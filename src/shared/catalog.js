/**
 * 方块仔 — 商品目录（单一事实来源 / single source of truth）
 *
 * 主进程、商店窗口、设置窗口、许可服务端都从这里读取商品与功能定义。
 * 所有价格以「分」为整数存储，避免浮点误差；展示时再换算。
 */

const { API_BASE } = require('./runtime-config');

const PRODUCT = {
  id: 'cubbit',
  name: 'Cubbit',
  zhName: '方块仔',
  version: '2.1.0',
  tagline: '一只住在你桌面上的小方块',
  taglineEn: 'A tiny cube that lives on your desktop.',
  website: 'https://cubbit.app',
  supportEmail: 'support@cubbit.app',
  // 试用天数（首次启动自动开始，无需注册）
  trialDays: 14, // 内测版：14 天（与 11/18 内测截止对齐；正式版改回 7 天）
  // 免费版默认皮肤
  defaultSkinId: 'blaze',
  // 许可服务端地址：构建期注入（asar 内 package.json 的 cubbit.apiBase），
  // 运行时可用 CUBBIT_API_BASE 覆盖；开发态默认本地联调地址。
  // 注入逻辑见 runtime-config.js，此处只做取值，避免与目录定义耦合。
  apiBase: API_BASE,
};

/** 功能权限：pro=true 表示需要 Pro 授权 */
const FEATURES = {
  skins_premium: { pro: true, name: '高级皮肤', desc: '20 套手工调色皮肤，含季节限定' },
  focus_custom: { pro: true, name: '自定义专注', desc: '任意时长、任意标签，多段循环' },
  focus_stats: { pro: true, name: '专注统计', desc: '每日/每周专注时长与心情日历' },
  growth: { pro: true, name: '成长系统', desc: '喂养、等级与成就徽章：免费可喂养，等级上限 3 级' },
  multi_pet: { pro: true, name: '多宠物同屏', desc: '最多 3 只方块仔一起陪你' },
  custom_colors: { pro: true, name: '自定义配色', desc: '自己调配方块的主色、光泽与眼睛' },
  reminders: { pro: true, name: '桌面提醒', desc: '让方块仔替你记住喝水、起身、开会' },
  no_watermark: { pro: true, name: '去除体验版角标', desc: '体验期内窗口右下角会显示体验标' },
  couple_mode: { pro: true, name: '情侣模式', desc: '两只方块仔配对、说情话、聊天并举行婚礼' },
  cinema_mode: { pro: false, name: '观影模式', desc: '看剧时只留一双发光的眼睛，不打扰你' },
  presence_reactions: { pro: false, name: '主人状态感知', desc: '根据你在工作/看剧/开会/离开自动做出反应' },
  life_system: { pro: true, name: '智慧生命', desc: '心情、精力、性格、记忆：它会主动想你、记得你' },
  ai_chat: { pro: true, name: 'AI 对话', desc: '接本地 Ollama 或任意 OpenAI 兼容接口，它真的会陪你聊天' },
  office_pro: { pro: true, name: '办公助手', desc: '会议/日程提醒（含 .ics 导入）、无限剪贴板历史、番茄钟进阶、每日专注总结' },
  member_perks: { pro: true, name: '会员权益', desc: '无限 AI、长期记忆不限条数、每月新皮肤、云同步' },
  custom_character: { pro: true, name: '角色定制', desc: '照片/文字生成专属皮肤 + 专属声音（单独购买）' },
  couple_premium: { pro: true, name: '情侣进阶', desc: '纪念日相册、每月情书、限定情侣装（情侣年卡）' },
  ai_unlimited: { pro: true, name: '无限 AI', desc: 'AI 对话/记忆不限额（完整版 50 轮/日，免费版 10 轮/日）' },
};

/** 免费档（不售卖，安装即享） */
const FREE_TIER = {
  id: 'free',
  name: '免费版',
  price: 0,
  aiTurnsPerDay: 10,
  watermark: true,
  skins: ['blaze', 'citrus', 'mint'],
  features: ['cinema_mode', 'presence_reactions'],
  desc: '免费体验桌面陪伴：2 套皮肤、观影模式、状态感知、每天 10 轮 AI 对话',
  watermark: true,
  permanentBadge: false,
  watermarkNote: '免费版默认不显示永久角标（仅体验版显示剩余天数）',
  missing: ['全部 20 套皮肤', '情侣模式', '智慧生命完整版', '无限 AI 对话'],
};

