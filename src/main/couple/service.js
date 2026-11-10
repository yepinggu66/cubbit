'use strict';
/**
 * CoupleService —— 真实情侣联机（替换演示伴侣阿橘），运行在主进程，渲染进程只走 IPC。
 *
 * new CoupleService({ dir, config, adapter?, backend?, auth?, now?, timers?, random? })
 *   config: { functionsBase, publishKey, subscribeKey, firebaseApiKey }；缺任一项 → 演示模式（阿橘）
 * 方法：init() status() createInvite() acceptInvite(codeOrLink) unpair()
 *       interact(action) note(text) voice({path,durationMs}) startFocus(sec) endFocus(result)
 *       suspend() resume() dispose()
 * 事件：'changed'(status) 'interaction'{action,from,self,catchup} 'note' 'voice' 'focus'
 *       'catchup'{counts} 'paired' 'unpaired' 'error'
 * 规则：Firestore 权威、PubNub 仅实时；去重 LRU 2000（持久化）；10s 限流；发送队列持久化+指数退避；
 *       Presence 30s 防抖；断线/唤醒后补拉；Token TTL 前 10 分钟刷新，403 刷新一次失败则离线。
 */
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const P = require('./protocol');
const { DedupeSet, RateLimiter, SendQueue, PresenceDebouncer, backoffDelay } = require('./reliability');
const { DEMO_PARTNER, demoReply } = require('./demo');

const STATE_FILE = 'couple-rt.json';
const MSG_FILE = 'couple-msgs.json';
const MSG_KEEP = 500;
const CATCHUP_REPLAY_LIMIT = 3;
const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;
/** 软启动开关：匿名设备可直接配对（服务端 ALLOW_ANON_PAIRING=1 配套）。正式版改回 false。 */
const SOFT_LAUNCH_ANON_PAIRING = true;

/** 服务器英文错误 → 给用户看的中文（渲染层再按语言翻译） */
const FRIENDLY = [
  [/invite not found|bad code/i, '邀请码不存在，请核对 6 位邀请码'],
  [/invite already used/i, '这个邀请码已经被用过了，请让 TA 重新生成一个'],
  [/invite expired/i, '邀请码已过期，请让 TA 重新生成一个'],
  [/cannot accept own invite/i, '不能输入自己生成的邀请码，请让 TA 来输入'],
  [/already paired/i, '你或 TA 已经和别人配对了，需要先解除配对'],
  [/too many failed|locked 15 min/i, '尝试次数太多，请 15 分钟后再试'],
  [/rate limited|TOO_MANY_ATTEMPTS/i, '操作太频繁，请稍后再试'],
  [/INVALID_CODE/i, '验证码不对，请检查邮件里的 6 位数字'],
  [/CODE_EXPIRED/i, '验证码已过期，请重新发送'],
  [/INVALID_EMAIL/i, '邮箱格式不对'],
  [/voice quota/i, '语音空间已满，旧语音过期后再试'],
];
function friendlyError(err) {
  const msg = (err && err.message) || '';
  if (err && err.code === 'NETWORK') return '连不上情侣服务器，请检查网络后重试';
  for (const [re, zh] of FRIENDLY) if (re.test(msg)) return zh;
  if (err && (err.status >= 500 || /HTTP_5|INTERNAL/.test(String(err.code)))) return '服务器开小差了，请稍后重试';
  return msg || '出错了，请重试';
}

function isLiveConfig(c) { return !!(c && c.functionsBase && c.publishKey && c.subscribeKey); }

