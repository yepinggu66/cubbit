'use strict';
/**
 * Cubbit 许可客户端 — 试用期本地加密存储
 *
 * 背景：试用期必须能离线开始（用户第一次打开 app 可能没网），但本地记录又不能被
 *       随手改 JSON 就重刷 7 天。所以用 AES-256-GCM 加密落盘：
 *
 *   文件：<userDataDir>/license-trial.bin
 *   密钥：scrypt(deviceId | "cubbit-trial-v1", 固定应用盐) → 32 字节
 *   内容：{ v, firstSeenAt, trialEndsAt, maxSeenAt, onlineSyncedAt }
 *
 * 离线防刷的边界：能防「改 JSON / 删文件后离线重刷」（删文件会触发联网校准），
 * 防不住「同一台机器完全断网 + 清空目录」这种极端情况；真正的防刷以服务端
 * /api/trial/register 的 firstSeenAt 为准（见 docs/LICENSE-SERVER.md 已知限制）。
 *
 * 本模块零依赖、不 require electron，可在 node --test 下直接测试。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALG = 'aes-256-gcm';
const VERSION = 1;
const DERIVE_SALT = 'cubbit-trial-salt-2026-01';
const DERIVE_INFO = 'cubbit-trial-v1';

class TrialStore {
  /**
   * @param {string} filePath license-trial.bin 绝对路径
   * @param {string} deviceId 设备指纹
   */
  constructor(filePath, deviceId) {
    this.filePath = path.resolve(filePath);
    this.deviceId = String(deviceId || '');
  }

  /** 由 deviceId + 应用盐派生 32 字节 AES 密钥 */
  deriveKey(deviceId = this.deviceId) {
    return crypto.scryptSync(`${deviceId}|${DERIVE_INFO}`, DERIVE_SALT, 32);
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  /**
   * 读取并解密。任何异常都不抛出，用状态区分：
   *  - { ok:true, record }        正常
   *  - { ok:false, missing:true } 文件不存在（首次运行）
   *  - { ok:false, tampered:true } 文件存在但解不开（被改写/损坏）
   * @returns {{ok:boolean, record?:object, missing?:boolean, tampered?:boolean, error?:string}}
   */
  read() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, missing: true };
      return { ok: false, tampered: true, error: err && err.message };
    }
    try {
      const wrapper = JSON.parse(raw);
      if (!wrapper || wrapper.v !== VERSION || wrapper.alg !== ALG) {
        return { ok: false, tampered: true, error: '版本或算法不支持' };
      }
      const key = this.deriveKey();
      const iv = Buffer.from(wrapper.iv, 'base64');
      const tag = Buffer.from(wrapper.tag, 'base64');
      const data = Buffer.from(wrapper.ct, 'base64');
      const decipher = crypto.createDecipheriv(ALG, key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      const record = JSON.parse(plain);
      if (!record || typeof record !== 'object') return { ok: false, tampered: true, error: '内容格式错误' };
      return { ok: true, record };
    } catch (err) {
      return { ok: false, tampered: true, error: err && err.message };
    }
  }

  /**
   * 加密写入（原子写：tmp + rename）。
   * @param {object} record
   */
  write(record) {
    this.ensureDir();
    const key = this.deriveKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const plain = Buffer.from(JSON.stringify(record), 'utf8');
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapper = {
      v: VERSION,
      alg: ALG,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64'),
      updatedAt: Date.now(),
    };
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(wrapper), 'utf8');
    fs.renameSync(tmp, this.filePath);
    return record;
  }

  /** 文件是否存在 */
  exists() {
    try {
      return fs.statSync(this.filePath).isFile();
    } catch {
      return false;
    }
  }

  clear() {
    try {
      fs.unlinkSync(this.filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { TrialStore, ALG, VERSION, DERIVE_SALT, DERIVE_INFO };
