/**
 * 专注计时器（番茄钟）+ 每日统计。
 * 免费版固定 25 分钟；Pro 可自定义时长与标签（由 IPC 层做权限判断）。
 */
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { app } = require('electron');
const { JsonFile } = require('./json-file');

const FREE_MINUTES = 25;
const MIN_MINUTES = 5;
const MAX_MINUTES = 180;

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class FocusTimer extends EventEmitter {
  constructor(settingsStore) {
    super();
    this.settingsStore = settingsStore;
    this.state = {
      running: false,
      paused: false,
      minutes: FREE_MINUTES,
      label: '',
      endsAt: 0,
      remainingMs: 0,
      startedAt: 0,
    };
    this._ticker = null;
    this._statsFile = new JsonFile(path.join(app.getPath('userData'), 'focus-stats.json'), {
      days: {},
      totalSessions: 0,
      totalMinutes: 0,
    });
    this._statsFile.load();
  }

  get remainingMs() {
    if (!this.state.running) return this.state.remainingMs;
    if (this.state.paused) return this.state.remainingMs;
    return Math.max(0, this.state.endsAt - Date.now());
  }

  snapshot() {
    return {
      running: this.state.running,
      paused: this.state.paused,
      minutes: this.state.minutes,
      label: this.state.label,
      endsAt: this.state.endsAt,
      remainingMs: this.remainingMs,
      startedAt: this.state.startedAt,
      today: this.todayStats(),
      history: this.history(7),
      totalSessions: this._statsFile.get('totalSessions') || 0,
      totalMinutes: this._statsFile.get('totalMinutes') || 0,
    };
  }

  todayStats() {
    const day = (this._statsFile.get('days') || {})[dateKey()];
    return day ? { sessions: day.sessions || 0, minutes: day.minutes || 0 } : { sessions: 0, minutes: 0 };
  }

  history(days = 7) {
    const all = this._statsFile.get('days') || {};
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const v = all[key] || { sessions: 0, minutes: 0 };
      out.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, sessions: v.sessions || 0, minutes: v.minutes || 0 });
    }
    return out;
  }

  start({ minutes, label } = {}) {
    if (this.state.running) this.stop({ silent: true });
    const m = Number(minutes) || FREE_MINUTES;
    const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(m)));
    this.state = {
      running: true,
      paused: false,
      minutes: clamped,
      label: String(label || '').slice(0, 40),
      endsAt: Date.now() + clamped * 60_000,
      remainingMs: clamped * 60_000,
      startedAt: Date.now(),
    };
    this.settingsStore.patch({ focus: { lastMinutes: clamped, lastLabel: this.state.label } });
    this._startTicker();
    this.emit('tick', this.snapshot());
    this.emit('started', this.snapshot());
    return this.snapshot();
  }

  pause() {
    if (!this.state.running || this.state.paused) return this.snapshot();
    this.state.remainingMs = this.remainingMs;
    this.state.paused = true;
    this._stopTicker();
    this.emit('tick', this.snapshot());
    return this.snapshot();
  }

  resume() {
    if (!this.state.running || !this.state.paused) return this.snapshot();
    this.state.endsAt = Date.now() + this.state.remainingMs;
    this.state.paused = false;
    this._startTicker();
    this.emit('tick', this.snapshot());
    return this.snapshot();
  }

  stop({ silent = false } = {}) {
    const wasRunning = this.state.running;
    const elapsedMin = this.state.running ? Math.round((this.state.minutes * 60_000 - this.remainingMs) / 60_000) : 0;
    this._stopTicker();
    this.state = { running: false, paused: false, minutes: this.state.minutes, label: '', endsAt: 0, remainingMs: 0, startedAt: 0 };
    if (wasRunning && elapsedMin >= 1 && !silent) {
      this._record(elapsedMin, false);
    }
    this.emit('tick', this.snapshot());
    if (wasRunning && !silent) this.emit('stopped', { elapsedMin });
    return this.snapshot();
  }

  _startTicker() {
    this._stopTicker();
    this._ticker = setInterval(() => {
      const left = this.remainingMs;
      if (left <= 0) {
        this._complete();
        return;
      }
      this.emit('tick', this.snapshot());
    }, 1000);
  }

  _stopTicker() {
    if (this._ticker) clearInterval(this._ticker);
    this._ticker = null;
  }

  _complete() {
    this._stopTicker();
    const minutes = this.state.minutes;
    const label = this.state.label;
    this.state = { running: false, paused: false, minutes, label: '', endsAt: 0, remainingMs: 0, startedAt: 0 };
    this._record(minutes, true);
    const snap = this.snapshot();
    this.emit('tick', snap);
    this.emit('complete', { minutes, label, snapshot: snap });
  }

  _record(minutes, completed) {
    const key = dateKey();
    const days = { ...(this._statsFile.get('days') || {}) };
    const cur = days[key] || { sessions: 0, minutes: 0 };
    days[key] = {
      sessions: cur.sessions + (completed ? 1 : 0),
      minutes: cur.minutes + minutes,
    };
    this._statsFile.patch({
      days,
      totalSessions: (this._statsFile.get('totalSessions') || 0) + (completed ? 1 : 0),
      totalMinutes: (this._statsFile.get('totalMinutes') || 0) + minutes,
    });
    this.emit('recorded', { minutes, completed, today: days[key] });
  }

  destroy() {
    this._stopTicker();
  }
}

module.exports = { FocusTimer, FREE_MINUTES, MIN_MINUTES, MAX_MINUTES };
