/**
 * 方块仔 — 应用内面板共享逻辑层
 *
 * 提供：
 *   · DOM 小工具（el / $ / 清空 / 事件）
 *   · 内联 SVG 图标（全部本地定义，无外链）
 *   · toast / modal / confirm / 升级 Pro 引导
 *   · 金额、日期、时长格式化
 *   · 面板外壳（标题栏、窗口控制、状态订阅、invoke 统一容错）
 *
 * 只依赖 window.cubbit.panel（真实运行时）或 window.__cubbitMock（浏览器预览）。
 * 不使用 innerHTML 拼接任何外部/用户数据。
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- IPC 通道
  // 与 app/src/shared/ipc.js 保持一致；渲染层无法 require，故此处为白名单副本。
  const IPC = {
    APP_STATE: 'app:state',
    APP_QUIT: 'app:quit',
    APP_OPEN_EXTERNAL: 'app:open-external',
    APP_PANEL_OPEN: 'app:panel:open',
    APP_PANEL_WINDOW: 'app:panel:window',
    APP_SETTINGS_SET: 'app:settings:set',
    APP_SETTINGS_RESET: 'app:settings:reset',
    LICENSE_STATUS: 'license:status',
    LICENSE_START_TRIAL: 'license:start-trial',
    LICENSE_ACTIVATE: 'license:activate',
    LICENSE_RESTORE: 'license:restore',
    LICENSE_DEACTIVATE: 'license:deactivate',
    STORE_PLANS: 'store:plans',
    STORE_CHECKOUT: 'store:checkout',
    STORE_ORDER: 'store:order',
    STORE_COUPON: 'store:coupon',
    FOCUS_START: 'focus:start',
    FOCUS_PAUSE: 'focus:pause',
    FOCUS_STOP: 'focus:stop',
    GROWTH_FEED: 'growth:feed',
    GROWTH_PET: 'growth:pet',
    MULTI_PET_SET: 'multi-pet:set',
    PET_RESET_POSITION: 'pet:reset-position',
    PRESENCE_GET: 'presence:get',
    // 情侣模式（配对 / 聊天 / 结婚 / 每日情话）
    COUPLE_STATUS: 'couple:status',
    COUPLE_CREATE: 'couple:create',
    COUPLE_JOIN: 'couple:join',
    COUPLE_UNPAIR: 'couple:unpair',
    COUPLE_SEND: 'couple:send',
    COUPLE_POLL: 'couple:poll',
    COUPLE_PROPOSE: 'couple:propose',
    COUPLE_ACCEPT: 'couple:accept',
    COUPLE_REJECT: 'couple:reject',
    COUPLE_LOVE_NOTE: 'couple:love-note',
    COUPLE_PROFILE: 'couple:profile',
    COUPLE_RETRY: 'couple:retry',
    // AI 陪伴（第四期）
    AI_STATUS: 'ai:status',
    AI_CHAT: 'ai:chat',
    AI_TEST: 'ai:test',
    AI_CONFIG_SET: 'ai:config:set',
    AI_HISTORY_GET: 'ai:history:get',
    AI_HISTORY_CLEAR: 'ai:history:clear',
  };

  /** 事件通道（与 shared/ipc.js 的 EVENTS 对齐） */
  const EVENTS = {
    AI_MESSAGE: 'ai:message',
  };

  // ---------------------------------------------------------------- 图标定义
  const ICONS = {
    cube: [
      ['path', { d: 'M12 2.7 20.7 7.5v9L12 21.3 3.3 16.5v-9z' }],
      ['path', { d: 'M3.3 7.5 12 12.3l8.7-4.8' }],
      ['path', { d: 'M12 12.3v9' }],
    ],
    crown: [
      ['path', { d: 'M3 8.4l3.9 2.9L12 4.6l5.1 6.7L21 8.4l-1.7 10.9H4.7z' }],
      ['path', { d: 'M8 19.3h8' }],
    ],
    check: [['path', { d: 'M4.8 12.6l4.6 4.6L19.3 7.3' }]],
    'check-circle': [
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['path', { d: 'M8.2 12.3l2.6 2.6 4.9-5.1' }],
    ],
    x: [
      ['path', { d: 'M6.2 6.2l11.6 11.6' }],
      ['path', { d: 'M17.8 6.2L6.2 17.8' }],
    ],
    minus: [['path', { d: 'M5 12h14' }]],
    square: [['rect', { x: 5, y: 5, width: 14, height: 14, rx: 2.4 }]],
    'chevron-left': [['path', { d: 'M14.6 5.5L8.1 12l6.5 6.5' }]],
    'chevron-right': [['path', { d: 'M9.4 5.5L15.9 12l-6.5 6.5' }]],
    'chevron-down': [['path', { d: 'M5.5 9.2L12 15.5l6.5-6.3' }]],
    'chevron-up': [['path', { d: 'M5.5 14.8L12 8.5l6.5 6.3' }]],
    'arrow-right': [
      ['path', { d: 'M4.5 12h14.2' }],
      ['path', { d: 'M13.2 6.3L18.7 12l-5.5 5.7' }],
    ],
    'arrow-left': [
      ['path', { d: 'M19.5 12H5.3' }],
      ['path', { d: 'M10.8 6.3L5.3 12l5.5 5.7' }],
    ],
    palette: [
      [
        'path',
        {
          d: 'M12 3.2a8.8 8.8 0 0 0 0 17.6c1.35 0 1.85-.92 1.85-1.85 0-1.8 1.5-2.5 2.85-2.5h1.15a3.1 3.1 0 0 0 3.05-3.1A8.8 8.8 0 0 0 12 3.2z',
        },
      ],
      ['circle', { cx: 8.4, cy: 9.6, r: 1.15 }],
      ['circle', { cx: 12, cy: 7.6, r: 1.15 }],
      ['circle', { cx: 15.6, cy: 9.6, r: 1.15 }],
    ],
    timer: [
      ['circle', { cx: 12, cy: 12.8, r: 8 }],
      ['path', { d: 'M12 8.6v4.4l3 1.8' }],
      ['path', { d: 'M9.4 2.8h5.2' }],
    ],
    sparkle: [
      ['path', { d: 'M12 3.2l1.75 5.05L18.8 10l-5.05 1.75L12 16.8l-1.75-5.05L5.2 10l5.05-1.75z' }],
      ['path', { d: 'M18 16.4l.72 1.88L20.6 19l-1.88.72L18 21.6l-.72-1.88L15.4 19l1.88-.72z' }],
    ],
    users: [
      ['circle', { cx: 9.2, cy: 8.6, r: 3.3 }],
      ['path', { d: 'M3.4 19.4c0-2.9 2.6-5.1 5.8-5.1s5.8 2.2 5.8 5.1' }],
      ['path', { d: 'M16.4 5.8a3.1 3.1 0 0 1 0 5.9' }],
      ['path', { d: 'M17.6 14.6c1.9.6 3.2 2.3 3.2 4.4' }],
    ],
    sliders: [
      ['path', { d: 'M4 7.2h6.2M14.6 7.2H20' }],
      ['path', { d: 'M4 16.8h4.4M12.8 16.8H20' }],
      ['circle', { cx: 12.4, cy: 7.2, r: 2.1 }],
      ['circle', { cx: 10.6, cy: 16.8, r: 2.1 }],
    ],
    bell: [
      ['path', { d: 'M6.3 9.4a5.7 5.7 0 0 1 11.4 0c0 3.9 1.4 5.4 1.4 5.4H4.9s1.4-1.5 1.4-5.4z' }],
      ['path', { d: 'M9.8 18.2a2.4 2.4 0 0 0 4.4 0' }],
    ],
    lock: [
      ['rect', { x: 4.6, y: 10.4, width: 14.8, height: 9.6, rx: 2.4 }],
      ['path', { d: 'M8.2 10.4V7.7a3.8 3.8 0 0 1 7.6 0v2.7' }],
    ],
    unlock: [
      ['rect', { x: 4.6, y: 10.4, width: 14.8, height: 9.6, rx: 2.4 }],
      ['path', { d: 'M8.2 10.4V7.7a3.8 3.8 0 0 1 7.2-1.5' }],
    ],
    key: [
      ['circle', { cx: 8.2, cy: 15.8, r: 3.4 }],
      ['path', { d: 'M10.7 13.3L19.4 4.6' }],
      ['path', { d: 'M15.6 8.4l2.4 2.4' }],
      ['path', { d: 'M17.7 6.3l2.4 2.4' }],
    ],
    link: [
      ['path', { d: 'M10.2 13.8l3.6-3.6' }],
      ['path', { d: 'M9.4 6.6l1.6-1.6a3.6 3.6 0 0 1 5.1 5.1l-1.6 1.6' }],
      ['path', { d: 'M14.6 17.4l-1.6 1.6a3.6 3.6 0 0 1-5.1-5.1l1.6-1.6' }],
    ],
    unlink: [
      ['path', { d: 'M9.8 14.2l1.2-1.2' }],
      ['path', { d: 'M7.4 10.2l-1.2 1.2a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2' }],
      ['path', { d: 'M16.6 13.8l1.2-1.2a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2' }],
      ['path', { d: 'M4 4l16 16' }],
    ],
    copy: [
      ['rect', { x: 8.6, y: 8.6, width: 11, height: 11, rx: 2.2 }],
      ['path', { d: 'M15.4 5.4H6.8A2.4 2.4 0 0 0 4.4 7.8v8.6' }],
    ],
    refresh: [
      ['path', { d: 'M19.2 12a7.2 7.2 0 1 1-2.6-5.6' }],
      ['path', { d: 'M19.6 4.4v4.4h-4.4' }],
    ],
    external: [
      ['path', { d: 'M13.6 4.6h5.8v5.8' }],
      ['path', { d: 'M19.4 4.6L11.2 12.8' }],
      ['path', { d: 'M17.4 14.2v4.2a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2V8.8a2 2 0 0 1 2-2h4.2' }],
    ],
    sun: [
      ['circle', { cx: 12, cy: 12, r: 4.2 }],
      ['path', { d: 'M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7' }],
    ],
    moon: [['path', { d: 'M20.2 14.4A8.6 8.6 0 0 1 9.6 3.8a8.9 8.9 0 1 0 10.6 10.6z' }]],
    keyboard: [
      ['rect', { x: 2.8, y: 6.4, width: 18.4, height: 11.2, rx: 2.4 }],
      ['path', { d: 'M6.8 10.2h.01M10.2 10.2h.01M13.6 10.2h.01M17 10.2h.01M8 14h8' }],
    ],
    power: [
      ['path', { d: 'M12 3.4v8' }],
      ['path', { d: 'M17.4 6.2a7.6 7.6 0 1 1-10.8 0' }],
    ],
    volume: [
      ['path', { d: 'M4.4 9.6h3.2L12 5.8v12.4L7.6 14.4H4.4z' }],
      ['path', { d: 'M15.4 9.2a3.9 3.9 0 0 1 0 5.6' }],
      ['path', { d: 'M17.8 6.8a7.2 7.2 0 0 1 0 10.4' }],
    ],
    chart: [
      ['path', { d: 'M4.4 20h15.2' }],
      ['rect', { x: 6.4, y: 11.4, width: 3, height: 6, rx: 1.2 }],
      ['rect', { x: 10.9, y: 7.4, width: 3, height: 10, rx: 1.2 }],
      ['rect', { x: 15.4, y: 13.4, width: 3, height: 4, rx: 1.2 }],
    ],
    heart: [
      ['path', { d: 'M12 20.2s-7.6-4.6-7.6-9.5a4.3 4.3 0 0 1 7.6-2.7 4.3 4.3 0 0 1 7.6 2.7c0 4.9-7.6 9.5-7.6 9.5z' }],
    ],
    flame: [
      ['path', { d: 'M12 21c3.3 0 6-2.5 6-5.7 0-4.6-6-12-6-12S6 10.7 6 15.3C6 18.5 8.7 21 12 21z' }],
      ['path', { d: 'M12 17.6c1.3 0 2.3-1 2.3-2.3 0-1.8-2.3-4.4-2.3-4.4s-2.3 2.6-2.3 4.4c0 1.3 1 2.3 2.3 2.3z' }],
    ],
    gift: [
      ['rect', { x: 3.6, y: 8.6, width: 16.8, height: 4.2, rx: 1.4 }],
      ['path', { d: 'M5.2 12.8v6.2a1.8 1.8 0 0 0 1.8 1.8h10a1.8 1.8 0 0 0 1.8-1.8v-6.2' }],
      ['path', { d: 'M12 8.6v12.2' }],
      ['path', { d: 'M12 8.2S10.6 4 8.2 4a2.2 2.2 0 0 0 0 4.4zM12 8.2S13.4 4 15.8 4a2.2 2.2 0 0 1 0 4.4z' }],
    ],
    info: [
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['path', { d: 'M12 11.2v5.2' }],
      ['path', { d: 'M12 8.1h.01' }],
    ],
    shield: [
      ['path', { d: 'M12 3.2l7.2 2.8v5.2c0 4.3-3.1 7.4-7.2 9.4-4.1-2-7.2-5.1-7.2-9.4V6z' }],
      ['path', { d: 'M9.2 11.8l2 2 3.6-3.8' }],
    ],
    trash: [
      ['path', { d: 'M4.6 7h14.8' }],
      ['path', { d: 'M9.4 7V5.2a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6V7' }],
      ['path', { d: 'M6.4 7l.9 11.6a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.6 7' }],
    ],
    warning: [
      ['path', { d: 'M12 4.2l8.6 14.4a1.1 1.1 0 0 1-1 1.6H4.4a1.1 1.1 0 0 1-1-1.6z' }],
      ['path', { d: 'M12 9.4v4.2' }],
      ['path', { d: 'M12 17h.01' }],
    ],
    play: [['path', { d: 'M8.4 5.6l9.4 6.4-9.4 6.4z' }]],
    pause: [
      ['rect', { x: 8, y: 5.4, width: 3.2, height: 13.2, rx: 1.2 }],
      ['rect', { x: 12.8, y: 5.4, width: 3.2, height: 13.2, rx: 1.2 }],
    ],
    stop: [['rect', { x: 6.6, y: 6.6, width: 10.8, height: 10.8, rx: 2.2 }]],
    wifi: [
      ['path', { d: 'M3.4 9.2a13 13 0 0 1 17.2 0' }],
      ['path', { d: 'M6.6 12.6a8.4 8.4 0 0 1 10.8 0' }],
      ['path', { d: 'M9.7 16a4 4 0 0 1 4.6 0' }],
      ['path', { d: 'M12 19.4h.01' }],
    ],
    'wifi-off': [
      ['path', { d: 'M3.4 9.2a13 13 0 0 1 7-3.5' }],
      ['path', { d: 'M14.8 6.2a13 13 0 0 1 5.8 3' }],
      ['path', { d: 'M6.6 12.6a8.4 8.4 0 0 1 2.6-1.5' }],
      ['path', { d: 'M14.6 12.1c.9.2 1.8.6 2.8 1.2' }],
      ['path', { d: 'M9.7 16a4 4 0 0 1 4.6 0' }],
      ['path', { d: 'M4 4l16 16' }],
    ],
    mail: [
      ['rect', { x: 3.2, y: 5.4, width: 17.6, height: 13.2, rx: 2.4 }],
      ['path', { d: 'M3.8 7.2L12 13l8.2-5.8' }],
    ],
    star: [
      ['path', { d: 'M12 3.6l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17.4l-5.38 2.85 1.03-6L3.3 10l6-.9z' }],
    ],
    eye: [
      ['path', { d: 'M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z' }],
      ['circle', { cx: 12, cy: 12, r: 2.9 }],
    ],
    droplet: [['path', { d: 'M12 3.4s6 6.1 6 10.1a6 6 0 0 1-12 0c0-4 6-10.1 6-10.1z' }]],
    target: [
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['circle', { cx: 12, cy: 12, r: 4.6 }],
      ['circle', { cx: 12, cy: 12, r: 1 }],
    ],
    calendar: [
      ['rect', { x: 3.8, y: 5.4, width: 16.4, height: 14.8, rx: 2.4 }],
      ['path', { d: 'M3.8 10.2h16.4' }],
      ['path', { d: 'M8.4 3.4v3.6M15.6 3.4v3.6' }],
    ],
    card: [
      ['rect', { x: 2.8, y: 5.6, width: 18.4, height: 12.8, rx: 2.4 }],
      ['path', { d: 'M2.8 10.2h18.4' }],
      ['path', { d: 'M6.4 14.6h3.6' }],
    ],
    receipt: [
      ['path', { d: 'M6 3.4h12v17.2l-3-1.8-3 1.8-3-1.8-3 1.8z' }],
      ['path', { d: 'M9.2 8h5.6M9.2 11.6h5.6' }],
    ],
    monitor: [
      ['rect', { x: 2.8, y: 4.4, width: 18.4, height: 12, rx: 2.2 }],
      ['path', { d: 'M8.6 20.2h6.8M12 16.4v3.8' }],
    ],
    'rotate-ccw': [
      ['path', { d: 'M4.4 12a7.6 7.6 0 1 0 2.8-5.9' }],
      ['path', { d: 'M4 4.4v4.6h4.6' }],
    ],
    globe: [
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['path', { d: 'M3.6 12h16.8' }],
      ['path', { d: 'M12 3.4c2.4 2.4 3.7 5.4 3.7 8.6S14.4 18.2 12 20.6c-2.4-2.4-3.7-5.4-3.7-8.6S9.6 5.8 12 3.4z' }],
    ],
    help: [
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['path', { d: 'M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.6' }],
      ['path', { d: 'M12 17h.01' }],
    ],
    bolt: [['path', { d: 'M13.4 2.8L5.6 13.6h5.2l-.8 7.6 7.8-10.8h-5.2z' }]],
    bag: [
      ['path', { d: 'M4.6 8.4h14.8l-1.2 11.2a1.8 1.8 0 0 1-1.8 1.6H7.6a1.8 1.8 0 0 1-1.8-1.6z' }],
      ['path', { d: 'M8.6 8.4V6.6a3.4 3.4 0 0 1 6.8 0v1.8' }],
    ],
    download: [
      ['path', { d: 'M12 3.6v11.2' }],
      ['path', { d: 'M7.6 10.6L12 15l4.4-4.4' }],
      ['path', { d: 'M4.6 18.4v1a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-1' }],
    ],
    leaf: [
      ['path', { d: 'M5 19.4c0-8 5-14 15-14.6 0 10-5.5 15-14.2 14.8' }],
      ['path', { d: 'M5 19.4c2-4.4 5.2-7.4 9.4-9.2' }],
    ],
    ring: [
      ['circle', { cx: 12, cy: 15.2, r: 5.2 }],
      ['path', { d: 'M9.2 7.4L12 3.2l2.8 4.2' }],
      ['path', { d: 'M7.4 9.6h9.2' }],
    ],
    chat: [
      ['path', { d: 'M20.4 12.6c0 3.7-3.8 6.7-8.4 6.7-1 0-2-.1-2.9-.4l-4.6 1.7 1.4-3.6c-1.3-1.2-2.1-2.7-2.1-4.4 0-3.7 3.8-6.7 8.4-6.7s8.2 3 8.2 6.7z' }],
      ['path', { d: 'M8.6 12.4h.01M12.1 12.4h.01M15.6 12.4h.01' }],
    ],
    send: [
      ['path', { d: 'M21 3.4L10.6 13.8' }],
      ['path', { d: 'M21 3.4l-6.6 17.4-3.8-7-7-3.8z' }],
    ],
    coffee: [
      ['path', { d: 'M4.6 8.6h11.2v5.6a4.4 4.4 0 0 1-4.4 4.4h-2.4a4.4 4.4 0 0 1-4.4-4.4z' }],
      ['path', { d: 'M15.8 9.6h1.8a2.4 2.4 0 0 1 0 4.8h-1.8' }],
      ['path', { d: 'M7.4 4.6v1.6M10.4 4.6v1.6M13.4 4.6v1.6' }],
    ],
    moon2: [
      ['path', { d: 'M19.6 14.2A7.8 7.8 0 0 1 9.8 4.4a8.1 8.1 0 1 0 9.8 9.8z' }],
    ],
    hug: [
      ['path', { d: 'M12 20.2s-7.6-4.6-7.6-9.5a4.3 4.3 0 0 1 7.6-2.7 4.3 4.3 0 0 1 7.6 2.7c0 4.9-7.6 9.5-7.6 9.5z' }],
      ['path', { d: 'M8.6 12.4c1 1.2 2.2 1.8 3.4 1.8s2.4-.6 3.4-1.8' }],
    ],    cake: [
      ['path', { d: 'M4.6 12.4h14.8v7.2H4.6z' }],
      ['path', { d: 'M4.2 12.4c1.4-1.3 3.4-1.3 4.8 0 1.4-1.3 3.4-1.3 4.8 0 1.4-1.3 3.4-1.3 4.8 0' }],
      ['path', { d: 'M12 8.6V5.2M9.2 16h5.6' }],
    ],
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** 生成内联 SVG 图标元素 */
  function icon(name, size) {
    const defs = ICONS[name] || ICONS.info;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ico ico--' + name);
    if (size) {
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
    }
    for (const [tag, attrs] of defs) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(node);
    }
    return svg;
  }

  // ------------------------------------------------------------------ DOM 工具
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /**
   * 创建元素。
   * el('div', { class: 'card', text: '标题', on: { click: fn }, style: { width: '10px' } }, child1, child2)
   */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class' || key === 'className') node.className = value;
        else if (key === 'text') node.textContent = String(value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'on' && typeof value === 'object') {
          for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
        } else if (key in node && typeof value !== 'string') {
          try {
            node[key] = value;
          } catch {
            node.setAttribute(key, String(value));
          }
        } else if (typeof value === 'boolean') {
          if (value) node.setAttribute(key, '');
        } else {
          node.setAttribute(key, String(value));
        }
      }
    }
    for (const child of children.flat(4)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'object' && child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function on(node, evt, fn, opts) {
    if (!node) return () => {};
    node.addEventListener(evt, fn, opts);
    return () => node.removeEventListener(evt, fn, opts);
  }

  // ------------------------------------------------------------------ 格式化
  /** 人民币分 → ¥8 / ¥9.90 */
  // v2.5 定价：中文显示人民币，其它语言显示美元（与 catalog.priceUsd 对应）
  function uiLang() {
    try { return localStorage.getItem('cubbit.lang') || document.documentElement.lang || 'zh-CN'; } catch { return 'zh-CN'; }
  }
  /** 定价地区：界面语言 + 系统 locale 的国家（如 en + de-DE → 德国 EUR）；可用 localStorage cubbit.region 覆盖 */
  function priceLocale() {
    try { const o = localStorage.getItem('cubbit.region'); if (o) return o; } catch {}
    const lang = String(uiLang()); const nav = String((navigator && navigator.language) || '');
    if (/-[A-Za-z]{2}$/.test(lang)) return lang;
    const m = nav.match(/-([A-Za-z]{2})$/);
    return m ? lang.split('-')[0] + '-' + m[1] : lang;
  }
  function priceOf(cents) {
    const P = window.CubbitPricing;
    if (P) return P.displayCny(cents, priceLocale());
    const yuan = (Number(cents) || 0) / 100;
    return { currency: 'CNY', text: '¥' + (Number.isInteger(yuan) ? yuan : yuan.toFixed(2)) };
  }
  function formatMoney(cents) {
    const n = Number(cents);
    if (!Number.isFinite(n)) return '¥0';
    return priceOf(n).text;
  }

  /** 分 → 纯数字字符串（配合 currency() 前缀使用） */
  function currency() { const p = priceOf(0); return (window.CubbitPricing && window.CubbitPricing.SYMBOL[p.currency]) || '¥'; }
  function moneyNumber(cents) {
    return priceOf(Number(cents) || 0).text.replace(/^[^\d]+/, '');
  }

  /** 按地区价折算（如年付折合每月 = ratio 1/12） */
  function formatMoneyPart(cents, ratio) {
    const p = priceOf(Number(cents) || 0); const P = window.CubbitPricing;
    if (!P || !p.currency) return formatMoney(Math.round((Number(cents) || 0) * ratio));
    const dec = P.DECIMALS[p.currency] ? 1 : 100; // JPY/KRW 取整
    return P.format(Math.round(p.amount * ratio / dec) * dec, p.currency);
  }
  /** 地区价 a×mul − b，按 a 的币种格式化 */
  function formatRegionDiff(aCents, mul, bCents) {
    const P = window.CubbitPricing; const a = priceOf(aCents); const b = priceOf(bCents);
    if (!P || !a.currency) return formatMoney(aCents * mul - bCents);
    return P.format(Math.max(0, a.amount * mul - b.amount), a.currency);
  }
  function regionAmount(cents) { const p = priceOf(Number(cents) || 0); return p.amount !== undefined ? p.amount : Number(cents) || 0; }

  function parseMoneyInput(text) {
    const s = String(text || '').replace(/[^\d.]/g, '');
    if (!s) return 0;
    return Math.round(parseFloat(s) * 100);
  }

  /** 时间戳兼容「秒 / 毫秒 / 0」 */
  function toDate(ts) {
    const n = Number(ts);
    if (!n || !Number.isFinite(n)) return null;
    return new Date(n > 1e12 ? n : n * 1000);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** 2026-11-01 */
  function formatDate(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /** 2026-11-01 20:31 */
  function formatDateTime(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    return `${formatDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** 11 月 1 日 */
  function formatDateCn(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  /** 毫秒 → 12:34 / 1:02:03（用于倒计时） */
  function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
  }

  /** 分钟 → 「1 小时 20 分」 */
  function formatMinutes(min) {
    const m = Math.max(0, Math.round(Number(min) || 0));
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
  }

  /** 相对时间：刚刚 / 5 分钟前 / 3 天前 */
  function formatAgo(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /** 设备 ID 截断显示 */
  function shortId(id, head = 8, tail = 6) {
    const s = String(id || '');
    if (s.length <= head + tail + 3) return s || '—';
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
  }

  /** 复制到剪贴板（file:// 下 navigator.clipboard 可能不可用，退回 execCommand） */
  async function copyText(text) {
    const value = String(text ?? '');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* 继续兜底 */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function setSliderFill(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const val = Number(input.value || 0);
    const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${clamp(pct, 0, 100)}%`);
  }

  function debounce(fn, wait = 160) {
    let t = null;
    return function debounced(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn.apply(this, args);
      }, wait);
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  // ------------------------------------------------------------------ Toast
  let toastWrap = null;

  function ensureToastWrap() {
    if (toastWrap && document.body.contains(toastWrap)) return toastWrap;
    toastWrap = el('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastWrap);
    return toastWrap;
  }

  const TOAST_ICON = { ok: 'check-circle', err: 'warning', warn: 'warning', info: 'info' };

  function toast(message, type = 'info', ms = 2800) {
    const wrap = ensureToastWrap();
    const node = el(
      'div',
      { class: `toast toast--${type}` },
      icon(TOAST_ICON[type] || 'info'),
      el('span', { text: String(message ?? '') }),
    );
    wrap.appendChild(node);
    const timer = setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 240);
    }, Math.max(1200, ms));
    node.addEventListener('click', () => {
      clearTimeout(timer);
      node.remove();
    });
    return () => {
      clearTimeout(timer);
      node.remove();
    };
  }

  // ------------------------------------------------------------------ Modal
  let openModals = 0;

  /**
   * 通用弹窗。返回 { el, close, result }。
   * actions: [{ label, kind: 'primary'|'ghost'|'danger'|'teal', icon, value, onClick, autofocus }]
   */
  function modal(opts = {}) {
    const {
      title = '',
      desc = '',
      iconName = '',
      body = null,
      actions = [],
      wide = false,
      closable = true,
      dismissValue = null,
      onClose = null,
    } = opts;

    const previousFocus = document.activeElement;
    openModals += 1;

    const backdrop = el('div', { class: 'modal-backdrop', role: 'presentation' });
    const card = el('div', {
      class: 'modal' + (wide ? ' modal--wide' : ''),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title || '对话框',
    });

    const head = el('div', { class: 'modal__head' });
    if (iconName) {
      head.appendChild(
        el('div', { class: 'ico-tile' + (iconName === 'crown' || iconName === 'lock' ? ' ico-tile--gold' : '') }, icon(iconName)),
      );
    }
    const headText = el('div', { class: 'grow' });
    if (title) headText.appendChild(el('div', { class: 'h3', text: title }));
    if (desc) headText.appendChild(el('div', { class: 'card__desc', text: desc }));
    head.appendChild(headText);
    if (closable) {
      const closeBtn = el('button', { class: 'win-ctrl modal__close', type: 'button', title: '关闭', 'aria-label': '关闭' }, icon('x'));
      closeBtn.addEventListener('click', () => settle(dismissValue));
      head.appendChild(closeBtn);
    }
    card.appendChild(head);

    if (body) {
      if (body.nodeType) card.appendChild(body);
      else card.appendChild(el('div', { class: 'modal__body', text: String(body) }));
    }

    const foot = el('div', { class: 'modal__foot' });
    let resolved = false;
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    function settle(value) {
      if (resolved) return;
      resolved = true;
      openModals = Math.max(0, openModals - 1);
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      if (onClose) onClose(value);
      resolvePromise(value);
    }

    for (const action of actions) {
      const kind = action.kind || 'ghost';
      const cls = 'btn' + (kind === 'primary' ? ' btn--primary' : kind === 'teal' ? ' btn--teal' : kind === 'danger' ? ' btn--danger' : ' btn--ghost');
      const btn = el('button', { class: cls, type: 'button' }, action.icon ? icon(action.icon) : null, el('span', { text: action.label }));
      btn.addEventListener('click', async () => {
        if (action.onClick) {
          const keep = await action.onClick(btn);
          if (keep === true) return; // 由调用方自行关闭（如异步 loading）
        }
        settle(action.value !== undefined ? action.value : action.label);
      });
      foot.appendChild(btn);
    }
    if (actions.length) card.appendChild(foot);

    backdrop.appendChild(card);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && closable) settle(dismissValue);
    });

    function onKey(event) {
      if (event.key === 'Escape' && closable) {
        event.stopPropagation();
        settle(dismissValue);
      }
    }
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);

    const autofocus = actions.find((a) => a.autofocus);
    const focusTarget = autofocus ? foot.children[actions.indexOf(autofocus)] : card.querySelector('.modal__foot .btn:last-child');
    if (focusTarget && focusTarget.focus) setTimeout(() => focusTarget.focus(), 30);

    return { el: card, close: () => settle(dismissValue), result: promise };
  }

  function confirmModal(opts = {}) {
    const { title = '确认操作', desc = '', confirmLabel = '确认', cancelLabel = '取消', danger = false } = opts;
    return modal({
      title,
      desc,
      iconName: danger ? 'warning' : 'info',
      actions: [
        { label: cancelLabel, kind: 'ghost', value: false },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true, autofocus: true },
      ],
      dismissValue: false,
    }).result;
  }

  function alertModal(opts = {}) {
    return modal({
      title: opts.title || '提示',
      desc: opts.desc || '',
      iconName: opts.iconName || 'info',
      body: opts.body || null,
      actions: [{ label: opts.okLabel || '知道了', kind: 'primary', value: true, autofocus: true }],
    }).result;
  }

  /** 只读长文本弹窗（EULA / 隐私政策等内置文案） */
  function textModal({ title, paragraphs = [], okLabel = '我明白了' }) {
    const body = el('div', { class: 'modal__body legal' });
    for (const p of paragraphs) {
      if (typeof p === 'string') body.appendChild(el('p', { text: p }));
      else if (p.heading) body.appendChild(el('h4', { class: 'h4 mt-8 mb-6', text: p.heading }));
      else if (p.li) body.appendChild(el('div', { class: 'legal__li', text: '· ' + p.li }));
    }
    return modal({
      title,
      body,
      wide: true,
      actions: [{ label: okLabel, kind: 'primary', value: true, autofocus: true }],
    }).result;
  }

  // ---------------------------------------------------------------- 面板应用
  function detectTransport() {
    if (window.cubbit && window.cubbit.panel) return { real: true, panel: window.cubbit.panel };
    if (window.__cubbitMock) return { real: false, panel: window.__cubbitMock };
    return null;
  }

  const LICENSE_STATES = {
    pro: { label: 'Pro 会员', cls: 'badge--pro', icon: 'crown' },
    trial: { label: '内测版', cls: 'badge--trial', icon: 'sparkle' },
    expired: { label: '体验已结束', cls: 'badge--locked', icon: 'lock' },
    unlicensed: { label: '未激活', cls: 'badge--locked', icon: 'lock' },
  };

  function licenseBadge(license, ui) {
    const state = (license && license.state) || 'unlicensed';
    const meta = LICENSE_STATES[state] || LICENSE_STATES.unlicensed;
    let text = meta.label;
    if (state === 'pro') {
      text = (license && license.planName) || 'Pro 会员';
      if (license && license.expiresAt) {
        text += ' · ' + formatDate(license.expiresAt) + ' 到期';
      } else if (state === 'pro') {
        text += ' · 永久';
      }
    } else if (state === 'trial') {
      const days = (ui && ui.trialDaysLeft) || (license && license.trialDaysLeft) || 0;
      text = `内测版 · 剩余 ${days} 天`;
    }
    return { text, cls: meta.cls, icon: meta.icon, state };
  }

  /** 面板主控 */
  class PanelApp {
    constructor() {
      this.panel = null;
      this.isMock = false;
      this.state = null;
      this.ready = false;
      this._handlers = new Set();
      this._navHandlers = new Set();
      this._unsub = [];
    }

    // --- 生命周期 ---
    async boot(opts = {}) {
      const transport = detectTransport();
      if (!transport) {
        this._renderFatal();
        return null;
      }
      this.panel = transport.panel;
      this.isMock = !transport.real;

      try {
        if (this.panel.onState) {
          const off = this.panel.onState((snapshot) => this._applyState(snapshot));
          if (typeof off === 'function') this._unsub.push(off);
        }
        if (this.panel.onNav) {
          const off = this.panel.onNav((payload) => {
            for (const fn of this._navHandlers) fn(payload);
          });
          if (typeof off === 'function') this._unsub.push(off);
        }
      } catch (err) {
        console.warn('[panel] 订阅事件失败', err);
      }

      let state = null;
      try {
        state = await this.panel.init();
      } catch (err) {
        console.error('[panel] init 失败', err);
        toast('无法读取应用状态：' + (err && err.message ? err.message : err), 'err', 5000);
      }
      if (state) this._applyState(state);
      this.ready = true;
      if (opts.onReady) opts.onReady(this.state);
      if (this.isMock && !(this.panel && this.panel.quiet)) {
        toast('浏览器预览模式（演示数据）', 'info', 3200);
      }
      return this.state;
    }

    _applyState(state) {
      if (!state) return;
      this.state = state;
      document.body.dataset.license = (state.license && state.license.state) || 'unlicensed';
      document.body.classList.toggle('is-pro', !!(state.ui && state.ui.isPro));
      document.body.classList.toggle('reduce-motion', !!(state.settings && state.settings.reduceMotion));
      // 注意：系统强调色只作为次级变量暴露（--sys-accent），品牌主色始终是蜜橘 #ef7a52，
      // 否则 Windows 蓝色强调色会把整个面板的产品感冲掉。
      if (state.theme && state.theme.accent) {
        document.documentElement.style.setProperty('--sys-accent', state.theme.accent);
      }
      for (const fn of this._handlers) {
        try {
          fn(state, this);
        } catch (err) {
          console.error('[panel] 状态回调解异常', err);
        }
      }
    }

    onState(fn) {
      this._handlers.add(fn);
      if (this.state) fn(this.state, this);
      return () => this._handlers.delete(fn);
    }

    onNav(fn) {
      this._navHandlers.add(fn);
      return () => this._navHandlers.delete(fn);
    }

    get ui() {
      return (this.state && this.state.ui) || { isPro: false, isTrial: false, trialDaysLeft: 0 };
    }

    /** 是否已解锁全部 Pro 能力（主进程语义：Pro 与体验期都为 true） */
    get isPro() {
      return !!this.ui.isPro;
    }

    /** 许可证原始状态：pro / trial / expired / unlicensed */
    get licenseState() {
      return (this.state && this.state.license && this.state.license.state) || 'unlicensed';
    }

    /** 是否为「已付费购买」的 Pro（体验期不算），用于 CTA 文案区分升级 / 续费 */
    get isPaid() {
      return this.licenseState === 'pro';
    }

    get isTrial() {
      return this.licenseState === 'trial';
    }

    /** 统一 invoke：容错 + FEATURE_LOCKED 统一升级引导 */
    async invoke(channel, payload, opts = {}) {
      if (!this.panel) return { ok: false, code: 'NO_TRANSPORT', message: '面板未初始化' };
      try {
        const res = await this.panel.invoke(channel, payload || {});
        if (res && res.ok === false && res.code === 'FEATURE_LOCKED' && opts.gate !== false) {
          this.showUpgrade(res.feature, res.message);
        }
        return res || { ok: false, code: 'EMPTY', message: '没有返回结果' };
      } catch (err) {
        console.error('[invoke]', channel, err);
        return {
          ok: false,
          code: 'IPC_FAILED',
          message: '与主进程通信失败：' + (err && err.message ? err.message : err),
        };
      }
    }

    async refresh() {
      if (!this.panel) return null;
      try {
        const state = await this.panel.state();
        if (state) this._applyState(state);
        return state;
      } catch (err) {
        console.warn('[panel] 刷新状态失败', err);
        return null;
      }
    }

    // --- 窗口动作（window.cubbit.panel 作为兜底，2026-11-04 修复关闭无效） ---
    bridge() {
      if (this.panel && this.panel.close) return this.panel;
      if (typeof window !== 'undefined' && window.cubbit && window.cubbit.panel) return window.cubbit.panel;
      return this.panel || null;
    }

    winAction(action) {
      try {
        const b = this.bridge();
        if (b && b.window) b.window(action);
        else if (b && b.close && action === 'close') b.close();
      } catch (err) {
        console.warn('[window]', action, err);
      }
    }

    close() {
      try {
        const b = this.bridge();
        if (b && b.close) { b.close(); return; }
        if (b && b.window) { b.window('close'); return; }
        window.close();
      } catch (err) {
        console.warn('[close]', err);
      }
    }

    openPanel(name) {
      try {
        const b = this.bridge();
        if (b && b.openPanel) b.openPanel(name);
      } catch (err) {
        console.warn('[openPanel]', name, err);
      }
    }

    async openExternal(url) {
      const value = String(url || '');
      if (!/^https?:\/\//i.test(value)) {
        toast('该链接需要在浏览器中打开，但地址无效', 'warn');
        return false;
      }
      const res = await this.invoke(IPC.APP_OPEN_EXTERNAL, { url }, { gate: false });
      if (res && res.ok === false) toast('无法打开链接，请手动访问：' + value, 'err', 4200);
      return !!(res && res.ok);
    }

    // --- 升级引导 ---
    showUpgrade(featureKey, message) {
      const state = this.state || {};
      const features = state.features || {};
      const info = featureKey && features[featureKey];
      const tier = (state.ui && state.ui.tier) || '';
      const lic = state.license || {};
      const ownsBase = !!(lic.baseOwned || lic.state === 'base' || lic.state === 'ai' || lic.state === 'couple' || (lic.features && lic.features.skins_premium));
      const isAiFeature = /^ai_/.test(featureKey || '');
      const isCouple = featureKey === 'couple_mode';
      const title = info && info.name ? (isAiFeature ? `「${info.name}」需要 AI 订阅` : `「${info.name}」需要升级`) : '解锁完整功能';
      const desc =
        (info && info.desc) ||
        message ||
        (isAiFeature ? '完整版含每天 50 轮 AI；AI 订阅可不限次数。' : '免费版可以一直用；完整版一次买断，解锁全部功能。');

      const body = el('div', { class: 'upgrade-body' });
      const benefits = isAiFeature
        ? [
            { icon: 'sparkle', text: 'AI 无限对话' },
            { icon: 'crown', text: '含完整版全部权益' },
          ]
        : isCouple
          ? [
              { icon: 'users', text: '情侣模式与双人席位' },
              { icon: 'heart', text: '共享纪念日与情话' },
              { icon: 'crown', text: '含完整版全部权益' },
            ]
          : [
              { icon: 'palette', text: '全部基础皮肤' },
              { icon: 'heart', text: '情侣模式 · 生命系统' },
              { icon: 'sparkle', text: '每天 50 轮 AI' },
            ];
      const list = el('div', { class: 'upgrade-list' });
      for (const b of benefits) {
        list.appendChild(
          el('div', { class: 'upgrade-item' }, el('div', { class: 'ico-tile ico-tile--sm ico-tile--gold' }, icon(b.icon)), el('span', { text: b.text })),
        );
      }
      body.appendChild(list);

      // 四选一：完整版 / AI 月 / AI 年 / 情侣（按 state.plans 动态生成，不硬编码价格）
      const plans = Array.isArray(state.plans) ? state.plans : [];
      const tierKey = (p) => {
        if (!p) return '';
        if (p.id === 'base') return 'base';
        if (p.grants && p.grants.aiUnlimited) return 'ai';
        if (p.id === 'couple_year' || Number(p.seats) > 1) return 'couple';
        return p.id;
      };
      const options = plans.filter((p) => ['base', 'ai', 'couple'].includes(tierKey(p)));
      const pick = el('div', { class: 'upgrade-plans' });
      const order = { base: 0, ai: 1, couple: 2 };
      options
        .slice()
        .sort((a, b) => order[tierKey(a)] - order[tierKey(b)] || (a.period === 'year' ? -1 : 1))
        .forEach((plan) => {
          const key = tierKey(plan);
          const owned =
            key === 'base'
              ? ownsBase
              : key === 'ai'
                ? lic.state === 'ai' || (lic.features && lic.features.ai_unlimited)
                : lic.state === 'couple' || Number(lic.seats) > 1;
          const isRecommended = (key === 'base' && !ownsBase) || (isAiFeature && key === 'ai' && plan.period === 'year');
          const btn = el(
            'button',
            { class: 'upgrade-plan' + (isRecommended ? ' is-recommended' : ''), type: 'button', disabled: owned },
            el(
              'div',
              { class: 'upgrade-plan__main' },
              el('div', { class: 'upgrade-plan__name' }, el('span', { text: plan.name }), owned ? el('span', { class: 'tag tag--teal', text: '已拥有' }) : null),
              el('div', { class: 'upgrade-plan__note', text: plan.badge || (plan.period === 'month' ? '按月订阅，可随时取消' : plan.period === 'year' ? '年付更划算' : '一次买断，永久有效') }),
            ),
            el(
              'div',
              { class: 'upgrade-plan__price' },
              el('span', { class: 'upgrade-plan__cur', text: currency() }),
              el('span', { class: 'num', text: String(Math.round((plan.price || 0) / 100)) }),
              el('span', { class: 'upgrade-plan__per', text: plan.period === 'once' ? '' : plan.period === 'year' ? '/年' : '/月' }),
            ),
          );
          btn.addEventListener('click', () => {
            this.close();
            this.openPanel('store');
          });
          pick.appendChild(btn);
        });
      if (options.length) body.appendChild(el('div', { class: 'upgrade-plans__title', text: '选择解锁方式' }));
      body.appendChild(pick);

      modal({
        title,
        desc,
        iconName: isAiFeature ? 'sparkle' : 'crown',
        body,
        actions: [
          { label: '以后再说', kind: 'ghost', value: false },
          {
            label: '查看全部方案',
            kind: 'primary',
            icon: 'arrow-right',
            onClick: () => {
              this.openPanel('store');
            },
            value: true,
          },
        ],
      });
      return true;
    }
    /** 若该功能需要 Pro 且当前非 Pro，则弹升级引导并返回 false */
    requirePro(featureKey) {
      if (this.isPro) return true;
      this.showUpgrade(featureKey);
      return false;
    }

    _renderFatal() {
      const wrap = el(
        'div',
        { class: 'fatal' },
        el('div', { class: 'brand-mark' }, icon('cube')),
        el('h2', { class: 'h2 mt-16', text: '请在 方块仔 应用内打开此面板' }),
        el('p', { class: 'muted mt-8', text: '这个页面依赖主进程提供的状态与命令通道，直接双击 HTML 无法完整运行。' }),
      );
      document.body.appendChild(wrap);
    }
  }

  // ------------------------------------------------------------- 标题栏构造
  /**
   * mountTitlebar({ page, subtitle, right, showMax })
   * 生成品牌 + 页面名 + 右侧插槽 + 最小化/关闭（frame:false 窗口自绘）。
   */
  function mountTitlebar(app, opts = {}) {
    const { page = '', subtitle = '', right = [], showMax = false, brandName = '方块仔', brandSub = true, brandSubText = '方块仔' } = opts;
    const brand = el(
      'div',
      { class: 'titlebar__brand' },
      el('div', { class: 'brand-mark' }, icon('cube')),
      el(
        'div',
        { class: 'titlebar__titles' },
        el('div', { class: 'brand-name', text: brandName }),
        brandSub ? el('div', { class: 'brand-sub', text: brandSubText }) : null,
      ),
    );
    const left = el('div', { class: 'titlebar__left' }, brand);
    if (page) {
      left.appendChild(el('span', { class: 'titlebar__sep', 'aria-hidden': 'true' }));
      left.appendChild(el('span', { class: 'titlebar__page', text: page }));
    }
    if (subtitle) left.appendChild(el('span', { class: 'titlebar__sub', text: subtitle }));

    const rightSlot = el('div', { class: 'titlebar__right' });
    for (const node of right) rightSlot.appendChild(node);

    const minBtn = el('button', { class: 'win-ctrl', type: 'button', title: '最小化', 'aria-label': '最小化' }, icon('minus'));
    minBtn.addEventListener('click', () => app.winAction('minimize'));
    const closeBtn = el('button', { class: 'win-ctrl win-ctrl--close', type: 'button', title: '关闭', 'aria-label': '关闭' }, icon('x'));
    closeBtn.addEventListener('click', () => app.close());
    rightSlot.appendChild(minBtn);
    if (showMax) {
      const maxBtn = el('button', { class: 'win-ctrl', type: 'button', title: '最大化', 'aria-label': '最大化' }, icon('square'));
      maxBtn.addEventListener('click', () => app.winAction('maximize'));
      rightSlot.appendChild(maxBtn);
    }
    rightSlot.appendChild(closeBtn);

    const bar = el('header', { class: 'titlebar' }, left, el('div', { class: 'titlebar__spacer' }), rightSlot);
    return { bar, rightSlot, left };
  }

  /** 把许可证徽标做成 DOM 节点 */
  function licenseBadgeNode(license, ui) {
    const info = licenseBadge(license, ui);
    const node = el('span', { class: 'badge ' + info.cls }, icon(info.icon), el('span', { text: info.text }));
    node.dataset.state = info.state;
    return node;
  }

  /** 服务器在线状态节点 */
  function serverStatusNode(server) {
    const online = !!(server && server.online);
    return el(
      'span',
      { class: 'badge ' + (online ? 'badge--ok' : 'badge--danger') },
      el('span', { class: 'dot ' + (online ? 'dot--ok' : 'dot--bad') }),
      el('span', { text: online ? '许可服务在线' : '许可服务离线' }),
    );
  }

  /** 把键盘事件翻译成 Electron accelerator（Control+Shift+H） */
  function acceleratorFromEvent(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('Control');
    if (event.metaKey) parts.push('Command');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    const code = event.code || '';
    const key = event.key || '';
    const MODIFIER_ONLY = ['Control', 'Shift', 'Alt', 'Meta', 'ContextMenu'];
    if (MODIFIER_ONLY.includes(key)) return parts.length ? parts.join('+') + '+…' : '…';
    let main = '';
    if (/^Key[A-Z]$/.test(code)) main = code.slice(3);
    else if (/^Digit\d$/.test(code)) main = code.slice(5);
    else if (/^F\d{1,2}$/.test(code)) main = code;
    else if (code === 'Space') main = 'Space';
    else if (/^(Arrow(Up|Down|Left|Right))$/.test(code)) main = code.replace('Arrow', '');
    else if (['Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Backquote', 'BracketLeft', 'BracketRight', 'Backslash'].includes(code)) {
      main = key.length === 1 ? key.toUpperCase() : '';
    } else if (key.length === 1) main = key.toUpperCase();
    if (!main) return parts.length ? parts.join('+') + '+…' : '…';
    parts.push(main);
    return parts.join('+');
  }

  /** 展示用：Control+Shift+H → Ctrl + Shift + H */
  function prettyAccelerator(accel) {
    return String(accel || '')
      .replace(/Control/g, 'Ctrl')
      .split('+')
      .join(' + ');
  }

  // ------------------------------------------------------- 状态感知 / 情侣辅助
  /** 主人（或伴侣）状态：kind → 中文文案 + 图标 + 色调 */
  const PRESENCE_KINDS = {
    working: { label: '工作中', icon: 'monitor', tone: 'ok' },
    coding: { label: '敲代码中', icon: 'monitor', tone: 'ok' },
    meeting: { label: '开会中', icon: 'users', tone: 'warn' },
    watching: { label: '看剧中', icon: 'monitor', tone: 'teal' },
    cinema: { label: '观影中', icon: 'monitor', tone: 'teal' },
    focus: { label: '专注中', icon: 'timer', tone: 'teal' },
    gaming: { label: '游戏中', icon: 'bolt', tone: 'warn' },
    away: { label: '离开了', icon: 'moon', tone: 'muted' },
    idle: { label: '发呆中', icon: 'moon', tone: 'muted' },
    sleeping: { label: '睡觉中', icon: 'moon2', tone: 'muted' },
    offline: { label: '离线', icon: 'wifi-off', tone: 'muted' },
    free: { label: '有空', icon: 'coffee', tone: 'ok' },
  };

  function presenceInfo(presence) {
    const p = presence || {};
    const kind = p.kind || 'free';
    const meta = PRESENCE_KINDS[kind] || { label: '在线', icon: 'sparkle', tone: 'ok' };
    return {
      kind,
      label: meta.label,
      icon: meta.icon,
      tone: meta.tone,
      title: p.title || meta.label,
      app: p.app || '',
      fullscreen: !!p.fullscreen,
      cinemaMode: !!p.cinemaMode,
    };
  }

  /** 状态胶囊：小圆点 + 中文状态（可用于伴侣在线态 / 主人状态） */
  function presenceBadge(presence, opts) {
    const info = presenceInfo(presence);
    const offline = !!(opts && opts.offline);
    const toneDot = offline ? 'dot' : info.tone === 'muted' ? 'dot dot--warn' : 'dot dot--ok';
    return el(
      'span',
      { class: 'badge ' + (offline ? 'badge--locked' : info.tone === 'teal' ? 'badge--trial' : 'badge--ok') },
      el('span', { class: toneDot }),
      el('span', { text: offline ? '离线' : info.label }),
    );
  }

  /** 聊天时间 HH:MM */
  function formatClock(ts) {
    const d = toDate(ts);
    if (!d) return '';
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** 恋爱值 0-1000 → 百分比 */
  function affectionPercent(value) {
    return clamp((Number(value) || 0) / 10, 0, 100);
  }
  // -------------------------------------------------------------- 版本与文案
  const LEGAL = {
    eula: {
      title: '最终用户许可协议（EULA）',
      paragraphs: [
        { heading: '1. 授权范围' },
        '方块仔授予你个人的、不可转让的、非独占的使用许可。一份 Pro 授权可供同一自然人名下最多 2 台设备使用；团队或商业场所的多机部署需要单独购买授权。',
        { heading: '2. 试用' },
        '首次启动自动开启 7 天完整功能体验，无需注册、无需绑定手机号。体验结束后，免费版仍可继续使用基础皮肤与桌面陪伴功能。',
        { heading: '3. 限制' },
        '不得对软件进行反向工程、反编译、二次分发、出租或出售；不得移除授权校验逻辑。违反上述条款可能导致授权被吊销。',
        { heading: '4. 退款' },
        '购买后 7 天内，若软件无法在你的设备上正常运行且我们无法协助解决，可申请全额退款。永久买断版适用同一规则。',
        { heading: '5. 数据与隐私' },
        '授权校验仅使用设备指纹与激活时间，不采集硬件信息、屏幕内容或使用行为。详见《隐私政策》。',
        { heading: '6. 免责' },
        '本软件按「现状」提供。在法律允许的最大范围内，我们不对因使用本软件导致的间接损失承担责任。',
      ],
    },
    privacy: {
      title: '隐私政策',
      paragraphs: [
        { heading: '我们收集什么' },
        '· 设备指纹（deviceId）：由机器标识与用户名哈希而来，用于设备绑定与试用防刷。',
        '· 授权信息：激活码、计划类型、激活时间、到期时间。',
        '· 你主动填写的邮箱：仅用于发送购买凭证与重要通知，可随时要求删除。',
        { heading: '我们不收集什么' },
        '不收集屏幕内容、键盘输入、剪贴板、浏览记录、地理位置，也不包含任何第三方统计或广告 SDK。',
        { heading: '数据存放' },
        '授权数据存放于许可服务器；桌面端的设置、专注记录与成长数据全部保存在本机（userData 目录），卸载时可选择是否保留。',
        { heading: '你的权利' },
        '你可以随时在「设置 → 我的授权」解除本机绑定，或联系 support@cubbit.app 要求删除账户与授权记录。',
        { heading: '离线宽限' },
        '客户端缓存最近一次授权校验结果，最多 30 天可在离线状态下使用 Pro 功能。',
      ],
    },
    refund: {
      title: '退款政策',
      paragraphs: [
        '购买后 7 天内，如果 方块仔 无法在你的设备上正常运行，且支持团队无法协助解决，我们提供全额退款。',
        { heading: '如何申请' },
        '发送邮件至 support@cubbit.app，附上订单号（可在「商店 → 我的授权」查看）与问题描述。我们通常在 2 个工作日内回复。',
        { heading: '不适用的情况' },
        '· 已超过 7 天；· 授权密钥已用于 2 台以上设备；· 因违反 EULA 导致的授权吊销。',
        { heading: '订阅取消' },
        '月付/年付方案可随时取消，取消后到期自动降级为免费版，已产生的费用不按比例退还。',
      ],
    },
  };

  function legalModal(kind) {
    const doc = LEGAL[kind] || LEGAL.eula;
    return textModal({ title: doc.title, paragraphs: doc.paragraphs });
  }

  // ---------------------------------------------------------------- 导出
  window.CubbitUI = {
    IPC,
    EVENTS,
    icon,
    icons: ICONS,
    $,
    $$,
    el,
    on,
    clear,
    toast,
    modal,
    confirm: confirmModal,
    alert: alertModal,
    textModal,
    legalModal,
    LEGAL,
    formatMoney,
    moneyNumber,
    currency,
    priceLocale,
    formatMoneyPart,
    regionAmount,
    formatRegionDiff,
    parseMoneyInput,
    formatDate,
    formatDateTime,
    formatDateCn,
    formatDuration,
    formatMinutes,
    formatAgo,
    shortId,
    copyText,
    clamp,
    pad2,
    setSliderFill,
    debounce,
    sleep,
    licenseBadge,
    licenseBadgeNode,
    serverStatusNode,
    presenceInfo,
    presenceBadge,
    formatClock,
    affectionPercent,
    acceleratorFromEvent,
    prettyAccelerator,
    mountTitlebar,
    PanelApp,
    createApp: () => new PanelApp(),
  };
})();
