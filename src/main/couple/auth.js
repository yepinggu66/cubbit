'use strict';
/**
 * Firebase Auth REST：匿名登录、刷新 ID Token、匿名账号升级为正式账号（保留 uid）。
 * apiKey 是 Firebase Web API Key（公开标识，不是密钥）。
 *
 * 升级 = Web SDK 的 linkWithCredential 在 REST 上的等价调用，都带着匿名用户的 idToken，因此 uid 不变：
 *  - 邮箱：accounts:update { idToken, email, password }（之后可发验证邮件 accounts:sendOobCode VERIFY_EMAIL）
 *  - Google：accounts:signInWithIdp { idToken, postBody: id_token=…&providerId=google.com }
 * 升级后会强制刷新 token，使 sign_in_provider 不再是 anonymous（后端 assertFullAccount 依赖它）。
 */
const IDT = 'https://identitytoolkit.googleapis.com/v1';

/** Firebase 错误码 → 中文提示 */
const AUTH_ERRORS = {
  EMAIL_EXISTS: '这个邮箱已被其他账号使用，请换一个邮箱，或用该邮箱直接登录',
  INVALID_EMAIL: '邮箱格式不正确',
  WEAK_PASSWORD: '密码至少 6 位',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: '登录状态过期，请重试',
  FEDERATED_USER_ID_ALREADY_LINKED: '这个 Google 账号已绑定了另一个方块仔账号',
  INVALID_IDP_RESPONSE: 'Google 登录结果无效，请重试',
  TOO_MANY_ATTEMPTS_TRY_LATER: '尝试太频繁，请稍后再试',
  OPERATION_NOT_ALLOWED: '服务端未开启该登录方式',
  USER_DISABLED: '账号已被停用',
};
function authError(raw, status) {
  const key = String(raw || '').split(':')[0].split(' ')[0].trim();
  const e = new Error(AUTH_ERRORS[key] || (key ? `账号服务错误：${key}` : `账号服务错误 ${status || ''}`));
  e.code = key || 'AUTH'; e.authCode = key; return e;
}

class FirebaseAuthClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, now = Date.now, load, save }) {
    Object.assign(this, { apiKey, fetchImpl, now, load, save });
    const s = (load && load()) || {};
    this.uid = s.uid || ''; this.refreshToken = s.refreshToken || ''; this.idToken = ''; this.expiresAt = 0;
    // 没记录的老存档默认按匿名处理（首次升级后会写入）
    this.anonymous = s.anonymous !== false; this.email = s.email || ''; this.providers = Array.isArray(s.providers) ? s.providers : [];
  }
  async _post(url, body, form) {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw authError(j.error && j.error.message, res.status);
    return j;
  }
  async getIdToken(force = false) {
    if (!force && this.idToken && this.now() < this.expiresAt - 60000) return this.idToken;
    if (this.refreshToken) {
      const j = await this._post(`https://securetoken.googleapis.com/v1/token?key=${this.apiKey}`, { grant_type: 'refresh_token', refresh_token: this.refreshToken }, true);
      this._set(j.user_id, j.refresh_token, j.id_token, j.expires_in);
    } else {
      const j = await this._post(`${IDT}/accounts:signUp?key=${this.apiKey}`, { returnSecureToken: true });
      this.anonymous = true;
      this._set(j.localId, j.refreshToken, j.idToken, j.expiresIn);
    }
    return this.idToken;
  }
  _set(uid, refresh, id, expiresIn) {
    this.uid = uid; this.refreshToken = refresh || this.refreshToken; this.idToken = id; this.expiresAt = this.now() + Number(expiresIn || 3600) * 1000;
    this._persist();
  }
  _persist() {
    this.save && this.save({ uid: this.uid, refreshToken: this.refreshToken, anonymous: this.anonymous, email: this.email, providers: this.providers });
  }
  account() { return { uid: this.uid, anonymous: this.anonymous, email: this.email, providers: [...this.providers] }; }

  /** 从服务端刷新账号信息（是否匿名、已绑定的登录方式） */
  async lookup() {
    const idToken = await this.getIdToken();
    const j = await this._post(`${IDT}/accounts:lookup?key=${this.apiKey}`, { idToken });
    const u = (j.users && j.users[0]) || {};
    this.providers = (u.providerUserInfo || []).map((p) => p.providerId);
    this.email = u.email || this.email;
    this.anonymous = this.providers.length === 0;
    this._persist();
    return this.account();
  }

  _assertSameUid(newUid, before) {
    if (newUid && before && newUid !== before) { const e = new Error('升级后账号 uid 发生变化，已中止'); e.code = 'UID_CHANGED'; throw e; }
  }

  /** 匿名 → 邮箱密码账号（保留 uid） */
  async linkEmail(email, password) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw authError('INVALID_EMAIL');
    if (String(password || '').length < 6) throw authError('WEAK_PASSWORD');
    const before = this.uid;
    const idToken = await this.getIdToken();
    const j = await this._post(`${IDT}/accounts:update?key=${this.apiKey}`, { idToken, email, password, returnSecureToken: true });
    this._assertSameUid(j.localId, before || j.localId);
    this.anonymous = false; this.email = email; if (!this.providers.includes('password')) this.providers.push('password');
    this._set(j.localId || before, j.refreshToken, j.idToken, j.expiresIn);
    await this.getIdToken(true); // 新 token：sign_in_provider=password
    this._post(`${IDT}/accounts:sendOobCode?key=${this.apiKey}`, { requestType: 'VERIFY_EMAIL', idToken: this.idToken }).catch(() => {});
    return this.account();
  }

  /** 匿名 → Google 账号（保留 uid）。googleIdToken 来自桌面端 OAuth（google-oauth.js） */
  async linkGoogle(googleIdToken, requestUri = 'http://localhost') {
    if (!googleIdToken) { const e = new Error('没有拿到 Google 登录结果'); e.code = 'NO_GOOGLE_TOKEN'; throw e; }
    const before = this.uid;
    const idToken = await this.getIdToken();
    const j = await this._post(`${IDT}/accounts:signInWithIdp?key=${this.apiKey}`, {
      idToken, postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`, requestUri, returnSecureToken: true, returnIdpCredential: true,
    });
    if (j.errorMessage) throw authError(j.errorMessage);
    this._assertSameUid(j.localId, before || j.localId);
    this.anonymous = false; this.email = j.email || this.email; if (!this.providers.includes('google.com')) this.providers.push('google.com');
    this._set(j.localId || before, j.refreshToken, j.idToken, j.expiresIn);
    await this.getIdToken(true);
    return this.account();
  }
}
module.exports = { FirebaseAuthClient, authError, AUTH_ERRORS };
