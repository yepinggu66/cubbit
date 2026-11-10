'use strict';
/**
 * Firebase Callable Functions 客户端（契约见 spec §2/§3，后端在 opt/backend）。
 * 协议：POST {functionsBase}/{name}  body {data}  Authorization: Bearer <ID Token>  → {result} | {error:{status,message}}
 * 函数名（与 opt/backend/functions/src/index.ts 对齐）：createInvite→{code,expiresAt,deepLink,webLink}
 *   acceptInvite→{coupleId,partnerUid}  issuePubNubToken→{token,ttlMin,coupleId,userId}  requestUnpair / cancelUnpair
 * 注意：createInvite/acceptInvite 要求正式账号（非匿名），见 auth.js。
 */
class BackendClient {
  constructor({ functionsBase, getIdToken, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
    if (!functionsBase) throw new Error('functionsBase 未配置');
    Object.assign(this, { base: String(functionsBase).replace(/\/+$/, ''), getIdToken, fetchImpl, timeoutMs });
  }
  async call(name, data = {}) {
    const token = this.getIdToken ? await this.getIdToken() : '';
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs); if (t.unref) t.unref();
    let res;
    try {
      res = await this.fetchImpl(`${this.base}/${name}`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ data }),
      });
    } catch (err) { const e = new Error('无法连接情侣服务'); e.code = 'NETWORK'; e.cause = err; throw e; } finally { clearTimeout(t); }
    let body = null; try { body = await res.json(); } catch { /* ignore */ }
    if (!res.ok || (body && body.error)) {
      const err = (body && body.error) || {};
      const e = new Error(err.message || `服务返回 ${res.status}`); e.code = err.status || `HTTP_${res.status}`; e.status = res.status; throw e;
    }
    return body ? body.result : null;
  }
  createInvite() { return this.call('createInvite'); }
  acceptInvite(code) { return this.call('acceptInvite', { code }); }
  issueToken() { return this.call('issuePubNubToken'); }
  requestUnpair() { return this.call('requestUnpair'); }
  /** 内测期：立即解绑（服务端 unpair 接口） */
  forceUnpair() { return this.call('unpair'); }
  cancelUnpair() { return this.call('cancelUnpair'); }
  msgPost(m) { return this.call('msgPost', m); }
  msgHistory(since, limit) { return this.call('msgHistory', { since, limit }); }
  msgRead(ids) { return this.call('msgRead', { ids }); }
}
module.exports = { BackendClient };
