/**
 * AI 长期记忆 + 主动关心 + 性格 + 亲密度（v2.4）
 *  - 记忆全部存在本机 userData/memory.json，不上传；设置里可查看 / 逐条删除 / 清空
 *  - 主动关心：按时段问候、深夜提醒、久坐提醒、天气（wttr.in，免 key，可关）、记忆回访
 *  - 性格：gentle 温柔 / tsundere 傲娇 / energetic 元气（同时作用于 AI 人设与本地台词）
 *  - 亲密度：互动累积点数 → 等级解锁台词与动作
 */
const fs = require('node:fs');
const path = require('node:path');

const PERSONALITIES = {
  gentle: { label: '温柔', prompt: '温柔体贴、说话轻轻的，总会先关心主人的感受' },
  tsundere: { label: '傲娇', prompt: '傲娇：嘴上说「才不是关心你」，其实非常在意主人，结尾常带「哼」' },
  energetic: { label: '元气', prompt: '元气满满、热情、爱用感叹号，像个小太阳一样给主人打气' },
};

const INTIMACY_LEVELS = [
  { level: 1, min: 0, name: '初识', unlock: '基础互动' },
  { level: 2, min: 30, name: '熟悉', unlock: '会叫你的名字、记住你的喜好' },
  { level: 3, min: 100, name: '朋友', unlock: '「抱抱」动作 + 撒娇台词' },
  { level: 4, min: 250, name: '好朋友', unlock: '「亲亲」动作 + 专属晚安' },
  { level: 5, min: 500, name: '亲密', unlock: '生日惊喜 + 特别心里话' },
  { level: 6, min: 1000, name: '灵魂伴侣', unlock: '隐藏庆祝舞 + 全部台词' },
];

