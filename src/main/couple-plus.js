/**
 * 情侣空间 Plus（v2.4）
 *  - 同步互动：戳一戳 / 比心 / 抱抱 / 亲亲 / 击掌 / 牵手 / 晚安 / 一起专注
 *  - 传话 & 语音留言（对方的方块仔会把话说出来）
 *  - 在一起天数、纪念日倒计时、共同任务、情侣成就、情侣配对皮肤
 *
 * 传输：复用现有情侣消息通道，用隐藏前缀 [[act]]<json> 发送（和 [[scene]] 一样不展示、不通知），
 * 所以只要情侣服务端（自建 license/social server）能收发消息就能用，无需改服务端。
 */
const ACT_PREFIX = '[[act]]';

const ACTIONS = {
  poke: { emoji: '👉', label: '戳一戳', points: 1 },
  heart: { emoji: '💗', label: '比心', points: 2 },
  hug: { emoji: '🤗', label: '抱抱', points: 3, together: true },
  kiss: { emoji: '😘', label: '亲亲', points: 3, minIntimacy: 4 },
  highfive: { emoji: '🙌', label: '击掌', points: 2, together: true },
  hands: { emoji: '🤝', label: '牵手', points: 3, together: true },
  goodnight: { emoji: '🌙', label: '晚安', points: 2 },
  focus: { emoji: '🍅', label: '一起专注', points: 3 },
  relay: { emoji: '💬', label: '传话', points: 2 },
  voice: { emoji: '🎙️', label: '语音留言', points: 3 },
  task: { emoji: '✅', label: '共同任务', points: 2 },
  skinpair: { emoji: '👕', label: '情侣装', points: 1 },
};

const SKIN_PAIRS = [
  { id: 'love', name: '丘比特 × 玫瑰', a: 'cupid', b: 'rose' },
  { id: 'fruit', name: '橙红 × 蜜橘', a: 'blaze', b: 'citrus' },
  { id: 'sky', name: '夜光 × 极光', a: 'nightowl', b: 'aurora' },
  { id: 'cute', name: '喵喵 × 跳跳兔', a: 'neko', b: 'bunny' },
  { id: 'fresh', name: '薄荷 × 樱花', a: 'mint', b: 'sakura' },
];

const SHARED_TASK_PRESETS = [
  { id: 'water', text: '一起喝水 8 杯', icon: '💧' },
  { id: 'focus', text: '一起专注 25 分钟', icon: '🍅' },
  { id: 'sleep', text: '一起 23:30 前睡觉', icon: '🌙' },
  { id: 'walk', text: '一起走 6000 步', icon: '🚶' },
];

const ACHIEVEMENTS = [
  { id: 'first_poke', name: '第一次戳戳', icon: '👉', desc: '第一次戳了 TA 的方块仔', test: (s) => s.stats.poke >= 1 },
  { id: 'hearts_10', name: '比心达人', icon: '💗', desc: '累计比心 10 次', test: (s) => s.stats.heart >= 10 },
  { id: 'first_hug', name: '抱抱成就', icon: '🤗', desc: '第一次抱抱', test: (s) => s.stats.hug >= 1 },
  { id: 'highfive', name: '默契击掌', icon: '🙌', desc: '两人同时在线时击掌', test: (s) => s.stats.togetherHighfive >= 1 },
  { id: 'hands', name: '牵手散步', icon: '🤝', desc: '两人同时在线时牵手', test: (s) => s.stats.togetherHands >= 1 },
  { id: 'relay', name: '传声筒', icon: '💬', desc: '让 TA 的方块仔替你说一句话', test: (s) => s.stats.relay + s.stats.voice >= 1 },
  { id: 'focus_3', name: '学习搭子', icon: '🍅', desc: '一起专注 3 次', test: (s) => s.stats.focus >= 3 },
  { id: 'goodnight_7', name: '晚安打卡', icon: '🌙', desc: '互道晚安 7 次', test: (s) => s.stats.goodnight >= 7 },
  { id: 'shared_task', name: '同频', icon: '✅', desc: '同一天一起完成共同任务', test: (s) => s.stats.sharedBoth >= 1 },
  { id: 'days_7', name: '一周纪念', icon: '🎈', desc: '在一起 7 天', test: (s) => s.days >= 7 },
  { id: 'days_100', name: '百日纪念', icon: '💯', desc: '在一起 100 天', test: (s) => s.days >= 100 },
  { id: 'days_365', name: '一周年', icon: '💍', desc: '在一起 365 天', test: (s) => s.days >= 365 },
];

