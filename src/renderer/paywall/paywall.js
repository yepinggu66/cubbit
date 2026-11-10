/**
 * v2.4.1 Lite 付费墙
 *
 * 只做三件事：展示 Couple Pack 价格 → 打开支付平台结账页 → 激活码激活。
 * 支付平台（Paddle / Lemon Squeezy）只负责扣款与发码，客户端不碰卡号。
 */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const app = UI.createApp();
  const IPC = UI.IPC;
  const cfg = window.CubbitLiteConfig || {};

  let LANG = 'en-US';
  const isZh = () => String(LANG).toLowerCase().startsWith('zh');
  const T = (en, zh) => (isZh() ? zh : en);

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bind();
    try {
      await app.boot({});
      LANG = (app.state && app.state.settings && app.state.settings.language) || navigator.language || 'en-US';
    } catch (err) {
      console.warn('[paywall] boot failed', err && err.message);
    }
    document.documentElement.lang = LANG;
    renderStatic();
    renderState(app.state);
    app.onState((state) => renderState(state));
  }

  function bind() {
    $('buyBtn').addEventListener('click', onBuy);
    $('keyToggle').addEventListener('click', () => {
      const box = $('keyBox');
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) $('keyInput').focus();
    });
    $('activateBtn').addEventListener('click', onActivate);
    $('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onActivate(); });
    $('restoreBtn').addEventListener('click', onRestore);
  }

  function renderStatic() {
    const today = Date.now();
    const price = typeof cfg.currentPrice === 'function' ? cfg.currentPrice(today) : cfg.price || 19.99;
    const isLaunch = typeof cfg.isLaunchPrice === 'function' ? cfg.isLaunchPrice(today) : false;
    const fmt = typeof cfg.formatPrice === 'function' ? cfg.formatPrice : (v) => '$' + Number(v).toFixed(2);

    $('amount').textContent = fmt(price);
    if (isLaunch) {
      $('was').textContent = fmt(cfg.price || 19.99);
      $('was').classList.remove('hidden');
      $('priceNote').textContent = T('launch price', '首发价');
      $('priceNote').classList.remove('hidden');
    } else {
      $('was').textContent = '';
      $('was').classList.add('hidden');
      $('priceNote').textContent = T('one-time · no subscription', '一次性 · 不是订阅');
    }

    $('title').textContent = T('Both desktops, one purchase.', '两台电脑，一份授权。');
    $('sub').textContent = T(
      'Unlock everything you need to play together — one payment, no subscription.',
      '解锁你们俩一起玩需要的全部功能——一次买断，不是订阅。',
    );
    $('buyBtn').textContent = T('Get Couple Pack', '购买情侣包');
    $('keyToggle').textContent = T('I already have a key', '我已有激活码');
    $('activateBtn').textContent = T('Activate', '激活');
    $('restoreBtn').textContent = T('Restore purchase', '恢复购买');
    $('freeTitle').textContent = T('Free version includes', '免费版已包含');

    const bullets = Array.isArray(cfg.bullets) ? cfg.bullets : [];
    const ul = $('bullets');
    ul.innerHTML = '';
    for (const b of bullets) {
      const li = document.createElement('li');
      li.textContent = isZh() ? b.zh : b.en;
      ul.appendChild(li);
    }

    const freeUl = $('freeList');
    freeUl.innerHTML = '';
    for (const b of (cfg.freeIncludes || [])) {
      const li = document.createElement('li');
      li.textContent = isZh() ? b.zh : b.en;
      freeUl.appendChild(li);
    }
  }

  function renderState(state) {
    const lic = (state && state.license) || {};
    const line = $('licenseLine');
    const buy = $('buyBtn');
    const isPro = lic.state === 'pro';

    if (isPro) {
      $('title').textContent = T("You're all set.", '已经解锁了。');
      $('sub').textContent = T('Couple Pack is active on this computer.', '这台电脑已激活情侣包。');
      buy.disabled = true;
      buy.textContent = T('Unlocked', '已解锁');
      $('amount').textContent = '✓';
      $('was').classList.add('hidden');
      $('priceNote').classList.add('hidden');
      $('keyToggle').classList.add('hidden');
      line.textContent = T(`Full version · ${lic.planName || ''}`, `完整版 · ${lic.planName || ''}`);
      return;
    }

    if (lic.state === 'trial' && lic.trialDaysLeft > 0) {
      line.textContent = T(
        `Free trial · ${lic.trialDaysLeft} days left · no card`,
        `免费体验 · 还剩 ${lic.trialDaysLeft} 天 · 不绑卡`,
      );
    } else if (lic.state === 'expired') {
      line.textContent = T('Trial ended — Couple Pack keeps everything on.', '体验已结束——购买情侣包可继续使用。');
    } else {
      line.textContent = T('30-day free trial · no card', '30 天免费体验 · 不绑卡');
    }
  }

  function setStatus(text, kind) {
    const el = $('keyStatus');
    el.textContent = text || '';
    el.className = 'pay__status' + (kind ? ' ' + kind : '');
  }

  async function onBuy() {
    if (!cfg.checkoutReady) {
      setStatus(T(
        `Checkout isn't live yet. Email ${cfg.supportEmail || 'support@cubbit.app'} and we'll send a key.`,
        `购买页尚未开通。发邮件到 ${cfg.supportEmail || 'support@cubbit.app'}，我们会直接给你发激活码。`,
      ), 'err');
      $('keyBox').classList.remove('hidden');
      return;
    }
    const res = await app.invoke(IPC.APP_OPEN_EXTERNAL, { url: cfg.checkoutUrl });
    if (!res || !res.ok) {
      setStatus(T('Could not open the checkout page.', '打不开购买页，请检查网络。'), 'err');
      return;
    }
    setStatus(T('After paying, your key arrives by email — paste it below.', '付款后激活码会发到邮箱，填在下面即可。'));
    $('keyBox').classList.remove('hidden');
    $('keyInput').focus();
  }

  async function onActivate() {
    const key = String($('keyInput').value || '').trim();
    if (key.length < 8) {
      setStatus(T('That key looks too short.', '激活码太短了。'), 'err');
      return;
    }
    $('activateBtn').disabled = true;
    setStatus(T('Activating…', '正在激活…'));
    const res = await app.invoke(IPC.LICENSE_ACTIVATE, { key });
    $('activateBtn').disabled = false;
    if (res && res.ok) {
      setStatus(T('Activated. Thanks for supporting a tiny studio.', '激活成功，谢谢支持。'), 'ok');
      try { await app.refresh(); } catch { /* ignore */ }
      renderState(app.state);
      setTimeout(() => { try { if (app.panel && app.panel.close) app.panel.close(); } catch { /* ignore */ } }, 1400);
    } else {
      setStatus((res && res.message) || T('Activation failed.', '激活失败，请检查激活码。'), 'err');
    }
  }

  async function onRestore() {
    setStatus(T('Checking…', '正在检查…'));
    const res = await app.invoke(IPC.LICENSE_RESTORE, {});
    if (res && res.ok) {
      setStatus(T('Restored.', '已恢复。'), 'ok');
      try { await app.refresh(); } catch { /* ignore */ }
      renderState(app.state);
    } else {
      setStatus((res && res.message) || T('Nothing to restore on this computer.', '这台电脑上没有可恢复的授权。'), 'err');
    }
  }
})();
