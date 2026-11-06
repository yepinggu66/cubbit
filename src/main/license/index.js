/**
 * 方块仔 — 许可管理器（真实实现，替换原 stub）
 *
 * 职责：
 *  - 试用期：本地 AES-256-GCM 加密记录 + 在线 /api/trial/register 校准（幂等，防清数据重刷）
 *  - 激活：/api/license/activate 换 Ed25519 签名 token，本地离线验签后缓存
 *  - 校验：启动后台静默续签；离线宽限 30 天；时钟回拨超过 24h 标记并要求联网
 *  - 恢复 / 解绑
 *
 * 设计约束：
 *  - 不 require('electron')：目录可注入（options.userDataDir / env CUBBIT_USERDATA），
 *    默认 ~/.cubbit，保证 node --test 可直接测。
 *  - getStatus() 字段是 UI 契约（state/planId/planName/expiresAt/trialEndsAt/trialDaysLeft/
 *    features/deviceId/name/email/offline/apiBase/lastVerifiedAt），不要删字段。
 *  - 所有面向用户的 message 均为中文。
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { JsonFile } = require('../json-file');
const { PRODUCT, PLANS, FEATURES } = require('../../shared/catalog');
const { ApiClient, normalizeBase } = require('./api-client');
const { computeDeviceId } = require('./device-id');
const { TrialStore } = require('./trial-store');
const tokenUtil = require('./token');

const DAY = 86400;
const OFFLINE_GRACE_DAYS = 30;
const CLOCK_ROLLBACK_TOLERANCE = DAY; // 回拨超过 24h 视为异常
const PERIODIC_SYNC_MS = 6 * 3600 * 1000; // 后台每 6 小时静默续签
const KEY_RE = /^CUBB-?[0-9A-Z]{16}$/;

const FILE_DEFAULTS = {
  deviceId: '',
  token: '',
  lastVerifiedAt: 0,
  planId: '',
  name: '',
  email: '',
  activatedAt: 0,
  maxSeenAt: 0, // 本地见过的最大时间（unix 秒，服务端时间对齐后）
  clockOffsetSec: 0, // 服务端时间 - 本地时间
  trialFirstSeenAt: 0, // 明文备份（防止加密文件被删导致离线重置试用）
  trialEndsAt: 0,
  trialTampered: false,
  publicKeyFingerprint: '',
};

/** 宽松规范化用户输入的密钥：大写、去分隔符 */
function normalizeKey(input) {
  return String(input == null ? '' : input)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function formatKey(normalized) {
  const s = normalizeKey(normalized);
  if (s.length !== 20 || !s.startsWith('CUBB')) return s;
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20)].join('-');
}

function planNameOf(planId) {
  const plan = PLANS.find((p) => p.id === planId);
  return plan ? plan.name : planId || '';
}

