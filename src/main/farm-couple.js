'use strict';
/**
 * 方块仔小农场 · 情侣玩法（纯逻辑，可单测）。
 * 没有联机服务器之前，伴侣是本地演示伴侣「阿橘」（她自己的方块仔、名字和皮肤），
 * 她的行为由 _partnerTick() 按时间确定性地模拟；所有「需要同步给真实伴侣」的事件都会经过
 * hooks.coupleSync(event) —— 默认返回 NEEDS_SERVER，并在 outbox 里排队，服务器上线后补发。
 *
 * 商业化：基础玩法全部免费可用；情侣年卡（couple_premium）只多给外观（专属情侣装、小屋高级家具）
 * 和「约会照片自动进纪念日相册」（相册本身就是年卡权益）。不卖金币、不卖产量。
 */
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const DEMO_PARTNER = { id: 'demo_partner', name: '阿橘', skinId: 'neko', emoji: '🐱', demo: true };
const SHARED_PLOTS = 6;
const LOVE_CROPS = {
  rose:         { emoji: '🌹', grow: 10 * MIN, seed: 8,  tokens: 1 },
  lovetulip:    { emoji: '🌷', grow: 20 * MIN, seed: 14, tokens: 2 },
  heartpumpkin: { emoji: '🎃', heart: true, grow: 40 * MIN, seed: 24, tokens: 4 },
};
const OUTFITS = {
  pair_scarf: { emoji: '🧣', tokens: 6 },
  pair_straw: { emoji: '👒', tokens: 8 },
  pair_bow:   { emoji: '🎀', tokens: 10 },
  pair_crown: { emoji: '👑', tokens: 12, premium: true },
  pair_wings: { emoji: '🪽', tokens: 14, premium: true },
};
const COTTAGE = {
  rug:       { emoji: '🟫', fund: 40,  at: [50, 62] },
  plant:     { emoji: '🪴', fund: 50,  at: [16, 40] },
  lamp:      { emoji: '🪔', fund: 60,  at: [82, 36] },
  frame:     { emoji: '🖼️', fund: 70,  at: [40, 14] },
  sofa:      { emoji: '🛋️', fund: 120, at: [30, 56] },
  teddy:     { emoji: '🧸', fund: 90,  at: [70, 66] },
  bed:       { emoji: '🛏️', fund: 160, at: [72, 46] },
  fireplace: { emoji: '🔥', fund: 140, at: [60, 18], premium: true },
  piano:     { emoji: '🎹', fund: 180, at: [18, 66], premium: true },
};
const DATES = {
  river: { emoji: '🌉', unlock: { fund: 120 }, tokens: 1 },
  snow:  { emoji: '🏔️', unlock: { tokens: 6 }, tokens: 2 },
};
const DUO = { bonus: 0.2, capBonus: 0.2 };
const FUND = { partnerMatchPerDay: 100 };
const HELP = { perDay: 6 };
const PARTNER_AWAY_SLOT = 20 * MIN; // 演示：阿橘每 20 分钟在线/外出切换一次

function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function md(t) { const d = new Date(t); return [d.getMonth() + 1, d.getDate()]; }

function freshCouple(now) {
  const plots = [];
  for (let i = 0; i < SHARED_PLOTS; i++) plots.push({ id: i, crop: null, love: false, plantedAt: 0, plantedBy: '', wateredBy: '', care: { me: 0, partner: 0 }, growFrom: 0 });
  return {
    v: 1, partner: { ...DEMO_PARTNER }, since: now, plots,
    tokens: 0, outfits: [], wear: '', fund: 0, partnerCoins: 0, partnerInv: {},
    cottage: [], anniversaryOpened: '', dates: [], memories: [],
    inbox: [], outbox: [], partnerFarm: { plots: [0, 0, 0, 0], beast: true, day: '' },
    daily: { day: '', match: 0, help: 0, dated: {} }, partnerAway: null, lastPartnerAct: 0,
    stats: { shared: 0, love: 0, gifts: 0, helps: 0, duo: 0, dates: 0 },
  };
}

