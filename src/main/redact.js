'use strict';

/**
 * 日志与崩溃上报脱敏：抹掉疑似 API Key / Token / 密码的片段。
 *
 * 用于：
 *  - ai.js 的错误日志（上游服务报错时可能把请求内容带回来）；
 *  - crash.js 的本地日志与上报正文。
 *
 * 只做「看起来像凭据」的片段替换，不做业务判断，避免误伤正常文案。
 */

const PATTERNS = [
  // OpenAI 风格：sk-xxxxxxxx
  { re: /\bsk-[A-Za-z0-9._-]{6,}/g, to: 'sk-***' },
  // Authorization: Bearer xxxx / bearer xxxx
  { re: /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: '$1 ***' },
  // apiKey=xxx / "apiKey": "xxx" / token: xxx / password=xxx
  {
    re: /\b(api[_-]?key|apikey|token|secret|password|passwd|authorization)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    to: (m, name, sep) => `${name}${sep}***`,
  },
];

/**
 * 脱敏任意文本（字符串 / Error 消息 / 可序列化对象）。
 * @param {*} input
 * @returns {string}
 */
function redactSecrets(input) {
  if (input == null) return '';
  let text = typeof input === 'string' ? input : String(input);
  for (const { re, to } of PATTERNS) {
    text = text.replace(re, to);
  }
  return text;
}

/**
 * 脱敏对象（浅层：只处理字符串值，深层对象交给 JSON 序列化后再脱敏）。
 * @param {*} obj
 */
function redactObject(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return redactSecrets(obj);
  if (typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? redactSecrets(v) : v;
  }
  return out;
}

module.exports = { redactSecrets, redactObject };