class LicenseManager extends EventEmitter {
  /**
   * @param {{userDataDir?:string, deviceId?:string, apiBase?:string, publicKeyPath?:string,
   *          publicKeyPem?:string, timeoutMs?:number, fetchImpl?:Function, now?:Function,
   *          appVersion?:string, platform?:string, offlineGraceDays?:number,
   *          respectServerTime?:boolean, syncIntervalMs?:number}} [options]
   */
  constructor(options = {}) {
    super();
    this.options = options || {};
    this.now = typeof this.options.now === 'function' ? this.options.now : () => Date.now();
    this.appVersion = this.options.appVersion || process.env.CUBBIT_VERSION || '';
    this.platform = this.options.platform || process.platform;
    this.offlineGraceDays = Number.isFinite(this.options.offlineGraceDays)
      ? this.options.offlineGraceDays
      : OFFLINE_GRACE_DAYS;
    this.respectServerTime = this.options.respectServerTime !== false;

    // 数据目录（不依赖 electron）：必须可写；不可写时降级到临时目录，构造函数绝不 throw
    this.userDataDirRequested = path.resolve(
      this.options.userDataDir || process.env.CUBBIT_USERDATA || path.join(os.homedir(), '.cubbit')
    );
    this.userDataDirFallback = false;
    this.userDataDir = this._resolveWritableDataDir(this.userDataDirRequested);
    this.ioError = this.userDataDir === this.userDataDirRequested ? '' : `数据目录不可写，已降级到 ${this.userDataDir}`;

    // 服务端地址
    this.apiBase = normalizeBase(this.options.apiBase || PRODUCT.apiBase);
    this.api = new ApiClient({
      baseUrl: this.apiBase,
      timeoutMs: Number.isFinite(this.options.timeoutMs) ? this.options.timeoutMs : 6000,
      fetchImpl: this.options.fetchImpl,
    });

    // 本地状态（JsonFile 自身对写失败是宽容的；这里再兜一层，避免构造失败）
    this.file = new JsonFile(path.join(this.userDataDir, 'license.json'), FILE_DEFAULTS);
    try {
      this.file.load();
    } catch (err) {
      // 极端情况（只读盘/权限不足）：退化为内存态，不阻塞桌宠启动
      this.ioError = this.ioError || `许可缓存不可读写：${(err && err.message) || err}`;
      this.file.data = { ...FILE_DEFAULTS };
    }

    // 公钥（可注入 PEM / 路径，默认内置 public-key.pem）
    this.publicKey = null;
    this.publicKeyPem = '';
    this.publicKeyFingerprint = '';
    this.publicKeyError = '';
    try {
      this.publicKeyPem =
        this.options.publicKeyPem ||
        fs.readFileSync(this.options.publicKeyPath || path.join(__dirname, 'public-key.pem'), 'utf8');
      this.publicKey = tokenUtil.importPublicKey(this.publicKeyPem);
      this.publicKeyFingerprint = tokenUtil.fingerprint(this.publicKey);
      if (this.file.get('publicKeyFingerprint') !== this.publicKeyFingerprint) {
        this.file.patch({ publicKeyFingerprint: this.publicKeyFingerprint });
      }
    } catch (err) {
      this.publicKey = null;
      this.publicKeyError = (err && err.message) || '公钥读取失败';
    }

    // 设备指纹 + 加密试用存储
    this._deviceId = this._resolveDeviceId();
    this.trialStore = new TrialStore(path.join(this.userDataDir, 'license-trial.bin'), this._deviceId);
    this._trialRecord = null;
    this._trialLoaded = false;

    this._offline = false;
    this._status = null;
    this._statusSignature = '';
    this._timer = null;
    this._syncing = null;

    this._status = this._computeStatusSafe();
    this._statusSignature = this._signature(this._status);
  }

  // ---------------------------------------------------------------- 公共接口

  /** 主进程启动时调用：本地快速出状态，随后后台联网校准（不阻塞） */
  async init() {
    this._ensureTrialRecord();
    this._refresh();
    // 后台静默校准，不阻塞启动；主进程 commit 会被 changed 事件再次触发
    this._bgSync = this.sync();
    void this._bgSync.catch(() => {});
    this._startPeriodicSync();
    return this.getStatus();
  }

  /** 等待 init 触发的后台联网校准结束（测试/设置页可用） */
  whenSynced() {
    return this._bgSync || Promise.resolve(null);
  }

  getStatus() {
    return this._status;
  }

  isPro() {
    return this._status.state === 'pro';
  }

  hasFeature(featureId) {
    return Boolean(this._status.features && this._status.features[featureId]);
  }

  /** 是否拥有某个 DLC 角色包（addons 由服务端 token 授予） */
  hasAddon(dlcId) {
    const addons = (this._status && this._status.addons) || [];
    return addons.includes(dlcId);
  }

  /** AI 每日轮数配额：免费 10 / 完整版 50 / AI 订阅无限 */
  aiQuota() {
    const st = this._status || {};
    if (st.aiUnlimited) return { unlimited: true, perDay: Infinity };
    if (st.baseOwned || st.state === 'trial') return { unlimited: false, perDay: 50 };
    return { unlimited: false, perDay: 10 };
  }

  /** 当前设备授权 token（云同步/备份鉴权用；空字符串表示未激活） */
  getToken() {
    return String(this.file.get('token') || '');
  }

  getDeviceId() {
    return this._deviceId;
  }

  /** 兼容旧 stub 的写法 */
  deviceId() {
    return this._deviceId;
  }

  /** 设置/切换许可服务端地址（设置项里可改，便于自托管） */
  setApiBase(apiBase) {
    this.apiBase = normalizeBase(apiBase || PRODUCT.apiBase);
    this.api.setBaseUrl(this.apiBase);
    if (this._status) {
      this._status = { ...this._status, apiBase: this.apiBase };
      this._statusSignature = this._signature(this._status);
    }
    return this.apiBase;
  }

