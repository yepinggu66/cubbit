'use strict';
// v2.9.5 回归：125% 缩放下最大化窗口 / 点桌面不再被当成「全屏游戏」而自动隐身
const test = require('node:test');
const assert = require('node:assert/strict');
const { isFullscreenRaw, isShellWindow, classifyPresence } = require('../src/main/presence');

const MON = [0, 0, 1920, 1080]; // 物理像素（125% 缩放下逻辑是 1536x864）
const WORK = [0, 0, 1920, 1032];
const WS_OVERLAPPEDWINDOW = 0x00cf0000; // 含 WS_CAPTION
const WS_POPUP_VISIBLE = 0x90000000; // 无标题栏
const base = (o) => ({ v: 2, title: 'x', className: 'X', process: 'app', pid: 1234, zoomed: false, style: WS_OVERLAPPEDWINDOW, monitor: MON, work: WORK, ...o });
const DAY = { idle: 0, hour: 14, selfPid: 999 };

test('maximized normal window (WeChat / Explorer / Word) is not fullscreen and not a game', () => {
  for (const proc of ['weixin2', 'explorer', 'winword', 'someapp']) {
    const raw = base({ process: proc, title: 'Doc', zoomed: true, rect: [-8, -8, 1928, 1040] });
    assert.equal(isFullscreenRaw(raw), false, proc);
    assert.notEqual(classifyPresence(raw, DAY).kind, 'game', proc);
  }
});

test('maximized window with auto-hidden taskbar (covers whole monitor) is still not fullscreen', () => {
  const raw = base({ zoomed: true, rect: [-8, -8, 1928, 1088] });
  assert.equal(isFullscreenRaw(raw), false);
  assert.notEqual(classifyPresence(raw, DAY).kind, 'game');
});

test('desktop, taskbar and other shell windows never count as fullscreen', () => {
  const cases = [
    { process: 'explorer', className: 'Progman', title: 'Program Manager' },
    { process: 'explorer', className: 'WorkerW', title: '' },
    { process: 'explorer', className: 'Shell_TrayWnd', title: '' },
    { process: 'explorer', className: 'CabinetWClass', title: '' },
    { process: 'StartMenuExperienceHost', className: 'Windows.UI.Core.CoreWindow', title: '开始' },
    { process: 'SearchHost', className: 'Windows.UI.Core.CoreWindow', title: 'Search' },
  ];
  for (const c of cases) {
    const raw = base({ ...c, style: WS_POPUP_VISIBLE, rect: MON });
    assert.equal(isShellWindow(raw), true, c.className);
    assert.equal(isFullscreenRaw(raw), false, c.className);
    assert.notEqual(classifyPresence(raw, DAY).kind, 'game', c.className);
  }
});

test('old unit bug: physical window vs logical screen no longer matches', () => {
  // 1536x864 逻辑尺寸的窗口在 1920x1080 物理显示器上并没有盖满
  const raw = base({ style: WS_POPUP_VISIBLE, rect: [0, 0, 1536, 864] });
  assert.equal(isFullscreenRaw(raw), false);
});

test('real borderless / exclusive fullscreen game is still detected and hides the pet', () => {
  const raw = base({ process: 'genshinimpact', title: 'Genshin Impact', style: WS_POPUP_VISIBLE, rect: [0, 0, 1920, 1080] });
  assert.equal(isFullscreenRaw(raw), true);
  const p = classifyPresence(raw, DAY);
  assert.equal(p.kind, 'game');
  assert.equal(p.fullscreen, true);
});

test('fullscreen game on a second monitor is measured against that monitor', () => {
  const raw = base({ process: 'game', style: WS_POPUP_VISIBLE, monitor: [1920, 0, 4480, 1440], rect: [1920, 0, 4480, 1440] });
  assert.equal(isFullscreenRaw(raw), true);
  const half = base({ process: 'game', style: WS_POPUP_VISIBLE, monitor: [1920, 0, 4480, 1440], rect: [0, 0, 1920, 1080] });
  assert.equal(isFullscreenRaw(half), false);
});

test('browser F11 fullscreen is classified as video, not game', () => {
  const raw = base({ process: 'chrome', title: 'Some page', style: WS_POPUP_VISIBLE, rect: MON });
  assert.equal(classifyPresence(raw, DAY).kind, 'video');
});

test('window with a title bar stretched over the screen is not fullscreen; own pet window ignored', () => {
  assert.equal(isFullscreenRaw(base({ rect: [-1, -1, 1921, 1081] })), false);
  assert.equal(isFullscreenRaw(base({ pid: 999, style: WS_POPUP_VISIBLE, rect: MON }), { selfPid: 999 }), false);
});

test('legacy probe output without monitor data never triggers fullscreen', () => {
  assert.equal(isFullscreenRaw({ title: 'x', process: 'game', fullscreen: true, width: 1920, height: 1080 }), false);
  assert.equal(isFullscreenRaw(null), false);
});
