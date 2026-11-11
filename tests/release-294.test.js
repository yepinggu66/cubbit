// v2.9.4：中国大陆微信 / 支付宝收款码
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const PW = path.join(ROOT, 'src/renderer/paywall');

test('paywall ships both QR images and a QR section', () => {
  for (const f of ['qr-wechat.png', 'qr-alipay.png']) {
    const b = fs.readFileSync(path.join(PW, f));
    assert.equal(b.slice(1, 4).toString(), 'PNG', f);
  }
  const html = fs.readFileSync(path.join(PW, 'index.html'), 'utf8');
  for (const id of ['qrSection', 'qrWechat', 'qrAlipay', 'qrAmount', 'qrTip']) assert.ok(html.includes(`id="${id}"`), id);
});

test('QR payment copy exists in all 7 paywall languages', () => {
  const ctx = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(PW, 'paywall-i18n.js'), 'utf8'), ctx);
  const S = ctx.self.CubbitPaywallI18N.STRINGS;
  for (const lang of ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'it']) {
    const T = S[lang];
    for (const k of ['subCN', 'copyNoteCN', 'qrAmount', 'qrWechat', 'qrAlipay', 'qrTip', 'chargeCN']) assert.ok(T[k], `${lang}.${k}`);
    assert.ok(T.qrWechat.includes('{price}') && T.qrAlipay.includes('{price}'), lang);
    assert.equal(T.stepsCN.length, 5, lang);
    assert.ok(!/paypal/i.test(T.subCN + T.stepsCN.join('')), `${lang} CN copy must not mention PayPal`);
  }
});

test('legal refund text mentions WeChat / Alipay refunds', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'src/renderer/ui/ui.js'), 'utf8');
  assert.ok(ui.includes('退款原路退回到你的微信 / 支付宝'));
});
