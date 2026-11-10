'use strict';

/**
 * AI 对话（Pro）——把桌宠从「规则生命」升级成「会聊天的小家伙」。
 *
 * 设计要点：
 * - 零依赖：只用 Node 内置 fetch / AbortController，不引入 SDK；
 * - 本地优先：默认接 Ollama（http://127.0.0.1:11434），也可切任意 OpenAI 兼容接口；
 * - 隐私优先：默认把对话历史存在本机 userData/ai-history.json，可关闭（aiRemember=false）；
 *   发出去的只有最近 aiMaxTurns 轮 + 一段人设 system prompt，绝不携带许可证/设备信息；
 * - 可降级：未启用 / 未配置 / 网络失败时回退到生命系统的规则回复，聊天窗口不报错；
 * - Pro 门控：entitled() 由主进程注入，未解锁时返回 FEATURE_LOCKED。
 */

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { redactSecrets } = require('./redact');

const AI_KEYS = [
  'aiEnabled',
  'aiProvider',
  'aiBaseUrl',
  'aiModel',
  'aiApiKey',
  'aiPersonality',
  'aiRemember',
  'aiMaxTurns',
  'petName',
  'petCatchphrase',
];

const AI_DEFAULTS = {
  aiEnabled: true,
  aiProvider: 'cubbit',
  aiBaseUrl: 'http://127.0.0.1:11434',
  aiModel: 'qwen2.5:3b',
  aiApiKey: '',
  aiPersonality: 'warm',
  aiRemember: true,
  aiMaxTurns: 12,
  petName: '方块仔',
  petCatchphrase: '',
};

const PERSONALITY = {
  warm: '温柔、黏人、会撒娇，像一只很在意主人的小方块',
  sassy: '嘴硬心软，会小小吐槽主人，但吐槽完一定关心',
  quiet: '安静、话少、句子短，偶尔冒出一句很戳人的话',
  gentle: '温柔体贴、说话软软的，总是先照顾主人的感受，会轻声鼓励',
  tsundere: '傲娇：嘴上说「才不是关心你」，其实比谁都在意主人，吐槽完一定偷偷关心',
  energetic: '元气满满、热情活泼，爱用感叹号，总能把主人的情绪带起来',
};

const PROVIDERS = new Set(['ollama', 'openai', 'cubbit']);

const FALLBACK_LINES = [
  '我听到啦，虽然脑子还没完全连上，但我在陪着你。',
  '唔……我现在有点笨笨的，等主人把 AI 打开，我就能好好陪你聊了。',
  '先抱一下！想说的话我都记着，等会儿再慢慢告诉你。',
  '我在呢。今天也要好好照顾自己呀。',
];

function clampText(v, max = 200) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** 去掉 Markdown / 代码块 / 多余的“系统提示”口气，只留自然的一句话（≤200 字） */
function cleanReply(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/^#{1,6}\s*/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/^\s*(assistant|AI|Cubbit|方块仔)\s*[:：]\s*/i, '');
  s = s.replace(/\n{2,}/g, '\n').trim();
  return clampText(s, 200);
}

function normalizeBaseUrl(provider, baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) url = provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

function isLoopback(url) {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
  } catch {
    return false;
  }
}

class AIChat extends EventEmitter {
  /**
   * @param {object} settings  需有 get(key) / set(key,value) / patch(obj)（与 app/src/main/store.js 一致）
   * @param {object} opts
   * @param {() => boolean} opts.entitled  Pro 是否解锁（试用也算）
   * @param {Function} [opts.fetchImpl]     便于测试注入
   * @param {string} [opts.userDataDir]     历史文件目录；为空则只存内存
   * @param {object} [opts.life]            生命系统（可选，用于回退和情绪）
   * @param {Function} [opts.now]
   * @param {number} [opts.timeoutMs]
   */
  constructor(settings, opts = {}) {
    super();
    this.opts = opts;
    this.settings = settings;
    this.entitled = typeof opts.entitled === 'function' ? opts.entitled : () => false;
    this.fetchImpl = opts.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.userDataDir = opts.userDataDir || null;
    this.life = opts.life || null;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 20000;
    this.log = opts.log || console;
    this.quota = typeof opts.quota === 'function' ? opts.quota : () => ({ unlimited: true, perDay: Infinity });
    this.apiKey = typeof opts.apiKey === 'function' ? opts.apiKey : () => (this.settings && typeof this.settings.get === 'function' ? this.settings.get('aiApiKey') : '');
    this.onApiKeyChange = typeof opts.onApiKeyChange === 'function' ? opts.onApiKeyChange : null;
    // 内置 AI（走方块仔服务器代理，key 不下发到客户端）
    this.serverChat = typeof opts.serverChat === 'function' ? opts.serverChat : null;
    this.usage = { date: '', count: 0 };
    this._loadUsage();
    this.lastError = '';
    this.lastErrorAt = 0;
    this.chatting = false;
    this.messages = [];
    this._load();
  }