/** 不同性格的台词模板；{x} 会被替换 */
const L = {
  morning: {
    gentle: ['早上好呀{name}，今天也慢慢来就好', '早安～记得吃早餐哦'],
    tsundere: ['哼，起这么晚…才、才不是在等你', '早。早餐吃了没？没吃我可要生气了'],
    energetic: ['早上好！！今天也是元气满满的一天！', '起床啦起床啦！太阳都晒屁股了！'],
  },
  lunch: {
    gentle: ['中午啦，好好吃顿饭再继续吧', '午饭时间到，别饿着自己'],
    tsundere: ['都中午了还不去吃饭？笨蛋', '快去吃饭，饿坏了我可不管你…才怪'],
    energetic: ['干饭时间！冲呀！', '午饭午饭！吃饱了下午才有力气！'],
  },
  dinner: {
    gentle: ['晚饭时间到了，今天辛苦啦', '天黑啦，记得吃晚饭哦'],
    tsundere: ['还在忙？晚饭都不吃了吗，哼', '去吃饭，我帮你看着电脑'],
    energetic: ['晚饭晚饭！今天吃什么好吃的？', '辛苦一天啦！吃顿好的奖励自己！'],
  },
  late: {
    gentle: ['已经很晚了，早点休息好不好？', '夜深了，眼睛也要休息了哦'],
    tsundere: ['都几点了还不睡！明天黑眼圈我可不管', '哼，熬夜的人最讨厌了…快去睡'],
    energetic: ['夜猫子！快充电（睡觉）啦！', '再不睡明天就没电啦！晚安晚安！'],
  },
  longWork: {
    gentle: ['你已经连续忙了 {min} 分钟了，站起来走走吧', '忙了好久啦，喝口水、伸个懒腰'],
    tsundere: ['坐了 {min} 分钟了，你是椅子成精了吗？起来动动', '又忙这么久…休息一下啦，笨蛋'],
    energetic: ['连续工作 {min} 分钟！起来做个伸展操吧！', '休息时间！喝水！走两步！'],
  },
  rain: {
    gentle: ['今天{city}可能下雨（{desc}），出门记得带伞', '外面好像要下雨，带把伞吧'],
    tsundere: ['要下雨了，别忘了带伞…我才没担心你', '下雨天还不带伞？淋湿了别找我'],
    energetic: ['今天有雨！雨伞装备上！', '下雨啦！带伞出门才是好孩子！'],
  },
  hot: {
    gentle: ['今天{city}有 {temp}°C，多喝水注意防暑', '好热呀，记得补水'],
    tsundere: ['{temp} 度！中暑了我可不背你', '这么热，快去喝水，哼'],
    energetic: ['{temp}°C 热热热！冰水走起！', '超热的一天！记得防晒补水！'],
  },
  cold: {
    gentle: ['今天{city}只有 {temp}°C，多穿一点', '天冷了，注意保暖哦'],
    tsundere: ['{temp} 度还穿那么少？感冒了别哭', '冷死了…你多穿点啦'],
    energetic: ['{temp}°C！裹成粽子出门吧！', '好冷！热乎乎的饮料来一杯！'],
  },
  weather: {
    gentle: ['今天{city}{desc}，{temp}°C，祝你有好心情', '今天天气{desc}，{temp}°C'],
    tsundere: ['今天{desc}，{temp} 度，知道了吧', '{desc}，{temp}°C。我只是顺便说一下'],
    energetic: ['今日天气：{desc}，{temp}°C！冲！', '{desc}，{temp}°C，好日子！'],
  },
  birthdayToday: {
    gentle: ['生日快乐，{name}！今天你是最重要的人', '🎂 生日快乐！愿你被温柔对待'],
    tsundere: ['生、生日快乐…礼物？我、我就是礼物！', '哼，今天特别允许你开心一整天！生日快乐！'],
    energetic: ['生日快乐！！！🎉🎂 今天你是主角！', 'Happy Birthday！要吃好多好多蛋糕！'],
  },
  birthdaySoon: {
    gentle: ['还有 {n} 天就是你的生日啦，我记着呢', '你的生日快到了（{n} 天），想怎么过？'],
    tsundere: ['还有 {n} 天你就生日了…我才没有偷偷数', '{n} 天后你生日，别以为我忘了'],
    energetic: ['倒计时 {n} 天！你的生日要来啦！', '还有 {n} 天！生日派对准备好了吗！'],
  },
  worry: {
    gentle: ['前几天你说「{x}」，现在好些了吗？', '还记得你说过「{x}」，我一直有点担心你'],
    tsundere: ['你之前说「{x}」…现在没事了吧？我只是随便问问', '「{x}」那件事，搞定了没？'],
    energetic: ['之前你说「{x}」，现在是不是满血复活啦？', '「{x}」那件事加油！我给你打气！'],
  },
  like: {
    gentle: ['要不要来点你喜欢的{x}？', '想到你喜欢{x}，我就开心'],
    tsundere: ['你不是喜欢{x}吗？去享受一下啦', '哼，我记得你喜欢{x}，才不是特意记的'],
    energetic: ['{x}时间到！你最爱的！', '来点{x}充充电吧！'],
  },
  remember: {
    gentle: ['我记住啦：{x}', '嗯，{x}，我会一直记得'],
    tsundere: ['…{x}，好啦好啦我记住了', '哼，{x}，这种事我当然记得住'],
    energetic: ['记住啦！{x}！', '收到！{x}，存进小脑袋里了！'],
  },
  levelUp: {
    gentle: ['我们的亲密度升到 Lv.{n}「{x}」了，好开心', '和你更亲近了一点（Lv.{n}）'],
    tsundere: ['亲密度 Lv.{n}…才、才没有很高兴', 'Lv.{n}「{x}」？哼，算你厉害'],
    energetic: ['亲密度 UP！Lv.{n}「{x}」！', '升级啦！我们是 Lv.{n} 的关系了！'],
  },
  intimate: {
    gentle: ['有你在，我每天都很安心', '谢谢你一直陪着我'],
    tsundere: ['我才没有很喜欢你…一点点而已', '你今天…还挺顺眼的'],
    energetic: ['最喜欢你啦！！', '和你在一起超开心的！'],
  },
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(tpl, vars = {}) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

function line(kind, personality, vars) {
  const group = L[kind] || {};
  const pool = group[personality] || group.gentle || [];
  if (!pool.length) return '';
  return fill(pick(pool), vars).replace(/\s{2,}/g, ' ').replace(/(，|,)\s*(，|,)/g, '，');
}

function normPersonality(p) {
  if (PERSONALITIES[p]) return p;
  if (p === 'warm') return 'gentle';
  if (p === 'sassy') return 'tsundere';
  return 'gentle';
}

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const EN_MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function cleanTail(s) {
  return String(s || '')
    .replace(/^(吃|喝|看|玩|听)?/, (m) => m)
    .replace(/[了的呀啊哦呢吧嘛～~!！。.,，?？\s]+$/g, '')
    .trim()
    .slice(0, 16);
}

/**
 * 从一句话里抽取记忆。纯函数，便于测试。
 * @returns {Array<{type:string,text:string,value?:string}>}
 */
function extractMemories(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const out = [];
  let m;
  // 生日
  m = s.match(/生日(?:是|在)?\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) {
    const mo = /\d/.test(m[1]) ? Number(m[1]) : CN_NUM[m[1]];
    const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push({ type: 'birthday', value: `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text: `你的生日是 ${mo} 月 ${d} 日` });
  } else {
    m = s.match(/birthday is (?:on )?(?:([a-z]{3})[a-z]*\.? (\d{1,2})|(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]{3})[a-z]*|(\d{1,2})[/.-](\d{1,2}))/i);
    if (m) {
      let mo;
      let d;
      if (m[1]) { mo = EN_MONTH[m[1].toLowerCase()]; d = Number(m[2]); }
      else if (m[3]) { d = Number(m[3]); mo = EN_MONTH[m[4].toLowerCase()]; }
      else { mo = Number(m[5]); d = Number(m[6]); }
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push({ type: 'birthday', value: `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text: `你的生日是 ${mo} 月 ${d} 日` });
    }
  }
  // 名字
  m = s.match(/(?:我叫|我的名字(?:是|叫)|叫我)\s*([\u4e00-\u9fa5A-Za-z]{1,8})/) || s.match(/(?:my name is|call me)\s+([A-Za-z]{2,16})/i);
  if (m) out.push({ type: 'name', value: m[1], text: `你叫${m[1]}` });
  // 不喜欢（先于喜欢，避免「不喜欢」被当成喜欢）
  m = s.match(/我(?:很|最|超|特别|有点)?(?:不喜欢|讨厌|受不了|怕)\s*([^，。,.!！?？]{1,16})/) || s.match(/I (?:really )?(?:don't like|do not like|hate|dislike|can't stand) ([^,.!?]{1,24})/i);
  if (m) out.push({ type: 'dislike', value: cleanTail(m[1]), text: `你不喜欢${cleanTail(m[1])}` });
  else {
    m = s.match(/我(?:很|最|超|特别|超级|挺)?(?:喜欢|爱吃|爱喝|爱看|爱玩|爱听)\s*([^，。,.!！?？]{1,16})/) || s.match(/I (?:really )?(?:like|love|enjoy) ([^,.!?]{1,24})/i);
    if (m && !/你/.test(m[1])) out.push({ type: 'like', value: cleanTail(m[1]), text: `你喜欢${cleanTail(m[1])}` });
  }
  // 烦恼 / 担心
  if (/(担心|焦虑|压力好?大|好累|很累|累死|烦死|好烦|难过|失眠|睡不着|紧张|害怕|不开心|伤心|生病|感冒|加班)/.test(s) || /\b(worried|stressed|anxious|exhausted|tired|sad|nervous|sick|can't sleep)\b/i.test(s)) {
    out.push({ type: 'worry', value: s.slice(0, 40), text: s.slice(0, 40) });
  }
  return out;
}

class Companion {
  /**
   * @param {object} rt AppRuntime
   * @param {{dir:string, fetch?:Function, now?:Function}} opts
   */
  constructor(rt, opts = {}) {
    this.rt = rt;
    this.file = path.join(opts.dir || '.', 'memory.json');
    this.fetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    this.now = opts.now || (() => Date.now());
    this.data = this._load();
    this._timer = null;
    this._workStart = 0;
    this._lastActive = 0;
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { items: Array.isArray(raw.items) ? raw.items : [], said: raw.said && typeof raw.said === 'object' ? raw.said : {}, weather: raw.weather || null };
    } catch {
      return { items: [], said: {}, weather: null };
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      /* ignore */
    }
  }

  get s() {
    return this.rt.settings.settings || {};
  }

  personality() {
    return normPersonality(this.s.petPersonality || this.s.aiPersonality);
  }

  // ------------------------------------------------------------ 记忆
  memories() {
    return this.data.items.slice().sort((a, b) => b.at - a.at);
  }

  remember(text) {
    if (this.s.memoryEnabled === false) return [];
    const found = extractMemories(text);
    const added = [];
    for (const f of found) {
      const now = this.now();
      if (f.type === 'birthday' || f.type === 'name') {
        this.data.items = this.data.items.filter((x) => x.type !== f.type);
      }
      if (this.data.items.some((x) => x.type === f.type && x.value === f.value)) continue;
      const item = { id: 'm' + now.toString(36) + Math.random().toString(36).slice(2, 5), type: f.type, value: f.value, text: f.text, at: now, followedAt: 0 };
      this.data.items.push(item);
      added.push(item);
    }
    // 会员：长期记忆上限 2000 条；其他 200 条
    let cap = 200;
    try { if (this.rt && this.rt.can && this.rt.can('member_perks')) cap = 2000; } catch { /* ignore */ }
    if (this.data.items.length > cap) this.data.items = this.data.items.slice(-cap);
    if (added.length) this._persist();
    return added;
  }

  forget(id) {
    if (id === 'all') this.data.items = [];
    else this.data.items = this.data.items.filter((x) => x.id !== id);
    this._persist();
    return { ok: true, items: this.memories() };
  }

  userName() {
    const n = this.data.items.find((x) => x.type === 'name');
    return n ? n.value : '';
  }

  /** 供 AI system prompt 使用的记忆摘要 */
  promptSummary() {
    if (this.s.memoryEnabled === false || !this.data.items.length) return '';
    const parts = this.memories().slice(0, 12).map((x) => x.text);
    return `你记得关于主人的这些事（自然地在合适时提起，不要一次全说）：${parts.join('；')}。`;
  }

  /** 聊天后：记下新事实并给出「我记住啦」的回应 */
  onUserChat(text) {
    const added = this.remember(text);
    this.add(3, 'chat');
    if (!added.length) return '';
    const first = added.find((x) => x.type !== 'worry');
    if (first) return line('remember', this.personality(), { x: first.text });
    return line('worry', this.personality(), { x: added[0].value }).replace(/^前几天你说|^之前你说|^你之前说|^还记得你说过/, '你说');
  }

  /** 记忆回访：生日 > 烦恼 > 喜好 */
  recallLine(now = new Date()) {
    const p = this.personality();
    const name = this.userName();
    const bday = this.data.items.find((x) => x.type === 'birthday');
    if (bday) {
      const [mo, d] = bday.value.split('-').map(Number);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let next = new Date(now.getFullYear(), mo - 1, d);
      if (next < today) next = new Date(now.getFullYear() + 1, mo - 1, d);
      const n = Math.round((next - today) / 86400000);
      const key = 'bday-' + next.getFullYear() + '-' + n;
      if (n === 0 && !this.data.said[key]) { this.data.said[key] = 1; this._persist(); return { kind: 'birthday', text: line('birthdayToday', p, { name }) }; }
      if (n > 0 && n <= 7 && !this.data.said[key]) { this.data.said[key] = 1; this._persist(); return { kind: 'birthday', text: line('birthdaySoon', p, { n }) }; }
    }
    const nowMs = now.getTime();
    const worry = this.data.items.find((x) => x.type === 'worry' && !x.followedAt && nowMs - x.at > 6 * 3600 * 1000 && nowMs - x.at < 10 * 86400000);
    if (worry) {
      worry.followedAt = nowMs;
      this._persist();
      return { kind: 'worry', text: line('worry', p, { x: worry.value.slice(0, 20) }) };
    }
    const likes = this.data.items.filter((x) => x.type === 'like');
    if (likes.length) return { kind: 'like', text: line('like', p, { x: pick(likes).value }) };
    return null;
  }

  // ------------------------------------------------------------ 亲密度
  intimacyState() {
    const raw = this.s.intimacy || {};
    return { points: Math.max(0, Number(raw.points) || 0), day: String(raw.day || ''), today: Math.max(0, Number(raw.today) || 0) };
  }

  level(points) {
    const pts = points === undefined ? this.intimacyState().points : points;
    let lv = 1;
    for (const l of INTIMACY_LEVELS) if (pts >= l.min) lv = l.level;
    return lv;
  }

  intimacySnapshot() {
    const st = this.intimacyState();
    const lv = this.level(st.points);
    const cur = INTIMACY_LEVELS[lv - 1];
    const next = INTIMACY_LEVELS[lv] || null;
    return {
      points: st.points,
      level: lv,
      name: cur.name,
      next: next ? { level: next.level, min: next.min, name: next.name } : null,
      progress: next ? Math.min(1, (st.points - cur.min) / (next.min - cur.min)) : 1,
      levels: INTIMACY_LEVELS.map((l) => ({ ...l, unlocked: lv >= l.level })),
    };
  }

  /** 加亲密度（每天最多 +60，防刷） */
  add(n = 1, _reason = '') {
    const st = this.intimacyState();
    const dd = new Date(this.now());
    const today = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
    if (st.day !== today) { st.day = today; st.today = 0; }
    const gain = Math.max(0, Math.min(n, 60 - st.today));
    if (!gain) return this.level(st.points);
    const before = this.level(st.points);
    st.points += gain;
    st.today += gain;
    this.rt.settings.patch({ intimacy: st });
    const after = this.level(st.points);
    if (after > before) {
      const info = INTIMACY_LEVELS[after - 1];
      this.rt.sendPetEvent('intimacy-up', { level: after, name: info.name, unlock: info.unlock, text: line('levelUp', this.personality(), { n: after, x: info.name }) });
    }
    return after;
  }

  // ------------------------------------------------------------ 主动关心
  slotFor(d) {
    const m = d.getHours() * 60 + d.getMinutes();
    if (m >= 7 * 60 && m < 10 * 60) return 'morning';
    if (m >= 11 * 60 + 30 && m < 13 * 60) return 'lunch';
    if (m >= 17 * 60 + 30 && m < 19 * 60 + 30) return 'dinner';
    if (m >= 23 * 60 + 30 || m < 4 * 60) return 'late';
    return '';
  }

  async fetchWeather() {
    if (this.s.weatherEnabled === false || !this.fetch) return null;
    const city = String(this.s.weatherCity || '').trim();
    const url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await this.fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'curl/8 Cubbit' } });
      clearTimeout(t);
      if (!res.ok) return null;
      const j = await res.json();
      const cur = (j.current_condition || [])[0] || {};
      const today = (j.weather || [])[0] || {};
      const hourly = Array.isArray(today.hourly) ? today.hourly : [];
      const rainChance = hourly.reduce((m, h) => Math.max(m, Number(h.chanceofrain) || 0), 0);
      const area = (((j.nearest_area || [])[0] || {}).areaName || [])[0];
      const desc = ((cur.lang_zh || [])[0] || {}).value || ((cur.weatherDesc || [])[0] || {}).value || '';
      const w = {
        at: this.now(),
        city: city || (area && area.value) || '',
        temp: Number(cur.temp_C),
        max: Number(today.maxtempC),
        min: Number(today.mintempC),
        desc,
        rainChance,
      };
      this.data.weather = w;
      this._persist();
      return w;
    } catch {
      return null;
    }
  }

  weatherLine(w) {
    if (!w || !Number.isFinite(w.temp)) return '';
    const p = this.personality();
    const ZH = { sunny: '晴', clear: '晴', 'partly cloudy': '多云', cloudy: '阴', overcast: '阴', mist: '薄雾', fog: '雾', haze: '霾', 'smoky haze': '霾', 'light rain': '小雨', rain: '雨', 'heavy rain': '大雨', 'patchy rain nearby': '局部小雨', 'light drizzle': '毛毛雨', thunderstorm: '雷雨', snow: '雪', 'light snow': '小雪' };
    let desc = String(w.desc || '').trim();
    if (desc && !/[\u4e00-\u9fff]/.test(desc)) desc = ZH[desc.toLowerCase()] || desc;
    const city = w.city ? (/^[\x00-\x7f]+$/.test(w.city) ? w.city + ' ' : w.city) : '';
    const vars = { city, temp: w.temp, desc };
    if (w.rainChance >= 60) return line('rain', p, vars);
    if ((w.max || w.temp) >= 31) return line('hot', p, { ...vars, temp: w.max || w.temp });
    if ((w.min || w.temp) <= 5) return line('cold', p, { ...vars, temp: w.min || w.temp });
    return line('weather', p, vars);
  }

  /** 由活动监视器调用：用户是否刚刚在操作电脑 */
  noteActivity(idleSeconds, now = this.now()) {
    if (idleSeconds > 300) {
      this._workStart = 0;
      return;
    }
    if (!this._workStart) this._workStart = now;
    this._lastActive = now;
  }

  /**
   * 每分钟调用一次；返回要说的话（或 null）。force 用于 QA 触发某一类。
   */
  async tick(now = new Date(), force = '') {
    if (this.s.proactiveCare === false && !force) return null;
    const p = this.personality();
    const p2 = (n) => String(n).padStart(2, '0');
    const day = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
    const said = this.data.said;
    const once = (key) => {
      if (said[key]) return false;
      said[key] = 1;
      const keys = Object.keys(said);
      if (keys.length > 300) for (const k of keys.slice(0, 100)) delete said[k];
      this._persist();
      return true;
    };
    const name = this.level() >= 2 ? this.userName() : '';
    // 1) 久坐
    const workMin = this._workStart ? Math.round((now.getTime() - this._workStart) / 60000) : 0;
    if (force === 'longWork' || workMin >= 90) {
      this._workStart = now.getTime();
      return { kind: 'longWork', emoji: '🧘', text: line('longWork', p, { min: force ? 90 : workMin }) };
    }
    // 2) 时段问候
    const slot = force && L[force] && ['morning', 'lunch', 'dinner', 'late'].includes(force) ? force : this.slotFor(now);
    if (slot && (force === slot || once(day + '-' + slot))) {
      let text = line(slot, p, { name: name ? name : '' });
      if (slot === 'morning') {
        const w = await this.fetchWeather();
        const wl = this.weatherLine(w);
        if (wl) text += ' ' + wl;
      }
      return { kind: slot, emoji: slot === 'late' ? '🌙' : slot === 'morning' ? '☀️' : '🍚', text };
    }
    if (force === 'weather') {
      const w = await this.fetchWeather();
      const wl = this.weatherLine(w);
      return wl ? { kind: 'weather', emoji: '🌦️', text: wl, weather: w } : { kind: 'weather', emoji: '🌦️', text: '', error: 'weather unavailable' };
    }
    // 3) 记忆回访（每 2 小时最多一次）
    const recallKey = day + '-recall-' + Math.floor(now.getHours() / 2);
    if (force === 'recall' || (Math.random() < 0.35 && !said[recallKey])) {
      const r = this.recallLine(now);
      if (r) {
        said[recallKey] = 1;
        this._persist();
        return { ...r, emoji: r.kind === 'birthday' ? '🎂' : r.kind === 'worry' ? '🫂' : '💛' };
      }
    }
    // 4) 亲密台词（Lv.4+ 偶尔）
    if (force === 'intimate' || (this.level() >= 4 && Math.random() < 0.08)) return { kind: 'intimate', emoji: '💗', text: line('intimate', p, {}) };
    return null;
  }

  start(intervalMs = 60 * 1000) {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.runTick().catch(() => {}), intervalMs);
  }

  async runTick(force = '') {
    const r = await this.tick(new Date(), force);
    if (r && r.text) this.rt.sendPetEvent('say', { text: r.text, emoji: r.emoji || '💛', priority: !!force || r.kind === 'birthday' || r.kind === 'late' });
    return r;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

module.exports = { Companion, PERSONALITIES, INTIMACY_LEVELS, extractMemories, line, normPersonality, LINES_BY_PERSONALITY: L };
