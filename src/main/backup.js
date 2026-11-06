'use strict';

/**
 * 数据备份（生命 / 成长 / 专注 / 外观 / 情侣资料）
 *
 * - 本地导出：JSON 文件，可选密码加密（AES-256-GCM + scrypt）
 * - 本地导入：覆盖前自动把旧文件备份为 *.bak-时间戳
 * - 云同步：客户端加密后上传，服务端零知识（只存密文 blob/salt/iv/tag）
 * - 不备份许可证密钥/试用记录/AI 对话（AI 需显式 includeAi）
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SECRET_SETTING_FIELDS } = require('./secret-store');

const FORMAT = 'cubbit-backup';
const VERSION = 1;
const FILES = ['settings.json', 'growth.json', 'focus-stats.json', 'life.json'];
const AI_FILE = 'ai-history.json';
const MAX_CLOUD_BYTES = 2 * 1024 * 1024;

function nowIso(now) {
  return new Date(now()).toISOString();
}

/** 剔除设置里的机密字段（API Key 密文、云同步密码密文），避免随备份外传 */
function stripSecrets(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const field of SECRET_SETTING_FIELDS) delete out[field];
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, { N: 16384, r: 8, p: 1 });
}

function encryptJson(obj, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: FORMAT,
    version: VERSION,
    encrypted: true,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptJson(wrapper, passphrase) {
  const salt = Buffer.from(String(wrapper.salt || ''), 'base64');
  const iv = Buffer.from(String(wrapper.iv || ''), 'base64');
  const tag = Buffer.from(String(wrapper.tag || ''), 'base64');
  const data = Buffer.from(String(wrapper.data || ''), 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

class BackupService {
  /**
   * @param {object} opts
   * @param {string} opts.userDataDir
   * @param {string} [opts.appVersion]
   * @param {() => string} [opts.deviceId]
   * @param {() => string} [opts.apiBase]
   * @param {() => string} [opts.licenseToken]
   * @param {object} [opts.settings]
   * @param {Function} [opts.fetchImpl]
   * @param {Function} [opts.now]
   */
  constructor(opts = {}) {
    this.userDataDir = opts.userDataDir || '';
    this.appVersion = opts.appVersion || '';
    this.deviceId = typeof opts.deviceId === 'function' ? opts.deviceId : () => '';
    this.apiBase = typeof opts.apiBase === 'function' ? opts.apiBase : () => '';
    this.licenseToken = typeof opts.licenseToken === 'function' ? opts.licenseToken : () => '';
    this.settings = opts.settings || null;
    this.fetchImpl = opts.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.lastSyncAt = 0;
    this.lastRevision = 0;
    this.lastError = '';
  }

  _file(name) {
    return path.join(this.userDataDir, name);
  }

  /** 收集可备份数据 */
  collect({ includeAi = false } = {}) {
    const files = {};
    const list = includeAi ? [...FILES, AI_FILE] : FILES.slice();
    for (const name of list) {
      const data = readJson(this._file(name));
      if (data === null) continue;
      // settings.json 里的机密字段（API Key 密文、云同步密码密文）不上传/不导出：
      // 它们与本机系统密钥库绑定，换机也无法解密，带上云端只是徒增泄露面。
      files[name] = name === 'settings.json' ? stripSecrets(data) : data;
    }
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: nowIso(this.now),
      appVersion: this.appVersion,
      deviceId: this.deviceId(),
      files,
      meta: { fileCount: Object.keys(files).length, includeAi: !!includeAi },
    };
  }

  /** 导出到文件；passphrase 非空则加密 */
  async exportTo(file, { passphrase = '', includeAi = false } = {}) {
    const payload = this.collect({ includeAi });
    const out = passphrase && String(passphrase).length >= 6 ? encryptJson(payload, passphrase) : payload;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
    if (this.settings) this.settings.patch({ backupLastExportAt: this.now() });
    return { ok: true, path: file, encrypted: !!out.encrypted, bytes: fs.statSync(file).size };
  }

  _payloadFromFile(file, passphrase) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.format !== FORMAT) throw Object.assign(new Error('不是有效的 Cubbit 备份文件'), { code: 'INVALID_BACKUP' });
    if (raw.encrypted) {
      if (!passphrase || String(passphrase).length < 6) throw Object.assign(new Error('该备份已加密，请输入至少 6 位密码'), { code: 'PASSWORD_REQUIRED' });
      return decryptJson(raw, passphrase);
    }
    return raw;
  }

  /** 从文件恢复（覆盖前自动 .bak-时间戳） */
  async importFrom(file, { passphrase = '' } = {}) {
    const payload = this._payloadFromFile(file, passphrase);
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const restored = [];
    for (const name of Object.keys(payload.files || {})) {
      if (!FILES.includes(name) && name !== AI_FILE) continue;
      const data = payload.files[name];
      if (data === null || typeof data !== 'object') continue;
      // 老版本备份里可能含明文 aiApiKey —— 恢复时剔除，绝不把明文写回磁盘
      const safe = name === 'settings.json' ? stripSecrets(data) : data;
      const target = this._file(name);
      try {
        if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak-${stamp}`);
      } catch {
        /* ignore */
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(safe, null, 2), 'utf8');
      restored.push(name);
    }
    if (!restored.length) throw Object.assign(new Error('备份里没有可恢复的数据'), { code: 'EMPTY_BACKUP' });
    return { ok: true, restored, backupExportedAt: payload.exportedAt || '', encrypted: Boolean(payload.encrypted) };
  }

  /** 当前数据概况 */
  info() {
    const files = [];
    for (const name of [...FILES, AI_FILE]) {
      try {
        const st = fs.statSync(this._file(name));
        files.push({ name, bytes: st.size, updatedAt: st.mtimeMs });
      } catch {
        /* 不存在 */
      }
    }
    const token = this.licenseToken();
    return {
      ok: true,
      files,
      deviceId: this.deviceId(),
      lastExportAt: Number(this.settings && this.settings.get('backupLastExportAt')) || 0,
      cloud: {
        configured: !!token,
        lastSyncAt: this.lastSyncAt,
        revision: this.lastRevision,
        error: this.lastError,
        maxBytes: MAX_CLOUD_BYTES,
      },
    };
  }

  // ------------------------------------------------------------ 云同步
  _headers() {
    const token = this.licenseToken();
    if (!token) throw Object.assign(new Error('云同步需要先激活完整版/登录授权'), { code: 'NO_LICENSE' });
    return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  }

  async _api(method, apiPath, body) {
    if (!this.fetchImpl) throw Object.assign(new Error('当前环境不支持网络'), { code: 'NO_FETCH' });
    const base = String(this.apiBase() || '').replace(/\/+$/, '');
    if (!base) throw Object.assign(new Error('未配置服务端地址'), { code: 'NO_API' });
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    try {
      const res = await this.fetchImpl(`${base}${apiPath}`, {
        method,
        headers: this._headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        const err = Object.assign(new Error((data && data.message) || `云同步失败 HTTP ${res.status}`), {
          code: (data && data.code) || 'SYNC_FAILED',
          status: res.status,
        });
        throw err;
      }
      return data || {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async cloudPush({ passphrase, includeAi = false } = {}) {
    if (!passphrase || String(passphrase).length < 6) {
      throw Object.assign(new Error('云同步密码至少 6 位（用于客户端加密）'), { code: 'PASSWORD_REQUIRED' });
    }
    const payload = this.collect({ includeAi });
    const wrapper = encryptJson(payload, passphrase);
    const blob = String(wrapper.data || '');
    const bytes = Buffer.byteLength(blob, 'utf8');
    if (bytes > MAX_CLOUD_BYTES) throw Object.assign(new Error('备份超过 2MB 上限'), { code: 'TOO_LARGE' });
    const res = await this._api('POST', '/api/backup/push', {
      deviceId: this.deviceId(),
      blob,
      salt: wrapper.salt,
      iv: wrapper.iv,
      tag: wrapper.tag,
      version: VERSION,
      meta: JSON.stringify({ includeAi: !!includeAi, appVersion: this.appVersion }).slice(0, 1000),
    });
    this.lastSyncAt = this.now();
    this.lastRevision = Number(res && res.revision) || this.lastRevision + 1;
    this.lastError = '';
    if (this.settings) this.settings.patch({ backupLastSyncAt: this.lastSyncAt });
    return { ok: true, revision: this.lastRevision, updatedAt: (res && res.updatedAt) || '', bytes };
  }

  async cloudPull({ passphrase } = {}) {
    if (!passphrase || String(passphrase).length < 6) {
      throw Object.assign(new Error('恢复云端备份需要输入同步密码'), { code: 'PASSWORD_REQUIRED' });
    }
    const res = await this._api('GET', `/api/backup/pull?deviceId=${encodeURIComponent(this.deviceId())}`);
    const blob = String((res && res.blob) || '');
    if (!blob) throw Object.assign(new Error('云端还没有备份'), { code: 'NO_BACKUP' });
    const wrapper = {
      format: FORMAT,
      version: VERSION,
      encrypted: true,
      kdf: 'scrypt',
      salt: String(res.salt || ''),
      iv: String(res.iv || ''),
      tag: String(res.tag || ''),
      data: blob,
    };
    const payload = decryptJson(wrapper, passphrase);
    const saved = payload;
    // 直接复用 import 的落盘逻辑
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const restored = [];
    for (const name of Object.keys(saved.files || {})) {
      if (!FILES.includes(name) && name !== AI_FILE) continue;
      const data = saved.files[name];
      if (!data || typeof data !== 'object') continue;
      const target = this._file(name);
      try {
        if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak-${stamp}`);
      } catch {
        /* ignore */
      }
      fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
      restored.push(name);
    }
    this.lastSyncAt = this.now();
    this.lastRevision = Number(res && res.revision) || 0;
    this.lastError = '';
    return { ok: true, restored, exportedAt: saved.exportedAt || '', revision: this.lastRevision };
  }

  async cloudDelete() {
    const res = await this._api('DELETE', '/api/backup', { deviceId: this.deviceId() });
    this.lastSyncAt = this.now();
    return { ok: true, removed: Boolean(res && res.removed) };
  }
}

module.exports = { BackupService, encryptJson, decryptJson, FORMAT, VERSION, MAX_CLOUD_BYTES };
