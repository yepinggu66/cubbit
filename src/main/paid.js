'use strict';
/**
 * 方块仔 v2.5 付费扩展（主进程）：办公助手 / 会员订阅 / 角色定制 / 情侣进阶。
 *
 * 只有一个 IPC 入口（paid:call {area, action, args}），所有门槛统一走 rt.can(feature)：
 *   office_pro        完整版 / 试用 / 会员 / 情侣年卡
 *   member_perks      会员月付 / 年付
 *   custom_character  角色定制（单独购买 dlc_custom_char）
 *   couple_premium    情侣年卡
 * 免费可用：剪贴板历史（最近 10 条）、灵感速记、普通番茄钟。
 *
 * 需要服务端 / AI 服务的部分（云同步、AI 生图、声音克隆）只留接口，返回 needsService，
 * 本地兜底照常可用：照片取色、文字配色、音高/语速预设、模板情书。
 */
const fs = require('node:fs');
const path = require('node:path');

const DAY = 86400000;
const FREE_CLIP = 10;
const PRO_CLIP = 200;
const MAX_CLIP_LEN = 4000;

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function monthKey(d = new Date()) { return localDay(d).slice(0, 7); }
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function clampStr(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }

// ------------------------------------------------------------------ .ics
function unfoldIcs(text) { return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function parseIcsDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(v || '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h = '09', mi = '00', s = '00', z] = m;
  if (z) return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}
/** 解析 VEVENT（SUMMARY / DTSTART / LOCATION），只取未来 400 天内、最多 500 条 */
function parseIcs(text, now = Date.now()) {
  const out = [];
  const blocks = unfoldIcs(text).split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const body = b.split('END:VEVENT')[0];
    const get = (k) => { const m = new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm').exec(body); return m ? m[1].trim() : ''; };
    const start = parseIcsDate(get('DTSTART'));
    if (!Number.isFinite(start)) continue;
    if (start < now - DAY || start > now + 400 * DAY) continue;
    const title = clampStr(get('SUMMARY').replace(/\\([,;nN\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)), 80) || '未命名日程';
    out.push({ title, start, location: clampStr(get('LOCATION').replace(/\\/g, ''), 60) });
    if (out.length >= 500) break;
  }
  return out;
}

// ------------------------------------------------------------------ 取色
function hex(r, g, b) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
function sat(c) { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; }
function mix(a, b, t) { return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t); }

/** RGBA/BGRA 像素 → 主色（简易 k-means，k=4）。返回按「占比×饱和度」排序的颜色 */
function dominantColors(pixels, { bgra = false, k = 4 } = {}) {
  const pts = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const c = bgra ? [pixels[i + 2], pixels[i + 1], pixels[i]] : [pixels[i], pixels[i + 1], pixels[i + 2]];
    pts.push(c);
  }
  if (!pts.length) return [];
  let cents = [];
  for (let j = 0; j < k; j++) cents.push(pts[Math.floor(((j + 0.5) / k) * pts.length)].slice());
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 8; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      cents.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      assign[i] = best; const s = sums[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    cents = sums.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[j]));
  }
  const counts = cents.map((_, j) => assign.filter((a) => a === j).length / pts.length);
  return cents.map((c, j) => ({ rgb: c, share: counts[j], hex: hex(...c) }))
    .filter((c) => c.share > 0.02)
    .sort((a, b) => b.share * (0.35 + sat(b.rgb)) - a.share * (0.35 + sat(a.rgb)));
}

/** 主色 → 方块仔调色板（body1 亮 / body2 主 / body3 暗，眼睛取最暗色） */
function paletteFromColors(colors) {
  const main = (colors[0] && colors[0].rgb) || [255, 138, 80];
  const darkest = colors.slice().sort((a, b) => lum(a.rgb) - lum(b.rgb))[0];
  let eye = darkest && lum(darkest.rgb) < 90 ? darkest.rgb : mix(main, [0, 0, 0], 0.82);
  if (lum(eye) > 90) eye = mix(eye, [0, 0, 0], 0.7);
  return {
    body1: hex(...mix(main, [255, 255, 255], 0.55)),
    body2: hex(...main),
    body3: hex(...mix(main, [0, 0, 0], 0.32)),
    eye: hex(...eye),
    pupil: hex(...mix(eye, [0, 0, 0], 0.55)),
    blush: hex(...mix(main, [255, 140, 160], 0.6)),
    rim: hex(...mix(main, [255, 255, 255], 0.8)),
    glow: `rgba(${main.map(Math.round).join(',')},.45)`,
  };
}

