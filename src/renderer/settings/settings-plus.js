/* ============================================================================
 * 方块仔 v2.4 设置扩展：语言 / 情侣空间 / AI 记忆 / 主动关心 / 性格 / 亲密度
 * 独立文件，挂到已有分区（sec-system / sec-couple / sec-ai）里，不改原有卡片。
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
  let S = null;

  const LANGS = [
    { id: 'zh-CN', label: '中文' },
    { id: 'en', label: 'English' },
    { id: 'de', label: 'Deutsch' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' },
    { id: 'fr', label: 'Français' },
    { id: 'it', label: 'Italiano' },
  ];

  const inv = (ch, payload) => api.invoke(ch, payload || {}).catch((e) => ({ ok: false, message: e && e.message }));
  const save = async (patch, msg) => {
    const res = await inv('app:settings:set', patch);
    if (res && res.ok) { if (msg) toast(msg, 'ok'); return true; }
    toast((res && res.message) || '保存失败', 'err');
    return false;
  };

  function card(title, desc, ...children) {
    return el('div', { class: 'card plus-card' },
      el('div', { class: 'card__head' }, el('div', {}, el('div', { class: 'card__title' }, el('span', { text: title })), desc ? el('div', { class: 'card__desc', text: desc }) : null)),
      ...children);
  }
  function row(title, desc, ctrl) {
    return el('div', { class: 'row-item' },
      el('div', { class: 'row-item__body' }, el('div', { class: 'row-item__title' }, el('span', { text: title })), desc ? el('div', { class: 'row-item__desc', text: desc }) : null),
      el('div', { class: 'row-item__ctrl' }, ctrl || null));
  }
  function sw(on, onChange) {
    const b = el('button', { class: 'switch' + (on ? ' is-on' : ''), type: 'button', role: 'switch' });
    b.addEventListener('click', () => { const next = !b.classList.contains('is-on'); b.classList.toggle('is-on', next); onChange(next); });
    return b;
  }
  function setSw(b, on) { if (b) b.classList.toggle('is-on', !!on); }
  function btn(text, onClick, cls) {
    const b = el('button', { class: 'btn btn--sm ' + (cls || ''), type: 'button' }, el('span', { text }));
    b.addEventListener('click', async () => { b.disabled = true; try { await onClick(b); } finally { b.disabled = false; } });
    return b;
  }
  function insertAfterHead(sec, node) {
    const head = sec.querySelector('.sec-head');
    if (head && head.nextSibling) sec.insertBefore(node, head.nextSibling);
    else sec.appendChild(node);
  }

  // ------------------------------------------------------------ 贴边
  function buildEdge() {
    const sec = document.getElementById('sec-interaction');
    if (!sec) return;
    R.edgeSnap = sw(true, (on) => save({ petEdgeSnap: on }));
    R.edgeHide = sw(false, (on) => save({ petEdgeHide: on }));
    const c = card('贴边与半隐藏', '方块仔可以拖到屏幕任意边缘和角落（包括任务栏那一侧、多显示器），不会挡住办公区。',
      row('松手自动贴边', '离屏幕边缘很近时松手，方块仔会贴过去', R.edgeSnap),
      row('贴边半隐藏', '贴在左 / 右边时只露出一小半，鼠标移上去就滑出来，移开后自动缩回', R.edgeHide));
    insertAfterHead(sec, c);
  }

  // ------------------------------------------------------------ 语言
  function buildLanguage() {
    const sec = document.getElementById('sec-system');
    if (!sec) return;
    R.langSelect = el('select', { class: 'select', 'aria-label': 'Language' });
    for (const l of LANGS) R.langSelect.appendChild(el('option', { value: l.id, text: l.label }));
    R.langSelect.addEventListener('change', async () => {
      const v = R.langSelect.value;
      try { localStorage.setItem('cubbit.lang', v); } catch { /* ignore */ }
      await save({ language: v });
    });
    R.langHint = el('div', { class: 'row-item__desc plus-hint', text: '' });
    R.langOpen = btn('打开 Windows 语言设置', () => inv('plus:open-lang-settings'));
    const c = card('语言 Language', '界面、方块仔台词与语音一起切换。Interface, pet lines and voice switch together.',
      row('界面语言', '中文 / English / Deutsch / 日本語 / 한국어 / Français / Italiano', R.langSelect),
      R.langHint,
      el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, R.langOpen));
    c.id = 'plus-language';
    insertAfterHead(sec, c);
  }

  async function updateLanguage(state) {
    if (!R.langSelect) return;
    const lang = (state.settings && state.settings.language) || 'zh-CN';
    if (document.activeElement !== R.langSelect) R.langSelect.value = LANGS.some((l) => l.id === lang) ? lang : 'zh-CN';
    const sup = await inv('plus:lang-support', { lang });
    if (sup && sup.ok) {
      const parts = [];
      parts.push(sup.tts ? '✅ 语音：' + sup.ttsVoice : '⚠️ 没有安装「' + sup.langName + '」语音，方块仔会只显示气泡。安装方法：Windows 设置 → 时间和语言 → 语言和区域 → 添加语言「' + sup.langName + '」→ 勾选「文本到语音转换」和「语音识别」，装好后重启方块仔。');
      parts.push(sup.stt ? '✅ 语音输入：支持 ' + sup.sttCulture : '⚠️ 语音输入：Windows 没有「' + sup.langName + '」离线识别包（同上安装「语音识别」），否则只能用' + (sup.sttFallback || '中文') + '识别。');
      R.langHint.textContent = parts.join('\n');
      R.langOpen.style.display = sup.tts && sup.stt ? 'none' : '';
    }
  }

  // ------------------------------------------------------------ 情侣空间
  function buildCoupleSpace() {
    const sec = document.getElementById('sec-couple');
    if (!sec) return;
    R.cpDays = el('div', { class: 'plus-big', text: '—' });
    R.cpCount = el('div', { class: 'plus-sub', text: '' });
    R.cpOnline = el('div', { class: 'plus-sub', text: '' });
    R.cpSince = el('input', { class: 'input', type: 'date', style: { width: '160px' } });
    R.cpAnniv = el('input', { class: 'input', type: 'date', style: { width: '160px' } });
    R.cpSince.addEventListener('change', () => inv('couple-plus:set', { since: R.cpSince.value }).then(() => toast('在一起的日子已更新', 'ok')));
    R.cpAnniv.addEventListener('change', () => inv('couple-plus:set', { anniversary: R.cpAnniv.value }).then(() => toast('纪念日已设置', 'ok')));

    const actions = [
      ['poke', '👉 戳一戳'], ['heart', '💗 比心'], ['hug', '🤗 抱抱'], ['kiss', '😘 亲亲'],
      ['highfive', '🙌 击掌'], ['hands', '🤝 牵手'], ['goodnight', '🌙 晚安'], ['focus', '🍅 一起专注 25 分钟'],
    ];
    R.cpActs = el('div', { class: 'plus-acts' });
    for (const [id, label] of actions) {
      R.cpActs.appendChild(btn(label, async () => {
        const res = await inv('couple-plus:act', { t: id, minutes: 25 });
        if (res && res.ok) toast(res.demo ? '已发送（本地演示）' : '已发送给 TA', 'ok');
        else toast((res && res.message) || '发送失败', 'err');
      }, 'plus-act'));
    }
    R.cpRelay = el('input', { class: 'input', type: 'text', maxlength: '120', placeholder: '想让 TA 的方块仔替你说什么？' });
    const relayBtn = btn('💬 让 TA 的方块仔说', async () => {
      const res = await inv('couple-plus:act', { t: 'relay', text: R.cpRelay.value });
      if (res && res.ok) { R.cpRelay.value = ''; toast('传话成功，TA 的方块仔会念出来', 'ok'); } else toast((res && res.message) || '发送失败', 'err');
    });
    const voiceBtn = btn('🎙️ 录一句语音留言', async (b) => {
      const span = b.querySelector('span');
      span.textContent = '🎙️ 正在听…';
      try {
        const res = await inv('couple-plus:voice', {});
        if (res && res.ok) toast('语音留言已发送：「' + res.text + '」', 'ok');
        else toast((res && res.message) || '没听清', 'err');
      } finally { span.textContent = '🎙️ 录一句语音留言'; }
    });

    R.cpTasks = el('div', { class: 'plus-list' });
    R.cpTaskInput = el('input', { class: 'input', type: 'text', maxlength: '40', placeholder: '添加共同任务，比如：一起喝水' });
    const addTask = btn('添加', async () => {
      const res = await inv('couple-plus:task', { op: 'add', text: R.cpTaskInput.value });
      if (res && res.ok) R.cpTaskInput.value = ''; else toast((res && res.message) || '添加失败', 'err');
    });
    R.cpPresets = el('div', { class: 'plus-acts' });
    R.cpAch = el('div', { class: 'plus-ach' });
    R.cpSkin = el('select', { class: 'select' });
    const skinBtn = btn('穿上情侣装', async () => {
      const res = await inv('couple-plus:skin', { id: R.cpSkin.value });
      if (res && res.ok) toast('情侣装已换上，TA 那边会自动换成另一半', 'ok'); else toast((res && res.message) || '换装失败', 'err');
    });
    R.cpAutoFocus = sw(true, (on) => inv('couple-plus:set', { autoJoinFocus: on }));
    R.cpPokeSync = sw(true, (on) => save({ couplePokeSync: on }));

    const c = card('情侣空间', '同步互动、传话、纪念日、共同任务与情侣成就。动作通过情侣消息通道实时同步到 TA 的方块仔。',
      el('div', { class: 'plus-hero' }, el('div', {}, el('div', { class: 'plus-sub', text: '我们在一起' }), R.cpDays), el('div', { class: 'plus-hero__side' }, R.cpCount, R.cpOnline)),
      row('在一起的日子', '不填则按配对/结婚日期计算', R.cpSince),
      row('纪念日', '每年这一天前会倒计时提醒', R.cpAnniv),
      el('div', { class: 'divider' }),
      el('div', { class: 'row-item__title', text: '同步互动（两人都在线时会播放击掌 / 牵手 / 抱抱合体动画）' }),
      R.cpActs,
      row('戳自己的方块仔时也戳 TA', '点一下桌面上的方块仔，TA 的方块仔会抖一下（10 秒最多一次）', R.cpPokeSync),
      row('TA 发起「一起专注」时自动开始', '', R.cpAutoFocus),
      el('div', { class: 'divider' }),
      el('div', { class: 'row-item__title', text: '传话 & 语音留言（TA 的方块仔会用语音念出来）' }),
      el('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } }, R.cpRelay, relayBtn),
      el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, voiceBtn),
      el('div', { class: 'divider' }),
      el('div', { class: 'row-item__title', text: '共同任务（两人同一天都完成会庆祝）' }),
      R.cpPresets,
      R.cpTasks,
      el('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } }, R.cpTaskInput, addTask),
      el('div', { class: 'divider' }),
      row('情侣配对皮肤', '你穿一半，TA 自动穿另一半', el('div', { class: 'row', style: { gap: '8px' } }, R.cpSkin, skinBtn)),
      el('div', { class: 'divider' }),
      el('div', { class: 'row-item__title', text: '情侣成就' }),
      R.cpAch);
    c.id = 'plus-couple-space';
    const partnerCard = sec.querySelector('.card');
    if (partnerCard && partnerCard.nextSibling) sec.insertBefore(c, partnerCard.nextSibling);
    else insertAfterHead(sec, c);
  }

  function updateCoupleSpace(state) {
    const cp = state.couplePlus;
    if (!cp || !R.cpDays) return;
    R.cpDays.textContent = cp.days ? cp.days + ' 天' : (cp.paired ? '第 1 天' : '还没配对');
    R.cpCount.textContent = cp.countdown ? (cp.countdown.isToday ? '🎉 今天是纪念日！' : '距离纪念日还有 ' + cp.countdown.daysLeft + ' 天（' + cp.countdown.next + '）') : '设置一个纪念日吧';
    R.cpOnline.textContent = cp.paired ? (cp.partnerOnline ? '🟢 ' + cp.partnerName + ' 在线' : '⚪ ' + cp.partnerName + ' 离线') : '先在「情侣模式」里配对';
    if (document.activeElement !== R.cpSince) R.cpSince.value = cp.since || '';
    if (document.activeElement !== R.cpAnniv) R.cpAnniv.value = cp.anniversary || '';
    setSw(R.cpAutoFocus, cp.autoJoinFocus);
    setSw(R.cpPokeSync, (state.settings || {}).couplePokeSync !== false);
    R.cpTasks.innerHTML = '';
    for (const t of cp.sharedTasks) {
      const done = btn(t.mine ? '✓ 我已完成' : '完成', async () => { await inv('couple-plus:task', { op: 'done', id: t.id }); });
      if (t.mine) done.disabled = true;
      const del = btn('删除', async () => { await inv('couple-plus:task', { op: 'remove', id: t.id }); });
      R.cpTasks.appendChild(el('div', { class: 'plus-task' + (t.both ? ' is-both' : '') },
        el('span', { class: 'plus-task__text', text: t.icon + ' ' + t.text }),
        el('span', { class: 'plus-task__st' }, el('span', { text: t.mine ? '我✓' : '我○' }), el('span', { text: ' · ' }), el('span', { text: t.partner ? 'TA✓' : 'TA○' }), el('span', { text: t.both ? ' 🎉' : '' })),
        done, del));
    }
    if (!cp.sharedTasks.length) R.cpTasks.appendChild(el('div', { class: 'row-item__desc', text: '还没有共同任务，点上面的预设快速添加。' }));
    if (!R.cpPresets.childNodes.length) {
      for (const p of cp.presets) R.cpPresets.appendChild(btn(p.icon + ' ' + p.text, () => inv('couple-plus:task', { op: 'add', text: p.text, icon: p.icon })));
    }
    R.cpAch.innerHTML = '';
    for (const a of cp.achievements) {
      R.cpAch.appendChild(el('div', { class: 'plus-badge' + (a.unlockedAt ? ' is-on' : ''), title: a.desc }, el('div', { class: 'plus-badge__icon', text: a.unlockedAt ? a.icon : '🔒' }), el('div', { class: 'plus-badge__name', text: a.name })));
    }
    if (!R.cpSkin.childNodes.length) for (const p of cp.skinPairs) R.cpSkin.appendChild(el('option', { value: p.id, text: p.name }));
    if (cp.pairSkin && document.activeElement !== R.cpSkin) R.cpSkin.value = cp.pairSkin;
  }

  // ------------------------------------------------------------ AI：性格 / 亲密度 / 记忆 / 主动关心
  function buildCompanion() {
    const sec = document.getElementById('sec-ai');
    if (!sec) return;
    R.persona = el('div', { class: 'seg' });
    for (const [id, label] of [['gentle', '🌸 温柔'], ['tsundere', '😤 傲娇'], ['energetic', '⚡ 元气']]) {
      const b = el('button', { class: 'seg__item', type: 'button', dataset: { id } }, el('span', { text: label }));
      b.addEventListener('click', () => save({ petPersonality: id, aiPersonality: id }, '性格已切换'));
      R.persona.appendChild(b);
    }
    R.intLevel = el('div', { class: 'plus-big', text: 'Lv.1' });
    R.intBar = el('div', { class: 'plus-bar__fill' });
    R.intNext = el('div', { class: 'plus-sub', text: '' });
    R.intList = el('div', { class: 'plus-list' });
    const c1 = card('性格与亲密度', '性格同时影响 AI 回复和本地台词；摸摸、聊天、完成任务、情侣互动都会增加亲密度（每天上限 60 点）。',
      row('性格', '温柔 / 傲娇 / 元气', R.persona),
      el('div', { class: 'plus-hero' }, el('div', {}, el('div', { class: 'plus-sub', text: '亲密度' }), R.intLevel), el('div', { class: 'plus-hero__side grow' }, el('div', { class: 'plus-bar' }, R.intBar), R.intNext)),
      R.intList);
    c1.id = 'plus-persona';

    R.memSwitch = sw(true, (on) => save({ memoryEnabled: on }, on ? '长期记忆已开启' : '长期记忆已关闭'));
    R.memList = el('div', { class: 'plus-list' });
    const clearBtn = btn('清空全部记忆', async () => { if (window.confirm('确定清空方块仔记住的所有事吗？')) { await inv('memory:delete', { id: 'all' }); refreshMemory(); toast('已清空', 'ok'); } });
    const c2 = card('长期记忆', '从聊天里记住你的生日、喜好和最近的烦恼，之后会主动提起。只保存在这台电脑（memory.json），不会上传。',
      row('启用长期记忆', '关闭后不再记新事，已有记忆保留直到你删除', R.memSwitch),
      R.memList,
      el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, clearBtn));
    c2.id = 'plus-memory';

    R.careSwitch = sw(true, (on) => save({ proactiveCare: on }));
    R.weatherSwitch = sw(true, (on) => save({ weatherEnabled: on }));
    R.city = el('input', { class: 'input', type: 'text', maxlength: '40', placeholder: '城市（留空按 IP 自动定位）', style: { width: '200px' } });
    R.city.addEventListener('change', () => save({ weatherCity: R.city.value.trim() }, '城市已保存'));
    const testRow = el('div', { class: 'plus-acts' });
    for (const [k, label] of [['morning', '☀️ 早安'], ['late', '🌙 深夜'], ['longWork', '🧘 久坐'], ['weather', '🌦️ 天气'], ['recall', '💛 记忆回访']]) {
      testRow.appendChild(btn(label, async () => { const r = await inv('care:tick', { force: k }); toast(r && r.text ? r.text : (r && r.message) || '暂时没有可说的', r && r.text ? 'ok' : 'info', 4200); }));
    }
    const c3 = card('主动关心', '按时段问候（早/午/晚/深夜）、连续工作 90 分钟提醒休息、早上播报天气（wttr.in，免费无需 Key）、回访你说过的烦恼和生日。',
      row('启用主动关心', '', R.careSwitch),
      row('天气提醒', '早上第一次问候时附带天气', R.weatherSwitch),
      row('城市', '', R.city),
      el('div', { class: 'row-item__desc', text: '试一试：' }),
      testRow);
    c3.id = 'plus-care';
    insertAfterHead(sec, c3);
    insertAfterHead(sec, c2);
    insertAfterHead(sec, c1);
  }

  async function refreshMemory() {
    const res = await inv('memory:get');
    if (!R.memList) return;
    R.memList.innerHTML = '';
    const TYPE = { birthday: '🎂 生日', name: '🙋 名字', like: '💛 喜欢', dislike: '🙅 不喜欢', worry: '🫂 烦恼' };
    const items = (res && res.items) || [];
    if (!items.length) R.memList.appendChild(el('div', { class: 'row-item__desc', text: '还没有记忆。试着在聊天里说「我的生日是 3 月 14 日」「我最喜欢喝奶茶」。' }));
    for (const m of items) {
      const del = btn('删除', async () => { await inv('memory:delete', { id: m.id }); refreshMemory(); });
      R.memList.appendChild(el('div', { class: 'plus-task' }, el('span', { class: 'plus-task__st', text: TYPE[m.type] || m.type }), el('span', { class: 'plus-task__text', text: m.text }), el('span', { class: 'plus-task__st', text: new Date(m.at).toLocaleDateString() }), del));
    }
  }

  function updateCompanion(state) {
    const s = state.settings || {};
    if (R.persona) {
      const p = s.petPersonality || ({ warm: 'gentle', sassy: 'tsundere' }[s.aiPersonality]) || 'gentle';
      for (const b of R.persona.children) b.classList.toggle('is-active', b.dataset.id === p);
    }
    setSw(R.memSwitch, s.memoryEnabled !== false);
    setSw(R.careSwitch, s.proactiveCare !== false);
    setSw(R.weatherSwitch, s.weatherEnabled !== false);
    if (R.city && document.activeElement !== R.city) R.city.value = s.weatherCity || '';
    const it = state.intimacy;
    if (it && R.intLevel) {
      R.intLevel.textContent = 'Lv.' + it.level + ' ' + it.name;
      R.intBar.style.width = Math.round(it.progress * 100) + '%';
      R.intNext.textContent = it.next ? it.points + ' / ' + it.next.min + ' 点 → Lv.' + it.next.level + ' ' + it.next.name : it.points + ' 点 · 已满级';
      R.intList.innerHTML = '';
      for (const l of it.levels) R.intList.appendChild(el('div', { class: 'plus-task' + (l.unlocked ? ' is-both' : '') }, el('span', { class: 'plus-task__st' }, el('span', { text: l.unlocked ? '✅ ' : '🔒 ' }), el('span', { text: 'Lv.' + l.level + ' ' + l.name })), el('span', { class: 'plus-task__text', text: l.unlock })));
    }
  }

  function sync(state) {
    if (!state) return;
    S = state;
    updateLanguage(state);
    updateCoupleSpace(state);
    updateCompanion(state);
    const s2 = state.settings || {};
    setSw(R.edgeSnap, s2.petEdgeSnap !== false);
    setSw(R.edgeHide, !!s2.petEdgeHide);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    buildLanguage();
    buildEdge();
    buildCoupleSpace();
    buildCompanion();
    if (I18N) I18N.translateDom(document.body);
    try { sync(await api.state()); } catch { /* ignore */ }
    refreshMemory();
    api.onState((st) => sync(st));
    setInterval(refreshMemory, 15000);
  });
})();
