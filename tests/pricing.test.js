// v2.9.2 地区价 + PayPal.me 固定金额链接（2026-11-12 用户确认的价格）
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/shared/pricing.js');
const O = require('../src/shared/offer-config.js');
const catalog = require('../src/shared/catalog.js');

const ME = 'https://paypal.me/pinggu80/';
const EXPECT = {
  'zh-CN': { text: ['¥68', '¥25', '¥198', '¥268'], pay: ['9.99USD', '3.99USD', '29.99USD', '39.99USD'] },
  'ja-JP': { text: ['¥1,480', '¥480', '¥2,980', '¥3,980'], pay: ['1480JPY', '480JPY', '2980JPY', '3980JPY'] },
  'ko-KR': { text: ['₩12,800', '₩4,900', '₩29,800', '₩39,800'], pay: ['9.99USD', '3.99USD', '29.99USD', '39.99USD'] },
  'en-US': { text: ['$9.99', '$3.99', '$29.99', '$39.99'], pay: ['9.99USD', '3.99USD', '29.99USD', '39.99USD'] },
  'pt-BR': { text: ['$9.99', '$3.99', '$29.99', '$39.99'], pay: ['9.99USD', '3.99USD', '29.99USD', '39.99USD'] },
  'de-DE': { text: ['€9.99', '€3.99', '€29.99', '€39.99'], pay: ['9.99EUR', '3.99EUR', '29.99EUR', '39.99EUR'] },
  'en-GB': { text: ['£7.99', '£3.99', '£24.99', '£34.99'], pay: ['7.99GBP', '3.99GBP', '24.99GBP', '34.99GBP'] },
};
const SKUS = ['base', 'month', 'year', 'couple'];

test('offer config validates', () => {
  assert.deepEqual(O.validate(), []);
});

for (const [locale, exp] of Object.entries(EXPECT)) {
  test(`regional prices and PayPal links for ${locale}`, () => {
    SKUS.forEach((sku, i) => {
      const p = P.skuPrice(sku, locale);
      assert.equal(p.text, exp.text[i]);
      assert.equal(p.payUrl, ME + exp.pay[i]);
      assert.equal(P.payUrl(sku, locale), ME + exp.pay[i]);
    });
  });
}

test('manual region ids work', () => {
  assert.equal(P.skuPrice('base', 'EU').payUrl, ME + '9.99EUR');
  assert.equal(P.skuPrice('base', 'GB').text, '£7.99');
  assert.equal(P.skuPrice('couple', 'KR').payUrl, ME + '39.99USD');
});

test('catalog plan prices map to regional display prices', () => {
  const byId = Object.fromEntries(catalog.PLANS.map((p) => [p.id, p]));
  assert.equal(P.displayCny(byId.base.price, 'en-US').text, '$9.99');
  assert.equal(P.displayCny(byId.ai_month.price, 'ja-JP').text, '¥480');
  assert.equal(P.displayCny(byId.ai_year.price, 'en-GB').text, '£24.99');
  assert.equal(P.displayCny(byId.couple_year.price, 'ko-KR').text, '₩39,800');
  assert.equal(catalog.localizedPrice(byId.couple_year, 'de-DE'), '€39.99');
});

test('no old $19.99 / $59.99 / $79.99 prices remain in sellable plans', () => {
  for (const p of catalog.PLANS) assert.ok(![1999, 5999, 7999].includes(p.priceUsd), p.id);
  for (const d of catalog.DLC) assert.equal(d.available, false, d.id);
});
