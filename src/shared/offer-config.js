/**
 * 方块仔 售卖配置 —— 唯一需要改价格/开关的文件（v2.2 简化为 3 档 + 隐藏的 AI 订阅）。
 * UMD：主进程 require / 渲染进程 window.CubbitOffers。
 *
 * 档位：
 *   base     本体（一次性）：桌宠全部基础功能
 *   couple   情侣包（一次性）：一方购买，配对双方都解锁（权益挂在 couples/{id}.entitlement，tier=couple_pack）
 *   skinpack 皮肤包（一次性，可多次购买不同包）
 *   ai       AI 陪伴订阅（月/年）—— FLAGS.aiCompanion=false 时完全隐藏，AI 服务上线后再打开
 *
 * 价格：最小货币单位（分/美分；JPY/KRW 为整数元）。改价只改 PRICES。
 * 地区分级：t1 高收入 / t2 中等（含中国大陆 CNY）/ t3 新兴市场。国家归属见 REGIONS。
 * 注：以下数值为建议定价，上架前请与 Steam 区域定价建议核对。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubbitOffers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FLAGS = {
    aiCompanion: true, // 开启会员订阅（AI 陪伴月付/年付主推）
  };

  const OFFERS = [
    { id: 'ai', kind: 'subscription', name: '会员订阅 · AI 陪伴', nameEn: 'Membership · AI Companion', grants: ['ai_unlimited', 'member_perks'], flag: 'aiCompanion',
      periods: ['year', 'month'], legacyPlanIds: ['ai_year', 'ai_month'], primary: true },
    { id: 'couple', kind: 'one_time', name: '情侣包（两人共用）', nameEn: 'Couple Pack (for both of you)', grants: ['couple_mode', 'couple_premium'],
      sharedWithPartner: true, entitlementTier: 'couple_pack', steamItem: 'DLC_COUPLE_PACK' },
    { id: 'base', kind: 'one_time', name: '方块仔 完整版买断', nameEn: 'Cubbit Full Buyout', grants: ['base'], legacyPlanId: 'base', steamItem: 'APP' },
    { id: 'skinpack', kind: 'one_time', name: '皮肤包', nameEn: 'Skin Pack', grants: ['skin_pack'], repeatable: true, steamItem: 'DLC_SKINPACK_*' },
  ];

  // 列顺序固定：[base, couple, skinpack, ai_month, ai_year]
  const PRICE_COLUMNS = ['base', 'couple', 'skinpack', 'ai_month', 'ai_year'];
  const PRICES = {
    t1: { USD: [1999, 7999, 499, 799, 5999], EUR: [1999, 7999, 499, 799, 5999], GBP: [1699, 6999, 449, 699, 4999],
          JPY: [2980, 11800, 750, 1200, 8800], KRW: [26000, 99000, 6500, 10500, 78000] },
    t2: { CNY: [6800, 26800, 1800, 2500, 19800], USD: [999, 3999, 299, 399, 2999] },
    t3: { USD: [699, 2799, 199, 299, 1999] },
  };

  // 老版本 SKU（已停售，仅用于历史订单/农场点数展示，不进入商店）
  const LEGACY_PRICES = {
    custom:     { t1: { USD: 999, EUR: 999, GBP: 899, JPY: 1500, KRW: 13000 }, t2: { CNY: 2800, USD: 599 }, t3: { USD: 399 } },
    farmpoints: { t1: { USD: 299, EUR: 299, GBP: 249, JPY: 450, KRW: 3900 }, t2: { CNY: 1200, USD: 199 }, t3: { USD: 129 } },
  };

  const REGIONS = {
    euro: 'DE FR IT ES NL BE AT IE FI PT LU GR'.split(' '),
    t1: 'US CA GB UK AU NZ DE FR IT ES NL BE AT IE LU SE NO DK FI IS CH JP KR SG'.split(' '),
    t2: 'CN TW HK MO PL CZ SK HU RO BG HR SI EE LV LT RS UA BY RU AE SA QA KW BH OM IL JO LB'.split(' '),
    t3: 'TH VN ID MY PH MM KH LA MX BR AR CL CO PE UY EC BO PY VE IN PK BD LK NP TR EG NG KE ZA MA GH ET TZ DZ TN'.split(' '),
  };

  function isVisible(offer, flags) {
    const f = Object.assign({}, FLAGS, flags || {});
    return !offer.flag || !!f[offer.flag];
  }
  function visibleOffers(flags) { return OFFERS.filter((o) => isVisible(o, flags)); }
  /** 老 PLANS id 在当前开关下是否应出现在商店 */
  function legacyPlanVisible(planId, flags) {
    const o = OFFERS.find((x) => x.legacyPlanId === planId || (x.legacyPlanIds || []).includes(planId));
    return !!o && isVisible(o, flags);
  }
  /** 情侣权益：任一方买过情侣包 → 双方解锁（couple.entitlement 由服务端写入，客户端只读） */
  function coupleUnlocked(coupleEntitlement) {
    return !!(coupleEntitlement && coupleEntitlement.tier === 'couple_pack' && (coupleEntitlement.until == null || coupleEntitlement.until > Date.now()));
  }
  function validate() {
    const errs = [];
    for (const [tier, byCur] of Object.entries(PRICES)) for (const [cur, row] of Object.entries(byCur)) {
      if (row.length !== PRICE_COLUMNS.length) errs.push(`${tier}.${cur} 列数应为 ${PRICE_COLUMNS.length}`);
      row.forEach((v, i) => { if (!Number.isInteger(v) || v <= 0) errs.push(`${tier}.${cur}.${PRICE_COLUMNS[i]} 必须是正整数`); });
    }
    if (OFFERS.filter((o) => o.kind === 'one_time').length !== 3) errs.push('一次性档位应为 3 个');
    return errs;
  }
  return { FLAGS, OFFERS, PRICE_COLUMNS, PRICES, LEGACY_PRICES, REGIONS, isVisible, visibleOffers, legacyPlanVisible, coupleUnlocked, validate };
});
