'use strict';
/**
 * 可靠性原语（spec §4.3 去重、§4.4 限流、§6 重连退避/发送队列/Presence 防抖）。
 * 时间与随机数均可注入，便于测试。
 */

/** 指数退避：1s,2s,4s… 上限 60s，±jitter 抖动 */
function backoffDelay(attempt, { base = 1000, max = 60000, jitter = 0.2, random = Math.random } = {}) {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt));
  const j = raw * jitter * (random() * 2 - 1);
  return Math.max(0, Math.min(max, Math.round(raw + j)));
}

/** LRU 去重集合（默认 2000），可序列化后持久化 */
class DedupeSet {
  constructor(limit = 2000, initial = []) { this.limit = limit; this.map = new Map(); for (const id of initial) this.add(id); }
  has(id) { return this.map.has(id); }
  add(id) {
    if (this.map.has(id)) { this.map.delete(id); this.map.set(id, 1); return false; }
    this.map.set(id, 1);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return true;
  }
  toJSON() { return [...this.map.keys()]; }
  get size() { return this.map.size; }
}

/** 10 秒规则：同一 action 每窗口 ≤ perAction 次，合计 ≤ total 次 */
class RateLimiter {
  constructor({ windowMs = 10000, perAction = 1, total = 3, now = Date.now } = {}) {
    Object.assign(this, { windowMs, perAction, total, now }); this.hits = [];
  }
  _prune() { const t = this.now() - this.windowMs; this.hits = this.hits.filter((h) => h.at > t); }
  check(action) {
    this._prune();
    const same = this.hits.filter((h) => h.action === action);
    if (same.length >= this.perAction) return { ok: false, retryInMs: same[0].at + this.windowMs - this.now() };
    if (this.hits.length >= this.total) return { ok: false, retryInMs: this.hits[0].at + this.windowMs - this.now() };
    return { ok: true, retryInMs: 0 };
  }
  take(action) { const r = this.check(action); if (r.ok) this.hits.push({ action, at: this.now() }); return r; }
}

/**
 * 持久化发送队列：失败按退避重试，重试时 id 不变（幂等）。
 * publish(env) 返回 Promise；store 为 {load():[], save(items)}。
 */
class SendQueue {
  constructor({ publish, store, timers = { setTimeout, clearTimeout }, random = Math.random, maxItems = 200, onDrop } = {}) {
    Object.assign(this, { publish, store, timers, random, maxItems, onDrop });
    this.items = (store && store.load && store.load()) || [];
    this.attempt = 0; this.timer = null; this.busy = false; this.paused = false;
  }
  enqueue(env) {
    if (this.items.some((i) => i.id === env.id)) return;
    this.items.push(env);
    while (this.items.length > this.maxItems) { const d = this.items.shift(); this.onDrop && this.onDrop(d); }
    this._save(); this.flush();
  }
  _save() { this.store && this.store.save && this.store.save(this.items); }
  pause() { this.paused = true; this._clear(); }
  resume() { this.paused = false; this.attempt = 0; this.flush(); }
  _clear() { if (this.timer) { this.timers.clearTimeout(this.timer); this.timer = null; } }
  async flush() {
    if (this.busy || this.paused) return;
    this.busy = true; this._clear();
    try {
      while (this.items.length && !this.paused) {
        const env = this.items[0];
        try { await this.publish(env); } catch (err) {
          if (err && err.fatal) { this.items.shift(); this._save(); this.onDrop && this.onDrop(env, err); continue; }
          const delay = backoffDelay(this.attempt++, { random: this.random });
          this.timer = this.timers.setTimeout(() => { this.timer = null; this.flush(); }, delay);
          if (this.timer && this.timer.unref) this.timer.unref();
          return;
        }
        this.items.shift(); this.attempt = 0; this._save();
      }
    } finally { this.busy = false; }
  }
  get pending() { return this.items.length; }
  dispose() { this._clear(); }
}

/** Presence 防抖：离线需持续 graceMs 才确认，上线立即生效 */
class PresenceDebouncer {
  constructor({ graceMs = 30000, onChange, timers = { setTimeout, clearTimeout } } = {}) {
    Object.assign(this, { graceMs, onChange, timers }); this.online = false; this.timer = null;
  }
  set(online) {
    if (online) {
      if (this.timer) { this.timers.clearTimeout(this.timer); this.timer = null; }
      if (!this.online) { this.online = true; this.onChange && this.onChange(true); }
      return;
    }
    if (!this.online || this.timer) return;
    this.timer = this.timers.setTimeout(() => { this.timer = null; this.online = false; this.onChange && this.onChange(false); }, this.graceMs);
    if (this.timer && this.timer.unref) this.timer.unref();
  }
  dispose() { if (this.timer) this.timers.clearTimeout(this.timer); }
}

module.exports = { backoffDelay, DedupeSet, RateLimiter, SendQueue, PresenceDebouncer };
