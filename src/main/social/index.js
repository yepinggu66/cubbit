/**
 * 方块仔 — 情侣模式客户端（真实实现，替换原占位 stub）
 *
 * 与主进程的契约（保持方法签名/事件名不变）：
 *   new SocialClient({ userDataDir, apiBase, deviceId, petName, skinId, fetchImpl?, now?, platform? })
 *   init() / snapshot() / setProfile({petName,skinId,loveNote}) / setApiBase(base)
 *   createInvite() -> {ok, code, expiresAt, couple}
 *   join(code)     -> {ok, couple}
 *   unpair()       -> {ok, couple}
 *   send(text, kind) -> {ok, message, couple}
 *   poll()         -> {ok, messages, couple}
 *   propose() / accept() / decline() -> {ok, couple}
 *   setLoveNote(text) -> {ok, couple}
 *   heartbeat(presence) -> {ok, partner}
 *   status()       -> {ok, couple}
 * 事件：'changed'（couple 快照变化）、'message'（收到对方的新消息数组）、'error'
 *
 * 设计约束：
 *  - 不 require('electron')：目录/fetch/now 全部可注入，node --test 可直接测。
 *  - 不 throw：网络失败/服务未启动/配对失效都返回 {ok:false, offline?, code, message(中文), couple}。
 *  - 持久化 <userDataDir>/social.json（token、pairId、partner 缓存、lastMessageAt、消息缓存）。
 *  - 未完成配对时（等待 TA 输入配对码）内部 5 秒轮询一次 status，配对成功后停掉，
 *    之后由主进程的 poll/heartbeat 循环接管（主进程只在 enabled 时轮询）。
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { JsonFile } = require('../json-file');
const { ApiClient, normalizeBase } = require('../license/api-client');
const { PRODUCT } = require('../../shared/catalog');

const DEFAULT_PET_NAME = '方块仔';
const DEFAULT_SKIN_ID = 'blaze';
const WAITING_POLL_MS = 5000;
const MESSAGE_CACHE_LIMIT = 60;
const FIRST_POLL_GRACE_MS = 5 * 60 * 1000; // 首次拉取时，5 分钟内的消息算「新消息」发通知

const FILE_DEFAULTS = {
  token: '',
  pairId: '',
  lastMessageAt: 0,
  messages: [],
  couple: null,
  profile: null,
  updatedAt: 0,
};

function defaultPartner() {
  return { name: '', skinId: DEFAULT_SKIN_ID, online: false, lastSeenAt: 0, presence: null };
}

function defaultDailyLove() {
  return { sent: false, text: '', at: 0, from: null };
}

/** 与主进程 state.couple 同构的默认快照（字段名不要改，UI 依赖） */
function defaultCouple(profile = {}) {
  return {
    enabled: false,
    pairId: '',
    partner: defaultPartner(),
    married: false,
    marriedAt: 0,
    affection: 0,
    unread: 0,
    pendingProposal: false,
    proposalFrom: null,
    dailyLove: defaultDailyLove(),
    anniversaryDays: 0,
    messages: [],
    serverOnline: false,
    error: '',
    invite: null,
    me: { name: profile.petName || DEFAULT_PET_NAME, skinId: profile.skinId || DEFAULT_SKIN_ID },
    serverTime: 0,
    profile: { petName: profile.petName || DEFAULT_PET_NAME, skinId: profile.skinId || DEFAULT_SKIN_ID },
  };
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** 找一个可写目录；不可写时降级到临时目录，绝不抛异常 */
function resolveWritableDir(preferred) {
  const userTag = (() => {
    try {
      return String((os.userInfo() && os.userInfo().username) || 'user').replace(/[^\w.-]/g, '_');
    } catch {
      return 'user';
    }
  })();
  const candidates = [
    preferred,
    path.join(os.tmpdir(), `cubbit-social-${userTag}`),
    path.join(os.tmpdir(), 'cubbit-social'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      /* 尝试下一个 */
    }
  }
  return os.tmpdir();
}

class SocialClient extends EventEmitter {
  /**
   * @param {{userDataDir?:string, apiBase?:string, deviceId?:string, petName?:string, skinId?:string,
   *          fetchImpl?:Function, now?:Function, platform?:string, timeoutMs?:number}} [options]
   */
  constructor(options = {}) {
    super();
    this.options = options || {};
    this.now = typeof this.options.now === 'function' ? this.options.now : () => Date.now();
    this.platform = this.options.platform || process.platform;
    this.deviceId = String(this.options.deviceId || process.env.CUBBIT_DEVICE_ID || '');
    this.profile = {
      petName: String(this.options.petName || DEFAULT_PET_NAME).slice(0, 20) || DEFAULT_PET_NAME,
      skinId: String(this.options.skinId || DEFAULT_SKIN_ID).slice(0, 32) || DEFAULT_SKIN_ID,
      loveNote: '',
    };

    const requestedDir =
      this.options.userDataDir || process.env.CUBBIT_USERDATA || path.join(os.homedir(), '.cubbit');
    this.userDataDir = resolveWritableDir(path.resolve(requestedDir));

    this.apiBase = normalizeBase(this.options.apiBase || PRODUCT.apiBase);
    this.api = new ApiClient({
      baseUrl: this.apiBase,
      timeoutMs: Number.isFinite(this.options.timeoutMs) ? this.options.timeoutMs : 6000,
      fetchImpl: this.options.fetchImpl,
    });

    this.file = new JsonFile(path.join(this.userDataDir, 'social.json'), FILE_DEFAULTS);
    try {
      this.file.load();
    } catch {
      this.file.data = { ...FILE_DEFAULTS };
    }

    const savedProfile = this.file.get('profile');
    if (savedProfile && typeof savedProfile === 'object') {
      this.profile = { ...this.profile, ...savedProfile };
    }
    const savedCouple = this.file.get('couple');
    this.couple = savedCouple
      ? { ...defaultCouple(this.profile), ...savedCouple, serverOnline: false, error: '' }
      : defaultCouple(this.profile);

    this.token = String(this.file.get('token') || '');
    this.pairId = String(this.file.get('pairId') || this.couple.pairId || '');
    this.lastMessageAt = Number(this.file.get('lastMessageAt')) || 0;
    this.messagesCache = Array.isArray(this.file.get('messages')) ? this.file.get('messages') : [];
    if (!this.couple.messages || !Array.isArray(this.couple.messages)) this.couple.messages = [];

    this._waitTimer = null;
    this._lastSignature = JSON.stringify(this.couple);
    this._lastErrorCode = '';
    this._pollBusy = false;
  }

  // ---------------------------------------------------------------- 生命周期

  /** 启动时调用：尽量联网刷新一次；失败则保留本地缓存（离线可用），绝不 throw */
  async init() {
    this._applyCachedMessages();
    if (!this.token) {
      this._emitChanged(true);
      return this.snapshot();
    }
    try {
      const res = await this.status();
      if (!res.ok && res.code === 'UNAUTHORIZED_INVITE') {
        // 对方已解除配对 / 服务端数据被清理：本地也清零
        this._clearLocal('配对已失效，可能对方解除了配对');
      }
    } catch (err) {
      this._setError('INTERNAL', (err && err.message) || '情侣服务初始化失败');
    }
    this._syncWaitTimer();
    this._emitChanged(true);
    return this.snapshot();
  }

  /** 与主进程 state.couple 同构的快照（深拷贝，避免外部误改） */
  snapshot() {
    const couple = safeprofileSnapshot(this.couple, this.profile);
    couple.messages = this.messagesCache.slice(-MESSAGE_CACHE_LIMIT).map((message) => ({ ...message }));
    return couple;
  }

  setApiBase(base) {
    this.apiBase = normalizeBase(base || PRODUCT.apiBase);
    this.api.setBaseUrl(this.apiBase);
    return this.apiBase;
  }

  setProfile(profile = {}) {
    if (!profile || typeof profile !== 'object') return this.profile;
    if (profile.petName !== undefined) {
      const name = String(profile.petName || '').trim().slice(0, 20);
      if (name) this.profile.petName = name;
    }
    if (profile.skinId !== undefined) {
      const skinId = String(profile.skinId || '').trim().slice(0, 32);
      if (skinId) this.profile.skinId = skinId;
    }
    if (profile.loveNote !== undefined) {
      this.profile.loveNote = String(profile.loveNote || '').slice(0, 140);
    }
    this.couple.me = { name: this.profile.petName, skinId: this.profile.skinId };
    this.couple.profile = { petName: this.profile.petName, skinId: this.profile.skinId };
    this._persist();
    this._emitChanged();
    return this.profile;
  }

  stop() {
    if (this._waitTimer) {
      clearInterval(this._waitTimer);
      this._waitTimer = null;
    }
  }

  // ---------------------------------------------------------------- 配对

  /** 生成 6 位配对码（10 分钟有效） */
  async createInvite() {
    const res = await this._post('/api/social/pair/create', {
      deviceId: this.deviceId,
      petName: this.profile.petName,
      skinId: this.profile.skinId,
    });
    if (!res.ok) return this._fail(res);
    this.token = String(res.token || '');
    this.pairId = String(res.pairId || '');
    this.couple = {
      ...this.couple,
      enabled: false,
      pairId: this.pairId,
      invite: {
        code: String(res.pairCode || ''),
        inviteId: String(res.inviteId || ''),
        expiresAt: Number(res.expiresAt) || 0,
        expired: false,
      },
      serverOnline: true,
      error: '',
      serverTime: Number(res.serverTime) || this.now(),
    };
    this._persist();
    this._emitChanged(true);
    this._syncWaitTimer();
    return {
      ok: true,
      code: String(res.pairCode || ''),
      inviteId: String(res.inviteId || ''),
      expiresAt: Number(res.expiresAt) || 0,
      couple: this.snapshot(),
    };
  }

  /** 输入 TA 的 6 位配对码加入 */
  async join(code) {
    const pairCode = String(code == null ? '' : code)
      .replace(/\D/g, '')
      .slice(0, 6);
    if (pairCode.length !== 6) {
      return this._localError('PAIR_CODE_INVALID', '配对码应为 6 位数字');
    }
    const res = await this._post('/api/social/pair/join', {
      pairCode,
      deviceId: this.deviceId,
      petName: this.profile.petName,
      skinId: this.profile.skinId,
    });
    if (!res.ok) return this._fail(res);
    this.token = String(res.token || '');
    this.pairId = String(res.pairId || '');
    this.couple = {
      ...this.couple,
      enabled: true,
      pairId: this.pairId,
      invite: null,
      serverOnline: true,
      error: '',
      serverTime: Number(res.serverTime) || this.now(),
    };
    this._persist();
    this._emitChanged(true);
    // 拉一次完整状态（拿到对方在线/关系值/纪念日）
    const fresh = await this.status();
    if (fresh && fresh.ok) return { ok: true, couple: this.snapshot() };
    return { ok: true, couple: this.snapshot() };
  }

  /** 解除配对（会清空服务端聊天记录） */
  async unpair() {
    if (!this.token) {
      this._clearLocal('');
      return { ok: true, couple: this.snapshot() };
    }
    const res = await this._post('/api/social/unpair', { token: this.token });
    if (!res.ok && res.code !== 'UNAUTHORIZED_INVITE') return this._fail(res);
    this._clearLocal('');
    return { ok: true, couple: this.snapshot() };
  }

  // ---------------------------------------------------------------- 状态 / 聊天

  async status() {
    if (!this.token) return { ok: false, code: 'NOT_PAIRED', message: '还没有配对', couple: this.snapshot() };
    const res = await this._get('/api/social/pair/status', { token: this.token });
    if (!res.ok) return this._fail(res);
    this._applyStatus(res);
    return { ok: true, couple: this.snapshot() };
  }

  /** 同步情侣空间（通过隐藏前缀消息，渲染层会过滤不显示） */
  async sendScene(id, light) {
    const safeId = String(id || '').slice(0, 24);
    const safeLight = light === 'dark' ? 'dark' : 'light';
    return this.send(`[[scene]]${safeId}|${safeLight}`, 'chat');
  }

  async send(text, kind = 'chat') {
    if (!this.token) return this._localError('NOT_PAIRED', '还没有配对，无法发送消息');
    const content = String(text == null ? '' : text).trim();
    if (!content) return this._localError('BAD_REQUEST', '消息不能为空');
    if (Array.from(content).length > 200) return this._localError('BAD_REQUEST', '消息最多 200 个字符');
    const res = await this._post('/api/social/messages', { token: this.token, text: content, kind });
    if (!res.ok) return this._fail(res);
    const message = res.message || {};
    this._appendCache([{ ...message, from: 'me' }], { skipPartnerNotify: true });
    this.lastMessageAt = Math.max(this.lastMessageAt, Number(message.at) || 0);
    if (Number.isFinite(Number(res.affection))) this.couple.affection = Number(res.affection);
    this.couple.unread = 0;
    this.couple.serverOnline = true;
    this.couple.error = '';
    this._persist();
    this._emitChanged(true);
    return { ok: true, message, couple: this.snapshot() };
  }

  /**
   * 拉取对方新消息。返回的 messages 只包含「新收到的对方消息」，主进程据此弹通知，
   * 避免把历史消息重复播报；完整最近消息在 snapshot().messages 里。
   */
  async poll() {
    if (!this.token) return { ok: true, messages: [], couple: this.snapshot() };
    if (this._pollBusy) return { ok: true, messages: [], couple: this.snapshot() };
    this._pollBusy = true;
    try {
      const since = this.lastMessageAt || 0;
      const res = await this._get('/api/social/messages', { token: this.token, since: String(since) });
      if (!res.ok) {
        const failure = this._fail(res);
        return { ok: false, offline: !!failure.offline, code: failure.code, message: failure.message, messages: [], couple: this.snapshot() };
      }
      const list = Array.isArray(res.messages) ? res.messages : [];
      const nowMs = this.now();
      const isFirstPoll = since === 0;
      const freshPartner = list.filter(
        (message) =>
          message.from === 'partner' &&
          (!isFirstPoll || (Number(message.at) || 0) > nowMs - FIRST_POLL_GRACE_MS)
      );
      const maxAt = list.reduce((max, message) => Math.max(max, Number(message.at) || 0), since);
      this.lastMessageAt = maxAt;
      this._appendCache(list);
      this.couple.unread = 0;
      this.couple.serverOnline = true;
      this.couple.error = '';
      this.couple.serverTime = Number(res.serverTime) || nowMs;
      if (freshPartner.length) this.emit('message', freshPartner);
      this._persist();
      this._emitChanged();
      return { ok: true, messages: freshPartner, couple: this.snapshot() };
    } finally {
      this._pollBusy = false;
    }
  }

  // ---------------------------------------------------------------- 结婚

  async propose() {
    const res = await this._post('/api/social/marry/propose', { token: this.token });
    if (!res.ok) return this._fail(res);
    this.couple.pendingProposal = true;
    this.couple.proposalFrom = (res.pendingProposal && res.pendingProposal.from) || 'me';
    this.couple.serverOnline = true;
    await this.status();
    return { ok: true, couple: this.snapshot() };
  }

  async accept() {
    const res = await this._post('/api/social/marry/accept', { token: this.token });
    if (!res.ok) return this._fail(res);
    this.couple.married = true;
    this.couple.marriedAt = Number(res.marriedAt) || this.now();
    this.couple.pendingProposal = false;
    this.couple.proposalFrom = null;
    if (Number.isFinite(Number(res.affection))) this.couple.affection = Number(res.affection);
    await this.status();
    return { ok: true, couple: this.snapshot() };
  }

  async decline() {
    const res = await this._post('/api/social/marry/decline', { token: this.token });
    if (!res.ok) return this._fail(res);
    this.couple.pendingProposal = false;
    this.couple.proposalFrom = null;
    await this.status();
    return { ok: true, couple: this.snapshot() };
  }

  // ---------------------------------------------------------------- 每日情话 / 在线

  async setLoveNote(text) {
    const note = String(text == null ? '' : text).trim();
    if (!note) return this._localError('BAD_REQUEST', '情话不能为空');
    if (Array.from(note).length > 140) return this._localError('BAD_REQUEST', '情话最多 140 个字符');
    const res = await this._post('/api/social/love-note', { token: this.token, text: note });
    if (!res.ok) return this._fail(res);
    this.couple.dailyLove = {
      sent: true,
      text: note,
      at: Number(res.dailyLove && res.dailyLove.at) || this.now(),
      from: 'me',
    };
    this.couple.serverOnline = true;
    this._persist();
    this._emitChanged(true);
    return { ok: true, couple: this.snapshot() };
  }

  /** 心跳：更新自己在另一台机器上的在线状态，并刷新对方的在线情况 */
  async heartbeat(presence = {}) {
    if (!this.token) return { ok: false, partner: null, couple: this.snapshot() };
    const payload = {
      token: this.token,
      presence: {
        kind: String((presence && presence.kind) || 'working'),
        app: String((presence && presence.app) || '').slice(0, 64),
        title: String((presence && presence.title) || '').slice(0, 120),
        // 顺带同步自己的昵称/皮肤，对方能看到最新形象
        petName: this.profile.petName,
        skinId: this.profile.skinId,
      },
    };
    const res = await this._post('/api/social/heartbeat', payload);
    if (!res.ok) {
      const failure = this._fail(res);
      return { ok: false, offline: !!failure.offline, code: failure.code, message: failure.message, partner: null, couple: this.snapshot() };
    }
    if (res.partner) {
      this.couple.partner = {
        name: res.partner.name || '',
        skinId: res.partner.skinId || DEFAULT_SKIN_ID,
        online: !!res.partner.online,
        lastSeenAt: Number(res.partner.lastSeenAt) || 0,
        presence: res.partner.presence || null,
      };
    }
    this.couple.serverOnline = true;
    this.couple.error = '';
    this._persist();
    this._emitChanged();
    return { ok: true, partner: res.partner || null, couple: this.snapshot() };
  }

  // ---------------------------------------------------------------- 内部

  _post(apiPath, body) {
    return this.api.post(apiPath, body);
  }

  _get(apiPath, query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.api.get(`${apiPath}${suffix}`);
  }

  _applyStatus(status) {
    const partner = status.partner;
    this.pairId = String(status.pairId || '');
    this.couple = {
      ...this.couple,
      enabled: Boolean(status.paired),
      pairId: this.pairId,
      partner: partner
        ? {
            name: partner.name || '',
            skinId: partner.skinId || DEFAULT_SKIN_ID,
            online: Boolean(partner.online),
            lastSeenAt: Number(partner.lastSeenAt) || 0,
            presence: partner.presence || null,
          }
        : defaultPartner(),
      married: Boolean(status.married),
      marriedAt: Number(status.marriedAt) || 0,
      affection: Number(status.affection) || 0,
      unread: Number(status.unread) || 0,
      pendingProposal: Boolean(status.pendingProposal),
      proposalFrom: status.pendingProposal ? status.pendingProposal.from : null,
      dailyLove: status.dailyLove
        ? {
            sent: Boolean(status.dailyLove.sent),
            text: String(status.dailyLove.text || ''),
            at: Number(status.dailyLove.at) || 0,
            from: status.dailyLove.from || null,
          }
        : defaultDailyLove(),
      anniversaryDays: Number(status.anniversaryDays) || 0,
      invite: status.invite
        ? {
            code: String(status.invite.code || ''),
            inviteId: String(status.invite.inviteId || ''),
            expiresAt: Number(status.invite.expiresAt) || 0,
            expired: Boolean(status.invite.expired),
          }
        : null,
      me: status.me ? { name: status.me.name, skinId: status.me.skinId } : this.couple.me,
      serverOnline: true,
      error: '',
      serverTime: Number(status.serverTime) || this.now(),
    };
    this._applyCachedMessages();
    this._persist();
    this._syncWaitTimer();
    this._emitChanged();
  }

  _appendCache(list, { skipPartnerNotify = false } = {}) {
    if (!Array.isArray(list) || !list.length) return;
    void skipPartnerNotify;
    const known = new Set(this.messagesCache.map((message) => message.id));
    const merged = this.messagesCache.slice();
    for (const message of list) {
      if (!message || !message.id || known.has(message.id)) continue;
      known.add(message.id);
      merged.push({
        id: message.id,
        from: message.from === 'partner' ? 'partner' : 'me',
        text: String(message.text || ''),
        kind: String(message.kind || 'chat'),
        at: Number(message.at) || 0,
      });
    }
    merged.sort((a, b) => a.at - b.at);
    this.messagesCache = merged.slice(-MESSAGE_CACHE_LIMIT);
    this.couple.messages = this.messagesCache;
  }

  _applyCachedMessages() {
    this.couple.messages = this.messagesCache.slice(-MESSAGE_CACHE_LIMIT);
  }

  _clearLocal(errorMessage) {
    this.token = '';
    this.pairId = '';
    this.lastMessageAt = 0;
    this.messagesCache = [];
    this.couple = defaultCouple(this.profile);
    this.couple.profile = { petName: this.profile.petName, skinId: this.profile.skinId };
    if (errorMessage) this.couple.error = errorMessage;
    this._setError(errorMessage ? 'UNAUTHORIZED_INVITE' : '', errorMessage || '');
    this._persist();
    this._syncWaitTimer();
    this._emitChanged(true);
  }

  /** 把各种失败归一化：离线 / 配对失效 / 业务错误码，全部不 throw */
  _fail(res) {
    const offline = Boolean(res && res.offline);
    const code = String((res && res.code) || 'NETWORK_ERROR');
    const message = String(
      (res && res.message) ||
        (offline ? '无法连接情侣服务器，请检查网络或服务端是否已启动' : '操作失败，请稍后重试')
    );

    if (code === 'UNAUTHORIZED_INVITE' && this.token) {
      // token 失效（对方解除配对 / 服务端清库）
      this._clearLocal(message || '配对已失效，可能对方解除了配对');
      return {
        ok: false,
        code: 'UNAUTHORIZED_INVITE',
        message: message || '配对已失效，可能对方解除了配对',
        couple: this.snapshot(),
      };
    }

    this.couple.serverOnline = false;
    this.couple.error = message;
    if (offline) {
      this.couple.serverTime = this.now();
    }
    this._setError(code, message);
    this._persist();
    this._emitChanged();
    return { ok: false, offline, code, message, couple: this.snapshot() };
  }

  _localError(code, message) {
    this.couple.error = message;
    this._setError(code, message);
    this._emitChanged();
    return { ok: false, code, message, couple: this.snapshot() };
  }

  _setError(code, message) {
    if (!code && !message) {
      this._lastErrorCode = '';
      return;
    }
    this.couple.error = message || this.couple.error;
    // 同一种错误只派发一次 error 事件，避免 4 秒轮询刷屏；
    // 没有监听者时不 emit（EventEmitter 的 'error' 无监听会抛异常，不能影响主进程启动）。
    if (this._lastErrorCode !== code) {
      this._lastErrorCode = code;
      const payload = { code, message: this.couple.error };
      if (this.listenerCount('error') > 0) this.emit('error', payload);
    }
  }

  _syncWaitTimer() {
    const needWait = Boolean(this.token) && !this.couple.enabled;
    if (needWait && !this._waitTimer) {
      this._waitTimer = setInterval(() => {
        void this.status();
      }, WAITING_POLL_MS);
      if (typeof this._waitTimer.unref === 'function') this._waitTimer.unref();
    } else if (!needWait && this._waitTimer) {
      clearInterval(this._waitTimer);
      this._waitTimer = null;
    }
  }

  _persist() {
    const couple = safeClone(this.couple);
    couple.serverOnline = false;
    couple.error = '';
    couple.messages = [];
    this.file.patch({
      token: this.token,
      pairId: this.pairId,
      lastMessageAt: this.lastMessageAt,
      messages: this.messagesCache.slice(-MESSAGE_CACHE_LIMIT),
      couple,
      profile: { petName: this.profile.petName, skinId: this.profile.skinId, loveNote: this.profile.loveNote },
      updatedAt: this.now(),
    });
  }

  _emitChanged(force = false) {
    const signature = JSON.stringify([
      this.couple.enabled,
      this.couple.pairId,
      this.couple.partner,
      this.couple.married,
      this.couple.affection,
      this.couple.pendingProposal,
      this.couple.proposalFrom,
      this.couple.dailyLove,
      this.couple.unread,
      this.couple.anniversaryDays,
      this.couple.invite,
      this.couple.serverOnline,
      this.couple.error,
    ]);
    if (!force && signature === this._lastSignature) return;
    this._lastSignature = signature;
    this.emit('changed', this.snapshot());
  }
}

/** 快照里的 profile 字段与 me 保持一致，避免 UI 拿不到自己的名字/皮肤 */
function safeprofileSnapshot(couple, profile) {
  const cloned = safeClone(couple);
  cloned.profile = { petName: profile.petName, skinId: profile.skinId };
  cloned.me = { name: profile.petName, skinId: profile.skinId };
  return cloned;
}

module.exports = { SocialClient, defaultCouple, resolveWritableDir };
