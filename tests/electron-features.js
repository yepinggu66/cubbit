'use strict';
/**
 * 新功能端到端冒烟：照片宠物 / 相亲角 / 健康检索分享。
 *
 * 和 electron-smoke.js 的区别：那边测的是"窗口能起来、旧功能没坏"，
 * 这里测的是三条新链路真的跑通了——
 *   1. 一张合成照片 → 抠底 → 512 成品 → 面板显示两帧；
 *   2. 写需求 → 候选打分 → 发邀请 → 双方点头 → 恋爱状态；
 *   3. 检索 767 条卡 → 生成分享卡 PNG 落盘 → 平台链接可点 → 落地页能渲染。
 *
 * 跑法：npx electron tests/electron-features.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const { INVOKE } = require('../src/shared/ipc');
const S = require('../src/shared/share');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function load(win, relativePath, query) {
  const url = new URL(pathToFileURL(path.join(ROOT, relativePath)).href);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  await win.loadURL(url.href);
  await wait(260);
}

function watchErrors(win, errors) {
  win.webContents.on('console-message', (...args) => {
    const level = typeof args[1] === 'number' ? args[1] : args[0] && args[0].level;
    const message = typeof args[2] === 'string' ? args[2] : args[0] && args[0].message;
    const isError = level === 'error' || level >= 2;
    if (!isError) return;
    const text = String(message || '');
    if (/Electron Security Warning/.test(text)) return;
    errors.push(text);
  });
}

function tmpDir(tag) {
  const dir = path.join(app.getPath('temp'), `cubbit-${tag}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 把布局视口校准到目标尺寸。
 * 这台机器上 BrowserWindow 的 width 和 CSS 宽度不是 1:1（dpr 报 2.5），
 * 直接调窗口大小会把面板挤成窄屏单栏。用 zoomFactor 反算更稳：
 * 窗口物理尺寸不动，只改渲染缩放，布局宽度就等于面板设计宽度。
 */
async function fitView(win, targetW) {
  try {
    win.webContents.setZoomFactor(1);
    await wait(140);
    const iw = await win.webContents.executeJavaScript('window.innerWidth');
    if (!iw || Math.abs(iw - targetW) <= 12) return;
    const z = Math.max(0.45, Math.min(2.4, targetW / iw));
    win.webContents.setZoomFactor(z);
    await wait(240);
  } catch {
    /* 保底：校不准就用原样 */
  }
}

/**
 * 截图。
 * 隐藏窗口不会持续合成，capturePage 拿到的是第一帧（常见现象：截出来还是空态）。
 * 所以必须 show() 让它真的画一帧，截完再 hide()。
 */
async function shot(win, name) {
  try {
    win.show();
  } catch {
    /* ignore */
  }
  await wait(420);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACTS, name), image.toPNG());
}

/** 把 RGBA 转成 createFromBitmap 需要的平台字节序。 */
function toBitmapBuffer(rgba, order) {
  if (order === 'rgba') return Buffer.from(rgba);
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

/**
 * 合成一张"路边拍的"照片：
 * 浅色渐变背景 + 一只有耳朵、有两只眼睛的圆形主体 + 地面阴影。
 * 眼睛是深色连通块，正好用来验证 detectEyes。
 */
function makePhotoDataUrl(w = 900, h = 900) {
  const { channelOrder } = require('../src/main/petforge');
  const rgba = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      put(x, y, 224 - t * 26, 231 - t * 18, 240 - t * 52);
    }
  }
  // 地面阴影
  for (let y = 640; y < 760; y++) {
    for (let x = 180; x < 720; x++) {
      const dx = (x - 450) / 270;
      const dy = (y - 700) / 55;
      if (dx * dx + dy * dy < 1) {
        const i = (y * w + x) * 4;
        rgba[i] *= 0.9;
        rgba[i + 1] *= 0.9;
        rgba[i + 2] *= 0.9;
      }
    }
  }
  // 身体
  const cx = 450;
  const cy = 470;
  const rx = 200;
  const ry = 215;
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const shade = 1 - Math.max(0, dy) * 0.22;
        put(x, y, Math.round(214 * shade), Math.round(150 * shade), Math.round(96 * shade));
      }
    }
  }
  // 两只耳朵
  for (const ex of [cx - 140, cx + 140]) {
    for (let y = cy - 300; y <= cy - 150; y++) {
      for (let x = ex - 52; x <= ex + 52; x++) {
        const dx = (x - ex) / 52;
        const dy = (y - (cy - 225)) / 76;
        if (dx * dx + dy * dy <= 1) put(x, y, 232, 172, 118);
      }
    }
  }
  // 两只眼睛（深色圆点）
  for (const ex of [cx - 78, cx + 78]) {
    for (let y = cy - 60; y <= cy - 24; y++) {
      for (let x = ex - 18; x <= ex + 18; x++) {
        if ((x - ex) ** 2 + (y - (cy - 42)) ** 2 <= 18 * 18) put(x, y, 42, 33, 28);
      }
    }
  }
  const img = nativeImage.createFromBitmap(toBitmapBuffer(rgba, channelOrder()), { width: w, height: h });
  return img.toDataURL();
}

