'use strict';
/**
 * v2.2 留存：情侣每日打卡 + 一起浇水连续天数 + 在一起天数里程碑皮肤。
 * 纯逻辑 + 可选文件持久化；双方状态通过 farm.event {kind:'checkin'|'water', day} 同步。
 */
const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['checkin', 'water'];
/** 在一起天数里程碑 → 解锁皮肤（皮肤定义见 shared/catalog.js milestoneDays） */
const MILESTONES = [
  { days: 7, skin: 'sweet7', title: '甜蜜一周' },
  { days: 30, skin: 'moon30', title: '满月之约' },
  { days: 100, skin: 'blossom100', title: '百日花开' },
  { days: 365, skin: 'forever365', title: '一周年·永恒' },
];
const KEEP_DAYS = 400;

function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

class Retention {
  constructor({ file = null, now = () => new Date() } = {}) {
    this.file = file; this.now = now;
    this.state = { checkin: {}, water: {}, best: { checkin: 0, water: 0 }, unlocked: [] };
    if (file) try { Object.assign(this.state, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* 首次 */ }
  }
  _save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state)); } catch { /* ignore */ }
  }
  _prune(kind) {
    const keys = Object.keys(this.state[kind]).sort();
    while (keys.length > KEEP_DAYS) delete this.state[kind][keys.shift()];
  }
  /** who: 'me' | 'partner' */
  mark(kind, who, day = dayKey(this.now())) {
    if (!KINDS.includes(kind) || !DAY_RE.test(day) || !['me', 'partner'].includes(who)) return null;
    const rec = this.state[kind][day] || (this.state[kind][day] = { me: false, partner: false });
    const already = rec[who];
    rec[who] = true;
    const s = this.streak(kind);
    if (s > (this.state.best[kind] || 0)) this.state.best[kind] = s;
    this._prune(kind); this._save();
    return { day, already, both: rec.me && rec.partner, streak: s, best: this.state.best[kind] };
  }
  /** 双方都完成的连续天数；今天还没凑齐时从昨天往回算（不打断） */
  streak(kind, today = dayKey(this.now())) {
    const days = this.state[kind] || {};
    const both = (k) => days[k] && days[k].me && days[k].partner;
    let k = both(today) ? today : prevDay(today);
    let n = 0;
    while (both(k)) { n++; k = prevDay(k); }
    return n;
  }
  today(kind) { const r = this.state[kind][dayKey(this.now())] || {}; return { me: !!r.me, partner: !!r.partner }; }
  /** 根据在一起天数解锁里程碑皮肤，返回本次新解锁的 */
  checkMilestones(daysTogether) {
    const fresh = [];
    for (const m of MILESTONES) {
      if (daysTogether >= m.days && !this.state.unlocked.includes(m.skin)) { this.state.unlocked.push(m.skin); fresh.push(m); }
    }
    if (fresh.length) this._save();
    return fresh;
  }
  isUnlocked(skinId) { return this.state.unlocked.includes(skinId); }
  nextMilestone(daysTogether) { const m = MILESTONES.find((x) => x.days > daysTogether); return m ? { ...m, left: m.days - daysTogether } : null; }
  snapshot(daysTogether = 0) {
    return {
      checkin: { today: this.today('checkin'), streak: this.streak('checkin'), best: this.state.best.checkin || 0 },
      water: { today: this.today('water'), streak: this.streak('water'), best: this.state.best.water || 0 },
      unlocked: [...this.state.unlocked],
      next: this.nextMilestone(daysTogether),
    };
  }
}

module.exports = { Retention, MILESTONES, KINDS, dayKey, prevDay };
