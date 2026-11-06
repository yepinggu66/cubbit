/**
 * 成长系统：经验、等级、亲密度、连续陪伴、投喂、成就。
 * 数据落盘 growth.json；升级/成就通过事件通知渲染层播放庆祝动画。
 */
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { app } = require('electron');
const { JsonFile } = require('./json-file');

const FEED_COOLDOWN_MS = 4 * 3600 * 1000;
/**
 * 免费档等级上限。
 * 「喂养」对所有用户开放（免费档唯一的日常回访钩子），但等级封顶 —— 等级与成就徽章
 * 仍是 Pro 权益，这样既给免费用户留了正反馈，又不稀释 Pro 的长期价值。
 * 封顶后继续喂养仍会累计经验与亲密度（升级时会补上），只是等级数字不再增长。
 */
const FREE_MAX_LEVEL = 3;
const EXP = {
  pet: 2,
  click: 1,
  feed: 12,
  focus_complete: 20,
  launch: 3,
  throw: 1,
};

const ACHIEVEMENTS = [
  { id: 'first_pet', name: '初次见面', desc: '第一次摸摸方块仔', icon: '👋' },
  { id: 'level3', name: '小伙伴', desc: '等级达到 3 级', icon: '🌱' },
  { id: 'level5', name: '形影不离', desc: '等级达到 5 级', icon: '💛' },
  { id: 'focus3', name: '专注新手', desc: '累计完成 3 次专注', icon: '🍅' },
  { id: 'focus25', name: '心流大师', desc: '累计完成 25 次专注', icon: '🧘' },
  { id: 'feed7', name: '投喂达人', desc: '累计投喂 7 次', icon: '🍬' },
  { id: 'nightowl', name: '夜猫子', desc: '凌晨 0 点后它还醒着', icon: '🌙' },
  { id: 'streak3', name: '三日不弃', desc: '连续 3 天来看它', icon: '🔥' },
  { id: 'collector', name: '皮肤收藏家', desc: '解锁 5 套皮肤', icon: '🎨' },
];

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 升到下一级所需经验：1→2 需要 50，之后每级 +30 */
function expToNext(level) {
  return 50 + (level - 1) * 30;
}

function levelFromExp(totalExp) {
  let level = 1;
  let rest = Math.max(0, totalExp);
  while (rest >= expToNext(level) && level < 99) {
    rest -= expToNext(level);
    level += 1;
  }
  return { level, expInLevel: rest, expToNext: expToNext(level) };
}

/** 升到 level 所需的累计经验（用于封顶后展示「当前等级内进度」） */
function expToReach(level) {
  let s = 0;
  for (let l = 1; l < level; l++) s += expToNext(l);
  return s;
}

class Growth extends EventEmitter {
  constructor(settingsStore) {
    super();
    this.settingsStore = settingsStore;
    // 等级展示上限：0 表示不封顶（完整版）；免费档投喂时置为 FREE_MAX_LEVEL。
    // 经验始终累计（升级时补上），但「展示等级」在封顶后不再增长。
    this.maxDisplayLevel = 0;
    this.file = new JsonFile(path.join(app.getPath('userData'), 'growth.json'), {
      exp: 0,
      affinity: 0,
      feeds: 0,
      lastFeedAt: 0,
      visits: 0,
      streak: 1,
      lastVisitDate: '',
      achievements: [],
    });
    this.file.load();
    this._visit();
  }