/**
 * DLC 角色包
 *
 * ⚠️ v2.0.1 起：极光 / 南瓜两款皮肤已包含在「完整版 ¥38」中，不再单独售卖。
 * 因此这两条记录标记 `available: false`：
 *   - 前端（应用内商店面板 / 站点）据此隐藏购买入口；
 *   - 服务端下单处据此拒绝下单。
 *
 * ⚠️ **记录本身必须保留**：`dlcById()` 是历史已购订单的授权校验依据，
 * 删除会导致已付费用户授权失效（`tests/license/entitlements.test.js` 也依赖这两个 id）。
 */
const DLC = [
  {
    id: 'dlc_aurora',
    name: '极光皮肤',
    nameEn: 'Aurora',
    price: 1800,
    priceUsd: 499,
    skinId: 'aurora',
    badge: null,
    desc: '极光渐层皮肤 + 冰蓝发光眼睛，适合夜间与观影场景（已包含在完整版中）',
    requires: 'base',
    available: false,
    includedInBase: true,
  },
  {
    id: 'dlc_pumpkin',
    name: '南瓜皮肤',
    nameEn: 'Pumpkin',
    price: 1800,
    priceUsd: 499,
    skinId: 'pumpkin',
    badge: '万圣限定',
    desc: '暖橙南瓜皮肤 + 糖果色腮红，秋季与节日氛围拉满（已包含在完整版中）',
    requires: 'base',
    available: false,
    includedInBase: true,
  },
  {
    id: 'dlc_season_winter',
    name: '冬季限定皮肤包',
    nameEn: 'Winter Season Pack',
    price: 1800,
    priceUsd: 499,
    skinIds: ['santa', 'lunar'],
    badge: '季节限定',
    desc: '圣诞老方 + 福崽两套节日皮肤，免费版也能单独拥有',
    requires: null,
    available: true,
    kind: 'skin_pack',
  },
  {
    id: 'dlc_custom_char',
    name: '角色定制',
    nameEn: 'Character Studio',
    price: 2800,
    priceUsd: 999,
    badge: '单独购买',
    desc: '上传照片或一句话描述，生成你的专属方块仔皮肤；录几句话设置专属声音',
    requires: null,
    available: true,
    kind: 'feature',
    feature: 'custom_character',
  },
];

/** 订阅 / 买断方案（四层结构：免费 / 完整版买断 / AI 订阅 / 情侣双人版；DLC 见上） */
/** 订阅 / 买断方案（价格为人民币分） */
const PLANS = [
  {
    id: 'base',
    name: '完整版',
    nameEn: 'Full',
    price: 6800,
    priceUsd: 1999,
    period: 'once',
    durationDays: 0,
    badge: '最划算 · 一次买断',
    desc: '一次买断，永久使用：20 套皮肤、情侣模式、智慧生命、50 轮/日 AI、去水印',
    perks: ['全部 20 套皮肤', '情侣模式 + 双人配对', '智慧生命完整版', '50 轮/日 AI 对话', '无体验标识 + 永久更新'],
    includes: '当前 20 套皮肤，后续新增皮肤持续更新（不含 UGC / 联名 / 合作 IP）',
    highlight: true,
    grants: { base: true },
  },
  {
    id: 'ai_month',
    name: '会员 · 月付',
    nameEn: 'Membership Monthly',
    price: 2500,
    priceUsd: 799,
    period: 'month',
    durationDays: 30,
    badge: null,
    desc: '无限 AI 对话 + 长期记忆 + 每月新皮肤 + 云同步，随时取消',
    perks: ['包含完整版全部权益', '无限 AI 对话', '长期记忆不限条数', '每月一套会员新皮肤', '云同步（多设备）'],
    highlight: false,
    grants: { base: true, aiUnlimited: true },
  },
  {
    id: 'ai_year',
    name: '会员 · 年付',
    nameEn: 'Membership Yearly',
    price: 19800,
    priceUsd: 5999,
    period: 'year',
    durationDays: 365,
    badge: '省 46%',
    desc: '会员全部权益，年付更省',
    perks: ['包含完整版全部权益', '无限 AI 对话', '长期记忆不限条数', '每月一套会员新皮肤', '云同步（多设备）'],
    highlight: false,
    grants: { base: true, aiUnlimited: true },
  },
  {
    id: 'couple_year',
    name: '情侣双人版',
    nameEn: 'Couple',
    price: 26800,
    priceUsd: 7999,
    period: 'year',
    durationDays: 365,
    badge: '双人优惠',
    renewalPrice: 26800,
    desc: '两人共用一份：2 个完整版名额 + 情侣模式 + 情侣进阶（纪念日相册、每月情书、限定情侣装）',
    perks: ['2 个完整版名额（两人都能用）', '情侣配对 / 聊天 / 结婚', '纪念日回忆相册', '每月一封方块仔写的情书', '限定情侣装'],
    highlight: false,
    seats: 2,
    grants: { base: true, seats: 2 },
  },
];

