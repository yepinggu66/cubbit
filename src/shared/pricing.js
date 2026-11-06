/**
 * Cubbit 区域分级定价（v2.2）。UMD：主进程 require / 渲染进程 window.CubbitPricing。
 * ⚠️ 价格不要在这里改 —— 统一改 shared/offer-config.js。本文件只负责地区判定与格式化。
 * SKU：base / couple(情侣包，一次性，两人共用) / skinpack / month(AI 月) / year(AI 年)
 *      旧 SKU custom / farmpoints 仅用于历史展示。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./offer-config'));
  else root.CubbitPricing = factory(root.CubbitOffers);
})(typeof self !== 'undefined' ? self : this, function (OFFERS) {
  const SKUS = ['base', 'couple', 'skinpack', 'month', 'year', 'custom', 'farmpoints'];
  const COL = { base: 'base', couple: 'couple', skinpack: 'skinpack', month: 'ai_month', year: 'ai_year' };
  const DECIMALS = { USD: 2, EUR: 2, GBP: 2, CNY: 2, JPY: 0, KRW: 0 };
  const SYMBOL = { USD: '$', EUR: '€', GBP: '£', CNY: '¥', JPY: '¥', KRW: '₩' };
  const { REGIONS } = OFFERS;
  const LANG_COUNTRY = { zh: 'CN', ja: 'JP', ko: 'KR', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', en: 'US', pt: 'BR', ru: 'RU', tr: 'TR' };

  function amountOf(sku, tier, currency) {
    if (COL[sku]) return OFFERS.PRICES[tier][currency][OFFERS.PRICE_COLUMNS.indexOf(COL[sku])];
    const l = OFFERS.LEGACY_PRICES[sku];
    return l ? l[tier][currency] : null;
  }
  // 表视图（兼容旧调用方：TABLE[tier][currency][SKUS.indexOf(sku)]）
  const TABLE = {};
  for (const [tier, byCur] of Object.entries(OFFERS.PRICES)) {
    TABLE[tier] = {};
    for (const cur of Object.keys(byCur)) TABLE[tier][cur] = SKUS.map((s) => amountOf(s, tier, cur));
  }
  // CNY 基准分 → SKU（服务器价格 → 展示价）
  const SKU_OF_CNY = {};
  SKUS.forEach((s) => { const v = amountOf(s, 't2', 'CNY'); if (v != null && !(v in SKU_OF_CNY)) SKU_OF_CNY[v] = s; });

  function countryOf(locale) {
    const s = String(locale || '').replace('_', '-');
    const m = s.match(/^([a-zA-Z]{2,3})(?:-[A-Za-z]{4})?(?:-([A-Za-z]{2}))?/);
    if (!m) return 'US';
    if (m[2]) return m[2].toUpperCase();
    if (/^zh-(hant|tw)/i.test(s)) return 'TW';
    return LANG_COUNTRY[m[1].toLowerCase()] || 'US';
  }
  function regionFor(locale) {
    const c = countryOf(locale);
    if (REGIONS.t1.includes(c)) {
      const cur = c === 'GB' || c === 'UK' ? 'GBP' : c === 'JP' ? 'JPY' : c === 'KR' ? 'KRW' : REGIONS.euro.includes(c) ? 'EUR' : 'USD';
      return { country: c, tier: 't1', currency: cur };
    }
    if (REGIONS.t2.includes(c)) return { country: c, tier: 't2', currency: c === 'CN' ? 'CNY' : 'USD' };
    if (REGIONS.t3.includes(c)) return { country: c, tier: 't3', currency: 'USD' };
    return { country: c, tier: 't1', currency: 'USD' };
  }
  function format(amount, currency) {
    const d = DECIMALS[currency] ?? 2;
    const v = d ? amount / 100 : amount;
    const txt = d ? (Number.isInteger(v) && currency === 'CNY' ? String(v) : v.toFixed(2)) : v.toLocaleString('en-US');
    return SYMBOL[currency] + txt;
  }
  function skuPrice(sku, locale) {
    if (!SKUS.includes(sku)) return null;
    const r = regionFor(locale);
    const amount = amountOf(sku, r.tier, r.currency);
    return { ...r, sku, amount, text: format(amount, r.currency) };
  }
  function displayCny(cents, locale) {
    const n = Number(cents) || 0;
    const sku = SKU_OF_CNY[n];
    if (sku) return skuPrice(sku, locale);
    const r = regionFor(locale);
    if (r.currency === 'CNY') return { ...r, amount: n, text: format(n, 'CNY') };
    const rate = { USD: 1 / 7.2, EUR: 1 / 7.8, GBP: 1 / 9.1, JPY: 21 / 100, KRW: 190 / 100 }[r.currency];
    const factor = r.tier === 't3' ? 0.4 / 0.6 : 1;
    const amount = Math.round(n * rate * factor);
    return { ...r, amount, text: format(amount, r.currency) };
  }
  /** 商店用：当前开关下可见档位 + 本地价格 */
  function storeOffers(locale, flags) {
    return OFFERS.visibleOffers(flags).map((o) => {
      if (o.kind === 'subscription') return { ...o, prices: { month: skuPrice('month', locale), year: skuPrice('year', locale) } };
      return { ...o, price: skuPrice(o.id, locale) };
    });
  }
  return { SKUS, TABLE, SKU_OF_CNY, regionFor, countryOf, skuPrice, displayCny, storeOffers, format, SYMBOL, DECIMALS };
});
