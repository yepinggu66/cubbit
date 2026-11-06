'use strict';

/**
 * 崩溃与错误上报（本地优先）。
 *
 * - 主进程未捕获异常 / 未处理 Promise 拒绝 / 渲染进程崩溃 / GPU 崩溃 → 写 userData/crash.log（滚动 256KB）并通知 UI；
 * - 默认只存本地，不联网；用户显式开启 crashReportEnabled 后，才把「最小化诊断信息」POST 到
 *   {apiBase}/api/telemetry/crash（服务端未实现时静默失败，不影响使用）；
 * - 绝不包含聊天内容、许可证 Key、apiKey、文件路径以外的隐私信息。
 */

const fs = require('node:fs');
const path = require('node:path');
const { redactSecrets, redactObject } = require('./redact');

const MAX_BYTES = 256 * 1024;

function safeString(v, max = 500) {
  const s = String(v == null ? '' : v);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Electron 的 render-process-gone / child-process-gone 传进来的是 details 对象而不是 Error；
 * 之前直接当 Error 用，导致 crash.log 里 20/20 条都是 "[object Object]"，完全无法排障。
 * 这里把两种形态统一归一出「可读的一行 + 结构化字段」。
 */
const CRASH_DETAIL_KEYS = ['reason', 'exitCode', 'processType', 'type', 'serviceName', 'name', 'error', 'details', 'status', 'url', 'killed'];
function safeJsonOf(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}
function describeCrash(err) {
  if (!err) return { message: '(no details)', stack: '' };
  if (err instanceof Error) return { message: String(err.message || err.name || 'Error'), stack: String(err.stack || '') };
  if (typeof err === 'object') {
    const picked = {};
    for (const key of CRASH_DETAIL_KEYS) {
      const v = err[key];
      if (v === undefined || v === null || v === '') continue;
      picked[key] = typeof v === 'object' ? safeString(safeJsonOf(v), 300) : safeString(v, 300);
    }
    const message = Object.keys(picked).length
      ? Object.entries(picked).map(([k, v]) => `${k}=${v}`).join(' ')
      : safeString(safeJsonOf(err), 400);
    return { message, stack: safeString(err.stack || '', 4000), picked };
  }
  return { message: safeString(err, 400), stack: '' };
}

class CrashReporter {
  /**
   * @param {object} opts
   * @param {string} opts.userDataDir
   * @param {string} opts.version
   * @param {() => boolean} [opts.enabled]  是否允许 POST 到服务端（默认 false）
   * @param {() => string} [opts.apiBase]
   * @param {Function} [opts.fetchImpl]
   * @param {Function} [opts.now]
   */
  constructor(opts = {}) {
    this.userDataDir = opts.userDataDir || '';
    this.version = opts.version || '0.0.0';
    this.enabled = typeof opts.enabled === 'function' ? opts.enabled : () => false;
    this.apiBase = typeof opts.apiBase === 'function' ? opts.apiBase : () => '';
    this.fetchImpl = opts.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.log = opts.log || console;
    this.lastCrash = null;
    this.count = 0;
    this.installed = false;
    this._file = this.userDataDir ? path.join(this.userDataDir, 'crash.log') : '';
  }

  filePath() {
    return this._file;
  }

  install() {
    if (this.installed) return this;
    this.installed = true;
    process.on('uncaughtException', (err) => this.capture('uncaughtException', err));
    process.on('unhandledRejection', (reason) => this.capture('unhandledRejection', reason));
    return this;
  }

  /** 由主进程在 app 事件里调用（render-process-gone / child-process-gone / GPU 崩溃） */
  capture(kind, err, extra = {}) {
    const at = this.now();
    // 崩溃现场可能夹带凭据（如异常信息里回显了 API Key）→ 落盘与上报前统一脱敏
    const info = describeCrash(err);
    const message = info.message;
    const stack = info.stack;
    const mergedExtra = { ...(extra || {}) };
    if (info.picked) mergedExtra.details = info.picked;
    const entry = {
      at,
      kind,
      message: redactSecrets(safeString(message, 500)),
      stack: redactSecrets(stack),
      version: this.version,
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      extra: redactObject(JSON.parse(JSON.stringify(mergedExtra))),
    };
    this.lastCrash = entry;
    this.count += 1;
    this._write(entry);
    this.log.error && this.log.error(`[crash] ${kind}: ${entry.message}`);
    if (this.enabled()) this._post(entry).catch(() => {});
    return entry;
  }

  _write(entry) {
    if (!this._file) return;
    try {
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
      try {
        const st = fs.statSync(this._file);
        if (st.size > MAX_BYTES) fs.renameSync(this._file, `${this._file}.1`);
      } catch {
        /* 首次写入 */
      }
      fs.appendFileSync(this._file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      /* 磁盘不可写时忽略，不能因为日志再崩一次 */
    }
  }

  async _post(entry) {
    const base = String(this.apiBase() || '').replace(/\/+$/, '');
    if (!base || !this.fetchImpl) return;
    try {
      await this.fetchImpl(`${base}/api/telemetry/crash`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: entry.version,
          platform: entry.platform,
          kind: entry.kind,
          message: entry.message,
          at: entry.at,
        }),
      });
    } catch {
      /* 服务端未实现/断网都静默 */
    }
  }

  status() {
    return {
      ok: true,
      reportingEnabled: !!this.enabled(),
      count: this.count,
      lastCrash: this.lastCrash,
      logFile: this._file,
    };
  }

  /** 读取最近 N 行长文本（给「关于」页/反馈邮件用） */
  tail(lines = 20) {
    if (!this._file) return '';
    try {
      const all = fs.readFileSync(this._file, 'utf8').trim().split('\n');
      return all.slice(-Math.max(1, lines)).join('\n');
    } catch {
      return '';
    }
  }

  clear() {
    if (!this._file) return { ok: true };
    try {
      fs.rmSync(this._file, { force: true });
    } catch {
      /* ignore */
    }
    this.lastCrash = null;
    this.count = 0;
    return { ok: true };
  }
}

module.exports = { CrashReporter };
