/**
 * 智慧生命系统（Life）
 *
 * 让方块仔不再只是「会眨眼的表情包」，而是有需求、有性格、有记忆、会主动找你的小生命：
 *  - 需求：精力 energy / 饱腹 hunger / 精神 spirit，随时间和主人状态缓慢变化
 *  - 性格：出生时按昵称+设备种子随机 3 个特质（黏人 / 好奇 / 爱睡觉 / 爱吃 …）
 *  - 心情：由需求 + 主人状态 + 情侣状态推导（happy/calm/sleepy/hungry/lonely/excited/worried/proud）
 *  - 记忆：相处天数、最近事件（投喂/专注完成/被摸/情侣消息…），上限 20 条
 *  - 主动：间隔随机冒出一句「心声」，事件驱动时也会说话（由主进程转成气泡 + 语音）
 *  - 情侣：TA 在线会更精神，长时间不在线会「想念」
 *
 * 数据落在 userData/life.json；深度能力（性格/记忆/主动说话）与 Pro 授权挂钩，
 * 免费用户仍能看到基础心情与需求（由 UI 决定是否遮挡）。
 */
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { app } = require('electron');
const { JsonFile } = require('./json-file');

const TRAIT_POOL = [
  { id: 'clingy', name: '黏人', desc: '喜欢待在你旁边' },
  { id: 'curious', name: '好奇', desc: '对屏幕上的东西感兴趣' },
  { id: 'sleepyhead', name: '爱睡觉', desc: '一闲下来就打盹' },
  { id: 'foodie', name: '爱吃', desc: '对投喂毫无抵抗力' },
  { id: 'shy', name: '有点害羞', desc: '被盯着看会移开视线' },
  { id: 'cuddly', name: '喜欢撒娇', desc: '被摸头就会眯眼睛' },
  { id: 'workaholic', name: '工作狂', desc: '你忙的时候它也不睡' },
  { id: 'nightowl', name: '夜猫子', desc: '深夜反而更精神' },
];

const MOODS = {
  calm: { label: '平静', icon: '🌿' },
  happy: { label: '开心', icon: '😊' },
  excited: { label: '兴奋', icon: '✨' },
  sleepy: { label: '困倦', icon: '😴' },
  hungry: { label: '饿了', icon: '🍊' },
  lonely: { label: '想你', icon: '💭' },
  worried: { label: '担心你', icon: '🥺' },
  proud: { label: '为你骄傲', icon: '🏅' },
};

const THOUGHT_POOL = {
  morning: ['早上好呀，我等你很久了', '今天的第一件事，是先喝口水', '窗外的光好像变暖了一点'],
  day: ['你忙你的，我就在这儿', '刚刚我数了 37 次呼吸', '要不要起来走两步？', '我好像听见你肚子叫了'],
  evening: ['今天也辛苦啦', '晚上想吃点什么？', '天色暗下来的时候，我眼睛会亮'],
  night: ['困了就睡吧，我帮你看着', '晚安，做个好梦', '夜里的桌面好安静'],
  coding: ['又在写代码呀，我给你盯着时间', '这个 bug 我们一起盯着它', '记得眨眼睛，不然会干'],
  video: ['专心看吧，我就在这儿', '看完记得活动一下脖子'],
  meeting: ['（安静地待在角落）', '开会辛苦了，我不打扰你'],
  away: ['你去哪儿了…我等你回来', '刚刚打了个盹，梦见你了'],
  hungry: ['肚子有点空空的…', '有没有小饼干？'],
  sleepy: ['眼睛快睁不开了…', '先睡一小会儿，就一小会儿'],
  lonely: ['好久没见到 TA 了…', 'TA 的方块仔还好吗？'],
  coupleOnline: ['TA 也在哦，我感觉得到', '要不要跟 TA 说句话？', '恋爱值又涨了一点点'],
  coupleMarried: ['我们已经结婚啦，纪念日要记得哦', '今天也是被爱着的一天'],
  feed: ['谢谢投喂！我会记住这个味道', '还想吃…'],
  focusDone: ['又完成一轮专注，你超棒', '休息一下吧，我陪你'],
  memory: ['我们已经一起度过 {days} 天啦', '我还记得你第一次摸我的时候'],
};

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

