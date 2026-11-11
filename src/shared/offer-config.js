/**
 * 方块仔 售卖配置 —— 唯一需要改价格/开关的文件（v2.9.2 正式版：PayPal.me 手动发码）。
 * UMD：主进程 require / 渲染进程 window.CubbitOffers。
 *
 * 售卖方式（2026-11-12 起）：
 *   用户在应用 / 官网点「购买」→ 打开写好金额和币种的 PayPal.me 链接付款
 *   → 付款备注里写邮箱（和设备 ID）→ 开发者确认到账后手动发激活码 → 应用里输入激活码激活。
 *   没有自动收银台，也不在应用内处理任何银行卡信息。
 *
 * 档位（与许可服务端 planId 一一对应）：
 *   base        完整版（买断）
 *   ai_month    会员 · 月
 *   ai_year     会员 · 年
 *   couple_year 情侣年卡（2 个席位）
 *
 * 地区价（2026-11-12 用户确认）：
 *   display = 页面上显示的价格；charge = PayPal 实际扣款（PayPal 不收 KRW，人民币也按美元收）。
 *   金额单位：USD/EUR/GBP/CNY 为「分」，JPY/KRW 为整数元。
 *   PayPal 无法按地区锁价，所以只有这一套价格，不设更低的地区档。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubbitOffers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FLAGS = {
    aiCompanion: true, // 会员（月/年）
  };

  const PAYPAL_ME = 'https://paypal.me/pinggu80';

  const OFFERS = [
    { id: 'base', kind: 'one_time', planId: 'base', name: '方块仔 完整版（买断）', nameEn: 'Cubbit Full Version (one-time)', grants: ['base'], legacyPlanId: 'base' },
    { id: 'ai', kind: 'subscription', name: '会员（AI 陪伴）', nameEn: 'Membership (AI Companion)', grants: ['ai_unlimited', 'member_perks'], flag: 'aiCompanion',
      periods: ['month', 'year'], legacyPlanIds: ['ai_year', 'ai_month'], primary: true },
    { id: 'couple', kind: 'one_time', planId: 'couple_year', name: '情侣年卡（两人共用）', nameEn: 'Couple Year Pass (for both of you)', grants: ['couple_mode', 'couple_premium'],
      sharedWithPartner: true, entitlementTier: 'couple_pack', legacyPlanId: 'couple_year' },
  ];

  /** 售卖 SKU（顺序即付费墙展示顺序）→ 许可服务端 planId */
  const SKU_PLAN = { base: 'base', month: 'ai_month', year: 'ai_year', couple: 'couple_year' };
  const SELL_SKUS = ['base', 'month', 'year', 'couple'];

  const REGION_IDS = ['CN', 'JP', 'KR', 'US', 'EU', 'GB'];
  const REGION_PRICES = {
    CN: { currency: 'CNY', display: { base: 6800, month: 2500, year: 19800, couple: 26800 },
          chargeCurrency: 'USD', charge: { base: 999, month: 399, year: 2999, couple: 3999 } },
    JP: { currency: 'JPY', display: { base: 1480, month: 480, year: 2980, couple: 3980 },
          chargeCurrency: 'JPY', charge: { base: 1480, month: 480, year: 2980, couple: 3980 } },
    KR: { currency: 'KRW', display: { base: 12800, month: 4900, year: 29800, couple: 39800 },
          chargeCurrency: 'USD', charge: { base: 999, month: 399, year: 2999, couple: 3999 } },
    US: { currency: 'USD', display: { base: 999, month: 399, year: 2999, couple: 3999 },
          chargeCurrency: 'USD', charge: { base: 999, month: 399, year: 2999, couple: 3999 } },
    EU: { currency: 'EUR', display: { base: 999, month: 399, year: 2999, couple: 3999 },
          chargeCurrency: 'EUR', charge: { base: 999, month: 399, year: 2999, couple: 3999 } },
    GB: { currency: 'GBP', display: { base: 799, month: 399, year: 2499, couple: 3499 },
          chargeCurrency: 'GBP', charge: { base: 799, month: 399, year: 2499, couple: 3499 } },
  };

  /** 国家 → 地区（未列出的国家一律按「美国和其他地区」USD） */
  const EURO_COUNTRIES = 'AT BE HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES'.split(' ');
  function regionOfCountry(country) {
    const c = String(country || '').toUpperCase();
    if (c === 'CN') return 'CN';
    if (c === 'JP') return 'JP';
    if (c === 'KR') return 'KR';
    if (c === 'GB' || c === 'UK') return 'GB';
    if (EURO_COUNTRIES.includes(c)) return 'EU';
    return 'US';
  }

  // 兼容旧调用方（REGIONS.euro 等）
  const REGIONS = { euro: EURO_COUNTRIES, t1: [], t2: [], t3: [] };

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
    for (const id of REGION_IDS) {
      const r = REGION_PRICES[id];
      if (!r) { errs.push(`缺少地区 ${id}`); continue; }
      for (const sku of SELL_SKUS) {
        for (const k of ['display', 'charge']) {
          const v = r[k][sku];
          if (!Number.isInteger(v) || v <= 0) errs.push(`${id}.${k}.${sku} 必须是正整数`);
        }
      }
    }
    return errs;
  }
  return {
    FLAGS, PAYPAL_ME, OFFERS, SKU_PLAN, SELL_SKUS, REGION_IDS, REGION_PRICES, EURO_COUNTRIES, REGIONS,
    regionOfCountry, isVisible, visibleOffers, legacyPlanVisible, coupleUnlocked, validate,
  };
});
