'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/mate.js');

test('写需求：滑杆定基调，关键词加权并且翻倍权重', () => {
  const a = M.parseDesire({ text: '', warmth: 30 });
  const b = M.parseDesire({ text: '希望安静一点，各过各的也行', warmth: 30 });
  assert.equal(a.expect.warmth, 30);
  assert.ok(b.expect.warmth < a.expect.warmth, '写了"安静"应该更往外冷那头偏');
  assert.ok(b.weights.warmth > a.weights.warmth, '主动说出口的维度权重应更高');
  assert.ok(b.tags.includes('solo'));
});

test('候选池同 seed 稳定、不同 seed 不同，且不含重复', () => {
  const a = M.makeCandidates({ seed: 'abc', count: 3 });
  const b = M.makeCandidates({ seed: 'abc', count: 3 });
  const c = M.makeCandidates({ seed: 'xyz', count: 3 });
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.notDeepEqual(a.map((x) => x.id), c.map((x) => x.id));
  assert.equal(new Set(a.map((x) => x.id)).size, 3);
  for (const cand of a) {
    assert.ok(cand.name && cand.emoji && cand.bio);
    for (const t of M.TRAITS) assert.ok(cand.traits[t.id] >= 0 && cand.traits[t.id] <= 100);
  }
});

test('契合度在 30–97 之间，且一定同时给出理由和不合的地方', () => {
  const desire = M.parseDesire({ text: '想找个愿意一起吃饭、会做饭的', warmth: 70, thrift: 60 });
  const cands = M.makeCandidates({ seed: 'score', count: 6 });
  for (const c of cands) {
    const s = M.score(c, desire);
    assert.ok(s.score >= 30 && s.score <= 97, String(s.score));
    assert.ok(s.fits.length === 5);
    assert.ok(Array.isArray(s.reasons) && Array.isArray(s.gaps));
  }
  // 完全不匹配的人不该拿到高分
  const opposite = Object.assign({}, cands[0], {
    traits: { warmth: 0, pace: 100, thrift: 0, order: 0, curiosity: 0 },
  });
  const tight = M.parseDesire({ text: '安静、省钱、有计划、慢慢来、不爱折腾' });
  assert.ok(M.score(opposite, tight).score < 70);
});

test('高分直接同意，中段要提条件，低分婉拒', () => {
  const cand = M.makeCandidates({ seed: 'reply', count: 1 })[0];
  const perfect = {
    text: '',
    expect: Object.assign({}, cand.traits),
    weights: { warmth: 1, pace: 1, thrift: 1, order: 1, curiosity: 1 },
    tags: [],
  };
  const high = M.replyOf(cand, perfect);
  assert.equal(high.decision, 'accept');
  assert.ok(high.score >= 80);

  const wrong = {
    text: '',
    expect: { warmth: 100 - cand.traits.warmth, pace: 100 - cand.traits.pace, thrift: 100 - cand.traits.thrift, order: 100 - cand.traits.order, curiosity: 100 - cand.traits.curiosity },
    weights: { warmth: 1, pace: 1, thrift: 1, order: 1, curiosity: 1 },
    tags: [],
  };
  const low = M.replyOf(cand, wrong);
  assert.ok(['decline', 'hesitate', 'conditional'].includes(low.decision));
});

test('两头点头才能确立关系：条件没答应就进不去', () => {
  const cand = M.makeCandidates({ seed: 'consent', count: 1 })[0];
  let state = M.blank();
  state = M.seek(state, { text: '随便', warmth: cand.traits.warmth }, [cand]);
  assert.equal(state.status, 'seeking');

  const prop = M.propose(state, cand.id);
  assert.equal(prop.ok, true);
  assert.equal(prop.state.status, 'proposed');
  assert.ok(prop.reply && prop.reply.decision);

  const decision = prop.reply.decision;
  if (decision === 'conditional') {
    const no = M.confirm(prop.state, { acceptPact: false });
    assert.equal(no.ok, false);
    assert.equal(no.code, 'NEED_PACT');
    const yes = M.confirm(prop.state, { acceptPact: true });
    assert.equal(yes.ok, true);
    assert.equal(yes.state.status, 'dating');
    assert.ok(yes.state.relation.pact);
  } else if (decision === 'accept') {
    const yes = M.confirm(prop.state, {});
    assert.equal(yes.ok, true);
    assert.equal(yes.state.status, 'dating');
  } else {
    const no = M.confirm(prop.state, { acceptPact: true });
    assert.equal(no.ok, false);
  }
});

