'use strict';
/**
 * 自托管后端（opt/server，部署在 https://pingguye.cn/cubbit/api）的客户端：
 *  - SelfhostAuthClient：接口与 FirebaseAuthClient 相同（getIdToken/account/lookup/linkEmail），
 *    匿名设备登录 + 邮箱验证码升级（linkEmail(email, code)，uid 保留），emailMode='code'
 *  - SelfhostVoiceStorage：接口与 VoiceStorage 相同（upload/download），PUT/GET {apiBase}/voice/{path}
 * 业务接口（createInvite/acceptInvite/...）沿用 Callable 协议，直接复用 BackendClient（functionsBase=apiBase）。
 */
const { MAX_VOICE_BYTES, MIME } = require('./voice-storage');

const ERRORS = {
  INVALID_EMAIL: '邮箱格式不正确', INVALID_CODE: '验证码不对，请检查后重试', CODE_EXPIRED: '验证码已过期，请重新获取',
  TOO_MANY_ATTEMPTS_TRY_LATER: '尝试太频繁，请稍后再试', INVALID_REFRESH_TOKEN: '登录状态已失效，请重新登录',
};
function apiError(body, status) {
  const err = (body && body.error) || {};
  const key = String(err.message || '');
  const e = new Error(ERRORS[key] || (status === 429 ? (key || '操作太频繁，请稍后再试') : key || `服务返回 ${status}`));
  e.code = key || err.status || `HTTP_${status}`; e.status = status; e.authCode = key; return e;
}
async function request(fetchImpl, url, { method = 'POST', data, token, body, headers = {}, timeoutMs = 15000, raw = false } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs); if (t.unref) t.unref();
  let res;
  try {
    res = await fetchImpl(url, { method, signal: ctl.signal,
      headers: { ...(data !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: data !== undefined ? JSON.stringify({ data }) : body });
  } catch (err) { const e = new Error('无法连接方块仔服务'); e.code = 'NETWORK'; e.cause = err; throw e; } finally { clearTimeout(t); }
  if (raw && res.ok) return res;
  let j = null; try { j = await res.json(); } catch { /* */ }
  if (!res.ok || (j && j.error)) throw apiError(j, res.status);
  return j && 'result' in j ? j.result : j;
}

class SelfhostAuthClient {
  constructor({ apiBase, fetchImpl = globalThis.fetch, now = Date.now, load, save }) {
    if (!apiBase) throw new Error('apiBase 未配置');
    Object.assign(this, { base: String(apiBase).replace(/\/+$/, ''), fetchImpl, now, load, save, emailMode: 'code' });
    const s = (load && load()) || {};
    this.uid = s.uid || ''; this.refreshToken = s.refreshToken || ''; this.idToken = ''; this.expiresAt = 0;
    this.anonymous = s.anonymous !== false; this.email = s.email || ''; this.providers = Array.isArray(s.providers) ? s.providers : [];
  }
  _post(path, data, token) { return request(this.fetchImpl, `${this.base}/${path}`, { data, token }); }
  _apply(r) {
    this.uid = r.uid; this.refreshToken = r.refreshToken || this.refreshToken; this.idToken = r.idToken;
    this.expiresAt = this.now() + Number(r.expiresIn || 3600) * 1000;
    if (typeof r.anonymous === 'boolean') this.anonymous = r.anonymous;
    if (r.email) this.email = r.email;
    this.providers = this.anonymous ? [] : ['email'];
    this._persist();
  }
  _persist() { this.save && this.save({ backend: 'selfhost', uid: this.uid, refreshToken: this.refreshToken, anonymous: this.anonymous, email: this.email, providers: this.providers }); }
  async getIdToken(force = false) {
    if (!force && this.idToken && this.now() < this.expiresAt - 60000) return this.idToken;
    if (this.refreshToken) {
      try { this._apply(await this._post('auth/refresh', { refreshToken: this.refreshToken })); return this.idToken; }
      catch (e) { if (e.code !== 'INVALID_REFRESH_TOKEN' || !this.anonymous) throw e; /* 匿名凭据丢失：重新匿名登录 */ }
    }
    this._apply(await this._post('auth/anonymous', {}));
    return this.idToken;
  }
  account() { return { uid: this.uid, anonymous: this.anonymous, email: this.email, providers: [...this.providers] }; }
  async lookup() {
    const me = await request(this.fetchImpl, `${this.base}/auth/me`, { method: 'GET', token: await this.getIdToken() });
    this.anonymous = !!me.anonymous; this.email = me.email || this.email; this.providers = me.providers || []; this._persist();
    return { ...this.account(), coupleId: me.coupleId || null };
  }
  async sendEmailCode(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { const e = new Error(ERRORS.INVALID_EMAIL); e.code = 'INVALID_EMAIL'; throw e; }
    return this._post('auth/email/send', { email });
  }
  /** 匿名 → 邮箱账号（验证码；uid 保留）。若该邮箱已有账号则登录到那个账号（switched=true） */
  async linkEmail(email, code) {
    email = String(email || '').trim();
    if (!/^\d{6}$/.test(String(code || '').trim())) { const e = new Error('请输入邮件里的 6 位验证码'); e.code = 'INVALID_CODE'; throw e; }
    const token = this.refreshToken || this.idToken ? await this.getIdToken() : '';
    const r = await this._post('auth/email/verify', { email, code: String(code).trim() }, token);
    this._apply(r); this.lastSwitched = !!r.switched;
    return this.account();
  }
  async linkGoogle() { const e = new Error('当前服务器暂不支持 Google 登录，请用邮箱验证码'); e.code = 'UNSUPPORTED'; throw e; }
}

class SelfhostVoiceStorage {
  static create({ apiBase, getIdToken, fetchImpl } = {}) { return apiBase && getIdToken ? new SelfhostVoiceStorage({ apiBase, getIdToken, fetchImpl }) : null; }
  constructor({ apiBase, getIdToken, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
    Object.assign(this, { base: String(apiBase).replace(/\/+$/, ''), getIdToken, fetchImpl, timeoutMs });
  }
  _url(p) { return `${this.base}/voice/${encodeURIComponent(p)}`; }
  async upload(objectPath, data, contentType = MIME) {
    if (!data || !data.length) { const e = new Error('录音为空'); e.code = 'EMPTY'; throw e; }
    if (data.length > MAX_VOICE_BYTES) { const e = new Error('语音太大（上限 2MB）'); e.code = 'TOO_LARGE'; throw e; }
    try { return await request(this.fetchImpl, this._url(objectPath), { method: 'PUT', token: await this.getIdToken(), body: data, headers: { 'content-type': contentType }, timeoutMs: this.timeoutMs }); }
    catch (e) { if (e.status === 403) e.message = '没有上传权限（请确认已配对）'; throw e; }
  }
  async download(objectPath) {
    let res;
    try { res = await request(this.fetchImpl, this._url(objectPath), { method: 'GET', token: await this.getIdToken(), raw: true, timeoutMs: this.timeoutMs }); }
    catch (e) { if (e.status === 404) e.message = '语音已过期（保留 30 天）'; throw e; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_VOICE_BYTES) { const e = new Error('语音文件异常'); e.code = 'TOO_LARGE'; throw e; }
    return { data: buf, contentType: (res.headers && res.headers.get && res.headers.get('content-type')) || MIME };
  }
}
module.exports = { SelfhostAuthClient, SelfhostVoiceStorage, apiError };
