'use strict';
/**
 * 桌面端 Google 登录（OAuth 2.0 授权码 + PKCE + 本机回环地址，RFC 8252）。
 * 打开系统浏览器 → 用户同意 → 回调 http://127.0.0.1:<随机端口>/ → 用 code 换 id_token。
 * 需要配置 Google OAuth「桌面应用」client id（CUBBIT_GOOGLE_CLIENT_ID）；client secret 对桌面应用不是机密，可选。
 */
const crypto = require('node:crypto');
const http = require('node:http');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function pkcePair(rand = crypto.randomBytes) {
  const verifier = b64url(rand(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}
function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
const PAGE = (msg) => `<!doctype html><meta charset="utf-8"><title>Cubbit</title><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>${msg}</h2><p>You can close this window. 可以关闭此页面，回到方块仔。</p></body>`;

/**
 * openExternal(url) 由主进程传 shell.openExternal。返回 { idToken, email }。
 */
async function googleSignIn({ clientId, clientSecret = '', openExternal, fetchImpl = globalThis.fetch, timeoutMs = 180000 }) {
  if (!clientId) { const e = new Error('未配置 Google 登录（CUBBIT_GOOGLE_CLIENT_ID），请改用邮箱升级'); e.code = 'GOOGLE_UNCONFIGURED'; throw e; }
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((r, j) => server.listen(0, '127.0.0.1', r).on('error', j));
  const redirectUri = `http://127.0.0.1:${server.address().port}/`;
  try {
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { const e = new Error('Google 登录超时'); e.code = 'TIMEOUT'; reject(e); }, timeoutMs);
      server.on('request', (req, res) => {
        const u = new URL(req.url, redirectUri);
        if (u.pathname !== '/') { res.writeHead(404).end(); return; }
        const err = u.searchParams.get('error');
        const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE(ok ? '登录成功 ✓' : '登录未完成'));
        clearTimeout(t);
        if (ok) resolve(u.searchParams.get('code'));
        else { const e = new Error(err === 'access_denied' ? '你取消了 Google 登录' : 'Google 登录失败'); e.code = err || 'STATE_MISMATCH'; reject(e); }
      });
      Promise.resolve(openExternal(buildAuthUrl({ clientId, redirectUri, challenge, state }))).catch(reject);
    });
    const body = new URLSearchParams({ code, client_id: clientId, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (clientSecret) body.set('client_secret', clientSecret);
    const res = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id_token) { const e = new Error('Google 登录换取凭证失败'); e.code = j.error || 'TOKEN_EXCHANGE'; throw e; }
    return { idToken: j.id_token, redirectUri };
  } finally {
    server.close();
  }
}
module.exports = { googleSignIn, pkcePair, buildAuthUrl };
