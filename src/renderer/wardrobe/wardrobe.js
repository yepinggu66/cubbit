/**
 * 形象馆 —— 让用户真正"看见"每一个形象再挑选。
 *
 * 依赖：shared/pet-dom.js（外形 DOM）、shared/diy.js（形象数据）
 * IPC：app:state 读状态、app:settings:set 写入 diyPet
 */
(function () {
  'use strict';

  const DIY = window.CUBBIT_DIY;
  const Dom = window.CubbitPetDom;
  const CH_STATE = 'app:state';
  const CH_SET = 'app:settings:set';
  const CH_PANEL_WINDOW = 'app:panel:window';
  const CH_PANEL_OPEN = 'app:panel:open';

  const R = {
    grid: document.getElementById('grid'),
    tip: document.getElementById('tip'),
    toast: document.getElementById('toast'),
    randomBtn: document.getElementById('randomBtn'),
    diyBtn: document.getElementById('diyBtn'),
    closeBtn: document.getElementById('closeBtn'),
    swatches: document.getElementById('swatches'),
    colorPick: document.getElementById('colorPick'),
    customColor: document.getElementById('customColor'),
  };

  const S = {
    state: null,
    current: null,
    busy: false,
    toastTimer: 0,
    cards: new Map(),
  };

  const api = (window.cubbit && window.cubbit.panel) || null;

  // ------------------------------------------------------------------ 工具
  function invoke(channel, payload) {
    if (!api) return Promise.resolve(null);
    return api.invoke(channel, payload).catch((err) => {
      console.warn('[wardrobe] invoke failed', channel, err);
      return null;
    });
  }

  function toast(text) {
    if (!R.toast) return;
    R.toast.textContent = text;
    R.toast.classList.add('is-on');
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => R.toast.classList.remove('is-on'), 1900);
  }

  function readDiy(state) {
    const raw = state && state.settings && state.settings.diyPet;
    return DIY.normalize(raw);
  }

  function configFor(entry) {
    if (entry && entry.id === DIY.EXPLORER_ID) {
      // 探险方块仔：同样保留当前配色与小性格
      const base = S.current || DIY.DEFAULT;
      return DIY.normalize(Object.assign({}, base, { enabled: true, animalId: DIY.EXPLORER_ID }));
    }
    if (!entry || entry.id === 'custom') {
      // 自由组合：保留用户当前的配色与配件，只把形态切回方块
      const base = S.current || DIY.DEFAULT;
      return DIY.normalize(Object.assign({}, base, { enabled: true, animalId: 'custom' }));
    }
    return DIY.normalize(Object.assign({}, entry, { enabled: true, animalId: entry.id }));
  }

  // ------------------------------------------------------------------ 卡片
  function stagePet(cfg) {
    const palette = DIY.palette(cfg);
    const animalId = cfg.animalId;
    const isExplorer = animalId === DIY.EXPLORER_ID;
    // 经典方块仔 = CSS 立体方块；探险方块仔 = 插画（.sprite-form）；照片宠物 = 位图
    const el = Dom.build(palette, { sprite: isExplorer });
    const useArt = !isExplorer && animalId !== 'custom' && DIY.hasArt(animalId);
    el.dataset.animal = animalId;
    el.dataset.diy = 'on';
    el.dataset.hat = cfg.hat && cfg.hat !== 'auto' && cfg.hat !== 'none' ? cfg.hat : '';
    el.dataset.ears = cfg.ears && cfg.ears !== 'auto' && cfg.ears !== 'none' ? cfg.ears : '';
    el.dataset.tail = cfg.tail && cfg.tail !== 'auto' && cfg.tail !== 'none' ? cfg.tail : '';
    const held = el.querySelector('.acc-held');
    if (held) held.textContent = DIY.heldGlyph(cfg) || '';
    // 方块仔本体走插画（Dom.build 已挂好 .sprite-form）；照片宠物走自己的位图
    if (useArt && Dom.sprite && Dom.sprite()) Dom.sprite().detach(el);
    const useSprite = !useArt && el.classList.contains('sprite-form');
    el.classList.toggle('art-form', useArt || useSprite);
    el.classList.toggle('animal-form', animalId !== 'custom' && !useArt && !useSprite);
    if (useArt) {
      const img = el.querySelector('.pet-art');
      if (img) img.src = DIY.artFile(animalId, 'idle');
      // 卡片里也挂上闭眼帧，随机眨一下——静态缩略图看不出「它是活的」
      const fx = el.querySelector('.pet-art-fx');
      if (fx && DIY.hasArtFrame(animalId, 'blink')) fx.src = DIY.artFile(animalId, 'blink');
    }
    el.dataset.temperament = cfg.temperament;
    // 静态展示：去掉拖拽手感，避免误触
    el.style.cursor = 'pointer';
    return el;
  }

  function temperamentOf(id) {
    return DIY.TEMPERAMENTS.find((t) => t.id === id) || DIY.TEMPERAMENTS[0];
  }

  function buildCard(entry) {
    const cfg = configFor(entry);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = entry.id;
    card.setAttribute('aria-label', `换上 ${entry.label}`);

    const badge = document.createElement('span');
    badge.className = 'card__badge';
    badge.textContent = '使用中';

    const stage = document.createElement('div');
    stage.className = 'card__stage';
    stage.appendChild(stagePet(cfg));

    const name = document.createElement('div');
    name.className = 'card__name';
    name.textContent = entry.label;

    const tag = document.createElement('span');
    tag.className = 'card__tag';
    tag.textContent = `${temperamentOf(entry.temperament || cfg.temperament).emoji} ${
      temperamentOf(entry.temperament || cfg.temperament).label
    }`;

    const desc = document.createElement('div');
    desc.className = 'card__desc';
    desc.textContent = entry.desc || '';

    card.append(badge, stage, name, tag, desc);
    card.addEventListener('click', () => select(entry));
    return card;
  }

  function render(current) {
    if (!R.grid) return;
    R.grid.textContent = '';
    S.cards.clear();

    // 方块仔始终保留。11 种整只动物形象由 ANIMAL_PRESETS_ENABLED 控制；关掉后只剩方块仔与用户自拍照。
    const cube = { id: 'custom', label: '方块仔', emoji: '🧡', desc: '经典亮橙小方块，大眼睛、小手小脚，40 多种表情都会。', lines: ['我是方块仔，今天也陪着你'] };
    const explorer = DIY.EXPLORER ? [DIY.EXPLORER] : [];
    const animalEntries = DIY.ANIMAL_PRESETS_ENABLED ? DIY.ANIMALS : [];
    const entries = [cube].concat(explorer).concat(animalEntries).concat(DIY.photoPets());

    for (const entry of entries) {
      const card = buildCard(entry);
      S.cards.set(entry.id, card);
      R.grid.appendChild(card);
    }
    paintActive(current);
  }

  function paintActive(current) {
    for (const [id, card] of S.cards) {
      card.classList.toggle('is-active', id === current.animalId);
    }
  }

  // ------------------------------------------------------------------ 选择
  async function select(entry) {
    if (S.busy) return;
    S.busy = true;
    const next = configFor(entry);
    // 先本地反馈，再等主进程确认：面板操作要"点了就有反应"
    S.current = next;
    paintActive(next);
    try {
      const res = await invoke(CH_SET, { diyPet: next });
      if (res && res.state) applyState(res.state);
      if (entry.id === 'custom') {
        toast('已切回方块仔');
      } else {
        const line = Array.isArray(entry.lines) && entry.lines.length ? entry.lines[0] : '';
        toast(line ? `${entry.label}：${line}` : `换上了「${entry.label}」`);
      }
    } finally {
      S.busy = false;
    }
  }

  async function randomize() {
    if (S.busy) return;
    // 动物预设关闭时没有可随机的整只形象
    if (!DIY.ANIMAL_PRESETS_ENABLED) {
      toast('当前只有方块仔，去自由组合换配色和配件吧');
      return;
    }
    // 只在有渲染图的形象里随机，且避开当前这只，保证每次点都有可见变化
    const pool = DIY.ANIMALS.filter((a) => a.art);
    if (!pool.length) return;
    const cur = S.current && S.current.animalId;
    const choices = pool.filter((a) => a.id !== cur);
    const entry = choices[Math.floor(Math.random() * choices.length)] || pool[0];
    await select(entry);
  }

  // ------------------------------------------------------------------ 身体颜色
  function renderSwatches() {
    if (!R.swatches) return;
    R.swatches.textContent = '';
    for (const p of DIY.PALETTES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.id = p.id;
      b.title = p.label;
      b.setAttribute('aria-label', '身体颜色：' + p.label);
      b.style.background = `linear-gradient(145deg, ${p.body1}, ${p.body2} 55%, ${p.body3})`;
      b.addEventListener('click', () => pickColor({ paletteId: p.id }, `换成了「${p.label}」`));
      R.swatches.appendChild(b);
    }
  }

  // 皮肤衣橱最后被点时（colorSource = 'skin'），桌宠用皮肤配色；卡片也跟着显示皮肤配色，色块不高亮
  function skinColors() {
    return !!(S.state && S.state.colorSource === 'skin' && S.state.palette);
  }

  function paintColor(cfg) {
    if (!cfg) return;
    const bySkin = skinColors();
    if (R.swatches) for (const b of R.swatches.children) b.classList.toggle('is-active', !bySkin && b.dataset.id === cfg.paletteId);
    const isCustom = !bySkin && cfg.paletteId === DIY.CUSTOM_PALETTE_ID;
    if (R.customColor) R.customColor.classList.toggle('is-active', isCustom);
    if (R.colorPick && document.activeElement !== R.colorPick) R.colorPick.value = DIY.palette(cfg).body2;
    // 两张方块仔卡片（经典 / 探险）都跟着换色
    for (const id of ['custom', DIY.EXPLORER_ID]) {
      const card = S.cards.get(id);
      const pet = card && card.querySelector('.pet');
      if (pet) Dom.palette(pet, bySkin ? Object.assign({}, DIY.palette(cfg), S.state.palette) : DIY.palette(cfg));
    }
  }

  let colorTimer = 0;
  async function pickColor(patch, message) {
    const base = S.current || DIY.DEFAULT;
    // 换颜色不换形象：探险方块仔保持探险，其它（含照片）回到经典方块仔
    const keep = base.animalId === DIY.EXPLORER_ID ? DIY.EXPLORER_ID : 'custom';
    const next = DIY.normalize(Object.assign({}, base, patch, { enabled: true, animalId: keep }));
    S.current = next;
    if (S.state) S.state.colorSource = 'diy';
    paintActive(next);
    paintColor(next);
    clearTimeout(colorTimer);
    colorTimer = setTimeout(async () => {
      const res = await invoke(CH_SET, { diyPet: next, colorSource: 'diy' });
      if (res && res.state) applyState(res.state);
      if (message) toast(message);
    }, patch.paletteId === DIY.CUSTOM_PALETTE_ID ? 220 : 0);
  }

  if (R.colorPick) {
    R.colorPick.addEventListener('input', () => pickColor({ paletteId: DIY.CUSTOM_PALETTE_ID, bodyColor: R.colorPick.value }, ''));
    R.colorPick.addEventListener('change', () => pickColor({ paletteId: DIY.CUSTOM_PALETTE_ID, bodyColor: R.colorPick.value }, '换上了自定义颜色'));
  }

  // ------------------------------------------------------------------ 状态
  function applyState(state) {
    if (!state) return;
    S.state = state;
    const current = readDiy(state);
    const changed = !S.current || S.current.animalId !== current.animalId;
    S.current = current;
    paintActive(current);
    paintColor(current);
    if (changed && R.tip) {
      const animal = current.animalId === DIY.EXPLORER_ID ? DIY.EXPLORER : current.animalId !== 'custom' ? DIY.animalById(current.animalId) : null;
      R.tip.textContent = animal
        ? `当前：${animal.label} · ${animal.desc}`
        : '当前：方块仔 · 可自由组合配色、配件和小性格。';
    }
  }

  async function boot() {
    if (!api) {
      // 浏览器直接打开时的降级预览
      S.current = DIY.normalize(Object.assign({}, DIY.DEFAULT, { enabled: true }));
      render(S.current);
      renderSwatches();
      paintColor(S.current);
      return;
    }
    const state = await invoke(CH_STATE);
    // 照片宠物是运行时文件，必须先注册进 DIY，grid 里才会多出"你拍的"那几只
    const photos = await invoke('pet:photo:list');
    if (photos && photos.ok && photos.items && photos.items.length) {
      DIY.registerPhotoPets(photos.items);
    }
    applyState(state);
    render(S.current || readDiy(null));
    renderSwatches();
    paintColor(S.current || readDiy(null));
    api.onState && api.onState(applyState);
  }

  // ------------------------------------------------------------------ 事件
  if (R.closeBtn) R.closeBtn.addEventListener('click', () => invoke(CH_PANEL_WINDOW, { action: 'close' }));
  if (R.randomBtn) R.randomBtn.addEventListener('click', randomize);
  const photoBtn = document.getElementById('photoBtn');
  if (photoBtn) {
    photoBtn.addEventListener('click', async () => {
      await invoke(CH_PANEL_OPEN, { name: 'photo' });
      invoke(CH_PANEL_WINDOW, { action: 'close' });
    });
  }
  if (R.diyBtn) {
    R.diyBtn.addEventListener('click', async () => {
      await invoke(CH_PANEL_OPEN, { name: 'settings' });
      invoke(CH_PANEL_WINDOW, { action: 'close' });
    });
  }
  const storeBtn = document.getElementById('storeBtn');
  if (storeBtn) {
    storeBtn.addEventListener('click', async () => {
      await invoke(CH_PANEL_OPEN, { name: 'store' });
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') invoke(CH_PANEL_WINDOW, { action: 'close' });
  });

  // 让卡片自己眨眼：每次随机挑 1~2 只，间隔也随机，避免整排一起动（很假）
  setInterval(() => {
    const cards = [...document.querySelectorAll('.pet.art-form')];
    if (!cards.length) return;
    const n = Math.min(cards.length, 1 + (Math.random() < 0.35 ? 1 : 0));
    for (let k = 0; k < n; k++) {
      const target = cards.splice((Math.random() * cards.length) | 0, 1)[0];
      if (!target) continue;
      target.classList.add('art-blink');
      setTimeout(() => target.classList.remove('art-blink'), 140);
    }
  }, 1400);

  boot();
})();
