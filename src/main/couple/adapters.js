'use strict';
/**
 * RealtimeAdapter 抽象（spec §8：中国区可替换为境内 IM/RTC）。
 * 统一接口：
 *   connect({ userId, token, channels, presenceChannels }) / disconnect()
 *   setToken(token)
 *   publish(channel, message) -> { timetoken }
 *   fetchSince(channel, timetoken) -> [{ message, timetoken, publisher }]  （严格晚于 timetoken，升序）
 *   setState(channel, state) / hereNow(channel) -> [userId]
 *   on('message' {channel,message,timetoken,publisher}) / on('presence' {uuid,action,state})
 *   on('status' 'connected'|'down'|'reconnected'|'denied')
 */
const { EventEmitter } = require('node:events');

/** 进程内总线：测试和“演示模式/局域网自测”用；模拟 PubNub 持久化 + presence */
class MemoryBus {
  constructor() { this.history = new Map(); this.clients = new Set(); this.tt = 17000000000000000n; this.deny = new Set(); }
  nextTT() { this.tt += 1n; return String(this.tt); }
}

class MemoryAdapter extends EventEmitter {
  constructor(bus) { super(); this.bus = bus; this.connected = false; this.subs = new Set(); this.uid = ''; this.online = true; this.state = {}; }
  async connect({ userId, channels = [] }) {
    this.uid = userId; channels.forEach((c) => this.subs.add(c)); this.connected = true; this.bus.clients.add(this);
    this._presence('join'); this.emit('status', 'connected');
  }
  _presence(action) {
    for (const c of this.bus.clients) if (c !== this && c.connected && c.online) c.emit('presence', { uuid: this.uid, action, state: this.state });
  }
  async disconnect() { this._presence('leave'); this.connected = false; this.bus.clients.delete(this); }
  setToken() {}
  /** 测试用：模拟网络断开 / 恢复 */
  simulateDown() { this.online = false; this._presence('timeout'); this.emit('status', 'down'); }
  simulateUp() { this.online = true; this._presence('join'); this.emit('status', 'reconnected'); }
  async publish(channel, message) {
    if (!this.online) { const e = new Error('网络不可用'); e.code = 'NETWORK'; throw e; }
    if (this.bus.deny.has(this.uid)) { const e = new Error('403'); e.status = 403; throw e; }
    const timetoken = this.bus.nextTT();
    const entry = { message: JSON.parse(JSON.stringify(message)), timetoken, publisher: this.uid };
    if (!this.bus.history.has(channel)) this.bus.history.set(channel, []);
    this.bus.history.get(channel).push(entry);
    for (const c of this.bus.clients) if (c.connected && c.online && c.subs.has(channel)) c.emit('message', { channel, ...entry });
    return { timetoken };
  }
  async fetchSince(channel, timetoken) {
    if (!this.online) { const e = new Error('网络不可用'); e.code = 'NETWORK'; throw e; }
    const all = this.bus.history.get(channel) || [];
    return all.filter((e) => !timetoken || BigInt(e.timetoken) > BigInt(timetoken)).slice(-100);
  }
  async setState(_channel, state) { this.state = state; this._presence('state-change'); }
  async hereNow() { return [...this.bus.clients].filter((c) => c.connected && c.online).map((c) => c.uid); }
}

/** PubNub JS SDK（v8+）适配。SDK 懒加载：未安装 pubnub 时 create() 返回 null，服务降级为演示模式。 */
class PubNubAdapter extends EventEmitter {
  static create(cfg, requireFn = require) {
    let PubNub;
    try { PubNub = requireFn('pubnub'); } catch { return null; }
    return new PubNubAdapter(cfg, PubNub.default || PubNub);
  }
  constructor({ publishKey, subscribeKey, heartbeatInterval = 29, presenceTimeout = 60 }, PubNub) {
    super(); Object.assign(this, { publishKey, subscribeKey, heartbeatInterval, presenceTimeout, PubNub }); this.pn = null;
  }
  async connect({ userId, token, channels = [] }) {
    this.pn = new this.PubNub({
      publishKey: this.publishKey, subscribeKey: this.subscribeKey, userId,
      restore: true, heartbeatInterval: this.heartbeatInterval, presenceTimeout: this.presenceTimeout,
      // 关闭 SDK 自带重试，由 CoupleService 统一退避（避免双重重试）
    });
    if (token) this.pn.setToken(token);
    this.pn.addListener({
      message: (e) => this.emit('message', { channel: e.channel, message: e.message, timetoken: String(e.timetoken), publisher: e.publisher }),
      presence: (e) => this.emit('presence', { uuid: e.uuid, action: e.action, state: e.state }),
      status: (s) => {
        const c = s && s.category;
        if (c === 'PNConnectedCategory') this.emit('status', 'connected');
        else if (c === 'PNNetworkDownCategory' || c === 'PNNetworkIssuesCategory' || c === 'PNDisconnectedUnexpectedlyCategory') this.emit('status', 'down');
        else if (c === 'PNReconnectedCategory' || c === 'PNNetworkUpCategory') this.emit('status', 'reconnected');
        else if (c === 'PNAccessDeniedCategory') this.emit('status', 'denied');
      },
    });
    this.pn.subscribe({ channels, withPresence: true });
  }
  async disconnect() { if (this.pn) { this.pn.unsubscribeAll(); this.pn.stop && this.pn.stop(); this.pn = null; } }
  setToken(token) { if (this.pn) this.pn.setToken(token); }
  async publish(channel, message) {
    try { const r = await this.pn.publish({ channel, message, storeInHistory: true }); return { timetoken: String(r.timetoken) }; } catch (err) {
      const status = err && err.status && err.status.statusCode;
      const e = new Error((err && err.message) || 'publish failed'); e.status = status; e.fatal = status === 400; throw e;
    }
  }
  async fetchSince(channel, timetoken) {
    const end = timetoken ? String(BigInt(timetoken) + 1n) : undefined;
    const r = await this.pn.fetchMessages({ channels: [channel], end, count: 100 });
    const list = (r && r.channels && r.channels[channel]) || [];
    return list.map((m) => ({ message: m.message, timetoken: String(m.timetoken), publisher: m.uuid }))
      .sort((a, b) => (BigInt(a.timetoken) < BigInt(b.timetoken) ? -1 : 1));
  }
  async setState(channel, state) { await this.pn.setState({ channels: [channel], state }); }
  async hereNow(channel) {
    const r = await this.pn.hereNow({ channels: [channel], includeUUIDs: true });
    const occ = (r && r.channels && r.channels[channel] && r.channels[channel].occupants) || [];
    return occ.map((o) => o.uuid);
  }
}

module.exports = { MemoryBus, MemoryAdapter, PubNubAdapter };
