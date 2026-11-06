/**
 * v2.4 Lite 产品定位（UMD）：
 *
 *   你们俩桌面上，同一只方块仔。你戳一下，TA 那边会跳一下。
 *
 * 减法原则：设置页只留 5 个分区。
 *   - 农场 / 情侣房间 / 专注 / AI / 成长 / 办公 / 备份 的代码仍然在，只是不再出现在 UI 里；
 *   - 想把某个分区放回来，把 id 加进 LITE_SECTIONS 即可（一行改动）；
 *   - 加回来之前请确认它有对应的主进程能力，否则会出现空面板。
 *
 * 为什么要减：每多一个入口，「这是一只你们俩共有的小家伙」这个认知就被稀释一次。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubbitNav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LITE_MODE = true;

  const ALL_SECTIONS = [
    { id: 'couple', label: '我们俩', icon: 'ring', pro: 'couple_mode', primary: true },
    { id: 'appearance', label: '外观', icon: 'palette' },
    { id: 'interaction', label: '交互', icon: 'keyboard' },
    { id: 'growth', label: '成长', icon: 'heart', pro: 'growth' },
    { id: 'life', label: '生命', icon: 'sparkle', pro: 'life_system' },
    { id: 'ai', label: 'AI 陪伴', icon: 'chat', pro: 'ai_chat' },
    { id: 'member', label: '会员与商店', icon: 'sparkle' },
    { id: 'focus', label: '专注', icon: 'timer', group: 'tools' },
    { id: 'office', label: '办公助手', icon: 'keyboard', group: 'tools' },
    { id: 'backup', label: '数据与备份', icon: 'shield' },
    { id: 'system', label: '系统', icon: 'sliders' },
    { id: 'about', label: '关于', icon: 'info' },
  ];

  /** Lite 保留的分区（顺序即展示顺序）；系统/关于合并进「关于」一页 */
  const LITE_SECTION_IDS = ['couple', 'ai', 'appearance', 'interaction', 'member', 'about'];

  const SETTINGS_SECTIONS = LITE_MODE
    ? ALL_SECTIONS.filter((s) => LITE_SECTION_IDS.includes(s.id))
    : ALL_SECTIONS;

  const GROUPS = { tools: { label: '更多工具', collapsedByDefault: true } };
  const DEFAULT_SECTION = 'couple';

  /**
   * 桌宠右键菜单里的情侣手势（与 couple/protocol ACTIONS 一致）。
   * 保留全部 7 个：它们不是「功能」，是一秒就能发出的「表情」——这正是产品的核心。
   */
  const COUPLE_MENU_ACTIONS = [
    ['poke', '👉 戳一下'], ['heart', '💗 比心'], ['hug', '🤗 抱抱'], ['kiss', '😘 亲亲'],
    ['highfive', '🙌 击掌'], ['holdhands', '🤝 牵手'], ['goodnight', '🌙 晚安'],
  ];

  return { LITE_MODE, SETTINGS_SECTIONS, GROUPS, DEFAULT_SECTION, COUPLE_MENU_ACTIONS };
});