const STAT_KEYS = ['poke', 'heart', 'hug', 'kiss', 'highfive', 'hands', 'goodnight', 'focus', 'relay', 'voice', 'task', 'skinpair', 'togetherHighfive', 'togetherHands', 'togetherHug', 'sharedBoth', 'received'];

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function defaultPlus() {
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = 0;
  return { anniversary: '', since: '', sharedTasks: [], stats, achievements: {}, autoJoinFocus: true, pairSkin: '' };
}

function normalizePlus(raw) {
  const base = defaultPlus();
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...base, ...src };
  out.stats = { ...base.stats, ...(src.stats || {}) };
  for (const k of STAT_KEYS) out.stats[k] = Math.max(0, Number(out.stats[k]) || 0);
  out.achievements = src.achievements && typeof src.achievements === 'object' ? { ...src.achievements } : {};
  out.sharedTasks = (Array.isArray(src.sharedTasks) ? src.sharedTasks : []).slice(0, 12).map((t) => ({
    id: String(t.id || '').slice(0, 24) || Math.random().toString(36).slice(2, 8),
    text: String(t.text || '').slice(0, 40),
    icon: String(t.icon || '✅').slice(0, 4),
    myDoneOn: String(t.myDoneOn || '').slice(0, 10),
    partnerDoneOn: String(t.partnerDoneOn || '').slice(0, 10),
    bothOn: String(t.bothOn || '').slice(0, 10),
  })).filter((t) => t.text);
  out.anniversary = /^\d{4}-\d{2}-\d{2}$/.test(String(src.anniversary || '')) ? src.anniversary : '';
  out.since = /^\d{4}-\d{2}-\d{2}$/.test(String(src.since || '')) ? src.since : '';
  out.autoJoinFocus = src.autoJoinFocus !== false;
  out.pairSkin = SKIN_PAIRS.some((p) => p.id === src.pairSkin) ? src.pairSkin : '';
  return out;
}

/** 在一起天数：优先手动设置的「在一起日期」，否则服务端 anniversaryDays */
function daysTogether(plus, couple, now = new Date()) {
  if (plus.since) {
    const start = new Date(plus.since + 'T00:00:00');
    const today = new Date(localDay(now) + 'T00:00:00');
    return Math.max(1, Math.round((today - start) / 86400000) + 1);
  }
  return Math.max(0, Number(couple && couple.anniversaryDays) || 0);
}

/** 纪念日倒计时：按每年同月同日计算下一次 */
function anniversaryCountdown(dateStr, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date(localDay(now) + 'T00:00:00');
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const daysLeft = Math.round((next - today) / 86400000);
  return { next: localDay(next), daysLeft, years: next.getFullYear() - y, isToday: daysLeft === 0 };
}

function evaluateAchievements(plus, days, now = Date.now()) {
  const unlocked = [];
  const ctx = { stats: plus.stats, days };
  for (const a of ACHIEVEMENTS) {
    if (!plus.achievements[a.id] && a.test(ctx)) {
      plus.achievements[a.id] = now;
      unlocked.push(a);
    }
  }
  return unlocked;
}

function encodeAct(act) {
  const clean = { t: String(act.t || '') };
  if (act.text) clean.text = String(act.text).slice(0, 120);
  if (act.minutes) clean.minutes = Math.max(5, Math.min(120, Number(act.minutes) || 25));
  if (act.id) clean.id = String(act.id).slice(0, 24);
  if (act.skin) clean.skin = String(act.skin).slice(0, 24);
  if (act.online !== undefined) clean.online = !!act.online;
  return ACT_PREFIX + JSON.stringify(clean);
}

function decodeAct(text) {
  const raw = String(text || '');
  if (!raw.startsWith(ACT_PREFIX)) return null;
  try {
    const obj = JSON.parse(raw.slice(ACT_PREFIX.length));
    if (!obj || !ACTIONS[obj.t]) return null;
    return obj;
  } catch {
    return null;
  }
}

function isHiddenMessage(text) {
  const raw = String(text || '');
  return raw.startsWith(ACT_PREFIX) || raw.startsWith('[[scene]]');
}

class CouplePlus {
  /**
   * @param {object} rt AppRuntime（需要 settings / social / sendPetEvent / focus / applySettings / commit / speech）
   */
  constructor(rt) {
    this.rt = rt;
    this._lastPokeAt = 0;
  }

  get plus() {
    return normalizePlus(this.rt.settings.get('couplePlus'));
  }

  _save(plus) {
    this.rt.settings.patch({ couplePlus: plus });
  }

  couple() {
    try {
      return this.rt._devCouple ? this.rt._devCouple() : this.rt.social.snapshot();
    } catch {
      return { enabled: false };
    }
  }

  paired() {
    const c = this.couple();
    return !!(c && c.enabled && c.partner);
  }

  partnerOnline() {
    const c = this.couple();
    return !!(c && c.partner && c.partner.online);
  }

