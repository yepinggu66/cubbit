'use strict';
/**
 * 情侣联机消息协议（docs/couple-multiplayer-spec.md §3/§4）。纯函数，可在 node --test 直接测。
 */
const crypto = require('node:crypto');

const PROTOCOL_VERSION = 1;
const ACTIONS = ['poke', 'heart', 'hug', 'kiss', 'highfive', 'holdhands', 'goodnight'];
const ACTION_LABEL = { poke: '戳', heart: '比心', hug: '抱抱', kiss: '亲亲', highfive: '击掌', holdhands: '牵手', goodnight: '晚安' };
const TYPES = ['interact', 'focus.start', 'focus.join', 'focus.end', 'note', 'voice', 'presence.mood', 'farm.event', 'anniv.update', 'ack'];
const ENVELOPE_KEYS = new Set(['v', 'id', 'type', 'from', 'ts', 'seq', 'payload']);
const MAX_MESSAGE_BYTES = 32 * 1024;
const NOTE_MAX_CHARS = 200;
const VOICE_MAX_MS = 60000;
const FOCUS_DEFAULT_SEC = 1500;

const channels = {
  rt: (c) => `cpl.${c}.rt`,
  sys: (c) => `cpl.${c}.sys`,
  pres: (c) => `cpl.${c}.rt-pnpres`,
  inbox: (uid) => `u.${uid}.inbox`,
  meta: (c) => `cpl.${c}`,
};
const userId = (uid) => `u_${uid}`;

// ---- ULID（Crockford base32，26 字符） ----
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now = Date.now(), rand = crypto.randomBytes) {
  let t = Math.max(0, Math.floor(now)); let time = '';
  for (let i = 0; i < 10; i++) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = rand(16); let r = '';
  for (let i = 0; i < 16; i++) r += B32[bytes[i] % 32];
  return time + r;
}
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function validatePayload(type, p) {
  if (p == null) return type === 'ack' ? 'payload 缺失' : null;
  if (typeof p !== 'object' || Array.isArray(p)) return 'payload 必须是对象';
  switch (type) {
    case 'interact':
      if (!ACTIONS.includes(p.action)) return '未知互动 action';
      if (p.combo != null && typeof p.combo !== 'boolean') return 'combo 必须是布尔';
      return null;
    case 'focus.start':
      if (!p.sessionId || typeof p.sessionId !== 'string') return 'sessionId 缺失';
      if (!Number.isInteger(p.duration) || p.duration <= 0 || p.duration > 4 * 3600) return 'duration 非法';
      if (!Number.isFinite(p.startAt)) return 'startAt 缺失';
      return null;
    case 'focus.join': case 'focus.end':
      if (!p.sessionId) return 'sessionId 缺失';
      if (type === 'focus.end' && !['done', 'abort'].includes(p.result)) return 'result 非法';
      return null;
    case 'note':
      if (typeof p.text !== 'string' || !p.text.trim()) return '传话为空';
      if ([...p.text].length > NOTE_MAX_CHARS) return `传话不能超过 ${NOTE_MAX_CHARS} 字`;
      return null;
    case 'voice':
      if (typeof p.path !== 'string' || !/^couples\/[^/]+\/voice\/[^/]+\.(opus|webm)$/.test(p.path)) return '语音路径非法';
      if (!Number.isFinite(p.durationMs) || p.durationMs <= 0 || p.durationMs > VOICE_MAX_MS) return '语音时长须在 60 秒内';
      return null;
    case 'ack': return p.ackId ? null : 'ackId 缺失';
    default: return null;
  }
}

/** 校验信封；返回 null 表示合法，否则返回中文错误 */
function validateEnvelope(m) {
  if (!m || typeof m !== 'object') return '消息不是对象';
  for (const k of Object.keys(m)) if (!ENVELOPE_KEYS.has(k)) return `多余字段 ${k}`;
  if (m.v !== PROTOCOL_VERSION) return '协议版本不匹配';
  if (typeof m.id !== 'string' || !ULID_RE.test(m.id)) return 'id 不是 ULID';
  if (!TYPES.includes(m.type)) return '未知消息类型';
  if (typeof m.from !== 'string' || !/^u_.+/.test(m.from)) return 'from 非法';
  if (!Number.isInteger(m.ts)) return 'ts 非法';
  if (m.seq != null && !Number.isInteger(m.seq)) return 'seq 非法';
  const err = validatePayload(m.type, m.payload);
  if (err) return err;
  if (Buffer.byteLength(JSON.stringify(m)) > MAX_MESSAGE_BYTES) return '消息超过 32KB';
  return null;
}

function makeEnvelope({ type, from, payload, seq, now = Date.now(), id }) {
  const env = { v: PROTOCOL_VERSION, id: id || ulid(now), type, from, ts: Math.floor(now) };
  if (seq != null) env.seq = seq;
  if (payload !== undefined) env.payload = payload;
  const err = validateEnvelope(env);
  if (err) { const e = new Error(err); e.code = 'BAD_MESSAGE'; throw e; }
  return env;
}

/** 解析邀请码或链接 cubbit://pair?code=XXXXXX / https://.../pair?code=XXXXXX */
const INVITE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/;
function parseInvite(raw) {
  const s = String(raw || '').trim();
  let code = s;
  const m = s.match(/[?&]code=([^&#\s]+)/i);
  if (m) code = decodeURIComponent(m[1]);
  code = code.replace(/[\s-]/g, '').toUpperCase();
  return INVITE_RE.test(code) ? code : null;
}
function inviteLink(code) { return `cubbit://pair?code=${encodeURIComponent(code)}`; }

module.exports = {
  PROTOCOL_VERSION, ACTIONS, ACTION_LABEL, TYPES, MAX_MESSAGE_BYTES, NOTE_MAX_CHARS, VOICE_MAX_MS, FOCUS_DEFAULT_SEC,
  channels, userId, ulid, ULID_RE, validateEnvelope, makeEnvelope, parseInvite, inviteLink, INVITE_RE,
};
