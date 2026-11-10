const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/shared/lifegame');

const DAY = (n) => new Date(2026, 10, 8 + n); // 2026-11-08 起第 n 天

// ---------------------------------------------------------------- 资源 → 它今天的样子

test('四条资源映射成宠物状态：命快没了优先于没钱，没钱优先于没精力', () => {
  const base = G.create(DAY(0));

  assert.equal(G.resourceMood({ ...base, energy: 20, cash: 50000, free: 80, lifeYears: 50 }).level, 'tired');
  assert.equal(G.resourceMood({ ...base, energy: 20, cash: -1, free: 80, lifeYears: 50 }).level, 'broke', '没钱比没精力更该被看见');
  assert.equal(G.resourceMood({ ...base, energy: 20, cash: -1, free: 10, lifeYears: 50 }).level, 'broke');
  assert.equal(G.resourceMood({ ...base, energy: 90, cash: 50000, free: 20, lifeYears: 50 }).level, 'caged');
  assert.equal(G.resourceMood({ ...base, energy: 90, cash: 50000, free: 80, lifeYears: 3 }).level, 'danger', '命快没了压过一切');
});

test('状态好坏要有可见差异：毛色滤镜和待机速度都必须给出具体数值', () => {
  const base = G.create(DAY(0));
  const good = G.resourceMood({ ...base, turn: 10, energy: 90, cash: 60000, free: 80, lifeYears: 40 });
  const bad = G.resourceMood({ ...base, energy: 90, cash: 50000, free: 80, lifeYears: 3 });

  assert.equal(good.level, 'steady');
  assert.ok(good.sat > 1, '状态好应该更饱和');
  assert.ok(good.tempo < 1, '状态好待机应该更快');

  assert.equal(bad.level, 'danger');
  assert.ok(bad.sat < 0.6, '命快没了应该几乎退到灰度');
  assert.ok(bad.tempo > 1.4, '命快没了待机应该明显变慢');
  assert.ok(Number.isFinite(bad.hue) && Math.abs(bad.hue) <= 180, 'hue 必须是可用的角度值');

  for (const key of ['hue', 'sat', 'bright', 'tempo', 'label', 'line']) {
    assert.ok(good[key] !== undefined && good[key] !== null, `${key} 不能缺`);
  }
});

test('状态变化会说明理由，而不是只给一个颜色', () => {
  const s = { ...G.create(DAY(0)), energy: 12, cash: -3000, free: 20 };
  const m = G.resourceMood(s);
  assert.deepEqual(m.signals.sort(), ['cash', 'energy', 'free']);
  assert.equal(m.reasons.length, 3);
  assert.match(m.reasons.map((r) => r.text).join(' '), /现金/);
});

// ---------------------------------------------------------------- 同命局

test('同命局：两个人轮流按，四十步各走二十步', () => {
  let s = G.create(DAY(0), { duo: { names: ['小林', '阿岚'] } });
  assert.equal(G.duoOwnerOf(s), 0);

  const owners = [];
  for (let i = 0; i < 6; i++) {
    const cards = G.cardsFor(s, DAY(i));
    const r = G.choose(s, cards[0].id, 'do', DAY(i));
    assert.equal(r.result.ok, true);
    owners.push(r.result.owner);
    s = r.state;
  }
  assert.deepEqual(owners, [0, 1, 0, 1, 0, 1], '必须轮流，不能一直是同一个人');

  const info = G.duoInfo(s);
  assert.equal(info.names[0], '小林');
  assert.equal(info.steps[0], 3);
  assert.equal(info.steps[1], 3);
  assert.equal(info.owner, 0, '第 7 步轮到第一个人');
  assert.equal(info.left, 17);
});

test('同命局共用同一条命：钱和寿命只有一份，不分账', () => {
  let s = G.create(DAY(0), { duo: { names: ['A', 'B'] } });
  const cash0 = s.cash;
  const c1 = G.cardsFor(s, DAY(0));
  s = G.choose(s, c1[0].id, 'do', DAY(0)).state;
  const cash1 = s.cash;
  const c2 = G.cardsFor(s, DAY(1));
  s = G.choose(s, c2[0].id, 'do', DAY(1)).state;
  assert.ok(s.cash !== cash0);
  assert.ok(s.cash !== cash1);
  assert.equal(typeof s.cash, 'number', '现金是共享的一个数，不是每人一份');
  assert.ok(!('cashB' in s) && !('cashA' in s));
});