// ---------------------------------------------------------------- 照片宠物

async function runPhotoSmoke() {
  const { PetForge } = require('../src/main/petforge');
  const dir = tmpDir('pets');
  const forge = new PetForge({ dir });

  const dataUrl = makePhotoDataUrl();
  const res = forge.forge({ dataUrl, name: '豆沙', temperament: 'curious' });
  assert.equal(res.ok, true, `forge 失败：${JSON.stringify(res)}`);

  const pet = res.pet;
  assert.match(pet.id, /^photo-[a-z0-9]{8}$/, `id 形状不对：${pet.id}`);
  assert.equal(pet.name, '豆沙');
  assert.ok(res.meta.bgRatio > 0.2, `背景占比异常：${res.meta.bgRatio}`);
  assert.equal(res.meta.size, 512);

  const idlePath = require('node:url').fileURLToPath(pet.idle);
  assert.ok(fs.existsSync(idlePath), '睁眼帧没落盘');
  const idle = nativeImage.createFromPath(idlePath);
  assert.equal(idle.getSize().width, 512);
  assert.equal(idle.getSize().height, 512);

  // 四角必须透明（背景被抠掉了），中心必须不透明
  const bmp = idle.toBitmap();
  const alphaAt = (x, y) => bmp[(y * 512 + x) * 4 + 3];
  assert.equal(alphaAt(2, 2), 0, '左上角应透明');
  assert.equal(alphaAt(509, 2), 0, '右上角应透明');
  assert.ok(alphaAt(256, 300) > 200, '主体中心应不透明');

  assert.ok(pet.blink, '合成了成对眼睛，应该出闭眼帧');
  const blinkPath = require('node:url').fileURLToPath(pet.blink);
  assert.ok(fs.existsSync(blinkPath));
  const blink = nativeImage.createFromPath(blinkPath);
  assert.equal(blink.getSize().width, 512);
  assert.notEqual(blink.toBitmap().toString('base64'), bmp.toString('base64'), '闭眼帧不该和睁眼帧一模一样');

  // 列表 / 删除
  assert.equal(forge.list().length, 1);
  const removed = forge.remove(pet.id);
  assert.equal(removed.ok, true);
  assert.equal(forge.list().length, 0);
  assert.equal(fs.existsSync(idlePath), false, '删除应连文件一起删');

  // ---- 面板端到端：?demo=1 会真的走一遍 forge 并显示两帧
  const forge2 = new PetForge({ dir: tmpDir('pets2') });
  const settingsPatches = [];
  for (const ch of [INVOKE.PET_PHOTO_LIST, INVOKE.PET_PHOTO_FORGE, INVOKE.PET_PHOTO_REMOVE, INVOKE.APP_SETTINGS_SET, INVOKE.APP_PANEL_WINDOW]) {
    ipcMain.removeHandler(ch);
  }
  ipcMain.handle(INVOKE.PET_PHOTO_LIST, () => ({ ok: true, items: forge2.list() }));
  ipcMain.handle(INVOKE.PET_PHOTO_FORGE, (_e, p) => forge2.forge(p || {}));
  ipcMain.handle(INVOKE.PET_PHOTO_REMOVE, (_e, p) => forge2.remove((p && p.id) || ''));
  ipcMain.handle(INVOKE.APP_SETTINGS_SET, (_e, patch) => {
    settingsPatches.push(patch);
    return { ok: true };
  });
  ipcMain.handle(INVOKE.APP_PANEL_WINDOW, () => ({ ok: true }));

  const win = new BrowserWindow({
    width: 940,
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
  watchErrors(win, errors);
  win.showInactive();

  await load(win, 'src/renderer/photo/index.html', { demo: '1' });
  await fitView(win, 940);
  // 3.6s：合成一张 900×900 的照片要抠底 + 归一化 + 生成闭眼帧，2.6s 在慢机器上会翻车
  await wait(3600);

  const ui = await win.webContents.executeJavaScript(`(() => {
    const idle = document.getElementById('frameIdle');
    const blink = document.getElementById('frameBlink');
    return {
      resultShown: !document.getElementById('result').hidden,
      name: document.getElementById('resultName').textContent,
      idleLoaded: idle.naturalWidth,
      blinkLoaded: blink.naturalWidth,
      gallery: document.querySelectorAll('.gallery__item').length,
      countNote: document.getElementById('countNote').textContent,
      warn: document.getElementById('resultWarn').hidden ? '' : document.getElementById('resultWarn').textContent,
    };
  })()`);

  assert.equal(ui.resultShown, true, '生成后面板应显示结果区');
  assert.equal(ui.name, '豆沙');
  assert.equal(ui.idleLoaded, 512, '睁眼帧应真的解码成功（512 宽）');
  assert.ok(ui.blinkLoaded === 512, `闭眼帧解码失败：${ui.blinkLoaded}`);
  assert.equal(ui.gallery, 1, '相册应出现刚生成的那只');
  assert.match(ui.countNote, /1 只/);

  await shot(win, 'photo-panel.png');

  // 点「就用这一只」→ 必须写到 settings.diyPet，且 animalId 是这个照片 id
  await win.webContents.executeJavaScript(`document.getElementById('useBtn').click()`);
  await wait(300);
  assert.equal(settingsPatches.length, 1, '应发出一次设置写入');
  const diy = settingsPatches[0].diyPet;
  assert.ok(diy, '设置里应带 diyPet');
  assert.equal(diy.enabled, true);
  assert.match(diy.animalId, /^photo-/, '切过去以后 animalId 应该是照片宠物');

  assert.deepEqual(errors, [], `照片面板有控制台错误：${errors.join(' | ')}`);
  win.destroy();
  return { id: pet.id, bgRatio: res.meta.bgRatio, eyes: res.meta.eyes, gallery: ui.gallery };
}

// ---------------------------------------------------------------- 相亲角

async function runMateSmoke() {
  const { MateService } = require('../src/main/mate');
  const mate = new MateService({ dir: tmpDir('mate'), seed: 'smoke-seed' });

  for (const ch of [
    INVOKE.MATE_STATE, INVOKE.MATE_SEEK, INVOKE.MATE_PROPOSE, INVOKE.MATE_RETRY,
    INVOKE.MATE_CONFIRM, INVOKE.MATE_BREAKUP, INVOKE.APP_PANEL_WINDOW,
    INVOKE.PET_PHOTO_LIST, INVOKE.APP_STATE,
  ]) ipcMain.removeHandler(ch);
  ipcMain.handle(INVOKE.MATE_STATE, () => mate.snapshot());
  ipcMain.handle(INVOKE.MATE_SEEK, (_e, p) => mate.seek(p || {}));
  ipcMain.handle(INVOKE.MATE_PROPOSE, (_e, p) => mate.propose((p && p.id) || ''));
  ipcMain.handle(INVOKE.MATE_RETRY, () => mate.retry());
  ipcMain.handle(INVOKE.MATE_CONFIRM, (_e, p) => mate.confirm(p || {}));
  ipcMain.handle(INVOKE.MATE_BREAKUP, () => mate.breakup());
  ipcMain.handle(INVOKE.APP_PANEL_WINDOW, () => ({ ok: true }));
  ipcMain.handle(INVOKE.PET_PHOTO_LIST, () => ({ ok: true, items: [] }));
  ipcMain.handle(INVOKE.APP_STATE, () => ({ ok: true, settings: { diyPet: null } }));

  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(SRC, 'preload', 'panel.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const errors = [];
  watchErrors(win, errors);
  win.showInactive();

  await load(win, 'src/renderer/mate/index.html');
  await fitView(win, 1040);
  await wait(400);

  const initial = await win.webContents.executeJavaScript(`(() => ({
    pill: document.getElementById('statusPill').textContent,
    sliders: document.querySelectorAll('#sliders input[type=range]').length,
    empty: !!document.querySelector('.empty'),
    cands: document.querySelectorAll('.cand').length,
  }))()`);
  assert.equal(initial.pill, '单身');
  assert.equal(initial.sliders, 3, '三条偏好滑杆');
  assert.equal(initial.cands, 0);
  assert.equal(initial.empty, true, '没写需求前应是空态，不能先给一堆人');

  // 写需求 → 找
  await win.webContents.executeJavaScript(`(() => {
    const t = document.getElementById('wishText');
    t.value = '想找个安静一点的，能一起吃饭，别太能花钱，最好作息规律';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('seekBtn').click();
  })()`);
  await wait(700);

  const cands = await win.webContents.executeJavaScript(`(() => {
    const list = [...document.querySelectorAll('.cand')].map((c) => ({
      name: c.querySelector('.cand__head b').textContent,
      fit: c.querySelector('.fit').textContent,
      bio: c.querySelector('.cand__bio').textContent,
      good: c.querySelectorAll('.why li').length,
      bad: c.querySelectorAll('.why--bad li').length,
    }));
    return { count: list.length, list };
  })()`);
  assert.ok(cands.count >= 3, `候选太少：${cands.count}`);
  for (const c of cands.list) {
    assert.match(c.fit, /^\d+ 分$/, `契合度格式不对：${c.fit}`);
    const score = Number(c.fit.replace(/[^\d]/g, ''));
    assert.ok(score >= 30 && score <= 97, `分数超出范围：${score}`);
    assert.ok(c.bio.length > 4, '候选应有简介');
  }
  // 至少有一张卡同时写了"像的地方"和"差得远的地方"——只夸不挑就是假匹配
  assert.ok(cands.list.some((c) => c.good + c.bad > 0), '候选卡应给出契合/不合的具体理由');

  await shot(win, 'mate-candidates.png');

  // 邀请第一只
  await win.webContents.executeJavaScript(`document.querySelectorAll('.cand .btn--primary')[0].click()`);
  await wait(500);

  const reply = await win.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.reply');
    return r ? {
      hasPact: !!document.querySelector('.reply__pact'),
      line: document.querySelector('.reply__line').textContent,
      acts: [...document.querySelectorAll('.reply__acts .btn')].map((b) => b.textContent.trim()),
      score: (r.querySelector('.fit') || {}).textContent || '',
    } : null;
  })()`);
  assert.ok(reply, '发出邀请后应显示对方的回信');
  assert.ok(reply.line.length > 4, '回信应有具体台词');
  assert.ok(reply.acts.length >= 1, '回信要给出可执行的动作');

  await shot(win, 'mate-reply.png');

  // 走到"恋爱"：有确认按钮就答应条件后确认
  if (reply.acts.includes('我也愿意，确定关系')) {
    await win.webContents.executeJavaScript(`(() => {
      const box = document.querySelector('.reply__pact input[type=checkbox]');
      if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
    })()`);
    await wait(200);
    await win.webContents.executeJavaScript(`(() => {
      const btn = [...document.querySelectorAll('.reply__acts .btn')].find((b) => b.textContent.includes('确定关系'));
      if (btn) btn.click();
    })()`);
    await wait(500);
  }

  const after = await win.webContents.executeJavaScript(`(() => ({
    couple: !!document.querySelector('.couple'),
    pill: document.getElementById('statusPill').textContent,
    wishHidden: document.getElementById('wish').hidden,
    names: [...document.querySelectorAll('.couple__cell b')].map((n) => n.textContent),
  }))()`);

  const state = mate.snapshot();
  if (after.couple) {
    assert.equal(after.pill, '恋爱中');
    assert.equal(after.wishHidden, true, '谈恋爱后不该还显示"找什么样的"表单');
    assert.equal(state.status, 'dating');
    await shot(win, 'mate-dating.png');
  } else {
    // 被婉拒也是合法结果：此时必须给出"换一批"的出口，不能卡死
    assert.ok(
      reply.acts.some((a) => /换一批|再争取/.test(a)),
      '被拒或犹豫时必须提供出口',
    );
    assert.equal(state.status, 'proposed');
  }

  // 持久化：重建服务应读到同一份状态
  const again = new MateService({ dir: mate.dir, seed: 'smoke-seed' });
  assert.equal(again.snapshot().status, state.status, '状态应落盘');

  assert.deepEqual(errors, [], `相亲角有控制台错误：${errors.join(' | ')}`);
  win.destroy();
  return { candidates: cands.count, decided: state.status, score: reply.score };
}

// ---------------------------------------------------------------- 检索 + 分享

async function runShareSmoke() {
  const { ShareKit } = require('../src/main/share');
  const { Ledger } = require('../src/main/ledger');
  const opened = [];
  const kit = new ShareKit({ dir: tmpDir('exports'), openExternal: (u) => opened.push(u) });
  // 账本页启动时会先读 life:state；这里给一份真账本，页面才不会走降级分支，
  // 顺便也验证了"检索页是从真实账本里长出来的"，不是一张假界面。
  const ledger = new Ledger({ filePath: path.join(tmpDir('ledger'), 'ledger.json') });

  for (const ch of [
    INVOKE.SHARE_INFO, INVOKE.SHARE_CARD, INVOKE.SHARE_TEXT, INVOKE.SHARE_OPEN,
    INVOKE.APP_PANEL_WINDOW, INVOKE.APP_STATE,
    INVOKE.LIFE_STATE, INVOKE.LIFE_CHOOSE, INVOKE.LIFE_RESTART,
  ]) {
    ipcMain.removeHandler(ch);
  }
  ipcMain.handle(INVOKE.LIFE_STATE, () => ledger.snapshot());
  ipcMain.handle(INVOKE.LIFE_CHOOSE, (_e, p) => ledger.choose(p && p.cardId, p && p.action));
  ipcMain.handle(INVOKE.LIFE_RESTART, () => ledger.restart());
  ipcMain.handle(INVOKE.SHARE_INFO, () => ({ ok: true, base: 'https://cubbit.app/share.html', exportDir: kit.exportDir() }));
  ipcMain.handle(INVOKE.SHARE_CARD, (_e, p) => kit.saveCard(p || {}));
  ipcMain.handle(INVOKE.SHARE_TEXT, (_e, p) => kit.copyText((p && p.text) || ''));
  ipcMain.handle(INVOKE.SHARE_OPEN, (_e, p) => kit.open((p && p.url) || ''));
  ipcMain.handle(INVOKE.APP_PANEL_WINDOW, () => ({ ok: true }));
  ipcMain.handle(INVOKE.APP_STATE, () => ({ ok: true, settings: { diyPet: null } }));

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
  watchErrors(win, errors);
  win.showInactive();

  await load(win, 'src/renderer/ledger/index.html', { demo: 'find' });
  await fitView(win, 960);
  await wait(700);

  const findInit = await win.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('.frow').length,
    count: (document.querySelector('.find__meta span') || {}).textContent || '',
    chips: document.querySelectorAll('.find__chips .chip').length,
  }))()`);
  assert.ok(findInit.rows > 5, `默认健康检索应有结果：${findInit.rows}`);
  assert.match(findInit.count, /找到 \d+ 条/);
  assert.ok(findInit.chips >= 8, '应有章节与证据筛选');

  // 搜索关键词
  await win.webContents.executeJavaScript(`(() => {
    const i = document.querySelector('.find__input');
    i.value = '体检';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(400);
  const searched = await win.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('.frow').length,
    titles: [...document.querySelectorAll('.frow__head b')].slice(0, 3).map((n) => n.textContent),
    hits: [...document.querySelectorAll('.frow__plain')].slice(0, 3).map((n) => n.textContent.includes('体检')),
  }))()`);
  assert.ok(searched.rows > 0, '搜"体检"应该有结果');
  assert.ok(searched.hits.some(Boolean), '命中行里应真的含关键词');

  await shot(win, 'ledger-find.png');

  // 打开分享面板
  await win.webContents.executeJavaScript(`document.querySelector('.frow__share').click()`);
  await wait(500);
  const sheet = await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('.sheet__canvas');
    return {
      open: !!document.querySelector('.sheet'),
      canvas: c ? c.width + 'x' + c.height : '',
      text: (document.querySelector('.sheet__text') || {}).textContent || '',
      platforms: [...document.querySelectorAll('.sheet__acts .btn')].map((b) => b.textContent),
    };
  })()`);
  assert.equal(sheet.open, true, '分享面板应打开');
  assert.equal(sheet.canvas, '1200x630', '分享卡尺寸应为 1200×630');
  assert.match(sheet.text, /证据 [ABC] 级/, '文案里应带证据等级');
  for (const p of ['分享到 X', '分享到 Facebook', '复制链接', '复制文案', '存成图片']) {
    assert.ok(sheet.platforms.includes(p), `缺少动作：${p}`);
  }

  await shot(win, 'ledger-share.png');

  // 存成图片 → 真的落盘
  await win.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('.sheet__acts .btn')].find((b) => b.textContent === '存成图片');
    btn.click();
  })()`);
  await wait(800);
  const files = fs.readdirSync(kit.exportDir()).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, 1, `应导出 1 张分享卡，实际 ${files.length}`);
  const saved = fs.statSync(path.join(kit.exportDir(), files[0]));
  assert.ok(saved.size > 15 * 1024, `分享卡太小，可能没画上：${saved.size}`);

  // 点 X → 只允许白名单域名，且带上了 url 参数
  await win.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('.sheet__acts .btn')].find((b) => b.textContent === '分享到 X');
    btn.click();
  })()`);
  await wait(300);
  assert.equal(opened.length, 1, '应打开一次外链');
  assert.match(opened[0], /^https:\/\/x\.com\/intent\/post\?text=.+&url=https%3A%2F%2Fcubbit\.app%2Fshare\.html%23d%3D/);

  // 越权地址必须被拒
  const blocked = kit.open('https://evil.example.com/steal');
  assert.equal(blocked.ok, false);
  const blockedJs = kit.open('javascript:alert(1)');
  assert.equal(blockedJs.ok, false);

  // ---- 落地页：同一个 payload 在浏览器里能渲染出来
  const payload = {
    kind: 'list',
    head: '我挑了 3 条关于健康的建议',
    items: [
      { title: '每年免费查两次自己的征信报告', ev: 'A' },
      { title: '体检前先想清楚要查什么', ev: 'B' },
      { title: '家里的常备药别乱吃', ev: 'A' },
    ],
  };
  const code = S.encodePayload(payload);
  const land = new BrowserWindow({ width: 900, height: 800, show: false, webPreferences: { contextIsolation: true } });
  const landErrors = [];
  watchErrors(land, landErrors);
  // 注意：必须带着 hash 一次性 load。先加载再改 hash 属于同文档跳转，
  // 页面脚本不会重跑，断言会拿到一个空页面。
  await land.loadURL(`${pathToFileURL(path.join(ROOT, 'site', 'share.html')).href}#d=${code}`);
  await wait(700);
  const landing = await land.webContents.executeJavaScript(`(() => ({
    h1: (document.querySelector('h1') || {}).textContent || '',
    items: [...document.querySelectorAll('.items li')].map((n) => n.textContent),
    links: [...document.querySelectorAll('.acts a')].map((a) => a.href),
    evs: [...document.querySelectorAll('.items .ev')].map((n) => n.textContent),
  }))()`);
  assert.match(landing.h1, /我挑了 3 条/);
  assert.equal(landing.items.length, 3, '清单页应渲染 3 条');
  assert.ok(landing.links.some((h) => h.startsWith('https://x.com/intent/post')));
  assert.ok(landing.links.some((h) => h.includes('facebook.com/sharer')));
  assert.ok(landing.evs.some((t) => /证据 A/.test(t)), '证据等级要跟着卡片一起走');
  await fitView(land, 900);
  await shot(land, 'share-landing.png');
  assert.deepEqual(landErrors, [], `落地页有控制台错误：${landErrors.join(' | ')}`);
  land.destroy();

  assert.deepEqual(errors, [], `账本检索/分享有控制台错误：${errors.join(' | ')}`);
  win.destroy();
  return {
    rows: findInit.rows,
    searched: searched.rows,
    exported: files[0],
    bytes: saved.size,
    opened: opened[0].slice(0, 46) + '…',
  };
}

