const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
const page = process.argv[2] || 'index.html';
const out = process.argv[3] || 'shot-section.png';
const sel = process.argv[4] || '#mobile';
const W = Number(process.argv[5] || 1200);
const H = Number(process.argv[6] || 900);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, page));
  await new Promise((r) => setTimeout(r, 700));
  await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'start'}); true`);
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, out), img.toPNG());
  console.log('captured', out, img.getSize());
  app.quit();
});