class FarmCouple {
  constructor(farm) {
    this.farm = farm;
    if (!farm.state.couple || typeof farm.state.couple !== 'object') farm.state.couple = freshCouple(farm.now());
    const base = freshCouple(farm.now());
    const c = farm.state.couple;
    for (const k of Object.keys(base)) if (c[k] === undefined) c[k] = base[k];
    if (!Array.isArray(c.plots) || c.plots.length !== SHARED_PLOTS) c.plots = base.plots;
  }
  get s() { return this.farm.state.couple; }
  now() { return this.farm.now(); }
  _hook(name, ...a) { try { return this.farm.hooks[name] ? this.farm.hooks[name](...a) : undefined; } catch { return undefined; } }
  premium() { return !!this._hook('isCouplePremium'); }
  _daily() { const k = dayKey(this.now()); if (this.s.daily.day !== k) this.s.daily = { day: k, match: 0, help: 0, dated: {} }; return this.s.daily; }
  /** 发给真实伴侣的事件：需服务器；先排队 */
  _sync(type, data = {}) {
    const ev = { type, data, at: this.now() };
    const r = this._hook('coupleSync', ev);
    if (!r || !r.ok) { this.s.outbox.push(ev); if (this.s.outbox.length > 50) this.s.outbox.shift(); }
    return r || { ok: false, code: 'NEEDS_SERVER', needsServer: true };
  }
  _note(text, emoji = '💌', params = []) { this.s.inbox.unshift({ id: 'n' + this.now() + Math.floor(this.farm.random() * 1000), from: this.s.partner.name, text, params, emoji, at: this.now(), read: false }); this.s.inbox = this.s.inbox.slice(0, 20); }

  partnerAway(now = this.now()) {
    if (this.s.partnerAway !== null && this.s.partnerAway !== undefined) return !!this.s.partnerAway; // QA/演示可手动切换
    return Math.floor(now / PARTNER_AWAY_SLOT) % 2 === 1;
  }

  // ---------- 1/2 共建农田 + 爱心作物 ----------
  plotStatus(p, now = this.now()) {
    if (!p.crop) return 'empty';
    if (p.love) {
      if (!p.growFrom) return 'needCare';
      return now - p.growFrom >= LOVE_CROPS[p.crop].grow ? 'ripe' : 'growing';
    }
    const c = this.farm.constructor.CROPS[p.crop];
    const g = Math.round(c.grow * (p.wateredBy ? 0.75 : 1));
    return now - p.plantedAt >= g ? 'ripe' : 'growing';
  }
  _leftMs(p, now) {
    if (!p.crop) return 0;
    if (p.love) return p.growFrom ? Math.max(0, LOVE_CROPS[p.crop].grow - (now - p.growFrom)) : LOVE_CROPS[p.crop].grow;
    const c = this.farm.constructor.CROPS[p.crop]; return Math.max(0, Math.round(c.grow * (p.wateredBy ? 0.75 : 1)) - (now - p.plantedAt));
  }
  plant({ plot, crop }) {
    const p = this.s.plots[plot]; if (!p) return this.farm._err('BAD_INPUT');
    if (p.crop) return this.farm._err('PLOT_BUSY');
    const love = !!LOVE_CROPS[crop]; const c = love ? LOVE_CROPS[crop] : this.farm.constructor.CROPS[crop];
    if (!c || c.rare) return this.farm._err('BAD_INPUT');
    if (this.farm.state.coins < c.seed) return this.farm._err('NEED_COINS', { n: c.seed });
    this.farm.state.coins -= c.seed;
    Object.assign(p, { crop, love, plantedAt: this.now(), plantedBy: 'me', wateredBy: '', care: { me: love ? this.now() : 0, partner: 0 }, growFrom: 0 });
    this._sync('plant', { plot, crop });
    return this.farm._ok();
  }
  /** 浇水（普通作物）/ 照顾（爱心作物）：爱心作物两个人都照顾过才开始长 */
  water({ plot }) {
    const p = this.s.plots[plot]; if (!p || !p.crop) return this.farm._err('NOT_GROWING');
    const now = this.now();
    if (p.love) {
      if (p.care.me && p.growFrom) return this.farm._err('ALREADY_WATERED');
      if (p.care.me) return this.farm._err('WAIT_PARTNER');
      p.care.me = now; if (p.care.partner) p.growFrom = now;
    } else {
      if (this.plotStatus(p) !== 'growing') return this.farm._err('NOT_GROWING');
      if (p.wateredBy) return this.farm._err('ALREADY_WATERED');
      p.wateredBy = 'me';
    }
    this._sync('water', { plot });
    return this.farm._ok();
  }
  harvest({ plot }) {
    const p = this.s.plots[plot]; if (!p || this.plotStatus(p) !== 'ripe') return this.farm._err('NOT_RIPE');
    const crop = p.crop, love = p.love;
    let mine = 0, tokens = 0;
    if (love) { tokens = LOVE_CROPS[crop].tokens; this.s.tokens += tokens; this.s.stats.love += 1; }
    else {
      // 共建加成：两人合作收成 ×2，然后平分 —— 每人拿到的不少于自己单独种
      const total = 2 + (p.wateredBy && p.plantedBy && p.wateredBy !== p.plantedBy ? 1 : 0);
      mine = Math.ceil(total / 2);
      this.farm.state.inv[crop] = (this.farm.state.inv[crop] || 0) + mine;
      this.s.partnerInv[crop] = (this.s.partnerInv[crop] || 0) + (total - mine);
      this.s.stats.shared += 1;
    }
    Object.assign(p, { crop: null, love: false, plantedAt: 0, plantedBy: '', wateredBy: '', care: { me: 0, partner: 0 }, growFrom: 0 });
    this._sync('harvest', { plot, crop });
    return this.farm._ok({ crop, love, mine, partner: love ? tokens : undefined, tokens });
  }

