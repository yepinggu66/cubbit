'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const { WindowManager } = require('../src/main/windows');
const { AUTONOMY_SCENES } = require('../src/main/pet-brain');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ARTIFACTS = path.join(__dirname, 'artifacts');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function load(win, relativePath, query) {
  const url = new URL(pathToFileURL(path.join(ROOT, relativePath)).href);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  await win.loadURL(url.href);
  await wait(250);
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  }[ext] || 'application/octet-stream';
}

async function startStaticServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      requests.push(pathname + url.search);
      const sitePrefix = '/cubbit/';
      const siteRoot = path.join(ROOT, 'site');
      const base = pathname.startsWith(sitePrefix) ? siteRoot : SRC;
      const relative = pathname.startsWith(sitePrefix) ? pathname.slice(sitePrefix.length - 1) : pathname;
      const filePath = path.resolve(base, '.' + relative);
      if (!filePath.startsWith(base + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'content-type': mimeType(filePath) });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests };
}

async function runPetSmoke() {
  const win = new BrowserWindow({
    show: false,
    width: 520,
    height: 420,
    backgroundColor: '#10131b',
    webPreferences: { contextIsolation: false, sandbox: false },
  });
  await load(win, 'src/renderer/pet/index.html');

  const result = await win.webContents.executeJavaScript(`(async () => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    const cfg = diy.normalize({
      enabled: true,
      paletteId: 'grape',
      hat: 'flower',
      ears: 'bunny',
      tail: 'wings',
      heldId: 'orange',
      temperament: 'curious'
    });
    pet.state().settings.diyPet = cfg;
    pet.palette(diy.palette(cfg));
    pet.applySkin('blaze');
    const node = pet.instances()[0].el;
    const accessory = {
      hat: node.dataset.hat,
      ears: node.dataset.ears,
      tail: node.dataset.tail,
      temperament: node.dataset.temperament,
      held: node.querySelector('.acc-held').textContent
    };

    const actions = {};
    for (const name of ['tiptoe', 'bonk', 'peek', 'flop', 'wave', 'sneeze', 'sniff', 'melt']) {
      const returned = pet.triggerIdle(name);
      const classPresent = node.classList.contains('idle-' + name);
      const target = node.querySelector(
        name === 'flop' || name === 'melt' ? '.squash' :
        name === 'sniff' ? '.pet-bob' :
        name === 'wave' ? '.arm.r' : '.pose'
      );
      actions[name] = {
        returned,
        classPresent,
        animation: getComputedStyle(target).animationName
      };
      pet.cancelIdle();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const sceneIds = pet.scenes();
    const sniffStarted = pet.runScene('curious_sniff', { source: 'qa' });
    await new Promise((resolve) => setTimeout(resolve, 90));
    const sniffState = {
      scene: pet.scene() && pet.scene().id,
      classPresent: node.classList.contains('scene-curious-sniff'),
      idlePresent: node.classList.contains('idle-sniff')
    };
    pet.stopScene();
    pet.cancelIdle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const focusStarted = pet.runScene('focus_quiet', { presence: 'focus' });
    await new Promise((resolve) => setTimeout(resolve, 90));
    const focusState = {
      scene: pet.scene() && pet.scene().id,
      classPresent: node.classList.contains('scene-focus-quiet'),
      previousRemoved: !node.classList.contains('scene-curious-sniff'),
      idlePresent: node.classList.contains('idle-daze')
    };
    pet.stopScene();
    pet.cancelIdle();
    await new Promise((resolve) => setTimeout(resolve, 30));

    pet.dispatch('crawl-start', { dir: 1, scene: 'belly_crawl' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const crawlState = {
      petClass: node.classList.contains('is-crawl'),
      directionClass: node.classList.contains('walk-left'),
      bodyClass: document.body.classList.contains('is-crawling'),
      squashTransform: getComputedStyle(node.querySelector('.squash')).transform
    };
    pet.dispatch('crawl-end', { completed: true, scene: 'belly_crawl' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const crawlEndState = {
      petClassRemoved: !node.classList.contains('is-crawl'),
      bodyClassRemoved: !document.body.classList.contains('is-crawling'),
      scene: pet.scene() && pet.scene().id
    };
    pet.stopScene();
    pet.cancelIdle();
    await new Promise((resolve) => setTimeout(resolve, 30));

    pet.setExpression('blep');
    await new Promise((resolve) => setTimeout(resolve, 30));

    // 人生账本的四条资源 → 毛色 / 待机速度：这里只验证事件被接住、类名与变量都落到 DOM 上
    pet.dispatch('life-resource', { level: 'danger', hue: 0, sat: 0.22, bright: 0.8, tempo: 1.6, line: '' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const lifeMood = {
      cls: node.classList.contains('life-danger'),
      tempoDanger: getComputedStyle(document.documentElement).getPropertyValue('--life-tempo').trim(),
      bodyDanger: document.body.dataset.life,
    };
    pet.dispatch('life-resource', { level: 'steady', hue: 4, sat: 1.12, bright: 1.04, tempo: 0.92, line: '' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    lifeMood.tempo = getComputedStyle(document.documentElement).getPropertyValue('--life-tempo').trim();
    lifeMood.body = document.body.dataset.life;
    lifeMood.steadyCls = node.classList.contains('life-steady');
    lifeMood.dangerRemoved = !node.classList.contains('life-danger');

    return {
      hookActions: pet.actions(),
      expressions: pet.expressions(),
      sceneTests: {
        sceneIds,
        sniffStarted,
        sniffState,
        focusStarted,
        focusState,
        crawlState,
        crawlEndState
      },
      accessory,
      expression: pet.expression(),
      classes: Array.from(node.classList).filter((item) => /^(eyes|mouth|body|fx)--/.test(item)),
      actions,
      lifeMood
    };
  })()`);

  assert.equal(result.accessory.hat, 'flower');
  assert.equal(result.accessory.ears, 'bunny');
  assert.equal(result.accessory.tail, 'wings');
  assert.equal(result.accessory.temperament, 'curious');
  assert.equal(result.accessory.held, '🍊');
  for (const name of ['tiptoe', 'bonk', 'peek', 'flop', 'wave', 'sneeze', 'sniff', 'melt']) {
    assert.ok(result.hookActions.includes(name), `idle action ${name}`);
    assert.equal(result.actions[name].returned, name);
    assert.equal(result.actions[name].classPresent, true, `class ${name}`);
    assert.ok(result.actions[name].animation && result.actions[name].animation !== 'none', `animation ${name}`);
  }
  assert.equal(result.lifeMood.cls, true, '资源状态要落到 pet 的类名上');
  assert.equal(result.lifeMood.bodyDanger, 'danger', 'body 上要能读到当前状态');
  assert.equal(result.lifeMood.body, 'steady', '换状态时 body 也要跟着换');
  assert.equal(result.lifeMood.tempoDanger, '1.6', '状态差时待机要变慢');
  assert.equal(result.lifeMood.tempo, '0.92', '状态好时待机要变快');
  assert.equal(result.lifeMood.steadyCls, true, '换状态要换类名');
  assert.equal(result.lifeMood.dangerRemoved, true, '旧状态的类名必须摘掉');
  assert.ok(result.expressions.includes('blep'));
  assert.ok(result.classes.includes('eyes--wide'));
  assert.ok(result.classes.includes('mouth--tongue'));
  const rendererSceneIds = new Set(result.sceneTests.sceneIds.map((scene) => scene.id));
  for (const sceneId of [...new Set(Object.values(AUTONOMY_SCENES).flat())]) {
    assert.ok(rendererSceneIds.has(sceneId), `renderer implements ${sceneId}`);
  }
  assert.ok(result.sceneTests.sceneIds.length >= 10);
  assert.equal(result.sceneTests.sniffStarted, 'curious_sniff');
  assert.equal(result.sceneTests.sniffState.scene, 'curious_sniff');
  assert.equal(result.sceneTests.sniffState.classPresent, true);
  assert.equal(result.sceneTests.sniffState.idlePresent, true);
  assert.equal(result.sceneTests.focusStarted, 'focus_quiet');
  assert.equal(result.sceneTests.focusState.scene, 'focus_quiet');
  assert.equal(result.sceneTests.focusState.classPresent, true);
  assert.equal(result.sceneTests.focusState.previousRemoved, true);
  assert.equal(result.sceneTests.focusState.idlePresent, true);
  assert.equal(result.sceneTests.crawlState.petClass, true);
  assert.equal(result.sceneTests.crawlState.directionClass, false);
  assert.equal(result.sceneTests.crawlState.bodyClass, true);
  assert.notEqual(result.sceneTests.crawlState.squashTransform, 'none');
  assert.equal(result.sceneTests.crawlEndState.petClassRemoved, true);
  assert.equal(result.sceneTests.crawlEndState.bodyClassRemoved, true);
  assert.equal(result.sceneTests.crawlEndState.scene, 'belly_crawl');

  const releaseForm = await win.webContents.executeJavaScript(`(() => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    const fox = diy.ANIMALS.find((item) => item.id === 'fox');
    const cfg = diy.normalize({ ...fox, animalId: 'fox', enabled: true });
    pet.state().settings.diyPet = cfg;
    pet.palette(diy.palette(cfg));
    pet.applySkin('blaze');
    const node = pet.instances()[0].el;
    const img = node.querySelector('.pet-art');
    return {
      animalCount: diy.ANIMALS.length,
      normalizedAnimal: cfg.animalId,
      renderedAnimal: node.dataset.animal,
      animalForm: node.classList.contains('animal-form'),
      artForm: node.classList.contains('art-form'),
      artSrc: img ? img.getAttribute('src') : '',
      poseVisibility: getComputedStyle(node.querySelector('.pose')).visibility,
    };
  })()`);
  assert.equal(releaseForm.animalCount, 11, '11 只动物应全部开放');
  assert.equal(releaseForm.normalizedAnimal, 'fox');
  assert.equal(releaseForm.renderedAnimal, 'fox');
  assert.equal(releaseForm.artForm, true, '狐狸有渲染图，应走位图层');
  assert.equal(releaseForm.animalForm, false, '位图层与 CSS 轮廓层不能同时挂上');
  assert.match(String(releaseForm.artSrc), /fox-idle-01\.webp$/, `狐狸素材路径不对：${releaseForm.artSrc}`);
  assert.equal(releaseForm.poseVisibility, 'hidden', 'CSS 轮廓层应被隐藏');

  // 行走：位图没有独立的腿，靠整体"颠 + 摆"驱动，必须真的切到 artWalk
  const walkForm = await win.webContents.executeJavaScript(`(() => {
    const pet = window.__cubbitPet;
    const node = document.querySelector('.pet');
    const wrap = node.querySelector('.pet-art-wrap');
    node.classList.add('is-walk');
    const anim = getComputedStyle(wrap).animationName;
    const dur = getComputedStyle(wrap).animationDuration;
    node.classList.add('walk-left');
    const flipped = getComputedStyle(node).transform;
    node.classList.remove('is-walk', 'walk-left');
    return { anim, dur, flipped };
  })()`);
  assert.equal(walkForm.anim, 'artWalk', '行走应切到 artWalk（不是待机呼吸）');
  assert.match(String(walkForm.dur), /0\.34s/, '步频应与窗口 190px/s 的移动对上');
  assert.notEqual(walkForm.flipped, 'none', '向左走应整体翻转');

  await win.webContents.executeJavaScript(`(() => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    const cfg = diy.normalize({
      enabled: true,
      animalId: 'fox',
      paletteId: 'grape',
      hat: 'flower',
      ears: 'bunny',
      tail: 'wings',
      heldId: 'orange',
      temperament: 'curious'
    });
    pet.state().settings.diyPet = cfg;
    pet.palette(diy.palette(cfg));
    pet.applySkin('blaze');
    pet.setExpression('tinyWave');
  })()`);
  await wait(80);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'diy-pet.png'), image.toPNG());

  // 位图形象端到端：切到小猫，确认 pet-art 真的加载出像素（naturalWidth>0），
  // 并且 CSS 轮廓层被隐藏。只断言 class 是不够的，路径错了照样静默失败。
  const artForm = await win.webContents.executeJavaScript(`(async () => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    pet.state().settings.diyPet = diy.normalize({ enabled: true, animalId: 'cat' });
    pet.applySkin('blaze');
    await new Promise((r) => setTimeout(r, 500));
    const node = document.querySelector('.pet');
    const img = node.querySelector('.pet-art');
    const fx = node.querySelector('.pet-art-fx');
    const wrap = node.querySelector('.pet-art-wrap');
    const rect = img ? img.getBoundingClientRect() : { width: 0, height: 0 };
    // 叠加帧先验「解码成功」再验「切换真的可见」：只查 src 会漏掉路径写错的情况
    const fxLoaded = !!(fx && fx.getAttribute('src') && fx.complete && fx.naturalWidth > 0);
    // 宠物此刻可能正处在眯眼/开心/睡觉等「长按闭眼」的状态，会干扰这次测量。
    // 先暂时摘掉这些类测「默认透明 → 眨眼可见」，测完原样还回去。
    const HOLD = ['art-blink', 'is-sleep', 'eyes--crescent', 'eyes--half', 'm-happy'];
    const held = HOLD.filter((c) => node.classList.contains(c));
    // 关掉过渡再量：否则刚摘掉闭眼状态时，45ms 的淡出会让读数停在中间值
    if (fx) fx.style.transition = 'none';
    node.classList.remove(...HOLD);
    void fx.offsetWidth;
    const fxOpacityBefore = fx ? getComputedStyle(fx).opacity : 'n/a';
    node.classList.add('art-blink');
    void fx.offsetWidth;
    const fxOpacityBlink = fx ? getComputedStyle(fx).opacity : 'n/a';
    node.classList.remove('art-blink');
    node.classList.add(...held);
    if (fx) fx.style.transition = '';
    return {
      artForm: node.classList.contains('art-form'),
      animalForm: node.classList.contains('animal-form'),
      src: img && img.getAttribute('src'),
      complete: !!(img && img.complete),
      natural: img ? img.naturalWidth : 0,
      imgDisplay: img ? getComputedStyle(img).display : 'none',
      rectW: Math.round(rect.width),
      rectH: Math.round(rect.height),
      poseVisibility: getComputedStyle(node.querySelector('.pose')).visibility,
      fxSrc: fx && fx.getAttribute('src'),
      fxLoaded,
      fxNatural: fx ? fx.naturalWidth : 0,
      fxOpacityBefore,
      fxOpacityBlink,
      wrapAnimation: wrap ? getComputedStyle(wrap).animationName : 'none',
      wrapRectW: wrap ? Math.round(wrap.getBoundingClientRect().width) : 0,
    };
  })()`);
  assert.equal(artForm.artForm, true, '小猫应走位图层');
  assert.equal(artForm.animalForm, false, '位图层不应同时带 CSS 轮廓 class');
  assert.ok(/assets\/pets\/kitten-idle-01\.webp$/.test(String(artForm.src)), `素材路径不符：${artForm.src}`);
  assert.equal(artForm.complete, true, '图片应加载完成');
  assert.ok(artForm.natural > 0, `图片未真正解码出像素（naturalWidth=${artForm.natural}）`);
  assert.equal(artForm.imgDisplay, 'block');
  assert.ok(artForm.rectW >= 180 && artForm.rectH >= 180, `位图应真实占据版面：${artForm.rectW}x${artForm.rectH}`);
  assert.equal(artForm.poseVisibility, 'hidden', 'CSS 轮廓层应被隐藏');

  // 闭眼帧：必须真的加载出来，且默认透明、加类后不透明
  assert.ok(/kitten-blink-01\.webp$/.test(String(artForm.fxSrc)), `闭眼帧路径不符：${artForm.fxSrc}`);
  assert.equal(artForm.fxLoaded, true, '闭眼帧未解码成功，眨眼会是空的');
  assert.equal(artForm.fxNatural, artForm.natural, '两帧尺寸必须一致，否则切换会跳');
  assert.equal(artForm.fxOpacityBefore, '0', '闭眼帧默认应完全透明');
  assert.equal(artForm.fxOpacityBlink, '1', '加 art-blink 后闭眼帧应可见');

  // 动作层：动画必须真的挂在载体上，否则「不会动」的问题没解决
  assert.equal(artForm.wrapAnimation, 'artIdle', `待机动画未生效：${artForm.wrapAnimation}`);
  assert.ok(artForm.wrapRectW >= 190, `动画载体尺寸异常：${artForm.wrapRectW}`);

  // capturePage 本身要几十毫秒，期间主进程的 state 广播会把 diyPet 冲回旧值，
  // 所以截图前再钉一次状态，确保抓到的就是位图层那一帧。
  await win.webContents.executeJavaScript(`(() => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    pet.state().settings.diyPet = diy.normalize({ enabled: true, animalId: 'cat' });
    pet.applySkin('blaze');
    return document.querySelector('.pet').classList.contains('art-form');
  })()`);
  const artShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'diy-pet-art.png'), artShot.toPNG());

  // 复原，避免影响后面的场景截图
  await win.webContents.executeJavaScript(`(() => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    pet.state().settings.diyPet = diy.normalize({ enabled: true, animalId: 'fox', paletteId: 'grape',
      hat: 'flower', ears: 'bunny', tail: 'wings', heldId: 'orange', temperament: 'curious' });
    pet.applySkin('blaze');
    pet.setExpression('tinyWave');
  })()`);
  await wait(120);

  await win.webContents.executeJavaScript(
    `window.__cubbitPet.dispatch('crawl-start', { dir: 1, scene: 'belly_crawl' })`
  );
  await wait(380);
  const crawlFrame = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'scene-crawl.png'), crawlFrame.toPNG());
  await win.webContents.executeJavaScript(`(() => {
    window.__cubbitPet.dispatch('crawl-end', { completed: false, scene: 'belly_crawl' });
    window.__cubbitPet.stopScene();
    window.__cubbitPet.cancelIdle();
  })()`);
  await wait(80);

  const sceneMoments = [
    { id: 'focus_quiet', waitMs: 900, file: 'scene-focus.png' },
    { id: 'curious_sniff', waitMs: 950, file: 'scene-sniff.png' },
    { id: 'peek_hello', waitMs: 1100, file: 'scene-peek.png' },
    { id: 'playful_spin', waitMs: 1800, file: 'scene-playful.png' },
  ];
  for (const moment of sceneMoments) {
    const started = await win.webContents.executeJavaScript(
      `window.__cubbitPet.runScene(${JSON.stringify(moment.id)}, { source: 'screenshot' })`
    );
    assert.equal(started, moment.id);
    await wait(moment.waitMs);
    const frame = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACTS, moment.file), frame.toPNG());
    await win.webContents.executeJavaScript(`(() => {
      window.__cubbitPet.stopScene();
      window.__cubbitPet.cancelIdle();
    })()`);
    await wait(80);
  }
  win.destroy();
  return { ...result, releaseForm, sceneMoments: sceneMoments.map((item) => item.id) };
}

