/**
 * IPC 契约 — 主进程 / 预加载 / 渲染层共用的通道名。
 * 任何新增通道都必须同时更新：preload/*.js 的暴露白名单、main/ipc.js 的 handler。
 */
const INVOKE = {
  APP_STATE: 'app:state',
  APP_QUIT: 'app:quit',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_PANEL_OPEN: 'app:panel:open',
  APP_PANEL_WINDOW: 'app:panel:window',
  APP_SETTINGS_SET: 'app:settings:set',
  SKIN_PREVIEW: 'skin:preview',
  APP_SETTINGS_RESET: 'app:settings:reset',

  PET_SET_IGNORE_MOUSE: 'pet:set-ignore-mouse',
  PET_DRAG_START: 'pet:drag-start',
  PET_DRAG_END: 'pet:drag-end',
  PET_MOVE: 'pet:move',
  PET_BOUNDS: 'pet:bounds',
  PET_CURSOR: 'pet:cursor',
  PET_INTERACTION: 'pet:interaction',
  PET_CONTEXT_MENU: 'pet:context-menu',
  PET_SAY: 'pet:say',
  PET_RESET_POSITION: 'pet:reset-position',
  PET_HITBOXES: 'pet:hitboxes',
  PET_DRAG_RESULT: 'pet:drag-result',
  PET_CINEMA: 'pet:cinema',
  TTS_SPEAK: 'tts:speak',
  TTS_VOICES: 'tts:voices',
  TTS_TEST: 'tts:test',
  TTS_LAST: 'tts:last',
  VOICE_LISTEN: 'voice:listen',

  PRESENCE_GET: 'presence:get',

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
  COUPLE_SCENE_GET: 'couple-scene:get',
  COUPLE_SCENE_SET: 'couple-scene:set',
  COUPLE_PLUS_GET: 'couple-plus:get',
  COUPLE_PLUS_ACT: 'couple-plus:act',
  COUPLE_PLUS_SET: 'couple-plus:set',
  COUPLE_PLUS_TASK: 'couple-plus:task',
  COUPLE_PLUS_SKIN: 'couple-plus:skin',
  COUPLE_PLUS_VOICE: 'couple-plus:voice',
  MEMORY_GET: 'memory:get',
  PAID_CALL: 'paid:call',
  FARM_CALL: 'farm:call',
  MEMORY_DELETE: 'memory:delete',
  CARE_TICK: 'care:tick',
  INTIMACY_GET: 'intimacy:get',
  LANG_SUPPORT: 'plus:lang-support',
  LANG_OPEN_SETTINGS: 'plus:open-lang-settings',
  COUPLE_SCENE_CAPTURE: 'couple-scene:capture',

  // 智慧生命
  LIFE_STATUS: 'life:status',
  LIFE_INTERACT: 'life:interact',

  // AI 对话（Pro）
  AI_STATUS: 'ai:status',
  AI_CHAT: 'ai:chat',
  AI_TEST: 'ai:test',
  AI_CONFIG_SET: 'ai:config:set',
  AI_HISTORY_GET: 'ai:history:get',
  AI_HISTORY_CLEAR: 'ai:history:clear',

  // 更新 / 崩溃上报
  UPDATE_STATUS: 'update:status',
  UPDATE_CHECK: 'update:check',
  UPDATE_OPEN: 'update:open',
  UPDATE_SET: 'update:set',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  CRASH_STATUS: 'crash:status',
  CRASH_TAIL: 'crash:tail',
  CRASH_CLEAR: 'crash:clear',

  // 数据备份 / 加密云同步
  BACKUP_INFO: 'backup:info',
  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',
  BACKUP_SYNC_PUSH: 'backup:sync:push',
  BACKUP_SYNC_PULL: 'backup:sync:pull',
  BACKUP_SYNC_DELETE: 'backup:sync:delete',
  // 实时情侣联机（PubNub + Firebase，替换演示伴侣）
  COUPLE_RT_STATUS: 'couple-rt:status',
  COUPLE_RT_INVITE: 'couple-rt:invite',
  COUPLE_RT_ACCEPT: 'couple-rt:accept',
  COUPLE_RT_UNPAIR: 'couple-rt:unpair',
  COUPLE_RT_INTERACT: 'couple-rt:interact',
  COUPLE_RT_NOTE: 'couple-rt:note',
  COUPLE_RT_FOCUS: 'couple-rt:focus',
  COUPLE_RT_CHECKIN: 'couple-rt:checkin',
  COUPLE_RT_ACCOUNT: 'couple-rt:account',
  COUPLE_RT_VOICE: 'couple-rt:voice',
  COUPLE_RT_MESSAGES: 'couple-rt:messages',
  // 人生账本（性价比人生 · 一天一步）
  LIFE_STATE: 'life:state',
  LIFE_CHOOSE: 'life:choose',
  LIFE_RESTART: 'life:restart',
  LIFE_DUO: 'life:duo',
  LIFE_HAND: 'life:hand',

  // 照片宠物（拍一张路边的小动物 → 变成桌宠）
  PET_PHOTO_LIST: 'pet:photo:list',
  PET_PHOTO_FORGE: 'pet:photo:forge',
  PET_PHOTO_REMOVE: 'pet:photo:remove',

  // 分享（站点落地页 + X / Facebook / 微博 / Telegram）
  SHARE_INFO: 'share:info',
  SHARE_CARD: 'share:card',
  SHARE_TEXT: 'share:text',
  SHARE_OPEN: 'share:open',

  // 宠物相亲（写需求 → 匹配 → 双方认可 → 恋爱）
  MATE_STATE: 'mate:state',
  MATE_SEEK: 'mate:seek',
  MATE_PROPOSE: 'mate:propose',
  MATE_RETRY: 'mate:retry',
  MATE_CONFIRM: 'mate:confirm',
  MATE_BREAKUP: 'mate:breakup',
};

const EVENTS = {
  STATE_CHANGED: 'state:changed',
  PET_EVENT: 'pet:event',
  COUPLE_SCENE: 'couple:scene',
  PET_CURSOR: 'pet:cursor',
  PANEL_NAV: 'panel:nav',
  AI_MESSAGE: 'ai:message',
  COUPLE_RT: 'couple-rt:event',
  MATE_CHANGED: 'mate:changed',
};

module.exports = { INVOKE, EVENTS };
