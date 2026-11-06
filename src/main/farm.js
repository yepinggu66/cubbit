'use strict';
/**
 * 方块仔 2.5D 小农场 —— 纯逻辑（不依赖 electron，便于单测）。
 * 全部计时用真实时间戳：关掉程序再打开，作物/动物照样成熟（离线进度）。
 * 商业化红线：付费点只卖「时间（加速）」与「装饰/外观/扩地」，不卖金币、不卖产量。
 */
const fs = require('fs');
const { FarmCouple, DUO } = require('./farm-couple');
const path = require('path');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const CROPS = {
  turnip:  { emoji: '🥬', grow: 2 * MIN,  seed: 2,  sell: 5 },
  carrot:  { emoji: '🥕', grow: 5 * MIN,  seed: 5,  sell: 12 },
  tomato:  { emoji: '🍅', grow: 15 * MIN, seed: 10, sell: 28 },
  corn:    { emoji: '🌽', grow: 30 * MIN, seed: 18, sell: 50 },
  pumpkin: { emoji: '🎃', grow: 60 * MIN, seed: 30, sell: 90 },
  // 稀有种子（付费点）：产出与普通作物同价，只额外掉 1 片皮肤碎片 → 外观向，不影响金币平衡
  goldberry: { emoji: '🍓', grow: 20 * MIN, points: 20, sell: 28, rare: true, shard: 1 },
  starmelon: { emoji: '🍉', grow: 45 * MIN, points: 35, sell: 50, rare: true, shard: 2 },
};
const ANIMALS = {
  chicken: { emoji: '🐔', product: 'egg',     pEmoji: '🥚', cost: 40,  feed: 3,  cycle: 10 * MIN, sell: 12 },
  rabbit:  { emoji: '🐰', product: 'fur',     pEmoji: '🧶', cost: 80,  feed: 5,  cycle: 20 * MIN, sell: 26 },
  pig:     { emoji: '🐷', product: 'truffle', pEmoji: '🍄', cost: 150, feed: 8,  cycle: 40 * MIN, sell: 55 },
  cow:     { emoji: '🐮', product: 'milk',    pEmoji: '🥛', cost: 200, feed: 10, cycle: 30 * MIN, sell: 48 },
  sheep:   { emoji: '🐑', product: 'wool',    pEmoji: '🧵', cost: 180, feed: 9,  cycle: 45 * MIN, sell: 62 },
  // 稀有动物（付费点）：外观款，产出同母种，额外掉碎片
  goldhen: { emoji: '🐓', product: 'egg', pEmoji: '🥚', points: 60, feed: 3, cycle: 10 * MIN, sell: 12, rare: true, shard: 1 },
};
const SHOP = {
  growth_food: { emoji: '🍙', coins: 60, kind: 'food' },
  hat_straw:   { emoji: '👒', coins: 300, kind: 'accessory' },
  scarf_red:   { emoji: '🧣', coins: 220, kind: 'accessory' },
  shard:       { emoji: '🧩', coins: 400, kind: 'shard', dailyLimit: 2 },
  guard_dog:   { emoji: '🐕', coins: 500, kind: 'dog' },
};
const DECOR = {
  fence:     { emoji: '🪵', points: 15 },
  flowers:   { emoji: '🌷', points: 20 },
  scarecrow: { emoji: '🎎', points: 25 },
  windmill:  { emoji: '🌬️', points: 40 },
  pond:      { emoji: '⛲', points: 50 },
};
const SHARD_SKIN = 'farmer';
const SHARDS_NEEDED = 10;
const MAX_PLOTS = 16;
const START_PLOTS = 6;
const PREMIUM_PLOTS = 4; // 付费点扩地上限（纯便利）
const WORK = { idleMs: 5 * MIN, coinsPerMin: 2, dailyCap: 240, manualMs: 15 * MIN };
const STEAL = { perFriend: 2, perDay: 6, dogCatch: 0.35, fine: 8 };
const POINT_PACK = 300; // 每包付费点数（价格见 shared/pricing.js 的 farmpoints）
const MEMBER_MONTHLY_POINTS = 100;

const WILD = { kinds: ['wolf', 'jackal', 'tiger', 'leopard'], reward: 3, perDay: 5 };

const DEMO_FRIENDS = [
  { id: 'demo_mimi', name: '阿橘', emoji: '🐱', dog: false, skinId: 'neko' },
  { id: 'demo_leo',  name: '大力', emoji: '🐼', dog: true,  skinId: 'panda' },
  { id: 'demo_yuki', name: '雪团', emoji: '🐰', dog: false, skinId: 'bunny' },
];