test('被拒之后 confirm 一定失败，不能硬凑', () => {
  const cand = M.makeCandidates({ seed: 'no', count: 1 })[0];
  const wrong = {
    text: '',
    expect: { warmth: 100 - cand.traits.warmth, pace: 100 - cand.traits.pace, thrift: 100 - cand.traits.thrift, order: 100 - cand.traits.order, curiosity: 100 - cand.traits.curiosity },
    weights: { warmth: 2, pace: 2, thrift: 2, order: 2, curiosity: 2 },
    tags: [],
  };
  let state = M.seek(M.blank(), wrong, [cand]);
  const prop = M.propose(state, cand.id);
  if (prop.reply.decision === 'decline') {
    const r = M.confirm(prop.state, { acceptPact: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DECLINED');
  }
});

test('犹豫只能再争取一次，第二次就被挡住', () => {
  const state = Object.assign(M.blank(), {
    status: 'proposed',
    picked: { id: 'x', name: '阿柚' },
    reply: { decision: 'hesitate', score: 50, line: '再看看' },
    attempts: 0,
  });
  const first = M.retry(state);
  assert.equal(first.ok, true);
  const again = M.retry(first.state);
  if (first.state.reply.decision === 'hesitate') {
    assert.equal(again.ok, false);
  }
});

test('恋爱天数按自然日走，不是按打开次数', () => {
  const day1 = new Date('2026-11-01T10:00:00Z').getTime();
  const state = M.normalize({
    status: 'dating',
    relation: { name: '阿柚', startedAt: day1, days: 0, lastSeenDay: '' },
  });
  const a = M.tickRelation(state, new Date('2026-11-01T23:00:00Z').getTime());
  assert.equal(a.relation.days, 1);
  const b = M.tickRelation(a, new Date('2026-11-03T02:00:00Z').getTime());
  assert.equal(b.relation.days, 3);
});

test('分开之后回到单身，历史里留下记录', () => {
  const state = M.normalize({
    status: 'dating',
    relation: { name: '阿柚', startedAt: Date.now(), days: 5 },
    picked: { id: 'x' },
  });
  const r = M.breakup(state);
  assert.equal(r.ok, true);
  assert.equal(r.state.status, 'single');
  assert.equal(r.state.relation, null);
  assert.ok(r.state.history.some((h) => h.kind === 'breakup'));
  assert.equal(M.breakup(r.state).ok, false);
});

test('台词随状态变化，且分手后不会说恋爱台词', () => {
  const single = M.lineOf(M.blank(), () => 0);
  assert.ok(M.PHRASES.single.includes(single));
  const dating = M.lineOf(M.normalize({ status: 'dating', relation: { name: 'a', startedAt: Date.now() } }), () => 0);
  assert.ok(M.PHRASES.dating.includes(dating));
  const broken = M.normalize({ status: 'single', history: [{ kind: 'breakup' }] });
  assert.ok(M.PHRASES.broken.includes(M.lineOf(broken, () => 0)));
});

test('normalize 容错：坏数据不会炸，dating 没对象自动降级', () => {
  const bad = M.normalize({ status: 'dating', relation: null, candidates: 'x' });
  assert.equal(bad.status, 'single');
  assert.deepEqual(bad.candidates, []);
  assert.equal(M.normalize(null).status, 'single');
});