  /** 重新计算状态并（必要时）派发 changed */
  refresh() {
    return this._refresh();
  }

  /** 显式联网同步：有 token 就续签，没有就校准试用。测试/设置页可 await */
  async sync() {
    let result;
    try {
      const token = this.file.get('token');
      if (token) result = await this._verifyOnline();
      else result = await this._syncTrialOnline();
    } catch (err) {
      result = { ok: false, code: 'INTERNAL', message: (err && err.message) || '同步失败' };
    }
    this._refresh();
    return result;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async startTrial() {
    this._ensureTrialRecord();
    let record = this._readTrialRecord();
    const nowSec = this._effectiveNowSec();

    if (this.isPro()) {
      return { ok: true, alreadyPro: true, license: this.getStatus() };
    }

    // 本地试用仍有效：顺手在线校准一次（失败不影响本地判断）
    if (record && record.trialEndsAt > nowSec) {
      void this.sync();
      return { ok: true, license: this.getStatus() };
    }

    // 本地试用已结束或缺失：联网看服务端是否还认这台设备
    const synced = await this._syncTrialOnline();
    this._refresh();
    record = this._readTrialRecord();
    if (this.isPro()) return { ok: true, license: this.getStatus() };
    if (record && record.trialEndsAt > this._effectiveNowSec()) {
      return { ok: true, license: this.getStatus() };
    }
    return {
      ok: false,
      offline: Boolean(synced && synced.offline),
      code: 'TRIAL_EXPIRED',
      message: '体验期已结束，购买 Pro 后即可继续使用全部功能',
      license: this.getStatus(),
    };
  }

  /**
   * 用许可证密钥激活。
   * @param {{key?:string, name?:string, email?:string}} [payload]
   */
  async activate(payload = {}) {
    const rawKey = String((payload && payload.key) || '').trim();
    if (!rawKey) {
      return { ok: false, code: 'BAD_REQUEST', message: '请输入许可证密钥' };
    }
    const normalized = normalizeKey(rawKey);
    if (!/^CUBB[0-9A-Z]{16}$/.test(normalized)) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: '许可证密钥格式不正确，应为 CUBB-XXXX-XXXX-XXXX-XXXX',
      };
    }
    if (!this.publicKey) {
      return {
        ok: false,
        code: 'CLIENT_KEY_MISSING',
        message: `客户端授权公钥缺失（${this.publicKeyError}），请重新安装应用或联系客服`,
      };
    }

    const res = await this.api.post('/api/license/activate', {
      key: formatKey(normalized),
      deviceId: this._deviceId,
      appVersion: this.appVersion,
    });

    if (!res.ok) {
      this._offline = Boolean(res.offline);
      this._refresh();
      return {
        ok: false,
        code: res.code || 'NETWORK_ERROR',
        message: res.offline
          ? '无法连接许可服务器，请检查网络后重试（激活需要联网，之后可离线使用）'
          : res.message || '激活失败，请稍后重试',
        offline: Boolean(res.offline),
      };
    }

    this._applyServerTime(res.serverTime);
    const checked = this._verifyToken(res.token, { expectDevice: true });
    if (!checked.ok) {
      this._refresh();
      return {
        ok: false,
        code: checked.code,
        message: `服务器返回的授权凭据无法通过本地校验：${checked.message}`,
      };
    }

