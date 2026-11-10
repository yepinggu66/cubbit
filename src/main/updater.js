'use strict';

/**
 * 更新检查（轻量版，不依赖 electron-updater / 不做静默安装）。
 *
 * 设计原因：
 * - 静默自动更新要求「安装包已代码签名 + 更新源 HTTPS + latest.yml」，在签名证书就位前贸然开
 *   autoUpdater 会在用户机器上弹出不可信发布者警告，反而伤害信任；
 * - 所以第一版做「检查 + 提示 + 打开下载页」，签名就绪后把 `_download` 换成 electron-updater
 *   即可无缝升级（接口保持一致）。
 *
 * 服务端契约（license server 提供，未实现时自动降级为“检查失败但不打扰”）：
 *   GET {apiBase}/api/app/latest
 *   → { version: '1.3.0', notes: '...', url: 'https://.../Cubbit-Setup-1.3.0.exe', sha256: '...', mandatory?: false }
 */

const { EventEmitter } = require('node:events');

function parseVersion(v) {
  const m = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

class UpdateChecker extends EventEmitter {
  /**
   * @param {object} settings  需有 get/patch
   * @param {object} opts
   * @param {() => string} opts.apiBase  服务端地址（不含结尾 /）
   * @param {string} opts.currentVersion app.getVersion()
   * @param {Function} [opts.fetchImpl]
   * @param {(url:string)=>void} [opts.openExternal]
   * @param {Function} [opts.now]
   */
  constructor(settings, opts = {}) {
    super();
    this.settings = settings;
    this.apiBase = typeof opts.apiBase === 'function' ? opts.apiBase : () => opts.apiBase || '';
    this.currentVersion = opts.currentVersion || '0.0.0';
    this.fetchImpl = opts.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.openExternal = typeof opts.openExternal === 'function' ? opts.openExternal : () => {};
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
    this.log = opts.log || console;
    this.checking = false;
    this.latest = null;
    this.available = false;
    this.error = '';
    this.lastCheck = 0;
    this.autoUpdater = null;
    this.mode = 'manual'; // manual | auto（electron-updater）
    this.downloading = false;
    this.downloaded = false;
    this.progress = 0;
  }

  /**
   * 挂载 electron-updater（仅打包版 + 已签名时真正可安装；dev/未签名仍可用手动下载兜底）。
   * @param {object} autoUpdater electron-updater 的 autoUpdater 实例
   * @param {string} feedUrl generic 更新源（https://host/updates）
   */
  attachAutoUpdater(autoUpdater, feedUrl) {
    if (!autoUpdater || !feedUrl) return false;
    this.autoUpdater = autoUpdater;
    this.mode = 'auto';
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    try {
      this.autoUpdater.setFeedURL({ provider: 'generic', url: String(feedUrl).replace(/\/+$/, '') });
    } catch (err) {
      this.log.warn && this.log.warn('[update] setFeedURL failed:', err && err.message);
    }
    this.autoUpdater.on('update-available', (info) => {
      this.log.info && this.log.info('[update] event update-available:', info && info.version);
      this.latest = {
        version: String(info && info.version ? info.version : ''),
        notes: '',
        url: '',
        sha256: '',
        mandatory: false,
      };
      this.available = true;
      this.lastCheck = this.now();
      this.emit('changed', this.status());
      this.emit('available', this.latest);
    });
    this.autoUpdater.on('update-not-available', () => {
      this.available = false;
      this.lastCheck = this.now();
      this.emit('changed', this.status());
    });
    this.autoUpdater.on('download-progress', (p) => {
      this.downloading = true;
      this.progress = Math.max(0, Math.min(100, Math.round(Number(p && p.percent) || 0)));
      this.emit('changed', this.status());
    });
    this.autoUpdater.on('update-downloaded', () => {
      this.downloading = false;
      this.downloaded = true;
      this.progress = 100;
      this.emit('changed', this.status());
    });
    this.autoUpdater.on('error', (err) => {
      this.downloading = false;
      this.error = (err && err.message) || '自动更新失败';
      this.emit('changed', this.status());
    });
    return true;
  }

  /** 把 checkForUpdates 的返回值同步进状态（部分 electron-updater 场景事件不触发） */
  applyCheckResult(result) {
    const info = result && result.updateInfo;
    if (!info) return false;
    this.latest = {
      version: String(info.version || ''),
      notes: String(info.releaseNotes || '').slice(0, 500),
      url: '',
      sha256: '',
      mandatory: false,
    };
    this.available = isNewer(this.latest.version, this.currentVersion);
    this.lastCheck = this.now();
    this.emit('changed', this.status());
    return this.available;
  }

  /** 自动下载更新包（仅 auto 模式） */
  async download() {
    if (!this.autoUpdater) return { ok: false, error: '当前为手动更新模式' };
    try {
      this.downloading = true;
      this.emit('changed', this.status());
      await this.autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      this.downloading = false;
      this.error = (err && err.message) || '下载更新失败';
      this.emit('changed', this.status());
      return { ok: false, error: this.error };
    }
  }

  /** 退出并安装已下载的更新 */
  install() {
    if (!this.autoUpdater || !this.downloaded) return { ok: false, error: '尚未下载更新' };
    try {
      this.autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '安装更新失败' };
    }
  }

  enabled() {
    try {
      return this.settings.get('autoUpdateCheck') !== false;
    } catch {
      return true;
    }
  }

  status() {
    return {
      ok: true,
      currentVersion: this.currentVersion,
      enabled: this.enabled(),
      checking: this.checking,
      firstRun: !this.lastCheck,
      available: this.available,
      latest: this.latest,
      error: this.error,
      lastCheck: this.lastCheck,
      feed: this._feedUrl(),
      mode: this.mode,
      downloading: this.downloading,
      downloaded: this.downloaded,
      progress: this.progress,
    };
  }

  _feedUrl() {
    const base = String(this.apiBase() || '').replace(/\/+$/, '');
    return base ? `${base}/api/app/latest` : '';
  }

  /** @returns {Promise<object>} 最新 status() */
  async check({ manual = false } = {}) {
    if (this.checking) return this.status();
    if (!manual && !this.enabled()) return this.status();
    const url = this._feedUrl();
    if (!url || !this.fetchImpl) {
      this.error = '未配置更新源';
      this.lastCheck = this.now();
      return this.status();
    }
    this.checking = true;
    this.error = '';
    this.emit('changed', this.status());
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    try {
      const res = await this.fetchImpl(url, { signal: ctrl ? ctrl.signal : undefined, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`更新源 HTTP ${res.status}`);
      const body = await res.json();
      const latest = {
        version: String((body && body.version) || '').trim(),
        notes: String((body && body.notes) || '').trim().slice(0, 2000),
        url: String((body && body.url) || '').trim(),
        sha256: String((body && body.sha256) || '').trim(),
        mandatory: !!(body && body.mandatory),
      };
      if (!latest.version) throw new Error('更新源返回格式错误');
      this.latest = latest;
      this.available = isNewer(latest.version, this.currentVersion);
      this.lastCheck = this.now();
      this.emit('changed', this.status());
      if (this.available) this.emit('available', latest);
      return this.status();
    } catch (err) {
      this.error = (err && err.message) || '检查更新失败';
      this.lastCheck = this.now();
      this.log.warn && this.log.warn('[update] check failed:', this.error);
      this.emit('changed', this.status());
      return this.status();
    } finally {
      this.checking = false;
      if (timer) clearTimeout(timer);
    }
  }

  /** 打开下载页（签名就绪前不做静默安装） */
  openDownload() {
    const url = (this.latest && this.latest.url) || '';
    if (!url) return { ok: false, error: '暂无下载地址' };
    try {
      this.openExternal(url);
      return { ok: true, url };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '打开下载页失败' };
    }
  }

  setEnabled(flag) {
    if (this.settings && typeof this.settings.patch === 'function') this.settings.patch({ autoUpdateCheck: !!flag });
    this.emit('changed', this.status());
    return this.status();
  }
}

module.exports = { UpdateChecker, isNewer, parseVersion };
