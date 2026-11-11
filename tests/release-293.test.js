'use strict';
// v2.9.3 回归：农场点数不再有本地免费发放、更新源可用、神秘探险面板已注册、套餐名多语言
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { Farm } = require('../src/main/farm');
const { UpdateChecker, isNewer } = require('../src/main/updater');
const I18N = require('../src/shared/i18n');
const RC = require('../src/shared/runtime-config');

test('farm points are never granted locally, even with developer authorization', () => {
  const farm = new Farm({ hooks: { isDeveloper: () => true, isMember: () => false } });
  const before = farm.state.points;
  const r = farm.call ? farm.call('buyPoints', {}) : farm.buyPoints();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(farm.state.points, before);
});

test('update feed defaults to the website download folder', () => {
  assert.strictEqual(RC.DEFAULT_UPDATE_FEED_URL, 'https://pingguye.cn/cubbit/dl');
  const u = new UpdateChecker({ get: () => undefined }, { apiBase: 'https://x/api', latestUrl: () => 'https://pingguye.cn/cubbit/dl/app-latest.json', currentVersion: '2.9.2' });
  assert.strictEqual(u.status().feed, 'https://pingguye.cn/cubbit/dl/app-latest.json');
  assert.ok(isNewer('2.9.3', '2.9.2'));
});

test('update check reads app-latest.json and reports a newer version', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: '2.9.3', url: 'https://pingguye.cn/cubbit/dl/windows/latest' }) });
  const u = new UpdateChecker({ get: () => true }, { latestUrl: 'https://pingguye.cn/cubbit/dl/app-latest.json', currentVersion: '2.9.2', fetchImpl });
  const st = await u.check({ manual: true });
  assert.strictEqual(st.available, true);
  assert.strictEqual(st.latest.version, '2.9.3');
});

test('mysterious adventure opens a registered farm panel', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'windows.js'), 'utf8');
  assert.match(src, /\n\s*farm:\s*\{\s*dir:\s*'farm'/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', 'farm', 'index.html')));
});

test('plan names are localized in every supported language', () => {
  for (const lang of ['en', 'de', 'ja', 'ko', 'fr', 'it']) {
    for (const zh of ['完整版', '情侣年卡', 'AI 陪伴会员 · 年付', 'AI 陪伴会员 · 月付', '完整版 · 买断', '已激活']) {
      const out = I18N.tr(lang, zh);
      assert.ok(!/[\u4e00-\u9fff]/.test(out) || lang === 'ja', `${lang}: ${zh} -> ${out}`);
      assert.notStrictEqual(out, zh, `${lang}: ${zh} untranslated`);
    }
  }
});

test('photo, mate and ledger panels load the i18n runtime', () => {
  for (const d of ['photo', 'mate', 'ledger', 'wardrobe', 'farm']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', d, 'index.html'), 'utf8');
    assert.ok(html.includes('shared/i18n.js') && html.includes('shared/i18n-dict.js'), d);
  }
});