  // 演示伴侣的行动（确定性；联机后由服务器推送真实伴侣的操作替代）
  _partnerTick(now = this.now()) {
    if (!this.s.partner.demo) return;
    const away = this.partnerAway(now);
    let acted = false;
    for (const p of this.s.plots) {
      if (!p.crop || away) continue;
      if (p.love && !p.care.partner && now - p.plantedAt >= 15 * 1000) { p.care.partner = now; if (p.care.me) p.growFrom = now; acted = true; }
      else if (!p.love && !p.wateredBy && p.plantedBy === 'me' && now - p.plantedAt >= 15 * 1000 && this.plotStatus(p, now) === 'growing') { p.wateredBy = 'partner'; acted = true; }
    }
    // 她也会种：在线时每 10 分钟最多种一块，留给你去浇水（一个种一个浇）
    if (!away && now - (this.s.lastPartnerAct || 0) >= 10 * MIN) {
      const empty = this.s.plots.find((p) => !p.crop);
      if (empty) { Object.assign(empty, { crop: ['carrot', 'tomato', 'turnip'][Math.floor(now / MIN) % 3], love: false, plantedAt: now, plantedBy: 'partner', wateredBy: '', care: { me: 0, partner: 0 }, growFrom: 0 }); this.s.lastPartnerAct = now; acted = true; }
    }
    // 伴侣的农场（演示）：每天新长出要浇水的地 + 一只来捣乱的野兽
    const pf = this.s.partnerFarm; const dk = dayKey(now);
    if (pf.day !== dk) { pf.day = dk; pf.plots = [0, 0, 0, 0]; pf.beast = true; }
    return acted;
  }

