/* 人生账本 · 桌面宠物内置的「性价比人生」
 *
 * 把《高性价比人生指南》的 767 条循证建议，改造成"一天只走一步"的长期陪伴玩法。
 *
 * 和原作网页版（40 回合一次打完，7 分钟一局）的关键差别：
 *   1. 一天一回合 —— 40 回合 = 40 天。宠物陪你走完一个"人生季度"，而不是刷一局。
 *   2. 资源映射到宠物本体 —— 寿命/现金/精力/自由 直接决定它今天的精神状态，
 *      不需要另开一个数值面板（这也是桌面宠物比硬件宠物值钱的地方：它认识你）。
 *   3. 选择会被记住 —— 宠物会引用你上次、上上次的选择，物理玩偶没有记忆。
 *
 * 数值全部是游戏化换算，不是医学/财务建议。这一点必须随卡面一起露出。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CUBBIT_LIFEGAME = api;
})(this, function (root) {
  const VERSION = 1;
  const TOTAL_TURNS = 40;

  const START = Object.freeze({
    age: 22,
    cash: 30000,
    energy: 100,
    free: 100,
    lifeYears: 62, // 22 + 62 = 84 岁预期
  });

  // 34 个章节各自最吃哪一条资源。sec 号与原作目录顺序一致。
  const SECTION_CHANNEL = {
    1: 'life', 2: 'life', 3: 'energy', 4: 'energy', 5: 'cash', 6: 'life', 7: 'cash',
    8: 'free', 9: 'free', 10: 'free', 11: 'free', 12: 'cash', 13: 'life', 14: 'free',
    15: 'cash', 16: 'life', 17: 'life', 18: 'cash', 19: 'cash', 20: 'life', 21: 'life',
    22: 'energy', 23: 'cash', 24: 'life', 25: 'life', 26: 'cash', 27: 'life', 28: 'life',
    29: 'energy', 30: 'cash', 31: 'cash', 32: 'cash', 33: 'life', 34: 'life',
  };

  const CHANNEL_LABEL = {
    life: '寿命',
    cash: '现金',
    energy: '精力',
    free: '自由',
  };

  const MONEY_COST = { 0: [0, 0], 少: [300, 1200], 多: [3000, 15000] };
  const TIME_COST = { 少: 2, 中: 5, 多: 9 };
  const WILL_COST = { 否: 0, 些: 2, 是: 5 };
  const WILL_FREE = { 否: 0, 些: 1, 是: 3 };

  const GAIN = {
    life: { 大: 2.2, 中: 1.3, 小: 0.5 },
    cash: { 大: 4200, 中: 1800, 小: 600 },
    energy: { 大: 9, 中: 5, 小: 2 },
    free: { 大: 9, 中: 5, 小: 2 },
  };

  // 证据等级只控制方差：A 不打折，C 上下浮动最大。
  const EV_SPREAD = { A: [1, 1], B: [0.7, 1.3], C: [0.45, 1.55] };

  // 强制打断。条件成立才触发，所以"你之前怎么选"会决定后来遇到什么。
  const EVENTS = [
    {
      id: 'insurance-gap',
      when: (s) => s.turn === 9 && !s.flags.insurance,
      title: '社保被劝着放弃了',
      text: '公司说"多给你点现金，社保你自己交更划算"。你签了。',
      effect: { cash: 2400, free: -6, life: -1.2 },
      need: 'insurance',
    },
    {
      id: 'checkup',
      when: (s) => s.turn === 15 && !s.flags.checkup && s.energy < 70,
      title: '体检报告上多了两个箭头',
      text: '你一直没去复查。这次拖过去了，但身体会记账。',
      effect: { life: -1.6, energy: -6 },
      need: 'checkup',
    },
    {
      id: 'borrow',
      when: (s) => s.turn === 21 && s.cash < 20000,
      title: '亲戚来借钱',
      text: '借出去的钱，通常是拿关系换的。',
      effect: { cash: -6000, free: -4 },
      need: null,
    },
    {
      id: 'layoff',
      when: (s) => s.turn === 30 && s.cash < 60000,
      title: '裁员名单上有你',
      text: 'N+1 拿到了。问题是，你上一次学新东西是三年前。',
      effect: { cash: 8000, energy: -12, free: -8 },
      need: null,
    },
  ];

  // ------------------------------------------------------------ 基础工具

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seeded(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function todayKey(now) {
    const d = now ? new Date(now) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  // ------------------------------------------------------------ 卡库

  let CACHE = null;
  function allCards() {
    if (CACHE) return CACHE;
    if (typeof module === 'object' && module.exports) {
      CACHE = require('./life-cards');
    } else if (root && root.LIFE_CARDS) {
      CACHE = root.LIFE_CARDS;
    } else {
      CACHE = [];
    }
    return CACHE;
  }

  function cardById(id) {
    return allCards().find((c) => c.id === id) || null;
  }

  function channelOf(card) {
    return SECTION_CHANNEL[card.sec] || 'life';
  }

  // ------------------------------------------------------------ 状态

  function create(now, opts = {}) {
    const duo = opts.duo && Array.isArray(opts.duo.names) && opts.duo.names.length === 2
      ? { on: true, names: opts.duo.names.map((n, i) => String(n || (i ? 'TA' : '你')).slice(0, 8)), since: todayKey(now) }
      : { on: false, names: ['你', 'TA'], since: null };
    return {
      version: VERSION,
      lifeIndex: 1,
      startedAt: todayKey(now),
      turn: 0,
      age: START.age,
      cash: START.cash,
      energy: START.energy,
      free: START.free,
      lifeYears: START.lifeYears,
      used: [],
      log: [],
      flags: {},
      streak: 0,
      lastPlayDay: null,
      today: null,
      ended: null,
      duo,
    };
  }

  function normalize(input) {
    const base = create();
    const s = Object.assign(base, input && typeof input === 'object' ? input : {});
    s.version = VERSION;
    s.turn = Math.max(0, Math.min(TOTAL_TURNS, Number(s.turn) || 0));
    s.age = Number(s.age) || START.age;
    s.cash = Number(s.cash) || 0;
    s.energy = clamp(Number(s.energy) || 0, 0, 100);
    s.free = clamp(Number(s.free) || 0, 0, 100);
    s.lifeYears = Math.max(0, Number(s.lifeYears) || 0);
    s.used = Array.isArray(s.used) ? s.used.slice(-400) : [];
    s.log = Array.isArray(s.log) ? s.log.slice(-60) : [];
    s.flags = s.flags && typeof s.flags === 'object' ? s.flags : {};
    s.streak = Number(s.streak) || 0;
    s.lifeIndex = Number(s.lifeIndex) || 1;
    // 同命局：两人共用这一条命，轮流决定每一步。
    // 老存档没有这个字段，兜底成单人局，不要因为升级就把人家的命改掉。
    const d = s.duo && typeof s.duo === 'object' ? s.duo : null;
    s.duo = {
      on: !!(d && d.on),
      names: d && Array.isArray(d.names) && d.names.length === 2
        ? d.names.map((n, i) => String(n || (i ? 'TA' : '你')).slice(0, 8))
        : ['你', 'TA'],
      since: (d && d.since) || null,
    };
    return s;
  }

  function needsDay(state, now) {
    const s = normalize(state);
    if (s.ended) return false;
    return s.lastPlayDay !== todayKey(now);
  }

  // ------------------------------------------------------------ 抽卡

  /** 当天抽 3 张，确定性的：同一天反复打开不会重抽。 */
  function cardsFor(state, now) {
    const s = normalize(state);
    const day = todayKey(now);
    if (s.today && s.today.day === day && Array.isArray(s.today.ids) && s.today.ids.length === 3) {
      return s.today.ids.map(cardById).filter(Boolean);
    }

    const rnd = seeded(hash(`${day}#${s.lifeIndex}#${s.turn}`));
    const pool = allCards().filter((c) => {
      if (s.used.includes(c.id)) return false;
      const band = Array.isArray(c.band) ? c.band : null;
      if (band && (s.age < band[0] || s.age > band[1])) return false;
      return true;
    });

    const picked = [];
    const seenSec = new Set();
    // 先保证三张来自不同章节：同一天看到三条"系安全带"是灾难
    const shuffled = pool.slice().sort(() => rnd() - 0.5);
    for (const c of shuffled) {
      if (picked.length >= 3) break;
      if (seenSec.has(c.sec)) continue;
      seenSec.add(c.sec);
      picked.push(c);
    }
    for (const c of shuffled) {
      if (picked.length >= 3) break;
      if (!picked.includes(c)) picked.push(c);
    }

    return picked;
  }

  // ------------------------------------------------------------ 结算

  function computeResult(card, action, rnd) {
    const channel = channelOf(card);
    const spread = EV_SPREAD[card.ev] || EV_SPREAD.B;
    const factor = spread[0] + rnd() * (spread[1] - spread[0]);

    if (action === 'skip') {
      return {
        channel,
        deltas: { energy: 6 },
        cost: {},
        gain: {},
        factor: 1,
        note: '这一年你什么也没做，攒回一点精力。',
      };
    }

    const moneyRange = MONEY_COST[card.money] || [0, 0];
    const moneyCost = Math.round((moneyRange[0] + rnd() * (moneyRange[1] - moneyRange[0])) / 100) * 100;
    const energyCost = (TIME_COST[card.time] || 0) + (WILL_COST[card.will] || 0);
    const freeCost = WILL_FREE[card.will] || 0;

    const gainBase = (GAIN[channel] || GAIN.life)[card.benefit] || 0;
    const gain = round1(gainBase * factor);

    const deltas = {};
    if (channel === 'life') deltas.lifeYears = gain;
    else deltas[channel] = gain;
    if (energyCost) deltas.energy = (deltas.energy || 0) - energyCost;
    if (freeCost) deltas.free = (deltas.free || 0) - freeCost;
    if (moneyCost) deltas.cash = (deltas.cash || 0) - moneyCost;

    return {
      channel,
      deltas,
      cost: { money: moneyCost, energy: energyCost, free: freeCost },
      gain: { channel, value: gain },
      factor: round1(factor * 100) / 100,
      note: '',
    };
  }

  /** 把增量落到状态上，返回 {state, result}。 */
  function choose(state, cardId, action, now) {
    const s = normalize(state);
    if (s.ended) return { state: s, result: { ok: false, code: 'ENDED' } };
    if (!needsDay(s, now)) return { state: s, result: { ok: false, code: 'ALREADY_TODAY' } };

    const card = cardById(cardId);
    if (!card) return { state: s, result: { ok: false, code: 'NO_CARD' } };
    if (s.today && s.today.day === todayKey(now) && s.today.ids && !s.today.ids.includes(cardId)) {
      return { state: s, result: { ok: false, code: 'NOT_TODAY_CARD' } };
    }

    const day = todayKey(now);
    // 同命局：这一步算谁的。必须在 turn+1 之前取，否则永远记成对方。
    const owner = duoOwnerOf(s);
    const seedKey = `${day}#${cardId}#${action}#${s.currentSeed || 0}`;
    const rnd = seeded(hash(seedKey));
    const res = computeResult(card, action, rnd);

    // 卡片本身的效果先单独记一份。UI 必须把它和"又过一年"分开显示，
    // 否则用户会把每年必扣的衰老算到这张卡头上（"执行这条 → 寿命 -1.2"是错的）。
    const cardDeltas = {
      cash: res.deltas.cash || 0,
      energy: res.deltas.energy || 0,
      free: res.deltas.free || 0,
      lifeYears: round1(res.deltas.lifeYears || 0),
    };

    s.age += 1;
    s.turn += 1;
    s.cash += cardDeltas.cash;
    s.energy = clamp(s.energy + cardDeltas.energy, 0, 100);
    s.free = clamp(s.free + cardDeltas.free, 0, 100);
    s.lifeYears = Math.max(0, s.lifeYears + cardDeltas.lifeYears);

    // ---- 时间流逝：这一段和"你选了什么"无关，每年都会发生
    const aging = 1.2; // 衰老 + 不确定性
    const living = Math.round(livingOf(s.age) / 100) * 100;
    const salary = incomeOf(s.age);
    const recovery = s.energy < 60 ? 12 : 8; // 又过一年，身体歇回来一点
    s.lifeYears = Math.max(0, s.lifeYears - aging);
    s.cash += salary - living;
    s.energy = clamp(s.energy + recovery, 0, 100);

    // 透支惩罚：资源见底会真扣寿。这是"精力/自由不是软指标"的证据。
    const burn = burnOf(s);
    if (burn > 0) s.lifeYears = Math.max(0, s.lifeYears - burn);
    const passing = { lifeYears: round1(-aging - burn), cash: salary - living, energy: recovery };

    // 记住这张卡：真正的"以后不会再抽到"
    if (!s.used.includes(card.id)) s.used.push(card.id);

    // 卡面自带的事实会改变后面的意外
    if (/保险|社保/.test(card.title)) s.flags.insurance = true;
    if (/体检|筛查|复查/.test(card.title)) s.flags.checkup = true;

    const beforeEv = { cash: s.cash, energy: s.energy, free: s.free, lifeYears: s.lifeYears };
    const eventOut = maybeEvent(s, rnd);
    if (eventOut) {
      const ed = diffOf(beforeEv, s);
      cardDeltas.cash += ed.cash || 0;
      cardDeltas.energy += ed.energy || 0;
      cardDeltas.free += ed.free || 0;
      cardDeltas.lifeYears = round1(cardDeltas.lifeYears + (ed.lifeYears || 0));
    }
    const deltas = cardDeltas;
    let line = petLine(s, { card, action, deltas, event: eventOut });
    // 同命局里要让人知道这一步是谁按的——两个人共用一条命，责任得看得见。
    if (s.duo.on && owner >= 0) line = `${line}（${s.duo.names[owner]}按的）`;

    s.log.push({
      turn: s.turn,
      day,
      cardId: card.id,
      title: card.title,
      secName: card.secName,
      action,
      deltas,
      event: eventOut ? eventOut.id : null,
      owner,
    });
    s.log = s.log.slice(-60);
    s.lastPlayDay = day;
    s.today = { day, ids: s.today && s.today.day === day ? s.today.ids : [card.id] };
    s.streak = 1; // 由主进程按真实日期累计，这里只保证非零

    if (s.lifeYears <= 0) {
      s.ended = endingOf(s);
    } else if (s.turn >= TOTAL_TURNS) {
      s.ended = endingOf(s);
    }

    return {
      state: s,
      result: {
        ok: true,
        card,
        action,
        deltas,
        event: eventOut,
        line,
        ended: s.ended,
        cost: res.cost,
        factor: res.factor,
        passing,
        owner,
      },
    };
  }

  function diffOf(before, s) {
    const d = {};
    if (s.cash !== before.cash) d.cash = s.cash - before.cash;
    if (s.energy !== before.energy) d.energy = s.energy - before.energy;
    if (s.free !== before.free) d.free = s.free - before.free;
    if (s.lifeYears !== before.lifeYears) d.lifeYears = round1(s.lifeYears - before.lifeYears);
    return d;
  }

  function burnOf(s) {
    let burn = 0;
    if (s.energy < 30) burn += 1.1;
    if (s.cash < 0) burn += 0.9;
    if (s.free < 30) burn += 0.5;
    return round1(burn);
  }

  function maybeEvent(s, rnd) {
    for (const ev of EVENTS) {
      if (!ev.when(s)) continue;
      s.cash += ev.effect.cash || 0;
      s.energy = clamp(s.energy + (ev.effect.energy || 0), 0, 100);
      s.free = clamp(s.free + (ev.effect.free || 0), 0, 100);
      s.lifeYears = Math.max(0, s.lifeYears + (ev.effect.life || 0));
      return { id: ev.id, title: ev.title, text: ev.text, effect: ev.effect };
    }
    return null;
  }

  // ------------------------------------------------------------ 结局

  function endingOf(state) {
    const s = normalize(state);
    const ageNow = s.age;
    if (s.lifeYears <= 0) {
      return {
        type: 'early',
        title: '早死',
        age: ageNow,
        summary: `${ageNow} 岁就走了。你省下的那些钱，没能换成时间。`,
      };
    }
    if (s.cash < -20000) {
      return { type: 'poor', title: '被穷拖垮', age: ageNow, summary: '钱不是万能的，但没钱会把每一步都变窄。' };
    }
    if (s.free < 25) {
      return { type: 'trapped', title: '被搭进去', age: ageNow, summary: '你没有做错什么大事，只是一次次签了那张字。' };
    }
    if (s.turn >= TOTAL_TURNS) {
      // "活到 80 且不穷"要三件事同时成立：命够、钱够、还算自由。
      // 只满足"活着"不算赢，这是这版比原作更严的地方。
      if (s.lifeYears < 15 || s.cash < 40000) {
        return { type: 'slow', title: '慢慢死', age: ageNow, summary: '活到了，但最后几年一直在还前半生的账。' };
      }
      if (s.free < 55) {
        return { type: 'trapped', title: '被搭进去', age: ageNow, summary: '钱和命都在，人却不由自己安排了。' };
      }
      return {
        type: 'good',
        title: '活到 80 且不穷',
        age: ageNow,
        summary: `你活到了 ${Math.round(ageNow + s.lifeYears)} 岁，手里还有 ${Math.round(s.cash / 10000)} 万。`,
      };
    }
    return null;
  }

  // ------------------------------------------------------------ 宠物台词

  const CHANNEL_HINT = {
    life: '这条是保命的',
    cash: '这条跟钱有关',
    energy: '这条是省力气的',
    free: '这条是保自由的',
  };

  // 每回合都会发生的"日子"：工资进来，生活开销出去。
  // 没有这组数，钱只会单向上涨，"不要浪费钱"就失效了。
  const INCOME = 20000; // 起步工资，随工龄微涨
  const incomeOf = (age) => INCOME + Math.max(0, age - 22) * 150;
  const livingOf = (age) => 15000 + Math.max(0, age - 22) * 400;

  function moneyText(n) {
    if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)} 万`;
    return `${Math.round(n)} 元`;
  }

  function petLine(s, info) {
    const { card, action, deltas, event } = info;

    if (event) {
      return `${event.title}。${event.text}`;
    }

    if (action === 'skip') {
      // +1：这一步还没写进 log，台词是在写之前生成的
      const skips = countRecentSkips(s) + 1;
      if (skips >= 3) return `你已经连着 ${skips} 次说「算了」。我不催你，但时间在走。`;
      return '行，这一年就当歇口气。我陪你待着。';
    }

    const parts = [];
    if (deltas.lifeYears) {
      const v = deltas.lifeYears;
      parts.push(v > 0 ? `寿命 ${v > 0 ? '+' : ''}${v} 年` : `寿命 ${v} 年`);
    }
    if (deltas.cash) parts.push(`现金 ${deltas.cash > 0 ? '+' : '-'}${moneyText(Math.abs(deltas.cash))}`);
    if (deltas.energy) parts.push(`精力 ${deltas.energy > 0 ? '+' : ''}${deltas.energy}`);
    if (deltas.free) parts.push(`自由 ${deltas.free > 0 ? '+' : ''}${deltas.free}`);

    const head = `${CHANNEL_HINT[channelOf(card)]}：${card.title}`;
    const tail = parts.length ? `（${parts.join('，')}）` : '';

    if (s.energy < 30) return `${head}${tail}。你精力只剩 ${Math.round(s.energy)} 了，今晚早点睡。`;
    if (s.cash < 0) return `${head}${tail}。钱包已经是负的了，我有点慌。`;
    if (s.free < 40) return `${head}${tail}。自由掉到 ${Math.round(s.free)}，你最近是不是很难说「不」。`;
    return `${head}${tail}。记下了。`;
  }

  function countRecentSkips(s) {
    let n = 0;
    for (let i = s.log.length - 1; i >= 0; i--) {
      if (s.log[i].action !== 'skip') break;
      n++;
    }
    return n;
  }

  /** 面板底部那句"我注意到的事"，比数值更能让人觉得它认识你。 */
  function insight(state) {
    const s = normalize(state);
    if (!s.log.length) return '今天开始，一天一步，四十天走完一辈子。';
    if (countRecentSkips(s) >= 3) return `你连着 ${countRecentSkips(s)} 次选择放弃。省钱没错，但命也在走。`;
    if (s.energy < 30) return '你精力一直在低位。今天能少做一件就少做一件。';
    if (s.cash < 0) return '现金已经是负数。先把利息高的那笔处理掉。';
    if (s.free < 40) return '自由被压得很低。有些字，签了就很难反悔。';
    const spent = s.log.filter((r) => r.action !== 'skip').length;
    if (spent >= 10) return `你已经真正执行了 ${spent} 条。多数人一年连一条都做不到。`;
    return `${s.turn}/40 步。慢慢来，别把这一局也过成赶工。`;
  }

  // ------------------------------------------------------------ 资源 → 它今天的样子
  //
  // 四条资源不只是数字，它们要长在宠物身上：毛色偏暖还是发青、待机是弹的还是塌的。
  // 这是"宠物即状态面板"的实现部分——用户不看数字，看它今天什么状态就知道过得怎么样。
  //
  // 只做滤镜（hue-rotate / saturate / brightness）和动画时长，不改素材：
  // 12 只 × 2 帧已经全部对齐，任何几何改动都会让它们对不上。

  const RESOURCE_TONES = {
    steady: { level: 'steady', label: '状态很好', hue: 4, sat: 1.12, bright: 1.04, tempo: 0.92, expr: 'happy', line: '我今天状态不错，你想做点什么？' },
    normal: { level: 'normal', label: '还行', hue: 0, sat: 1, bright: 1, tempo: 1, expr: null, line: '普通的一天，也挺好。' },
    tired: { level: 'tired', label: '有点撑不住', hue: -6, sat: 0.78, bright: 0.92, tempo: 1.42, expr: 'sleepy', line: '我有点累了……今天能不能只做一件小事？' },
    broke: { level: 'broke', label: '心里发慌', hue: 32, sat: 0.58, bright: 0.9, tempo: 1.26, expr: 'nervous', line: '钱有点紧，我说话都不敢大声。' },
    caged: { level: 'caged', label: '闷', hue: 190, sat: 0.45, bright: 0.93, tempo: 1.32, expr: 'sad', line: '最近好像什么都得听别人的。' },
    danger: { level: 'danger', label: '不太好', hue: 0, sat: 0.22, bright: 0.8, tempo: 1.6, expr: 'sad', line: '我们得慢一点了，真的。' },
  };

  /**
   * 把四条资源翻译成"它今天的样子"。
   * 优先级是刻意的：命快没了 > 没钱 > 没自由 > 没精力。越靠前越该被看见。
   */
  function resourceMood(state) {
    const s = normalize(state);
    const signals = [];
    if (s.energy < 30) signals.push('energy');
    if (s.cash < 0) signals.push('cash');
    if (s.free < 35) signals.push('free');
    if (s.lifeYears < 8) signals.push('life');

    let level = 'normal';
    if (s.lifeYears < 8) level = 'danger';
    else if (s.cash < 0) level = 'broke';
    else if (s.free < 35 || s.energy < 30) level = s.free < 35 ? 'caged' : 'tired';
    else if (s.turn >= 6 && s.energy >= 65 && s.free >= 55 && s.lifeYears >= 20 && s.cash >= 20000) level = 'steady';

    const tone = RESOURCE_TONES[level];
    return {
      ok: true,
      level,
      label: tone.label,
      hue: tone.hue,
      sat: tone.sat,
      bright: tone.bright,
      tempo: tone.tempo,
      expr: tone.expr,
      line: tone.line,
      signals,
      reasons: signals.map((k) => ({
        key: k,
        text: k === 'life' ? `只剩 ${round1(s.lifeYears)} 年` : k === 'cash' ? '现金已经是负的' : k === 'free' ? `自由只剩 ${Math.round(s.free)}` : `精力只剩 ${Math.round(s.energy)}`,
      })),
      turn: s.turn,
      duo: s.duo.on ? s.duo.names : null,
    };
  }

  // ------------------------------------------------------------ 同命局（情侣）
  //
  // 规则一句话：四十步，两人轮流按，共用一条命。
  // 不做两份资源——"共享一条命"必须是字面意思，否则只是两个单人局互相看。
  // 也不锁定"只能轮到谁按"：情侣常常挤在一台电脑前，锁了就得换设备。

  function duoOwnerOf(s) {
    const st = normalize(s);
    if (!st.duo.on) return -1;
    return st.turn % 2;
  }

  function duoInfo(state) {
    const s = normalize(state);
    if (!s.duo.on) return null;
    const steps = [0, 0];
    const acted = [0, 0];
    for (const r of s.log) {
      const o = r.owner === 1 ? 1 : 0;
      steps[o]++;
      if (r.action !== 'skip') acted[o]++;
    }
    return {
      on: true,
      names: s.duo.names.slice(),
      owner: s.turn % 2,
      turn: s.turn,
      left: Math.ceil((TOTAL_TURNS - s.turn) / 2),
      steps,
      acted,
      since: s.duo.since,
    };
  }

  // ------------------------------------------------------------ 跨端接续（手机看牌）
  //
  // 只带走"今天这一手"，不带走整局状态。
  // 理由：整局状态里 used 有几百个 id，塞进 URL 会到几 KB，微信/短信里必断；
  // 而手机端真正需要的只是"今天三张卡长什么样"。
  // 决定用 D1.<序号>.<d|s> 这种 8 个字符的码带回来，双方都不会误解。

  function toBin(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function b64urlEncode(str) {
    const bytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str)
      : new Uint8Array(Buffer.from(str, 'utf8'));
    const b64 = typeof btoa === 'function' ? btoa(toBin(bytes)) : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(text) {
    const clean = String(text || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
    if (!clean) return '';
    const pad = clean.length % 4 ? '='.repeat(4 - (clean.length % 4)) : '';
    const bin = typeof atob === 'function'
      ? atob(clean + pad)
      : Buffer.from(clean + pad, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString('utf8');
  }

  function packHand(state, cards, now) {
    const s = normalize(state);
    const hand = (Array.isArray(cards) && cards.length ? cards : cardsFor(s, now)).slice(0, 3);
    const payload = {
      v: 1,
      d: todayKey(now),
      t: s.turn,
      a: Math.round(s.age),
      c: Math.round(s.cash),
      e: Math.round(s.energy),
      f: Math.round(s.free),
      l: round1(s.lifeYears),
      n: s.duo.on ? s.duo.names : null,
      // 第 8 位是正文摘要：不带的话手机上三张卡都是同一句占位文字，等于没内容。
      k: hand.map((c) => [c.id, c.title, c.ev, c.secName, c.money || '0', c.time || '少', c.will || '否', String(c.plain || '').slice(0, 60)]),
    };
    return b64urlEncode(JSON.stringify(payload));
  }

  function parseHand(code) {
    const raw = String(code || '').trim().replace(/^.*#h=/, '');
    if (!raw || raw.length > 8000) return null;
    let o;
    try {
      o = JSON.parse(b64urlDecode(raw));
    } catch {
      return null;
    }
    if (!o || o.v !== 1 || !Array.isArray(o.k) || !o.k.length) return null;
    const cards = o.k.slice(0, 3).filter((k) => Array.isArray(k) && k.length >= 4).map((k) => ({
      id: String(k[0]),
      title: String(k[1]),
      ev: String(k[2] || 'A'),
      secName: String(k[3] || ''),
      money: k[4] == null ? '0' : k[4],
      time: k[5] || '少',
      will: k[6] || '否',
      plain: String(k[7] || ''),
    }));
    if (!cards.length) return null;
    return {
      ok: true,
      day: String(o.d || ''),
      turn: Number(o.t) || 0,
      age: Number(o.a) || 0,
      cash: Number(o.c) || 0,
      energy: Number(o.e) || 0,
      free: Number(o.f) || 0,
      lifeYears: Number(o.l) || 0,
      duo: Array.isArray(o.n) && o.n.length === 2 ? o.n.map(String) : null,
      cards,
    };
  }

  function decisionCode(index, action) {
    const i = Math.max(0, Math.min(2, Number(index) || 0));
    return `D1.${i}.${action === 'skip' ? 's' : 'd'}`;
  }

  function parseDecision(code) {
    const m = /^D1\.([0-2])\.([ds])$/i.exec(String(code || '').trim());
    if (!m) return null;
    return { ok: true, index: Number(m[1]), action: m[2].toLowerCase() === 's' ? 'skip' : 'do' };
  }

  function snapshot(state, now) {
    const s = normalize(state);
    return {
      ...s,
      total: TOTAL_TURNS,
      canPlay: needsDay(s, now),
      today: todayKey(now),
      insight: insight(s),
      ending: s.ended,
      duo: duoInfo(s),
      mood: resourceMood(s),
    };
  }

  // ------------------------------------------------------------ 三场短试炼（立即可玩 · 高低分分流）
  const TRIAL_ROUNDS = 5;
  const TRIALS = Object.freeze([
    {
      id: 'vitality',
      icon: '🫀',
      title: '第一场 · 身体与精力试炼',
      shortTitle: '身体与精力',
      subtitle: '睡眠、慢病预防、看病与常备药——5 步测出你的身体护城河',
      channels: ['life', 'energy'],
      secs: [1, 2, 3, 4, 13, 16, 24, 28, 34],
    },
    {
      id: 'wealth',
      icon: '💰',
      title: '第二场 · 钱包与避坑试炼',
      shortTitle: '钱包与避坑',
      subtitle: '社保合同、消费防坑与保命底线——5 步测出你的反割韭菜免疫力',
      channels: ['cash'],
      secs: [5, 7, 12, 15, 18, 19, 23, 26, 30, 31, 32],
    },
    {
      id: 'freedom',
      icon: '🕊️',
      title: '第三场 · 自由与边界试炼',
      shortTitle: '自由与边界',
      subtitle: '人情边界、时间自主与精力分配——5 步测出你的人生掌控感',
      channels: ['free', 'energy'],
      secs: [8, 9, 10, 11, 14, 22, 29],
    },
  ]);

  function trialSpec(trialId) {
    return TRIALS.find((t) => t.id === trialId) || TRIALS[0];
  }

  function startTrial(trialId, seedInput) {
    const spec = trialSpec(trialId);
    const seedStr = `${spec.id}#${seedInput != null ? seedInput : Date.now()}`;
    const rnd = seeded(hash(seedStr));
    const pool = allCards().filter((c) => spec.secs.includes(c.sec) || spec.channels.includes(channelOf(c)));
    const source = (pool.length >= TRIAL_ROUNDS * 3 ? pool : allCards()).slice().sort(() => rnd() - 0.5);

    const hands = [];
    const usedIds = new Set();
    for (let r = 0; r < TRIAL_ROUNDS; r++) {
      const hand = [];
      const seenSec = new Set();
      for (const c of source) {
        if (hand.length >= 3) break;
        if (usedIds.has(c.id) || seenSec.has(c.sec)) continue;
        usedIds.add(c.id);
        seenSec.add(c.sec);
        hand.push(c);
      }
      for (const c of source) {
        if (hand.length >= 3) break;
        if (!usedIds.has(c.id)) {
          usedIds.add(c.id);
          hand.push(c);
        }
      }
      hands.push(hand);
    }

    return {
      id: spec.id,
      title: spec.title,
      shortTitle: spec.shortTitle,
      subtitle: spec.subtitle,
      icon: spec.icon,
      round: 0,
      total: TRIAL_ROUNDS,
      score: 45,
      hands,
      history: [],
      finished: false,
      outcome: null,
    };
  }

  function cardScoreValue(card) {
    if (!card) return 8;
    const evPts = card.ev === 'A' ? 7 : card.ev === 'B' ? 5 : 3;
    const benPts = card.benefit === '大' ? 6 : card.benefit === '中' ? 4 : 2;
    const lowCostBonus = card.money === '0' || card.money === 0 ? 2 : 0;
    return evPts + benPts + lowCostBonus; // 5 ~ 15
  }

  function evaluateTrial(trial) {
    const spec = trialSpec(trial && trial.id);
    const hist = (trial && Array.isArray(trial.history)) ? trial.history : [];
    const score = clamp(Math.round(Number(trial && trial.score) || 0), 0, 100);
    const high = score >= 75;

    const doneCards = hist.filter((h) => h.action === 'do' && h.card).map((h) => h.card);
    const missedCards = [];
    for (const h of hist) {
      for (const c of h.hand || []) {
        if (h.action === 'skip' || !h.card || c.id !== h.card.id) {
          missedCards.push(c);
        }
      }
    }

    // 高分：生成「保持清单」+ 分享卡数据
    const keepList = doneCards.slice(0, 5);
    if (keepList.length < 3) {
      for (const c of missedCards.sort((a, b) => cardScoreValue(b) - cardScoreValue(a))) {
        if (keepList.length >= 4) break;
        if (!keepList.some((k) => k.id === c.id)) keepList.push(c);
      }
    }

    // 中低分：生成「专属健康方案」（优先挑证据 A、收益大、成本低的漏选/核心建议）
    const planCandidates = missedCards
      .concat(allCards().filter((c) => spec.secs.includes(c.sec) && c.ev === 'A' && (c.money === '0' || c.money === 0)))
      .filter((c, idx, arr) => c && arr.findIndex((x) => x && x.id === c.id) === idx)
      .sort((a, b) => cardScoreValue(b) - cardScoreValue(a));
    const planList = planCandidates.slice(0, 5);

    return {
      trialId: spec.id,
      title: spec.title,
      shortTitle: spec.shortTitle,
      icon: spec.icon,
      score,
      tier: high ? 'high' : 'plan',
      badge: high ? '🌟 高分通关 · 保持清单' : '🩺 待加固 · 专属健康方案',
      headline: high
        ? `你在「${spec.shortTitle}」拿到 ${score} 分！高性价比习惯很稳，继续保持这份清单并分享给朋友吧。`
        : `你在「${spec.shortTitle}」拿到 ${score} 分。发现几处容易被忽视的高回报习惯，已为你定制低成本专属方案：`,
      keepList,
      planList,
      doneCount: doneCards.length,
    };
  }

  function stepTrial(trial, cardId, action) {
    if (!trial || trial.finished) {
      return { ok: false, code: 'TRIAL_FINISHED', trial };
    }
    const hand = (trial.hands && trial.hands[trial.round]) || [];
    const card = hand.find((c) => c.id === cardId) || hand[0];
    if (!card) {
      return { ok: false, code: 'NO_CARD', trial };
    }
    const act = action === 'skip' ? 'skip' : 'do';
    const rnd = seeded(hash(`${trial.id}#${trial.round}#${card.id}#${act}`));
    const res = computeResult(card, act, rnd);

    const bestInHand = hand.slice().sort((a, b) => cardScoreValue(b) - cardScoreValue(a))[0];
    let deltaScore = 0;
    if (act === 'do') {
      deltaScore = cardScoreValue(card); // +5 ~ +15
    } else {
      // 跳过时如果手里有高证据低成本卡，稍微扣分；否则给小幅休整分
      deltaScore = (bestInHand && bestInHand.ev === 'A' && (bestInHand.money === '0' || bestInHand.money === 0)) ? -3 : 3;
    }

    const next = Object.assign({}, trial, {
      round: trial.round + 1,
      score: clamp(Math.round(trial.score + deltaScore), 0, 100),
      history: trial.history.concat([
        {
          round: trial.round + 1,
          card,
          action: act,
          deltas: res.deltas,
          deltaScore,
          hand,
        },
      ]),
    });

    if (next.round >= next.total) {
      next.finished = true;
      next.outcome = evaluateTrial(next);
    }

    return {
      ok: true,
      trial: next,
      step: next.history[next.history.length - 1],
      outcome: next.outcome,
    };
  }

  return {
    VERSION,
    TOTAL_TURNS,
    START,
    CHANNELS: CHANNEL_LABEL,
    TRIALS,
    TRIAL_ROUNDS,
    allCards,
    cardById,
    channelOf,
    todayKey,
    create,
    normalize,
    needsDay,
    cardsFor,
    choose,
    endingOf,
    insight,
    petLine,
    snapshot,
    resourceMood,
    duoOwnerOf,
    duoInfo,
    packHand,
    parseHand,
    decisionCode,
    parseDecision,
    startTrial,
    stepTrial,
    evaluateTrial,
  };
});