    const nowSec = this._effectiveNowSec();
    this.file.patch({
      token: res.token,
      lastVerifiedAt: nowSec,
      planId: checked.payload.plan,
      activatedAt: this.file.get('activatedAt') || nowSec,
      name: String(payload.name || checked.payload.name || this.file.get('name') || ''),
      email: String(payload.email || checked.payload.email || this.file.get('email') || ''),
      maxSeenAt: Math.max(this.file.get('maxSeenAt') || 0, nowSec),
    });
    this._offline = false;
    this._refresh();
    this._startPeriodicSync();
    return { ok: true, license: this.getStatus() };
  }

  /** 恢复购买：优先联网续签缓存 token；离线时用未超宽限的本地凭据 */
  async restore() {
    const token = this.file.get('token');
    if (!token) {
      // 可能重装后本地无缓存：让服务端按 deviceId 找授权（试用登记接口会返回 alreadyLicensed + token）
      const synced = await this._syncTrialOnline();
      this._refresh();
      if (this.isPro()) return { ok: true, license: this.getStatus() };
      if (synced && synced.offline) {
        return {
          ok: false,
          offline: true,
          code: 'SERVER_OFFLINE',
          message: '无法连接许可服务器，恢复购买需要联网',
        };
      }
      return {
        ok: false,
        code: 'NO_LICENSE',
        message: '本机没有找到可恢复的授权，请输入购买时收到的许可证密钥',
      };
    }

    const res = await this.api.post('/api/license/verify', {
      token,
      deviceId: this._deviceId,
      appVersion: this.appVersion,
    });

    if (res.ok) {
      this._applyServerTime(res.serverTime);
      const checked = this._verifyToken(res.token, { expectDevice: true });
      if (checked.ok) {
        const nowSec = this._effectiveNowSec();
        this.file.patch({
          token: res.token,
          lastVerifiedAt: nowSec,
          planId: checked.payload.plan,
          maxSeenAt: Math.max(this.file.get('maxSeenAt') || 0, nowSec),
        });
        this._offline = false;
        this._refresh();
        return { ok: true, license: this.getStatus() };
      }
    }

    this._offline = Boolean(res.offline);
    if (!res.offline) {
      this._handleRejected(res.code, res);
    }
    this.refresh();

    const state = this.getStatus();
    if (state.state === 'pro') {
      return { ok: true, license: state, offline: true };
    }
    if (res.offline) {
      return {
        ok: false,
        offline: true,
        code: 'SERVER_OFFLINE',
        message: '无法连接许可服务器，且本地离线宽限已用尽，请联网后重试',
      };
    }
    return {
      ok: false,
      code: res.code || 'TOKEN_INVALID',
      message: res.message || '授权已失效，请输入许可证密钥重新激活',
    };
  }

  /** 解绑当前设备（迁移到新设备前调用，需要联网） */
  async deactivate() {
    const token = this.file.get('token');
    if (!token) {
      return { ok: false, code: 'NO_LICENSE', message: '当前设备没有已激活的授权' };
    }
    const res = await this.api.post('/api/license/deactivate', {
      token,
      deviceId: this._deviceId,
    });
    if (!res.ok) {
      this._offline = Boolean(res.offline);
      this._refresh();
      return {
        ok: false,
        offline: Boolean(res.offline),
        code: res.code || 'NETWORK_ERROR',
        message: res.offline
          ? '解绑需要联网，请连接网络后重试（也可以先在原设备联网解绑再在新设备激活）'
          : res.message || '解绑失败，请稍后重试',
      };
    }
    this.file.patch({ token: '', planId: '', lastVerifiedAt: 0, activatedAt: 0 });
    this._offline = false;
    this._refresh();
    return { ok: true, license: this.getStatus() };
  }

  // ---------------------------------------------------------------- 内部：目录 / 安全降级

  /**
   * 找一个真正可写的目录。首选请求目录（app userData / env），失败则降级到临时目录。
   * 受限环境（如某些 Windows 用户目录 ACL 拒绝）下也不会抛异常。
   * @param {string} preferred 首选绝对路径
   * @returns {string} 实际可用目录
   */
  _resolveWritableDataDir(preferred) {
    const userTag = (() => {
      try {
        return String((os.userInfo() && os.userInfo().username) || 'user').replace(/[^\w.-]/g, '_');
      } catch {
        return 'user';
      }
    })();
    const candidates = [preferred, path.join(os.tmpdir(), `cubbit-${userTag}`), path.join(os.tmpdir(), 'cubbit')];
    for (const dir of candidates) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        if (dir !== preferred) this.userDataDirFallback = true;
        return dir;
      } catch {
        /* 尝试下一个候选目录 */
      }
    }
    // 理论上不会到这里（os.tmpdir() 一定存在且可写）
    this.userDataDirFallback = true;
    return os.tmpdir();
  }

  /** 计算状态但绝不抛异常；异常时返回安全的「未授权」内存态 */
  _computeStatusSafe() {
    try {
      return this._computeStatus();
    } catch (err) {
      this.ioError = this.ioError || `许可状态计算失败：${(err && err.message) || err}`;
      return this._fallbackStatus();
    }
  }

  /** 兜底状态：满足 UI 契约字段，全部视为未授权，不让主进程崩 */
  _fallbackStatus() {
    const features = this._emptyFeatures();
    return {
      state: 'unlicensed',
      planId: '',
      planName: '未授权',
      expiresAt: 0,
      trialEndsAt: 0,
      trialDaysLeft: 0,
      features,
      deviceId: this._deviceId || '',
      name: '',
      email: '',
      offline: true,
      apiBase: this.apiBase,
      lastVerifiedAt: 0,
      message: '许可数据不可读写，已进入安全模式',
      clockRollback: false,
      trialStartedAt: 0,
      tampered: false,
      revoked: false,
      publicKeyFingerprint: this.publicKeyFingerprint || '',
      serverTimeOffset: 0,
      ioError: this.ioError || '',
    };
  }

  // ---------------------------------------------------------------- 内部：设备 / 试用

  _resolveDeviceId() {
    const override = this.options.deviceId || process.env.CUBBIT_DEVICE_ID || '';
    if (override) {
      const id = String(override).slice(0, 64);
      if (this.file.get('deviceId') !== id) this.file.patch({ deviceId: id });
      return id;
    }
    const cached = this.file.get('deviceId');
    if (cached && String(cached).length >= 8) return String(cached);
    const computed = computeDeviceId();
    this.file.patch({ deviceId: computed });
    return computed;
  }

  _ensureTrialRecord() {
    const record = this._readTrialRecord();
    if (record && record.trialEndsAt > 0) return record;
    // 文件被篡改且没有可用备份：不重置试用，等待联网用服务端记录校准
    if (this.file.get('trialTampered')) return record;
    // 加密文件被删除但明文备份还在：按备份恢复，避免「删文件＝重刷 7 天」
    const plainEnds = Number(this.file.get('trialEndsAt')) || 0;
    const plainFirst = Number(this.file.get('trialFirstSeenAt')) || 0;
    if (plainEnds > 0 || plainFirst > 0) {
      const nowSec = this._effectiveNowSec();
      const restored = {
        v: 1,
        firstSeenAt: plainFirst || nowSec,
        trialEndsAt: plainEnds || nowSec,
        maxSeenAt: Math.max(Number(this.file.get('maxSeenAt')) || 0, nowSec),
        onlineSyncedAt: 0,
        tampered: false,
      };
      this._writeTrialRecord(restored);
      return restored;
    }
    const nowSec = this._effectiveNowSec();
    const next = {
      v: 1,
      firstSeenAt: nowSec,
      trialEndsAt: nowSec + (Number(PRODUCT.trialDays) || 7) * DAY,
      maxSeenAt: nowSec,
      onlineSyncedAt: 0,
      tampered: false,
    };
    this._writeTrialRecord(next);
    return next;
  }

  _readTrialRecord() {
    if (this._trialLoaded) return this._trialRecord;
    this._trialLoaded = true;
    const result = this.trialStore.read();
    if (result.ok) {
      this._trialRecord = result.record;
      return this._trialRecord;
    }
    if (result.missing) {
      this._trialRecord = null;
      return null;
    }
    // 文件存在但解不开：标记损坏。明文备份仍可用于判断剩余试用，避免用户被误伤
    const plainEnds = Number(this.file.get('trialEndsAt')) || 0;
    const plainFirst = Number(this.file.get('trialFirstSeenAt')) || 0;
    const record = {
      v: 1,
      tampered: true,
      firstSeenAt: plainFirst,
      trialEndsAt: plainEnds,
      maxSeenAt: this.file.get('maxSeenAt') || 0,
      onlineSyncedAt: 0,
    };
    this._trialRecord = record;
    this.file.patch({ trialTampered: true });
    // 重新写一份可解密的记录（内容沿用备份），保证下次不再重复报损坏
    try {
      this.trialStore.write({ ...record, tampered: false });
      this._trialRecord = { ...record, tampered: false };
    } catch {
      /* 磁盘异常时保持内存态 */
    }
    return this._trialRecord;
  }

  _writeTrialRecord(record) {
    this._trialRecord = { ...record };
    this._trialLoaded = true;
    try {
      this.trialStore.write(record);
    } catch (err) {
      console.error('[license] 试用记录写入失败：', err && err.message);
    }
    this.file.patch({
      trialFirstSeenAt: record.firstSeenAt || 0,
      trialEndsAt: record.trialEndsAt || 0,
    });
    return this._trialRecord;
  }

  /** 把服务端时间写回本地并校准时钟偏移 */
  _applyServerTime(serverTime) {
    if (!this.respectServerTime) return;
    const server = Number(serverTime);
    if (!Number.isFinite(server) || server <= 0) return;
    const localNow = Math.floor(this.now() / 1000);
    const offset = server - localNow;
    this.file.patch({
      clockOffsetSec: offset,
      // 联网确认过时间：以此为准（可清除「时钟回拨」标记）
      maxSeenAt: server,
    });
  }

  _effectiveNowSec() {
    const localNow = Math.floor(this.now() / 1000);
    const offset = Number(this.file.get('clockOffsetSec')) || 0;
    return localNow + offset;
  }

  // ---------------------------------------------------------------- 内部：网络

  async _syncTrialOnline() {
    if (this._syncing) return this._syncing;
    this._syncing = (async () => {
      const res = await this.api.post('/api/trial/register', {
        deviceId: this._deviceId,
        appVersion: this.appVersion,
        platform: this.platform,
      });
      if (!res.ok) {
        this._offline = Boolean(res.offline);
        return { ok: false, offline: Boolean(res.offline), code: res.code, message: res.message };
      }
      this._offline = false;
      this._applyServerTime(res.serverTime);
      const nowSec = this._effectiveNowSec();

      if (res.alreadyLicensed) {
        this.file.patch({ trialTampered: false });
        if (res.token) {
          const checked = this._verifyToken(res.token, { expectDevice: true });
          if (checked.ok) {
            this.file.patch({
              token: res.token,
              lastVerifiedAt: nowSec,
              planId: checked.payload.plan,
              maxSeenAt: Math.max(this.file.get('maxSeenAt') || 0, nowSec),
            });
          }
        }
        return { ok: true, alreadyLicensed: true };
      }

      const current = this._readTrialRecord() || {};
      const next = {
        ...current,
        v: 1,
        tampered: false,
        firstSeenAt: Number(res.firstSeenAt) || current.firstSeenAt || nowSec,
        trialEndsAt: Number(res.trialEndsAt) || current.trialEndsAt || nowSec,
        maxSeenAt: Math.max(current.maxSeenAt || 0, nowSec),
        onlineSyncedAt: nowSec,
      };
      this._writeTrialRecord(next);
      this.file.patch({ trialTampered: false });
      return { ok: true, trialEndsAt: next.trialEndsAt, firstSeenAt: next.firstSeenAt };
    })();
    try {
      return await this._syncing;
    } finally {
      this._syncing = null;
    }
  }

  async _verifyOnline() {
    const token = this.file.get('token');
    if (!token) return { ok: false, code: 'NO_TOKEN' };
    const res = await this.api.post('/api/license/verify', {
      token,
      deviceId: this._deviceId,
      appVersion: this.appVersion,
    });

    if (res.ok) {
      this._applyServerTime(res.serverTime);
      const checked = this._verifyToken(res.token, { expectDevice: true });
      if (checked.ok) {
        const nowSec = this._effectiveNowSec();
        this.file.patch({
          token: res.token,
          lastVerifiedAt: nowSec,
          planId: checked.payload.plan,
          maxSeenAt: Math.max(this.file.get('maxSeenAt') || 0, nowSec),
        });
        this._offline = false;
        return { ok: true };
      }
      return { ok: false, code: checked.code, message: checked.message };
    }

    this._offline = Boolean(res.offline);
    if (!res.offline) this._handleRejected(res.code, res);
    return {
      ok: false,
      offline: Boolean(res.offline),
      code: res.code || 'NETWORK_ERROR',
      message: res.message,
    };
  }

  /** 服务端明确拒绝：吊销则清 token；过期/无效保留 token 用于展示「已过期」 */
  _handleRejected(code, res) {
    if (code === 'KEY_REVOKED' || code === 'INVALID_KEY') {
      this.file.patch({ token: '', planId: '' });
      this._revokedMessage = (res && res.message) || '授权已被吊销，请联系客服';
    }
  }

  _startPeriodicSync() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      void this.sync();
    }, Number.isFinite(this.options.syncIntervalMs) ? this.options.syncIntervalMs : PERIODIC_SYNC_MS);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  // ---------------------------------------------------------------- 内部：状态

  _verifyToken(token, options = {}) {
    if (!this.publicKey) {
      return { ok: false, code: 'CLIENT_KEY_MISSING', message: this.publicKeyError || '客户端公钥缺失' };
    }
    const nowSec = Number.isFinite(options.nowSec) ? options.nowSec : this._effectiveNowSec();
    const result = tokenUtil.verifyToken(token, this.publicKey, { now: nowSec });
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message, payload: result.payload };
    }
    const payload = result.payload;
    const boundDevice = payload.sub || payload.deviceId || '';
    if (options.expectDevice && boundDevice && boundDevice !== this._deviceId) {
      return {
        ok: false,
        code: 'DEVICE_MISMATCH',
        message: '该授权绑定的是另一台设备',
        payload,
      };
    }
    return { ok: true, payload };
  }

  /**
   * 功能开关：Pro 功能看 token.features；免费功能（FEATURES[x].pro === false）恒为 true。
   * 这样 UI 可直接用 features 判断「当前能不能用」，免费功能不会因为未授权被误锁。
   */
  _featureFlags(payload) {
    const enabled = new Set();
    const feat = payload && payload.features;
    if (Array.isArray(feat)) {
      for (const id of feat) if (typeof id === 'string') enabled.add(id);
    } else if (feat && typeof feat === 'object') {
      for (const [id, on] of Object.entries(feat)) if (on === true) enabled.add(id);
    } else {
      for (const id of Object.keys(FEATURES)) enabled.add(id);
    }
    const out = {};
    for (const id of Object.keys(FEATURES)) out[id] = FEATURES[id].pro === false || enabled.has(id);
    out.ai_unlimited = enabled.has('ai_unlimited');
    // 服务端 token 只携带 14 个权益键（不含 focus_stats），客户端按 baseOwned 补齐历史权益
    if (payload && payload.baseOwned) out.focus_stats = true;
    return out;
  }

  /** 完整版（base）包含的功能集合；试用期与买断都按此授予 */
  _baseFeatures() {
    const BASE = [
      'skins_premium',
      'growth',
      'focus_custom',
      'focus_stats',
      'multi_pet',
      'custom_colors',
      'reminders',
      'no_watermark',
      'couple_mode',
      'life_system',
      'ai_chat',
      'office_pro',
    ];
    const out = {};
    for (const id of Object.keys(FEATURES)) out[id] = FEATURES[id].pro === false || BASE.includes(id);
    out.ai_unlimited = false;
    return out;
  }

  _emptyFeatures() {
    const out = {};
    for (const id of Object.keys(FEATURES)) out[id] = FEATURES[id].pro === false;
    return out;
  }

  _signature(status) {
    return JSON.stringify([
      status.state,
      status.planId,
      status.planName,
      status.expiresAt,
      status.trialEndsAt,
      status.trialDaysLeft,
      status.features,
      status.baseOwned,
      status.addons,
      status.seats,
      status.planExpiry,
      status.aiUnlimited,
      status.offline,
      status.message,
      status.clockRollback,
      status.lastVerifiedAt,
      status.name,
      status.email,
      status.deviceId,
    ]);
  }

  _refresh() {
    const next = this._computeStatusSafe();
    const signature = this._signature(next);
    this._status = next;
    if (signature !== this._statusSignature) {
      this._statusSignature = signature;
      this.emit('changed', next);
    }
    return next;
  }

  _computeStatus() {
    const nowSec = this._effectiveNowSec();
    const rawNowSec = Math.floor(this.now() / 1000);
    const record = this._readTrialRecord();

    // --- 时钟回拨检测（记录本地见过的最大时间）
    const prevMax = Math.max(Number(this.file.get('maxSeenAt')) || 0, (record && record.maxSeenAt) || 0);
    const clockRollback = prevMax > 0 && nowSec < prevMax - CLOCK_ROLLBACK_TOLERANCE;
    if (nowSec > prevMax + 30) {
      this.file.patch({ maxSeenAt: nowSec });
      if (record && record.trialEndsAt) {
        this._trialRecord = { ...record, maxSeenAt: nowSec };
        try {
          this.trialStore.write(this._trialRecord);
        } catch {
          /* ignore */
        }
      }
    }
    void rawNowSec;

    // --- 试用区间：加密记录 + 明文备份取更保守值
    const plainFirst = Number(this.file.get('trialFirstSeenAt')) || 0;
    const plainEnds = Number(this.file.get('trialEndsAt')) || 0;
    let trialFirstSeenAt = record ? Number(record.firstSeenAt) || 0 : 0;
    let trialEndsAt = record ? Number(record.trialEndsAt) || 0 : 0;
    if (plainEnds > 0) trialEndsAt = trialEndsAt > 0 ? Math.min(trialEndsAt, plainEnds) : plainEnds;
    if (plainFirst > 0) trialFirstSeenAt = trialFirstSeenAt > 0 ? Math.min(trialFirstSeenAt, plainFirst) : plainFirst;

    const trialActive = trialEndsAt > nowSec;
    const trialDaysLeft = trialActive ? Math.max(1, Math.ceil((trialEndsAt - nowSec) / DAY)) : 0;

    // --- token 校验
    const token = this.file.get('token');
    let check = { ok: false, code: 'TOKEN_INVALID', message: '尚未激活' };
    if (token) check = this._verifyToken(token, { expectDevice: true, nowSec });

    let state = 'unlicensed';
    let planId = '';
    let planName = '未授权';
    let expiresAt = 0;
    let features = this._emptyFeatures();
    let name = this.file.get('name') || '';
    let email = this.file.get('email') || '';
    let message = '';
    let tampered = Boolean(record && record.tampered) || Boolean(this.file.get('trialTampered'));

    if (check.ok) {
      const payload = check.payload;
      planId = payload.plan;
      planName = planNameOf(payload.plan);
      expiresAt = Number(payload.exp) || 0;
      name = payload.name || name;
      email = payload.email || email;

      const lastVerified = Number(this.file.get('lastVerifiedAt')) || Number(payload.iat) || 0;
      const offlineDays = lastVerified > 0 ? (nowSec - lastVerified) / DAY : Infinity;
      const graceExceeded = this.offlineGraceDays > 0 && offlineDays > this.offlineGraceDays;
      const requireOnline = clockRollback || graceExceeded;

      if (requireOnline) {
        state = 'expired';
        features = this._emptyFeatures();
        message = clockRollback
          ? '检测到系统时间异常，请联网验证授权后继续使用'
          : `离线已超过 ${this.offlineGraceDays} 天，请联网验证授权后继续使用`;
      } else {
        state = 'pro';
        features = this._featureFlags(payload);
        if (payload && payload.planName) planName = String(payload.planName);

        message = '';
      }
    } else if (check.code === 'TOKEN_EXPIRED') {
      state = 'expired';
      planId = this.file.get('planId') || (check.payload && check.payload.plan) || '';
      planName = 'Pro 已到期';
      expiresAt = Number(check.payload && check.payload.exp) || 0;
      message = 'Pro 授权已到期，续费后可继续使用全部功能';
    } else {
      if (token) message = '授权凭据无效，请重新激活';
      if (trialActive) {
        state = 'trial';
        planName = '体验版（完整版 7 天）';
        features = this._baseFeatures();
        message = message || `体验期剩余 ${trialDaysLeft} 天`;
      } else if (trialEndsAt > 0) {
        state = 'expired';
        planName = '体验已结束';
        message = message || '体验期已结束，购买 Pro 后继续使用';
      } else {
        state = 'unlicensed';
        planName = '未授权';
        message = tampered
          ? '本地试用数据异常，请联网校准后重试'
          : '输入许可证密钥即可激活 Pro';
      }
    }

    const status = {
      // —— UI 契约字段（缺一不可）——
      state,
      planId,
      planName,
      expiresAt,
      trialEndsAt,
      trialDaysLeft,
      features,
      baseOwned: Boolean(check.ok && check.payload && check.payload.baseOwned),
      addons: check.ok && check.payload && Array.isArray(check.payload.addons) ? check.payload.addons.slice() : [],
      seats: Math.max(1, Number(check.ok && check.payload && check.payload.seats) || 1),
      planExpiry: Number(check.ok && check.payload && (check.payload.planExpiry || check.payload.exp)) || 0,
      aiUnlimited: Boolean(check.ok && check.payload && check.payload.features && check.payload.features.ai_unlimited),
      deviceId: this._deviceId,
      name,
      email,
      offline: this._offline,
      apiBase: this.apiBase,
      lastVerifiedAt: Number(this.file.get('lastVerifiedAt')) || 0,
      // —— 附加信息（UI 可选使用）——
      message,
      clockRollback,
      trialStartedAt: trialFirstSeenAt,
      tampered,
      revoked: Boolean(this._revokedMessage),
      publicKeyFingerprint: this.publicKeyFingerprint || '',
      serverTimeOffset: Number(this.file.get('clockOffsetSec')) || 0,
      ioError: this.ioError || '',
    };
    return status;
  }
}

module.exports = { LicenseManager, normalizeKey, formatKey, planNameOf };
