const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
const FPS = 30;
const W = Number(process.argv[2] || 720);
const H = Number(process.argv[3] || 1280);
const OUT = process.argv[4] || 'frames-v';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  // 用 CDP 把视口设成目标尺寸，不受物理屏幕大小限制
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await win.loadFile(path.join(__dirname, 'promo.html'));
  await new Promise((r) => setTimeout(r, 800));

  const dur = await win.webContents.executeJavaScript('window.DURATION');
  const total = Math.ceil(dur * FPS);
  const dir = path.join(__dirname, OUT);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < total; i += 1) {
    const t = i / FPS;
    await win.webContents.executeJavaScript(`window.renderAt(${t})`);
    const shot = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
      fromSurface: true,
    });
    fs.writeFileSync(path.join(dir, String(i).padStart(4, '0') + '.png'), Buffer.from(shot.data, 'base64'));
    if (i % 180 === 0) console.log('frame', i, '/', total);
  }
  console.log('done', OUT, total, Math.round((Date.now() - t0) / 1000) + 's');
  dbg.detach();
  app.quit();
});
