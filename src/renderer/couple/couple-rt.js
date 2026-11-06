/* ============================================================================
 * 实时情侣联机（PubNub 实时层 + 自托管服务器）：配对（邀请码/链接）、7 种互动、
 * 悄悄话（文字传话 + 语音留言，同一条时间线，持久化 + 已送达/已读/已听回执）、一起专注、打卡浇水。
 * 无联机配置时显示「演示模式 · 阿橘」。所有调用走 preload 白名单 couple-rt:*。
 * v2.3：联机模式下隐藏旧版社交服务的配对卡片与「情侣服务暂不可用」提示条。
 * ========================================================================== */
(function () {
  'use strict';
  /** 邀请码有效期文案：按服务器返回的 expiresAt 计算，不写死时长 */
  function validFor(expiresAt, now = Date.now()) {
    const m = Math.max(0, Math.round((expiresAt - now) / 60000));
    return m >= 120 ? `${Math.round(m / 60)} 小时内有效` : m >= 1 ? `${m} 分钟内有效` : '即将过期';
  }
  const api = window.cubbit && window.cubbit.panel;
  if (!api) return;
  const ACTIONS = [
    ['poke', '戳', '👉'], ['heart', '比心', '💗'], ['hug', '抱抱', '🤗'], ['kiss', '亲亲', '😘'],
    ['highfive', '击掌', '🙌'], ['holdhands', '牵手', '🤝'], ['goodnight', '晚安', '🌙'],
  ];
  const host = document.getElementById('coupleRt');
  if (!host) return;
  let st = null; let focusTimer = null; let pairError = ''; let celebrate = false;
  let msgs = { list: [], unread: 0 }; let rec = null; let playing = null;
  const tr = (s) => (window.CubbitI18N && window.CubbitI18N.t ? window.CubbitI18N.t(s) : s);
  // 二维码 / 邀请信息（pair-qr.js 提供；缺失时降级为不显示）
  const PQ = window.CubbitPairQR || {};
  let lastToast = { m: '', t: 0 };
  const toast = (m, kind) => {
    if (!m) return null;
    const now = Date.now(); if (m === lastToast.m && now - lastToast.t < 2500) return null; // 同一句 2.5 秒内只弹一次
    lastToast = { m, t: now };
    return window.CubbitUI && window.CubbitUI.toast ? window.CubbitUI.toast(tr(m), kind || 'ok', 2600) : null;
  };
  const h = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') Object.entries(v).forEach(([e, f]) => n.addEventListener(e, f)); else if (v != null) n.setAttribute(k, v); }
    kids.flat().forEach((c) => n.append(c && c.nodeType ? c : document.createTextNode(String(c ?? ''))));
    return n;
  };
  const call = (ch, p) => api.invoke(ch, p).catch((e) => ({ ok: false, message: e.message }));
  const partnerName = () => (st && st.partner && st.partner.name) || 'TA';

  function connLabel(s) {
    if (s.mode === 'demo') return '演示模式 · 正在和阿橘体验（配置联机服务后可与真实伴侣配对）';
    if (!s.paired) return '尚未配对';
    if (s.connection !== 'online') return `离线中，${s.pending ? s.pending + ' 条待发送，' : ''}正在重连…`;
    return s.partner.online ? `${s.partner.name} 在线` : `${s.partner.name} 不在线，TA 上线后会看到`;
  }
  /** 打卡/浇水状态：说人话 */
  function todayText(t) {
    if (t.me && t.partner) return '· 你们都完成了';
    if (t.me) return '· 你已完成，等 TA';
    if (t.partner) return '· TA 已完成，就差你';
    return '';
  }

  async function onUnpair() {
    if (!window.confirm('解除配对后需要重新配对，确定吗？')) return;
    const r = await call('couple-rt:unpair');
    if (r && r.ok) { toast('已解除配对，可以重新配对了'); refresh(); }
    else toast((r && r.message) || '解除失败，请重试', 'err');
  }

  // ---------------------------------------------------------------- 主体
  function render() {
    document.body.classList.toggle('rt-live', !!(st && st.mode === 'live'));
    host.textContent = '';
    if (!st) return;
    const head = h('div', { class: 'crt-head' },
      h('span', { class: 'dot ' + (st.mode === 'demo' || (st.connection === 'online' && st.partner.online) ? 'dot--ok' : 'dot--warn') }),
      h('span', { class: 'crt-status' }, connLabel(st)),
      st.paired ? h('button', { class: 'btn btn--ghost btn--sm', style: 'margin-left:auto', title: '解除配对后可重新配对', on: { click: onUnpair } }, '解除配对') : null);
    host.append(head);
    if (st.account && st.account.email && !st.account.anonymous) host.append(h('div', { class: 'crt-status crt-account' }, `账号：${st.account.email}`));
    if (celebrate && st.paired) {
      host.append(h('div', { class: 'crt-celebrate' }, h('span', { class: 'crt-celebrate__emoji' }, '🎉'),
        h('div', {}, h('b', {}, '配对成功！'), h('div', { class: 'crt-status' }, `${partnerName()} 已经和你连上了，先戳 TA 一下、或者说句悄悄话吧`)),
        h('button', { class: 'btn btn--ghost btn--sm', on: { click: () => { celebrate = false; render(); } } }, '知道啦')));
    }

    if (st.mode === 'live' && !st.paired && st.account && st.account.needsUpgrade) return renderUpgrade();
    if (st.mode === 'live' && !st.paired) return renderPair();

    const bar = h('div', { class: 'crt-actions' });
    for (const [id, label, emoji] of ACTIONS) {
      const cd = (st.cooldown && st.cooldown[id]) || 0;
      bar.append(h('button', { class: 'btn crt-act' + (cd > 0 ? ' is-cooling' : ''), title: cd > 0 ? `${Math.ceil(cd / 1000)} 秒后可再次发给 TA（本地仍会播放）` : label,
        on: { click: async () => { const r = await call('couple-rt:interact', { action: id }); actFeedback(r, label, emoji); refresh(); } } }, `${emoji} ${label}`));
    }
    host.append(bar);

    const f = st.focus;
    const R = st.retention;
    host.append(h('div', { class: 'crt-row crt-streak' },
      R ? h('button', { class: 'btn', on: { click: async () => { await call('couple-rt:checkin', { kind: 'checkin' }); refresh(); } } }, `📅 今日打卡 ${todayText(R.checkin.today)}`) : null,
      R ? h('span', { class: 'crt-status' }, `🔥 连续 ${R.checkin.streak} 天`) : null,
      R ? h('button', { class: 'btn', on: { click: async () => { await call('couple-rt:checkin', { kind: 'water' }); refresh(); } } }, `💧 一起浇水 ${todayText(R.water.today)}`) : null,
      R ? h('span', { class: 'crt-status' }, `🌱 连续 ${R.water.streak} 天`) : null,
      f ? h('button', { class: 'btn btn--ghost', on: { click: () => call('couple-rt:focus', { op: 'end', result: 'abort' }) } }, `专注中 ${fmtLeft(f.endsAt)} · 结束`)
        : h('button', { class: 'btn btn--primary', on: { click: () => call('couple-rt:focus', { op: 'start' }) } }, '🍅 一起专注 25 分钟')));
    if (R && R.next) host.append(h('div', { class: 'crt-status crt-next' }, `再 ${R.next.left} 天解锁皮肤「${R.next.title}」`));
    host.append(chat.root);
    renderComposer(); renderMessages();
    clearInterval(focusTimer);
    if (f) focusTimer = setInterval(() => { if (Date.now() >= f.endsAt) { clearInterval(focusTimer); call('couple-rt:focus', { op: 'end', result: 'done' }); } else render(); }, 1000);
  }
  function actFeedback(r, label, emoji) {
    if (!r || !r.ok) return toast((r && r.message) || '没发出去，稍后再试', 'err');
    if (r.localOnly && r.reason === 'cooldown') return toast(`${Math.ceil((r.retryInMs || 0) / 1000)} 秒后才能再发给 TA（这次只在本地播放）`, 'info');
    if (r.localOnly) return toast('还没配对，只在本地播放', 'info');
    toast(r.partnerOnline ? `${emoji} 已发给 TA：${label}` : `${emoji} 已发出，TA 上线就能看到`);
  }

  function renderUpgrade() {
    // 匿名账号：配对前引导升级（保留 uid 与本地数据）
    const email = h('input', { class: 'input', type: 'email', placeholder: '邮箱', autocomplete: 'email' });
    const byCode = st.account.emailMode === 'code';
    const pw = byCode
      ? h('input', { class: 'input', inputmode: 'numeric', maxlength: '6', placeholder: '6 位验证码', autocomplete: 'one-time-code' })
      : h('input', { class: 'input', type: 'password', placeholder: '设置密码（至少 6 位）', autocomplete: 'new-password' });
    let sending = false;
    const sendBtn = byCode ? h('button', { class: 'btn', on: { click: async () => {
      if (sending) return; sending = true; sendBtn.disabled = true;
      const r = await call('couple-rt:account', { op: 'emailCode', email: email.value });
      if (!r.ok) { sending = false; sendBtn.disabled = false; return toast(r.message, 'err'); }
      const min = Math.max(1, Math.round((r.ttlSec || 600) / 60));
      toast(`验证码已发到邮箱，${min} 分钟内有效`); let n = 60;
      const tick = setInterval(() => { n -= 1; sendBtn.textContent = tr(n > 0 ? `${n} 秒后重发` : '发送验证码'); if (n <= 0) { clearInterval(tick); sendBtn.disabled = false; sending = false; } }, 1000);
    } } }, '发送验证码') : null;
    const code = h('input', { class: 'input', placeholder: '已有 TA 的邀请码？先填这里，升级后自动配对', maxlength: '80' });
    const err = h('div', { class: 'crt-error' + (pairError ? '' : ' hidden') }, pairError);
    const done = (r) => {
      if (r.ok && r.pairResult && !r.pairResult.ok) { pairError = r.pairResult.message; toast(`升级成功，但配对没成功：${tr(r.pairResult.message)}`, 'err'); }
      else if (r.ok) { pairError = ''; toast(r.paired ? '升级成功，已和 TA 配对！' : '升级成功，现在可以配对了'); }
      else { pairError = r.message; toast(r.message, 'err'); }
      refresh();
    };
    const stash = async () => { if (code.value.trim()) await call('couple-rt:accept', { code: code.value }); };
    host.append(h('div', { class: 'crt-upgrade' },
      h('p', { class: 'crt-status' }, '配对前需要先升级为正式账号，你现在的数据都会保留。'),
      code,
      h('div', { class: 'crt-row' }, email, sendBtn, pw,
        h('button', { class: 'btn btn--primary', on: { click: async () => { await stash(); done(await call('couple-rt:account', { op: 'email', email: email.value, password: pw.value })); } } }, '用邮箱升级')),
      err,
      st.account.google ? h('button', { class: 'btn', on: { click: async () => { await stash(); toast('已在浏览器打开 Google 登录'); done(await call('couple-rt:account', { op: 'google' })); } } }, '用 Google 账号升级') : null));
  }

  function renderPair() {
    const inv = st.invite;
    const input = h('input', { class: 'input', placeholder: '输入 TA 的 6 位邀请码或粘贴链接', maxlength: '80' });
    const err = h('div', { class: 'crt-error' + (pairError ? '' : ' hidden') }, pairError);
    const join = h('button', { class: 'btn btn--primary', on: { click: async () => {
      join.disabled = true; join.textContent = tr('配对中…');
      const r = await call('couple-rt:accept', { code: input.value });
      join.disabled = false; join.textContent = tr('加入');
      if (r.ok) { pairError = ''; celebrate = true; toast('配对成功！'); refresh(); } else { pairError = r.message || '配对失败，请重试'; err.textContent = tr(pairError); err.classList.remove('hidden'); toast(pairError, 'err'); }
    } } }, '加入');
    host.append(h('div', { class: 'crt-pair-grid' },
      h('div', { class: 'crt-pair-card' },
        h('div', { class: 'crt-pair-title' }, '① 我来邀请 TA'),
        inv ? h('div', { class: 'crt-code' }, h('b', {}, inv.code),
          h('button', { class: 'btn btn--ghost btn--sm', on: { click: () => { navigator.clipboard.writeText(inv.code); toast('邀请码已复制，发给 TA 吧'); } } }, '复制'))
          : h('button', { class: 'btn btn--primary', on: { click: async () => { const r = await call('couple-rt:invite'); if (!r.ok) toast(r.message, 'err'); } } }, '生成邀请码'),
        inv ? h('div', { class: 'crt-status' }, `${validFor(inv.expiresAt)}，只能用一次 · TA 加入后这里会自动提醒你`) : h('div', { class: 'crt-status' }, '把 6 位邀请码发给 TA，TA 在自己电脑上输入即可'),
        inv && PQ.svg ? h('div', { class: 'crt-invite-extra' },
          PQ.svg('cubbit://pair?code=' + inv.code),
          h('div', { class: 'crt-invite-actions' },
            h('button', { class: 'btn btn--primary btn--sm', on: { click: async () => {
              const txt = PQ.message ? PQ.message(inv.code) : inv.code;
              try { await navigator.clipboard.writeText(txt); toast('整段邀请信息已复制，直接发给 TA'); } catch { toast('复制失败，请手动复制邀请码', 'err'); }
            } } }, '复制邀请信息'),
            h('button', { class: 'btn btn--ghost btn--sm', on: { click: async () => {
              try { await navigator.clipboard.writeText(PQ.link ? PQ.link(inv.code) : inv.code); toast('邀请链接已复制，TA 点开会自动填码'); } catch { toast('复制失败', 'err'); }
            } } }, '复制邀请链接')),
          h('div', { class: 'crt-status' }, '也可以让 TA 扫码；链接里有下载按钮')) : null),
      h('div', { class: 'crt-pair-card' },
        h('div', { class: 'crt-pair-title' }, '② TA 邀请了我'),
        h('div', { class: 'crt-row' }, input, join),
        err)));
    if (inv) host.append(h('div', { class: 'crt-waiting' }, h('span', { class: 'crt-spinner' }), '等待 TA 输入邀请码…'));
  }

  // ---------------------------------------------------------------- 悄悄话
  const chat = (() => {
    const root = h('section', { class: 'crt-chat', 'aria-label': '悄悄话' });
    const headEl = h('div', { class: 'crt-chat__head' });
    const list = h('div', { class: 'crt-chat__list scroll' });
    const composer = h('div', { class: 'crt-chat__composer' });
    const input = h('input', { class: 'input', placeholder: '说句悄悄话，TA 的方块仔会替你念出来（≤200 字）', maxlength: '200' });
    root.append(headEl, list, composer);
    return { root, headEl, list, composer, input };
  })();
  chat.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendNote(); });
  async function sendNote() {
    const text = chat.input.value.trim(); if (!text) return;
    const r = await call('couple-rt:note', { text });
    if (r.ok) { chat.input.value = ''; loadMessages(); } else toast(r.message, 'err');
  }
  function renderComposer() {
    const c = chat.composer; c.textContent = '';
    c.append(chat.input, h('button', { class: 'btn btn--primary', on: { click: sendNote } }, '传话'));
    if (st && st.voice !== 'off') {
      c.append(h('button', { class: 'btn' + (rec ? ' btn--danger crt-rec' : ''), title: '最长 60 秒', on: { click: () => (rec ? stopRec() : startRec()) } },
        rec ? `⏹ 停止并发送 ${Math.round((Date.now() - rec.t0) / 1000)}s` : '🎙️ 语音'));
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  function timeLabel(ts) {
    const d = new Date(ts); const now = new Date();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return hm;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  function statusText(m) {
    if (m.status === 'read') return m.type === 'voice' ? '已听' : '已读';
    if (m.status === 'delivered') return '已送达';
    return '发送中…';
  }
  function renderMessages() {
    const { list, headEl } = chat;
    headEl.textContent = '';
    headEl.append(h('b', {}, '💌 悄悄话'), msgs.unread ? h('span', { class: 'crt-badge' }, `${msgs.unread} 条未读`) : h('span', { class: 'crt-status' }, '文字和语音都会保存在这里'));
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.textContent = '';
    if (!msgs.list.length) list.append(h('div', { class: 'crt-chat__empty' }, `还没有悄悄话。说一句，${partnerName()} 的方块仔会替你念给 TA 听`));
    for (const m of msgs.list) {
      const bubble = h('div', { class: 'crt-msg__bubble' });
      if (m.type === 'voice') {
        const isPlaying = playing === m.id;
        bubble.append(h('button', { class: 'crt-voice' + (isPlaying ? ' is-playing' : ''), on: { click: () => playVoice(m) } },
          h('span', { class: 'crt-voice__icon' }, isPlaying ? '⏸' : '▶'),
          h('span', { class: 'crt-voice__wave' }, ...Array.from({ length: Math.min(14, 4 + Math.round(m.durationMs / 3000)) }, () => h('i'))),
          h('span', { class: 'crt-voice__dur' }, `${Math.max(1, Math.round(m.durationMs / 1000))}″`)));
      } else bubble.append(h('span', { class: 'crt-msg__text' }, m.text));
      const meta = h('div', { class: 'crt-msg__meta' }, timeLabel(m.ts), m.mine ? h('span', { class: 'crt-msg__st crt-st--' + (m.status || 'sending') }, statusText(m)) : null);
      list.append(h('div', { class: 'crt-msg ' + (m.mine ? 'crt-msg--mine' : 'crt-msg--ta') + (!m.mine && m.unread ? ' is-unread' : ''), 'data-id': m.id },
        h('div', { class: 'crt-msg__col' }, bubble, meta),
        !m.mine && m.unread && m.type === 'voice' ? h('span', { class: 'crt-dot', title: '未听' }) : null));
    }
    if (atBottom || renderMessages.first !== false) { list.scrollTop = list.scrollHeight; renderMessages.first = false; }
  }
  async function loadMessages(op = 'list') {
    const r = await call('couple-rt:messages', { op });
    if (r && Array.isArray(r.list)) { msgs = r; if (host.contains(chat.root)) renderMessages(); markSeen(); }
  }
  /** 面板可见时，文字消息即视为已读（语音要点播放才算已听） */
  function markSeen() {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    if (msgs.list.some((m) => !m.mine && m.unread && m.type === 'note')) call('couple-rt:messages', { op: 'read' }).then(() => loadMessages());
  }
  window.addEventListener('focus', markSeen);
  document.addEventListener('visibilitychange', markSeen);

  let audio = null;
  async function playVoice(m) {
    if (audio) { audio.pause(); audio = null; if (playing === m.id) { playing = null; renderMessages(); return; } }
    playing = m.id; renderMessages();
    const r = await call('couple-rt:voice', { op: 'fetch', path: m.path });
    if (!r.ok) { playing = null; renderMessages(); toast(r.message || '语音已过期', 'err'); return; }
    const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    audio = new Audio(URL.createObjectURL(new Blob([bin], { type: r.contentType || 'audio/webm' })));
    audio.onended = () => { playing = null; audio = null; renderMessages(); };
    audio.play().catch(() => { playing = null; toast('播放失败', 'err'); renderMessages(); });
    if (!m.mine && m.unread) call('couple-rt:messages', { op: 'read', ids: [m.id] }).then(() => loadMessages());
  }
  const fmtLeft = (end) => { const s = Math.max(0, Math.round((end - Date.now()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // ---- 语音留言：MediaRecorder 录 Opus/WebM（≤60s）→ 主进程上传 → 发 voice 通知 ----
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      const chunks = [];
      rec = { mr, stream, chunks, mime, t0: Date.now(), tick: setInterval(renderComposer, 1000), cap: setTimeout(stopRec, 60000) };
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.start(1000); renderComposer();
    } catch (err) { rec = null; toast('无法使用麦克风：' + (err && err.message), 'err'); }
  }
  function stopRec() {
    if (!rec) return;
    const r = rec; rec = null; clearInterval(r.tick); clearTimeout(r.cap);
    r.mr.onstop = async () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const durationMs = Math.min(60000, Date.now() - r.t0);
      if (durationMs < 800) { toast('录音太短', 'err'); renderComposer(); return; }
      const blob = new Blob(r.chunks, { type: r.mime });
      const data = new Uint8Array(await blob.arrayBuffer());
      const res = await call('couple-rt:voice', { op: 'send', data, durationMs, mime: r.mime });
      if (res.ok && res.localOnly) new Audio(URL.createObjectURL(blob)).play().catch(() => {});
      if (!res.ok) toast(res.message, 'err'); else if (res.localOnly) toast('演示模式：语音只在本地播放');
      renderComposer(); loadMessages();
    };
    r.mr.stop(); renderComposer();
  }

  async function refresh() { const r = await call('couple-rt:status'); if (r && r.mode) { st = r; render(); } }
  if (api.onCoupleRt) api.onCoupleRt((e) => {
    if (!e) return;
    if (e.type === 'status') {
      // 状态变化只在关键字段变了时重绘，避免打断输入/滚动
      const p = e.payload; const key = (s) => s && JSON.stringify([s.paired, s.connection, s.partner && s.partner.online, s.partner && s.partner.name, s.invite, s.focus, s.account, s.mode, s.voice]);
      const changed = key(st) !== key(p);
      st = { ...p, retention: p.retention || (st && st.retention) };
      if (changed) render();
    }
    if (e.type === 'paired') { celebrate = true; pairError = ''; toast(`${(e.payload && e.payload.partner && e.payload.partner.name) || 'TA'} 加入啦，配对成功 🎉`); refresh(); loadMessages('sync'); }
    if (e.type === 'catchup') toast('补收到你离线时的消息');
    if (e.type === 'farm') refresh(); // TA 打卡/浇水后连续天数立即更新
    if (e.type === 'messages' || e.type === 'receipt') loadMessages();
  });
  refresh().then(() => loadMessages('sync'));
})();