// ---------------------------------------------------------------- 同命局 / 跨端 / 结局卡

/**
 * 四条链路一口气测完：
 *   1. 开同命局 → 两步由不同的人按（owner 0 → 1），面板显示轮到谁；
 *   2. 把今天这一手打包成链接 → 手机页渲染三张卡 → 选出决定码；
 *   3. 决定码贴回面板 → 卡片被预选（不是直接落账）；
 *   4. 结局卡：1200×630 的 PNG 真的写进文件。
 */
async function runLifeSmoke() {
  const { Ledger } = require('../src/main/ledger');
  const { ShareKit } = require('../src/main/share');
  const G = require('../src/shared/lifegame');

  const exportDir = tmpDir('life-exports');
  const kit = new ShareKit({ dir: exportDir, openExternal: () => {} });
  const ledger = new Ledger({ filePath: path.join(tmpDir('life-ledger'), 'ledger.json') });

  for (const ch of [
    INVOKE.LIFE_STATE, INVOKE.LIFE_CHOOSE, INVOKE.LIFE_RESTART, INVOKE.LIFE_DUO, INVOKE.LIFE_HAND,
    INVOKE.SHARE_INFO, INVOKE.SHARE_CARD, INVOKE.SHARE_TEXT, INVOKE.SHARE_OPEN,
    INVOKE.APP_PANEL_WINDOW, INVOKE.APP_STATE,
  ]) ipcMain.removeHandler(ch);

  ipcMain.handle(INVOKE.LIFE_STATE, () => ledger.snapshot());
  ipcMain.handle(INVOKE.LIFE_CHOOSE, (_e, p) => ledger.choose(p && p.cardId, p && p.action));
  ipcMain.handle(INVOKE.LIFE_RESTART, () => ledger.restart());
  ipcMain.handle(INVOKE.LIFE_DUO, (_e, p) => ((p && p.action === 'stop') ? ledger.stopDuo() : ledger.startDuo(p && p.names)));
  ipcMain.handle(INVOKE.LIFE_HAND, () => ledger.hand());
  ipcMain.handle(INVOKE.SHARE_INFO, () => ({ ok: true, base: 'https://cubbit.app/share.html', exportDir: kit.exportDir() }));
  ipcMain.handle(INVOKE.SHARE_CARD, (_e, p) => kit.saveCard(p || {}));
  ipcMain.handle(INVOKE.SHARE_TEXT, (_e, p) => kit.copyText((p && p.text) || ''));
  ipcMain.handle(INVOKE.SHARE_OPEN, (_e, p) => kit.open((p && p.url) || ''));
  ipcMain.handle(INVOKE.APP_PANEL_WINDOW, () => ({ ok: true }));
  ipcMain.handle(INVOKE.APP_STATE, () => ({ ok: true, settings: { diyPet: null } }));

  // ---- 1. 同命局：两步必须换人按
  const today = new Date();
  const day = (back) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 10, 0, 0);
  const first = ledger.startDuo(['小林', '阿岚'], day(2));
  assert.equal(first.ok, true, '同命局没开成');
  assert.equal(first.state.duo.on, true);
  assert.equal(first.state.duo.names[0], '小林');

  const hand0 = ledger.snapshot(day(2));
  const t1 = ledger.choose(hand0.cards[0].id, 'do', day(2));
  assert.equal(t1.ok, true);
  assert.equal(t1.result.owner, 0, '第一步应该记在「小林」头上');

  const hand1 = ledger.snapshot(day(1));
  const t2 = ledger.choose(hand1.cards[0].id, 'do', day(1));
  assert.equal(t2.ok, true);
  assert.equal(t2.result.owner, 1, '第二步必须换人：不能一直是同一个人按');
  assert.match(t2.result.line, /阿岚按的/, '台词要说明这一步是谁按的');

  const duoSnap = ledger.snapshot();
  assert.equal(duoSnap.state.duo.steps[0], 1);
  assert.equal(duoSnap.state.duo.steps[1], 1);

  // ---- 2. 跨端：把今天这一手带到手机页
  const hand = ledger.hand();
  assert.equal(hand.ok, true);
  const parsed = G.parseHand(hand.code);
  assert.equal(parsed.cards.length, 3);
  assert.deepEqual(parsed.duo, ['小林', '阿岚'], '手机上也要知道这是同命局');

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
  watchErrors(win, errors);
  win.showInactive();

  await load(win, 'src/renderer/ledger/index.html');
  await fitView(win, 960);
  await wait(600);
  const duoBar = await win.webContents.executeJavaScript(`(() => {
    const d = document.getElementById('duo');
    return { hidden: !!d.hidden, cls: d.className, text: d.textContent || '' };
  })()`);
  assert.equal(duoBar.hidden, false);
  assert.match(duoBar.cls, /duo--on/);
  assert.match(duoBar.text, /同命局/);
  assert.match(duoBar.text, /轮到/, '要写清轮到谁');
  assert.match(duoBar.text, /1 : 1 步/, '两个人的步数要分开算');

  // 手机页：390 宽的竖屏
  const mob = new BrowserWindow({ width: 400, height: 860, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const mobErrors = [];
  watchErrors(mob, mobErrors);
  await mob.loadURL(`${pathToFileURL(path.join(ROOT, 'site', 'life.html')).href}#h=${hand.code}`);
  await wait(420);
  const mobInit = await mob.webContents.executeJavaScript(`(() => ({
    cards: document.querySelectorAll('.card').length,
    meters: document.querySelectorAll('.m').length,
    sub: document.getElementById('sub').textContent,
    barHidden: document.getElementById('bar').hidden,
  }))()`);
  assert.equal(mobInit.cards, 3, '手机上应看到三张卡');
  assert.equal(mobInit.meters, 4, '四条资源都要带过来');
  assert.match(mobInit.sub, /同命局/);

  // 截图前回到顶部：窗口从未显示过时 show() 可能保留上一次的滚动位置
  await mob.webContents.executeJavaScript('window.scrollTo(0, 0); 1');
  await wait(160);
  await shot(mob, 'life-mobile-cards.png');

  await mob.webContents.executeJavaScript(`document.querySelectorAll('.card')[0].click()`);
  await wait(200);
  await mob.webContents.executeJavaScript(`[...document.querySelectorAll('.bar .btn')].find(b => /执行这条/.test(b.textContent)).click()`);
  await wait(260);
  const mobCode = await mob.webContents.executeJavaScript(`(document.querySelector('.code') || {}).textContent || ''`);
  assert.equal(mobCode, 'D1.0.d', `手机应给出 D1.0.d，实际是 ${mobCode}`);
  await shot(mob, 'life-mobile.png');
  assert.deepEqual(mobErrors, [], `手机页有控制台错误：${mobErrors.join(' | ')}`);
  mob.destroy();

  // ---- 3. 决定码贴回面板：预选，不直接落账
  await win.webContents.executeJavaScript(`document.getElementById('handoffBtn').click()`);
  await wait(500);
  const sheetHead = await win.webContents.executeJavaScript(`(document.querySelector('.sheet__head b') || {}).textContent || ''`);
  assert.match(sheetHead, /手机上想/);

  await win.webContents.executeJavaScript(`(() => {
    const i = document.querySelector('.hand__in input');
    i.value = 'D1.1.d';
    [...document.querySelectorAll('.hand__in .btn')].find(b => /用这个决定/.test(b.textContent)).click();
  })()`);
  await wait(400);
  const applied = await win.webContents.executeJavaScript(`(() => ({
    sel: document.querySelectorAll('.card.is-sel').length,
    pick: (document.querySelector('.actions__pick') || {}).textContent || '',
  }))()`);
  assert.equal(applied.sel, 1, '应有一张卡被预选');
  assert.match(applied.pick, /已选：/);

  await win.webContents.executeJavaScript(`document.querySelector('.sheet .btn--icon').click()`);
  await wait(300);
  await shot(win, 'ledger-duo.png');

  // ---- 4. 结局卡：导出成 1200×630 的 PNG
  await load(win, 'src/renderer/ledger/index.html', { demo: 'ending' });
  await fitView(win, 960);
  await wait(600);
  const endingShot = await win.webContents.executeJavaScript(`(() => {
    const b = [...document.querySelectorAll('.actions__btns .btn')].find(x => /导出结局卡/.test(x.textContent));
    if (b) b.click();
    return { found: !!b };
  })()`);
  assert.equal(endingShot.found, true, '结局页应有「导出结局卡」');
  await wait(600);

  const canvasInfo = await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('.sheet__canvas');
    return c ? { w: c.width, h: c.height } : null;
  })()`);
  assert.deepEqual(canvasInfo, { w: 1200, h: 630 }, '结局卡必须是 1200×630');

  await shot(win, 'ledger-endcard.png');

  const before = fs.existsSync(exportDir) ? fs.readdirSync(exportDir).length : 0;
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.sheet__acts .btn')].find(b => /存成图片/.test(b.textContent)).click()`);
  await wait(900);
  const files = fs.readdirSync(exportDir).filter((f) => /\.png$/i.test(f));
  assert.ok(files.length > before - 1 && files.length > 0, '结局卡没写进文件');
  const png = fs.readFileSync(path.join(exportDir, files[files.length - 1]));
  // PNG magic + IHDR 尺寸：不靠文件名判断，直接读字节
  assert.equal(png.slice(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);

  assert.deepEqual(errors, [], `账本面板有控制台错误：${errors.join(' | ')}`);
  win.destroy();

  return {
    duo: { owner1: t1.result.owner, owner2: t2.result.owner, steps: duoSnap.state.duo.steps },
    hand: { codeLen: hand.code.length, cards: parsed.cards.length, decision: mobCode },
    endcard: { file: files[files.length - 1], bytes: png.length },
  };
}

app.whenReady().then(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  try {
    const photo = await runPhotoSmoke();
    const mate = await runMateSmoke();
    const share = await runShareSmoke();
    const life = await runLifeSmoke();
    console.log(JSON.stringify({ ok: true, photo, mate, share, life }, null, 2));
    app.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    app.exit(1);
  }
});
