'use strict';

/**
 * 台词库服务：bundled 320+ 条 + 服务端每月新增 20 条（增量拉取、本地缓存、离线回退）。
 *
 * 设计：
 * - bundled：app/src/shared/lines.js（打包进 app.asar，永远可用）
 * - 月度：GET /api/content/lines?since=<packVersion>，缓存到 userData/content/lines.json，去重合并
 * - 选取：按 context + mood 优先，避免最近 40 条重复；支持 important 强情绪
 * - 隐私：只拉内容，不上报任何用户信息
 */

const fs = require('node:fs');
const path = require('node:path');

const CACHE_VERSION = 1;
const MAX_RECENT = 40;

function normalizeLine(raw, fallbackContext) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text == null ? '' : raw.text).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    id: String(raw.id || `${fallbackContext}-${text.slice(0, 8)}`),
    text,
    mood: String(raw.mood || 'calm'),
    context: String(raw.context || fallbackContext || 'idle'),
    important: !!raw.important,
    voice: raw.voice == null ? '' : String(raw.voice),
  };
}

class LinesService {
  /**
   * @param {object} opts
   * @param {string} opts.userDataDir
   * @param {() => string} [opts.apiBase]
   * @param {Function} [opts.fetchImpl]
   * @param {Function} [opts.now]
   * @param {object} [opts.settings]
   * @param {object} [opts.bundled] 直接注入 bundled（测试用）
   */
  constructor(opts = {}) {
    this.userDataDir = opts.userDataDir || '';
    this.apiBase = typeof opts.apiBase === 'function' ? opts.apiBase : () => opts.apiBase || '';
    this.fetchImpl = opts.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.settings = opts.settings || null;
    this.bundled = opts.bundled || null;
    this.lines = [];
    this.byContext = new Map();
    this.byMood = new Map();
    this.packVersion = 0;
    this.month = '';
    this.monthlyAdded = 0;
    this.lastSyncAt = 0;
    this.lastError = '';
    this.recent = [];
    this.loaded = false;
  }

  _cacheFile() {
    return this.userDataDir ? path.join(this.userDataDir, 'content', 'lines.json') : '';
  }

  load() {
    if (this.loaded) return this;
    const bundled = this.bundled || this._requireBundled();
    const map = new Map();
    const add = (line) => {
      if (!line || map.has(line.id)) return;
      map.set(line.id, line);
    };
    if (bundled && bundled.LINES && bundled.LINES.contexts) {
      this.packVersion = Number(bundled.PACK_VERSION) || 0;
      this.month = String(bundled.VERSION_LABEL || '');
      for (const [context, list] of Object.entries(bundled.LINES.contexts || {})) {
        if (Array.isArray(list)) for (const raw of list) add(normalizeLine(raw, context));
      }
      for (const [mood, list] of Object.entries(bundled.LINES.moods || {})) {
        if (Array.isArray(list)) for (const raw of list) add(normalizeLine({ ...raw, mood: raw && raw.mood ? raw.mood : mood }, 'mood'));
      }
    }
    this._addFromCache(map);
    this.lines = Array.from(map.values());
    this._reindex();
    this.loaded = true;
    return this;
  }

