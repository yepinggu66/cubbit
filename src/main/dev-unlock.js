'use strict';

/**
 * 开发者授权（developer unlock）判定 —— 纯函数，不依赖 electron，便于单测。
 *
 * 商业化红线（历史事故）：
 *  旧版本在**设置页**提供了「开发者模式」开关，并把结果写进 settings.json。
 *  任何用户改一个 JSON 就能一键解锁全部付费内容（DLC / 情侣模式 / 无限 AI / 全部皮肤），
 *  属于典型的「白嫖通道」，正式包必须彻底移除。
 *
 * 现在的授权来源只有两个，**都不在用户可写的 settings.json 里**：
 *  1. 构建期授权：打包时把 cubbit.devUnlock=true 写进 package.json（内部 QA 包专用），
 *     见 scripts/build-prod.js；
 *  2. 环境变量授权：CUBBIT_DEV_UNLOCK=1（或历史名 CUBBIT_DEV_OWNER=1），
 *     供开发与自测时解锁全部功能，**不再依赖 UI 开关**。
 *
 * 注意：这里刻意**不使用** `process.env.NODE_ENV !== 'production'` 作为放行条件 ——
 * Electron 正式包里 NODE_ENV 通常是 undefined，该表达式会恒为真，等同于全量放行。
 */

/** 可用于解锁的环境变量（第一个为新名字，第二个为历史名字，保留以兼容既有脚本与文档）。 */
const DEV_UNLOCK_ENV_KEYS = ['CUBBIT_DEV_UNLOCK', 'CUBBIT_DEV_OWNER'];

/** settings.json 中历史遗留、必须被强制清除的字段。 */
const LEGACY_DEV_SETTING_KEY = 'developerMode';

/**
 * 环境变量是否请求解锁。
 * @param {object} [env] 默认 process.env
 * @returns {boolean}
 */
function isDevUnlockEnvSet(env) {
  const source = env && typeof env === 'object' ? env : {};
  return DEV_UNLOCK_ENV_KEYS.some((key) => String(source[key] || '').trim() === '1');
}

/**
 * 构建期授权：打包时注入的 package.json → cubbit.devUnlock === true。
 * @param {object} [pkg] 打包后的 package.json
 * @returns {boolean}
 */
function isBuildTimeAuthorized(pkg) {
  return Boolean(pkg && pkg.cubbit && pkg.cubbit.devUnlock === true);
}

/**
 * 最终判定：本机是否处于「开发者解锁」状态。
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]  环境变量
 * @param {object} [opts.pkg=null]          打包后的 package.json（构建期授权）
 * @returns {boolean}
 */
function isDeveloperAuthorized(opts = {}) {
  const { env = process.env, pkg = null } = opts;
  if (isBuildTimeAuthorized(pkg)) return true;
  return isDevUnlockEnvSet(env);
}

/**
 * 强制清除历史遗留的 developerMode 字段（读取时忽略、写入时不保留）。
 * @param {object} settings 需实现 get(key) 与 remove(key)
 * @returns {boolean} 是否发生了清理
 */
function stripLegacyDeveloperMode(settings) {
  if (!settings || typeof settings.get !== 'function') return false;
  if (settings.get(LEGACY_DEV_SETTING_KEY) === undefined) return false;
  if (typeof settings.remove === 'function') {
    settings.remove(LEGACY_DEV_SETTING_KEY);
  } else if (typeof settings.patch === 'function') {
    settings.patch({ [LEGACY_DEV_SETTING_KEY]: undefined });
  } else {
    return false;
  }
  return true;
}

module.exports = {
  DEV_UNLOCK_ENV_KEYS,
  LEGACY_DEV_SETTING_KEY,
  isDevUnlockEnvSet,
  isBuildTimeAuthorized,
  isDeveloperAuthorized,
  stripLegacyDeveloperMode,
};
