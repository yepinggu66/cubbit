/**
 * v2.4 Lite 托盘菜单：只留「让人每天还会回来」的几项。
 *
 * 保留：显示/隐藏、情侣面板、皮肤、观影模式、商店、设置、退出。
 * 移除：专注、办公助手、语音对话、小农场（模块仍在，见 shared/nav-layout.js 的说明）。
 *
 * 菜单标签做中/英双语：i18n 词典里没有的新文案走 L() 兜底，保证英文系统不会看到中文。
 */
const path = require('node:path');
const { Tray, Menu, nativeImage } = require('electron');
const { SKINS, PRODUCT } = require('../shared/catalog');
const I18N = require('../shared/i18n');

let tray = null;

function trayImage(unread = false) {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'resources', unread ? 'tray-unread.png' : 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function buildMenu(rt) {
  const license = rt.license.getStatus();
  const state = rt.stateSnapshot();
  const petVisible = rt.windows.petVisible;
  const lang = rt.settings.get('language') || 'zh-CN';
  const zh = String(lang).toLowerCase().startsWith('zh');
  const L = (a, b) => (zh ? a : b);

  const skinItems = SKINS.map((s) => ({
    label: `${rt.skinUnlocked(s) ? '' : '🔒 '}${s.name}${state.settings.skinId === s.id ? '  ✓' : ''}`,
    click: () => {
      if (!rt.skinUnlocked(s)) {
        if (rt.previewSkin) rt.previewSkin(s.id);
        rt.openPanel('store');
        return;
      }
      rt.applySettings({ skinId: s.id });
    },
  }));

  return Menu.buildFromTemplate(
    I18N.trMenu(lang, [
      {
        label: L('🚶 绕桌面走一圈', '🚶 Walk around desktop'),
        click: () => rt.windows.roam(),
      },
      {
        label: petVisible ? L('隐藏方块仔', 'Hide Cubbit') : L('显示方块仔', 'Show Cubbit'),
        accelerator: (rt.settings.get('hotkeys') && rt.settings.get('hotkeys').toggle) || 'Control+Shift+H',
        click: () => rt.windows.togglePet(),
      },
      {
        label: rt.coupleUnread > 0
          ? L(`💌 ${rt.coupleUnread} 条新悄悄话`, `💌 ${rt.coupleUnread} new note(s)`)
          : L(`💞 我们俩${state.couple && state.couple.enabled ? ' · 已配对' : ''}`, '💞 Us two'),
        click: () => rt.openPanel('couple'),
      },
      { label: L('🧸 摸摸它', '🧸 Pet it'), click: () => rt.sendPetEvent('interact', { type: 'pet' }) },
      { label: L('🍪 喂点吃的', '🍪 Feed it'), click: () => rt.feedFromMenu && rt.feedFromMenu() },
      { type: 'separator' },
      { label: L('皮肤', 'Skins'), submenu: skinItems },
      {
        label: state.ui.cinemaMode ? L('退出观影模式', 'Exit cinema mode') : L('观影模式（只留眼睛）', 'Cinema mode (eyes only)'),
        click: () => rt.toggleCinema(),
      },
      { label: L('📤 导出内测数据', '📤 Export test data'), click: () => rt.exportBetaData && rt.exportBetaData() },
      { label: L('设置', 'Settings'), accelerator: 'Control+,', click: () => rt.openPanel('settings') },
      { type: 'separator' },
      {
        label: license.state === 'pro'
          ? L(`完整版 · ${license.planName || ''}`, `Full version · ${license.planName || ''}`)
          : license.state === 'trial'
            ? L(`内测版 · 剩 ${license.trialDaysLeft} 天`, `Test build · ${license.trialDaysLeft} days left`)
            : L('未授权', 'Not activated'),
        enabled: false,
      },
      { label: L(`关于 方块仔 ${PRODUCT.version}`, `About Cubbit ${PRODUCT.version}`), click: () => rt.openPanel('settings') },
      { type: 'separator' },
      { label: L('退出', 'Quit'), click: () => rt.quit() },
    ]),
  );
}

function createTray(rt) {
  tray = new Tray(trayImage());
  tray.setToolTip(I18N.tr(rt.settings.get('language'), '方块仔'));
  tray.on('click', () => rt.windows.togglePet());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu(rt)));
  refreshTray(rt);
  return tray;
}

function refreshTray(rt) {
  if (!tray) return;
  try {
    const unread = (rt.coupleUnread || 0) > 0;
    if (tray._unread !== unread) { tray._unread = unread; tray.setImage(trayImage(unread)); }
    tray.setToolTip(I18N.tr(rt.settings.get('language') || 'zh-CN', '方块仔'));
    tray.setContextMenu(buildMenu(rt));
  } catch (err) {
    console.error('[tray] refresh failed', err && err.message);
  }
}

module.exports = { createTray, refreshTray };
