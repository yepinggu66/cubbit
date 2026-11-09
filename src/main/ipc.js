const OFFER_CONFIG = require('../shared/offer-config');
const PRICING = require('../shared/pricing');
/**
 * 主进程 IPC 注册。
 *
 * 设计原则：
 *  1. 渲染层永远不能直接触碰文件系统 / 网络 / 许可逻辑，全部经这里收口。
 *  2. 每个 handler 返回结构化结果（{ok:true,...} / {ok:false,code,message}），不抛未捕获异常。
 *  3. 任何会影响界面状态的改动统一走 rt.commit() → 广播 state:changed。
 */
const { BrowserWindow, screen, shell, ipcMain, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { INVOKE } = require('../shared/ipc');
const { PLANS, DLC, FREE_TIER, SKINS } = require('../shared/catalog');
const { FREE_MINUTES } = require('./focus');

const SETTINGS_WHITELIST = new Set([
  'skinId',
  'sizeScale',
  'alwaysOnTop',
  'autoStart',
  'soundEnabled',
  'followSystemTheme',
  'nightMode',
  'bubbleOnLaunch',
  'customColors',
  'language',
  'apiBase',
  'multiPetCount',
  'onboardingDone',
  'hotkeys',
  'reduceMotion',
  'focus',
  'showFps',
  'voiceEnabled',
  'voiceVolume',
  'voiceRate',
  'voicePitch',
  'farmAutoWork',
  'petName',
  'voiceName',
  'voiceAllBubbles',
  'voiceInputEnabled',
  'tasks',
  'presenceReactions',
  'cinemaAuto',
  'cinemaManual',
  'coupleNotify',
  'coupleProfile',
  'aiEnabled',
  'aiProvider',
  'aiBaseUrl',
  'aiModel',
  // 注意：aiApiKey **不在**通用设置白名单里。API Key 只能经由专用的写入口
  // INVOKE.AI_CONFIG_SET → ai.configure() → 主进程 safeStorage 加密后落盘，
  // 否则这里的通用 patch 会把明文 Key 直接写进 settings.json。
  'aiPersonality',
  'aiRemember',
  'aiMaxTurns',
  'autoUpdateCheck',
  'updateFeedUrl',
  'crashReportEnabled',
  'backupAutoSync',
  'backupSyncPassword',
  'gameAutoHide',
  'gameWhitelist',
  'petPersonality',
  'memoryEnabled',
  'proactiveCare',
  'weatherEnabled',
  'weatherCity',
  'couplePokeSync',
  'petEdgeSnap',
  'petEdgeHide',
]);

function safeHandler(fn, label) {
  return async (event, payload) => {
    try {
      return await fn(event, payload);
    } catch (err) {
      console.error(`[ipc:${label}]`, err);
      return { ok: false, code: 'INTERNAL', message: err && err.message ? err.message : String(err) };
    }
  };
}

function registerIpc(rt) {
  const handle = (channel, fn) => ipcMain.handle(channel, safeHandler(fn, channel));

  // ---------------------------------------------------------------- 应用状态
  handle(INVOKE.APP_STATE, () => rt.stateSnapshot());

  handle(INVOKE.APP_SETTINGS_SET, (_e, patch) => {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (SETTINGS_WHITELIST.has(k)) clean[k] = v;
    }
    return rt.applySettings(clean);
  });

  handle(INVOKE.SKIN_PREVIEW, (_e, { id, seconds } = {}) => rt.previewSkin(String(id || ''), seconds));
  handle(INVOKE.APP_SETTINGS_RESET, () => {
    rt.settings.reset();
    rt.applySettings({});
    rt.windows.applyPetSettings();
    return { ok: true, state: rt.stateSnapshot() };
  });

  handle(INVOKE.APP_QUIT, () => {
    rt.quit();
    return { ok: true };
  });

  handle(INVOKE.APP_OPEN_EXTERNAL, (_e, { url }) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, code: 'BAD_URL' };
    shell.openExternal(url);
    return { ok: true };
  });

  handle(INVOKE.APP_PANEL_OPEN, (_e, { name } = {}) => {
    const win = rt.openPanel(name);
    return { ok: !!win, name };
  });

  handle(INVOKE.APP_PANEL_WINDOW, (event, { action }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return { ok: rt.windows.panelWindowAction(win, action) };
  });

  // ---------------------------------------------------------------- 桌宠窗口
  handle(INVOKE.PET_SET_IGNORE_MOUSE, (_e, ignore) => {
    if (rt.windows.petWindow) rt.windows.petWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
    return { ok: true };
  });

  handle(INVOKE.PET_DRAG_START, (_e, payload) => rt.windows.beginDrag(payload || {}));
  handle(INVOKE.PET_DRAG_END, () => rt.windows.endDrag());
  handle(INVOKE.PET_MOVE, (_e, payload) => rt.windows.movePet(payload || {}));
  handle(INVOKE.PET_RESET_POSITION, () => {
    rt.windows.resetPetPosition();
    return { ok: true };
  });

  handle(INVOKE.PET_BOUNDS, () => {
    const win = rt.windows.petWindow;
    if (!win || win.isDestroyed()) return { ok: false };
    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
    return { ok: true, x, y, width: w, height: h, workArea: wa };
  });

  handle(INVOKE.PET_CURSOR, () => {
    const p = screen.getCursorScreenPoint();
    return { ok: true, x: p.x, y: p.y };
  });

  handle(INVOKE.PET_HITBOXES, (_e, { rects } = {}) => {
    if (!Array.isArray(rects)) return { ok: false, code: 'BAD_REQUEST' };
    const body = rects.find((r) => r && r.body && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0);
    rt.petBody = body ? { x: Math.round(body.x), y: Math.round(body.y), w: Math.round(body.w), h: Math.round(body.h) } : rt.petBody || null;
    rt.petHitboxes = rects
      .filter((r) => r && !r.body)
      .slice(0, 16)
      .filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h))
      .map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }));
    return { ok: true, count: rt.petHitboxes.length };
  });

  handle(INVOKE.PET_INTERACTION, (_e, { type } = {}) => {
    if (rt.life) rt.life.onInteraction(type);
    if (rt.companion && (type === 'pet' || type === 'click')) rt.companion.add(1, type);
    if (type === 'click' && rt.couplePlus && rt.settings.get('couplePokeSync') !== false) rt.couplePlus.autoPoke();
    if (type === 'pet') {
      const growth = rt.growth.pet();
      return { ok: true, growth, line: rt.pickLine('pet') };
    }
    if (type === 'click') {
      const growth = rt.growth.click();
      return { ok: true, growth, line: rt.pickLine('click') };
    }
    if (type === 'throw') {
      rt.growth.throwPet();
      return { ok: true, line: rt.pickLine('throw') };
    }
    if (type === 'wake') {
      rt.growth.pet();
      return { ok: true, line: rt.pickLine('wake') };
    }
    return { ok: true };
  });

  handle(INVOKE.PET_CONTEXT_MENU, () => {
    rt.showPetMenu();
    return { ok: true };
  });

  handle(INVOKE.PET_SAY, (_e, { text } = {}) => {
    const clean = String(text || '').slice(0, 60);
    rt.lastSay = { text: clean, at: Date.now() };
    return { ok: true };
  });

  // ---------------------------------------------------------------- 许可 / 授权
  handle(INVOKE.LICENSE_STATUS, () => ({ ok: true, license: rt.licenseView() }));

  handle(INVOKE.LICENSE_START_TRIAL, async () => {
    const res = await rt.license.startTrial();
    rt.commit();
    return res;
  });

  handle(INVOKE.LICENSE_ACTIVATE, async (_e, payload = {}) => {
    const key = String(payload.key || '').trim();
    if (key.length < 8) return { ok: false, code: 'BAD_REQUEST', message: '请输入有效的许可证密钥' };
    const res = await rt.license.activate({ key, name: payload.name, email: payload.email });
    rt.commit();
    rt.windows.applyPetSettings();
    return res;
  });

  handle(INVOKE.LICENSE_RESTORE, async () => {
    const res = await rt.license.restore();
    rt.commit();
    return res;
  });

  handle(INVOKE.LICENSE_DEACTIVATE, async () => {
    const res = await rt.license.deactivate();
    rt.commit();
    return res;
  });

  // ---------------------------------------------------------------- 商店
  handle(INVOKE.STORE_PLANS, async () => {
    const stripeTest = rt.stripeTest ? rt.stripeTest.status() : { enabled: false, blockCheckout: false };
    const health = stripeTest.enabled || stripeTest.blockCheckout
      ? { ok: !!stripeTest.enabled, message: stripeTest.message || '' }
      : await rt.commerce.ping();
    const flags = rt.offerFlags ? rt.offerFlags() : undefined;
    const plans = PLANS.filter((p) => OFFER_CONFIG.legacyPlanVisible(p.id, flags));
    return {
      ok: true,
      // v2.2：只展示 offer-config 里可见的档位（AI 订阅受 FLAGS.aiCompanion 控制）
      plans: rt.stripeTest ? rt.stripeTest.decorateSellables(plans) : plans,
      offers: PRICING.storeOffers(rt.priceLocale ? rt.priceLocale() : 'zh-CN', flags),
      dlc: rt.stripeTest ? rt.stripeTest.decorateSellables(DLC) : DLC,
      freeTier: FREE_TIER,
      skins: SKINS.map((skin) => ({ ...skin, locked: !rt.skinUnlocked(skin) })),
      license: rt.licenseView(),
      server: {
        online: !!(health.ok),
        base: stripeTest.enabled ? 'stripe-test' : rt.commerce.base(),
        error: health.ok ? null : health.message,
        stripeTest,
      },
    };
  });

  handle(INVOKE.STORE_CHECKOUT, async (_e, { planId, couponCode, email } = {}) => {
    const license = rt.license.getStatus();
    if (rt.stripeTest) {
      const gate = rt.stripeTest.gate();
      // blockCheckout 只在 CUBBIT_STRIPE_TEST=1 且密钥不合格时为真。
      // 开关关闭时，即便环境里留着 sk_live_，也落到下面的许可服务下单。
      if (gate.blockCheckout) return { ok: false, code: gate.code, message: gate.message };
      if (gate.enabled) {
        const testOrder = await rt.stripeTest.createCheckout({
          planId,
          couponCode: couponCode ? String(couponCode).trim().toUpperCase() : undefined,
          email: email ? String(email).trim() : undefined,
          deviceId: license.deviceId,
        });
        if (testOrder.ok && testOrder.order && testOrder.order.payUrl) {
          try {
            const payUrl = new URL(testOrder.order.payUrl);
            if (payUrl.protocol === 'https:' && payUrl.hostname === 'checkout.stripe.com') {
              await shell.openExternal(testOrder.order.payUrl);
            }
          } catch { /* 结账链接打不开时，界面仍保留 payUrl 供重试 */ }
        }
        return testOrder;
      }
    }
    // 客户端下单前校验：已下架商品（如已并入完整版的 DLC 皮肤包）不得再单独下单。
    // 服务端也有一道同样的校验，这里再加一道，避免前端漏改时用户仍能下单。
    const sellable = (DLC || []).find((d) => d.id === planId);
    if (sellable && sellable.available === false) {
      return {
        ok: false,
        code: 'PLAN_UNAVAILABLE',
        message: sellable.includedInBase
          ? `「${sellable.name}」已包含在完整版中，请直接购买完整版`
          : `「${sellable.name}」已下架`,
      };
    }
    const res = await rt.commerce.createOrder({
      planId,
      couponCode: couponCode ? String(couponCode).trim().toUpperCase() : undefined,
      email: email ? String(email).trim() : undefined,
      deviceId: license.deviceId,
    });
    if (res.ok && res.order && res.order.payUrl) {
      shell.openExternal(res.order.payUrl);
    }
    return res;
  });

  handle(INVOKE.STORE_ORDER, async (_e, { orderId } = {}) => {
    const id = String(orderId || '');
    if (rt.stripeTest && rt.stripeTest.hasOrder(id)) return rt.stripeTest.syncOrder(id);
    return rt.commerce.getOrder(id);
  });

  handle(INVOKE.STORE_COUPON, async (_e, { code, planId } = {}) => {
    if (!code) return { ok: false, code: 'COUPON_INVALID', message: '请输入优惠码' };
    return rt.commerce.validateCoupon(String(code).trim().toUpperCase(), planId);
  });

  // ---------------------------------------------------------------- 专注
  handle(INVOKE.FOCUS_START, (_e, { minutes, label } = {}) => {
    const isPro = rt.can('focus_custom');
    const m = Number(minutes) || FREE_MINUTES;
    if (!isPro && (m !== FREE_MINUTES || (label && String(label).trim()))) {
      return { ok: false, code: 'FEATURE_LOCKED', feature: 'focus_custom', message: '自定义专注时长与标签是 Pro 功能' };
    }
    const snap = rt.focus.start({ minutes: m, label });
    rt.commit();
    return { ok: true, focus: snap };
  });

  handle(INVOKE.FOCUS_PAUSE, () => {
    const snap = rt.focus.state.paused ? rt.focus.resume() : rt.focus.pause();
    rt.commit();
    return { ok: true, focus: snap };
  });

  handle(INVOKE.FOCUS_STOP, () => {
    const snap = rt.focus.stop();
    rt.commit();
    return { ok: true, focus: snap };
  });

  // ---------------------------------------------------------------- 成长
  handle(INVOKE.GROWTH_PET, () => ({ ok: true, growth: rt.growth.pet() }));

  handle(INVOKE.GROWTH_FEED, () => {
    // 「喂养」对所有用户开放（免费档的日常回访钩子）；等级上限与成就徽章仍需 Pro。
    const res = rt.growth.feed(rt.can('growth'));
    rt.commit();
    return res;
  });

  // ---------------------------------------------------------------- 多宠物
  handle(INVOKE.MULTI_PET_SET, (_e, { count } = {}) => {
    const n = Math.max(1, Math.min(3, Number(count) || 1));
    if (n > 1 && !rt.can('multi_pet')) {
      return { ok: false, code: 'FEATURE_LOCKED', feature: 'multi_pet', message: '多宠物同屏是 Pro 功能' };
    }
    rt.applySettings({ multiPetCount: n });
    return { ok: true, state: rt.stateSnapshot() };
  });

  // ---------------------------------------------------------------- 更新 / 崩溃上报
  handle(INVOKE.UPDATE_STATUS, () => (rt.updater ? rt.updater.status() : { ok: false }));
  handle(INVOKE.UPDATE_CHECK, async (_e, payload = {}) => {
    if (!rt.updater) return { ok: false };
    if (rt._autoUpdater) {
      try {
        const result = await rt._autoUpdater.checkForUpdates();
        rt.updater.applyCheckResult(result);
      } catch (err) {
        rt.updater.error = (err && err.message) || '检查更新失败';
      }
      rt.commit();
      return rt.updater.status();
    }
    const st = await rt.updater.check({ manual: (payload && payload.manual) !== false });
    rt.commit();
    return st;
  });
  handle(INVOKE.UPDATE_OPEN, () => (rt.updater ? rt.updater.openDownload() : { ok: false }));
  handle(INVOKE.UPDATE_DOWNLOAD, () => (rt.updater ? rt.updater.download() : { ok: false }));
  handle(INVOKE.UPDATE_INSTALL, () => (rt.updater ? rt.updater.install() : { ok: false }));
  handle(INVOKE.UPDATE_SET, (_e, { enabled } = {}) => {
    if (!rt.updater) return { ok: false };
    const st = rt.updater.setEnabled(enabled !== false);
    rt.commit();
    return st;
  });
  handle(INVOKE.CRASH_STATUS, () => (rt.crash ? rt.crash.status() : { ok: false }));
  handle(INVOKE.CRASH_TAIL, (_e, { lines } = {}) => ({ ok: true, text: rt.crash ? rt.crash.tail(lines || 20) : '' }));
  handle(INVOKE.CRASH_CLEAR, () => (rt.crash ? rt.crash.clear() : { ok: false }));

  // ---------------------------------------------------------------- 数据备份 / 加密云同步
  handle(INVOKE.BACKUP_INFO, () => (rt.backup ? rt.backup.info() : { ok: false }));
  handle(INVOKE.BACKUP_EXPORT, async (event, { passphrase, password, includeAi } = {}) => {
    const pass = passphrase || password;
    const { dialog } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const def = require('node:path').join(app.getPath('documents'), `Cubbit-backup-${new Date().toISOString().slice(0, 10)}.json`);
    const pick = await dialog.showSaveDialog(win, {
      title: '导出 Cubbit 备份',
      defaultPath: def,
      filters: [{ name: 'Cubbit 备份', extensions: ['json'] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
    try {
      const out = await rt.backup.exportTo(pick.filePath, { passphrase: pass, includeAi });
      rt.commit();
      return out;
    } catch (err) {
      return { ok: false, error: (err && err.message) || '导出失败', code: err && err.code };
    }
  });
  handle(INVOKE.BACKUP_IMPORT, async (event, { passphrase, password } = {}) => {
    const pass = passphrase || password;
    const { dialog } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const pick = await dialog.showOpenDialog(win, {
      title: '导入 Cubbit 备份',
      properties: ['openFile'],
      filters: [{ name: 'Cubbit 备份', extensions: ['json'] }],
    });
    if (pick.canceled || !pick.filePaths || !pick.filePaths.length) return { ok: false, canceled: true };
    try {
      const out = await rt.backup.importFrom(pick.filePaths[0], { passphrase: pass });
      rt.commit();
      return out;
    } catch (err) {
      return { ok: false, error: (err && err.message) || '导入失败', code: err && err.code };
    }
  });
  handle(INVOKE.BACKUP_SYNC_PUSH, async (_e, { passphrase, password, includeAi } = {}) => {
    const pass = passphrase || password;
    if (!rt.backup) return { ok: false, error: '备份服务未就绪' };
    if (!rt.entitled()) return { ok: false, code: 'FEATURE_LOCKED', feature: 'backup_sync', message: '云同步需要完整版或试用' };
    try {
      const out = await rt.backup.cloudPush({ passphrase: pass || rt.backupPassphrase(), includeAi });
      rt.commit();
      return out;
    } catch (err) {
      return { ok: false, error: (err && err.message) || '云同步失败', code: err && err.code };
    }
  });
  handle(INVOKE.BACKUP_SYNC_PULL, async (_e, { passphrase, password } = {}) => {
    const pass = passphrase || password;
    if (!rt.backup) return { ok: false, error: '备份服务未就绪' };
    if (!rt.entitled()) return { ok: false, code: 'FEATURE_LOCKED', feature: 'backup_sync', message: '云同步需要完整版或试用' };
    try {
      const out = await rt.backup.cloudPull({ passphrase: pass || rt.backupPassphrase() });
      rt.commit();
      return out;
    } catch (err) {
      return { ok: false, error: (err && err.message) || '恢复失败', code: err && err.code };
    }
  });
  handle(INVOKE.BACKUP_SYNC_DELETE, async () => {
    if (!rt.backup) return { ok: false, error: '备份服务未就绪' };
    try {
      const out = await rt.backup.cloudDelete();
      rt.commit();
      return out;
    } catch (err) {
      return { ok: false, error: (err && err.message) || '删除失败', code: err && err.code };
    }
  });

  // ---------------------------------------------------------------- v2.4 情侣空间 / 记忆 / 主动关心 / 语言
  const plusResult = (extra = {}) => {
    rt.commit();
    return { ...extra, space: rt.couplePlus.snapshot() };
  };
  // ---- 实时情侣联机（CoupleService，见 main/couple/service.js） ----
  const crt = () => rt.coupleRt;
  handle(INVOKE.COUPLE_RT_STATUS, () => (crt() ? { ...crt().status(), retention: rt.retentionSnapshot() } : { ok: false, mode: 'off' }));
  handle(INVOKE.COUPLE_RT_ACCOUNT, async (_e, { op, email, password } = {}) => {
    const s = crt();
    if (!s) return { ok: false };
    if (op === 'emailCode') return s.sendEmailCode(String(email || ''));
    if (op === 'email') return s.upgradeEmail(String(email || ''), String(password || ''));
    if (op === 'google') return s.upgradeGoogle(() => rt.googleSignIn());
    return { ok: true, account: await s.refreshAccount() };
  });
  handle(INVOKE.COUPLE_RT_VOICE, async (_e, { op, data, durationMs, mime, path: p } = {}) => {
    const s = crt();
    if (!s) return { ok: false };
    if (op === 'send') {
      const r = await s.sendVoice({ data: data ? Buffer.from(data) : null, durationMs, mime: typeof mime === 'string' ? mime.slice(0, 60) : undefined });
      if (r.ok) rt.sendPetEvent('say', { text: r.localOnly ? '演示模式：语音只在本地播放' : '语音已发给 TA', emoji: '🎙️' });
      return r;
    }
    if (op === 'fetch') {
      const r = await s.fetchVoice(String(p || ''));
      return r.ok ? { ok: true, contentType: r.contentType, base64: r.data.toString('base64') } : r;
    }
    return { ok: false };
  });
  handle(INVOKE.COUPLE_RT_MESSAGES, async (_e, { op, ids } = {}) => {
    const s = crt(); if (!s) return { ok: false, list: [], unread: 0 };
    if (op === 'read') return s.markRead(Array.isArray(ids) ? ids.map(String).slice(0, 200) : null);
    if (op === 'sync') { await s.syncMessages(); return s.messages(); }
    return s.messages();
  });
  handle(INVOKE.COUPLE_RT_CHECKIN, (_e, { kind } = {}) => rt.coupleCheckin(String(kind || 'checkin')));
  handle(INVOKE.COUPLE_RT_INVITE, async () => (crt() ? crt().createInvite() : { ok: false }));
  handle(INVOKE.COUPLE_RT_ACCEPT, async (_e, { code } = {}) => (crt() ? crt().acceptInvite(String(code || '')) : { ok: false }));
  handle(INVOKE.COUPLE_RT_UNPAIR, async () => (crt() ? crt().unpair() : { ok: false }));
  handle(INVOKE.COUPLE_RT_INTERACT, (_e, { action } = {}) => rt.coupleInteract(String(action || '')));
  handle(INVOKE.COUPLE_RT_NOTE, (_e, { text } = {}) => (crt() ? crt().note(String(text || '').slice(0, 200)) : { ok: false }));
  handle(INVOKE.COUPLE_RT_FOCUS, (_e, { op, result } = {}) => {
    if (!crt()) return { ok: false };
    if (op === 'start') return crt().startFocus();
    if (op === 'end') return crt().endFocus(result === 'abort' ? 'abort' : 'done');
    return { ok: false };
  });
  handle(INVOKE.COUPLE_PLUS_GET, () => ({ ok: true, space: rt.couplePlus.snapshot() }));
  handle(INVOKE.COUPLE_PLUS_ACT, async (_e, { t, text, minutes } = {}) => {
    const res = await rt.couplePlus.act(String(t || ''), { text, minutes });
    return plusResult(res);
  });
  handle(INVOKE.COUPLE_PLUS_SET, (_e, patch = {}) => plusResult(rt.couplePlus.setConfig(patch) || { ok: true }));
  handle(INVOKE.COUPLE_PLUS_TASK, async (_e, { op, id, text, icon } = {}) => {
    let res;
    if (op === 'add') res = rt.couplePlus.addSharedTask({ text, icon });
    else if (op === 'remove') res = rt.couplePlus.removeSharedTask(id);
    else if (op === 'done') res = await rt.couplePlus.doneSharedTask(id);
    else res = { ok: false, message: 'bad op' };
    return plusResult(res);
  });
  handle(INVOKE.COUPLE_PLUS_SKIN, async (_e, { id } = {}) => plusResult(await rt.couplePlus.applySkinPair(id)));
  handle(INVOKE.COUPLE_PLUS_VOICE, async () => {
    if (!rt.speech || typeof rt.speech.listen !== 'function') return { ok: false, message: '语音输入不可用' };
    rt.sendPetEvent('listening', { on: true });
    const heard = await rt.speech.listen({ seconds: 8 });
    rt.sendPetEvent('listening', { on: false });
    const text = String((heard && heard.text) || '').trim();
    if (!heard || !heard.ok) return { ok: false, message: (heard && heard.message) || '麦克风不可用' };
    if (!text) return { ok: false, message: '没听清，再录一次？' };
    const res = await rt.couplePlus.act('voice', { text });
    return plusResult({ ...res, text });
  });
  handle(INVOKE.FARM_CALL, (e, { action, args } = {}) => rt.farmCall(String(action || ''), args || {}, e && e.sender));
  handle(INVOKE.PAID_CALL, (_e, { area, action, args } = {}) => rt.paid.call(String(area || ''), String(action || ''), args || {}));
  handle(INVOKE.MEMORY_GET, () => ({ ok: true, items: rt.companion.memories(), enabled: rt.settings.get('memoryEnabled') !== false }));
  handle(INVOKE.MEMORY_DELETE, (_e, { id } = {}) => {
    const res = rt.companion.forget(id);
    rt.commit();
    return { ok: true, ...(res && typeof res === 'object' ? res : {}), items: rt.companion.memories() };
  });
  handle(INVOKE.CARE_TICK, async (_e, { force } = {}) => {
    const r = await rt.companion.runTick(String(force || ''));
    return r ? { ok: true, ...r } : { ok: false, message: '现在没有要说的' };
  });
  handle(INVOKE.INTIMACY_GET, () => ({ ok: true, ...rt.companion.intimacySnapshot() }));
  handle(INVOKE.LANG_SUPPORT, (_e, { lang } = {}) => (rt.speech && rt.speech.support ? rt.speech.support(lang || rt.settings.get('language')) : { ok: false }));
  handle(INVOKE.LANG_OPEN_SETTINGS, async () => {
    try {
      await shell.openExternal('ms-settings:regionlanguage');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err && err.message };
    }
  });

  // ---------------------------------------------------------------- AI 对话（Pro）
  handle(INVOKE.AI_STATUS, () => (rt.ai ? rt.ai.status() : { ok: false, reason: 'not-ready' }));
  handle(INVOKE.AI_CHAT, async (_e, { text } = {}) => {
    if (!rt.ai) return { ok: false, code: 'NOT_READY', message: 'AI 还没准备好' };
    const res = await rt.ai.chat(text);
    if (res && res.ok && res.reply) {
      rt.sendPetEvent('say', { text: res.reply });
      rt.sendPetEvent('mood', { mood: res.mood || 'happy' });
      rt.sendPetEvent('chat-reply', { mood: res.mood || null, text: res.reply });
    }
    rt.commit();
    return res;
  });
  handle(INVOKE.AI_TEST, async (_e, payload = {}) => (rt.ai ? rt.ai.test(payload || {}) : { ok: false, error: 'not-ready' }));
  handle(INVOKE.AI_CONFIG_SET, (_e, { patch } = {}) => {
    if (!rt.ai) return { ok: false, reason: 'not-ready' };
    const st = rt.ai.configure(patch || {});
    rt.commit();
    return st;
  });
  handle(INVOKE.AI_HISTORY_GET, () => (rt.ai ? { ok: true, messages: rt.ai.history() } : { ok: false, messages: [] }));
  handle(INVOKE.AI_HISTORY_CLEAR, () => (rt.ai ? rt.ai.clearHistory() : { ok: false }));

  // ---------------------------------------------------------------- 智慧生命
  handle(INVOKE.LIFE_STATUS, () => ({ ok: true, life: rt.life ? rt.life.snapshot() : null }));
  handle(INVOKE.LIFE_INTERACT, (_e, { type } = {}) => {
    if (!rt.life) return { ok: false, message: '生命系统未就绪' };
    if (type === 'feed') {
      if (!rt.can('life_system')) return { ok: false, code: 'FEATURE_LOCKED', feature: 'life_system', message: '智慧生命是 Pro 功能' };
      rt.growth.feed();
      const snap = rt.life.feed();
      rt.commit();
      return { ok: true, life: snap };
    }
    if (type === 'think') {
      const text = rt.life.think(true);
      rt.sendPetEvent('say', { text: text || '…' });
      return { ok: true, text };
    }
    rt.life.onInteraction(type || 'pet');
    rt.commit();
    return { ok: true, life: rt.life.snapshot() };
  });

  // ---------------------------------------------------------------- 语音
  handle(INVOKE.TTS_SPEAK, (_e, { text, kind } = {}) => (
    { ok: !!(rt.speech && rt.speech.speak(text, { force: kind === 'love' })) }
  ));

  handle(INVOKE.TTS_VOICES, () => ({ ok: true, voices: rt.speech ? rt.speech.listVoices() : [], running: !!(rt.speech && rt.speech.child) }));
  handle(INVOKE.TTS_LAST, () => ({ ok: true, last: rt.speech ? rt.speech.lastSpoken() : null }));
  handle(INVOKE.VOICE_LISTEN, async (_e, { mode } = {}) => {
    if (mode === 'text') {
      if (rt.settings.get('voiceInputEnabled') === false) return { ok: false, code: 'DISABLED', message: '语音输入已关闭（设置 → 语音）' };
      rt.sendPetEvent('listening', { on: true });
      try { return await rt.speech.listen(); } finally { rt.sendPetEvent('listening', { on: false }); }
    }
    return rt.voiceTalk();
  });
  handle(INVOKE.TTS_TEST, (_e, { text } = {}) => ({ ok: !!(rt.speech && rt.speech.speak(text || '主人你好呀，我是方块仔，今天也要加油哦！', { force: true })) }));

  // ---------------------------------------------------------------- 主人状态
  handle(INVOKE.PRESENCE_GET, () => ({ ok: true, presence: rt.presence ? rt.presence.snapshot() : null }));

  // ---------------------------------------------------------------- 情侣模式
  const coupleGuard = () => {
    if (!rt.can('couple_mode')) {
      return { ok: false, code: 'FEATURE_LOCKED', feature: 'couple_mode', message: '情侣模式是 Pro 功能，升级后即可和 TA 的方块仔见面' };
    }
    if (!rt.social) return { ok: false, code: 'INTERNAL', message: '情侣服务未初始化' };
    return null;
  };
  const coupleResult = (res) => {
    if (res && res.couple) rt.commit();
    return res;
  };

  handle(INVOKE.COUPLE_STATUS, async () => {
    if (!rt.social) return { ok: false, message: '情侣服务未初始化' };
    const res = await rt.social.status();
    return { ok: !!(res && res.ok), couple: rt.stateSnapshot().couple, offline: !!(res && res.offline), message: res && res.message };
  });

  handle(INVOKE.COUPLE_CREATE, async () => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const res = await rt.social.createInvite();
    return coupleResult({ ...res, couple: rt.social.snapshot() });
  });

  handle(INVOKE.COUPLE_JOIN, async (_e, { code } = {}) => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const clean = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6) return { ok: false, code: 'BAD_REQUEST', message: '请输入 6 位邀请码' };
    const res = await rt.social.join(clean);
    return coupleResult({ ...res, couple: rt.social.snapshot() });
  });

  handle(INVOKE.COUPLE_UNPAIR, async () => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const res = await rt.social.unpair();
    rt.commit();
    return { ...res, couple: rt.social.snapshot() };
  });

  handle(INVOKE.COUPLE_SEND, async (_e, { text, kind } = {}) => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const clean = String(text || '').slice(0, 200).trim();
    if (!clean) return { ok: false, code: 'BAD_REQUEST', message: '说点什么嘛' };
    const res = await rt.social.send(clean, ['chat', 'love', 'emoji', 'gift'].includes(kind) ? kind : 'chat');
    return coupleResult({ ...res, couple: rt.social.snapshot() });
  });

  handle(INVOKE.COUPLE_POLL, async () => {
    if (!rt.social) return { ok: false, messages: [] };
    const res = await rt.social.poll();
    if (res && res.messages && res.messages.length) rt.onCoupleMessages(res.messages);
    return { ...res, couple: rt.stateSnapshot().couple };
  });

  handle(INVOKE.COUPLE_PROPOSE, async () => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const res = await rt.social.propose();
    if (res && res.ok) rt.sendPetEvent('couple-propose', {});
    return coupleResult({ ...res, couple: rt.social.snapshot() });
  });

  handle(INVOKE.COUPLE_ACCEPT, async () => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const res = await rt.social.accept();
    if (res && res.ok) rt.sendPetEvent('couple-married', { at: res.couple && res.couple.marriedAt });
    return coupleResult({ ...res, couple: rt.social.snapshot() });
  });

  handle(INVOKE.COUPLE_REJECT, async () => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const res = await rt.social.decline();
    rt.commit();
    return { ...res, couple: rt.social.snapshot() };
  });

  handle(INVOKE.COUPLE_LOVE_NOTE, async (_e, { text } = {}) => {
    const blocked = coupleGuard();
    if (blocked) return blocked;
    const clean = String(text || '').slice(0, 140).trim();
    if (!clean) return { ok: false, code: 'BAD_REQUEST', message: '写一句情话吧' };
    const res = await rt.social.setLoveNote(clean);
    return coupleResult({ ...res, couple: rt.social.snapshot() });
  });

  handle(INVOKE.COUPLE_PROFILE, async (_e, { petName, loveNote } = {}) => {
    if (!rt.social) return { ok: false, message: '情侣服务未初始化' };
    rt.social.setProfile({
      petName: String(petName || '').slice(0, 20).trim() || '方块仔',
      loveNote: String(loveNote || '').slice(0, 140),
    });
    rt.settings.patch({ coupleProfile: { petName: String(petName || '').slice(0, 20).trim(), loveNote: String(loveNote || '').slice(0, 140) } });
    rt.commit();
    return { ok: true, couple: rt.social.snapshot() };
  });

  handle(INVOKE.COUPLE_RETRY, async () => {
    if (!rt.social) return { ok: false, message: '情侣服务未初始化' };
    const res = await rt.social.status();
    rt.commit();
    return { ok: !!(res && res.ok), couple: rt.social.snapshot(), offline: !!(res && res.offline), message: res && res.message };
  });

  // ---------------------------------------------------------------- 情侣空间（v1.6）
  handle(INVOKE.COUPLE_SCENE_GET, () => rt.getCoupleScene());
  handle(INVOKE.COUPLE_SCENE_SET, (_e, payload) => rt.setCoupleScene(payload || {}));
  handle(INVOKE.COUPLE_SCENE_CAPTURE, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: '窗口不可用' };
      const image = await win.webContents.capturePage();
      const dir = path.join(app.getPath('pictures'), 'Cubbit');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `couple-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      fs.writeFileSync(file, image.toPNG());
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: (err && err.message) || '保存失败' };
    }
  });
}

module.exports = { registerIpc };
