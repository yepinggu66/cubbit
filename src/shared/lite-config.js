/**
 * Cubbit Lite 商业化配置（唯一真相源）
 *
 * 改动这里就能改付费墙、价格、购买链接，不需要碰 store.js / 许可服务端。
 * 正式上线时只需要替换两个值：CHECKOUT_URL、DOWNLOAD_URL。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubbitLiteConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CONFIG = {
    productName: 'Couple Pack',
    productNameZh: '情侣包',
    // 首发价与常规价（美元，用于展示；真实扣款由支付平台决定）
    price: 19.99,
    launchPrice: 14.99,
    launchEndsAt: '2026-12-31',
    currency: 'USD',

    // 支付平台结账页（Paddle / Lemon Squeezy 的 checkout link）
    // 接好后替换成真实链接；未替换时点购买会打开占位页并提示"尚未开通"
    checkoutUrl: 'https://cubbit.app/buy',
    checkoutReady: false,

    // 官网下载页（2 周内测：直接指向服务器上的安装包）
    downloadUrl: 'https://pingguye.cn/cubbit/dl/Cubbit-Setup-2.6.3-soft.exe',
    // 邀请落地页：带 code 参数，页面上有「打开方块仔并配对」+ 下载按钮（服务端 landing.js）
    joinBase: 'https://pingguye.cn/cubbit/join',
    supportEmail: 'support@cubbit.app',

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

    isLaunchPrice(now = Date.now()) {
      const end = Date.parse(this.launchEndsAt + 'T23:59:59Z');
      return Number.isFinite(end) ? now <= end : false;
    },
    currentPrice(now = Date.now()) {
      return this.isLaunchPrice(now) ? this.launchPrice : this.price;
    },
    formatPrice(value) {
      return '$' + Number(value).toFixed(2).replace(/\.00$/, '');
    },
  };
  return CONFIG;
});
