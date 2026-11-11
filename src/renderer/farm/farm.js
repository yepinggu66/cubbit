/* 方块仔 2.5D 小农场（等距视角 canvas，隐藏/最小化时暂停渲染） */
(function () {
  'use strict';
  const UI = window.CubbitUI;
  const app = UI.createApp();
  const el = UI.el;
  const toast = (m, t) => UI.toast(m, t || 'ok');

  const NAMES = {
    turnip: '小白菜', carrot: '胡萝卜', tomato: '番茄', corn: '玉米', pumpkin: '南瓜', goldberry: '金草莓', starmelon: '星星瓜',
    chicken: '小鸡', rabbit: '兔子', pig: '小猪', cow: '奶牛', sheep: '绵羊', goldhen: '金色公鸡',
    egg: '鸡蛋', fur: '兔毛', truffle: '松露', milk: '牛奶', wool: '羊毛',
    growth_food: '成长饭团', hat_straw: '草帽', scarf_red: '红围巾', shard: '皮肤碎片', guard_dog: '看门狗',
    wolf: '狼', jackal: '豺', tiger: '老虎', leopard: '豹子',
    fence: '木栅栏', flowers: '郁金香花坛', scarecrow: '稻草人', windmill: '风车', pond: '小池塘',
  };
  const ERR = {
    NEED_COINS: '金币不够（需要 {}）', NEED_POINTS: '农场点数不够（需要 {}）', PLOT_LOCKED: '这块地还没开垦', PLOT_BUSY: '这块地已经种了东西',
    NOT_GROWING: '这块地没有在生长的作物', ALREADY_WATERED: '已经浇过水了', NOT_RIPE: '还没成熟', MAX_PLOTS: '土地已经全部开垦',
    USE_PREMIUM_LAND: '普通开垦已到上限，剩下的地可用点数扩建', PEN_FULL: '动物栏满了（最多 10 只）', NOT_HUNGRY: '它现在不饿', NOT_READY: '还没产出',
    NOTHING_TO_SELL: '仓库里没有可卖的东西', OWNED: '已经拥有了', DAILY_LIMIT: '今天的限购已用完（每天 {} 次）', ALREADY_WORKING: '方块仔已经在打工了',
    NOT_WORKING: '方块仔没有在打工', STEAL_DAILY: '今天偷菜次数用完了（每天 {} 次）', STEAL_FRIEND: '这位好友今天最多只能偷 {} 次',
    NEEDS_SERVER: '真实购买需要正式支付服务器，暂未开放', BAD_INPUT: '操作无效',
  };
  const S = { tab: 'field', tool: 'plant', seed: 'turnip', view: null, cat: null, friend: null, settings: {}, hover: null };
  const R = {};

  const call = async (action, args) => {
    const r = await app.invoke('farm:call', { action, args: args || {} });
    if (r && r.view) S.view = r.view;
    if (r && r.ok === false) toast((ERR[r.code] || r.message || '操作失败').replace('{}', (r.params && r.params.n) ?? ''), 'warn');
    return r || {};
  };
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
  const fmtMin = (ms) => Math.round(ms / 60000) + ' 分钟';

  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    const { bar } = UI.mountTitlebar(app, { page: '神秘探险' });
    document.getElementById('titlebar-host').appendChild(bar);
    try { await app.boot({}); } catch {}
    try { const st = await app.panel.state(); applyPetState(st); } catch {}
    try { if (app.panel.onState) app.panel.onState((st) => applyPetState(st)); } catch {}
    R.canvas = document.getElementById('farmCanvas'); R.ctx = R.canvas.getContext('2d'); R.tip = document.getElementById('tip');
    mountTabs(); mountTools();
    const r = await call('view'); S.cat = r.catalog;
    renderAll();
    R.canvas.addEventListener('click', onCanvasClick); bindCamera();
    R.canvas.addEventListener('mousemove', onCanvasMove);
    R.canvas.addEventListener('mouseleave', () => { S.hover = null; R.tip.style.display = 'none'; });
    window.addEventListener('resize', fitCanvas); fitCanvas();
    R.me = makePet(); document.querySelector('.farm-stage').appendChild(R.me.host);
    R.her = makePet(); R.her.host.style.display = 'none'; document.querySelector('.farm-stage').appendChild(R.her.host); updateMyPet();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); loop(); } });
    setInterval(() => { if (!document.hidden) refresh(); }, 4000);
    loop();
  }
  async function refresh() { await call('view'); renderHud(); if (S.tab !== 'friends' || !S.friend) renderPanel(); }
  function renderAll() { renderHud(); renderPanel(); }

  // ------------------------------------------------------------ HUD / 工具
  function renderHud() {
    const v = S.view; if (!v) return;
    document.getElementById('hudCoins').textContent = v.coins;
    document.getElementById('hudPoints').textContent = v.points;
    document.getElementById('hudShards').textContent = `${v.shards}/${v.shardsNeeded}`;
    document.getElementById('hudWork').classList.toggle('hidden', !v.work);
  }
  const TOOLS = [['plant', '🌱 营地栽种'], ['water', '💧 灵泉浇灌'], ['harvest', '🧺 采集收获'], ['speed', '⚡ 晶石加速']];
  function mountTools() {
    R.tools = document.getElementById('tools');
    R.tools.innerHTML = '';
    for (const [id, label] of TOOLS) {
      const b = el('button', { class: 'farm-tool' + (S.tool === id ? ' is-on' : ''), type: 'button', text: label });
      b.addEventListener('click', () => { S.tool = id; mountTools(); });
      R.tools.appendChild(b);
    }
    const cb = (label, fn) => { const b = el('button', { class: 'farm-tool farm-tool--cam', type: 'button', text: label }); b.addEventListener('click', fn); R.tools.appendChild(b); };
    cb('🏕️ 回到营地', () => centerFarm()); cb('➕', () => zoomAt(W / 2, H / 2, 1.2)); cb('➖', () => zoomAt(W / 2, H / 2, 1 / 1.2));
  }
  const TABS = [['field', '🏕️ 探险营地'], ['animals', '🦊 灵兽伙伴'], ['shop', '🎒 探险补给'], ['friends', '🧭 邻近营地'], ['couple', '💞 双人探险'], ['work', '⛏️ 外出探险']];
  function mountTabs() {
    const host = document.getElementById('tabs'); host.innerHTML = '';
    for (const [id, label] of TABS) {
      const b = el('button', { class: 'farm-tab' + (S.tab === id ? ' is-on' : ''), type: 'button', text: label });
      b.addEventListener('click', () => { S.tab = id; S.friend = null; mountTabs(); renderPanel(); });
      host.appendChild(b);
    }
  }
  const btn = (text, fn, pri, disabled) => { const b = el('button', { class: 'farm-btn' + (pri ? ' farm-btn--pri' : ''), type: 'button', text }); if (disabled) b.disabled = true; b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; renderAll(); } }); return b; };
  const row = (em, title, sub, ...right) => el('div', { class: 'farm-row' }, el('span', { class: 'em', text: em }), el('div', { class: 'grow' }, el('div', { text: title }), sub ? el('div', { class: 'sub', text: sub }) : null), ...right);

  // ------------------------------------------------------------ 面板
  function renderPanel() {
    const P = document.getElementById('panel'); if (!P || !S.view || !S.cat) return;
    const st = P.scrollTop; P.innerHTML = '';
    ({ field: panelField, animals: panelAnimals, shop: panelShop, friends: panelFriends, couple: panelCouple, work: panelWork })[S.tab](P);
    P.scrollTop = st;
  }
  function panelField(P) {
    const v = S.view, C = S.cat.CROPS;
    P.appendChild(el('div', { class: 'farm-h', text: '选择种子（选好后点左边的空地）' }));
    for (const [id, c] of Object.entries(C)) {
      const r = row(c.emoji, NAMES[id] + (c.rare ? ' · 稀有' : ''), (c.rare ? `${c.points} 💎 · 额外掉 ${c.shard} 片碎片` : `${c.seed} 🪙 · 卖 ${c.sell} 🪙`) + ` · ${fmtMin(c.grow)}`);
      if (S.seed === id) r.classList.add('is-sel');
      r.style.cursor = 'pointer'; r.addEventListener('click', () => { S.seed = id; S.tool = 'plant'; mountTools(); renderPanel(); });
      P.appendChild(r);
    }
    P.appendChild(el('div', { class: 'farm-note', text: '浇水能让作物快 25% 成熟；会员每天第一次收获额外 +1。' }));
    P.appendChild(el('div', { class: 'farm-h', text: '土地' }));
    const open = v.plots.filter((p) => p.open).length;
    P.appendChild(row('🟫', `已开垦 ${open} / ${S.cat.MAX_PLOTS} 块`, v.memberBonusLeft ? '今日会员收获加成：还没用' : ''));
    P.appendChild(el('div', { class: 'farm-row farm-row--wrap' }, btn('🧺 一键收获', () => call('harvestAll'), true), btn(`开垦新地（${v.reclaimCost} 🪙）`, () => call('reclaim')), btn('扩建（80 💎）', () => call('premiumLand'))));
  }
  function panelAnimals(P) {
    const v = S.view, A = S.cat.ANIMALS;
    P.appendChild(el('div', { class: 'farm-h', text: '我的动物' }));
    if (!v.animals.length) P.appendChild(el('div', { class: 'farm-note', text: '还没有动物，先买一只小鸡吧。' }));
    for (const a of v.animals) {
      const d = A[a.kind];
      const sub = a.status === 'hungry' ? `饿了 · 喂食 ${d.feed} 🪙` : a.status === 'ready' ? `${d.pEmoji} 可以收取了` : `产出中 · 还剩 ${mmss(a.leftMs)}`;
      const act = a.status === 'hungry' ? btn('喂食', () => call('feed', { id: a.id }), true) : a.status === 'ready' ? btn('收取', () => call('collect', { id: a.id }), true) : btn('⚡ 加速', () => call('speedUp', { id: a.id }));
      P.appendChild(row(d.emoji, NAMES[a.kind], sub, act));
    }
    if (v.animals.length) P.appendChild(el('div', { class: 'farm-row' }, btn('全部喂食', () => call('feedAll'), true), btn('全部收取', () => call('collectAll'))));
    P.appendChild(el('div', { class: 'farm-h', text: '买动物' }));
    for (const [id, d] of Object.entries(A)) {
      P.appendChild(row(d.emoji, NAMES[id] + (d.rare ? ' · 稀有' : ''), `产 ${d.pEmoji}${NAMES[d.product]} · 每 ${fmtMin(d.cycle)} · 卖 ${d.sell} 🪙`, btn(d.rare ? `${d.points} 💎` : `${d.cost} 🪙`, () => call('buyAnimal', { kind: id }))));
    }
  }
  function panelShop(P) {
    const v = S.view, SH = S.cat.SHOP, D = S.cat.DECOR;
    P.appendChild(el('div', { class: 'farm-h', text: '仓库' }));
    const items = Object.entries(v.inv).filter(([, n]) => n > 0);
    if (!items.length) P.appendChild(el('div', { class: 'farm-note', text: '仓库是空的，去收获吧。' }));
    for (const [id, n] of items) {
      const em = (S.cat.CROPS[id] && S.cat.CROPS[id].emoji) || (Object.values(S.cat.ANIMALS).find((a) => a.product === id) || {}).pEmoji || '📦';
      P.appendChild(row(em, `${NAMES[id] || id} × ${n}`, '', btn('出售', async () => { const r = await call('sell', { item: id }); if (r.ok) toast(`卖出获得 ${r.coins} 金币`); })));
    }
    if (items.length) P.appendChild(el('div', { class: 'farm-row' }, btn('全部出售', async () => { const r = await call('sellAll'); if (r.ok) toast(`卖出获得 ${r.coins} 金币`); }, true)));
    P.appendChild(el('div', { class: 'farm-h', text: '金币商店' }));
    for (const [id, it] of Object.entries(SH)) {
      const owned = (it.kind === 'accessory' && v.accessories.includes(id)) || (it.kind === 'dog' && v.dog);
      const sub = { food: '给方块仔吃：经验 + 亲密度', accessory: '农场里的方块仔会戴上', shard: `集齐 ${v.shardsNeeded} 片解锁限定皮肤「田园小农夫」· 今天还能买 ${v.daily.shardBuysLeft} 次`, dog: '好友来偷菜时有机会被它拦下' }[it.kind];
      P.appendChild(row(it.emoji, NAMES[id], sub, owned ? el('span', { class: 'sub', text: '已拥有' }) : btn(`${it.coins} 🪙`, async () => { const r = await call('buy', { item: id }); if (r.ok) toast(r.unlocked ? '🎉 限定皮肤「田园小农夫」已解锁！' : '购买成功'); })));
    }
    P.appendChild(el('div', { class: 'farm-big', text: v.skinUnlocked ? '🎉 「田园小农夫」皮肤已解锁，可在 设置 → 外观 换上' : `🧩 碎片 ${v.shards} / ${v.shardsNeeded}` }));
    P.appendChild(el('div', { class: 'farm-h', text: '农场点数 💎' }));
    P.appendChild(el('div', { class: 'farm-note', text: '点数只能买时间（加速）、扩建土地、稀有种子/动物和装饰，不能换金币，也不会提高产量。会员每月赠送 100 点（点数不单独出售）。' }));
    P.appendChild(row('👑', 'AI 陪伴会员 · 探险特权', '每月白送 100 💎 点数 + 每日首次采集双倍', btn('开通会员', () => app.openPanel('store'), true)));
    P.appendChild(el('div', { class: 'farm-h', text: '装饰' }));
    for (const [id, it] of Object.entries(D)) {
      P.appendChild(row(it.emoji, NAMES[id], '', v.decor.includes(id) ? el('span', { class: 'sub', text: '已摆放' }) : btn(`${it.points} 💎`, () => call('buyDecor', { item: id }))));
    }
  }
  async function panelFriends(P) {
    if (S.friend) {
      const r = await call('friendFarm', { friend: S.friend }); const f = r.farm; if (!f) return;
      P.innerHTML = '';
      P.appendChild(el('div', { class: 'farm-row' }, btn('← 返回', () => { S.friend = null; })));
      P.appendChild(el('div', { class: 'farm-big', text: `${f.emoji} ${f.name} 的农场` + (f.dog ? ' · 🐕 有看门狗' : '') }));
      { const fp = makePet({ scale: 0.42, static: true }); const sk = skinById(f.skinId); setPetLook(fp, sk ? sk.palette : PET.palette, f.skinId, sk, f.name); fp.host.classList.add('farm-petdom--friend'); P.appendChild(fp.host); }
      P.appendChild(el('div', { class: 'farm-note', text: `点金框里成熟的作物偷一个 · 这位好友今天还能偷 ${f.left} 次 · 今天总共还能偷 ${S.view.daily.stealLeft} 次` }));
      const g = el('div', { class: 'farm-friend-grid' });
      for (const p of f.plots) {
        const c = el('div', { class: 'farm-fcell' + (p.ripe ? ' is-ripe' : '') + (p.stolen ? ' is-stolen' : ''), text: p.crop ? (p.ripe ? S.cat.CROPS[p.crop].emoji : '🌱') : '' });
        if (p.ripe) c.addEventListener('click', async () => { const res = await call('steal', { friend: f.id, plot: p.id }); if (res.ok) toast(res.caught ? `🐕 被看门狗发现了！罚了 ${res.fine} 金币` : `偷到了 1 个${NAMES[res.crop]}`, res.caught ? 'warn' : 'ok'); renderHud(); renderPanel(); });
        g.appendChild(c);
      }
      P.appendChild(g);
      return;
    }
    const r = await call('friends');
    P.innerHTML = '';
    P.appendChild(el('div', { class: 'farm-h', text: '邻近探险营地（本地演示）' }));
    for (const f of r.friends || []) P.appendChild(row(f.emoji, f.name + (f.dog ? ' 🐕' : ''), `${f.ripe} 处资源可采集 · 今天还能顺手采集 ${f.left} 次`, btn('去探访', () => { S.friend = f.id; }, true)));
    P.appendChild(el('div', { class: 'farm-note', text: '真实好友营地串门、资源互动需要联机服务器（好友关系、营地同步、防作弊），接口已预留，上线后自动可用。' }));
  }
  function panelWork(P) {
    const v = S.view, W = S.cat.WORK;
    P.appendChild(el('div', { class: 'farm-h', text: '名字' }));
    { const inp = el('input', { class: 'input farm-name-input', type: 'text', maxlength: '16', dataset: { noI18n: '1' } }); inp.value = PET.name;
      const save = async () => { const n = window.CubbitPetDom.cleanName(inp.value); inp.value = n; PET.name = n; await app.invoke('app:settings:set', { petName: n }); updateMyPet(); toast('名字已保存'); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      P.appendChild(el('div', { class: 'farm-row' }, inp, btn('保存', save, true))); }
    P.appendChild(el('div', { class: 'farm-h', text: '秘境探险巡逻' }));
    P.appendChild(el('div', { class: 'farm-big', text: v.work ? '⛏️ 方块仔正在秘境探险寻宝' : '🏠 方块仔在桌面陪你' }));
    P.appendChild(el('div', { class: 'farm-note', text: `你离开电脑 ${Math.round(W.idleMs / 60000)} 分钟后，方块仔会自己去秘境探险巡逻（每分钟 ${W.coinsPerMin} 金币，每天最多 ${W.dailyCap}），顺手照料营地作物；你回来时它会向你汇报探险收获。` }));
    P.appendChild(el('div', { class: 'farm-row' }, v.work ? btn('召回营地', async () => { const r = await call('endWork'); if (r.ok) toast(`探险 ${r.report.mins} 分钟，收获 ${r.report.coins} 金币`); }, true) : btn('出发探险（15 分钟）', () => call('startWork'), true)));
    P.appendChild(row('🪙', `今日探险收获 ${v.workToday} / ${W.dailyCap}`, ''));
    const on = S.settings.farmAutoWork !== false;
    const sw = el('label', { class: 'farm-switch' }, el('input', { type: 'checkbox' }), el('span', { text: '离开 5 分钟自动出发探险' }));
    sw.querySelector('input').checked = on;
    sw.querySelector('input').addEventListener('change', async (e) => { S.settings.farmAutoWork = e.target.checked; await app.invoke('app:settings:set', { farmAutoWork: e.target.checked }); });
    P.appendChild(el('div', { class: 'farm-row' }, sw));
    if (v.lastReport) { const r = v.lastReport; P.appendChild(el('div', { class: 'farm-h', text: '上次探险日志' })); P.appendChild(row('📋', `${r.mins} 分钟 · +${r.coins} 🪙`, `照料营地 ${r.watered} 处 · ${r.ripe} 处已成熟${r.capped ? ' · 今日已达上限' : ''}`)); }
  }

  // ------------------------------------------------------------ 方块仔本体（与桌宠同一套 DOM + pet.css，放在 Shadow DOM 里隔离样式）
  const PET = { palette: null, skinId: 'blaze', skins: [], name: '方块仔', dark: false };
  const NEKO_PAL = { body1: '#fff4e6', body2: '#f2c48d', body3: '#c98a4b', eye: '#2c3a1a', pupil: '#121a08', blush: '#ff9fae', rim: '#fffaf2', glow: 'rgba(255,200,140,.45)' };
  function skinById(id) { return PET.skins.find((s) => s.id === id) || null; }
  function applyPetState(st) {
    if (!st) return;
    if (st.settings) { S.settings = { ...S.settings, ...st.settings }; PET.skinId = st.settings.skinId || PET.skinId; PET.name = window.CubbitPetDom.cleanName(st.settings.petName); }
    if (Array.isArray(st.skins)) PET.skins = st.skins;
    if (st.palette) PET.palette = st.palette;
    updateMyPet();
  }
  const SHADOW_CSS = `:host{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:3;--sclera:#fff;--mouth:rgba(74,30,18,.9);--pet-scale:1;--pet-shift-y:1.4}
    :host(.is-dark){--sclera:#0d0f1a;--mouth:rgba(190,230,255,.75)}
    :host(.farm-petdom--friend){position:relative;display:block;width:100%;height:110px;margin:6px 0 10px}
    .holder{position:absolute;left:-95px;top:-184px;width:190px;height:196px;transform-origin:95px 184px}
    :host(.farm-petdom--friend) .holder{left:calc(50% - 95px);top:-76px}
    .pet{cursor:default!important;pointer-events:none;filter:drop-shadow(0 6px 8px rgba(0,0,0,.35))}
    .name{position:absolute;left:0;transform:translateX(-50%);white-space:nowrap;font:600 12px "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif;color:#fff;background:rgba(18,22,16,.78);border:1px solid rgba(255,255,255,.2);padding:2px 9px;border-radius:999px}
    :host(.farm-petdom--friend) .name{left:50%;top:0}
    .extra{position:absolute;left:0;transform:translateX(-50%);font-size:20px}
    .tool{position:absolute;right:-20px;top:70px;font-size:56px;transform-origin:50% 90%;animation:dig .9s ease-in-out infinite;display:none}
    .holder.working .tool{display:block}
    .act{position:absolute;inset:0;transform-origin:50% 92%}
    .holder.flip .act{transform:scaleX(-1)}
    .prop{position:absolute;right:-26px;top:84px;font-size:58px;pointer-events:none}
    .emote{position:absolute;left:0;transform:translate(-50%,0) scale(.6);opacity:0;font-size:20px;background:rgba(255,255,255,.92);border-radius:14px;padding:1px 6px;box-shadow:0 2px 6px rgba(0,0,0,.25);transition:opacity .25s,transform .25s;white-space:nowrap}
    .emote.on{opacity:1;transform:translate(-50%,0) scale(1)}
    .a-walk .pet{animation:fwalk .5s ease-in-out infinite}
    .a-chase .pet{animation:fwalk .28s ease-in-out infinite}
    .a-hop .pet,.a-jump .pet{animation:fjump .6s cubic-bezier(.3,.7,.4,1) infinite}
    .a-roll .pet{animation:froll 1.1s ease-in-out 1}
    .a-dance .pet{animation:fdance .8s ease-in-out infinite}
    .a-stretch .pet{animation:fstretch 1.6s ease-in-out infinite}
    .a-sneeze .pet{animation:fsneeze .5s ease-in-out 2}
    .a-shake .pet{animation:fshake .18s linear infinite}
    .a-wave .pet{animation:fwave .7s ease-in-out infinite}
    .a-sleep .pet{animation:fsleep 2.6s ease-in-out infinite}
    .a-lean-r .pet{transform:rotate(9deg)} .a-lean-l .pet{transform:rotate(-9deg)}
    @keyframes fwalk{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-10px) rotate(3deg)}}
    @keyframes fjump{0%,100%{transform:translateY(0) scale(1.06,.94)}45%{transform:translateY(-46px) scale(.95,1.06)}}
    @keyframes froll{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    @keyframes fdance{0%,100%{transform:rotate(-12deg) translateX(-8px)}50%{transform:rotate(12deg) translateX(8px)}}
    @keyframes fstretch{0%,100%{transform:scale(1,1)}50%{transform:scale(.9,1.14)}}
    @keyframes fsneeze{0%,100%{transform:translateX(0)}30%{transform:translateX(-10px) rotate(-8deg)}60%{transform:translateX(12px) rotate(10deg) scale(1.05)}}
    @keyframes fshake{0%,100%{transform:translateX(-4px)}50%{transform:translateX(4px)}}
    @keyframes fwave{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg) translateY(-6px)}}
    @keyframes fsleep{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.96)}}
    @keyframes dig{0%,100%{transform:rotate(-25deg)}50%{transform:rotate(25deg)}}`;
  function makePet(opts = {}) {
    const host = document.createElement('div'); host.className = 'farm-petdom';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<link rel="stylesheet" href="../pet/pet.css"><link rel="stylesheet" href="../pet/pet-v2.css"><style>${SHADOW_CSS}</style>`;
    const holder = document.createElement('div'); holder.className = 'holder';
    const scale = opts.scale || 0.26; holder.style.transform = `scale(${scale})`;
    const pet = window.CubbitPetDom.build(null); pet.classList.add('eyes--wide', 'mouth--smile');
    const tool = document.createElement('div'); tool.className = 'tool'; tool.textContent = '⛏️';
    const act = document.createElement('div'); act.className = 'act';
    const prop = document.createElement('div'); prop.className = 'prop';
    act.append(pet, prop); holder.append(act, tool);
    const name = document.createElement('div'); name.className = 'name';
    name.style.top = opts.static ? '' : `${-184 * scale - 26}px`;
    const extra = document.createElement('div'); extra.className = 'extra'; extra.style.top = `${-184 * scale - 8}px`;
    const emote = document.createElement('div'); emote.className = 'emote'; emote.style.top = `${-184 * scale - 52}px`;
    sh.append(holder, extra, name, emote);
    const o = { host, holder, pet, act, prop, emote, name, extra, scale };
    setExpr(o, 'happy');
    return o;
  }
  function setPetLook(p, palette, skinId, meta, name) {
    if (!p) return;
    window.CubbitPetDom.palette(p.pet, palette || {}); window.CubbitPetDom.skin(p.pet, skinId, meta);
    p.host.classList.toggle('is-dark', !!(palette && palette.dark));
    p.name.textContent = name;
  }
  function updateMyPet() {
    if (!R.me) return;
    setPetLook(R.me, PET.palette, PET.skinId, skinById(PET.skinId), PET.name);
    const w = !!(S.view && S.view.work);
    R.me.holder.classList.toggle('working', w);
    if (w) { setExpr(R.me, 'determined'); setAnim(R.me, 'walk'); setProp(R.me, ''); }
    if (R.her) { const c = S.view && S.view.couple; const sk = (c && c.partner.skinId) || 'neko'; setPetLook(R.her, (skinById(sk) && skinById(sk).palette) || NEKO_PAL, sk, skinById(sk) || { id: 'neko' }, (c && c.partner.name) || '阿橘'); R.her.holder.classList.toggle('working', !!(w && S.view.work.duo)); }
  }
  let lastWork = null;
  let lastZ = 0;
  function placePet(x, y, dir, p) {
    p = p || R.me; if (!p) return;
    const w = !!(S.view && S.view.work); if (p === R.me && w !== lastWork) { lastWork = w; updateMyPet(); }
    const [sx, sy] = toScreen(x, y);
    if (p.z !== cam.z) { p.z = cam.z; const sc = p.scale * cam.z; p.holder.style.transform = `scale(${sc})`; p.name.style.top = `${-184 * sc - 26}px`; p.extra.style.top = `${-184 * sc - 8}px`; p.emote.style.top = `${-184 * sc - 54}px`; }
    p.holder.classList.toggle('flip', dir < 0);
    p.host.style.display = ''; p.host.style.zIndex = String(3 + Math.round(sy));
    p.host.style.transform = `translate(${Math.round(R.canvas.offsetLeft + sx)}px, ${Math.round(R.canvas.offsetTop + sy)}px)`;
  }

  // ------------------------------------------------------------ 方块仔的自主生活（活动每几秒切换；按时间/天气/农场状况挑选）
  // 睡觉很少见：只在深夜（23:00-6:00）或刚打工很久回来时才可能打个盹。
  const RIVER_BANK = [3.4, 12.2], SNOW_SPOT = [-8, -8], RIVER_SPOT = [3.4, 12.3], COTTAGE_AT = [12.4, 4.7];
  const CP_AT = (i) => [11 + (i % 3), 1 + Math.floor(i / 3)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  const XPR = () => (window.CUBBIT_EXPR && window.CUBBIT_EXPR.EXPRESSIONS) || {};
  const PARTS = ['eyes', 'mouth', 'body', 'fx'];
  function setExpr(p, name) {
    if (!p || p.exprName === name) return; p.exprName = name;
    const e = XPR()[name] || XPR().happy || { eyes: 'wide', mouth: 'smile' };
    const P = (window.CUBBIT_EXPR && window.CUBBIT_EXPR.PARTS) || {};
    for (const k of PARTS) { for (const v of P[k] || []) p.pet.classList.remove(`${k}--${v}`); if (e[k]) p.pet.classList.add(`${k}--${e[k]}`); }
  }
  const ANIMS = ['walk', 'jump', 'roll', 'dance', 'stretch', 'sneeze', 'wave', 'chase', 'shake', 'sleep', 'lean-r', 'lean-l', 'hop'];
  function setAnim(p, a) { if (p.anim === a) return; p.anim = a; for (const x of ANIMS) p.act.classList.remove('a-' + x); if (a) p.act.classList.add('a-' + a); }
  function setProp(p, ch) { if (p.prop.textContent !== (ch || '')) p.prop.textContent = ch || ''; }
  function setEmote(p, ch) { if (p.emote.textContent !== (ch || '')) { p.emote.textContent = ch || ''; p.emote.classList.toggle('on', !!ch); } }

  const hourNow = () => new Date().getHours();
  const isNight = () => { const h = hourNow(); return h >= 23 || h < 6; };
  const rainy = () => { const w = S.view && S.view.weather; return !!(w && (/雨|rain|snow|雪/i.test(w.desc || '') || w.rain >= 70)); };
  const ripePlot = () => { const v = S.view; if (!v) return null; const i = v.plots.findIndex((p) => p.status === 'ripe'); return i >= 0 ? PLOT_AT(i) : null; };
  const growingPlot = () => { const v = S.view; if (!v) return null; const l = v.plots.map((p, i) => [p, i]).filter(([p]) => p.status === 'growing'); return l.length ? PLOT_AT(pickOne(l)[1]) : null; };
  const hasAnimal = (k) => !!(S.view && S.view.animals.some((a) => !k || a.kind === k));
  const restAfterWork = () => { const r = S.view && S.view.lastReport; return !!(r && r.mins >= 30 && Date.now() - r.at < 10 * 60000); };
  const farmSpot = () => [rnd(0, 9), rnd(0, 6)];

  // 单人活动：w=权重（可按情境变化），to=去哪，steps=[表情, 动作, 道具, 气泡, 毫秒]...
  const SOLO = {
    stroll:    { w: () => 3, to: farmSpot, steps: [['happy', 'walk', '', '🎵', 2600], ['curious', '', '', '', 1600], ['sing', 'hop', '', '🎶', 1800]] },
    water:     { w: () => (growingPlot() ? 3 : 0) + (hourNow() < 10 ? 2 : 0), to: () => growingPlot() || farmSpot(), steps: [['focused', '', '🚿', '💧', 2400], ['content', '', '🚿', '✨', 1600]] },
    chickens:  { w: () => (hasAnimal('chicken') || hasAnimal('goldhen') ? 2.5 : 0), to: () => [rnd(6.2, 8.8), rnd(1.2, 3.6)], steps: [['excited', 'chase', '', '🐔', 1600], ['playful', 'chase', '', '💨', 1600], ['giggle', 'jump', '', '😆', 1400]] },
    petAnimal: { w: () => (hasAnimal() ? 2.5 : 0), to: () => [rnd(6.2, 8.6), rnd(1.4, 3.4)], steps: [['love', 'lean-r', '', '💕', 2200], ['content', '', '', '✨', 1600]] },
    fish:      { w: () => { const h = hourNow(); return h >= 16 && h < 21 ? 3 : 1.2; }, to: () => [RIVER_BANK[0] + rnd(-1.2, 1.2), RIVER_BANK[1]], steps: [['focused', '', '🎣', '', 2600], ['curious', '', '🎣', '❓', 1400], ['excited', 'jump', '🎣', '🐟', 1800]] },
    flowers:   { w: () => (rainy() ? 0.3 : 1.6), to: () => [rnd(-3, -1.2), rnd(1, 6)], steps: [['happy', 'lean-l', '🌼', '🌸', 2000], ['shy', '', '🌼', '💗', 1600]] },
    dance:     { w: () => (hourNow() >= 19 && hourNow() < 23 ? 2.4 : 1.2), to: null, steps: [['joy', 'dance', '', '🎶', 2400], ['sing', 'dance', '', '🎵', 2000]] },
    stretch:   { w: () => (hourNow() >= 6 && hourNow() < 10 ? 3 : 0.8), to: null, steps: [['yawn', 'stretch', '', '', 1800], ['content', '', '', '✨', 1400]] },
    jump:      { w: () => 1.2, to: null, steps: [['excited', 'jump', '', '⭐', 1600], ['joy', 'hop', '', '', 1200]] },
    roll:      { w: () => 1, to: null, steps: [['playful', 'roll', '', '', 1300], ['dizzy', '', '', '💫', 1400], ['giggle', '', '', '', 1000]] },
    sneeze:    { w: () => (rainy() ? 1.5 : 0.6), to: null, steps: [['surprised', '', '', '', 700], ['shocked', 'sneeze', '', '💨', 900], ['awkward', '', '', '💦', 1200]] },
    butterfly: { w: () => (rainy() || isNight() ? 0 : 1.6), to: () => [rnd(-2, 10), rnd(-1.5, 7)], steps: [['curious', 'chase', '', '🦋', 2200], ['starstruck', 'jump', '', '🦋', 1600]] },
    snack:     { w: () => { const h = hourNow(); return (h >= 11 && h < 13) || (h >= 15 && h < 16) ? 3 : 1; }, to: null, steps: [['hungry', '', '🍙', '', 1200], ['yummy', '', '🍙', '😋', 2000], ['content', '', '', '', 1000]] },
    waveCam:   { w: () => 1, to: null, steps: [['wink', 'wave', '', '👋', 1800], ['happy', '', '', '', 1000]] },
    celebrate: { w: () => (ripePlot() ? 3 : 0), to: () => ripePlot() || farmSpot(), steps: [['proud', 'jump', '', '🎉', 1600], ['joy', 'dance', '', '✨', 1600]] },
    umbrella:  { w: () => (rainy() ? 3 : 0), to: farmSpot, steps: [['content', 'walk', '☂️', '🌧️', 2600], ['playful', 'hop', '☂️', '💦', 1600]] },
    think:     { w: () => 0.8, to: null, steps: [['thinking', '', '', '❓', 1600], ['curious', '', '', '💡', 1200]] },
    nap:       { w: () => (isNight() ? 6 : restAfterWork() ? 0.6 : 0), to: () => [0.6, 0.6], steps: [['yawn', 'stretch', '', '', 1400], ['asleep', 'sleep', '', '💤', 6000]] },
  };
  // 情侣双人活动（阿橘在线时）
  const DUO_ACTS = {
    handWalk:   { w: 3, to: farmSpot, a: [['love', 'walk', '', '💞', 3200], ['happy', 'walk', '', '', 1600]], b: [['shy', 'walk', '', '', 3200], ['happy', 'walk', '', '', 1600]], gap: 0.55 },
    hug:        { w: 2, to: farmSpot, a: [['love', 'lean-r', '', '🤗', 2400], ['content', '', '', '💗', 1400]], b: [['content', 'lean-l', '', '', 2400], ['shy', '', '', '', 1400]], gap: 0.45 },
    shareFood:  { w: 2, to: farmSpot, a: [['yummy', '', '🍡', '', 2000], ['happy', 'lean-r', '', '💕', 1400]], b: [['hungry', '', '', '', 1000], ['yummy', 'lean-l', '🍡', '😋', 2400]], gap: 0.6 },
    chase:      { w: 2, to: farmSpot, a: [['giggle', 'chase', '', '😆', 2600], ['playful', 'jump', '', '', 1200]], b: [['playful', 'chase', '', '💨', 2600], ['excited', 'jump', '', '', 1200]], gap: 1.1, chase: true },
    highFive:   { w: 1.6, to: null, a: [['excited', 'jump', '', '✋', 1200], ['joy', '', '', '✨', 1200]], b: [['excited', 'jump', '', '✋', 1200], ['joy', '', '', '', 1200]], gap: 0.5 },
    blush:      { w: 1.6, to: null, a: [['shy', '', '', '💗', 2200]], b: [['kiss', 'lean-l', '', '', 2200]], gap: 0.5 },
    riverSit:   { w: () => (hourNow() >= 16 && hourNow() < 22 ? 3 : 1.2), to: () => [RIVER_BANK[0] + rnd(-1, 1), RIVER_BANK[1]], a: [['content', '', '', '🌅', 3600]], b: [['love', '', '', '', 3600]], gap: 0.55 },
    danceDuo:   { w: 1.8, to: null, a: [['joy', 'dance', '', '🎶', 2600]], b: [['sing', 'dance', '', '🎵', 2600]], gap: 0.6 },
    pillowFight:{ w: 1.4, to: () => [COTTAGE_AT[0] - 0.6, COTTAGE_AT[1] + 0.8], a: [['playful', 'jump', '🛏️', '🪶', 1400], ['giggle', 'hop', '', '🪶', 1400]], b: [['giggle', 'shake', '', '💥', 1400], ['playful', 'jump', '🛏️', '🪶', 1400]], gap: 0.7 },
  };
  const wv = (w) => (typeof w === 'function' ? w() : w);
  function weighted(tbl) { const l = Object.entries(tbl).map(([k, d]) => [k, Math.max(0, wv(d.w))]).filter(([, w]) => w > 0); let r = Math.random() * l.reduce((s, [, w]) => s + w, 0); for (const [k, w] of l) { r -= w; if (r <= 0) return k; } return l.length ? l[0][0] : null; }
  const LIFE = { me: { gx: 0.6, gy: 0.6, tx: 0.6, ty: 0.6, steps: [], until: 0, act: '' }, her: { gx: 11.6, gy: 3.4, tx: 11.6, ty: 3.4, steps: [], until: 0, act: '' }, duo: '', forced: null };
  const partnerHere = () => !!(S.view && S.view.couple && !S.view.couple.partnerAway);
  function plan(t, force) {
    const c = S.view && S.view.couple;
    const duoOk = partnerHere() && R.her;
    let duo = null;
    if (force && DUO_ACTS[force]) duo = force; else if (force && SOLO[force]) duo = null;
    else if (duoOk && Math.random() < 0.55) duo = weighted(DUO_ACTS);
    LIFE.duo = duo || '';
    if (duo) {
      const d = DUO_ACTS[duo]; const [x, y] = d.to ? d.to() : [LIFE.me.gx, LIFE.me.gy];
      startSteps(LIFE.me, duo, x, y, d.a, t); startSteps(LIFE.her, duo, x + d.gap * 1.1, y - d.gap * 0.9, d.b, t);
      LIFE.her.lead = d.chase ? LIFE.me : null;
    } else {
      const k = force || weighted(SOLO); const d = SOLO[k]; const [x, y] = d.to ? d.to() : [LIFE.me.gx, LIFE.me.gy];
      startSteps(LIFE.me, k, x, y, d.steps, t);
      if (duoOk && c) { const k2 = weighted({ ...SOLO, nap: { w: () => (isNight() ? 6 : 0) } }); const d2 = SOLO[k2]; let [x2, y2] = d2.to ? d2.to() : [LIFE.her.gx, LIFE.her.gy]; if (k2 === 'stroll') [x2, y2] = [rnd(10.6, 14), rnd(0.6, 5.6)]; startSteps(LIFE.her, k2, x2, y2, d2.steps, t); LIFE.her.lead = null; }
    }
    S.lastAct = (duo || LIFE.me.act);
  }
  function startSteps(a, act, x, y, steps, t) { a.act = act; a.tx = x; a.ty = y; a.steps = steps.map((s) => s.slice()); a.si = -1; a.stepEnd = 0; a.walking = true; a.t0 = t; }
  function lifeTick(t, dt) {
    if (!R.me) return;
    const v = S.view; if (!v) return;
    if (v.work && !CS.dating) return; // 打工中由 draw() 负责走动
    const done = (a) => a.si >= a.steps.length;
    if (!LIFE.started || (done(LIFE.me) && (!LIFE.her.steps.length || done(LIFE.her) || !partnerHere()))) { LIFE.started = true; plan(t, LIFE.forced); LIFE.forced = null; }
    for (const [a, p] of [[LIFE.me, R.me], [LIFE.her, R.her]]) {
      if (!p || (p === R.her && !partnerHere())) continue;
      if (a.lead) { a.tx = a.lead.gx + 0.75; a.ty = a.lead.gy - 0.6; }
      const dx = a.tx - a.gx, dy = a.ty - a.gy, d = Math.hypot(dx, dy);
      const sp = (a.act === 'chase' || a.act === 'chickens' || a.act === 'butterfly' ? 3.2 : 1.8) * dt / 1000;
      if (d > 0.08 && (a.walking || a.lead)) { const k = Math.min(1, sp / d); a.gx += dx * k; a.gy += dy * k; p.flip = (dx - dy) < 0; if (a.walking) { setAnim(p, 'walk'); setExpr(p, 'happy'); setEmote(p, ''); } }
      else if (a.walking) { a.walking = false; a.si = -1; a.stepEnd = 0; }
      if (!a.walking && t >= a.stepEnd && a.si < a.steps.length) {
        a.si++; const s = a.steps[a.si];
        if (s) { const [ex, an, pr, em, ms] = s; setExpr(p, ex); setAnim(p, an || ''); setProp(p, pr); setEmote(p, em); a.stepEnd = t + ms; }
      }
    }
  }
  /** 野兽靠近：先吓一跳，再鼓起勇气 */
  function petBrave() { if (!R.me) return; startSteps(LIFE.me, 'brave', LIFE.me.gx, LIFE.me.gy, [['nervous', 'shake', '', '😨', 1300], ['determined', 'jump', '', '💪', 1400], ['proud', '', '', '✨', 1200]], performance.now()); LIFE.me.walking = false; }
  window.__farmFocus = (x, y, z) => focusOn([x, y], z); // QA：镜头对准某格
  window.__farmLife = () => ({ me: [LIFE.me.act, +LIFE.me.gx.toFixed(1), +LIFE.me.gy.toFixed(1)], her: [LIFE.her.act, +LIFE.her.gx.toFixed(1), +LIFE.her.gy.toFixed(1)], duo: LIFE.duo });
  window.__farmAct = (k) => { LIFE.forced = k; LIFE.me.si = 99; LIFE.her.si = 99; LIFE.me.steps = []; LIFE.her.steps = []; LIFE.started = false; };
  // ------------------------------------------------------------ 💞 情侣（演示伴侣阿橘；真实同步需服务器）
  const CNAMES = { rose: '玫瑰', lovetulip: '爱心郁金香', heartpumpkin: '爱心南瓜', pair_scarf: '情侣围巾', pair_straw: '情侣草帽', pair_bow: '情侣蝴蝶结', pair_crown: '情侣小王冠', pair_wings: '情侣小翅膀',
    rug: '小地毯', plant: '盆栽', lamp: '暖灯', frame: '合照相框', sofa: '双人沙发', teddy: '泰迪熊', bed: '软软的床', fireplace: '壁炉', piano: '钢琴', river: '河边小桥', snow: '雪山之巅' };
  Object.assign(ERR, { WAIT_PARTNER: '已经照顾过了，等 TA 来照顾', NEED_COUPLE_PASS: '这是情侣年卡专属外观', NEED_FUND: '小屋基金不够（需要 {}）', NEED_TOKENS: '爱心不够（需要 {}）',
    NOT_ANNIVERSARY: '今天不是纪念日', OPENED: '今天的惊喜已经拆开了', NOT_ENOUGH: '仓库里数量不够', PARTNER_HERE: '对方在线，等 TA 不在时再帮忙吧', HELP_DAILY: '今天最多帮忙 {} 次',
    NO_BEAST: '对方农场现在很安全', DATE_LOCKED: '这个约会地点还没解锁', PARTNER_AWAY: '对方现在不在，没法一起打工', PHOTO_FAIL: '拍照失败了' });
  const CS = { seed: 'rose', sub: 'garden', dating: null };
  function panelCouple(P) {
    const v = S.view, c = v.couple, CC = S.cat.COUPLE; if (!c) return;
    const pn = c.partner.name;
    const head = el('div', { class: 'farm-couple-head' });
    head.appendChild(el('div', { class: 'farm-big', text: `💞 ${PET.name} & ${pn}` }));
    head.appendChild(el('div', { class: 'sub', text: c.partnerAway ? `${pn}现在不在（可以帮 TA 浇水、赶野兽）` : `${pn}在农场里` }));
    head.appendChild(el('div', { class: 'farm-row farm-row--wrap' }, el('span', { class: 'farm-chip', text: `💗 ${c.tokens}` }), el('span', { class: 'farm-chip', text: `🏠 ${c.fund}` }), c.premium ? el('span', { class: 'farm-chip', text: '👑 情侣年卡' }) : null));
    P.appendChild(head);
    const subs = [['garden', '🌹 共建农田'], ['cottage', '🏠 小屋'], ['gift', '🎁 送礼代劳'], ['date', '📸 约会'], ['duo', '🤝 双人打工']];
    const nav = el('div', { class: 'farm-row farm-row--wrap farm-subtabs' });
    for (const [id, label] of subs) { const b = el('button', { class: 'farm-tool' + (CS.sub === id ? ' is-on' : ''), type: 'button', text: label }); b.addEventListener('click', () => { CS.sub = id; renderPanel(); if (id === 'cottage' || id === 'date') focusOn(id === 'cottage' ? COTTAGE_AT : RIVER_SPOT); }); nav.appendChild(b); }
    P.appendChild(nav);
    if (c.unread) { for (const n of c.inbox.filter((x) => !x.read).slice(0, 3)) P.appendChild(row(n.emoji, `${n.from}的宠物留言`, fillNote(n))); P.appendChild(el('div', { class: 'farm-row' }, btn('知道啦', () => call('couple', { op: 'readInbox' })))); }
    ({ garden: cGarden, cottage: cCottage, gift: cGift, date: cDate, duo: cDuo })[CS.sub](P, c, CC, pn);
    P.appendChild(el('div', { class: 'farm-note', text: `现在用的是演示伴侣「${pn}」。和真实伴侣实时同步（共建、送礼、代劳留言、双人打工）需要联机服务器，接口已预留，待同步事件 ${c.pendingSync} 条。` }));
  }
  function fillNote(n) { let t = n.text; for (const p of n.params || []) t = t.replace('{}', NAMES[p] || CNAMES[p] || p); return t; }
  function cGarden(P, c, CC, pn) {
    P.appendChild(el('div', { class: 'farm-h', text: '情侣共建农田（农场右边的爱心篱笆里）' }));
    P.appendChild(el('div', { class: 'farm-note', text: `一个人种、一个人浇水，收成翻倍再平分；${pn}在线时会帮你浇水，也会自己种下让你来浇。` }));
    const seeds = [...Object.entries(CC.LOVE_CROPS).map(([id, d]) => [id, d, true]), ...['turnip', 'carrot', 'tomato', 'corn', 'pumpkin'].map((id) => [id, S.cat.CROPS[id], false])];
    for (const [id, d, love] of seeds) {
      const r = row(d.emoji + (d.heart ? '💗' : ''), (NAMES[id] || CNAMES[id]) + (love ? ' · 爱心作物' : ''), love ? `${d.seed} 🪙 · 两人都照顾才会长 · 收获 ${d.tokens} 💗 · ${fmtMin(d.grow)}` : `${d.seed} 🪙 · 共建收成 ×2 平分 · ${fmtMin(d.grow)}`);
      if (CS.seed === id) r.classList.add('is-sel'); r.style.cursor = 'pointer'; r.addEventListener('click', () => { CS.seed = id; renderPanel(); }); P.appendChild(r);
    }
    P.appendChild(el('div', { class: 'farm-h', text: '共建地块' }));
    c.plots.forEach((p, i) => {
      const nm = p.crop ? (NAMES[p.crop] || CNAMES[p.crop]) : '空地';
      const who = p.plantedBy === 'me' ? '你种的' : p.plantedBy === 'partner' ? `${pn}种的` : '';
      const st = !p.crop ? '点「种下」' : p.status === 'ripe' ? '成熟了！' : p.status === 'needCare' ? `等待照顾：你${p.care.me ? '✅' : '⬜'} ${pn}${p.care.partner ? '✅' : '⬜'}` : `还剩 ${mmss(p.leftMs)}${p.wateredBy ? ` · ${p.wateredBy === 'me' ? '你' : pn}浇过水` : ''}`;
      const em = p.crop ? ((CC.LOVE_CROPS[p.crop] || S.cat.CROPS[p.crop]).emoji) : '🟫';
      const act = !p.crop ? btn('种下', () => call('couple', { op: 'plant', plot: i, crop: CS.seed }), true) : p.status === 'ripe' ? btn('收获', async () => { const r = await call('couple', { op: 'harvest', plot: i }); if (r.ok) { toast(r.love ? `收获爱心 +${r.tokens} 💗` : `收获 ${NAMES[r.crop]}：你 ${r.mine} 个，${pn}也分到了`); window.__farmAct('celebrate'); } }, true) : btn(p.love ? '照顾' : '浇水', () => call('couple', { op: 'water', plot: i }));
      P.appendChild(row(em, `${i + 1}. ${nm}${who ? ' · ' + who : ''}`, st, act));
    });
    P.appendChild(el('div', { class: 'farm-h', text: '情侣装（用爱心兑换）' }));
    for (const [id, o] of Object.entries(CC.OUTFITS)) {
      const own = c.outfits.includes(id);
      const sub = (o.premium ? '情侣年卡专属款 · ' : '') + `${o.tokens} 💗 · 两只方块仔一起穿`;
      const b = own ? btn(c.wear === id ? '脱下' : '穿上', () => call('couple', { op: 'wear', item: c.wear === id ? '' : id }), c.wear !== id) : btn(`兑换`, async () => { const r = await call('couple', { op: 'exchange', item: id }); if (r.ok) toast(`换到了「${CNAMES[id]}」，你们一人一件`); }, true, o.premium && !c.premium);
      P.appendChild(row(o.emoji, CNAMES[id], sub, b));
    }
  }
  function cCottage(P, c, CC, pn) {
    P.appendChild(el('div', { class: 'farm-h', text: '情侣小屋' }));
    const room = el('div', { class: 'farm-room' });
    room.appendChild(el('div', { class: 'farm-room-wall' })); room.appendChild(el('div', { class: 'farm-room-floor' }));
    for (const id of c.cottage) { const d = CC.COTTAGE[id]; const it = el('div', { class: 'farm-room-item', text: d.emoji }); it.style.left = d.at[0] + '%'; it.style.top = d.at[1] + '%'; room.appendChild(it); }
    if (c.anniversary.today && !c.anniversary.opened) { const g = el('button', { class: 'farm-room-gift', type: 'button', text: '🎁' }); g.addEventListener('click', async () => { const r = await call('couple', { op: 'openSurprise' }); if (r.ok) { toast(`纪念日惊喜：${r.yearly ? '一周年快乐！' : '月纪念日快乐！'}爱心 +${r.tokens} 💗`); window.__farmAct('hug'); } renderPanel(); }); room.appendChild(g); }
    const pets = el('div', { class: 'farm-room-pets', text: (c.partnerAway ? '' : '') }); room.appendChild(pets);
    const roomPet = (skinId, pal, name, left, expr) => { const p = makePet({ scale: 0.3 }); const sk = skinById(skinId); setPetLook(p, pal || (sk && sk.palette) || NEKO_PAL, skinId, sk, name); p.host.style.cssText += `;left:${left}%;top:86%;z-index:4`; setExpr(p, expr); pets.appendChild(p.host); return p; };
    roomPet(PET.skinId, PET.palette, PET.name, 40, c.anniversary.today ? 'excited' : 'love');
    if (!c.partnerAway) roomPet(c.partner.skinId, null, pn, 62, 'shy');
    P.appendChild(room);
    if (c.anniversary.today) P.appendChild(row('🎉', c.anniversary.opened ? '今天是你们的纪念日 · 惊喜已拆开' : '今天是你们的纪念日！小屋里有一个惊喜', '点小屋里的 🎁'));
    else P.appendChild(row('📅', `纪念日：每月 ${c.anniversary.day} 号小屋里会有惊喜（${c.anniversary.month} 月 ${c.anniversary.day} 日是周年）`, ''));
    P.appendChild(el('div', { class: 'farm-h', text: `小屋基金 ${c.fund} 🪙` }));
    P.appendChild(el('div', { class: 'farm-note', text: `两个人一起存钱装修。演示中${pn}每天会跟投同样的金额（今天还能跟投 ${c.matchLeft}）。` }));
    P.appendChild(el('div', { class: 'farm-row farm-row--wrap' }, btn('存入 50 🪙', async () => { const r = await call('couple', { op: 'contribute', n: 50 }); if (r.ok && r.match) toast(`${pn}也存了 ${r.match} 🪙`); }, true), btn('存入 200 🪙', async () => { const r = await call('couple', { op: 'contribute', n: 200 }); if (r.ok && r.match) toast(`${pn}也存了 ${r.match} 🪙`); })));
    for (const [id, d] of Object.entries(CC.COTTAGE)) {
      const own = c.cottage.includes(id);
      P.appendChild(row(d.emoji, CNAMES[id], (d.premium ? '情侣年卡专属 · ' : '') + `${d.fund} 🪙 基金`, own ? el('span', { class: 'sub', text: '已摆放' }) : btn('买来摆上', () => call('couple', { op: 'buyCottage', item: id }), false, d.premium && !c.premium)));
    }
  }
  function cGift(P, c, CC, pn) {
    P.appendChild(el('div', { class: 'farm-h', text: `送礼给${pn}` }));
    const items = Object.entries(S.view.inv).filter(([, n]) => n > 0);
    if (!items.length) P.appendChild(el('div', { class: 'farm-note', text: '仓库是空的，先去收获点东西吧。' }));
    for (const [id, n] of items) {
      const em = (S.cat.CROPS[id] && S.cat.CROPS[id].emoji) || (Object.values(S.cat.ANIMALS).find((a) => a.product === id) || {}).pEmoji || '📦';
      P.appendChild(row(em, `${NAMES[id] || id} × ${n}`, '', btn('送 1 个', async () => { const r = await call('couple', { op: 'gift', item: id, n: 1 }); if (r.ok) { toast(r.seenOnReturn ? `已送到${pn}的农场，TA 回来就能看到` : `${pn}收到了！`); window.__farmAct('shareFood'); } }, true)));
    }
    P.appendChild(el('div', { class: 'farm-h', text: `帮${pn}代劳（TA 不在时）` }));
    const pf = c.partnerFarm;
    const g = el('div', { class: 'farm-friend-grid' });
    pf.plots.forEach((w, i) => { const cell = el('div', { class: 'farm-fcell' + (w ? '' : ' is-ripe'), text: w ? '💧🌿' : '🥀' }); if (!w) cell.addEventListener('click', async () => { const r = await call('couple', { op: 'help', kind: 'water', plot: i }); if (r.ok) toast(`帮${pn}浇好了，TA 回来会看到你的宠物留言`); renderPanel(); }); g.appendChild(cell); });
    P.appendChild(g);
    P.appendChild(el('div', { class: 'farm-row farm-row--wrap' }, pf.beast ? btn(`🐺 赶走${pn}农场边的狼`, async () => { const r = await call('couple', { op: 'help', kind: 'chase' }); if (r.ok) { toast('赶跑啦！'); petBrave(); } }, true, !c.partnerAway) : el('span', { class: 'sub', text: `${pn}的农场很安全` }), el('span', { class: 'sub', text: `今天还能帮 ${c.helpLeft} 次` })));
    P.appendChild(el('div', { class: 'farm-row farm-row--wrap' }, btn(c.partnerAway ? `（演示）让${pn}回来` : `（演示）让${pn}出门`, () => call('couple', { op: 'demoAway', on: !c.partnerAway }))));
  }
  function cDate(P, c, CC, pn) {
    P.appendChild(el('div', { class: 'farm-h', text: '约会地点' }));
    for (const [id, d] of Object.entries(CC.DATES)) {
      const open = c.dates.includes(id);
      const cost = d.unlock.fund ? `${d.unlock.fund} 🪙 小屋基金` : `${d.unlock.tokens} 💗`;
      P.appendChild(row(d.emoji, CNAMES[id], open ? `已解锁 · 今天第一次约会 +${d.tokens} 💗 · 自动拍照` : `解锁：${cost}`,
        open ? btn('去约会', () => goDate(id), true, c.partnerAway || !!CS.dating) : btn('解锁', () => call('couple', { op: 'unlockDate', spot: id }), true)));
    }
    P.appendChild(el('div', { class: 'farm-h', text: '我们的回忆' }));
    P.appendChild(el('div', { class: 'farm-note', text: c.premium ? '约会照片会自动存进「情侣纪念日相册」。' : '约会照片会保存在这里；开通情侣年卡后会同步进「情侣纪念日相册」。' }));
    const g = el('div', { class: 'farm-album' });
    for (const m of c.memories) { const f = el('div', { class: 'farm-album-item' }); const img = el('img', { alt: '' }); f.appendChild(img); f.appendChild(el('div', { class: 'sub', text: `${CNAMES[m.spot]}${m.album ? ' · 已进相册' : ''}` })); g.appendChild(f); loadMemory(m.id, img); }
    if (!c.memories.length) g.appendChild(el('div', { class: 'farm-note', text: '还没有照片，去约会吧。' }));
    P.appendChild(g);
  }
  const MEMO = {};
  async function loadMemory(id, img) { if (!MEMO[id]) { const r = await app.invoke('farm:call', { action: 'memoryPhoto', args: { id } }); if (r && r.ok) MEMO[id] = r.dataUrl; } if (MEMO[id]) img.src = MEMO[id]; }
  async function goDate(spot) {
    const at = spot === 'river' ? RIVER_SPOT : SNOW_SPOT;
    CS.dating = spot; focusOn(at, 1.25);
    LIFE.me.gx = at[0] - 0.4; LIFE.me.gy = at[1]; LIFE.her.gx = at[0] + 0.4; LIFE.her.gy = at[1] + 0.1;
    startSteps(LIFE.me, 'date', at[0] - 0.3, at[1], [['love', '', '', '💞', 1600], ['wink', 'wave', '', '📸', 2400], ['happy', '', '', '', 1200]], performance.now());
    startSteps(LIFE.her, 'date', at[0] + 0.35, at[1] + 0.1, [['shy', '', '', '', 1600], ['love', 'wave', '', '💗', 2400], ['happy', '', '', '', 1200]], performance.now());
    const r = await call('couple', { op: 'goDate', spot });
    await new Promise((res) => setTimeout(res, 2200));
    const b = R.canvas.getBoundingClientRect();
    const ph = await app.invoke('farm:call', { action: 'datePhoto', args: { spot, rect: { x: b.left, y: b.top, width: b.width, height: b.height } } });
    if (ph && ph.view) S.view = ph.view;
    CS.dating = null;
    toast(ph && ph.ok ? (ph.album ? '📸 合照已存进情侣纪念日相册' : '📸 合照已保存到「我们的回忆」') + (r.tokens ? ` · 💗 +${r.tokens}` : '') : '拍照失败了', ph && ph.ok ? 'ok' : 'warn');
    renderAll();
  }
  function cDuo(P, c, CC, pn) {
    const v = S.view, W = S.cat.WORK;
    P.appendChild(el('div', { class: 'farm-h', text: '双人打工' }));
    P.appendChild(el('div', { class: 'farm-big', text: v.work ? (v.work.duo ? `🤝 ${PET.name}和${pn}手牵手在打工` : `⛏️ ${PET.name}正在一个人打工`) : '🏠 还没出发' }));
    P.appendChild(el('div', { class: 'farm-note', text: `两只方块仔一起去打工，收入 +${Math.round(CC.DUO.bonus * 100)}%，当天上限也提高到 ${Math.round(W.dailyCap * (1 + CC.DUO.capBonus))}。所有情侣都一样，不需要付费。` }));
    P.appendChild(el('div', { class: 'farm-row' }, v.work ? btn('叫它们回来', async () => { const r = await call('endWork'); if (r.ok) toast(`打工 ${r.report.mins} 分钟，赚了 ${r.report.coins} 金币`); }, true) : btn('一起去打工（15 分钟）', () => call('startWork', { duo: true }), true, c.partnerAway)));
    P.appendChild(row('💞', `一起打工 ${c.stats.duo} 次 · 约会 ${c.stats.dates} 次 · 送礼 ${c.stats.gifts} 次 · 代劳 ${c.stats.helps} 次`, ''));
  }
  function focusOn(at, z) { const [x, y] = iso(at[0], at[1]); cam.z = z || cam.z; cam.x = W / 2 - x * cam.z; cam.y = H / 2 - y * cam.z; }

  // ------------------------------------------------------------ 2.5D 世界（可拖动 / 缩放）
  // 世界坐标：等距格子；农场在世界中央，四周是草地、山、河、森林和野生动物。
  // 静态地形只在首次（或尺寸变化时）画到离屏画布，之后每帧只 drawImage + 动态物件，省 GPU/CPU。
  const TW = 64, TH = 32, WN = 48, FX = 18, FY = 18;
  let W = 720, H = 560, dpr = 1, raf = 0, lastDraw = 0;
  const cam = { x: 0, y: 0, z: 1, ready: false };
  const isoW = (gx, gy) => [(gx - gy) * TW / 2, (gx + gy) * TH / 2];
  const iso = (gx, gy) => isoW(gx + FX, gy + FY); // 农场局部坐标 → 世界像素
  const toScreen = (x, y) => [x * cam.z + cam.x, y * cam.z + cam.y];
  const toWorld = (sx, sy) => [(sx - cam.x) / cam.z, (sy - cam.y) / cam.z];
  function unIso(x, y) { const a = x / (TW / 2), b = y / (TH / 2); return [Math.floor((a + b) / 2) - FX, Math.floor((b - a) / 2) - FY]; }
  const PLOT_AT = (i) => [1 + (i % 4), 1 + Math.floor(i / 4)];
  const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  // ---- 地形
  const riverY = (gx) => 32 + Math.sin(gx / 4.2) * 1.6 + gx * 0.08;
  const BRIDGE_X = FX + 2;
  function terrainAt(gx, gy) {
    if (gx + gy < 22 || gx < 3 || gy < 3) return 'mountain';
    if (Math.abs(gy - riverY(gx)) < 1.15) return gx === BRIDGE_X || gx === BRIDGE_X + 1 ? 'bridge' : 'river';
    const fx = gx - FX, fy = gy - FY;
    if (fx >= -1 && fx <= 15 && fy >= -1 && fy <= 7) return 'farm';
    if (gx > 31 || gy > 37 || (gx > 27 && hash2(gx, gy) > 0.55)) return 'forest';
    return 'meadow';
  }
  const WILD_ZONE = []; // 野生动物可以走的格子
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k)))); return `rgb(${c[0]},${c[1]},${c[2]})`; }
  function tilePath(ctx, x, y) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + TW / 2, y + TH / 2); ctx.lineTo(x, y + TH); ctx.lineTo(x - TW / 2, y + TH / 2); ctx.closePath(); }
  const BOUNDS = { x0: -WN * TW / 2 - 40, y0: -260, w: WN * TW + 80, h: WN * TH + 320 };
  function buildTerrain() {
    const c = document.createElement('canvas'); c.width = BOUNDS.w; c.height = BOUNDS.h;
    const ctx = c.getContext('2d'); ctx.translate(-BOUNDS.x0, -BOUNDS.y0);
    const props = [];
    WILD_ZONE.length = 0;
    for (let gy = 0; gy < WN; gy++) for (let gx = 0; gx < WN; gx++) {
      const t = terrainAt(gx, gy); const [x, y] = isoW(gx, gy); const n = hash2(gx, gy);
      const light = 1.08 - (gx + gy) / (WN * 2) * 0.22 + (n - 0.5) * 0.08; // 左上方向的太阳 + 纹理噪声
      let base = '#5d9b47';
      if (t === 'meadow') base = n > 0.85 ? '#78ad4f' : '#5f9e48';
      if (t === 'farm') base = '#6aaa4e';
      if (t === 'forest') base = '#3f7a37';
      if (t === 'mountain') base = '#7b8a6a';
      if (t === 'river' || t === 'bridge') base = '#3a86b8';
      ctx.fillStyle = shade(base, light); tilePath(ctx, x, y); ctx.fill();
      if (t === 'river' || t === 'bridge') { ctx.fillStyle = 'rgba(255,255,255,' + (0.06 + n * 0.1) + ')'; ctx.fillRect(x - 10 + n * 14, y + TH / 2 - 1, 14, 2); }
      else { ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 1; tilePath(ctx, x, y); ctx.stroke(); }
      // 草叶纹理
      if (t === 'meadow' || t === 'farm' || t === 'forest') { ctx.fillStyle = 'rgba(20,60,10,.25)'; for (let k = 0; k < 3; k++) { const a = hash2(gx * 7 + k, gy * 13); ctx.fillRect(x - 14 + a * 28, y + 8 + hash2(gy + k, gx) * 16, 1.5, 3); } }
      if (t === 'forest' && n > 0.25) props.push({ d: gx + gy, kind: 'tree', x, y: y + TH / 2, s: 0.8 + n * 0.6, n });
      if (t === 'meadow' && n < 0.04) props.push({ d: gx + gy, kind: 'rock', x, y: y + TH / 2, s: 0.7 + n * 6 });
      if (t === 'meadow' && n > 0.97) props.push({ d: gx + gy, kind: 'tree', x, y: y + TH / 2, s: 0.9, n });
      if (t === 'mountain' && n > 0.35) props.push({ d: gx + gy, kind: 'peak', x, y: y + TH / 2, s: 0.8 + n * 1.1, n });
      if (t === 'bridge' && gx === BRIDGE_X) props.push({ d: gx + gy + 0.5, kind: 'bridge', x, y: y + TH / 2 });
      if ((t === 'forest' || (t === 'meadow' && (gx > 27 || gy > 33 || gx + gy < 30))) && t !== 'farm') WILD_ZONE.push([gx, gy]);
    }
    props.sort((a, b) => a.d - b.d);
    for (const p of props) {
      if (p.kind === 'tree') {
        const s = p.s; ctx.fillStyle = 'rgba(10,30,5,.35)'; ctx.beginPath(); ctx.ellipse(p.x + 10 * s, p.y + 4, 16 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5a3a1e'; ctx.fillRect(p.x - 2.5 * s, p.y - 12 * s, 5 * s, 13 * s);
        const g = ctx.createLinearGradient(p.x - 16 * s, 0, p.x + 16 * s, 0); g.addColorStop(0, '#5fae4c'); g.addColorStop(1, '#245c25');
        ctx.fillStyle = g;
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(p.x, p.y - (48 - k * 10) * s); ctx.lineTo(p.x + (17 - k * 2) * s, p.y - (14 + k * 8) * s); ctx.lineTo(p.x - (17 - k * 2) * s, p.y - (14 + k * 8) * s); ctx.closePath(); ctx.fill(); }
      } else if (p.kind === 'rock') {
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(p.x + 5, p.y + 2, 10 * p.s, 4 * p.s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9aa0a2'; ctx.beginPath(); ctx.ellipse(p.x, p.y - 4 * p.s, 9 * p.s, 6 * p.s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c8cdce'; ctx.beginPath(); ctx.ellipse(p.x - 3 * p.s, p.y - 6 * p.s, 4 * p.s, 2.5 * p.s, 0, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'peak') {
        const s = p.s, hgt = 70 * s, wd = 46 * s;
        ctx.fillStyle = '#6d7563'; ctx.beginPath(); ctx.moveTo(p.x - wd, p.y); ctx.lineTo(p.x, p.y - hgt); ctx.lineTo(p.x, p.y + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#4a5145'; ctx.beginPath(); ctx.moveTo(p.x + wd, p.y); ctx.lineTo(p.x, p.y - hgt); ctx.lineTo(p.x, p.y + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f4f7fb'; ctx.beginPath(); ctx.moveTo(p.x, p.y - hgt); ctx.lineTo(p.x - wd * 0.3, p.y - hgt * 0.7); ctx.lineTo(p.x - wd * 0.08, p.y - hgt * 0.74); ctx.lineTo(p.x + wd * 0.06, p.y - hgt * 0.66); ctx.lineTo(p.x + wd * 0.3, p.y - hgt * 0.7); ctx.closePath(); ctx.fill();
      } else if (p.kind === 'bridge') {
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(p.x - 6, p.y + 6, 60, 6);
        for (let k = 0; k < 9; k++) { const [bx, by] = [p.x - 30 + k * 7, p.y - 30 + k * 3.5]; ctx.fillStyle = k % 2 ? '#8a5a2c' : '#a06a36'; ctx.save(); ctx.translate(bx + 32, by + 30); ctx.rotate(0.46); ctx.fillRect(-18, -3, 36, 6); ctx.restore(); }
      }
    }
    // 柔和的光照：右下角压暗，左上角提亮
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lg = ctx.createLinearGradient(0, 0, c.width, c.height); lg.addColorStop(0, 'rgba(255,240,200,.10)'); lg.addColorStop(1, 'rgba(0,10,30,.22)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, c.width, c.height);
    R.terrain = c;
  }
  function fitCanvas() {
    const r = R.canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, r.width); H = Math.max(260, r.height);
    R.canvas.width = Math.round(W * dpr); R.canvas.height = Math.round(H * dpr);
    if (!cam.ready) centerFarm();
  }
  function centerFarm() { const [fx, fy] = iso(3, 2.5); cam.z = 1; cam.x = W / 2 - fx; cam.y = H / 2 - fy; cam.ready = true; }
  function zoomAt(sx, sy, k) { const [wx, wy] = toWorld(sx, sy); cam.z = Math.max(0.45, Math.min(2.2, cam.z * k)); cam.x = sx - wx * cam.z; cam.y = sy - wy * cam.z; }
  function diamond(ctx, gx, gy, fill, stroke, lift = 0) {
    const [x, y] = iso(gx, gy);
    ctx.beginPath(); ctx.moveTo(x, y - lift); ctx.lineTo(x + TW / 2, y + TH / 2 - lift); ctx.lineTo(x, y + TH - lift); ctx.lineTo(x - TW / 2, y + TH / 2 - lift); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function soil(ctx, gx, gy, top, side, n) {
    const [x, y] = iso(gx, gy); const d = 7;
    ctx.fillStyle = side; ctx.beginPath(); ctx.moveTo(x - TW / 2 + 4, y + TH / 2); ctx.lineTo(x, y + TH - 2); ctx.lineTo(x + TW / 2 - 4, y + TH / 2); ctx.lineTo(x + TW / 2 - 4, y + TH / 2 + d); ctx.lineTo(x, y + TH - 2 + d); ctx.lineTo(x - TW / 2 + 4, y + TH / 2 + d); ctx.closePath(); ctx.fill();
    ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + TW / 2 - 4, y + TH / 2); ctx.lineTo(x, y + TH - 2); ctx.lineTo(x - TW / 2 + 4, y + TH / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,5,.35)'; ctx.lineWidth = 1.2; for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x - TW / 2 + 4 + k * 7, y + TH / 2 - k * 3.5 + 1); ctx.lineTo(x + k * 7 - 2, y + TH - 2 - k * 3.5 + 1); ctx.stroke(); } // 垄沟
  }
  function emoji(ctx, ch, x, y, size) { if (!ch) return; ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#000'; ctx.fillText(ch, x, y); }
  function blob(ctx, x, y, rx, ry, a = 0.28) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function loop() {
    if (raf) return;
    const step = (t) => {
      raf = 0;
      if (document.hidden) return; // 隐藏/最小化：暂停渲染与野生动物模拟
      if (t - lastDraw > 40) { const dt = Math.min(200, t - (lastDraw || t)); lastDraw = t; wildTick(t, dt); lifeTick(t, dt); draw(t); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ---- 野生动物：只吓人不伤人（不会吃掉作物、动物或任何买来的东西）
  const WILD_KINDS = { wolf: { e: '🐺', speed: 1.3 }, jackal: { e: '🦊', speed: 1.5 }, tiger: { e: '🐅', speed: 1.0 }, leopard: { e: '🐆', speed: 1.4 } };
  const WILD = [];
  let nextVisit = 0;
  function wildInit() {
    if (WILD.length || !WILD_ZONE.length) return;
    ['wolf', 'wolf', 'jackal', 'tiger', 'leopard', 'jackal'].forEach((kind, i) => {
      const [gx, gy] = WILD_ZONE[Math.floor(hash2(i, 99) * WILD_ZONE.length)];
      WILD.push({ id: i, kind, gx, gy, tx: gx, ty: gy, state: 'roam', until: 0, dir: 1 });
    });
  }
  const fenceOn = () => !!(S.view && (S.view.dog || (S.view.decor || []).includes('fence')));
  function wildTick(t, dt) {
    wildInit(); if (!S.view) return;
    if (!nextVisit) nextVisit = t + 12000; // 打开后不久来一只，之后 70~140 秒一次
    for (const a of WILD) {
      const sp = WILD_KINDS[a.kind].speed * dt / 1000 * (a.state === 'flee' ? 3 : 1);
      const dx = a.tx - a.gx, dy = a.ty - a.gy, d = Math.hypot(dx, dy);
      if (d > 0.05) { const k = Math.min(1, sp / d); a.gx += dx * k; a.gy += dy * k; a.dir = (dx - dy) >= 0 ? 1 : -1; }
      if (a.state === 'roam' && d < 0.1 && WILD_ZONE.length) { const [gx, gy] = WILD_ZONE[Math.floor(Math.random() * WILD_ZONE.length)]; if (Math.hypot(gx - a.gx, gy - a.gy) < 8) { a.tx = gx; a.ty = gy; } }
      if (a.state === 'approach' && d < 0.15) { a.state = 'near'; petBrave(); a.until = t + (fenceOn() ? 2200 : 12000); }
      if (a.state === 'near' && t > a.until) scare(a, fenceOn() ? (S.view.dog ? 'dog' : 'fence') : 'pet');
      if (a.state === 'flee' && d < 0.2) a.state = 'roam';
    }
    if (t > nextVisit) {
      nextVisit = t + 70000 + Math.random() * 70000;
      const a = WILD.filter((x) => x.state === 'roam').sort(() => Math.random() - 0.5)[0];
      if (a) { a.state = 'approach'; const side = Math.random() < 0.5; a.tx = FX + (side ? 16.2 : 2 + Math.random() * 5); a.ty = FY + (side ? 1 + Math.random() * 4 : 7.4); }
    }
  }
  async function scare(a, by) {
    if (a.state !== 'near' && a.state !== 'approach') return;
    a.state = 'flee'; const [gx, gy] = WILD_ZONE[Math.floor(Math.random() * WILD_ZONE.length)] || [40, 40]; a.tx = gx; a.ty = gy;
    const nm = NAMES[a.kind];
    if (by === 'dog') toast(`🐕 汪汪！看门狗把${nm}吓跑了`);
    else if (by === 'fence') toast(`🪵 栅栏挡住了${nm}，它悻悻地走了`);
    else if (by === 'click') { const r = await call('scare', { kind: a.kind }); toast(r.ok && r.reward ? `${PET.name}把${nm}吓跑了！勇气奖励 +${r.reward} 🪙` : `${PET.name}把${nm}吓跑了！`); renderHud(); }
    else toast(`${PET.name}鼓起勇气把${nm}吓跑了`);
  }
  window.__farmWildVisit = () => { nextVisit = 1; }; // QA 用：立即来一只

  const DECOR_AT = { fence: [0, 5.2], flowers: [5.3, 0.2], scarecrow: [0.1, 0.3], windmill: [-0.6, 3.6], pond: [5.6, 5.6] };
  function draw(t) {
    const ctx = R.ctx, v = S.view; if (!v || !S.cat) return;
    if (!R.terrain) buildTerrain();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#24401f'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
    ctx.drawImage(R.terrain, BOUNDS.x0, BOUNDS.y0);
    // 河面波光（动态，很轻）
    for (let gx = 0; gx < WN; gx += 2) { const gy = Math.round(riverY(gx)); const [x, y] = isoW(gx, gy); ctx.fillStyle = `rgba(255,255,255,${0.1 + 0.08 * Math.sin(t / 500 + gx)})`; ctx.fillRect(x - 8 + Math.sin(t / 900 + gx) * 6, y + TH / 2, 10, 1.5); }
    // 农场篱笆
    ctx.strokeStyle = '#8a6236'; ctx.lineWidth = 2.5;
    { const c = [iso(-0.5, -0.5), iso(9.5, -0.5), iso(9.5, 6.5), iso(-0.5, 6.5)].map(([x, y]) => [x, y + TH / 2]); ctx.beginPath(); ctx.moveTo(...c[0]); for (const p of c.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.stroke(); for (const [x, y] of c) { ctx.fillStyle = '#6b4826'; ctx.fillRect(x - 2, y - 8, 4, 10); } }
    // 动物栏
    for (let gx = 6; gx < 9; gx++) for (let gy = 1; gy < 4; gy++) diamond(ctx, gx, gy, (gx + gy) & 1 ? '#a8925a' : '#9c8a4e', 'rgba(60,40,10,.35)');
    // 地块：没开垦的是长满杂草的荒地，开垦就是把荒野变成良田
    v.plots.forEach((p, i) => {
      const [gx, gy] = PLOT_AT(i); const [x, y] = iso(gx, gy);
      if (!p.open) { diamond(ctx, gx, gy, '#4c6b34', 'rgba(255,255,255,.05)'); emoji(ctx, i % 3 ? '🌿' : '🪨', x - 8, y + TH * 0.8, 15); emoji(ctx, '🌾', x + 10, y + TH * 0.7, 12); return; }
      soil(ctx, gx, gy, p.watered ? '#5a3a20' : '#7a5232', '#4a2e18');
      if (p.premium) { ctx.fillStyle = 'rgba(160,200,255,.22)'; ctx.fillRect(x - 3, y + TH / 2 - 3, 6, 6); }
      if (S.hover && S.hover.kind === 'plot' && S.hover.i === i) diamond(ctx, gx, gy, 'rgba(255,214,107,.25)', '#ffd66b');
      if (!p.crop) return;
      const c = S.cat.CROPS[p.crop];
      const prog = p.status === 'ripe' ? 1 : 1 - (p.leftMs - (Date.now() - v.now)) / p.totalMs;
      blob(ctx, x + 4, y + TH * 0.72, 10, 3.5, 0.22);
      if (p.status === 'ripe') { const b = Math.sin(t / 300 + i) * 2; emoji(ctx, c.emoji, x, y + TH * 0.8 - b, 26); if ((t / 400 + i) % 4 < 1) emoji(ctx, '✨', x + 14, y + 6, 12); }
      else if (prog < 0.5) emoji(ctx, '🌱', x, y + TH * 0.8, 14 + prog * 10);
      else emoji(ctx, '🌿', x, y + TH * 0.8, 18 + prog * 6);
      if (p.watered && p.status !== 'ripe') emoji(ctx, '💧', x - 16, y + TH * 0.6, 10);
    });
    // 情侣共建农田（爱心篱笆）+ 小屋 + 约会地点
    const cv = v.couple, CC = S.cat.COUPLE;
    if (cv) {
      ctx.strokeStyle = '#e66f9a'; ctx.lineWidth = 2.5;
      { const c = [iso(10.5, 0.5), iso(14.5, 0.5), iso(14.5, 6.2), iso(10.5, 6.2)].map(([x, y]) => [x, y + TH / 2]); ctx.beginPath(); ctx.moveTo(...c[0]); for (const p of c.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.stroke(); for (const [x, y] of c) emoji(ctx, '💗', x, y + 4, 12); }
      cv.plots.forEach((p, i) => {
        const [gx, gy] = CP_AT(i); const [x, y] = iso(gx, gy);
        soil(ctx, gx, gy, p.love ? '#8a4a52' : (p.wateredBy ? '#5a3a20' : '#7a5232'), '#4a2e18');
        if (S.hover && S.hover.kind === 'cplot' && S.hover.i === i) diamond(ctx, gx, gy, 'rgba(255,150,190,.25)', '#ff9cc0');
        if (!p.crop) return;
        const d = CC.LOVE_CROPS[p.crop] || S.cat.CROPS[p.crop];
        blob(ctx, x + 4, y + TH * 0.72, 10, 3.5, 0.22);
        if (p.status === 'ripe') { const b = Math.sin(t / 300 + i) * 2; emoji(ctx, d.emoji, x, y + TH * 0.8 - b, 26); if (d.heart) emoji(ctx, '💗', x + 10, y + 4 - b, 12); }
        else if (p.status === 'needCare') { emoji(ctx, '🌱', x, y + TH * 0.8, 14); emoji(ctx, (p.care.me ? '💗' : '🤍') + (p.care.partner ? '💗' : '🤍'), x, y + 2, 10); }
        else emoji(ctx, p.love ? '🌿' : '🌱', x, y + TH * 0.8, 18);
        if (p.wateredBy && p.status !== 'ripe') emoji(ctx, '💧', x - 16, y + TH * 0.6, 10);
      });
      for (const [id, at] of [['river', RIVER_SPOT], ['snow', SNOW_SPOT]]) {
        const [x, y] = iso(at[0], at[1]); const open = cv.dates.includes(id);
        blob(ctx, x, y + TH / 2, 12, 4); emoji(ctx, open ? (id === 'river' ? '🧺' : '⛺') : '🔒', x, y + TH / 2, 22);
        emoji(ctx, open ? '📍' : '', x, y - 14 + Math.sin(t / 400) * 3, 16);
      }
    }
    // 动态物件按深度排序（动物、装饰、狗、小屋、野生动物）
    const items = [];
    if (cv) items.push({ d: COTTAGE_AT[0] + COTTAGE_AT[1], f: () => { const [x, y] = iso(COTTAGE_AT[0], COTTAGE_AT[1]); blob(ctx, x + 10, y + TH, 30, 9, 0.3); emoji(ctx, '🏠', x, y + TH, 50); emoji(ctx, '💗', x + 4, y - 10 + Math.sin(t / 500) * 2, 14); if (cv.anniversary.today && !cv.anniversary.opened) emoji(ctx, '🎁', x + 26, y + TH, 20); } });
    v.animals.forEach((a, k) => {
      const d = S.cat.ANIMALS[a.kind]; const ph = k * 1.7;
      const gx = 6.5 + (k % 3) + Math.sin(t / 2400 + ph) * 0.35, gy = 1.5 + Math.floor(k / 3) * 0.7 + Math.cos(t / 2900 + ph) * 0.25;
      items.push({ d: gx + gy, f: () => { const [x, y] = iso(gx, gy); blob(ctx, x, y + TH / 2, 10, 4); emoji(ctx, d.emoji, x, y + TH / 2 - Math.abs(Math.sin(t / 260 + ph)) * 3, 24); if (a.status === 'ready') emoji(ctx, d.pEmoji, x + 14, y - 6, 13); if (a.status === 'hungry') emoji(ctx, '💤', x + 14, y - 6, 11); } });
    });
    for (const id of v.decor) { const at = DECOR_AT[id]; if (!at) continue; items.push({ d: at[0] + at[1], f: () => { const [x, y] = iso(at[0], at[1]); blob(ctx, x + 6, y + TH / 2, 14, 5); emoji(ctx, S.cat.DECOR[id].emoji, x, y + TH / 2, 30); } }); }
    if (v.dog) items.push({ d: 1.6, f: () => { const [x, y] = iso(0.2, 1.4); blob(ctx, x, y + TH / 2, 10, 4); emoji(ctx, '🐕', x, y + TH / 2, 24); } });
    items.push({ d: -1.2, f: () => { const [x, y] = iso(-0.6, -0.6); blob(ctx, x + 14, y + TH, 34, 10, 0.3); emoji(ctx, '🏡', x, y + TH, 56); } });
    for (const a of WILD) items.push({ d: a.gx + a.gy - FX - FY, f: () => {
      const [x, y] = isoW(a.gx, a.gy); const big = a.kind === 'tiger' || a.kind === 'leopard';
      blob(ctx, x, y + TH / 2, big ? 14 : 11, 4.5);
      ctx.save(); ctx.translate(x, 0); ctx.scale(a.dir, 1); emoji(ctx, WILD_KINDS[a.kind].e, 0, y + TH / 2 - Math.abs(Math.sin(t / 180 + a.id)) * 2, big ? 30 : 25); ctx.restore();
      if (a.state === 'near' || a.state === 'approach') emoji(ctx, a.state === 'near' ? '❗' : '👀', x, y - 14, 16);
    } });
    items.sort((a, b) => a.d - b.d).forEach((it) => it.f());
    // 方块仔（真正的桌宠 DOM，跟随镜头）
    const wearC = cv && cv.wear ? CC.OUTFITS[cv.wear].emoji : '';
    const hat = wearC || (v.accessories.includes('hat_straw') ? '👒' : '');
    const herOn = R.her && cv && (!cv.partnerAway || (v.work && v.work.duo));
    if (v.work && !CS.dating) {
      const k = (t / 6000) % 1; const pos = k < 0.5 ? k * 2 : 2 - k * 2;
      const gx = 1 + pos * 3.2, gy = 2.6 + Math.sin(t / 1600) * 0.8; const [x, y] = iso(gx, gy);
      placePet(x, y + TH / 2, k < 0.5 ? 1 : -1); emoji(ctx, (t % 900) < 450 ? '💦' : '', x + 22, y - 30, 14);
      LIFE.me.gx = gx; LIFE.me.gy = gy;
      if (v.work.duo && R.her) { const [x2, y2] = iso(gx + 0.55, gy + 0.15); placePet(x2, y2 + TH / 2, k < 0.5 ? 1 : -1, R.her); setAnim(R.her, 'walk'); setExpr(R.her, 'love'); setEmote(R.her, ''); setEmote(R.me, '💞'); LIFE.her.gx = gx + 0.55; LIFE.her.gy = gy + 0.15; }
    } else { const [x, y] = iso(LIFE.me.gx, LIFE.me.gy); placePet(x, y + TH / 2, R.me && R.me.flip ? -1 : 1); }
    if (R.her) { if (herOn && !(v.work && v.work.duo && !CS.dating)) { const [x, y] = iso(LIFE.her.gx, LIFE.her.gy); placePet(x, y + TH / 2, R.her.flip ? -1 : 1, R.her); } else if (!herOn) R.her.host.style.display = 'none'; }
    // 手牵手：两只之间画一颗小爱心
    if (herOn && (LIFE.duo === 'handWalk' || (v.work && v.work.duo))) { const [x1, y1] = iso(LIFE.me.gx, LIFE.me.gy), [x2, y2] = iso(LIFE.her.gx, LIFE.her.gy); emoji(ctx, '💗', (x1 + x2) / 2, (y1 + y2) / 2 + 2, 13); }
    if (R.me) R.me.extra.textContent = hat;
    if (R.her) R.her.extra.textContent = wearC;
  }
  function hit(e) {
    const r = R.canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wy] = toWorld(sx, sy);
    for (const a of WILD) { const [x, y] = isoW(a.gx, a.gy); if (Math.abs(wx - x) < 18 && wy > y - 14 && wy < y + TH / 2 + 4) return { kind: 'wild', a, x: sx, y: sy }; }
    const [gx, gy] = unIso(wx, wy);
    if (S.view && S.view.couple) {
      if (gx >= 11 && gx <= 13 && gy >= 1 && gy <= 2) return { kind: 'cplot', i: (gy - 1) * 3 + (gx - 11), x: sx, y: sy };
      if (Math.abs(gx - COTTAGE_AT[0]) <= 1 && Math.abs(gy - COTTAGE_AT[1]) <= 1) return { kind: 'cottage', x: sx, y: sy };
      for (const [id, at] of [['river', RIVER_SPOT], ['snow', SNOW_SPOT]]) if (Math.abs(gx - Math.floor(at[0])) <= 1 && Math.abs(gy - Math.floor(at[1])) <= 1) return { kind: 'date', id, x: sx, y: sy };
    }
    const i = (gx >= 1 && gx <= 4 && gy >= 1 && gy <= 4) ? (gy - 1) * 4 + (gx - 1) : -1;
    if (i >= 0) return { kind: 'plot', i, x: sx, y: sy };
    if (gx >= 6 && gx <= 8 && gy >= 1 && gy <= 3) return { kind: 'pen', x: sx, y: sy };
    return null;
  }
  function onCanvasMove(e) {
    if (DRAG.on) return;
    S.hover = hit(e); const v = S.view;
    if (!S.hover || !v) { R.tip.style.display = 'none'; return; }
    let text = '';
    if (S.hover.kind === 'plot') {
      const p = v.plots[S.hover.i];
      text = !p.open ? '荒地 · 在「农田」里开垦' : !p.crop ? `空地 · 点击种 ${NAMES[S.seed]}` : p.status === 'ripe' ? `${NAMES[p.crop]} 成熟了，点击收获` : `${NAMES[p.crop]} · 还剩 ${mmss(Math.max(0, p.leftMs - (Date.now() - v.now)))}${p.watered ? ' · 已浇水' : ''}`;
    } else if (S.hover.kind === 'wild') text = S.hover.a.state === 'near' ? `${NAMES[S.hover.a.kind]}靠近了农场，点它吓跑` : `野生的${NAMES[S.hover.a.kind]}`;
    else if (S.hover.kind === 'cplot') { const p = v.couple.plots[S.hover.i]; text = !p.crop ? '情侣共建地 · 点击种下' : p.status === 'ripe' ? '成熟了，点击收获' : p.status === 'needCare' ? '爱心作物：两个人都照顾才会长' : '情侣共建地 · 生长中'; }
    else if (S.hover.kind === 'cottage') text = '情侣小屋：点击进去看看';
    else if (S.hover.kind === 'date') text = v.couple.dates.includes(S.hover.id) ? '约会地点：点击去约会' : '约会地点（未解锁）';
    else text = '动物栏：点击打开动物面板';
    R.tip.textContent = text; R.tip.style.display = 'block'; R.tip.style.left = (S.hover.x + 14) + 'px'; R.tip.style.top = (S.hover.y + 70) + 'px';
  }
  // ---- 拖动平移 / 滚轮缩放
  const DRAG = { on: false, moved: 0, sx: 0, sy: 0, cx: 0, cy: 0 };
  function bindCamera() {
    R.canvas.addEventListener('mousedown', (e) => { if (e.button !== 0) return; Object.assign(DRAG, { on: true, moved: 0, sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }); });
    window.addEventListener('mousemove', (e) => { if (!DRAG.on) return; const dx = e.clientX - DRAG.sx, dy = e.clientY - DRAG.sy; DRAG.moved = Math.max(DRAG.moved, Math.abs(dx) + Math.abs(dy)); if (DRAG.moved > 4) { cam.x = DRAG.cx + dx; cam.y = DRAG.cy + dy; R.canvas.style.cursor = 'grabbing'; R.tip.style.display = 'none'; } });
    window.addEventListener('mouseup', () => { DRAG.on = false; R.canvas.style.cursor = ''; });
    R.canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = R.canvas.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  }
  async function onCanvasClick(e) {
    if (DRAG.moved > 4) return; // 刚才是拖动，不算点击
    const h = hit(e); if (!h) return;
    if (h.kind === 'wild') { if (h.a.state === 'near' || h.a.state === 'approach') scare(h.a, 'click'); return; }
    if (h.kind === 'pen') { S.tab = 'animals'; mountTabs(); renderPanel(); return; }
    if (h.kind === 'cottage' || h.kind === 'date' || h.kind === 'cplot') {
      S.tab = 'couple'; CS.sub = h.kind === 'cottage' ? 'cottage' : h.kind === 'date' ? 'date' : 'garden'; mountTabs();
      if (h.kind === 'cplot') { const p = S.view.couple.plots[h.i]; if (!p.crop) await call('couple', { op: 'plant', plot: h.i, crop: CS.seed }); else if (p.status === 'ripe') await call('couple', { op: 'harvest', plot: h.i }); else await call('couple', { op: 'water', plot: h.i }); }
      renderAll(); return;
    }
    const p = S.view.plots[h.i]; let r;
    if (!p.open) { S.tab = 'field'; mountTabs(); renderPanel(); return; }
    if (p.status === 'ripe') { r = await call('harvest', { plot: h.i }); if (r.ok) toast(`收获 ${NAMES[r.crop]} × ${r.n}` + (r.bonus ? '（会员加成 +1）' : '')); }
    else if (!p.crop) r = await call('plant', { plot: h.i, crop: S.seed });
    else if (S.tool === 'speed') r = await call('speedUp', { plot: h.i });
    else r = await call('water', { plot: h.i });
    renderAll();
  }
})();
