/* ============================================================================
 * Cubbit 商店窗口逻辑
 *
 * 结构：会员方案（三档 + 优惠码 + 下单轮询）/ 皮肤商店 / 我的授权
 * 所有价格、皮肤、权益均来自 state 或 store:plans，不在此处硬编码。
 * ========================================================================== */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const IPC = UI.IPC;
  const el = UI.el;
  const icon = UI.icon;
  const clear = UI.clear;
  const formatMoney = UI.formatMoney;
  const formatDate = UI.formatDate;
  const formatDuration = UI.formatDuration;
  const formatMinutes = UI.formatMinutes;
  const shortId = UI.shortId;
  const toast = UI.toast;
  const modal = UI.modal;
  const confirmDialog = UI.confirm;

  const app = UI.createApp();

  // ---------------------------------------------------------------- 本地状态
  const S = {
    tab: 'upgrade',
    plans: [],
    dlc: [],
    freeTier: null,
    skins: [],
    license: null,
    server: { online: null, base: '', error: null, stripeTest: null },
    stripeTest: null,
    selectedPlanId: null,
    coupon: null,
    couponBusy: false,
    email: '',
    order: null,
    payPhase: 'idle',
    payReason: '',
    payKey: '',
    pollTimer: null,
    countdownTimer: null,
    pollDeadline: 0,
    pollErrors: 0,
    buyBusy: false,
    storeLoadedOnce: false,
  };

  const R = {}; // DOM 引用

  const TABS = [
    { id: 'upgrade', label: '升级方案', icon: 'crown' },
    { id: 'dlc', label: '角色包', icon: 'gift' },
    { id: 'skins', label: '皮肤', icon: 'palette' },
    { id: 'license', label: '我的授权', icon: 'shield' },
  ];

  const PAY_WAIT_LIMIT_MS = 5 * 60 * 1000;
  const TEST_PAY_WAIT_LIMIT_MS = 30 * 60 * 1000;
  const POLL_INTERVAL_MS = 2000;

  // ============================================================== 三档售卖条
  function renderOffers(offers) {
    if (!R.offerStrip) return;
    R.offerStrip.textContent = '';
    for (const o of offers) {
      const price = o.price ? o.price.text : o.prices ? `${o.prices.month.text}/月 · ${o.prices.year.text}/年` : '';
      const card = el('div', { class: 'offer-card' + (o.id === 'couple' ? ' offer-card--hero' : '') },
        el('div', { class: 'offer-card__name', text: o.name }),
        el('div', { class: 'offer-card__price', text: price + (o.kind === 'one_time' ? ' · 一次买断' : '') }),
        el('div', { class: 'offer-card__desc', text: o.id === 'couple' ? '一人购买，配对的两个人都解锁全部情侣玩法' : o.id === 'skinpack' ? '季节/主题皮肤，按包购买' : o.id === 'base' ? '桌宠本体 + 全部基础功能' : '可选订阅' }));
      R.offerStrip.appendChild(card);
    }
  }

  // ============================================================== 启动
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    mountTitlebar();
    mountTabs();
    mountPanels();

    await app.boot({});

    app.onState((state) => {
      S.license = state.license || S.license;
      if (Array.isArray(state.plans) && state.plans.length) S.plans = state.plans;
      if (Array.isArray(state.skins) && state.skins.length) S.skins = state.skins;
      if (Array.isArray(state.offers)) renderOffers(state.offers);
      if (state.stripeTest) S.stripeTest = state.stripeTest;
      if (!S.selectedPlanId) pickDefaultPlan();
      renderTitlebarBadge();
      renderHead();
      renderPlans();
      renderDlc();
      renderSkins();
      renderLicense();
    });

    if (S.license) {
      pickDefaultPlan();
      renderHead();
      renderPlans();
      renderSkins();
      renderLicense();
    }

    loadStore(true);
    app.onNav((payload) => {
      if (payload && payload.tab && TABS.some((t) => t.id === payload.tab)) switchTab(payload.tab);
    });

    // 支持 ?tab=skins|license 深链（也方便截图走查）
    const initialTab = new URLSearchParams(location.search).get('tab');
    if (initialTab && TABS.some((t) => t.id === initialTab)) switchTab(initialTab);
  }

  // ============================================================== 外壳
  function mountTitlebar() {
    const { bar, rightSlot } = UI.mountTitlebar(app, { page: '商店' });
    R.badgeHost = el('div', { class: 'row', style: { gap: '8px' } });
    rightSlot.insertBefore(R.badgeHost, rightSlot.firstChild);
    document.getElementById('titlebar-host').appendChild(bar);
  }

  function renderTitlebarBadge() {
    if (!R.badgeHost) return;
    clear(R.badgeHost);
    if (!S.license) return;
    R.badgeHost.appendChild(UI.licenseBadgeNode(S.license, app.state && app.state.ui));
  }

  function mountTabs() {
    const host = document.getElementById('storeTabs');
    R.tabButtons = {};
    for (const tab of TABS) {
      const btn = el(
        'button',
        {
          class: 'tab' + (tab.id === S.tab ? ' is-active' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': tab.id === S.tab ? 'true' : 'false',
          dataset: { tab: tab.id },
        },
        icon(tab.icon),
        el('span', { text: tab.label }),
      );
      btn.addEventListener('click', () => switchTab(tab.id));
      R.tabButtons[tab.id] = btn;
      host.appendChild(btn);
      if (tab.id === 'skins') R.skinTabDot = btn; // 预留：有未读提示时可挂小圆点
    }
    host.appendChild(el('div', { class: 'store-tabs__spacer' }));
    R.tabHint = el('span', { class: 'store-tabs__hint' });
    host.appendChild(R.tabHint);
  }

  function switchTab(id) {
    // 「角色包」标签页只在还有可售 DLC 时存在（全部下架后隐藏，避免空标签页）
    if (id === 'dlc' && !hasSellableDlc()) id = 'upgrade';
    S.tab = id;
    for (const tab of TABS) {
      const btn = R.tabButtons[tab.id];
      if (!btn) continue;
      btn.classList.toggle('is-active', tab.id === id);
      btn.setAttribute('aria-selected', tab.id === id ? 'true' : 'false');
    }
    document.getElementById('panel-upgrade').classList.toggle('hidden', id !== 'upgrade');
    document.getElementById('panel-dlc').classList.toggle('hidden', id !== 'dlc');
    document.getElementById('panel-skins').classList.toggle('hidden', id !== 'skins');
    document.getElementById('panel-license').classList.toggle('hidden', id !== 'license');
    updateTabHint();
    document.getElementById('storeBody').scrollTop = 0;
  }

  function updateTabHint() {
    if (!R.tabHint) return;
    if (S.tab === 'upgrade') R.tabHint.textContent = '支持支付宝 / 微信 / 银行卡 · 7 天无理由退款';
    else if (S.tab === 'dlc') R.tabHint.textContent = '角色包需先拥有完整版 · 一次购买永久有效';
    else if (S.tab === 'skins') {
      const unlocked = S.skins.filter((s) => s.free || app.isPro || !s.locked).length;
      R.tabHint.textContent = `已解锁 ${unlocked} / ${S.skins.length} 套皮肤`;
    } else R.tabHint.textContent = '许可证与本机绑定，最多 2 台设备';
  }

  // ============================================================== 顶部区
  function renderHead() {
    const lic = S.license || { state: 'unlicensed' };
    const titleNode = document.getElementById('headTitle');
    const subNode = document.getElementById('headSub');
    const side = document.getElementById('headSide');
    const trialDays = (app.state && app.state.product && app.state.product.trialDays) || 7;

    if (lic.state === 'pro') {
      titleNode.textContent = '你已是 Pro 会员';
      subNode.textContent = '感谢支持，全部功能与 20 套皮肤均已解锁。授权信息与设备绑定可在「我的授权」中管理。';
    } else if (lic.state === 'trial') {
      titleNode.textContent = '让方块仔更像它自己';
      subNode.textContent = `体验期还剩 ${lic.trialDaysLeft || 0} 天。升级 Pro，立即解锁 20 套手工皮肤、专注模式、成长系统与多宠物同屏。`;
    } else if (lic.state === 'expired') {
      titleNode.textContent = '体验已结束，继续陪它长大';
      subNode.textContent = '免费版仍可使用基础陪伴与 2 套免费皮肤。升级 Pro 恢复全部功能，已有设置不会丢失。';
    } else {
      titleNode.textContent = '解锁 方块仔 的全部能力';
      subNode.textContent = '免费版可以一直用；完整版一次买断，AI 订阅解锁无限对话。';
    }

    clear(side);
    if (lic.state === 'pro') {
      side.appendChild(
        el(
          'div',
          { class: 'pro-card' },
          el('div', { class: 'pro-card__title' }, icon('crown'), el('span', { text: lic.planName || 'Pro 会员' })),
          el('div', {
            class: 'pro-card__meta',
            text: lic.expiresAt ? `有效期至 ${formatDate(lic.expiresAt)}` : '永久授权 · 含未来全部皮肤',
          }),
        ),
      );
    } else if (lic.state === 'trial') {
      const days = lic.trialDaysLeft || 0;
      const pct = Math.max(4, Math.min(100, (days / trialDays) * 100));
      const card = el(
        'div',
        { class: 'trial-card' },
        el(
          'div',
          { class: 'trial-card__row' },
          el('span', { class: 'trial-card__label', text: '体验期中' }),
          el('span', { class: 'trial-card__days' }, el('span', { text: String(days) }), el('span', { text: '天' })),
        ),
        el('div', { class: 'progress progress--teal progress--thin' }, el('div', { class: 'progress__fill', style: { width: pct + '%' } })),
        el('div', { class: 'trial-card__note', text: '体验期内全部 Pro 功能可用；到期后自动回到免费版。' }),
      );
      side.appendChild(card);
    } else {
      side.appendChild(
        el(
          'div',
          { class: 'pro-card', style: { borderColor: 'var(--line-strong)', background: 'var(--surface)' } },
          el('div', { class: 'pro-card__title', style: { color: 'var(--text-2)' } }, icon('lock'), el('span', { text: '当前为免费版' })),
          el('div', { class: 'pro-card__meta', text: '2 套免费皮肤 · 基础陪伴功能可用' }),
        ),
      );
    }
  }

  // ============================================================== 方案面板
  function mountPanels() {
    // ---------- 升级方案 / 角色包 ----------
    const plansPanel = document.getElementById('panel-upgrade');

    const plansMain = el('div', { id: 'plansMain' });
    R.offlineNotice = el('div', { class: 'notice-bar hidden' });
    plansMain.appendChild(R.offlineNotice);

    // 当前方案摘要 + 免费版/完整版对比
    R.tierBanner = el('div', { class: 'tier-banner' });
    R.coupleHero = el('div', { class: 'couple-hero' });
    R.compareCard = el('div', { class: 'card compare-card' });
    // v2.2 三档售卖条（数据来自 shared/offer-config.js，经 state.offers 下发）
    R.offerStrip = el('div', { class: 'offer-strip' });
    plansMain.appendChild(R.offerStrip);
    plansMain.appendChild(R.tierBanner);
    plansMain.appendChild(R.coupleHero);
    plansMain.appendChild(R.compareCard);

    const wrap = el('div', { class: 'plans-wrap' });
    R.plansGrid = el('div', { class: 'plans' });
    wrap.appendChild(R.plansGrid);
    plansMain.appendChild(wrap);

    // 结算条（紧凑单行，避免把方案挤出首屏）
    R.couponInput = el('input', {
      class: 'input',
      id: 'couponInput',
      type: 'text',
      maxlength: '24',
      placeholder: '输入优惠码',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    R.couponBtn = el('button', { class: 'btn btn--sm', type: 'button' }, el('span', { text: '应用' }));
    R.couponStatus = el('div', { class: 'coupon-status' });
    R.emailInput = el('input', {
      class: 'input',
      id: 'emailInput',
      type: 'email',
      maxlength: '120',
      placeholder: '接收凭证的邮箱（选填）',
      autocomplete: 'off',
      spellcheck: 'false',
    });

    R.sumPlan = el('span', { class: 'checkout-bar__plan-name', text: '—' });
    R.sumPeriod = el('span', { class: 'checkout-bar__plan-period', text: '' });
    R.sumDiscount = el('span', { class: 'teal-text small', text: '' });
    R.sumDiscountRow = el('div', { class: 'checkout-bar__discount hidden' }, R.sumDiscount);
    R.sumTotal = el('span', { text: '0' });
    R.sumOriginal = el('span', { class: 'summary-original hidden' });
    R.sumPromo = el('span', { class: 'checkout-bar__note' });
    R.buyBtn = el('button', { class: 'btn btn--primary btn--lg', type: 'button' }, el('span', { text: '立即升级' }));

    const couponField = el(
      'div',
      { class: 'checkout-bar__field' },
      el('label', { class: 'checkout-bar__label', for: 'couponInput' }, icon('gift'), el('span', { text: '优惠码' })),
      el('div', { class: 'coupon-row' }, R.couponInput, R.couponBtn),
      R.couponStatus,
    );
    const emailField = el(
      'div',
      { class: 'checkout-bar__field' },
      el('label', { class: 'checkout-bar__label', for: 'emailInput' }, icon('mail'), el('span', { text: '邮箱（选填）' })),
      R.emailInput,
    );
    const planBlock = el(
      'div',
      { class: 'checkout-bar__plan' },
      R.sumPlan,
      R.sumPeriod,
      R.sumDiscountRow,
      R.sumPromo,
    );
    const totalBlock = el(
      'div',
      { class: 'checkout-bar__total' },
      el('span', { class: 'checkout-bar__total-label', text: '合计' }),
      el('div', { class: 'checkout-bar__total-value' }, (R.sumCurrency = el('span', { class: 'currency', text: UI.currency() })), R.sumTotal),
      R.sumOriginal,
    );

    const checkoutBar = el(
      'div',
      { class: 'card checkout-bar' },
      couponField,
      emailField,
      planBlock,
      el('div', { class: 'checkout-bar__spacer' }),
      totalBlock,
      R.buyBtn,
    );
    plansMain.appendChild(checkoutBar);
    plansMain.appendChild(
      el(
        'div',
        { class: 'checkout-guarantees' },
        el('div', { class: 'checkout-guarantees__item' }, icon('check'), (R.activateGuarantee = el('span', { text: '支付成功后自动激活' }))),
        el('div', { class: 'checkout-guarantees__item' }, icon('shield'), el('span', { text: '7 天无理由退款' })),
        el('div', { class: 'checkout-guarantees__item' }, icon('monitor'), el('span', { text: '授权最多绑定 2 台设备' })),
        el('div', { class: 'checkout-guarantees__item' }, icon('wifi-off'), el('span', { text: '离线可用 30 天' })),
        el('div', { class: 'checkout-guarantees__item' }, icon('card'), (R.payMethodsText = el('span', { text: '支付宝 / 微信 / 银行卡' }))),
      ),
    );

    // 权益条
    R.benefitsGrid = el('div', { class: 'benefits__grid' });
    plansMain.appendChild(
      el(
        'div',
        { class: 'benefits' },
        el(
          'div',
          { class: 'benefits__head' },
          el('div', { class: 'ico-tile ico-tile--sm ico-tile--teal' }, icon('crown')),
          el('div', {}, el('div', { class: 'h4', text: '完整版包含的全部权益' }), el('div', { class: 'card__desc', text: '一次买断，全部解锁；AI 订阅可再叠加无限对话。' })),
        ),
        R.benefitsGrid,
      ),
    );

    R.payHost = el('div', { id: 'payHost' });
    plansPanel.appendChild(plansMain);
    plansPanel.appendChild(R.payHost);

    R.buyBtn.addEventListener('click', startCheckout);
    R.couponBtn.addEventListener('click', applyCoupon);
    R.couponInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyCoupon();
    });
    R.couponInput.addEventListener('input', () => {
      const upper = R.couponInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (upper !== R.couponInput.value) R.couponInput.value = upper;
    });
    R.emailInput.addEventListener('input', () => {
      S.email = R.emailInput.value.trim();
    });

    // ---------- 皮肤 ----------
    const skinsPanel = document.getElementById('panel-skins');
    R.skinsHeadLeft = el('div', { class: 'skins-head__left' });
    R.skinsCta = el('div', { class: 'row' });
    skinsPanel.appendChild(
      el(
        'div',
        { class: 'skins-head' },
        R.skinsHeadLeft,
        R.skinsCta,
      ),
    );
    R.skinsGrid = el('div', { class: 'skin-grid' });
    skinsPanel.appendChild(R.skinsGrid);
    R.skinsTip = el(
      'div',
      { class: 'skins-tip' },
      icon('info'),
      el('span', { text: '点击皮肤立即生效，方块仔会立刻换上；已锁定的皮肤需要 Pro 授权。' }),
    );
    skinsPanel.appendChild(R.skinsTip);

    // ---------- 角色包（DLC） ----------
    buildDlcPanel();

    // ---------- 我的授权 ----------
    buildLicensePanel();
  }

  function pickDefaultPlan() {
    const plans = S.plans || [];
    if (!plans.length) return;
    const featured = plans.find((p) => p.highlight) || plans[1] || plans[0];
    S.selectedPlanId = featured.id;
  }

  function selectedPlan() {
    return (
      (S.plans || []).find((p) => p.id === S.selectedPlanId) ||
      // 已下架的 DLC 不能再作为购买对象（否则会出现「选中已下架商品 → 去下单」）
      sellableDlc().find((d) => d.id === S.selectedPlanId) ||
      null
    );
  }

  function planPeriodLabel(plan) {
    if (!plan) return '';
    if (plan.period === 'year') return '1 年';
    if (plan.period === 'month') return '1 个月';
    return '永久';
  }

  // ==========================================================================
  // 四层定价（免费 / 完整版买断 / AI 订阅 / 情侣）与 DLC
  // 所有价格与权益都来自 state.plans / state.dlc / state.freeTier，不硬编码
  // ==========================================================================
  function isV2License(lic) {
    if (!lic) return false;
    if (lic.baseOwned !== undefined || lic.planExpiry !== undefined || Array.isArray(lic.addons)) return true;
    // 兼容 v1 授权（pro/trial）：视为完整版 + AI 全开
    return ['free', 'base', 'ai', 'couple', 'pro', 'trial'].includes(lic.state);
  }

  function ownedFlags() {
    const lic = S.license || {};
    const feats = lic.features || {};
    const base = !!(lic.baseOwned || ['base', 'ai', 'couple', 'pro', 'trial'].includes(lic.state) || feats.skins_premium);
    return {
      base,
      ai: !!(lic.state === 'ai' || feats.ai_unlimited),
      couple: !!((Number(lic.seats) || 0) > 1 || lic.state === 'couple'),
      addons: Array.isArray(lic.addons) ? lic.addons : [],
      planId: lic.planId || '',
      planExpiry: lic.planExpiry || lic.expiresAt || 0,
      seats: Number(lic.seats) || 0,
      feats,
    };
  }

  function planOwnedState(plan) {
    if (!plan) return { owned: false, extra: '' };
    const flags = ownedFlags();
    const isDlc = plan.requiresBase !== undefined;
    const tier = planTierKey(plan);
    const owned = isDlc
      ? flags.addons.includes(plan.id)
      : tier === 'base'
        ? flags.base
        : tier === 'ai'
          ? flags.ai && flags.planId === plan.id
          : tier === 'couple'
            ? flags.couple
            : false;
    const extra = owned ? '已拥有' : tier === 'ai' || tier === 'couple' ? '含完整版' : '';
    return { owned, extra };
  }

  function basePlanOf() {
    const plans = S.plans || [];
    return (
      plans.find((p) => p.id === 'base') ||
      plans.find((p) => p.grants && p.grants.baseOwned && !p.grants.aiUnlimited && p.period === 'once') ||
      plans[0] ||
      null
    );
  }

  function aiPlansOf() {
    return (S.plans || []).filter((p) => p.grants && p.grants.aiUnlimited);
  }

  function couplePlanOf() {
    return (S.plans || []).find((p) => p.id === 'couple_year' || (p.grants && Number(p.grants.seats) > 1) || Number(p.seats) > 1) || null;
  }

  function dlcOf(skinId) {
    return (S.dlc || []).find((d) => d.skinId === skinId || d.id === skinId) || null;
  }

  /**
   * 可购买的 DLC 列表。
   * catalog 里 available === false 的条目（如已并入完整版的极光/南瓜皮肤包）不再单独售卖，
   * 与站点 store/assets/store.js 的口径保持一致，避免用户在应用内下单到已下架的商品。
   * 历史已购用户仍能看到自己拥有的 addon（dlcOf 走全量列表，不受影响）。
   */
  function sellableDlc() {
    return (S.dlc || []).filter((d) => d.available !== false);
  }

  /** 是否还有可购买的 DLC（决定「角色包」标签页是否展示） */
  function hasSellableDlc() {
    return sellableDlc().length > 0;
  }

  /**
   * DLC 数据到达后同步「角色包」标签页的可见性：
   * 全部下架时隐藏该标签页，并确保不会停留在已隐藏的标签上。
   */
  function syncDlcTab() {
    const btn = R.tabButtons && R.tabButtons.dlc;
    const show = hasSellableDlc();
    if (btn) btn.classList.toggle('hidden', !show);
    if (!show && S.tab === 'dlc') switchTab('upgrade');
    else if (show && S.tab === 'upgrade') updateTabHint();
  }

  function planTierKey(plan) {
    if (!plan) return '';
    if (plan.id === 'base' || (plan.grants && plan.grants.baseOwned && !plan.grants.aiUnlimited && plan.period === 'once')) return 'base';
    if (plan.grants && plan.grants.aiUnlimited) return 'ai';
    if (Number(plan.seats) > 1 || (plan.grants && Number(plan.grants.seats) > 1)) return 'couple';
    return plan.id;
  }

  function tierTitle() {
    const lic = S.license || {};
    const flags = ownedFlags();
    if (lic.state === 'trial') return '体验版 · 剩余 ' + (lic.trialDaysLeft || 0) + ' 天';
    if (lic.state === 'pro') return lic.planName && !/^[a-z_]+$/.test(lic.planName) ? lic.planName : '完整版';
    if (flags.ai) return lic.planName || 'AI 陪伴';
    if (flags.couple) return lic.planName || '情侣双人版';
    if (flags.base) return lic.planName || '完整版';
    return (S.freeTier && S.freeTier.name) || '免费版';
  }

  function freePerkText(free) {
    if (!free) return [];
    const feats = Array.isArray(free.features) ? free.features : [];
    const labels = {
        cinema_mode: '观影模式',
      presence_reactions: '主人状态感知',
      ai_chat: '基础 AI 对话',
    };
    const out = [];
    if (free.aiRoundsPerDay) out.push(`每天 ${free.aiRoundsPerDay} 轮 AI 对话`);
    if (Array.isArray(free.skins) && free.skins.length) out.push(`${free.skins.length} 套免费皮肤`);
    for (const key of feats) if (labels[key]) out.push(labels[key]);
    if (free.watermark) out.push('右下角体验水印');
    return out;
  }

  function compareRow(text, ok, strong) {
    return el(
      'div',
      { class: 'compare-row' + (ok ? ' is-ok' : '') },
      el('span', { class: 'compare-row__icon' }, icon(ok ? 'check' : 'lock')),
      el('span', { class: strong ? 'compare-row__text is-strong' : 'compare-row__text', text }),
    );
  }

  function renderTierBanner() {
    const host = R.tierBanner;
    if (!host) return;
    const flags = ownedFlags();
    const lic = S.license || {};
    clear(host);
    const chips = [];
    if (flags.base) chips.push('完整版');
    if (flags.ai) chips.push('AI 无限');
    if (flags.couple) chips.push(`${flags.seats} 个席位`);
    for (const addonId of flags.addons) {
      const dlc = (S.dlc || []).find((d) => d.id === addonId);
      if (dlc) chips.push(dlc.name.replace('角色包', ''));
    }
    const expiry = flags.planExpiry ? formatDate(flags.planExpiry) : '';
    const sub = flags.ai
      ? `AI 对话无限 · ${expiry ? '有效期至 ' + expiry : '永久有效'}`
      : flags.couple
        ? `${flags.seats} 个席位 · ${expiry ? '有效期至 ' + expiry : '永久'}`
        : flags.base
          ? '完整版已拥有 · 一次买断，永久有效'
          : '免费版：每天有限次数 AI 与 2 套皮肤，随时可升级';

    const left = el(
      'div',
      { class: 'tier-banner__left' },
      el('div', { class: 'ico-tile ico-tile--gold' }, icon(flags.base ? 'crown' : 'leaf')),
      el(
        'div',
        {},
        el('div', { class: 'tier-banner__title' }, el('span', { text: tierTitle() }), ...chips.map((c) => el('span', { class: 'tag tag--accent', text: c }))),
        el('div', { class: 'tier-banner__sub', text: sub }),
      ),
    );
    const actions = el('div', { class: 'tier-banner__actions' });
    const basePlan = basePlanOf();
    if (!flags.base && basePlan) {
      const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('crown'), el('span', { text: `解锁完整版 ${formatMoney(basePlan.price)}` }));
      btn.addEventListener('click', () => selectPlan(basePlan.id, { scroll: true }));
      actions.appendChild(btn);
    } else if (!flags.ai) {
      const aiPlan = aiPlansOf().find((p) => p.period === 'year') || aiPlansOf()[0];
      if (aiPlan) {
        const btn = el('button', { class: 'btn btn--teal btn--sm', type: 'button' }, icon('sparkle'), el('span', { text: `加购 AI 无限 ${formatMoney(aiPlan.price)}${aiPlan.period === 'year' ? '/年' : '/月'}` }));
        btn.addEventListener('click', () => selectPlan(aiPlan.id, { scroll: true }));
        actions.appendChild(btn);
      }
      if (couplePlanOf() && !flags.couple) {
        const cbtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('users'), el('span', { text: '看情侣双人版' }));
        cbtn.addEventListener('click', () => selectPlan(couplePlanOf().id, { scroll: true }));
        actions.appendChild(cbtn);
      }
    }
    const manage = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('shield'), el('span', { text: '我的授权' }));
    manage.addEventListener('click', () => switchTab('license'));
    actions.appendChild(manage);

    host.appendChild(left);
    host.appendChild(actions);
  }

  /** 首屏 C 位：情侣双人版 + 智慧生命（皮肤降级到下面权益区） */
  function renderCoupleHero() {
    const host = R.coupleHero;
    if (!host) return;
    clear(host);
    const flags = ownedFlags();
    const couple = couplePlanOf();
    const life = (app.state && app.state.features && app.state.features.life_system) || null;
    if (!couple && !life) return;
    const demoImage = el('div', { class: 'couple-hero__art' });
    demoImage.appendChild(el('div', { class: 'couple-hero__cube couple-hero__cube--a' }));
    demoImage.appendChild(el('div', { class: 'couple-hero__cube couple-hero__cube--b' }));
    demoImage.appendChild(el('div', { class: 'couple-hero__heart' }, icon('heart')));

    const body = el(
      'div',
      { class: 'couple-hero__body' },
      el(
        'div',
        { class: 'couple-hero__badges' },
        el('span', { class: 'badge badge--couple' }, icon('users'), el('span', { text: '双人主推' })),
        el('span', { class: 'badge badge--teal' }, icon('sparkle'), el('span', { text: '含智慧生命' })),
      ),
      el('div', { class: 'couple-hero__title', text: couple ? couple.name + ' · 两个人一起养' : '两个人一起养方块仔' }),
      el('div', {
        class: 'couple-hero__desc',
        text:
          '两台电脑各自配对，共享纪念日与情话；它还会记得你说过的话（' +
          ((life && life.desc) || '心情、精力、性格与记忆') +
          '）。',
      }),
      (() => {
        const perks = el('div', { class: 'couple-hero__perks' });
        const items = [
          couple ? (Number(couple.seats) || 2) + ' 个完整版席位' : '2 个完整版席位',
          '情侣模式 · 配对/聊天/婚礼',
          '每席位每天 50 轮 AI',
          '永远记住你的偏好',
        ];
        for (const text of items) perks.appendChild(el('div', { class: 'couple-hero__perk' }, icon('check'), el('span', { text })));
        return perks;
      })(),
    );

    const cta = el('div', { class: 'couple-hero__cta' });
    if (couple) {
      const owned = flags.couple;
      const price = el('div', { class: 'couple-hero__price' });
      price.appendChild(el('span', { class: 'couple-hero__cur', text: UI.currency() }));
      price.appendChild(el('span', { class: 'num', text: UI.moneyNumber(couple.price) }));
      price.appendChild(el('span', { class: 'couple-hero__per', text: couple.period === 'year' ? '/年 · 2 席位' : '' }));
      cta.appendChild(price);
      const buy = el(
        'button',
        { class: 'btn btn--primary', type: 'button', disabled: owned ? 'disabled' : null },
        icon(owned ? 'check' : 'users'),
        el('span', { text: owned ? '情侣版已拥有' : '购买情侣双人版' }),
      );
      buy.addEventListener('click', () => selectPlan(couple.id, { scroll: true }));
      cta.appendChild(buy);
    }
    if (life && flags.base) {
      cta.appendChild(el('div', { class: 'tiny dim', text: '智慧生命已包含在完整版与情侣版里' }));
    }

    // 情侣场景预告 chips（当前共 6 个场景）
    const scenes = (app.state && app.state.coupleScenes) || [];
    if (scenes.length) {
      const chips = el('div', { class: 'couple-hero__scenes' });
      for (const scene of scenes.slice(0, 6)) {
        chips.appendChild(
          el('span', { class: 'couple-hero__scene', title: scene.desc || '' }, el('span', { class: 'emoji', text: scene.emoji || '✨' }), el('span', { text: scene.name })),
        );
      }
      body.appendChild(chips);
    }
    host.appendChild(el('div', { class: 'couple-hero__inner' }, demoImage, body, cta));
  }
  function renderCompare() {
    const host = R.compareCard;
    if (!host) return;
    clear(host);
    const free = S.freeTier;
    const basePlan = basePlanOf();
    const flags = ownedFlags();
    if (!free && !basePlan) return;

    host.appendChild(
      el(
        'div',
        { class: 'compare-head' },
        el('div', { class: 'ico-tile ico-tile--sm' }, icon('users')),
        el(
          'div',
          {},
          el('div', { class: 'h4', text: '免费版 vs 完整版' }),
          el('div', { class: 'card__desc', text: '免费版可以一直用；完整版一次买断，解锁全部功能，AI 每天 50 轮。' }),
        ),
      ),
    );

    const freeCol = el('div', { class: 'compare-col compare-col--free' });
    freeCol.appendChild(
      el(
        'div',
        { class: 'compare-col__head' },
        el('div', { class: 'compare-col__name', text: (free && free.name) || '免费版' }),
        el('div', { class: 'compare-col__price' }, el('span', { class: 'num', text: UI.currency() + '0' }), el('span', { class: 'compare-col__period', text: '永久免费' })),
      ),
    );
    for (const text of freePerkText(free)) freeCol.appendChild(compareRow(text, true, false));
    if (!free) freeCol.appendChild(compareRow('免费版权益读取失败', false, false));
    freeCol.appendChild(
      el(
        'div',
        { class: 'compare-col__foot' },
        el('div', { class: 'tiny dim', text: '随时可升级，已产生的数据不会丢。' }),
      ),
    );

    const baseCol = el('div', { class: 'compare-col compare-col--base' });
    if (basePlan) {
      baseCol.appendChild(
        el('span', { class: 'compare-col__badge badge badge--pro' }, icon('crown'), el('span', { text: basePlan.badge || '推荐' })),
        el(
          'div',
          { class: 'compare-col__head' },
          el('div', { class: 'compare-col__name', text: basePlan.name }),
          el(
            'div',
            { class: 'compare-col__price' },
            el('span', { class: 'num', text: formatMoney(basePlan.price) }),
            el('span', { class: 'compare-col__period', text: '一次买断 · 永久有效' }),
          ),
        ),
      );
      const perks = Array.isArray(basePlan.perks) ? basePlan.perks : [];
      for (const text of perks) baseCol.appendChild(compareRow(String(text).replace(/去水印/g, '无体验标识'), true, true));
      baseCol.appendChild(compareRow('不限设备重装（最多 2 台）', true, false));
      const cta = el(
        'button',
        { class: 'btn btn--primary btn--block', type: 'button', style: { marginTop: '12px' } },
        icon(flags.base ? 'check' : 'crown'),
        el('span', { text: flags.base ? '完整版已拥有' : `购买完整版 ${formatMoney(basePlan.price)}` }),
      );
      cta.disabled = flags.base;
      cta.addEventListener('click', () => selectPlan(basePlan.id, { scroll: true }));
      baseCol.appendChild(cta);
    } else {
      baseCol.appendChild(compareRow('完整版方案读取失败', false, false));
    }

    host.appendChild(el('div', { class: 'compare-grid' }, freeCol, baseCol));
  }

  function buildDlcPanel() {
    const panel = document.getElementById('panel-dlc');
    if (!panel) return;
    panel.appendChild(
      el(
        'div',
        { class: 'dlc-intro' },
        el('div', { class: 'ico-tile ico-tile--gold' }, icon('gift')),
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'h3', text: '角色包（DLC）' }),
          el('div', { class: 'card__desc', text: '一次购买永久有效。角色包需要先拥有完整版；已购买的角色包会出现在「皮肤」里。' }),
        ),
        (() => {
          const btn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('arrow-left'), el('span', { text: '去升级完整版' }));
          btn.addEventListener('click', () => switchTab('upgrade'));
          return btn;
        })(),
      ),
    );
    R.dlcGrid = el('div', { class: 'dlc-grid' });
    panel.appendChild(R.dlcGrid);
  }

  function renderDlc() {
    if (!R.dlcGrid) return;
    const flags = ownedFlags();
    // 只渲染仍可单独购买的 DLC；已下架（available === false）的条目不出现在购买列表里
    const dlcList = sellableDlc();
    clear(R.dlcGrid);
    if (!dlcList.length) {
      R.dlcGrid.appendChild(el('div', { class: 'empty' }, icon('gift'), el('div', { text: '暂无可购买的角色包' })));
      return;
    }
    for (const dlc of dlcList) {
      const owned = flags.addons.includes(dlc.id);
      const locked = !!dlc.requiresBase && !flags.base;
      const skin = (S.skins || []).find((s) => s.id === (dlc.skinId || (dlc.skinIds || [])[0])) || null;
      const palette = (skin && skin.palette) || null;
      const card = el('div', { class: 'card dlc-card' + (owned ? ' is-owned' : '') });
      const stage = el('div', { class: 'dlc-card__stage' });
      if (palette) {
        stage.appendChild(
          el('div', {
            class: 'pet-preview',
            style: {
              background: `linear-gradient(158deg, ${palette.body1}, ${palette.body2} 52%, ${palette.body3})`,
              boxShadow: `0 12px 26px rgba(0,0,0,.4), inset 0 2px 0 rgba(255,255,255,.5), 0 0 28px ${palette.glow || 'transparent'}`,
            },
          }),
        );
      }
      if (owned) card.appendChild(el('span', { class: 'dlc-card__badge badge badge--ok' }, icon('check'), el('span', { text: '已拥有' })));
      else if (locked) card.appendChild(el('span', { class: 'dlc-card__badge badge badge--locked' }, icon('lock'), el('span', { text: '需完整版' })));
      card.appendChild(stage);
      card.appendChild(el('div', { class: 'h4', text: dlc.name }));
      card.appendChild(el('div', { class: 'card__desc', text: dlc.desc || '' }));
      const perks = el('ul', { class: 'plan__perks dlc-card__perks' });
      for (const perk of dlc.perks || []) perks.appendChild(el('li', { class: 'plan__perk' }, icon('check'), el('span', { text: perk })));
      card.appendChild(perks);
      const foot = el(
        'div',
        { class: 'dlc-card__foot' },
        el('div', { class: 'dlc-card__price' }, el('span', { class: 'dlc-card__currency', text: UI.currency() }), el('span', { class: 'num', text: UI.moneyNumber(dlc.price) })),
      );
      const btn = el(
        'button',
        { class: 'btn btn--sm' + (owned ? ' btn--ghost' : ' btn--primary'), type: 'button' },
        icon(owned ? 'check' : locked ? 'lock' : 'card'),
        el('span', { text: owned ? '已拥有' : locked ? '需完整版' : '购买' }),
      );
      btn.disabled = owned || locked;
      btn.addEventListener('click', () => {
        if (locked) {
          switchTab('upgrade');
          toast('角色包需要先拥有完整版', 'warn', 3200);
          return;
        }
        selectPlan(dlc.id, { scroll: false });
        startCheckout();
      });
      foot.appendChild(btn);
      card.appendChild(foot);
      R.dlcGrid.appendChild(card);
    }
    if (!flags.base) {
      R.dlcGrid.appendChild(
        el(
          'div',
          { class: 'notice notice--warn dlc-notice' },
          icon('info'),
          el('div', { class: 'notice__body', text: '角色包是完整版的附加内容：先购买完整版，再挑选喜欢的角色包。' }),
        ),
      );
    }
  }

  /** 四层授权状态卡（v2） */
  function renderTierLicense(lic) {
    const ui = (app.state && app.state.ui) || {};
    const flags = ownedFlags();
    const badgeHost = document.getElementById('licBadge');
    if (badgeHost) {
      clear(badgeHost);
      badgeHost.appendChild(UI.licenseBadgeNode(lic, ui));
    }
    if (!R.licStatus) return;
    R.licStatus.dataset.state = lic.state || 'free';

    clear(R.licName);
    clear(R.licCta);
    clear(R.licMeta);
    clear(R.licDesc);
    clear(R.licIconTile);

    R.licIconTile.className = 'ico-tile' + (flags.base ? ' ico-tile--gold' : '');
    R.licIconTile.appendChild(icon(flags.base ? 'crown' : 'leaf'));
    R.licName.appendChild(el('span', { text: tierTitle() }));

    if (flags.base) {
      R.licDesc.textContent = flags.ai
        ? `AI 对话无限 · ${flags.planExpiry ? '有效期至 ' + formatDate(flags.planExpiry) : '永久有效'}；包含完整版全部权益。`
        : `完整版已拥有 · ${flags.couple ? flags.seats + ' 个席位 · ' : ''}一次买断，永久有效；AI 每天可用 50 轮。`;
    } else {
      R.licDesc.textContent = '免费版：每天 10 轮 AI 对话、2 套免费皮肤。升级完整版可解锁全部皮肤、情侣与生命系统。';
    }

    if (flags.planExpiry) {
      const expiryMs = flags.planExpiry > 1e12 ? flags.planExpiry : flags.planExpiry * 1000;
      const daysLeft = Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000));
      R.licDaysNum.textContent = String(daysLeft);
      R.licDaysUnit.textContent = '天后到期';
      R.licDaysLabel.textContent = '到期时间 ' + formatDate(flags.planExpiry);
      R.licProgress.classList.remove('hidden');
      const pct = UI.clamp((daysLeft / 365) * 100, 2, 100);
      const fill = R.licProgress.querySelector('.progress__fill');
      if (fill) fill.style.width = pct + '%';
    } else {
      R.licDaysNum.textContent = flags.base ? '∞' : '—';
      R.licDaysUnit.textContent = flags.base ? '永久有效' : '免费版';
      R.licDaysLabel.textContent = flags.base ? '无需续费' : '随时可以升级';
      R.licProgress.classList.add('hidden');
    }

    if (flags.base) R.licMeta.appendChild(el('span', { class: 'badge badge--pro' }, icon('crown'), el('span', { text: '完整版已解锁' })));
    if (flags.ai) R.licMeta.appendChild(el('span', { class: 'badge badge--teal' }, icon('sparkle'), el('span', { text: 'AI 无限' })));
    if (flags.couple) R.licMeta.appendChild(el('span', { class: 'badge' }, icon('users'), el('span', { text: flags.seats + ' 个席位' })));
    for (const addonId of flags.addons) {
      const dlc = (S.dlc || []).find((d) => d.id === addonId);
      if (dlc) R.licMeta.appendChild(el('span', { class: 'badge badge--gold' }, icon('gift'), el('span', { text: dlc.name })));
    }
    if (!flags.base) R.licMeta.appendChild(el('span', { class: 'badge badge--locked' }, icon('lock'), el('span', { text: '部分功能未解锁' })));

    if (!flags.base) {
      const upgrade = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '解锁完整版' }));
      upgrade.addEventListener('click', () => switchTab('upgrade'));
      R.licCta.appendChild(upgrade);
    } else if (!flags.ai) {
      const addAi = el('button', { class: 'btn btn--teal', type: 'button' }, icon('sparkle'), el('span', { text: '加购 AI 无限' }));
      addAi.addEventListener('click', () => switchTab('upgrade'));
      R.licCta.appendChild(addAi);
      const manage = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('shield'), el('span', { text: '管理授权' }));
      manage.addEventListener('click', () => switchTab('license'));
      R.licCta.appendChild(manage);
    } else {
      const manage = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('shield'), el('span', { text: '管理授权' }));
      manage.addEventListener('click', () => switchTab('license'));
      R.licCta.appendChild(manage);
    }

    // 设备与 KV
    if (R.deviceIdText) R.deviceIdText.textContent = shortId(lic.deviceId || '', 8, 8);
    if (R.licPlanKv) R.licPlanKv.textContent = tierTitle();
    if (R.licEmailKv) R.licEmailKv.textContent = lic.email || '未绑定';
  }
  function planMetaText(plan) {
    if (!plan) return '';
    const plans = S.plans || [];
    const monthly = plans.find((p) => p.period === 'month');
    const tier = planTierKey(plan);
    const flags = ownedFlags();
    if (tier === 'base') {
      return flags.base ? '已拥有 · 永久有效' : '一次买断 · 永久有效';
    }
    if (tier === 'ai') {
      if (plan.period === 'year') {
        const perMonth = Math.round(plan.price / 12);
        const monthPlan = plans.find((p) => planTierKey(p) === 'ai' && p.period === 'month');
        const monthlyFull = monthPlan ? Math.round((monthPlan.price * 12 * plan.price) / plan.price) : 0;
        const save = monthPlan ? Math.round((1 - UI.regionAmount(plan.price) / (UI.regionAmount(monthPlan.price) * 12)) * 100) : 0;
        return `含完整版 · 折合每月 ${UI.formatMoneyPart(plan.price, 1 / 12)}` + (monthlyFull && save > 0 ? ` · 省 ${save}%` : '');
      }
      return '含完整版 · 按月订阅，可随时取消';
    }
    if (tier === 'couple') {
      return `含完整版 · ${plan.seats || (plan.grants && plan.grants.seats) || 2} 个席位`;
    }
    // 多账号方案（如情侣双人版）优先展示「每账号折算」
    if (plan.seats && plan.seats > 1) {
      const perSeat = Math.round(plan.price / plan.seats);
      const period = plan.period === 'year' ? '/ 年' : plan.period === 'month' ? '/ 月' : '';
      return `含 ${plan.seats} 个 Pro 账号 · 折合每账号 ${UI.formatMoneyPart(plan.price, 1 / plan.seats)} ${period}`.trim();
    }
    if (plan.period === 'year' && monthly) {
      const perMonth = Math.round(plan.price / 12);
      const full = monthly.price * 12;
      return `折合每月 ${UI.formatMoneyPart(plan.price, 1 / 12)}${full > plan.price ? ' · 省 ' + UI.formatRegionDiff(monthly.price, 12, plan.price) : ''}`;
    }
    if (plan.requiresBase !== undefined) {
      return '一次购买 · 永久有效 · 需完整版';
    }
    if (plan.period === 'once') {
      const yearly = plans.find((p) => p.period === 'year');
      if (yearly && yearly.price > 0) {
        const months = Math.floor(plan.price / (yearly.price / 12));
        return `永久有效 · 约等于 ${months} 个月的年度会员`;
      }
      return '永久有效 · 含未来全部皮肤';
    }
    return '按月订阅，可随时取消';
  }

  function buildPlanCard(plan) {
    const card = el('div', {
      class: 'plan' + (plan.highlight ? ' plan--featured' : '') + (plan.id === S.selectedPlanId ? ' is-selected' : ''),
      role: 'button',
      tabindex: '0',
      dataset: { plan: plan.id },
      'aria-pressed': plan.id === S.selectedPlanId ? 'true' : 'false',
    });
    if (plan.badge) {
      card.appendChild(
        el('span', { class: 'plan__ribbon' }, icon(plan.highlight ? 'sparkle' : 'bolt'), el('span', { text: plan.badge })),
      );
    }
    card.appendChild(el('div', { class: 'plan__check' }, icon('check')));

    const head = el(
      'div',
      {},
      el('div', { class: 'plan__name', text: plan.name }),
      el('div', { class: 'card__desc', text: plan.desc || '' }),
    );
    card.appendChild(head);

    const price = el(
      'div',
      { class: 'plan__price' },
      el('span', { class: 'plan__currency', text: UI.currency() }),
      el('span', { class: 'plan__amount num', text: UI.moneyNumber(plan.price) }),
      el('span', { class: 'plan__period', text: plan.period === 'once' ? '一次买断' : '/ ' + (plan.period === 'year' ? '年' : '月') }),
    );
    card.appendChild(price);
    card.appendChild(el('div', { class: 'plan__meta', text: planMetaText(plan) + (planOwnedState(plan).extra ? ' · ' + planOwnedState(plan).extra : '') }));

    if (planOwnedState(plan).owned) card.classList.add('plan--owned');
    const list = el('ul', { class: 'plan__perks' });
    for (const perk of plan.perks || []) {
      list.appendChild(el('li', { class: 'plan__perk' }, icon('check'), el('span', { text: perk })));
    }
    card.appendChild(list);

    card.addEventListener('click', () => selectPlan(plan.id));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPlan(plan.id);
      }
    });
    return card;
  }

  async function selectPlan(planId) {
    if (S.selectedPlanId === planId) return;
    S.selectedPlanId = planId;
    renderPlans();
    if (S.coupon) await revalidateCoupon(true);
    else renderSummary();
  }

  function renderPlans() {
    if (R.tierBanner) renderTierBanner();
    if (R.coupleHero) renderCoupleHero();
    if (R.compareCard) renderCompare();
    if (R.dlcGrid) renderDlc();
    if ((!S.dlc || !S.dlc.length) && app.state && Array.isArray(app.state.dlc)) S.dlc = app.state.dlc;
    const plans = S.plans || [];
    if (!R.plansGrid) return;
    if (!plans.length) {
      clear(R.plansGrid);
      R.plansGrid.appendChild(el('div', { class: 'skeleton', style: { height: '292px' } }));
      return;
    }
    clear(R.plansGrid);
    for (const plan of plans) R.plansGrid.appendChild(buildPlanCard(plan));

    // 权益：catalog 的 proBenefits + features 里未罗列的两个新能力（观影 / 状态感知）
    clear(R.benefitsGrid);
    const benefits = ((app.state && app.state.proBenefits) || []).slice().sort((a, b) => {
      const rank = (x) => {
        const t = String((x && (x.title || x.name)) || '');
        if (/智慧生命|情侣|AI/.test(t)) return 0;
        if (/皮肤/.test(t)) return 2;
        return 1;
      };
      return rank(a) - rank(b);
    });
    const features = (app.state && app.state.features) || {};
    const extras = [
      { key: 'cinema_mode', icon: 'moon' },
      { key: 'presence_reactions', icon: 'eye' },
    ]
      .filter((item) => features[item.key] && features[item.key].name)
      .map((item) => ({
        icon: item.icon,
        title: features[item.key].name,
        desc: features[item.key].desc,
        isNew: true,
      }));
    for (const b of [...benefits, ...extras]) {
      R.benefitsGrid.appendChild(
        el(
          'div',
          { class: 'benefit' + (b.isNew ? ' benefit--new' : '') },
          el('div', { class: 'ico-tile ico-tile--sm' }, icon(b.icon || 'sparkle')),
          el(
            'div',
            { class: 'benefit__body' },
            el(
              'div',
              { class: 'benefit__title' },
              el('span', { text: b.title }),
              b.isNew ? el('span', { class: 'tag tag--teal', text: 'NEW' }) : null,
            ),
            el('div', { class: 'benefit__desc', text: b.desc }),
          ),
        ),
      );
    }

    renderServerState();
    renderSummary();
    updateTabHint();
  }

  function renderServerState() {
    if (!R.offlineNotice) return;
    const state = S.server;
    clear(R.offlineNotice);
    const stripeTest = state.stripeTest || S.stripeTest;
    const unknown = state.online === null;
    const offline = state.online === false;
    if (R.payMethodsText) {
      R.payMethodsText.textContent = stripeTest && stripeTest.enabled
        ? 'Google Pay（Stripe 测试）· 测试卡'
        : '支付宝 / 微信 / 银行卡';
    }
    if (R.activateGuarantee) {
      R.activateGuarantee.textContent = stripeTest && stripeTest.enabled
        ? '测试支付只记订单，不自动激活'
        : '支付成功后自动激活';
    }

    if (stripeTest && stripeTest.blockCheckout) {
      R.offlineNotice.className = 'notice notice-bar';
      R.offlineNotice.appendChild(icon('warning'));
      R.offlineNotice.appendChild(el('div', { class: 'notice__body', text: stripeTest.message || '正式扣款未开启。' }));
      return;
    }
    if (stripeTest && stripeTest.enabled) {
      R.offlineNotice.className = 'notice notice--info notice-bar';
      R.offlineNotice.appendChild(icon('card'));
      R.offlineNotice.appendChild(el('div', {
        class: 'notice__body',
        text: 'Stripe 测试模式已开启。结账会打开 Stripe 托管页，可使用 Google Pay 或测试卡。不会真实扣款，也不会写入正式授权。人民币标价未改；本次测试收款使用目录中的美元价。',
      }));
      return;
    }

    if (unknown) {
      R.offlineNotice.className = 'notice notice--info notice-bar';
      R.offlineNotice.appendChild(icon('refresh'));
      R.offlineNotice.appendChild(
        el('div', { class: 'notice__body', text: '正在连接许可服务…（' + (state.base || S.license?.apiBase || '') + '）' }),
      );
    } else if (offline) {
      R.offlineNotice.className = 'notice notice-bar';
      R.offlineNotice.appendChild(icon('wifi-off'));
      R.offlineNotice.appendChild(
        el(
          'div',
          { class: 'notice__body' },
          el('div', { class: 'h4', style: { color: '#ffc0c0' }, text: '许可服务未启动，暂时无法购买' }),
          el('div', {
            class: 'small',
            text:
              '请先启动本机的许可服务端（默认 ' + (state.base || 'http://127.0.0.1:8787') + '），或在「设置 → 系统 → API 地址」中修改地址后重试。',
          }),
        ),
      );
      const retry = el('button', { class: 'btn btn--sm', type: 'button' }, icon('refresh'), el('span', { text: '重试' }));
      retry.addEventListener('click', () => {
        retry.disabled = true;
        loadStore(true).finally(() => {
          retry.disabled = false;
        });
      });
      R.offlineNotice.appendChild(retry);
    } else {
      R.offlineNotice.className = 'notice notice--info notice-bar hidden';
    }
  }

  function renderSummary() {
    const plan = selectedPlan();
    if (!R.sumPlan) return;
    if (!plan) {
      R.sumPlan.textContent = '—';
      R.sumPeriod.textContent = '—';
      R.sumTotal.textContent = '0';
      R.buyBtn.disabled = true;
      return;
    }

    R.sumPlan.textContent = plan.name;
    R.sumPeriod.textContent = planPeriodLabel(plan);

    const base = plan.price;
    const discount = S.coupon ? Math.max(0, Math.min(base - 1, S.coupon.discountCents || 0)) : 0;
    const total = S.coupon && Number.isFinite(S.coupon.finalPriceCents) ? Math.max(0, S.coupon.finalPriceCents) : base - discount;
    const quote = plan.stripeTestQuote;

    if (quote && quote.amountText) {
      R.sumDiscountRow.classList.add('hidden');
      R.sumOriginal.classList.add('hidden');
      if (R.sumCurrency) R.sumCurrency.textContent = '';
      R.sumTotal.textContent = quote.amountText;
    } else {
      if (discount > 0) {
        R.sumDiscountRow.classList.remove('hidden');
        R.sumDiscount.textContent = '-' + formatMoney(discount);
        R.sumOriginal.classList.remove('hidden');
        R.sumOriginal.textContent = '原价 ' + formatMoney(base);
      } else {
        R.sumDiscountRow.classList.add('hidden');
        R.sumOriginal.classList.add('hidden');
      }
      if (R.sumCurrency) R.sumCurrency.textContent = UI.currency();
      R.sumTotal.textContent = UI.moneyNumber(total);
    }

    // 促销提示：测试模式说明实收金额；有券显示券信息，否则显示年卡折算
    clear(R.sumPromo);
    R.sumPromo.appendChild(icon(quote ? 'card' : S.coupon ? 'gift' : 'sparkle'));
    if (quote && quote.amountText) {
      const billing = quote.mode === 'subscription' ? '订阅' : '一次性';
      R.sumPromo.appendChild(el('span', {
        text: `本次 Stripe 测试收款 ${quote.amountText}（${billing}，目录美元价）。人民币标价未改，优惠码不参与测试扣款。`,
      }));
    } else if (S.coupon) {
      R.sumPromo.appendChild(
        el('span', { text: '已使用优惠码 ' + S.coupon.code + (S.coupon.description ? '（' + S.coupon.description + '）' : '') }),
      );
    } else {
      R.sumPromo.appendChild(el('span', { text: planMetaText(plan) }));
    }

    const flags = ownedFlags();
    const isDlc = plan.requiresBase !== undefined;
    const dlcLocked = isDlc && plan.requiresBase && !flags.base;
    const offline = S.server.online === false;
    const checking = S.server.online === null;
    R.buyBtn.disabled = offline || checking || S.buyBusy || dlcLocked;
    const label = R.buyBtn.querySelector('span');
    if (label) {
      if (S.buyBusy) label.textContent = '正在创建订单…';
      else if (S.stripeTest && S.stripeTest.blockCheckout) label.textContent = '测试结账未就绪';
      else if (offline) label.textContent = '许可服务未启动';
      else if (checking) label.textContent = '正在检查许可服务…';
      else if (dlcLocked) label.textContent = '需先拥有完整版';
      else if (isDlc) label.textContent = '购买角色包';
      else if (planTierKey(plan) === 'base') label.textContent = flags.base ? '完整版已拥有' : '购买完整版';
      else if (planTierKey(plan) === 'ai') label.textContent = flags.ai ? '延长 AI 订阅' : '订阅 AI 陪伴';
      else if (planTierKey(plan) === 'couple') label.textContent = flags.couple ? '延长情侣版' : '购买情侣双人版';
      else label.textContent = '立即升级 Pro';
    }
  }

  // -------------------------------------------------------------- 优惠码
  async function applyCoupon() {
    const code = R.couponInput.value.trim().toUpperCase();
    if (!code) {
      S.coupon = null;
      renderCouponStatus();
      renderSummary();
      return;
    }
    if (S.couponBusy) return;
    S.couponBusy = true;
    R.couponBtn.disabled = true;
    R.couponStatus.className = 'coupon-status';
    clear(R.couponStatus);
    R.couponStatus.appendChild(el('span', { class: 'dim', text: '正在校验优惠码…' }));

    const res = await app.invoke(IPC.STORE_COUPON, { code, planId: S.selectedPlanId }, { gate: false });
    S.couponBusy = false;
    R.couponBtn.disabled = false;

    if (res && res.ok) {
      S.coupon = {
        code: res.code || code,
        discountCents: Number(res.discountCents) || 0,
        finalPriceCents: Number.isFinite(res.finalPriceCents) ? res.finalPriceCents : undefined,
        description: res.description || '',
      };
      renderCouponStatus();
      renderSummary();
      toast('优惠码已生效', 'ok');
    } else {
      S.coupon = null;
      renderCouponStatus(res && res.message ? res.message : '优惠码无效或已过期', true);
      renderSummary();
    }
  }

  async function revalidateCoupon(silent) {
    if (!S.coupon) return;
    const res = await app.invoke(IPC.STORE_COUPON, { code: S.coupon.code, planId: S.selectedPlanId }, { gate: false });
    if (res && res.ok) {
      S.coupon.discountCents = Number(res.discountCents) || 0;
      S.coupon.finalPriceCents = Number.isFinite(res.finalPriceCents) ? res.finalPriceCents : undefined;
      renderCouponStatus();
    } else {
      S.coupon = null;
      renderCouponStatus('该优惠码不适用于当前方案', true);
      if (!silent) toast('优惠码已失效，请重新选择', 'warn');
    }
    renderSummary();
  }

  function renderCouponStatus(message, isError) {
    if (!R.couponStatus) return;
    clear(R.couponStatus);
    if (message) {
      R.couponStatus.className = 'coupon-status coupon-status--err';
      R.couponStatus.appendChild(icon('warning'));
      R.couponStatus.appendChild(el('span', { text: message }));
      return;
    }
    if (S.coupon) {
      R.couponStatus.className = 'coupon-status coupon-status--ok';
      R.couponStatus.appendChild(icon('check-circle'));
      R.couponStatus.appendChild(
        el('span', {
          text: `已减 ${formatMoney(S.coupon.discountCents)}` + (S.coupon.description ? ' · ' + S.coupon.description : ''),
        }),
      );
    } else {
      R.couponStatus.className = 'coupon-status';
    }
  }

  // -------------------------------------------------------------- 下单
  async function startCheckout() {
    const plan = selectedPlan();
    if (!plan || S.buyBusy) return;
    if (S.server.online === false) {
      toast('许可服务未启动，无法下单。请先启动服务端后重试', 'err', 4200);
      return;
    }
    S.buyBusy = true;
    renderSummary();

    const res = await app.invoke(
      IPC.STORE_CHECKOUT,
      {
        planId: plan.id,
        couponCode: S.coupon ? S.coupon.code : undefined,
        email: S.email || undefined,
      },
      { gate: false },
    );
    S.buyBusy = false;
    renderSummary();

    if (!res || !res.ok) {
      if (res && (res.code === 'SERVER_OFFLINE' || res.offline)) {
        S.server = { online: false, base: S.server.base || S.license?.apiBase, error: res.message };
        renderServerState();
        renderSummary();
      }
      toast((res && res.message) || '创建订单失败，请稍后重试', 'err', 4600);
      return;
    }

    const order = res.order || {};
    const fallbackAmount = plan.stripeTestQuote ? plan.stripeTestQuote.amount : plan.price - (S.coupon ? S.coupon.discountCents || 0 : 0);
    S.order = {
      id: order.id || order.orderId || '',
      planId: order.planId || plan.id,
      amount: Number.isFinite(order.amount) ? order.amount : fallbackAmount,
      amountText: order.amountText || (plan.stripeTestQuote && plan.stripeTestQuote.amountText) || '',
      currency: order.currency || '',
      status: order.status || 'pending',
      payUrl: order.payUrl || '',
      expiresAt: order.expiresAt || 0,
      createdAt: order.createdAt || 0,
      testMode: !!order.testMode,
      stripeCheckoutSessionId: order.stripeCheckoutSessionId || '',
      stripePaymentIntentId: order.stripePaymentIntentId || '',
      plan,
    };
    S.payKey = '';
    S.pollErrors = 0;
    S.payPhase = 'waiting';
    S.pollDeadline = Date.now() + (S.order.testMode ? TEST_PAY_WAIT_LIMIT_MS : PAY_WAIT_LIMIT_MS);

    renderPayView();
    startPolling();

    // 主进程通常已经在系统浏览器打开支付页；若没有 payUrl 则提示用户
    if (!S.order.payUrl) toast('订单已创建，请在弹出的支付页完成付款', 'info', 4000);
    else if (S.order.testMode) toast('已打开 Stripe 测试结账，可使用 Google Pay 或测试卡', 'info', 4200);
  }

  function startPolling() {
    stopPolling();
    S.pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
    S.countdownTimer = setInterval(updatePayTimer, 1000);
    pollOnce();
  }

  function stopPolling() {
    if (S.pollTimer) clearInterval(S.pollTimer);
    if (S.countdownTimer) clearInterval(S.countdownTimer);
    S.pollTimer = null;
    S.countdownTimer = null;
  }

  async function pollOnce() {
    if (S.payPhase !== 'waiting' || !S.order) return;
    if (Date.now() > S.pollDeadline) {
      failPay('等待支付超时');
      return;
    }
    const res = await app.invoke(IPC.STORE_ORDER, { orderId: S.order.id }, { gate: false });
    if (!res || !res.ok) {
      S.pollErrors += 1;
      if (S.pollErrors >= 6 && res && (res.code === 'SERVER_OFFLINE' || res.code === 'NETWORK_ERROR')) {
        failPay('与许可服务的连接中断');
      }
      return;
    }
    S.pollErrors = 0;
    const order = res.order || {};
    if (order.status === 'paid') {
      if (S.order) {
        S.order.status = 'paid';
        S.order.testMode = !!(order.testMode || S.order.testMode);
        S.order.amountText = order.amountText || S.order.amountText || '';
        S.order.stripeCheckoutSessionId = order.stripeCheckoutSessionId || S.order.stripeCheckoutSessionId || '';
        S.order.stripePaymentIntentId = order.stripePaymentIntentId || S.order.stripePaymentIntentId || '';
      }
      await onOrderPaid(order);
      return;
    }
    // 测试结账的取消页不会把仍可支付的会话写成终态。即便账本里暂时是 cancelled，也继续向 Stripe 核对。
    if (order.status === 'cancelled' && !(order.testMode || (S.order && S.order.testMode))) {
      failPay('订单已取消');
      return;
    }
    if (order.status === 'expired') {
      failPay('订单已过期，请重新下单');
      return;
    }
    if (Number.isFinite(order.amount)) S.order.amount = order.amount;
  }

  async function onOrderPaid(order) {
    stopPolling();
    if (order && order.testMode) {
      S.payPhase = 'recorded';
      S.payKey = '';
      renderPayView();
      toast('测试订单已入账。没有真实扣款，也没有签发正式激活码。', 'ok', 4600);
      return;
    }
    S.payPhase = 'activating';
    S.payKey = order.licenseKey || '';
    renderPayView();

    if (!order.licenseKey) {
      S.payPhase = 'keyissue';
      S.payReason = '支付已到账，但订单没有返回激活码。请联系支持并附上订单号。';
      renderPayView();
      await app.refresh();
      return;
    }

    const res = await app.invoke(
      IPC.LICENSE_ACTIVATE,
      { key: order.licenseKey, email: S.email || undefined },
      { gate: false },
    );
    await app.refresh();
    if (!res || !res.ok) {
      S.payPhase = 'keyissue';
      S.payReason = (res && res.message) || '激活失败，请稍后重试';
      renderPayView();
      toast('支付成功，但自动激活失败：' + S.payReason, 'warn', 5200);
      return;
    }

    S.payPhase = 'success';
    renderPayView();
    toast('Pro 已解锁，感谢支持！', 'ok', 3600);
    loadStore(true);
  }

  function failPay(reason) {
    stopPolling();
    S.payPhase = 'failed';
    S.payReason = reason;
    renderPayView();
  }

  function updatePayTimer() {
    if (S.payPhase !== 'waiting' || !R.payTimerText) return;
    const left = Math.max(0, S.pollDeadline - Date.now());
    R.payTimerText.textContent = formatDuration(left);
    if (left <= 0) failPay('等待支付超时');
  }

  // -------------------------------------------------------------- 支付视图
  function renderPayView() {
    if (!R.payHost) return;
    clear(R.payHost);
    R.payTimerText = null;

    const plansMain = document.getElementById('plansMain');
    const showPay = S.payPhase !== 'idle';
    plansMain.classList.toggle('hidden', showPay);
    R.payHost.classList.toggle('hidden', !showPay);
    if (!showPay) return;

    const view = el('div', { class: 'pay-view' });
    if (S.payPhase === 'success') view.appendChild(buildSuccessView());
    else if (S.payPhase === 'recorded') view.appendChild(buildRecordedView());
    else if (S.payPhase === 'failed') view.appendChild(buildFailedView());
    else if (S.payPhase === 'keyissue') view.appendChild(buildKeyIssueView());
    else view.appendChild(buildWaitingView());
    R.payHost.appendChild(view);
  }

  function buildWaitingView() {
    const order = S.order || {};
    const plan = order.plan || selectedPlan();
    const activating = S.payPhase === 'activating';

    const top = el(
      'div',
      { class: 'pay-card__top' },
      activating ? el('div', { class: 'pay-spinner' }) : el('div', { class: 'pay-spinner' }),
      el('div', { class: 'pay-title', text: activating ? '支付成功，正在激活…' : '等待支付完成' }),
      el('div', {
        class: 'pay-sub',
        text: activating
          ? '正在用订单中的激活码为这台设备激活 Pro，请稍候。'
          : order.testMode
            ? '已在系统浏览器打开 Stripe 测试结账页。请使用测试卡或 Google Pay 测试卡组，不会真实扣款。'
            : '已在系统浏览器打开支付页。完成付款后，这里会在几秒内自动解锁。',
      }),
      order.amountText
        ? el('div', { class: 'pay-amount' }, el('span', { class: 'num', text: order.amountText }))
        : el(
          'div',
          { class: 'pay-amount' },
          el('span', { class: 'currency', text: UI.currency() }),
          el('span', { class: 'num', text: UI.moneyNumber(order.amount || 0) }),
        ),
    );

    const rows = el('div', { class: 'pay-rows' });
    rows.appendChild(payRow('订单号', order.id || '—', true));
    rows.appendChild(payRow('会员方案', plan ? plan.name : '—', false));
    rows.appendChild(payRow('有效期', plan ? planPeriodLabel(plan) : '—', false));
    if (S.coupon && S.coupon.discountCents) {
      rows.appendChild(payRow('优惠', '-' + formatMoney(S.coupon.discountCents) + ' · ' + S.coupon.code, false));
    }
    rows.appendChild(
      el(
        'div',
        { class: 'pay-row' },
        el('span', { class: 'pay-row__label', text: '状态' }),
        el(
          'span',
          { class: 'pay-row__value' },
          el('span', { class: 'dot dot--warn' }),
          el('span', { text: activating ? '激活中' : '等待支付' }),
        ),
      ),
    );

    const timer = el(
      'div',
      { class: 'pay-timer' },
      icon('timer'),
      el('span', { text: '将在' }),
      (R.payTimerText = el('strong', { text: formatDuration(Math.max(0, S.pollDeadline - Date.now())) })),
      el('span', { text: '内自动检测支付结果，你也可以直接关闭此窗口' }),
    );

    const actions = el('div', { class: 'pay-actions' });
    const reopen = el('button', { class: 'btn', type: 'button' }, icon('external'), el('span', { text: '重新打开支付页' }));
    reopen.disabled = !order.payUrl || activating;
    reopen.addEventListener('click', () => {
      if (order.payUrl) app.openExternal(order.payUrl);
      else toast('订单没有返回支付链接，请取消后重新下单', 'warn');
    });
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button' }, el('span', { text: '取消本次购买' }));
    cancel.disabled = activating;
    cancel.addEventListener('click', cancelCheckout);
    actions.appendChild(reopen);
    actions.appendChild(cancel);

    return el(
      'div',
      { class: 'card pay-card' },
      top,
      rows,
      timer,
      actions,
      el('div', {
        class: 'pay-note',
        text: order.testMode
          ? 'Google Pay 出现在 Stripe 托管结账页上。若没看到，请确认 Dashboard 处于 Test mode，并已打开 Google Pay；用 Chrome 登录带有卡片的 Google 账号，实际付款请走测试卡。'
          : '提示：若支付页没有自动弹出，可能是浏览器拦截了弹窗。也可以稍后从「我的授权」中重新激活。',
      }),
    );
  }

  function payRow(label, value, mono) {
    const val = el('span', { class: 'pay-row__value' });
    const text = el('span', { class: mono ? 'mono' : '', text: String(value) });
    val.appendChild(text);
    if (mono && value && value !== '—') {
      const copyBtn = el('button', { class: 'btn btn--sm btn--icon', type: 'button', title: '复制订单号' }, icon('copy'));
      copyBtn.addEventListener('click', async () => {
        const ok = await UI.copyText(String(value));
        toast(ok ? '订单号已复制' : '复制失败，请手动选择', ok ? 'ok' : 'err');
      });
      val.appendChild(copyBtn);
    }
    return el('div', { class: 'pay-row' }, el('span', { class: 'pay-row__label', text: label }), val);
  }

  async function cancelCheckout() {
    const ok = await confirmDialog({
      title: '取消本次购买？',
      desc: '订单会保留在服务器上（未支付会自动过期），你可以随时重新下单。',
      confirmLabel: '取消购买',
      cancelLabel: '继续等待',
      danger: true,
    });
    if (!ok) return;
    stopPolling();
    S.payPhase = 'idle';
    S.order = null;
    S.payKey = '';
    renderPayView();
    toast('已取消本次购买', 'info');
  }

  function buildRecordedView() {
    const order = S.order || {};
    const wrap = el(
      'div',
      { class: 'card result-card' },
      el('div', { class: 'result__ring result__ring--teal' }, icon('check')),
      el('div', { class: 'h2', text: '测试订单已入账' }),
      el('div', {
        class: 'pay-sub',
        text: 'Stripe 测试模式已记录这张订单。没有真实扣款，也没有签发正式激活码，生产授权保持关闭。',
      }),
    );
    const rows = el('div', { class: 'pay-rows' });
    rows.appendChild(payRow('订单号', order.id || '—', true));
    rows.appendChild(payRow('Checkout Session', order.stripeCheckoutSessionId || '—', true));
    rows.appendChild(payRow('PaymentIntent', order.stripePaymentIntentId || '—', true));
    rows.appendChild(payRow('金额', order.amountText || '—', false));
    wrap.appendChild(rows);
    const back = el('button', { class: 'btn btn--primary', type: 'button' }, el('span', { text: '返回方案' }));
    back.addEventListener('click', () => {
      S.payPhase = 'idle';
      renderPayView();
    });
    wrap.appendChild(el('div', { class: 'result-actions' }, back));
    wrap.appendChild(el('div', {
      class: 'pay-note',
      text: '在 Stripe Dashboard 的 Test mode 里，可以用 Checkout Session 编号找到这张订单。正式收款需要另一次明确开启。',
    }));
    return wrap;
  }

  function buildSuccessView() {
    const lic = (app.state && app.state.license) || S.license || {};
    const plan = lic.planName || (S.order && S.order.plan ? S.order.plan.name : 'Pro 会员');
    const perks = (S.order && S.order.plan && S.order.plan.perks) || [];
    const wrap = el(
      'div',
      { class: 'card result-card' },
      el('div', { class: 'result__ring' }, icon('check')),
      el('div', { class: 'h2', text: 'Pro 已解锁' }),
      el('div', {
        class: 'pay-sub',
        text: lic.expiresAt
          ? `${plan} · 有效期至 ${formatDate(lic.expiresAt)}。全部功能与皮肤已即时生效。`
          : `已开通 ${plan}。全部功能与皮肤已即时生效，永久有效。`,
      }),
    );
    const chips = el('div', { class: 'result-perks' });
    const list = perks.length ? perks : ['全部 Pro 功能', '全部高级皮肤'];
    for (const p of list) {
      chips.appendChild(el('span', { class: 'tag tag--teal' }, icon('check'), el('span', { text: p })));
    }
    wrap.appendChild(chips);

    const actions = el('div', { class: 'result-actions' });
    const goSettings = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('sliders'), el('span', { text: '去设置里逛逛' }));
    goSettings.addEventListener('click', () => app.openPanel('settings'));
    const viewLicense = el('button', { class: 'btn btn--primary', type: 'button' }, icon('shield'), el('span', { text: '查看我的授权' }));
    viewLicense.addEventListener('click', () => {
      S.payPhase = 'idle';
      renderPayView();
      switchTab('license');
      renderLicense();
    });
    actions.appendChild(goSettings);
    actions.appendChild(viewLicense);
    wrap.appendChild(actions);
    wrap.appendChild(
      el('div', { class: 'pay-note', text: '授权已绑定到本机设备；更换电脑时可在「我的授权」中解除绑定。' }),
    );
    return wrap;
  }

  function buildKeyIssueView() {
    const wrap = el(
      'div',
      { class: 'card result-card' },
      el('div', { class: 'result__ring result__ring--teal' }, icon('key')),
      el('div', { class: 'h2', text: '支付成功，激活需要手动确认' }),
      el('div', { class: 'pay-sub', text: S.payReason || '自动激活没有成功。' }),
    );
    if (S.payKey) {
      wrap.appendChild(el('div', { class: 'small muted', text: '你的激活码（已自动复制，可稍后粘贴到「我的授权」）' }));
      const keyBox = el('div', { class: 'manual-key' }, el('span', { text: S.payKey }));
      const copyBtn = el('button', { class: 'btn btn--sm btn--icon', type: 'button', title: '复制激活码' }, icon('copy'));
      copyBtn.addEventListener('click', async () => {
        const ok = await UI.copyText(S.payKey);
        toast(ok ? '激活码已复制' : '复制失败', ok ? 'ok' : 'err');
      });
      keyBox.appendChild(copyBtn);
      wrap.appendChild(keyBox);
      UI.copyText(S.payKey);
    }
    const actions = el('div', { class: 'result-actions' });
    if (S.payKey) {
      const retry = el('button', { class: 'btn', type: 'button' }, icon('refresh'), el('span', { text: '重试激活' }));
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        const res = await app.invoke(IPC.LICENSE_ACTIVATE, { key: S.payKey, email: S.email || undefined }, { gate: false });
        retry.disabled = false;
        await app.refresh();
        if (res && res.ok) {
          S.payPhase = 'success';
          renderPayView();
          toast('激活成功，Pro 已解锁', 'ok');
        } else {
          S.payReason = (res && res.message) || '激活仍然失败';
          renderPayView();
          toast(S.payReason, 'err', 4600);
        }
      });
      actions.appendChild(retry);
    }
    const goLicense = el('button', { class: 'btn btn--primary', type: 'button' }, el('span', { text: '去「我的授权」手动激活' }));
    goLicense.addEventListener('click', () => {
      S.payPhase = 'idle';
      renderPayView();
      switchTab('license');
      if (R.activateInput && S.payKey) R.activateInput.value = S.payKey;
    });
    actions.appendChild(goLicense);
    wrap.appendChild(actions);
    return wrap;
  }

  function buildFailedView() {
    const actions = el('div', { class: 'result-actions' });
    const back = el('button', { class: 'btn btn--primary', type: 'button' }, el('span', { text: '返回方案' }));
    back.addEventListener('click', () => {
      S.payPhase = 'idle';
      S.order = null;
      renderPayView();
    });
    const retry = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('refresh'), el('span', { text: '重新下单' }));
    retry.addEventListener('click', () => {
      S.payPhase = 'idle';
      renderPayView();
      startCheckout();
    });
    actions.appendChild(retry);
    actions.appendChild(back);
    return el(
      'div',
      { class: 'card result-card' },
      el('div', { class: 'result__ring', style: { background: 'linear-gradient(150deg,#ffb0b0,#e5484d)', color: '#2a0b0b' } }, icon('warning')),
      el('div', { class: 'h2', text: S.payReason || '本次支付没有完成' }),
      el('div', { class: 'pay-sub', text: '如果已经扣款，请不要重复支付。可回到「我的授权」点击「恢复购买」，或联系支持并提供订单号。' }),
      actions,
    );
  }

  // ============================================================== 皮肤
  function renderSkins() {
    if (!R.skinsGrid) return;
    const skins = S.skins || [];
    const isPro = app.isPro;
    const unlockedCount = skins.filter((s) => s.free || isPro).length;

    clear(R.skinsHeadLeft);
    R.skinsHeadLeft.appendChild(
      el(
        'div',
        { class: 'skins-head__count' },
        icon('palette'),
        el('strong', { text: String(unlockedCount) }),
        el('span', { text: `/ ${skins.length} 套已解锁` }),
      ),
    );
    if (app.isPaid) {
      R.skinsHeadLeft.appendChild(el('span', { class: 'badge badge--pro' }, icon('crown'), el('span', { text: '全部解锁' })));
    } else if (app.isTrial) {
      R.skinsHeadLeft.appendChild(
        el(
          'span',
          { class: 'badge badge--trial' },
          icon('sparkle'),
          el('span', { text: `体验期内全部解锁 · 剩 ${app.ui.trialDaysLeft || 0} 天` }),
        ),
      );
    } else {
      R.skinsHeadLeft.appendChild(
        el('span', { class: 'badge badge--locked' }, icon('lock'), el('span', { text: `${skins.length - unlockedCount} 套待解锁` })),
      );
    }

    clear(R.skinsCta);
    if (!isPro) {
      const unlock = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('crown'), el('span', { text: '解锁全部皮肤' }));
      unlock.addEventListener('click', () => switchTab('plans'));
      R.skinsCta.appendChild(unlock);
    }

    clear(R.skinsGrid);
    for (const skin of skins) {
      const locked = !skin.free && !isPro;
      const active = (app.state && app.state.settings && app.state.settings.skinId) === skin.id;
      const card = el('div', {
        class: 'skin-card' + (locked ? ' is-locked' : '') + (active ? ' is-active' : ''),
        role: 'button',
        tabindex: '0',
        dataset: { skin: skin.id },
        'aria-label': `${skin.name}${locked ? '（Pro 皮肤）' : ''}`,
      });

      const stage = el('div', { class: 'skin-card__stage' });
      const pet = el('div', {
        class: 'pet-preview',
        style: {
          background: `linear-gradient(158deg, ${skin.palette.body1} 0%, ${skin.palette.body2} 52%, ${skin.palette.body3} 100%)`,
          boxShadow: `0 10px 22px rgba(0,0,0,.34), inset 0 2px 0 rgba(255,255,255,.55), 0 0 26px ${skin.palette.glow || 'transparent'}`,
        },
      });
      pet.style.setProperty('--p-eye', skin.palette.eye);
      stage.appendChild(pet);
      if (locked) {
        stage.appendChild(
          el('div', { class: 'skin-card__lock' }, icon('lock'), el('span', { text: 'Pro 皮肤 · 点击解锁' })),
        );
        card.appendChild(el('span', { class: 'skin-card__pro badge badge--pro' }, icon('crown'), el('span', { text: 'PRO' })));
      }
      card.appendChild(stage);

      const nameRow = el('div', { class: 'skin-card__name', text: skin.name });
      if (skin.free) nameRow.appendChild(el('span', { class: 'tag tag--teal', text: '免费' }));
      const foot = el(
        'div',
        { class: 'skin-card__foot' },
        el(
          'div',
          { class: 'grow', style: { minWidth: '0' } },
          nameRow,
          el('div', { class: 'skin-card__desc', text: skin.desc }),
        ),
      );
      if (active) foot.appendChild(el('span', { class: 'tag tag--accent' }, icon('check'), el('span', { text: '使用中' })));
      card.appendChild(foot);

      card.addEventListener('click', () => onSkinClick(skin, locked, active));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSkinClick(skin, locked, active);
        }
      });
      R.skinsGrid.appendChild(card);
    }
    updateTabHint();
  }

  async function onSkinClick(skin, locked, active) {
    if (locked) {
      showSkinUpgrade(skin);
      return;
    }
    if (active) {
      toast('正在使用「' + skin.name + '」', 'info', 1800);
      return;
    }
    const res = await app.invoke(IPC.APP_SETTINGS_SET, { skinId: skin.id });
    if (res && res.ok) {
      toast('已切换到「' + skin.name + '」', 'ok');
      if (res.state) app._applyState(res.state);
    } else if (res && res.code !== 'FEATURE_LOCKED') {
      toast(res.message || '切换皮肤失败', 'err');
    }
  }

  function showSkinUpgrade(skin) {
    const others = (S.skins || []).filter((s) => !s.free).length;
    const body = el(
      'div',
      { class: 'upgrade-body' },
      el(
        'div',
        { class: 'upgrade-list' },
        el('div', { class: 'upgrade-item' }, el('div', { class: 'ico-tile ico-tile--sm ico-tile--gold' }, icon('palette')), el('span', { text: `${others} 套 Pro 皮肤` })),
        el('div', { class: 'upgrade-item' }, el('div', { class: 'ico-tile ico-tile--sm ico-tile--gold' }, icon('sparkle')), el('span', { text: '未来新皮肤免费' })),
        el('div', { class: 'upgrade-item' }, el('div', { class: 'ico-tile ico-tile--sm ico-tile--gold' }, icon('monitor')), el('span', { text: '最多 2 台设备' })),
      ),
    );
    // 价格来自 state.plans（不硬编码），加深转化引导
    const plans = (app.state && app.state.plans) || [];
    const yearly = plans.find((plan) => plan.highlight) || plans[1];
    if (yearly) {
      body.appendChild(
        el(
          'div',
          { class: 'upgrade-price' },
          el('span', { class: 'muted small', text: '年卡低至 ' }),
          el('strong', { class: 'accent-text', text: formatMoney(yearly.price) + ' / 年' }),
          el('span', { class: 'muted small', text: '，随时可退' }),
        ),
      );
    }
    modal({
      title: `「${skin.name}」是 Pro 皮肤`,
      desc: skin.desc || '升级 Pro 即可解锁全部高级皮肤。',
      iconName: 'lock',
      body,
      actions: [
        { label: '以后再说', kind: 'ghost', value: false },
        {
          label: '查看 Pro 方案',
          kind: 'primary',
          icon: 'crown',
          autofocus: true,
          onClick: () => switchTab('plans'),
          value: true,
        },
      ],
    });
  }

  // ============================================================== 我的授权
  function buildLicensePanel() {
    const panel = document.getElementById('panel-license');
    const left = el('div', { class: 'lic-col' });
    const right = el('div', { class: 'lic-col' });

    // ---- 授权状态卡
    R.licStatus = el('div', { class: 'card lic-status', dataset: { state: 'unlicensed' } });
    R.licIconTile = el('div', { class: 'ico-tile' }, icon('lock'));
    R.licName = el('div', { class: 'lic-status__name', text: '未激活' });
    R.licDesc = el('div', { class: 'lic-status__desc', text: '' });
    R.licDaysNum = el('span', { class: 'lic-days__num num', text: '—' });
    R.licDaysUnit = el('span', { class: 'lic-days__unit', text: '天' });
    R.licDaysLabel = el('div', { class: 'small muted', text: '' });
    R.licProgress = el('div', { class: 'progress progress--teal lic-progress' }, el('div', { class: 'progress__fill', style: { width: '0%' } }));
    R.licMeta = el('div', { class: 'lic-meta' });
    R.licCta = el('div', { class: 'lic-cta' });

    R.licStatus.appendChild(
      el(
        'div',
        { class: 'lic-status__top' },
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } }, R.licIconTile, R.licName),
          R.licDesc,
        ),
        el('div', { id: 'licBadge' }),
      ),
    );
    R.licStatus.appendChild(
      el('div', { class: 'lic-days' }, el('div', {}, R.licDaysNum, R.licDaysUnit), R.licDaysLabel),
    );
    R.licStatus.appendChild(R.licProgress);
    R.licStatus.appendChild(R.licMeta);
    R.licStatus.appendChild(R.licCta);
    left.appendChild(R.licStatus);

    // ---- 激活卡
    R.activateInput = el('input', {
      class: 'input input--mono',
      id: 'activateInput',
      type: 'text',
      maxlength: '40',
      placeholder: 'CUBB-XXXX-XXXX-XXXX-XXXX',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    R.activateError = el('div', { class: 'field__error hidden' });
    R.activateBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('key'), el('span', { text: '激活 Pro' }));
    R.activateNote = el(
      'div',
      { class: 'activate-note' },
      icon('info'),
      el('span', { text: '激活码在购买邮件或商店订单中；激活后授权与本机设备绑定，可在更换设备时解除。' }),
    );
    R.activateInput.addEventListener('input', () => {
      const upper = R.activateInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (upper !== R.activateInput.value) R.activateInput.value = upper;
      R.activateError.classList.add('hidden');
    });
    R.activateInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') activateKey();
    });
    R.activateBtn.addEventListener('click', activateKey);

    left.appendChild(
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el(
            'div',
            {},
            el('div', { class: 'card__title' }, icon('key'), el('span', { text: '激活码激活' })),
            el('div', { class: 'card__desc', text: '已有激活码？粘贴到这里即可立即绑定当前设备。' }),
          ),
        ),
        el(
          'div',
          { class: 'activate-box' },
          R.activateInput,
          R.activateError,
          R.activateBtn,
          R.activateNote,
        ),
      ),
    );

    // ---- 设备卡
    R.deviceIdText = el('span', { text: '—' });
    R.deviceCopyBtn = el('button', { class: 'btn btn--sm btn--icon', type: 'button', title: '复制设备 ID' }, icon('copy'));
    R.deviceCopyBtn.addEventListener('click', async () => {
      const id = (S.license && S.license.deviceId) || '';
      const ok = await UI.copyText(id);
      toast(ok ? '设备 ID 已复制' : '复制失败', ok ? 'ok' : 'err');
    });
    R.licPlanKv = el('span', { text: '—' });
    R.licEmailKv = el('span', { text: '未绑定' });

    right.appendChild(
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el(
            'div',
            {},
            el('div', { class: 'card__title' }, icon('monitor'), el('span', { text: '本机授权' })),
            el('div', { class: 'card__desc', text: '授权只与设备指纹绑定，不采集任何硬件明细。' }),
          ),
        ),
        el(
          'div',
          {},
          el('div', { class: 'kv' }, el('span', { class: 'kv__k', text: '设备 ID' }), el('div', { class: 'kv__v' }, R.deviceIdText, R.deviceCopyBtn)),
          el('div', { class: 'kv' }, el('span', { class: 'kv__k', text: '当前授权' }), el('div', { class: 'kv__v' }, R.licPlanKv)),
          el('div', { class: 'kv' }, el('span', { class: 'kv__k', text: '购买邮箱' }), el('div', { class: 'kv__v' }, R.licEmailKv)),
        ),
        el('div', { class: 'divider' }),
        el(
          'div',
          { class: 'row', style: { gap: '10px' } },
          (R.restoreBtn = el('button', { class: 'btn btn--sm grow', type: 'button' }, icon('refresh'), el('span', { text: '恢复购买' }))),
          (R.unbindBtn = el('button', { class: 'btn btn--danger btn--sm grow', type: 'button' }, icon('unlink'), el('span', { text: '解除本机绑定' }))),
        ),
      ),
    );
    R.restoreBtn.addEventListener('click', restorePurchase);
    R.unbindBtn.addEventListener('click', unbindDevice);

    // ---- 服务器卡（放在右列，位于设备卡下方）
    R.serverDot = el('span', { class: 'dot' });
    R.serverLabel = el('div', { class: 'server-row__label', text: '许可服务状态' });
    R.serverUrl = el('div', { class: 'server-row__url', text: '—' });
    R.serverBadgeHost = el('div', {});
    R.retryServerBtn = el('button', { class: 'btn btn--sm btn--icon', type: 'button', title: '重新检测' }, icon('refresh'));
    R.retryServerBtn.addEventListener('click', async () => {
      R.retryServerBtn.disabled = true;
      await loadStore(true);
      R.retryServerBtn.disabled = false;
      toast(S.server.online ? '许可服务已连接' : '仍然无法连接许可服务', S.server.online ? 'ok' : 'warn', 3200);
    });
    R.editApiBtn = el('button', { class: 'btn btn--link', type: 'button', text: '修改' });
    R.editApiBtn.addEventListener('click', () => {
      switchTab('plans');
      app.openPanel('settings');
      toast('在「设置 → 系统 → API 地址」中修改许可服务地址', 'info', 4200);
    });

    right.appendChild(
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el(
            'div',
            {},
            el('div', { class: 'card__title' }, icon('globe'), el('span', { text: '许可服务' })),
            el('div', { class: 'card__desc', text: '购买与激活都需要连接许可服务；已激活后离线也能使用。' }),
          ),
        ),
        el(
          'div',
          { class: 'server-row' },
          R.serverDot,
          el('div', { class: 'server-row__body' }, R.serverLabel, R.serverUrl),
          R.retryServerBtn,
        ),
        el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '10px' } }, R.serverBadgeHost, R.editApiBtn),
      ),
    );

    // ---- 法务
    const legalFoot = el('div', { class: 'legal-foot' });
    const links = el('div', { class: 'legal-foot__links' });
    const mkLink = (label, kind, iconName) => {
      const btn = el('button', { class: 'btn btn--link', type: 'button' }, iconName ? icon(iconName) : null, el('span', { text: label }));
      btn.addEventListener('click', () => UI.legalModal(kind));
      return btn;
    };
    links.appendChild(mkLink('最终用户许可协议', 'eula', 'receipt'));
    links.appendChild(mkLink('隐私政策', 'privacy', 'shield'));
    links.appendChild(mkLink('退款政策', 'refund', 'rotate-ccw'));
    const mailLink = el('button', { class: 'btn btn--link', type: 'button' }, icon('mail'), el('span', { text: '联系支持' }));
    mailLink.addEventListener('click', async () => {
      const email = (app.state && app.state.product && app.state.product.supportEmail) || 'support@cubbit.app';
      const ok = await UI.copyText(email);
      toast(ok ? `支持邮箱 ${email} 已复制` : `支持邮箱：${email}`, ok ? 'ok' : 'info', 3600);
    });
    links.appendChild(mailLink);
    legalFoot.appendChild(links);
    R.legalCopy = el('div', { class: 'legal-foot__copy', text: '© 2026 Cubbit Studio' });
    legalFoot.appendChild(R.legalCopy);

    panel.appendChild(el('div', { class: 'lic-layout' }, left, right));
    panel.appendChild(legalFoot);
  }

  function renderLicense() {
    const lic = S.license || { state: 'unlicensed' };
    if (isV2License(lic)) {
      renderTierLicense(lic);
      return;
    }
    const ui = (app.state && app.state.ui) || {};
    const product = (app.state && app.state.product) || {};
    const trialDays = product.trialDays || 7;

    if (!R.licStatus) return;
    R.licStatus.dataset.state = lic.state || 'unlicensed';

    // 徽标
    const badgeHost = document.getElementById('licBadge');
    if (badgeHost) {
      clear(badgeHost);
      badgeHost.appendChild(UI.licenseBadgeNode(lic, ui));
    }

    // 名称 / 描述 / 天数 / 进度 / meta / CTA
    clear(R.licName);
    clear(R.licCta);
    clear(R.licMeta);
    clear(R.licDesc);
    clear(R.licIconTile);
    R.licProgress.classList.toggle('hidden', false);

    if (lic.state === 'pro') {
      R.licIconTile.appendChild(icon('crown'));
      R.licIconTile.className = 'ico-tile ico-tile--gold';
      R.licName.appendChild(el('span', { text: lic.planName || 'Pro 会员' }));
      R.licDesc.textContent = lic.expiresAt
        ? `有效期至 ${formatDate(lic.expiresAt)}。全部功能与皮肤已解锁，到期后权益失效，可自行重新购买。`
        : '永久授权，包含未来全部新皮肤与新功能。';
      const expiryMs = lic.expiresAt ? (lic.expiresAt > 1e12 ? lic.expiresAt : lic.expiresAt * 1000) : 0;
      const daysLeft = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : null;
      R.licDaysNum.textContent = daysLeft === null ? '∞' : String(daysLeft);
      R.licDaysUnit.textContent = daysLeft === null ? '永久有效' : '天后到期';
      R.licDaysLabel.textContent = expiryMs ? '到期时间 ' + formatDate(lic.expiresAt) : '无需续费';
      R.licProgress.classList.add('hidden');
      R.licMeta.appendChild(el('span', { class: 'badge badge--pro' }, icon('crown'), el('span', { text: '全部功能已解锁' })));
      R.licMeta.appendChild(el('span', { class: 'badge' }, icon('monitor'), el('span', { text: '本机已绑定' })));
      const renew = el('button', { class: 'btn btn--sm', type: 'button' }, icon('arrow-right'), el('span', { text: '续费 / 延长' }));
      renew.addEventListener('click', () => switchTab('plans'));
      R.licCta.appendChild(renew);
    } else if (lic.state === 'trial') {
      const days = lic.trialDaysLeft || 0;
      R.licIconTile.appendChild(icon('sparkle'));
      R.licIconTile.className = 'ico-tile ico-tile--teal';
      R.licName.appendChild(el('span', { text: '体验版' }));
      R.licDesc.textContent = `全部 Pro 功能体验中，还剩 ${days} 天。到期后会回到免费版，升级 Pro 可继续使用全部功能。`;
      R.licDaysNum.textContent = String(days);
      R.licDaysUnit.textContent = '天剩余';
      R.licDaysLabel.textContent = '体验于 ' + formatDate(lic.trialEndsAt) + ' 结束';
      const pct = UI.clamp((days / trialDays) * 100, 2, 100);
      const fill = R.licProgress.querySelector('.progress__fill');
      if (fill) fill.style.width = pct + '%';
      R.licMeta.appendChild(el('span', { class: 'badge badge--trial' }, icon('sparkle'), el('span', { text: '自动开启，无需注册' })));
      R.licMeta.appendChild(el('span', { class: 'badge' }, icon('timer'), el('span', { text: `共 ${trialDays} 天` })));
      const upgrade = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '立即升级 Pro' }));
      upgrade.addEventListener('click', () => switchTab('plans'));
      R.licCta.appendChild(upgrade);
    } else if (lic.state === 'expired') {
      R.licIconTile.appendChild(icon('lock'));
      R.licIconTile.className = 'ico-tile';
      R.licName.appendChild(el('span', { text: '体验已结束' }));
      R.licDesc.textContent = '免费版仍可使用基础陪伴功能与 2 套免费皮肤。升级 Pro 可恢复全部功能。';
      R.licDaysNum.textContent = '0';
      R.licDaysUnit.textContent = '天剩余';
      R.licDaysLabel.textContent = '已结束于 ' + formatDate(lic.trialEndsAt);
      const fill = R.licProgress.querySelector('.progress__fill');
      if (fill) fill.style.width = '2%';
      const upgrade = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '重新升级 Pro' }));
      upgrade.addEventListener('click', () => switchTab('plans'));
      R.licCta.appendChild(upgrade);
    } else {
      R.licIconTile.appendChild(icon('lock'));
      R.licIconTile.className = 'ico-tile';
      R.licName.appendChild(el('span', { text: '未激活' }));
      R.licDesc.textContent = '使用激活码或购买 Pro 后即可解锁全部功能。';
      R.licDaysNum.textContent = '—';
      R.licDaysUnit.textContent = '';
      R.licDaysLabel.textContent = '';
      R.licProgress.classList.add('hidden');
      const upgrade = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '购买 Pro' }));
      upgrade.addEventListener('click', () => switchTab('plans'));
      R.licCta.appendChild(upgrade);
    }

    // 设备与 KV
    R.deviceIdText.textContent = shortId(lic.deviceId || '', 8, 8);
    R.licPlanKv.textContent = lic.planName || (lic.state === 'pro' ? 'Pro 会员' : '未激活');
    R.licEmailKv.textContent = lic.email || '未绑定';
    R.unbindBtn.disabled = lic.state !== 'pro';

    // 服务器状态
    const online = S.server.online;
    R.serverDot.className = 'dot ' + (online === true ? 'dot--ok' : online === false ? 'dot--bad' : 'dot--warn');
    R.serverLabel.textContent = online === true ? '已连接' : online === false ? '未连接' : '检测中';
    R.serverUrl.textContent = S.server.base || lic.apiBase || '—';
    clear(R.serverBadgeHost);
    R.serverBadgeHost.appendChild(
      el(
        'span',
        { class: 'badge ' + (online === true ? 'badge--ok' : online === false ? 'badge--danger' : 'badge--locked') },
        el('span', { text: online === true ? '在线' : online === false ? '离线' : '检测中' }),
      ),
    );

    // 底部版权
    if (R.legalCopy) R.legalCopy.textContent = `${product.zhName || '方块仔'} ${product.version || ''} · © 2026 Cubbit Studio`;
  }

  async function activateKey() {
    const key = (R.activateInput.value || '').trim();
    if (key.length < 8) {
      showActivateError('请输入完整的激活码（形如 CUBB-XXXX-XXXX-XXXX-XXXX）');
      return;
    }
    R.activateBtn.disabled = true;
    const label = R.activateBtn.querySelector('span');
    const originalLabel = label ? label.textContent : '激活 Pro';
    if (label) label.textContent = '正在激活…';
    R.activateError.classList.add('hidden');

    const res = await app.invoke(IPC.LICENSE_ACTIVATE, { key, email: S.email || (S.license && S.license.email) || undefined }, { gate: false });

    R.activateBtn.disabled = false;
    if (label) label.textContent = originalLabel;

    if (res && res.ok) {
      R.activateInput.value = '';
      toast('激活成功，Pro 已解锁', 'ok', 3600);
      await app.refresh();
      await loadStore(true);
      renderLicense();
    } else {
      showActivateError(friendlyLicenseError(res));
    }
  }

  function showActivateError(message) {
    clear(R.activateError);
    R.activateError.classList.remove('hidden');
    R.activateError.appendChild(icon('warning'));
    R.activateError.appendChild(el('span', { text: message }));
  }

  function friendlyLicenseError(res) {
    if (!res) return '激活失败，请稍后重试';
    const code = res.code || '';
    if (code === 'SERVER_OFFLINE' || code === 'NETWORK_ERROR' || res.offline) {
      return '许可服务未启动，请先启动 server 或检查 API 地址后重试';
    }
    if (code === 'INVALID_KEY') return '激活码不存在或已失效，请核对后重试';
    if (code === 'KEY_REVOKED') return '该激活码已被吊销，请联系支持';
    if (code === 'KEY_ALREADY_BOUND') return '该激活码已绑定到其他设备，请先解绑或联系支持';
    if (code === 'DEVICE_LIMIT') return '该激活码已绑定设备数量达到上限';
    if (code === 'RATE_LIMITED') return '操作过于频繁，请稍后再试';
    if (code === 'NOT_IMPLEMENTED') return '许可模块尚未实现，请先启动服务端';
    return res.message || '激活失败，请稍后重试';
  }

  async function restorePurchase() {
    R.restoreBtn.disabled = true;
    const res = await app.invoke(IPC.LICENSE_RESTORE, {}, { gate: false });
    R.restoreBtn.disabled = false;
    if (res && res.ok) {
      toast('已恢复购买记录', 'ok');
      await app.refresh();
      await loadStore(true);
      renderLicense();
    } else {
      toast(friendlyLicenseError(res), 'warn', 4600);
    }
  }

  async function unbindDevice() {
    const lic = S.license || {};
    if (lic.state !== 'pro') {
      toast('当前没有需要解除的授权', 'info');
      return;
    }
    const ok = await confirmDialog({
      title: '解除本机绑定？',
      desc: '解绑后这台电脑将回到免费版，授权可以重新绑定到其他设备。你的设置、专注记录与成长数据不会丢失。',
      confirmLabel: '确认解除',
      cancelLabel: '保留授权',
      danger: true,
    });
    if (!ok) return;
    const res = await app.invoke(IPC.LICENSE_DEACTIVATE, {}, { gate: false });
    if (res && res.ok) {
      toast('已解除本机绑定', 'ok');
      await app.refresh();
      await loadStore(true);
      renderLicense();
    } else {
      if (res && (res.code === 'SERVER_OFFLINE' || res.offline)) {
        toast('解绑需要连接许可服务，请先启动 server 后重试', 'err', 4600);
      } else {
        toast((res && res.message) || '解除绑定失败，请稍后重试', 'err', 4600);
      }
    }
  }

  // ============================================================== 数据加载
  async function loadStore(silent) {
    if (!app.panel) return;
    if (!silent) S.server = { online: null, base: S.server.base || (S.license && S.license.apiBase) || '', error: null };
    renderServerState();
    renderSummary();

    const res = await app.invoke(IPC.STORE_PLANS, {}, { gate: false });
    S.storeLoadedOnce = true;

    if (res && res.ok) {
      if (Array.isArray(res.plans) && res.plans.length) S.plans = res.plans;
      if (Array.isArray(res.dlc)) S.dlc = res.dlc;
      if (res.freeTier) S.freeTier = res.freeTier;
      if (Array.isArray(res.skins) && res.skins.length) S.skins = res.skins;
      if (res.license) S.license = res.license;
      S.server = {
        online: !!(res.server && res.server.online),
        base: (res.server && res.server.base) || (S.license && S.license.apiBase) || '',
        error: res.server ? res.server.error : null,
        stripeTest: (res.server && res.server.stripeTest) || S.stripeTest || null,
      };
      if (S.server.stripeTest) S.stripeTest = S.server.stripeTest;
      if (!S.selectedPlanId) pickDefaultPlan();
      renderTitlebarBadge();
      renderHead();
      renderPlans();
      renderSkins();
      renderLicense();
      // DLC 数据到位后再决定「角色包」标签页是否展示
      syncDlcTab();
    } else {
      // 主进程返回结构化错误（例如网络异常）：保留本地目录，只标记离线
      const msg = (res && res.message) || '无法连接许可服务';
      S.server = { online: false, base: S.server.base || (S.license && S.license.apiBase) || '', error: msg };
      renderServerState();
      renderSummary();
      renderLicense();
      if (!silent) toast(msg, 'warn', 4200);
    }
  }
})();