  _requireBundled() {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require('../shared/lines.js');
    } catch {
      return null;
    }
  }

  _addFromCache(map) {
    const file = this._cacheFile();
    if (!file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw || raw.version !== CACHE_VERSION) return;
      this.packVersion = Math.max(this.packVersion, Number(raw.packVersion) || 0);
      this.month = String(raw.month || this.month);
      this.lastSyncAt = Number(raw.lastSyncAt) || 0;
      for (const item of Array.isArray(raw.lines) ? raw.lines : []) {
        const line = normalizeLine(item, item && item.context);
        if (line && !map.has(line.id)) map.set(line.id, line);
      }
    } catch {
      /* 首次运行 / 缓存损坏都不影响启动 */
    }
  }

  _reindex() {
    this.byContext = new Map();
    this.byMood = new Map();
    for (const line of this.lines) {
      if (!this.byContext.has(line.context)) this.byContext.set(line.context, []);
      this.byContext.get(line.context).push(line);
      if (!this.byMood.has(line.mood)) this.byMood.set(line.mood, []);
      this.byMood.get(line.mood).push(line);
    }
  }

  _writeCache() {
    const file = this._cacheFile();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          version: CACHE_VERSION,
          packVersion: this.packVersion,
          month: this.month,
          lastSyncAt: this.lastSyncAt,
          lines: this.lines,
        }),
        'utf8'
      );
    } catch {
      /* 磁盘不可写时只保留内存 */
    }
  }

  /** 拉取增量（每天最多一次；失败静默） */
  async refresh({ force = false } = {}) {
    if (!this.loaded) this.load();
    const token = Number(this.settings && this.settings.get('linesLastSyncAt')) || 0;
    if (!force && token && this.now() - token < 24 * 3600 * 1000) return this.info();
    if (!this.fetchImpl) return this.info();
    const base = String(this.apiBase() || '').replace(/\/+$/, '');
    if (!base) return this.info();
    const since = this.packVersion || 0;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    try {
      const res = await this.fetchImpl(`${base}/api/content/lines?since=${since}`, {
        headers: { accept: 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = Array.isArray(body.lines) ? body.lines : [];
      const map = new Map(this.lines.map((l) => [l.id, l]));
      let added = 0;
      for (const raw of list) {
        const line = normalizeLine(raw, raw && raw.context);
        if (line && !map.has(line.id)) {
          map.set(line.id, line);
          added += 1;
        }
      }
      this.lines = Array.from(map.values());
      this.packVersion = Math.max(this.packVersion, Number(body.packVersion) || 0);
      this.month = String(body.month || this.month);
      this.monthlyAdded += added;
      this.lastSyncAt = this.now();
      this.lastError = '';
      this._reindex();
      this._writeCache();
      if (this.settings) this.settings.patch({ linesLastSyncAt: this.lastSyncAt, linesPackVersion: this.packVersion });
      return this.info();
    } catch (err) {
      this.lastError = (err && err.message) || '内容更新失败';
      return this.info();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 选取一句：context 优先，其次 mood，最后 idle */
  pick(context, { mood = '', exclude = [] } = {}) {
    if (!this.loaded) this.load();
    const pools = [];
    if (context && this.byContext.has(context)) pools.push(this.byContext.get(context));
    if (mood && this.byMood.has(mood)) pools.push(this.byMood.get(mood));
    if (this.byContext.has('idle')) pools.push(this.byContext.get('idle'));
    if (!pools.length) pools.push(this.lines);
    const excluded = new Set([...this.recent, ...exclude]);
    for (const pool of pools) {
      const candidates = pool.filter((l) => !excluded.has(l.id));
      const source = candidates.length ? candidates : pool;
      if (source.length) {
        const line = source[Math.floor(Math.random() * source.length)];
        this._remember(line.id);
        return { text: line.text, mood: line.mood, context: line.context, id: line.id, important: line.important, voice: line.voice };
      }
    }
    return { text: '', mood: mood || 'calm', context: context || 'idle', id: '', important: false, voice: '' };
  }

  _remember(id) {
    if (!id) return;
    this.recent.push(id);
    if (this.recent.length > MAX_RECENT) this.recent = this.recent.slice(-MAX_RECENT);
  }

  info() {
    if (!this.loaded) this.load();
    return {
      ok: true,
      packVersion: this.packVersion,
      month: this.month,
      total: this.lines.length,
      monthlyAdded: this.monthlyAdded,
      lastSyncAt: this.lastSyncAt,
      error: this.lastError,
      contexts: Object.fromEntries(Array.from(this.byContext.entries()).map(([k, v]) => [k, v.length])),
    };
  }
}

module.exports = { LinesService, normalizeLine, CACHE_VERSION };