  _visit() {
    const today = dateKey();
    const last = this.file.get('lastVisitDate');
    let streak = this.file.get('streak') || 1;
    if (last !== today) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      streak = last === dateKey(y) ? streak + 1 : 1;
      this.file.patch({ lastVisitDate: today, streak, visits: (this.file.get('visits') || 0) + 1 });
    }
    this._checkAchievements();
  }

  snapshot() {
    const exp = this.file.get('exp') || 0;
    const trueLvl = levelFromExp(exp);
    // 免费档等级封顶：展示等级不再增长，但底层经验继续累计（升级时补上）。
    const displayLevel = this.maxDisplayLevel > 0 ? Math.min(trueLvl.level, this.maxDisplayLevel) : trueLvl.level;
    const displayInfo =
      displayLevel === trueLvl.level
        ? trueLvl
        : {
            // 封顶后：进度条钳制在满格，避免 expInLevel > expToNext 溢出显示
            expInLevel: Math.min(Math.max(0, exp - expToReach(displayLevel)), expToNext(displayLevel)),
            expToNext: expToNext(displayLevel),
          };
    const lastFeedAt = this.file.get('lastFeedAt') || 0;
    const now = Date.now();
    return {
      level: displayLevel,
      exp,
      expInLevel: displayInfo.expInLevel,
      expToNext: displayInfo.expToNext,
      affinity: this.file.get('affinity') || 0,
      streak: this.file.get('streak') || 1,
      visits: this.file.get('visits') || 0,
      feeds: this.file.get('feeds') || 0,
      lastFeedAt,
      canFeed: now - lastFeedAt >= FEED_COOLDOWN_MS,
      nextFeedInMs: Math.max(0, FEED_COOLDOWN_MS - (now - lastFeedAt)),
      achievements: ACHIEVEMENTS.map((a) => ({
        ...a,
        unlocked: (this.file.get('achievements') || []).includes(a.id),
        unlockedAt: (this.file.get('unlockedAt') || {})[a.id] || 0,
      })),
      expRules: EXP,
      freeMaxLevel: FREE_MAX_LEVEL,
    };
  }

  /**
   * 增加经验。
   * @param {number} amount 经验值
   * @param {string} reason 原因
   * @param {number} [maxLevel] 等级上限（超过后不再提升等级，但经验仍累计，升级时补上）
   */
  _addExp(amount, reason, maxLevel = 0) {
    const before = levelFromExp(this.file.get('exp') || 0);
    const exp = (this.file.get('exp') || 0) + amount;
    this.file.patch({ exp, affinity: Math.min(100, (this.file.get('affinity') || 0) + Math.ceil(amount / 4)) });
    const after = levelFromExp(exp);
    // 达到等级上限时不再广播升级事件（等级不再增长）
    const capped = maxLevel > 0 && after.level >= maxLevel;
    if (after.level > before.level && !capped) {
      this.emit('levelup', { level: after.level, reason });
    }
    this._checkAchievements();
    return capped ? before.level : after.level;
  }

  pet() {
    this._addExp(EXP.pet, 'pet');
    return this.snapshot();
  }

  click() {
    this._addExp(EXP.click, 'click');
    return this.snapshot();
  }

  throwPet() {
    this._addExp(EXP.throw, 'throw');
    return this.snapshot();
  }

  /**
   * 投喂。所有用户可用；免费档等级封顶在 FREE_MAX_LEVEL。
   * @param {boolean} [canLevelUp] 是否允许等级继续增长（Pro 用户为 true）
   */
  feed(canLevelUp = true) {
    // 免费档（canLevelUp=false）等级封顶在 FREE_MAX_LEVEL；完整版不封顶。
    this.maxDisplayLevel = canLevelUp ? 0 : FREE_MAX_LEVEL;
    const lastFeedAt = this.file.get('lastFeedAt') || 0;
    if (Date.now() - lastFeedAt < FEED_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', growth: this.snapshot() };
    }
    this.file.patch({
      lastFeedAt: Date.now(),
      feeds: (this.file.get('feeds') || 0) + 1,
      affinity: Math.min(100, (this.file.get('affinity') || 0) + 6),
    });
    this._addExp(EXP.feed, 'feed', canLevelUp ? 0 : FREE_MAX_LEVEL);
    return { ok: true, growth: this.snapshot() };
  }

  focusCompleted(minutes) {
    this._addExp(EXP.focus_complete + Math.floor(minutes / 10) * 3, 'focus');
    return this.snapshot();
  }

  _checkAchievements() {
    const unlocked = new Set(this.file.get('achievements') || []);
    const newly = [];
    const snap = {
      exp: this.file.get('exp') || 0,
      feeds: this.file.get('feeds') || 0,
      streak: this.file.get('streak') || 1,
    };
    const level = levelFromExp(snap.exp).level;
    const focusSessions = this.totalFocusSessions();
    const skins = 1 + (this.settingsStore ? 0 : 0); // 由调用方在渲染层补充皮肤解锁数
    const cond = {
      first_pet: () => snap.exp > 0,
      level3: () => level >= 3,
      level5: () => level >= 5,
      focus3: () => focusSessions >= 3,
      focus25: () => focusSessions >= 25,
      feed7: () => snap.feeds >= 7,
      nightowl: () => new Date().getHours() < 5,
      streak3: () => snap.streak >= 3,
      collector: () => this._skinCount >= 5,
    };
    for (const a of ACHIEVEMENTS) {
      if (!unlocked.has(a.id) && cond[a.id] && cond[a.id]()) {
        unlocked.add(a.id);
        newly.push(a.id);
      }
    }
    if (newly.length) {
      const unlockedAt = { ...(this.file.get('unlockedAt') || {}) };
      for (const id of newly) unlockedAt[id] = Date.now();
      this.file.patch({ achievements: [...unlocked], unlockedAt });
      this.emit('achievement', newly.map((id) => ACHIEVEMENTS.find((a) => a.id === id)));
    }
  }

  totalFocusSessions() {
    try {
      const raw = require('node:fs').readFileSync(path.join(app.getPath('userData'), 'focus-stats.json'), 'utf8');
      return JSON.parse(raw).totalSessions || 0;
    } catch {
      return 0;
    }
  }

  setSkinCount(n) {
    this._skinCount = n;
    this._checkAchievements();
  }
}

module.exports = { Growth, ACHIEVEMENTS, levelFromExp, expToNext, FREE_MAX_LEVEL };
