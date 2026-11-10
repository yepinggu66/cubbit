'use strict';

/**
 * 本机密文存储（基于 Electron safeStorage）。
 *
 * 设计要点：
 *  - **落盘格式带版本标记**：`v1:<base64(safeStorage.encryptString(key))>`。
 *    没有标记的老数据（旧版直接写 base64）会被识别并自动升级，不丢用户已存的 Key。
 *  - **密文与明文分离**：磁盘上只有 `xxxEnc` 字段；旧的明文字段迁移后会被删除。
 *  - **降级保护**：`safeStorage.isEncryptionAvailable()` 为 false 时（部分 Linux 环境），
 *    **绝不把明文写回磁盘**，只保留在内存并向上层报告「未加密」，由 UI 提示用户。
 *
 * 本模块不 require('electron')，safeStorage 由调用方注入，因此可在 node --test 下直接单测。
 */

const SECRET_PREFIX = 'v1:';

/** 不允许出现在状态广播 / 渲染进程里的设置字段（明文与密文都不给） */
const SECRET_SETTING_FIELDS = ['aiApiKey', 'aiApiKeyEnc', 'backupSyncPasswordEnc'];

/** 系统是否支持安全存储 */
function isEncryptionAvailable(safeStorage) {
  try {
    return !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
  } catch (err) {
    return false;
  }
}

/**
 * 加密为落盘格式。
 * @returns {string} `v1:<base64>`；无法加密时返回 null（调用方据此决定不落盘）
 */
function encryptSecret(safeStorage, plaintext) {
  const text = String(plaintext == null ? '' : plaintext);
  if (!text) return '';
  if (!isEncryptionAvailable(safeStorage)) return null;
  try {
    return SECRET_PREFIX + Buffer.from(safeStorage.encryptString(text)).toString('base64');
  } catch (err) {
    return null;
  }
}

/**
 * 解密。
 * 兼容三种历史格式：v1 密文 / 旧版 base64(密文) / 更旧的 base64(明文)。
 * @returns {string} 明文；无法解密时返回空串
 */
function decryptSecret(safeStorage, stored) {
  const raw = String(stored == null ? '' : stored);
  if (!raw) return '';
  if (raw.startsWith(SECRET_PREFIX)) {
    if (!isEncryptionAvailable(safeStorage)) return '';
    try {
      return String(safeStorage.decryptString(Buffer.from(raw.slice(SECRET_PREFIX.length), 'base64')) || '');
    } catch (err) {
      return '';
    }
  }
  // 旧格式：没有版本前缀。可能是旧版写的 base64(密文)，也可能是更早的降级 base64(明文)。
  let buf = null;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch (err) {
    buf = null;
  }
  if (!buf || !buf.length) return '';
  if (isEncryptionAvailable(safeStorage)) {
    try {
      return String(safeStorage.decryptString(buf) || '');
    } catch (err) {
      /* 不是密文 → 继续按旧降级明文处理 */
    }
  }
  return buf.toString('utf8');
}

/**
 * 绑定到 settings.json 的机密读写器。
 */
class SecretStore {
  /**
   * @param {object} settings 需实现 get(key) / patch(obj) / remove(key)
   * @param {object} safeStorage Electron safeStorage（可注入假实现以便单测）
   */
  constructor(settings, safeStorage) {
    this.settings = settings;
    this.safeStorage = safeStorage;
  }

  /** 系统是否支持安全存储 */
  available() {
    return isEncryptionAvailable(this.safeStorage);
  }

  /**
   * 读取密文并处理历史明文迁移。
   * @param {string} plainKey 明文字段名（如 aiApiKey）
   * @param {string} encKey   密文字段名（如 aiApiKeyEnc）
   * @returns {{value:string, encrypted:boolean}} value 为明文，encrypted 表示是否已安全落盘
   */
  read(plainKey, encKey) {
    const encRaw = String(this.settings.get(encKey) || '');
    const legacyPlain = String(this.settings.get(plainKey) || '');
    let value = '';
    let encrypted = false;

    if (encRaw.startsWith(SECRET_PREFIX)) {
      value = decryptSecret(this.safeStorage, encRaw);
      encrypted = !!value;
    } else if (encRaw) {
      // 旧格式：可能是旧版密文，也可能是更早的降级明文
      value = decryptSecret(this.safeStorage, encRaw);
    }
    if (!value && legacyPlain) value = legacyPlain;

    if (value) {
      // 需要升级（旧格式）或需要清掉残留明文时，重新加密落盘
      const needsRewrite = !encRaw.startsWith(SECRET_PREFIX) || !!legacyPlain;
      if (needsRewrite) {
        const res = this.write(plainKey, encKey, value);
        encrypted = res.encrypted;
      }
    }
    return { value, encrypted };
  }

  /**
   * 加密落盘。
   * @returns {{persisted:boolean, encrypted:boolean}} persisted=false 表示仅在内存保留
   */
  write(plainKey, encKey, value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) {
      this.settings.patch({ [encKey]: '' });
      if (this.settings.get(plainKey)) this.settings.remove(plainKey);
      return { persisted: true, encrypted: true };
    }
    const enc = encryptSecret(this.safeStorage, text);
    if (enc === null) {
      // 降级：系统不支持安全存储 → 只在内存保留，绝不把明文写回磁盘
      return { persisted: false, encrypted: false };
    }
    this.settings.patch({ [encKey]: enc });
    if (this.settings.get(plainKey)) this.settings.remove(plainKey);
    return { persisted: true, encrypted: true };
  }
}

/**
 * 过滤掉不能广播给渲染进程的机密字段，返回可安全广播的设置副本。
 */
function publicSettings(settings) {
  const out = { ...(settings || {}) };
  for (const field of SECRET_SETTING_FIELDS) delete out[field];
  return out;
}

module.exports = {
  SECRET_PREFIX,
  SECRET_SETTING_FIELDS,
  isEncryptionAvailable,
  encryptSecret,
  decryptSecret,
  SecretStore,
  publicSettings,
};
