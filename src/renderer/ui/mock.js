/**
 * 方块仔 — 面板演示数据（浏览器预览专用）
 *
 * 只有在主进程不存在（window.cubbit 缺失）时才安装 window.__cubbitMock，
 * 让 store / settings / onboarding 三个页面可以直接用浏览器打开预览与走查视觉。
 * 真实 Electron 运行时 window.cubbit 一定存在，此处整段不会生效。
 *
 * 预览变体（控制状态，便于走查各形态）：
 *   store/index.html?mock=trial      体验中（默认）
 *   store/index.html?mock=pro        已购 Pro
 *   store/index.html?mock=expired    体验已结束
 *   store/index.html?mock=offline    许可服务离线
 *
 * 演示数据与 app/src/shared/catalog.js 保持一致；不参与任何真实交易。
 */
(function () {
  'use strict';

  if (window.cubbit && window.cubbit.panel) return; // 真实运行时：直接退出
  if (window.__cubbitMock) return;

  // ------------------------------------------------------------- 演示商品目录
  const PLANS = [
    {
      id: 'pro_month',
      name: '月度会员',
      nameEn: 'Monthly',
      price: 800,
      period: 'month',
      durationDays: 30,
      badge: null,
      desc: '先试一个月，随时取消',
      perks: ['全部 Pro 功能', '全部高级皮肤', '持续更新'],
      highlight: false,
    },
    {
      id: 'pro_year',
      name: '年度会员',
      nameEn: 'Yearly',
      price: 4800,
      period: 'year',
      durationDays: 365,
      badge: '最受欢迎',
      desc: '相当于每月 ¥4，省 50%',
      perks: ['全部 Pro 功能', '全部高级皮肤', '持续更新'],
      highlight: true,
    },
    {
      id: 'pro_lifetime',
      name: '永久买断',
      nameEn: 'Lifetime',
      price: 9800,
      period: 'once',
      durationDays: 0,
      badge: '一次买断',
      desc: '一次付费，终身使用，含未来全部皮肤',
      perks: ['全部 Pro 功能', '全部高级皮肤 + 未来新皮肤', '终身免费更新', '优先支持'],
      highlight: false,
    },
    {
      id: 'couple_year',
      name: '情侣双人版',
      nameEn: 'Couple',
      price: 6800,
      period: 'year',
      durationDays: 365,
      badge: '双人优惠',
      desc: '两个 Pro 账号 + 情侣模式：配对、聊天、结婚、纪念日',
      perks: ['2 个 Pro 账号（2 台 PC）', '情侣配对 / 聊天 / 结婚', '共享恋爱纪念日与情话'],
      highlight: false,
      seats: 2,
    },
  ];

  const SKINS = [
    { id: 'citrus', name: '蜜橘', nameEn: 'Citrus', free: true, desc: '出厂自带的小橘子方块', palette: { body1: '#ffd9bf', body2: '#ef7a52', body3: '#c9482a', eye: '#2b1a14', pupil: '#140c08', blush: '#ff8d78', rim: '#ffe6d4', glow: 'rgba(255,150,110,.45)' } },
    { id: 'mint', name: '薄荷', nameEn: 'Mint', free: true, desc: '清爽的薄荷奶油，适合白天', palette: { body1: '#e8fff6', body2: '#7fd9bb', body3: '#3f9e83', eye: '#123028', pupil: '#081a15', blush: '#ffb3c2', rim: '#f4fffb', glow: 'rgba(120,230,200,.45)' } },
    { id: 'nightowl', name: '夜光', nameEn: 'Night Owl', free: false, desc: '深夜里眼睛会发光的暗夜方块', palette: { body1: '#5a5aa0', body2: '#2a2a55', body3: '#14142c', eye: '#9ff2ff', pupil: '#e6feff', blush: '#7c5cff', rim: '#c9c9ff', glow: 'rgba(120,200,255,.75)' } },
    { id: 'sakura', name: '樱花', nameEn: 'Sakura', free: false, desc: '春日限定的粉樱渐变', palette: { body1: '#ffe1ec', body2: '#f497b6', body3: '#c85f83', eye: '#3a1622', pupil: '#1c0a10', blush: '#ff6f9c', rim: '#fff2f7', glow: 'rgba(255,140,180,.5)' } },
    { id: 'aurora', name: '极光', nameEn: 'Aurora', free: false, desc: '青紫流动的极光质感', palette: { body1: '#c8f8ff', body2: '#5b8cff', body3: '#4356c9', eye: '#0b1233', pupil: '#050914', blush: '#a37bff', rim: '#e8f6ff', glow: 'rgba(120,180,255,.6)' } },
    { id: 'chrome', name: '金属', nameEn: 'Chrome', free: false, desc: '冷静的枪灰金属，商务桌面友好', palette: { body1: '#f2f4f8', body2: '#9aa3b2', body3: '#4d5666', eye: '#0b0e14', pupil: '#05070a', blush: '#8d99b0', rim: '#ffffff', glow: 'rgba(200,220,255,.4)' } },
    { id: 'pumpkin', name: '南瓜', nameEn: 'Pumpkin', free: false, desc: '万圣节限定，眼睛会冒小火星', palette: { body1: '#ffd08a', body2: '#f09030', body3: '#b85a10', eye: '#2a1200', pupil: '#150800', blush: '#ff7a35', rim: '#ffe9c8', glow: 'rgba(255,150,60,.6)' } },
    { id: 'cloud', name: '云朵', nameEn: 'Cloud', free: false, desc: '软乎乎的奶油云，治愈系', palette: { body1: '#ffffff', body2: '#cfe3ff', body3: '#94b6ea', eye: '#1b2a44', pupil: '#0b1424', blush: '#ffc2cf', rim: '#ffffff', glow: 'rgba(180,220,255,.5)' } },
  ];

  // ==========================================================================
  // 四层定价（catalog 1.4.0 契约的演示副本；价格逻辑与 lead 的 catalog 一致）
  // ==========================================================================
  const FREE_TIER = {
    id: 'free',
    name: '免费版',
    price: 0,
    aiRoundsPerDay: 10,
    skins: ['citrus', 'mint'],
    features: ['cinema_mode', 'presence_reactions'],
    watermark: true,
      perks: ['每天 10 轮 AI 对话', '2 套免费皮肤（蜜橘 / 薄荷）', '观影模式 · 状态感知', '右下角体验水印'],
  };

  const PLANS_TIERS = [
    {
      id: 'base',
      name: '完整版',
      nameEn: 'Complete',
      price: 3800,
      period: 'once',
      durationDays: 0,
      badge: '一次买断',
      desc: '一次付费，永久使用；不含无限 AI',
      perks: ['全部基础皮肤', '情侣模式 · 生命系统', '每天 50 轮 AI 对话', '去掉水印 · 永久更新'],
      highlight: true,
      grants: { baseOwned: true },
    },
    {
      id: 'ai_month',
      name: 'AI 陪伴 · 月付',
      nameEn: 'AI Monthly',
      price: 1500,
      period: 'month',
      durationDays: 30,
      badge: null,
      desc: '含完整版，AI 无限聊，随时可停',
      perks: ['包含完整版全部权益', 'AI 对话无每日轮数限制', 'AI 对话记忆（本机）', '优先模型路由'],
      highlight: false,
      grants: { baseOwned: true, aiUnlimited: true },
    },
    {
      id: 'ai_year',
      name: 'AI 陪伴 · 年付',
      nameEn: 'AI Yearly',
      price: 9800,
      period: 'year',
      durationDays: 365,
      badge: '省 46%',
      desc: '含完整版，折合每月 ¥8.2',
      perks: ['包含完整版全部权益', 'AI 无限对话 + 对话记忆（本机）', '新模型优先体验', '优先支持'],
      highlight: false,
      grants: { baseOwned: true, aiUnlimited: true },
    },
    {
      id: 'couple_year',
      name: '情侣双人版',
      nameEn: 'Couple',
      price: 6800,
      period: 'year',
      durationDays: 365,
      badge: '双人优惠',
      desc: '2 个完整版席位的年付方案',
      perks: ['包含完整版全部权益', '2 个席位（2 台 PC）', '情侣模式 · 共享纪念日', '每席位每天 50 轮 AI'],
      highlight: false,
      seats: 2,
      grants: { baseOwned: true, seats: 2 },
    },
  ];

  const DLC_LIST = [
    {
      id: 'dlc_aurora',
      name: '极光角色包',
      skinId: 'aurora',
      price: 2800,
      period: 'once',
      durationDays: 0,
      desc: '青紫流动的极光质感，会随光晕缓慢流动',
      requiresBase: true,
      perks: ['极光皮肤（含夜间变体）', '专属光晕与粒子', '永久有效'],
    },
    {
      id: 'dlc_pumpkin',
      name: '南瓜角色包',
      skinId: 'pumpkin',
      price: 3800,
      period: 'once',
      durationDays: 0,
      desc: '万圣节限定，眼睛会冒小火星',
      requiresBase: true,
      perks: ['南瓜皮肤（含夜间变体）', '眼睛火星特效', '永久有效'],
    },
  ];

  const DLC_BY_SKIN = { aurora: 'dlc_aurora', pumpkin: 'dlc_pumpkin' };

  /** 四层授权预设（?tier=free|base|ai|couple） */
  function tierPreset(tier) {
    const nowSec = Math.floor(now / 1000);
    const base = {
      state: 'free',
      planId: '',
      planName: '免费版',
      planExpiry: null,
      baseOwned: false,
      addons: [],
      seats: 0,
      aiUnlimited: false,
      aiRoundLimit: FREE_TIER.aiRoundsPerDay,
      trialDaysLeft: 7,
    };
    if (tier === 'base') {
      return Object.assign(base, {
        state: 'base',
        planId: 'base',
        planName: '完整版',
        baseOwned: true,
        aiRoundLimit: 50,
      });
    }
    if (tier === 'ai') {
      return Object.assign(base, {
        state: 'ai',
        planId: 'ai_year',
        planName: 'AI 陪伴 · 年付',
        planExpiry: nowSec + 300 * 86400,
        baseOwned: true,
        aiUnlimited: true,
        aiRoundLimit: null,
      });
    }
    if (tier === 'couple') {
      return Object.assign(base, {
        state: 'couple',
        planId: 'couple_year',
        planName: '情侣双人版',
        planExpiry: nowSec + 200 * 86400,
        baseOwned: true,
        seats: 2,
        aiRoundLimit: 50,
      });
    }
    return base;
  }

  function tierFeatures(preset) {
    const ownsBase = !!preset.baseOwned;
    return {
      skins_premium: ownsBase,
      growth: ownsBase,
      focus_custom: ownsBase,
      focus_stats: ownsBase,
      multi_pet: ownsBase,
      custom_colors: ownsBase,
      reminders: ownsBase,
      no_watermark: ownsBase,
      couple_mode: ownsBase,
      life_system: ownsBase,
      ai_chat: true,
      ai_unlimited: !!preset.aiUnlimited,
      cinema_mode: true,
      presence_reactions: true,
      };
  }
  const FEATURES = {
    skins_premium: { pro: true, name: '高级皮肤', desc: '20 套手工调色皮肤，含季节限定' },
    focus_custom: { pro: true, name: '自定义专注', desc: '任意时长、任意标签，多段循环' },
    focus_stats: { pro: true, name: '专注统计', desc: '每日/每周专注时长与心情日历' },
    growth: { pro: true, name: '成长系统', desc: '亲密度、等级、成就徽章' },
    multi_pet: { pro: true, name: '多宠物同屏', desc: '最多 3 只方块仔一起陪你' },
    custom_colors: { pro: true, name: '自定义配色', desc: '自己调配方块的主色、光泽与眼睛' },
    reminders: { pro: true, name: '桌面提醒', desc: '让方块仔替你记住喝水、起身、开会' },
    no_watermark: { pro: true, name: '去除体验版角标', desc: '体验期内窗口右下角会显示体验标' },
    couple_mode: { pro: true, name: '情侣模式', desc: '两只方块仔配对、说情话、聊天并举行婚礼' },
    cinema_mode: { pro: false, name: '观影模式', desc: '看剧时只留一双发光的眼睛，不打扰你' },
    presence_reactions: { pro: false, name: '主人状态感知', desc: '根据你在工作/看剧/开会/离开自动做出反应' },
    life_system: { pro: true, name: '智慧生命', desc: '心情、精力、性格、记忆：它会主动想你、记得你' },
  };

  const PRO_BENEFITS = [
    { icon: 'palette', title: '20 套皮肤', desc: '蜜橘、薄荷免费；夜光、樱花、极光、金属、南瓜、云朵解锁' },
    { icon: 'timer', title: '专注模式', desc: '宠物陪你番茄钟，完成有庆祝动画与统计' },
    { icon: 'sparkle', title: '成长系统', desc: '亲密度、等级、成就，越养越粘人' },
    { icon: 'users', title: '多宠物', desc: '最多 3 只方块仔同屏玩耍' },
    { icon: 'sliders', title: '自定义配色', desc: '主色 / 眼睛 / 光晕自由调' },
    { icon: 'heart', title: '情侣模式', desc: '两台 PC 配对：说情话、聊天、举行婚礼、共享纪念日' },
    { icon: 'sparkle', title: '智慧生命', desc: '心情、精力、性格与记忆，它会主动想你、记得你说过的话' },
    { icon: 'bell', title: '桌面提醒', desc: '喝水、起身、开会，让方块仔来提醒你' },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_pet', name: '初次见面', desc: '第一次摸摸方块仔', icon: '👋' },
    { id: 'level3', name: '小伙伴', desc: '等级达到 3 级', icon: '🌱' },
    { id: 'level5', name: '形影不离', desc: '等级达到 5 级', icon: '💛' },
    { id: 'focus3', name: '专注新手', desc: '累计完成 3 次专注', icon: '🍅' },
    { id: 'focus25', name: '心流大师', desc: '累计完成 25 次专注', icon: '🧘' },
    { id: 'feed7', name: '投喂达人', desc: '累计投喂 7 次', icon: '🍬' },
    { id: 'nightowl', name: '夜猫子', desc: '凌晨 0 点后它还醒着', icon: '🌙' },
    { id: 'streak3', name: '三日不弃', desc: '连续 3 天来看它', icon: '🔥' },
    { id: 'collector', name: '皮肤收藏家', desc: '解锁 5 套皮肤', icon: '🎨' },
  ];

  const DEFAULTS = {
    schemaVersion: 1,
    skinId: 'citrus',
    sizeScale: 1,
    alwaysOnTop: true,
    autoStart: false,
    soundEnabled: false,
    followSystemTheme: true,
    nightMode: { enabled: true, start: '22:00', end: '07:00' },
    bubbleOnLaunch: true,
    customColors: null,
    petPosition: null,
    language: 'zh-CN',
    apiBase: '',
    multiPetCount: 1,
    onboardingDone: false,
    hotkeys: { toggle: 'Control+Shift+H', focus: 'Control+Shift+F' },
    reduceMotion: false,
    focus: { lastMinutes: 25, lastLabel: '' },
    showFps: false,
    voiceEnabled: true,
    voiceVolume: 0.7,
    voiceRate: 1.05,
    presenceReactions: true,
    cinemaAuto: true,
    cinemaManual: false,
    coupleNotify: true,
    coupleProfile: { petName: '', loveNote: '' },
    // AI 陪伴（第四期）
    aiEnabled: true,
    aiProvider: 'ollama',
    aiBaseUrl: 'http://127.0.0.1:11434',
    aiModel: 'qwen2.5:3b',
    aiApiKey: '',
    aiPersonality: 'warm',
    aiRemember: true,
    aiMaxTurns: 10,
    // 第六期：游戏全屏自动隐藏 / 数据与备份
    gameAutoHide: true,
    gameWhitelist: [],
    backupAutoSync: true,
  };

  const FREE_MINUTES = 25;
  const FEED_COOLDOWN_MS = 4 * 3600 * 1000;

  // ------------------------------------------------------------------ 演示状态
  const params = new URLSearchParams(location.search);
  const variant = (params.get('mock') || 'trial').toLowerCase();
  const quiet = params.get('quiet') === '1';
  const now = Date.now();

  const mockState = {
    settings: JSON.parse(JSON.stringify(DEFAULTS)),
    license: {
      state: 'trial',
      planId: '',
      planName: '体验版',
      expiresAt: 0,
      trialEndsAt: Math.floor(now / 1000) + 5 * 86400,
      trialDaysLeft: 5,
      features: {},
      deviceId: 'a7f3c9d21b8e4f60a2c5e9d7b3f81426',
      name: '',
      email: '',
      offline: false,
      apiBase: 'http://127.0.0.1:8787',
    },
    focus: {
      running: false,
      paused: false,
      minutes: 25,
      label: '',
      endsAt: 0,
      remainingMs: 0,
      startedAt: 0,
      today: { sessions: 2, minutes: 50 },
      history: [],
      totalSessions: 14,
      totalMinutes: 372,
    },
    growth: {
      level: 4,
      exp: 268,
      expInLevel: 38,
      expToNext: 140,
      affinity: 68,
      streak: 6,
      visits: 24,
      feeds: 9,
      lastFeedAt: now - 5 * 3600 * 1000,
      canFeed: true,
      nextFeedInMs: 0,
      achievements: [],
    },
    serverOnline: variant !== 'offline',
    order: null,
    orderPolls: 0,
    stateHandlers: new Set(),
    navHandlers: new Set(),
    _tick: null,
  };

  // 最近 7 天专注数据（体验版也有基础统计，Pro 才有完整图表）
  const historyMinutes = [25, 50, 0, 75, 25, 100, 50];
  mockState.focus.history = historyMinutes.map((minutes, i) => {
    const d = new Date(now - (6 - i) * 86400000);
    return {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      sessions: Math.round(minutes / 25),
      minutes,
    };
  });

  const unlockedSet = new Set(['first_pet', 'level3', 'focus3', 'feed7', 'nightowl']);
  mockState.growth.achievements = ACHIEVEMENTS.map((a) => ({
    ...a,
    unlocked: unlockedSet.has(a.id),
    unlockedAt: unlockedSet.has(a.id) ? now - 86400000 * 2 : 0,
  }));

  function applyVariant() {
    const lic = mockState.license;
    if (variant === 'pro') {
      lic.state = 'pro';
      lic.planId = 'pro_year';
      lic.planName = '年度会员';
      lic.expiresAt = Math.floor(now / 1000) + 300 * 86400;
      lic.trialDaysLeft = 0;
    } else if (variant === 'expired') {
      lic.state = 'expired';
      lic.planName = '体验已结束';
      lic.trialDaysLeft = 0;
      lic.trialEndsAt = Math.floor(now / 1000) - 86400;
    } else {
      lic.state = 'trial';
      lic.planName = '体验版';
      lic.trialDaysLeft = 7;
      lic.trialEndsAt = Math.floor(now / 1000) + 7 * 86400;
    }
  }
  applyVariant();

  /** 与主进程 rt.entitled() 一致：Pro 与体验期都解锁全部功能，到期后回落免费版 */
  const isEntitled = () => mockState.license.state === 'pro' || (mockState.license.state === 'trial' && (mockState.license.trialDaysLeft || 0) > 0);
  // ---------------------------------------------------- 状态感知 / 情侣演示态
  const coupleVariant = (params.get('couple') || 'unpaired').toLowerCase();
  const PARTNER = { name: '小柚', skinId: 'sakura', online: true, lastSeenAt: now - 60_000, presence: { kind: 'watching', title: '看《海街日记》' } };

  function baseCouple() {
    return {
      enabled: false,
      pairId: '',
      partner: null,
      married: false,
      marriedAt: 0,
      affection: 0,
      unread: 0,
      pendingProposal: false,
      proposalFrom: null,
      dailyLove: { sent: false, text: '', at: 0 },
      anniversaryDays: 0,
      messages: [],
      serverOnline: mockState.serverOnline,
      error: '',
    };
  }

  // ---------------------------------------------------- 智慧生命（第三期）
  mockState.life = {
    enabled: true,
    locked: false,
    // 与 app/src/main/life.js snapshot() 同构
    mood: 'happy',
    moodLabel: '开心',
    moodIcon: '😊',
    energy: 72,
    hunger: 62,
    spirit: 84,
    traits: [
      { id: 'clingy', name: '黏人', desc: '喜欢待在你旁边' },
      { id: 'curious', name: '好奇', desc: '对屏幕上的东西感兴趣' },
      { id: 'sleepyhead', name: '爱睡觉', desc: '一闲下来就打盹' },
    ],
    daysTogether: 128,
    thoughtPool: [
      '你终于回来了',
      '刚刚好像听到你叹气了',
      '我把桌面收拾干净了，等你回来',
      '要不要站起来走走？我陪你',
      '今天也一起加油吧',
      '夜深了，早点睡呀',
    ],
    thoughts: ['你终于回来了'],
    events: [
      { at: now - 2 * 3600 * 1000, type: 'feed', text: '你喂了它一块小饼干' },
      { at: now - 3 * 86400000, type: 'focus', text: '一起完成 25 分钟专注' },
      { at: now - 6 * 86400000, type: 'pet', text: '第一次摸头，它记住了这个动作' },
      { at: now - 30 * 86400000, type: 'pair', text: '和 TA 的方块仔配对了' },
    ],
    partnerMissing: 12,
    focusDoneAt: 0,
    lastInteractionAt: now - 3600 * 1000,
  };

  // ---------------------------------------------------- AI 陪伴（第四期）
  const aiVariant = (params.get('ai') || 'ready').toLowerCase();
  function demoAiMessages() {
    const base = now - 8 * 60 * 1000;
    return [
      { role: 'assistant', text: '我在呢。今天过得怎么样？', at: base },
      { role: 'user', text: '今天累死了，连开三个会', at: base + 60 * 1000 },
      { role: 'assistant', text: '听起来真的很消耗。要不要先把肩膀放松一下？我可以安静陪你一会儿。', at: base + 75 * 1000 },
      { role: 'user', text: '好啊，那你说点轻松的', at: base + 120 * 1000 },
      { role: 'assistant', text: '那我讲个冷笑话：为什么方块仔从不迟到？因为它每天都「方」得刚刚好。…不好笑也没关系，你笑一下我就值了。', at: base + 140 * 1000 },
    ];
  }

  mockState.ai = {
    enabled: aiVariant !== 'unconfigured',
    provider: 'ollama',
    model: 'qwen2.5:3b',
    ready: aiVariant === 'ready' || aiVariant === 'pro',
    pro: aiVariant !== 'locked',
    chatting: false,
    lastError: '',
    personality: 'warm',
    messages: aiVariant === 'locked' ? [] : demoAiMessages(),
  };
  if (aiVariant === 'unconfigured') {
    mockState.ai.provider = '';
    mockState.ai.model = '';
    mockState.ai.messages = [];
  }
  if (aiVariant === 'openai') {
    mockState.ai.provider = 'openai';
    mockState.ai.model = 'gpt-4o-mini';
    mockState.ai.ready = true;
  }

  function aiSnapshot() {
    return JSON.parse(JSON.stringify(mockState.ai));
  }

  function aiReplyTo(text) {
    const t = String(text || '');
    const personality = mockState.settings.aiPersonality || 'warm';
    if (/累|疲惫|加班|开会|难受|烦/.test(t)) {
      return personality === 'sassy'
        ? '又累了？行吧，允许你摆烂十分钟，我数着时间。'
        : '听起来真的很消耗。先把肩膀放松一下，我在这儿陪你，什么都不用说。';
    }
    if (/夸|厉害|棒|表扬/.test(t)) {
      return personality === 'quiet'
        ? '嗯，你很好。真的。'
        : '今天能撑到现在就已经很厉害了。别人可能看不出来，但我一直看着你。';
    }
    if (/笑话|冷笑话|逗|搞笑/.test(t)) {
      return '为什么方块仔不会被 AI 取代？因为它会「方」法摸鱼。……不好笑的话，我换一个：为什么我总在屏幕右下角？因为那里离你的手最近。';
    }
    if (/晚安|睡了|困/.test(t)) {
      return '晚安。屏幕调暗一点，明天我还在这个位置等你。';
    }
    if (/你好|在吗|嗨|hi|hello/i.test(t)) {
      return '在的。刚刚在看你桌面上的光，现在看你。';
    }
    const warm = [
      '我听着呢，慢慢说。',
      '这件事我记住了。你继续说，我在。',
      '嗯…我在想，如果是我遇到这件事，大概也会有点难受。',
      '要不要先喝口水？然后我们再接着聊。',
    ];
    return warm[Math.floor(Math.random() * warm.length)];
  }

  mockState.couple = baseCouple();
  mockState.presence = {
    kind: 'working',
    app: 'Visual Studio Code',
    title: '在写一个桌面小方块',
    fullscreen: false,
    cinemaMode: false,
  };

  function seedMessages() {
    const t0 = now - 3 * 3600 * 1000;
    return [
      { id: 'm1', from: 'partner', text: '今天也一起加油呀～', kind: 'text', at: t0 },
      { id: 'm2', from: 'me', text: '嗯！刚写完一段代码，正在摸鱼看它蹦跶', kind: 'text', at: t0 + 60_000 },
      { id: 'm3', from: 'partner', text: '抱抱', kind: 'emoji', at: t0 + 120_000 },
      { id: 'm4', from: 'me', text: '晚上一起看那部电影？', kind: 'text', at: now - 40 * 60_000 },
      { id: 'm5', from: 'partner', text: '好呀，我买爆米花 🍿', kind: 'text', at: now - 32 * 60_000 },
      { id: 'm6', from: 'me', text: '辛苦了，早点休息', kind: 'text', at: now - 12 * 60_000 },
    ];
  }

  function applyCoupleVariant() {
    const c = mockState.couple;
    c.serverOnline = mockState.serverOnline;
    if (coupleVariant === 'offline') {
      c.serverOnline = false;
      c.error = '情侣服务暂不可用，请检查网络后重试';
      return;
    }
    if (coupleVariant === 'unpaired') return;
    // paired / married / married 使用同一份伴侣数据
    c.enabled = true;
    c.pairId = 'pair_demo_8f21c4';
    c.partner = JSON.parse(JSON.stringify(PARTNER));
    c.affection = coupleVariant === 'married' ? 862 : 384;
    c.anniversaryDays = coupleVariant === 'married' ? 128 : 0;
    c.messages = seedMessages();
    c.dailyLove = { sent: coupleVariant === 'married', text: '今天也要开开心心的', at: now - 2 * 3600 * 1000 };
    c.unread = 2;
    if (coupleVariant === 'married') {
      c.married = true;
      c.marriedAt = Math.floor((now - 128 * 86400 * 1000) / 1000);
      c.pendingProposal = false;
      c.messages.push(
        { id: 'm7', from: 'me', text: '纪念日快乐，第 128 天 💗', kind: 'text', at: now - 6 * 60_000 },
        { id: 'm8', from: 'partner', text: '还有好多天要一起走～', kind: 'text', at: now - 4 * 60_000 },
      );
    }
  }
  applyCoupleVariant();

  // ---------------------------------------------------- 四层定价模式（?tier=）
  const tierParam = (params.get('tier') || '').toLowerCase();
  const useTier = ['free', 'base', 'ai', 'couple'].indexOf(tierParam) >= 0;
  mockState.tier = useTier ? tierParam : '';
  mockState.tierPreset = useTier ? tierPreset(tierParam) : null;

  function tierLicense() {
    const preset = mockState.tierPreset;
    if (!preset) return mockState.license;
    const lic = mockState.license;
    return Object.assign({}, lic, {
      state: preset.state,
      planId: preset.planId,
      planName: preset.planName,
      planExpiry: preset.planExpiry,
      baseOwned: preset.baseOwned,
      addons: preset.addons.slice(),
      seats: preset.seats,
      aiUnlimited: preset.aiUnlimited,
      features: tierFeatures(preset),
      // 兼容旧徽标/到期字段
      expiresAt: preset.planExpiry || 0,
      trialDaysLeft: preset.state === 'free' ? 0 : 0,
      trialEndsAt: 0,
    });
  }

  function tierSkins() {
    const preset = mockState.tierPreset;
    const feats = tierFeatures(preset);
    return SKINS.map((skin) => {
      const dlcId = DLC_BY_SKIN[skin.id];
      const unlocked = skin.free
        ? true
        : dlcId
          ? !!(preset.baseOwned && preset.addons.indexOf(dlcId) >= 0)
          : !!feats.skins_premium;
      return Object.assign({}, skin, { locked: !unlocked, dlcId: dlcId || null });
    });
  }

  function tierAi() {
    const preset = mockState.tierPreset;
    const ai = mockState.ai;
    return Object.assign({}, ai, {
      enabled: true,
      provider: 'ollama',
      model: 'qwen2.5:3b',
      ready: true,
      pro: !!preset.baseOwned,
      roundsPerDay: preset.aiRoundLimit,
      roundsLeft: preset.aiRoundLimit == null ? null : Math.max(0, preset.aiRoundLimit - 3),
      unlimited: !!preset.aiUnlimited,
    });
  }
  const isPro = isEntitled;

  function palette() {
    const skin = SKINS.find((s) => s.id === mockState.settings.skinId) || SKINS[0];
    return { ...skin.palette, dark: false };
  }

  function snapshot() {
    const lic = mockState.license;
    const pro = isPro();
    return {
      time: Date.now(),
      product: {
        name: 'Cubbit',
        zhName: '方块仔',
        version: '1.0.0',
        tagline: '一只住在你桌面上的小方块',
        trialDays: 7,
        supportEmail: 'support@cubbit.app',
        website: 'https://cubbit.app',
      },
      settings: JSON.parse(JSON.stringify(mockState.settings)),
      theme: {
        dark: true,
        nightNow: false,
        followSystemTheme: mockState.settings.followSystemTheme !== false,
        effectiveDark: true,
        accent: '#ef7a52',
        time: Date.now(),
        clock: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
      },
      license: useTier ? tierLicense() : { ...lic, features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, pro])) },
      plans: useTier ? PLANS_TIERS : PLANS,
      dlc: DLC_LIST,
      freeTier: FREE_TIER,
      focus: JSON.parse(JSON.stringify(mockState.focus)),
      growth: JSON.parse(JSON.stringify(mockState.growth)),
      skins: useTier ? tierSkins() : SKINS.map((skin) => ({ ...skin, locked: !skin.free && !pro })),
      proBenefits: PRO_BENEFITS,
      features: FEATURES,
      ui: {
        isPro: useTier ? !!mockState.tierPreset.baseOwned : pro,
        tier: useTier ? mockState.tier : '',
        isTrial: lic.state === 'trial',
        trialDaysLeft: lic.trialDaysLeft || 0,
        showTrialBadge: lic.state === 'trial',
        petVisible: true,
        apiBase: mockState.settings.apiBase || 'http://127.0.0.1:8787',
        cinemaMode: !!mockState.presence.cinemaMode,
      },
      life: JSON.parse(JSON.stringify(mockState.life)),
      ai: useTier ? tierAi() : aiSnapshot(),
      couple: Object.assign({}, JSON.parse(JSON.stringify(mockState.couple)), {
        apiBase: 'https://cubbit.app',
        invite: mockState.couple.inviteCode
          ? { code: mockState.couple.inviteCode, expiresAt: mockState.couple.inviteExpiresAt }
          : null,
      }),
      partnerPalette: {
        body1: '#f9d7e6',
        body2: '#f497b6',
        body3: '#b76689',
        eye: '#3a1622',
        pupil: '#1c0a10',
        blush: '#ff6f9c',
        glow: 'rgba(255,140,180,.5)',
      },
      coupleScenes: [
        { id: 'coffee', name: '咖啡约会', desc: '两杯热咖啡，慢慢聊', emoji: '☕', accent: '#ef7a52' },
        { id: 'movie', name: '深夜电影', desc: '灯关小一点，一起看', emoji: '🎬', accent: '#7fb2ff' },
        { id: 'stars', name: '阳台看星星', desc: '风有点凉，但肩并肩', emoji: '🌟', accent: '#ffd166' },
        { id: 'cooking', name: '一起做饭', desc: '你切菜，我递调料', emoji: '🍳', accent: '#ffb347' },
        { id: 'rain', name: '雨天窗边', desc: '听雨，谁都不必说话', emoji: '🌧️', accent: '#9fc3e8' },
        { id: 'bedtime', name: '晚安故事', desc: '关灯之后的那十分钟', emoji: '🌙', accent: '#b9a8ff' },
      ],
      coupleScene: { id: 'coffee', light: 'light', updatedAt: now - 60000 },
      presence: JSON.parse(JSON.stringify(mockState.presence)),
      palette: palette(),
      lines: ['早上好呀～', '今天也一起加油！'],
      server: { online: mockState.serverOnline, base: mockState.settings.apiBase || 'http://127.0.0.1:8787', error: mockState.serverOnline ? null : '演示：许可服务未启动' },
    };
  }

  let broadcastTimer = null;
  function broadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const state = snapshot();
      for (const cb of mockState.stateHandlers) {
        try {
          cb(state);
        } catch (err) {
          console.error('[mock.onState]', err);
        }
      }
    }, 40);
  }

  // ------------------------------------------------------------------ 设置写入
  function applySettings(patch = {}) {
    const clean = { ...patch };
    if (clean.skinId !== undefined) {
      const skin = SKINS.find((s) => s.id === clean.skinId);
      if (!skin) delete clean.skinId;
      else if (!skin.free && !isPro()) {
        return { ok: false, code: 'FEATURE_LOCKED', feature: 'skins_premium', message: `「${skin.name}」是 Pro 皮肤` };
      }
    }
    if (clean.customColors && !isPro()) {
      return { ok: false, code: 'FEATURE_LOCKED', feature: 'custom_colors', message: '自定义配色是 Pro 功能' };
    }
    if (clean.multiPetCount !== undefined) {
      const n = Math.max(1, Math.min(3, Number(clean.multiPetCount) || 1));
      if (n > 1 && !isPro()) return { ok: false, code: 'FEATURE_LOCKED', feature: 'multi_pet', message: '多宠物同屏是 Pro 功能' };
      clean.multiPetCount = n;
    }
    if (clean.sizeScale !== undefined) clean.sizeScale = Math.max(0.75, Math.min(1.4, Number(clean.sizeScale) || 1));
    if (clean.nightMode) {
      clean.nightMode = {
        enabled: clean.nightMode.enabled !== false,
        start: /^\d{1,2}:\d{2}$/.test(clean.nightMode.start) ? clean.nightMode.start : mockState.settings.nightMode.start,
        end: /^\d{1,2}:\d{2}$/.test(clean.nightMode.end) ? clean.nightMode.end : mockState.settings.nightMode.end,
      };
    }
    if (clean.hotkeys) {
      clean.hotkeys = {
        toggle: String(clean.hotkeys.toggle || 'Control+Shift+H').slice(0, 40),
        focus: String(clean.hotkeys.focus || 'Control+Shift+F').slice(0, 40),
      };
    }
    Object.assign(mockState.settings, clean);
    broadcast();
    return { ok: true, state: snapshot() };
  }

  // ------------------------------------------------------------------ 专注
  function focusSnapshot() {
    return JSON.parse(JSON.stringify(mockState.focus));
  }

  function startFocusInterval() {
    stopFocusInterval();
    mockState._tick = setInterval(() => {
      const f = mockState.focus;
      if (!f.running || f.paused) return;
      f.remainingMs = Math.max(0, f.endsAt - Date.now());
      if (f.remainingMs <= 0) {
        f.running = false;
        f.paused = false;
        f.today.minutes += f.minutes;
        f.today.sessions += 1;
        f.totalSessions += 1;
        f.totalMinutes += f.minutes;
        f.remainingMs = 0;
        stopFocusInterval();
      }
      broadcast();
    }, 1000);
  }

  function stopFocusInterval() {
    if (mockState._tick) clearInterval(mockState._tick);
    mockState._tick = null;
  }

  // ------------------------------------------------------------------ 订单
  function planPrice(planId) {
    const all = PLANS_TIERS.concat(DLC_LIST).concat(PLANS);
    const plan = all.find((p) => p.id === planId);
    return plan ? plan.price : 0;
  }

  function findPlan(planId) {
    return PLANS_TIERS.concat(DLC_LIST).concat(PLANS).find((p) => p.id === planId) || null;
  }

  const COUPONS = {
    CUBBIT50: { percent: 50, description: '五折优惠券' },
    FIRST20: { percent: 20, description: '首单立减 20%' },
    YEAR30: { percent: 30, description: '年度会员 7 折' },
  };

  function orderAmount(order) {
    const base = planPrice(order.planId);
    return order.discountCents ? Math.max(1, base - order.discountCents) : base;
  }

  function publicOrder(order) {
    const out = {
      id: order.id,
      planId: order.planId,
      amount: orderAmount(order),
      status: order.status,
      payUrl: order.payUrl,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
    };
    if (order.status === 'paid') {
      out.licenseKey = order.licenseKey;
      out.paidAt = order.paidAt;
    }
    return out;
  }

  // ---------------------------------------------------------- mock 事件总线
  const mockEventHandlers = new Map();

  function mockEmit(channel, payload) {
    const set = mockEventHandlers.get(channel);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (err) {
        console.error('[mock.emit]', channel, err);
      }
    }
  }

  function coupleTwin() {
    return JSON.parse(JSON.stringify(mockState.couple));
  }

  // ------------------------------------------------------------------ 假 IPC
  function fail(code, message, extra) {
    return { ok: false, code, message, ...(extra || {}) };
  }

  const handlers = {
    'app:state': async () => snapshot(),

    'app:settings:set': async (patch) => applySettings(patch),

    'app:settings:reset': async () => {
      mockState.settings = JSON.parse(JSON.stringify(DEFAULTS));
      broadcast();
      return { ok: true, state: snapshot() };
    },

    'app:quit': async () => ({ ok: true }),

    'app:open-external': async ({ url } = {}) => {
      if (!/^https?:\/\//i.test(String(url || ''))) return fail('BAD_URL', '链接地址无效');
      try {
        window.open(url, '_blank', 'noopener');
      } catch {
        /* 预览环境可能被拦截 */
      }
      return { ok: true };
    },

    'app:panel:open': async ({ name } = {}) => {
      const q = location.search || '';
      location.href = `../${name}/index.html${q}`;
      return { ok: true, name };
    },

    'app:panel:window': async () => ({ ok: true }),

    'pet:reset-position': async () => ({ ok: true }),

    'license:status': async () => ({ ok: true, license: snapshot().license }),

    'license:start-trial': async () => {
      mockState.license.state = 'trial';
      mockState.license.planName = '体验版';
      mockState.license.trialDaysLeft = 7;
      mockState.license.trialEndsAt = Math.floor(Date.now() / 1000) + 7 * 86400;
      broadcast();
      return { ok: true, license: snapshot().license };
    },

    'license:activate': async ({ key } = {}) => {
      const value = String(key || '').trim().toUpperCase();
      if (value.length < 8) return fail('BAD_REQUEST', '请输入有效的许可证密钥');
      if (!/^CUBB(-[A-Z0-9]{4}){3,4}$/.test(value)) {
        return fail('INVALID_KEY', '许可证密钥不存在或已失效（演示环境仅接受 CUBB-XXXX-… 格式）');
      }
      if (!useTier) {
        const lic = mockState.license;
        lic.state = 'pro';
        lic.planId = 'pro_year';
        lic.planName = '年度会员';
        lic.expiresAt = Math.floor(Date.now() / 1000) + 365 * 86400;
        lic.name = 'Cubbit 用户';
        broadcast();
        return { ok: true, license: snapshot().license };
      }
      const preset = mockState.tierPreset;
      const nowSec = Math.floor(Date.now() / 1000);
      let planKey = 'base';
      if (/AURORA|AUR/.test(value)) planKey = 'dlc_aurora';
      else if (/PUMPKIN|PUMP/.test(value)) planKey = 'dlc_pumpkin';
      else if (/AIYEAR|AI-Y|AIY/.test(value)) planKey = 'ai_year';
      else if (/AIMONTH|AI-M|AIM/.test(value)) planKey = 'ai_month';
      else if (/COUPLE|COUP/.test(value)) planKey = 'couple_year';

      if (planKey === 'dlc_aurora' || planKey === 'dlc_pumpkin') {
        if (!preset.baseOwned) return fail('BASE_REQUIRED', '角色包需要先拥有完整版');
        if (preset.addons.indexOf(planKey) < 0) preset.addons.push(planKey);
      } else if (planKey === 'base') {
        preset.baseOwned = true;
        preset.state = 'base';
        preset.planId = 'base';
        preset.planName = '完整版';
        preset.planExpiry = null;
        preset.aiRoundLimit = 50;
      } else if (planKey === 'ai_month' || planKey === 'ai_year') {
        const plan = findPlan(planKey);
        preset.baseOwned = true;
        preset.aiUnlimited = true;
        preset.aiRoundLimit = null;
        preset.state = 'ai';
        preset.planId = planKey;
        preset.planName = plan ? plan.name : 'AI 陪伴';
        preset.planExpiry = nowSec + (plan ? plan.durationDays : 365) * 86400;
      } else {
        preset.baseOwned = true;
        preset.state = 'couple';
        preset.planId = 'couple_year';
        preset.planName = '情侣双人版';
        preset.seats = 2;
        preset.aiRoundLimit = 50;
        preset.planExpiry = nowSec + 365 * 86400;
      }
      broadcast();
      return { ok: true, merged: true, planId: planKey, license: snapshot().license };
    },

    'license:restore': async () =>
      fail('NO_RECORD', '这台设备上没有找到可恢复的购买记录，请使用激活码或联系支持'),

    'license:deactivate': async () => {
      mockState.license.state = 'unlicensed';
      mockState.license.planName = '未激活';
      broadcast();
      return { ok: true };
    },

    // -------------------------------------------------- 数据与备份（第六期）
    'backup:info': async () => ({
      ok: true,
      scope: ['life', 'growth', 'focus', 'settings', 'coupleProfile', 'skins'],
      scopeNotes: '生命状态、成长与亲密度、专注记录、外观设置、情侣资料；不包含许可证密钥',
      lastExportAt: Date.now() - 26 * 3600 * 1000,
      lastExportPath: '',
      lastSyncAt: mockState.serverOnline ? Date.now() - 2 * 3600 * 1000 : 0,
      syncConfigured: false,
      syncAuto: mockState.settings.backupAutoSync !== false,
      cloudReady: false,
      serverOnline: mockState.serverOnline,
      deviceIdTail: 'f3e5c19d',
      sizeBytes: 18240,
    }),

    'backup:export': async ({ password } = {}) => {
      if (password != null && password !== '' && String(password).length < 6) {
        return fail('WEAK_PASSWORD', '密码至少 6 位，或者留空导出明文备份');
      }
      await new Promise((r) => setTimeout(r, 500));
      const encrypted = !!(password && String(password).length >= 6);
      return {
        ok: true,
        canceled: false,
        path: 'C:\\Users\\Cubbit\\Documents\\Cubbit-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        encrypted,
        bytes: 18240,
        scope: ['life', 'growth', 'focus', 'settings', 'coupleProfile'],
      };
    },

    'backup:import': async ({ password } = {}) => {
      await new Promise((r) => setTimeout(r, 600));
      if (password != null && password !== '' && String(password).length < 6) {
        return fail('WEAK_PASSWORD', '密码至少 6 位');
      }
      if (mockState.__importFail) {
        mockState.__importFail = false;
        return fail('BAD_BACKUP', '备份文件已损坏，或者密码不正确');
      }
      broadcast();
      return {
        ok: true,
        canceled: false,
        path: 'C:\\Users\\Cubbit\\Documents\\Cubbit-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        restored: { life: true, growth: true, focus: 46, settings: true, coupleProfile: true },
      };
    },

    'backup:sync:push': async ({ password } = {}) => {
      if (password != null && password !== '' && String(password).length < 6) {
        return fail('WEAK_PASSWORD', '同步密码至少 6 位');
      }
      return fail('SYNC_NOT_READY', '云同步服务即将开放：本轮先支持本地导出/导入，服务端接口就绪后即可使用');
    },

    'backup:sync:pull': async () => fail('SYNC_NOT_READY', '云同步服务即将开放：暂时还没有可恢复的云端备份'),

    'backup:sync:delete': async () => fail('SYNC_NOT_READY', '云同步服务即将开放，暂无云端备份可删除'),

    // ---------------------------------------------------- 情侣场景（v1.6）
    'couple-scene:get': async () => ({
      ok: true,
      scene: mockState.coupleScene,
      scenes: [
        { id: 'coffee', name: '咖啡约会', desc: '两杯热咖啡，慢慢聊', emoji: '☕', accent: '#ef7a52' },
        { id: 'movie', name: '深夜电影', desc: '灯关小一点，一起看', emoji: '🎬', accent: '#7fb2ff' },
        { id: 'stars', name: '阳台看星星', desc: '风有点凉，但肩并肩', emoji: '🌟', accent: '#ffd166' },
        { id: 'cooking', name: '一起做饭', desc: '你切菜，我递调料', emoji: '🍳', accent: '#ffb347' },
        { id: 'rain', name: '雨天窗边', desc: '听雨，谁都不必说话', emoji: '🌧️', accent: '#9fc3e8' },
        { id: 'bedtime', name: '晚安故事', desc: '关灯之后的那十分钟', emoji: '🌙', accent: '#b9a8ff' },
      ],
      partnerHere: mockState.couple.enabled,
    }),

    'couple-scene:set': async ({ id, light, announce } = {}) => {
      if (id) mockState.coupleScene.id = String(id);
      if (light === 'light' || light === 'dark') mockState.coupleScene.light = light;
      mockState.coupleScene.updatedAt = Date.now();
      mockState.coupleScene.partnerHere = mockState.couple.enabled;
      broadcast();
      return { ok: true, scene: mockState.coupleScene, announce: !!announce, synced: !!announce };
    },

    'couple-scene:capture': async () => ({
      ok: true,
      path: 'C:\\\\Users\\\\Cubbit\\\\Pictures\\\\Cubbit-couple-room-' + new Date().toISOString().slice(0, 10) + '.png',
      bytes: 268400,
    }),

    'store:plans': async () => ({
      ok: true,
      plans: snapshot().plans,
      dlc: DLC_LIST,
      freeTier: FREE_TIER,
      skins: snapshot().skins,
      license: snapshot().license,
      server: {
        online: mockState.serverOnline,
        base: mockState.settings.apiBase || 'http://127.0.0.1:8787',
        error: mockState.serverOnline ? null : '演示：许可服务未启动',
      },
    }),

    'store:coupon': async ({ code, planId } = {}) => {
      const value = String(code || '').trim().toUpperCase();
      if (!value) return fail('COUPON_INVALID', '请输入优惠码');
      const coupon = COUPONS[value];
      if (!coupon) return fail('COUPON_INVALID', '优惠码无效或已过期');
      const base = planPrice(planId);
      if (!base) return fail('PLAN_NOT_FOUND', '请选择有效的方案');
      const discountCents = Math.round((base * coupon.percent) / 100);
      return {
        ok: true,
        code: value,
        discountCents,
        finalPriceCents: base - discountCents,
        description: coupon.description,
      };
    },

    'store:checkout': async ({ planId, couponCode, email } = {}) => {
      if (!mockState.serverOnline) {
        return fail('SERVER_OFFLINE', '无法连接许可服务器，请检查网络或服务器是否已启动');
      }
      const plan = findPlan(planId);
      if (!plan) return fail('PLAN_NOT_FOUND', '请选择有效的方案');
      const order = {
        id: 'ord_demo_' + Math.random().toString(36).slice(2, 10),
        planId,
        status: 'pending',
        payUrl: `https://cubbit.app/pay/${planId}`,
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 1800,
        discountCents: 0,
        email: email || '',
        licenseKey: 'CUBB-DEMO-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-PQ7X-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      };
      const code = String(couponCode || '').trim().toUpperCase();
      if (code && COUPONS[code]) {
        order.discountCents = Math.round((plan.price * COUPONS[code].percent) / 100);
      }
      mockState.order = order;
      mockState.orderPolls = 0;
      return { ok: true, order: publicOrder(order) };
    },

    'store:order': async ({ orderId } = {}) => {
      const order = mockState.order;
      if (!order || order.id !== orderId) return fail('ORDER_NOT_FOUND', '订单不存在或已过期');
      if (order.status === 'pending') {
        mockState.orderPolls += 1;
        // 演示环境：模拟支付渠道回调，两次轮询后即视为已支付
        if (mockState.orderPolls >= 2) {
          order.status = 'paid';
          order.paidAt = Math.floor(Date.now() / 1000);
        }
      }
      return { ok: true, order: publicOrder(order) };
    },

    'focus:start': async ({ minutes, label } = {}) => {
      const m = Number(minutes) || FREE_MINUTES;
      if (!isPro() && (m !== FREE_MINUTES || (label && String(label).trim()))) {
        return fail('FEATURE_LOCKED', '自定义专注时长与标签是 Pro 功能', { feature: 'focus_custom' });
      }
      const f = mockState.focus;
      f.running = true;
      f.paused = false;
      f.minutes = Math.min(180, Math.max(5, Math.round(m)));
      f.label = String(label || '').slice(0, 40);
      f.endsAt = Date.now() + f.minutes * 60000;
      f.remainingMs = f.minutes * 60000;
      f.startedAt = Date.now();
      startFocusInterval();
      broadcast();
      return { ok: true, focus: focusSnapshot() };
    },

    'focus:pause': async () => {
      const f = mockState.focus;
      if (!f.running) return { ok: true, focus: focusSnapshot() };
      if (f.paused) {
        f.endsAt = Date.now() + f.remainingMs;
        f.paused = false;
        startFocusInterval();
      } else {
        f.remainingMs = Math.max(0, f.endsAt - Date.now());
        f.paused = true;
        stopFocusInterval();
      }
      broadcast();
      return { ok: true, focus: focusSnapshot() };
    },

    'focus:stop': async () => {
      const f = mockState.focus;
      const elapsed = f.running ? Math.round((f.minutes * 60000 - Math.max(0, f.endsAt - Date.now())) / 60000) : 0;
      f.running = false;
      f.paused = false;
      f.remainingMs = 0;
      f.endsAt = 0;
      f.label = '';
      stopFocusInterval();
      if (elapsed >= 1) {
        f.today.minutes += elapsed;
        f.totalMinutes += elapsed;
      }
      broadcast();
      return { ok: true, focus: focusSnapshot() };
    },

    'growth:feed': async () => {
      if (!isPro()) return fail('FEATURE_LOCKED', '成长系统是 Pro 功能', { feature: 'growth' });
      const g = mockState.growth;
      if (Date.now() - g.lastFeedAt < FEED_COOLDOWN_MS) {
        return { ok: false, reason: 'cooldown', growth: JSON.parse(JSON.stringify(g)) };
      }
      g.lastFeedAt = Date.now();
      g.feeds += 1;
      g.affinity = Math.min(100, g.affinity + 6);
      g.exp += 12;
      g.expInLevel = Math.min(g.expToNext, g.expInLevel + 12);
      g.canFeed = false;
      g.nextFeedInMs = FEED_COOLDOWN_MS;
      const life = mockState.life;
      if (life) {
        life.hunger = Math.min(100, life.hunger + 18);
        life.energy = Math.min(100, life.energy + 6);
        life.spirit = Math.min(100, life.spirit + 3);
        life.mood = 'happy';
        life.lastInteractionAt = Date.now();
        life.thoughts.unshift('谢谢，好好吃！');
        life.thoughts = life.thoughts.slice(0, 8);
      }
      broadcast();
      return { ok: true, growth: JSON.parse(JSON.stringify(g)) };
    },

    'growth:pet': async () => {
      const g = mockState.growth;
      g.exp += 2;
      g.expInLevel = Math.min(g.expToNext, g.expInLevel + 2);
      g.affinity = Math.min(100, g.affinity + 1);
      const life = mockState.life;
      if (life) {
        life.spirit = Math.min(100, life.spirit + 4);
        life.energy = Math.min(100, life.energy + 2);
        life.mood = 'happy';
        life.lastInteractionAt = Date.now();
        life.thoughts.unshift('嘿嘿，再摸一下');
        life.thoughts = life.thoughts.slice(0, 8);
      }
      broadcast();
      return { ok: true, growth: JSON.parse(JSON.stringify(g)) };
    },


    // ------------------------------------------------------ AI 陪伴（第四期）
    'ai:status': async () => ({ ok: true, ai: aiSnapshot() }),

    'ai:chat': async ({ text } = {}) => {
      const clean = String(text || '').slice(0, 200).trim();
      if (!clean) return fail('BAD_REQUEST', '先打点字再发吧');
      const ai = mockState.ai;
      if (!ai.pro) return fail('FEATURE_LOCKED', 'AI 陪伴是 Pro 功能', { feature: 'ai_chat' });
      if (!ai.enabled) {
        ai.lastError = 'AI 未启用，请到设置里开启';
        return fail('AI_NOT_ENABLED', 'AI 陪伴未启用，可在「设置 → AI 陪伴」里打开', { ai: aiSnapshot() });
      }
      ai.messages.push({ role: 'user', text: clean, at: Date.now() });
      ai.chatting = true;
      ai.lastError = '';
      await new Promise((resolve) => setTimeout(resolve, 420 + Math.random() * 380));
      const reply = aiReplyTo(clean);
      ai.messages.push({ role: 'assistant', text: reply, at: Date.now() });
      ai.messages = ai.messages.slice(-2 * (Number(mockState.settings.aiMaxTurns) || 10));
      ai.chatting = false;
      ai.ready = true;
      broadcast();
      mockEmit('ai:message', { text: reply, mood: 'happy', source: ai.ready ? 'ai' : 'rules' });
      return {
        ok: true,
        reply,
        mood: 'happy',
        source: mockState.settings.aiModel ? 'ai' : 'rules',
        usage: { promptTokens: 84, completionTokens: 42, totalTokens: 126 },
        ai: useTier ? tierAi() : aiSnapshot(),
      };
    },

    'ai:test': async (payload = {}) => {
      const provider = String(payload.provider || mockState.settings.aiProvider || 'ollama');
      const baseUrl = String(payload.baseUrl || mockState.settings.aiBaseUrl || '');
      const apiKey = payload.apiKey != null ? String(payload.apiKey) : String(mockState.settings.aiApiKey || '');
      const model = String(payload.model || mockState.settings.aiModel || '');
      await new Promise((resolve) => setTimeout(resolve, 640));
      if (provider === 'openai') {
        if (!apiKey) return fail('AI_NOT_CONFIGURED', '请先填写 API Key，再测试连接');
        if (!/^https?:\/\//i.test(baseUrl)) return fail('AI_BAD_URL', 'Base URL 需要以 http:// 或 https:// 开头');
        return { ok: true, latencyMs: 486, models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'], provider, model };
      }
      if (!/^https?:\/\//i.test(baseUrl)) return fail('AI_BAD_URL', 'Base URL 需要以 http:// 或 https:// 开头');
      const isLocal = /127\.0\.0\.1|localhost/.test(baseUrl);
      if (!isLocal) return fail('AI_UNREACHABLE', '没有连上本机 Ollama，请确认服务已启动（ollama serve）');
      return { ok: true, latencyMs: 128, models: ['qwen2.5:3b', 'llama3.2:3b', 'gemma3:4b'], provider, model };
    },

    'ai:config:set': async (patch = {}) => {
      const allowed = ['aiEnabled', 'aiProvider', 'aiBaseUrl', 'aiModel', 'aiApiKey', 'aiPersonality', 'aiRemember', 'aiMaxTurns'];
      for (const key of allowed) {
        if (patch[key] !== undefined) mockState.settings[key] = patch[key];
      }
      const ai = mockState.ai;
      ai.enabled = mockState.settings.aiEnabled !== false;
      ai.provider = mockState.settings.aiProvider || '';
      ai.model = mockState.settings.aiModel || '';
      ai.personality = mockState.settings.aiPersonality || 'warm';
      ai.ready = ai.enabled && !!ai.provider && !!ai.model;
      ai.lastError = ai.ready ? '' : 'AI 尚未配置完成';
      broadcast();
      return { ok: true, ai: aiSnapshot() };
    },

    'ai:history:get': async () => ({ ok: true, messages: aiSnapshot().messages }),

    'ai:history:clear': async () => {
      mockState.ai.messages = [];
      broadcast();
      return { ok: true };
    },

    'multi-pet:set': async ({ count } = {}) => {
      const n = Math.max(1, Math.min(3, Number(count) || 1));
      if (n > 1 && !isPro()) return fail('FEATURE_LOCKED', '多宠物同屏是 Pro 功能', { feature: 'multi_pet' });
      mockState.settings.multiPetCount = n;
      broadcast();
      return { ok: true, state: snapshot() };
    },

    // ------------------------------------------------ 状态感知 / 情侣模式（演示）
    'presence:get': async () => ({ ok: true, presence: JSON.parse(JSON.stringify(mockState.presence)) }),

    'couple:status': async () => ({ ok: true, couple: coupleTwin() }),

    'couple:create': async () => {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      mockState.couple.inviteCode = code;
      mockState.couple.inviteExpiresAt = Date.now() + 10 * 60 * 1000;
      broadcast();
      return { ok: true, code, expiresAt: mockState.couple.inviteExpiresAt, couple: coupleTwin() };
    },

    'couple:join': async ({ code } = {}) => {
      const value = String(code || '').replace(/\D/g, '');
      if (value.length !== 6) return fail('BAD_REQUEST', '请输入 6 位邀请码');
      if (!mockState.couple.serverOnline) return fail('SERVER_OFFLINE', '情侣服务暂不可用，请稍后重试');
      const c = mockState.couple;
      c.enabled = true;
      c.pairId = 'pair_demo_' + value;
      c.partner = JSON.parse(JSON.stringify(PARTNER));
      c.affection = 120;
      c.anniversaryDays = 0;
      c.unread = 1;
      c.messages = [
        { id: 'j1', from: 'partner', text: '配对成功啦，以后多关照～', kind: 'text', at: Date.now() },
      ];
      broadcast();
      return { ok: true, couple: coupleTwin() };
    },

    'couple:send': async ({ text, kind } = {}) => {
      const clean = String(text || '').slice(0, 200);
      if (!clean.trim()) return fail('BAD_REQUEST', '消息不能为空');
      const c = mockState.couple;
      if (!c.enabled) return fail('COUPLE_NOT_PAIRED', '还没有配对，无法发送消息');
      c.messages.push({ id: 'm' + Date.now(), from: 'me', text: clean.trim(), kind: kind || 'text', at: Date.now() });
      c.messages = c.messages.slice(-20);
      c.affection = Math.min(1000, (c.affection || 0) + 2);
      broadcast();
      // 演示：对方 1.2s 后回一句
      setTimeout(() => {
        c.messages.push({ id: 'r' + Date.now(), from: 'partner', text: '收到啦，我也想你～', kind: 'text', at: Date.now() });
        c.messages = c.messages.slice(-20);
        broadcast();
      }, 1200);
      return { ok: true, couple: coupleTwin() };
    },

    'couple:poll': async () => ({ ok: true, couple: coupleTwin() }),

    'couple:propose': async () => {
      const c = mockState.couple;
      if (!c.enabled) return fail('COUPLE_NOT_PAIRED', '还没有配对，无法求婚');
      c.pendingProposal = true;
      c.proposalFrom = 'me';
      broadcast();
      return { ok: true, couple: coupleTwin() };
    },

    'couple:accept': async () => {
      const c = mockState.couple;
      c.married = true;
      c.marriedAt = Math.floor(Date.now() / 1000);
      c.anniversaryDays = 1;
      c.pendingProposal = false;
      c.proposalFrom = null;
      c.affection = Math.min(1000, (c.affection || 0) + 100);
      c.messages.push({ id: 'w' + Date.now(), from: 'partner', text: '我们结婚啦！💍', kind: 'text', at: Date.now() });
      broadcast();
      return { ok: true, couple: coupleTwin() };
    },

    'couple:love-note': async ({ text } = {}) => {
      const clean = String(text || '').slice(0, 140);
      if (!clean.trim()) return fail('BAD_REQUEST', '先写一句情话吧');
      const c = mockState.couple;
      c.dailyLove = { sent: true, text: clean.trim(), at: Date.now() };
      c.affection = Math.min(1000, (c.affection || 0) + 5);
      mockState.settings.coupleProfile = Object.assign({}, mockState.settings.coupleProfile, { loveNote: clean.trim() });
      broadcast();
      return { ok: true, couple: coupleTwin() };
    },

    'couple:profile': async ({ petName, loveNote } = {}) => {
      mockState.settings.coupleProfile = {
        petName: String(petName || '').slice(0, 20),
        loveNote: String(loveNote || '').slice(0, 140),
      };
      broadcast();
      return { ok: true, coupleProfile: mockState.settings.coupleProfile };
    },

    'couple:unpair': async () => {
      // ---------------------------------------------------- 智慧生命（第三期）
  mockState.life = {
    enabled: true,
    locked: false,
    // 与 app/src/main/life.js snapshot() 同构
    mood: 'happy',
    moodLabel: '开心',
    moodIcon: '😊',
    energy: 72,
    hunger: 62,
    spirit: 84,
    traits: [
      { id: 'clingy', name: '黏人', desc: '喜欢待在你旁边' },
      { id: 'curious', name: '好奇', desc: '对屏幕上的东西感兴趣' },
      { id: 'sleepyhead', name: '爱睡觉', desc: '一闲下来就打盹' },
    ],
    daysTogether: 128,
    thoughtPool: [
      '你终于回来了',
      '刚刚好像听到你叹气了',
      '我把桌面收拾干净了，等你回来',
      '要不要站起来走走？我陪你',
      '今天也一起加油吧',
      '夜深了，早点睡呀',
    ],
    thoughts: ['你终于回来了'],
    events: [
      { at: now - 2 * 3600 * 1000, type: 'feed', text: '你喂了它一块小饼干' },
      { at: now - 3 * 86400000, type: 'focus', text: '一起完成 25 分钟专注' },
      { at: now - 6 * 86400000, type: 'pet', text: '第一次摸头，它记住了这个动作' },
      { at: now - 30 * 86400000, type: 'pair', text: '和 TA 的方块仔配对了' },
    ],
    partnerMissing: 12,
    focusDoneAt: 0,
    lastInteractionAt: now - 3600 * 1000,
  };

  // ---------------------------------------------------- AI 陪伴（第四期）
  const aiVariant = (params.get('ai') || 'ready').toLowerCase();
  function demoAiMessages() {
    const base = now - 8 * 60 * 1000;
    return [
      { role: 'assistant', text: '我在呢。今天过得怎么样？', at: base },
      { role: 'user', text: '今天累死了，连开三个会', at: base + 60 * 1000 },
      { role: 'assistant', text: '听起来真的很消耗。要不要先把肩膀放松一下？我可以安静陪你一会儿。', at: base + 75 * 1000 },
      { role: 'user', text: '好啊，那你说点轻松的', at: base + 120 * 1000 },
      { role: 'assistant', text: '那我讲个冷笑话：为什么方块仔从不迟到？因为它每天都「方」得刚刚好。…不好笑也没关系，你笑一下我就值了。', at: base + 140 * 1000 },
    ];
  }

  mockState.ai = {
    enabled: aiVariant !== 'unconfigured',
    provider: 'ollama',
    model: 'qwen2.5:3b',
    ready: aiVariant === 'ready' || aiVariant === 'pro',
    pro: aiVariant !== 'locked',
    chatting: false,
    lastError: '',
    personality: 'warm',
    messages: aiVariant === 'locked' ? [] : demoAiMessages(),
  };
  if (aiVariant === 'unconfigured') {
    mockState.ai.provider = '';
    mockState.ai.model = '';
    mockState.ai.messages = [];
  }
  if (aiVariant === 'openai') {
    mockState.ai.provider = 'openai';
    mockState.ai.model = 'gpt-4o-mini';
    mockState.ai.ready = true;
  }

  function aiSnapshot() {
    return JSON.parse(JSON.stringify(mockState.ai));
  }

  function aiReplyTo(text) {
    const t = String(text || '');
    const personality = mockState.settings.aiPersonality || 'warm';
    if (/累|疲惫|加班|开会|难受|烦/.test(t)) {
      return personality === 'sassy'
        ? '又累了？行吧，允许你摆烂十分钟，我数着时间。'
        : '听起来真的很消耗。先把肩膀放松一下，我在这儿陪你，什么都不用说。';
    }
    if (/夸|厉害|棒|表扬/.test(t)) {
      return personality === 'quiet'
        ? '嗯，你很好。真的。'
        : '今天能撑到现在就已经很厉害了。别人可能看不出来，但我一直看着你。';
    }
    if (/笑话|冷笑话|逗|搞笑/.test(t)) {
      return '为什么方块仔不会被 AI 取代？因为它会「方」法摸鱼。……不好笑的话，我换一个：为什么我总在屏幕右下角？因为那里离你的手最近。';
    }
    if (/晚安|睡了|困/.test(t)) {
      return '晚安。屏幕调暗一点，明天我还在这个位置等你。';
    }
    if (/你好|在吗|嗨|hi|hello/i.test(t)) {
      return '在的。刚刚在看你桌面上的光，现在看你。';
    }
    const warm = [
      '我听着呢，慢慢说。',
      '这件事我记住了。你继续说，我在。',
      '嗯…我在想，如果是我遇到这件事，大概也会有点难受。',
      '要不要先喝口水？然后我们再接着聊。',
    ];
    return warm[Math.floor(Math.random() * warm.length)];
  }

  mockState.couple = baseCouple();
      broadcast();
      return { ok: true, couple: coupleTwin() };
    },

    'couple:retry': async () => {
      mockState.serverOnline = true;
      mockState.couple.serverOnline = true;
      mockState.couple.error = '';
      broadcast();
      return { ok: true, couple: coupleTwin() };
    },
  };

  window.__cubbitMock = {
    isMock: true,
    variant,
    quiet,
    init: async () => snapshot(),
    state: async () => snapshot(),
    invoke: async (channel, payload) => {
      const handler = handlers[channel];
      if (!handler) {
        return { ok: false, code: 'NOT_ALLOWED', message: `演示模式不支持该通道：${channel}` };
      }
      // 模拟 120~260ms 的网络/主进程延迟，便于观察 loading 态
      await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 140));
      try {
        return await handler(payload || {});
      } catch (err) {
        return { ok: false, code: 'MOCK_ERROR', message: String((err && err.message) || err) };
      }
    },
    onState: (cb) => {
      mockState.stateHandlers.add(cb);
      return () => mockState.stateHandlers.delete(cb);
    },
    onNav: (cb) => {
      mockState.navHandlers.add(cb);
      return () => mockState.navHandlers.delete(cb);
    },
    onEvent: (channel, cb) => {
      if (!mockEventHandlers.has(channel)) mockEventHandlers.set(channel, new Set());
      mockEventHandlers.get(channel).add(cb);
      return () => {
        const set = mockEventHandlers.get(channel);
        if (set) set.delete(cb);
      };
    },
    window: async () => ({ ok: true }),
    close: async () => {
      window.close();
      return { ok: true };
    },
    openPanel: async (name) => {
      location.href = `../${name}/index.html${location.search || ''}`;
      return { ok: true, name };
    },
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener');
      return { ok: true };
    },
    quit: async () => ({ ok: true }),
  };

  // 演示模式下的专注倒计时也需要一份初始快照
  mockState.focus.remainingMs = 0;
})();
