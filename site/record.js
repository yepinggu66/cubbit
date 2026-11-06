const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
const FPS = 30;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'promo.html'));
  await new Promise((r) => setTimeout(r, 600));
  const dur = await win.webContents.executeJavaScript('window.DURATION');
  const total = Math.ceil(dur * FPS);
  const dir = path.join(__dirname, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < total; i += 1) {
    const t = i / FPS;
    await win.webContents.executeJavaScript(`window.renderAt(${t})`);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, String(i).padStart(4, '0') + '.png'), img.toPNG());
    if (i % 90 === 0) console.log('frame', i, '/', total, Math.round((Date.now() - t0) / 1000) + 's');
  }
  console.log('done frames=', total, 'elapsed=', Math.round((Date.now() - t0) / 1000) + 's');
  app.quit();
});
