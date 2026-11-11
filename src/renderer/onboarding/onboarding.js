/* ============================================================================
 * Cubbit Lite（2.4）首启引导
 *  1) 欢迎：你们俩，同一只方块仔（表情 / 戳一下 / 传话）
 *  2) 配对：两个人各装一份，6 位邀请码 + 30 天免费体验
 *  3) 玩法：点它摸它甩它 / 右键互动 / 打开「我们俩」传话
 *
 * 双语策略：文案直接写在 HTML 里（.i18n-zh / .i18n-en，按 <html lang> 切换），
 * 不再依赖 1MB 的机翻词典——欧美用户首启看到的第一屏必须是正确英文。
 * ========================================================================== */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const IPC = UI.IPC;
  const el = UI.el;
  const icon = UI.icon;
  const clear = UI.clear;
  const toast = UI.toast;
  const formatDate = UI.formatDate;
  const confirmDialog = UI.confirm;

  const app = UI.createApp();

  /** 初始语言取自系统；boot 之后用设置里的语言覆盖 */
  let LANG = String(navigator.language || 'zh-CN').toLowerCase();
  const isZh = () => LANG.startsWith('zh');
  const T = (zh, en) => (isZh() ? zh : en);

  // 文案固定三句，不随步骤变化（步骤标题由 mountSteps 渲染）
  const STEP_LABELS = () => [T('欢迎', 'Welcome'), T('配对', 'Pair up'), T('玩法', 'How to play')];
  const NEXT_LABELS = () => [
    T('继续', 'Continue'),
    T('继续', 'Continue'),
    T('开始使用', 'Start using Cubbit'),
  ];

  const S = {
    step: 0,
    busy: false,
    finishing: false,
    cohort: '',
    cohortSource: 'onboarding',
    cohortSaving: false,
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    mountTitlebar();
    fillIcons();
    mountSteps();

    document.getElementById('skipBtn').addEventListener('click', onSkip);
    document.getElementById('backBtn').addEventListener('click', () => goStep(S.step - 1));
    document.getElementById('nextBtn').addEventListener('click', onNext);

    for (const button of UI.$$('[data-cohort]')) {
      button.addEventListener('click', () => selectCohort(button.getAttribute('data-cohort'), 'onboarding'));
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' && S.step < 3 - 1) goStep(S.step + 1);
      else if (event.key === 'ArrowLeft' && S.step > 0) goStep(S.step - 1);
    });

    await app.boot({});

    // 用设置里的语言覆盖系统语言，再重挂一次步骤条（标签是动态生成的）
    const settings = (app.state && app.state.settings) || {};
    if (settings.language) LANG = String(settings.language).toLowerCase();
    document.documentElement.lang = LANG;
    mountSteps();

    const queryCohort = String(new URLSearchParams(location.search).get('cohort') || '').toLowerCase();
    if (['couple', 'solo'].includes(settings.betaCohort)) {
      S.cohort = settings.betaCohort;
      S.cohortSource = settings.betaCohortSource || 'onboarding';
    } else if (['couple', 'solo'].includes(queryCohort)) {
      S.cohort = queryCohort;
      S.cohortSource = 'invite_link';
      selectCohort(queryCohort, 'invite_link');
    }
    renderCohort();

    app.onState((state) => {
      applyPalette(state);
      renderTrial(state);
      renderShortcut(state);
      const savedCohort = state && state.settings && state.settings.betaCohort;
      if (!S.cohort && ['couple', 'solo'].includes(savedCohort)) {
        S.cohort = savedCohort;
        renderCohort();
      }
    });

    const initialStep = Number(new URLSearchParams(location.search).get('step'));
    goStep(Number.isFinite(initialStep) ? initialStep : 0);
    app.onNav(() => goStep(0));
  }

  function mountTitlebar() {
    const { bar } = UI.mountTitlebar(app, {
      page: T('欢迎', 'Welcome'),
      subtitle: T('第一次见面，聊两句', 'Nice to meet you'),
    });
    document.getElementById('titlebar-host').appendChild(bar);
  }

  /** 把 HTML 里的 data-icon 占位替换成内联 SVG */
  function fillIcons() {
    for (const node of UI.$$('[data-icon]')) {
      const name = node.getAttribute('data-icon');
      clear(node);
      node.appendChild(icon(name));
    }
  }

  function mountSteps() {
    const host = document.getElementById('onbSteps');
    clear(host);
    S.stepEls = [];
    const labels = STEP_LABELS();
    labels.forEach((label, index) => {
      const wrap = el(
        'div',
        { class: 'step' + (index === S.step ? ' is-active' : '') + (index < S.step ? ' is-done' : '') },
        el('span', { class: 'step__num', text: String(index + 1) }),
        el('span', { class: 'step__label', text: label }),
      );
      S.stepEls.push(wrap);
      host.appendChild(wrap);
      if (index < labels.length - 1) host.appendChild(el('span', { class: 'step__line' }));
    });
  }

  function goStep(index) {
    const target = UI.clamp(index, 0, 3 - 1);
    S.step = target;
    const slides = UI.$$('.onb-slide');
    for (const slide of slides) {
      slide.classList.toggle('hidden', Number(slide.dataset.step) !== target);
    }
    S.stepEls.forEach((node, i) => {
      node.classList.toggle('is-active', i === target);
      node.classList.toggle('is-done', i < target);
    });
    const back = document.getElementById('backBtn');
    back.classList.toggle('hidden', target === 0);
    back.textContent = T('上一步', 'Back');
    const next = document.getElementById('nextBtn');
    const nextLabel = next.querySelector('span');
    const label = NEXT_LABELS()[target];
    if (nextLabel) nextLabel.textContent = label;
    else next.textContent = label;
    const skip = document.getElementById('skipBtn');
    skip.classList.toggle('hidden', target === 3 - 1);
    skip.textContent = T('先自己玩，稍后配对', 'Play solo for now');
  }

  function renderCohort() {
    for (const button of UI.$$('[data-cohort]')) {
      const active = button.getAttribute('data-cohort') === S.cohort;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  async function selectCohort(cohort, source) {
    if (!['couple', 'solo'].includes(cohort) || S.cohortSaving) return false;
    S.cohort = cohort;
    S.cohortSource = source || 'onboarding';
    renderCohort();
    S.cohortSaving = true;
    try {
      const res = await app.invoke(
        IPC.APP_SETTINGS_SET,
        { betaCohort: cohort, betaCohortSource: S.cohortSource },
        { gate: false }
      );
      if (!res || !res.ok) {
        toast(T('cohort 保存失败，请重试', 'Could not save the beta cohort'), 'err', 3200);
        return false;
      }
      if (res.state) app._applyState(res.state);
      return true;
    } catch {
      toast(T('cohort 保存失败，请重试', 'Could not save the beta cohort'), 'err', 3200);
      return false;
    } finally {
      S.cohortSaving = false;
    }
  }

  function applyPalette(state) {
    const palette = (state && state.palette) || {};
    const root = document.documentElement;
    if (palette.body1) root.style.setProperty('--pet-body1', palette.body1);
    if (palette.body2) root.style.setProperty('--pet-body2', palette.body2);
    if (palette.body3) root.style.setProperty('--pet-body3', palette.body3);
    if (palette.eye) root.style.setProperty('--pet-eye', palette.eye);
    if (palette.blush) root.style.setProperty('--pet-blush', palette.blush);
    if (palette.glow) root.style.setProperty('--pet-glow', palette.glow);

    const chipA = document.getElementById('artChipA');
    const chipB = document.getElementById('artChipB');
    const chipC = document.getElementById('artChipC');
    if (chipA && !chipA.firstChild) chipA.appendChild(icon('timer'));
    if (chipB && !chipB.firstChild) chipB.appendChild(icon('heart'));
    if (chipC && !chipC.firstChild) chipC.appendChild(icon('sparkle'));
  }

  function renderTrial(state) {
    if (!state) return;
    const lic = state.license || {};
    const product = state.product || {};
    const days = lic.state === 'trial' ? lic.trialDaysLeft || 0 : lic.state === 'pro' ? 0 : product.trialDays || 30;
    const daysNode = document.getElementById('trialDays');
    const noteNode = document.getElementById('trialNote');
    const trialLabel = document.getElementById('trialLabel');
    const nextSpan = document.getElementById('nextBtn').querySelector('span');

    if (lic.state === 'pro') {
      if (daysNode) daysNode.textContent = '∞';
      if (trialLabel) trialLabel.textContent = T('完整版', 'Full version');
      if (noteNode) noteNode.textContent = T('你已经是完整版用户，全部功能与皮肤已解锁', 'You already own the full version — everything is unlocked');
      if (nextSpan && S.step === 1) nextSpan.textContent = T('继续', 'Continue');
      return;
    }

    if (daysNode) daysNode.textContent = String(days);
    if (trialLabel) {
      trialLabel.innerHTML = lic.state === 'trial'
        ? T('体验中，剩余', 'Trial — days left')
        : T('免费体验', 'Free trial');
    }
    if (noteNode) {
      if (lic.state === 'trial' && lic.trialEndsAt) {
        noteNode.textContent = T(
          `到 ${formatDate(lic.trialEndsAt)} 结束，不会自动扣费`,
          `Ends ${formatDate(lic.trialEndsAt)} · no auto-charge`,
        );
      } else if (lic.state === 'expired') {
        noteNode.textContent = T('体验已结束，升级完整版可以继续使用全部功能', 'Trial ended — upgrade to keep everything');
      } else {
        noteNode.textContent = T('不会自动扣费，体验结束后自动回到免费版', 'No auto-charge. Returns to free version after the trial.');
      }
    }
  }

  function renderShortcut(state) {
    const host = document.getElementById('shortcutTip');
    if (!host) return;
    const hotkeys = (state && state.settings && state.settings.hotkeys) || {};
    const accel = UI.prettyAccelerator(hotkeys.toggle || 'Control+Shift+H');
    clear(host);
    host.appendChild(icon('keyboard'));
    host.appendChild(el('span', { text: T('随时用', 'Press') }));
    const keys = el('span', { class: 'row', style: { gap: '4px' } });
    for (const part of accel.split(' + ')) keys.appendChild(el('kbd', { text: part }));
    host.appendChild(keys);
    host.appendChild(el('span', { text: T('把它叫出来；右键菜单里还有全部玩法。', 'to bring it back. Everything else is in the right-click menu.') }));
  }

  async function onNext() {
    if (S.busy) return;
    if (S.step === 3 - 1) {
      await finish();
      return;
    }
    if (S.step === 0) {
      if (!S.cohort) {
        toast(T('先选择这次是情侣测试还是单人测试', 'Choose a couple or solo beta cohort first'), 'warn', 3200);
        return;
      }
      if (S.cohortSaving) return;
      goStep(1);
      return;
    }
    if (S.step === 1) {
      // 试用是本地自动开启的，这里只做一次兜底尝试。
      // 即使服务端不可达，也必须能继续——绝不把用户卡在「开启失败」这一步。
      const lic = (app.state && app.state.license) || {};
      if (lic.state === 'pro') {
        goStep(2);
        return;
      }
      const begun = await startTrialQuietly();
      if (!begun) toast(T('已继续（免费版功能不受影响）', 'Continuing — free features are not affected'), 'warn', 3000);
      goStep(2);
      return;
    }
    goStep(S.step + 1);
  }

  /** 开启试用只做兜底：失败不阻断引导，返回是否真的开起来了 */
  async function startTrialQuietly() {
    if (S.busy) return false;
    S.busy = true;
    try {
      const res = await app.invoke(IPC.LICENSE_START_TRIAL, {}, { gate: false });
      await app.refresh();
      return Boolean(res && res.ok);
    } catch (err) {
      console.warn('[onboarding] trial start failed', err && err.message);
      return false;
    } finally {
      S.busy = false;
    }
  }

  async function finish() {
    if (S.finishing) return;
    S.finishing = true;
    const btn = document.getElementById('nextBtn');
    const label = btn.querySelector('span');
    btn.disabled = true;
    if (label) label.textContent = T('正在完成…', 'Finishing…');
    const res = await app.invoke(IPC.APP_SETTINGS_SET, { onboardingDone: true }, { gate: false });
    if (!res || !res.ok) {
      btn.disabled = false;
      S.finishing = false;
      if (label) label.textContent = NEXT_LABELS()[2];
      toast(T('保存引导状态失败，请稍后重试', 'Could not save, please retry'), 'err', 3600);
      return;
    }
    // 让方块仔在桌面上说句话，然后关闭引导窗口
    try {
      if (app.panel && app.panel.close) app.panel.close();
      else app.close();
    } catch (err) {
      console.warn('[onboarding] close failed', err);
    }
  }

  async function onSkip() {
    if (S.finishing) return;
    const ok = await confirmDialog({
      title: T('先自己玩？', 'Play solo for now?'),
      desc: T(
        '不配对也能用：它会自己逛、有表情、能截图。想配对时随时右键它 →「💞 我们俩」。',
        'You can use it alone: it wanders, reacts and can be screenshotted. Pair any time from the right-click menu → “Us two”.',
      ),
      confirmLabel: T('先自己玩', 'Play solo'),
      cancelLabel: T('继续看看', 'Keep going'),
    });
    if (!ok) return;
    if (!S.cohort) {
      const saved = await selectCohort('solo', 'skip');
      if (!saved) return;
    }
    await finish();
  }
})();