const COLOR_WORDS = [
  [/粉|樱|pink|rosa|rose/i, [255, 150, 190]], [/红|red|rouge|rot|rosso|赤|빨/i, [232, 64, 60]],
  [/橙|橘|orange|arancio|オレンジ|주황/i, [255, 128, 60]], [/黄|金|yellow|gold|gelb|jaune|giallo|黄色|노랑/i, [255, 204, 51]],
  [/绿|薄荷|green|grün|vert|verde|緑|초록|mint/i, [110, 200, 120]], [/青|天蓝|cyan|teal|aqua/i, [70, 200, 210]],
  [/蓝|blue|blau|bleu|blu|青い|파랑/i, [80, 130, 240]], [/紫|purple|violet|lila|viola|보라/i, [150, 110, 240]],
  [/黑|暗|black|schwarz|noir|nero|黒|검/i, [50, 52, 70]], [/白|雪|white|weiß|blanc|bianco|白い|흰/i, [245, 245, 250]],
  [/灰|银|gray|grey|silver|grau|gris|grigio/i, [170, 175, 185]], [/棕|咖啡|巧克力|brown|braun|marron|marrone|茶色/i, [150, 95, 60]],
];
const ACCESSORY_WORDS = [
  [/猫|cat|katze|chat|gatto|ねこ|고양이/i, { ears: 'cat', tail: 'cat' }], [/兔|bunny|rabbit|hase|lapin|coniglio|うさぎ|토끼/i, { ears: 'bunny', tail: 'puff' }],
  [/熊|bear|bär|ours|orso|くま|곰/i, { ears: 'bear' }], [/花|flower|blume|fleur|fiore|花|꽃/i, { hat: 'flower' }],
  [/魔法|巫师|wizard|magier|sorcier|mago/i, { hat: 'wizard' }], [/厨|chef|koch|cuoco/i, { hat: 'chef' }],
  [/天使|光环|angel|halo|engel|ange/i, { hat: 'halo' }], [/机器|robot|赛博|cyber/i, { ears: 'antenna', hat: 'visor' }],
  [/圣诞|christmas|santa|weihnacht|noël|natale/i, { hat: 'santa' }], [/叶|leaf|blatt|feuille|foglia/i, { hat: 'leaf' }],
];

/** 从 hex 还原 rgb */
function rgbOf(h) {
  const s = String(h || '#000').replace('#', '');
  const v = s.length === 3 ? s.split('').map((x) => x + x).join('') : s;
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
}