class CoupleService extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir; this.config = opts.config || {};
    this.now = opts.now || Date.now;
    this.timers = opts.timers || { setTimeout, clearTimeout };
    this.random = opts.random || Math.random;
    this.adapter = opts.adapter || null; this.backend = opts.backend || null; this.auth = opts.auth || null; this.storage = opts.storage || null;
    this.mode = this.adapter && this.backend ? 'live' : 'demo';
    this.state = this._load();
    this.msgs = this._loadMsgs();
    this.dedupe = new DedupeSet(2000, this.state.dedupe || []);
    this.limiter = new RateLimiter({ windowMs: opts.cooldownMs || 10000, now: this.now });
    this.connection = 'offline'; this.partnerOnline = false; this.partnerState = {};
    this.focus = null; this.invite = null; this._tokenTimer = null; this._reconnectTimer = null; this._reconnectAttempt = 0;
    this._demoTimers = new Set(); this._demoNoteIdx = 0;
    this.presence = new PresenceDebouncer({ graceMs: opts.presenceGraceMs ?? 30000, timers: this.timers,
      onChange: (on) => { this.partnerOnline = on; this.emit('partnerOnline', on); this._changed(); } });
    this.queue = new SendQueue({
      publish: (env) => this._publishNow(env), timers: this.timers, random: this.random,
      store: { load: () => this.state.queue || [], save: (items) => { this.state.queue = items; this._save(); } },
      onDrop: (env, err) => this.emit('error', { code: 'DROPPED', message: (err && err.message) || '消息被丢弃', id: env.id }),
    });
  }

  // ---------- 持久化 ----------
  _file() { return this.dir ? path.join(this.dir, STATE_FILE) : null; }
  _load() {
    const f = this._file(); const base = { coupleId: '', uid: '', partnerUid: '', partnerName: '', since: 0, lastTT: {}, dedupe: [], queue: [], seq: 0, lastFocus: null };
    if (!f) return base;
    try { return { ...base, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return base; }
  }
  // ---------- 悄悄话（传话 + 语音）时间线：本地缓存 + 服务器历史 ----------
  _loadMsgs() {
    const base = { list: [], syncAt: 0, coupleId: '' };
    const f = this.dir ? path.join(this.dir, MSG_FILE) : null; if (!f) return base;
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return { ...base, ...j, list: Array.isArray(j.list) ? j.list : [] }; } catch { return base; }
  }
  _saveMsgs() {
    if (!this.dir) return;
    if (this.msgs.list.length > MSG_KEEP) this.msgs.list = this.msgs.list.slice(-MSG_KEEP);
    const f = path.join(this.dir, MSG_FILE);
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(this.msgs)); fs.renameSync(`${f}.tmp`, f); } catch { /* ignore */ }
  }
  /** 合并一条消息（按 id 去重）；返回 true 表示新增 */
  _msgAdd(m) {
    if (this.msgs.coupleId !== (this.state.coupleId || 'demo')) { this.msgs = { list: [], syncAt: 0, coupleId: this.state.coupleId || 'demo' }; }
    const ex = this.msgs.list.find((x) => x.id === m.id);
    if (ex) { Object.assign(ex, Object.fromEntries(Object.entries(m).filter(([k, v]) => v != null && !(k === 'unread' && ex.unread === false) && !(k === 'status' && ex.status === 'read')))); return false; }
    this.msgs.list.push(m); this.msgs.list.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));
    return true;
  }
  _msgChanged() { this._saveMsgs(); this.emit('messages', { unread: this.unreadCount() }); }
  unreadCount() { return this.msgs.list.filter((m) => !m.mine && m.unread).length; }
  messages() { return { ok: true, list: this.msgs.list.slice(-200), unread: this.unreadCount(), partner: this.state.partnerName || 'TA' }; }
  _archive(m) {
    if (this.mode !== 'live' || !this.backend || typeof this.backend.msgPost !== 'function') return;
    const body = m.type === 'note' ? { text: m.text } : { path: m.path, durationMs: m.durationMs };
    this.backend.msgPost({ id: m.id, type: m.type, ts: m.ts, ...body }).then(() => {
      const x = this.msgs.list.find((y) => y.id === m.id); if (x && x.status === 'sending') { x.status = 'delivered'; this._msgChanged(); }
    }).catch(() => { /* 下次同步时重试 */ });
  }
  /** 从服务器补齐历史（面板关闭/离线期间收到的）+ 我方消息的已读状态；并重试未存档的我方消息 */
  async syncMessages() {
    if (this.mode !== 'live' || !this.state.coupleId || !this.backend || typeof this.backend.msgHistory !== 'function') return { ok: false };
    if (this.msgs.coupleId !== this.state.coupleId) this.msgs = { list: [], syncAt: 0, coupleId: this.state.coupleId };
    let changed = false;
    try {
      for (let i = 0; i < 5; i++) {
        const r = await this.backend.msgHistory(this.msgs.syncAt || 0, 200);
        for (const m of r.messages || []) {
          const mine = m.from === this.state.uid;
          // 兜底：接受邀请返回 5xx 时 partnerUid 可能落空，用对方发来的第一条消息补上
          if (!mine && m.from && !this.state.partnerUid) { this.state.partnerUid = m.from; this._save(); }
          const isNew = this._msgAdd({ id: m.id, mine, type: m.type, text: m.text, path: m.path, durationMs: m.durationMs, ts: m.ts,
            ...(mine ? { status: m.readAt ? 'read' : 'delivered' } : { unread: !m.readAt }) });
          if (isNew && !mine) changed = true; else if (isNew) changed = true;
          if (!mine) { const x = this.msgs.list.find((y) => y.id === m.id); if (x && m.readAt) x.unread = false; }
          this.msgs.syncAt = Math.max(this.msgs.syncAt || 0, m.at || 0);
        }
        for (const rd of r.reads || []) { const x = this.msgs.list.find((y) => y.id === rd.id && y.mine); if (x && x.status !== 'read') { x.status = 'read'; changed = true; } }
        if (!r.messages || r.messages.length < 200) break;
      }
      for (const m of this.msgs.list) if (m.mine && m.status === 'sending') this._archive(m);
    } catch { return { ok: false }; }
    if (changed) this._msgChanged(); else this._saveMsgs();
    return { ok: true, unread: this.unreadCount() };
  }
  /** 标记已读（文字：面板里看到即已读；语音：点播放才算已听），并给对方发回执 */
  markRead(ids) {
    const want = Array.isArray(ids) ? new Set(ids) : null;
    const hit = this.msgs.list.filter((m) => !m.mine && m.unread && (want ? want.has(m.id) : m.type === 'note'));
    if (!hit.length) return { ok: true, updated: 0, unread: this.unreadCount() };
    for (const m of hit) m.unread = false;
    if (this.paired && this.mode === 'live') {
      for (const m of hit.slice(-20)) { try { this._send('ack', { ackId: m.id, kind: m.type === 'voice' ? 'played' : 'read' }); } catch { /* ignore */ } }
      if (this.backend && typeof this.backend.msgRead === 'function') this.backend.msgRead(hit.map((m) => m.id)).catch(() => {});
    }
    this._msgChanged();
    return { ok: true, updated: hit.length, unread: this.unreadCount() };
  }

  _save() {
    const f = this._file(); if (!f) return;
    this.state.dedupe = this.dedupe ? this.dedupe.toJSON() : this.state.dedupe;
    try { fs.mkdirSync(this.dir, { recursive: true }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.state)); fs.renameSync(tmp, f); } catch (err) { this.emit('error', { code: 'IO', message: err.message }); }
  }

  // ---------- 状态 ----------
  get paired() { return this.mode === 'demo' ? true : !!this.state.coupleId; }
  get me() { return P.userId(this.state.uid || 'local'); }
  status() {
    const demo = this.mode === 'demo';
    return {
      ok: true, mode: this.mode, paired: this.paired, coupleId: demo ? 'demo' : this.state.coupleId,
      connection: demo ? 'online' : this.connection,
      partner: demo ? { name: DEMO_PARTNER.name, skinId: DEMO_PARTNER.skinId, online: true, demo: true }
        : { name: this.state.partnerName || 'TA', online: this.partnerOnline, state: this.partnerState },
      since: this.state.since || 0, pending: this.queue.pending, invite: this.invite, focus: this.focus,
      account: this.accountInfo(), voice: this.voiceMode(),
      cooldown: Object.fromEntries(P.ACTIONS.map((a) => [a, this.limiter.check(a).retryInMs])),
    };
  }
  _changed() { this.emit('changed', this.status()); }

  async init() {
    if (this.mode === 'demo') { this.connection = 'online'; this._changed(); return this.status(); }
    if (this.auth && !this.state.coupleId) this.refreshAccount().catch(() => {});
    if (this.state.coupleId) await this._connect();
    this._changed();
    return this.status();
  }

  // ---------- 账号（匿名 → 正式，spec §2.1） ----------
  accountInfo() {
    if (this.mode === 'demo') return { demo: true, anonymous: false, needsUpgrade: false };
    if (!this.auth) return { anonymous: false, needsUpgrade: false, managed: false };
    const a = this.auth.account();
    return { ...a, needsUpgrade: SOFT_LAUNCH_ANON_PAIRING ? false : !!a.anonymous, google: !!this.config.googleClientId && this.auth.emailMode !== 'code', emailMode: this.auth.emailMode || 'password' };
  }
  _needUpgrade() {
    return { ok: false, code: 'NEED_UPGRADE', message: '配对前需要先升级为正式账号（邮箱或 Google），你的数据和 uid 会保留' };
  }
  _isAnonBlocked() {
    // 2 周软启动（2.5.x-soft）：服务端已开 ALLOW_ANON_PAIRING=1，匿名设备可直接配对。
    // 目的：把「配对能不能成」和「邮箱验证码能不能收到」分开测。正式版改回 false。
    if (SOFT_LAUNCH_ANON_PAIRING) return false;
    return this.mode === 'live' && this.auth && this.auth.anonymous;
  }
  async refreshAccount() {
    if (!this.auth) return this.accountInfo();
    let acct = null;
    try { acct = await this.auth.lookup(); } catch { /* 离线时沿用本地记录 */ }
    // 服务器已配对但本地不知道（例如接受邀请时响应失败）→ 补签令牌接管
    if (acct && acct.coupleId && !this.state.coupleId && this.backend) {
      try { const t = await this.backend.issueToken(); if (t && t.coupleId) await this._onPaired({ ...t, coupleId: t.coupleId }); } catch { /* 下次启动再试 */ }
    }
    this._changed(); return this.accountInfo();
  }
  /** 自托管后端：邮箱验证码（发码） */
  async sendEmailCode(email) {
    if (!this.auth || typeof this.auth.sendEmailCode !== 'function') return { ok: false, code: 'UNSUPPORTED', message: '当前账号服务不需要验证码' };
    try { const r = await this.auth.sendEmailCode(email); return { ok: true, ttlSec: r && r.ttlSec }; } catch (err) { return this._fail(err); }
  }
  /** password：Firebase 下是新密码；自托管下是邮件里的 6 位验证码 */
  async upgradeEmail(email, password) {
    if (!this.auth) return { ok: false, code: 'NO_AUTH', message: '未配置账号服务' };
    try { await this.auth.linkEmail(email, password); if (this.auth.uid && this.state.uid !== this.auth.uid) this.state.uid = this.auth.uid; this._changed(); return { ok: true, account: this.accountInfo(), ...(await this._resumePending()) }; } catch (err) { return this._fail(err); }
  }
  /** signIn: () => Promise<{idToken, redirectUri}>（主进程注入 google-oauth.googleSignIn） */
  async upgradeGoogle(signIn) {
    if (!this.auth) return { ok: false, code: 'NO_AUTH', message: '未配置账号服务' };
    try { const g = await signIn(); await this.auth.linkGoogle(g.idToken, g.redirectUri); this._changed(); return { ok: true, account: this.accountInfo(), ...(await this._resumePending()) }; } catch (err) { return this._fail(err); }
  }

  /** 升级前被拦下的邀请码：升级成功后自动继续配对 */
  async _resumePending() {
    const code = this.pendingInvite; if (!code) return {};
    this.pendingInvite = null;
    const r = await this.acceptInvite(code);
    return { paired: !!r.ok, pairResult: r };
  }

  // ---------- 配对 ----------
  async createInvite() {
    if (this.mode === 'demo') return { ok: false, code: 'DEMO', message: '演示模式：尚未配置联机服务，正在和阿橘体验' };
    if (this._isAnonBlocked()) return this._needUpgrade();
    this.emit('pairIntent', { role: 'inviter', method: 'invite_code' });
    try {
      const r = await this.backend.createInvite();
      this.invite = { code: r.code, link: r.deepLink || r.link || P.inviteLink(r.code), webLink: r.webLink || '', expiresAt: r.expiresAt };
      this._changed(); this._pollPairing();
      return { ok: true, ...this.invite };
    } catch (err) {
      this.emit('pairFailure', { role: 'inviter', code: String((err && (err.code || err.status)) || 'UNKNOWN').slice(0, 40) });
      return this._fail(err);
    }
  }
  /** 邀请方在对方接受前没有情侣频道权限：每 5 秒查一次 getCouple，配对成功后接管 */
  _pollPairing() {
    if (this._pairTimer) return;
    const tick = async () => {
      this._pairTimer = null;
      if (!this.invite || this.state.coupleId) return;
      if (this.invite.expiresAt && this.now() > this.invite.expiresAt) { this.invite = null; this._changed(); return; }
      // 自托管：先查便宜的 /auth/me（不消耗 PubNub 令牌配额 30 次/小时），确认已配对才签发令牌
      const cheap = this.auth && typeof this.auth.lookup === 'function' && this.config && this.config.backend === 'selfhost';
      this._pairPolls = (this._pairPolls || 0) + 1;
      try {
        let paired = true;
        if (cheap) { const a = await this.auth.lookup(); paired = !!(a && a.coupleId); }
        if (paired) { const t = await this.backend.issueToken(); if (t && t.coupleId) { await this._onPaired({ ...t, coupleId: t.coupleId }); return; } }
      } catch { /* 网络失败下次再试 */ }
      this._pairTimer = this.timers.setTimeout(tick, cheap ? 5000 : 30000); if (this._pairTimer.unref) this._pairTimer.unref();
    };
    this._pairTimer = this.timers.setTimeout(tick, 5000); if (this._pairTimer && this._pairTimer.unref) this._pairTimer.unref();
  }
  /**
   * 接受邀请，带一次 5xx 重试。
   * 背景：服务端在「配对事务已提交、随后发布实时事件失败」时会返回 5xx，此时配对其实已经成功。
   * 直接重试会得到 failed-precondition（已配对），由 acceptInvite 的 catch 里 refreshAccount 兜底接管，
   * 这样用户不会看到「配对失败」，也不会出现「配上了但对方信息为空」的半个状态。
   */
  async _acceptInviteWithRetry(code) {
    try {
      return await this.backend.acceptInvite(code);
    } catch (err) {
      const transient = err && (err.status >= 500 || /^HTTP_5/.test(String(err.code || '')) || err.code === 'INTERNAL');
      if (!transient) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this.backend.acceptInvite(code);
    }
  }
  async acceptInvite(raw) {
    if (this.mode === 'demo') return { ok: false, code: 'DEMO', message: '演示模式下不能配对' };
    const code = P.parseInvite(raw);
    if (!code) return { ok: false, code: 'BAD_CODE', message: '邀请码格式不对（6 位字母数字）' };
    if (this._isAnonBlocked()) { this.pendingInvite = code; return { ...this._needUpgrade(), pendingCode: code }; }
    this.emit('pairIntent', { role: 'joiner', method: 'invite_code' });
    try {
      const r = await this._acceptInviteWithRetry(code);
      await this._onPaired(r);
      return { ok: true, ...this.status() };
    } catch (err) {
      // 响应失败不代表没配上（服务端可能已提交）：查一次账号状态兜底
      await this.refreshAccount().catch(() => {});
      if (this.state.coupleId) return { ok: true, recovered: true, ...this.status() };
      this.emit('pairFailure', { role: 'joiner', code: String((err && (err.code || err.status)) || 'UNKNOWN').slice(0, 40) });
      return this._fail(err);
    }
  }
  async _onPaired(r) {
    const role = this.invite ? 'inviter' : 'joiner';
    this.state.coupleId = r.coupleId; this.state.partnerUid = r.partnerUid || ''; this.state.partnerName = r.partnerName || '';
    this.state.since = r.since || this.now(); if (r.uid) this.state.uid = r.uid; else if (r.userId) this.state.uid = String(r.userId).replace(/^u_/, ''); this.invite = null; this._save();
    await this._connect(r.token ? { token: r.token, ttlMin: r.ttlMin } : null);
    this.emit('paired', { ...this.status(), role }); this._changed();
    this.syncMessages().catch(() => {});
  }
  async unpair() {
    if (this.mode === 'demo') return { ok: false, code: 'DEMO', message: '演示模式下无需解绑' };
    // 内测期：立即解绑（正式版恢复 7 天冷静期）
    try {
      if (this.backend && typeof this.backend.forceUnpair === 'function') await this.backend.forceUnpair();
      else await this.backend.requestUnpair();
    } catch (err) {
      // 服务端已经没这一对（本地脏数据）时，也照样清本地
      if (!/not paired|failed-precondition/i.test(String(err && err.message))) return this._fail(err);
    }
    this._clearCouple();
    this._changed();
    return { ok: true, immediate: true, message: '已解除配对' };
  }
  _fail(err) {
    // 后端 assertFullAccount：本地记录不准时（例如老存档）以服务端为准
    if (err && /FAILED_PRECONDITION|failed-precondition/i.test(String(err.code)) && /anonymous/i.test(String(err.message))) {
      if (this.auth) { this.auth.anonymous = true; this._changed(); }
      return this._needUpgrade();
    }
    const offline = err && err.code === 'NETWORK';
    return { ok: false, offline, code: (err && err.code) || 'ERROR', message: friendlyError(err) };
  }

  // ---------- 连接 / Token / 重连 ----------
  async _connect(tokenInfo) {
    this.connection = 'connecting'; this._changed();
    try {
      const t = tokenInfo || await this.backend.issueToken();
      if (t.uid) this.state.uid = t.uid;
      else if (t.userId) this.state.uid = String(t.userId).replace(/^u_/, '');
      this._scheduleTokenRefresh(t.ttlMin || 60);
      if (!this._wired) this._wire();
      const c = this.state.coupleId;
      await this.adapter.connect({ userId: this.me, token: t.token, channels: [P.channels.rt(c), P.channels.sys(c), P.channels.inbox(this.state.uid)] });
      this.connection = 'online'; this._reconnectAttempt = 0;
      await this._afterOnline();
    } catch (err) {
      this.connection = 'offline'; this._changed(); this._scheduleReconnect();
      this.emit('error', { code: err.code || 'CONNECT', message: err.message });
    }
  }
  _wire() {
    this._wired = true;
    this.adapter.on('message', (e) => this._onMessage(e, false));
    this.adapter.on('presence', (e) => {
      if (!e || e.uuid === this.me) return;
      if (e.action === 'join' || e.action === 'state-change') { this.presence.set(true); if (e.state) this.partnerState = e.state; }
      else if (e.action === 'leave' || e.action === 'timeout') this.presence.set(false);
      this._changed();
    });
    this.adapter.on('status', (s) => {
      if (s === 'down') { this.connection = 'offline'; this.queue.pause(); this._changed(); }
      else if (s === 'reconnected' || s === 'connected') { if (this.connection !== 'online') { this.connection = 'online'; this._afterOnline(); } }
      else if (s === 'denied') this._refreshToken(true);
    });
  }
  async _afterOnline() {
    this._changed();
    await this.catchUp();
    this.syncMessages().catch(() => {});
    if (!this._msgTimer) { this._msgTimer = setInterval(() => { if (this.connection === 'online') this.syncMessages().catch(() => {}); }, 20e3); if (this._msgTimer.unref) this._msgTimer.unref(); }
    try { const here = await this.adapter.hereNow(P.channels.rt(this.state.coupleId)); this.presence.set(here.some((u) => u !== this.me)); } catch { /* ignore */ }
    this.queue.resume();
  }
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const d = backoffDelay(this._reconnectAttempt++, { random: this.random });
    this._reconnectTimer = this.timers.setTimeout(() => { this._reconnectTimer = null; if (this.connection !== 'online') this._connect(); }, d);
    if (this._reconnectTimer && this._reconnectTimer.unref) this._reconnectTimer.unref();
  }
  _scheduleTokenRefresh(ttlMin) {
    if (this._tokenTimer) this.timers.clearTimeout(this._tokenTimer);
    const ms = Math.max(60000, ttlMin * 60000 - TOKEN_REFRESH_LEAD_MS);
    this._tokenTimer = this.timers.setTimeout(() => this._refreshToken(false), ms);
    if (this._tokenTimer && this._tokenTimer.unref) this._tokenTimer.unref();
  }
  async _refreshToken(denied) {
    if (denied) {
      // 403 只自动刷新一次；刷新后仍被拒则进入离线模式，等重连流程
      if (this._deniedRefreshAt && this.now() - this._deniedRefreshAt < 60000) { this.connection = 'offline'; this.queue.pause(); this._changed(); this._scheduleReconnect(); return; }
      this._deniedRefreshAt = this.now();
    }
    try {
      const t = await this.backend.issueToken(); this.adapter.setToken(t.token); this._scheduleTokenRefresh(t.ttlMin || 60);
      if (denied) this.queue.resume();
    } catch (err) {
      if (denied) { this.connection = 'offline'; this.queue.pause(); this._changed(); }
      this._scheduleReconnect();
    }
  }
  /** powerMonitor suspend / resume */
  suspend() { if (this.mode === 'live') { this.queue.pause(); this.connection = 'offline'; this._changed(); } }
  async resume() { if (this.mode === 'live' && this.state.coupleId) { await this._refreshToken(false); this.connection = 'online'; await this._afterOnline(); } }

  // ---------- 补拉 ----------
  async catchUp() {
    if (this.mode !== 'live' || !this.state.coupleId) return { ok: true, counts: {} };
    const counts = {}; const replay = [];
    for (const kind of ['rt', 'sys']) {
      const ch = P.channels[kind](this.state.coupleId);
      let list = [];
      try { list = await this.adapter.fetchSince(ch, this.state.lastTT[kind]); } catch { continue; }
      for (const e of list) {
        const r = this._onMessage({ channel: ch, ...e }, true);
        if (r && r.type) { counts[r.type] = (counts[r.type] || 0) + 1; if (r.type === 'interact') replay.push(r); }
      }
    }
    // 只补播最近 3 条互动（spec §4.2）
    for (const r of replay.slice(-CATCHUP_REPLAY_LIMIT)) this.emit('interaction', { ...r.payload, from: r.from, self: false, catchup: true });
    if (Object.keys(counts).length) this.emit('catchup', { counts });
    return { ok: true, counts };
  }

  // ---------- 接收 ----------
  _onMessage(e, isCatchup) {
    const kind = e.channel && e.channel.endsWith('.sys') ? 'sys' : 'rt';
    if (e.timetoken && (!this.state.lastTT[kind] || BigInt(e.timetoken) > BigInt(this.state.lastTT[kind]))) this.state.lastTT[kind] = e.timetoken;
    const m = e.message;
    if (kind === 'sys') return this._onSys(m, isCatchup);
    if (P.validateEnvelope(m)) return null;
    if (!this.dedupe.add(m.id)) return null;
    this._save();
    const self = m.from === this.me;
    if (self) { if (!isCatchup) this.emit('echo', m); return null; }
    if (isCatchup && m.type === 'interact') return m; // 由 catchUp 统一节流补播
    this._dispatch(m, isCatchup);
    return m;
  }
  _onSys(m, isCatchup) {
    if (!m || !m.type) return null;
    if (m.id && !this.dedupe.add(m.id)) return null;
    if (m.type === 'unpaired') { this._clearCouple(); this.emit('unpaired', {}); }
    else if (m.type === 'paired' && m.payload) { this.state.partnerName = m.payload.partnerName || this.state.partnerName; this._save(); this._changed(); }
    else if (m.type === 'farm.event') this.emit('farm', m.payload);
    return isCatchup ? m : null;
  }
  _clearCouple() {
    this.adapter && this.adapter.disconnect().catch(() => {});
    Object.assign(this.state, { coupleId: '', partnerUid: '', partnerName: '', since: 0, lastTT: {}, queue: [] });
    this.queue.items = []; this.connection = 'offline'; this._save(); this._changed();
  }
  _dispatch(m, catchup) {
    const from = m.from;
    switch (m.type) {
      case 'interact': this.emit('interaction', { ...m.payload, from, self: false, catchup }); break;
      case 'note': this._msgAdd({ id: m.id, mine: false, type: 'note', text: m.payload.text, ts: m.ts, unread: true }); this._msgChanged(); this.emit('note', { ...m.payload, id: m.id, from, catchup }); break;
      case 'voice': this._msgAdd({ id: m.id, mine: false, type: 'voice', path: m.payload.path, durationMs: m.payload.durationMs, ts: m.ts, unread: true }); this._msgChanged(); this.emit('voice', { ...m.payload, id: m.id, from, catchup }); break;
      case 'ack': {
        const x = this.msgs.list.find((y) => y.mine && y.id === m.payload.ackId);
        if (x && x.status !== 'read') { x.status = 'read'; this._msgChanged(); this.emit('receipt', { id: x.id, kind: m.payload.kind || 'read' }); }
        break;
      }
      case 'focus.start': {
        const p = m.payload; const left = p.startAt + p.duration * 1000 - this.now();
        if (left > 0) { this.focus = { ...p, partner: 'running', me: 'invited', endsAt: p.startAt + p.duration * 1000 }; this.emit('focus', { event: 'start', ...this.focus, from }); this.joinFocus(); }
        break;
      }
      case 'focus.join': if (this.focus && this.focus.sessionId === m.payload.sessionId) { this.focus.partner = 'running'; this.emit('focus', { event: 'join', ...this.focus }); } break;
      case 'focus.end': if (this.focus && this.focus.sessionId === m.payload.sessionId) { this.focus.partner = m.payload.result; this.emit('focus', { event: 'partnerEnd', ...this.focus }); } break;
      case 'farm.event': this.emit('farm', { ...m.payload, from, catchup }); break;
      case 'anniv.update': if (m.payload && m.payload.since) { this.state.since = m.payload.since; this._save(); } break;
      default: break;
    }
    this._changed();
  }

  // ---------- 发送 ----------
  _send(type, payload) {
    this.state.seq = (this.state.seq || 0) + 1;
    const env = P.makeEnvelope({ type, from: this.me, payload, seq: this.state.seq, now: this.now() });
    this.dedupe.add(env.id); this._save();
    if (this.mode === 'demo') { this._demoRespond(type, payload); return env; }
    this.queue.enqueue(env);
    return env;
  }
  async _publishNow(env) {
    if (this.connection !== 'online') { const e = new Error('离线'); e.code = 'NETWORK'; throw e; }
    try { return await this.adapter.publish(P.channels.rt(this.state.coupleId), env); } catch (err) {
      if (err.status === 403) { this.queue.pause(); this._refreshToken(true); }
      throw err;
    }
  }
  _demoRespond(type, payload) {
    const r = demoReply(type, payload, this._demoNoteIdx++); if (!r) return;
    const t = this.timers.setTimeout(() => {
      this._demoTimers.delete(t);
      const env = { v: 1, id: P.ulid(this.now()), type: r.type, from: P.userId(DEMO_PARTNER.uid), ts: this.now(), payload: r.payload };
      this.dedupe.add(env.id); this._dispatch(env, false);
    }, 1200);
    if (t && t.unref) t.unref(); this._demoTimers.add(t);
  }

  /** 打卡 / 浇水等轻量同步事件（spec: farm.event） */
  farmEvent(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false };
    if (!this.paired) return { ok: true, localOnly: true };
    this._send('farm.event', payload);
    return { ok: true };
  }

  /** 互动：本地动画立刻播（调用方负责），联机消息受 10 秒限流；超限只本地播放 */
  interact(action, { combo = false } = {}) {
    if (!P.ACTIONS.includes(action)) return { ok: false, code: 'BAD_ACTION', message: '未知互动' };
    if (!this.paired) return { ok: true, localOnly: true, reason: 'unpaired' };
    const rl = this.limiter.take(action);
    if (!rl.ok) return { ok: true, localOnly: true, reason: 'cooldown', retryInMs: rl.retryInMs };
    const env = this._send('interact', { action, combo: !!combo });
    return { ok: true, id: env.id, partnerOnline: this.mode === 'demo' || this.partnerOnline, queued: this.queue.pending };
  }
  note(text, lang = 'zh-CN') {
    if (!this.paired) return { ok: false, code: 'UNPAIRED', message: '还没有配对' };
    try { const env = this._send('note', { text: String(text || '').trim(), tts: true, lang }); const m = { id: env.id, mine: true, type: 'note', text: env.payload.text, ts: env.ts, status: this.mode === 'demo' ? 'delivered' : 'sending' }; this._msgAdd(m); this._msgChanged(); this._archive(m); return { ok: true, id: env.id }; } catch (err) { return { ok: false, code: 'BAD_MESSAGE', message: err.message }; }
  }
  /** 语音留言：音频先由 backend.createVoiceUpload 上传到 Storage，这里只传路径（spec §7） */
  voice({ path: p, durationMs }) {
    if (!this.paired) return { ok: false, code: 'UNPAIRED', message: '还没有配对' };
    try { const env = this._send('voice', { path: p, durationMs: Math.round(durationMs) }); const m = { id: env.id, mine: true, type: 'voice', path: p, durationMs: env.payload.durationMs, ts: env.ts, status: 'sending' }; this._msgAdd(m); this._msgChanged(); this._archive(m); return { ok: true, id: env.id }; } catch (err) { return { ok: false, code: 'BAD_MESSAGE', message: err.message }; }
  }
  /** 语音能力：live+storage=云端；demo=仅本地试听；live 无 storage=不可用（降级为文字传话） */
  voiceMode() { return this.mode === 'demo' ? 'local' : this.storage ? 'cloud' : 'off'; }

  /** 录好的语音：上传到 Storage 后发 voice 通知（spec §7 路径 couples/{id}/voice/{msgId}.opus） */
  async sendVoice({ data, durationMs, mime } = {}) {
    if (!this.paired) return { ok: false, code: 'UNPAIRED', message: '还没有配对' };
    const buf = data ? Buffer.from(data) : null;
    const ms = Math.round(Number(durationMs) || 0);
    if (!buf || !buf.length) return { ok: false, code: 'EMPTY', message: '录音为空' };
    if (ms <= 0 || ms > P.VOICE_MAX_MS) return { ok: false, code: 'TOO_LONG', message: '语音须在 60 秒内' };
    const mode = this.voiceMode();
    if (mode === 'local') return { ok: true, localOnly: true, demo: true, message: '演示模式：语音只在本地播放' };
    if (mode === 'off') return { ok: false, code: 'VOICE_UNAVAILABLE', message: '未配置语音存储，先用文字传话吧' };
    const msgId = P.ulid(this.now());
    const objectPath = `couples/${this.state.coupleId}/voice/${msgId}.opus`;
    try {
      await this.storage.upload(objectPath, buf, mime || 'audio/webm');
    } catch (err) { return this._fail(err); }
    const r = this.voice({ path: objectPath, durationMs: ms });
    return r.ok ? { ...r, path: objectPath } : r;
  }
  /** 收到的语音：按路径下载（只允许本情侣目录） */
  async fetchVoice(objectPath) {
    const prefix = `couples/${this.state.coupleId}/voice/`;
    if (!this.storage) return { ok: false, code: 'VOICE_UNAVAILABLE', message: '未配置语音存储' };
    if (!this.state.coupleId || typeof objectPath !== 'string' || !objectPath.startsWith(prefix) || objectPath.includes('..')) return { ok: false, code: 'BAD_PATH', message: '语音路径非法' };
    try { const r = await this.storage.download(objectPath); return { ok: true, ...r }; } catch (err) { return this._fail(err); }
  }

  startFocus(durationSec = P.FOCUS_DEFAULT_SEC) {
    if (!this.paired) return { ok: false, code: 'UNPAIRED', message: '还没有配对' };
    const startAt = this.now(); const sessionId = P.ulid(startAt);
    this.focus = { sessionId, duration: durationSec, startAt, endsAt: startAt + durationSec * 1000, me: 'running', partner: 'invited' };
    this._send('focus.start', { sessionId, duration: durationSec, startAt });
    this._changed();
    return { ok: true, focus: this.focus };
  }
  joinFocus() { if (!this.focus) return { ok: false }; this.focus.me = 'running'; this._send('focus.join', { sessionId: this.focus.sessionId }); this._changed(); return { ok: true, focus: this.focus }; }
  endFocus(result = 'done') {
    if (!this.focus) return { ok: false, code: 'NO_FOCUS' };
    this._send('focus.end', { sessionId: this.focus.sessionId, result });
    const f = { ...this.focus, me: result }; this.state.lastFocus = f; this.focus = null; this._save(); this._changed();
    return { ok: true, focus: f };
  }
  /** 设置自己的 presence 状态（idle/focus/mood/skin） */
  async setPresence(state) {
    if (this.mode !== 'live' || this.connection !== 'online') return { ok: false };
    try { await this.adapter.setState(P.channels.rt(this.state.coupleId), state); return { ok: true }; } catch { return { ok: false }; }
  }

  dispose() {
    for (const t of [this._tokenTimer, this._reconnectTimer, this._pairTimer, ...this._demoTimers]) if (t) this.timers.clearTimeout(t);
    if (this._msgTimer) clearInterval(this._msgTimer);
    this.queue.dispose(); this.presence.dispose(); this._save();
    if (this.adapter) this.adapter.disconnect().catch(() => {});
  }
}

