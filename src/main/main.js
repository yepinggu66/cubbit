/**
 * 方块仔 — 主进程入口。
 *
 * 运行时（AppRuntime）持有所有服务：设置、主题、专注、成长、许可、商城、窗口、托盘。
 * 对外只暴露几个方法给 IPC 层：stateSnapshot / commit / applySettings / openPanel / pickLine 等。
 */
const {
  app,
  Menu,
  BrowserWindow,
  Notification,
  clipboard,
  nativeImage,
  globalShortcut,
  powerMonitor,
  screen,
  shell,
  safeStorage,
  session,
} = require('electron');

const { PRODUCT, SKINS, PLANS, FEATURES, DARK_VARIANT, PRO_BENEFITS, FREE_TIER, DLC, COUPLE_SCENES } = require('../shared/catalog');
const { EVENTS } = require('../shared/ipc');
const { UPDATE_FEED_URL, API_BASE } = require('../shared/runtime-config');
const { SettingsStore } = require('./store');
const { ThemeWatcher } = require('./theme');
const { FocusTimer, FREE_MINUTES } = require('./focus');
const { Growth } = require('./growth');
const { LicenseManager } = require('./license');
const { CommerceClient } = require('./commerce');
const { WindowManager } = require('./windows');
const { PresenceWatcher } = require('./presence');
const { SpeechService } = require('./speech');
const { LifeSystem } = require('./life');
const { Ledger } = require('./ledger');
const { PetForge } = require('./petforge');
const { ShareKit } = require('./share');
const { MateService } = require('./mate');
const { AIChat } = require('./ai');
const { UpdateChecker } = require('./updater');
const { CrashReporter } = require('./crash');
const { BetaStats } = require('./beta-stats');
const { BackupService } = require('./backup');
const { LinesService } = require('./lines');
const { SocialClient } = require('./social');
const { CouplePlus } = require('./couple-plus');
const { Companion, normPersonality } = require('./companion');
const { PaidFeatures } = require('./paid');
const { Farm } = require('./farm');
const I18N = require('../shared/i18n');
const { createTray, refreshTray } = require('./tray');
const { LITE_MODE } = require('../shared/nav-layout');
const DIY = require('../shared/diy');
const { registerIpc } = require('./ipc');
const { isDeveloperAuthorized } = require('./dev-unlock');
/** 深色模式：保留皮肤色相，只压暗（避免所有皮肤夜间变成同一个颜色） */
function __mixHex(a, b, t) {
  const p = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const x = p(a); const y = p(b);
  if (!x || !y) return b || a;
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const { isEntitled, canFeature, isSkinUnlocked, aiQuotaFor } = require('./entitlements');
const { publicSettings } = require('./secret-store');

// 应用自身的 package.json（打包后位于 asar 根目录），用于读取构建期注入的 cubbit.* 配置
const APP_PKG = require('../../package.json');

app.setName('Cubbit');
app.setAppUserModelId('com.cubbit.desktop');

// ---- GPU 兜底：透明/置顶窗口在虚拟机、远程桌面、老显卡上可能连续崩渲染进程。
// 连续崩溃 3 次后写入 runtime-flags.json，下次启动自动禁用硬件加速，避免用户陷入崩溃循环。
const FLAGS_FILE = (() => {
  try { return require('node:path').join(app.getPath('userData'), 'runtime-flags.json'); } catch { return ''; }
})();
function readRuntimeFlags() {
  try { return JSON.parse(require('node:fs').readFileSync(FLAGS_FILE, 'utf8')) || {}; } catch { return {}; }
}
const GPU_DISABLED = process.argv.includes('--disable-gpu') || !!readRuntimeFlags().disableGpu;
if (GPU_DISABLED && typeof app.disableHardwareAcceleration === 'function') {
  try { app.disableHardwareAcceleration(); console.log('[gpu] hardware acceleration disabled (fallback)'); } catch { /* ignore */ }
}

const LINES = {
  greeting: ['早上好呀～', '今天也一起加油！', '我在这儿陪你', '桌面有点乱哦，要整理吗？', '要不要来杯水？'],
  pet: ['嘿嘿～', '好舒服…', '再摸摸嘛', '最喜欢你了', '咕噜咕噜…', '（眯起眼睛）'],
  click: ['呀！', '在呢在呢', '叫我吗？', '戳我干嘛～', '嗨！'],
  throw: ['哇啊啊啊——', '飞起来啦！', '要摔啦要摔啦', '（四脚朝天）'],
  wake: ['嗯…我没睡！', '醒啦醒啦', '（伸懒腰）'],
  night: ['晚安，早点睡哦', '熬夜会变丑的', '我帮你看着屏幕', '眼睛会发光的夜晚～'],
  focus: ['专注时间开始，我陪你', '别碰手机哦～', '加油，我盯着你呢', '这一轮结束我请你吃糖'],
  focusDone: ['完成啦！奖励我一个抱抱？', '太棒了！喝口水休息下', '这轮专注，满分！', '你超厉害的～'],
  feed: ['好吃！谢谢～', '（嚼嚼嚼）', '还要还要！', '能量满满！'],
  locked: ['这是 Pro 皮肤哦', '解锁后就能换啦', '商店里看看？'],
  drop: ['哎哟', '站稳了！', '呼…'],
};

class AppRuntime {
  constructor() {
    this.settings = new SettingsStore();
    const storedBase = (this.settings.get('apiBase') || '').trim();
    this.apiBase = storedBase || PRODUCT.apiBase;

    this.license = new LicenseManager({
      // 生产环境用 Electron userData；开发/测试会被 --user-data-dir 覆盖到工作区
      userDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
    });
    this.license.setApiBase(this.apiBase);
    // v2.4 Lite：首次启动按系统语言选界面语言（欧美用户默认英文，避免一打开就是中文）
    try {
      if (!this.settings.get('onboardingDone') && !this.settings.get('languagePicked')) {
        const MAP = [['zh', 'zh-CN'], ['ja', 'ja-JP'], ['ko', 'ko-KR'], ['de', 'de-DE'], ['fr', 'fr-FR'], ['it', 'it-IT'], ['en', 'en-US']];
        const loc = String(app.getLocale() || '').toLowerCase();
        const hit = MAP.find(([prefix]) => loc.startsWith(prefix));
        this.settings.patch({ language: hit ? hit[1] : 'en-US', languagePicked: true });
      }
    } catch { /* 语言探测失败就用默认值 */ }
    this.theme = new ThemeWatcher(this.settings);
    this.focus = new FocusTimer(this.settings);
    this.growth = new Growth(this.settings);
    this.commerce = new CommerceClient(() => (this.settings.get('apiBase') || this.apiBase).trim() || PRODUCT.apiBase);
    this.presence = new PresenceWatcher(this.settings);
    this.speech = new SpeechService(this.settings, this.presence);
    // 神经语音（更接近真人）：服务端 Edge TTS 合成，宠物窗口负责播放
    this.speech.onNeural = (p) => this.sendPetEvent('tts', p);
    this.life = new LifeSystem(this.settings, { entitled: () => this.entitled() });
    // 人生账本：一天一步的长期玩法。结算后让宠物把结果说出来——
    // 这是它和"数值面板"的区别：结果由它念给你听。
    this.ledger = new Ledger();
    this.ledger.on('turn', (payload) => {
      const line = payload && payload.result && payload.result.line;
      if (line) this.sendPetEvent('say', { text: line });
    });
    // 四条资源直接长在宠物身上：毛色偏暖还是发青、待机是弹的还是塌的。
    // 不把数字推到界面上——用户看它今天什么状态，就知道这局过得怎么样。
    this.ledger.on('mood', (mood) => {
      if (mood && mood.ok) this.sendPetEvent('life-resource', mood);
    });

    // 照片宠物：拍一张 → 抠底 → 归一化 → 生成 idle/blink 两帧
    this.petforge = new PetForge();
    // 分享：落盘 PNG + 剪贴板 + 白名单外链
    this.share = new ShareKit();
    // 相亲角：离线候选池（配了 mateEndpoint 就走真实网络）
    this.mate = new MateService({
      dir: app.getPath('userData'),
      endpoint: () => String(this.settings.get('mateEndpoint') || ''),
      seed: () => (this.license && this.license.getDeviceId ? this.license.getDeviceId() : 'cubbit'),
    });
    this.mate.on('dating', (rel) => {
      if (rel && rel.name) this.sendPetEvent('say', { text: `我和 ${rel.name} 在一起了。` });
    });
    this.mate.on('single', () => this.sendPetEvent('say', { text: '又回到我们俩了。' }));
    this.updater = new UpdateChecker(this.settings, {
      apiBase: () => this.apiBase,
      // v2.9.3：版本信息放在官网下载目录（https://pingguye.cn/cubbit/dl/app-latest.json）
      latestUrl: () => {
        const custom = String(this.settings.get('updateFeedUrl') || '').trim().replace(/\/+$/, '');
        return `${custom || UPDATE_FEED_URL}/app-latest.json`;
      },
      currentVersion: app.getVersion(),
      openExternal: (url) => shell.openExternal(url),
    });
    this.crash = new CrashReporter({
      userDataDir: app.getPath('userData'),
      version: app.getVersion(),
      enabled: () => !!this.settings.get('crashReportEnabled'),
      apiBase: () => this.apiBase,
    });
    this.backup = new BackupService({
      userDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
      deviceId: () => this.license.getDeviceId(),
      apiBase: () => (this.settings.get('apiBase') || this.apiBase || '').trim() || this.apiBase,
      licenseToken: () => this.license.getToken(),
      settings: this.settings,
    });
    this.lines = new LinesService({
      userDataDir: app.getPath('userData'),
      apiBase: () => (this.settings.get('apiBase') || this.apiBase || '').trim() || this.apiBase,
      settings: this.settings,
    });
    this.ai = new AIChat(this.settings, {
      entitled: () => this.entitled(),
      quota: () => this.aiQuota(),
      apiKey: () => this.aiApiKey(),
      onApiKeyChange: (value) => this._saveAiApiKey(value),      // 内置 AI：把对话发给方块仔服务器代理（key 只在服务端）
      serverChat: async ({ messages, persona, petName, catchphrase } = {}) => {
        const list = Array.isArray(messages) ? messages : [];
        const lastUser = [...list].reverse().find((m) => m && m.role === 'user');
        const history = list.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(0, -1).slice(-6);
        const device = (this.license && this.license.getDeviceId && this.license.getDeviceId()) || '';
        const res = await fetch(API_BASE + '/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: { device, text: (lastUser && lastUser.content) || '', persona: persona || 'warm', petName: petName || '', catchphrase: catchphrase || '', history } }),
          signal: AbortSignal.timeout(20000),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (body && body.error && body.error.message) || 'AI 暂时连不上';
          throw Object.assign(new Error(msg), { code: 'UPSTREAM', status: res.status });
        }
        return body && body.result ? body.result : { reply: '' };
      },
      userDataDir: app.getPath('userData'),
      life: this.life,
      memory: () => (this.companion ? this.companion.promptSummary() : ''),
      replyLanguage: () => {
        const inf = I18N.info(this.settings.get('language'));
        return inf.short === 'zh' ? '' : `Always reply in ${inf.name} (language code ${inf.id}), 1-2 short cute sentences. Your name is Cubbit.`;
      },
      onUserText: (t) => (this.companion ? this.companion.onUserChat(t) : ''),
    });    this.social = new SocialClient({
      userDataDir: app.getPath('userData'),
      apiBase: (this.settings.get('apiBase') || this.apiBase).trim() || PRODUCT.apiBase,
      deviceId: this.license.getDeviceId(),
      petName: (this.settings.get('petName') && this.settings.get('petName') !== '方块仔' ? this.settings.get('petName') : '') || (this.settings.get('coupleProfile') && this.settings.get('coupleProfile').petName) || '方块仔',
      skinId: this.settings.get('skinId') || 'blaze',
    });
    this.couplePlus = new CouplePlus(this);
    this.companion = new Companion(this, { dir: app.getPath('userData') });
    this.paid = new PaidFeatures(this, { dir: app.getPath('userData'), clipboard, nativeImage });
    this.intimacy = { add: (n, r) => this.companion.add(n, r), level: () => this.companion.level() };
    this.farm = new Farm({
      dir: app.getPath('userData'),
      hooks: {
        isMember: () => this.can('member_perks'),
        isDeveloper: () => this.isDeveloper(),
        growthFood: () => { const r = this.growth.feed(this.can('growth')); try { this.companion.add(3, 'farm-food'); } catch {} this.commit(); return r && r.growth ? { level: r.growth.level } : null; },
        onWork: (on, report, duo) => this._farmWork(on, report, duo),
        weather: () => { try { const w = this.companion.data && this.companion.data.weather; return w && w.desc ? { desc: w.desc, temp: w.temp, rain: w.rainChance } : null; } catch { return null; } },
        isCouplePremium: () => this.isDeveloper() || this.can('couple_premium'),
        anniversary: () => { try { return this.couplePlus.snapshot().anniversary || ''; } catch { return ''; } },
        // coupleSync: 真实伴侣同步需要服务器（NEEDS_SERVER），默认不提供 → 事件在 outbox 排队
      },
    });
    // v2.2 空闲/睡眠节流：所有高频轮询都挂在 power 上（见 main/power-governor.js）
    {
      const { PowerGovernor } = require('./power-governor');
      this.power = new PowerGovernor({
        getIdleSec: () => powerMonitor.getSystemIdleTime(),
        isVisible: () => !!(this.windows && this.windows.petVisible),
        // QA/性能测量可用环境变量缩短阈值
        idleSec: Number(process.env.CUBBIT_IDLE_SEC) || 60,
        sleepSec: Number(process.env.CUBBIT_SLEEP_SEC) || 300,
      });
    }
    this.windows = new WindowManager(this);
    this.petHitboxes = [];
    this.lastSay = null;
    this._broadcastTimer = null;
    this._quitting = false;
    this._sleeping = false;
    this._cinema = false;
    this._backupPassphrase = '';
    this._backupPassphraseEncrypted = false;
    this._loadBackupPassphrase();
    this._aiApiKey = '';
    this._aiKeyEncrypted = false;
    this._loadAiApiKey();
    this.coupleScene = this.settings.get('coupleScene') || { id: 'coffee', light: 'light', updatedAt: 0 };
    this._partnerSceneAt = 0;
  }

  /**
   * 开发者授权判定。
   *
   * 正式包**不提供**任何用户可写的解锁开关：历史版本的「开发者模式」开关已从设置页与
   * settings.json 中彻底移除（见 store.js 的历史字段清理）。现在只剩两条授权来源：
   * 构建期注入的 package.json → cubbit.devUnlock，以及开发态的环境变量。
   */
  isDeveloper() {
    // v2.9.3：环境变量解锁只在开发态（未打包）生效；正式安装包里设置 CUBBIT_DEV_UNLOCK 不再解锁付费内容。
    return isDeveloperAuthorized({ env: app.isPackaged ? {} : process.env, pkg: APP_PKG });
  }

  /** 是否拥有「完整版」权益（买断 / 试用 / 任意付费订阅都算） */
  entitled() {
    return isEntitled({ developer: this.isDeveloper(), status: this.license.getStatus() });
  }

  /** 当前功能开关（由 license token 的 features 决定，免费功能恒为 true） */
  licenseFeatures() {
    const st = this.license.getStatus();
    return st.features || {};
  }

  can(feature) {
    // 内测期放开角色定制（正式版仍按付费项校验）
    if (feature === 'custom_character' && this.entitled()) return true;
    return canFeature({ developer: this.isDeveloper(), features: this.licenseFeatures(), feature });
  }

  /**
   * 内测数据一键导出：把 beta-events.jsonl 复制到桌面并打开所在文件夹。
   * 内测用户不需要知道 %APPDATA% 在哪——这是唯一会影响回收率的摩擦点。
   */
  exportBetaData() {
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      const src = this.beta && typeof this.beta.filePath === 'function' ? this.beta.filePath() : '';
      if (!src || !fs.existsSync(src)) {
        this.sendPetEvent('say', { text: '还没有使用数据，用完这一天再导出～', emoji: '📤' });
        return { ok: false, code: 'NO_DATA' };
      }
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const dev = String((this.license.getStatus() || {}).deviceId || '').slice(0, 6);
      const name = `Cubbit-使用数据-${stamp}${dev ? '-' + dev : ''}.jsonl`;
      const dest = path.join(app.getPath('desktop'), name);
      fs.copyFileSync(src, dest);
      shell.showItemInFolder(dest);
      this.sendPetEvent('say', { text: `已导出到桌面：${name}，发给我们就行`, emoji: '📤', priority: true });
      return { ok: true, path: dest };
    } catch (err) {
      console.error('[beta] export failed', err && err.message);
      this.sendPetEvent('say', { text: '导出失败了，可以手动打开 %APPDATA%\\Cubbit\\beta-events.jsonl', emoji: '⚠️' });
      return { ok: false, code: 'EXPORT_FAILED' };
    }
  }

  /** 小农场：面板调用 */
  farmCall(action, args, sender) {
    if (action === 'datePhoto') return this._farmDatePhoto(args || {}, sender);
    if (action === 'memoryPhoto') {
      const m = this.farm.couple.s.memories.find((x) => x.id === (args && args.id));
      try { return { ok: true, dataUrl: 'data:image/jpeg;base64,' + require('fs').readFileSync(require('path').join(app.getPath('userData'), 'farm-dates', m.file)).toString('base64') }; } catch { return { ok: false }; }
    }
    const before = this.farm.state.skinUnlocked;
    const r = this.farm.call(action, args);
    const done = (res) => { if (!before && this.farm.state.skinUnlocked) { this.sendPetEvent('say', { text: '集齐碎片！限定皮肤「田园小农夫」解锁啦', emoji: '🧑‍🌾', priority: true }); this.commit(); } return res; };
    return r && typeof r.then === 'function' ? r.then(done) : done(r);
  }

  /** 约会拍照：截取农场窗口里两只方块仔所在区域 → 存本地；有情侣年卡时同时进纪念日相册 */
  async _farmDatePhoto({ spot, rect }, sender) {
    const fs = require('fs'); const path = require('path');
    const c = this.farm.couple; if (!c.s.dates.includes(spot)) return { ok: false, code: 'DATE_LOCKED' };
    let img = null;
    try { const r = rect && { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.max(10, Math.round(rect.width)), height: Math.max(10, Math.round(rect.height)) }; img = await sender.capturePage(r || undefined); } catch { img = null; }
    if (!img || img.isEmpty()) return { ok: false, code: 'PHOTO_FAIL' };
    if (img.getSize().width > 900) img = img.resize({ width: 900, quality: 'good' });
    const id = 'fd' + Date.now(); const dir = path.join(app.getPath('userData'), 'farm-dates');
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.jpg'), img.toJPEG(85));
    let album = false;
    if (this.can('couple_premium') || this.isDeveloper()) {
      const titles = { river: '河边约会', snow: '雪山约会' };
      const r = this.paid.data && this.paid.addAlbum ? (this.can('couple_premium') ? this.paid.addAlbum({ title: titles[spot] || '农场约会', note: '方块仔和' + c.s.partner.name + '在小农场约会', photo: img.toDataURL() }) : null) : null;
      album = !!(r && r.ok);
    }
    c.addMemory({ id, spot, file: id + '.jpg', album });
    return { ok: true, id, album, view: this.farm.view() };
  }

  /** 小农场打工：桌宠进入/退出「打工中」 */
  _farmWork(on, report, duo) {
    this.sendPetEvent('farm-work', { on: !!on });
    const pn = (this.farm && this.farm.couple.s.partner.name) || 'TA';
    if (on) this.sendPetEvent('say', duo ? { text: `我和${pn}手牵手去农场打工啦`, emoji: '💞', priority: true } : { text: '我去农场打工啦，回来告诉你赚了多少', emoji: '🌾', priority: true });
    else if (report) {
      let text = !report.capped || report.coins > 0 ? (report.duo ? `和${pn}一起打工回来啦！${report.mins} 分钟赚了 ${report.coins} 金币` : `打工回来啦！${report.mins} 分钟赚了 ${report.coins} 金币`) : '打工回来啦！今天的打工收入已经到上限了';
      if (report.partnerHelped) text += `（${report.partnerHelped}给你留了话，去农场看看吧）`;
      this.sendPetEvent('say', { text, emoji: '🪙', priority: true, durationMs: 5200 });
    }
  }

  /** 今天原专注模块记录的分钟数（给办公助手晚间总结用） */
  focusTodayMinutes() {
    try { const t = this.focus.todayStats(); return Number(t && (t.minutes || t.focusMinutes)) || 0; } catch { return 0; }
  }

  /** 皮肤是否可用：免费皮肤 / 完整版（skins_premium）/ 已购 DLC */
  skinUnlocked(skin) {
    if (skin && skin.milestoneDays) return this.isDeveloper() || !!(this.retention && this.retention.isUnlocked(skin.id));
    if (skin && skin.farmShards) return this.isDeveloper() || !!(this.farm && this.farm.state.skinUnlocked);
    if (skin && skin.couplePremium) return this.isDeveloper() || this.can('couple_premium');
    if (skin && skin.memberMonth) return this.isDeveloper() || this.can('member_perks');
    if (skin && !skin.free && this.license.hasAddon && (DLC || []).some((d) => Array.isArray(d.skinIds) && d.skinIds.includes(skin.id) && this.license.hasAddon(d.id))) return true;
    return isSkinUnlocked({
      developer: this.isDeveloper(),
      skin,
      hasAddon: Boolean(this.license.hasAddon && this.license.hasAddon(skin && skin.dlc)),
      features: this.licenseFeatures(),
    });
  }

  /** AI 配额：免费 10 / 完整版 50 / AI 订阅无限 */
  aiQuota() {
    return aiQuotaFor({ developer: this.isDeveloper(), quota: () => this.license.aiQuota() });
  }

  /** 给 UI 的许可视图：features 为布尔开关，并附带四层权益字段 */
  licenseView() {
    const raw = this.license.getStatus();
    return {
      ...raw,
      features: this.licenseFeatures(),
      baseOwned: Boolean(raw.baseOwned) || raw.state === 'trial',
      addons: raw.addons || [],
      seats: raw.seats || 1,
      aiQuota: this.aiQuota(),
      developer: this.isDeveloper(),
    };
  }

  // ---------------------------------------------------------------- 状态快照
  stateSnapshot() {
    const license = this.license.getStatus();
    const isPro = this.entitled();
    const t = this.theme.snapshot();
    const s = this.settings.settings;
    return {
      time: Date.now(),
      product: {
        name: PRODUCT.name,
        zhName: PRODUCT.zhName,
        version: app.getVersion(),
        tagline: PRODUCT.tagline,
        trialDays: PRODUCT.trialDays,
        supportEmail: PRODUCT.supportEmail,
        website: PRODUCT.website,
      },
      // 设置广播：剔除所有机密字段（AI Key 明文/密文、云同步密码密文），只暴露「是否已配置」标记
      settings: {
        ...publicSettings(s),
        aiKeySet: !!this._aiApiKey,
        aiKeyEncrypted: !!this._aiKeyEncrypted,
        backupPasswordSet: !!this._backupPassphrase,
        backupPasswordEncrypted: !!this._backupPassphraseEncrypted,
      },
      theme: t,
      license: this.licenseView(),
      focus: this.focus.snapshot(),
      growth: this.growth.snapshot(),
      skins: SKINS.map((skin) => ({ ...skin, locked: !this.skinUnlocked(skin) })),
      dlc: DLC,
      freeTier: FREE_TIER,
      plans: PLANS.filter((p) => require('../shared/offer-config').legacyPlanVisible(p.id, this.offerFlags())),
      offers: require('../shared/pricing').storeOffers(this.priceLocale(), this.offerFlags()),
      proBenefits: PRO_BENEFITS,
      features: FEATURES,
      ui: {
        isPro,
        isTrial: license.state === 'trial',
        trialDaysLeft: license.trialDaysLeft || 0,
        showTrialBadge: license.state === 'trial',
        petVisible: this.windows.petVisible,
        apiBase: this.settings.get('apiBase') || this.apiBase,
        cinemaMode: !!(this._devPresenceSnapshot().cinemaMode),
        presenceKind: this._devPresenceSnapshot().kind,
        voiceEnabled: !!this.settings.get('voiceEnabled'),
      },
      palette: this.currentPalette(),
      colorSource: this.colorSource(),
      presence: this._devPresenceSnapshot(),
      life: this.life ? this.life.snapshot() : { mood: 'calm', moodLabel: '平静' },
      ai: this.ai ? this.ai.status() : null,
      update: this.updater ? this.updater.status() : null,
      crash: this.crash ? this.crash.status() : null,
      backup: this.backup ? this.backup.info() : null,
      content: this.lines ? this.lines.info() : null,
      coupleScenes: COUPLE_SCENES,
      coupleScene: this.getCoupleScene(),
      developerMode: this.isDeveloper(),
      couple: this._devCouple(),
      coupleRt: this.coupleRt ? this.coupleRt.status() : null,
      retention: this.retentionSnapshot(),
      offerFlags: this.offerFlags(),
      partnerPalette: this.partnerPalette(),
      couplePlus: this.couplePlus ? this.couplePlus.snapshot() : null,
      intimacy: this.companion ? this.companion.intimacySnapshot() : null,
      personality: this.companion ? this.companion.personality() : 'gentle',
      lang: I18N.normLang(s.language),
      lines: LINES.greeting,
    };
  }

  /** QA：--dev-presence=video|meeting|coding 时伪造主人状态（用于截图/验收） */
  _devPresenceSnapshot() {
    if (!this.presence) return { kind: 'working', cinemaMode: false };
    const snap = this.presence.snapshot();
    if (this._devPresence) {
      return { ...snap, kind: this._devPresence, cinemaMode: this._devPresence === 'video' || !!this.settings.get('cinemaManual') };
    }
    return snap;
  }

  /** QA：--dev-couple-demo 时注入一份假情侣数据，用于在没有服务端时预览 UI */
  _devCouple() {
    if (this._devCoupleDemo) {
      return {
        enabled: true,
        pairId: 'dev-pair',
        partner: { name: '阿橘', skinId: 'sakura', online: true, lastSeenAt: Date.now(), presence: { kind: 'working' } },
        married: true,
        marriedAt: Date.now() - 30 * 86400000,
        affection: 520,
        unread: 0,
        pendingProposal: false,
        dailyLove: { sent: false, text: '', at: 0 },
        anniversaryDays: 30,
        messages: [{ id: 'dev1', from: 'partner', text: '今天也想你啦', kind: 'love', at: Date.now() - 60000 }],
        serverOnline: true,
        error: '',
      };
    }
    return this.social ? this.social.snapshot() : { enabled: false };
  }

  /** 情侣模式下是否需要在桌宠旁渲染「TA 的方块仔」 */
  hasPartnerPet() {
    try {
      if (!this.social) return false;
      const c = this._devCouple ? this._devCouple() : this.social.snapshot();
      return !!(c && c.enabled && c.partner);
    } catch {
      return false;
    }
  }

  /** 伴侣方块仔的调色板（用于桌宠界面里渲染「TA 的方块仔」） */
  partnerPalette() {
    if (this._devCoupleDemo) {
      const skin = SKINS.find((x) => x.id === 'sakura') || SKINS[0];
      return this._applyDarkVariant(skin.palette);
    }
    try {
      const couple = this.social ? this.social.snapshot() : null;
      if (!couple || !couple.enabled || !couple.partner || !couple.partner.skinId) return null;
      const skin = SKINS.find((x) => x.id === couple.partner.skinId) || SKINS[0];
      return this._applyDarkVariant(skin.palette);
    } catch {
      return null;
    }
  }

  /** 任务提醒：到点让方块仔开口提醒（每天每个任务提醒一次） */
  /** 语音对话：麦克风 → 离线中文识别 → AI 聊天 → 气泡 + 朗读 */
  async voiceTalk() {
    if (this._voiceBusy) return { ok: false, code: 'BUSY' };
    if (this.settings.get('voiceInputEnabled') === false) {
      this.sendPetEvent('say', { text: '语音输入还没打开，去 设置 → 语音 里打开吧', emoji: '🎤' });
      return { ok: false, code: 'DISABLED' };
    }
    if (!this.speech) return { ok: false, code: 'NOT_READY' };
    this._voiceBusy = true;
    let res;
    try {
      this.sendPetEvent('listening', { on: true });
      res = await this.speech.listen();
    } finally {
      this.sendPetEvent('listening', { on: false });
    }
    try {
      if (!res || !res.ok) {
        const msg = res && res.code === 'NO_RECOGNIZER' ? '这台电脑没有安装中文语音识别，去 Windows 设置 → 语音 里添加一下吧' : '麦克风打不开，检查一下 Windows 设置 → 隐私 → 麦克风';
        this.sendPetEvent('say', { text: msg, emoji: '🎤', priority: true });
        return res || { ok: false };
      }
      const text = String(res.text || '').trim();
      if (!text) {
        this.sendPetEvent('say', { text: '没听清，再说一次？', emoji: '👂', priority: true });
        return { ok: true, text: '' };
      }
      this.sendPetEvent('heard', { text });
      if (!this.ai) return { ok: true, text };
      const r = await this.ai.chat(text);
      if (r && r.ok && r.reply) {
        this.sendPetEvent('mood', { mood: r.mood || 'happy' });
        this.sendPetEvent('chat-reply', { mood: r.mood || null, text: r.reply, bubble: true });
      } else {
        this.sendPetEvent('say', { text: (r && r.message) || '我现在答不上来…', emoji: '💭', priority: true });
      }
      this.commit();
      return { ok: true, text, reply: r && r.reply, source: r && r.source };
    } finally {
      this._voiceBusy = false;
    }
  }

  _localDay(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** 任务今天是否「该做」：一次性（可带日期）/ 每天 / 工作日 / 每周 */
  _taskDueToday(t, d) {
    const today = this._localDay(d);
    const dow = d.getDay();
    if (t.repeat === 'daily') return true;
    if (t.repeat === 'weekdays') return dow >= 1 && dow <= 5;
    if (t.repeat === 'weekly') return dow === t.dow;
    if (t.date) return t.date <= today; // 过期未提醒的一次性任务，补提醒一次
    return true;
  }

  _checkTasks(now = new Date()) {
    try {
      const tasks = Array.isArray(this.settings.get('tasks')) ? this.settings.get('tasks') : [];
      const d = now;
      const today = this._localDay(d);
      const nowMin = d.getHours() * 60 + d.getMinutes();
      let changed = false;
      const next = tasks.map((task) => {
        if (!task) return task;
        let t = task;
        // 重复任务：新的一天自动变回「未完成」
        if (t.repeat && t.repeat !== 'none' && t.done && t.doneOn && t.doneOn !== today) {
          t = { ...t, done: false };
          changed = true;
        }
        if (t.done || !t.at || t.remindedOn === today) return t;
        if (!this._taskDueToday(t, d)) return t;
        const [h, m] = t.at.split(':').map(Number);
        const due = h * 60 + m;
        const overdueDay = t.repeat === 'none' && t.date && t.date < today;
        if (overdueDay || nowMin >= due) {
          changed = true;
          const late = overdueDay || nowMin - due > 10;
          this.sendPetEvent('task-remind', { text: t.text, at: t.at, late, repeat: t.repeat });
          return { ...t, remindedOn: today };
        }
        return t;
      });
      if (changed) {
        this.settings.patch({ tasks: next });
        this.commit();
      }
    } catch (err) {
      console.error('[tasks] check failed', err && err.message);
    }
  }

  _startTaskTimer() {
    if (this._taskTimer) clearInterval(this._taskTimer);
    this._taskTimer = setInterval(() => this._checkTasks(), 20 * 1000);
    setTimeout(() => this._checkTasks(), 5000);
  }

  /** 试穿：桌宠临时换上任意皮肤（含未解锁）10 秒后自动恢复，不写设置 */
  previewSkin(id, seconds = 10) {
    const skin = SKINS.find((x) => x.id === id);
    if (!skin) return { ok: false, code: 'NOT_FOUND', message: '没有这个皮肤' };
    const secs = Math.max(3, Math.min(20, Number(seconds) || 10));
    this.sendPetEvent('skin', { palette: this._applyDarkVariant(skin.palette), skinId: skin.id, preview: true });
    if (this._skinPreviewTimer) clearTimeout(this._skinPreviewTimer);
    this._skinPreviewTimer = setTimeout(() => {
      this._skinPreviewTimer = null;
      this.sendPetEvent('skin', {
        palette: this.currentPalette(),
        skinId: this.settings.get('skinId') || 'blaze',
        diyPet: this.settings.get('diyPet'),
      });
    }, secs * 1000);
    return { ok: true, seconds: secs, locked: !this.skinUnlocked(skin) };
  }

  /** 深色模式下把任意皮肤调成夜行配色（和主人宠物同一套规则） */
  _applyDarkVariant(basePalette) {
    if (!basePalette) return null;
    const dark = !!this.theme.snapshot().effectiveDark;
    if (!dark) return { ...basePalette, dark: false };
    return {
      ...basePalette,
      body1: __mixHex(basePalette.body1, DARK_VARIANT.body1, 0.62),
          body2: __mixHex(basePalette.body2, DARK_VARIANT.body2, 0.62),
          body3: __mixHex(basePalette.body3, DARK_VARIANT.body3, 0.62),
      eye: DARK_VARIANT.eye,
      pupil: DARK_VARIANT.pupil,
      blush: basePalette.blush || DARK_VARIANT.blush,
      rim: DARK_VARIANT.rim,
      glow: basePalette.glow || DARK_VARIANT.glow,
      dark: true,
    };
  }

  currentPalette() {
    const s = this.settings.settings;
    const skin = SKINS.find((x) => x.id === s.skinId) || SKINS[0];
    const t = this.theme.snapshot();
    const base = skin.palette;
    const dark = t.effectiveDark;
    const palette = dark
      ? {
          ...base,
          // v2.3：深色模式不再把机身混暗（之前会把橙色混成泥棕色），保持皮肤原色
          dark: true,
        }
      : { ...base, dark: false };
    if (s.customColors && (this.entitled() || this.can('custom_character'))) {
      Object.assign(palette, s.customColors);
    }
    const diyPet = DIY.normalize(s.diyPet);
    // v3.3：谁最后被点就听谁的——点了皮肤（夜光等）用皮肤配色+特效；点了身体颜色才用 DIY 配色。
    // 以前只要 DIY 开着就无条件盖上 DIY 配色（默认经典橙），皮肤衣橱选什么桌宠都还是橙色。
    if (diyPet.enabled && this.colorSource() === 'diy') Object.assign(palette, DIY.palette(diyPet));
    return palette;
  }

  /**
   * 身体配色来源：'skin'（皮肤衣橱）或 'diy'（身体颜色 / 自定义颜色）。
   * 旧设置没有这个字段：选过非默认皮肤的按 'skin'，还在默认橙红经典（blaze）上的按 'diy'。
   */
  colorSource() {
    const s = this.settings.settings || {};
    if (s.colorSource === 'skin' || s.colorSource === 'diy') return s.colorSource;
    return s.skinId && s.skinId !== 'blaze' ? 'skin' : 'diy';
  }

  // ---------------------------------------------------------------- 广播
  commit() {
    refreshTray(this);
    this.broadcastState();
  }

  broadcastState() {
    if (this._broadcastTimer) return;
    this._broadcastTimer = setTimeout(() => {
      this._broadcastTimer = null;
      const state = this.stateSnapshot();
      this.sendToPet(EVENTS.STATE_CHANGED, state);
      for (const panel of this.windows.panels.values()) {
        if (!panel.isDestroyed()) panel.webContents.send(EVENTS.STATE_CHANGED, state);
      }
    }, 40);
  }

  sendToPet(channel, payload) {
    const win = this.windows.petWindow;
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  /** AI 消息广播：聊天窗 + 桌宠（气泡/状态） */
  sendAiMessage(msg) {
    if (!msg) return;
    for (const win of this.windows.panels.values()) {
      if (!win.isDestroyed()) win.webContents.send(EVENTS.AI_MESSAGE, msg);
    }
    if (this.windows.petWindow && !this.windows.petWindow.isDestroyed()) {
      this.windows.petWindow.webContents.send(EVENTS.AI_MESSAGE, msg);
    }
  }

  // ---------------------------------------------------------------- 实时情侣联机
  /** 桌面端 Google 登录（系统浏览器 + 本机回环），用于匿名账号升级 */
  googleSignIn() {
    const { googleSignIn } = require('./couple/google-oauth');
    const cfg = (this.coupleRt && this.coupleRt.config) || {};
    return googleSignIn({ clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret, openExternal: (u) => shell.openExternal(u) });
  }

  /** 情侣打卡 / 一起浇水（留存）。本地记一笔并同步给 TA */
  coupleCheckin(kind = 'checkin') {
    const { KINDS } = require('./couple/retention');
    if (!KINDS.includes(kind) || !this.retention) return { ok: false, message: '未知打卡类型' };
    const r = this.retention.mark(kind, 'me');
    if (!r) return { ok: false };
    if (!r.already && this.coupleRt) this.coupleRt.farmEvent({ kind, day: r.day });
    const word = kind === 'water' ? '浇水' : '打卡';
    if (r.already) this.sendPetEvent('say', { text: `今天已经${word}过啦`, emoji: '✅' });
    else if (r.both) { this.sendPetEvent('couple-act', { t: 'heart', dir: 'out', name: 'TA', together: true }); this.sendPetEvent('say', { text: `一起${word}连续 ${r.streak} 天！`, emoji: kind === 'water' ? '💧' : '🔥', priority: true }); }
    else this.sendPetEvent('say', { text: `${word}成功，等 TA 也来${word}就能续上连续天数`, emoji: kind === 'water' ? '💧' : '📅' });
    this.commit();
    return { ok: true, ...r };
  }

  retentionSnapshot() {
    if (!this.retention) return null;
    let days = 0;
    try { days = this.couplePlus.snapshot().days || 0; } catch { /* ignore */ }
    return { ...this.retention.snapshot(days), days };
  }

  /** 在一起天数达到里程碑 → 解锁皮肤 */
  checkMilestones() {
    if (!this.retention) return [];
    let days = 0;
    try { days = this.couplePlus.snapshot().days || 0; } catch { return []; }
    const fresh = this.retention.checkMilestones(days);
    for (const m of fresh) this.sendPetEvent('say', { text: `在一起 ${m.days} 天！解锁限定皮肤「${m.title}」`, emoji: '🎁', priority: true });
    if (fresh.length) this.commit();
    return fresh;
  }

  /** 桌宠窗口崩了就地重载（10 分钟内最多 3 次），避免用户看到一个空白/消失的宠物 */
  _recoverPetWindow(wc) {
    try {
      const pet = this.windows && this.windows.petWindow;
      if (!pet || pet.isDestroyed() || !wc || wc !== pet.webContents) return;
      const now = Date.now();
      this._petRecoverAt = (this._petRecoverAt || []).filter((t) => now - t < 10 * 60 * 1000);
      this._petRecoverAt.push(now);
      if (this._petRecoverAt.length > 3) return;
      console.log('[pet] renderer gone -> reload (#%d)', this._petRecoverAt.length);
      setTimeout(() => { try { if (!pet.isDestroyed()) pet.reload(); } catch { /* ignore */ } }, 400);
    } catch { /* ignore */ }
  }

  /** 渲染进程连续崩溃 → 落盘 GPU 兜底开关并自动重启一次（只重启一次，避免循环） */
  _onRenderCrashLoop(details) {
    if (GPU_DISABLED || this._quitting) return;
    const reason = String((details && (details.reason || details.type)) || '');
    if (!/crash|oom|gpu|killed|launch/i.test(reason)) return;
    const now = Date.now();
    this._renderCrashAt = (this._renderCrashAt || []).filter((t) => now - t < 5 * 60 * 1000);
    this._renderCrashAt.push(now);
    if (this._renderCrashAt.length < 3 || this._gpuFallbackRelaunched) return;
    this._gpuFallbackRelaunched = true;
    try {
      require('node:fs').mkdirSync(require('node:path').dirname(FLAGS_FILE), { recursive: true });
      require('node:fs').writeFileSync(FLAGS_FILE, JSON.stringify({ disableGpu: true, at: now, crashes: this._renderCrashAt.length }));
      console.log('[gpu] 3 renderer crashes in 5min -> relaunch with GPU disabled');
    } catch { /* ignore */ }
    setTimeout(() => { try { app.relaunch(); app.exit(0); } catch { /* ignore */ } }, 800);
  }

  _initCoupleRt() {
    try {
      const { createCoupleService } = require('./couple/service');
      this.coupleRt = createCoupleService({ userDataDir: app.getPath('userData') });
    } catch (err) {
      console.error('[couple-rt] init failed', err && err.message);
      this.coupleRt = null;
      return;
    }
    const svc = this.coupleRt;
    const ACT_TO_PET = { holdhands: 'hands' };
    const name = () => svc.status().partner.name || 'TA';
    const toPanels = (type, payload) => {
      for (const win of this.windows.panels.values()) if (!win.isDestroyed()) win.webContents.send(EVENTS.COUPLE_RT, { type, payload });
    };
    svc.on('changed', (st) => toPanels('status', st));
    // 内测埋点（本地，不外发）
    const track = (event, data) => { try { if (this.beta) this.beta.log(event, data); } catch { /* ignore */ } };
    svc.on('pairIntent', (event) => track('pair_intent', event));
    svc.on('pairFailure', (event) => track('pair_failed', event));
    svc.on('paired', (st) => track('pair_success', {
      role: st && st.role,
      method: 'invite_code',
    }));
    svc.on('note', (e) => track('msg_in', { type: 'note', catchup: !!(e && e.catchup) }));
    svc.on('voice', (e) => track('msg_in', { type: 'voice', catchup: !!(e && e.catchup) }));
    svc.on('interaction', (e) => track('interaction_in', { action: e && e.action }));
    svc.on('focus', (e) => track('couple_focus', { event: e && e.event }));
    svc.on('partnerOnline', (on) => track('partner_presence', { online: !!on }));
    svc.on('interaction', (e) => {
      this.sendPetEvent('couple-act', { t: ACT_TO_PET[e.action] || e.action, dir: 'in', name: name(), together: true, catchup: !!e.catchup });
      toPanels('interaction', e);
    });
    const panelOpen = () => { const w = this.windows.panels.get && this.windows.panels.get('couple'); return !!(w && !w.isDestroyed() && w.isVisible()); };
    const notify = (body, raw = false) => {
      if (panelOpen()) return;
      const lang = this.settings.get('language');
      try { if (!Notification.isSupported()) return; const n = new Notification({ title: I18N.tr(lang, '方块仔 · 悄悄话'), body: raw ? body : I18N.tr(lang, body), silent: true }); n.on('click', () => this.openPanel('couple')); n.show(); } catch { /* ignore */ }
    };
    svc.on('note', (e) => { if (!e.catchup) { this.sendPetEvent('couple-act', { t: 'relay', dir: 'in', name: name(), text: e.text }); notify(`${name()}：${String(e.text || '').slice(0, 60)}`, true); } toPanels('note', e); });
    svc.on('voice', (e) => { if (!e.catchup) { this.sendPetEvent('couple-act', { t: 'voice', dir: 'in', name: name(), text: '给你留了一段语音' }); notify(`${name()} 给你留了一段语音 🎙️`); } toPanels('voice', e); });
    svc.on('messages', (m) => { this.coupleUnread = m.unread; toPanels('messages', m); try { refreshTray(this); } catch { /* ignore */ } });
    svc.on('receipt', (r) => toPanels('receipt', r));
    svc.on('focus', (e) => { if (e.event === 'start') this.sendPetEvent('couple-act', { t: 'focus', dir: 'in', name: name(), minutes: Math.round(e.duration / 60) }); toPanels('focus', e); });
    svc.on('farm', (e) => {
      if (!e || !this.retention || !['checkin', 'water'].includes(e.kind)) return;
      const r = this.retention.mark(e.kind, 'partner', e.day);
      if (r && !r.already && !e.catchup) this.sendPetEvent('say', { text: `${name()} ${e.kind === 'water' ? '浇水' : '打卡'}了${r.both ? `，连续 ${r.streak} 天！` : '，你也来吧'}`, emoji: e.kind === 'water' ? '💧' : '📅' });
      toPanels('farm', e); this.commit();
    });
    svc.on('partnerOnline', (on) => { this.sendPetEvent(on ? 'partner-arrive' : 'partner-leave', { name: name() }); toPanels('presence', { online: on }); });
    svc.on('catchup', (c) => { this.sendPetEvent('say', { text: `你不在时，${name()} 找过你 ${Object.values(c.counts).reduce((a, b) => a + b, 0)} 次` }); toPanels('catchup', c); });
    svc.on('paired', (st) => {
      toPanels('paired', st); this.commit();
      this.sendPetEvent('couple-act', { t: 'paired', dir: st.role === 'inviter' ? 'in' : 'out', name: name() });
      if (st.role === 'inviter') {
        try { if (Notification.isSupported()) { const n = new Notification({ title: I18N.tr(this.settings.get('language'), '配对成功 🎉'), body: I18N.tr(this.settings.get('language'), `${name()} 接受了你的邀请，现在可以一起戳戳、传话、浇水啦`), silent: false }); n.on('click', () => this.openPanel('couple')); n.show(); } } catch { /* ignore */ }
      }
    });
    svc.on('error', (e) => console.warn('[couple-rt]', e && e.code, e && e.message));
    svc.init().then(() => { this.coupleUnread = svc.unreadCount(); try { refreshTray(this); } catch { /* ignore */ } }).catch(() => {});
    try {
      powerMonitor.on('suspend', () => svc.suspend());
      powerMonitor.on('resume', () => svc.resume().catch(() => {}));
    } catch { /* ignore */ }
    if (this._pendingPairLink) { svc.acceptInvite(this._pendingPairLink).catch(() => {}); this._pendingPairLink = null; }
  }

  /** 戳/比心…：本地动画立刻播，联机消息受 10 秒限流 */
  coupleInteract(action) {
    const svc = this.coupleRt;
    if (!svc) return { ok: false };
    const r = svc.interact(action);
    if (r.ok) {
      const st = svc.status();
      this.sendPetEvent('couple-act', { t: action === 'holdhands' ? 'hands' : action, dir: 'out', name: st.partner.name || 'TA', together: !!st.partner.online });
    }
    return r;
  }

  /** 纪念日 / 整百天：放烟花 + 提示一键截图分享 */
  checkAnniversary(now = new Date()) {
    try {
      const { anniversaryMoment } = require('../shared/moments');
      const snap = this.couplePlus.snapshot(now);
      const m = anniversaryMoment(snap.since || snap.anniversary, now);
      const key = now.toDateString();
      if (!m || this._annivShownOn === key) return null;
      this._annivShownOn = key;
      this.sendPetEvent('fireworks', { title: m.title, days: m.days, kind: m.kind });
      return m;
    } catch {
      return null;
    }
  }

  /** 一键截图（PNG，复制到剪贴板）或录 GIF（默认 2.4 秒）。保存到 图片/Cubbit。 */
  async captureMoment(kind = 'png', { frames = 12, intervalMs = 200 } = {}) {
    const fs = require('node:fs');
    const path = require('node:path');
    const { momentFileName, encodeGif } = require('../shared/moments');
    const win = this.windows.petWindow;
    if (!win || win.isDestroyed()) return { ok: false, error: '桌宠未显示' };
    if (this._capturing) return { ok: false, error: '正在录制' };
    this._capturing = true;
    try {
      const dir = path.join(app.getPath('pictures'), 'Cubbit');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, momentFileName(kind));
      if (kind === 'gif') {
        this.sendPetEvent('say', { text: '录 GIF 中…摆个 pose', emoji: '🎞️' });
        const shots = [];
        for (let i = 0; i < frames; i++) {
          const img = await win.webContents.capturePage();
          shots.push(img);
          await new Promise((r) => setTimeout(r, intervalMs));
        }
        // 统一缩放到首帧尺寸的一半以内（≤320px 宽），控制文件大小
        const base = shots[0].getSize();
        const scale = Math.min(1, 320 / base.width);
        const w = Math.max(1, Math.round(base.width * scale)), h = Math.max(1, Math.round(base.height * scale));
        const list = shots.map((img) => ({ pixels: img.resize({ width: w, height: h }).toBitmap(), delayMs: intervalMs }));
        fs.writeFileSync(file, encodeGif(w, h, list, { bgra: true })); // Electron toBitmap 为 BGRA
      } else {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(file, img.toPNG());
        try { clipboard.writeImage(img); } catch { /* ignore */ }
      }
      this.sendPetEvent('say', { text: kind === 'gif' ? 'GIF 存好啦，发给 TA 吧' : '截图已复制，可以直接粘贴给 TA', emoji: '📸', priority: true });
      try { shell.showItemInFolder(file); } catch { /* ignore */ }
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err && err.message };
    } finally {
      this._capturing = false;
    }
  }

  /** 右键菜单顶部：实时情侣互动（戳/比心/抱抱…）+ 一起专注 */
  _coupleRtMenu() {
    const svc = this.coupleRt;
    if (!svc) return [];
    const st = svc.status();
    const { COUPLE_MENU_ACTIONS } = require('../shared/nav-layout');
    const who = st.partner && st.partner.name ? st.partner.name : 'TA';
    return [
      {
        label: `💞 和 ${who} 互动${st.mode === 'demo' ? '（演示）' : st.partner.online ? ' · 在线' : ''}`,
        submenu: [
          ...COUPLE_MENU_ACTIONS.map(([id, label]) => ({ label, click: () => this.coupleInteract(id) })),
          ...(LITE_MODE ? [] : [
            { type: 'separator' },
            { label: st.focus ? '结束一起专注' : '🍅 一起专注 25 分钟', click: () => (st.focus ? svc.endFocus('abort') : svc.startFocus()) },
          ]),
          { label: '📅 今日打卡', click: () => this.coupleCheckin('checkin') },
          ...(LITE_MODE ? [] : [{ label: '💧 一起浇水', click: () => this.coupleCheckin('water') }]),
          { label: '打开情侣面板', click: () => this.openPanel('couple') },
        ],
      },
      {
        label: '📸 留个瞬间',
        submenu: [
          { label: '截图（复制到剪贴板）', click: () => this.captureMoment('png') },
          { label: '录 GIF（约 2 秒）', click: () => this.captureMoment('gif') },
        ],
      },
      { type: 'separator' },
    ];
  }

  /** 售卖开关（shared/offer-config.js FLAGS）；QA 可用 CUBBIT_FLAG_AI=1 预览 AI 订阅 */
  offerFlags() {
    return { aiCompanion: process.env.CUBBIT_FLAG_AI === '1' || require('../shared/offer-config').FLAGS.aiCompanion };
  }
  priceLocale() {
    try { return this.settings.get('priceLocale') || app.getLocale() || 'zh-CN'; } catch { return 'zh-CN'; }
  }

  /** cubbit://pair?code=XXXXXX 深度链接 */
  handlePairLink(url) {
    if (!/^cubbit:\/\/pair/i.test(String(url || ''))) return false;
    if (this.coupleRt) this.coupleRt.acceptInvite(url).then(() => this.openPanel('couple')).catch(() => {});
    else this._pendingPairLink = url;
    return true;
  }

  sendPetEvent(kind, payload = {}) {
    this.sendToPet(EVENTS.PET_EVENT, { kind, payload, at: Date.now() });
  }

  // ---------------------------------------------------------------- 设置
  applySettings(patch = {}) {
    const clean = { ...patch };
    const isPro = this.entitled();
    const previousCohort = String(this.settings.get('betaCohort') || '');
    const previousOnboardingDone = !!this.settings.get('onboardingDone');
    const previousAnimal = DIY.normalize(this.settings.get('diyPet')).animalId;

    // 机密字段永不进入通用设置补丁：API Key 只能走 INVOKE.AI_CONFIG_SET（加密落盘）
    if (clean.aiApiKey !== undefined) {
      const value = String(clean.aiApiKey == null ? '' : clean.aiApiKey).trim().slice(0, 400);
      this._saveAiApiKey(value);
      delete clean.aiApiKey;
    }
    delete clean.aiApiKeyEnc;
    delete clean.developerMode;

    if (clean.skinId !== undefined) {
      const skin = SKINS.find((s) => s.id === clean.skinId);
      if (!skin) delete clean.skinId;
      else if (!this.skinUnlocked(skin)) {
        return { ok: false, code: 'FEATURE_LOCKED', feature: 'skins_premium', message: `「${skin.name}」是 Pro 皮肤` };
      }
    }
    if (clean.tasks !== undefined) {
      const prev = Array.isArray(this.settings.get('tasks')) ? this.settings.get('tasks') : [];
      const list = (Array.isArray(clean.tasks) ? clean.tasks : []).slice(0, 50).map((t) => ({
        id: String((t && t.id) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 24),
        text: String((t && t.text) || '').trim().slice(0, 60),
        at: /^([01]\d|2[0-3]):[0-5]\d$/.test(String((t && t.at) || '')) ? String(t.at) : '',
        done: !!(t && t.done),
        doneAt: Number(t && t.doneAt) || 0,
        remindedOn: String((t && t.remindedOn) || '').slice(0, 10),
        repeat: ['daily', 'weekdays', 'weekly'].includes(t && t.repeat) ? t.repeat : 'none',
        date: /^\d{4}-\d{2}-\d{2}$/.test(String((t && t.date) || '')) ? String(t.date) : '',
        dow: Number.isInteger(t && t.dow) && t.dow >= 0 && t.dow <= 6 ? t.dow : (/^\d{4}-\d{2}-\d{2}$/.test(String((t && t.date) || '')) ? new Date(t.date + 'T00:00:00').getDay() : new Date().getDay()),
        doneOn: String((t && t.doneOn) || '').slice(0, 10),
      })).filter((t) => t.text);
      for (const t of list) {
        const old = prev.find((x) => x && x.id === t.id);
        if (t.done && !(old && old.done)) {
          t.doneAt = Date.now();
          t.doneOn = this._localDay();
          this.sendPetEvent('task-done', { text: t.text, left: list.filter((x) => !x.done).length });
          if (this.companion) this.companion.add(5, 'task');
        } else if (!old && !t.done) {
          // 新建时提醒时间已过：今天不再补提醒（从下次开始）
          const nd = new Date();
          if (t.at && this._taskDueToday(t, nd)) {
            const [hh, mm] = t.at.split(':').map(Number);
            if (hh * 60 + mm < nd.getHours() * 60 + nd.getMinutes() && !(t.date && t.date < this._localDay(nd))) t.remindedOn = this._localDay(nd);
          }
          const when = (t.repeat === 'daily' ? '每天 ' : t.repeat === 'weekdays' ? '工作日 ' : t.repeat === 'weekly' ? '每周' + '日一二三四五六'[t.dow] + ' ' : t.date ? t.date.slice(5).replace('-', '月') + '日 ' : '') + (t.at || '');
          this.sendPetEvent('say', { text: when.trim() ? '记住啦！' + when.trim() + ' 提醒你「' + t.text + '」' : '记下啦：「' + t.text + '」，我会盯着你的～', emoji: '📝' });
        }
      }
      clean.tasks = list;
    }
    if (clean.customColors && !this.can('custom_colors') && !this.can('custom_character')) {
      return { ok: false, code: 'FEATURE_LOCKED', feature: 'custom_colors', message: '自定义配色是 Pro 功能' };
    }
    if (clean.diyPet !== undefined) clean.diyPet = DIY.normalize(clean.diyPet);
    // 配色来源：面板显式传 colorSource（身体颜色 = 'diy'）；否则点皮肤 / 改 Pro 自定义配色 = 'skin'，
    // DIY 配色真的变了（或刚打开 DIY）= 'diy'。只换形象/配件/性格不改来源。
    if (clean.colorSource !== undefined && clean.colorSource !== 'skin' && clean.colorSource !== 'diy') delete clean.colorSource;
    if (clean.colorSource === undefined) {
      if (clean.skinId !== undefined || (clean.customColors && typeof clean.customColors === 'object')) clean.colorSource = 'skin';
      if (clean.diyPet !== undefined) {
        const prevDiy = DIY.normalize(this.settings.get('diyPet'));
        const nextDiy = clean.diyPet;
        const colorChanged = nextDiy.paletteId !== prevDiy.paletteId || String(nextDiy.bodyColor || '') !== String(prevDiy.bodyColor || '');
        if (nextDiy.enabled && (colorChanged || !prevDiy.enabled)) clean.colorSource = 'diy';
      }
    }
    if (clean.multiPetCount !== undefined) {
      const n = Math.max(1, Math.min(3, Number(clean.multiPetCount) || 1));
      if (n > 1 && !this.can('multi_pet')) return { ok: false, code: 'FEATURE_LOCKED', feature: 'multi_pet', message: '多宠物同屏是完整版功能' };
      clean.multiPetCount = n;
    }
    if (clean.sizeScale !== undefined) clean.sizeScale = Math.max(0.75, Math.min(1.4, Number(clean.sizeScale) || 1));
    if (clean.gameWhitelist !== undefined) {
      clean.gameWhitelist = Array.isArray(clean.gameWhitelist)
        ? clean.gameWhitelist.map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 50)
        : [];
    }
    if (clean.gameAutoHide !== undefined) clean.gameAutoHide = !!clean.gameAutoHide;
    if (clean.backupAutoSync !== undefined) clean.backupAutoSync = !!clean.backupAutoSync;
    if (clean.backupSyncPassword !== undefined) {
      const saved = this._saveBackupPassphrase(clean.backupSyncPassword);
      delete clean.backupSyncPassword;
      if (!saved.ok) return saved;
    }
    if (clean.nightMode) {
      clean.nightMode = {
        enabled: clean.nightMode.enabled !== false,
        start: /^\d{1,2}:\d{2}$/.test(clean.nightMode.start) ? clean.nightMode.start : this.settings.get('nightMode').start,
        end: /^\d{1,2}:\d{2}$/.test(clean.nightMode.end) ? clean.nightMode.end : this.settings.get('nightMode').end,
      };
    }
    if (clean.apiBase !== undefined) {
      clean.apiBase = String(clean.apiBase || '').trim().slice(0, 200);
      this.license.setApiBase(clean.apiBase || PRODUCT.apiBase);
      if (this.social) this.social.setApiBase(clean.apiBase || PRODUCT.apiBase);
    }
    if (clean.coupleProfile && this.social) {
      this.social.setProfile({
        petName: String(clean.coupleProfile.petName || '').slice(0, 20),
        loveNote: String(clean.coupleProfile.loveNote || '').slice(0, 140),
      });
    }
    if (clean.skinId && this.social) this.social.setProfile({ skinId: clean.skinId });
    if (clean.hotkeys) {
      clean.hotkeys = {
        toggle: String(clean.hotkeys.toggle || 'Control+Shift+H').slice(0, 40),
        focus: String(clean.hotkeys.focus || 'Control+Shift+F').slice(0, 40),
      };
    }
    if (clean.autoStart !== undefined) {
      try {
        app.setLoginItemSettings({ openAtLogin: !!clean.autoStart, args: ['--hidden'] });
      } catch (err) {
        console.error('[autostart]', err.message);
      }
    }

    if (clean.language !== undefined) clean.language = I18N.normLang(clean.language);
    if (clean.petPersonality !== undefined) {
      clean.petPersonality = normPersonality(clean.petPersonality);
      clean.aiPersonality = clean.petPersonality;
    }
    if (clean.weatherCity !== undefined) clean.weatherCity = String(clean.weatherCity || '').trim().slice(0, 40);
    if (clean.betaCohort !== undefined) {
      const nextCohort = ['couple', 'solo'].includes(clean.betaCohort) ? clean.betaCohort : '';
      if (nextCohort && nextCohort !== previousCohort) {
        clean.betaCohortAt = Date.now();
        clean.betaCohortSource = String(clean.betaCohortSource || 'onboarding').trim().slice(0, 40);
      } else {
        clean.betaCohortSource = String(clean.betaCohortSource || this.settings.get('betaCohortSource') || '').slice(0, 40);
      }
      clean.betaCohort = nextCohort;
    }
    for (const k of ['memoryEnabled', 'proactiveCare', 'weatherEnabled', 'couplePokeSync', 'petEdgeSnap', 'petEdgeHide']) if (clean[k] !== undefined) clean[k] = !!clean[k];
    const langChanged = clean.language !== undefined && clean.language !== I18N.normLang(this.settings.get('language'));
    // v2.3：切换皮肤时清除自定义配色，避免旧配色静默覆盖新皮肤
    if (clean.skinId && clean.customColors === undefined && this.settings.get('customColors')) clean.customColors = null;
    this.settings.patch(clean);
    if (clean.skinId || clean.customColors !== undefined || clean.diyPet !== undefined || clean.colorSource !== undefined) {
      if (this._skinPreviewTimer) { clearTimeout(this._skinPreviewTimer); this._skinPreviewTimer = null; }
      this.sendPetEvent('skin', { palette: this.currentPalette(), skinId: this.settings.get('skinId') || 'blaze' });
    }
    if (clean.alwaysOnTop !== undefined || clean.multiPetCount !== undefined) {
      this.windows.applyPetSettings();
    }
    // 大小设置变化：窗口跟着缩放，否则放大后会被裁掉（2026-11-04）
    if (clean.sizeScale !== undefined) this.windows.resizePet();
    if (clean.petEdgeHide !== undefined) this.windows.applyEdgeHide();
    if (clean.petRoamEnabled !== undefined) this.windows.scheduleAutoRoam(1200);
    if (clean.hotkeys) this.registerHotkeys();
    if (clean.cinemaManual !== undefined && this.presence) {
      this.sendPetEvent('presence', { ...this.presence.snapshot(), cinema: !!clean.cinemaManual });
    }
    if (langChanged) setTimeout(() => this.onLanguageChanged(), 50);
    const nextCohort = String(this.settings.get('betaCohort') || '');
    if (this.beta && nextCohort && nextCohort !== previousCohort) {
      this.beta.log('cohort_assigned', {
        cohort: nextCohort,
        source: this.settings.get('betaCohortSource') || 'unknown',
      });
    }
    if (this.beta && clean.onboardingDone === true && !previousOnboardingDone) {
      this.beta.log('onboarding_done', { pairChoice: nextCohort || 'unknown' });
    }
    const nextAnimal = DIY.normalize(this.settings.get('diyPet')).animalId;
    if (this.beta && nextAnimal !== 'custom' && nextAnimal !== previousAnimal) {
      this.beta.log('animal_selected', { animal: nextAnimal });
    }
    this.commit();
    return { ok: true, state: this.stateSnapshot() };
  }

  /** 切换界面语言：重载所有窗口、重建托盘、让方块仔用新语言打个招呼 */
  onLanguageChanged() {
    try {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w && !w.isDestroyed()) w.webContents.reload();
      }
    } catch (err) {
      console.error('[i18n] reload', err.message);
    }
    try { refreshTray(this); } catch { /* ignore */ }
    const lang = I18N.normLang(this.settings.get('language'));
    setTimeout(() => {
      const sup = this.speech && this.speech.support ? this.speech.support(lang) : null;
      const hello = { 'zh-CN': '好哒，我们说中文！', en: "Okay, let's speak English!", de: 'Okay, wir sprechen jetzt Deutsch!', ja: 'よし、日本語で話そう！', ko: '좋아, 이제 한국어로 말할게!', fr: "D'accord, parlons français !", it: 'Va bene, parliamo italiano!' }[lang];
      this.sendPetEvent('say', { text: hello, emoji: '🌍', priority: true, noTranslate: true });
      if (sup && !sup.tts) {
        const hint = {
          en: 'No English voice is installed. Add it in Windows Settings → Time & language → Language & region (Text-to-speech).',
          de: 'Keine deutsche Stimme installiert. Windows-Einstellungen → Zeit und Sprache → Sprache und Region → Deutsch hinzufügen (Sprachausgabe).',
          ja: '日本語の音声がありません。Windows の設定 → 時刻と言語 → 言語と地域 で日本語（音声合成）を追加してね。',
          ko: '한국어 음성이 없어요. Windows 설정 → 시간 및 언어 → 언어 및 지역에서 한국어(텍스트 음성 변환)를 추가해 주세요.',
          fr: 'Aucune voix française installée. Paramètres Windows → Heure et langue → Langue et région → ajouter le français (Synthèse vocale).',
          it: 'Nessuna voce italiana installata. Impostazioni di Windows → Data/ora e lingua → Lingua e area → aggiungi italiano (Sintesi vocale).',
        }[lang];
        if (hint) setTimeout(() => this.sendPetEvent('say', { text: hint, emoji: '🔈', priority: true, noTranslate: true, durationMs: 12000 }), 4500);
      }
    }, 1800);
  }

  // ---------------------------------------------------------------- 观影模式
  toggleCinema(force) {
    const next = typeof force === 'boolean' ? force : !this.settings.get('cinemaManual');
    this.settings.patch({ cinemaManual: next });
    const p = this.presence.snapshot();
    this._cinema = next || !!p.cinemaMode;
    this.sendPetEvent('presence', { ...p, cinema: this._cinema, manual: next });
    this.commit();
    return { ok: true, cinemaMode: this._cinema };
  }

  // ---------------------------------------------------------------- 主人状态
  // ---------------------------------------------------------------- AI Key（safeStorage 加密）
  /**
   * 读取本机保存的 AI Key（safeStorage 加密，磁盘上只有密文）。
   * 兼容历史数据：旧的明文字段 aiApiKey 会被自动重新加密并从磁盘上清除（见 store.js）。
   */
  _loadAiApiKey() {
    this._aiApiKey = this.settings.getApiKey();
    this._aiKeyEncrypted = this.settings.isApiKeyEncrypted();
    return this._aiApiKey;
  }

  /** 供 ai.js 使用的明文 Key（仅存在于主进程内存，绝不广播） */
  aiApiKey() {
    return this._aiApiKey || '';
  }

  /**
   * 保存 AI Key：加密后落盘，明文字段不写入 settings.json。
   * 系统不支持安全存储时（部分 Linux 环境）只保留在内存，并提示用户。
   */
  _saveAiApiKey(value) {
    const res = this.settings.setApiKey(value);
    this._aiApiKey = this.settings.getApiKey();
    this._aiKeyEncrypted = res.encrypted;
    if (!res.persisted) {
      // 降级：没有安全存储 → 明文不落盘，仅内存保留
      console.warn('[ai] 系统不支持安全存储，API Key 仅保存在内存中（不会写入磁盘）');
    }
    return res;
  }

  /**
   * 读取本机保存的云同步密码（safeStorage 加密存储）。
   * 兼容历史数据：旧版本在无安全存储时写入的 base64 明文会被识别并重新加密。
   */
  _loadBackupPassphrase() {
    try {
      const res = this.settings.readSecret('backupSyncPassword', 'backupSyncPasswordEnc');
      if (res.value && res.value.length >= 6) this._backupPassphrase = res.value;
      this._backupPassphraseEncrypted = res.encrypted;
    } catch {
      /* ignore */
    }
  }

  backupPassphrase() {
    return this._backupPassphrase || '';
  }

  /**
   * 保存云同步密码：加密后落盘。
   * 系统不支持安全存储时**不落盘**（base64 不是加密），只在内存保留并告知用户。
   */
  _saveBackupPassphrase(password) {
    const pw = String(password || '');
    if (pw.length < 6) return { ok: false, code: 'WEAK_PASSWORD', message: '同步密码至少 6 位' };
    this._backupPassphrase = pw;
    const res = this.settings.writeSecret('backupSyncPassword', 'backupSyncPasswordEnc', pw);
    this._backupPassphraseEncrypted = res.encrypted;
    if (!res.persisted) {
      console.warn('[backup] 系统不支持安全存储，云同步密码仅保存在内存中（不会写入磁盘）');
    }
    return { ok: true, persisted: res.persisted };
  }

  /** 全屏游戏时自动隐藏宠物（可按进程白名单例外） */
  _applyGameAutoHide(p) {
    if (!this.windows || !this.windows.petWindow) return;
    const enabled = this.settings.get('gameAutoHide') !== false;
    const fullGame = enabled && p && p.kind === 'game' && p.fullscreen;
    const app = String((p && p.app) || '').toLowerCase();
    const rawList = this.settings.get('gameWhitelist');
    const list = Array.isArray(rawList) ? rawList : [];
    const whitelisted =
      !!app &&
      list.some((x) => {
        const token = String(x || '').trim().toLowerCase();
        return token && app.includes(token);
      });
    if (fullGame && !whitelisted) {
      if (!this._autoHiddenForGame) {
        this._autoHiddenForGame = true;
        this.windows.petWindow.hide();
        console.log('[presence] 游戏全屏，自动隐藏宠物');
      }
    } else if (this._autoHiddenForGame) {
      this._autoHiddenForGame = false;
      this.windows.petWindow.showInactive();
      console.log('[presence] 退出游戏全屏，恢复宠物');
    }
  }

  onPresenceChanged(p) {
    if (!p) return;
    if (this.life) this.life.onPresence(p.kind);
    this._applyGameAutoHide(p);
    // 前台应用突然切换 → 惊吓反应（限频 45s）
    try {
      const now = Date.now();
      const prev = this._lastPresence;
      this._lastPresence = { kind: p.kind, app: p.app || '', at: now };
      if (
        prev &&
        prev.kind &&
        p.kind &&
        prev.kind !== p.kind &&
        now - prev.at < 2500 &&
        now - (this._lastStartleAt || 0) > 45000 &&
        ['game', 'video', 'meeting'].includes(p.kind)
      ) {
        this._lastStartleAt = now;
        this.sendPetEvent('startle', { from: prev.kind, to: p.kind });
        if (this.lines) {
          const line = this.lines.pick('startle', { mood: this._currentMood() });
          if (line.text) this.sendPetEvent('say', { text: line.text });
        }
      }
    } catch {
      /* ignore */
    }
    const cinema = !!p.cinemaMode;
    this.sendPetEvent('presence', { ...p, cinema });
    if (p.kind === 'away' && !this._sleeping) {
      this._sleeping = true;
      this.sendPetEvent('sleep', { reason: 'away' });
    } else if (p.kind !== 'away' && this._sleeping) {
      this._sleeping = false;
      this.sendPetEvent('wake', { reason: 'presence' });
      if (this.settings.get('presenceReactions')) {
        this.sendPetEvent('say', { text: this.pickLine('wake') });
      }
    }
    if (this.settings.get('presenceReactions') && ['coding', 'working'].includes(p.kind)) {
      // 工作/写代码时偶尔悄悄打气（由渲染层节流）
      this.sendPetEvent('presence-kind', { kind: p.kind });
    }
    this.commit();
  }

  // ---------------------------------------------------------------- 情侣
  onCoupleMessages(messages) {
    if (!Array.isArray(messages) || !messages.length) return;
    const sceneMsgs = messages.filter((m) => String((m && m.text) || '').startsWith('[[scene]]'));
    if (sceneMsgs.length) {
      const last = sceneMsgs[sceneMsgs.length - 1];
      const raw = String(last.text || '').replace('[[scene]]', '').trim();
      const [id, lightRaw] = raw.split('|');
      if (COUPLE_SCENES.some((s) => s.id === id)) {
        this.coupleScene = {
          id,
          light: lightRaw === 'dark' ? 'dark' : 'light',
          updatedAt: Date.now(),
          by: 'partner',
        };
        this._partnerSceneAt = Date.now();
        this.settings.patch({ coupleScene: this.coupleScene });
        this.broadcastEvent(EVENTS.COUPLE_SCENE, this.getCoupleScene());
        this.commit();
      }
    }
    const visible = this.couplePlus.handleIncoming(messages.filter((m) => !String((m && m.text) || '').startsWith('[[scene]]')));
    if (!visible.length) {
      this.commit();
      return;
    }
    messages = visible;
    if (this.life) this.life.onCoupleMessage({ kind: messages[messages.length - 1].kind });
    const partner = this.social.snapshot().partner || {};
    for (const msg of messages) {
      this.sendPetEvent('couple-message', {
        text: msg.text,
        kind: msg.kind || 'chat',
        name: partner.name || 'TA',
      });
    }
    if (this.settings.get('coupleNotify')) {
      try {
        const last = messages[messages.length - 1];
        const n = new Notification({
          title: `${partner.name || 'TA'} 的方块仔`,
          body: String(last.text || '').slice(0, 60),
          silent: true,
        });
        n.on('click', () => this.openPanel('couple'));
        n.show();
      } catch {
        /* ignore */
      }
    }
    this.commit();
  }

  _startSocialLoops() {
    if (this._socialPoll) clearInterval(this._socialPoll);
    if (this._socialBeat) clearInterval(this._socialBeat);
    this._socialPoll = setInterval(async () => {
      try {
        if (!this.social || !this.social.snapshot().enabled) return;
        const res = await this.social.poll();
        if (res && Array.isArray(res.messages) && res.messages.length) this.onCoupleMessages(res.messages);
        if (res && res.couple) this.commit();
      } catch {
        /* ignore */
      }
    }, 4000);
    this._socialBeat = setInterval(async () => {
      try {
        if (!this.social || !this.social.snapshot().enabled) return;
        await this.social.heartbeat({
          kind: this.presence.snapshot().kind,
          app: this.presence.snapshot().app,
          title: this.presence.snapshot().title,
        });
      } catch {
        /* ignore */
      }
    }, 25000);
  }

  // ---------------------------------------------------------------- 更新
  _initAutoUpdater() {
    if (!app.isPackaged || !this.updater) return;
    try {
      const { autoUpdater } = require('electron-updater');
      // 优先用户自设的更新源，其次构建期注入的生产更新源，最后回落到 API 地址下的 /updates
      const custom = String(this.settings.get('updateFeedUrl') || '').trim();
      const feed = (custom || UPDATE_FEED_URL || String(this.apiBase || '').replace(/\/+$/, '')).replace(/\/+$/, '');
      if (!feed) return;
      const ok = this.updater.attachAutoUpdater(autoUpdater, feed);
      if (ok) {
        this._autoUpdater = autoUpdater;
        console.log('[update] auto updater attached:', feed);
      }
    } catch (err) {
      console.log('[update] auto updater unavailable:', err && err.message);
    }
  }

  // ---------------------------------------------------------------- 智慧生命
  _startLife() {
    try {
      this.life.start();
      // 启动时先补一次"它今天的样子"：否则每次重启毛色都回到默认，
      // 用户会以为账本里的状态丢了（这一条是实测发现的，界面和状态对不上最伤人）。
      const startMood = this.ledger ? this.ledger.mood() : null;
      if (startMood) {
        setTimeout(() => {
          try { this.sendPetEvent('life-resource', startMood); } catch { /* 窗口没了就算了 */ }
        }, 2400);
      }
      // 人生指南：今天还没体验试炼，就让它在启动 12 秒后轻声提醒一句。
      const nudge = this.ledger ? this.ledger.nudge() : null;
      if (nudge) {
        setTimeout(() => {
          try {
            this.sendPetEvent('say', { text: nudge, emoji: '🧭', durationMs: 9000 });
          } catch { /* 窗口已销毁就不说了 */ }
        }, 12000);
      }
      this.life.on('thought', ({ text, important }) => {
        if (!text) return;
        this.sendPetEvent('thought', { text, important: !!important });
        this.sendPetEvent('say', { text });
        this.commit();
      });
      this.life.on('mood', (m) => {
        this.sendPetEvent('mood', m);
        this.commit();
      });
      this.life.on('changed', () => {
        const now = Date.now();
        if (now - (this._lifeCommitAt || 0) > 20000) {
          this._lifeCommitAt = now;
          this.commit();
        }
      });
    } catch (err) {
      console.error('[life]', err && err.message);
    }
  }

  // ---------------------------------------------------------------- 面板
  openPanel(name) {
    // v2.9.2 正式版：所有「商店 / 升级」入口统一指向购买 / 激活页（PayPal.me 付款 + 激活码）
    if (name === 'store') name = 'paywall';
    const win = this.windows.openPanel(name);
    if (win) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send(EVENTS.STATE_CHANGED, this.stateSnapshot());
      });
    }
    return win;
  }

  /** v2.4 Lite 版右键菜单：只留「表情 / 情侣互动 / 皮肤 / 设置」 */
  _showLitePetMenu() {
    const lang = this.settings.get('language') || 'zh-CN';
    const zh = String(lang).toLowerCase().startsWith('zh');
    const L = (a, b) => (zh ? a : b);
    const state = this.stateSnapshot();
    const skinItems = SKINS.map((s) => ({
      label: `${this.skinUnlocked(s) ? '' : '🔒 '}${s.name}${state.settings.skinId === s.id ? '  ✓' : ''}`,
      click: () => {
        const res = this.applySettings({ skinId: s.id });
        if (!res.ok) { this.previewSkin(s.id); this.openPanel('store'); }
      },
    }));
    const coupleItems = (this.couplePlus ? this.couplePlus.snapshot().actions : [])
      .filter((a) => ['poke', 'heart', 'hug', 'kiss', 'highfive', 'hands', 'goodnight'].includes(a.id))
      .map((a) => ({
        label: `${a.emoji || ''} ${a.label}`,
        click: () => this.couplePlus.act(a.id).then((r) => {
          if (r && !r.ok && r.message) this.sendPetEvent('say', { text: r.message, emoji: '💌' });
        }),
      }));
    const menu = Menu.buildFromTemplate([
      ...this._coupleRtMenu(),
      { label: L('摸摸它', 'Pet it'), click: () => this.sendPetEvent('interact', { type: 'pet' }) },
      { label: L('💞 和 TA 互动', '💞 Play with them'), submenu: coupleItems.length ? coupleItems : [{ label: L('先配对', 'Pair first'), enabled: false }] },
      { label: L('🍪 喂点吃的', '🍪 Feed it'), click: () => this.feedFromMenu() },
      { type: 'separator' },
      { label: L('皮肤', 'Skins'), submenu: skinItems },
      { label: L('形象馆 · 换一只', 'Wardrobe · Change pet'), click: () => this.openPanel('wardrobe') },
      { label: L('🧭 人生指南 · 三场试炼', '🧭 Life Guide · 3 Trials'), click: () => this.openPanel('ledger') },
      { label: L('🗺️ 神秘探险', '🗺️ Mysterious Adventure'), click: () => this.openPanel('farm') },
      { label: L('📷 拍一只 · 变成桌宠', '📷 Turn a photo into a pet'), click: () => this.openPanel('photo') },
      { label: L('🎬 观影模式（只留眼睛）', '🎬 Cinema mode (eyes only)'), click: () => this.toggleCinema() },
      {
        label: this.coupleUnread > 0
          ? L(`💌 ${this.coupleUnread} 条新悄悄话`, `💌 ${this.coupleUnread} new note(s)`)
          : L('💞 我们俩', '💞 Us two'),
        click: () => this.openPanel('couple'),
      },
      { type: 'separator' },
      { label: L('💳 购买 / 激活', '💳 Buy / Activate'), click: () => this.openPanel('paywall') },
      { label: L('设置', 'Settings'), click: () => this.openPanel('settings') },
      { label: L('隐藏', 'Hide'), click: () => this.windows.hidePet() },
      { type: 'separator' },
      { label: L('退出 方块仔', 'Quit Cubbit'), click: () => this.quit() },
    ]);
    menu.popup({ window: this.windows.petWindow || undefined });
  }

  // ---------------------------------------------------------------- 桌宠右键菜单
  showPetMenu() {
    if (LITE_MODE) return this._showLitePetMenu();
    const isPro = this.entitled();
    const state = this.stateSnapshot();
    const skinItems = SKINS.map((s) => ({
      label: `${this.skinUnlocked(s) ? '' : '🔒 '}${s.name}${state.settings.skinId === s.id ? '  ✓' : ''}`,
      click: () => {
        const res = this.applySettings({ skinId: s.id });
        if (!res.ok) { this.previewSkin(s.id); this.openPanel('store'); }
      },
    }));
    const lv = this.companion ? this.companion.level() : 1;
    const coupleItems = (this.couplePlus ? this.couplePlus.snapshot().actions : [])
      .filter((a) => ['poke', 'heart', 'hug', 'kiss', 'highfive', 'hands', 'goodnight', 'focus'].includes(a.id))
      .map((a) => ({
        label: `${a.minIntimacy && lv < a.minIntimacy ? '🔒 ' : ''}${a.emoji || ''} ${a.label}${a.minIntimacy && lv < a.minIntimacy ? `（亲密度 Lv.${a.minIntimacy}）` : ''}`,
        enabled: !(a.minIntimacy && lv < a.minIntimacy),
        click: () => this.couplePlus.act(a.id, { minutes: 25 }).then((r) => { if (r && !r.ok && r.message) this.sendPetEvent('say', { text: r.message, emoji: '💌' }); }),
      }));
    const menu = Menu.buildFromTemplate(I18N.trMenu(this.settings.get('language'), [
      ...this._coupleRtMenu(),
      { label: '摸摸它', click: () => this.sendPetEvent('interact', { type: 'pet' }) },
      { label: '💞 情侣空间玩法', submenu: coupleItems.length ? coupleItems : [{ label: '先配对', enabled: false }] },
      { label: '💛 情侣空间 / 记忆', click: () => this.openPanel('settings') },
      {
        label: '对 TA 说「想你」',
        click: () => {
          if (!this.social || !this.social.snapshot().enabled) {
            this.sendPetEvent('say', { text: '先在情侣模式里和 TA 配对呀' });
            return;
          }
          this.social.send('想你啦', 'love').then(() => this.commit()).catch(() => {});
          this.sendPetEvent('couple-message', { text: '想你啦', kind: 'love', name: this.social.snapshot().partner.name || 'TA' });
        },
      },
      { label: '喂点吃的', click: () => this.feedFromMenu() },
      { type: 'separator' },
      { label: '皮肤', submenu: skinItems },
      { label: '形象馆 · 换一只', click: () => this.openPanel('wardrobe') },
      {
        label: '🧭 人生指南 · 三场试炼',
        click: () => this.openPanel('ledger'),
      },
      { label: '📷 拍一只 · 变成桌宠', click: () => this.openPanel('photo') },
      {
        label: state.ui.cinemaMode ? '退出观影模式' : '观影模式（只留发光的眼睛）',
        click: () => {
          const res = this.toggleCinema();
          this.sendPetEvent('say', { text: res.cinemaMode ? '灯光调暗，我只留一双眼睛陪你' : '开灯啦～' });
        },
      },
      {
        label: this.coupleUnread > 0 ? `💌 ${this.coupleUnread} 条新悄悄话` : `情侣模式${state.couple && state.couple.enabled ? ' · 已配对' : ''}`,
        click: () => {
          if (!this.entitled() && !(this.coupleUnread > 0 || (this.coupleRt && this.coupleRt.paired))) {
            this.sendPetEvent('locked', { feature: 'couple_mode', message: '情侣模式是 Pro 功能' });
            this.openPanel('store');
            return;
          }
          this.openPanel('couple');
        },
      },
      { type: 'separator' },
      { label: '🗺️ 神秘探险', click: () => this.openPanel('farm') },
      { label: '和 TA 聊聊', click: () => this.openPanel('chat') },
      {
        label: '🧰 更多工具',
        submenu: [
          { label: state.focus.running ? '结束专注' : '专注 25 分钟', click: () => this.toggleFocusFromMenu() },
          { label: '办公助手 / 任务', click: () => this.openPanel('settings') },
          { label: '🎤 对它说话（Ctrl+Shift+V）', click: () => this.voiceTalk() },
        ],
      },
      { label: '检查更新', click: () => this.updater && this.updater.check({ manual: true }).then((st) => { if (st && st.available) this.openPanel('settings'); }) },
      { label: '商店 / 升级 Pro', click: () => this.openPanel('store') },
      { label: '设置', click: () => this.openPanel('settings') },
      { label: '隐藏', click: () => this.windows.hidePet() },
      { type: 'separator' },
      { label: '退出 方块仔', click: () => this.quit() },
    ]));
    menu.popup({ window: this.windows.petWindow || undefined });
  }

  feedFromMenu() {
    // 「喂养」对所有用户开放 —— 它是免费用户唯一的日常回访钩子。
    // 等级上限与成就徽章仍为 Pro 权益（见 growth.js 的 canLevelUp）。
    const res = this.growth.feed(this.can('growth'));
    if (!res.ok) {
      this.sendPetEvent('sad', { reason: 'cooldown' });
      this.sendPetEvent('say', { text: '刚刚才吃过，等一会儿嘛～' });
      return;
    }
    if (this.life) this.life.feed();
    this.sendPetEvent('feed', { growth: res.growth, line: this.pickLine('feed') });
    this.commit();
  }

  toggleFocusFromMenu() {
    if (this.focus.state.running) {
      this.focus.stop();
      return;
    }
    const minutes = this.entitled()
      ? Math.min(180, Math.max(5, Number(this.settings.get('focus')?.lastMinutes) || 25))
      : 25;
    this.focus.start({ minutes, label: this.settings.get('focus')?.lastLabel || '' });
    this.sendPetEvent('say', { text: this.pickLine('focus') });
  }

  _currentMood() {
    try {
      if (this.life && typeof this.life.snapshot === 'function') return this.life.snapshot().mood || 'calm';
    } catch {
      /* ignore */
    }
    return 'calm';
  }

  getCoupleScene() {
    const current = this.coupleScene || { id: 'coffee', light: 'light', updatedAt: 0 };
    const partnerHere = !!this._partnerSceneAt && Date.now() - this._partnerSceneAt < 2 * 3600 * 1000;
    return {
      ok: true,
      scenes: COUPLE_SCENES,
      current: { ...current },
      partnerHere,
      entitled: this.entitled(),
    };
  }

  setCoupleScene({ id, light, announce } = {}) {
    const scene = COUPLE_SCENES.find((s) => s.id === id);
    if (!scene) return { ok: false, code: 'BAD_SCENE', message: '未知场景' };
    this.coupleScene = {
      id: scene.id,
      light: light === 'dark' ? 'dark' : 'light',
      updatedAt: Date.now(),
      by: 'me',
    };
    this.settings.patch({ coupleScene: this.coupleScene });
    this.broadcastEvent(EVENTS.COUPLE_SCENE, this.getCoupleScene());
    if (announce && this.social && this.social.token) {
      this.social.sendScene(this.coupleScene.id, this.coupleScene.light).catch(() => {});
    }
    this.commit();
    return this.getCoupleScene();
  }

  broadcastEvent(channel, payload) {
    this.sendToPet(channel, payload);
    for (const panel of this.windows.panels.values()) {
      if (!panel.isDestroyed()) panel.webContents.send(channel, payload);
    }
  }

  pickLine(kind) {
    const CONTEXT = {
      greeting: 'morning',
      pet: 'idle',
      click: 'idle',
      throw: 'idle',
      wake: 'morning',
      night: 'night',
      focus: 'focus',
      focusDone: 'focusDone',
      feed: 'feed',
      locked: 'idle',
      drop: 'startle',
    };
    let mood = 'calm';
    try {
      if (this.life && typeof this.life.snapshot === 'function') mood = this.life.snapshot().mood || 'calm';
    } catch {
      /* ignore */
    }
    if (this.lines) {
      const picked = this.lines.pick(CONTEXT[kind] || 'idle', { mood });
      if (picked && picked.text) return picked.text;
    }
    const pool = LINES[kind] || LINES.click;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------------------------------------------------------------- 活跃度 / 惊吓（隐私安全）
  _startActivityMonitor() {
    if (this._activityTimer) clearInterval(this._activityTimer);
    let lastIdle = -1;
    let lastPulse = 0;
    this._activityTimer = setInterval(() => {
      try {
        const idle = powerMonitor.getSystemIdleTime();
        if (this.companion) this.companion.noteActivity(idle);
        if (this.farm && this.settings.get('farmEnabled')) this.farm.tickIdle(idle * 1000, this.settings.get('farmAutoWork') !== false);
        if (lastIdle >= 0 && idle < lastIdle && idle <= 2) {
          const now = Date.now();
          if (now - lastPulse > 1500) {
            lastPulse = now;
            this.sendPetEvent('activity', { intensity: idle === 0 ? 1 : 0.6, at: now });
            // 偶尔跟一句「按节奏」的台词（限频 60s，不影响性能）
            if (this.lines && now - (this._lastActivitySayAt || 0) > 60000 && Math.random() < 0.12) {
              this._lastActivitySayAt = now;
              const line = this.lines.pick('activity', { mood: this._currentMood() });
              if (line.text) this.sendPetEvent('say', { text: line.text });
            }
          }
        }
        lastIdle = idle;
      } catch {
        /* ignore */
      }
    }, 1000);
  }

  // ---------------------------------------------------------------- 快捷键
  registerHotkeys() {
    globalShortcut.unregisterAll();
    const hk = this.settings.get('hotkeys') || {};
    const tryRegister = (accel, fn, label) => {
      if (!accel) return;
      try {
        const ok = globalShortcut.register(accel, fn);
        if (!ok) console.warn(`[hotkeys] 注册失败: ${label} ${accel}`);
      } catch (err) {
        console.warn(`[hotkeys] 非法加速键: ${label} ${accel}`, err.message);
      }
    };
    // v2.5 灵感速记：把剪贴板里的文字存成灵感；剪贴板为空则打开办公助手
    tryRegister(hk.note || 'Control+Alt+N', () => {
      let t = '';
      try { t = String(clipboard.readText() || '').trim(); } catch { /* ignore */ }
      if (t && t.length <= 500 && this.paid) this.paid.addNote({ text: t });
      else this.windows.openPanel('settings');
    }, 'note');
    tryRegister(hk.toggle || 'Control+Shift+H', () => this.windows.togglePet(), 'toggle');
    tryRegister(hk.focus || 'Control+Shift+F', () => {
      if (this.focus.state.running) this.focus.stop();
      else this.focus.start({ minutes: FREE_MINUTES, label: '' });
    }, 'focus');
    tryRegister('Control+Shift+M', () => this.toggleCinema(), 'cinema');
    tryRegister('Control+Shift+V', () => this.voiceTalk(), 'voice');
  }

  // ---------------------------------------------------------------- 生命周期
  start() {
    this.license.init().then(() => this.commit());

    this.theme.start();
    this.theme.on('changed', (t) => {
      this.sendPetEvent('theme', t);
      this.commit();
    });

    this.focus.on('tick', () => {
      const snap = this.focus.snapshot();
      this.sendPetEvent('focus-tick', snap);
      if (!this.focus.state.running) this.commit();
    });
    this.focus.on('complete', ({ minutes, label }) => {
      this.growth.focusCompleted(minutes);
      if (this.life) this.life.focusCompleted(minutes);
      this.sendPetEvent('focus-complete', { minutes, label, line: this.pickLine('focusDone') });
      this.notify('专注完成 🍅', `这一轮 ${minutes} 分钟完成啦，休息一下～`);
      this.commit();
    });
    this.focus.on('recorded', () => this.commit());

    this.growth.on('levelup', ({ level }) => {
      this.sendPetEvent('levelup', { level });
      this.notify('方块仔升级啦！', `你们的亲密度达到 ${level} 级，它更粘人了一点。`);
      this.commit();
    });
    this.growth.on('achievement', (items) => {
      this.sendPetEvent('achievement', { achievements: items });
      this.commit();
    });

    this.license.on('changed', () => {
      this.growth.setSkinCount(this.entitled() ? 8 : 2);
      this.commit();
    });

    this.windows.createPet();
    // 插拔显示器 / 改分辨率 / 任务栏位置变化后，把方块仔拉回可见区域
    try {
      const fix = () => setTimeout(() => this.windows.ensureOnScreen(), 300);
      screen.on('display-removed', fix);
      screen.on('display-added', fix);
      screen.on('display-metrics-changed', fix);
    } catch (err) { console.error('[screen]', err.message); }
    tray = createTray(this);
    registerIpc(this);
    this.registerHotkeys();

    // 主人状态感知（前台窗口 / 全屏 / 闲置 → 观影模式与表情反应）
    try {
      this.presence.start();
      this.presence.on('changed', (p) => this.onPresenceChanged(p));
    } catch (err) {
      console.error('[presence]', err && err.message);
    }

    // 智慧生命：需求/心情/性格/记忆/主动说话
    this._startLife();

    // 台词库：加载 bundled + 拉取月度增量（每天最多一次）
    try {
      if (this.lines) {
        this.lines.load();
        this.lines.refresh().catch(() => {});
        if (this._linesTimer) clearInterval(this._linesTimer);
        this._startTaskTimer();
        if (this.companion) this.companion.start();
        if (this.paid) this.paid.start();
        this._linesTimer = setInterval(() => this.lines.refresh().catch(() => {}), 6 * 3600 * 1000);
      }
    } catch {
      /* ignore */
    }

    // 活跃度脉冲（基于系统闲置时间，不采集按键内容）
    this._startActivityMonitor();

    // 崩溃捕获（本地日志；开启 crashReportEnabled 才上报最小信息）
    if (this.crash) {
      this.crash.install();
      app.on('render-process-gone', (_e, _wc, details) => {
        if (!this._quitting) this.crash.capture('render-process-gone', details || {});
        this._onRenderCrashLoop(details || {});
        this._recoverPetWindow(_wc);
      });
      app.on('child-process-gone', (_e, details) => {
        if (!this._quitting) this.crash.capture('child-process-gone', details || {});
      });
    }

    // 自动更新：v2.9.3 起统一走「检查 app-latest.json → 提示 → 打开官网下载」（安装包未签名，不做静默安装）。
    // electron-updater 暂不挂载；签名就绪后再调用 this._initAutoUpdater()。

    // 更新检查（默认静默检查，失败不打扰；设置里可关）
    if (this.updater) {
      this.updater.on('available', (latest) => {
        this.sendPetEvent('update-available', { version: latest.version });
        try {
          const lang = this.settings.get('language') || 'zh-CN';
          const text = I18N.tr(lang, `有新版本 v${latest.version} 啦！右键我 → 设置 → 关于 → 检查更新`);
          setTimeout(() => this.sendPetEvent('say', { text, emoji: '⬆️', durationMs: 12000 }), 1500);
        } catch { /* 提示失败不影响检查 */ }
        this.commit();
      });
      setTimeout(() => {
        if (this._autoUpdater) {
          this._autoUpdater
            .checkForUpdates()
            .then((result) => {
              console.log('[update] auto check resolved:', JSON.stringify(result && result.updateInfo && result.updateInfo.version));
              if (this.updater.applyCheckResult(result)) {
                this.sendPetEvent('update-available', { version: this.updater.latest.version });
              }
              this.commit();
            })
            .catch((err) => {
              console.log('[update] auto check failed:', err && err.message);
            });
        } else {
          this.updater.check({ manual: false }).catch(() => {});
        }
      }, 25000);
    }

    // AI 对话：消息广播 + 状态节流持久化
    if (this.ai) {
      this.ai.on('message', (msg) => this.sendAiMessage(msg));
      this.ai.on('changed', () => {
        const now = Date.now();
        if (now - (this._aiCommitAt || 0) > 1500) {
          this._aiCommitAt = now;
          this.commit();
        }
      });
    }


    // 留存：打卡 / 一起浇水 / 里程碑皮肤
    try {
      const { Retention } = require('./couple/retention');
      this.retention = new Retention({ file: require('node:path').join(app.getPath('userData'), 'couple-retention.json') });
    } catch { this.retention = null; }
    // 内测埋点 v2（本地 JSONL，不上传；cohort 与配对组哈希在事件层固定）
    try {
      const userDataDir = app.getPath('userData');
      const currentCoupleId = () => {
        try {
          if (this.coupleRt && this.coupleRt.state && this.coupleRt.state.coupleId) {
            return this.coupleRt.state.coupleId;
          }
          const local = JSON.parse(
            require('node:fs').readFileSync(require('node:path').join(userDataDir, 'couple-rt.json'), 'utf8')
          );
          return local && local.coupleId ? local.coupleId : '';
        } catch {
          return '';
        }
      };
      this.beta = new BetaStats({
        dir: userDataDir,
        version: APP_PKG.version,
        installId: this.license ? this.license.getDeviceId() : '',
        cohortProvider: () => this.settings.get('betaCohort') || 'unknown',
        groupProvider: currentCoupleId,
        channel: 'beta',
        experiment: 'softlaunch-2026-11',
      });
      this.beta.log('app_open', { cold: true });
    } catch { this.beta = null; }
    // 实时情侣联机（PubNub/Firebase；无配置时为“阿橘”演示模式）
    this._initCoupleRt();
    // 纪念日烟花：启动 20s 后检查一次，之后每小时检查（每天最多放一次）
    setTimeout(() => { this.checkAnniversary(); this.checkMilestones(); }, 20000);
    this._annivTimer = setInterval(() => { this.checkAnniversary(); this.checkMilestones(); }, 3600000);
    if (this._annivTimer.unref) this._annivTimer.unref();

    // 情侣模式（旧 SocialClient）默认停用：
    //  - 新的实时联机由上方 _initCoupleRt() 提供；
    //  - 旧栈未配置时会显示「情侣服务暂不可用」红字，与真实状态矛盾（见商业价值评估 §1.2）。
    // 需要回退旧栈时设置环境变量 CUBBIT_LEGACY_SOCIAL=1。
    if (process.env.CUBBIT_LEGACY_SOCIAL !== '1' && this.social) {
      try {
        this.social.init = () => Promise.resolve();
        this.social.enabled = false;
      } catch { /* ignore */ }
    }
    // 情侣模式初始化 + 轮询
    this.social
      .init()
      .then(() => {
        this.social.on('changed', () => {
          if (this.life) this.life.setCouple(this.social.snapshot());
          this.windows.applyPetSettings();
          this.commit();
        });
        this.social.on('error', () => this.commit());
        this.commit();
        this._startSocialLoops();
      })
      .catch(() => {
        /* 情侣服务不可用不影响主流程 */
      });

    // 语音（Windows SAPI 常驻 worker）
    this.speech.start();

    // 鼠标位置广播（眼睛跟随）
    // v2.2：随空闲/睡眠降频；坐标没变就不发 IPC（原来固定 100ms 一次）
    const { PERIODS } = require('./power-governor');
    let lastCursorKey = '';
    this.power.every('cursor', () => {
      const win = this.windows.petWindow;
      if (!win || win.isDestroyed() || !this.windows.petVisible) return;
      const c = screen.getCursorScreenPoint();
      const [wx, wy] = win.getPosition();
      const key = c.x + ',' + c.y + ',' + wx + ',' + wy;
      if (key === lastCursorKey) return;
      lastCursorKey = key;
      this.sendToPet(EVENTS.PET_CURSOR, { x: c.x, y: c.y, wx, wy });
    }, PERIODS.cursor);
    this.power.on('mode', (mode) => {
      this.sendPetEvent('power', { mode });
      if (process.env.CUBBIT_PERF_LOG) console.log('[power]', mode, JSON.stringify(this.power.stats().wakeups));
    });
    for (const [ev, flag, on] of [['lock-screen', 'locked', true], ['unlock-screen', 'locked', false], ['suspend', 'suspended', true], ['resume', 'suspended', false]]) {
      try { powerMonitor.on(ev, () => this.power.setFlag(flag, on)); } catch { /* 部分平台无此事件 */ }
    }
    this.power.start();

    // 首次启动：引导页
    if (!this.settings.get('onboardingDone')) {
      setTimeout(() => this.openPanel('onboarding'), 1200);
    }
  }

  notify(title, body) {
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title, body, silent: false });
        n.on('click', () => this.openPanel('settings'));
        n.show();
      }
    } catch (err) {
      console.error('[notify]', err.message);
    }
  }

  quit() {
    this._quitting = true;
    this.focus.destroy();
    this.theme.stop();
    if (this.presence) this.presence.stop();
    if (this.speech) this.speech.stop();
    if (this.life) this.life.stop();
    if (this._activityTimer) clearInterval(this._activityTimer);
    if (this._linesTimer) clearInterval(this._linesTimer);
    if (this._cursorTimer) clearInterval(this._cursorTimer);
    if (this._idleTimer) clearInterval(this._idleTimer);
    if (this._socialPoll) clearInterval(this._socialPoll);
    if (this._socialBeat) clearInterval(this._socialBeat);
    globalShortcut.unregisterAll();
    this.windows.closeAll();
    if (tray) {
      try {
        tray.destroy();
      } catch {
        /* ignore */
      }
    }
    app.quit();
  }
}

