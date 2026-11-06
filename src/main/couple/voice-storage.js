'use strict';
/**
 * 语音留言 ↔ Firebase Cloud Storage（REST，spec §7）。
 * 上传：POST https://firebasestorage.googleapis.com/v0/b/{bucket}/o?uploadType=media&name={path}
 * 下载：GET  .../o/{encodeURIComponent(path)}?alt=media
 * 鉴权：Authorization: Firebase <ID Token>（Storage 规则只允许情侣双方读写 couples/{id}/voice/**）
 * 未配置 bucket / 账号服务时 VoiceStorage.create 返回 null，调用方降级为文字传话或本地播放。
 */
const API = 'https://firebasestorage.googleapis.com/v0/b';
const MAX_VOICE_BYTES = 2 * 1024 * 1024; // 60s Opus 约 0.5MB，留足余量
const MIME = 'audio/webm';

class VoiceStorage {
  static create({ bucket, getIdToken, fetchImpl } = {}) {
    if (!bucket || !getIdToken) return null;
    return new VoiceStorage({ bucket, getIdToken, fetchImpl });
  }
  constructor({ bucket, getIdToken, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
    Object.assign(this, { bucket: String(bucket).replace(/^gs:\/\//, '').replace(/\/+$/, ''), getIdToken, fetchImpl, timeoutMs });
  }
  async _fetch(url, init) {
    const token = await this.getIdToken();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs); if (t.unref) t.unref();
    try {
      return await this.fetchImpl(url, { ...init, signal: ctl.signal, headers: { ...(init.headers || {}), authorization: `Firebase ${token}` } });
    } catch (err) { const e = new Error('语音上传/下载失败：网络不可用'); e.code = 'NETWORK'; e.cause = err; throw e; } finally { clearTimeout(t); }
  }
  async upload(objectPath, data, contentType = MIME) {
    if (!data || !data.length) { const e = new Error('录音为空'); e.code = 'EMPTY'; throw e; }
    if (data.length > MAX_VOICE_BYTES) { const e = new Error('语音太大（上限 2MB）'); e.code = 'TOO_LARGE'; throw e; }
    const url = `${API}/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
    const res = await this._fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body: data });
    if (!res.ok) { const e = new Error(res.status === 403 ? '没有上传权限（请确认已配对）' : `语音上传失败（${res.status}）`); e.code = `HTTP_${res.status}`; e.status = res.status; throw e; }
    return res.json().catch(() => ({}));
  }
  async download(objectPath) {
    const url = `${API}/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`;
    const res = await this._fetch(url, { method: 'GET' });
    if (!res.ok) { const e = new Error(res.status === 404 ? '语音已过期（保留 30 天）' : `语音下载失败（${res.status}）`); e.code = `HTTP_${res.status}`; e.status = res.status; throw e; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_VOICE_BYTES) { const e = new Error('语音文件异常'); e.code = 'TOO_LARGE'; throw e; }
    return { data: buf, contentType: res.headers && res.headers.get ? res.headers.get('content-type') || MIME : MIME };
  }
}
module.exports = { VoiceStorage, MAX_VOICE_BYTES, MIME };