test('同命局的每一步都记下是谁按的，结局能算清账', () => {
  let s = G.create(DAY(0), { duo: { names: ['A', 'B'] } });
  s = G.choose(s, G.cardsFor(s, DAY(0))[0].id, 'do', DAY(0)).state;
  s = G.choose(s, G.cardsFor(s, DAY(1))[0].id, 'skip', DAY(1)).state;
  assert.equal(s.log[0].owner, 0);
  assert.equal(s.log[1].owner, 1);
  const info = G.duoInfo(s);
  assert.equal(info.acted[0], 1, 'A 执行了 1 条');
  assert.equal(info.acted[1], 0, 'B 选了放弃');
});

test('单人局不受影响：duoOwnerOf 返回 -1，log 里不出现 owner 语义', () => {
  const s = G.create(DAY(0));
  assert.equal(G.duoOwnerOf(s), -1);
  assert.equal(G.duoInfo(s), null);
  const r = G.choose(s, G.cardsFor(s, DAY(0))[0].id, 'do', DAY(0));
  assert.equal(r.result.owner, -1);
});

test('老存档没有 duo 字段时自动补成单人局，不能把老命改掉', () => {
  const legacy = {
    version: 1, turn: 5, age: 27, cash: 40000, energy: 70, free: 70, lifeYears: 50,
    used: [], log: [], flags: {}, streak: 2, lifeIndex: 1,
  };
  const s = G.normalize(legacy);
  assert.equal(s.duo.on, false);
  assert.equal(s.cash, 40000);
  assert.equal(s.turn, 5);
});

// ---------------------------------------------------------------- 跨端接续

test('手机上这一手：打包 → 解包，三张卡原样回来（含中文）', () => {
  const s = G.create(DAY(0));
  const cards = G.cardsFor(s, DAY(0));
  const code = G.packHand(s, cards, DAY(0));
  // 实测 ~1.3k：三张卡的标题 + 60 字摘要 + 四条资源。再长就该压缩了，短了手机上看不到内容。
  assert.ok(code.length < 1500, `码不该长到贴不进微信：${code.length}`);

  const back = G.parseHand(code);
  assert.equal(back.ok, true);
  assert.equal(back.turn, 0);
  assert.equal(back.age, 22);
  assert.equal(back.day, G.todayKey(DAY(0)));
  assert.deepEqual(back.cards.map((c) => c.id), cards.map((c) => c.id));
  assert.deepEqual(back.cards.map((c) => c.title), cards.map((c) => c.title));
  assert.equal(back.cards[0].ev, cards[0].ev);
});

test('整条链接也能解：用户从微信里复制过来的是完整 URL', () => {
  const s = G.create(DAY(0));
  const code = G.packHand(s, G.cardsFor(s, DAY(0)), DAY(0));
  const url = `https://cubbit.app/life.html#h=${code}`;
  const back = G.parseHand(url);
  assert.equal(back.ok, true);
  assert.equal(back.cards.length, 3);
});

test('垃圾输入不会让面板崩掉', () => {
  for (const bad of ['', 'xxx', 'https://cubbit.app/life.html', 'D1.1.d']) {
    assert.equal(G.parseHand(bad), null);
  }
  // 被截断的码必须安全失败，而不是抛异常
  const code = G.packHand(G.create(DAY(0)), null, DAY(0));
  assert.equal(G.parseHand(code.slice(0, 10)), null);
});

test('决定码：8 个字符说清「第几张 + 做不做」，非法值挡住', () => {
  assert.equal(G.decisionCode(0, 'do'), 'D1.0.d');
  assert.equal(G.decisionCode(2, 'skip'), 'D1.2.s');
  assert.equal(G.decisionCode(9, 'do'), 'D1.2.d', '越界钳到 2，不生成坏码');

  assert.deepEqual(G.parseDecision('D1.1.d'), { ok: true, index: 1, action: 'do' });
  assert.deepEqual(G.parseDecision(' d1.0.s '), { ok: true, index: 0, action: 'skip' });
  assert.equal(G.parseDecision('D1.3.d'), null);
  assert.equal(G.parseDecision('hello'), null);
  assert.equal(G.parseDecision(''), null);
});

test('同命局的牌打包后仍然带着两个人的名字', () => {
  const s = G.create(DAY(0), { duo: { names: ['小林', '阿岚'] } });
  const back = G.parseHand(G.packHand(s, G.cardsFor(s, DAY(0)), DAY(0)));
  assert.deepEqual(back.duo, ['小林', '阿岚']);
});

// ---------------------------------------------------------------- 快照

test('快照同时带出 duo 和 mood，渲染层不需要自己算', () => {
  const s = G.create(DAY(0), { duo: { names: ['A', 'B'] } });
  const snap = G.snapshot(s, DAY(0));
  assert.equal(snap.duo.on, true);
  assert.equal(snap.duo.owner, 0);
  assert.equal(snap.mood.level, 'normal');
  assert.equal(typeof snap.mood.tempo, 'number');
});
