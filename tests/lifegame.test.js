const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/shared/lifegame');

const DAY = (n) => new Date(2026, 10, 8 + n); // 2026-11-08 起第 n 天

test('卡库是原作 767 条，证据等级分布与原作一致', () => {
  const cards = G.allCards();
  assert.equal(cards.length, 767);
  const ev = { A: 0, B: 0, C: 0 };
  for (const c of cards) ev[c.ev]++;
  assert.deepEqual(ev, { A: 495, B: 220, C: 52 });
  // 每条都要有可读的标题和章节，卡面不能出现空卡
  for (const c of cards) {
    assert.ok(c.title && c.title.length > 2, `${c.id} 缺标题`);
    assert.ok(c.secName, `${c.id} 缺章节`);
  }
});

test('同一天抽到的三张卡是确定的，隔天才换', () => {
  const s = G.create(DAY(0));
  const a = G.cardsFor(s, DAY(0)).map((c) => c.id);
  const b = G.cardsFor(s, DAY(0)).map((c) => c.id);
  assert.deepEqual(a, b, '同一天重复打开不能重抽');
  assert.equal(a.length, 3);

  const c = G.cardsFor(s, DAY(1)).map((x) => x.id);
  assert.notDeepEqual(a, c, '换一天应换一批');
});

test('三张卡尽量来自不同章节，避免一天看到三条同类建议', () => {
  let s = G.create(DAY(0));
  for (let i = 0; i < 12; i++) {
    const cards = G.cardsFor(s, DAY(i));
    const secs = new Set(cards.map((c) => c.sec));
    assert.equal(secs.size, 3, `第 ${i + 1} 天的三张卡撞了章节：${cards.map((c) => c.secName)}`);
    s.lastPlayDay = null;
    const r = G.choose(s, cards[0].id, 'do', DAY(i));
    assert.equal(r.result.ok, true);
    s = r.state;
  }
});

test('卡片效果与「又过一年」是两笔账，不能混在一起', () => {
  const s = G.create(DAY(0));
  const cards = G.cardsFor(s, DAY(0));
  const r = G.choose(s, cards[0].id, 'do', DAY(0));
  assert.equal(r.result.ok, true);

  // 时间流逝恒定发生：至少扣掉衰老，且一定有工资-开销这一笔
  assert.ok(r.result.passing.lifeYears < 0, '每年都要扣衰老');
  assert.equal(typeof r.result.passing.cash, 'number');
  assert.ok(r.result.passing.energy > 0, '每年应恢复一点精力');

  // 卡片效果里不允许出现「衰老」那一笔（-1.2 是时间造成的，不是这张卡）
  const d = r.result.deltas;
  assert.notEqual(d.lifeYears, r.result.passing.lifeYears, '两张账不能相等');
  assert.ok(Math.abs(d.lifeYears) <= 3, `单张卡的寿命增益不应异常：${d.lifeYears}`);
});

test('一天只能走一步：同一天再选一次会被拒绝', () => {
  const s = G.create(DAY(0));
  const cards = G.cardsFor(s, DAY(0));
  const first = G.choose(s, cards[0].id, 'do', DAY(0));
  assert.equal(first.result.ok, true);

  const second = G.choose(first.state, cards[1].id, 'do', DAY(0));
  assert.equal(second.result.ok, false);
  assert.equal(second.result.code, 'ALREADY_TODAY');
  assert.equal(second.state.turn, 1, '被拒绝时回合数不能增加');
});

test('放弃会回一点精力，且不该给出任何收益', () => {
  const s = G.create(DAY(0));
  const cards = G.cardsFor(s, DAY(0));
  const r = G.choose(s, cards[0].id, 'skip', DAY(0));
  const d = r.result.deltas;
  assert.ok(!d.cash, '放弃不该有现金收益');
  assert.ok(!d.lifeYears, '放弃不该延寿');
  assert.ok(!d.free, '放弃不该增加自由');
});

test('抽过的卡不会在同一条命里重复出现', () => {
  let s = G.create(DAY(0));
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    s.lastPlayDay = null;
    const cards = G.cardsFor(s, DAY(i));
    for (const c of cards) assert.ok(!seen.has(c.id), `${c.id} 被重复抽到`);
    seen.add(cards[0].id);
    const r = G.choose(s, cards[0].id, 'do', DAY(i));
    s = r.state;
  }
  assert.ok(s.used.length >= 20);
});

test('两条资源见底会真的扣寿（透支惩罚）', () => {
  const s = G.create(DAY(0));
  s.energy = 5;
  s.cash = -10000;
  const cards = G.cardsFor(s, DAY(0));
  const r = G.choose(s, cards[0].id, 'skip', DAY(0));
  // 衰老 1.2 + 精力见底 1.1 + 负债 0.9 = 至少 3.2
  assert.ok(r.result.passing.lifeYears <= -3, `透支惩罚未生效：${r.result.passing.lifeYears}`);
});