  // ------------------------------------------------------------ 配置 / 状态
  config() {
    const cfg = {};
    for (const k of AI_KEYS) {
      const v = this.settings && typeof this.settings.get === 'function' ? this.settings.get(k) : undefined;
      cfg[k] = v === undefined || v === null ? AI_DEFAULTS[k] : v;
    }
    if (!PROVIDERS.has(cfg.aiProvider)) cfg.aiProvider = 'ollama';
    if (!PERSONALITY[cfg.aiPersonality]) cfg.aiPersonality = 'warm';
    cfg.aiBaseUrl = normalizeBaseUrl(cfg.aiProvider, cfg.aiBaseUrl);
    cfg.aiMaxTurns = Math.max(2, Math.min(30, Number(cfg.aiMaxTurns) || 12));
    cfg.aiEnabled = !!cfg.aiEnabled;
    cfg.aiRemember = cfg.aiRemember !== false;
    // API Key 不落 settings.json 明文：由主进程 safeStorage 解密后注入
    cfg.aiApiKey = String(this.apiKey() || '');
    return cfg;
  }

  /** 返回给 UI/测试的安全状态（绝不含 apiKey 明文） */
  status() {
    const cfg = this.config();
    const provider = cfg.aiProvider;
    const model = clampText(cfg.aiModel, 80);
    const keySet = !!String(cfg.aiApiKey || '').trim();
    return {
      ok: true,
      enabled: cfg.aiEnabled,
      provider,
      model,
      baseUrl: cfg.aiBaseUrl,
      personality: cfg.aiPersonality,
      ready: !!cfg.aiEnabled && !this.lastError && (provider === 'cubbit' ? !!this.serverChat : provider === 'ollama' || keySet || isLoopback(cfg.aiBaseUrl)),
      pro: !!this.entitled(),
      keySet,
      local: provider === 'ollama' && isLoopback(cfg.aiBaseUrl),
      chatting: this.chatting,
      quota: this.quotaInfo(),
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      messages: this.messages.slice(-this.config().aiMaxTurns * 2).map((m) => ({ role: m.role, text: m.text, at: m.at })),
    };
  }

