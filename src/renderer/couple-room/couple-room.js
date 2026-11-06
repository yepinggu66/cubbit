/* ============================================================================
 * Cubbit 情侣空间（couple-room）
 *
 * 契约：
 *   · state.coupleScenes [{id,name,desc,emoji,accent}] / state.coupleScene {id,light,updatedAt}
 *   · IPC（字符串）：couple-scene:get / couple-scene:set {id,light,announce} / couple-scene:capture
 *   · 事件：'couple-scene'（主进程广播 state；伴侣进入同一场景时 partnerHere=true）
 *
 * 无 Electron 时用 ui/mock.js 预览：?mock=1&couple=married&scene=coffee&light=dark
 * ========================================================================== */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const el = UI.el;
  const icon = UI.icon;
  const clear = UI.clear;
  const toast = UI.toast;
  const app = UI.createApp();

  const IPC_SCENE = {
    GET: 'couple-scene:get',
    SET: 'couple-scene:set',
    CAPTURE: 'couple-scene:capture',
  };
  const EVENT_SCENE = (UI.EVENTS && UI.EVENTS.COUPLE_SCENE) || 'couple-scene';

  /** preload 暴露的 room API（cubbit.room 或 cubbit.panel.room） */
  function roomApi() {
    const panel = app.panel || (window.cubbit && window.cubbit.panel) || null;
    const direct = (window.cubbit && window.cubbit.room) || null;
    if (direct && typeof direct.get === 'function') return direct;
    if (panel && panel.room && typeof panel.room.get === 'function') return panel.room;
    return null;
  }

  async function roomGet() {
    const api = roomApi();
    if (api && typeof api.get === 'function') return api.get();
    return app.invoke(IPC_SCENE.GET, {}, { gate: false });
  }

  function roomSet(payload) {
    const api = roomApi();
    if (api && typeof api.set === 'function') return api.set(payload);
    return app.invoke(IPC_SCENE.SET, payload, { gate: false });
  }

  function roomCapture() {
    const api = roomApi();
    if (api && typeof api.capture === 'function') return api.capture();
    return app.invoke(IPC_SCENE.CAPTURE, { id: S.sceneId, light: S.light }, { gate: false });
  }
  const TOTAL_MS = 25 * 60 * 1000;

  const DEFAULT_SCENES = [
    { id: 'coffee', name: '咖啡约会', desc: '两杯热咖啡，慢慢聊', emoji: '☕', accent: '#ef7a52' },
    { id: 'movie', name: '深夜电影', desc: '灯关小一点，一起看', emoji: '🎬', accent: '#7fb2ff' },
    { id: 'stars', name: '阳台看星星', desc: '风有点凉，但肩并肩', emoji: '🌟', accent: '#ffd166' },
    { id: 'cooking', name: '一起做饭', desc: '你切菜，我递调料', emoji: '🍳', accent: '#ffb347' },
    { id: 'rain', name: '雨天窗边', desc: '听雨，谁都不必说话', emoji: '🌧️', accent: '#9fc3e8' },
    { id: 'bedtime', name: '晚安故事', desc: '关灯之后的那十分钟', emoji: '🌙', accent: '#b9a8ff' },
  ];

  const S = {
    scenes: DEFAULT_SCENES,
    sceneId: 'coffee',
    light: 'light',
    couple: null,
    partnerHere: false,
    locked: false,
    timer: { running: false, remaining: TOTAL_MS, endAt: 0, timer: null, done: false },
    exprTimer: null,
    rotateTimer: null,
    unsubscribe: [],
    updatedAt: 0,
  };

  const R = {};

  document.addEventListener('DOMContentLoaded', init);

  // ================================================================= 启动
  async function init() {
    mountTitlebar();
    buildConsole();
    bindEvents();

    app.onState((state) => applyState(state));
    await app.boot({});
    applyState(app.state);
    subscribeSceneEvents();

    await loadScene();
    const params = new URLSearchParams(location.search);
    const wantScene = params.get('scene');
    const wantLight = params.get('light');
    if (wantScene) selectScene(wantScene, { silent: true });
    if (wantLight === 'dark' || wantLight === 'light') setLight(wantLight, { silent: true });
    startExprRotation();
  }

  function mountTitlebar() {
    const { bar, rightSlot } = UI.mountTitlebar(app, { page: '情侣空间', brandSub: true });
    R.badgeHost = el('div', { class: 'row', style: { gap: '8px' } });
    rightSlot.insertBefore(R.badgeHost, rightSlot.firstChild);
    document.getElementById('titlebar-host').appendChild(bar);
    document.title = '方块仔 · 情侣空间';
  }

  // ================================================================= 状态
  function applyState(state) {
    if (!state) return;
    S.couple = state.couple || null;
    const cs = state.coupleScene || {};
    if (Array.isArray(cs.scenes) && cs.scenes.length) S.scenes = cs.scenes;
    else if (Array.isArray(state.coupleScenes) && state.coupleScenes.length) S.scenes = state.coupleScenes;
    const current = cs.current || cs;
    if (current && current.id && S.scenes.some((s) => s.id === current.id)) S.sceneId = current.id;
    if (current && (current.light === 'dark' || current.light === 'light')) S.light = current.light;
    if (current && current.updatedAt) S.updatedAt = current.updatedAt;
    S.partnerHere = cs.partnerHere === true || resolvePartnerHere(state, current);
    S.entitled = cs.entitled !== false;

    const features = state.features || {};
    const coupleOn = !!(features.couple_mode || (state.license && state.license.features && state.license.features.couple_mode));
    const paired = !!(S.couple && S.couple.enabled && S.couple.pairId);
    S.locked = !S.entitled || !coupleOn || !paired;

    renderBadge(state);
    renderScene();
    renderPets();
    renderLocked();
    renderPartner();
  }

  function resolvePartnerHere(state, current) {
    if (current && current.partnerHere === true) return true;
    if (current && current.partnerScene && current.partnerScene === S.sceneId) return true;
    const partner = (state.couple && state.couple.partner) || null;
    return !!(partner && partner.online && state.couple && state.couple.enabled && current && current.id === S.sceneId && current.joined === true);
  }

  function renderBadge(state) {
    if (!R.badgeHost || !state) return;
    clear(R.badgeHost);
    R.badgeHost.appendChild(UI.licenseBadgeNode(state.license || {}, state.ui));
    if (S.couple && S.couple.married) {
      R.badgeHost.appendChild(el('span', { class: 'badge badge--couple' }, icon('heart'), el('span', { text: '已婚' })));
    }
  }

  // ================================================================= 场景
  function sceneOf(id) {
    return S.scenes.find((s) => s.id === id) || S.scenes[0] || DEFAULT_SCENES[0];
  }

  function renderScene() {
    const scene = sceneOf(S.sceneId);
    document.body.dataset.scene = scene.id;
    document.body.dataset.light = S.light;

    if (R.plateEmoji) R.plateEmoji.textContent = scene.emoji || '✨';
    if (R.plateName) R.plateName.textContent = scene.name || '一起待着';
    if (R.plateDesc) R.plateDesc.textContent = scene.desc || '';

    if (R.sceneTabs) {
      clear(R.sceneTabs);
      for (const item of S.scenes) {
        const btn = el(
          'button',
          { class: 'console__scene-btn' + (item.id === scene.id ? ' is-active' : ''), type: 'button', role: 'tab', title: item.name },
          el('span', { class: 'emoji', text: item.emoji || '✨' }),
          el('span', { text: item.name }),
        );
        btn.addEventListener('click', () => selectScene(item.id));
        R.sceneTabs.appendChild(btn);
      }
    }
    for (const btn of document.querySelectorAll('.light-btn')) {
      btn.classList.toggle('is-active', btn.dataset.light === S.light);
    }
    updateExpressions();
  }

  function renderPets() {
    const state = app.state || {};
    const localName = (state.product && state.product.zhName) || '方块仔';
    const partner = (S.couple && S.couple.partner) || null;
    if (R.petNameA) R.petNameA.textContent = localName;
    if (R.petNameB) R.petNameB.textContent = partner ? partner.name || 'TA' : 'TA';
    applyPalette(R.petA, state.palette, { a1: '#ffd9bf', a2: '#ef7a52', a3: '#c9482a' });
    applyPalette(R.petB, state.partnerPalette || partnerPaletteFallback(state), { a1: '#f9d7e6', a2: '#f497b6', a3: '#b76689' }, true);
  }

  function partnerPaletteFallback(state) {
    const skins = (state && state.skins) || [];
    const partner = (S.couple && S.couple.partner) || {};
    const skin = skins.find((s) => s.id === partner.skinId) || null;
    return skin ? skin.palette : null;
  }

  function applyPalette(pet, palette, fallback, isPartner) {
    if (!pet) return;
    const p = palette || fallback || {};
    const body = pet.querySelector('.rpet__body');
    if (!body) return;
    const prefix = isPartner ? '--rp-b' : '--rp-a';
    body.style.setProperty(prefix + '1', p.body1 || fallback.a1);
    body.style.setProperty(prefix + '2', p.body2 || fallback.a2);
    body.style.setProperty(prefix + '3', p.body3 || fallback.a3);
    body.style.setProperty('--rp-eye', p.eye || '#2b1a14');
    body.style.setProperty('--rp-pupil', p.pupil || '#140c08');
    body.style.setProperty('--rp-glow', p.glow || 'rgba(255,150,110,.45)');
  }

  function updateExpressions() {
    const scene = sceneOf(S.sceneId);
    const baseExpr = S.light === 'dark' ? 'sleepy' : scene.id === 'bedtime' ? 'sleepy' : 'smile';
    setExpression(baseExpr);
  }

  function setExpression(expr, opts = {}) {
    for (const pet of [R.petA, R.petB]) {
      if (!pet) continue;
      pet.dataset.expr = expr;
      pet.querySelector('.rpet__body')?.classList.remove('rpet--jump');
    }
    if (opts.duration > 0) {
      clearTimeout(S.exprTimer);
      S.exprTimer = setTimeout(() => updateExpressions(), opts.duration);
    }
  }

  function startExprRotation() {
    clearInterval(S.rotateTimer);
    // 纯定时器（无 rAF）：每 14~22 秒随机换一个可爱表情，避免刷屏
    const tick = () => {
      if (S.locked || document.hidden) return;
      const roll = Math.random();
      const expr = roll < 0.42 ? 'starry' : roll < 0.72 ? 'tongue' : 'smile';
      setExpression(expr, { duration: 2400 });
    };
    S.rotateTimer = setInterval(tick, 16000);
  }

  function selectScene(id, opts = {}) {
    const scene = sceneOf(id);
    if (!scene) return;
    S.sceneId = scene.id;
    renderScene();
    if (!opts.silent && !S.locked) {
      invokeScene({ id: scene.id, light: S.light, announce: false, reason: 'switch' });
      toast(`已来到「${scene.name}」`, 'ok', 1800);
    }
  }

  function setLight(light, opts = {}) {
    if (light !== 'dark' && light !== 'light') return;
    S.light = light;
    renderScene();
    if (!opts.silent) {
      // 参考视频：切暗色时宠物变剪影 + 发光眼；切亮色时星星眼开心一下
      setExpression(light === 'dark' ? 'sleepy' : 'starry', { duration: light === 'dark' ? 0 : 1800 });
      invokeScene({ id: S.sceneId, light, announce: false, reason: 'light' });
    }
  }

  function invokeScene(payload) {
    return roomSet(payload).then((res) => {
      if (res && res.ok) return res;
      return res;
    });
  }

  async function loadScene() {
    try {
      const res = await roomGet();
      const data = res && (res.current || res.scene || res.coupleScene || res);
      if (data && (data.id || data.light)) {
        if (data.id) S.sceneId = data.id;
        if (data.light) S.light = data.light;
      }
      if (Array.isArray(res && res.scenes) && res.scenes.length) S.scenes = res.scenes;
      if (res && res.partnerHere === true) S.partnerHere = true;
      if (res && res.entitled === false) { S.entitled = false; S.locked = true; }
      renderScene();
      renderPets();
    } catch (err) {
      // 主进程尚未提供该通道时保持本地默认场景，不报错
    }
    updateExpressions();
  }

  // ================================================================= 控制台
  function buildConsole() {
    R.sceneTabs = document.getElementById('sceneTabs');
    R.plateEmoji = document.getElementById('plateEmoji');
    R.plateName = document.getElementById('plateName');
    R.plateDesc = document.getElementById('plateDesc');
    R.partnerHere = document.getElementById('partnerHere');
    R.petA = document.getElementById('pets').querySelector('.rpet--a');
    R.petB = document.getElementById('pets').querySelector('.rpet--b');
    R.petNameA = document.getElementById('petNameA');
    R.petNameB = document.getElementById('petNameB');
    R.timerBtn = document.getElementById('timerBtn');
    R.timerTime = document.getElementById('timerTime');
    R.timerLabel = document.getElementById('timerLabel');
    R.captureBtn = document.getElementById('captureBtn');
    R.shareBtn = document.getElementById('shareBtn');
    R.locked = document.getElementById('locked');
    R.upgradeBtn = document.getElementById('upgradeBtn');
    R.pairBtn = document.getElementById('pairBtn');

    for (const btn of document.querySelectorAll('.light-btn')) {
      btn.addEventListener('click', () => setLight(btn.dataset.light));
    }
    R.timerBtn.addEventListener('click', toggleTimer);
    R.captureBtn.addEventListener('click', captureMoment);
    R.shareBtn.addEventListener('click', shareScene);
    R.upgradeBtn.addEventListener('click', () => app.openPanel('store'));
    R.pairBtn.addEventListener('click', () => app.openPanel('couple'));
  R.previewBtn = document.getElementById('previewBtn');
  if (R.previewBtn) {
    R.previewBtn.addEventListener('click', () => {
      // 预览模式：未配对/未解锁也可以看 6 个场景，用于种草；同步/保存仍按权益
      S.preview = true;
      S.locked = false;
      R.locked.classList.add('hidden');
      document.body.classList.add('is-preview');
      const cur = S.coupleScene && S.coupleScene.current;
      if (cur) applyScene(cur.id, cur.light, { silent: true });
    });
  }
    spawnParticles();
    updateTimerUi();
  }

  function spawnParticles() {
    const host = document.getElementById('particles');
    if (!host) return;
    clear(host);
    // 6 个场景共用的轻微漂浮粒子：纯 CSS 动画
    for (let i = 0; i < 14; i += 1) {
      const dot = el('span');
      dot.style.left = 4 + Math.random() * 92 + '%';
      dot.style.top = 10 + Math.random() * 70 + '%';
      dot.style.animationDelay = (-Math.random() * 9).toFixed(2) + 's';
      dot.style.animationDuration = (7 + Math.random() * 5).toFixed(2) + 's';
      dot.style.opacity = (0.12 + Math.random() * 0.4).toFixed(2);
      host.appendChild(dot);
    }
  }

  function bindEvents() {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') app.close();
      if (event.key === ' ') {
        event.preventDefault();
        toggleTimer();
      }
    });
  }

  // ================================================================= 计时
  function toggleTimer() {
    if (S.locked) {
      toast('情侣场景是双人版权益', 'warn', 2600);
      return;
    }
    const t = S.timer;
    if (t.running) {
      // 暂停
      t.running = false;
      t.remaining = Math.max(0, t.endAt - Date.now());
      clearInterval(t.timer);
      t.timer = null;
      R.timerBtn.classList.remove('is-running');
      R.timerLabel.textContent = '继续一起待';
      updateTimerUi();
      return;
    }
    if (t.remaining <= 0) {
      t.remaining = TOTAL_MS;
      t.done = false;
    }
    t.running = true;
    t.endAt = Date.now() + t.remaining;
    R.timerBtn.classList.add('is-running');
    R.timerLabel.textContent = '正在一起待';
    setExpression('starry', { duration: 1800 });
    t.timer = setInterval(() => {
      const left = Math.max(0, t.endAt - Date.now());
      t.remaining = left;
      updateTimerUi();
      if (left <= 0) finishTimer();
    }, 1000);
    updateTimerUi();
  }

  function updateTimerUi() {
    const remaining = S.timer.running ? Math.max(0, S.timer.endAt - Date.now()) : S.timer.remaining;
    const total = Math.ceil(remaining / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    if (R.timerTime) R.timerTime.textContent = `${mm}:${ss}`;
  }

  function finishTimer() {
    const t = S.timer;
    clearInterval(t.timer);
    t.timer = null;
    t.running = false;
    t.done = true;
    t.remaining = 0;
    R.timerBtn.classList.remove('is-running');
    R.timerLabel.textContent = '再待一会儿';
    setExpression('starry', { duration: 6000 });
    burstHearts(12);
    toast('25 分钟到了，抱一下 ❤', 'ok', 4200);
    updateTimerUi();
    if (!S.locked) invokeScene({ id: S.sceneId, light: S.light, announce: true, reason: 'timer-done' });
  }

  function burstHearts(count) {
    const host = document.getElementById('room');
    if (!host) return;
    for (let i = 0; i < count; i += 1) {
      const heart = el('div', { class: 'heart-float', text: ['❤', '💗', '💞', '♡'][i % 4] });
      heart.style.left = 30 + Math.random() * 40 + '%';
      heart.style.bottom = 150 + Math.random() * 140 + 'px';
      heart.style.animationDelay = (i * 0.09).toFixed(2) + 's';
      host.appendChild(heart);
      setTimeout(() => heart.remove(), 3000 + i * 90);
    }
  }

  // ================================================================= 保存 / 分享
  async function captureMoment() {
    if (S.locked) {
      toast('升级双人版就能保存这一刻', 'warn', 2800);
      return;
    }
    R.captureBtn.disabled = true;
    const label = R.captureBtn.querySelector('span');
    const original = label ? label.textContent : '保存这一刻';
    if (label) label.textContent = '正在保存…';
    try {
      const res = await roomCapture();
      if (res && res.ok) {
        toast(res.path ? '已保存：' + res.path : '这一刻已保存', 'ok', 3600);
        setExpression('starry', { duration: 1600 });
      } else {
        toast((res && (res.message || res.error)) || '保存失败，请稍后再试', 'err', 3200);
      }
    } catch (err) {
      toast('保存功能需要更新应用（主进程尚未接入 couple-scene:capture）', 'err', 4200);
    } finally {
      R.captureBtn.disabled = false;
      if (label) label.textContent = original;
    }
  }

  async function shareScene() {
    if (S.locked) {
      toast('升级双人版就能同步场景', 'warn', 2800);
      return;
    }
    R.shareBtn.disabled = true;
    try {
      const res = await roomSet({ id: S.sceneId, light: S.light, announce: true });
      if (res && res.ok) {
        toast('已分享给 TA：TA 那边也会切到同一个场景', 'ok', 3600);
        setExpression('tongue', { duration: 1600 });
        burstHearts(6);
      } else {
        toast((res && (res.message || res.error)) || '分享失败，请稍后再试', 'err', 3200);
      }
    } catch (err) {
      toast('分享功能需要更新应用（主进程尚未接入 couple-scene:set）', 'err', 4200);
    } finally {
      R.shareBtn.disabled = false;
    }
  }

  // ================================================================= 伴侣 / 锁定
  function renderPartner() {
    if (!R.partnerHere) return;
    R.partnerHere.classList.toggle('hidden', !S.partnerHere);
  }

  function renderLocked() {
    if (!R.locked) return;
    R.locked.classList.toggle('hidden', !S.locked);
    document.body.classList.toggle('is-locked', S.locked);
  }

  function subscribeSceneEvents() {
    const panel = app.panel;
    if (!panel) return;
    const handleSceneBroadcast = (payload) => {
      if (!payload) return;
      const cs = payload.current ? payload : { current: payload };
      const current = cs.current || {};
      if (current.id && S.scenes.some((x) => x.id === current.id)) S.sceneId = current.id;
      if (current.light === 'light' || current.light === 'dark') S.light = current.light;
      if (Array.isArray(cs.scenes) && cs.scenes.length) S.scenes = cs.scenes;
      if (typeof cs.partnerHere === 'boolean') S.partnerHere = cs.partnerHere;
      if (cs.entitled === false || cs.entitled === true) S.locked = cs.entitled === false || S.locked;
      renderScene();
      renderPartner();
      renderLocked();
      if (payload && payload.announce) toast('TA 把场景切到了「' + sceneOf(S.sceneId).name + '」', 'info', 3000);
    };

    const handler = (payload) => {
      if (!payload) return;
      const data = payload.scene || payload;
      if (data && data.id) S.sceneId = data.id;
      if (data && (data.light === 'light' || data.light === 'dark')) S.light = data.light;
      if (typeof data.partnerHere === 'boolean') S.partnerHere = data.partnerHere;
      renderScene();
      renderPartner();
      if (payload && payload.announce) toast('TA 把场景切到了「' + sceneOf(S.sceneId).name + '」', 'info', 3000);
    };
    try {
      if (typeof panel.onAiMessage === 'function' && typeof panel.onEvent === 'function') {
        const off = panel.onEvent(EVENT_SCENE, handler);
        if (typeof off === 'function') S.unsubscribe.push(off);
      } else if (typeof panel.onEvent === 'function') {
        const off = panel.onEvent(EVENT_SCENE, handler);
        if (typeof off === 'function') S.unsubscribe.push(off);
      } else if (typeof panel.on === 'function') {
        const off = panel.on(EVENT_SCENE, handler);
        if (typeof off === 'function') S.unsubscribe.push(off);
      }
    } catch (err) {
      /* 事件通道未就绪时静默降级 */
    }
  }

  // ================================================================= QA 钩子
  window.__coupleRoom = {
    scene: () => ({ id: S.sceneId, light: S.light, locked: S.locked, partnerHere: S.partnerHere }),
    setScene: (id) => selectScene(id, { silent: true }),
    setLight: (light) => setLight(light, { silent: true }),
    setExpression: (expr) => setExpression(expr),
    timer: () => Object.assign({}, S.timer, { timer: undefined }),
    startTimer: () => {
      if (!S.timer.running) toggleTimer();
    },
    finishTimer: () => {
      S.timer.endAt = Date.now() - 1;
      finishTimer();
    },
    scenes: () => S.scenes.map((s) => s.id),
    locked: () => {
      S.locked = true;
      renderLocked();
    },
    unlock: () => {
      S.locked = false;
      renderLocked();
    },
  };

  window.addEventListener('beforeunload', () => {
    clearInterval(S.timer.timer);
    clearInterval(S.rotateTimer);
    clearTimeout(S.exprTimer);
    for (const off of S.unsubscribe) {
      try {
        off();
      } catch (err) {
        /* ignore */
      }
    }
  });
})();
