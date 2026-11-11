/**
 * Cubbit Lite 商业化配置（唯一真相源）
 *
 * 改动这里就能改付费墙、价格、购买链接，不需要碰 store.js / 许可服务端。
 * v2.9.2 起价格统一在 shared/offer-config.js，付款走 PayPal.me，这里只放链接和文案。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubbitLiteConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CONFIG = {
    productName: 'Cubbit',
    productNameZh: '方块仔',

    // v2.9.2 正式版：PayPal.me 付款 + 开发者手动发激活码（价格见 shared/offer-config.js）
    paymentMethod: 'paypal_me',
    paypalMe: 'https://paypal.me/pinggu80',
    checkoutReady: true,

    // 官网与下载
    website: 'https://pingguye.cn/cubbit/',
    downloadUrl: 'https://pingguye.cn/cubbit/dl/windows/latest',
    termsUrl: 'https://pingguye.cn/cubbit/terms',
    privacyUrl: 'https://pingguye.cn/cubbit/privacy',
    refundUrl: 'https://pingguye.cn/cubbit/refund',
    // 邀请落地页：带 code 参数，页面上有「打开方块仔并配对」+ 下载按钮（服务端 landing.js）
    joinBase: 'https://pingguye.cn/cubbit/join',
    // 联系方式：PayPal 付款备注（暂无公开客服邮箱）
    supportEmail: '',

    // 付费墙文案（英文优先，中文只作回退）
    bullets: [
      { en: 'Poke, hug, heart, kiss, high-five, hold hands, goodnight — they feel it instantly', zh: '戳一下 / 抱抱 / 比心 / 亲亲 / 击掌 / 牵手 / 晚安，瞬间送达' },
      { en: 'Notes and 60-second voice messages pop out of their cube', zh: '传话和 60 秒语音，从 TA 的方块仔头顶冒出来' },
      { en: 'Daily check-in and days-together counter', zh: '每天一起打卡，记录在一起的天数' },
      { en: 'One purchase covers both desktops — no subscription', zh: '一份授权两台电脑，永久使用，不是订阅' },
    ],

    /** 免费版包含什么（用于付费墙底部说明） */
    freeIncludes: [
      { en: '42 expressions and reactions', zh: '42 种表情与反应' },
      { en: 'Desktop wandering, petting, feeding', zh: '桌面闲逛、抚摸、投喂' },
      { en: '3 free skins + screenshot / GIF', zh: '3 套免费皮肤 + 截图 / GIF' },
    ],
  };
  return CONFIG;
});