/** 皮肤定义：palette 直接映射到渲染层 CSS 变量 */
const SKINS = [
  {
    id: 'blaze',
    effect: 'warm-glow',
    name: '橙红经典',
    nameEn: 'Classic Orange',
    free: true,
    desc: '纯橙红色的经典方块仔，明亮干净',
    palette: {
      body1: '#ff8a50', body2: '#ff5a1f', body3: '#e8440c',
      eye: '#2a1610', pupil: '#120805', blush: '#ffb199', rim: '#ffd2bd', glow: 'rgba(255,110,50,.45)',
    },
  },
  {
    id: 'citrus',
    effect: 'warm-glow',
    name: '蜜橘',
    nameEn: 'Citrus',
    free: true,
    desc: '出厂自带的小橘子方块',
    palette: {
      body1: '#ffd9bf', body2: '#ef7a52', body3: '#c9482a',
      eye: '#2b1a14', pupil: '#140c08', blush: '#ff8d78', rim: '#ffe6d4', glow: 'rgba(255,150,110,.45)',
    },
  },
  {
    id: 'mint',
    effect: 'bubbles',
    name: '薄荷',
    nameEn: 'Mint',
    free: true,
    desc: '清爽的薄荷奶油，适合白天',
    palette: {
      body1: '#e8fff6', body2: '#7fd9bb', body3: '#3f9e83',
      eye: '#123028', pupil: '#081a15', blush: '#ffb3c2', rim: '#f4fffb', glow: 'rgba(120,230,200,.45)',
    },
  },
  {
    id: 'nightowl',
    effect: 'star-glow',
    name: '夜光',
    nameEn: 'Night Owl',
    free: false,
    desc: '深夜里眼睛会发光的暗夜方块',
    palette: {
      body1: '#5a5aa0', body2: '#2a2a55', body3: '#14142c',
      eye: '#9ff2ff', pupil: '#e6feff', blush: '#7c5cff', rim: '#c9c9ff', glow: 'rgba(120,200,255,.75)',
    },
  },
  {
    id: 'sakura',
    effect: 'petals',
    name: '樱花',
    nameEn: 'Sakura',
    free: false,
    desc: '春日限定的粉樱渐变',
    palette: {
      body1: '#ffe1ec', body2: '#f497b6', body3: '#c85f83',
      eye: '#3a1622', pupil: '#1c0a10', blush: '#ff6f9c', rim: '#fff2f7', glow: 'rgba(255,140,180,.5)',
    },
  },
  {
    id: 'aurora',
    effect: 'aurora-flow',
    name: '极光',
    nameEn: 'Aurora',
    free: false,
    desc: '青紫流动的极光质感',
    palette: {
      body1: '#c8f8ff', body2: '#5b8cff', body3: '#4356c9',
      eye: '#0b1233', pupil: '#050914', blush: '#a37bff', rim: '#e8f6ff', glow: 'rgba(120,180,255,.6)',
    },
  },
  {
    id: 'chrome',
    effect: 'sheen',
    name: '金属',
    nameEn: 'Chrome',
    free: false,
    desc: '冷静的枪灰金属，商务桌面友好',
    palette: {
      body1: '#f2f4f8', body2: '#9aa3b2', body3: '#4d5666',
      eye: '#0b0e14', pupil: '#05070a', blush: '#8d99b0', rim: '#ffffff', glow: 'rgba(200,220,255,.4)',
    },
  },
  {
    id: 'pumpkin',
    effect: 'sparks',
    name: '南瓜',
    nameEn: 'Pumpkin',
    free: false,
    desc: '万圣节限定，眼睛会冒小火星',
    palette: {
      body1: '#ffd08a', body2: '#f09030', body3: '#b85a10',
      eye: '#2a1200', pupil: '#150800', blush: '#ff7a35', rim: '#ffe9c8', glow: 'rgba(255,150,60,.6)',
    },
  },
  {
    id: 'cloud',
    effect: 'drift',
    name: '云朵',
    nameEn: 'Cloud',
    free: false,
    desc: '软乎乎的奶油云，治愈系',
    palette: {
      body1: '#ffffff', body2: '#cfe3ff', body3: '#94b6ea',
      eye: '#1b2a44', pupil: '#0b1424', blush: '#ffc2cf', rim: '#ffffff', glow: 'rgba(180,220,255,.5)',
    },
  },
];

