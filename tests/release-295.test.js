// v2.9.5：人生卡片（健康 / 过日子建议）全部有 6 种界面语言的译文，且能在界面里翻出来
const test = require('node:test');
const assert = require('node:assert/strict');
const DICT = require('../src/shared/i18n-dict.js');
const I18N = require('../src/shared/i18n.js');
const LANGS = ['en', 'de', 'ja', 'ko', 'fr', 'it'];

function loadCards() {
  const cards = require('../src/shared/life-cards.js');
  assert.ok(Array.isArray(cards) && cards.length > 700, 'life cards loaded');
  return cards;
}

test('package version is 2.9.5', () => {
  assert.equal(require('../package.json').version, '2.9.5');
});

test('every life card title / plain / section has all 6 translations', () => {
  const missing = [];
  for (const c of loadCards()) {
    for (const s of [c.title, c.plain, c.secName]) {
      const e = DICT[s];
      for (const l of LANGS) if (!e || !e[l] || !String(e[l]).trim()) missing.push(`${c.id}:${l}:${String(s).slice(0, 12)}`);
    }
  }
  assert.deepEqual(missing.slice(0, 20), [], `${missing.length} missing`);
});

test('English card text is a real translation (no Chinese left)', () => {
  const bad = [];
  for (const c of loadCards()) for (const s of [c.title, c.plain, c.secName]) {
    const v = DICT[s] && DICT[s].en;
    // s12-15 deliberately quotes the legal terms 定金 / 订金
    if (!v || (c.id !== 's12-15' && /[\u3400-\u9fff]/.test(v))) bad.push(c.id);
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} bad`);
});

test('I18N.tr translates a card in the UI and keeps Chinese for zh', () => {
  const c = loadCards()[0];
  for (const l of LANGS) assert.notEqual(I18N.tr(l, c.title), c.title, l);
  assert.equal(I18N.tr('zh-CN', c.title), c.title);
  assert.equal(I18N.tr('en', '不要早死'), "Don't die early");
  assert.equal(I18N.tr('ja', '不要早死'), '早死にしない');
});
