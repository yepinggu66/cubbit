/**
 * 宠物相亲（伴侣匹配）纯逻辑。
 *
 * 为什么单独一层：这件事的难点不是界面，是"两头都要点头"。
 * 所以状态机必须显式，且每一步都能被测试：
 *
 *   single ──写需求──> seeking ──挑一只──> proposed ──对方回应──> replying
 *        ──对方同意 + 你确认──> dating ──分开──> single
 *
 * 约定：
 *  - 候选池离线可生成（同一 seed 结果稳定），联网时由主进程换成真实用户宠物，
 *    本模块只负责打分与回应，不关心候选从哪来。
 *  - 不打"完美匹配"：分数上限 97，且一定同时给出「不合的地方」，
 *    这是产品态度——相亲不是抽奖。
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (typeof window !== 'undefined') window.CUBBIT_MATE = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;

  const TRAITS = [
    { id: 'warmth', label: '黏人度', low: '各过各的', high: '一秒不见就想' },
    { id: 'pace', label: '节奏', low: '慢慢来', high: '风风火火' },
    { id: 'thrift', label: '过日子', low: '该花花', high: '能省就省' },
    { id: 'order', label: '计划性', low: '走到哪算哪', high: '凡事有安排' },
    { id: 'curiosity', label: '好奇心', low: '老样子最好', high: '什么都想试试' },
  ];

  const SPECIES = [
    { id: 'cat', label: '小奶猫', emoji: '🐱', art: 'kitten' },
    { id: 'bunny', label: '奶油兔', emoji: '🐰', art: 'bunny' },
    { id: 'bear', label: '焦糖熊', emoji: '🐻', art: 'bear' },
    { id: 'fox', label: '小狐狸', emoji: '🦊', art: 'fox' },
    { id: 'panda', label: '团子熊猫', emoji: '🐼', art: 'panda' },
    { id: 'frog', label: '薄荷蛙', emoji: '🐸', art: 'frog' },
    { id: 'penguin', label: '小企鹅', emoji: '🐧', art: 'penguin' },
    { id: 'dog', label: '小柴犬', emoji: '🐕', art: 'dog' },
    { id: 'sheep', label: '棉花羊', emoji: '🐑', art: 'sheep' },
    { id: 'dino', label: '小恐龙', emoji: '🦕', art: 'dino' },
    { id: 'duck', label: '小黄鸭', emoji: '🐤', art: 'duck' },
    { id: 'cube', label: '方块仔', emoji: '🧊', art: 'cube' },
  ];

  const NAMES = [
    '阿柚', '小满', '七喜', '花生', '汤圆', '毛豆', '芝麻', '布丁', '年糕', '柚子',
    '阿栗', '奶昔', '桂花', '小暑', '栗子', '豆沙', '青柠', '米粒', '冬瓜', '麦芽',
    '小盐', '阿茶', '桃酥', '春卷',
  ];

  const BIOS = [
    '不太会聊，但你说话的时候我都在听。',
    '一天一步的账本我走了 {steps} 步，没断过。',
    '喜欢在窗边待着，看楼下的人来人往。',
    '我不催人，但会一直在。',
    '会做饭，做得一般，但很愿意做。',
    '手机常年静音，找我要直接叫名字。',
    '怕吵，但不怕安静。',
    '存款不多，但从来没欠过钱。',
    '喜欢把话说清楚，不喜欢猜。',
    '睡觉很早，起得也早，可以叫你。',
  ];

  const WANTS = [
    '想找个能一起吃饭的人', '希望你别总在半夜找我', '想有人提醒我喝水',
    '希望我们不用每天说话也不尴尬', '想找个愿意听我讲废话的', '希望你也怕吵',
    '想找一个会算账的', '希望你别嫌我慢',
  ];

  const KEYWORDS = [
    { tag: 'clingy', words: ['黏', '陪', '在一起', '说话', '聊天', '不要走', '热闹'], traits: { warmth: 22, pace: -4 } },
    { tag: 'solo', words: ['安静', '独立', '不粘', '空间', '各过各', '清静'], traits: { warmth: -20, order: 6 } },
    { tag: 'thrifty', words: ['省', '务实', '过日子', '攒钱', '存钱', '划算', '便宜'], traits: { thrift: 22 } },
    { tag: 'planner', words: ['计划', '安排', '稳定', '上进', '规律', '靠谱', '按时'], traits: { order: 22, pace: -8 } },
    { tag: 'healthy', words: ['健康', '早睡', '运动', '跑步', '作息', '体检', '养生'], traits: { order: 14, pace: -6 } },
    { tag: 'funny', words: ['有趣', '好玩', '幽默', '开心', '笑', '逗'], traits: { curiosity: 16, warmth: 8 } },
    { tag: 'thinker', words: ['读书', '学习', '深度', '聊得来', '想法', '思考'], traits: { curiosity: 20, pace: -6 } },
    { tag: 'domestic', words: ['做饭', '家务', '厨房', '收拾', '照顾'], traits: { warmth: 12, thrift: 8, order: 10 } },
    { tag: 'traveler', words: ['旅行', '出去', '外面', '自驾', '露营', '走一走'], traits: { curiosity: 22, thrift: -14, pace: 10 } },
    { tag: 'slow', words: ['慢', '不着急', '慢慢', '松弛', '随缘'], traits: { pace: -20 } },
  ];

  const PACT_POOL = [
    { id: 'ledger7', label: '先一起走满 7 天账本，再谈以后' },
    { id: 'night3', label: '连续三天，睡前说一句晚安' },
    { id: 'walk', label: '带我去窗边晒一次太阳，就现在' },
    { id: 'ask', label: '先回答我一个问题：你最怕变成什么样的人' },
    { id: 'quiet', label: '先试试一整天不说话，谁也不难受' },
  ];

  const PHRASES = {
    single: ['我还是一个人。', '你写字的时候，我在想会不会有人也这样。', '不急，慢慢遇。'],
    proposed: ['我发出去了，等回信。', '有点紧张，你说会有人回吗。', '我在等一个答复。'],
    dating: ['今天也有人在等我。', '它说我走路的样子很好看。', '两个人的桌面，比一个人的暖一点。', '我把今天的事留着，等它问。'],
    broken: ['回来了，就我们俩。', '不合适的，早点知道也好。', '我还好，你别担心。'],
  };

  // ------------------------------------------------------------------ 工具

  function hash(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function rng(seed) {
    let a = hash(seed) || 1;
    return function next() {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function blankDesire() {
    return {
      text: '',
      expect: { warmth: 50, pace: 50, thrift: 50, order: 50, curiosity: 50 },
      weights: { warmth: 1, pace: 0.8, thrift: 0.7, order: 0.6, curiosity: 0.5 },
      tags: [],
    };
  }

  /**
   * 把"要什么样的"翻译成五个可算的维度。
   * 滑杆定基调，文字里的关键词做加权：写了"安静"的人，是真的在意安静。
   */
  function parseDesire(input) {
    const src = input && typeof input === 'object' ? input : {};
    const base = blankDesire();
    const text = String(src.text || '').slice(0, 300);
    const expect = Object.assign({}, base.expect);
    const weights = Object.assign({}, base.weights);
    const tags = [];

    for (const t of TRAITS) {
      const v = Number(src[t.id]);
      if (Number.isFinite(v)) expect[t.id] = clamp(Math.round(v), 0, 100);
    }

    const hits = KEYWORDS.filter((k) => k.words.some((w) => text.includes(w)));
    for (const hit of hits) {
      tags.push(hit.tag);
      for (const [k, d] of Object.entries(hit.traits)) {
        expect[k] = clamp(expect[k] + d, 0, 100);
      }
      // 提到的维度权重翻倍：这是用户主动说出口的，比滑杆更算数
      for (const k of Object.keys(hit.traits)) weights[k] = Math.min(2.2, weights[k] + 0.55);
    }

    return { text, expect, weights, tags };
  }

  function personaTraits(rand) {
    const t = {};
    for (const tr of TRAITS) t[tr.id] = 18 + Math.round(rand() * 76);
    return t;
  }

  function bioOf(cand, rand) {
    const tpl = BIOS[Math.floor(rand() * BIOS.length)];
    return tpl.replace('{steps}', String(3 + Math.floor(rand() * 30)));
  }

  /** 离线候选池：稳定、可复现，联网时由主进程替换成真实宠物。 */
  function makeCandidates(input) {
    const src = input && typeof input === 'object' ? input : {};
    const count = clamp(Number(src.count) || 3, 1, 6);
    const seed = String(src.seed || 'cubbit');
    const used = new Set(src.exclude || []);
    const usedNames = new Set();
    const out = [];
    for (let i = 0; i < count * 3 && out.length < count; i++) {
      const rand = rng(`${seed}#${i}`);
      const name = NAMES[Math.floor(rand() * NAMES.length)];
      const species = SPECIES[Math.floor(rand() * SPECIES.length)];
      const id = `m-${hash(`${seed}#${i}#${name}`).toString(16).slice(0, 8)}`;
      // 一次相到两只同名的很出戏（"豆沙"对"豆沙"），宁可跳过重抽
      if (used.has(id) || usedNames.has(name) || out.some((c) => c.id === id)) continue;
      usedNames.add(name);
      out.push({
        id,
        name,
        species: species.id,
        speciesLabel: species.label,
        emoji: species.emoji,
        art: species.art,
        traits: personaTraits(rand),
        bio: bioOf(null, rand),
        wants: [WANTS[Math.floor(rand() * WANTS.length)]],
        steps: 2 + Math.floor(rand() * 26),
        remote: false,
      });
    }
    return out;
  }

  function fitOf(a, b) {
    return clamp(1 - Math.abs(a - b) / 100, 0, 1);
  }

  /**
   * 契合度：五个维度带权平均，映射到 30–97。
   * 永远返回 gaps——不合的地方比合的地方更该说清楚。
   */
  function score(cand, desire) {
    const d = desire && desire.expect ? desire : blankDesire();
    const traits = (cand && cand.traits) || {};
    let sum = 0;
    let wsum = 0;
    const fits = [];
    for (const t of TRAITS) {
      const w = Number(d.weights[t.id]) || 0.5;
      const cv = Number(traits[t.id]);
      if (!Number.isFinite(cv)) continue;
      const fit = fitOf(cv, d.expect[t.id]);
      sum += fit * w;
      wsum += w;
      fits.push({ id: t.id, label: t.label, fit, cand: cv, want: d.expect[t.id] });
    }
    const raw = wsum ? sum / wsum : 0.5;
    const pct = Math.round(clamp(30 + raw * 67, 30, 97));
    fits.sort((a, b) => b.fit - a.fit);

    const good = fits.filter((f) => f.fit >= 0.72).slice(0, 2);
    const bad = fits.filter((f) => f.fit < 0.6).slice(-2);
    const reasons = good.map((f) => ({ id: f.id, text: reasonText(f, 'good') }));
    const gaps = bad.map((f) => ({ id: f.id, text: reasonText(f, 'bad') }));
    return { score: pct, reasons, gaps, fits };
  }

  function reasonText(f, side) {
    const hi = f.cand >= 60;
    if (side === 'good') {
      return `你们在「${f.label}」上很像：${hi ? '都偏多' : '都偏少'}。`;
    }
    return `「${f.label}」差得有点多：它 ${
      hi ? '比较外放' : '比较收着'
    }，你想要的是另一头。`;
  }

  /** 对方的第一反应。分数越高越快答应；中段会提一个条件。 */
  function replyOf(cand, desire, opts = {}) {
    const s = score(cand, desire);
    const rand = rng(`${cand && cand.id}#${s.score}#${opts.attempt || 0}`);
    if (s.score >= 80) {
      return {
        decision: 'accept',
        line: `「${s.score} 分？那我没什么好想的。」${cand.name} 直接答应了。`,
        score: s.score,
        pact: null,
      };
    }
    if (s.score >= 62) {
      const pact = PACT_POOL[Math.floor(rand() * PACT_POOL.length)];
      return {
        decision: 'conditional',
        line: `「${s.score} 分，可以聊聊。不过先答应我一件事。」`,
        score: s.score,
        pact,
      };
    }
    if (s.score >= 46) {
      const soft = opts.attempt ? 8 : 0;
      if (s.score + soft >= 56) {
        const pact = PACT_POOL[Math.floor(rand() * PACT_POOL.length)];
        return {
          decision: 'conditional',
          line: '「你说得挺认真的，那就聊聊看。不过我有个小条件。」',
          score: s.score,
          pact,
        };
      }
      return {
        decision: 'hesitate',
        line: '「再看看好吗？我还没想清楚。」',
        score: s.score,
        pact: null,
      };
    }
    return {
      decision: 'decline',
      line: `「对不起呀，${s.score} 分……我觉得我们不太是一个节奏的。」`,
      score: s.score,
      pact: null,
    };
  }

  // ------------------------------------------------------------------ 状态机

  function blank() {
    return {
      version: VERSION,
      status: 'single', // single | seeking | proposed | dating
      desire: blankDesire(),
      candidates: [],
      picked: null,
      reply: null,
      relation: null,
      attempts: 0,
      history: [],
      updatedAt: 0,
    };
  }

  function normalize(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = blank();
    out.status = ['single', 'seeking', 'proposed', 'dating'].includes(src.status) ? src.status : 'single';
    out.desire = parseDesire(src.desire || src);
    out.candidates = Array.isArray(src.candidates) ? src.candidates.slice(0, 6) : [];
    out.picked = src.picked && typeof src.picked === 'object' ? src.picked : null;
    out.reply = src.reply && typeof src.reply === 'object' ? src.reply : null;
    out.relation = src.relation && typeof src.relation === 'object' ? src.relation : null;
    out.attempts = Math.max(0, Math.min(9, Number(src.attempts) || 0));
    out.history = Array.isArray(src.history) ? src.history.slice(-20) : [];
    out.updatedAt = Number(src.updatedAt) || 0;
    if (out.status === 'dating' && !out.relation) out.status = 'single';
    return out;
  }

  /** 写需求 → 出候选。candidates 由调用方注入（离线池或网络结果）。 */
  function seek(state, desireInput, candidates, now) {
    const s = normalize(state);
    s.desire = parseDesire(desireInput);
    s.candidates = (candidates || []).slice(0, 6);
    s.picked = null;
    s.reply = null;
    s.attempts = 0;
    s.status = 'seeking';
    s.updatedAt = now || Date.now();
    return s;
  }

  function propose(state, candidateId, now) {
    const s = normalize(state);
    const cand = s.candidates.find((c) => c.id === candidateId);
    if (!cand) return { ok: false, code: 'NO_CANDIDATE', message: '这只已经不在候选里了。', state: s };
    s.picked = cand;
    s.status = 'proposed';
    s.attempts = 0;
    s.reply = replyOf(cand, s.desire, { attempt: 0 });
    s.updatedAt = now || Date.now();
    s.history.push({ at: s.updatedAt, kind: 'propose', id: cand.id, name: cand.name });
    return { ok: true, state: s, reply: s.reply };
  }

  /** 被犹豫了可以再争取一次；被拒了就是被拒了。 */
  function retry(state, now) {
    const s = normalize(state);
    if (s.status !== 'proposed' || !s.picked) {
      return { ok: false, code: 'NOT_PROPOSED', message: '现在不是能再争取的时候。', state: s };
    }
    if (!s.reply || s.reply.decision !== 'hesitate') {
      return { ok: false, code: 'NO_RETRY', message: '对方已经给出答复了。', state: s };
    }
    if (s.attempts >= 1) {
      return { ok: false, code: 'TOO_MANY', message: '再问就烦人了，换一只吧。', state: s };
    }
    s.attempts += 1;
    s.reply = replyOf(s.picked, s.desire, { attempt: s.attempts });
    s.updatedAt = now || Date.now();
    s.history.push({ at: s.updatedAt, kind: 'retry', id: s.picked.id, decision: s.reply.decision });
    return { ok: true, state: s, reply: s.reply };
  }

  /**
   * 确立关系：必须对方点是（accept / conditional 且你答应了条件）+ 你确认。
   * 只靠一边点头不算——这是这个功能唯一值得写死的规则。
   */
  function confirm(state, opts = {}) {
    const s = normalize(state);
    if (s.status !== 'proposed' || !s.picked || !s.reply) {
      return { ok: false, code: 'NOT_READY', message: '还没有等到答复。', state: s };
    }
    const d = s.reply.decision;
    if (d === 'decline') return { ok: false, code: 'DECLINED', message: '对方没同意，换一只吧。', state: s };
    if (d === 'hesitate') return { ok: false, code: 'HESITATE', message: '对方还在犹豫，可以再争取一次。', state: s };
    if (d === 'conditional' && !opts.acceptPact) {
      return { ok: false, code: 'NEED_PACT', message: '对方提了一个条件，得先答应。', state: s };
    }
    const now = opts.now || Date.now();
    s.relation = {
      id: s.picked.id,
      name: s.picked.name,
      species: s.picked.species,
      speciesLabel: s.picked.speciesLabel,
      emoji: s.picked.emoji,
      art: s.picked.art,
      score: s.reply.score,
      pact: (s.reply.pact && opts.acceptPact && s.reply.pact.label) || '',
      startedAt: now,
      days: 0,
      lastSeenDay: '',
    };
    s.status = 'dating';
    s.updatedAt = now;
    s.history.push({ at: now, kind: 'dating', name: s.picked.name, score: s.relation.score });
    return { ok: true, state: s };
  }

  function breakup(state, now) {
    const s = normalize(state);
    if (s.status !== 'dating') return { ok: false, code: 'NOT_DATING', message: '现在还是单身。', state: s };
    s.status = 'single';
    s.relation = null;
    s.picked = null;
    s.reply = null;
    s.candidates = [];
    s.updatedAt = now || Date.now();
    s.history.push({ at: s.updatedAt, kind: 'breakup' });
    return { ok: true, state: s };
  }

  /** 恋爱天数：按自然日算，不是按次数算。 */
  function tickRelation(state, now) {
    const s = normalize(state);
    if (s.status !== 'dating' || !s.relation) return s;
    const day = new Date(now || Date.now()).toISOString().slice(0, 10);
    if (s.relation.lastSeenDay !== day) {
      const start = new Date(s.relation.startedAt || Date.now()).toISOString().slice(0, 10);
      const diff = Math.max(0, Math.round((new Date(day) - new Date(start)) / 86400000)) + 1;
      s.relation.days = diff;
      s.relation.lastSeenDay = day;
    }
    return s;
  }

  function lineOf(state, rand = Math.random) {
    const s = normalize(state);
    const pool = PHRASES[s.status === 'dating' ? 'dating' : s.status === 'proposed' ? 'proposed' : 'single'];
    const arr = s.status === 'single' && s.history.some((h) => h.kind === 'breakup') ? PHRASES.broken : pool;
    return arr[Math.floor(rand() * arr.length)];
  }

  function snapshot(state, now) {
    const s = tickRelation(state, now);
    return Object.assign({}, s, {
      fitSummary: s.picked ? score(s.picked, s.desire) : null,
      canRetry: !!(s.status === 'proposed' && s.reply && s.reply.decision === 'hesitate' && s.attempts < 1),
    });
  }

  return {
    VERSION,
    TRAITS,
    SPECIES,
    NAMES,
    PACT_POOL,
    PHRASES,
    blank,
    normalize,
    parseDesire,
    makeCandidates,
    score,
    replyOf,
    seek,
    propose,
    retry,
    confirm,
    breakup,
    tickRelation,
    lineOf,
    snapshot,
    hash,
    rng,
  };
});