/** 夜间 / 深色模式下的自动调色（free 也生效，是本产品的核心卖点） */
const DARK_VARIANT = {
  body1: '#3a3a4d',
  body2: '#1e1e2a',
  body3: '#0e0e15',
  eye: '#8ff3ff',
  pupil: '#e9ffff',
  blush: '#6d5cff',
  rim: '#8f9bd8',
  glow: 'rgba(120,210,255,.8)',
};

/** Pro 权益汇总（用于商店页 / 文案） */
const PRO_BENEFITS = [
  { icon: 'palette', title: '20 套手工皮肤', desc: '蜜橘、薄荷免费；夜光、樱花、极光、金属、南瓜、云朵解锁' },
  { icon: 'users', title: '情侣模式', desc: '两台 PC 或 PC + 手机配对，聊天、情话、结婚、纪念日' },
  { icon: 'sparkle', title: '智慧生命完整版', desc: '心情、精力、性格、记忆，会主动想你、记得你' },
  { icon: 'timer', title: '专注 / 成长', desc: '番茄钟、等级、成就与多宠物同屏' },
  { icon: 'chat', title: 'AI 对话', desc: '本地 Ollama 或任意 OpenAI 兼容接口；完整版 50 轮/日，AI 订阅无限' },
  { icon: 'bell', title: '手机后台提醒', desc: '对方发消息、情话、求婚，手机锁屏也能收到（免费）' },
  { icon: 'sliders', title: '去水印 / 自定义', desc: '完整版去除体验水印，支持自定义配色与桌面提醒' },
];

function dlcById(id) {
  return DLC.find((d) => d.id === id) || null;
}

function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

function skinById(id) {
  return SKINS.find((s) => s.id === id) || SKINS[0];
}

/** 该皮肤是否需要 Pro（返回 false 表示免费） */
function skinRequiresPro(skinId) {
  const s = skinById(skinId);
  return !s.free;
}

function freeSkins() {
  return SKINS.filter((s) => s.free).map((s) => s.id);
}

/** Pro 计划对应的授权时长（天）；0 表示永久 */
function planDurationDays(planId) {
  const p = planById(planId);
  return p ? p.durationDays : 0;
}

