/**
 * Cubbit 地区定价（v2.9.2 正式版）。UMD：主进程 require / 渲染进程 window.CubbitPricing。
 * ⚠️ 价格不要在这里改 —— 统一改 shared/offer-config.js。本文件只负责地区判定、格式化和 PayPal.me 链接。
 *
 * 售卖 SKU：base（完整版）/ month（会员月）/ year（会员年）/ couple（情侣年卡）
 * 已停售 SKU（skinpack / custom / farmpoints）skuPrice 返回 null，调用方需自行兜底。
 *
 * 地区：CN / JP / KR / US（美国和其他地区）/ EU / GB。
 * 默认按「界面语言 + 系统地区」判定；用户可在付费墙手动切换（localStorage cubbit.region）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./offer-config'));
  else root.CubbitPricing = factory(root.CubbitOffers);
})(typeof self !== 'undefined' ? self : this, function (OFFERS) {
  const SKUS = ['base', 'couple', 'month', 'year'];
  const DECIMALS = { USD: 2, EUR: 2, GBP: 2, CNY: 2, JPY: 0, KRW: 0 };
  const SYMBOL = { USD: '$', EUR: '€', GBP: '£', CNY: '¥', JPY: '¥', KRW: '₩' };
  const LANG_COUNTRY = { zh: 'CN', ja: 'JP', ko: 'KR', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', en: 'US', pt: 'PT', nl: 'NL' };
  const { REGION_PRICES, REGION_IDS } = OFFERS;
  // 已停售 SKU 的历史别名
  const SKU_ALIAS = { ai_month: 'month', ai_year: 'year', couple_year: 'couple' };

  /** CNY 分 → SKU（catalog.PLANS 的 price 是人民币分，用来反查展示价） */
  const SKU_OF_CNY = {};
  for (const s of SKUS) SKU_OF_CNY[REGION_PRICES.CN.display[s]] = s;

  // 表视图（兼容旧调用方）：TABLE[region][currency][SKUS.indexOf(sku)]
  const TABLE = {};
  for (const id of REGION_IDS) {
    const r = REGION_PRICES[id];
    TABLE[id] = { [r.currency]: SKUS.map((s) => r.display[s]) };
  }

  function countryOf(locale) {
    const s = String(locale || '').replace('_', '-');
    const m = s.match(/^([a-zA-Z]{2,3})(?:-[A-Za-z]{4})?(?:-([A-Za-z]{2}))?/);
    if (!m) return 'US';
    if (m[2]) return m[2].toUpperCase();
    if (/^zh-(hant|tw)/i.test(s)) return 'TW';
    return LANG_COUNTRY[m[1].toLowerCase()] || 'US';
  }

  /** locale（如 zh-CN / ja-JP / de-DE / en-GB）或地区 id（CN/JP/KR/US/EU/GB）→ 地区 */
  function regionFor(localeOrRegion) {
    const raw = String(localeOrRegion || '').trim();
    const upper = raw.toUpperCase();
    const region = REGION_IDS.includes(upper) ? upper : OFFERS.regionOfCountry(countryOf(raw));
    const r = REGION_PRICES[region];
    return {
      region,
      tier: region, // 兼容旧字段
      country: REGION_IDS.includes(upper) ? upper : countryOf(raw),
      currency: r.currency,
      chargeCurrency: r.chargeCurrency,
    };
  }

  function format(amount, currency) {
    const d = DECIMALS[currency] ?? 2;
    const v = d ? amount / 100 : amount;
    const txt = d ? (Number.isInteger(v) && currency === 'CNY' ? String(v) : v.toFixed(2)) : v.toLocaleString('en-US');
    return (SYMBOL[currency] || '') + txt;
  }

  /** PayPal.me 金额段：9.99USD / 1480JPY */
  function paypalAmount(amount, currency) {
    const d = DECIMALS[currency] ?? 2;
    const v = d ? (amount / 100).toFixed(2) : String(Math.round(amount));
    return `${v}${currency}`;
  }
  function payUrl(sku, localeOrRegion) {
    const s = SKU_ALIAS[sku] || sku;
    if (!SKUS.includes(s)) return '';
    const r = regionFor(localeOrRegion);
    const p = REGION_PRICES[r.region];
    if (OFFERS.payMethodOf(r.region) !== 'paypal') return ''; // 中国大陆：扫码付款，没有链接
    return `${OFFERS.PAYPAL_ME}/${paypalAmount(p.charge[s], p.chargeCurrency)}`;
  }

  function skuPrice(sku, localeOrRegion) {
    const s = SKU_ALIAS[sku] || sku;
    if (!SKUS.includes(s)) return null; // 已停售
    const r = regionFor(localeOrRegion);
    const p = REGION_PRICES[r.region];
    const amount = p.display[s];
    const chargeAmount = p.charge[s];
    return {
      ...r,
      sku: s,
      planId: OFFERS.SKU_PLAN[s],
      amount,
      text: format(amount, r.currency),
      chargeAmount,
      chargeText: format(chargeAmount, p.chargeCurrency) + (p.chargeCurrency !== r.currency || p.chargeCurrency === 'USD' ? ` ${p.chargeCurrency}` : ''),
      payMethod: OFFERS.payMethodOf(r.region),
      payUrl: OFFERS.payMethodOf(r.region) === 'paypal' ? `${OFFERS.PAYPAL_ME}/${paypalAmount(chargeAmount, p.chargeCurrency)}` : '',
    };
  }

  /** 人民币分 → 当前地区展示价（售卖档位按地区价；其它数值按大致汇率折算，仅用于展示） */
  function displayCny(cents, localeOrRegion) {
    const n = Number(cents) || 0;
    const sku = SKU_OF_CNY[n];
    if (sku) return skuPrice(sku, localeOrRegion);
    const r = regionFor(localeOrRegion);
    if (r.currency === 'CNY') return { ...r, amount: n, text: format(n, 'CNY') };
    // 人民币分 → 目标币种最小单位（JPY/KRW 为整数元）
    const rate = { USD: 1 / 6.8, EUR: 1 / 6.8, GBP: 1 / 8.5, JPY: 21.8 / 100, KRW: 188 / 100 }[r.currency] || 1 / 6.8;
    const amount = Math.round(n * rate);
    return { ...r, amount, text: format(amount, r.currency) };
  }

  /** 商店用：当前开关下可见档位 + 本地价格 */
  function storeOffers(localeOrRegion, flags) {
    return OFFERS.visibleOffers(flags).map((o) => {
      if (o.kind === 'subscription') return { ...o, prices: { month: skuPrice('month', localeOrRegion), year: skuPrice('year', localeOrRegion) } };
      return { ...o, price: skuPrice(o.id, localeOrRegion) };
    });
  }

  /** 付费墙地区下拉 */
  function regionOptions() {
    return REGION_IDS.map((id) => ({ id, currency: REGION_PRICES[id].currency, chargeCurrency: REGION_PRICES[id].chargeCurrency }));
  }

  return { SKUS, TABLE, SKU_OF_CNY, REGION_IDS, regionFor, countryOf, skuPrice, displayCny, storeOffers, format, payUrl, paypalAmount, regionOptions, SYMBOL, DECIMALS };
});
