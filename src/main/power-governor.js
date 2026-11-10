'use strict';
/**
 * v2.2 性能：空闲/睡眠节流。
 * mode: 'active'（用户在用电脑）→ 'idle'（≥60s 无输入）→ 'sleep'（≥5min 无输入 / 锁屏 / 系统挂起 / 桌宠隐藏）
 * every(name, fn, { active, idle, sleep }) 注册自适应轮询：周期随模式变化，null 表示该模式下暂停。
 * 用 setTimeout 链而非 setInterval，模式切换立即生效，并统计每个轮询的唤醒次数（用于前后对比）。
 */
const { EventEmitter } = require('node:events');

class PowerGovernor extends EventEmitter {
  constructor({ getIdleSec = () => 0, isVisible = () => true, timers = { setTimeout, clearTimeout }, now = Date.now, idleSec = 60, sleepSec = 300, checkMs = 2000 } = {}) {
    super();
    Object.assign(this, { getIdleSec, isVisible, timers, now, idleSec, sleepSec, checkMs });
    this.mode = 'active';
    this.flags = { locked: false, suspended: false };
    this.loops = new Map();
    this.wakeups = {};
    this._checker = null;
  }
  computeMode() {
    if (this.flags.suspended || this.flags.locked || !this.isVisible()) return 'sleep';
    let idle = 0;
    try { idle = Number(this.getIdleSec()) || 0; } catch { /* ignore */ }
    if (idle >= this.sleepSec) return 'sleep';
    if (idle >= this.idleSec) return 'idle';
    return 'active';
  }
  update() {
    const m = this.computeMode();
    if (m !== this.mode) {
      const prev = this.mode; this.mode = m;
      for (const loop of this.loops.values()) this._arm(loop, true);
      this.emit('mode', m, prev);
    }
    return this.mode;
  }
  setFlag(name, on) { this.flags[name] = !!on; return this.update(); }
  start() {
    if (this._checker) return this;
    const tick = () => { this.update(); this._checker = this.timers.setTimeout(tick, this.checkMs); if (this._checker && this._checker.unref) this._checker.unref(); };
    this._checker = this.timers.setTimeout(tick, this.checkMs);
    return this;
  }
  stop() {
    if (this._checker) this.timers.clearTimeout(this._checker);
    this._checker = null;
    for (const name of [...this.loops.keys()]) this.cancel(name);
  }
  periodOf(loop) {
    let p = loop.periods[this.mode];
    if (p === undefined) p = loop.periods.active;
    return typeof p === 'function' ? p() : p; // 函数：按场景动态周期（如鼠标远离桌宠时降频）
  }
  _arm(loop, reset) {
    if (reset && loop.h) { this.timers.clearTimeout(loop.h); loop.h = null; }
    if (loop.h) return;
    const ms = this.periodOf(loop);
    if (ms == null) return; // 本模式暂停
    loop.h = this.timers.setTimeout(() => {
      loop.h = null;
      this.wakeups[loop.name] = (this.wakeups[loop.name] || 0) + 1;
      try { loop.fn(this.mode); } catch { /* 轮询体出错不影响调度 */ }
      if (this.loops.get(loop.name) === loop) this._arm(loop, false);
    }, ms);
    if (loop.h && loop.h.unref) loop.h.unref();
  }
  every(name, fn, periods) {
    this.cancel(name);
    const loop = { name, fn, periods: { ...periods }, h: null };
    this.loops.set(name, loop);
    this._arm(loop, false);
    return { stop: () => this.cancel(name) };
  }
  /** 立刻按当前模式重新排期（例如鼠标靠近桌宠时需要高频命中检测） */
  poke(name) { const l = this.loops.get(name); if (l) this._arm(l, true); }
  cancel(name) {
    const l = this.loops.get(name);
    if (!l) return;
    if (l.h) this.timers.clearTimeout(l.h);
    this.loops.delete(name);
  }
  stats() { return { mode: this.mode, flags: { ...this.flags }, wakeups: { ...this.wakeups }, loops: [...this.loops.keys()] }; }
}

/** 默认节流表（毫秒；null=暂停）。原实现：cursor 100 / hitTest 30 / clipboard 1500 / activity 1000，任何状态都不降频 */
const PERIODS = {
  cursor: { active: 100, idle: 400, sleep: null },
  hitTest: { active: 30, idle: 120, sleep: 400 },
  clipboard: { active: 1500, idle: 4000, sleep: null },
};

module.exports = { PowerGovernor, PERIODS };