let runtime = null;
let tray = null;

/**
 * 开发/QA 用：把各个窗口的内容直接截成 PNG（不依赖桌面截图，能看清透明窗口的真实渲染）。
 * 用法：electron app --capture=<dir>
 */
/** QA/演示：连续抓帧（用于生成演示视频），可在第 N 帧触发一次宠物点击 */
async function captureSequence({ dir, frames, interval, clickAt, target }) {
  const fs = require('node:fs');
  const path = require('node:path');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const win = runtime.windows.petWindow;
    for (let i = 0; i < frames; i++) {
      if (!win || win.isDestroyed()) break;
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `frame-${String(i).padStart(3, '0')}.png`), img.toPNG());
      } catch {
        /* ignore */
      }
      if (i === clickAt) {
        try {
          await win.webContents.executeJavaScript('window.__cubbitDemo && window.__cubbitDemo.click()');
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    console.log('[capture-seq] done', frames, dir);
  } catch (err) {
    console.log('[capture-seq-error]', err && err.message);
  }
}

async function captureRuntime(dir) {
  const fs = require('node:fs');
  const path = require('node:path');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const targets = [];
    if (runtime.windows.petWindow) targets.push(['pet', runtime.windows.petWindow]);
    for (const [name, win] of runtime.windows.panels) targets.push([name, win]);
    for (const [name, win] of targets) {
      if (!win || win.isDestroyed()) continue;
      try {
        const img = await win.webContents.capturePage();
        const out = path.join(dir, `${name}.png`);
        fs.writeFileSync(out, img.toPNG());
        console.log('[capture]', out, img.getSize());
      } catch (err) {
        console.log('[capture-fail]', name, err && err.message);
      }
    }
  } catch (err) {
    console.log('[capture-error]', err && err.message);
  }
}

