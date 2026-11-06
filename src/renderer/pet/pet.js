/* ============================================================
   Cubbit 桌宠渲染层逻辑
   - 纯前端渲染，数据全部来自主进程 state 快照（window.cubbit.pet）
   - 交互：点击/抚摸/拖拽/甩飞/右键菜单/双击打开设置
   - 情绪：待机、开心、被摸、惊讶、困、难过、专注、落地回弹
   - 命中：向主进程上报可点击矩形，实现像素级点击穿透
   ============================================================ */

(() => {
  'use strict';

  const api = window.cubbit && window.cubbit.pet ? window.cubbit.pet : null;
  const isMock = !api;

  const els = {
    stage: document.getElementById('stage'),
    pets: document.getElementById('pets'),
    bubble: document.getElementById('bubble'),
    bubbleText: document.getElementById('bubbleText'),
    bubbleEmoji: document.getElementById('bubbleEmoji'),
    focusPill: document.getElementById('focusPill'),
    focusTime: document.getElementById('focusTime'),
    focusLabel: document.getElementById('focusLabel'),
    trialBadge: document.getElementById('trialBadge'),
    trialDays: document.getElementById('trialDays'),
    levelChip: document.getElementById('levelChip'),
    fx: document.getElementById('fx'),
    hint: document.getElementById('hint'),
    dragHint: document.getElementById('dragHint'),
  };

  const state = {
    palette: {
      body1: '#ffd9bf',
      body2: '#ef7a52',
      body3: '#c9482a',
      eye: '#2b1a14',
      pupil: '#140c08',
      blush: '#ff8d78',
      rim: '#ffe6d4',
      glow: 'rgba(255,150,110,.45)',
      dark: false,
    },
    settings: { skinId: 'blaze', sizeScale: 1, multiPetCount: 1, reduceMotion: false, onboardingDone: true, voiceEnabled: true, voiceVolume: 0.7, voiceRate: 1.05 },
    license: { state: 'trial', trialDaysLeft: 7, planName: '体验版' },
    ui: { showTrialBadge: true, isPro: false, cinemaMode: false, voiceEnabled: true },
    focus: { running: false, paused: false, remainingMs: 0, label: '' },
    growth: { level: 1, exp: 0 },
    theme: { effectiveDark: false },
    presence: { kind: 'working', cinemaMode: false, app: '', title: '' },
    couple: { enabled: false, partner: null, married: false, messages: [] },
    partnerPalette: null,
  };

  /* 无主进程时的演示状态（浏览器直接打开 index.html 预览用） */
  const mockState = JSON.parse(JSON.stringify(state));
  mockState.ui.showTrialBadge = true;

  const petInstances = [];
  let petCount = 0;
  let partnerInstance = null;
  let cinemaMode = false;
  let quietMode = false;
  let dragHintTimer = 0;
  let voice = { lastAt: 0 };
  let lastCursor = { x: 0, y: 0 };
  let cursorAt = 0;
  let dragging = false;
  let dragStart = null;
  let dragMoved = 0;
  let pokeCooldown = 0;
  let pokeStreak = 0;
  let pokeStreakAt = 0;
  let petStreak = 0;
  let focusWasRunning = false;
  let lastIdleLongAt = 0;
  let lastLateNightAt = 0;
  let petting = { active: false, lastMove: 0, timer: 0 };
  let sleeping = false;
  let powerMode = 'active';
  let happyTimer = null;
  let bubbleQueue = [];
  let bubbleBusy = false;
  let currentBubble = null;
  let bubbleToken = 0;
  let hintShown = false;
  let focusCelebrating = false;

  // ------------------------------------------------------------ 工具
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.round(rand(min, max));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const now = () => performance.now();

  function setCssVars(palette) {
    const root = document.documentElement;
    const map = {
      '--body1': palette.body1,
      '--body2': palette.body2,
      '--body3': palette.body3,
      '--eye': palette.eye,
      '--pupil': palette.pupil,
      '--blush': palette.blush,
      '--rim': palette.rim,
      '--glow': palette.glow,
    };
    Object.entries(map).forEach(([k, v]) => {
      if (v) root.style.setProperty(k, v);
    });
    document.body.classList.toggle('dark', !!palette.dark);
    // 自定义深色机身也要保证嘴巴/眉毛可见：按 body2 亮度自动选嘴色
    try {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(palette.body2 || '').trim());
      const lum = m ? (() => { const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; })() : 1;
      document.body.classList.toggle('body-darkish', !palette.dark && lum < 0.32);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ 宠物 DOM
  const PALETTE_VARS = ['body1', 'body2', 'body3', 'eye', 'pupil', 'blush', 'rim', 'glow'];

  function applyPetPalette(el, palette) {
    if (!el || !palette) return;
    for (const key of PALETTE_VARS) {
      if (palette[key]) el.style.setProperty(`--${key}`, palette[key]);
    }
    el.classList.toggle('pet-dark', !!palette.dark);
  }

  function buildPet(palette, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = opts.partner ? 'pet pet-partner xv2' : 'pet xv2';
    wrap.innerHTML = (window.CubbitPetDom && window.CubbitPetDom.MARKUP) || `
      <div class="shadow"></div>
      <div class="skin-fx"></div>
      <div class="pose">
      <div class="squash">
      <div class="pet-bob">
        <div class="acc acc-tail"></div>
        <div class="arm l"></div>
        <div class="arm r"></div>
        <div class="leg l"></div>
        <div class="leg r"></div>
        <div class="body"></div>
        <div class="face">
          <div class="eye l">
            <div class="eye-inner">
              <div class="sclera"></div>
              <div class="pupil"></div>
              <div class="hl"></div>
              <div class="hl small"></div>
            </div>
            <div class="eye-happy"></div>
            <div class="eye-glyph"></div>
            <div class="tear"></div>
          </div>
          <div class="eye r">
            <div class="eye-inner">
              <div class="sclera"></div>
              <div class="pupil"></div>
              <div class="hl"></div>
              <div class="hl small"></div>
            </div>
            <div class="eye-happy"></div>
            <div class="eye-glyph"></div>
            <div class="tear"></div>
          </div>
          <div class="brow l"></div>
          <div class="brow r"></div>
          <div class="blush l"></div>
          <div class="blush r"></div>
          <div class="mouth"><i class="tongue"></i><i class="teeth"></i></div>
          <div class="emote-fx" aria-hidden="true"></div>
        </div>
        <div class="acc acc-ears"></div>
        <div class="acc acc-hat"></div>
        <div class="acc acc-held"></div>
      </div>
      </div>
      </div>`;
    applyPetPalette(wrap, palette);
    if (opts.partner) {
      const name = document.createElement('div');
      name.className = 'partner-name';
      name.textContent = opts.partnerName || 'TA 的方块仔';
      wrap.appendChild(name);
    }
    return wrap;
  }

  function ensurePetCount(count) {
    const n = clamp(Number(count) || 1, 1, 3);
    if (n === petCount && petInstances.length) {
      ensurePartnerPet();
      return;
    }
    els.pets.innerHTML = '';
    petInstances.length = 0;
    partnerInstance = null;
    for (let i = 0; i < n; i++) {
      const el = buildPet(state.palette);
      els.pets.appendChild(el);
      petInstances.push({
        el,
        inner: el.querySelector('.pet-bob'),
        body: el.querySelector('.body'),
        eyes: [...el.querySelectorAll('.eye-inner')],
        index: i,
      });
      bindPetEvents(el);
    }
    petCount = n;
    ensurePartnerPet();
    scheduleBlink();
    reportHitboxes();
  }

  /** 情侣模式：在主人宠物旁边渲染「TA 的方块仔」 */
  function ensurePartnerPet() {
    const couple = state.couple || {};
    const partner = couple.partner || null;
    const want = !!(couple.enabled && partner && state.partnerPalette);
    if (want && !partnerInstance) {
      const el = buildPet(state.partnerPalette, { partner: true, partnerName: partner.name || 'TA 的方块仔' });
      els.pets.insertBefore(el, petInstances[0] ? petInstances[0].el : null);
      partnerInstance = { el, inner: el.querySelector('.pet-bob'), body: el.querySelector('.body'), eyes: [...el.querySelectorAll('.eye-inner')] };
      bindPartnerEvents(el);
      ensureCoupleHeart();
      setPartnerExpression(partner.online ? 'happy' : 'sleepy', partner.online ? 1800 : 0);
      startPartnerIdle();
    } else if (want && partnerInstance) {
      applyPetPalette(partnerInstance.el, state.partnerPalette);
      if (partnerInstance.el.classList.contains('offline') !== !partner.online) setPartnerExpression(partner.online ? 'excited' : 'sleepy', partner.online ? 2200 : 0);
      partnerInstance.el.classList.toggle('offline', !partner.online);
      const nameEl = partnerInstance.el.querySelector('.partner-name');
      if (nameEl) nameEl.textContent = partner.name || 'TA 的方块仔';
      ensureCoupleHeart();
    } else if (!want && partnerInstance) {
      partnerInstance.el.remove();
      partnerInstance = null;
      const heart = document.getElementById('coupleHeart');
      if (heart) heart.remove();
    }
    document.body.classList.toggle('has-partner', !!partnerInstance);
    reportHitboxes();
  }

  function ensureCoupleHeart() {
    const couple = state.couple || {};
    const exists = document.getElementById('coupleHeart');
    if (couple.enabled && couple.partner && couple.married && !exists) {
      const heart = document.createElement('div');
      heart.id = 'coupleHeart';
      heart.className = 'couple-heart';
      heart.textContent = '💞';
      els.stage.appendChild(heart);
    } else if ((!couple.enabled || !couple.married) && exists) {
      exists.remove();
    }
  }

  function bindPartnerEvents(el) {
    el.addEventListener('pointerenter', () => setPartnerExpression('shy', 1600));
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setPartnerExpression('happy', 1600);
      if (api) api.openPanel('couple');
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (api) api.openPanel('couple');
    });
  }

  const MOOD_CLASSES = ['is-happy', 'is-squint', 'is-surprised', 'is-sleep', 'is-sad', 'is-drag', 'is-land', 'is-focus', 'm-happy', 'm-squint', 'm-surprised', 'm-sad'];
  // v2.1：这些旧心情类只保留身体动画（m-*），脸部交给表情部件系统
  const FACE_MOODS = ['happy', 'squint', 'surprised', 'sad'];
  const moodClass = (mood) => (FACE_MOODS.includes(mood) ? `m-${mood}` : `is-${mood}`);

  function setMood(mood, duration = 0) {
    for (const p of petInstances) {
      p.el.classList.remove(...MOOD_CLASSES);
      p.el.classList.add(moodClass(mood));
    }
    // v1.5：心情同时映射到表情参数（旧 is-* 类保留兼容）
    setExpression(expressionForMood(mood), duration > 0 ? { duration } : {});
    if (duration > 0 && mood !== 'sleep' && mood !== 'focus') {
      clearTimeout(happyTimer);
      happyTimer = setTimeout(() => {
        for (const p of petInstances) p.el.classList.remove(moodClass(mood));
        setExpression(EXPR_DEFAULT, { duration: 320 });
      }, duration);
    }
  }

  function clearMood() {
    for (const p of petInstances) p.el.classList.remove(...MOOD_CLASSES);
    setExpression(EXPR_DEFAULT, { duration: 320 });
  }

  // ============================================================ v2.1 表情部件系统
  // 眼 15 × 嘴 14 × 姿态 6 × 叠加符号 11；命名表情 40+ 见 src/shared/expressions.js
  const XD = window.CUBBIT_EXPR || { PARTS: { eyes: ['wide', 'half', 'crescent'], mouth: ['smile', 'pout', 'o', 'wave'], body: ['lean', 'back', 'slump'], fx: [] }, EXPRESSIONS: {}, pickEvent: () => null, forChat: () => 'happy' };
  const EXPR_KEYS = ['eyes', 'mouth', 'body', 'fx'];
  const EXPR_PREFIX = { eyes: 'eyes--', mouth: 'mouth--', body: 'body--', fx: 'fx--' };
  const EXPR_CLASSES = {};
  for (const k of EXPR_KEYS) EXPR_CLASSES[k] = (XD.PARTS[k] || []).map((v) => EXPR_PREFIX[k] + v);
  const EXPR_DEFAULT = { eyes: 'wide', mouth: 'smile', body: null, fx: null };

  const MOOD_EXPR = {
    calm: 'neutral', happy: 'happy', excited: 'excited', sleepy: 'sleepy', hungry: 'hungry', lonely: 'lonely',
    worried: 'nervous', proud: 'proud', focus: 'focused', sleep: 'asleep', squint: 'content', sad: 'sad',
    surprised: 'surprised', drag: 'nervous', land: 'surprised',
  };

  let exprState = Object.assign({}, EXPR_DEFAULT);
  let exprName = 'neutral';
  let exprRestoreTimer = null;

  function resolveExpr(input) {
    if (typeof input === 'string') return XD.EXPRESSIONS[input] || null;
    return input || null;
  }

  function normalizeExpr(input) {
    const src = resolveExpr(input) || {};
    const out = {};
    for (const key of EXPR_KEYS) {
      const value = src[key];
      if (value && EXPR_CLASSES[key].includes(EXPR_PREFIX[key] + value)) out[key] = value;
    }
    return out;
  }

  function popPet(p, kind) {
    // 共享 squash & stretch：先蓄力（anticipation）再回弹（overshoot）
    const sq = p.el.querySelector('.squash');
    if (!sq || document.body.classList.contains('reduce-motion')) return;
    sq.classList.remove('sq-pop', 'sq-big', 'sq-shrink');
    void sq.offsetWidth;
    sq.classList.add(kind || 'sq-pop');
  }

  function applyExpressionToPet(p, expr) {
    if (!p || !p.el) return;
    for (const key of EXPR_KEYS) {
      p.el.classList.remove(...EXPR_CLASSES[key]);
      const value = expr[key];
      if (value) p.el.classList.add(EXPR_PREFIX[key] + value);
    }
  }

  // ============================================================ v2.4 情侣 TA 的方块仔：同一套表情部件系统
  let partnerExprTimer = null;
  let partnerIdleTimer = null;
  function setPartnerExpression(next, duration = 0) {
    if (!partnerInstance) return null;
    const expr = Object.assign({}, EXPR_DEFAULT, normalizeExpr(next));
    applyExpressionToPet(partnerInstance, expr);
    partnerInstance.el.dataset.expr = typeof next === 'string' ? next : 'custom';
    popPet(partnerInstance);
    clearTimeout(partnerExprTimer);
    if (duration > 0) {
      partnerExprTimer = setTimeout(() => {
        const offline = partnerInstance && partnerInstance.el.classList.contains('offline');
        setPartnerExpression(offline ? 'sleepy' : 'neutral', 0);
      }, duration);
    }
    return expr;
  }
  function startPartnerIdle() {
    clearTimeout(partnerIdleTimer);
    partnerIdleTimer = setTimeout(() => {
      if (!partnerInstance) return;
      const offline = partnerInstance.el.classList.contains('offline');
      if (!offline && !cinemaMode) setPartnerExpression(pick(['content', 'happy', 'curious', 'wink', 'playful', 'giggle', 'love']), 2200);
      startPartnerIdle();
    }, rand(9000, 16000));
  }

  /** 统一表情入口：setExpression('love' | {eyes,mouth,body,fx}, {duration, pop}) */
  function setExpression(next, opts = {}) {
    const name = typeof next === 'string' ? next : null;
    const expr = Object.assign({}, EXPR_DEFAULT, normalizeExpr(next));
    const changed = EXPR_KEYS.some((k) => (exprState[k] || null) !== (expr[k] || null));
    exprState = expr;
    exprName = name || 'custom';
    for (const p of petInstances) {
      applyExpressionToPet(p, expr);
      if (changed && opts.pop !== false) popPet(p, opts.popKind);
    }
    clearTimeout(exprRestoreTimer);
    if (opts.duration > 0) {
      exprRestoreTimer = setTimeout(() => setExpression(EXPR_DEFAULT, { pop: false }), opts.duration);
    }
    return expr;
  }

  /** 事件驱动表情：从 EVENT_EXPRESSIONS 加权抽取 */
  function emote(eventName, opts = {}) {
    const hit = XD.pickEvent(eventName);
    if (!hit) return null;
    const def = XD.EXPRESSIONS[hit.name] || {};
    const duration = opts.duration || hit.duration || def.duration || 1600;
    setExpression(hit.name, { duration, popKind: opts.popKind });
    return hit.name;
  }

  function expressionForMood(mood) {
    return MOOD_EXPR[mood] || EXPR_DEFAULT;
  }

  // ============================================================ v1.5 待机行为
  const IDLE_CLASSES = ['idle-sig', 'idle-breathe', 'idle-stretch', 'idle-hop', 'idle-shake', 'idle-sway', 'idle-nod', 'idle-spin', 'idle-daze', 'is-drool'];
  const IDLE_ACTIONS = [
    { name: 'yawn', weight: 8, duration: 1800, cls: 'idle-breathe', expr: { eyes: 'half', mouth: 'o', body: 'slump' } },
    { name: 'stretch', weight: 6, duration: 1500, cls: 'idle-stretch', expr: { eyes: 'wide', mouth: 'smile', body: 'lean' } },
    { name: 'lookAround', weight: 10, duration: 2200, look: true, expr: { eyes: 'wide', mouth: 'smile', body: null } },
    { name: 'daze', weight: 9, duration: 2600, cls: 'idle-daze', expr: { eyes: 'half', mouth: 'smile', body: 'back' } },
    { name: 'swayLeg', weight: 7, duration: 2000, cls: 'idle-sway', expr: { eyes: 'wide', mouth: 'smile', body: null } },
    { name: 'doze', weight: 6, duration: 3200, cls: 'idle-breathe', expr: { eyes: 'half', mouth: 'o', body: 'slump' } },
    { name: 'tailChase', weight: 4, duration: 1500, cls: 'idle-spin', expr: { eyes: 'wide', mouth: 'wave', body: 'lean' } },
    { name: 'nod', weight: 8, duration: 1500, cls: 'idle-nod', expr: { eyes: 'crescent', mouth: 'smile', body: 'lean' } },
    { name: 'hop', weight: 6, duration: 900, cls: 'idle-hop', expr: { eyes: 'crescent', mouth: 'wave', body: 'lean' } },
    { name: 'sigh', weight: 5, duration: 1700, cls: 'idle-breathe', expr: { eyes: 'half', mouth: 'pout', body: 'back' } },
    { name: 'hum', weight: 5, duration: 2000, cls: 'idle-sway', expr: { eyes: 'crescent', mouth: 'smile', body: 'back' } },
    { name: 'headTilt', weight: 6, duration: 900, cls: 'idle-shake', expr: { eyes: 'wide', mouth: 'smile', body: null } },
    { name: 'signature', weight: 10, duration: 2400, cls: 'idle-sig', sig: true, expr: 'proud' },
    { name: 'sing', weight: 5, duration: 2200, cls: 'idle-sway', expr: 'sing' },
    { name: 'drool', weight: 7, duration: 3400, cls: 'is-drool', expr: { eyes: 'sleepy', mouth: 'tongue', body: 'slump' } },
    { name: 'giggle', weight: 4, duration: 1400, cls: 'idle-shake', expr: 'giggle' },
    { name: 'think', weight: 4, duration: 2000, look: true, expr: 'thinking' },
    { name: 'wink', weight: 4, duration: 1200, expr: 'wink' },
    { name: 'smug', weight: 3, duration: 1600, cls: 'idle-nod', expr: 'smug' },
  ];

  let activityNodAt = 0;
  let idleActive = null;
  let idleCooldownUntil = 0;
  let lastUserActivityAt = performance.now();

  function markActivity(reason) {
    lastUserActivityAt = performance.now();
    if (idleActive && reason !== 'behavior') cancelIdle('user');
  }

  function cancelIdle(reason) {
    if (!idleActive) return;
    const active = idleActive;
    clearTimeout(active.timer);
    idleActive = null;
    for (const p of petInstances) p.el.classList.remove(...IDLE_CLASSES);
    if (reason !== 'behavior') {
      setExpression(EXPR_DEFAULT, { duration: 260 });
      idleCooldownUntil = performance.now() + 1200;
    }
  }

  function pickWeightedIdle() {
    const total = IDLE_ACTIONS.reduce((sum, a) => sum + a.weight, 0);
    let roll = Math.random() * total;
    for (const action of IDLE_ACTIONS) {
      roll -= action.weight;
      if (roll <= 0) return action;
    }
    return IDLE_ACTIONS[0];
  }

  function startIdle(action) {
    cancelIdle('behavior');
    for (const p of petInstances) if (action.cls) p.el.classList.add(action.cls);
    if (action.expr) setExpression(action.expr, { duration: action.duration });
    if (action.sig) skinSignature();
    if (action.look) {
      const dir = pick(['look-left', 'look-right']);
      for (const p of petInstances) p.el.classList.add(dir);
      setTimeout(() => {
        for (const p of petInstances) p.el.classList.remove('look-left', 'look-right');
      }, Math.min(action.duration, 1200));
    }
    const timer = setTimeout(() => {
      for (const p of petInstances) p.el.classList.remove(...IDLE_CLASSES);
      idleActive = null;
      setExpression(EXPR_DEFAULT, { duration: 300 });
      idleCooldownUntil = performance.now() + rand(900, 2000);
    }, action.duration);
    idleActive = { action, timer };
  }

  function triggerIdle(name) {
    const action = name ? IDLE_ACTIONS.find((a) => a.name === name) : pickWeightedIdle();
    if (!action) return false;
    if (name && !idleAllowed(true)) return false;
    startIdle(action);
    return action.name;
  }

  function idleAllowed(force) {
    const t = performance.now();
    if (dragging || sleeping || focusCelebrating || cinemaMode || quietMode || petting.active || idleActive) return false;
    if (document.body.classList.contains('reduce-motion')) return false;
    if (force) return true;
    return t > idleCooldownUntil && t - lastUserActivityAt > 12000;
  }

  function scheduleIdle() {
    clearTimeout(scheduleIdle._t);
    scheduleIdle._t = setTimeout(() => {
      if (idleAllowed() && Math.random() < 0.72) triggerIdle();
      scheduleIdle();
    }, rand(7000, 15000));
  }

  // ============================================================ v1.5 皮肤特效
  const SKIN_EFFECTS = {
    blaze: 'warm-glow',
    citrus: 'warm-glow',
    cloud: 'cloud-drift',
    aurora: 'aurora-flow',
    pumpkin: 'pumpkin-sparks',
    nightowl: 'star-glow',
    sakura: 'petals',
    mint: 'bubbles',
    chrome: 'sheen',
    nebula: 'aurora-flow',
  };

  function skinMeta(id) {
    const list = Array.isArray(state.skins) ? state.skins : [];
    return list.find((s) => s.id === id) || null;
  }

  function applySkinAccessories(p, meta) {
    const acc = (meta && meta.accessory) || {};
    p.el.dataset.hat = acc.hat || '';
    p.el.dataset.ears = acc.ears || '';
    p.el.dataset.tail = acc.tail || '';
    p.el.dataset.idle = (meta && meta.idle) || 'wiggle';
    const held = p.el.querySelector('.acc-held');
    if (held) held.textContent = acc.held || '';
  }

  function skinParticles(count = 4) {
    const meta = skinMeta(state.settings.skinId);
    const parts = (meta && meta.particles) || ['✨'];
    const c = petAnchor(0);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnFx(pick(parts), { className: 'spark', x: c.x + side * rand(50, 110), y: c.y - rand(20, 120), dx: side * rand(6, 22), size: randInt(13, 19) });
      }, i * 110);
    }
  }

  /** 皮肤专属：待机动作 + 粒子 + 台词 */
  function skinSignature() {
    const meta = skinMeta(state.settings.skinId);
    skinParticles(5);
    if (meta && Array.isArray(meta.lines) && meta.lines.length && !cinemaMode && !quietMode && Math.random() < 0.45) {
      showBubble(pick(meta.lines), { emoji: (meta.particles && meta.particles[0]) || '✨', ms: 2400 });
    }
  }

  function applySkin(skinId) {
    const id = String(skinId || 'blaze');
    state.settings.skinId = id;
    const meta = skinMeta(id);
    const fx = (meta && meta.effect) || SKIN_EFFECTS[id] || 'warm-glow';
    const all = petInstances.slice();
    if (partnerInstance) all.push(partnerInstance);
    for (const p of all) {
      if (!p || !p.el) continue;
      p.el.dataset.skin = id;
      p.el.dataset.skinFx = fx;
      applySkinAccessories(p, p === partnerInstance ? skinMeta((state.couple && state.couple.partner && state.couple.partner.skinId) || id) : meta);
    }
  }

  function cleanPreview(text) {
    return String(text || '')
      .replace(/（[^）]*）/g, ' ')
      .replace(/[~～…]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()   
      .slice(0, 80);
  }

  // ------------------------------------------------------------ 说话（TTS）
  function speak(text, { kind = 'chat', force = false } = {}) {
    try {
      if (!text) return;
      if (!force && (!state.settings.voiceEnabled || !state.ui.voiceEnabled)) return;
      if (!force && (cinemaMode || quietMode)) return;
      // 优先走主进程的 Windows SAPI（Chromium 在本机没有 web speech 语音）
      if (api && api.tts) {
        api.tts(cleanPreview(String(text)), kind).catch(() => {});
        return;
      }
      if (!('speechSynthesis' in window)) return;
      const t = now();
      if (t - voice.lastAt < 2200) return;
      voice.lastAt = t;
      const clean = String(text)
        .replace(/（[^）]*）/g, ' ')
        .replace(/[~～…]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      const voices = window.speechSynthesis.getVoices() || [];
      const zh = voices.find((v) => /zh[_-]?CN|Chinese|Huihui|Yaoyao|Xiaoxiao|Kangkang|Ting-?Ting/i.test(`${v.lang} ${v.name}`));
      if (zh) u.voice = zh;
      u.lang = 'zh-CN';
      u.rate = clamp(Number(state.settings.voiceRate) || 1.05, 0.7, 1.5);
      u.volume = clamp(Number(state.settings.voiceVolume) || 0.7, 0, 1);
      const vp = Number(state.settings.voicePitch) || 0;
      u.pitch = vp ? clamp(vp + (kind === 'love' ? 0.1 : 0), 0.5, 2) : kind === 'love' ? 1.22 : 1.12;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* 语音不可用时静默降级 */
    }
  }

  // ------------------------------------------------------------ 气泡
  /**
   * 气泡队列。priority=true 的重要气泡（任务完成/提醒/语音对话）会打断普通台词，
   * 并且在它显示期间随机台词一律丢弃，保证用户一定能看到。
   */
  function showBubble(text, { emoji = '', ms = 2600, voice: speakIt = false, priority = false, silent = false, replaceable = false, noTranslate = false, action = '' } = {}) {
    if (!text) return;
    if (window.CubbitI18N && !noTranslate) text = window.CubbitI18N.t(String(text));
    if (window.CubbitPetDom) text = window.CubbitPetDom.name(text, state.settings && state.settings.petName);
    if (!priority && ((currentBubble && currentBubble.priority) || bubbleQueue.some((b) => b.priority))) return;
    const item = { text, emoji, ms, priority, replaceable, action };
    if (priority) {
      bubbleQueue = bubbleQueue.filter((b) => b.priority && !b.replaceable);
      bubbleQueue.push(item);
      if (bubbleBusy && currentBubble && (!currentBubble.priority || currentBubble.replaceable)) {
        clearTimeout(showBubble._timer);
        bubbleBusy = false;
      }
    } else {
      bubbleQueue.push(item);
    }
    if (!bubbleBusy) drainBubble();
    if (!silent && (speakIt || priority || state.settings.voiceAllBubbles !== false)) speak(text);
  }

  function drainBubble() {
    if (!bubbleQueue.length) {
      bubbleBusy = false;
      currentBubble = null;
      return;
    }
    bubbleBusy = true;
    const item = bubbleQueue.shift();
    currentBubble = item;
    const token = ++bubbleToken;
    document.body.dataset.bubble = item.text;
    els.bubble.classList.remove('hidden');
    els.bubble.dataset.action = item.action || '';
    els.bubble.classList.toggle('clickable', !!item.action);
    els.bubbleEmoji.textContent = item.emoji || '';
    els.bubbleEmoji.classList.toggle('show', !!item.emoji);
    els.bubbleText.textContent = '';
    requestAnimationFrame(() => { els.bubble.classList.add('show'); positionBubble(); });
    reportHitboxes();

    // 打字机效果
    const chars = [...item.text];
    let i = 0;
    const type = () => {
      if (i >= chars.length || token !== bubbleToken) return;
      els.bubbleText.textContent += chars[i++];
      setTimeout(type, 26);
    };
    type();

    clearTimeout(showBubble._timer);
    showBubble._timer = setTimeout(() => {
      els.bubble.classList.remove('show');
      setTimeout(() => {
        if (token !== bubbleToken) return;
        els.bubble.classList.add('hidden');
        els.bubbleText.textContent = '';
        reportHitboxes();
        drainBubble();
      }, 190);
    }, Math.max(item.ms, chars.length * 26 + 800));
  }

  /** 让气泡锚定在主宠物上方（情侣双宠/多宠时也能贴着宠物） */
  function positionBubble() {
    try {
      const p = petInstances[0];
      if (!p) return;
      const r = p.el.getBoundingClientRect();
      const w = els.bubble.offsetWidth || 200;
      const half = w / 2;
      const cx = r.left + r.width / 2;
      const left = Math.min(Math.max(cx, half + 12), window.innerWidth - half - 12);
      els.bubble.style.left = `${Math.round(left)}px`;
      const tail = els.bubble.querySelector('.bubble-tail');
      if (tail) {
        const tailLeft = Math.round(Math.min(Math.max(cx - (left - half) - 8, 14), w - 30));
        tail.style.left = `${tailLeft}px`;
      }
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ 粒子
  function spawnFx(char, opts = {}) {
    const el = document.createElement('div');
    el.className = `fx-item ${opts.className || ''}`;
    el.textContent = char;
    const x = opts.x != null ? opts.x : rand(90, 290);
    const y = opts.y != null ? opts.y : rand(240, 320);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--dx', `${opts.dx != null ? opts.dx : rand(-30, 30)}px`);
    el.style.setProperty('--rot', `${opts.rot != null ? opts.rot : rand(-24, 24)}deg`);
    if (opts.size) el.style.fontSize = `${opts.size}px`;
    if (opts.color) el.style.color = opts.color;
    els.fx.appendChild(el);
    setTimeout(() => el.remove(), opts.className === 'zzz' ? 2800 : 1500);
  }

  /** 粒子起点：宠物身体底部（避免从脸部/眼睛位置冒出） */
  function petAnchor(index = 0) {
    const p = petInstances[index];
    if (!p) return { x: 190, y: 430 };
    const r = p.body.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom - 6 };
  }

  function petCenter(index = 0) {
    const p = petInstances[index];
    if (!p) return { x: 190, y: 340 };
    const r = p.body.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
  }

  function hearts(count = 6) {
    const c = petAnchor(0);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnFx(pick(['❤️', '💛', '💗']), {
          x: c.x + side * rand(52, 96),
          y: c.y - rand(2, 26),
          dx: side * rand(8, 26),
          size: randInt(13, 20),
        });
      }, i * 80);
    }
  }

  function sparkles(count = 8) {
    const c = petAnchor(0);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const side = i % 2 === 0 ? -1 : 1;
        spawnFx(pick(['✨', '⭐', '💫']), {
          className: 'spark',
          x: c.x + side * rand(70, 130),
          y: c.y - rand(0, 70),
          size: randInt(11, 18),
        });
      }, i * 60);
    }
  }

  function dust() {
    const c = petCenter(0);
    for (let i = 0; i < 5; i++) {
      spawnFx('', {
        className: 'dust',
        x: c.x + rand(-70, 70),
        y: c.y + 80,
        dx: rand(-16, 16),
      });
    }
  }

  function zzzLoop() {
    if (!sleeping) return;
    spawnFx('💤', { className: 'zzz', x: 280, y: 260, size: 16 });
    setTimeout(zzzLoop, rand(2600, 4200));
  }

  // ------------------------------------------------------------ 命中矩形上报
  let hitboxTimer = 0;
  function paddedRect(el, pad = 12) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left - pad,
      y: r.top - pad,
      w: r.width + pad * 2,
      h: r.height + pad * 2,
    };
  }

  /** 上报「看得见的身体」矩形（所有方块仔合起来），主进程据此让身体贴到屏幕边缘 */
  function pushBody(rects) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const els2 = petInstances.map((p) => p.el).concat(partnerInstance ? [partnerInstance.el] : []);
    for (const e of els2) {
      if (!e) continue;
      const parts = e.querySelectorAll('.body, .arm, .leg');
      for (const part of (parts.length ? parts : [e])) {
        const r = part.getBoundingClientRect();
        if (!(r.width > 0)) continue;
        x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
      }
    }
    if (Number.isFinite(x1)) rects.push({ x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1), body: 1 });
  }

  function reportHitboxes() {
    if (!api) return;
    clearTimeout(hitboxTimer);
    hitboxTimer = setTimeout(() => {
      const rects = [];
      const push = (r) => {
        if (!r || !(r.w > 0) || !(r.h > 0)) return;
        rects.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      };
      // 观影模式：只上报眼睛附近的可拖动区域（比眼睛大，方便再次拖动/退出）
      if (cinemaMode) {
        for (const p of petInstances) {
          const eyes = p.el.querySelectorAll('.eye');
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          eyes.forEach((e) => {
            const r = e.getBoundingClientRect();
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.right);
            maxY = Math.max(maxY, r.bottom);
          });
          if (Number.isFinite(minX)) {
            push({ x: minX - 34, y: minY - 30, w: maxX - minX + 68, h: maxY - minY + 60 });
          }
        }
        if (partnerInstance) push(paddedRect(partnerInstance.el, 10));
        pushBody(rects);
        api.setHitboxes(rects).catch(() => {});
        return;
      }
      for (const p of petInstances) {
        push(paddedRect(p.el, 14));
        // 头顶「抓取区」：让用户更容易按住拖动（视觉上不存在，但可交互）
        const r = p.el.getBoundingClientRect();
        push({ x: r.left + r.width * 0.18, y: r.top - 46, w: r.width * 0.64, h: 64 });
      }
      if (partnerInstance) push(paddedRect(partnerInstance.el, 12));
      // 气泡 / 角标 / 胶囊
      [els.bubble, els.trialBadge, els.focusPill, els.levelChip].forEach((el) => {
        if (!el || el.classList.contains('hidden')) return;
        push(paddedRect(el, 4));
      });
      pushBody(rects);
      api.setHitboxes(rects).catch(() => {});
    }, 40);
  }

  // ------------------------------------------------------------ 拖动提示
  function showDragHint() {
    clearTimeout(dragHintTimer);
    dragHintTimer = setTimeout(() => {
      if (dragging) return;
      els.dragHint.textContent = cinemaMode ? '按住发光的眼睛也可以拖动' : '按住我拖动 · 双击打开设置';
      els.dragHint.classList.add('show');
      setTimeout(() => els.dragHint.classList.remove('show'), 3200);
    }, 750);
  }

  function hideDragHint() {
    clearTimeout(dragHintTimer);
    els.dragHint.classList.remove('show');
  }

  // ------------------------------------------------------------ 点击 / 拖拽
  function bindPetEvents(el) {
    el.addEventListener('pointerenter', () => showDragHint());
    el.addEventListener('pointerleave', () => hideDragHint());
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointermove', onPointerMoveOverPet);
    el.addEventListener('pointerleave', () => {
      petting.active = false;
      petStreak = 0;
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (api) api.contextMenu();
    });
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (api) api.openPanel('settings');
    });
  }

  let droolHoldTimer = 0;
  function clearDroolHold() { if (droolHoldTimer) { clearTimeout(droolHoldTimer); droolHoldTimer = 0; } }
  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    hideDragHint();
    markActivity('pointer');
    dragging = true;
    dragMoved = 0;
    dragStart = { x: e.clientX, y: e.clientY, at: now() };
    if (api) api.dragStart({ offsetX: e.clientX, offsetY: e.clientY });
    setMood('drag');
    emote('drag', { duration: 60000 });
    // 按住不动 1.4 秒：它开始发呆流口水
    clearDroolHold();
    droolHoldTimer = setTimeout(() => {
      if (!dragging || dragMoved > 8) return;
      for (const p of petInstances) p.el.classList.add('is-drool');
      setTimeout(() => { for (const p of petInstances) p.el.classList.remove('is-drool'); }, 3300);
    }, 1400);
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMoveWindow(e) {
    if (!dragging) return;
    dragMoved = Math.max(dragMoved, Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y));
  }

  async function onPointerUp(e) {
    clearDroolHold();
    if (!dragging) return;
    dragging = false;
    const dt = now() - dragStart.at;
    const moved = dragMoved;
    dragStart = null;
    let drop = null;
    if (api) drop = await api.dragEnd().catch(() => null);
    clearMood();
    if (moved > 18) {
      // 拖拽落地：回弹 + 尘土；甩得够快算「抛出去」
      setMood('land', 700);
      dust();
      const speed = drop ? Math.hypot(drop.vx || 0, drop.vy || 0) : 0;
      if (speed <= 700) emote('land', { popKind: 'sq-big' });
      if (speed > 700) {
        emote('throw', { popKind: 'sq-big' });
        for (const p of petInstances) p.el.classList.add('is-spin');
        setTimeout(() => { for (const p of petInstances) p.el.classList.remove('is-spin'); }, 700);
        const res = await api.interaction('throw').catch(() => null);
        if (res && res.line) showBubble(res.line, { emoji: '💫' });
      }
      return;
    }
    if (dt < 420 && Math.abs(moved) < 18) {
      handlePetClick();
    }
  }

  function handlePetClick() {
    if (now() - pokeCooldown < 500) return;
    pokeCooldown = now();
    markActivity('click');
    if (!api) return;
    api.interaction('click').then((res) => {
      if (!res || !res.ok) return;
      const line = res.line || pick(['呀！', '在呢在呢', '叫我吗？', '戳我干嘛～']);
      showBubble(line, { emoji: pick(['👀', '✨', '💛']), voice: true });
      const t = now();
      pokeStreak = t - pokeStreakAt < 2600 ? pokeStreak + 1 : 1;
      pokeStreakAt = t;
      if (pokeStreak >= 4) {
        emote('pokeSpam', { popKind: 'sq-big' });
        if (pokeStreak === 4) showBubble(pick(['别戳啦！', '哼，我要生气了', '再戳就晕了…']), { emoji: '💢', ms: 1600 });
      } else {
        emote('poke');
        hearts(3);
      }
    }).catch(() => {});
  }

  function onPointerMoveOverPet(e) {
    // 抚摸检测：指针在宠物上缓慢移动 → 眯眼 + 爱心
    if (dragging || !e.buttons === 0) {
      /* noop */
    }
    if (dragging) return;
    const t = now();
    if (petting.lastMove && t - petting.lastMove < 900) {
      petting.active = true;
    }
    petting.lastMove = t;
    if (!petting.active || petting.timer) return;
    petting.timer = setTimeout(() => {
      petting.timer = 0;
      if (!petting.active || dragging) return;
      petting.active = false;
      if (api) {
        api.interaction('pet').then((res) => {
          const line = res && res.line ? res.line : pick(['嘿嘿～', '好舒服…', '再摸摸嘛']);
          showBubble(line, { emoji: '💗', ms: 1800, voice: true });
          petStreak += 1;
          emote(petStreak >= 3 ? 'petLong' : 'pet');
          hearts(4);
        }).catch(() => {});
      }
    }, 1500);
  }

  // ------------------------------------------------------------ 眨眼 / 待机
  const BLINKABLE = ['wide', 'half', 'look', 'sparkle', 'angry', 'tears', 'sleepy'];
  function blinkOnce() {
    if (petInstances.some((p) => /is-sleep/.test(p.el.className))) return;
    if (!BLINKABLE.includes(exprState.eyes)) return;
    for (const p of petInstances) {
      for (const eye of p.eyes) eye.style.transform = 'scaleY(0.08)';
    }
    setTimeout(() => {
      for (const p of petInstances) for (const eye of p.eyes) eye.style.transform = '';
    }, 130);
  }

  function scheduleBlink() {
    clearTimeout(scheduleBlink._t);
    scheduleBlink._t = setTimeout(() => {
      if (powerMode !== 'sleep') blinkOnce();
      // 偶尔连续眨两下
      if (Math.random() < 0.28) setTimeout(blinkOnce, 240);
      // 随机眼动（扫视）：鼠标静止时偶尔看看别处
      if (!dragging && !sleeping && now() - cursorAt > 2500 && Math.random() < 0.45) {
        for (const p of petInstances) {
          p.el.style.setProperty('--look-x', `${rand(-4.5, 4.5).toFixed(2)}px`);
          p.el.style.setProperty('--look-y', `${rand(-2.5, 3).toFixed(2)}px`);
        }
      }
      scheduleBlink();
    }, rand(2400, 6200));
  }

  function lookAtPointer(localX, localY) {
    for (const p of petInstances) {
      const r = p.body.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.5;
      const dx = clamp((localX - cx) / 140, -1, 1) * 5.5;
      const dy = clamp((localY - cy) / 120, -1, 1) * 4.5;
      p.el.style.setProperty('--look-x', `${dx.toFixed(2)}px`);
      p.el.style.setProperty('--look-y', `${dy.toFixed(2)}px`);
    }
  }

  // v1.5：待机行为统一由 scheduleIdle() 调度（12 种，带冷却与可打断）
  function idleAct() {
    scheduleIdle();
  }
  // ------------------------------------------------------------ 主进程事件
  function applyState(next) {
    if (!next) return;
    Object.assign(state, next);
    if (!state.settings) state.settings = {};
    if (!state.ui) state.ui = {};
    if (!state.license) state.license = {};
    if (!state.focus) state.focus = {};
    if (!state.growth) state.growth = {};
    if (!state.presence) state.presence = { kind: 'working', cinemaMode: false };

    setCssVars(state.palette || {});
    document.documentElement.style.setProperty('--pet-scale', String(clamp(Number(state.settings.sizeScale) || 1, 0.75, 1.4)));
    document.body.classList.toggle('reduce-motion', !!state.settings.reduceMotion);

    applyPresence(state.presence, state.ui && state.ui.cinemaMode);
    for (const p of petInstances) applyPetPalette(p.el, state.palette);
    ensurePetCount(state.settings.multiPetCount || 1);
    ensurePartnerPet();
    applySkin(state.settings.skinId || 'blaze');
    ensureCoupleHeart();
    updateBadges();
    updateFocusUi();
    reportHitboxes();

    if (!state.settings.onboardingDone && !hintShown) {
      hintShown = true;
      els.hint.classList.remove('hidden');
      setTimeout(() => els.hint.classList.add('hidden'), 3800);
    }
  }

  /** 情绪 + 观影模式（由主进程状态/事件驱动） */
  function applyLifeMood(mood) {
    if (!mood || dragging) return;
    if (mood === 'sleepy' && !sleeping) {
      setMood('sleep');
    } else if (mood === 'happy' || mood === 'excited' || mood === 'proud') {
      if (!sleeping) setMood('happy', 2200);
    } else if (mood === 'lonely' || mood === 'worried') {
      if (!sleeping) setMood('sad', 2400);
    } else if (mood === 'hungry') {
      if (!sleeping) setMood('sad', 1600);
    } else if (!sleeping && !petInstances.some((p) => /is-(drag|sleep|focus)/.test(p.el.className))) {
      clearMood();
    }
    reportHitboxes();
  }

  function applyPresence(presence, uiCinema) {
    const p = presence || {};
    const cinema = !!(uiCinema || p.cinemaMode);
    const quiet = ['meeting', 'game', 'video'].includes(p.kind);
    cinemaMode = cinema;
    quietMode = quiet;
    document.body.classList.toggle('cinema', cinema);
    document.body.classList.toggle('quiet', quiet && !cinema);
    if (cinema) {
      try {
        window.speechSynthesis && window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    if (p.kind === 'away' && !sleeping) {
      sleeping = true;
      setMood('sleep');
      zzzLoop();
    } else if (p.kind !== 'away' && sleeping) {
      sleeping = false;
      clearMood();
    }
    // v1.5：presence 也映射到表情组合（不覆盖更强的事件表情）
    const PRESENCE_EXPR = {
      coding: { eyes: 'half', mouth: 'smile', body: 'lean' },
      focus: { eyes: 'half', mouth: 'smile', body: 'lean' },
      meeting: { eyes: 'half', mouth: 'smile', body: 'back' },
      watching: { eyes: 'wide', mouth: 'smile', body: 'lean' },
      cinema: { eyes: 'wide', mouth: 'smile', body: 'back' },
      away: { eyes: 'half', mouth: 'pout', body: 'slump' },
      sleeping: { eyes: 'half', mouth: 'o', body: 'slump' },
      free: { eyes: 'wide', mouth: 'smile', body: null },
      working: { eyes: 'wide', mouth: 'smile', body: null },
    };
    if (!sleeping && !dragging && !idleActive && PRESENCE_EXPR[p.kind]) {
      setExpression(PRESENCE_EXPR[p.kind], { duration: 0 });
    }
    reportHitboxes();
  }

  function applyPartnerSkin() {
    ensurePartnerPet();
  }

  function updateBadges() {
    const trial = state.ui && state.ui.showTrialBadge;
    els.trialBadge.classList.toggle('hidden', !trial);
    if (trial) {
      const days = Math.max(0, Number(state.license.trialDaysLeft) || 0);
      els.trialDays.textContent = days > 0 ? ` · 剩 ${days} 天` : '';
    }
    const pro = !!(state.ui && state.ui.isPro);
    const level = Number(state.growth && state.growth.level) || 1;
    const showLevel = pro && level >= 1;
    els.levelChip.classList.toggle('hidden', !showLevel);
    if (showLevel) els.levelChip.querySelector('.lvl').textContent = `Lv.${level}`;
  }

  function updateFocusUi() {
    const f = state.focus || {};
    const running = !!f.running;
    els.focusPill.classList.toggle('hidden', !running);
    els.bubble.classList.toggle('raised', running);
    els.focusPill.classList.toggle('paused', !!f.paused);
    if (running) {
      const ms = Math.max(0, Number(f.remainingMs) || 0);
      const total = Math.ceil(ms / 1000);
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      els.focusTime.textContent = `${mm}:${ss}`;
      els.focusLabel.textContent = f.label || '专注';
      for (const p of petInstances) p.el.classList.add('is-focus');
      if (!focusCelebrating) setMood('focus');
      if (!focusWasRunning && !focusCelebrating) emote('focusStart', { duration: 1600 });
    }
    focusWasRunning = running;
    if (!running) {
      for (const p of petInstances) p.el.classList.remove('is-focus');
      if (petInstances.some((p) => p.el.classList.contains('is-focus'))) clearMood();
    }
  }

  // ------------------------------------------------------------ v2.4 情侣同步互动
  function petClass(inst, cls, ms) {
    if (!inst || !inst.el) return;
    inst.el.classList.remove(cls);
    void inst.el.offsetWidth;
    inst.el.classList.add(cls);
    setTimeout(() => inst.el && inst.el.classList.remove(cls), ms);
  }
  function fxBurst(chars, n = 6, spread = 80) {
    const c = petCenter(0);
    for (let i = 0; i < n; i++) {
      setTimeout(() => spawnFx(pick(chars), { x: c.x + rand(-spread, spread), y: c.y - rand(10, 60), size: randInt(16, 26) }), i * 90);
    }
  }
  function togetherFx(t) {
    const stage = document.getElementById('stage');
    const cls = 'is-together-' + t;
    stage.classList.remove(cls);
    void stage.offsetWidth;
    stage.classList.add(cls);
    setTimeout(() => stage.classList.remove(cls), 2600);
    const me = petInstances[0];
    const mid = me && partnerInstance ? (() => {
      const a = me.body.getBoundingClientRect();
      const b = partnerInstance.body.getBoundingClientRect();
      return { x: (a.left + a.right + b.left + b.right) / 4, y: Math.min(a.top, b.top) + 20 };
    })() : petCenter(0);
    const ch = t === 'highfive' ? '🙌' : t === 'hands' ? '🤝' : '🤗';
    spawnFx(ch, { x: mid.x - 14, y: mid.y, dx: 0, rot: 0, size: 34 });
    setTimeout(() => spawnFx('✨', { x: mid.x - 30, y: mid.y - 10, size: 20 }), 220);
    setTimeout(() => spawnFx('✨', { x: mid.x + 10, y: mid.y - 16, size: 18 }), 360);
  }
  function coupleAct(p) {
    markActivity('couple');
    const t = p.t;
    const name = p.name || 'TA';
    const inbound = p.dir === 'in';
    const together = !!p.together && !!partnerInstance;
    const me = petInstances[0];
    const target = inbound ? me : partnerInstance || me;
    switch (t) {
      case 'poke':
        petClass(target, 'is-poked', 900);
        setMood(inbound ? 'surprised' : 'happy', 900);
        if (inbound) showBubble('哎呀！' + name + ' 戳了我一下', { emoji: '👉', ms: 2200 });
        break;
      case 'heart':
        hearts(10);
        setMood('love', 2000);
        showBubble(inbound ? name + ' 给你比了个心' : '比心发给 ' + name + ' 啦', { emoji: '💗', ms: 2600 });
        break;
      case 'kiss':
        fxBurst(['💋', '😘', '💗'], 8);
        setMood('shy', 2400);
        if (partnerInstance) setPartnerExpression('love', 2400);
        showBubble(inbound ? name + ' 亲了你一下，脸红了…' : '啵～ 已经亲到 ' + name + ' 了', { emoji: '😘', ms: 3000 });
        break;
      case 'hug':
      case 'highfive':
      case 'hands':
        if (together) {
          togetherFx(t);
          setMood('happy', 2600);
          setPartnerExpression(t === 'hug' ? 'love' : 'happy', 2600);
        } else {
          petClass(me, 'is-poked', 700);
          fxBurst([p.emoji || '💗'], 4);
        }
        showBubble(
          inbound
            ? (t === 'hug' ? name + ' 抱了抱你' : t === 'hands' ? name + ' 牵起了你的手' : name + ' 要和你击掌！')
            : (together ? (t === 'hug' ? '抱抱～' : t === 'hands' ? '手牵手一起走' : '耶！击掌成功') : '已发给 ' + name + '，TA 上线就能看到'),
          { emoji: p.emoji || '💗', ms: 2800 },
        );
        break;
      case 'goodnight':
        setMood('sleepy', 3200);
        spawnFx('🌙', { ...petCenter(0), size: 28 });
        for (let i = 0; i < 3; i++) setTimeout(() => spawnFx('z', { className: 'zzz', ...petCenter(0) }), 400 + i * 500);
        if (partnerInstance) setPartnerExpression('sleepy', 3200);
        showBubble(inbound ? name + ' 说晚安啦，我们一起睡吧' : '晚安已送达，一起睡觉觉', { emoji: '🌙', ms: 3200, priority: inbound });
        break;
      case 'paired':
        hearts(10);
        fxBurst(['🎉', '💞', '✨', '💗'], 14, 110);
        setMood('happy', 4000);
        showBubble(inbound ? `${name} 接受了你的邀请，你们配对成功啦！点我打个招呼` : `配对成功！以后 ${name} 就在这里陪你啦`, { emoji: '🎉', ms: 9000, priority: true, voice: true, action: 'couple' });
        break;
      case 'focus':
        showBubble(inbound ? name + ' 邀请你一起专注 ' + (p.minutes || 25) + ' 分钟' : '一起专注开始啦，加油！', { emoji: '🍅', ms: 3200, priority: true });
        break;
      case 'relay':
      case 'voice':
        if (inbound) {
          hearts(5);
          showBubble(t === 'voice' ? `${name} 给你留了一段语音，点我去听` : name + ' 让我告诉你：「' + String(p.text || '').slice(0, 120) + '」', { emoji: t === 'voice' ? '🎙️' : '💬', ms: 9000, priority: true, voice: t !== 'voice', action: 'couple' });
        } else {
          showBubble('已经让 ' + name + ' 的方块仔替你说啦', { emoji: '💬', ms: 2400 });
        }
        break;
      case 'task':
        if (p.both) { sparkles(10); hearts(8); }
        showBubble(inbound ? name + ' 完成了共同任务「' + (p.text || '') + '」' : (p.both ? '你们今天都完成了「' + (p.text || '') + '」！同频！' : '「' + (p.text || '') + '」打卡啦，等 ' + name), { emoji: '✅', ms: 3200 });
        break;
      case 'skinpair':
        sparkles(8);
        showBubble(inbound ? name + ' 换上了情侣装，我也换好啦' : '情侣装「' + (p.text || '') + '」穿上啦', { emoji: '👕', ms: 3000 });
        break;
      default:
        if (p.emoji) fxBurst([p.emoji], 4);
    }
  }

  function handleEvent(evt) {
    if (!evt) return;
    const { kind, payload = {} } = evt;
    switch (kind) {
      case 'theme':
        if (payload && typeof payload === 'object' && state.palette) {
          // 主题变化时主进程会重新广播 state；这里只做即时切换
          document.body.classList.toggle('dark', !!payload.effectiveDark);
        }
        break;
      case 'skin':
        if (payload.palette) {
          Object.assign(state.palette, payload.palette);
          setCssVars(state.palette);
        }
        applySkin(payload.skinId || (payload.skin && payload.skin.id) || state.settings.skinId || 'blaze');
        break;
      case 'tts': {
        // 神经语音：服务端合成好的 mp3，直接播放（失败静默，SAPI 不受影响）
        if (payload && payload.url) {
          try {
            const audio = new Audio(payload.url);
            audio.volume = Math.max(0, Math.min(1, Number(payload.volume) || 0.7));
            audio.play().catch(() => {});
          } catch (err) {
            /* ignore */
          }
        }
        break;
      }      case 'say':
        if (payload && payload.text) showBubble(payload.text, { emoji: payload.emoji || '', ms: payload.ms || 3600, priority: !!payload.priority, action: payload.action || '' });
        break;
      case 'drag-end': {
        const edge = payload && payload.edge;
        for (const p of petInstances) {
          p.el.classList.remove('is-wall', 'is-wall-left', 'is-wall-right');
          if (edge === 'left') p.el.classList.add('is-wall', 'is-wall-left');
          else if (edge === 'right') p.el.classList.add('is-wall', 'is-wall-right');
        }
        if (edge === 'left' || edge === 'right') {
          setTimeout(() => {
            for (const p of petInstances) p.el.classList.remove('is-wall', 'is-wall-left', 'is-wall-right');
          }, 2400);
        }
        break;
      }
      case 'trash': {
        for (const p of petInstances) { p.el.classList.add('is-trash'); }
        showBubble('啊…我被扔进垃圾桶了', { emoji: '🗑️', ms: 2200 });
        setTimeout(() => { for (const p of petInstances) p.el.classList.remove('is-trash'); }, 2400);
        break;
      }
      case 'trash-return': {
        for (const p of petInstances) { p.el.classList.add('is-dizzy'); }
        showBubble(pick(['垃圾桶好臭…我爬出来了', '你居然想扔掉我！', '哼，我自己爬回来啦']), { emoji: '💫', ms: 3200 });
        setTimeout(() => { for (const p of petInstances) p.el.classList.remove('is-dizzy'); }, 1400);
        break;
      }
      case 'dragged': {
        for (const p of petInstances) p.el.classList.add('is-dragged');
        dust();
        setTimeout(() => { for (const p of petInstances) p.el.classList.remove('is-dragged'); }, 1800);
        break;
      }
      case 'walk-start': {
        document.body.classList.add('is-walking');
        for (const p of petInstances) { p.el.classList.add('is-walk'); if (payload && payload.dir < 0) p.el.classList.add('walk-left'); }
        break;
      }
      case 'walk-dir': {
        for (const p of petInstances) p.el.classList.toggle('walk-left', !!(payload && payload.dir < 0));
        break;
      }
      case 'walk-end': {
        document.body.classList.remove('is-walking');
        for (const p of petInstances) p.el.classList.remove('is-walk', 'walk-left');
        break;
      }
      case 'climb': {
        for (const p of petInstances) p.el.classList.add('is-climb');
        setTimeout(() => {
          for (const p of petInstances) p.el.classList.remove('is-climb');
        }, 900);
        break;
      }
      case 'task-remind':
        markActivity('focus');
        emote('startle', { duration: 1800 });
        showBubble((payload.late ? '⏰ 有个提醒过时间啦：' : '⏰ ' + payload.at + ' 到啦，') + '该「' + payload.text + '」了！', { emoji: '⏰', ms: 6500, voice: true, priority: true });
        break;
      case 'task-done':
        markActivity('focus');
        emote('focusDone', { duration: 3200, popKind: 'sq-big' });
        hearts(8);
        sparkles(10);
        showBubble('「' + payload.text + '」完成啦，你真棒！' + (payload.left ? '还剩 ' + payload.left + ' 个任务' : '今天的任务全部完成！'), { emoji: '✅', ms: 5200, voice: true, priority: true });
        break;
      case 'focus-tick':
        state.focus = payload;
        updateFocusUi();
        break;
      case 'focus-complete':
        focusCelebrating = true;
        clearMood();
        markActivity('focus');
        setMood('happy', 4200);
        emote('focusDone', { duration: 4200, popKind: 'sq-big' });
        hearts(12);
        skinParticles(6);
        sparkles(14);
        showBubble(payload.line || '专注完成！休息一下吧～', { emoji: '🍅', ms: 4200 });
        setTimeout(() => {
          focusCelebrating = false;
          clearMood();
        }, 4200);
        break;
      case 'levelup':
        sparkles(16);
        markActivity('levelup');
        setMood('happy', 3000);
        emote('levelup', { duration: 2600, popKind: 'sq-big' });
        showBubble(`升级啦！现在是 Lv.${payload.level}`, { emoji: '🎉', ms: 3600 });
        break;
      case 'achievement':
        sparkles(10);
        if (payload.achievements && payload.achievements[0]) {
          showBubble(`解锁成就「${payload.achievements[0].name}」`, { emoji: payload.achievements[0].icon || '🏅', ms: 3600 });
        }
        break;
      case 'farm-work':
        for (const p of petInstances) if (p && p.el) p.el.classList.toggle('is-farm-away', !!payload.on);
        break;
      case 'sleep':
        sleeping = true;
        setMood('sleep');
        zzzLoop();
        break;
      case 'wake':
        sleeping = false;
        clearMood();
        emote('wake', { duration: 1400 });
        showBubble(pick(['嗯…我没睡！', '醒啦醒啦', '（伸懒腰）']), { emoji: '😴', ms: 1800 });
        break;
      case 'startle': {
        // 前台窗口突然切换：吓一跳（短促抖动，不刷屏）
        markActivity('startle');
        idleCooldownUntil = performance.now() + 4000;
        setMood('surprised', 900);
        emote('startle', { duration: 900, popKind: 'sq-shrink' });
        for (const p of petInstances) p.el.classList.add('idle-shake');
        setTimeout(() => {
          for (const p of petInstances) p.el.classList.remove('idle-shake');
        }, 620);
        if (!quietMode && !cinemaMode && Math.random() < 0.5) {
          showBubble(pick(['！', '吓我一跳', '（抖了一下）']), { emoji: '❗', ms: 1400 });
        }
        break;
      }
      case 'activity': {
        // 用户活跃（系统闲置时间重置，不含按键内容）：跟着节奏点头
        markActivity('activity');
        const t = performance.now();
        if (t > activityNodAt) {
          activityNodAt = t + 2600;
          for (const p of petInstances) p.el.classList.add('idle-nod');
          setExpression({ eyes: 'crescent', mouth: 'smile', body: 'lean' }, { duration: 900 });
          setTimeout(() => {
            for (const p of petInstances) p.el.classList.remove('idle-nod');
          }, 900);
        }
        break;
      }
      case 'power':
        // 睡眠模式：暂停所有 CSS 动画与粒子，回到 active 恢复
        powerMode = p.mode || 'active';
        document.body.classList.toggle('power-save', powerMode === 'sleep');
        break;
      case 'partner-arrive': {
        // TA 上线：小伙伴从屏幕边跑进来，抱一下
        const n = p.name || 'TA';
        const runner = document.createElement('div');
        runner.className = 'partner-runin';
        runner.textContent = '🧡';
        document.body.appendChild(runner);
        setTimeout(() => runner.remove(), 1800);
        setTimeout(() => { hearts(6); setMood('happy', 2200); }, 1200);
        showBubble(n + ' 上线啦！冲过来抱抱～', { emoji: '🏃', ms: 3000 });
        break;
      }
      case 'partner-leave':
        setMood('sad', 1800);
        showBubble((p.name || 'TA') + ' 先下线了，等 TA 回来', { emoji: '👋', ms: 2400 });
        break;
      case 'fireworks': {
        const burst = () => fxBurst(['🎆', '🎇', '✨', '💗', '🎉'], 14, 140);
        burst(); setTimeout(burst, 700); setTimeout(burst, 1400);
        setMood('love', 4000);
        showBubble((p.title || '纪念日快乐！') + ' 右键「📸 留个瞬间」存下来吧', { emoji: '🎆', ms: 6000 });
        break;
      }
        if (payload.text) showBubble(payload.text, { emoji: payload.emoji || '', ms: payload.durationMs || (payload.priority ? 4200 : 2400), priority: !!payload.priority, noTranslate: !!payload.noTranslate });
        break;
      case 'drop':
        setMood('land', 700);
        dust();
        break;
      case 'interact':
        markActivity('interact');
        if (payload.type === 'pet') {
          setMood('squint', 1400);
          emote('pet');
          hearts(4);
          showBubble(pick(['嘿嘿～', '好舒服…', '再摸摸嘛']), { emoji: '💗' });
        }
        break;
      case 'feed':
        markActivity('feed');
        setMood('happy', 2200);
        emote('feed', { duration: 2000 });
        hearts(6);
        showBubble(payload.line || '好吃！谢谢～', { emoji: '🍬' });
        break;
      case 'locked':
        setMood('sad', 1600);
        emote('locked');
        showBubble(payload.message || '这是 Pro 功能哦', { emoji: '🔒' });
        break;
      case 'sad':
        setMood('sad', 1400);
        break;
      case 'thought': {
        if (payload.text && !cinemaMode && !quietMode) {
          showBubble(payload.text, { emoji: '💭', ms: 3400, voice: !!payload.important });
          setMood(payload.important ? 'happy' : 'squint', 1600);
        }
        break;
      }
      case 'mood': {
        applyLifeMood(payload && payload.mood);
        break;
      }
      case 'presence': {
        state.presence = { ...(state.presence || {}), ...payload };
        applyPresence(payload, payload.cinema);
        break;
      }
      case 'presence-kind': {
        if (payload.kind === 'coding' && !cinemaMode && !quietMode) {
          const t = now();
          if (!applyPresence._cheerAt || t - applyPresence._cheerAt > 12 * 60 * 1000) {
            applyPresence._cheerAt = t;
            showBubble(pick(['写代码辛苦啦，喝口水吧', '这个 bug 我们一起盯着它', '记得坐直一点哦', '我在这儿陪你写']), {
              emoji: pick(['☕', '💻', '🍊']),
              ms: 2600,
            });
          }
        }
        break;
      }
      case 'couple-message': {
        markActivity('couple');
        emote('coupleMessage', { duration: 2200 });
        const name = payload.name || 'TA';
        const text = String(payload.text || '').slice(0, 120);
        if (!text) break;
        if (!cinemaMode && !quietMode) {
          showBubble(`${name}：${text}`, { emoji: payload.kind === 'love' ? '💗' : '💬', ms: 3800 });
        }
        hearts(payload.kind === 'love' ? 8 : 4);
        if (partnerInstance) {
          setMood('happy', 1600);
          partnerInstance.el.classList.add('is-nuzzle');
          setPartnerExpression('shy', 2600);
          setTimeout(() => partnerInstance && partnerInstance.el.classList.remove('is-nuzzle'), 2600);
        }
        speak(text, { kind: payload.kind === 'love' ? 'love' : 'chat' });
        break;
      }
      case 'couple-married': {
        clearMood();
        hearts(16);
        sparkles(14);
        setMood('happy', 4200);
        if (!cinemaMode) showBubble('我们结婚啦！💍', { emoji: '💍', voice: true, ms: 4200 });
        if (partnerInstance) partnerInstance.el.classList.add('is-happy');
        setPartnerExpression('love', 4200);
        setTimeout(() => partnerInstance && partnerInstance.el.classList.remove('is-happy'), 3000);
        break;
      }
      case 'couple-act': {
        coupleAct(payload);
        break;
      }
      case 'intimacy-up': {
        clearMood();
        sparkles(12);
        hearts(10);
        setMood('happy', 3600);
        showBubble(payload.text || ('亲密度升到 Lv.' + payload.level + ' ' + (payload.name || '') + '！'), { emoji: '💞', priority: true, ms: 5200 });
        break;
      }
      case 'couple-propose': {
        hearts(6);
        if (!cinemaMode) showBubble('求婚送出去啦，等 TA 回应…', { emoji: '💍', ms: 3200 });
        break;
      }
      case 'listening':
        document.body.classList.toggle('is-listening', !!payload.on);
        if (payload.on) {
          setExpression('curious', { duration: 9000 });
          showBubble('我在听，你说吧…', { emoji: '🎤', ms: 9000, priority: true, silent: true, replaceable: true });
        } else if (currentBubble && currentBubble.replaceable) {
          clearTimeout(showBubble._timer);
          bubbleToken++;
          els.bubble.classList.remove('show');
          els.bubble.classList.add('hidden');
          drainBubble();
        }
        break;
      case 'heard':
        markActivity('chat');
        setExpression('thinking', { duration: 4000 });
        showBubble('你说：「' + String(payload.text || '').slice(0, 40) + '」', { emoji: '👂', ms: 2200, priority: true, silent: true });
        break;
      case 'chat-reply': {
        // AI 回复：mood 标签优先，其次关键词
        markActivity('chat');
        if (payload.bubble && payload.text) showBubble(String(payload.text), { emoji: '💬', ms: 6000, priority: true, silent: true });
        if (payload.text) speak(String(payload.text).slice(0, 80));
        if (partnerInstance) setPartnerExpression('curious', 1800);
        if (!sleeping && !dragging) setExpression(XD.forChat(payload.mood, payload.text), { duration: 2600 });
        break;
      }
      case 'expression': {
        if (payload.event) emote(payload.event);
        else if (payload.name) setExpression(payload.name, { duration: payload.duration || 2000 });
        break;
      }
      case 'settings':
        if (payload && payload.settings) {          state.settings = { ...state.settings, ...payload.settings };
          ensurePetCount(state.settings.multiPetCount || 1);
        }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ 指针位置（Windows 全屏）
  function onCursor(pos) {
    if (!pos) return;
    const t = now();
    if (t - cursorAt < 70) return;
    cursorAt = t;
    lastCursor = { x: pos.x, y: pos.y };
    // 主进程给的是屏幕坐标，转换成窗口内坐标
    const localX = pos.x - (pos.wx || 0);
    const localY = pos.y - (pos.wy || 0);
    if (!sleeping && !dragging) lookAtPointer(localX, localY);
  }

  // ------------------------------------------------------------ 角标 / 胶囊交互
  els.bubble.addEventListener('click', () => {
    const a = els.bubble.dataset.action;
    if (a === 'couple' && api) api.openPanel('couple');
  });
  els.trialBadge.addEventListener('click', () => {
    if (api) api.openPanel('store');
  });
  els.focusPill.addEventListener('click', () => {
    if (api) api.openPanel('settings');
  });
  els.levelChip.addEventListener('click', () => {
    if (api) api.openPanel('settings');
  });

  window.addEventListener('pointermove', onPointerMoveWindow);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('blur', () => {
    if (dragging) {
      dragging = false;
      if (api) api.dragEnd().catch(() => {});
      clearMood();
    }
  });
  window.addEventListener('resize', () => reportHitboxes());

  // ------------------------------------------------------------ 启动
  async function init() {
    if (isMock) {
      applyState(mockState);
      startLoops();
      // 浏览器预览：允许点击模拟反应
      return;
    }
    try {
      const st = await api.ready();
      applyState(st);
    } catch {
      /* ignore */
    }
    api.onState(applyState);
    api.onCursor(onCursor);
    api.onEvent(handleEvent);
    startLoops();
  }

  function startLoops() {
    try {
      const vv = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      console.log('[pet] speech voices:', vv.length, vv.slice(0, 2).map((v) => v.name).join('|'));
    } catch {
      console.log('[pet] speech unavailable');
    }
    scheduleBlink();
    idleAct();
    setInterval(() => {
      if (powerMode === 'sleep') return; // 睡眠模式不上报命中框
      if (els.bubble.classList.contains('hidden')) reportHitboxes();
    }, 1500);
    setInterval(ambientTick, 20000);
  }

  /** 长时间无操作 / 深夜 / 环境粒子 */
  function ambientTick() {
    if (dragging || sleeping || focusCelebrating || powerMode === 'sleep') return;
    const t = now();
    const calm = !cinemaMode && !quietMode;
    const hour = new Date().getHours();
    const lateNight = hour >= 23 || hour < 5;
    if (lateNight && t - lastLateNightAt > 40 * 60 * 1000) {
      lastLateNightAt = t;
      emote('lateNight', { duration: 3200 });
      if (calm) showBubble(pick(['已经很晚啦，早点休息好不好', '熬夜会变成熊猫眼哦', '我有点困了…你也是吧？']), { emoji: '🌙', ms: 3200 });
      return;
    }
    if (t - lastUserActivityAt > 5 * 60 * 1000 && t - lastIdleLongAt > 10 * 60 * 1000 && !idleActive) {
      lastIdleLongAt = t;
      emote('idleLong', { duration: 2800 });
      if (calm && Math.random() < 0.5) showBubble(pick(['好无聊呀…陪我玩一下嘛', '你去哪啦？', '（哼歌中）♪']), { emoji: '💭', ms: 2600 });
      return;
    }
    if (calm && !document.body.classList.contains('reduce-motion') && Math.random() < 0.3) skinParticles(2);
  }

  // 仅用于演示视频录制：允许主进程触发一次「被点击」的完整反应（不经过鼠标拖拽逻辑）
  window.__cubbitDemo = {
    click: () => handlePetClick(),
    say: (text, opts) => showBubble(text || '嗨～', opts || {}),
    hearts: (n) => hearts(n || 8),
    sparkles: (n) => sparkles(n || 10),
    hintOff: () => {
      const el = document.getElementById('dragHint');
      if (el) el.classList.remove('show');
    },
  };

  init();

  // ============================================================ QA / 截图钩子
  window.__cubbitPet = {
    setExpression: (expr, opts) => setExpression(expr, opts || {}),
    expression: () => Object.assign({}, exprState),
    setMood: (mood, ms) => setMood(mood, ms || 0),
    clearMood: () => clearMood(),
    applySkin: (id) => applySkin(id),
    emote: (evt, opts) => emote(evt, opts || {}),
    expressions: () => Object.keys(XD.EXPRESSIONS || {}),
    signature: () => skinSignature(),
    triggerIdle: (name) => triggerIdle(name),
    actions: () => IDLE_ACTIONS.map((a) => a.name),
    dispatch: (kind, payload) => handleEvent({ kind, payload: payload || {} }),
    palette: (p) => {
      if (!p) return;
      Object.assign(state.palette, p);
      setCssVars(state.palette);
      for (const pet of petInstances) applyPetPalette(pet.el, state.palette);
    },
    state: () => state,
    instances: () => petInstances,
  };
})();