function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function monthKey(t) { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}`; }
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function freshState(now) {
  const plots = [];
  for (let i = 0; i < MAX_PLOTS; i++) plots.push({ id: i, open: i < START_PLOTS, premium: false, crop: null, plantedAt: 0, watered: false });
  return {
    v: 1, createdAt: now, coins: 100, points: 0, pointsSandbox: 0,
    plots, animals: [], inv: {}, shards: 0, skinUnlocked: false,
    accessories: [], decor: [], dog: false, foodStock: 0,
    work: null, workLog: { day: '', coins: 0 }, lastReport: null,
    daily: { day: '', memberBonusUsed: false, stealTotal: 0, steals: {}, shardBuys: 0 },
    memberPointsMonth: '', stats: { harvested: 0, sold: 0, stolen: 0, caught: 0 },
  };
}

class Farm {
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.file = opts.dir ? path.join(opts.dir, 'cubbit-farm.json') : null;
    this.hooks = opts.hooks || {}; // { isMember, isDeveloper, growthFood, onWork, remoteSteal }
    this.random = opts.random || Math.random;
    this.state = this._load();
    this.couple = new FarmCouple(this);
  }

  _load() {
    let s = null;
    if (this.file) { try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { s = null; } }
    const base = freshState(this.now());
    if (!s || typeof s !== 'object') return base;
    const out = { ...base, ...s, daily: { ...base.daily, ...(s.daily || {}) }, stats: { ...base.stats, ...(s.stats || {}) } };
    if (!Array.isArray(out.plots) || out.plots.length !== MAX_PLOTS) out.plots = base.plots;
    return out;
  }
  save() {
    if (!this.file) return;
    try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state)); fs.renameSync(tmp, this.file); } catch (e) { /* ignore */ }
  }
  _ok(extra = {}) { this.save(); return { ok: true, ...extra, view: this.view() }; }
  _err(code, params = {}) { return { ok: false, code, params }; }
  _member() { try { return !!(this.hooks.isMember && this.hooks.isMember()); } catch { return false; } }
  _dev() { try { return !!(this.hooks.isDeveloper && this.hooks.isDeveloper()); } catch { return false; } }
  _daily() {
    const k = dayKey(this.now());
    if (this.state.daily.day !== k) this.state.daily = { day: k, memberBonusUsed: false, stealTotal: 0, steals: {}, shardBuys: 0, scares: 0 };
    return this.state.daily;
  }
  _grantMemberPoints() {
    const m = monthKey(this.now());
    if (this._member() && this.state.memberPointsMonth !== m) { this.state.memberPointsMonth = m; this.state.points += MEMBER_MONTHLY_POINTS; return true; }
    return false;
  }

  // ---------- 作物 ----------
  _growMs(p) { const c = CROPS[p.crop]; if (!c) return 0; return Math.round(c.grow * (p.watered ? 0.75 : 1)); }
  plotStatus(p, now = this.now()) {
    if (!p.open) return 'locked';
    if (!p.crop) return 'empty';
    return now - p.plantedAt >= this._growMs(p) ? 'ripe' : 'growing';
  }
  plant({ plot, crop }) {
    const p = this.state.plots[plot]; const c = CROPS[crop];
    if (!p || !c) return this._err('BAD_INPUT');
    if (!p.open) return this._err('PLOT_LOCKED');
    if (p.crop) return this._err('PLOT_BUSY');
    if (c.rare) { if (this.state.points < c.points) return this._err('NEED_POINTS', { n: c.points }); this.state.points -= c.points; }
    else { if (this.state.coins < c.seed) return this._err('NEED_COINS', { n: c.seed }); this.state.coins -= c.seed; }
    Object.assign(p, { crop, plantedAt: this.now(), watered: false });
    return this._ok();
  }
  water({ plot }) {
    const p = this.state.plots[plot];
    if (!p || this.plotStatus(p) !== 'growing') return this._err('NOT_GROWING');
    if (p.watered) return this._err('ALREADY_WATERED');
    p.watered = true;
    return this._ok();
  }
  harvest({ plot }) {
    const p = this.state.plots[plot];
    if (!p || this.plotStatus(p) !== 'ripe') return this._err('NOT_RIPE');
    const c = CROPS[p.crop];
    let n = 1;
    const d = this._daily();
    let bonus = false;
    if (this._member() && !d.memberBonusUsed) { n += 1; d.memberBonusUsed = true; bonus = true; }
    this.state.inv[p.crop] = (this.state.inv[p.crop] || 0) + n;
    if (c.shard) this._addShards(c.shard);
    this.state.stats.harvested += n;
    const crop = p.crop;
    Object.assign(p, { crop: null, plantedAt: 0, watered: false });
    return this._ok({ crop, n, bonus });
  }
  harvestAll() {
    let total = 0;
    this.state.plots.forEach((p, i) => { if (this.plotStatus(p) === 'ripe') { const r = this.harvest({ plot: i }); if (r.ok) total += r.n; } });
    return this._ok({ n: total });
  }
  reclaimCost() { const open = this.state.plots.filter((p) => p.open && !p.premium).length; return 50 * Math.pow(2, Math.max(0, open - START_PLOTS)); }
  reclaim() {
    const p = this.state.plots.find((x) => !x.open);
    if (!p) return this._err('MAX_PLOTS');
    const freeOpen = this.state.plots.filter((x) => x.open && !x.premium).length;
    if (freeOpen >= MAX_PLOTS - PREMIUM_PLOTS) return this._err('USE_PREMIUM_LAND');
    const cost = this.reclaimCost();
    if (this.state.coins < cost) return this._err('NEED_COINS', { n: cost });
    this.state.coins -= cost; p.open = true;
    return this._ok({ cost });
  }

  // ---------- 动物 ----------
  buyAnimal({ kind }) {
    const a = ANIMALS[kind]; if (!a) return this._err('BAD_INPUT');
    if (this.state.animals.length >= 10) return this._err('PEN_FULL');
    if (a.rare) { if (this.state.points < a.points) return this._err('NEED_POINTS', { n: a.points }); this.state.points -= a.points; }
    else { if (this.state.coins < a.cost) return this._err('NEED_COINS', { n: a.cost }); this.state.coins -= a.cost; }
    this.state.animals.push({ id: 'a' + this.now().toString(36) + this.state.animals.length, kind, fedAt: 0 });
    return this._ok();
  }
  animalStatus(a, now = this.now()) {
    if (!a.fedAt) return 'hungry';
    return now - a.fedAt >= ANIMALS[a.kind].cycle ? 'ready' : 'producing';
  }
  feed({ id }) {
    const a = this.state.animals.find((x) => x.id === id); if (!a) return this._err('BAD_INPUT');
    if (this.animalStatus(a) !== 'hungry') return this._err('NOT_HUNGRY');
    const cost = ANIMALS[a.kind].feed;
    if (this.state.coins < cost) return this._err('NEED_COINS', { n: cost });
    this.state.coins -= cost; a.fedAt = this.now();
    return this._ok();
  }
  feedAll() { let n = 0; for (const a of this.state.animals) if (this.feed({ id: a.id }).ok) n++; return this._ok({ n }); }
  collect({ id }) {
    const a = this.state.animals.find((x) => x.id === id); if (!a) return this._err('BAD_INPUT');
    if (this.animalStatus(a) !== 'ready') return this._err('NOT_READY');
    const def = ANIMALS[a.kind];
    this.state.inv[def.product] = (this.state.inv[def.product] || 0) + 1;
    if (def.shard) this._addShards(def.shard);
    a.fedAt = 0;
    return this._ok({ product: def.product });
  }
  collectAll() { let n = 0; for (const a of this.state.animals) if (this.collect({ id: a.id }).ok) n++; return this._ok({ n }); }

  // ---------- 经济 ----------
  priceOf(item) {
    if (CROPS[item]) return CROPS[item].sell;
    const an = Object.values(ANIMALS).find((a) => a.product === item);
    return an ? an.sell : 0;
  }
  sell({ item, n }) {
    const have = this.state.inv[item] || 0; const price = this.priceOf(item);
    const k = Math.min(have, n == null ? have : Math.max(0, Math.floor(n)));
    if (!k || !price) return this._err('NOTHING_TO_SELL');
    this.state.inv[item] = have - k; this.state.coins += k * price; this.state.stats.sold += k;
    return this._ok({ coins: k * price });
  }
  sellAll() { let coins = 0; for (const it of Object.keys(this.state.inv)) { const r = this.sell({ item: it }); if (r.ok) coins += r.coins; } return coins ? this._ok({ coins }) : this._err('NOTHING_TO_SELL'); }
  _addShards(n) {
    this.state.shards += n;
    if (!this.state.skinUnlocked && this.state.shards >= SHARDS_NEEDED) { this.state.skinUnlocked = true; this._justUnlocked = true; }
  }
  buy({ item }) {
    const it = SHOP[item]; if (!it) return this._err('BAD_INPUT');
    if (it.kind === 'accessory' && this.state.accessories.includes(item)) return this._err('OWNED');
    if (it.kind === 'dog' && this.state.dog) return this._err('OWNED');
    const d = this._daily();
    if (it.kind === 'shard' && d.shardBuys >= it.dailyLimit) return this._err('DAILY_LIMIT', { n: it.dailyLimit });
    if (this.state.coins < it.coins) return this._err('NEED_COINS', { n: it.coins });
    this.state.coins -= it.coins;
    let extra = {};
    if (it.kind === 'food') { let g = null; try { g = this.hooks.growthFood && this.hooks.growthFood(); } catch { g = null; } extra.growth = g; }
    if (it.kind === 'accessory') this.state.accessories.push(item);
    if (it.kind === 'dog') this.state.dog = true;
    if (it.kind === 'shard') { d.shardBuys += 1; this._justUnlocked = false; this._addShards(1); extra.unlocked = !!this._justUnlocked; }
    return this._ok({ item, ...extra });
  }

  // ---------- 付费点（只卖时间与外观） ----------
  speedCost(ms) { return Math.max(1, Math.ceil(ms / (5 * MIN))); } // 每 5 分钟 1 点
  speedUp({ plot, id }) {
    const now = this.now();
    if (plot != null) {
      const p = this.state.plots[plot]; if (!p || this.plotStatus(p) !== 'growing') return this._err('NOT_GROWING');
      const left = this._growMs(p) - (now - p.plantedAt); const cost = this.speedCost(left);
      if (this.state.points < cost) return this._err('NEED_POINTS', { n: cost });
      this.state.points -= cost; p.plantedAt = now - this._growMs(p);
      return this._ok({ cost });
    }
    const a = this.state.animals.find((x) => x.id === id); if (!a || this.animalStatus(a) !== 'producing') return this._err('NOT_READY');
    const left = ANIMALS[a.kind].cycle - (now - a.fedAt); const cost = this.speedCost(left);
    if (this.state.points < cost) return this._err('NEED_POINTS', { n: cost });
    this.state.points -= cost; a.fedAt = now - ANIMALS[a.kind].cycle;
    return this._ok({ cost });
  }
  premiumLand() {
    const used = this.state.plots.filter((p) => p.premium).length;
    if (used >= PREMIUM_PLOTS) return this._err('MAX_PLOTS');
    const p = this.state.plots.find((x) => !x.open); if (!p) return this._err('MAX_PLOTS');
    const cost = 80;
    if (this.state.points < cost) return this._err('NEED_POINTS', { n: cost });
    this.state.points -= cost; p.open = true; p.premium = true;
    return this._ok({ cost });
  }
  buyDecor({ item }) {
    const it = DECOR[item]; if (!it) return this._err('BAD_INPUT');
    if (this.state.decor.includes(item)) return this._err('OWNED');
    if (this.state.points < it.points) return this._err('NEED_POINTS', { n: it.points });
    this.state.points -= it.points; this.state.decor.push(item);
    return this._ok();
  }
  /** 买点数包：真实扣款需正式支付服务器；开发/QA 授权下走沙盒发放，方便测试 */
  buyPoints() {
    if (!this._dev()) return { ok: false, code: 'NEEDS_SERVER', needsServer: true, pack: POINT_PACK };
    this.state.points += POINT_PACK; this.state.pointsSandbox += POINT_PACK;
    return this._ok({ sandbox: true, n: POINT_PACK });
  }

  // ---------- 打工 ----------
  startWork({ manual = false, duo = false } = {}) {
    if (this.state.work) return this._err('ALREADY_WORKING');
    if (duo && this.couple.partnerAway()) return this._err('PARTNER_AWAY');
    this.state.work = { since: this.now(), manual: !!manual, until: manual ? this.now() + WORK.manualMs : 0, duo: !!duo };
    try { this.hooks.onWork && this.hooks.onWork(true, null, !!duo); } catch {}
    return this._ok();
  }
  endWork() {
    const w = this.state.work; if (!w) return this._err('NOT_WORKING');
    const end = w.until ? Math.min(this.now(), w.until) : this.now();
    const mins = Math.max(0, Math.floor((end - w.since) / MIN));
    const k = dayKey(this.now());
    if (this.state.workLog.day !== k) this.state.workLog = { day: k, coins: 0 };
    // 双人打工：收入 +20%，当天上限也 +20%（两个人一起干活，所有情侣都一样，与付费无关）
    const cap = Math.round(WORK.dailyCap * (w.duo ? 1 + DUO.capBonus : 1));
    const coins = Math.max(0, Math.min(Math.floor(mins * WORK.coinsPerMin * (w.duo ? 1 + DUO.bonus : 1)), cap - this.state.workLog.coins));
    this.state.workLog.coins += coins; this.state.coins += coins;
    // 打工期间顺手浇水（所有在长的作物）
    let watered = 0;
    for (const p of this.state.plots) if (this.plotStatus(p) === 'growing' && !p.watered) { p.watered = true; watered++; }
    const ripe = this.state.plots.filter((p) => this.plotStatus(p) === 'ripe').length;
    const report = { mins, coins, watered, ripe, duo: !!w.duo, capped: this.state.workLog.coins >= cap, at: this.now() };
    if (w.duo) this.couple.s.stats.duo += 1;
    else { const h = this.couple.partnerHelpWhileAway(report); if (h) report.partnerHelped = this.couple.s.partner.name; }
    this.state.work = null; this.state.lastReport = report;
    try { this.hooks.onWork && this.hooks.onWork(false, report); } catch {}
    return this._ok({ report });
  }
  /** 主进程每 30 秒调用：idleMs = 系统空闲时长 */
  tickIdle(idleMs, autoWork = true) {
    const w = this.state.work;
    if (w && w.manual && w.until && this.now() >= w.until) return this.endWork();
    if (w && !w.manual && idleMs < 10 * 1000) return this.endWork();
    if (!w && autoWork && idleMs >= WORK.idleMs) return this.startWork({ manual: false });
    return null;
  }

  // ---------- 好友（本地演示） ----------
  friendFarm(fid) {
    const f = DEMO_FRIENDS.find((x) => x.id === fid); if (!f) return null;
    const now = this.now(); const seed = hash(fid + dayKey(now));
    const crops = ['turnip', 'carrot', 'tomato', 'corn', 'pumpkin'];
    const taken = (this._daily().steals[fid] || 0);
    const plots = [];
    for (let i = 0; i < 9; i++) {
      const r = (seed >> (i * 3)) & 7;
      const crop = crops[(seed + i * 7) % crops.length];
      plots.push({ id: i, crop: r < 6 ? crop : null, ripe: r < 4 });
    }
    // 已偷过的从前往后标记为空
    let t = taken; for (const p of plots) { if (t <= 0) break; if (p.ripe) { p.ripe = false; p.crop = null; p.stolen = true; t--; } }
    return { ...f, plots, left: Math.max(0, STEAL.perFriend - taken) };
  }
  friends() { return DEMO_FRIENDS.map((f) => { const ff = this.friendFarm(f.id); return { ...f, ripe: ff.plots.filter((p) => p.ripe).length, left: ff.left }; }); }
  steal({ friend, plot }) {
    const ff = this.friendFarm(friend); if (!ff) return this._err('BAD_INPUT');
    const d = this._daily();
    if (d.stealTotal >= STEAL.perDay) return this._err('STEAL_DAILY', { n: STEAL.perDay });
    if (ff.left <= 0) return this._err('STEAL_FRIEND', { n: STEAL.perFriend });
    const p = ff.plots[plot]; if (!p || !p.ripe) return this._err('NOT_RIPE');
    d.stealTotal += 1; d.steals[friend] = (d.steals[friend] || 0) + 1;
    if (ff.dog && this.random() < STEAL.dogCatch) {
      const fine = Math.min(this.state.coins, STEAL.fine); this.state.coins -= fine; this.state.stats.caught += 1;
      return this._ok({ caught: true, fine });
    }
    this.state.inv[p.crop] = (this.state.inv[p.crop] || 0) + 1; this.state.stats.stolen += 1;
    return this._ok({ caught: false, crop: p.crop });
  }
  /** 野生动物靠近农场时把它吓跑：从不造成损失；每天前几次有一点勇气奖励 */
  scare({ kind } = {}) {
    if (!WILD.kinds.includes(kind)) return this._err('BAD_INPUT');
    const d = this._daily(); d.scares = d.scares || 0;
    const reward = d.scares < WILD.perDay ? WILD.reward : 0;
    d.scares += 1; this.state.coins += reward; this.state.stats.scared = (this.state.stats.scared || 0) + 1;
    return this._ok({ reward });
  }
  /** 真实跨用户偷菜：需服务器（好友关系、对方农场快照、防作弊），这里只留钩子 */
  async remoteSteal(args) {
    if (this.hooks.remoteSteal) return this.hooks.remoteSteal(args);
    return { ok: false, code: 'NEEDS_SERVER', needsServer: true };
  }

  view() {
    const now = this.now(); this._daily(); this._grantMemberPoints();
    const s = this.state;
    return {
      now, coins: s.coins, points: s.points, pointsSandbox: s.pointsSandbox, member: this._member(),
      memberBonusLeft: this._member() && !s.daily.memberBonusUsed,
      plots: s.plots.map((p) => ({ id: p.id, open: p.open, premium: p.premium, crop: p.crop, watered: p.watered, status: this.plotStatus(p, now),
        leftMs: p.crop ? Math.max(0, this._growMs(p) - (now - p.plantedAt)) : 0, totalMs: p.crop ? this._growMs(p) : 0 })),
      animals: s.animals.map((a) => ({ id: a.id, kind: a.kind, status: this.animalStatus(a, now), leftMs: a.fedAt ? Math.max(0, ANIMALS[a.kind].cycle - (now - a.fedAt)) : 0 })),
      inv: s.inv, shards: s.shards, shardsNeeded: SHARDS_NEEDED, skinUnlocked: s.skinUnlocked, skinId: SHARD_SKIN,
      accessories: s.accessories, decor: s.decor, dog: s.dog, work: s.work, workToday: s.workLog.day === dayKey(now) ? s.workLog.coins : 0,
      lastReport: s.lastReport, reclaimCost: this.reclaimCost(), daily: { stealLeft: Math.max(0, STEAL.perDay - s.daily.stealTotal), shardBuysLeft: Math.max(0, SHOP.shard.dailyLimit - s.daily.shardBuys) },
      stats: s.stats, couple: this.couple.view(), weather: (() => { try { return this.hooks.weather ? this.hooks.weather() : null; } catch { return null; } })(),
    };
  }
  static catalog() { const C = require('./farm-couple'); return { COUPLE: { LOVE_CROPS: C.LOVE_CROPS, OUTFITS: C.OUTFITS, COTTAGE: C.COTTAGE, DATES: C.DATES, DUO: C.DUO, HELP: C.HELP, FUND: C.FUND }, CROPS, ANIMALS, SHOP, DECOR, WORK, STEAL, SHARDS_NEEDED, MAX_PLOTS, PREMIUM_PLOTS, POINT_PACK, MEMBER_MONTHLY_POINTS, MIN }; }

  call(action, args = {}) {
    const A = {
      view: () => ({ ok: true, view: this.view(), catalog: Farm.catalog() }),
      plant: () => this.plant(args), water: () => this.water(args), harvest: () => this.harvest(args), harvestAll: () => this.harvestAll(),
      reclaim: () => this.reclaim(), buyAnimal: () => this.buyAnimal(args), feed: () => this.feed(args), feedAll: () => this.feedAll(),
      collect: () => this.collect(args), collectAll: () => this.collectAll(), sell: () => this.sell(args), sellAll: () => this.sellAll(),
      buy: () => this.buy(args), speedUp: () => this.speedUp(args), premiumLand: () => this.premiumLand(), buyDecor: () => this.buyDecor(args),
      buyPoints: () => this.buyPoints(), startWork: () => this.startWork({ manual: true, duo: !!args.duo }), couple: () => this.couple.call(String(args.op || ''), args), endWork: () => this.endWork(),
      friends: () => ({ ok: true, friends: this.friends() }), friendFarm: () => ({ ok: true, farm: this.friendFarm(args.friend) }),
      steal: () => this.steal(args), scare: () => this.scare(args), remoteSteal: () => this.remoteSteal(args),
    };
    const fn = A[action];
    if (!fn) return this._err('BAD_ACTION');
    return fn();
  }
}

module.exports = { Farm, CROPS, ANIMALS, SHOP, DECOR, WORK, STEAL, WILD, SHARDS_NEEDED, SHARD_SKIN, DEMO_FRIENDS, dayKey };
Farm.CROPS = CROPS;