  // ---------- 3 情侣小屋 ----------
  contribute({ n }) {
    n = Math.floor(Number(n) || 0); if (n <= 0) return this.farm._err('BAD_INPUT');
    if (this.farm.state.coins < n) return this.farm._err('NEED_COINS', { n });
    this.farm.state.coins -= n; this.s.fund += n;
    const d = this._daily(); const match = Math.min(n, FUND.partnerMatchPerDay - d.match); // 演示：阿橘每天跟投同样的金额（上限）
    if (match > 0) { d.match += match; this.s.fund += match; }
    this._sync('fund', { n });
    return this.farm._ok({ match: Math.max(0, match) });
  }
  buyCottage({ item }) {
    const it = COTTAGE[item]; if (!it) return this.farm._err('BAD_INPUT');
    if (this.s.cottage.includes(item)) return this.farm._err('OWNED');
    if (it.premium && !this.premium()) return this.farm._err('NEED_COUPLE_PASS');
    if (this.s.fund < it.fund) return this.farm._err('NEED_FUND', { n: it.fund });
    this.s.fund -= it.fund; this.s.cottage.push(item);
    this._sync('cottage', { item });
    return this.farm._ok();
  }
  anniversary(now = this.now()) {
    const a = this._hook('anniversary'); // couplePlus 里设置的纪念日（YYYY-MM-DD / MM-DD）
    let m = 0, d = 0, src = 'since';
    const mm = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(String(a || ''));
    if (mm) { m = +mm[1]; d = +mm[2]; src = 'set'; } else { [m, d] = md(this.s.since); }
    const [cm, cd] = md(now);
    const yearly = cm === m && cd === d;
    const monthly = cd === d && (src === 'set' || now - this.s.since > 7 * DAY);
    const today = (yearly || monthly) && !(src === 'since' && dayKey(now) === dayKey(this.s.since));
    return { today, yearly, monthly: monthly && !yearly, opened: this.s.anniversaryOpened === dayKey(now), month: m, day: d };
  }
  openSurprise() {
    const a = this.anniversary(); if (!a.today) return this.farm._err('NOT_ANNIVERSARY');
    if (a.opened) return this.farm._err('OPENED');
    this.s.anniversaryOpened = dayKey(this.now());
    const tokens = a.yearly ? 10 : 3; this.s.tokens += tokens;
    this._sync('surprise', {});
    return this.farm._ok({ tokens, yearly: a.yearly, letter: a.yearly ? 'LETTER_YEAR' : 'LETTER_MONTH' });
  }

  // ---------- 2 情侣装（爱心兑换） ----------
  exchange({ item }) {
    const it = OUTFITS[item]; if (!it) return this.farm._err('BAD_INPUT');
    if (this.s.outfits.includes(item)) return this.farm._err('OWNED');
    if (it.premium && !this.premium()) return this.farm._err('NEED_COUPLE_PASS');
    if (this.s.tokens < it.tokens) return this.farm._err('NEED_TOKENS', { n: it.tokens });
    this.s.tokens -= it.tokens; this.s.outfits.push(item); this.s.wear = item;
    this._sync('outfit', { item });
    return this.farm._ok();
  }
  wear({ item }) {
    if (item && !this.s.outfits.includes(item)) return this.farm._err('BAD_INPUT');
    this.s.wear = item || ''; return this.farm._ok();
  }

  // ---------- 4 送礼 / 代劳 ----------
  gift({ item, n = 1 }) {
    n = Math.max(1, Math.floor(Number(n) || 1));
    if ((this.farm.state.inv[item] || 0) < n) return this.farm._err('NOT_ENOUGH');
    this.farm.state.inv[item] -= n; this.s.partnerInv[item] = (this.s.partnerInv[item] || 0) + n; this.s.stats.gifts += 1;
    this._sync('gift', { item, n });
    if (this.s.partner.demo) this._note('收到你送的 {} × {} 啦，谢谢你～', '🎁', [item, n]);
    return this.farm._ok({ seenOnReturn: this.partnerAway() });
  }
  help({ kind, plot }) {
    if (!this.partnerAway()) return this.farm._err('PARTNER_HERE');
    const d = this._daily(); if (d.help >= HELP.perDay) return this.farm._err('HELP_DAILY', { n: HELP.perDay });
    const pf = this.s.partnerFarm; this._partnerTick();
    if (kind === 'water') {
      const i = Number.isInteger(plot) ? plot : pf.plots.indexOf(0);
      if (i < 0 || pf.plots[i]) return this.farm._err('ALREADY_WATERED');
      pf.plots[i] = 1;
    } else if (kind === 'chase') {
      if (!pf.beast) return this.farm._err('NO_BEAST');
      pf.beast = false;
    } else return this.farm._err('BAD_INPUT');
    d.help += 1; this.s.stats.helps += 1;
    const msg = { kind, at: this.now() };
    this.s.pendingForPartner = (this.s.pendingForPartner || []).concat(msg).slice(-20); // 伴侣回来时她的方块仔会转告
    this._sync('help', msg);
    return this.farm._ok();
  }
  /** 你回来时：如果阿橘在你不在时帮了忙，她的方块仔留了话 */
  partnerHelpWhileAway(report) {
    if (!this.s.partner.demo || this.partnerAway()) return null;
    const watered = report ? report.watered : 0;
    this._note('你不在的时候我帮你看着农场，还赶走了一只小狐狸～', '🐾', []);
    return { watered };
  }
  readInbox() { for (const n of this.s.inbox) n.read = true; return this.farm._ok(); }