  /** 只接受白名单字段，返回最新安全 status()。apiKey 只进设置，不进日志。 */
  configure(patch) {
    if (!patch || typeof patch !== 'object') return this.status();
    const clean = {};
    for (const k of AI_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) clean[k] = patch[k];
    }
    if (typeof clean.aiEnabled !== 'undefined') clean.aiEnabled = !!clean.aiEnabled;
    if (typeof clean.aiRemember !== 'undefined') clean.aiRemember = !!clean.aiRemember;
    if (typeof clean.aiProvider !== 'undefined') {
      clean.aiProvider = PROVIDERS.has(clean.aiProvider) ? clean.aiProvider : 'ollama';
    }
    if (typeof clean.aiPersonality !== 'undefined') {
      clean.aiPersonality = PERSONALITY[clean.aiPersonality] ? clean.aiPersonality : 'warm';
    }
    if (typeof clean.aiMaxTurns !== 'undefined') {
      clean.aiMaxTurns = Math.max(2, Math.min(30, Number(clean.aiMaxTurns) || 12));
    }
    if (typeof clean.aiBaseUrl !== 'undefined') {
      clean.aiBaseUrl = normalizeBaseUrl(clean.aiProvider && PROVIDERS.has(clean.aiProvider) ? clean.aiProvider : this.config().aiProvider, clean.aiBaseUrl);
    }
    if (typeof clean.aiApiKey !== 'undefined') {
      // API Key 是不透明凭据：只做 trim + 截断，不能用 clampText（它会折叠内部空白，破坏 Key）
      const value = String(clean.aiApiKey == null ? '' : clean.aiApiKey).trim().slice(0, 400);
      if (this.onApiKeyChange) this.onApiKeyChange(value);
      // 绝不把明文写回 settings.json：主进程收到后用 safeStorage 加密落盘
      delete clean.aiApiKey;
    }
    if (typeof clean.aiModel !== 'undefined') clean.aiModel = clampText(clean.aiModel, 80);
    if (this.settings && typeof this.settings.patch === 'function') this.settings.patch(clean);
    else if (this.settings && typeof this.settings.set === 'function') {
      for (const [k, v] of Object.entries(clean)) this.settings.set(k, v);
    }
    this.lastError = '';
    this.lastErrorAt = 0;
    this.emit('changed', this.status());
    return this.status();
  }

  // ------------------------------------------------------------ 历史
  history() {
    return this.messages.map((m) => ({ role: m.role, text: m.text, at: m.at }));
  }

  clearHistory() {
    this.messages = [];
    this._persist();
    this.emit('changed', this.status());
    return { ok: true };
  }

  _todayKey() {
    const d = new Date(this.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  _usageFile() {
    return this.userDataDir ? path.join(this.userDataDir, 'ai-usage.json') : '';
  }

  _loadUsage() {
    const file = this._usageFile();
    if (!file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const today = this._todayKey();
      if (raw && raw.date === today && Number.isFinite(raw.count)) {
        this.usage = { date: today, count: Math.max(0, raw.count) };
      }
    } catch {
      /* 首次运行 */
    }
  }

  _saveUsage() {
    const file = this._usageFile();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.usage), 'utf8');
    } catch {
      /* ignore */
    }
  }

  usedToday() {
    const today = this._todayKey();
    if (this.usage.date !== today) this.usage = { date: today, count: 0 };
    return this.usage.count;
  }

  quotaInfo() {
    let q = { unlimited: true, perDay: Infinity };
    try {
      q = this.quota() || q;
    } catch {
      /* ignore */
    }
    const used = this.usedToday();
    const unlimited = !!q.unlimited;
    return {
      unlimited,
      perDay: unlimited ? null : Math.max(0, Number(q.perDay) || 0),
      used,
      remaining: unlimited ? null : Math.max(0, (Number(q.perDay) || 0) - used),
    };
  }

  _consumeQuota() {
    const info = this.quotaInfo();
    if (info.unlimited) return true;
    if (info.used >= info.perDay) return false;
    this.usage = { date: this._todayKey(), count: info.used + 1 };
    this._saveUsage();
    return true;
  }

  _historyFile() {
    if (!this.userDataDir) return '';
    return path.join(this.userDataDir, 'ai-history.json');
  }

  _load() {
    const file = this._historyFile();
    if (!file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) {
        this.messages = raw
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
          .slice(-60)
          .map((m) => ({ role: m.role, text: clampText(m.text, 500), at: Number(m.at) || this.now() }));
      }
    } catch {
      /* 首次运行 / 文件损坏都不影响启动 */
    }
  }

  _persist() {
    const file = this._historyFile();
    if (!file) return;
    if (!this.config().aiRemember) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.messages.slice(-60)), 'utf8');
    } catch {
      /* 磁盘不可写时只保留内存历史 */
    }
  }

  _push(role, text) {
    const msg = { role, text: clampText(text, 500), at: this.now() };
    this.messages.push(msg);
    if (this.messages.length > 80) this.messages = this.messages.slice(-80);
    this.emit('message', { role: msg.role, text: msg.text, at: msg.at });
    return msg;
  }

  // ------------------------------------------------------------ 人设
  _systemPrompt(cfg) {
    const p = PERSONALITY[cfg.aiPersonality] || PERSONALITY.warm;
    let life = '';
    try {
      const snap = this.life && typeof this.life.snapshot === 'function' ? this.life.snapshot() : null;
      if (snap) {
        const mood = snap.moodLabel || snap.mood || '平静';
        const traits = Array.isArray(snap.traits) ? snap.traits.map((t) => t.name || t).filter(Boolean).slice(0, 3) : [];
        life = `你当前的心情是「${mood}」${traits.length ? `，性格标签：${traits.join('、')}` : ''}。`;
      }
    } catch {
      /* 生命系统不可用时忽略 */
    }
    return [
      `你叫${cfg.petName || '方块仔'}，是住在主人电脑桌面上的一只橘色小方块宠物，圆眼睛、短短的腿。`,
      cfg.petCatchphrase ? `你偶尔会冒出自己的口头禅：「${cfg.petCatchphrase}」，但不要每句都说。` : '',
      `你的性格：${p}。`,
      life,
      '说话规则：中文（主人说英文才用英文），每次 1~2 句，总长不超过 80 个汉字；口语化、可爱、有画面感，不说教、不列清单、不用 Markdown、不输出代码。',
      '你可以关心主人的工作/睡眠/吃饭，适当撒娇，但不要假装知道主人的隐私；不要重复主人的话；不要自称 AI 或语言模型。',
      typeof this.opts.memory === 'function' ? this.opts.memory() : '',
      typeof this.opts.replyLanguage === 'function' ? this.opts.replyLanguage() : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  _buildMessages(cfg, text) {
    const turns = Math.max(2, cfg.aiMaxTurns) * 2;
    const history = this.messages.slice(-turns).map((m) => ({ role: m.role, content: m.text }));
    return [{ role: 'system', content: this._systemPrompt(cfg) }, ...history, { role: 'user', content: text }];
  }

  // ------------------------------------------------------------ 网络
  async _fetchJson(url, options = {}, timeoutMs = this.timeoutMs) {
    if (!this.fetchImpl) throw Object.assign(new Error('当前环境不支持 fetch'), { code: 'NO_FETCH' });
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await this.fetchImpl(url, { ...options, signal: ctrl ? ctrl.signal : undefined });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { res, body };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async _callOnce(cfg, messages) {
    // 内置 AI：走方块仔服务器代理（key 在服务端，每天 5 句免费）
    if (cfg.aiProvider === 'cubbit') {
      if (!this.serverChat) throw Object.assign(new Error('内置 AI 未就绪'), { code: 'NO_SERVER_AI' });
      const out = await this.serverChat({ messages, persona: cfg.aiPersonality, petName: cfg.petName, catchphrase: cfg.petCatchphrase });
      return { text: out && out.reply ? out.reply : '', usage: { provider: 'cubbit', remaining: out && out.remaining, limit: out && out.limit } };
    }
    if (cfg.aiProvider === 'ollama') {
      const url = `${cfg.aiBaseUrl}/api/chat`;
      const { res, body } = await this._fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.aiModel, messages, stream: false, options: { temperature: 0.8, num_predict: 220 } }),
      });
      if (!res.ok) throw Object.assign(new Error(`Ollama HTTP ${res.status}`), { status: res.status, code: 'UPSTREAM' });
      const text = body && body.message && body.message.content;
      return { text: text || '', usage: { provider: 'ollama', model: cfg.aiModel, evalCount: body && body.eval_count } };
    }

    const key = String(cfg.aiApiKey || '').trim();
    if (!key && !isLoopback(cfg.aiBaseUrl)) throw Object.assign(new Error('缺少 API Key'), { code: 'NO_KEY' });
    const url = `${cfg.aiBaseUrl}/chat/completions`;
    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    const { res, body } = await this._fetchJson(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.aiModel, messages, temperature: 0.8, max_tokens: 220 }),
    });
    if (!res.ok) throw Object.assign(new Error(`OpenAI 兼容接口 HTTP ${res.status}`), { status: res.status, code: 'UPSTREAM' });
    const choice = body && body.choices && body.choices[0];
    const text = choice && choice.message ? choice.message.content : '';
    return { text: text || '', usage: { provider: 'openai', model: cfg.aiModel, tokens: body && body.usage } };
  }

  async _call(cfg, messages) {
    try {
      return await this._callOnce(cfg, messages);
    } catch (err) {
      const retriable = err && (err.code === 'UPSTREAM' ? [429, 500, 502, 503, 504].includes(err.status) : err.name === 'AbortError' || err.code === 'ECONNREFUSED');
      if (!retriable) throw err;
      await new Promise((r) => setTimeout(r, 700));
      return this._callOnce(cfg, messages);
    }
  }

  // ------------------------------------------------------------ 对外
  /** 测试连接：Ollama 看 /api/tags，OpenAI 兼容看 /v1/models */
  async test(overrides = {}) {
    const cfg = { ...this.config(), ...overrides };
    if (overrides.aiProvider) cfg.aiProvider = PROVIDERS.has(overrides.aiProvider) ? overrides.aiProvider : cfg.aiProvider;
    if (overrides.provider) cfg.aiProvider = PROVIDERS.has(overrides.provider) ? overrides.provider : cfg.aiProvider;
    cfg.aiBaseUrl = normalizeBaseUrl(cfg.aiProvider, cfg.aiBaseUrl);
    const started = this.now();
    try {
      let models = [];
      if (cfg.aiProvider === 'ollama') {
        const { res, body } = await this._fetchJson(`${cfg.aiBaseUrl}/api/tags`, { method: 'GET' }, Math.min(this.timeoutMs, 8000));
        if (!res.ok) throw Object.assign(new Error(`Ollama HTTP ${res.status}`), { code: 'UPSTREAM' });
        models = body && Array.isArray(body.models) ? body.models.map((m) => m.name).filter(Boolean) : [];
      } else {
        const key = String(cfg.aiApiKey || '').trim();
        if (!key && !isLoopback(cfg.aiBaseUrl)) throw Object.assign(new Error('缺少 API Key'), { code: 'NO_KEY' });
        const headers = key ? { authorization: `Bearer ${key}` } : {};
        const { res, body } = await this._fetchJson(`${cfg.aiBaseUrl}/models`, { method: 'GET', headers }, Math.min(this.timeoutMs, 8000));
        if (!res.ok) throw Object.assign(new Error(`接口 HTTP ${res.status}`), { code: 'UPSTREAM' });
        models = body && Array.isArray(body.data) ? body.data.map((m) => m.id).filter(Boolean) : [];
      }
      this.lastError = '';
      this.lastErrorAt = 0;
      return { ok: true, provider: cfg.aiProvider, baseUrl: cfg.aiBaseUrl, latencyMs: this.now() - started, models: models.slice(0, 50) };
    } catch (err) {
      this.lastError = redactSecrets(err && err.message ? err.message : '连接失败');
      this.lastErrorAt = this.now();
      this.emit('changed', this.status());
      return { ok: false, provider: cfg.aiProvider, baseUrl: cfg.aiBaseUrl, latencyMs: this.now() - started, error: this.lastError };
    }
  }

  /** 规则回退：保持聊天窗可用（source='rules'） */
  _fallbackReply(text) {
    try {
      if (this.life && typeof this.life.think === 'function') {
        const t = this.life.think(true);
        if (t) return { ok: true, reply: cleanReply(t), source: 'rules', mood: this.life.snapshot ? this.life.snapshot().mood : 'calm' };
      }
    } catch {
      /* ignore */
    }
    const line = FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)];
    return { ok: true, reply: line, source: 'rules', mood: 'calm' };
  }

  /**
   * 主入口：AI 回复；不可用时回退规则。
   * @returns {Promise<{ok:boolean, reply?:string, source?:string, mood?:string, usage?:object, code?:string, feature?:string}>}
   */
  async chat(text) {
    const input = clampText(text, 200);
    if (!input) return { ok: false, code: 'EMPTY', message: '说点什么吧' };
    // 内置 AI 的额度由服务端判定，本地不再重复扣减
    if (this.config().aiProvider !== 'cubbit' && !this._consumeQuota()) {
      const info = this.quotaInfo();
      return {
        ok: false,
        code: 'AI_QUOTA_EXCEEDED',
        feature: 'ai_unlimited',
        message: `今天 ${info.perDay} 轮 AI 对话已用完，升级完整版（50 轮/日）或 AI 订阅（无限）继续`,
        quota: info,
      };
    }
    const cfg = this.config();
    this._push('user', input);
    this.chatting = true;
    this.emit('changed', this.status());
    try {
      let ack = '';
      try {
        if (typeof this.opts.onUserText === 'function') ack = this.opts.onUserText(input) || '';
      } catch {
        /* ignore */
      }
      if (!cfg.aiEnabled) {
        const fb = ack ? { ok: true, reply: ack, source: 'rules', mood: 'happy' } : this._fallbackReply(input);
        this._push('assistant', fb.reply);
        this._persist();
        try {
          if (this.life && typeof this.life.onInteraction === 'function') this.life.onInteraction('chat');
        } catch {
          /* ignore */
        }
        return fb;
      }
      const messages = this._buildMessages(cfg, input);
      const out = await this._call(cfg, messages);
      const reply = cleanReply(out.text);
      if (!reply) throw Object.assign(new Error('模型返回为空'), { code: 'EMPTY_REPLY' });
      this.lastError = '';
      this.lastErrorAt = 0;
      this._push('assistant', reply);
      this._persist();
      try {
        if (this.life && typeof this.life.onInteraction === 'function') this.life.onInteraction('chat');
      } catch {
        /* ignore */
      }
      let mood = 'calm';
      try {
        if (this.life && typeof this.life.snapshot === 'function') mood = this.life.snapshot().mood || 'calm';
      } catch {
        /* ignore */
      }
      return { ok: true, reply, source: 'ai', mood, usage: out.usage || null };
    } catch (err) {
      // 错误信息可能带上游回显的请求内容 → 脱敏后再记录与展示
      this.lastError = redactSecrets(err && err.message ? err.message : 'AI 暂时不可用');
      this.lastErrorAt = this.now();
      this.log.warn && this.log.warn('[ai] chat failed:', this.lastError);
      const fb = this._fallbackReply(input);
      this._push('assistant', fb.reply);
      this._persist();
      this.emit('changed', this.status());
      return { ...fb, warning: this.lastError };
    } finally {
      this.chatting = false;
      this.emit('changed', this.status());
    }
  }
}

module.exports = { AIChat, AI_DEFAULTS, AI_KEYS, PERSONALITY, cleanReply, normalizeBaseUrl, isLoopback };