/** 只保留中心区域（避开背景） */
function centerCrop(bitmap, size, ratio) {
  const src = Buffer.isBuffer(bitmap) ? bitmap : Buffer.from(bitmap);
  const side = Math.max(1, Math.floor(size * ratio));
  const start = Math.floor((size - side) / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const si = ((y + start) * size + (x + start)) * 4;
      const di = (y * side + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}

/** 一个主色 → 4 个风格化调色板，让用户挑 */
function paletteVariants(base) {
  const tweak = (p, amount, target) => {
    const b1 = mix(rgbOf(p.body1), target, amount);
    const b2 = mix(rgbOf(p.body2), target, amount);
    const b3 = mix(rgbOf(p.body3), target, amount);
    return { ...p, body1: hex(...b1), body2: hex(...b2), body3: hex(...b3), glow: 'rgba(' + b2.map(Math.round).join(',') + ',.45)' };
  };
  return [
    { label: '原色', palette: base },
    { label: '柔和', palette: tweak(base, 0.34, [255, 255, 255]) },
    { label: '鲜明', palette: tweak(base, 0.16, rgbOf(base.body2).map((v) => (v > 127 ? 255 : 0))) },
    { label: '夜行', palette: tweak(base, 0.45, [24, 26, 40]) },
  ];
}

function skinFromText(desc) {
  const text = String(desc || '');
  const hits = [];
  for (const [re, c] of COLOR_WORDS) { const m = re.exec(text); if (m) hits.push({ at: m.index, c }); }
  hits.sort((a, b) => a.at - b.at);
  const colors = hits.length ? hits.map((h) => ({ rgb: h.c, share: 1 })) : [{ rgb: [255, 138, 80], share: 1 }];
  const accessory = {};
  for (const [re, a] of ACCESSORY_WORDS) if (re.test(text)) Object.assign(accessory, a);
  const held = (text.match(/\p{Extended_Pictographic}/u) || [])[0];
  if (held) accessory.held = held;
  return { palette: paletteFromColors(colors), accessory, matched: hits.length };
}

const VOICE_PRESETS = [
  { id: 'default', name: '默认方块仔', rate: 1.05, pitch: 1.12 },
  { id: 'kid', name: '奶声奶气', rate: 1.12, pitch: 1.45 },
  { id: 'calm', name: '温柔低音', rate: 0.92, pitch: 0.85 },
  { id: 'robot', name: '机器人', rate: 1.0, pitch: 0.6 },
  { id: 'lively', name: '元气满满', rate: 1.25, pitch: 1.3 },
];

const LETTER_TEMPLATES = [
  (c) => `亲爱的${c.me}：\n\n这个月我在桌面上偷偷看着你们俩，已经在一起 ${c.days} 天啦。${c.partner}每次上线，你都会先戳我一下，我都记得。\n\n${c.highlight}\n\n下个月也要一起好好吃饭、好好专注、好好相爱。\n\n—— 永远替你们保管小秘密的 方块仔`,
  (c) => `给${c.me}和${c.partner}：\n\n${c.month}的风有点凉，但你们的恋爱值一直是热乎乎的。第 ${c.days} 天，我想说：谢谢你们让我当见证人。\n\n${c.highlight}\n\n记得今天抱一下对方。\n\n—— 方块仔（偷偷脸红中）`,
  (c) => `${c.me}：\n\n听说相爱的人会越来越像。${c.partner}最近说话的语气，越来越像你了哦。\n\n这是你们在一起的第 ${c.days} 天。${c.highlight}\n\n我会一直在桌角陪着你们。\n\n—— 你们的方块仔`,
];

class PaidFeatures {
  /**
   * @param {object} rt  运行时（can / sendPetEvent / applySettings / settings / couplePlus / ai）
   * @param {object} opts { dir, clipboard, nativeImage, now }
   */
  constructor(rt, opts = {}) {
    this.rt = rt;
    this.dir = opts.dir || '.';
    this.clipboard = opts.clipboard || null;
    this.nativeImage = opts.nativeImage || null;
    this.now = opts.now || (() => Date.now());
    this.file = path.join(this.dir, 'cubbit-paid.json');
    this.albumDir = path.join(this.dir, 'couple-album');
    this.voiceDir = path.join(this.dir, 'voice-samples');
    this.data = this._load();
    this.pomo = null;
    this._lastClip = '';
    this._timers = [];
  }

  _load() {
    const base = { events: [], clips: [], notes: [], focusLog: {}, summaryOn: '', customSkins: [], voice: { preset: 'default', samples: [] }, album: [], letters: [], clipboardOn: false, summaryHour: 21 };
    try { return Object.assign(base, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { return base; }
  }
  _save() {
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data)); fs.renameSync(this.file + '.tmp', this.file); } catch { /* 磁盘异常时不影响主流程 */ }
  }
  can(f) { try { return !!this.rt.can(f); } catch { return false; } }
  say(text, emoji) { try { this.rt.sendPetEvent('say', { text, emoji }); } catch { /* ignore */ } }
  locked(feature, message) { return { ok: false, code: 'FEATURE_LOCKED', feature, message }; }

  start() {
    this._timers.push(setInterval(() => this.tick(), 20000));
    // v2.2：剪贴板轮询随空闲降频、睡眠暂停
    if (this.rt && this.rt.power) { this.rt.power.every('clipboard', () => this.pollClipboard(), require('./power-governor').PERIODS.clipboard); this._powerLoop = true; }
    else this._timers.push(setInterval(() => this.pollClipboard(), 1500));
  }
  stop() { if (this._powerLoop && this.rt.power) this.rt.power.cancel('clipboard'); for (const t of this._timers) clearInterval(t); this._timers = []; if (this.pomo && this.pomo.timer) clearTimeout(this.pomo.timer); }

  // ================================================================ 办公助手
  addEvent({ title, start, remindMin = 10 } = {}) {
    if (!this.can('office_pro')) return this.locked('office_pro', '会议/日程提醒是完整版功能');
    const t = Number(start) || Date.parse(start);
    if (!Number.isFinite(t)) return { ok: false, code: 'BAD_TIME', message: '时间格式不对' };
    const ev = { id: uid('ev'), title: clampStr(title, 80) || '会议', start: t, remindMin: Math.max(0, Math.min(120, Number(remindMin) || 10)), notified: false, source: 'local' };
    this.data.events.push(ev);
    this.data.events.sort((a, b) => a.start - b.start);
    this._save();
    return { ok: true, event: ev };
  }
  importIcs({ text, remindMin = 10 } = {}) {
    if (!this.can('office_pro')) return this.locked('office_pro', '.ics 日历导入是完整版功能');
    const list = parseIcs(text, this.now());
    const seen = new Set(this.data.events.map((e) => e.title + '@' + e.start));
    let added = 0;
    for (const e of list) {
      if (seen.has(e.title + '@' + e.start)) continue;
      this.data.events.push({ id: uid('ev'), ...e, remindMin, notified: false, source: 'ics' });
      added++;
    }
    this.data.events.sort((a, b) => a.start - b.start);
    this._save();
    return { ok: true, added, total: list.length };
  }
  removeEvent({ id }) { this.data.events = this.data.events.filter((e) => e.id !== id); this._save(); return { ok: true }; }
  upcoming(limit = 20) { const now = this.now(); return this.data.events.filter((e) => e.start > now - 3600000).slice(0, limit); }

  /** 定时检查：会议提醒、过期清理、晚间总结、每月情书 */
  tick() {
    const now = this.now();
    let dirty = false;
    if (this.can('office_pro')) {
      for (const e of this.data.events) {
        if (e.notified) continue;
        const left = e.start - now;
        if (left <= e.remindMin * 60000 && left > -5 * 60000) {
          e.notified = true; dirty = true;
          const min = Math.max(0, Math.round(left / 60000));
          this.say(min > 0 ? `${min} 分钟后：「${e.title}」${e.location ? ' @' + e.location : ''}，准备一下吧～` : `「${e.title}」开始啦！`, '📅');
        }
      }
      const d = new Date(now);
      const today = localDay(d);
      if (d.getHours() >= (this.data.summaryHour || 21) && this.data.summaryOn !== today) {
        this.data.summaryOn = today; dirty = true;
        const s = this.dailySummary();
        if (s.ok) this.say(s.text, '🌙');
      }
    }
    const before = this.data.events.length;
    this.data.events = this.data.events.filter((e) => e.start > now - 2 * DAY);
    if (before !== this.data.events.length) dirty = true;
    if (this.can('couple_premium')) {
      const mk = monthKey(new Date(now));
      if (!this.data.letters.some((l) => l.month === mk) && this._coupleCtx().paired) {
        this.writeLetter({ auto: true }).catch(() => {});
      }
    }
    if (dirty) this._save();
  }

  pollClipboard() {
    if (!this.data.clipboardOn || !this.clipboard) return;
    let text = '';
    try { text = this.clipboard.readText() || ''; } catch { return; }
    if (!text || text === this._lastClip) return;
    this._lastClip = text;
    this.addClip(text);
  }
  addClip(text) {
    const t = String(text).slice(0, MAX_CLIP_LEN);
    if (!t.trim()) return;
    this.data.clips = [{ id: uid('c'), text: t, at: this.now() }, ...this.data.clips.filter((c) => c.text !== t)];
    const cap = this.can('office_pro') ? PRO_CLIP : FREE_CLIP;
    this.data.clips = this.data.clips.slice(0, cap);
    this._save();
  }
  copyClip({ id }) {
    const c = this.data.clips.find((x) => x.id === id);
    if (!c) return { ok: false, message: '这条记录已经没有了' };
    this._lastClip = c.text;
    try { this.clipboard && this.clipboard.writeText(c.text); } catch { /* ignore */ }
    return { ok: true };
  }

  addNote({ text } = {}) {
    const t = clampStr(text, 500);
    if (!t) return { ok: false, message: '写点什么吧' };
    const n = { id: uid('n'), text: t, at: this.now() };
    this.data.notes.unshift(n);
    this.data.notes = this.data.notes.slice(0, 500);
    this._save();
    this.say('灵感记下了 💡 「' + t.slice(0, 18) + (t.length > 18 ? '…' : '') + '」', '💡');
    return { ok: true, note: n };
  }

  /** 番茄钟进阶：长短休息循环 + 任务标签 + 计入专注统计（普通 25/5 免费，自定义参数需完整版） */
  pomoStart({ work = 25, short = 5, long = 15, rounds = 4, task = '' } = {}) {
    const custom = Number(work) !== 25 || Number(short) !== 5 || Number(long) !== 15 || Number(rounds) !== 4;
    if (custom && !this.can('office_pro')) return this.locked('office_pro', '自定义番茄节奏是完整版功能，免费版可用 25/5 标准番茄');
    this.pomoStop(true);
    const clampMin = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Number(v) || d));
    this.pomo = { work: clampMin(work, 1, 120, 25), short: clampMin(short, 1, 30, 5), long: clampMin(long, 1, 60, 15), rounds: clampMin(rounds, 1, 8, 4), task: clampStr(task, 40), round: 1, phase: 'work', endsAt: 0, timer: null };
    this._pomoPhase();
    return { ok: true, pomo: this.pomoState() };
  }
  _pomoPhase() {
    const p = this.pomo; if (!p) return;
    const min = p.phase === 'work' ? p.work : p.phase === 'long' ? p.long : p.short;
    p.endsAt = this.now() + min * 60000;
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => this.pomoAdvance(), min * 60000);
    if (p.timer.unref) p.timer.unref();
    this.say(p.phase === 'work' ? `第 ${p.round}/${p.rounds} 个番茄开始${p.task ? '：' + p.task : ''}，${min} 分钟专注！` : p.phase === 'long' ? `一整组完成！长休息 ${min} 分钟～` : `休息 ${min} 分钟，起来动动～`, p.phase === 'work' ? '🍅' : '☕');
  }
  pomoAdvance() {
    const p = this.pomo; if (!p) return;
    if (p.phase === 'work') {
      this.logFocus(p.work, p.task);
      p.phase = p.round >= p.rounds ? 'long' : 'short';
    } else if (p.phase === 'long') {
      this.pomo = null; this.say('这组番茄全部完成，太厉害了！', '🏆'); return;
    } else { p.round++; p.phase = 'work'; }
    this._pomoPhase();
  }
  pomoStop(silent) { if (this.pomo && this.pomo.timer) clearTimeout(this.pomo.timer); const had = !!this.pomo; this.pomo = null; if (had && !silent) this.say('番茄钟停下了，休息一下也好', '🍅'); return { ok: true }; }
  pomoState() { const p = this.pomo; return p ? { phase: p.phase, round: p.round, rounds: p.rounds, task: p.task, leftSec: Math.max(0, Math.round((p.endsAt - this.now()) / 1000)), work: p.work } : null; }

  logFocus(minutes, task) {
    const day = localDay(new Date(this.now()));
    const log = this.data.focusLog[day] || { minutes: 0, sessions: 0, tasks: {} };
    log.minutes += Math.round(Number(minutes) || 0); log.sessions++;
    if (task) log.tasks[task] = (log.tasks[task] || 0) + Math.round(Number(minutes) || 0);
    this.data.focusLog[day] = log;
    const keys = Object.keys(this.data.focusLog).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete this.data.focusLog[k];
    this._save();
  }

  /** 晚间总结：番茄 + 原专注模块的分钟数 + 今天会议数 + 速记数 */
  dailySummary() {
    if (!this.can('office_pro')) return this.locked('office_pro', '每日专注总结是完整版功能');
    const d = new Date(this.now());
    const day = localDay(d);
    const log = this.data.focusLog[day] || { minutes: 0, sessions: 0, tasks: {} };
    let extra = 0;
    try { const st = this.rt.focusTodayMinutes && this.rt.focusTodayMinutes(); extra = Number(st) || 0; } catch { /* ignore */ }
    const minutes = log.minutes + extra;
    const meetings = this.data.events.filter((e) => localDay(new Date(e.start)) === day).length;
    const notes = this.data.notes.filter((n) => localDay(new Date(n.at)) === day).length;
    const top = Object.entries(log.tasks).sort((a, b) => b[1] - a[1])[0];
    const h = Math.floor(minutes / 60), m = minutes % 60;
    const dur = h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
    const text = minutes > 0
      ? `今日总结：专注 ${dur}（${log.sessions} 个番茄）${top ? '，最投入的是「' + top[0] + '」' : ''}；会议 ${meetings} 个，灵感 ${notes} 条。辛苦啦，早点休息～`
      : `今日总结：今天还没有专注记录${meetings ? '，开了 ' + meetings + ' 个会' : ''}${notes ? '，记了 ' + notes + ' 条灵感' : ''}。明天一起加油！`;
    return { ok: true, day, minutes, sessions: log.sessions, meetings, notes, top: top ? top[0] : '', text };
  }

  officeView() {
    const pro = this.can('office_pro');
    return {
      pro,
      events: this.upcoming(30),
      clips: this.data.clips.slice(0, pro ? PRO_CLIP : FREE_CLIP).map((c) => ({ ...c, text: c.text.slice(0, 300) })),
      clipCap: pro ? PRO_CLIP : FREE_CLIP,
      clipboardOn: !!this.data.clipboardOn,
      notes: this.data.notes.slice(0, 50),
      pomo: this.pomoState(),
      summaryHour: this.data.summaryHour || 21,
      week: Object.entries(this.data.focusLog).sort().slice(-7).map(([d, v]) => ({ day: d, minutes: v.minutes })),
    };
  }

  // ================================================================ 会员
  memberView() {
    const member = this.can('member_perks');
    const catalog = require('../shared/catalog');
    const mk = monthKey(new Date(this.now()));
    const monthly = catalog.SKINS.filter((s) => s.memberMonth).map((s) => ({ id: s.id, name: s.name, month: s.memberMonth, current: s.memberMonth === mk, unlocked: member }));
    return {
      member,
      perks: [
        { id: 'ai', name: '无限 AI 对话', on: this.can('ai_unlimited'), works: true },
        { id: 'memory', name: '长期记忆不限条数', on: member, works: true },
        { id: 'skins', name: '每月一套会员新皮肤', on: member, works: true },
        { id: 'sync', name: '云同步（多设备）', on: member, works: false, note: '需要上线同步服务器；目前可用「数据与备份」导出/导入' },
      ],
      monthly,
    };
  }
  cloudSync() {
    if (!this.can('member_perks')) return this.locked('member_perks', '云同步是会员权益');
    return { ok: false, code: 'NEEDS_SERVICE', needsService: true, message: '云同步需要正式的同步服务器，上线后自动启用；现在可以先用「数据与备份」导出' };
  }

  // ================================================================ 角色定制
  customFromPhoto({ dataUrl, name, save = false } = {}) {
    if (!this.can('custom_character')) return this.locked('custom_character', '角色定制需要单独购买，请在「会员与商店」购买');
    if (!this.nativeImage || !/^data:image\/(png|jpe?g|webp);base64,/.test(String(dataUrl || ''))) return { ok: false, message: '请选择 PNG / JPG 图片' };
    let img = this.nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return { ok: false, message: '图片读不出来，换一张试试' };
    img = img.resize({ width: 48, height: 48, quality: 'good' });
    // 只取中间 72% 区域，避开背景（2026-11-04 升级）
    const bitmap = img.toBitmap();
    const colors = dominantColors(centerCrop(bitmap, 48, 0.72), { bgra: true, k: 5 });
    const base = paletteFromColors(colors);
    const candidates = paletteVariants(base);
    if (save) return this._saveCustom({ name: (clampStr(name, 20) || '照片方块仔') + ' · ' + candidates[0].label, palette: candidates[0].palette, accessory: {}, source: 'photo', swatches: colors.slice(0, 4).map((c) => c.hex) });
    return { ok: true, candidates, swatches: colors.slice(0, 4).map((c) => c.hex) };
  }

  /** 用户从 4 个候选里挑一个，正式保存 */
  saveCustomSkin({ name, palette, swatches, variant } = {}) {
    if (!this.can('custom_character')) return this.locked('custom_character', '角色定制需要单独购买，请在「会员与商店」购买');
    if (!palette || !palette.body1) return { ok: false, message: '颜色数据不对，重新生成一次' };
    return this._saveCustom({ name: clampStr(name, 20) || '我的方块仔', palette, accessory: {}, source: 'photo', swatches: (swatches || []).slice(0, 4), variant: clampStr(variant, 8) || '' });
  }
  customFromText({ text, name } = {}) {
    if (!this.can('custom_character')) return this.locked('custom_character', '角色定制需要单独购买，请在「会员与商店」购买');
    const t = clampStr(text, 200);
    if (!t) return { ok: false, message: '描述一下你想要的方块仔吧，比如「粉色兔耳朵，拿着🍓」' };
    const r = skinFromText(t);
    return this._saveCustom({ name: clampStr(name, 20) || t.slice(0, 10), palette: r.palette, accessory: r.accessory, source: 'text', prompt: t, matched: r.matched });
  }
  _saveCustom(skin) {
    const s = { id: uid('cs'), at: this.now(), ...skin };
    this.data.customSkins.unshift(s);
    this.data.customSkins = this.data.customSkins.slice(0, 12);
    this._save();
    return { ok: true, skin: s, aiImage: { available: false, note: 'AI 生图服务接入后，可把同一张照片/描述生成完整立绘' } };
  }
  applyCustom({ id }) {
    if (!this.can('custom_character')) return this.locked('custom_character', '角色定制需要单独购买');
    const s = this.data.customSkins.find((x) => x.id === id);
    if (!s) return { ok: false, message: '找不到这个定制皮肤' };
    const res = this.rt.applySettings({ customColors: s.palette });
    return res && res.ok === false ? res : { ok: true };
  }
  removeCustom({ id }) { this.data.customSkins = this.data.customSkins.filter((x) => x.id !== id); this._save(); return { ok: true }; }

  setVoicePreset({ id }) {
    if (!this.can('custom_character')) return this.locked('custom_character', '专属声音属于角色定制');
    const p = VOICE_PRESETS.find((v) => v.id === id);
    if (!p) return { ok: false, message: '没有这个音色' };
    this.data.voice.preset = p.id; this._save();
    this.rt.applySettings({ voiceRate: p.rate, voicePitch: p.pitch });
    return { ok: true, preset: p };
  }
  saveVoiceSample({ dataUrl, seconds } = {}) {
    if (!this.can('custom_character')) return this.locked('custom_character', '专属声音属于角色定制');
    const m = /^data:audio\/(webm|ogg|wav)[^,]*;base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) return { ok: false, message: '录音格式不支持' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) return { ok: false, message: '单段录音请控制在 30 秒以内' };
    fs.mkdirSync(this.voiceDir, { recursive: true });
    const id = uid('vs');
    fs.writeFileSync(path.join(this.voiceDir, id + '.' + m[1]), buf);
    this.data.voice.samples.unshift({ id, ext: m[1], seconds: Math.round(Number(seconds) || 0), at: this.now() });
    this.data.voice.samples = this.data.voice.samples.slice(0, 10);
    this._save();
    return { ok: true, count: this.data.voice.samples.length, clone: { available: false, note: '声音克隆服务接入后，用这些样本生成你的专属声音；现在先用音色预设' } };
  }
  customView() {
    return { unlocked: this.can('custom_character'), skins: this.data.customSkins, voice: { preset: this.data.voice.preset, samples: this.data.voice.samples.length, presets: VOICE_PRESETS } };
  }

  // ================================================================ 情侣进阶
  _coupleCtx() {
    let snap = {};
    try { snap = (this.rt.couplePlus && this.rt.couplePlus.snapshot()) || {}; } catch { /* ignore */ }
    const s = (this.rt.settings && this.rt.settings.get && this.rt.settings.get('userName')) || '';
    return { paired: !!snap.paired, partner: snap.partnerName || 'TA', days: snap.days || 0, me: s || '你' };
  }
  addAlbum({ title, note, date, photo } = {}) {
    if (!this.can('couple_premium')) return this.locked('couple_premium', '纪念日相册是情侣年卡权益');
    const entry = { id: uid('al'), title: clampStr(title, 40) || '我们的一天', note: clampStr(note, 500), date: /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : localDay(new Date(this.now())), photo: '', at: this.now() };
    if (photo) {
      if (!this.nativeImage || !/^data:image\/(png|jpe?g|webp);base64,/.test(String(photo))) return { ok: false, message: '照片格式不支持' };
      let img = this.nativeImage.createFromDataURL(photo);
      if (img.isEmpty()) return { ok: false, message: '照片读不出来' };
      const sz = img.getSize();
      if (sz.width > 1000) img = img.resize({ width: 1000, quality: 'good' });
      fs.mkdirSync(this.albumDir, { recursive: true });
      entry.photo = entry.id + '.jpg';
      fs.writeFileSync(path.join(this.albumDir, entry.photo), img.toJPEG(85));
    }
    this.data.album.unshift(entry);
    this.data.album.sort((a, b) => (a.date < b.date ? 1 : -1));
    this._save();
    return { ok: true, entry };
  }
  removeAlbum({ id }) {
    const e = this.data.album.find((x) => x.id === id);
    if (e && e.photo) { try { fs.unlinkSync(path.join(this.albumDir, e.photo)); } catch { /* ignore */ } }
    this.data.album = this.data.album.filter((x) => x.id !== id); this._save(); return { ok: true };
  }
  async writeLetter({ auto = false, useAi = true } = {}) {
    if (!this.can('couple_premium')) return this.locked('couple_premium', '每月情书是情侣年卡权益');
    const c = this._coupleCtx();
    const d = new Date(this.now());
    const mk = monthKey(d);
    const recent = this.data.album[0];
    const highlight = recent ? `我还记得「${recent.title}」那天（${recent.date}），${recent.note ? recent.note.slice(0, 40) : '你笑得特别开心'}。` : '你们一起完成的每个小任务，我都悄悄记在小本本上了。';
    const ctx = { ...c, month: `${d.getMonth() + 1} 月`, highlight };
    let text = '';
    let source = 'template';
    if (useAi && this.rt.ai && typeof this.rt.ai.status === 'function' && this.rt.ai.status().ready) {
      try {
        const r = await this.rt.ai.chat(`请以桌面宠物「方块仔」的口吻，给一对情侣写一封 150 字左右的中文月度情书。在一起第 ${c.days} 天，另一半叫${c.partner}。素材：${highlight} 落款「方块仔」。`);
        const t = r && (r.text || r.reply || (r.message && r.message.text));
        if (r && r.ok && t && t.length > 30) { text = String(t).slice(0, 800); source = 'ai'; }
      } catch { /* 回落模板 */ }
    }
    if (!text) text = LETTER_TEMPLATES[(d.getMonth() + c.days) % LETTER_TEMPLATES.length](ctx);
    const letter = { id: uid('lt'), month: mk, text, source, at: this.now() };
    this.data.letters = [letter, ...this.data.letters.filter((l) => !(auto && l.month === mk))].slice(0, 36);
    this._save();
    if (auto) this.say('叮咚～这个月的情书写好啦，去「情侣 → 情侣进阶」看看 💌', '💌');
    return { ok: true, letter };
  }
  coupleView() {
    const catalog = require('../shared/catalog');
    return {
      unlocked: this.can('couple_premium'),
      paired: this._coupleCtx().paired,
      album: this.data.album.map((a) => ({ ...a, photoPath: a.photo ? path.join(this.albumDir, a.photo) : '' })),
      letters: this.data.letters.slice(0, 12),
      outfits: catalog.SKINS.filter((s) => s.couplePremium).map((s) => ({ id: s.id, name: s.name, badge: s.badge })),
    };
  }

  // ================================================================ 商店
  storeView(lang) {
    const catalog = require('../shared/catalog');
    const lp = (x) => catalog.localizedPrice(x, lang);
    const pick = (p, extra) => ({ id: p.id, name: p.name, nameEn: p.nameEn, desc: p.desc, period: p.period, price: lp(p), perks: p.perks || [], ...extra });
    return {
      lang: lang || 'zh-CN',
      plans: catalog.PLANS.map((p) => pick(p)),
      addons: catalog.DLC.filter((d) => d.available !== false).map((d) => pick(d, { owned: !!(this.rt.license && this.rt.license.hasAddon && this.rt.license.hasAddon(d.id)) })),
      features: { office_pro: this.can('office_pro'), member_perks: this.can('member_perks'), custom_character: this.can('custom_character'), couple_premium: this.can('couple_premium') },
    };
  }

  // ================================================================ 入口
  async call(area, action, args = {}) {
    const a = args || {};
    const table = {
      office: { view: () => ({ ok: true, ...this.officeView() }), addEvent: () => this.addEvent(a), importIcs: () => this.importIcs(a), removeEvent: () => this.removeEvent(a), clipboard: () => { this.data.clipboardOn = !!a.on; this._save(); return { ok: true }; }, copyClip: () => this.copyClip(a), clearClips: () => { this.data.clips = []; this._save(); return { ok: true }; }, addNote: () => this.addNote(a), removeNote: () => { this.data.notes = this.data.notes.filter((n) => n.id !== a.id); this._save(); return { ok: true }; }, pomoStart: () => this.pomoStart(a), pomoStop: () => this.pomoStop(), summary: () => this.dailySummary(), summaryHour: () => { this.data.summaryHour = Math.max(17, Math.min(23, Number(a.hour) || 21)); this._save(); return { ok: true }; } },
      member: { view: () => ({ ok: true, ...this.memberView() }), sync: () => this.cloudSync() },
      custom: { view: () => ({ ok: true, ...this.customView() }), photo: () => this.customFromPhoto(a),
      save: () => this.saveCustomSkin(a), text: () => this.customFromText(a), apply: () => this.applyCustom(a), remove: () => this.removeCustom(a), voice: () => this.setVoicePreset(a), sample: () => this.saveVoiceSample(a) },
      couple: { view: () => ({ ok: true, ...this.coupleView() }), addAlbum: () => this.addAlbum(a), removeAlbum: () => this.removeAlbum(a), letter: () => this.writeLetter({ useAi: a.useAi !== false }), photo: () => this._albumPhoto(a) },
      store: { view: () => ({ ok: true, ...this.storeView(a.lang) }) },
    };
    const fn = table[area] && table[area][action];
    if (!fn) return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
    return fn();
  }
  _albumPhoto({ id }) {
    const e = this.data.album.find((x) => x.id === id);
    if (!e || !e.photo) return { ok: false };
    try { return { ok: true, dataUrl: 'data:image/jpeg;base64,' + fs.readFileSync(path.join(this.albumDir, e.photo)).toString('base64') }; } catch { return { ok: false }; }
  }
}

module.exports = { PaidFeatures, parseIcs, dominantColors, paletteFromColors, skinFromText, VOICE_PRESETS, localDay };
