const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
const FPS = 30;
const W = Number(process.argv[2] || 1280);
const H = Number(process.argv[3] || 720);
const OUT = process.argv[4] || 'frames';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'promo.html'));
  await new Promise((r) => setTimeout(r, 600));
  const dur = await win.webContents.executeJavaScript('window.DURATION');
  const total = Math.ceil(dur * FPS);
  const dir = path.join(__dirname, OUT);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < total; i += 1) {
    const t = i / FPS;
    await win.webContents.executeJavaScript(`window.renderAt(${t})`);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, String(i).padStart(4, '0') + '.png'), img.toPNG());
    if (i % 180 === 0) console.log('frame', i, '/', total);
  }
  console.log('done', OUT, total, Math.round((Date.now() - t0) / 1000) + 's');
  app.quit();
});
