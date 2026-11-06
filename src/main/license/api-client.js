'use strict';
/**
 * Cubbit 许可客户端 — 极简 API 封装（零依赖，Node 18+ / Electron 内置 fetch）
 *
 * 设计目标：
 *  - 永不抛异常：所有失败都归一化成 { ok:false, code, message, offline }
 *  - 离线/超时/服务未启动统一成 SERVER_OFFLINE，UI 只需看一个标志
 *  - 可注入 baseUrl / fetchImpl / timeoutMs，方便单测
 */

const DEFAULT_TIMEOUT_MS = 6000;

function normalizeBase(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

class ApiClient {
  /**
   * @param {{baseUrl?:string, timeoutMs?:number, fetchImpl?:Function}} [options]
   */
  constructor(options = {}) {
    this.baseUrl = normalizeBase(options.baseUrl);
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  }

  base() {
    return this.baseUrl;
  }

  setBaseUrl(url) {
    this.baseUrl = normalizeBase(url);
    return this.baseUrl;
  }

  /**
   * @param {string} apiPath 以 / 开头
   * @param {{method?:string, body?:object, timeoutMs?:number, headers?:object}} [options]
   * @returns {Promise<{ok:true, status:number, [key:string]:any} |
   *                   {ok:false, status?:number, code:string, message:string, offline:boolean}>}
   */
  async request(apiPath, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const url = `${this.baseUrl}${apiPath}`;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this.timeoutMs;

    if (!this.fetchImpl) {
      return { ok: false, code: 'NETWORK_ERROR', message: '当前运行环境不支持 fetch', offline: false };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller ? controller.signal : undefined,
      });

      const text = await res.text();
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text.slice(0, 200) };
        }
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          code: data.code || 'HTTP_ERROR',
          message: data.message || `请求失败（HTTP ${res.status}）`,
          offline: false,
          data,
        };
      }
      return { ok: true, status: res.status, ...(data && typeof data === 'object' ? data : {}) };
    } catch (err) {
      const name = err && err.name;
      const code = err && err.code;
      const causeCode = err && err.cause && err.cause.code;
      const isAbort = name === 'AbortError' || code === 'ABORT_ERR';
      const isNetwork =
        name === 'TypeError' ||
        ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH'].includes(
          code
        ) ||
        ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'CERT_HAS_EXPIRED'].includes(causeCode) ||
        /fetch failed|network|socket hang up/i.test(String((err && err.message) || ''));
      if (isAbort) {
        return {
          ok: false,
          code: 'SERVER_OFFLINE',
          message: `连接许可服务器超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络`,
          offline: true,
        };
      }
      if (isNetwork) {
        return {
          ok: false,
          code: 'SERVER_OFFLINE',
          message: '无法连接许可服务器，请检查网络或服务端是否已启动',
          offline: true,
        };
      }
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: `网络错误：${(err && err.message) || '未知错误'}`,
        offline: false,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get(apiPath, options = {}) {
    return this.request(apiPath, { ...options, method: 'GET' });
  }

  post(apiPath, body, options = {}) {
    return this.request(apiPath, { ...options, method: 'POST', body });
  }
}

module.exports = { ApiClient, normalizeBase, DEFAULT_TIMEOUT_MS };
