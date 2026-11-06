/**
 * Cubbit 表情系统数据表（v2.1 · 单一事实来源）
 * 主进程通过 require 读取（catalog 会挂到 CATALOG.EXPRESSIONS），
 * 渲染层通过 <script> 直接加载（挂到 window.CUBBIT_EXPR）。
 *
 * 表情 = 眼形(eyes) × 嘴型(mouth) × 姿态(body) × 叠加符号(fx)
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (typeof window !== 'undefined') window.CUBBIT_EXPR = data;
})(this, function () {
  const PARTS = {
    eyes: ['wide', 'half', 'crescent', 'blink', 'closed', 'star', 'heart', 'swirl', 'tears', 'angry', 'squint', 'sleepy', 'look', 'sparkle', 'dead'],
    mouth: ['smile', 'pout', 'o', 'wave', 'grin', 'cat', 'wavy', 'laugh', 'tongue', 'teeth', 'flat', 'frown', 'kiss', 'nom'],
    body: ['lean', 'back', 'slump', 'puff', 'shrink', 'tilt'],
    fx: ['blush', 'sweat', 'anger', 'question', 'exclaim', 'music', 'zzz', 'tears', 'heart', 'sparkle', 'gloom'],
  };

  /** 命名表情：可读、可复用；duration 为默认持续毫秒 */
  const EXPRESSIONS = {
    neutral: { eyes: 'wide', mouth: 'smile', duration: 0 },
    happy: { eyes: 'crescent', mouth: 'smile', body: 'lean', fx: 'blush', duration: 1600 },
    joy: { eyes: 'crescent', mouth: 'laugh', body: 'puff', fx: 'sparkle', duration: 1800 },
    excited: { eyes: 'star', mouth: 'laugh', body: 'puff', fx: 'sparkle', duration: 2000 },
    proud: { eyes: 'crescent', mouth: 'grin', body: 'back', fx: 'sparkle', duration: 2000 },
    smug: { eyes: 'squint', mouth: 'cat', body: 'tilt', duration: 1600 },
    playful: { eyes: 'blink', mouth: 'tongue', body: 'tilt', duration: 1400 },
    wink: { eyes: 'blink', mouth: 'grin', body: 'lean', fx: 'sparkle', duration: 1200 },
    love: { eyes: 'heart', mouth: 'cat', body: 'lean', fx: 'heart', duration: 2200 },
    shy: { eyes: 'squint', mouth: 'wavy', body: 'shrink', fx: 'blush', duration: 1800 },
    kiss: { eyes: 'closed', mouth: 'kiss', body: 'lean', fx: 'heart', duration: 1600 },
    content: { eyes: 'closed', mouth: 'cat', body: 'lean', fx: 'blush', duration: 1600 },
    purr: { eyes: 'squint', mouth: 'cat', body: 'slump', fx: 'music', duration: 1800 },
    sing: { eyes: 'closed', mouth: 'o', body: 'tilt', fx: 'music', duration: 2200 },
    surprised: { eyes: 'wide', mouth: 'o', body: 'back', fx: 'exclaim', duration: 1000 },
    shocked: { eyes: 'dead', mouth: 'o', body: 'shrink', fx: 'exclaim', duration: 1200 },
    confused: { eyes: 'look', mouth: 'wavy', body: 'tilt', fx: 'question', duration: 1800 },
    curious: { eyes: 'sparkle', mouth: 'o', body: 'lean', fx: 'question', duration: 1600 },
    thinking: { eyes: 'look', mouth: 'flat', body: 'tilt', fx: 'question', duration: 2000 },
    nervous: { eyes: 'wide', mouth: 'wavy', body: 'shrink', fx: 'sweat', duration: 1600 },
    awkward: { eyes: 'squint', mouth: 'teeth', body: 'tilt', fx: 'sweat', duration: 1600 },
    annoyed: { eyes: 'angry', mouth: 'flat', body: 'back', fx: 'anger', duration: 1400 },
    angry: { eyes: 'angry', mouth: 'teeth', body: 'puff', fx: 'anger', duration: 1600 },
    pouty: { eyes: 'half', mouth: 'pout', body: 'puff', fx: 'anger', duration: 1600 },
    sad: { eyes: 'tears', mouth: 'frown', body: 'slump', fx: 'gloom', duration: 2000 },
    crying: { eyes: 'tears', mouth: 'wavy', body: 'shrink', fx: 'tears', duration: 2200 },
    lonely: { eyes: 'half', mouth: 'frown', body: 'slump', fx: 'gloom', duration: 2200 },
    sleepy: { eyes: 'sleepy', mouth: 'o', body: 'slump', fx: 'zzz', duration: 2200 },
    asleep: { eyes: 'closed', mouth: 'flat', body: 'slump', fx: 'zzz', duration: 0 },
    yawn: { eyes: 'closed', mouth: 'laugh', body: 'back', duration: 1400 },
    dizzy: { eyes: 'swirl', mouth: 'wavy', body: 'tilt', fx: 'sparkle', duration: 1800 },
    knocked: { eyes: 'dead', mouth: 'tongue', body: 'slump', duration: 1400 },
    hungry: { eyes: 'look', mouth: 'nom', body: 'lean', fx: 'sweat', duration: 1800 },
    yummy: { eyes: 'crescent', mouth: 'tongue', body: 'puff', fx: 'heart', duration: 1800 },
    focused: { eyes: 'half', mouth: 'flat', body: 'lean', duration: 0 },
    determined: { eyes: 'angry', mouth: 'grin', body: 'puff', fx: 'sparkle', duration: 1400 },
    bored: { eyes: 'half', mouth: 'flat', body: 'slump', duration: 2400 },
    tired: { eyes: 'sleepy', mouth: 'wavy', body: 'slump', fx: 'sweat', duration: 2200 },
    starstruck: { eyes: 'star', mouth: 'o', body: 'back', fx: 'sparkle', duration: 1800 },
    giggle: { eyes: 'crescent', mouth: 'teeth', body: 'tilt', fx: 'music', duration: 1400 },
  };

  /** 事件 → 候选表情（加权随机）；duration 覆盖默认值；line 为可选台词池 */
  const EVENT_EXPRESSIONS = {
    poke: [{ e: 'surprised', w: 4 }, { e: 'curious', w: 3 }, { e: 'wink', w: 2 }, { e: 'playful', w: 2 }, { e: 'giggle', w: 2 }],
    pokeSpam: [{ e: 'annoyed', w: 4 }, { e: 'pouty', w: 3 }, { e: 'angry', w: 2 }, { e: 'dizzy', w: 1 }],
    pet: [{ e: 'content', w: 4 }, { e: 'purr', w: 3 }, { e: 'love', w: 2 }, { e: 'shy', w: 2 }],
    petLong: [{ e: 'love', w: 3 }, { e: 'asleep', w: 1, d: 2400 }, { e: 'kiss', w: 2 }],
    drag: [{ e: 'nervous', w: 3 }, { e: 'surprised', w: 2 }, { e: 'excited', w: 2 }],
    throw: [{ e: 'dizzy', w: 4 }, { e: 'knocked', w: 2 }, { e: 'shocked', w: 2 }],
    land: [{ e: 'surprised', w: 2 }, { e: 'proud', w: 1 }, { e: 'awkward', w: 1 }],
    focusStart: [{ e: 'determined', w: 3 }, { e: 'focused', w: 2 }],
    focusDone: [{ e: 'excited', w: 3 }, { e: 'proud', w: 3 }, { e: 'joy', w: 2 }],
    idleLong: [{ e: 'bored', w: 3 }, { e: 'lonely', w: 2 }, { e: 'sing', w: 2 }, { e: 'yawn', w: 2 }],
    lateNight: [{ e: 'sleepy', w: 3 }, { e: 'tired', w: 2 }, { e: 'yawn', w: 2 }],
    wake: [{ e: 'yawn', w: 3 }, { e: 'confused', w: 2 }],
    feed: [{ e: 'yummy', w: 4 }, { e: 'joy', w: 2 }],
    levelup: [{ e: 'starstruck', w: 2 }, { e: 'excited', w: 3 }],
    locked: [{ e: 'pouty', w: 2 }, { e: 'awkward', w: 2 }],
    startle: [{ e: 'surprised', w: 3 }, { e: 'shocked', w: 1 }],
    coupleMessage: [{ e: 'love', w: 3 }, { e: 'shy', w: 2 }, { e: 'kiss', w: 1 }],
  };

  /** AI 回复 mood 标签 / 关键词 → 表情 */
  const CHAT_MOOD_EXPRESSIONS = {
    happy: 'happy', excited: 'excited', proud: 'proud', calm: 'content', love: 'love', shy: 'shy',
    sad: 'sad', lonely: 'lonely', worried: 'nervous', angry: 'annoyed', sleepy: 'sleepy',
    hungry: 'hungry', curious: 'curious', thinking: 'thinking', surprised: 'surprised', playful: 'playful',
  };
  const CHAT_KEYWORDS = [
    { re: /(哈哈|嘿嘿|好耶|太棒|开心|😂|😄)/, e: 'joy' },
    { re: /(爱你|喜欢你|想你|抱抱|亲亲|❤|💗)/, e: 'love' },
    { re: /(难过|伤心|哭|呜呜|😢)/, e: 'crying' },
    { re: /(生气|哼|讨厌)/, e: 'pouty' },
    { re: /(困|晚安|睡觉)/, e: 'sleepy' },
    { re: /(饿|吃|好吃)/, e: 'yummy' },
    { re: /(？|\?|为什么|怎么)/, e: 'thinking' },
    { re: /(加油|冲|一起努力)/, e: 'determined' },
    { re: /(害羞|不好意思)/, e: 'shy' },
  ];

  function pickEvent(eventName) {
    const list = EVENT_EXPRESSIONS[eventName];
    if (!list || !list.length) return null;
    const total = list.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of list) {
      r -= x.w;
      if (r <= 0) return { name: x.e, duration: x.d };
    }
    return { name: list[0].e, duration: list[0].d };
  }

  function forChat(mood, text) {
    if (mood && CHAT_MOOD_EXPRESSIONS[mood]) return CHAT_MOOD_EXPRESSIONS[mood];
    const t = String(text || '');
    for (const k of CHAT_KEYWORDS) if (k.re.test(t)) return k.e;
    return 'happy';
  }

  return { PARTS, EXPRESSIONS, EVENT_EXPRESSIONS, CHAT_MOOD_EXPRESSIONS, pickEvent, forChat };
});