class LifeSystem extends EventEmitter {
  constructor(settingsStore, options = {}) {
    super();
    this.settings = settingsStore;
    this.entitledFn = options.entitled || (() => true);
    this.file = new JsonFile(path.join(app.getPath('userData'), 'life.json'), {
      bornAt: 0,
      traits: [],
      energy: 78,
      hunger: 65,
      spirit: 70,
      mood: 'calm',
      lastTickAt: 0,
      lastInteractionAt: 0,
      lastFeedAt: 0,
      lastThoughtAt: 0,
      lastGreetAt: 0,
      lastMoodAt: 0,
      partnerMissing: 0,
      events: [],
      daysSeen: {},
      focusDoneAt: 0,
      lastAwayAt: 0,
      lastReturnAt: 0,
    });
    this.file.load();
    this._initTraits();
    this._timer = null;
    this._thinking = false;
    this.presenceKind = 'working';
    this.couple = null;
  }

  _initTraits() {
    const existing = this.file.get('traits') || [];
    if (existing.length) return;
    const name = (this.settings && this.settings.get('coupleProfile')?.petName) || '方块仔';
    const deviceId = (this.settings && this.settings.get('deviceId')) || app.getPath('userData');
    const rng = seededRandom(hashSeed(`${name}|${deviceId}`));
    const pool = [...TRAIT_POOL];
    const picked = [];
    while (picked.length < 3 && pool.length) {
      picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    this.file.patch({ traits: picked, bornAt: this.file.get('bornAt') || Date.now() });
  }

  start() {
    this.file.patch({ daysSeen: { ...(this.file.get('daysSeen') || {}), [this._today()]: true } });
    this._tick();
    this._timer = setInterval(() => this._tick(), 30000);
    return this.snapshot();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  _daysTogether() {
    const born = this.file.get('bornAt') || Date.now();
    return Math.max(1, Math.floor((Date.now() - born) / 86400000) + 1);
  }

  _pushEvent(type, text) {
    const events = [{ at: Date.now(), type, text }, ...(this.file.get('events') || [])].slice(0, 20);
    this.file.patch({ events });
  }

  _tick() {
    const now = Date.now();
    const last = this.file.get('lastTickAt') || now;
    const elapsed = Math.min(600, Math.max(0, (now - last) / 1000));
    this.file.patch({ lastTickAt: now });

    const hour = new Date().getHours();
    let energy = this.file.get('energy');
    let hunger = this.file.get('hunger');
    let spirit = this.file.get('spirit');

    // 需求随时间缓慢变化
    energy = clamp(energy - elapsed * 0.02, 0, 100);
    hunger = clamp(hunger - elapsed * 0.03, 0, 100);
    spirit = clamp(spirit - elapsed * 0.008, 0, 100);

    if (hour >= 23 || hour < 6) energy = clamp(energy + elapsed * 0.03, 0, 100);
    if (this.presenceKind === 'away') energy = clamp(energy + elapsed * 0.06, 0, 100);
    if (this.presenceKind === 'coding') spirit = clamp(spirit + elapsed * 0.01, 0, 100);
    if (this.presenceKind === 'meeting') spirit = clamp(spirit - elapsed * 0.004, 0, 100);
    if (this.couple && this.couple.enabled) {
      if (this.couple.partner && this.couple.partner.online) {
        this.file.patch({ partnerMissing: clamp(this.file.get('partnerMissing') - elapsed * 0.2, 0, 100) });
      } else {
        this.file.patch({ partnerMissing: clamp(this.file.get('partnerMissing') + elapsed * 0.05, 0, 100) });
      }
    }

    this.file.patch({ energy, hunger, spirit });
    const mood = this._computeMood();
    if (mood !== this.file.get('mood')) {
      this.file.patch({ mood, lastMoodAt: now });
      this.emit('mood', { mood, label: MOODS[mood].label });
    }

    // 主动心声（深度能力，Pro；每分钟最多一次）
    const interval = 6 * 60 + Math.random() * 8 * 60;
    if (this.entitledFn() && now - (this.file.get('lastThoughtAt') || 0) > interval * 1000) {
      const text = this.think();
      if (text) {
        this.file.patch({ lastThoughtAt: now });
        this.emit('thought', { text });
      }
    }
    this.emit('changed', this.snapshot());
  }

  _computeMood() {
    const energy = this.file.get('energy');
    const hunger = this.file.get('hunger');
    const spirit = this.file.get('spirit');
    const missing = this.file.get('partnerMissing');
    const lastInteraction = this.file.get('lastInteractionAt') || 0;
    const focusDone = this.file.get('focusDoneAt') || 0;
    const now = Date.now();
    const hour = new Date().getHours();

    if (now - focusDone < 5 * 60 * 1000) return 'proud';
    if (energy < 24) return 'sleepy';
    if (hunger < 28) return 'hungry';
    if (missing > 72 && this.couple && this.couple.enabled) return 'lonely';
    if (spirit > 82 && now - lastInteraction < 10 * 60 * 1000) return 'excited';
    if (now - lastInteraction < 45 * 1000) return 'happy';
    if (spirit < 30) return 'worried';
    if (hour >= 23 || hour < 6) return 'sleepy';
    return 'calm';
  }

  _baseThoughts() {
    const hour = new Date().getHours();
    const slot = hour < 11 ? 'morning' : hour < 18 ? 'day' : 'evening';
    const out = [...(THOUGHT_POOL[slot] || []), ...(THOUGHT_POOL[this.presenceKind] || [])];
    const mood = this.file.get('mood');
    if (mood === 'hungry') out.push(...THOUGHT_POOL.hungry);
    if (mood === 'sleepy') out.push(...THOUGHT_POOL.sleepy);
    if (mood === 'lonely') out.push(...THOUGHT_POOL.lonely);
    if (this.couple && this.couple.enabled) {
      out.push(...(this.couple.married ? THOUGHT_POOL.coupleMarried : THOUGHT_POOL.coupleOnline));
    }
    if (this._daysTogether() >= 3) out.push(...THOUGHT_POOL.memory);
    return out;
  }

  /** 生成一句心声；返回 null 表示这次不说话 */
  think(force = false) {
    if (!force && Math.random() < 0.25) return null;
    const pool = this._baseThoughts();
    if (!pool.length) return null;
    const line = pool[Math.floor(Math.random() * pool.length)].replace('{days}', String(this._daysTogether()));
    const traits = this.file.get('traits') || [];
    // 性格影响语气（只在部分句子里加前缀）
    if (traits.some((t) => t.id === 'clingy') && Math.random() < 0.25) return `（蹭了蹭你）${line}`;
    if (traits.some((t) => t.id === 'shy') && Math.random() < 0.2) return `（小声）${line}`;
    return line;
  }

  onPresence(kind) {
    const prev = this.presenceKind;
    this.presenceKind = kind;
    if (kind === 'away' && prev !== 'away') {
      this.file.patch({ lastAwayAt: Date.now() });
    }
    if (kind !== 'away' && prev === 'away') {
      this.file.patch({ lastReturnAt: Date.now(), spirit: clamp(this.file.get('spirit') + 6, 0, 100) });
      const greet = this._greetOnReturn();
      if (greet) this.emit('thought', { text: greet, important: true });
    }
    this.emit('changed', this.snapshot());
  }

  _greetOnReturn() {
    const now = Date.now();
    if (now - (this.file.get('lastGreetAt') || 0) < 3 * 60 * 1000) return '';
    this.file.patch({ lastGreetAt: now });
    const pool = ['你回来啦！我刚刚在打盹', '欢迎回来，我一直在这儿', '（抬起头）你终于回来了', '刚刚还在想你什么时候回来'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  onInteraction(type) {
    const now = Date.now();
    this.file.patch({ lastInteractionAt: now });
    if (type === 'pet') {
      this.file.patch({ spirit: clamp(this.file.get('spirit') + 4, 0, 100), energy: clamp(this.file.get('energy') + 1, 0, 100) });
      this._pushEvent('pet', '被摸了头');
      this.emit('changed', this.snapshot());
    } else if (type === 'throw') {
      this.file.patch({ energy: clamp(this.file.get('energy') - 2, 0, 100), spirit: clamp(this.file.get('spirit') + 3, 0, 100) });
    } else if (type === 'click') {
      this.emit('changed', this.snapshot());
    }
  }

  feed() {
    const now = Date.now();
    this.file.patch({
      hunger: clamp(this.file.get('hunger') + 34, 0, 100),
      energy: clamp(this.file.get('energy') + 6, 0, 100),
      spirit: clamp(this.file.get('spirit') + 8, 0, 100),
      lastFeedAt: now,
      lastInteractionAt: now,
    });
    this._pushEvent('feed', '被你投喂了');
    this.emit('thought', { text: this.think(true) || THOUGHT_POOL.feed[0], important: true });
    this.emit('changed', this.snapshot());
    return this.snapshot();
  }

  focusCompleted(minutes) {
    this.file.patch({
      lastFocusDoneAt: Date.now(),
      focusDoneAt: Date.now(),
      spirit: clamp(this.file.get('spirit') + 10, 0, 100),
      lastInteractionAt: Date.now(),
    });
    this._pushEvent('focus', `陪你完成了 ${minutes} 分钟专注`);
    this.emit('thought', { text: THOUGHT_POOL.focusDone[Math.floor(Math.random() * THOUGHT_POOL.focusDone.length)], important: true });
    this.emit('changed', this.snapshot());
  }

  onCoupleMessage({ kind } = {}) {
    this.file.patch({
      spirit: clamp(this.file.get('spirit') + (kind === 'love' ? 8 : 5), 0, 100),
      lastInteractionAt: Date.now(),
    });
    this._pushEvent('couple', kind === 'love' ? '收到 TA 的情话' : '收到 TA 的消息');
    this.emit('changed', this.snapshot());
  }

  onCoupleMarried() {
    this.file.patch({ spirit: 100, energy: clamp(this.file.get('energy') + 10, 0, 100) });
    this._pushEvent('marry', '和 TA 的方块仔结婚了');
    this.emit('changed', this.snapshot());
  }

  setCouple(couple) {
    const prevEnabled = !!(this.couple && this.couple.enabled);
    this.couple = couple || null;
    if (couple && couple.enabled && !prevEnabled) this._pushEvent('pair', '和 TA 的方块仔配对了');
  }

  snapshot() {
    const mood = this.file.get('mood') || 'calm';
    const traits = this.file.get('traits') || [];
    const lastThought = this._lastThought || '';
    return {
      mood,
      moodLabel: (MOODS[mood] || MOODS.calm).label,
      moodIcon: (MOODS[mood] || MOODS.calm).icon,
      energy: Math.round(this.file.get('energy')),
      hunger: Math.round(this.file.get('hunger')),
      spirit: Math.round(this.file.get('spirit')),
      traits,
      daysTogether: this._daysTogether(),
      thoughts: lastThought ? [lastThought] : [],
      events: (this.file.get('events') || []).slice(0, 6),
      partnerMissing: Math.round(this.file.get('partnerMissing') || 0),
      focusDoneAt: this.file.get('focusDoneAt') || 0,
      locked: !this.entitledFn(),
    };
  }

  _tickThought(text) {
    this._lastThought = text;
  }
}

module.exports = { LifeSystem, MOODS, TRAIT_POOL, THOUGHT_POOL };
