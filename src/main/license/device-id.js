'use strict';
/**
 * Cubbit 许可客户端 — 设备指纹
 *
 * 契约 docs/API.md §3：deviceId = sha256(MachineGuid | 用户名 | 应用盐) 取 32 hex。
 * 只用于设备绑定与试用防刷，不采集/不上报任何其它硬件信息（PIPL 最小采集）。
 *
 * 注意：本模块不依赖 Electron，可在 node --test 下直接测试。
 * 测试/CI 可用 env CUBBIT_DEVICE_ID 或 options.deviceId 覆盖。
 */

const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const APP_SALT = 'cubbit-salt-v1';

/** 读取 Windows 注册表 MachineGuid（失败则回退，绝不抛异常） */
function readMachineGuid() {
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', timeout: 2000, windowsHide: true }
    );
    const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{8,})/.exec(String(out));
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function safeUsername() {
  try {
    const info = os.userInfo();
    return (info && info.username) || '';
  } catch {
    return '';
  }
}

/**
 * 计算设备指纹（32 位 hex）。
 * @param {{machineGuid?:string, username?:string, salt?:string}} [parts]
 */
function computeDeviceId(parts = {}) {
  const machineGuid = parts.machineGuid != null ? parts.machineGuid : readMachineGuid();
  const username = parts.username != null ? parts.username : safeUsername();
  const salt = parts.salt || APP_SALT;
  const material = [machineGuid || safeHostname(), username || '', salt].join('|');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
}

function safeHostname() {
  try {
    return os.hostname();
  } catch {
    return 'unknown-host';
  }
}

module.exports = { computeDeviceId, readMachineGuid, APP_SALT, safeUsername, safeHostname };