function formatPrice(cents) {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/** 情侣空间场景（v1.6，双人版权益） */
const COUPLE_SCENES = [
  { id: 'coffee', name: '咖啡约会', emoji: '☕', accent: '#c98a5a', desc: '两杯热咖啡，慢慢聊' },
  { id: 'movie', name: '深夜电影', emoji: '🎬', accent: '#5b6cff', desc: '只留屏幕的光和爆米花' },
  { id: 'stars', name: '阳台看星星', emoji: '✨', accent: '#7fd4ff', desc: '把今天的心事交给星星' },
  { id: 'cooking', name: '一起做饭', emoji: '🍳', accent: '#ffb15c', desc: '笨手笨脚也开心' },
  { id: 'rain', name: '雨天窗边', emoji: '🌧️', accent: '#8aa4c8', desc: '雨声当背景音，靠在一起' },
  { id: 'bedtime', name: '晚安故事', emoji: '🌙', accent: '#b7a6ff', desc: '讲完最后一个故事就睡' },
];


/* ============================================================ v2.1 皮肤角色化
 * 每个皮肤 = palette + 配件层(accessory) + 专属待机(idle) + 专属粒子(particles) + 专属台词(lines)
 * accessory: { hat, ears, tail, held }（均为可选，渲染层用 data-* 驱动 CSS）
 * idle: 专属待机动画名（pet.css 中 sig-<idle>）
 */
const SKIN_EXTRAS = {
  blaze: { idle: 'wiggle', particles: ['🧡', '✨'], lines: ['我是最经典的橙红方块仔！', '今天也要热乎乎的！'] },
  citrus: { accessory: { hat: 'leaf' }, idle: 'wiggle', particles: ['🍊', '✨'], lines: ['今天也要元气满满！', '闻闻，我是不是橘子味的？', '剥开我会有好心情哦'] },
  mint: { accessory: { hat: 'sprout' }, idle: 'float', particles: ['🫧', '🍃'], lines: ['呼～清清凉凉', '喝口水吧，像我一样清爽', '冒泡泡中…'] },
  nightowl: { accessory: { ears: 'owl' }, idle: 'peek', particles: ['⭐', '🌙'], lines: ['夜深了，我替你看着星星', '咕咕～还不睡吗？', '我的眼睛会发光哦'] },
  sakura: { accessory: { hat: 'flower' }, idle: 'sway', particles: ['🌸', '💮'], lines: ['春天在我头上开花啦', '樱花落下的速度是每秒五厘米', '要不要一起去赏花？'] },
  aurora: { accessory: { hat: 'halo' }, idle: 'float', particles: ['✨', '💠'], lines: ['极光是天空在跳舞', '我把北极的光带来给你', '闭上眼许个愿吧'] },
  chrome: { accessory: { ears: 'antenna' }, idle: 'scan', particles: ['⚙️', '✦'], lines: ['系统运行正常', '效率模式：开启', '本机器人很冷静（才怪）'] },
  pumpkin: { accessory: { hat: 'witch' }, idle: 'wiggle', particles: ['🎃', '🍬', '🦇'], lines: ['不给糖就捣蛋！', '嘿嘿，我的眼睛在冒火花', '万圣节快乐～'], season: 'halloween' },
  cloud: { accessory: { hat: 'raindrop' }, idle: 'float', particles: ['☁️', '💧'], lines: ['软乎乎的，想捏捏吗？', '我飘过来陪你啦', '今天是晴天心情'] },
  // ---------------- v2.1 新增角色皮肤
  neko: { accessory: { ears: 'cat', tail: 'cat', held: '🐟' }, idle: 'tailwag', particles: ['🐾', '💗'], lines: ['喵～', '小鱼干是我的！', '蹭蹭你的手'] },
  bunny: { accessory: { ears: 'bunny', tail: 'puff', held: '🥕' }, idle: 'hop', particles: ['🥕', '🌼'], lines: ['蹦蹦！', '胡萝卜补充能量', '耳朵竖起来听你说话'] },
  panda: { accessory: { ears: 'bear', held: '🎋' }, idle: 'sway', particles: ['🎋', '🍃'], lines: ['竹子真好吃', '我只是看起来很困', '滚来滚去～'] },
  frog: { accessory: { ears: 'frog', held: '🪷' }, idle: 'hop', particles: ['💧', '🪷'], lines: ['呱！', '雨天是我的主场', '跳一跳更健康'] },
  bee: { accessory: { ears: 'antenna', tail: 'stinger', held: '🍯' }, idle: 'buzz', particles: ['🌼', '🍯'], lines: ['嗡嗡嗡，勤劳一整天', '蜂蜜分你一口', '采蜜去咯'] },
  chef: { accessory: { hat: 'chef', held: '🍳' }, idle: 'wiggle', particles: ['🍳', '✨'], lines: ['今天吃什么？', '本大厨开火啦', '记得按时吃饭！'] },
  cyber: { accessory: { hat: 'visor', ears: 'antenna' }, idle: 'scan', particles: ['💾', '⚡'], lines: ['正在连接赛博空间…', 'bug 已定位', '电量 100%'] },
  wizard: { accessory: { hat: 'wizard', held: '🪄' }, idle: 'float', particles: ['✨', '🔮'], lines: ['咒语：专注力 +10！', '我会一点点魔法', '许愿池营业中'] },
  santa: { accessory: { hat: 'santa', held: '🎁' }, idle: 'wiggle', particles: ['❄️', '🎁'], lines: ['圣诞快乐！', '你今年很乖哦', '礼物在路上啦'], season: 'christmas' },
  lunar: { accessory: { hat: 'lantern', held: '🧧' }, idle: 'hop', particles: ['🧧', '🎆'], lines: ['新年快乐，恭喜发财！', '红包拿来～', '新的一年一起加油'], season: 'spring_festival' },
  mooncake: { accessory: { ears: 'bunny', held: '🥮' }, idle: 'sway', particles: ['🥮', '🌕'], lines: ['中秋快乐', '月亮和我一样圆', '分你一半月饼'], season: 'mid_autumn' },
  cupid: { accessory: { hat: 'halo', tail: 'wings', held: '💘' }, idle: 'float', particles: ['💘', '💗'], lines: ['射中你啦', '和 TA 配对，我们是一对', '今天也要好好相爱'], season: 'valentine', couplePair: 'rose' },
  maple: { accessory: { hat: 'leaf', held: '🍁' }, idle: 'sway', particles: ['🍁', '🍂'], lines: ['十一月的枫叶送给你', '秋天适合专注', '会员新皮肤上线啦'], memberMonth: '2026-11' },
  starpair: { accessory: { hat: 'halo', held: '🌟' }, idle: 'float', particles: ['🌟', '💞'], lines: ['你是我的那颗星', '情侣限定，只给你们俩'], couplePremium: true },
  vowpair: { accessory: { hat: 'flower', held: '💍' }, idle: 'sway', particles: ['💍', '🤍'], lines: ['今天也想嫁给你一次', '限定情侣装，要和 TA 一起穿'], couplePremium: true },
  farmer: { accessory: { hat: 'leaf', held: '🌾' }, idle: 'hop', particles: ['🌾', '🥕'], lines: ['今天的菜长得真好', '去农场看看吧', '收获的季节到啦'], farmShards: 10 },
  sweet7: { accessory: { hat: 'flower', held: '🍬' }, idle: 'hop', particles: ['🍬', '💗'], lines: ['在一起一周啦', '甜甜的一周'] },
  moon30: { accessory: { hat: 'halo', held: '🌙' }, idle: 'float', particles: ['🌙', '✨'], lines: ['满月快乐', '一个月了哦'] },
  blossom100: { accessory: { hat: 'flower', held: '🌸' }, idle: 'sway', particles: ['🌸', '💞'], lines: ['一百天，花开了', '百日快乐'] },
  forever365: { accessory: { hat: 'halo', held: '💍' }, idle: 'float', particles: ['💍', '🎆'], lines: ['一周年快乐', '以后每一年都一起'] },
  rose: { accessory: { hat: 'flower', held: '🌹' }, idle: 'sway', particles: ['🌹', '💗'], lines: ['送你一朵玫瑰', '我在等我的丘比特', '恋爱值 +1'], season: 'valentine', couplePair: 'cupid' },
};

SKINS.push(
  { id: 'neko', effect: 'paws', name: '喵喵', nameEn: 'Neko', free: false, desc: '猫耳 + 尾巴 + 小鱼干，会摇尾巴的猫系方块', palette: { body1: '#fff4e6', body2: '#f2c48d', body3: '#c98a4b', eye: '#2c3a1a', pupil: '#121a08', blush: '#ff9fae', rim: '#fffaf2', glow: 'rgba(255,200,140,.45)' } },
  { id: 'bunny', effect: 'petals', name: '跳跳兔', nameEn: 'Bunny', free: false, desc: '长耳朵 + 胡萝卜，待机会蹦蹦跳', palette: { body1: '#ffffff', body2: '#f3e3ee', body3: '#cfa9c1', eye: '#3a1630', pupil: '#1c0a18', blush: '#ff8fb6', rim: '#ffffff', glow: 'rgba(255,190,220,.45)' } },
  { id: 'panda', effect: 'leaves', name: '团子熊猫', nameEn: 'Panda', free: false, desc: '圆耳朵抱竹子，慢悠悠摇摆', palette: { body1: '#ffffff', body2: '#e6e6e6', body3: '#9a9a9a', eye: '#111111', pupil: '#000000', blush: '#ffb0b0', rim: '#ffffff', glow: 'rgba(200,200,200,.4)' } },
  { id: 'frog', effect: 'bubbles', name: '呱呱', nameEn: 'Froggy', free: false, desc: '雨天青蛙，顶着荷花跳来跳去', palette: { body1: '#e3ffc9', body2: '#8fd16a', body3: '#4d9438', eye: '#1b2a10', pupil: '#0b1406', blush: '#ffa0a0', rim: '#f4ffe9', glow: 'rgba(150,230,120,.45)' } },
  { id: 'bee', effect: 'sparks', name: '蜜蜂', nameEn: 'Honeybee', free: false, desc: '触角 + 蜂蜜罐，嗡嗡地勤劳一整天', palette: { body1: '#fff3b0', body2: '#ffcc33', body3: '#d99400', eye: '#2a1a00', pupil: '#120a00', blush: '#ff9a55', rim: '#fffbe0', glow: 'rgba(255,210,80,.5)' } },
  { id: 'chef', effect: 'warm-glow', name: '小厨师', nameEn: 'Chef', free: false, desc: '高高的厨师帽 + 平底锅，提醒你按时吃饭', palette: { body1: '#fff1e4', body2: '#ffc79e', body3: '#d98a5a', eye: '#2b1a14', pupil: '#140c08', blush: '#ff8d78', rim: '#ffffff', glow: 'rgba(255,190,150,.45)' } },
  { id: 'cyber', effect: 'sheen', name: '赛博', nameEn: 'Cyber', free: false, desc: '霓虹目镜 + 天线，扫描你的代码', palette: { body1: '#2b2f55', body2: '#1a1d3a', body3: '#0c0e20', eye: '#39ffe4', pupil: '#d9fffa', blush: '#ff3ec8', rim: '#7af6ff', glow: 'rgba(60,255,230,.7)', dark: true } },
  { id: 'wizard', effect: 'star-glow', name: '小法师', nameEn: 'Wizard', free: false, desc: '尖顶法师帽 + 魔杖，会给你施专注魔法', palette: { body1: '#e6d9ff', body2: '#9a7bff', body3: '#5a3fc0', eye: '#1a0f33', pupil: '#0a0514', blush: '#ff9ad8', rim: '#f5efff', glow: 'rgba(170,140,255,.6)' } },
  { id: 'santa', effect: 'snow', name: '圣诞老方', nameEn: 'Santa', free: false, badge: '圣诞限定', desc: '圣诞帽 + 礼物盒，下雪的冬日限定', palette: { body1: '#ffe0e0', body2: '#ef4b4b', body3: '#b01e2a', eye: '#2a0c0c', pupil: '#140606', blush: '#ffb3b3', rim: '#ffffff', glow: 'rgba(255,120,120,.5)' } },
  { id: 'lunar', effect: 'sparks', name: '福崽', nameEn: 'Lucky', free: false, badge: '春节限定', desc: '灯笼帽 + 红包，春节限定喜气洋洋', palette: { body1: '#ffe2c8', body2: '#e8402f', body3: '#a3161a', eye: '#2a0a00', pupil: '#120400', blush: '#ffcf4a', rim: '#ffe9a8', glow: 'rgba(255,200,80,.55)' } },
  { id: 'mooncake', effect: 'star-glow', name: '玉兔月饼', nameEn: 'Mooncake', free: false, badge: '中秋限定', desc: '兔耳 + 月饼，中秋限定的圆满', palette: { body1: '#fff3d6', body2: '#e8b86a', body3: '#a8712c', eye: '#2a1a08', pupil: '#140c02', blush: '#ffb08a', rim: '#fff8e8', glow: 'rgba(255,220,140,.5)' } },
  { id: 'cupid', effect: 'hearts', name: '丘比特', nameEn: 'Cupid', free: false, badge: '情侣款', desc: '光环 + 小翅膀 + 爱心箭，与「玫瑰」是一对', palette: { body1: '#fff0f6', body2: '#ffb3cf', body3: '#e0678f', eye: '#3a1022', pupil: '#1c0810', blush: '#ff6f9c', rim: '#ffffff', glow: 'rgba(255,150,190,.55)' } },
  { id: 'rose', effect: 'petals', name: '玫瑰', nameEn: 'Rose', free: false, badge: '情侣款', desc: '头顶小花 + 玫瑰，与「丘比特」是一对', palette: { body1: '#ffe0e6', body2: '#e8556f', body3: '#a3203c', eye: '#2a0810', pupil: '#140408', blush: '#ffb0c0', rim: '#fff0f3', glow: 'rgba(255,110,140,.5)' } },
);

SKINS.push(
  { id: 'maple', effect: 'leaves', name: '枫叶', nameEn: 'Maple', free: false, badge: '会员月度', desc: '2026 年 11 月会员新皮肤：暖橙枫叶', palette: { body1: '#ffe2c4', body2: '#f08a3c', body3: '#b4501c', eye: '#2a140a', pupil: '#120804', blush: '#ff9d7a', rim: '#fff0e0', glow: 'rgba(240,140,60,.45)' } },
  { id: 'starpair', effect: 'star-glow', name: '星河情侣装', nameEn: 'Starlight Pair', free: false, badge: '情侣限定', desc: '情侣年卡限定：星光光环，和 TA 一起穿', palette: { body1: '#eef0ff', body2: '#9fa8ff', body3: '#5b5fd1', eye: '#141638', pupil: '#070816', blush: '#ffb3d1', rim: '#ffffff', glow: 'rgba(150,160,255,.5)' } },
  { id: 'vowpair', effect: 'hearts', name: '誓约情侣装', nameEn: 'Vow Pair', free: false, badge: '情侣限定', desc: '情侣年卡限定：小白花 + 戒指', palette: { body1: '#ffffff', body2: '#f6e6ee', body3: '#cfa3b8', eye: '#3a1426', pupil: '#1a0812', blush: '#ffb0c8', rim: '#ffffff', glow: 'rgba(255,190,215,.5)' } },
  { id: 'farmer', effect: 'leaves', name: '田园小农夫', nameEn: 'Little Farmer', free: false, badge: '农场限定', desc: '小农场限定：集齐 10 片皮肤碎片解锁', palette: { body1: '#fff3c4', body2: '#e9b949', body3: '#9c6b1e', eye: '#2a1a06', pupil: '#120a02', blush: '#ff9d7a', rim: '#fffbe6', glow: 'rgba(240,200,90,.45)' } },
  { id: 'sweet7', effect: 'hearts', name: '甜蜜一周', nameEn: 'Sweet Week', free: false, badge: '在一起 7 天', milestoneDays: 7, desc: '情侣里程碑：在一起满 7 天解锁', palette: { body1: '#fff0f5', body2: '#ffb6cf', body3: '#e07a9e', eye: '#3a1022', pupil: '#1c0810', blush: '#ff7fa8', rim: '#ffffff', glow: 'rgba(255,170,200,.5)' } },
  { id: 'moon30', effect: 'star-glow', name: '满月之约', nameEn: 'Full Moon', free: false, badge: '在一起 30 天', milestoneDays: 30, desc: '情侣里程碑：在一起满 30 天解锁', palette: { body1: '#f3f1ff', body2: '#c7c2ff', body3: '#7b74d6', eye: '#18153a', pupil: '#0a0818', blush: '#ffb3d1', rim: '#ffffff', glow: 'rgba(190,180,255,.5)' } },
  { id: 'blossom100', effect: 'petals', name: '百日花开', nameEn: 'Blossom 100', free: false, badge: '在一起 100 天', milestoneDays: 100, desc: '情侣里程碑：在一起满 100 天解锁', palette: { body1: '#fff4f7', body2: '#ffc6d8', body3: '#e88aa8', eye: '#33101e', pupil: '#18060e', blush: '#ff9ab8', rim: '#ffffff', glow: 'rgba(255,190,210,.5)' } },
  { id: 'forever365', effect: 'sparks', name: '一周年·永恒', nameEn: 'Forever', free: false, badge: '在一起 365 天', milestoneDays: 365, desc: '情侣里程碑：在一起满一周年解锁', palette: { body1: '#fffbe8', body2: '#ffe08a', body3: '#c99a2e', eye: '#2a1e04', pupil: '#120c02', blush: '#ffb08a', rim: '#ffffff', glow: 'rgba(255,220,120,.55)' } },
);

const PRICING = require('./pricing');
const SKU_OF_ITEM = { base: 'base', ai_month: 'month', ai_year: 'year', dlc_custom_char: 'custom' }; // couple_year 已停售：按旧 CNY 价近似展示
/** 区域分级定价展示：locale 如 'en-US' / 'de-DE' / 'zh-CN'，未知地区回落 USD（Tier 1） */
function localizedPrice(item, locale) {
  if (!item) return '';
  const sku = SKU_OF_ITEM[item.id] || (item.kind === 'skin_pack' || item.skinIds || /^dlc_/.test(item.id) ? 'skinpack' : null);
  const p = sku ? PRICING.skuPrice(sku, locale || 'zh-CN') : PRICING.displayCny(item.price, locale || 'zh-CN');
  return p.text;
}

for (const skin of SKINS) Object.assign(skin, SKIN_EXTRAS[skin.id] || {});

const EXPR = require('./expressions');

const CATALOG = {
  COUPLE_SCENES,
  PRODUCT,
  FEATURES,
  PLANS,
  FREE_TIER,
  DLC,
  SKINS,
  DARK_VARIANT,
  PRO_BENEFITS,
  planById,
  dlcById,
  skinById,
  skinRequiresPro,
  freeSkins,
  planDurationDays,
  formatPrice,
  localizedPrice,
  PRICING,
};

CATALOG.EXPRESSIONS = EXPR.EXPRESSIONS;
CATALOG.EXPRESSION_PARTS = EXPR.PARTS;
CATALOG.EVENT_EXPRESSIONS = EXPR.EVENT_EXPRESSIONS;
CATALOG.SKIN_EXTRAS = SKIN_EXTRAS;

module.exports = CATALOG;
