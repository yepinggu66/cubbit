/* ============================================================================
 * 方块仔 v2.5 付费扩展设置：办公助手 / 会员与商店 / 角色定制 / 情侣进阶
 * 统一通过 paid:call 与主进程通信；门槛由主进程判断，这里只负责展示。
 * ========================================================================== */
(function () {
  'use strict';
  const UI = window.CubbitUI;
  const api = window.cubbit && window.cubbit.panel;
  if (!UI || !api) return;
  const el = UI.el;
  const toast = UI.toast;
  const I18N = window.CubbitI18N;
  const R = {};
  const call = (area, action, args) => api.invoke('paid:call', { area, action, args: args || {} }).catch((e) => ({ ok: false, message: e && e.message }));
  const tr = () => { if (I18N) I18N.translateDom(document.body); };
  const lang = () => { try { return (window.CubbitUI && CubbitUI.priceLocale) ? CubbitUI.priceLocale() : (localStorage.getItem('cubbit.lang') || 'zh-CN'); } catch { return 'zh-CN'; } };
  const fmtTime = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  function card(title, desc, ...children) {
    return el('div', { class: 'card plus-card' },
      el('div', { class: 'card__head' }, el('div', {}, el('div', { class: 'card__title' }, el('span', { text: title })), desc ? el('div', { class: 'card__desc', text: desc }) : null)),
      ...children);
  }
  function btn(text, onClick, cls) {
    const b = el('button', { class: 'btn btn--sm ' + (cls || ''), type: 'button' }, el('span', { text }));
    b.addEventListener('click', async () => { b.disabled = true; try { await onClick(b); } finally { b.disabled = false; } });
    return b;
  }
  function input(ph, type) { return el('input', { class: 'input', type: type || 'text', placeholder: ph || '' }); }
  function done(res, okMsg) {
    if (res && res.ok) { if (okMsg) toast(okMsg, 'ok'); return true; }
    if (res && res.code === 'FEATURE_LOCKED') toast((res.message || '需要升级') + ' →「会员与商店」', 'warn');
    else toast((res && res.message) || '操作失败', 'err');
    return false;
  }
  function lockNote(on, text) { return el('div', { class: 'paid-lock' + (on ? ' hidden' : '') }, el('span', { text: '🔒 ' + text })); }
  function readFile(accept) {
    return new Promise((resolve) => {
      const f = el('input', { type: 'file', accept });
      f.addEventListener('change', () => { const file = f.files && f.files[0]; if (!file) return resolve(null); const r = new FileReader(); r.onload = () => resolve({ dataUrl: r.result, name: file.name, text: null }); r.readAsDataURL(file); });
      f.click();
    });
  }
  function readText(accept) {
    return new Promise((resolve) => {
      const f = el('input', { type: 'file', accept });
      f.addEventListener('change', () => { const file = f.files && f.files[0]; if (!file) return resolve(null); file.text().then(resolve); });
      f.click();
    });
  }
  function head(sec, title, desc) {
    sec.appendChild(el('div', { class: 'sec-head' }, el('div', { class: 'sec-head__title', text: title }), el('div', { class: 'sec-head__desc', text: desc })));
  }

  // ================================================================ 办公助手
  function buildOffice() {
    const sec = document.getElementById('sec-office');
    if (!sec) return;
    head(sec, '办公助手', '会议提醒、剪贴板历史、番茄钟进阶、灵感速记（Ctrl+Alt+N）、晚间专注总结');
    R.offLock = lockNote(true, '会议提醒 / .ics 导入 / 自定义番茄 / 晚间总结 / 200 条剪贴板属于完整版（试用期可用）');
    sec.appendChild(R.offLock);
    { const nm = input('方块仔的名字'); nm.maxLength = 16; nm.dataset.noI18n = '1';
      Promise.resolve(api.state && api.state()).then((st) => { nm.value = (st && st.settings && st.settings.petName) || '方块仔'; }).catch(() => {});
      sec.appendChild(card('🏷️ 给方块仔起名字', '名字会用在气泡、语音和 AI 对话里', el('div', { class: 'plus-acts' }, nm, btn('保存', async () => {
        const n = (window.CubbitPetDom ? CubbitPetDom.cleanName(nm.value) : (nm.value.trim().slice(0, 16) || '方块仔')); nm.value = n;
        await api.invoke('app:settings:set', { petName: n }); toast('名字已保存', 'ok'); }, 'btn--primary')))); }

    // 日程
    const title = input('会议名称，如「周会」');
    const when = input('', 'datetime-local');
    const remind = el('select', { class: 'input paid-narrow' }, ...[5, 10, 15, 30].map((m) => el('option', { value: String(m), text: `提前 ${m} 分钟` })));
    remind.value = '10';
    R.events = el('div', { class: 'plus-list' });
    sec.appendChild(card('会议与日程提醒', '到点前方块仔会冒泡提醒；可导入 Outlook / Google / 飞书导出的 .ics 文件',
      el('div', { class: 'plus-acts' }, title, when, remind, btn('添加', async () => {
        const res = await call('office', 'addEvent', { title: title.value, start: when.value ? new Date(when.value).getTime() : NaN, remindMin: Number(remind.value) });
        if (done(res, '已添加提醒')) { title.value = ''; refreshOffice(); }
      }, 'btn--primary'), btn('导入 .ics', async () => {
        const text = await readText('.ics,text/calendar');
        if (!text) return;
        const res = await call('office', 'importIcs', { text, remindMin: Number(remind.value) });
        if (done(res, `导入 ${res && res.added} 个日程`)) refreshOffice();
      })), R.events));

    // 番茄钟进阶
    const nums = [['专注', 25], ['短休', 5], ['长休', 15], ['轮数', 4]].map(([l, v]) => { const i = input(l, 'number'); i.value = String(v); i.classList.add('paid-num'); return [l, i]; });
    const task = input('这一组在做什么（可选）');
    R.pomo = el('div', { class: 'plus-sub' });
    sec.appendChild(card('番茄钟进阶', '长短休息自动循环、按任务统计；标准 25/5 免费，自定义节奏需完整版',
      el('div', { class: 'plus-acts' }, ...nums.map(([l, i]) => el('label', { class: 'paid-field' }, el('span', { text: l }), i)), task),
      el('div', { class: 'plus-acts' }, btn('开始', async () => {
        const [w, s, l, r] = nums.map(([, i]) => Number(i.value));
        if (done(await call('office', 'pomoStart', { work: w, short: s, long: l, rounds: r, task: task.value }), '番茄钟开始')) refreshOffice();
      }, 'btn--primary'), btn('停止', async () => { await call('office', 'pomoStop'); refreshOffice(); })), R.pomo));

    // 剪贴板
    R.clipSw = el('button', { class: 'switch', type: 'button', role: 'switch' });
    R.clipSw.addEventListener('click', async () => { const on = !R.clipSw.classList.contains('is-on'); R.clipSw.classList.toggle('is-on', on); await call('office', 'clipboard', { on }); toast(on ? '剪贴板历史已开启（只存在本机）' : '已关闭', 'ok'); });
    R.clips = el('div', { class: 'plus-list paid-scroll' });
    R.clipCap = el('span', { class: 'plus-sub' });
    sec.appendChild(card('剪贴板历史', '复制过的文字自动记下，点一下重新复制。默认关闭，只保存在本机',
      el('div', { class: 'plus-acts' }, el('span', { text: '记录剪贴板' }), R.clipSw, R.clipCap, btn('清空', async () => { await call('office', 'clearClips'); refreshOffice(); })), R.clips));

    // 灵感速记
    const note = input('想到什么就记下来…（全局快捷键 Ctrl+Alt+N：把剪贴板文字存成灵感）');
    R.notes = el('div', { class: 'plus-list paid-scroll' });
    sec.appendChild(card('灵感速记', '', el('div', { class: 'plus-acts' }, note, btn('记下', async () => { if (done(await call('office', 'addNote', { text: note.value }), '记下了')) { note.value = ''; refreshOffice(); } }, 'btn--primary')), R.notes));

    // 每日总结
    R.summary = el('div', { class: 'plus-hint plus-sub' });
    R.week = el('div', { class: 'paid-week' });
    const hour = el('select', { class: 'input paid-narrow' }, ...[18, 19, 20, 21, 22, 23].map((h) => el('option', { value: String(h), text: `${h}:00` })));
    hour.addEventListener('change', () => call('office', 'summaryHour', { hour: Number(hour.value) }));
    R.sumHour = hour;
    sec.appendChild(card('晚间专注总结', '每天晚上方块仔会告诉你今天专注了多久、开了几个会',
      el('div', { class: 'plus-acts' }, el('span', { text: '提醒时间' }), hour, btn('现在看看', async () => { const r = await call('office', 'summary'); if (done(r)) R.summary.textContent = r.text; })), R.week, R.summary));
  }

  async function refreshOffice() {
    if (!R.events) return;
    const v = await call('office', 'view');
    if (!v || !v.ok) return;
    R.offLock.classList.toggle('hidden', !!v.pro);
    R.events.innerHTML = '';
    if (!v.events.length) R.events.appendChild(el('div', { class: 'plus-sub', text: '还没有日程' }));
    for (const e of v.events) R.events.appendChild(el('div', { class: 'plus-task' }, el('span', { class: 'plus-task__st', text: fmtTime(e.start) }), el('span', { class: 'plus-task__text', text: e.title + (e.location ? ' · ' + e.location : '') }), el('span', { class: 'plus-task__st', text: e.source === 'ics' ? '.ics' : '提前 ' + e.remindMin + ' 分' }), btn('删除', async () => { await call('office', 'removeEvent', { id: e.id }); refreshOffice(); })));
    R.pomo.textContent = v.pomo ? `${v.pomo.phase === 'work' ? '🍅 专注中' : '☕ 休息中'} · 第 ${v.pomo.round}/${v.pomo.rounds} 轮 · 剩 ${Math.floor(v.pomo.leftSec / 60)}:${String(v.pomo.leftSec % 60).padStart(2, '0')}${v.pomo.task ? ' · ' + v.pomo.task : ''}` : '未开始';
    R.clipSw.classList.toggle('is-on', !!v.clipboardOn);
    R.clipCap.textContent = `最多保存 ${v.clipCap} 条`;
    R.clips.innerHTML = '';
    for (const c of v.clips) R.clips.appendChild(el('div', { class: 'plus-task paid-click', dataset: { noI18n: '1' } }, el('span', { class: 'plus-task__text', text: c.text.replace(/\s+/g, ' ') }), el('span', { class: 'plus-task__st', text: fmtTime(c.at) })));
    [...R.clips.children].forEach((n, i) => n.addEventListener('click', async () => { if (done(await call('office', 'copyClip', { id: v.clips[i].id }))) toast('已复制', 'ok'); }));
    R.notes.innerHTML = '';
    for (const n of v.notes) R.notes.appendChild(el('div', { class: 'plus-task', dataset: { noI18n: '1' } }, el('span', { class: 'plus-task__st', text: '💡 ' + fmtTime(n.at) }), el('span', { class: 'plus-task__text', text: n.text }), btn('删除', async () => { await call('office', 'removeNote', { id: n.id }); refreshOffice(); })));
    R.sumHour.value = String(v.summaryHour);
    R.week.innerHTML = '';
    const max = Math.max(30, ...v.week.map((d) => d.minutes));
    for (const d of v.week) R.week.appendChild(el('div', { class: 'paid-week__col' }, el('div', { class: 'paid-week__bar', style: { height: Math.round((d.minutes / max) * 60) + 'px' } }), el('div', { class: 'paid-week__lbl', text: d.day.slice(5) + ' · ' + d.minutes + '′' })));
    tr();
  }

  // ================================================================ 会员与商店
  function buildMember() {
    const sec = document.getElementById('sec-member');
    if (!sec) return;
    head(sec, '会员与商店', '会员订阅、完整版、情侣年卡、角色定制与季节皮肤包');
    R.memberState = el('div', { class: 'plus-hero' });
    R.perks = el('div', { class: 'plus-list' });
    R.monthly = el('div', { class: 'plus-sub' });
    sec.appendChild(card('我的会员', '', R.memberState, R.perks, R.monthly,
      el('div', { class: 'plus-acts' }, btn('云同步', async () => { const r = await call('member', 'sync'); if (r && r.needsService) toast(r.message, 'warn'); else done(r); }))));
    R.plans = el('div', { class: 'paid-plans' });
    R.addons = el('div', { class: 'paid-plans' });
    sec.appendChild(card('订阅与买断', '在商店完成付款（当前为沙盒/本地许可服务器）', R.plans));
    sec.appendChild(card('单独购买', '', R.addons));
  }

  function planCard(p, owned) {
    const per = p.period === 'month' ? ' / 月' : p.period === 'year' ? ' / 年' : p.period === 'once' ? ' 买断' : '';
    return el('div', { class: 'paid-plan' + (owned ? ' is-owned' : '') },
      el('div', { class: 'paid-plan__name', text: p.name }),
      el('div', { class: 'paid-plan__price', dataset: { noI18n: '1' } }, el('span', { text: p.price }), el('small', { text: per })),
      el('div', { class: 'plus-sub', text: p.desc || '' }),
      el('ul', { class: 'paid-plan__perks' }, ...(p.perks || []).slice(0, 5).map((k) => el('li', { text: '✓ ' + k }))),
      owned ? el('div', { class: 'paid-plan__owned', text: '✅ 已拥有' }) : btn('去购买', () => api.openPanel('store'), 'btn--primary'));
  }

  async function refreshMember() {
    if (!R.plans) return;
    const [m, s] = await Promise.all([call('member', 'view'), call('store', 'view', { lang: lang() })]);
    if (m && m.ok) {
      R.memberState.innerHTML = '';
      R.memberState.appendChild(el('div', { class: 'plus-big', text: m.member ? '👑 会员生效中' : '还不是会员' }));
      R.perks.innerHTML = '';
      for (const p of m.perks) R.perks.appendChild(el('div', { class: 'plus-task' + (p.on ? ' is-both' : '') }, el('span', { class: 'plus-task__st', text: p.on ? '✅' : '🔒' }), el('span', { class: 'plus-task__text', text: p.name }), el('span', { class: 'plus-task__st', text: p.works ? '已可用' : '需服务器' })));
      const cur = m.monthly.find((x) => x.current) || m.monthly[0];
      R.monthly.textContent = cur ? `本月会员皮肤：「${cur.name}」（${cur.month}）${cur.unlocked ? '已解锁，可在「外观」里换上' : ''}` : '';
    }
    if (s && s.ok) {
      R.plans.innerHTML = '';
      const f = s.features;
      for (const p of s.plans) R.plans.appendChild(planCard(p, (p.id === 'ai_month' || p.id === 'ai_year') ? f.member_perks : p.id === 'couple_year' ? f.couple_premium : false));
      R.addons.innerHTML = '';
      for (const a of s.addons) R.addons.appendChild(planCard({ ...a, period: 'once' }, a.owned || (a.id === 'dlc_custom_char' && f.custom_character)));
    }
    tr();
  }

  // ================================================================ 角色定制（外观页）
  function buildCustom() {
    const sec = document.getElementById('sec-appearance');
    if (!sec) return;
    const desc = input('一句话描述，例如「粉色兔耳朵，拿着🍓」');
    R.cusLock = lockNote(true, '角色定制需单独购买（' + window.CubbitUI.formatMoney(2800) + '），在「会员与商店」购买');
    R.cusList = el('div', { class: 'paid-skins' });
    R.cusPick = el('div', { class: 'paid-skins' });
    R.voice = el('div', { class: 'plus-acts' });
    R.rec = el('span', { class: 'plus-sub' });
    let rec = null; let chunks = []; let t0 = 0;
    const recBtn = btn('🎙️ 录一段样本', async (b) => {
      if (rec) { rec.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = []; rec = new MediaRecorder(stream); t0 = Date.now();
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const fr = new FileReader();
          fr.onload = async () => { const r = await call('custom', 'sample', { dataUrl: fr.result, seconds: (Date.now() - t0) / 1000 }); if (done(r)) R.rec.textContent = `已保存 ${r.count} 段样本。${r.clone.note}`; };
          fr.readAsDataURL(blob); rec = null; b.querySelector('span').textContent = '🎙️ 录一段样本';
        };
        rec.start(); b.querySelector('span').textContent = '⏹ 停止录音';
        setTimeout(() => { if (rec) rec.stop(); }, 30000);
      } catch { toast('没有拿到麦克风权限', 'err'); }
    });
    const c = card('角色定制', '用你的照片或一句话，做一只专属方块仔；还能换成专属声音',
      R.cusLock,
      el('div', { class: 'plus-acts' }, btn('📷 从照片生成', async () => {
        const f = await readFile('image/png,image/jpeg,image/webp'); if (!f) return;
        const r = await call('custom', 'photo', { dataUrl: f.dataUrl, name: f.name.replace(/\.\w+$/, '') });
        if (!r || !r.ok) { toast((r && r.message) || '生成失败，换张照片试试', 'err'); return; }
        showCandidates(r.candidates || [], f.name.replace(/\.\w+$/, ''));
      }, 'btn--primary'), desc, btn('✨ 按描述生成', async () => { if (done(await call('custom', 'text', { text: desc.value }), '已生成')) refreshCustom(); })),
      R.cusList,
      R.cusPick,
      el('div', { class: 'card__desc', text: '专属声音：先选音色预设；录下的样本会在声音克隆服务上线后用来生成你的声音' }),
      R.voice, el('div', { class: 'plus-acts' }, recBtn, R.rec));
    c.id = 'paid-custom';
    const headEl = sec.querySelector('.sec-head');
    if (headEl && headEl.nextSibling) sec.insertBefore(c, headEl.nextSibling); else sec.appendChild(c);
  }
  function showCandidates(cands, baseName) {
    if (!R.cusPick) return;
    R.cusPick.innerHTML = '';
    if (!cands.length) { toast('这张照片没提取到颜色，换一张', 'err'); return; }
    R.cusPick.appendChild(el('div', { class: 'plus-sub', text: '选一个喜欢的颜色，就保存成你的方块仔' }));
    for (const c of cands) {
      const p = c.palette;
      R.cusPick.appendChild(el('div', { class: 'paid-skin' },
        el('div', { class: 'paid-skin__cube', style: { background: 'linear-gradient(158deg, ' + p.body1 + ', ' + p.body2 + ' 52%, ' + p.body3 + ')', boxShadow: '0 0 18px ' + p.glow } },
          el('i', { style: { background: p.eye } }), el('i', { style: { background: p.eye } })),
        el('div', { class: 'paid-skin__name', dataset: { noI18n: '1' }, text: baseName + ' · ' + c.label }),
        el('div', { class: 'plus-acts' },
          btn('用这个', async () => {
            const r = await call('custom', 'save', { name: baseName + ' · ' + c.label, palette: p, variant: c.label, swatches: (c.swatches || []) });
            if (done(r, '已保存：' + c.label)) { R.cusPick.innerHTML = ''; refreshCustom(); }
          }, 'btn--primary'))));
    }
    tr();
  }

  async function refreshCustom() {
    if (!R.cusList) return;
    const v = await call('custom', 'view');
    if (!v || !v.ok) return;
    R.cusLock.classList.toggle('hidden', !!v.unlocked);
    R.cusList.innerHTML = '';
    if (!v.skins.length) R.cusList.appendChild(el('div', { class: 'plus-sub', text: '还没有定制皮肤' }));
    for (const s of v.skins) {
      const p = s.palette;
      R.cusList.appendChild(el('div', { class: 'paid-skin' },
        el('div', { class: 'paid-skin__cube', style: { background: `linear-gradient(158deg, ${p.body1}, ${p.body2} 52%, ${p.body3})`, boxShadow: `0 0 18px ${p.glow}` } }, el('i', { style: { background: p.eye } }), el('i', { style: { background: p.eye } }), s.accessory && s.accessory.held ? el('b', { text: s.accessory.held }) : null),
        el('div', { class: 'paid-skin__name', dataset: { noI18n: '1' }, text: s.name }),
        el('div', { class: 'plus-sub', text: s.source === 'photo' ? '照片取色' : '文字生成' }),
        el('div', { class: 'plus-acts' }, btn('换上', async () => done(await call('custom', 'apply', { id: s.id }), '已换上')), btn('删除', async () => { await call('custom', 'remove', { id: s.id }); refreshCustom(); }))));
    }
    R.voice.innerHTML = '';
    for (const p of v.voice.presets) {
      const b = btn((v.voice.preset === p.id ? '● ' : '') + p.name, async () => { if (done(await call('custom', 'voice', { id: p.id }), '音色：' + p.name)) refreshCustom(); }, v.voice.preset === p.id ? 'btn--primary' : '');
      R.voice.appendChild(b);
    }
    if (v.voice.samples) R.rec.textContent = `已录 ${v.voice.samples} 段样本`;
    tr();
  }

  // ================================================================ 情侣进阶
  function buildCouplePremium() {
    const sec = document.getElementById('sec-couple');
    if (!sec) return;
    R.cpLock = lockNote(true, '情侣进阶包含在情侣年卡（' + window.CubbitUI.formatMoney(26800) + ' / 年，两人共用）');
    const t = input('这一天叫什么，如「第一次看海」');
    const d = input('', 'date');
    const n = el('textarea', { class: 'input', rows: 2, placeholder: '写点当时的心情…' });
    let photo = null;
    const ph = el('span', { class: 'plus-sub', text: '' });
    R.album = el('div', { class: 'paid-album' });
    R.letters = el('div', { class: 'plus-list' });
    R.outfits = el('div', { class: 'plus-acts' });
    const c = card('情侣进阶', '纪念日回忆相册 · 每月一封方块仔写的情书 · 限定情侣装', R.cpLock,
      el('div', { class: 'card__title paid-sub', text: '📷 纪念日相册' }),
      el('div', { class: 'plus-acts' }, t, d, btn('选照片', async () => { const f = await readFile('image/png,image/jpeg,image/webp'); if (f) { photo = f.dataUrl; ph.textContent = f.name; } }), ph),
      n, el('div', { class: 'plus-acts' }, btn('存入相册', async () => { if (done(await call('couple', 'addAlbum', { title: t.value, date: d.value, note: n.value, photo }), '已存入相册')) { t.value = ''; n.value = ''; photo = null; ph.textContent = ''; refreshCouple(); } }, 'btn--primary')),
      R.album,
      el('div', { class: 'card__title paid-sub', text: '💌 每月情书' }),
      el('div', { class: 'plus-acts' }, btn('让方块仔现在写一封', async () => { if (done(await call('couple', 'letter', {}), '情书写好了')) refreshCouple(); })),
      R.letters,
      el('div', { class: 'card__title paid-sub', text: '👗 限定情侣装' }), R.outfits);
    c.id = 'paid-couple';
    const headEl = sec.querySelector('.sec-head');
    if (headEl && headEl.nextSibling) sec.insertBefore(c, headEl.nextSibling); else sec.appendChild(c);
  }
  async function refreshCouple() {
    if (!R.album) return;
    const v = await call('couple', 'view');
    if (!v || !v.ok) return;
    R.cpLock.classList.toggle('hidden', !!v.unlocked);
    R.album.innerHTML = '';
    if (!v.album.length) R.album.appendChild(el('div', { class: 'plus-sub', text: '相册还是空的，存下你们的第一个纪念日吧' }));
    for (const a of v.album) {
      const img = el('div', { class: 'paid-album__img' }, el('span', { text: '💞' }));
      if (a.photo) call('couple', 'photo', { id: a.id }).then((r) => { if (r && r.ok) { img.innerHTML = ''; img.style.backgroundImage = `url(${r.dataUrl})`; } });
      R.album.appendChild(el('div', { class: 'paid-album__item', dataset: { noI18n: '1' } }, img, el('div', { class: 'paid-album__t', text: a.title }), el('div', { class: 'plus-sub', text: a.date + (a.note ? ' · ' + a.note.slice(0, 40) : '') })));
    }
    R.letters.innerHTML = '';
    for (const l of v.letters.slice(0, 3)) R.letters.appendChild(el('div', { class: 'paid-letter', dataset: { noI18n: '1' } }, el('div', { class: 'plus-sub', text: l.month + (l.source === 'ai' ? ' · AI 执笔' : ' · 模板') }), el('div', { class: 'paid-letter__body', text: l.text })));
    R.outfits.innerHTML = '';
    for (const o of v.outfits) R.outfits.appendChild(btn(`${o.name}（${o.badge}）`, async () => { const r = await api.invoke('app:settings:set', { skinId: o.id }); done(r, '换上了：' + o.name); }));
    tr();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      buildOffice(); buildMember(); buildCustom(); buildCouplePremium();
      tr();
      await Promise.all([refreshOffice(), refreshMember(), refreshCustom(), refreshCouple()]);
      setInterval(() => { const s = document.getElementById('sec-office'); if (s && !s.classList.contains('hidden')) refreshOffice(); }, 5000);
      api.onState(() => { refreshMember(); });
    }, 50);
  });
})();
