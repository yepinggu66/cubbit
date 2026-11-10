const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();

const page = process.argv[2] || 'expr-grid.html';
const out = process.argv[3] || 'expr-grid.png';
const w = Number(process.argv[4] || 1000);
const h = Number(process.argv[5] || 900);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, deviceScaleFactor: 2 },
  });
  await win.loadFile(path.join(__dirname, page));
  const zoom = Number(process.argv[6] || 0); if (zoom > 0) win.webContents.setZoomFactor(zoom);
  await new Promise((r) => setTimeout(r, 900));
  const probe = await win.webContents.executeJavaScript(
    "(() => { const p = document.querySelector('.pet'); if (!p) return 'no .pet'; const r = p.getBoundingClientRect(); const b = p.querySelector('.body'); return 'pets=' + document.querySelectorAll('.pet').length + ' rect=' + Math.round(r.width) + 'x' + Math.round(r.height) + ' bodyBg=' + (b ? getComputedStyle(b).backgroundImage.slice(0, 40) : 'none') + ' opacity=' + getComputedStyle(p).opacity; })()",
  );
  console.log('[probe]', probe);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, out), img.toPNG());
  console.log('captured', out, img.getSize());
  app.quit();
});