  snapshot(now = new Date()) {
    const plus = this.plus;
    const c = this.couple();
    const days = daysTogether(plus, c, now);
    const today = localDay(now);
    return {
      paired: this.paired(),
      partnerName: (c && c.partner && c.partner.name) || 'TA',
      partnerOnline: this.partnerOnline(),
      days,
      anniversary: plus.anniversary,
      since: plus.since,
      countdown: anniversaryCountdown(plus.anniversary, now),
      sharedTasks: plus.sharedTasks.map((t) => ({ ...t, mine: t.myDoneOn === today, partner: t.partnerDoneOn === today, both: t.bothOn === today })),
      presets: SHARED_TASK_PRESETS,
      stats: plus.stats,
      achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, icon: a.icon, desc: a.desc, unlockedAt: plus.achievements[a.id] || 0 })),
      actions: Object.entries(ACTIONS).map(([id, a]) => ({ id, ...a })),
      skinPairs: SKIN_PAIRS,
      pairSkin: plus.pairSkin,
      autoJoinFocus: plus.autoJoinFocus,
    };
  }

  _bump(plus, key, n = 1) {
    plus.stats[key] = (Number(plus.stats[key]) || 0) + n;
  }

  _afterChange(plus) {
    const days = daysTogether(plus, this.couple());
    const unlocked = evaluateAchievements(plus, days);
    this._save(plus);
    for (const a of unlocked) this.rt.sendPetEvent('say', { text: `解锁情侣成就「${a.name}」！`, emoji: a.icon, priority: true });
    if (this.rt.intimacy) this.rt.intimacy.add(1, 'couple');
    this.rt.commit();
    return unlocked;
  }

  async _transmit(act) {
    const c = this.couple();
    if (this.rt._devCoupleDemo || !this.rt.social || !c.enabled) {
      // 本地演示：模拟对方回应（便于没有服务端时也能看到效果）
      return { ok: true, demo: true };
    }
    try {
      const res = await this.rt.social.send(encodeAct(act), 'chat');
      return res && res.ok ? { ok: true } : { ok: false, message: (res && res.message) || '发送失败' };
    } catch (err) {
      return { ok: false, message: err && err.message };
    }
  }

  /** 我方发起一个动作 */
  async act(t, data = {}) {
    const def = ACTIONS[t];
    if (!def) return { ok: false, code: 'BAD_ACTION', message: '不支持的动作' };
    if (!this.paired()) return { ok: false, code: 'NOT_PAIRED', message: '先在情侣模式里和 TA 配对呀' };
    if (def.minIntimacy && this.rt.intimacy && this.rt.intimacy.level() < def.minIntimacy) {
      return { ok: false, code: 'LOCKED', message: `亲密度达到 Lv.${def.minIntimacy} 才能解锁「${def.label}」` };
    }
    const act = { t, ...data };
    if (t === 'relay' || t === 'voice') {
      act.text = String(data.text || '').trim().slice(0, 120);
      if (!act.text) return { ok: false, code: 'EMPTY', message: '说点什么吧' };
    }
    const online = this.partnerOnline();
    act.online = online;
    const sent = await this._transmit(act);
    if (!sent.ok) return { ok: false, code: 'SEND_FAILED', message: sent.message || '发送失败（情侣服务器不可达）' };
    const plus = this.plus;
    this._bump(plus, t);
    if (def.together && online) this._bump(plus, 'together' + t[0].toUpperCase() + t.slice(1));
    if (t === 'focus') this._startFocus(data.minutes || 25, false);
    this.rt.sendPetEvent('couple-act', { dir: 'out', t, text: act.text || '', together: !!(def.together && online), emoji: def.emoji, label: def.label, demo: !!sent.demo, name: this.couple().partner?.name || 'TA' });
    const unlocked = this._afterChange(plus);
    return { ok: true, demo: !!sent.demo, unlocked: unlocked.map((a) => a.id), space: this.snapshot() };
  }

  _startFocus(minutes, fromPartner) {
    try {
      if (this.rt.focus && !this.rt.focus.state.running) {
        this.rt.focus.start({ minutes: Math.max(5, Math.min(120, Number(minutes) || 25)), label: fromPartner ? '和 TA 一起专注' : '一起专注' });
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * 处理收到的消息：把 [[act]] 动作转成桌宠事件，返回剩余需要正常展示的消息。
   */
  handleIncoming(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const visible = [];
    let plus = null;
    const name = this.couple().partner?.name || 'TA';
    for (const m of list) {
      const act = decodeAct(m && m.text);
      if (!act) {
        visible.push(m);
        continue;
      }
      if (m.from && m.from !== 'partner') continue;
      plus = plus || this.plus;
      this._bump(plus, 'received');
      const def = ACTIONS[act.t];
      if (act.t === 'focus' && plus.autoJoinFocus) this._startFocus(act.minutes || 25, true);
      if (act.t === 'task' && act.id) {
        const today = localDay();
        const task = plus.sharedTasks.find((x) => x.id === act.id);
        if (task) {
          task.partnerDoneOn = today;
          if (task.myDoneOn === today && task.bothOn !== today) {
            task.bothOn = today;
            this._bump(plus, 'sharedBoth');
          }
        } else if (act.text) {
          plus.sharedTasks.push({ id: act.id, text: act.text, icon: '✅', myDoneOn: '', partnerDoneOn: today, bothOn: '' });
        }
      }
      if (act.t === 'skinpair' && act.skin) {
        try {
          this.rt.applySettings({ skinId: act.skin });
        } catch {
          /* ignore */
        }
      }
      const together = !!(def.together && act.online);
      if (together) this._bump(plus, 'together' + act.t[0].toUpperCase() + act.t.slice(1));
      this.rt.sendPetEvent('couple-act', { dir: 'in', t: act.t, text: act.text || '', minutes: act.minutes || 0, together, emoji: def.emoji, label: def.label, name });
    }
    if (plus) this._afterChange(plus);
    return visible;
  }

  /** 戳自己的宠物时顺手戳一下 TA（10 秒节流） */
  autoPoke() {
    const now = Date.now();
    if (!this.paired() || now - this._lastPokeAt < 10000) return false;
    this._lastPokeAt = now;
    this.act('poke').catch(() => {});
    return true;
  }

  setConfig(patch = {}) {
    const plus = this.plus;
    if (patch.anniversary !== undefined) plus.anniversary = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.anniversary)) ? patch.anniversary : '';
    if (patch.since !== undefined) plus.since = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.since)) ? patch.since : '';
    if (patch.autoJoinFocus !== undefined) plus.autoJoinFocus = !!patch.autoJoinFocus;
    this._save(normalizePlus(plus));
    this.rt.commit();
    return { ok: true, space: this.snapshot() };
  }

  addSharedTask({ text, icon, id } = {}) {
    const plus = this.plus;
    const clean = String(text || '').trim().slice(0, 40);
    if (!clean) return { ok: false, message: '任务不能为空' };
    if (plus.sharedTasks.length >= 12) return { ok: false, message: '最多 12 个共同任务' };
    plus.sharedTasks.push({ id: id || 'st' + Date.now().toString(36), text: clean, icon: icon || '✅', myDoneOn: '', partnerDoneOn: '', bothOn: '' });
    this._save(plus);
    this.rt.commit();
    return { ok: true, space: this.snapshot() };
  }

  removeSharedTask(id) {
    const plus = this.plus;
    plus.sharedTasks = plus.sharedTasks.filter((t) => t.id !== id);
    this._save(plus);
    this.rt.commit();
    return { ok: true, space: this.snapshot() };
  }

  async doneSharedTask(id) {
    const plus = this.plus;
    const task = plus.sharedTasks.find((t) => t.id === id);
    if (!task) return { ok: false, message: '任务不存在' };
    const today = localDay();
    task.myDoneOn = today;
    let both = false;
    if (task.partnerDoneOn === today && task.bothOn !== today) {
      task.bothOn = today;
      this._bump(plus, 'sharedBoth');
      both = true;
    }
    this._bump(plus, 'task');
    this._save(plus);
    if (this.paired()) await this._transmit({ t: 'task', id: task.id, text: task.text });
    this.rt.sendPetEvent('couple-act', { dir: 'out', t: 'task', text: task.text, both, emoji: '✅', label: '共同任务' });
    this._afterChange(this.plus);
    return { ok: true, both, space: this.snapshot() };
  }

  async applySkinPair(pairId) {
    const pair = SKIN_PAIRS.find((p) => p.id === pairId);
    if (!pair) return { ok: false, message: '没有这套情侣装' };
    const res = this.rt.applySettings({ skinId: pair.a });
    if (res && res.ok === false) return res;
    const plus = this.plus;
    plus.pairSkin = pair.id;
    this._save(plus);
    if (this.paired()) await this._transmit({ t: 'skinpair', skin: pair.b });
    this._bump(plus, 'skinpair');
    this._afterChange(plus);
    this.rt.sendPetEvent('couple-act', { dir: 'out', t: 'skinpair', text: pair.name, emoji: '👕', label: '情侣装' });
    return { ok: true, space: this.snapshot() };
  }
}

module.exports = {
  CouplePlus,
  ACTIONS,
  ACHIEVEMENTS,
  SKIN_PAIRS,
  SHARED_TASK_PRESETS,
  ACT_PREFIX,
  encodeAct,
  decodeAct,
  isHiddenMessage,
  normalizePlus,
  daysTogether,
  anniversaryCountdown,
  evaluateAchievements,
  localDay,
};
