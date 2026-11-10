/**
 * 系统主题监听：深浅色 + 强调色 + 夜间时段。
 * 这是产品核心卖点：方块仔会跟着 Windows 主题一起「变暗、眼睛发光」。
 */
const { EventEmitter } = require('node:events');
const { nativeTheme, systemPreferences } = require('electron');

function pad(n) {
  return String(n).padStart(2, '0');
}

function minutesOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function normalizeHex(input) {
  const s = String(input || '').replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{8}$/.test(s)) return `#${s.slice(0, 6)}`.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`.toLowerCase();
  return null;
}

class ThemeWatcher extends EventEmitter {
  constructor(settingsStore) {
    super();
    this.settingsStore = settingsStore;
    this._timer = null;
    this._lastKey = '';
  }

  start() {
    nativeTheme.on('updated', () => this.emit('changed', this.snapshot()));
    this._timer = setInterval(() => {
      const snap = this.snapshot();
      const key = `${snap.dark}|${snap.nightNow}`;
      if (key !== this._lastKey) {
        this._lastKey = key;
        this.emit('changed', snap);
      }
    }, 30_000);
    this._lastKey = this._key(this.snapshot());
    return this.snapshot();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _key(snap) {
    return `${snap.dark}|${snap.nightNow}`;
  }

  /** 当前是否处于用户配置的夜间时段（支持跨零点，如 22:00-07:00） */
  isNightNow(now = new Date()) {
    const nm = this.settingsStore.get('nightMode') || {};
    if (!nm.enabled) return false;
    const start = minutesOfDay(nm.start);
    const end = minutesOfDay(nm.end);
    if (start == null || end == null || start === end) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end; // 跨零点
  }

  accentColor() {
    try {
      const raw = systemPreferences.getAccentColor && systemPreferences.getAccentColor();
      return normalizeHex(raw) || '#ef7a52';
    } catch {
      return '#ef7a52';
    }
  }

  snapshot() {
    const dark = !!nativeTheme.shouldUseDarkColors;
    const nightNow = this.isNightNow();
    const follow = this.settingsStore.get('followSystemTheme') !== false;
    const effectiveDark = follow ? dark || nightNow : nightNow;
    return {
      dark,
      nightNow,
      followSystemTheme: follow,
      effectiveDark,
      accent: this.accentColor(),
      time: Date.now(),
      clock: `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`,
    };
  }
}

module.exports = { ThemeWatcher, minutesOfDay };
