/**
 * 用户设置（settings.json）。所有可变外观 / 行为参数都在这里。
 *
 * 两条硬性安全约束（都在本文件落地，避免散落到各处被绕过）：
 *  1. **开发者模式开关已彻底移除**。旧版本把开关写进 settings.json，任何人改一个 JSON
 *     就能白嫖全部付费内容。加载时强制清除该字段（见 dev-unlock.js）。
 *  2. **AI Key 只以密文落盘**。明文字段 aiApiKey 仅在迁移时读一次，随即被加密并删除；
 *     磁盘上只保留 aiApiKeyEnc（safeStorage 加密，带 v1: 版本标记）。
 */
const path = require('node:path');
const { JsonFile } = require('./json-file');
const { stripLegacyDeveloperMode } = require('./dev-unlock');
const { SecretStore } = require('./secret-store');

/**
 * 延迟加载 electron：只有在真正需要默认路径 / 系统密钥库时才 require，
 * 这样本模块可以在纯 node 环境（node --test）下被直接测试。
 */
function electronApi() {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('electron');
  } catch (err) {
    return {};
  }
}

const SETTINGS_DEFAULTS = {
  schemaVersion: 1,
  skinId: 'blaze',
  sizeScale: 1,
  alwaysOnTop: true,
  autoStart: false,
  soundEnabled: false,
  followSystemTheme: true,
  nightMode: { enabled: false, start: '22:00', end: '07:00' },
  bubbleOnLaunch: true,
  customColors: null,
  diyPet: { enabled: false, animalId: 'custom', paletteId: 'peach', hat: 'auto', ears: 'auto', tail: 'auto', heldId: 'auto', temperament: 'soft' },
  petPosition: null,
  language: 'zh-CN',
  apiBase: '',
  multiPetCount: 1,
  onboardingDone: false,
  betaCohort: '',
  betaCohortAt: 0,
  betaCohortSource: '',
  lastSeenVersion: null,
  hotkeys: { toggle: 'Control+Shift+H', focus: 'Control+Shift+F' },
  reduceMotion: false,
  focus: { lastMinutes: 25, lastLabel: '' },
  showFps: false,
  // 说话 / 状态感知 / 观影模式 / 情侣
  voiceEnabled: true,
  voiceVolume: 0.7,
  voiceRate: 1.05,
  voicePitch: 0,
  farmAutoWork: true,
  petName: '方块仔',
  petCatchphrase: '',
  farmEnabled: false,
  voiceName: '',
  voiceAllBubbles: true,
  voiceInputEnabled: true,
  tasks: [],
  presenceReactions: true,
  cinemaAuto: true,
  cinemaManual: false,
  coupleNotify: true,
  aiEnabled: true,
  aiProvider: 'cubbit',
  aiBaseUrl: 'http://127.0.0.1:11434',
  aiModel: 'qwen2.5:3b',
  // AI Key 只以密文形式落盘；明文字段 aiApiKey 不在默认值里（见 secret-store.js 的迁移逻辑）
  aiApiKeyEnc: '',
  aiPersonality: 'warm',
  petPersonality: '',
  memoryEnabled: true,
  proactiveCare: true,
  weatherEnabled: true,
  weatherCity: '',
  couplePokeSync: true,
  petEdgeSnap: true,
  petEdgeHide: false,
  petRoamEnabled: true,
  couplePlus: null,
  intimacy: null,
  aiRemember: true,
  aiMaxTurns: 12,
  // 语音：默认用服务端神经语音（更接近真人），失败自动回退系统 SAPI
  ttsEngine: 'neural',
  ttsVoice: 'zh-CN-XiaoxiaoNeural',
  autoUpdateCheck: true,
  updateFeedUrl: '',
  crashReportEnabled: false,
  backupAutoSync: false,
  backupLastExportAt: 0,
  backupLastSyncAt: 0,
  backupSyncPasswordEnc: '',
  gameAutoHide: true,
  gameWhitelist: [],
  coupleProfile: { petName: '', loveNote: '' },
};

class SettingsStore extends JsonFile {
  /**
   * @param {object} [opts]
   * @param {string} [opts.filePath]    覆盖 settings.json 路径（测试用）
   * @param {object} [opts.safeStorage] 覆盖 safeStorage 实现（测试用）
   */
  constructor(opts = {}) {
    const electron = opts.filePath && opts.safeStorage !== undefined ? {} : electronApi();
    const filePath =
      opts.filePath || path.join(electron.app.getPath('userData'), 'settings.json');
    super(filePath, SETTINGS_DEFAULTS);
    this.safeStorage = opts.safeStorage !== undefined ? opts.safeStorage : electron.safeStorage;
    this._secrets = new SecretStore(this, this.safeStorage);
    this._apiKey = '';
    this._apiKeyEncrypted = false;
    this.load();
  }

  /**
   * 读取设置并立即处理历史遗留数据：
   *  - 强制清除 developerMode（正式包不再接受该字段）；
   *  - 把旧的明文 aiApiKey 重新加密为 aiApiKeyEnc，并删除明文字段。
   */
  load() {
    const data = super.load();
    stripLegacyDeveloperMode(this);
    const res = this._secrets.read('aiApiKey', 'aiApiKeyEnc');
    this._apiKey = res.value || '';
    this._apiKeyEncrypted = res.encrypted;
    return data;
  }

  /**
   * 设置全量对象（供主进程内部读取）。
   * 注意：广播给渲染进程前必须经 publicSettings() 过滤掉机密字段。
   */
  get settings() {
    return this.data;
  }

  /** 明文 API Key（仅存在于主进程内存，不广播、不落盘） */
  getApiKey() {
    return this._apiKey || '';
  }

  /** API Key 是否已加密落盘（false 表示系统不支持安全存储，仅内存保留） */
  isApiKeyEncrypted() {
    return !!this._apiKeyEncrypted;
  }

  /**
   * 保存 API Key：加密后落盘，明文不写入 settings.json。
   * @returns {{persisted:boolean, encrypted:boolean}}
   */
  setApiKey(value) {
    const text = String(value == null ? '' : value).trim().slice(0, 400);
    this._apiKey = text;
    const res = this._secrets.write('aiApiKey', 'aiApiKeyEnc', text);
    this._apiKeyEncrypted = res.encrypted;
    return res;
  }

  /**
   * 通用机密读写（云同步密码等复用同一套加密与降级策略）。
   * @param {string} plainKey 明文字段名
   * @param {string} encKey   密文字段名
   * @returns {{value:string, encrypted:boolean}}
   */
  readSecret(plainKey, encKey) {
    return this._secrets.read(plainKey, encKey);
  }

  /**
   * @returns {{persisted:boolean, encrypted:boolean}} persisted=false 表示仅内存保留
   */
  writeSecret(plainKey, encKey, value) {
    return this._secrets.write(plainKey, encKey, value);
  }
}

module.exports = { SettingsStore, SETTINGS_DEFAULTS };