  // ---------- 6 约会地点 ----------
  unlockDate({ spot }) {
    const d = DATES[spot]; if (!d) return this.farm._err('BAD_INPUT');
    if (this.s.dates.includes(spot)) return this.farm._err('OWNED');
    if (d.unlock.fund && this.s.fund < d.unlock.fund) return this.farm._err('NEED_FUND', { n: d.unlock.fund });
    if (d.unlock.tokens && this.s.tokens < d.unlock.tokens) return this.farm._err('NEED_TOKENS', { n: d.unlock.tokens });
    if (d.unlock.fund) this.s.fund -= d.unlock.fund; if (d.unlock.tokens) this.s.tokens -= d.unlock.tokens;
    this.s.dates.push(spot); this._sync('dateUnlock', { spot });
    return this.farm._ok();
  }
  goDate({ spot }) {
    if (!this.s.dates.includes(spot)) return this.farm._err('DATE_LOCKED');
    const d = this._daily(); const first = !d.dated[spot]; d.dated[spot] = true;
    if (first) this.s.tokens += DATES[spot].tokens;
    this.s.stats.dates += 1; this._sync('date', { spot });
    return this.farm._ok({ tokens: first ? DATES[spot].tokens : 0 });
  }
  addMemory(entry) {
    this.s.memories.unshift({ id: entry.id, spot: entry.spot, file: entry.file || '', album: !!entry.album, at: this.now() });
    this.s.memories = this.s.memories.slice(0, 24); this.farm.save();
  }

  view() {
    const now = this.now(); this._partnerTick(now); this._daily();
    const s = this.s;
    return {
      partner: s.partner, partnerAway: this.partnerAway(now), premium: this.premium(), demo: !!s.partner.demo,
      plots: s.plots.map((p) => ({ id: p.id, crop: p.crop, love: p.love, plantedBy: p.plantedBy, wateredBy: p.wateredBy, care: { me: !!p.care.me, partner: !!p.care.partner }, status: this.plotStatus(p, now), leftMs: this._leftMs(p, now) })),
      tokens: s.tokens, outfits: s.outfits, wear: s.wear, fund: s.fund, cottage: s.cottage, anniversary: this.anniversary(now),
      dates: s.dates, memories: s.memories.slice(0, 12), inbox: s.inbox.slice(0, 8), unread: s.inbox.filter((n) => !n.read).length,
      partnerFarm: s.partnerFarm, partnerInv: s.partnerInv, helpLeft: Math.max(0, HELP.perDay - s.daily.help), matchLeft: Math.max(0, FUND.partnerMatchPerDay - s.daily.match),
      datedToday: s.daily.dated, pendingSync: s.outbox.length, stats: s.stats,
    };
  }
  call(op, a = {}) {
    const T = {
      plant: () => this.plant(a), water: () => this.water(a), harvest: () => this.harvest(a),
      contribute: () => this.contribute(a), buyCottage: () => this.buyCottage(a), openSurprise: () => this.openSurprise(),
      exchange: () => this.exchange(a), wear: () => this.wear(a), gift: () => this.gift(a), help: () => this.help(a), readInbox: () => this.readInbox(),
      unlockDate: () => this.unlockDate(a), goDate: () => this.goDate(a),
      demoAway: () => { this.s.partnerAway = a.on === null || a.on === undefined ? null : !!a.on; return this.farm._ok(); },
    };
    const fn = T[op]; return fn ? fn() : this.farm._err('BAD_ACTION');
  }
}

module.exports = { FarmCouple, LOVE_CROPS, OUTFITS, COTTAGE, DATES, DUO, FUND, HELP, DEMO_PARTNER, SHARED_PLOTS };
