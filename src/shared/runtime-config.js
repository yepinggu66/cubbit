'use strict';

/**
 * 运行时配置（构建期注入 + 运行期覆盖）。
 *
 * 优先级：环境变量 > 打包期注入 > 内置默认值。
 *  - 环境变量：便于私有化部署 / 本地联调（CUBBIT_API_BASE、CUBBIT_UPDATE_FEED_URL）。
 *  - 打包期注入：electron-builder 的 extraMetadata 会把 cubbit 字段写进 asar 内的
 *    package.json，因此只有**正式打包**才会带上生产地址；开发态读不到该字段，
 *    自动回落到默认值，保留本地联调能力。
 *
 * 本模块同时被主进程与服务端 require（server/src/catalog.js 复用本目录 catalog.js），
 * 因此不能依赖 electron，也不能在 require 阶段抛错。
 */

const DEFAULT_API_BASE = 'https://pingguye.cn/cubbit/api';

/** 读取环境变量（兼容没有 process 的宿主环境） */
function envValue(name) {
  try {
    if (typeof process !== 'undefined' && process && process.env) {
      const v = process.env[name];
      return typeof v === 'string' ? v.trim() : '';
    }
  } catch (err) {
    /* ignore */
  }
  return '';
}

/** 读取打包期注入的配置（asar 内 package.json 的 cubbit 字段） */
function bakedValue(key) {
  try {
    // eslint-disable-next-line import/no-dynamic-require
    const pkg = require('../../package.json');
    const baked = pkg && pkg.cubbit && typeof pkg.cubbit === 'object' ? pkg.cubbit : null;
    if (!baked) return '';
    const v = baked[key];
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return '';
  } catch (err) {
    return '';
  }
}

function trimSlash(v) {
  return String(v || '').trim().replace(/\/+$/, '');
}

/** 许可/服务端 API 地址 */
const API_BASE = trimSlash(envValue('CUBBIT_API_BASE') || bakedValue('apiBase') || DEFAULT_API_BASE) || DEFAULT_API_BASE;

/** 自动更新源（generic provider 的目录，存放 latest.yml 与安装包） */
const UPDATE_FEED_URL =
  trimSlash(envValue('CUBBIT_UPDATE_FEED_URL') || bakedValue('updateFeedUrl')) || `${API_BASE}/updates`;

module.exports = {
  DEFAULT_API_BASE,
  API_BASE,
  UPDATE_FEED_URL,
  envValue,
  bakedValue,
};
