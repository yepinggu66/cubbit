'use strict';

/**
 * 权益判定（纯函数，不依赖 electron，便于单测）。
 *
 * 这里是**唯一**的付费功能放行口径：entitled / can / skinUnlocked / aiQuota 四个判定
 * 全部收敛到本模块，主进程只做数据装配，避免出现「某个入口漏判 developer 导致白嫖」。
 *
 * developer（开发者授权）为 true 时本机解锁全部功能；正式包不接受任何用户可写开关，
 * 详见 dev-unlock.js。
 */

/** 是否拥有「完整版」权益（买断 / 试用 / 任意付费订阅都算） */
function isEntitled({ developer = false, status = null } = {}) {
  if (developer) return true;
  const st = status || {};
  if (st.state === 'pro') return true;
  if (st.state === 'trial' && (st.trialDaysLeft || 0) > 0) return true;
  return false;
}

/** 某个功能是否解锁（由 license token 的 features 决定） */
function canFeature({ developer = false, features = null, feature = '' } = {}) {
  if (developer) return true;
  return Boolean(features && features[feature]);
}

/**
 * 皮肤是否可用：免费皮肤 / 完整版（skins_premium）/ 已购 DLC。
 * @param {object} p
 * @param {boolean} p.developer
 * @param {object}  p.skin
 * @param {boolean} p.hasAddon  是否已拥有该 DLC
 * @param {object}  p.features  license token 的 features
 */
function isSkinUnlocked({ developer = false, skin = null, hasAddon = false, features = null } = {}) {
  if (!skin) return false;
  if (developer) return true;
  if (skin.free) return true;
  if (skin.dlc) return Boolean(hasAddon);
  return canFeature({ developer: false, features, feature: 'skins_premium' });
}

/**
 * AI 每日配额：免费 10 / 完整版 50 / AI 订阅无限
 * @param {object} p
 * @param {boolean} p.developer
 * @param {() => object} [p.quota] 读取许可证配额的函数（可能抛错）
 */
function aiQuotaFor({ developer = false, quota = null } = {}) {
  if (developer) return { unlimited: true, perDay: Infinity };
  try {
    const q = typeof quota === 'function' ? quota() : quota;
    if (q && typeof q === 'object') return q;
  } catch (err) {
    /* 许可证状态异常时回落到免费档 */
  }
  return { unlimited: false, perDay: 10 };
}

module.exports = { isEntitled, canFeature, isSkinUnlocked, aiQuotaFor };