async function runSettingsSmoke(baseUrl) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    backgroundColor: '#10131b',
    webPreferences: { contextIsolation: false, sandbox: false },
  });
  await win.loadURL(baseUrl + '/renderer/settings/index.html?mock=trial');
  await wait(250);
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#sideNav button')).find((button) => button.textContent.includes('外观')).click()`);
  await wait(120);
  await win.webContents.executeJavaScript(`document.querySelector('.diy-palette[data-id="grape"]').click()`);
  await wait(180);
  await win.webContents.executeJavaScript(`document.querySelector('.diy-option[data-id="bunny"]').click()`);
  await wait(180);
  await win.webContents.executeJavaScript(`document.querySelector('.diy-temperament[data-id="curious"]').click()`);
  await wait(220);
  const afterCurious = await win.webContents.executeJavaScript(
    `document.querySelector('.diy-preview-card__name').textContent`
  );
  await win.webContents.executeJavaScript(`document.querySelector('.diy-card').scrollIntoView({ block: 'start' })`);
  await wait(100);

  const result = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.diy-card');
    const preview = document.querySelector('.diy-preview');
    const active = Array.from(document.querySelectorAll('.diy-animal.is-active,.diy-option.is-active,.diy-palette.is-active,.diy-temperament.is-active'));
    const appearance = document.getElementById('sec-appearance');
    const order = Array.from(appearance.children).slice(0, 5).map((node) => node.id || node.className);
    return {
      name: document.querySelector('.diy-preview-card__name').textContent,
      animal: preview.dataset.animal,
      enabled: preview.dataset.enabled,
      ears: document.querySelector('.diy-preview__ears').dataset.ears,
      animalButtons: document.querySelectorAll('.diy-animal').length,
      previewAnimalDisplay: getComputedStyle(preview.querySelector('.diy-preview__animal')).display,
      cubeBodyDisplay: getComputedStyle(preview.querySelector('.diy-preview__body')).display,
      qualityNote: document.querySelector('.diy-quality-note') && document.querySelector('.diy-quality-note').textContent.trim(),
      wardrobeBar: !!document.querySelector('.diy-wardrobe-bar'),
      activeCount: active.length,
      activeLabels: active.map((node) => node.textContent.trim()),
      order,
      overflow: card.scrollWidth > card.clientWidth,
      optionCount: document.querySelectorAll('.diy-animal,.diy-option,.diy-palette,.diy-temperament').length
    };
  })()`);

  console.log('[settings-smoke]', JSON.stringify(result));
  assert.equal(result.enabled, '1');
  assert.ok(afterCurious.includes('葡萄'));
  assert.ok(afterCurious.includes('好奇鬼'));
  assert.equal(result.animal, 'custom');
  assert.equal(result.ears, 'bunny');
  assert.ok(result.name.includes('葡萄'));
  assert.ok(result.name.includes('好奇鬼'));
  assert.equal(result.animalButtons, 11, '形象按钮 = 11 只动物（方块仔是自由组合项，不占格子）');
  assert.ok(result.wardrobeBar, '设置页应有形象馆入口');
  assert.equal(result.previewAnimalDisplay, 'none');
  assert.equal(result.cubeBodyDisplay, 'block');
  assert.ok(result.qualityNote.includes('方块仔'));
  assert.equal(result.overflow, false);
  assert.ok(result.optionCount >= 40);
  const diyIndex = result.order.findIndex((item) => String(item).includes('diy-card'));
  assert.ok(diyIndex > 0 && diyIndex <= 2, `DIY card should stay near the top: ${JSON.stringify(result.order)}`);

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'diy-settings.png'), image.toPNG());
  win.destroy();
  return result;
}

async function runOnboardingSmoke(baseUrl) {
  const win = new BrowserWindow({
    show: false,
    width: 980,
    height: 760,
    backgroundColor: '#10131b',
    webPreferences: { contextIsolation: false, sandbox: false },
  });
  await win.loadURL(baseUrl + '/renderer/onboarding/index.html?mock=trial');
  await wait(250);
  const selected = await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('[data-cohort="couple"]').click();
    await wait(450);
    const active = document.querySelector('.onb-cohort__option.is-active');
    return {
      active: active && active.getAttribute('data-cohort'),
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  })()`);
  assert.equal(selected.active, 'couple');
  assert.equal(selected.overflow, false);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'onboarding-cohort.png'), image.toPNG());
  const result = await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.getElementById('nextBtn').click();
    await wait(180);
    return {
      step2Visible: !document.querySelector('[data-step="1"]').classList.contains('hidden')
    };
  })()`);
  assert.equal(result.step2Visible, true);
  win.setSize(620, 760);
  await wait(150);
  result.mobileOverflow = await win.webContents.executeJavaScript(
    `document.documentElement.scrollWidth > innerWidth`
  );
  assert.equal(result.mobileOverflow, false);
  win.destroy();
  return result;
}

async function runSiteSmoke(baseUrl, requests) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    backgroundColor: '#10131b',
    webPreferences: { contextIsolation: false, sandbox: false },
  });
  await win.loadURL(baseUrl + '/cubbit/index.html');
  await wait(350);
  const result = await win.webContents.executeJavaScript(`(() => {
    const hero = document.querySelector('[data-track-position="hero"][data-track-download]');
    hero.addEventListener('click', (event) => event.preventDefault(), { once: true });
    hero.click();
    return {
      hook: typeof window.CubbitTrack,
      stable: hero.getAttribute('href'),
      status: document.querySelector('.pill') && document.querySelector('.pill').textContent,
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  })()`);
  await wait(250);
  assert.equal(result.hook, 'object');
  assert.equal(result.stable, 'https://pingguye.cn/cubbit/dl/windows/latest');
  assert.ok(result.status.includes('内部测试版'));
  assert.equal(result.overflow, false);
  assert.ok(requests.some((entry) => entry.startsWith('/cubbit/t.gif?') && entry.includes('event=landing_view')));
  assert.ok(requests.some((entry) => entry.startsWith('/cubbit/t.gif?') && entry.includes('event=download_click')));
  assert.ok(requests.some((entry) => entry.startsWith('/cubbit/t.gif?') && entry.includes('event=download_start')));
  const landingImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'beta-landing.png'), landingImage.toPNG());
  win.setSize(470, 760);
  await wait(180);
  const mobile = await win.webContents.executeJavaScript(`(() => {
    const offenders = Array.from(document.querySelectorAll('*')).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
    }).slice(0, 20).map((node) => ({
      tag: node.tagName,
      cls: node.className || '',
      left: Math.round(node.getBoundingClientRect().left),
      right: Math.round(node.getBoundingClientRect().right),
      width: Math.round(node.getBoundingClientRect().width)
    }));
    return { overflow: document.documentElement.scrollWidth > innerWidth, offenders };
  })()`);
  assert.equal(mobile.overflow, false, JSON.stringify(mobile.offenders));
  result.mobileOverflow = mobile.overflow;
  win.destroy();
  return result;
}

async function runRoamSmoke() {
  const { screen } = require('electron');
  if (!process.argv.includes('--qa-auto-roam')) process.argv.push('--qa-auto-roam');
  const wa = screen.getPrimaryDisplay().workArea;
  const cursor = screen.getCursorScreenPoint();
  const useRight = cursor.x < wa.x + wa.width / 2;
  const x = useRight ? wa.x + wa.width - 420 : wa.x + 20;
  const y = wa.y + 20;
  const win = new BrowserWindow({
    show: false,
    x,
    y,
    width: 380,
    height: 470,
    frame: false,
    transparent: true,
    skipTaskbar: true,
  });
  win.setOpacity(0);
  win.showInactive();
  const events = [];
  const settings = {
    petRoamEnabled: true,
    sizeScale: 1,
    multiPetCount: 1,
  };
  const rt = {
    settings: {
      get: (key) => settings[key],
      patch: (patch) => Object.assign(settings, patch),
    },
    lastPetInteractionAt: 0,
    presence: { snapshot: () => ({ kind: 'working' }) },
    sendToPet: (_channel, event) => events.push(event),
    hasPartnerPet: () => false,
  };
  const manager = new WindowManager(rt);
  manager.petWindow = win;
  manager.petVisible = true;
  manager._canAutoRoam = () => true;
  const before = win.getPosition();
  const scheduled = manager.scheduleAutoRoam(250);
  assert.equal(scheduled, true);
  await wait(3200);
  manager.stopAutoRoam();
  const after = win.getPosition();
  const kinds = events.map((event) => event.kind);
  assert.ok(kinds.includes('walk-start'), JSON.stringify(kinds));
  assert.ok(kinds.includes('walk-end'), JSON.stringify(kinds));
  assert.notDeepEqual(after, before);

  events.length = 0;
  const groundY = wa.y + wa.height - 470;
  const crawlBefore = win.getPosition();
  const crawlDecision = { action: 'crawl', scene: 'belly_crawl', reason: 'qa' };
  const crawlDone = new Promise((resolve) =>
    manager.crawlAutonomously({ qa: true, onDone: resolve, decision: crawlDecision })
  );
  await wait(900);
  const crawlMid = win.getPosition();
  await Promise.race([crawlDone, wait(5200)]);
  const crawlAfter = win.getPosition();
  const crawlKinds = events.map((event) => event.kind);
  assert.ok(crawlKinds.includes('crawl-start'), JSON.stringify(crawlKinds));
  assert.ok(crawlKinds.includes('crawl-end'), JSON.stringify(crawlKinds));
  assert.equal(events.find((event) => event.kind === 'crawl-start').payload.scene, 'belly_crawl');
  assert.equal(events.find((event) => event.kind === 'crawl-end').payload.scene, 'belly_crawl');
  assert.equal(crawlMid[1], groundY);
  assert.equal(crawlAfter[1], groundY);
  assert.notDeepEqual(crawlAfter, crawlBefore);

  events.length = 0;
  const jumpBefore = win.getPosition();
  const jumpDecision = { action: 'jump', scene: 'playful_spin', reason: 'qa' };
  const jumpDone = new Promise((resolve) =>
    manager.hopAutonomously({ qa: true, onDone: resolve, decision: jumpDecision })
  );
  await wait(420);
  const jumpMid = win.getPosition();
  await Promise.race([jumpDone, wait(1600)]);
  const jumpAfter = win.getPosition();
  const jumpKinds = events.map((event) => event.kind);
  assert.ok(jumpKinds.includes('jump-start'), JSON.stringify(jumpKinds));
  assert.ok(jumpKinds.includes('jump-end'), JSON.stringify(jumpKinds));
  assert.equal(events.find((event) => event.kind === 'jump-start').payload.scene, 'playful_spin');
  assert.equal(events.find((event) => event.kind === 'jump-end').payload.scene, 'playful_spin');
  assert.notDeepEqual(jumpMid, jumpBefore);
  assert.deepEqual(jumpAfter, jumpBefore);

  events.length = 0;
  const climbBefore = win.getPosition();
  const climbDecision = { action: 'climb', scene: 'brave_climb', reason: 'qa' };
  const climbDone = new Promise((resolve) =>
    manager.climbAutonomously({ qa: true, onDone: resolve, decision: climbDecision })
  );
  await wait(1050);
  const climbMid = win.getPosition();
  await Promise.race([climbDone, wait(1700)]);
  const climbAfter = win.getPosition();
  const climbKinds = events.map((event) => event.kind);
  assert.ok(climbKinds.includes('climb'), JSON.stringify(climbKinds));
  assert.ok(climbKinds.includes('climb-end'), JSON.stringify(climbKinds));
  assert.equal(events.find((event) => event.kind === 'climb').payload.scene, 'brave_climb');
  assert.equal(events.find((event) => event.kind === 'climb-end').payload.scene, 'brave_climb');
  assert.notDeepEqual(climbMid, climbBefore);
  assert.ok(climbAfter[1] < climbBefore[1], `${JSON.stringify(climbBefore)} -> ${JSON.stringify(climbAfter)}`);

  const result = {
    before,
    after,
    events: kinds,
    crawl: { before: crawlBefore, mid: crawlMid, after: crawlAfter, groundY, events: crawlKinds },
    jump: { before: jumpBefore, mid: jumpMid, after: jumpAfter, events: jumpKinds },
    climb: { before: climbBefore, mid: climbMid, after: climbAfter, events: climbKinds },
  };
  win.destroy();
  return result;
}

async function runHeroCapture() {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 460,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: false, sandbox: false },
  });
  await load(win, 'src/renderer/pet/index.html');
  const heroRect = await win.webContents.executeJavaScript(`(() => {
    const pet = window.__cubbitPet;
    const diy = window.CUBBIT_DIY;
    const cfg = diy.normalize({
      enabled: true,
      animalId: 'fox',
      paletteId: 'peach',
      hat: 'flower',
      ears: 'none',
      tail: 'none',
      heldId: 'none',
      temperament: 'soft'
    });
    pet.state().settings.diyPet = cfg;
    pet.state().settings.sizeScale = 1;
    pet.palette(diy.palette(cfg));
    pet.applySkin('blaze');
    pet.setExpression('happy');
    document.documentElement.style.setProperty('--pet-scale', '1.35');
    document.body.classList.add('reduce-motion');
    const stage = document.getElementById('stage');
    stage.style.background = 'transparent';
    const hint = document.getElementById('dragHint');
    if (hint) hint.remove();
    const row = document.querySelector('.pet-row');
    if (row) row.style.bottom = '24px';
    const rect = document.querySelector('.pet').getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(rect.left - 26)),
      y: Math.max(0, Math.floor(rect.top - 26)),
      width: Math.ceil(rect.width + 52),
      height: Math.ceil(rect.height + 52)
    };
  })()`);
  await wait(350);
  const image = await win.webContents.capturePage(heroRect);
  fs.writeFileSync(path.join(ARTIFACTS, 'hero-cube.png'), image.toPNG());
  const size = image.getSize();
  win.destroy();
  return size;
}

/**
 * 人生账本：走真实 IPC + 真实 preload，验证"一天一步"端到端成立。
 * 这里不 mock 渲染层，因为最容易出错的地方恰恰是 IPC 白名单和持久化。
 */
async function runLedgerSmoke(port) {
  const { ipcMain } = require('electron');
  const { Ledger } = require('../src/main/ledger');
  const { INVOKE } = require('../src/shared/ipc');

  const tmpFile = path.join(app.getPath('temp'), `cubbit-ledger-smoke-${process.pid}.json`);
  try { fs.unlinkSync(tmpFile); } catch { /* 第一次跑没有这个文件 */ }
  const ledger = new Ledger({ filePath: tmpFile });

  for (const ch of [INVOKE.LIFE_STATE, INVOKE.LIFE_CHOOSE, INVOKE.LIFE_RESTART, INVOKE.APP_PANEL_WINDOW]) {
    ipcMain.removeHandler(ch);
  }
  ipcMain.handle(INVOKE.LIFE_STATE, () => ledger.snapshot());
  ipcMain.handle(INVOKE.LIFE_CHOOSE, (_e, p) => ledger.choose(p && p.cardId, p && p.action));
  ipcMain.handle(INVOKE.LIFE_RESTART, () => ledger.restart());
  ipcMain.handle(INVOKE.APP_PANEL_WINDOW, () => ({ ok: true }));

  const win = new BrowserWindow({
    width: 960,
    height: 780,
    show: false,
    webPreferences: {
      preload: path.join(SRC, 'preload', 'panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const errors = [];
  // Electron 新版把 console-message 的参数收进了一个对象，两种签名都兼容，
  // 否则这个"零控制台错误"的断言会永远为真，等于没测。
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'number' ? args[1] : args[0] && args[0].level;
    const message = typeof args[2] === 'string' ? args[2] : args[0] && args[0].message;
    if (level === 'error' || level >= 2) {
      const text = String(message || '');
      // 开发态窗口没有注入 CSP，Electron 会打一条安全警告；打包后不存在，不算页面错误
      if (/Electron Security Warning/.test(text)) return;
      errors.push(text);
    }
  });

  await load(win, 'src/renderer/ledger/index.html');
  await wait(600);

  const first = await win.webContents.executeJavaScript(`(() => ({
    meters: document.querySelectorAll('.meter').length,
    cards: document.querySelectorAll('.card').length,
    titles: [...document.querySelectorAll('.card__title')].map((n) => n.textContent.trim()),
    evs: [...document.querySelectorAll('.ev')].map((n) => n.textContent.trim()),
    btnDisabled: [...document.querySelectorAll('.actions__btns .btn')].map((b) => b.disabled),
  }))()`);

  assert.equal(first.meters, 4, '应显示寿命/现金/精力/自由四条');
  assert.equal(first.cards, 3, '一天抽三张');
  assert.equal(first.titles.length, 3);
  for (const t of first.titles) assert.ok(t.length > 3, `卡面标题太短：${t}`);
  for (const e of first.evs) assert.match(e, /证据 [ABC]/);
  assert.deepEqual(first.btnDisabled, [true, true], '没选卡之前两个按钮都应禁用（disabled 属性写错会变成可点）');

  // 选第一张 → 按钮解锁
  await win.webContents.executeJavaScript(`document.querySelectorAll('.card')[0].click()`);
  await wait(160);
  const afterPick = await win.webContents.executeJavaScript(`(() => ({
    disabled: [...document.querySelectorAll('.actions__btns .btn')].map((b) => b.disabled),
    selected: document.querySelectorAll('.card.is-sel').length,
  }))()`);
  assert.deepEqual(afterPick.disabled, [false, false], '选中卡之后应可执行');
  assert.equal(afterPick.selected, 1);

  // 执行 → 结算
  await win.webContents.executeJavaScript(`document.querySelectorAll('.actions__btns .btn')[1].click()`);
  await wait(500);

  const result = await win.webContents.executeJavaScript(`(() => {
    const d = [...document.querySelectorAll('.delta')].map((n) => n.textContent.trim());
    return {
      hasResult: !!document.querySelector('.result'),
      deltas: d,
      passing: (document.querySelector('.passing') || {}).textContent || '',
      line: (document.querySelector('.result__line') || {}).textContent || '',
      recent: document.querySelectorAll('.recent__row').length,
    };
  })()`);

  assert.equal(result.hasResult, true, '应进入结算视图');
  assert.ok(result.deltas.length >= 1, '结算应有增减标签');
  assert.match(result.passing, /又过一年/, '时间流逝必须单独一行，不能混进卡片效果');
  assert.ok(result.line.length > 6, '结算应有宠物台词');
  assert.equal(result.recent, 1, '结算页应列出刚走的这一步');

  const saved = ledger.state();
  assert.equal(saved.turn, 1, '主进程状态应已推进');
  assert.ok(saved.lastPlayDay, '应记下今天已经走过');
  assert.equal(saved.log.length, 1);

  // 同一天再打开：应进入"今天已经走完"
  await load(win, 'src/renderer/ledger/index.html');
  await wait(500);
  const again = await win.webContents.executeJavaScript(`(() => ({
    wait: !!document.querySelector('.wait'),
    cards: document.querySelectorAll('.card').length,
  }))()`);
  assert.equal(again.wait, true, '同一天再打开应显示"今天已走完"');
  assert.equal(again.cards, 0, '不该再发一批新卡');

  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, 'ledger-panel.png'), shot.toPNG());

  assert.deepEqual(errors, [], `账本面板有控制台错误：${errors.join(' | ')}`);
  win.destroy();
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  return { cards: first.cards, turn: saved.turn, waitView: again.wait };
}

app.whenReady().then(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  let server = null;
  try {
    const webServer = await startStaticServer();
    server = webServer.server;
    const pet = await runPetSmoke();
    const settings = await runSettingsSmoke(`http://127.0.0.1:${server.address().port}`);
    const onboarding = await runOnboardingSmoke(`http://127.0.0.1:${server.address().port}`);
    const site = await runSiteSmoke(`http://127.0.0.1:${server.address().port}`, webServer.requests);
    const roam = await runRoamSmoke();
    const ledger = await runLedgerSmoke(server.address().port);
    const hero = await runHeroCapture();
    console.log(JSON.stringify({ ok: true, pet, settings, onboarding, site, roam, ledger, hero }, null, 2));
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    if (server) server.close();
    app.exit(1);
  }
});