// QA 截图/多实例调试时可用 --multi-instance 绕过单实例锁
const gotLock = process.argv.includes('--multi-instance') ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 许可/网络等后台任务不应因为一个未捕获的 Promise 而让桌宠整体消失
  process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  });

  app.on('second-instance', (_event, argv) => {
    const pairLink = (argv || []).find((a) => /^cubbit:\/\/pair/i.test(a));
    if (runtime && pairLink && runtime.handlePairLink(pairLink)) return;
    if (runtime) {
      runtime.windows.showPet();
      const openArg = (argv || []).find((a) => a.startsWith('--open='));
      runtime.openPanel(openArg ? openArg.split('=')[1] : 'settings');
    }
  });

  try { app.setAsDefaultProtocolClient('cubbit'); } catch { /* ignore */ }
  app.whenReady().then(() => {
    runtime = new AppRuntime();
    // QA：--open=paywall / --open=couple 直接打开某个面板（首实例也生效）
    {
      const openArg0 = process.argv.find((a) => a.startsWith('--open='));
      if (openArg0) setTimeout(() => { try { runtime.openPanel(openArg0.split('=')[1]); } catch { /* ignore */ } }, 1500);
    }
    // QA/支持：--qa-export 启动后直接导出一次内测数据（验证「托盘导出」链路）
    if (process.argv.includes('--qa-export')) {      setTimeout(() => {
        try {
          const res = runtime.exportBetaData();
          console.log('[qa-export]', JSON.stringify(res));
        } catch (err) {
          console.error('[qa-export] failed', err && err.message);
        }
      }, 3000);
    }
    // QA：--qa-tts 触发一次神经语音（验证服务端合成 + 事件下发）
    if (process.argv.includes('--qa-tts')) {
      setTimeout(() => {
        try {
          runtime.settings.patch({ voiceEnabled: true });
          const ok = runtime.speech.speak('你好呀，我是方块仔，今天也要开开心心的', { force: true });
          console.log('[qa-tts]', ok);
        } catch (err) {
          console.log('[qa-tts-error]', err && err.message);
        }
      }, 5000);
    }    // QA：--qa-ai 直接跑一次内置 AI 对话（验证主进程 -> 服务器代理 -> DeepSeek 全链路）
    if (process.argv.includes('--qa-ai')) {
      setTimeout(async () => {
        try {
          const r = await runtime.ai.chat('你好呀，你是谁？');
          console.log('[qa-ai]', JSON.stringify(r));
        } catch (err) {
          console.log('[qa-ai-error]', err && err.message);
        }
      }, 5000);
    }
    // QA：--qa-climb 模拟「贴左墙 + 攀爬」，用来截图验证姿态
    if (process.argv.includes('--qa-climb')) {
      setTimeout(() => {
        try {
          runtime.windows.rt.sendToPet('pet:event', { kind: 'drag-end', payload: { edge: 'left' } });
          runtime.windows.rt.sendToPet('pet:event', { kind: 'climb', payload: { edge: 'left' } });
          console.log('[qa-climb] sent');
        } catch (err) {
          console.log('[qa-climb-error]', err && err.message);
        }
      }, 4000);
    }
    // QA：--qa-roam 触发「绕桌面走一圈」并打印窗口坐标，验证真的在移动
    if (process.argv.includes('--qa-roam')) {
      setTimeout(() => {
        try {
          const before = runtime.windows.petWindow.getPosition();
          runtime.windows.roam();
          let i = 0;
          const t = setInterval(() => {
            const p = runtime.windows.petWindow.getPosition();
            console.log('[qa-roam]', i, p[0], p[1], 'from', before.join(','));
            i += 1;
            if (i > 30) { clearInterval(t); runtime.windows.stopRoam(); }
          }, 500);
        } catch (err) { console.log('[qa-roam-error]', err && err.message); }
      }, 5000);
    }    const firstPairLink = process.argv.find((a) => /^cubbit:\/\/pair/i.test(a));    if (firstPairLink) runtime.handlePairLink(firstPairLink);
    // QA：--qa-pair 自动点一次「生成邀请码」，用来验证二维码 / 邀请信息是否真的渲染出来
    if (process.argv.includes('--qa-pair')) {
      setTimeout(async () => {
        try {
          const win = runtime.windows.panels && runtime.windows.panels.get ? runtime.windows.panels.get('couple') : null;
          if (!win) return console.log('[qa-pair] no couple panel');
          const r = await win.webContents.executeJavaScript(
            "(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('生成邀请码')); if (!b) return 'no-button'; b.click(); return 'clicked'; })()",
          );
          console.log('[qa-pair]', r);
          await new Promise((res) => setTimeout(res, 2500));
          const code = await win.webContents.executeJavaScript(
            "(() => { const el = document.querySelector('.crt-code b'); return el ? el.textContent.trim() : ''; })()",
          );
          console.log('[qa-pair-code]', code);
        } catch (err) {
          console.log('[qa-pair-error]', err && err.message);
        }
      }, 5000);
    }
    // 版本升级后清一次 Chromium 缓存，避免旧版渲染资源被缓存
    try {
      const lastVer = runtime.settings.get('lastRunVersion') || '';
      if (lastVer !== app.getVersion()) {
        const sess = session.defaultSession;
        if (sess && sess.clearCache) sess.clearCache().catch(() => {});
        if (sess && sess.clearCodeCaches) sess.clearCodeCaches({}).catch(() => {});
        runtime.settings.patch({ lastRunVersion: app.getVersion() });
        console.log('[cache] cleared for version', app.getVersion());
      }
    } catch {
      /* ignore */
    }
    // 开发/测试用参数：--open=store|settings|onboarding、--no-onboarding、--capture=<dir>
    const argv = process.argv.slice(1);
    if (argv.includes('--no-onboarding')) runtime.settings.patch({ onboardingDone: true });
    if (argv.includes('--pet-topleft')) runtime.settings.patch({ petPosition: { x: 60, y: 120 } });
    const petAt = argv.find((a) => a.startsWith('--pet-at='));
    if (petAt) {
      const [px, py] = petAt.slice('--pet-at='.length).split(',').map(Number);
      if (Number.isFinite(px) && Number.isFinite(py)) runtime.settings.patch({ petPosition: { x: px, y: py } });
    }
    runtime._devCoupleDemo = argv.includes('--dev-couple-demo');
    const devPresence = argv.find((a) => a.startsWith('--dev-presence='));
    if (devPresence) runtime._devPresence = devPresence.slice('--dev-presence='.length);
    if (argv.includes('--dev-cinema')) runtime.settings.patch({ cinemaManual: true });
    const devAiChat = argv.find((a) => a.startsWith('--dev-ai-chat='));
    if (devAiChat) {
      setTimeout(async () => {
        try {
          const text = decodeURIComponent(devAiChat.slice('--dev-ai-chat='.length));
          const res = await runtime.ai.chat(text);
          console.log('[dev-ai]', JSON.stringify({ ok: res.ok, source: res.source, reply: res.reply, warning: res.warning }));
          if (res.ok && res.reply) runtime.sendPetEvent('say', { text: res.reply });
          runtime.commit();
        } catch (err) {
          console.log('[dev-ai-error]', err && err.message);
        }
      }, 4000);
    }
    if (argv.includes('--dev-dark')) require('electron').nativeTheme.themeSource = 'dark';
    if (argv.includes('--dev-light')) require('electron').nativeTheme.themeSource = 'light';
    const devApi = argv.find((a) => a.startsWith('--dev-api='));
    if (devApi) runtime.settings.patch({ apiBase: devApi.slice('--dev-api='.length) });
    const devSkin = argv.find((a) => a.startsWith('--dev-skin='));
    const devMulti = argv.find((a) => a.startsWith('--dev-multi='));
    const applyDevLook = () => {
      if (devSkin) runtime.applySettings({ skinId: devSkin.slice('--dev-skin='.length) });
      if (devMulti) runtime.applySettings({ multiPetCount: Number(devMulti.slice('--dev-multi='.length)) || 1 });
    };
    if (!argv.some((a) => a.startsWith('--dev-activate='))) applyDevLook();
    runtime.start();
    const openArg = argv.find((a) => a.startsWith('--open='));
    if (openArg) {
      const name = openArg.split('=')[1];
      setTimeout(() => runtime.openPanel(name), 700);
    }
    // QA 钩子：自动激活 / 导出状态快照（自动化验证用，生产不会触发）
    const devActivate = argv.find((a) => a.startsWith('--dev-activate='));
    if (devActivate) {
      setTimeout(async () => {
        try {
          const res = await runtime.license.activate({ key: devActivate.slice('--dev-activate='.length) });
          console.log('[dev-activate]', JSON.stringify(res));
          runtime.commit();
          applyDevLook();
        } catch (err) {
          console.log('[dev-activate-error]', err && err.message);
        }
      }, 2500);
    }
    const devDump = argv.find((a) => a.startsWith('--dev-dump='));
    const devDumpDelayArg = argv.find((a) => a.startsWith('--dev-dump-delay='));
    const devDumpDelay = devDumpDelayArg ? Math.max(500, Number(devDumpDelayArg.split('=')[1]) || 6000) : 6000;
    if (devDump) {
      setTimeout(() => {
        try {
          require('node:fs').writeFileSync(devDump.slice('--dev-dump='.length), JSON.stringify(runtime.stateSnapshot(), null, 2));
          console.log('[dev-dump] done');
        } catch (err) {
          console.log('[dev-dump-error]', err && err.message);
        }
      }, devDumpDelay);
    }
    // 演示视频离屏录制：按帧抓取窗口内容（不依赖桌面是否可见/是否锁屏）
    const seqArg = argv.find((a) => a.startsWith('--capture-seq='));
    if (seqArg) {
      const dir = seqArg.slice('--capture-seq='.length) || 'frames';
      const framesArg = argv.find((a) => a.startsWith('--seq-frames='));
      const intervalArg = argv.find((a) => a.startsWith('--seq-interval='));
      const clickArg = argv.find((a) => a.startsWith('--seq-click='));
      const targetArg = argv.find((a) => a.startsWith('--seq-window='));
      setTimeout(() => captureSequence({
        dir,
        frames: framesArg ? Number(framesArg.split('=')[1]) : 60,
        interval: intervalArg ? Number(intervalArg.split('=')[1]) : 80,
        clickAt: clickArg ? Number(clickArg.split('=')[1]) : -1,
        target: targetArg ? targetArg.split('=')[1] : 'pet',
      }), 6000);
    }

    const captureArg = argv.find((a) => a.startsWith('--capture='));
    const captureDelayArg = argv.find((a) => a.startsWith('--capture-delay='));
    const captureDelay = captureDelayArg ? Math.max(500, Number(captureDelayArg.split('=')[1]) || 3500) : 3500;
    if (captureArg) {
      const dir = captureArg.slice('--capture='.length) || '.';
      setTimeout(() => captureRuntime(dir), captureDelay);
    }
    app.on('activate', () => {
      if (runtime) runtime.windows.showPet();
    });
  });

  app.on('window-all-closed', () => {
    if (runtime && runtime._quitting) app.quit();
  });

  app.on('before-quit', () => {
    if (runtime) runtime._quitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
