'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shared/share.js');

test('clip 按人眼长度截断，中文算 1、英文算 0.5', () => {
  const long = '一'.repeat(50) + 'abcdefghij';
  const out = S.clip(long, 20);
  assert.ok(out.endsWith('…'));
  assert.ok([...out].length <= 21);
  assert.equal(S.clip('短句', 20), '短句');
});

test('firstSentence 只取第一句，没有句号就整段', () => {
  assert.equal(S.firstSentence('系安全带，前排后排都系。坐轻型卡车降六成。'), '系安全带，前排后排都系');
  assert.equal(S.firstSentence('没有句号的一段话'), '没有句号的一段话');
  assert.equal(S.firstSentence(''), '');
});

test('卡片分享文案包含标题与证据等级，且不超预算', () => {
  const text = S.textOf({
    kind: 'card',
    title: '测试前先做一道比较题',
    plain: '提前还房贷之前，先算一下房贷利率和你能稳定拿到的税后收益。',
    ev: 'A',
  });
  assert.ok(text.includes('测试前先做一道比较题'));
  assert.ok(text.includes('证据 A 级'));
  assert.ok([...text].length < 200);
});

test('清单分享最多 5 条，编号连续', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ title: `第 ${i} 条建议。补充说明。`, ev: 'A' }));
  const text = S.textOf({ kind: 'list', items, head: '健康清单' });
  assert.ok(text.includes('1. 第 0 条建议'));
  assert.ok(text.includes('5. 第 4 条建议'));
  assert.ok(!text.includes('6. '));
});

test('payload 编解码往返无损（含中文与数组）', () => {
  const src = {
    kind: 'list',
    title: '健康清单',
    ev: 'B',
    secName: '看病',
    items: [{ title: '每年查一次血压', ev: 'A' }, { title: '别自己加药量', ev: 'B' }],
    pet: '小奶猫',
  };
  const code = S.encodePayload(src);
  assert.ok(!/[+/=]/.test(code), '必须是 base64url');
  const back = S.decodePayload(code);
  assert.equal(back.kind, 'list');
  assert.equal(back.title, '健康清单');
  assert.equal(back.items.length, 2);
  assert.equal(back.items[1].title, '别自己加药量');
});

test('decodePayload 对垃圾输入返回 null 而不是抛错', () => {
  assert.equal(S.decodePayload('%%%%'), null);
  assert.equal(S.decodePayload(''), null);
  assert.equal(S.decodePayload(Buffer.from('{"v":99}').toString('base64url')), null);
});

test('四个平台的 intent URL 都带上了文案与链接', () => {
  const pack = S.pack({ kind: 'card', title: '标题', plain: '内容。', ev: 'A' }, { base: 'https://cubbit.app/share.html' });
  assert.equal(pack.platforms.length, 4);
  for (const p of pack.platforms) {
    assert.ok(p.url.startsWith('https://'), p.id);
    assert.ok(p.url.length > 40, p.id);
    assert.ok(p.url.includes(encodeURIComponent('https://cubbit.app/share.html#d=').slice(0, 10)), p.id);
  }
  assert.ok(pack.platforms.find((p) => p.id === 'x').url.includes('x.com/intent/post'));
  assert.ok(pack.platforms.find((p) => p.id === 'facebook').url.includes('facebook.com/sharer'));
});

test('shareUrl 去掉旧 hash 再拼，避免 #d= 套两层', () => {
  const url = S.shareUrl('https://cubbit.app/share.html#d=old', 'new');
  assert.equal(url, 'https://cubbit.app/share.html#d=new');
});

test('外链白名单只放行我们拼的那几个域名', () => {
  assert.equal(S.isAllowedShareUrl('https://x.com/intent/post?text=a'), true);
  assert.equal(S.isAllowedShareUrl('https://www.facebook.com/sharer/sharer.php?u=b'), true);
  assert.equal(S.isAllowedShareUrl('https://evil.example.com/x'), false);
  assert.equal(S.isAllowedShareUrl('http://x.com/a'), false);
  assert.equal(S.isAllowedShareUrl('javascript:alert(1)'), false);
  assert.equal(S.isAllowedShareUrl('not a url'), false);
});

test('intentUrl 拒绝非 http 的分享链接', () => {
  assert.equal(S.intentUrl('x', { text: 't', url: 'file:///C:/x' }), null);
  assert.equal(S.intentUrl('nope', { text: 't', url: 'https://a.b' }), null);
});
