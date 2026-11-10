// 面板 preload 白名单：面板页通过 panel.invoke() 调用的通道必须都在 ALLOWED 里，
// 否则按钮会静默失败（例如 2.9.1-soft「拍一只」的 ✕ / Esc 关不掉）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INVOKE } = require('../src/shared/ipc.js');

const ROOT = path.join(__dirname, '..', 'src');
const preload = fs.readFileSync(path.join(ROOT, 'preload', 'panel.js'), 'utf8');
const allowed = new Set([...preload.split('const ALLOWED')[1].split(']);')[0].matchAll(/INVOKE\.([A-Z_]+)/g)].map((m) => INVOKE[m[1]]));
const known = new Set(Object.values(INVOKE));

test('panel allowlist includes the panel close/minimize channel', () => {
  assert.ok(allowed.has(INVOKE.APP_PANEL_WINDOW));
});

for (const page of ['photo/photo.js', 'wardrobe/wardrobe.js', 'mate/mate.js', 'ledger/ledger.js']) {
  test(`every IPC channel used by ${page} is allowed in the panel preload`, () => {
    const src = fs.readFileSync(path.join(ROOT, 'renderer', page), 'utf8');
    const channels = [...src.matchAll(/'([a-z]+(?::[a-z-]+)+)'/g)].map((m) => m[1]).filter((c) => known.has(c));
    assert.ok(channels.length > 0);
    for (const ch of channels) assert.ok(allowed.has(ch), `${page} uses ${ch} but it is not in ALLOWED`);
  });
  test(`${page} close falls back to window.close()`, () => {
    const src = fs.readFileSync(path.join(ROOT, 'renderer', page), 'utf8');
    assert.match(src, /function closePanel\(\)/);
    assert.match(src, /window\.close\(\)/);
  });
}