test('结局判定：命够、钱够、还算自由才算「活到 80 且不穷」', () => {
  const good = G.normalize({ turn: 40, age: 62, lifeYears: 20, cash: 80000, free: 70 });
  assert.equal(G.endingOf(good).type, 'good');

  const broke = G.normalize({ turn: 40, age: 62, lifeYears: 20, cash: 1000, free: 70 });
  assert.equal(G.endingOf(broke).type, 'slow');

  const trapped = G.normalize({ turn: 40, age: 62, lifeYears: 20, cash: 80000, free: 10 });
  assert.equal(G.endingOf(trapped).type, 'trapped');

  const dead = G.normalize({ turn: 20, age: 42, lifeYears: 0, cash: 90000, free: 90 });
  assert.equal(G.endingOf(dead).type, 'early');

  const poor = G.normalize({ turn: 30, age: 52, lifeYears: 30, cash: -50000, free: 80 });
  assert.equal(G.endingOf(poor).type, 'poor');
});

test('四十步一定收束成一个结局，不会卡在第 40 步', () => {
  let s = G.create(DAY(0));
  for (let i = 0; i < 40; i++) {
    s.lastPlayDay = null;
    const cards = G.cardsFor(s, DAY(i));
    const r = G.choose(s, cards[0].id, i % 5 === 4 ? 'skip' : 'do', DAY(i));
    assert.equal(r.result.ok, true, `第 ${i + 1} 步失败：${r.result.code}`);
    s = r.state;
    if (s.ended) break;
  }
  assert.ok(s.ended, '40 步后必须有结局');
  assert.ok(s.ended.title && s.ended.summary);
});

test('台词会随状态变化，且永远不是空串', () => {
  const s = G.create(DAY(0));
  const cards = G.cardsFor(s, DAY(0));
  const normal = G.choose(s, cards[0].id, 'do', DAY(0)).result.line;
  assert.ok(normal.length > 6);

  const tired = G.create(DAY(0));
  tired.energy = 12;
  const c2 = G.cardsFor(tired, DAY(0));
  const line2 = G.choose(tired, c2[0].id, 'do', DAY(0)).result.line;
  assert.ok(/精力/.test(line2), `精力见底时应提到精力：${line2}`);
});

test('连续放弃会被点出来（这是"被记住"的核心体验）', () => {
  let s = G.create(DAY(0));
  let line = '';
  for (let i = 0; i < 3; i++) {
    s.lastPlayDay = null;
    const cards = G.cardsFor(s, DAY(i));
    const r = G.choose(s, cards[0].id, 'skip', DAY(i));
    s = r.state;
    line = r.result.line;
  }
  assert.match(line, /连着 3 次/);
});

test('同一天同一张卡的结果是确定的（不会刷新赌数值）', () => {
  const s1 = G.create(DAY(0));
  const s2 = G.create(DAY(0));
  const id = G.cardsFor(s1, DAY(0))[0].id;
  const a = G.choose(s1, id, 'do', DAY(0)).result.deltas;
  const b = G.choose(s2, id, 'do', DAY(0)).result.deltas;
  assert.deepEqual(a, b);
});

test('三场短试炼：5 步可立即走完，高分产出保持清单，低分产出专属健康方案', () => {
  assert.equal(G.TRIALS.length, 3);
  // 高分路径：全程执行
  let highTrial = G.startTrial('vitality', 42);
  assert.equal(highTrial.total, 5);
  for (let i = 0; i < 5; i++) {
    const hand = highTrial.hands[highTrial.round];
    assert.equal(hand.length, 3);
    const best = hand.slice().sort((a, b) => (a.ev === 'A' ? -1 : 1))[0];
    const r = G.stepTrial(highTrial, best.id, 'do');
    assert.equal(r.ok, true);
    highTrial = r.trial;
  }
  assert.equal(highTrial.finished, true);
  assert.equal(highTrial.outcome.tier, 'high');
  assert.ok(highTrial.outcome.score >= 75);
  assert.ok(highTrial.outcome.keepList.length >= 3);

  // 低分路径：全程跳过
  let lowTrial = G.startTrial('wealth', 99);
  for (let i = 0; i < 5; i++) {
    const hand = lowTrial.hands[lowTrial.round];
    const r = G.stepTrial(lowTrial, hand[0].id, 'skip');
    assert.equal(r.ok, true);
    lowTrial = r.trial;
  }
  assert.equal(lowTrial.finished, true);
  assert.equal(lowTrial.outcome.tier, 'plan');
  assert.ok(lowTrial.outcome.score < 75);
  assert.ok(lowTrial.outcome.planList.length >= 3);
});
