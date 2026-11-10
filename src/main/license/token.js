'use strict';
/**
 * Cubbit 许可客户端 — 许可证 token 本地验签（Ed25519，离线可用）
 *
 * token 格式：base64url(payloadJson) + "." + base64url(signature)
 * 公钥内置在 app/src/main/license/public-key.pem（由服务端 private.pem 对应的公钥同步而来）。
 *
 * 校验顺序：格式 → 签名 → payload 结构 → 过期。
 * 设备绑定（sub === 本机 deviceId）由 LicenseManager 负责，因为要读设备指纹。
 */

const crypto = require('node:crypto');

/**
 * @param {string|Buffer|import('node:crypto').KeyObject} publicKeyOrPem
 */
function importPublicKey(publicKeyOrPem) {
  if (publicKeyOrPem && typeof publicKeyOrPem === 'object' && publicKeyOrPem.type === 'public') {
    return publicKeyOrPem;
  }
  return crypto.createPublicKey(publicKeyOrPem);
}

/** 公钥指纹（sha256(DER) 前 16 hex），用于与服务端 /api/health 比对 */
function fingerprint(publicKeyOrPem) {
  const key = importPublicKey(publicKeyOrPem);
  return crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

function decodePayload(token) {
  try {
    const part = String(token || '').split('.')[0];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * 离线验签 + 过期校验。
 * @param {string} token
 * @param {string|Buffer|import('node:crypto').KeyObject} publicKeyOrPem
 * @param {{now?:number}} [options] now 为 unix 秒
 * @returns {{ok:true, payload:object} |
 *           {ok:false, code:'TOKEN_INVALID'|'TOKEN_EXPIRED', message:string, payload?:object}}
 */
function verifyToken(token, publicKeyOrPem, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000);
  if (typeof token !== 'string' || token.length < 10) {
    return { ok: false, code: 'TOKEN_INVALID', message: '授权凭据为空或格式不正确' };
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: 'TOKEN_INVALID', message: '授权凭据格式不正确' };
  }

  const payload = decodePayload(token);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'TOKEN_INVALID', message: '授权凭据内容无法解析' };
  }

  let valid = false;
  try {
    const key = importPublicKey(publicKeyOrPem);
    valid = crypto.verify(null, Buffer.from(parts[0], 'utf8'), key, Buffer.from(parts[1], 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, code: 'TOKEN_INVALID', message: '授权凭据签名校验失败', payload };
  }

  const VERSION = Number(payload.v);
  if (
    (VERSION !== 1 && VERSION !== 2) ||
    typeof payload.plan !== 'string' ||
    (VERSION === 1 && typeof payload.lid !== 'string')
  ) {
    return { ok: false, code: 'TOKEN_INVALID', message: '授权凭据版本或字段不受支持', payload };
  }
  if (VERSION === 2) {
    const feat = payload.features;
    const okFeatures =
      (Array.isArray(feat) && feat.every((x) => typeof x === 'string')) ||
      (feat && typeof feat === 'object' && Object.values(feat).every((x) => typeof x === 'boolean'));
    if (!okFeatures) {
      return { ok: false, code: 'TOKEN_INVALID', message: '授权凭证功能列表格式不正确', payload };
    }
    if (payload.addons != null && !Array.isArray(payload.addons)) {
      return { ok: false, code: 'TOKEN_INVALID', message: '授权凭证附加内容格式不正确', payload };
    }
  }

  if (!Number.isFinite(payload.iat)) {
    return { ok: false, code: 'TOKEN_INVALID', message: '授权凭据缺少签发时间', payload };
  }

  const exp = Number(payload.exp);
  if (Number.isFinite(exp) && exp !== 0 && exp <= now) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: '授权已过期', payload };
  }
  return { ok: true, payload };
}

module.exports = { importPublicKey, fingerprint, verifyToken, decodePayload };
