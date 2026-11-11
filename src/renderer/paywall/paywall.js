/**
 * v2.9.2 购买 / 激活页（正式版）
 *
 * 付款方式：PayPal.me 固定金额链接（价格见 shared/offer-config.js）。
 *   1. 选地区 + 套餐 → 在系统浏览器打开 https://paypal.me/pinggu80/<金额><币种>
 *   2. 用户在 PayPal 备注里写邮箱 + 设备 ID
 *   3. 开发者确认到账后手动发激活码（CUBB-XXXX-XXXX-XXXX-XXXX）
 *   4. 在这里输入激活码 → 许可服务器换取本机签名授权
 * 客户端不处理任何银行卡信息。
 */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const app = UI.createApp();
  const IPC = UI.IPC;
  const P = window.CubbitPricing;
  const I = window.CubbitPaywallI18N;
  const cfg = window.CubbitLiteConfig || {};
  const REGION_KEY = 'cubbit.region';
  const PLAN_KEY = 'cubbit.payPlan';

  let LANG = 'zh';
  let T = I.STRINGS.zh;
  let region = 'US';
  let sku = 'base';
  let deviceId = '';

  const $ = (id) => document.getElementById(id);
  const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ''));

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bind();
    try {
      await app.boot({});
    } catch (err) {
      console.warn('[paywall] boot failed', err && err.message);
    }
    const settings = (app.state && app.state.settings) || {};
    LANG = I.pick(settings.language || navigator.language || 'zh-CN');
    T = I.STRINGS[LANG] || I.STRINGS.en;
    document.documentElement.lang = LANG;
    try {
      const { bar } = UI.mountTitlebar(app, { page: T.title.split(' / ')[0] });
      $('titlebar-host').appendChild(bar);
    } catch (err) { console.warn('[paywall] titlebar', err && err.message); }

    region = initialRegion();
    try { const saved = localStorage.getItem(PLAN_KEY); if (P.SKUS.includes(saved)) sku = saved; } catch { /* ignore */ }
    renderStatic();
    renderPlans();
    renderState(app.state);
    app.onState((state) => renderState(state));
  }

  /** 默认地区：手动选过的 > 界面语言 + 系统地区（与其它面板 UI.priceLocale 一致） */
  function initialRegion() {
    let loc = '';
    try { loc = UI.priceLocale ? UI.priceLocale() : ''; } catch { /* ignore */ }
    if (!loc) loc = navigator.language || 'en-US';
    return P.regionFor(loc).region;
  }

  function bind() {
    $('buyBtn').addEventListener('click', onBuy);
    $('copyNoteBtn').addEventListener('click', () => copy(noteText()));
    $('copyDeviceBtn').addEventListener('click', () => copy(deviceId));
    $('activateBtn').addEventListener('click', onActivate);
    $('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onActivate(); });
    $('restoreBtn').addEventListener('click', onRestore);
    $('unbindBtn').addEventListener('click', onUnbind);
    $('regionSelect').addEventListener('change', (e) => {
      region = e.target.value;
      try { localStorage.setItem(REGION_KEY, region); } catch { /* ignore */ }
      renderPlans();
    });
    $('termsLink').addEventListener('click', () => openUrl(cfg.termsUrl || 'https://pingguye.cn/cubbit/terms'));
    $('privacyLink').addEventListener('click', () => openUrl(cfg.privacyUrl || 'https://pingguye.cn/cubbit/privacy'));
    $('refundLink').addEventListener('click', () => openUrl(cfg.refundUrl || 'https://pingguye.cn/cubbit/refund'));
  }

  function renderStatic() {
    $('title').textContent = T.title;
    $('sub').textContent = T.sub;
    $('regionLabel').textContent = T.region;
    const sel = $('regionSelect');
    sel.innerHTML = '';
    for (const r of P.regionOptions()) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = `${T.regions[r.id]} · ${r.currency}`;
      sel.appendChild(o);
    }
    sel.value = region;
    $('copyNoteBtn').textContent = T.copyNote;
    $('stepsTitle').textContent = T.stepsTitle;
    const ol = $('steps');
    ol.innerHTML = '';
    for (const s of T.steps) {
      const li = document.createElement('li');
      li.textContent = s;
      ol.appendChild(li);
    }
    $('deviceLabel').textContent = T.deviceLabel;
    $('copyDeviceBtn').textContent = T.copy;
    $('keyTitle').textContent = T.keyTitle;
    $('activateBtn').textContent = T.activate;
    $('restoreBtn').textContent = T.restore;
    $('unbindBtn').textContent = T.unbind;
    $('termsLink').textContent = T.terms;
    $('privacyLink').textContent = T.privacy;
    $('refundLink').textContent = T.refund;
    renderContact();
  }

  function renderContact() {
    const host = $('contactLine');
    if (!host) return;
    const email = String(cfg.supportEmail || 'yongping163@qq.com');
    const tpl = String(T.contact || 'Support: {email}');
    const i = tpl.indexOf('{email}');
    host.textContent = '';
    host.append(document.createTextNode(i >= 0 ? tpl.slice(0, i) : tpl + ' '));
    const a = document.createElement('a');
    a.textContent = email;
    a.href = '#';
    a.title = email;
    a.addEventListener('click', (e) => { e.preventDefault(); copy(email); });
    host.append(a);
    if (i >= 0) host.append(document.createTextNode(tpl.slice(i + '{email}'.length)));
  }

  function renderPlans() {
    const host = $('plans');
    host.innerHTML = '';
    for (const id of ['base', 'month', 'year', 'couple']) {
      const p = P.skuPrice(id, region);
      const meta = T.plans[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'plan-card' + (id === sku ? ' is-selected' : '');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', id === sku ? 'true' : 'false');
      card.dataset.sku = id;
      card.innerHTML = '';
      const name = document.createElement('div'); name.className = 'plan-card__name'; name.textContent = meta.name;
      const price = document.createElement('div'); price.className = 'plan-card__price'; price.textContent = p.text;
      const period = document.createElement('div'); period.className = 'plan-card__period'; period.textContent = meta.period;
      const desc = document.createElement('div'); desc.className = 'plan-card__desc'; desc.textContent = meta.desc;
      card.append(name, price, period, desc);
      card.addEventListener('click', () => {
        sku = id;
        try { localStorage.setItem(PLAN_KEY, sku); } catch { /* ignore */ }
        renderPlans();
      });
      host.appendChild(card);
    }
    const cur = P.skuPrice(sku, region);
    $('buyBtn').textContent = fill(T.buy, { price: cur.text });
    $('chargeNote').textContent = cur.chargeCurrency !== cur.currency
      ? fill(T.chargeDiff, { display: cur.text, charge: cur.chargeText })
      : fill(T.chargeSame, { charge: cur.chargeText });
  }

  function noteText() {
    const plan = I.NOTE_PLAN[sku] || sku;
    return `Cubbit ${plan} | email: ____ | device: ${deviceId || '-'}`;
  }

  /** 套餐名按界面语言显示（服务器给的 planName 是中文，按 planId 映射到本页的多语言套餐名） */
  const PLAN_SKU = { base: 'base', ai_month: 'month', ai_year: 'year', couple_year: 'couple' };
  function planLabel(lic) {
    const sku = PLAN_SKU[String(lic.planId || '')];
    const p = sku && T.plans && T.plans[sku];
    if (p && p.name) return p.name;
    const tr = window.CubbitI18N && window.CubbitI18N.tr;
    return tr ? tr(LANG, lic.planName || lic.planId || '') : (lic.planName || lic.planId || '');
  }

  function renderState(state) {
    const lic = (state && state.license) || {};
    deviceId = String(lic.deviceId || deviceId || '');
    $('deviceId').textContent = deviceId || '—';
    const line = $('licenseLine');
    const isPro = lic.state === 'pro';
    line.classList.toggle('is-pro', isPro);
    if (isPro) line.textContent = fill(T.statusPro, { plan: planLabel(lic) });
    else if (lic.state === 'trial' && lic.trialDaysLeft > 0) line.textContent = fill(T.statusTrial, { n: lic.trialDaysLeft });
    else if (lic.state === 'expired') line.textContent = T.statusExpired;
    else line.textContent = T.statusFree;
    $('unbindBtn').classList.toggle('hidden', !isPro);
  }

  function setStatus(text, kind) {
    const el = $('keyStatus');
    el.textContent = text || '';
    el.className = 'pay__status' + (kind ? ' ' + kind : '');
  }

  async function copy(text) {
    let ok = false;
    try { ok = await UI.copyText(String(text || '')); } catch { ok = false; }
    UI.toast(ok ? T.copied : T.copyFail, ok ? 'ok' : 'err', 2200);
  }

  async function openUrl(url) {
    const res = await app.invoke(IPC.APP_OPEN_EXTERNAL, { url }, { gate: false });
    if (!res || !res.ok) setStatus(fill(T.openFail, { url }), 'err');
    return res && res.ok;
  }

  async function onBuy() {
    const p = P.skuPrice(sku, region);
    if (!p || !p.payUrl) return;
    const ok = await openUrl(p.payUrl);
    if (ok) {
      setStatus(T.opened);
      $('keyInput').focus();
    }
  }

  async function onActivate() {
    const key = String($('keyInput').value || '').trim();
    const normalized = key.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!/^CUBB[0-9A-Z]{16}$/.test(normalized)) {
      setStatus(T.keyShort, 'err');
      return;
    }
    $('activateBtn').disabled = true;
    setStatus(T.activating);
    const res = await app.invoke(IPC.LICENSE_ACTIVATE, { key }, { gate: false });
    $('activateBtn').disabled = false;
    if (res && res.ok) {
      setStatus(T.activated, 'ok');
      $('keyInput').value = '';
      try { await app.refresh(); } catch { /* ignore */ }
      renderState(app.state);
    } else {
      setStatus((res && res.message) || T.activateFail, 'err');
    }
  }

  async function onRestore() {
    setStatus(T.restoring);
    const res = await app.invoke(IPC.LICENSE_RESTORE, {}, { gate: false });
    if (res && res.ok) {
      setStatus(T.restored, 'ok');
      try { await app.refresh(); } catch { /* ignore */ }
      renderState(app.state);
    } else {
      setStatus((res && res.message) || T.nothing, 'err');
    }
  }

  async function onUnbind() {
    let yes = false;
    try { yes = await UI.confirm({ title: T.unbind, desc: T.unbindConfirm, danger: true, confirmLabel: T.unbind }); } catch { yes = false; }
    if (!yes) return;
    const res = await app.invoke(IPC.LICENSE_DEACTIVATE, {}, { gate: false });
    if (res && res.ok) {
      setStatus(T.unbound, 'ok');
      try { await app.refresh(); } catch { /* ignore */ }
      renderState(app.state);
    } else {
      setStatus((res && res.message) || T.activateFail, 'err');
    }
  }
})();