/**
 * 工厂：读 config（<userData>/couple-config.json 或环境变量），缺配置/缺 SDK → 演示模式。
 */
const DEFAULT_API_BASE = 'https://pingguye.cn/cubbit/api';
// 内置默认 PubNub 客户端密钥：客户端密钥本就设计为公开（鉴权靠服务端签发的 token），
// 内置后即使没有 <userData>/couple-config.json，也能直接连上联机服务完成配对（内测免手工配置）。
// 环境变量 / couple-config.json 仍然优先，便于换成自己的 PubNub 应用。
const DEFAULT_PUBLISH_KEY = 'pub-c-fe2477fe-a4af-414f-a12b-7631092e3e58';
const DEFAULT_SUBSCRIBE_KEY = 'sub-c-fbdaf461-73d6-4173-a99a-5c9586cd8109';
function loadCoupleConfig({ userDataDir, env = process.env } = {}) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(userDataDir || '.', 'couple-config.json'), 'utf8')); } catch { /* none */ }
  const fb = file.firebase || {}; const pn = file.pubnub || {};
  // backend: 'selfhost'（默认，腾讯云 pingguye.cn）| 'firebase'
  const backend = (env.CUBBIT_BACKEND || file.backend || 'selfhost') === 'firebase' ? 'firebase' : 'selfhost';
  const apiBase = env.CUBBIT_API_BASE || file.apiBase || DEFAULT_API_BASE;
  const fnBase = env.CUBBIT_FUNCTIONS_BASE || file.functionsBase || file.functionsBaseUrl || '';
  return {
    backend, apiBase: backend === 'selfhost' ? apiBase : '',
    functionsBase: backend === 'selfhost' ? apiBase : fnBase,
    publishKey: env.CUBBIT_PUBNUB_PUBLISH_KEY || file.publishKey || pn.publishKey || DEFAULT_PUBLISH_KEY,
    subscribeKey: env.CUBBIT_PUBNUB_SUBSCRIBE_KEY || file.subscribeKey || pn.subscribeKey || DEFAULT_SUBSCRIBE_KEY,
    firebaseApiKey: env.CUBBIT_FIREBASE_API_KEY || file.firebaseApiKey || fb.apiKey || '',
    storageBucket: env.CUBBIT_FIREBASE_STORAGE_BUCKET || file.storageBucket || fb.storageBucket || '',
    googleClientId: backend === 'firebase' ? (env.CUBBIT_GOOGLE_CLIENT_ID || file.googleClientId || '') : '',
    googleClientSecret: backend === 'firebase' ? (env.CUBBIT_GOOGLE_CLIENT_SECRET || file.googleClientSecret || '') : '',
  };
}
/** 联网诊断日志：<userData>/couple-net.log，只记方法/路径/状态/耗时，不记请求体与令牌。 */
function netLogger(userDataDir) {
  if (!userDataDir) return () => {};
  const file = path.join(userDataDir, 'couple-net.log');
  return (line) => {
    try {
      try { if (fs.statSync(file).size > 256 * 1024) fs.renameSync(file, file + '.1'); } catch { /* none */ }
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch { /* ignore */ }
  };
}
function loggingFetch(base, log) {
  if (typeof base !== 'function') return base;
  return async (url, opts = {}) => {
    const t0 = Date.now(); let u = String(url); try { const x = new URL(u); u = x.origin + x.pathname; } catch { /* keep */ }
    try { const r = await base(url, opts); log(`${(opts.method || 'GET').toUpperCase()} ${u} -> ${r.status} ${Date.now() - t0}ms`); return r; }
    catch (e) { log(`${(opts.method || 'GET').toUpperCase()} ${u} -> ERR ${e && e.message} ${Date.now() - t0}ms`); throw e; }
  };
}

function createCoupleService({ userDataDir, config, requireFn, fetchImpl } = {}) {
  const cfg = config || loadCoupleConfig({ userDataDir });
  const nlog = config ? () => {} : netLogger(userDataDir);
  if (!fetchImpl && !config && typeof globalThis.fetch === 'function') fetchImpl = loggingFetch(globalThis.fetch.bind(globalThis), nlog);
  nlog(`init backend=${cfg.backend || '?'} apiBase=${cfg.apiBase || '-'} pubnub=${cfg.subscribeKey ? 'on' : 'off'}`);
  const selfhost = (cfg.backend || (cfg.apiBase ? 'selfhost' : 'firebase')) === 'selfhost';
  if (selfhost && cfg.apiBase && !cfg.functionsBase) cfg.functionsBase = cfg.apiBase;
  let adapter = null; let backend = null; let auth = null; let storage = null;
  if (isLiveConfig(cfg)) {
    const { PubNubAdapter } = require('./adapters');
    const { BackendClient } = require('./backend');
    adapter = PubNubAdapter.create(cfg, requireFn);
    const authFile = path.join(userDataDir || '.', 'couple-auth.json');
    const want = selfhost ? 'selfhost' : 'firebase';
    // 切换后端时旧凭据作废（uid 体系不同）
    const load = () => { try { const s = JSON.parse(fs.readFileSync(authFile, 'utf8')); return (s.backend || 'firebase') === want ? s : null; } catch { return null; } };
    const save = (s) => { try { fs.writeFileSync(authFile, JSON.stringify({ ...s, backend: want })); } catch { /* ignore */ } };
    if (selfhost) {
      const { SelfhostAuthClient } = require('./selfhost');
      auth = new SelfhostAuthClient({ apiBase: cfg.apiBase || cfg.functionsBase, fetchImpl, load, save });
    } else if (cfg.firebaseApiKey) {
      const { FirebaseAuthClient } = require('./auth');
      auth = new FirebaseAuthClient({ apiKey: cfg.firebaseApiKey, fetchImpl, load, save });
    }
    backend = new BackendClient({ functionsBase: cfg.functionsBase, getIdToken: auth ? () => auth.getIdToken() : null, fetchImpl });
  }
  if (adapter && auth) {
    if (selfhost) storage = require('./selfhost').SelfhostVoiceStorage.create({ apiBase: cfg.apiBase || cfg.functionsBase, getIdToken: () => auth.getIdToken(), fetchImpl });
    else storage = require('./voice-storage').VoiceStorage.create({ bucket: cfg.storageBucket, getIdToken: () => auth.getIdToken(), fetchImpl });
  }
  const svc = new CoupleService({ dir: userDataDir, config: cfg, adapter: adapter && backend ? adapter : null, backend: adapter ? backend : null, auth, storage });
  if (auth && auth.uid && !svc.state.uid) svc.state.uid = auth.uid;
  return svc;
}

module.exports = { CoupleService, createCoupleService, loadCoupleConfig, isLiveConfig };
