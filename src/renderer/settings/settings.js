/* ============================================================================
 * Cubbit 设置窗口逻辑
 *
 * 六个分区：外观 / 交互 / 专注 / 成长 / 系统 / 关于
 *  · 所有写操作都走 app:settings:set（主进程白名单校验）
 *  · Pro 门禁统一弹「升级 Pro」引导（FEATURE_LOCKED 由 UI 层集中处理）
 *  · 价格与权益文案全部来自 state / catalog，不硬编码
 * ========================================================================== */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const IPC = UI.IPC;
  const el = UI.el;
  const icon = UI.icon;
  const clear = UI.clear;
  const toast = UI.toast;
  const modal = UI.modal;
  const confirmDialog = UI.confirm;
  const formatDate = UI.formatDate;
  const formatMinutes = UI.formatMinutes;
  const formatDuration = UI.formatDuration;
  const clamp = UI.clamp;
  const shortId = UI.shortId;

  const app = UI.createApp();

  // v2.2：排序与分组见 shared/nav-layout.js（情侣置顶，效率工具收进「更多工具」）
  const NAV = window.CubbitNav;
  const SECTIONS = NAV.SETTINGS_SECTIONS;

  const R = {}; // DOM 引用
  const S = {
    active: NAV.DEFAULT_SECTION,
    focusMinutes: 25,
    ringCircumference: 2 * Math.PI * 56,
    ringProgress: 0,
    tickTimer: null,
    feedTimer: null,
    sizeSave: null,
    diyDraft: null,
    diyLockUntil: 0,
    diySyncTimer: null,
  };

  // =============================================================== 启动
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    mountTitlebar();
    mountNav();

    // 必须先拿到 state 再装配分区：buildCouple 等会直接读 app.state
    await app.boot({});
    mountSections();

    app.onState((state) => {
      syncState(state);
    });

    // 支持 ?section=focus|growth 深链（方便截图走查）
    const initialSection = new URLSearchParams(location.search).get('section');
    if (initialSection && SECTIONS.some((s) => s.id === initialSection)) S.active = initialSection;
    showSection(S.active);
    startTick();
  }

  function mountTitlebar() {
    const { bar, rightSlot } = UI.mountTitlebar(app, { page: '设置' });
    R.titleBadgeHost = el('div', { class: 'row', style: { gap: '8px' } });
    rightSlot.insertBefore(R.titleBadgeHost, rightSlot.firstChild);
    document.getElementById('titlebar-host').appendChild(bar);
  }

  function mountNav() {
    const nav = document.getElementById('sideNav');
    R.navItems = {};
    for (const section of SECTIONS) {
      const btn = el(
        'button',
        {
          class: 'side__item' + (section.id === S.active ? ' is-active' : ''),
          type: 'button',
          dataset: { section: section.id },
          'aria-current': section.id === S.active ? 'page' : 'false',
        },
        icon(section.icon),
        el('span', { class: 'side__label', text: section.label }),
      );
      if (section.pro) btn.appendChild(el('span', { class: 'side__badge', text: 'PRO' }));
      btn.addEventListener('click', () => showSection(section.id));
      R.navItems[section.id] = btn;
      if (section.group) {
        if (!R.groups) R.groups = {};
        let g = R.groups[section.group];
        if (!g) {
          const meta = NAV.GROUPS[section.group] || { label: section.group };
          const body = el('div', { class: 'side__group-body' });
          const head = el('button', { class: 'side__group-head', type: 'button' }, el('span', { text: '▸ ' + meta.label }));
          head.addEventListener('click', () => { body.classList.toggle('hidden'); head.firstChild.textContent = (body.classList.contains('hidden') ? '▸ ' : '▾ ') + meta.label; });
          if (meta.collapsedByDefault) body.classList.add('hidden');
          nav.appendChild(head); nav.appendChild(body);
          g = R.groups[section.group] = { head, body, label: meta.label };
        }
        g.body.appendChild(btn);
        continue;
      }
      nav.appendChild(btn);
    }
    nav.appendChild(el('div', { class: 'side__sep' }));

    R.sideLic = el('div', { class: 'side-lic', dataset: { state: 'trial' } });
    document.getElementById('sideBottom').appendChild(R.sideLic);
    R.sideVer = el('div', { class: 'side-ver', text: '' });
    document.getElementById('sideBottom').appendChild(R.sideVer);
  }

  function showSection(id) {
    S.active = id;
    for (const section of SECTIONS) {
      const btn = R.navItems[section.id];
      const active = section.id === id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
      const panel = document.getElementById('sec-' + section.id);
      if (panel) panel.classList.toggle('hidden', !active);
      if (active && section.group && R.groups && R.groups[section.group]) {
        const g = R.groups[section.group]; g.body.classList.remove('hidden'); g.head.firstChild.textContent = '▾ ' + g.label;
      }
    }
    document.getElementById('content').scrollTop = 0;
  }

  // ---------------------------------------------------------------- 通用零件
  function sectionHead(title, desc) {
    return el(
      'div',
      { class: 'sec-head' },
      el('div', { class: 'sec-head__title', text: title }),
      desc ? el('div', { class: 'sec-head__desc', text: desc }) : null,
    );
  }

  function cardHead(title, desc, iconName) {
    return el(
      'div',
      { class: 'card__head' },
      el(
        'div',
        {},
        el('div', { class: 'card__title' }, iconName ? icon(iconName) : null, el('span', { text: title })),
        desc ? el('div', { class: 'card__desc', text: desc }) : null,
      ),
    );
  }

  function setSwitch(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function makeSwitch(on, onChange, disabled) {
    const btn = el('button', {
      class: 'switch' + (on ? ' is-on' : ''),
      type: 'button',
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
    });
    if (disabled) btn.disabled = true;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const next = !btn.classList.contains('is-on');
      setSwitch(btn, next);
      onChange(next);
    });
    return btn;
  }

  /** 一行设置项：图标 + 标题/说明 + 右侧控件 */
  function rowItem(opts) {
    const { title, desc, iconName, ctrl, extra } = opts;
    const body = el(
      'div',
      { class: 'row-item__body' },
      el('div', { class: 'row-item__title' }, iconName ? icon(iconName) : null, el('span', { text: title }), extra || null),
      desc ? el('div', { class: 'row-item__desc', text: desc }) : null,
    );
    const ctrlHost = el('div', { class: 'row-item__ctrl' }, ctrl || null);
    const node = el('div', { class: 'row-item' }, body, ctrlHost);
    return { el: node, ctrlHost, body };
  }

  function lockNote(text) {
    return el('span', { class: 'lock-note' }, icon('lock'), el('span', { text: text || 'Pro' }));
  }

  function can(featureKey) {
    const state = app.state;
    if (!state) return false;
    if (state.ui && state.ui.isPro) return true;
    const lic = state.license || {};
    return !!(lic.features && lic.features[featureKey]);
  }

  async function save(patch, successMsg) {
    const res = await app.invoke(IPC.APP_SETTINGS_SET, patch);
    if (res && res.ok) {
      if (res.state) app._applyState(res.state);
      if (successMsg) toast(successMsg, 'ok');
      return true;
    }
    if (res && res.code !== 'FEATURE_LOCKED' && res.message) toast(res.message, 'err', 3600);
    // 失败时回滚到主进程真实状态
    await app.refresh();
    return false;
  }

  // =============================================================== 状态同步
  function syncState(state) {
    renderTitleBadge(state);
    renderSideLicense(state);
    if (updateAppearance) updateAppearance(state);
    if (updateInteraction) updateInteraction(state);
    if (updateFocus) updateFocus(state);
    if (updateGrowth) updateGrowth(state);
    if (updateCouple) updateCouple(state);
    if (updateLife) updateLife(state);
    if (updateAi) updateAi(state);
    if (updateBackup) updateBackup(state);
    if (updateSystem) updateSystem(state);
    if (updateAbout) updateAbout(state);
  }

  function renderTitleBadge(state) {
    if (!R.titleBadgeHost) return;
    clear(R.titleBadgeHost);
    if (!state || !state.license) return;
    R.titleBadgeHost.appendChild(UI.licenseBadgeNode(state.license, state.ui));
  }

  function renderSideLicense(state) {
    if (!R.sideLic) return;
    const lic = (state && state.license) || {};
    const product = (state && state.product) || {};
    clear(R.sideLic);
    R.sideLic.dataset.state = lic.state || 'unlicensed';
    const paid = app.isPaid;
    const title = lic.state === 'pro' ? lic.planName || 'Pro 会员' : lic.state === 'trial' ? '免费试用' : lic.state === 'expired' ? '体验已结束' : '免费版';
    const titleIcon = lic.state === 'pro' ? 'crown' : lic.state === 'trial' ? 'sparkle' : 'lock';
    R.sideLic.appendChild(el('div', { class: 'side-lic__title' }, icon(titleIcon), el('span', { text: title })));
    let desc = '';
    if (lic.state === 'pro') {
      desc = lic.expiresAt ? '有效期至 ' + formatDate(lic.expiresAt) : '永久授权 · 全部功能已解锁';
    } else if (lic.state === 'trial') {
      desc = `全部功能体验中，还剩 ${lic.trialDaysLeft || 0} 天`;
    } else {
      desc = '升级 Pro 解锁全部皮肤与功能';
    }
    R.sideLic.appendChild(el('div', { class: 'side-lic__desc', text: desc }));
    const btn = el('button', { class: 'btn btn--sm' + (paid ? '' : ' btn--primary'), type: 'button' }, el('span', { text: paid ? '管理授权' : '升级 Pro' }));
    btn.addEventListener('click', () => app.openPanel('store'));
    R.sideLic.appendChild(btn);

    if (R.sideVer) {
      R.sideVer.textContent = `${product.zhName || '方块仔'} ${product.version || ''}`.trim();
    }
  }

  // =============================================================== 外观
  let updateAppearance = null;

  function buildAppearance() {
    const sec = document.getElementById('sec-appearance');
    sec.appendChild(sectionHead('外观', '让方块仔跟你桌面的风格一致：皮肤、大小、深浅色与配色都会实时生效。'));

    // ---- 皮肤
    R.swatchGrid = el('div', { class: 'swatches' });
    R.skinHint = el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '12px' } });
    const skinCard = el('div', { class: 'card' }, cardHead('皮肤衣橱', '点击即可换上；带 🔒 的皮肤点一下可在桌面免费试穿 10 秒，开通 7 天体验或完整版后永久可用。', 'palette'), R.swatchGrid, R.skinHint);
    sec.appendChild(skinCard);

    // ---- DIY 宠物工坊（免费内测直接可用）
    const DIY = window.CUBBIT_DIY;
    const currentDiy = () => DIY.normalize(app.state && app.state.settings && app.state.settings.diyPet);
    S.diyDraft = currentDiy();
    const holdDiyDraft = () => {
      S.diyLockUntil = Date.now() + 900;
      clearTimeout(S.diySyncTimer);
      S.diySyncTimer = setTimeout(() => {
        S.diyLockUntil = 0;
        S.diyDraft = currentDiy();
        renderDiyPreview(S.diyDraft);
      }, 950);
    };
    const saveDiy = async (patch, message, extra) => {
      const merged = Object.assign({}, S.diyDraft, patch, { enabled: true });
      // 改配色/配件时保持当前形象：探险方块仔仍是探险方块仔，其它回到经典方块仔
      if (!Object.prototype.hasOwnProperty.call(patch, 'animalId')) merged.animalId = S.diyDraft && S.diyDraft.animalId === DIY.EXPLORER_ID ? DIY.EXPLORER_ID : 'custom';
      const next = DIY.normalize(merged);
      S.diyDraft = next;
      holdDiyDraft();
      renderDiyPreview(next);
      if (extra && extra.colorSource && app.state) app.state.colorSource = extra.colorSource;
      return save(Object.assign({ diyPet: next }, extra || {}), message);
    };

    R.diyPreviewGlow = el('div', { class: 'diy-preview__glow' });
    R.diyPreviewTail = el('div', { class: 'diy-preview__tail' });
    R.diyPreviewEars = el('div', { class: 'diy-preview__ears' });
    R.diyPreviewHat = el('div', { class: 'diy-preview__hat' });
    R.diyPreviewAnimal = el(
      'div',
      { class: 'diy-preview__animal', 'aria-hidden': 'true' },
      el('div', { class: 'diy-preview__animal-tail' }),
      el('div', { class: 'diy-preview__animal-body' }),
      el('div', { class: 'diy-preview__animal-paw l' }),
      el('div', { class: 'diy-preview__animal-paw r' }),
      el('div', { class: 'diy-preview__animal-ear l' }),
      el('div', { class: 'diy-preview__animal-ear r' }),
      el('div', { class: 'diy-preview__animal-mark l' }),
      el('div', { class: 'diy-preview__animal-mark r' }),
      el('div', { class: 'diy-preview__animal-muzzle' }),
      el('div', { class: 'diy-preview__animal-nose' }),
    );
    R.diyPreviewBody = el(
      'div',
      { class: 'diy-preview__body' },
      el('div', { class: 'diy-preview__eye l' }),
      el('div', { class: 'diy-preview__eye r' }),
      el('div', { class: 'diy-preview__blush l' }),
      el('div', { class: 'diy-preview__blush r' }),
      el('div', { class: 'diy-preview__mouth' }),
    );
    R.diyPreviewHeld = el('div', { class: 'diy-preview__held' });
    R.diyPreviewArt = el('img', { class: 'diy-preview__art', alt: '', 'aria-hidden': 'true' });
    R.diyPreview = el(
      'div',
      { class: 'diy-preview', 'aria-label': 'DIY 宠物预览' },
      el('div', { class: 'diy-preview__shadow' }),
      R.diyPreviewArt,
      R.diyPreviewGlow,
      R.diyPreviewAnimal,
      R.diyPreviewTail,
      R.diyPreviewEars,
      R.diyPreviewBody,
      R.diyPreviewHat,
      R.diyPreviewHeld,
    );
    R.diyPreviewName = el('div', { class: 'diy-preview-card__name', text: '蜜桃 · 软乎乎' });
    R.diyPreviewDesc = el('div', { class: 'diy-preview-card__desc', text: '可以自由组合颜色、配件和小性格；想整只换掉就去形象馆。' });

    R.diyPaletteButtons = {};
    R.diyAnimalButtons = {};
    R.diyHatButtons = {};
    R.diyEarButtons = {};
    R.diyTailButtons = {};
    R.diyHeldButtons = {};
    R.diyTemperamentButtons = {};

    const animalGrid = el('div', { class: 'diy-animals' });
    // 只列有渲染图的形象：没图的仍是 CSS 轮廓，和位图放在一起会明显掉档次。
    // 想自由配色/配件仍可从形象馆的「自由组合」进。
    const animalChoices = DIY.ANIMAL_PRESETS_ENABLED ? DIY.ANIMALS.filter((a) => a.art) : [];
    for (const animal of animalChoices) {
      const btn = el(
        'button',
        {
          class: 'diy-animal',
          type: 'button',
          title: animal.desc || animal.label,
          dataset: { id: animal.id },
        },
        el('span', { class: 'diy-animal__emoji', text: animal.emoji }),
        el('span', { class: 'diy-animal__copy' },
          el('strong', { text: animal.label }),
          el('small', { text: animal.desc || '' }),
        ),
      );
      btn.addEventListener('click', () => {
        if (animal.id === 'custom') {
          saveDiy({ animalId: 'custom' }, '已切换为自由组合');
          return;
        }
        saveDiy(
          {
            animalId: animal.id,
            paletteId: animal.paletteId,
            hat: animal.hat,
            ears: animal.ears,
            tail: animal.tail,
            heldId: animal.heldId,
            temperament: animal.temperament,
          },
          `换成了「${animal.label}」动物模板`
        );
      });
      R.diyAnimalButtons[animal.id] = btn;
      animalGrid.appendChild(btn);
    }

    const paletteGrid = el('div', { class: 'diy-options diy-options--palette' });
    for (const palette of DIY.PALETTES) {
      const swatch = el(
        'button',
        {
          class: 'diy-palette',
          type: 'button',
          title: palette.label,
          'aria-label': '配色：' + palette.label,
          dataset: { id: palette.id },
        },
        el('span', {
          class: 'diy-palette__ball',
          style: {
            background: `linear-gradient(145deg, ${palette.body1}, ${palette.body2} 55%, ${palette.body3})`,
            boxShadow: `0 5px 12px rgba(0,0,0,.28), 0 0 14px ${palette.glow}`,
          },
        }, el('i', { style: { background: palette.eye } })),
        el('span', { class: 'diy-palette__label', text: palette.label }),
      );
      swatch.addEventListener('click', () => saveDiy({ paletteId: palette.id }, `换成了「${palette.label}」配色`, { colorSource: 'diy' }));
      R.diyPaletteButtons[palette.id] = swatch;
      paletteGrid.appendChild(swatch);
    }

    // 自定义颜色：任意主色，只换身体（小灯、小包、五官保持原色）
    R.diyCustomColor = el('input', { class: 'diy-palette__picker', type: 'color', value: '#f08a62', 'aria-label': '自定义身体颜色' });
    R.diyCustomBall = el('span', { class: 'diy-palette__ball diy-palette__ball--custom' }, el('i', { style: { background: '#3a211c' } }), R.diyCustomColor);
    const customSwatch = el(
      'label',
      { class: 'diy-palette diy-palette--custom', title: '自定义颜色：随便挑一个', dataset: { id: DIY.CUSTOM_PALETTE_ID || 'custom' } },
      R.diyCustomBall,
      el('span', { class: 'diy-palette__label', text: '自定义' }),
    );
    const pickCustom = (message) => saveDiy({ paletteId: DIY.CUSTOM_PALETTE_ID || 'custom', bodyColor: R.diyCustomColor.value }, message, { colorSource: 'diy' });
    const pickCustomSoon = UI.debounce(() => pickCustom(''), 220);
    R.diyCustomColor.addEventListener('input', () => {
      const pal = DIY.derivePalette ? DIY.derivePalette(R.diyCustomColor.value) : null;
      if (pal) R.diyCustomBall.style.background = `linear-gradient(145deg, ${pal.body1}, ${pal.body2} 55%, ${pal.body3})`;
      pickCustomSoon();
    });
    R.diyCustomColor.addEventListener('change', () => pickCustom('换上了自定义颜色'));
    R.diyPaletteButtons[DIY.CUSTOM_PALETTE_ID || 'custom'] = customSwatch;
    paletteGrid.appendChild(customSwatch);

    const makeOptionGrid = (items, key, labelOf, glyphOf, onPick) => {
      const grid = el('div', { class: 'diy-options' });
      const refs = {};
      for (const item of items) {
        const btn = el(
          'button',
          {
            class: 'diy-option',
            type: 'button',
            title: labelOf(item),
            'aria-label': `${labelOf(item)}`,
            dataset: { id: item.id },
          },
          el('span', { class: 'diy-option__glyph', text: glyphOf(item) }),
          el('span', { class: 'diy-option__label', text: labelOf(item) }),
        );
        btn.addEventListener('click', () => onPick(item));
        refs[item.id] = btn;
        grid.appendChild(btn);
      }
      R['diy' + key + 'Buttons'] = refs;
      return grid;
    };

    R.diyHatGrid = makeOptionGrid(DIY.HATS, 'Hat', (x) => x.label, (x) => x.emoji, (item) => saveDiy({ hat: item.id }));
    R.diyEarGrid = makeOptionGrid(DIY.EARS, 'Ear', (x) => x.label, (x) => x.emoji, (item) => saveDiy({ ears: item.id }));
    R.diyTailGrid = makeOptionGrid(DIY.TAILS, 'Tail', (x) => x.label, (x) => x.emoji, (item) => saveDiy({ tail: item.id }));
    R.diyHeldGrid = makeOptionGrid(DIY.HELD, 'Held', (x) => x.label, (x) => x.glyph || '·', (item) => saveDiy({ heldId: item.id }));

    R.diyTemperamentGrid = el('div', { class: 'diy-options diy-options--temperament' });
    for (const temperament of DIY.TEMPERAMENTS) {
      const btn = el(
        'button',
        { class: 'diy-temperament', type: 'button', dataset: { id: temperament.id } },
        el('span', { class: 'diy-temperament__glyph', text: temperament.emoji }),
        el('span', { class: 'diy-temperament__body' },
          el('span', { class: 'diy-temperament__title', text: temperament.label }),
          el('span', { class: 'diy-temperament__desc', text: temperament.desc }),
        ),
      );
      btn.addEventListener('click', () => saveDiy({ temperament: temperament.id }, `性格设为「${temperament.label}」`));
      R.diyTemperamentButtons[temperament.id] = btn;
      R.diyTemperamentGrid.appendChild(btn);
    }

    R.diyToggle = makeSwitch(false, async (on) => {
      const next = Object.assign({}, S.diyDraft, { enabled: on });
      S.diyDraft = next;
      holdDiyDraft();
      renderDiyPreview(next);
      const ok = await save({ diyPet: next }, on ? 'DIY 造型已启用到桌面' : '已恢复当前皮肤的默认造型');
      if (!ok) {
        await app.refresh();
        S.diyDraft = currentDiy();
        renderDiyPreview(S.diyDraft);
      }
    });
    R.diyRandom = el('button', { class: 'btn btn--sm btn--primary', type: 'button' }, icon('sparkle'), el('span', { text: '随机一只' }));
    R.diyRandom.addEventListener('click', async () => {
      const next = DIY.randomize(S.diyDraft);
      S.diyDraft = next;
      holdDiyDraft();
      renderDiyPreview(next);
      const ok = await save({ diyPet: next }, '随机造型已经跑到桌面上啦');
      if (!ok) {
        S.diyDraft = currentDiy();
        renderDiyPreview(S.diyDraft);
      }
    });
    R.diyReset = el('button', { class: 'btn btn--sm btn--ghost', type: 'button' }, icon('rotate-ccw'), el('span', { text: '恢复原生' }));
    R.diyReset.addEventListener('click', async () => {
      const next = Object.assign({}, DIY.DEFAULT, { enabled: false });
      S.diyDraft = next;
      holdDiyDraft();
      renderDiyPreview(next);
      const ok = await save({ diyPet: next }, '已恢复当前皮肤的原生造型');
      if (!ok) {
        S.diyDraft = currentDiy();
        renderDiyPreview(S.diyDraft);
      }
    });

    R.diyPreviewCard = el(
      'div',
      { class: 'diy-preview-card' },
      el('div', { class: 'diy-preview-card__stage' }, R.diyPreview),
      el('div', { class: 'diy-preview-card__copy' },
        R.diyPreviewName,
        R.diyPreviewDesc,
        el('div', { class: 'diy-preview-card__actions' }, R.diyRandom, R.diyReset),
      ),
    );
    R.diyField = (title, desc, control) => el(
      'div',
      { class: 'diy-field' },
      el('div', { class: 'diy-field__head' },
        el('div', { class: 'diy-field__title', text: title }),
        desc ? el('div', { class: 'diy-field__desc', text: desc }) : null,
      ),
      control,
    );
    const diyHead = cardHead('DIY 宠物工坊', '在选定的形象上继续微调配色、配件和小性格，保存后立刻换到桌面。换整只形象请用上面的形象馆。', 'sliders');
    const diySwitchWrap = el(
      'div',
      { class: 'diy-enable' },
      el('span', { class: 'diy-enable__label', text: '启用到桌面' }),
      R.diyToggle,
    );
    diyHead.appendChild(diySwitchWrap);

    // 形象馆入口。数量与名单都从「真正有渲染图的形象」推出来，避免文案写死
    // 之后跟实际素材对不上（之前就出现过写着 12 种、进去只有 4 种）。
    // 动物预设关闭时只宣传方块仔，不要再写 11 种高清形象。
    const artAnimals = DIY.ANIMAL_PRESETS_ENABLED ? DIY.ANIMALS.filter((a) => a.art) : [];
    const artCount = artAnimals.length;
    const artNames = artAnimals.map((a) => a.label.replace(/^小/, '')).join('、');
    const wardrobeBtnLabel = DIY.ANIMAL_PRESETS_ENABLED
      ? `形象馆 · ${artCount} 种形象`
      : '形象馆 · 方块仔';
    const wardrobeDesc = DIY.ANIMAL_PRESETS_ENABLED
      ? `${artNames}，点一下就换。`
      : '经典方块仔：亮橙身子、大眼睛、小手小脚；形象馆里还有带小灯和小包的「探险方块仔」。配色和配件可在下面自由组合。';
    const wardrobeBtn = el(
      'button',
      { class: 'btn btn--sm btn--primary', type: 'button' },
      icon('sparkle'),
      el('span', { text: wardrobeBtnLabel }),
    );
    wardrobeBtn.addEventListener('click', () => app.openPanel('wardrobe'));
    R.wardrobeNow = el('span', { class: 'diy-quality-note' }, el('span', { text: '当前：方块仔' }));
    const wardrobeBar = el(
      'div',
      { class: 'diy-wardrobe-bar' },
      el('div', { class: 'diy-wardrobe-bar__copy' },
        el('span', { class: 'diy-wardrobe-bar__title', text: DIY.ANIMAL_PRESETS_ENABLED ? '想整只换掉？' : '外观' }),
        el('span', { class: 'diy-wardrobe-bar__desc', text: wardrobeDesc }),
      ),
      R.wardrobeNow,
      wardrobeBtn,
    );
    const diyCard = el(
      'div',
      { class: 'card diy-card' },
      diyHead,
      wardrobeBar,
      R.diyPreviewCard,
      DIY.ANIMAL_PRESETS_ENABLED
        ? R.diyField('宠物形象', `${artCount} 种高清形象，点一下就会整只换掉，配件和性格跟着预设走。`, animalGrid)
        : R.diyField(
            '当前外观',
            '那 11 个旧动物形象已撤下。桌面默认是经典方块仔，也可以去形象馆换成探险方块仔。',
            el('div', { class: 'diy-quality-note' }, el('span', { text: '经典方块仔 · 探险方块仔' })),
          ),
      R.diyField('配色', '多套柔和的低饱和配色，随时可以换心情。', paletteGrid),
      R.diyField('头上', '跟随皮肤，或者自己挑一个小装饰。', R.diyHatGrid),
      R.diyField('耳朵', '猫耳、兔耳、小熊耳和小天线都可以组合。', R.diyEarGrid),
      R.diyField('尾巴 / 背后', '给方块仔加一条尾巴或一对小翅膀。', R.diyTailGrid),
      R.diyField('手里拿着', '小物件会跟着方块仔一起轻轻晃。', R.diyHeldGrid),
      R.diyField('小性格', '只会调整待机动作的偏好，不会改变互动和情侣功能。', R.diyTemperamentGrid),
    );
    sec.appendChild(diyCard);

    // ---- 拍一只 / 分享（v3.3：照片宠物 + 分享到站点，已撤下相亲角）
    const photoBtn = el(
      'button',
      { class: 'btn btn--sm btn--primary', type: 'button' },
      el('span', { text: '拍一只，变成桌宠' }),
    );
    photoBtn.addEventListener('click', () => app.openPanel('photo'));
    const wardrobeQuickBtn = el(
      'button',
      { class: 'btn btn--sm', type: 'button' },
      el('span', { text: '打开形象馆（12 种形象）' }),
    );
    wardrobeQuickBtn.addEventListener('click', () => app.openPanel('wardrobe'));
    sec.appendChild(
      el(
        'div',
        { class: 'card' },
        cardHead(
          '拍一只 · 形象馆',
          '路边遇见的小动物或家里的主子拍下来，本机自动抠底、对齐比例并生成眨眼帧，立刻变成一只桌宠（照片不上传）。也可以去形象馆查看方块仔，或用照片生成专属宠物。',
          'heart',
        ),
        el(
          'div',
          { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' } },
          photoBtn,
          wardrobeQuickBtn,
          el('span', { class: 'diy-quality-note' }, el('span', { text: '抠图与生成均在本机离线完成' })),
        ),
      ),
    );
    // ---- 人生指南 · 三场试炼 & 神秘探险
    const ledgerBtn = el(
      'button',
      { class: 'btn btn--sm btn--primary', type: 'button' },
      el('span', { text: '开始人生指南 · 三场试炼' }),
    );
    ledgerBtn.addEventListener('click', () => app.openPanel('ledger'));
    const farmBtn = el(
      'button',
      { class: 'btn btn--sm', type: 'button' },
      el('span', { text: '🗺️ 进入神秘探险' }),
    );
    farmBtn.addEventListener('click', () => app.openPanel('farm'));
    sec.appendChild(
      el(
        'div',
        { class: 'card' },
        cardHead(
          '人生指南 · 神秘探险',
          '「人生指南」把 767 条循证建议浓缩为三场立即可玩的短试炼（高分生成分享卡与保持清单，低分定制专属健康方案）；「神秘探险」带你的宠物（与伴侣宠物）深入荒野营地、奇遇猛兽并收集皮肤碎片。',
          'sparkle',
        ),
        el(
          'div',
          { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' } },
          ledgerBtn,
          farmBtn,
          el('span', { class: 'diy-quality-note' }, el('span', { text: '三场试炼随时可玩 · 完全离线' })),
        ),
      ),
    );

    function renderDiyPreview(input) {
      if (!R.diyPreview) return;
      const cfg = DIY.normalize(input);
      S.diyDraft = cfg;
      const state = app.state || {};
      const skin = ((state.skins || [])).find((item) => item.id === ((state.settings && state.settings.skinId) || 'blaze'));
      const skinAcc = (skin && skin.accessory) || {};
      const resolve = (value, fallback) => {
        if (!cfg.enabled) return fallback || '';
        if (value === 'auto') return fallback || '';
        return value === 'none' ? '' : value;
      };
      // 皮肤衣橱最后被点（colorSource = 'skin'）时，预览跟桌宠一样用皮肤配色
      const skinColors = !!(state.colorSource === 'skin' && state.palette);
      const palette = skinColors
        ? Object.assign({}, DIY.palette(cfg), state.palette, { emoji: '👗', label: (skin && skin.name) || '皮肤配色' })
        : DIY.palette(cfg);
      const temperament = DIY.TEMPERAMENTS.find((item) => item.id === cfg.temperament) || DIY.TEMPERAMENTS[0];
      const hatId = resolve(cfg.hat, skinAcc.hat);
      const earsId = resolve(cfg.ears, skinAcc.ears);
      const tailId = resolve(cfg.tail, skinAcc.tail);
      const held = cfg.enabled && cfg.heldId !== 'auto'
        ? (DIY.HELD.find((item) => item.id === cfg.heldId) || {}).glyph || ''
        : skinAcc.held || '';
      const hat = DIY.HATS.find((item) => item.id === hatId);

      R.diyPreview.dataset.enabled = cfg.enabled ? '1' : '0';
      R.diyPreview.dataset.animal = cfg.animalId;
      R.diyPreview.dataset.temperament = cfg.temperament;
      R.diyPreview.style.setProperty('--diy-1', palette.body1);
      R.diyPreview.style.setProperty('--diy-2', palette.body2);
      R.diyPreview.style.setProperty('--diy-3', palette.body3);
      R.diyPreview.style.setProperty('--diy-eye', palette.eye);
      R.diyPreview.style.setProperty('--diy-blush', palette.blush);
      R.diyPreview.style.setProperty('--diy-glow', palette.glow);
      R.diyPreviewEars.dataset.ears = earsId;
      R.diyPreviewTail.dataset.tail = tailId;
      R.diyPreviewHat.textContent = hat ? hat.emoji : '';
      R.diyPreviewHeld.textContent = held;
      const isExplorer = cfg.animalId === DIY.EXPLORER_ID;
      const animal = isExplorer ? DIY.EXPLORER : cfg.animalId !== 'custom' ? DIY.animalById(cfg.animalId) : null;
      // 有渲染图的形象用位图替换整套 CSS 拼装（与桌宠窗口保持一致）
      const isPhoto = !!(DIY.isPhotoId && DIY.isPhotoId(cfg.animalId) && DIY.hasArt(cfg.animalId));
      const useArt = !isExplorer && !!((animal || isPhoto) && DIY.hasArt(cfg.animalId));
      // 探险方块仔：和桌面一样用插画，只给身体换色；经典方块仔仍是 CSS 预览
      const Sprite = window.CubbitSprite || null;
      const useSprite = isExplorer && !!Sprite;
      R.diyPreview.classList.toggle('is-art', useArt || useSprite);
      R.diyPreview.classList.toggle('is-sprite', useSprite);
      if (R.diyPreviewArt) {
        if (useSprite) {
          const body = palette.body2;
          R.diyPreviewArt.dataset.want = body;
          Sprite.url(body, 'idle').then((src) => {
            if (R.diyPreviewArt.dataset.want !== body) return;
            if (R.diyPreviewArt.getAttribute('src') !== src) R.diyPreviewArt.setAttribute('src', src);
          });
        } else if (useArt) {
          delete R.diyPreviewArt.dataset.want;
          const src = DIY.artFile(cfg.animalId, 'idle');
          if (R.diyPreviewArt.getAttribute('src') !== src) R.diyPreviewArt.setAttribute('src', src);
        } else if (R.diyPreviewArt.hasAttribute('src')) {
          R.diyPreviewArt.removeAttribute('src');
        }
      }
      if (R.diyCustomColor && document.activeElement !== R.diyCustomColor) {
        const customHex = cfg.bodyColor || palette.body2;
        if (/^#[0-9a-f]{6}$/i.test(customHex)) R.diyCustomColor.value = customHex;
        const pal = DIY.derivePalette && cfg.bodyColor ? DIY.derivePalette(cfg.bodyColor) : null;
        if (R.diyCustomBall) R.diyCustomBall.style.background = pal ? `linear-gradient(145deg, ${pal.body1}, ${pal.body2} 55%, ${pal.body3})` : '';
      }
      R.diyPreviewName.textContent = animal
        ? `${animal.emoji} ${animal.label} · ${temperament.emoji} ${temperament.label}`
        : `${palette.emoji} ${palette.label} · ${temperament.emoji} ${temperament.label}`;
      R.diyPreviewDesc.textContent = animal ? animal.desc : temperament.desc;
      if (R.wardrobeNow) {
        const label = animal ? animal.label : '方块仔';
        R.wardrobeNow.textContent = cfg.enabled ? `当前：${label}` : `当前：${label}（DIY 已关闭）`;
      }

      setSwitch(R.diyToggle, cfg.enabled);
      const setActive = (refs, activeId) => {
        for (const [id, node] of Object.entries(refs)) node.classList.toggle('is-active', id === activeId);
      };
      setActive(R.diyPaletteButtons, skinColors ? '' : cfg.paletteId);
      setActive(R.diyAnimalButtons, cfg.animalId);
      setActive(R.diyHatButtons, cfg.hat);
      setActive(R.diyEarButtons, cfg.ears);
      setActive(R.diyTailButtons, cfg.tail);
      setActive(R.diyHeldButtons, cfg.heldId);
      setActive(R.diyTemperamentButtons, cfg.temperament);
    }

    renderDiyPreview(S.diyDraft);

    // ---- 大小
    R.sizePet = el('div', { class: 'size-preview__pet' });
    R.sizeSlider = el('input', {
      class: 'slider',
      type: 'range',
      min: '0.75',
      max: '1.4',
      step: '0.05',
      value: '1',
      'aria-label': '宠物大小',
    });
    R.sizeValue = el('span', { class: 'size-value', text: '1.00×' });
    R.sizeHint = el('div', { class: 'row-item__desc', text: '拖动滑杆实时预览；方块仔在桌面上的实际大小会在松手后生效。' });
    const sizeBody = el(
      'div',
      { class: 'size-controls' },
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '4px' } }, el('div', { class: 'row-item__title', text: '宠物大小' }), R.sizeValue),
      R.sizeSlider,
      el('div', { class: 'size-scale' }, el('span', { text: '75%' }), el('span', { text: '100%' }), el('span', { text: '140%' })),
      R.sizeHint,
    );
    const sizeCard = el(
      'div',
      { class: 'card' },
      cardHead('大小', '', 'monitor'),
      el('div', { class: 'size-row' }, el('div', { class: 'size-preview' }, R.sizePet), sizeBody),
    );
    sec.appendChild(sizeCard);

    // ---- 深浅色 & 夜间时段
    R.followSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ followSystemTheme: on });
      if (!ok) setSwitch(R.followSwitch, !on);
      else toast(on ? '已跟随系统深浅色' : '已停止跟随系统', 'ok');
    });
    R.nightSwitch = makeSwitch(false, async (on) => {
      const night = Object.assign({}, getNight(), { enabled: on });
      const ok = await save({ nightMode: night });
      if (!ok) setSwitch(R.nightSwitch, !on);
      updateNightInputs();
    });
    R.nightStart = el('input', { class: 'time-input', type: 'time', value: '22:00', 'aria-label': '夜间开始时间' });
    R.nightEnd = el('input', { class: 'time-input', type: 'time', value: '07:00', 'aria-label': '夜间结束时间' });
    R.nightRowHost = el('div', {});

    const nightTimes = el('div', { class: 'night-times' }, R.nightStart, el('span', { class: 'dim small', text: '至' }), R.nightEnd);
    R.nightRow = rowItem({
      title: '夜间时段自动变暗',
      desc: '到点后方块仔切换为暗色版，眼睛会发光（支持跨零点，例如 22:00 → 07:00）。',
      iconName: 'moon',
      ctrl: nightTimes,
    });
    R.nightRow.ctrlHost.prepend(R.nightSwitch);

    const themeCard = el(
      'div',
      { class: 'card' },
      cardHead('深浅色', '面板始终是深色；这里控制的是桌面上方块仔的配色。', 'sun'),
      rowItem({ title: '跟随系统深浅色', desc: 'Windows 切到深色时，方块仔会自动变暗。', iconName: 'sun', ctrl: R.followSwitch }).el,
      R.nightRow.el,
    );
    sec.appendChild(themeCard);

    const saveNight = UI.debounce(async () => {
      const night = getNight();
      night.start = R.nightStart.value || night.start;
      night.end = R.nightEnd.value || night.end;
      const ok = await save({ nightMode: night });
      if (ok) toast(`夜间时段已设为 ${night.start} → ${night.end}`, 'ok');
    }, 400);
    R.nightStart.addEventListener('change', saveNight);
    R.nightEnd.addEventListener('change', saveNight);

    // ---- 自定义配色（Pro）
    R.colorBody = el('input', { class: 'color-input', type: 'color', value: '#ef7a52', 'aria-label': '主色' });
    R.colorEye = el('input', { class: 'color-input', type: 'color', value: '#2b1a14', 'aria-label': '眼睛颜色' });
    R.colorGlow = el('input', { class: 'color-input', type: 'color', value: '#ef7a52', 'aria-label': '光晕颜色' });
    R.hexBody = el('span', { class: 'color-hex', text: '#EF7A52' });
    R.hexEye = el('span', { class: 'color-hex', text: '#2B1A14' });
    R.hexGlow = el('span', { class: 'color-hex', text: '#EF7A52' });
    R.customColorsLock = lockNote('Pro');
    R.customColorsLock.style.display = 'none';
    R.colorReset = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('rotate-ccw'), el('span', { text: '恢复默认' }));

    const colorRow = el(
      'div',
      { class: 'colors-row' },
      el('div', { class: 'color-item' }, R.colorBody, el('span', {}, el('div', { class: 'color-item__label', text: '主色' }), R.hexBody)),
      el('div', { class: 'color-item' }, R.colorEye, el('span', {}, el('div', { class: 'color-item__label', text: '眼睛' }), R.hexEye)),
      el('div', { class: 'color-item' }, R.colorGlow, el('span', {}, el('div', { class: 'color-item__label', text: '光晕' }), R.hexGlow)),
      el('div', { class: 'grow' }),
      R.colorReset,
    );
    R.customCard = el(
      'div',
      { class: 'card' },
      cardHead('自定义配色', '把方块仔调成你喜欢的颜色，会覆盖当前皮肤的主色、眼睛与光晕。', 'sliders'),
      colorRow,
    );
    R.customCardTitle = R.customCard.querySelector('.card__title');
    R.customCard.addEventListener('click', (event) => {
      if (!can('custom_colors') && event.target !== R.colorReset) app.showUpgrade('custom_colors');
    });
    sec.appendChild(R.customCard);

    const onColorInput = UI.debounce(async () => {
      const colors = {
        body2: R.colorBody.value,
        eye: R.colorEye.value,
        glow: hexToRgba(R.colorGlow.value, 0.55),
      };
      R.hexBody.textContent = R.colorBody.value.toUpperCase();
      R.hexEye.textContent = R.colorEye.value.toUpperCase();
      R.hexGlow.textContent = R.colorGlow.value.toUpperCase();
      const ok = await save({ customColors: colors });
      if (ok) toast('配色已应用', 'ok');
    }, 320);
    for (const input of [R.colorBody, R.colorEye, R.colorGlow]) {
      input.addEventListener('input', () => {
        if (!can('custom_colors')) {
          app.showUpgrade('custom_colors');
          return;
        }
        onColorInput();
      });
      input.addEventListener('click', () => {
        if (!can('custom_colors')) app.showUpgrade('custom_colors');
      });
    }
    R.colorReset.addEventListener('click', async () => {
      const ok = await save({ customColors: null }, '已恢复皮肤默认配色');
      if (ok) applyColorInputs(app.state);
    });

    // 大小滑杆
    R.sizeSlider.addEventListener('input', () => {
      const scale = Number(R.sizeSlider.value);
      R.sizeValue.textContent = scale.toFixed(2) + '×';
      UI.setSliderFill(R.sizeSlider);
      if (R.sizePet) R.sizePet.style.transform = `scale(${clamp(scale / 1, 0.75, 1.4)})`;
      if (!S.sizeSave) S.sizeSave = UI.debounce((value) => save({ sizeScale: value }), 220);
      S.sizeSave(scale);
    });

    updateAppearance = function (state) {
      if (!state) return;
      const settings = state.settings || {};
      // 皮肤色块
      clear(R.swatchGrid);
      const skins = state.skins || [];
      const addons = (state.license && Array.isArray(state.license.addons) && state.license.addons) || [];
      const proSkinsOn = can('skins_premium');
      let proLockedCount = 0;
      let dlcLockedCount = 0;
      for (const skin of skins) {
        const dlcId = skin.dlcId || null;
        const dlcOwned = dlcId ? addons.includes(dlcId) : false;
        const locked = !skin.free && !(dlcId ? dlcOwned : proSkinsOn);
        if (locked && dlcId) dlcLockedCount += 1;
        else if (locked) proLockedCount += 1;
        const active = settings.skinId === skin.id;
        const swatch = el(
          'button',
          {
            class: 'swatch' + (active ? ' is-active' : ''),
            type: 'button',
            title: skin.desc || skin.name,
            'aria-label': skin.name + (locked ? (dlcId ? '（需购买角色包）' : '（需完整版）') : ''),
            dataset: { skin: skin.id },
          },
          el('span', { class: 'swatch__check' }, icon('check')),
          locked ? el('span', { class: 'swatch__lock' }, icon('lock')) : null,
          el('span', {
            class: 'swatch__ball',
            style: {
              background: `linear-gradient(155deg, ${skin.palette.body1}, ${skin.palette.body2} 55%, ${skin.palette.body3})`,
              boxShadow: `0 6px 14px rgba(0,0,0,.36), inset 0 2px 0 rgba(255,255,255,.45), 0 0 16px ${skin.palette.glow || 'transparent'}`,
            },
          }),
          el('span', { class: 'swatch__item', text: (skin.particles && skin.particles[0]) || '' }),
          el('span', { class: 'swatch__name', text: skin.name }),
          el('span', { class: 'swatch__tag' + (skin.free ? ' is-free' : locked ? ' is-locked' : ' is-owned'), text: skin.free ? '免费' : skin.badge ? skin.badge : dlcId ? '角色包' : '完整版' }),
        );
        swatch.style.setProperty('--p-eye', skin.palette.eye);
        swatch.querySelector('.swatch__ball').style.setProperty('--p-eye', skin.palette.eye);
        swatch.addEventListener('click', () => onSkinPick(skin, locked, active, dlcId));
        R.swatchGrid.appendChild(swatch);
      }

      clear(R.skinHint);
      const current = skins.find((s) => s.id === settings.skinId) || skins[0];
      R.skinHint.appendChild(
        el('div', { class: 'small muted', text: current ? `当前使用：${current.name} · ${current.desc}` : '' }),
      );
      if (proLockedCount > 0) {
        const link = el('button', { class: 'btn btn--link', type: 'button' }, icon('crown'), el('span', { text: `${proLockedCount} 套皮肤需要完整版` }));
        link.addEventListener('click', () => app.showUpgrade('skins_premium'));
        R.skinHint.appendChild(link);
      }
      if (dlcLockedCount > 0) {
        const link = el('button', { class: 'btn btn--link', type: 'button' }, icon('gift'), el('span', { text: `${dlcLockedCount} 套角色包皮肤待解锁` }));
        link.addEventListener('click', () => app.openPanel('store'));
        R.skinHint.appendChild(link);
      }

      // 大小
      const scale = clamp(Number(settings.sizeScale) || 1, 0.75, 1.4);
      if (document.activeElement !== R.sizeSlider) R.sizeSlider.value = scale;
      R.sizeValue.textContent = scale.toFixed(2) + '×';
      UI.setSliderFill(R.sizeSlider);
      if (R.sizePet) R.sizePet.style.transform = `scale(${clamp(scale, 0.75, 1.4)})`;
      const palette = state.palette || (current && current.palette) || {};
      if (R.sizePet && palette.body2) {
        R.sizePet.style.background = `linear-gradient(155deg, ${palette.body1 || '#ffd9bf'}, ${palette.body2} 55%, ${palette.body3 || '#c9482a'})`;
        R.sizePet.style.boxShadow = `0 10px 20px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.5), 0 0 18px ${palette.glow || 'transparent'}`;
        R.sizePet.style.setProperty('--p-eye', palette.eye || '#2b1a14');
      }

      // 深浅色
      setSwitch(R.followSwitch, settings.followSystemTheme !== false);
      const night = settings.nightMode || { enabled: false, start: '22:00', end: '07:00' };
      setSwitch(R.nightSwitch, night.enabled !== false);
      if (document.activeElement !== R.nightStart) R.nightStart.value = night.start || '22:00';
      if (document.activeElement !== R.nightEnd) R.nightEnd.value = night.end || '07:00';
      updateNightInputs();

      // 自定义配色
      applyColorInputs(state);
      const locked = !can('custom_colors');
      for (const input of [R.colorBody, R.colorEye, R.colorGlow]) input.disabled = locked;
      R.colorReset.disabled = locked;
      R.customColorsLock.style.display = locked ? 'inline-flex' : 'none';
      if (!R.customCardTitle.contains(R.customColorsLock)) R.customCardTitle.appendChild(R.customColorsLock);
      R.customCard.style.cursor = locked ? 'pointer' : '';
      if (!S.diyLockUntil || Date.now() >= S.diyLockUntil) {
        S.diyDraft = currentDiy();
        renderDiyPreview(S.diyDraft);
      }
    };
  }

  function getNight() {
    const state = app.state || {};
    return Object.assign({ enabled: true, start: '22:00', end: '07:00' }, (state.settings && state.settings.nightMode) || {});
  }

  function updateNightInputs() {
    const enabled = R.nightSwitch && R.nightSwitch.classList.contains('is-on');
    if (R.nightStart) R.nightStart.disabled = !enabled;
    if (R.nightEnd) R.nightEnd.disabled = !enabled;
  }

  function applyColorInputs(state) {
    if (!state) return;
    const custom = (state.settings && state.settings.customColors) || null;
    const palette = state.palette || {};
    const body2 = (custom && custom.body2) || palette.body2 || '#ef7a52';
    const eye = (custom && custom.eye) || palette.eye || '#2b1a14';
    const glow = (custom && custom.glow) || palette.glow || 'rgba(239,122,82,.55)';
    if (R.colorBody) R.colorBody.value = toHex(body2, '#ef7a52');
    if (R.colorEye) R.colorEye.value = toHex(eye, '#2b1a14');
    if (R.colorGlow) R.colorGlow.value = toHex(glow, '#ef7a52');
    if (R.hexBody) R.hexBody.textContent = R.colorBody.value.toUpperCase();
    if (R.hexEye) R.hexEye.textContent = R.colorEye.value.toUpperCase();
    if (R.hexGlow) R.hexGlow.textContent = R.colorGlow.value.toUpperCase();
  }

  function toHex(value, fallback) {
    const s = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
    if (rgba) {
      const to2 = (n) => Number(n).toString(16).padStart(2, '0');
      return '#' + to2(rgba[1]) + to2(rgba[2]) + to2(rgba[3]);
    }
    return fallback;
  }

  function hexToRgba(hex, alpha) {
    const value = toHex(hex, '#ef7a52').slice(1);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  async function onSkinPick(skin, locked, active, dlcId) {
    if (locked) {
      try {
        const api = window.cubbit && window.cubbit.panel;
        if (api && api.skinPreview) await api.skinPreview(skin.id, 10);
        toast('正在桌面试穿「' + skin.name + '」10 秒 · ' + (dlcId ? '购买角色包' : '开通体验/完整版') + '即可永久使用', 'info', 4200);
      } catch (err) { /* 试穿失败不影响购买入口 */ }
      setTimeout(() => (dlcId ? app.openPanel('store') : app.showUpgrade('skins_premium')), 900);
      return;
    }
    // 身体颜色（DIY）接管时，再点当前皮肤 = 切回这套皮肤的配色
    if (active && !(app.state && app.state.colorSource === 'diy')) {
      toast('正在使用「' + skin.name + '」', 'info', 1800);
      return;
    }
    const ok = await save({ skinId: skin.id });
    if (ok) toast('已切换到「' + skin.name + '」', 'ok');
  }

  // =============================================================== 交互
  let updateInteraction = null;

  function buildInteraction() {
    const sec = document.getElementById('sec-interaction');
    sec.appendChild(sectionHead('交互', '快捷键、开机自启、音效与动效。所有改动保存在本机，不上传任何数据。'));

    const hotkeys = () => (app.state && app.state.settings && app.state.settings.hotkeys) || {};
    R.hotToggle = makeHotkeyInput('toggle', 'Control+Shift+H');
    R.hotFocus = makeHotkeyInput('focus', 'Control+Shift+F');

    const hotkeyCard = el(
      'div',
      { class: 'card' },
      cardHead('快捷键', '点击输入框后按下组合键即可修改，Esc 取消、Backspace 恢复默认。', 'keyboard'),
      rowItem({
        title: '显示 / 隐藏桌宠',
        desc: '在任何应用里都能一键把方块仔叫出来或藏起来。',
        iconName: 'eye',
        ctrl: R.hotToggle,
      }).el,
      rowItem({
        title: '开始 / 停止专注',
        desc: '开会或写代码时快速开启一轮番茄钟。',
        iconName: 'timer',
        ctrl: R.hotFocus,
      }).el,
    );
    sec.appendChild(hotkeyCard);

    R.autoStartSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ autoStart: on });
      if (!ok) setSwitch(R.autoStartSwitch, !on);
      else toast(on ? '已设为开机自启' : '已关闭开机自启', 'ok');
    });
    R.soundSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ soundEnabled: on });
      if (!ok) setSwitch(R.soundSwitch, !on);
      else toast(on ? '音效已开启' : '音效已关闭', 'ok');
    });
    R.reduceMotionSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ reduceMotion: on });
      if (!ok) setSwitch(R.reduceMotionSwitch, !on);
      else document.body.classList.toggle('reduce-motion', on);
    });
    R.roamSwitch = makeSwitch(true, async (on) => {
      const ok = await save({ petRoamEnabled: on });
      if (!ok) setSwitch(R.roamSwitch, !on);
      else toast(on ? '已开启自主活动' : '已暂停自主活动', 'ok');
    });
    R.alwaysOnTopSwitch = makeSwitch(true, async (on) => {
      const ok = await save({ alwaysOnTop: on });
      if (!ok) setSwitch(R.alwaysOnTopSwitch, !on);
      else toast(on ? '方块仔已置顶显示' : '已取消置顶', 'ok');
    });
    R.bubbleSwitch = makeSwitch(true, async (on) => {
      const ok = await save({ bubbleOnLaunch: on });
      if (!ok) setSwitch(R.bubbleSwitch, !on);
    });

    const behaviorCard = el(
      'div',
      { class: 'card' },
      cardHead('行为', '决定方块仔怎么出现在你的桌面上。', 'power'),
      rowItem({ title: '开机自动启动', desc: '登录 Windows 后自动唤醒方块仔（静默启动，不抢焦点）。', iconName: 'power', ctrl: R.autoStartSwitch }).el,
      rowItem({ title: '始终置顶', desc: '让方块仔始终显示在其它窗口上方。', iconName: 'monitor', ctrl: R.alwaysOnTopSwitch }).el,
      rowItem({ title: '启动时打招呼', desc: '打开应用时让方块仔说句话。', iconName: 'bell', ctrl: R.bubbleSwitch }).el,
      rowItem({ title: '音效', desc: '互动、专注完成时播放轻提示音。', iconName: 'volume', ctrl: R.soundSwitch }).el,
      rowItem({ title: '自主活动', desc: '没人打扰时，它会沿桌面底部走动、贴地爬行，并把动作、表情和气泡串成连续小场景。', iconName: 'sparkle', ctrl: R.roamSwitch }).el,
      rowItem({ title: '减少动效', desc: '关闭浮动、弹跳等动画，适合晕动症或省电场景。', iconName: 'leaf', ctrl: R.reduceMotionSwitch }).el,
    );
    sec.appendChild(behaviorCard);

    // 语音与状态感知的入口在「情侣」分区，这里只做指引，避免重复设置项
    const voiceNotice = el(
      'div',
      { class: 'notice notice--info', style: { marginTop: '14px' } },
      icon('volume'),
      el(
        'div',
        { class: 'notice__body' },
        el('div', { class: 'h4', style: { color: '#b9f2ea' }, text: '语音与主人状态感知也有联动设置' }),
        el('div', {
          class: 'small',
          text: '开启「主人状态感知」后，方块仔会根据你在写代码、看剧、开会或离开时做出反应；语音开关、音量与语速在「情侣」分区统一管理。',
        }),
      ),
    );
    const gotoCouple = el('button', { class: 'btn btn--sm', type: 'button' }, icon('ring'), el('span', { text: '去看看' }));
    gotoCouple.addEventListener('click', () => showSection('couple'));
    voiceNotice.appendChild(gotoCouple);
    sec.appendChild(voiceNotice);

    // ---- 游戏全屏自动隐藏
    R.gameSwitch = makeSwitch(true, async (on) => {
      const ok = await save({ gameAutoHide: on });
      if (!ok) setSwitch(R.gameSwitch, !on);
      else toast(on ? '游戏全屏时会自动隐藏方块仔' : '已关闭游戏全屏自动隐藏', 'ok');
    });
    R.gameWhitelistInput = el('textarea', {
      class: 'input',
      rows: '3',
      spellcheck: 'false',
      placeholder: '不需要隐藏的游戏进程名，每行一个，例如：\ncs2.exe\nLeagueClientUx.exe',
      style: { minHeight: '74px', resize: 'vertical', fontFamily: 'Consolas, monospace', fontSize: '11.5px', lineHeight: '1.6' },
    });
    R.gameWhitelistInput.addEventListener('change', UI.debounce(async () => {
      const list = R.gameWhitelistInput.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40);
      const ok = await save({ gameWhitelist: list }, list.length ? '白名单已保存（' + list.length + ' 个）' : '白名单已清空');
      if (!ok) R.gameWhitelistInput.classList.add('input--error');
      else R.gameWhitelistInput.classList.remove('input--error');
    }, 600));
    sec.appendChild(
      el(
        'div',
        { class: 'card' },
        cardHead('游戏全屏', '检测到全屏游戏时自动隐藏桌面伙伴，避免遮挡画面或抢焦点。', 'monitor'),
        rowItem({ title: '游戏全屏自动隐藏', desc: '默认开启。隐藏的是桌宠窗口，不影响游戏本身。', iconName: 'monitor', ctrl: R.gameSwitch }).el,
        el(
          'div',
          { class: 'field', style: { marginTop: '10px' } },
          el('label', { class: 'field__label' }, icon('sliders'), el('span', { text: '白名单（选填）' })),
          R.gameWhitelistInput,
          el('div', { class: 'field__hint', text: '列在这里的游戏不会被自动隐藏；不填则对全部全屏游戏生效。' }),
        ),
      ),
    );
    updateInteraction = function (state) {
      if (!state || !state.settings) return;
      const settings = state.settings;
      setSwitch(R.autoStartSwitch, settings.autoStart);
      setSwitch(R.soundSwitch, settings.soundEnabled);
      setSwitch(R.reduceMotionSwitch, settings.reduceMotion);
      setSwitch(R.roamSwitch, settings.petRoamEnabled !== false);
    if (R.gameSwitch) setSwitch(R.gameSwitch, settings.gameAutoHide !== false);
    if (R.gameWhitelistInput && document.activeElement !== R.gameWhitelistInput) {
      R.gameWhitelistInput.value = Array.isArray(settings.gameWhitelist) ? settings.gameWhitelist.join('\n') : '';
    }
      setSwitch(R.alwaysOnTopSwitch, settings.alwaysOnTop !== false);
      setSwitch(R.bubbleSwitch, settings.bubbleOnLaunch !== false);
      const hk = settings.hotkeys || {};
      if (!R.hotToggle.dataset.editing) {
        R.hotToggle.value = UI.prettyAccelerator(hk.toggle || 'Control+Shift+H');
        R.hotToggle.dataset.value = hk.toggle || 'Control+Shift+H';
      }
      if (!R.hotFocus.dataset.editing) {
        R.hotFocus.value = UI.prettyAccelerator(hk.focus || 'Control+Shift+F');
        R.hotFocus.dataset.value = hk.focus || 'Control+Shift+F';
      }
    };
  }

  function makeHotkeyInput(kind, defaultAccel) {
    const input = el('input', {
      class: 'hotkey',
      type: 'text',
      readonly: 'readonly',
      value: UI.prettyAccelerator(defaultAccel),
      'aria-label': kind === 'toggle' ? '显示隐藏桌宠快捷键' : '专注快捷键',
    });
    input.dataset.value = defaultAccel;
    const enter = () => {
      input.dataset.editing = '1';
      input.classList.add('is-capturing');
      input.value = '按下组合键…';
      input.focus();
    };
    input.addEventListener('focus', enter);
    input.addEventListener('click', enter);
    input.addEventListener('blur', () => {
      input.dataset.editing = '';
      input.classList.remove('is-capturing');
      input.value = UI.prettyAccelerator(input.dataset.value || defaultAccel);
    });
    input.addEventListener('keydown', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        input.blur();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        input.dataset.value = defaultAccel;
        input.blur();
        await persistHotkeys(kind, defaultAccel);
        return;
      }
      const accel = UI.acceleratorFromEvent(event);
      if (!accel || accel.endsWith('…')) {
        input.value = '需要同时按下修饰键 + 字母…';
        return;
      }
      const hasModifier = /Control\+|Alt\+|Shift\+|Command\+/.test(accel);
      if (!hasModifier) {
        input.value = '需要至少一个修饰键（Ctrl / Alt / Shift）';
        return;
      }
      input.dataset.value = accel;
      input.classList.add('is-edited');
      input.value = UI.prettyAccelerator(accel);
      await persistHotkeys(kind, accel);
      setTimeout(() => input.blur(), 260);
    });
    return input;
  }

  async function persistHotkeys(kind, accel) {
    const current = { toggle: 'Control+Shift+H', focus: 'Control+Shift+F' };
    const settings = (app.state && app.state.settings) || {};
    Object.assign(current, settings.hotkeys || {});
    current[kind] = accel;
    const ok = await save({ hotkeys: current });
    if (ok) {
      toast('快捷键已保存：' + UI.prettyAccelerator(accel), 'ok');
      toast('如果该组合键已被其它软件占用，注册会失败，请换一个', 'warn', 4200);
    }
  }

  // =============================================================== 专注
  let updateFocus = null;

  function buildFocus() {
    const sec = document.getElementById('sec-focus');
    sec.appendChild(sectionHead('专注', '让方块仔陪你番茄钟：开始后它会安静地待在旁边，结束后有庆祝动画。'));

    // ---- 番茄钟
    const NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      return node;
    };
    const ring = svgEl('svg', { class: 'focus-ring__svg', viewBox: '0 0 128 128' });
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'focusGrad', x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#6fe3d2' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#ef7a52' }));
    defs.appendChild(grad);
    ring.appendChild(defs);
    ring.appendChild(svgEl('circle', { class: 'focus-ring__track', cx: '64', cy: '64', r: '56' }));
    R.ringFill = svgEl('circle', { class: 'focus-ring__fill', cx: '64', cy: '64', r: '56' });
    R.ringFill.setAttribute('stroke-dasharray', String(S.ringCircumference));
    R.ringFill.setAttribute('stroke-dashoffset', String(S.ringCircumference));
    ring.appendChild(R.ringFill);

    R.focusTime = el('div', { class: 'focus-ring__time', text: '25:00' });
    R.focusState = el('div', { class: 'focus-ring__state', text: '准备开始' });
    const ringWrap = el('div', { class: 'focus-ring' }, ring, el('div', { class: 'col center' }, R.focusTime, R.focusState));

    R.focusTitle = el('div', { class: 'focus-hero__title', text: '25 分钟 · 专注一轮' });
    R.focusDesc = el('div', { class: 'focus-hero__desc', text: '默认 25 分钟免费可用；Pro 可以自定义 5–180 分钟与标签。' });

    R.presetHost = el('div', { class: 'focus-presets' });
    R.focusStartBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('play'), el('span', { text: '开始专注' }));
    R.focusPauseBtn = el('button', { class: 'btn', type: 'button' }, icon('pause'), el('span', { text: '暂停' }));
    R.focusStopBtn = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('stop'), el('span', { text: '结束' }));
    const actions = el('div', { class: 'focus-actions' }, R.focusStartBtn, R.focusPauseBtn, R.focusStopBtn);
    const hero = el(
      'div',
      { class: 'card focus-hero' },
      ringWrap,
      el('div', { class: 'focus-hero__body' }, R.focusTitle, R.focusDesc, R.presetHost, actions),
    );
    sec.appendChild(hero);

    // 预设时长
    const presets = [
      { minutes: 25, label: '25 分钟', pro: false },
      { minutes: 45, label: '45 分钟', pro: true },
      { minutes: 60, label: '60 分钟', pro: true },
      { minutes: 90, label: '90 分钟', pro: true },
    ];
    R.presetButtons = [];
    for (const preset of presets) {
      const btn = el('button', { class: 'preset' + (preset.minutes === 25 ? ' is-active' : ''), type: 'button' }, el('span', { text: preset.label }));
      const lockEl = preset.pro ? icon('lock') : null;
      if (lockEl) btn.appendChild(lockEl);
      btn.addEventListener('click', () => {
        if (preset.pro && !can('focus_custom')) {
          app.showUpgrade('focus_custom');
          return;
        }
        S.focusMinutes = preset.minutes;
        renderFocusPresets();
      });
      R.presetButtons.push({ ...preset, btn, lockEl });
      R.presetHost.appendChild(btn);
    }

    // 自定义时长
    R.durationSlider = el('input', {
      class: 'slider',
      type: 'range',
      min: '5',
      max: '180',
      step: '5',
      value: '25',
      'aria-label': '自定义专注时长',
    });
    R.durationValue = el('div', { class: 'focus-duration__value', text: '25 分钟' });
    R.durationLock = lockNote('Pro 自定义');
    R.durationLock.style.display = 'none';
    R.durationHint = el('div', { class: 'row-item__desc', text: '拖动选择 5–180 分钟，开始后按这个时长倒计时。' });

    const durationCard = el(
      'div',
      { class: 'card' },
      cardHead('自定义时长', '', 'timer'),
      el(
        'div',
        { class: 'focus-duration' },
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '4px' } }, el('div', { class: 'row-item__title', text: '本轮时长' }), R.durationLock),
          R.durationSlider,
          el('div', { class: 'size-scale' }, el('span', { text: '5 分钟' }), el('span', { text: '90 分钟' }), el('span', { text: '180 分钟' })),
          R.durationHint,
        ),
        R.durationValue,
      ),
    );
    sec.appendChild(durationCard);

    R.durationSlider.addEventListener('input', () => {
      if (!can('focus_custom')) {
        app.showUpgrade('focus_custom');
        R.durationSlider.value = String(S.focusMinutes);
        return;
      }
      S.focusMinutes = Number(R.durationSlider.value);
      updateDurationLabel();
    });

    R.focusStartBtn.addEventListener('click', async () => {
      const minutes = can('focus_custom') ? S.focusMinutes : 25;
      const res = await app.invoke(IPC.FOCUS_START, { minutes, label: '' });
      if (res && res.ok) {
        toast(`开始 ${minutes} 分钟专注，方块仔陪着你`, 'ok');
        await app.refresh();
      } else if (res && res.code !== 'FEATURE_LOCKED') {
        toast(res.message || '无法开始专注', 'err');
      }
    });
    R.focusPauseBtn.addEventListener('click', async () => {
      const res = await app.invoke(IPC.FOCUS_PAUSE, {});
      if (res && res.ok) await app.refresh();
    });
    R.focusStopBtn.addEventListener('click', async () => {
      const res = await app.invoke(IPC.FOCUS_STOP, {});
      if (res && res.ok) {
        toast('本轮专注已结束', 'info');
        await app.refresh();
      }
    });

    // ---- 统计（Pro 专属图表）
    R.todayMinutes = el('span', { class: 'stats-today__num', text: '0' });
    R.todaySessions = el('span', { class: 'small muted', text: '0 次' });
    R.totalMinutes = el('div', { class: 'stats-meta__value', text: '0 分钟' });
    R.totalSessions = el('div', { class: 'stats-meta__value', text: '0 次' });
    R.chartHost = el('div', { class: 'chart' });
    R.statsLockVeil = el(
      'div',
      { class: 'lock-veil hidden' },
      el('div', { class: 'lock-veil__icon' }, icon('lock')),
      el('div', { class: 'h4', text: '专注统计是 Pro 功能' }),
      el('div', { class: 'small muted', text: '解锁后可查看每日/每周专注时长与心情日历。' }),
    );
    R.statsLockVeil.appendChild(
      (() => {
        const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('crown'), el('span', { text: '升级 Pro' }));
        btn.addEventListener('click', () => app.showUpgrade('focus_stats'));
        return btn;
      })(),
    );
    R.chartWrap = el('div', { class: 'stats-locked' }, R.chartHost, R.statsLockVeil);

    const statsCard = el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'stats-head' },
        el(
          'div',
          {},
          el('div', { class: 'card__title' }, icon('chart'), el('span', { text: '专注统计' })),
          el('div', { class: 'card__desc', text: '今天专注了多少，一眼就看到。' }),
        ),
        el('div', { class: 'stats-today' }, R.todayMinutes, el('span', { class: 'stats-today__unit', text: '分钟 · 今日' })),
      ),
      R.chartWrap,
      el(
        'div',
        { class: 'stats-meta' },
        el('div', { class: 'stats-meta__item' }, el('div', { class: 'stats-meta__label', text: '今日完成' }), R.todaySessions),
        el('div', { class: 'stats-meta__item' }, el('div', { class: 'stats-meta__label', text: '累计时长' }), R.totalMinutes),
        el('div', { class: 'stats-meta__item' }, el('div', { class: 'stats-meta__label', text: '累计轮数' }), R.totalSessions),
      ),
    );
    sec.appendChild(statsCard);

    // ---- 任务清单：方块仔到点提醒、完成时庆祝
    R.taskInput = el('input', { class: 'input grow', type: 'text', maxlength: '60', placeholder: '比如：喝水 / 写周报 / 18:30 去健身' });
    R.taskTime = el('input', { class: 'input', type: 'time', 'aria-label': '提醒时间（可选）', style: { width: '110px' } });
    R.taskRepeat = el('select', { class: 'select', 'aria-label': '重复', style: { width: '96px' } },
      el('option', { value: 'none', text: '不重复' }), el('option', { value: 'daily', text: '每天' }),
      el('option', { value: 'weekdays', text: '工作日' }), el('option', { value: 'weekly', text: '每周' }));
    R.taskDate = el('input', { class: 'input', type: 'date', 'aria-label': '日期（可选）', style: { width: '140px' } });
    R.taskAdd = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('plus'), el('span', { text: '添加' }));
    R.taskList = el('div', { class: 'task-list' });
    R.taskClear = el('button', { class: 'btn btn--link', type: 'button' }, el('span', { text: '清除已完成' }));
    const taskCard = el('div', { class: 'card' },
      cardHead('任务清单', '给方块仔布置任务：设了时间会到点开口提醒你，完成后它会为你庆祝。', 'check'),
      el('div', { class: 'row task-add', style: { gap: '8px', flexWrap: 'wrap' } }, R.taskInput, R.taskDate, R.taskTime, R.taskRepeat, R.taskAdd),
      R.taskList,
      el('div', { class: 'row', style: { justifyContent: 'flex-end' } }, R.taskClear));
    sec.appendChild(taskCard);
    const curTasks = () => ((((app.state || {}).settings || {}).tasks) || []).slice();
    const addTask = async () => {
      const text = R.taskInput.value.trim();
      if (!text) return;
      const list = curTasks();
      if (list.length >= 50) { toast('最多 50 个任务', 'err'); return; }
      const date = R.taskDate.value || '';
      list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, at: R.taskTime.value || '', date, repeat: R.taskRepeat.value || 'none', dow: date ? new Date(date + 'T00:00:00').getDay() : new Date().getDay(), done: false });
      if (await save({ tasks: list })) { R.taskInput.value = ''; R.taskTime.value = ''; R.taskDate.value = ''; R.taskRepeat.value = 'none'; }
    };
    R.taskAdd.addEventListener('click', addTask);
    R.taskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
    R.taskClear.addEventListener('click', () => save({ tasks: curTasks().filter((t) => !t.done) }));
    const renderTasks = (state) => {
      const list = ((state.settings || {}).tasks) || [];
      clear(R.taskList);
      if (!list.length) { R.taskList.appendChild(el('div', { class: 'small muted', text: '还没有任务。添加一个，方块仔会帮你记着～' })); return; }
      for (const t of list) {
        const cb = el('button', { class: 'task-check' + (t.done ? ' is-done' : ''), type: 'button', 'aria-label': t.done ? '标为未完成' : '完成' }, t.done ? icon('check') : null);
        cb.addEventListener('click', () => save({ tasks: curTasks().map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }));
        const del = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': '删除' }, icon('trash'));
        del.addEventListener('click', () => save({ tasks: curTasks().filter((x) => x.id !== t.id) }));
        R.taskList.appendChild(el('div', { class: 'task-item' + (t.done ? ' is-done' : '') }, cb,
          el('span', { class: 'task-text grow', text: t.text }),
          (t.at || t.date || (t.repeat && t.repeat !== 'none')) ? el('span', { class: 'task-time', text: '⏰ ' + [t.repeat === 'daily' ? '每天' : t.repeat === 'weekdays' ? '工作日' : t.repeat === 'weekly' ? '每周' + '日一二三四五六'[t.dow || 0] : (t.date || ''), t.at || ''].filter(Boolean).join(' ') }) : null, del));
      }
    };

    updateFocus = function (state) {
      if (!state) return;
      try { renderTasks(state); } catch (err) { /* ignore */ }
      const focus = state.focus || {};
      const custom = can('focus_custom');
      // 首次渲染时沿用上次的专注时长；非 Pro 固定 25 分钟
      if (!S.focusInit) {
        const last = (state.settings && state.settings.focus && state.settings.focus.lastMinutes) || 25;
        S.focusMinutes = clamp(Number(last) || 25, 5, 180);
        S.focusInit = true;
      }
      if (!custom) S.focusMinutes = 25;

      R.durationSlider.disabled = !custom || focus.running;
      R.durationSlider.value = String(S.focusMinutes);
      R.durationLock.style.display = custom ? 'none' : 'inline-flex';
      UI.setSliderFill(R.durationSlider);
      updateDurationLabel();

      renderFocusPresets();
      for (const preset of R.presetButtons) {
        preset.btn.disabled = !!focus.running;
        if (preset.lockEl) preset.lockEl.style.display = custom ? 'none' : '';
      }

      const running = !!focus.running;
      const paused = !!focus.paused;
      const totalMs = (focus.minutes || 25) * 60000;
      const remaining = running ? (paused ? focus.remainingMs : Math.max(0, (focus.endsAt || 0) - Date.now())) : totalMs;
      R.focusTime.textContent = running ? formatDuration(remaining) : `${String(S.focusMinutes).padStart(2, '0')}:00`;
      R.focusState.textContent = running ? (paused ? '已暂停' : '专注中') : '准备开始';
      R.focusTitle.textContent = running
        ? `${focus.minutes} 分钟 · ${paused ? '已暂停' : '进行中'}`
        : `${S.focusMinutes} 分钟 · 专注一轮`;
      R.focusDesc.textContent = running
        ? '方块仔正在安静地陪着你，别碰手机哦。'
        : custom
          ? '选择时长后点击开始；专注完成会记录到统计与成长经验。'
          : '免费版固定 25 分钟；Pro 可以自定义 5–180 分钟与标签。';

      const progress = running ? clamp(1 - remaining / totalMs, 0, 1) : 0;
      S.ringProgress = progress;
      R.ringFill.setAttribute('stroke-dashoffset', String(S.ringCircumference * (1 - progress)));

      R.focusStartBtn.disabled = running;
      R.focusPauseBtn.disabled = !running;
      R.focusStopBtn.disabled = !running;
      const pauseLabel = R.focusPauseBtn.querySelector('span');
      if (pauseLabel) pauseLabel.textContent = paused ? '继续' : '暂停';
      const pauseIcon = R.focusPauseBtn.querySelector('svg');
      if (pauseIcon) pauseIcon.replaceWith(paused ? icon('play') : icon('pause'));
      R.focusStartBtn.querySelector('span').textContent = running ? '专注中…' : '开始专注';

      // 统计
      const today = focus.today || { sessions: 0, minutes: 0 };
      R.todayMinutes.textContent = String(today.minutes || 0);
      R.todaySessions.textContent = `${today.sessions || 0} 次`;
      R.totalMinutes.textContent = formatMinutes(focus.totalMinutes || 0);
      R.totalSessions.textContent = `${focus.totalSessions || 0} 次`;
      const history = focus.history || [];
      clear(R.chartHost);
      const max = Math.max(25, ...history.map((d) => d.minutes || 0));
      const todayKey = history.length ? history[history.length - 1].date : '';
      for (const day of history) {
        const isToday = day.date === todayKey;
        const height = Math.max(3, Math.round(((day.minutes || 0) / max) * 100));
        const col = el(
          'div',
          { class: 'chart__col' + (isToday ? ' is-today' : '') },
          el('div', { class: 'chart__val', text: day.minutes ? String(day.minutes) : '' }),
          el('div', { class: 'chart__bar-wrap' }, el('div', { class: 'chart__bar', style: { height: height + '%' }, title: `${day.date}：${day.minutes || 0} 分钟` })),
          el('div', { class: 'chart__label', text: isToday ? '今天' : day.label }),
        );
        R.chartHost.appendChild(col);
      }
      const statsAllowed = can('focus_stats');
      R.statsLockVeil.classList.toggle('hidden', statsAllowed);
      R.chartHost.style.filter = statsAllowed ? '' : 'blur(2px)';
      R.chartHost.style.opacity = statsAllowed ? '1' : '0.55';
    };
  }

  function updateDurationLabel() {
    if (!R.durationValue) return;
    R.durationValue.textContent = formatMinutes(S.focusMinutes);
  }

  function renderFocusPresets() {
    if (!R.presetButtons) return;
    for (const preset of R.presetButtons) {
      preset.btn.classList.toggle('is-active', preset.minutes === S.focusMinutes);
    }
  }

  /** 每秒只刷新倒计时/圆环，避免整个分区重绘 */
  function tickFocus() {
    const state = app.state;
    const focus = state && state.focus;
    if (!focus || !focus.running || !R.focusTime || !R.ringFill) return;
    const totalMs = (focus.minutes || 25) * 60000;
    const remaining = focus.paused ? focus.remainingMs : Math.max(0, (focus.endsAt || 0) - Date.now());
    R.focusTime.textContent = formatDuration(remaining);
    const p = clamp(1 - remaining / totalMs, 0, 1);
    R.ringFill.setAttribute('stroke-dashoffset', String(S.ringCircumference * (1 - p)));
    updateFeedCooldown();
  }

  function startTick() {
    stopTick();
    S.tickTimer = setInterval(() => {
      tickFocus();
      updateFeedCooldown();
    }, 1000);
  }

  function stopTick() {
    if (S.tickTimer) clearInterval(S.tickTimer);
    S.tickTimer = null;
  }

  // =============================================================== 成长
  let updateGrowth = null;

  function buildGrowth() {
    const sec = document.getElementById('sec-growth');
    sec.appendChild(sectionHead('成长（Pro）', '投喂、摸摸、专注都会累积经验。等级越高，它越粘人，也会解锁更多成就。'));

    R.growthAvatar = el('div', { class: 'growth-avatar' });
    R.growthLevel = el('span', { class: 'growth-level__num', text: '1' });
    R.growthLevelLabel = el('span', { class: 'growth-level__label', text: '等级 · 初来乍到' });
    R.expFill = el('div', { class: 'progress__fill', style: { width: '0%' } });
    R.expText = el('span', { text: '0 / 50' });
    R.expPct = el('span', { text: '0%' });
    R.affinityFill = el('div', { class: 'progress__fill', style: { width: '0%' } });
    R.statAffinity = el('div', { class: 'growth-stat__value', text: '0' });
    R.statStreak = el('div', { class: 'growth-stat__value', text: '0' });
    R.statFeeds = el('div', { class: 'growth-stat__value', text: '0' });
    R.feedBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('gift'), el('span', { text: '投喂' }));
    R.feedDesc = el('div', { class: 'feed-bar__desc', text: '投喂会增加亲密度与经验，每 4 小时可以喂一次。' });

    const hero = el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'growth-hero' },
        R.growthAvatar,
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'growth-level' }, R.growthLevel, R.growthLevelLabel),
          el(
            'div',
            { class: 'growth-exp' },
            el('div', { class: 'exp-head' }, el('span', { text: '距离下一级' }), el('span', {}, R.expText, el('span', { text: ' · ' }), R.expPct)),
            el('div', { class: 'progress' }, R.expFill),
          ),
        ),
      ),
      el(
        'div',
        { class: 'growth-stats' },
        el(
          'div',
          { class: 'growth-stat' },
          el('div', { class: 'growth-stat__label' }, icon('heart'), el('span', { text: '亲密度' })),
          R.statAffinity,
          el('div', { class: 'progress progress--thin progress--teal', style: { marginTop: '8px' } }, R.affinityFill),
        ),
        el(
          'div',
          { class: 'growth-stat' },
          el('div', { class: 'growth-stat__label' }, icon('flame'), el('span', { text: '连续陪伴' })),
          R.statStreak,
        ),
        el(
          'div',
          { class: 'growth-stat' },
          el('div', { class: 'growth-stat__label' }, icon('cake'), el('span', { text: '累计投喂' })),
          R.statFeeds,
        ),
      ),
    );

    const feedBar = el(
      'div',
      { class: 'feed-bar' },
      el('div', { class: 'ico-tile ico-tile--gold' }, icon('gift')),
      el('div', { class: 'feed-bar__body' }, el('div', { class: 'feed-bar__title' }, el('span', { text: '给它吃点东西' })), R.feedDesc),
      R.feedBtn,
    );

    R.achGrid = el('div', { class: 'achievements' });
    const achCard = el(
      'div',
      { class: 'card' },
      cardHead('成就墙', '共 9 个成就，解锁后会点亮并存入成长档案。', 'star'),
      R.achGrid,
    );

    const content = el('div', { class: 'stack' }, hero, feedBar, achCard);
    R.growthVeil = el(
      'div',
      { class: 'lock-veil hidden' },
      el('div', { class: 'lock-veil__icon' }, icon('lock')),
      el('div', { class: 'h3', text: '成长系统是 Pro 功能' }),
      el('div', {
        class: 'small muted',
        text: '等级、亲密度、连续陪伴天数与 9 个成就徽章，升级 Pro 后立即解锁。',
        style: { maxWidth: '320px' },
      }),
    );
    const upgradeBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '升级 Pro 解锁成长' }));
    upgradeBtn.addEventListener('click', () => app.showUpgrade('growth'));
    R.growthVeil.appendChild(upgradeBtn);

    sec.appendChild(el('div', { class: 'growth-lock' }, content, R.growthVeil));

    // 免费档可投喂（唯一日常回访钩子），但等级/成就仍为 Pro 权益。
    // 因此免费用户不显示整块遮罩，只在成就墙上方给出说明与升级入口。
    R.growthProHint = el(
      'div',
      { class: 'small muted', style: { marginBottom: '10px' } },
      el('span', { text: '免费版可投喂，等级上限 3 级；' }),
      el('button', {
        class: 'btn btn--link',
        type: 'button',
        text: '升级 Pro 解锁完整成长与 9 个成就徽章',
        onclick: () => app.showUpgrade('growth'),
      }),
    );
    achCard.before(R.growthProHint);

    R.feedBtn.addEventListener('click', async () => {
      R.feedBtn.disabled = true;
      const res = await app.invoke(IPC.GROWTH_FEED, {});
      R.feedBtn.disabled = false;
      if (res && res.ok) {
        toast('投喂成功，亲密度 +6', 'ok');
        await app.refresh();
      } else if (res && res.reason === 'cooldown') {
        toast('刚刚才吃过，' + formatDuration(nextFeedMs(res.growth)) + ' 后可以再喂', 'warn', 3600);
      } else if (res && res.code !== 'FEATURE_LOCKED') {
        toast(res.message || '投喂失败', 'err');
      }
    });

    updateGrowth = function (state) {
      if (!state) return;
      const growth = state.growth || {};
      const allowed = can('growth');
      // 免费档：喂养可用 → 不遮罩整块，只隐藏成就墙并显示 Pro 说明
      R.growthVeil.classList.toggle('hidden', true);
      if (R.growthProHint) R.growthProHint.classList.toggle('hidden', allowed);
      if (achCard) achCard.classList.toggle('hidden', !allowed);
      if (R.feedBtn) R.feedBtn.disabled = !allowed || !growth.canFeed;

      const palette = state.palette || {};
      if (palette.body2) {
        R.growthAvatar.style.background = `linear-gradient(155deg, ${palette.body1 || '#ffd9bf'}, ${palette.body2} 55%, ${palette.body3 || '#c9482a'})`;
        R.growthAvatar.style.boxShadow = `0 12px 24px rgba(0,0,0,.4), inset 0 3px 0 rgba(255,255,255,.5), 0 0 22px ${palette.glow || 'transparent'}`;
        R.growthAvatar.style.setProperty('--p-eye', palette.eye || '#2b1a14');
      }

      const level = growth.level || 1;
      const expIn = growth.expInLevel || 0;
      const expNext = growth.expToNext || 50;
      const pct = clamp((expIn / expNext) * 100, 0, 100);
      R.growthLevel.textContent = String(level);
      R.growthLevelLabel.textContent = `等级 · ${levelTitle(level)}`;
      R.expFill.style.width = pct + '%';
      R.expText.textContent = `${expIn} / ${expNext} 经验`;
      R.expPct.textContent = Math.round(pct) + '%';
      const affinity = clamp(growth.affinity || 0, 0, 100);
      clear(R.statAffinity);
      R.statAffinity.appendChild(el('span', { text: String(affinity) }));
      R.statAffinity.appendChild(el('small', { text: '/ 100' }));
      R.affinityFill.style.width = affinity + '%';
      clear(R.statStreak);
      R.statStreak.appendChild(el('span', { text: String(growth.streak || 0) }));
      R.statStreak.appendChild(el('small', { text: '天' }));
      clear(R.statFeeds);
      R.statFeeds.appendChild(el('span', { text: String(growth.feeds || 0) }));
      R.statFeeds.appendChild(el('small', { text: '次' }));
      updateFeedCooldown();

      clear(R.achGrid);
      for (const ach of growth.achievements || []) {
        R.achGrid.appendChild(
          el(
            'div',
            { class: 'ach' + (ach.unlocked ? ' is-unlocked' : ''), title: ach.desc },
            el('div', { class: 'ach__icon', text: ach.icon || '🏅' }),
            el(
              'div',
              { class: 'ach__body' },
              el('div', { class: 'ach__name', text: ach.name }),
              el('div', { class: 'ach__desc', text: ach.unlocked ? ach.desc : '未解锁 · ' + ach.desc }),
            ),
          ),
        );
      }
    };
  }

  function levelTitle(level) {
    if (level >= 12) return '形影不离';
    if (level >= 9) return '老伙计';
    if (level >= 6) return '好搭子';
    if (level >= 4) return '小伙伴';
    if (level >= 2) return '认识你啦';
    return '初来乍到';
  }

  function nextFeedMs(growth) {
    if (!growth) return 0;
    if (Number.isFinite(growth.nextFeedInMs) && growth.nextFeedInMs > 0) return growth.nextFeedInMs;
    if (growth.lastFeedAt) return Math.max(0, growth.lastFeedAt + 4 * 3600 * 1000 - Date.now());
    return 0;
  }

  function updateFeedCooldown() {
    const state = app.state;
    if (!state || !R.feedBtn) return;
    const growth = state.growth || {};
    const allowed = can('growth');
    const ms = nextFeedMs(growth);
    const ready = ms <= 0;
    R.feedBtn.disabled = !allowed || !ready;
    const label = R.feedBtn.querySelector('span');
    if (label) label.textContent = ready ? '投喂' : '冷却中';
    if (R.feedDesc) {
      R.feedDesc.textContent = ready ? '投喂会增加亲密度与经验，每 4 小时可以喂一次。' : `已经吃过啦，${formatDuration(ms)} 后可以再喂。`;
    }
  }

  // =============================================================== 情侣
  let updateCouple = null;

  function buildCouple() {
    const sec = document.getElementById('sec-couple');
    if (!sec) return;
    sec.appendChild(sectionHead('情侣', '伴侣状态、语音播报、主人状态感知与观影模式。这些设置会同时影响桌面上的方块仔和情侣面板。'));

    // ---- 伴侣状态卡
    R.couplePartnerHost = el('div', { class: 'card' });
    sec.appendChild(R.couplePartnerHost);

    // ---- 语音
    R.voiceSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ voiceEnabled: on });
      if (!ok) setSwitch(R.voiceSwitch, !on);
      else toast(on ? '语音已开启' : '语音已关闭', 'ok');
      updateVoiceControls();
    });
    R.voiceVolume = el('input', { class: 'slider', type: 'range', min: '0', max: '100', step: '5', value: '70', 'aria-label': '语音音量' });
    R.voiceVolumeValue = el('div', { class: 'focus-duration__value', text: '70%' });
    R.voiceRate = el('input', { class: 'slider', type: 'range', min: '80', max: '130', step: '5', value: '105', 'aria-label': '语音语速' });
    R.voiceRateValue = el('div', { class: 'focus-duration__value', text: '1.05×' });
    R.voiceHint = el('div', { class: 'row-item__desc', text: '方块仔会用语音说出提醒、问候与互动回应；关闭后只显示气泡。' });

    const saveVolume = UI.debounce(async (value) => {
      const ok = await save({ voiceVolume: value });
      if (ok) toast('音量已调整为 ' + Math.round(value * 100) + '%', 'ok');
    }, 320);
    const saveRate = UI.debounce(async (value) => {
      const ok = await save({ voiceRate: value });
      if (ok) toast('语速已调整为 ' + value.toFixed(2) + '×', 'ok');
    }, 320);

    R.voiceVolume.addEventListener('input', async () => {
      const v = Number(R.voiceVolume.value) / 100;
      R.voiceVolumeValue.textContent = Math.round(v * 100) + '%';
      UI.setSliderFill(R.voiceVolume);
      // 未开启语音时，拖动音量顺手把语音打开
      if (!(app.state.settings || {}).voiceEnabled) {
        setSwitch(R.voiceSwitch, true);
        await save({ voiceEnabled: true });
        updateVoiceControls();
      }
      saveVolume(v);
    });
    R.voiceRate.addEventListener('input', async () => {
      const v = Number(R.voiceRate.value) / 100;
      R.voiceRateValue.textContent = v.toFixed(2) + '×';
      UI.setSliderFill(R.voiceRate);
      saveRate(v);
    });

    const voiceCard = el(
      'div',
      { class: 'card' },
      cardHead('语音播报', '让方块仔开口说话（需要系统语音支持）。', 'volume'),
      rowItem({ title: '启用语音', desc: '提醒、问候与互动回应改用语音播报。', iconName: 'volume', ctrl: R.voiceSwitch }).el,      rowItem({ title: '声音', desc: '神经语音，更接近真人（需要联网）；男声/女声自选。', iconName: 'volume', ctrl: makeSeg([
        { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女' },
        { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女' },
        { id: 'zh-CN-YunxiNeural', label: '云希 · 男' },
        { id: 'zh-CN-YunyangNeural', label: '云扬 · 男' },
      ], (app.state.settings || {}).ttsVoice || 'zh-CN-XiaoxiaoNeural', async (id) => { const ok = await save({ ttsVoice: id }); if (ok) toast('声音已切换', 'ok'); }) }).el,
      el('div', { class: 'divider' }),
      el(
        'div',
        { class: 'focus-duration' },
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '4px' } }, el('div', { class: 'row-item__title', text: '音量' }), R.voiceVolumeValue),
          R.voiceVolume,
          el('div', { class: 'size-scale' }, el('span', { text: '静音' }), el('span', { text: '50%' }), el('span', { text: '最大' })),
        ),
      ),
      el(
        'div',
        { class: 'focus-duration', style: { marginTop: '14px' } },
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '4px' } }, el('div', { class: 'row-item__title', text: '语速' }), R.voiceRateValue),
          R.voiceRate,
          el('div', { class: 'size-scale' }, el('span', { text: '0.80× 慢' }), el('span', { text: '1.05×' }), el('span', { text: '1.30× 快' })),
        ),
      ),
      el('div', { class: 'mt-12' }, R.voiceHint),
      el('div', { class: 'divider' }),
      rowItem({ title: '朗读所有对话', desc: '方块仔冒出的每句话（问候、AI 回复、提醒）都读出来；关闭则只读重要提醒。', iconName: 'message', ctrl: (R.voiceAllSwitch = makeSwitch(true, async (on) => { if (!(await save({ voiceAllBubbles: on }))) setSwitch(R.voiceAllSwitch, !on); })) }).el,
      rowItem({ title: '语音输入（对它说话）', desc: '用麦克风和方块仔聊天：按 Ctrl+Shift+V、右键菜单「对它说话」或聊天窗口的 🎤 按钮。离线中文识别，声音不会上传。', iconName: 'message', ctrl: (R.voiceInputSwitch = makeSwitch(true, async (on) => { if (!(await save({ voiceInputEnabled: on }))) setSwitch(R.voiceInputSwitch, !on); })) }).el,
      rowItem({ title: '声音', desc: '使用 Windows 已安装的语音；想要更多声音可在 Windows 设置 → 时间和语言 → 语音 中添加。', iconName: 'volume', ctrl: (R.voiceSelect = el('select', { class: 'select', 'aria-label': '声音' })) }).el,
      el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, (R.voiceTalkBtn = el('button', { class: 'btn btn--sm', type: 'button', style: { marginRight: '8px' } }, el('span', { text: '🎤 对它说一句' }))), (R.voiceTestBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('volume'), el('span', { text: '试听' })))),
    );
    sec.appendChild(voiceCard);
    R.voiceSelect.addEventListener('change', () => save({ voiceName: R.voiceSelect.value }, '声音已切换'));
    R.voiceTalkBtn.addEventListener('click', async () => {
      const span = R.voiceTalkBtn.querySelector('span');
      span.textContent = '🎤 正在听…请说话';
      R.voiceTalkBtn.disabled = true;
      try {
        const res = await app.invoke('voice:listen', {}, { gate: false });
        if (res && res.ok && res.text) UI.toast('听到了：「' + res.text + '」', 'ok');
        else if (res && res.ok) UI.toast('没听清，再试一次', 'ok');
        else UI.toast((res && res.message) || '语音输入不可用', 'err');
      } finally {
        span.textContent = '🎤 对它说一句';
        R.voiceTalkBtn.disabled = false;
      }
    });
    R.voiceTestBtn.addEventListener('click', async () => {
      const res = await app.invoke('tts:test', {});
      toast(res && res.ok ? '正在试听…' : '语音服务未就绪（需要 Windows 语音包）', res && res.ok ? 'info' : 'err', 2400);
    });
    (async () => {
      let res = null;
      for (let i = 0; i < 5; i += 1) {
        res = await app.invoke('tts:voices', {}).catch(() => null);
        if (res && res.voices && res.voices.length) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const voices = (res && res.voices) || [];
      clear(R.voiceSelect);
      R.voiceSelect.appendChild(el('option', { value: '', text: '自动（优先自然中文语音）' }));
      const ZH = { Xiaoxiao: '晓晓', Yaoyao: '瑶瑶', Huihui: '慧慧', Kangkang: '康康' };
      const rank = (v) => (v.engine === 'onecore' ? 0 : 2) + (/^zh/i.test(v.culture) ? 0 : 1);
      for (const v of voices.slice().sort((a, b) => rank(a) - rank(b))) {
        const base = v.name.replace('OneCore:', '').replace('Microsoft ', '').replace(' Desktop', '');
        const label = (ZH[base] ? ZH[base] + ' ' : '') + base + (v.engine === 'onecore' ? '（自然）' : '（经典）') + ' · ' + v.culture;
        R.voiceSelect.appendChild(el('option', { value: v.name, text: label }));
      }
      R.voiceSelect.value = ((app.state && app.state.settings) || {}).voiceName || '';
    })();

    // ---- 主人状态感知
    R.presenceSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ presenceReactions: on });
      if (!ok) setSwitch(R.presenceSwitch, !on);
      else toast(on ? '已开启主人状态感知' : '已关闭主人状态感知', 'ok');
    });
    R.presenceChip = el('div', { class: 'row', style: { gap: '8px', marginTop: '4px' } });
    const presenceCard = el(
      'div',
      { class: 'card' },
      cardHead('主人状态感知', '方块仔会读取当前活动窗口类型（不读取窗口内容），在你工作、看剧、开会或离开时做出不同反应。', 'eye'),
      rowItem({ title: '启用状态感知', desc: '关掉后它会安静陪伴，不再根据你的状态切换动作。', iconName: 'eye', ctrl: R.presenceSwitch }).el,
      el('div', { class: 'mt-12' }, el('div', { class: 'group-title', text: '当前状态' }), R.presenceChip),
    );
    sec.appendChild(presenceCard);

    // ---- 观影模式
    R.cinemaAutoSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ cinemaAuto: on });
      if (!ok) setSwitch(R.cinemaAutoSwitch, !on);
      else toast(on ? '已开启自动观影模式' : '已关闭自动观影模式', 'ok');
    });
    R.cinemaManualSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ cinemaManual: on });
      if (!ok) setSwitch(R.cinemaManualSwitch, !on);
      else toast(on ? '已进入观影模式（手动）' : '已退出手动观影模式', 'ok');
    });
    R.cinemaChip = el('div', { class: 'row', style: { gap: '8px', marginTop: '4px' } });
    const cinemaCard = el(
      'div',
      { class: 'card' },
      cardHead('观影模式', '全屏看剧或打游戏时，方块仔只保留一双发光的眼睛，几乎不占视线。', 'monitor'),
      rowItem({
        title: '全屏时自动进入',
        desc: '检测到全屏视频/游戏时自动切换为「只有眼睛」的模式，退出全屏后恢复。',
        iconName: 'monitor',
        ctrl: R.cinemaAutoSwitch,
      }).el,
      rowItem({
        title: '手动开启',
        desc: '现在就想让它安静一点？手动进入，直到你关掉为止。',
        iconName: 'moon',
        ctrl: R.cinemaManualSwitch,
      }).el,
      el('div', { class: 'mt-12' }, el('div', { class: 'group-title', text: '当前状态' }), R.cinemaChip),
    );
    sec.appendChild(cinemaCard);

    // ---- 通知
    R.coupleNotifySwitch = makeSwitch(true, async (on) => {
      const ok = await save({ coupleNotify: on });
      if (!ok) setSwitch(R.coupleNotifySwitch, !on);
      else toast(on ? '已开启情侣消息通知' : '已关闭情侣消息通知', 'ok');
    });
    const notifyCard = el(
      'div',
      { class: 'card' },
      cardHead('通知', '', 'bell'),
      rowItem({
        title: '情侣消息通知',
        desc: 'TA 发来悄悄话或在桌面出现时，用系统通知提醒你（不会显示消息内容）。',
        iconName: 'chat',
        ctrl: R.coupleNotifySwitch,
      }).el,
    );
    sec.appendChild(notifyCard);

    updateCouple = function (state) {
      if (!state) return;
      const settings = state.settings || {};
      const coupled = state.couple || null;
      const pro = can('couple_mode');

      // 伴侣状态卡
      renderCouplePartner(coupled, pro);

      // 语音
      setSwitch(R.voiceSwitch, settings.voiceEnabled !== false);
      if (R.voiceAllSwitch) setSwitch(R.voiceAllSwitch, settings.voiceAllBubbles !== false);
      if (R.voiceInputSwitch) setSwitch(R.voiceInputSwitch, settings.voiceInputEnabled !== false);
      if (R.voiceSelect && document.activeElement !== R.voiceSelect && R.voiceSelect.options.length) R.voiceSelect.value = settings.voiceName || '';
      const vol = UI.clamp(Number(settings.voiceVolume == null ? 0.7 : settings.voiceVolume), 0, 1);
      if (document.activeElement !== R.voiceVolume) R.voiceVolume.value = String(Math.round(vol * 100));
      R.voiceVolumeValue.textContent = Math.round(vol * 100) + '%';
      UI.setSliderFill(R.voiceVolume);
      const rate = UI.clamp(Number(settings.voiceRate == null ? 1.05 : settings.voiceRate), 0.8, 1.3);
      if (document.activeElement !== R.voiceRate) R.voiceRate.value = String(Math.round(rate * 100));
      R.voiceRateValue.textContent = rate.toFixed(2) + '×';
      UI.setSliderFill(R.voiceRate);
      updateVoiceControls();

      // 状态感知
      setSwitch(R.presenceSwitch, settings.presenceReactions !== false);
      clear(R.presenceChip);
      const presence = state.presence || {};
      const info = UI.presenceInfo(presence);
      R.presenceChip.appendChild(
        el('span', { class: 'badge ' + (info.tone === 'teal' ? 'badge--trial' : 'badge--ok') }, icon(info.icon), el('span', { text: info.label })),
      );
      const appLabel = String(presence.app || '').trim();
      if (appLabel && !['idle', 'unknown', 'none', '-', 'null'].includes(appLabel.toLowerCase())) {
        R.presenceChip.appendChild(el('span', { class: 'tag', text: appLabel }));
      }
      if (info.fullscreen) R.presenceChip.appendChild(el('span', { class: 'tag tag--accent', text: '全屏中' }));
      if (settings.presenceReactions === false) {
        R.presenceChip.appendChild(el('span', { class: 'tiny dim', text: '（已关闭，状态不会触发反应）' }));
      }

      // 观影模式
      setSwitch(R.cinemaAutoSwitch, settings.cinemaAuto !== false);
      setSwitch(R.cinemaManualSwitch, !!settings.cinemaManual);
      clear(R.cinemaChip);
      const cinemaOn = !!(state.ui && state.ui.cinemaMode);
      R.cinemaChip.appendChild(
        el(
          'span',
          { class: 'badge ' + (cinemaOn ? 'badge--pro' : 'badge--locked') },
          icon(cinemaOn ? 'moon' : 'monitor'),
          el('span', { text: cinemaOn ? '观影模式已生效' : '正在正常显示' }),
        ),
      );
      if (info.fullscreen) R.cinemaChip.appendChild(el('span', { class: 'tag tag--teal', text: '检测到全屏' }));
      if (settings.cinemaAuto === false && !settings.cinemaManual) {
        R.cinemaChip.appendChild(el('span', { class: 'tiny dim', text: '（自动模式已关闭）' }));
      }

      // 通知
      setSwitch(R.coupleNotifySwitch, settings.coupleNotify !== false);
    };
  }

  function updateVoiceControls() {
    const enabled = R.voiceSwitch && R.voiceSwitch.classList.contains('is-on');
    if (R.voiceVolume) R.voiceVolume.disabled = !enabled;
    if (R.voiceRate) R.voiceRate.disabled = !enabled;
    if (R.voiceHint) {
      R.voiceHint.textContent = enabled
        ? '方块仔会用语音说出提醒、问候与互动回应；关闭后只显示气泡。'
        : '语音已关闭，方块仔只用气泡文字与你交流。';
    }
  }

  function renderCouplePartner(couple, pro) {
    const host = R.couplePartnerHost;
    if (!host) return;
    clear(host);
    const head = cardHead('伴侣', '', 'ring');
    host.appendChild(head);

    if (!pro) {
      host.appendChild(
        el(
          'div',
          { class: 'notice notice--warn', style: { marginBottom: '12px' } },
          icon('lock'),
          el('div', { class: 'notice__body', text: '情侣模式是 Pro 功能。升级 Pro 后可以和 TA 的方块仔配对、聊天并举行婚礼。' }),
        ),
      );
      const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('crown'), el('span', { text: '查看 Pro 方案' }));
      btn.addEventListener('click', () => app.openPanel('store'));
      host.appendChild(btn);
      return;
    }

    if (!couple || !couple.enabled) {
      host.appendChild(
        el('div', {
          class: 'small muted',
          style: { lineHeight: '1.65', marginBottom: '12px' },
          text: '还没有配对。把方块仔介绍给 TA 吧：一人生成邀请码，另一人输入，两台电脑上的方块仔就会成为朋友。',
        }),
      );
      const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('link'), el('span', { text: '去配对' }));
      btn.addEventListener('click', () => app.openPanel('couple'));
      host.appendChild(btn);
      return;
    }

    const partner = couple.partner || {};
    const online = partner.online !== false;
    const info = UI.presenceInfo(partner.presence);
    const affectionPct = UI.affectionPercent(couple.affection);
    host.appendChild(
      el(
        'div',
        { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } },
        (() => {
          const avatar = el('div', { class: 'partner-mini-avatar' });
          const palette = (((app.state && app.state.skins) || [])).find((s) => s.id === partner.skinId);
          const p = (palette && palette.palette) || { body1: '#ffe1ec', body2: '#f497b6', body3: '#c85f83', eye: '#3a1622', glow: 'rgba(255,140,180,.5)' };
          avatar.style.background = 'linear-gradient(155deg, ' + p.body1 + ', ' + p.body2 + ' 56%, ' + p.body3 + ')';
          avatar.style.boxShadow = '0 8px 18px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.5), 0 0 18px ' + (p.glow || 'transparent');
          avatar.style.setProperty('--p-eye', p.eye);
          return avatar;
        })(),
        el(
          'div',
          { class: 'grow' },
          el(
            'div',
            { class: 'row', style: { gap: '8px' } },
            el('div', { class: 'h3', text: partner.name || 'TA' }),
            online ? UI.presenceBadge(partner.presence) : el('span', { class: 'badge badge--locked' }, icon('wifi-off'), el('span', { text: '离线' })),
            couple.married ? el('span', { class: 'badge badge--pro' }, icon('ring'), el('span', { text: '已婚' })) : null,
          ),
          el('div', { class: 'card__desc', text: online ? `${info.title || info.label}${partner.lastSeenAt ? ' · 刚刚还在' : ''}` : '暂时不在线，消息会保留' }),
          el(
            'div',
            { class: 'row', style: { gap: '10px', marginTop: '8px' } },
            el('span', { class: 'tiny dim', text: '恋爱值 ' + (couple.affection || 0) + ' / 1000' }),
            el('span', { class: 'tiny dim', text: couple.married ? '相伴第 ' + (couple.anniversaryDays || 0) + ' 天' : '已配对' }),
          ),
          el('div', { class: 'progress progress--thin', style: { marginTop: '6px' } }, el('div', { class: 'progress__fill', style: { width: affectionPct + '%' } })),
        ),
        (() => {
          const btn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('heart'), el('span', { text: '打开情侣模式' }));
          btn.addEventListener('click', () => app.openPanel('couple'));
          return btn;
        })(),
      ),
    );
  }
  // =============================================================== 生命
  let updateLife = null;

  const LIFE_MOOD = {
    calm: { label: '平静', icon: 'leaf', tone: 'teal' },
    happy: { label: '开心', icon: 'sparkle', tone: 'gold' },
    excited: { label: '兴奋', icon: 'bolt', tone: 'gold' },
    sleepy: { label: '困倦', icon: 'moon2', tone: 'muted' },
    hungry: { label: '饿了', icon: 'cake', tone: 'gold' },
    lonely: { label: '想你', icon: 'heart', tone: 'pink' },
    worried: { label: '担心你', icon: 'shield', tone: 'muted' },
    proud: { label: '为你骄傲', icon: 'star', tone: 'gold' },
  };

  function buildLife() {
    const sec = document.getElementById('sec-life');
    if (!sec) return;
    sec.appendChild(sectionHead('生命（Pro）', '它不只是会动：会饿、会累、会有心情，也会记得你们经历过的事。'));

    R.lifeHost = el('div', { class: 'stack' });
    R.lifeVeil = el(
      'div',
      { class: 'lock-veil hidden' },
      el('div', { class: 'lock-veil__icon' }, icon('sparkle')),
      el('div', { class: 'h3', text: '智慧生命是 Pro 功能' }),
      el('div', {
        class: 'small muted',
        style: { maxWidth: '320px' },
        text: '心情、精力、饱腹与精神值会随你的作息变化；它还会记住你说过的话，主动想起你。',
      }),
    );
    const upgradeBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '升级 Pro 解锁生命系统' }));
    upgradeBtn.addEventListener('click', () => app.showUpgrade('life_system'));
    R.lifeVeil.appendChild(upgradeBtn);

    sec.appendChild(el('div', { class: 'growth-lock' }, R.lifeHost, R.lifeVeil));

    updateLife = function (state) {
      if (!state) return;
      const life = state.life || {};
      const allowed = can('life_system') && life.locked !== true;
      R.lifeVeil.classList.toggle('hidden', allowed);
      renderLife(state);
    };
  }

  function renderLife(state) {
    const life = state.life;
    const host = R.lifeHost;
    if (!host) return;
    clear(host);

    if (!life || life.enabled === false) {
      host.appendChild(
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'empty' }, icon('sparkle'), el('div', { text: '生命系统正在初始化，稍后再看看它现在的状态吧。' })),
        ),
      );
      return;
    }

    const mood = life.mood && LIFE_MOOD[life.mood] ? LIFE_MOOD[life.mood] : { label: life.moodLabel || '平静', icon: 'leaf', tone: 'teal' };
    // 真实契约：traits[{id,name,desc}] / events[{at,type,text}] / hunger(饱腹) / thoughts[string]
    const traitsRaw = Array.isArray(life.traits) ? life.traits : Array.isArray(life.personality) ? life.personality : [];
    const personality = traitsRaw.slice(0, 4).map((t) => (typeof t === 'string' ? t : t && (t.name || t.id))).filter(Boolean);
    const thoughts = normalizeLifeThoughts(life.thoughts);
    const eventsRaw = Array.isArray(life.events) ? life.events : Array.isArray(life.memories) ? life.memories : [];
    const memories = eventsRaw.slice(0, 3).map((e) => ({ title: e.text || e.title || '一件小事', text: e.type || '', at: e.at }));
    const days = Number(life.daysTogether) || 0;

    // ---- 状态主卡
    const moodTile = el('div', { class: 'ico-tile ico-tile--gold' }, icon(mood.icon));
    host.appendChild(
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'life-hero' },
          el('div', { class: 'life-avatar' }),
          el(
            'div',
            { class: 'grow' },
            el(
              'div',
              { class: 'life-mood' },
              moodTile,
              el('div', { class: 'h2', text: mood.label }),
              el('span', { class: 'tag', text: `相处第 ${days} 天` }),
            ),
            el(
              'div',
              { class: 'life-tags' },
              el('span', { class: 'tiny dim', text: '性格' }),
              ...(personality.length
                ? personality.map((tag) => el('span', { class: 'tag tag--teal', text: tag }))
                : [el('span', { class: 'tiny dim', text: '还在观察你…' })]),
            ),
          ),
          (() => {
            const feed = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('cake'), el('span', { text: '投喂' }));
            feed.addEventListener('click', async () => {
              feed.disabled = true;
              const res = await app.invoke(IPC.GROWTH_FEED, {});
              feed.disabled = false;
              if (res && res.ok) {
                toast('投喂成功，它看起来更精神了', 'ok');
                await app.refresh();
              } else if (res && res.reason === 'cooldown') {
                toast('刚刚才吃过，等一会儿再喂吧', 'warn', 3200);
              } else if (res && res.code !== 'FEATURE_LOCKED') {
                toast(res.message || '投喂失败', 'err');
              }
            });
            const pet = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('heart'), el('span', { text: '摸摸' }));
            pet.addEventListener('click', async () => {
              pet.disabled = true;
              const res = await app.invoke(IPC.GROWTH_PET, {});
              pet.disabled = false;
              if (res && res.ok) {
                toast('它蹭了蹭你的手', 'ok', 2200);
                await app.refresh();
              } else if (res && res.code !== 'FEATURE_LOCKED') {
                toast((res && res.message) || '互动失败', 'err');
              }
            });
            return el('div', { class: 'row', style: { gap: '8px' } }, feed, pet);
          })(),
        ),
      ),
    );

    // ---- 三条状态条
    const bars = [
      { key: 'energy', label: '精力', icon: 'bolt', value: life.energy, tone: 'amber' },
      { key: 'hunger', label: '饱腹', icon: 'cake', value: life.hunger != null ? life.hunger : life.satiety, tone: 'gold' },
      { key: 'spirit', label: '精神', icon: 'sparkle', value: life.spirit, tone: 'teal' },
    ];
    const barsCard = el('div', { class: 'card' }, cardHead('状态', '会随你的作息、投喂与互动缓慢变化。', 'chart'));
    for (const bar of bars) {
      const value = UI.clamp(Number(bar.value) || 0, 0, 100);
      barsCard.appendChild(
        el(
          'div',
          { class: 'life-bar' },
          el(
            'div',
            { class: 'life-bar__head' },
            el('div', { class: 'row-item__title', style: { gap: '7px' } }, icon(bar.icon), el('span', { text: bar.label })),
            el('span', { class: 'life-bar__value', text: `${value} / 100` }),
          ),
          el(
            'div',
            { class: 'progress life-bar__track' },
            el('div', { class: 'progress__fill life-bar__fill life-bar__fill--' + bar.tone, style: { width: value + '%' } }),
          ),
        ),
      );
    }
    host.appendChild(barsCard);

    // ---- 心声 + 记忆
    const thoughtCard = el(
      'div',
      { class: 'card' },
      cardHead('最近的心声', '', 'chat'),
      el(
        'div',
        { class: 'life-thought' },
        el('span', { class: 'life-thought__mark', text: '“' }),
        el('span', { class: 'life-thought__text', text: thoughts[0] || '我在这里，一直看着屏幕' }),
      ),
      el('div', { class: 'tiny dim mt-8', text: '这些心声会出现在气泡里。' }),
    );

    const memCard = el('div', { class: 'card' }, cardHead('记忆', '最近记得的 3 件事。', 'star'));
    if (memories.length) {
      const list = el('div', { class: 'life-memories' });
      for (const mem of memories) {
        list.appendChild(
          el(
            'div',
            { class: 'life-mem' },
            el('span', { class: 'life-mem__dot' }),
            el(
              'div',
              { class: 'grow' },
              el('div', { class: 'life-mem__title', text: mem.title || '一件小事' }),
              el('div', { class: 'life-mem__desc', text: UI.formatDateCn(mem.at) }),
            ),
          ),
        );
      }
      memCard.appendChild(list);
    } else {
      memCard.appendChild(el('div', { class: 'empty' }, icon('star'), el('div', { text: '还没有记忆，多陪它几天就会有了。' })));
    }

    host.appendChild(el('div', { class: 'grid-2' }, thoughtCard, memCard));
  }

  function normalizeLifeThoughts(value) {
    if (Array.isArray(value)) return value.filter((x) => typeof x === 'string' && x.trim());
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
  }
  // =============================================================== AI 陪伴
  let updateAi = null;

  const AI_PROVIDERS = [
    { id: 'cubbit', label: '方块仔内置', hint: '开箱即用，每天 5 句免费' },
    { id: 'ollama', label: '本地 Ollama', hint: '对话不出本机，需要先运行 ollama serve' },
    { id: 'openai', label: 'OpenAI 兼容', hint: '填任意兼容 OpenAI 协议的服务（含自建代理）' },
  ];
  const AI_PERSONALITIES = [
    { id: 'warm', label: '温暖', desc: '多共情，说话软一点' },
    { id: 'sassy', label: '毒舌', desc: '嘴上不饶人，但会陪你' },
    { id: 'quiet', label: '安静', desc: '话少，句子短' },
  ];

  function makeSeg(options, value, onChange) {
    const wrap = el('div', { class: 'seg' });
    const buttons = [];
    for (const opt of options) {
      const btn = el('button', { class: 'seg__item' + (opt.id === value ? ' is-active' : ''), type: 'button' }, el('span', { text: opt.label }));
      btn.addEventListener('click', () => {
        for (const b of buttons) b.classList.toggle('is-active', b === btn);
        onChange(opt.id);
      });
      buttons.push(btn);
      wrap.appendChild(btn);
    }
    wrap.setValue = (next) => {
      for (const b of buttons) {
        const opt = options[buttons.indexOf(b)];
        b.classList.toggle('is-active', opt.id === next);
      }
    };
    return wrap;
  }

  async function aiConfigSet(patch, successMsg) {
    const res = await app.invoke(IPC.AI_CONFIG_SET, { patch }, { gate: false });
    if (res && res.ok) {
      if (successMsg) toast(successMsg, 'ok');
      await app.refresh();
      return true;
    }
    if (res && res.code === 'FEATURE_LOCKED') {
      app.showUpgrade('ai_chat');
    } else {
      toast((res && res.message) || '保存失败，请稍后重试', 'err', 3600);
    }
    await app.refresh();
    return false;
  }

  function buildAi() {
    const sec = document.getElementById('sec-ai');
    if (!sec) return;
    sec.appendChild(
      sectionHead(
        'AI 陪伴（Pro）',
        '让方块仔真正听懂你。可以接本机 Ollama（对话不出本机），也可以接任意 OpenAI 兼容服务。',
      ),
    );

    // ---- 连接配置卡
    R.aiEnabledSwitch = makeSwitch(true, async (on) => {
      const ok = await aiConfigSet({ aiEnabled: on }, on ? 'AI 陪伴已开启' : 'AI 陪伴已关闭');
      if (!ok) setSwitch(R.aiEnabledSwitch, !on);
      updateAiControls();
    });

    R.aiProviderSeg = makeSeg(AI_PROVIDERS, 'ollama', async (id) => {
      const ok = await aiConfigSet({ aiProvider: id }, '已切换到' + (id === 'ollama' ? '本地 Ollama' : 'OpenAI 兼容服务'));
      if (!ok) app.refresh();
      updateAiHints();
    });

    R.aiBaseUrl = el('input', { class: 'input', type: 'text', spellcheck: 'false', placeholder: 'http://127.0.0.1:11434' });
    R.aiModel = el('input', { class: 'input', type: 'text', spellcheck: 'false', placeholder: 'qwen2.5:3b' });
    R.aiApiKey = el('input', { class: 'input', type: 'password', spellcheck: 'false', placeholder: 'sk-…（只保存在本机）', autocomplete: 'off' });
    R.aiKeyState = el('span', { class: 'tag', text: '未设置' });
    R.aiKeySecurityHint = el('div', { class: 'field__error hidden' });
    R.aiClearKeyBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('trash'), el('span', { text: '清除' }));
    R.aiClearKeyBtn.addEventListener('click', async () => {
      R.aiApiKey.value = '';
      const ok = await aiConfigSet({ aiApiKey: '' }, '已清除 API Key');
      if (ok) R.aiKeyState.textContent = '未设置';
    });

    const saveBaseUrl = UI.debounce(async () => {
      const value = R.aiBaseUrl.value.trim();
      if (value && !/^https?:\/\//i.test(value)) {
        toast('Base URL 需要以 http:// 或 https:// 开头', 'err', 3600);
        return;
      }
      await aiConfigSet({ aiBaseUrl: value });
      updateAiHints();
    }, 500);
    const saveModel = UI.debounce(async () => {
      await aiConfigSet({ aiModel: R.aiModel.value.trim() });
      updateAiHints();
    }, 500);
    R.aiBaseUrl.addEventListener('change', saveBaseUrl);
    R.aiModel.addEventListener('change', saveModel);
    R.aiApiKey.addEventListener('change', async () => {
      const value = R.aiApiKey.value.trim();
      if (!value) return;
      const ok = await aiConfigSet({ aiApiKey: value }, 'API Key 已保存（只存本机）');
      if (ok) R.aiKeyState.textContent = '已保存';
    });

    R.aiBaseUrlHint = el('div', { class: 'field__hint', text: '本地 Ollama 默认 http://127.0.0.1:11434。' });

    R.aiPersonalitySeg = makeSeg(AI_PERSONALITIES, 'warm', async (id) => {
      await aiConfigSet({ aiPersonality: id }, '性格已切换为' + (AI_PERSONALITIES.find((p) => p.id === id) || {}).label);
    });

    // ---- DIY 人设：它对自己的称呼 + 口头禅（2026-11-04）
    R.petNameInput = el('input', { class: 'input', type: 'text', maxlength: '10', placeholder: '方块仔', style: { width: '116px' } });
    R.petNameInput.addEventListener('change', async () => {
      const v = R.petNameInput.value.trim().slice(0, 10) || '方块仔';
      R.petNameInput.value = v;
      await aiConfigSet({ petName: v }, '以后叫我「' + v + '」');
    });
    R.petCatchphraseInput = el('input', { class: 'input', type: 'text', maxlength: '16', placeholder: '例如：你最棒啦', style: { width: '176px' } });
    R.petCatchphraseInput.addEventListener('change', async () => {
      const v = R.petCatchphraseInput.value.trim().slice(0, 16);
      await aiConfigSet({ petCatchphrase: v }, v ? '口头禅已记住：' + v : '口头禅已清空');
    });

    R.aiRememberSwitch = makeSwitch(true, async (on) => {
      const ok = await aiConfigSet({ aiRemember: on }, on ? '它会记住你们的对话' : '已关闭对话记忆');
      if (!ok) setSwitch(R.aiRememberSwitch, !on);
      updateAiControls();
    });
    R.aiMaxTurnsSelect = el('select', { class: 'select', style: { width: '128px' } });
    for (const n of [6, 10, 20, 30]) {
      R.aiMaxTurnsSelect.appendChild(el('option', { value: String(n), text: `${n} 轮` }));
    }
    R.aiMaxTurnsSelect.addEventListener('change', async () => {
      await aiConfigSet({ aiMaxTurns: Number(R.aiMaxTurnsSelect.value) }, '记忆长度已更新');
    });

    R.aiTestBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('bolt'), el('span', { text: '测试连接' }));
    R.aiTestResult = el('div', { class: 'ai-test-result' });
    R.aiTestBtn.addEventListener('click', runAiTest);

    R.aiStatusChip = el('div', { class: 'row', style: { gap: '8px' } });
    R.aiLastError = el('div', { class: 'field__error hidden' });

    const connectCard = el(
      'div',
      { class: 'card' },
      cardHead('连接方式', '推荐先试本机 Ollama：不用填 Key，对话也不会离开这台电脑。', 'chat'),
      rowItem({
        title: '启用 AI 陪伴',
        desc: '关闭后聊天面板只显示规则回复，桌宠也不会主动搭话。',
        iconName: 'chat',
        ctrl: R.aiEnabledSwitch,
      }).el,
      rowItem({ title: '服务商', desc: '本地模型 / 云端兼容服务', iconName: 'globe', ctrl: R.aiProviderSeg }).el,
      el(
        'div',
        { class: 'ai-grid' },
        el(
          'div',
          { class: 'field' },
          el('label', { class: 'field__label' }, icon('globe'), el('span', { text: 'Base URL' })),
          R.aiBaseUrl,
          R.aiBaseUrlHint,
        ),
        el(
          'div',
          { class: 'field' },
          el('label', { class: 'field__label' }, icon('sliders'), el('span', { text: '模型名' })),
          R.aiModel,
          el('div', { class: 'field__hint', text: '例如 qwen2.5:3b、llama3.2:3b、gpt-4o-mini。' }),
        ),
      ),
      el(
        'div',
        { class: 'field', style: { marginTop: '12px' } },
        el(
          'label',
          { class: 'field__label' },
          icon('key'),
          el('span', { text: 'API Key' }),
          R.aiKeyState,
          el('span', { class: 'grow' }),
          R.aiClearKeyBtn,
        ),
        R.aiApiKey,
        el('div', { class: 'field__hint', text: '用系统密钥库（safeStorage）加密后只保存在本机，不会写入状态、也不会同步给其它窗口或云端。' }),
        R.aiKeySecurityHint,
      ),
      el(
        'div',
        { class: 'row', style: { justifyContent: 'space-between', gap: '12px', marginTop: '16px' } },
        el('div', { class: 'small dim', style: { lineHeight: '1.6', maxWidth: '420px' }, text: '测试连接会向配置的服务发一次很小的请求，用于确认地址、模型和 Key 是否可用。' }),
        R.aiTestBtn,
      ),
      R.aiTestResult,
      R.aiLastError,
    );

    // ---- 性格 & 记忆
    const personaCard = el(
      'div',
      { class: 'card' },
      cardHead('性格与记忆', '它会按你选的方式说话，也会记住最近的对话。', 'heart'),
      rowItem({
        title: '说话风格',
        desc: '温暖多共情、毒舌嘴上不饶人、安静话少。随时可以改。',
        iconName: 'sparkle',
        ctrl: R.aiPersonalitySeg,
      }).el,
      rowItem({
        title: '它怎么称呼自己',
        desc: '给它起个只属于你们的名字，AI 对话里会用这个名字自称。',
        iconName: 'sparkle',
        ctrl: R.petNameInput,
      }).el,
      rowItem({
        title: '口头禅',
        desc: '它偶尔会冒出的一句话，留空就不说。',
        iconName: 'chat',
        ctrl: R.petCatchphraseInput,
      }).el,
      rowItem({
        title: '记住对话',
        desc: '关闭后每次聊天都是全新的开始；开启时会带上最近若干轮上下文。',
        iconName: 'receipt',
        ctrl: el('div', { class: 'row', style: { gap: '8px' } }, R.aiMaxTurnsSelect, R.aiRememberSwitch),
      }).el,
      el('div', { class: 'mt-12' }, el('div', { class: 'group-title', text: '当前状态' }), R.aiStatusChip),
    );

    sec.appendChild(connectCard);
    sec.appendChild(personaCard);

    // ---- 隐私说明
    sec.appendChild(
      el(
        'div',
        { class: 'notice notice--info' },
        icon('shield'),
        el(
          'div',
          { class: 'notice__body' },
          el('div', { class: 'h4', style: { color: '#b9f2ea' }, text: '对话的边界由你决定' }),
          el('div', {
            class: 'small',
            text: '使用本地 Ollama 时，对话只在本机流转；使用云端服务时，内容会发送给你配置的服务商，请先阅读其隐私政策。我们不会把你的对话上传到 方块仔 的服务器。',
          }),
        ),
      ),
    );

    // ---- 未解锁遮罩
    R.aiVeil = el(
      'div',
      { class: 'lock-veil hidden' },
      el('div', { class: 'lock-veil__icon' }, icon('lock')),
      el('div', { class: 'h3', text: 'AI 陪伴是 Pro 功能' }),
      el('div', {
        class: 'small muted',
        style: { maxWidth: '330px' },
        text: '聊天、性格与记忆都包含在 Pro 里；支持本地模型，对话可以完全不出这台电脑。',
      }),
    );
    const upgradeBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '升级 Pro 解锁' }));
    upgradeBtn.addEventListener('click', () => app.openPanel('store'));
    R.aiVeil.appendChild(upgradeBtn);
    sec.appendChild(el('div', { class: 'ai-lock-wrap' }, R.aiVeil));

    updateAi = function (state) {
      if (!state) return;
      const settings = state.settings || {};
      const ai = state.ai || {};
      const unlocked = can('ai_chat');
      R.aiVeil.classList.toggle('hidden', unlocked);

      setSwitch(R.aiEnabledSwitch, settings.aiEnabled !== false);
      const provider = settings.aiProvider || ai.provider || 'ollama';
      R.aiProviderSeg.setValue(provider);
      if (document.activeElement !== R.aiBaseUrl) R.aiBaseUrl.value = settings.aiBaseUrl || ai.baseUrl || '';
      if (document.activeElement !== R.aiModel) R.aiModel.value = settings.aiModel || ai.model || '';
      R.aiKeyState.textContent = ai.keySet === true || ai.hasApiKey === true ? '已保存' : '未设置';
      R.aiApiKey.value = '';
      // 安全存储不可用时（部分 Linux 环境）：Key 只在内存，重启后需重新输入
      const keyDegraded = (ai.keySet === true || ai.hasApiKey === true) && settings.aiKeyEncrypted === false;
      R.aiKeySecurityHint.classList.toggle('hidden', !keyDegraded);
      if (keyDegraded) {
        clear(R.aiKeySecurityHint);
        R.aiKeySecurityHint.appendChild(icon('warning'));
        R.aiKeySecurityHint.appendChild(el('span', { text: '当前系统不支持安全存储，API Key 不会保存到磁盘，重启后需要重新输入。' }));
      }
      R.aiPersonalitySeg.setValue(settings.aiPersonality || ai.personality || 'warm');
      if (R.petNameInput) R.petNameInput.value = settings.petName || '方块仔';
      if (R.petCatchphraseInput) R.petCatchphraseInput.value = settings.petCatchphrase || '';
      setSwitch(R.aiRememberSwitch, settings.aiRemember !== false);
      const turns = Number(settings.aiMaxTurns) || 10;
      if (![...R.aiMaxTurnsSelect.options].some((o) => o.value === String(turns))) {
        R.aiMaxTurnsSelect.appendChild(el('option', { value: String(turns), text: `${turns} 轮` }));
      }
      R.aiMaxTurnsSelect.value = String(turns);

      // 当前连接状态
      clear(R.aiStatusChip);
      const status = aiStatusForSettings(ai, settings);
      R.aiStatusChip.appendChild(el('span', { class: 'badge ' + status.cls }, icon(status.icon), el('span', { text: status.label })));
      if (ai.model) R.aiStatusChip.appendChild(el('span', { class: 'tag', text: ai.model }));
      if (ai.provider) R.aiStatusChip.appendChild(el('span', { class: 'tag', text: ai.provider === 'ollama' ? '本地' : '云端' }));
      if (ai.lastError) {
        R.aiLastError.classList.remove('hidden');
        clear(R.aiLastError);
        R.aiLastError.appendChild(icon('warning'));
        R.aiLastError.appendChild(el('span', { text: String(ai.lastError) }));
      } else {
        R.aiLastError.classList.add('hidden');
      }
      updateAiHints();
      updateAiControls();
    };
  }

  function aiStatusForSettings(ai, settings) {
    if (!ai || ai.ready === undefined) {
      if (settings.aiEnabled === false) return { label: 'AI 已关闭', cls: 'badge--locked', icon: 'power' };
      return { label: '未检测', cls: 'badge--locked', icon: 'wifi-off' };
    }
    if (ai.pro === false) return { label: 'Pro 专属', cls: 'badge--locked', icon: 'lock' };
    if (!ai.enabled) return { label: '已关闭', cls: 'badge--locked', icon: 'power' };
    if (ai.chatting) return { label: '正在对话', cls: 'badge--trial', icon: 'chat' };
    if (!ai.ready) return { label: ai.lastError ? '连接异常' : '未连接', cls: ai.lastError ? 'badge--danger' : 'badge--locked', icon: 'warning' };
    if (ai.provider === 'ollama') return { label: '本地模型就绪', cls: 'badge--ok', icon: 'monitor' };
    if (ai.provider === 'openai') return { label: '云端模型就绪', cls: 'badge--ok', icon: 'globe' };
    return { label: '已连接', cls: 'badge--ok', icon: 'check-circle' };
  }

  function updateAiHints() {
    if (!R.aiBaseUrlHint) return;
    const provider = R.aiProviderSeg && R.aiProviderSeg.querySelector('.seg__item.is-active')?.textContent?.trim();
    const isOpenAI = provider === 'OpenAI 兼容';
    R.aiBaseUrl.placeholder = isOpenAI ? 'https://api.openai.com/v1' : 'http://127.0.0.1:11434';
    R.aiBaseUrlHint.textContent = isOpenAI
      ? '填写兼容 OpenAI 协议的地址（一般以 /v1 结尾），Key 只保存在本机。'
      : '本地 Ollama 默认 http://127.0.0.1:11434，需要先运行 ollama serve。';
    R.aiModel.placeholder = isOpenAI ? 'gpt-4o-mini' : 'qwen2.5:3b';
  }

  function updateAiControls() {
    const enabled = R.aiEnabledSwitch && R.aiEnabledSwitch.classList.contains('is-on');
    const remember = R.aiRememberSwitch && R.aiRememberSwitch.classList.contains('is-on');
    for (const node of [R.aiProviderSeg, R.aiBaseUrl, R.aiModel, R.aiApiKey, R.aiPersonalitySeg, R.aiTestBtn]) {
      if (!node) continue;
      if (node.classList.contains('seg')) {
        for (const b of node.querySelectorAll('.seg__item')) b.disabled = !enabled;
      } else {
        node.disabled = !enabled;
      }
    }
    if (R.aiRememberSwitch) R.aiRememberSwitch.disabled = !enabled;
    if (R.aiMaxTurnsSelect) R.aiMaxTurnsSelect.disabled = !enabled || !remember;
    if (R.aiClearKeyBtn) R.aiClearKeyBtn.disabled = !enabled;
  }

  async function runAiTest() {
    if (!R.aiTestBtn || R.aiTestBtn.disabled) return;
    R.aiTestBtn.disabled = true;
    const label = R.aiTestBtn.querySelector('span');
    const original = label ? label.textContent : '测试连接';
    if (label) label.textContent = '测试中…';
    clear(R.aiTestResult);
    const provider = (R.aiProviderSeg.querySelector('.seg__item.is-active') || {}).textContent?.trim() === 'OpenAI 兼容' ? 'openai' : 'ollama';
    const payload = {
      provider,
      baseUrl: R.aiBaseUrl.value.trim(),
      model: R.aiModel.value.trim(),
    };
    if (R.aiApiKey.value.trim()) payload.apiKey = R.aiApiKey.value.trim();

    const res = await app.invoke(IPC.AI_TEST, payload, { gate: false });
    R.aiTestBtn.disabled = false;
    if (label) label.textContent = original;

    clear(R.aiTestResult);
    if (res && res.ok) {
      const box = el(
        'div',
        { class: 'ai-test-ok' },
        el('div', { class: 'row', style: { gap: '8px' } }, icon('check-circle'), el('strong', { text: '连接成功' }), el('span', { class: 'tag tag--teal', text: `${res.latencyMs || 0} ms` })),
      );
      if (Array.isArray(res.models) && res.models.length) {
        const list = el('div', { class: 'ai-test-models' });
        for (const model of res.models.slice(0, 8)) {
          const chip = el('button', { class: 'ai-model-chip', type: 'button', title: '使用这个模型' }, el('span', { text: model }));
          chip.addEventListener('click', async () => {
            R.aiModel.value = model;
            const ok = await aiConfigSet({ aiModel: model }, `已切换到 ${model}`);
            if (ok) updateAiHints();
          });
          list.appendChild(chip);
        }
        box.appendChild(el('div', { class: 'tiny dim mt-8', text: '可用模型（点击即切换）：' }));
        box.appendChild(list);
      }
      R.aiTestResult.appendChild(box);
      toast('连接成功', 'ok', 2600);
    } else {
      const msg = (res && (res.message || res.error)) || '连接失败，请检查地址与模型';
      R.aiTestResult.appendChild(
        el('div', { class: 'ai-test-err' }, icon('warning'), el('span', { text: msg })),
      );
      toast(msg, 'err', 4200);
    }
  }
  // =============================================================== 数据与备份
  let updateBackup = null;
  let backupInfo = null;

  const BACKUP_IPC = {
    INFO: 'backup:info',
    EXPORT: 'backup:export',
    IMPORT: 'backup:import',
    PUSH: 'backup:sync:push',
    PULL: 'backup:sync:pull',
    DELETE: 'backup:sync:delete',
  };

  function backupInvoke(channel, payload, opts) {
    try {
      return app.invoke(channel, payload || {}, opts || { gate: false });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function backupFeedback(message, kind) {
    if (!R.backupFeedback) return;
    R.backupFeedback.classList.remove('hidden', 'is-err', 'is-ok');
    R.backupFeedback.textContent = message;
    if (kind === 'err') R.backupFeedback.classList.add('is-err');
    else if (kind === 'ok') R.backupFeedback.classList.add('is-ok');
  }

  function friendlyBackupError(res, fallback) {
    if (!res) return fallback || '操作失败，请稍后重试';
    const code = res.code || '';
    if (code === 'WEAK_PASSWORD') return '密码至少 6 位';
    if (code === 'BAD_BACKUP') return '备份文件已损坏，或者密码不正确';
    if (code === 'SYNC_NOT_READY') return (res.message || '') || '云同步服务即将开放：先用本地导出/导入备份';
    if (code === 'NO_SYNC_PASSWORD' || code === 'PASSWORD_REQUIRED') return '请先设置同步密码（至少 6 位）';
    if (code === 'NOT_FOUND') return '云端还没有备份，先上传一次吧';
    if (code === 'SYNC_ERROR') return (res && res.error) || '云同步失败，请稍后重试';
    if (code === 'FEATURE_LOCKED') return '云同步需要完整版或 AI 订阅';
    return res.message || res.error || fallback || '操作失败，请稍后重试';
  }

  function backupTimeText(ts) {
    if (!ts) return '还没有同步过';
    const value = ts > 1e12 ? ts : ts * 1000;
    return UI.formatDateTime ? UI.formatDateTime(value) : UI.formatDate(value) + ' ' + UI.formatClock(value);
  }

  async function loadBackupInfo() {
    try {
      const res = await backupInvoke(BACKUP_IPC.INFO, {});
      if (res && res.ok) {
        backupInfo = res;
        renderBackupInfo();
      }
    } catch (err) {
      backupFeedback('备份信息读取失败：主进程版本可能较旧，重启应用后再试。', 'err');
    }
  }

  function renderBackupInfo() {
    const info = backupInfo || {};
    if (R.backupScopeNote) {
      const scope = Array.isArray(info.scope) && info.scope.length ? info.scope.length + ' 类数据' : '生命 / 成长 / 专注 / 外观 / 情侣资料';
      R.backupScopeNote.textContent = '本次备份包含：' + scope + '。不包含许可证密钥、支付信息与设备指纹。';
    }
    if (R.syncMeta) {
      clear(R.syncMeta);
      const cloud = info.cloud || {};
      const configured =
        cloud.configured !== undefined ? !!cloud.configured : !!(cloud.enabled || cloud.lastSyncAt || info.syncConfigured);
      R.syncMeta.appendChild(el('span', { class: 'badge ' + (configured ? 'badge--teal' : 'badge--locked') }, icon('cloud'), el('span', { text: configured ? '云同步已启用' : '云同步未启用' })));
      const lastSync = info.lastSyncAt || cloud.lastSyncAt || 0;
      R.syncMeta.appendChild(el('span', { class: 'tiny dim', text: '上次同步：' + backupTimeText(lastSync) }));
      const lastExport = info.lastExportAt || 0;
      R.syncMeta.appendChild(el('span', { class: 'tiny dim', text: '上次导出：' + (lastExport ? backupTimeText(lastExport) : '还没有导出过') }));
      if (Array.isArray(info.files) && info.files.length) {
        R.syncMeta.appendChild(el('span', { class: 'tiny dim', text: '本地已有 ' + info.files.length + ' 份备份' }));
      }
    }
    if (R.syncNotice) {
      const cloud = info.cloud || {};
      const ready = cloud.ready !== undefined ? !!cloud.ready : info.cloudReady === true && !cloud.error;
      R.syncNotice.classList.toggle('hidden', ready);
      if (!ready) {
        clear(R.syncNotice);
        R.syncNotice.appendChild(icon('info'));
        R.syncNotice.appendChild(
          el('div', {
            class: 'notice__body',
            text: (cloud.error || info.syncMessage || '云同步服务即将开放：本轮请使用本地导出/导入备份，等云端接口就绪后即可一键恢复。'),
          }),
        );
      }
    }
  }

  async function backupExport() {
    const password = (R.backupPwd && R.backupPwd.value) || '';
    if (password && password.length < 6) {
      backupFeedback('密码至少 6 位；也可以留空导出明文备份', 'err');
      return;
    }
    R.backupExportBtn.disabled = true;
    const label = R.backupExportBtn.querySelector('span');
    const original = label ? label.textContent : '导出备份';
    if (label) label.textContent = '正在导出…';
    try {
      const res = await backupInvoke(BACKUP_IPC.EXPORT, { password: password || undefined });
      if (res && res.ok) {
        if (res.canceled) backupFeedback('已取消导出', '');
        else {
          backupFeedback('已导出' + (res.encrypted ? '加密' : '') + '备份：' + (res.path || ''), 'ok');
          toast('备份已导出', 'ok', 2600);
          loadBackupInfo();
        }
      } else {
        backupFeedback(friendlyBackupError(res, '导出失败'), 'err');
      }
    } catch (err) {
      backupFeedback('导出失败：当前版本尚未提供备份能力（' + String((err && err.message) || err).slice(0, 60) + '），请更新应用后再试。', 'err');
    } finally {
      R.backupExportBtn.disabled = false;
      if (label) label.textContent = original;
    }
  }

  async function backupImport() {
    const password = (R.backupImportPwd && R.backupImportPwd.value) || '';
    R.backupImportBtn.disabled = true;
    const label = R.backupImportBtn.querySelector('span');
    const original = label ? label.textContent : '导入恢复';
    if (label) label.textContent = '正在恢复…';
    try {
      const res = await backupInvoke(BACKUP_IPC.IMPORT, { password: password || undefined });
      if (res && res.ok) {
        if (res.canceled) backupFeedback('已取消导入', '');
        else {
          const counts = res.restored || {};
          const parts = [];
          if (counts.focus) parts.push('专注记录 ' + counts.focus);
          if (counts.life) parts.push('生命状态');
          if (counts.growth) parts.push('成长数据');
          if (counts.settings) parts.push('外观设置');
          backupFeedback('已恢复：' + (parts.length ? parts.join('、') : '数据已导入'), 'ok');
          toast('备份已恢复，部分数据重启后完全生效', 'ok', 3200);
          await app.refresh();
          loadBackupInfo();
        }
      } else {
        backupFeedback(friendlyBackupError(res, '导入失败'), 'err');
      }
    } catch (err) {
      backupFeedback('导入失败：当前版本尚未提供备份能力，请更新应用后再试。', 'err');
    } finally {
      R.backupImportBtn.disabled = false;
      if (label) label.textContent = original;
    }
  }

  async function syncAction(kind, payload) {
    const map = {
      push: [BACKUP_IPC.PUSH, '正在上传…'],
      pull: [BACKUP_IPC.PULL, '正在恢复…'],
      delete: [BACKUP_IPC.DELETE, '正在删除…'],
    };
    const [channel, busy] = map[kind] || [];
    if (!channel) return;
    const btn = kind === 'push' ? R.syncPushBtn : kind === 'pull' ? R.syncPullBtn : R.syncDeleteBtn;
    if (!btn || btn.disabled) return;
    const label = btn.querySelector('span');
    const original = label ? label.textContent : '';
    btn.disabled = true;
    if (label) label.textContent = busy;
    try {
      const res = await backupInvoke(channel, payload || {});
      if (res && res.ok) {
        backupFeedback(kind === 'push' ? '已加密上传到云端' : kind === 'pull' ? '已从云端恢复数据' : '云端备份已清空', 'ok');
        toast(kind === 'push' ? '上传成功' : kind === 'pull' ? '恢复成功' : '云端备份已删除', 'ok', 2600);
        await loadBackupInfo();
        await app.refresh();
      } else {
        backupFeedback(friendlyBackupError(res, '同步失败'), 'err');
      }
    } catch (err) {
      backupFeedback('云同步暂不可用：服务端接口尚未就绪，先使用本地导出/导入吧。', 'warn');
    } finally {
      btn.disabled = false;
      if (label) label.textContent = original;
    }
  }

  function buildBackup() {
    const sec = document.getElementById('sec-backup');
    if (!sec) return;
    sec.appendChild(
      sectionHead('数据与备份', '把数据留在自己手里：可以导出成本地文件，也可以用同步密码加密存到云端。'),
    );

    // ---- 本地备份
    R.backupPwd = el('input', { class: 'input', type: 'password', placeholder: '可选：设置备份密码（≥6 位，留空即明文）', autocomplete: 'new-password' });
    R.backupImportPwd = el('input', { class: 'input', type: 'password', placeholder: '导入加密备份时填写原密码', autocomplete: 'off' });
    R.backupExportBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('save'), el('span', { text: '导出备份' }));
    R.backupImportBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('upload'), el('span', { text: '导入恢复' }));
    R.backupExportBtn.addEventListener('click', backupExport);
    R.backupImportBtn.addEventListener('click', backupImport);
    R.backupFeedback = el('div', { class: 'backup-feedback hidden' });
    R.backupScopeNote = el('div', { class: 'field__hint', text: '备份包含：生命 / 成长 / 专注 / 外观 / 情侣资料；不包含许可证密钥与支付信息。' });

    sec.appendChild(
      el(
        'div',
        { class: 'card' },
        cardHead('本地导出 / 导入', '导出成 JSON 文件，换电脑或重装时双击导入即可恢复。', 'save'),
        el(
          'div',
          { class: 'ai-grid' },
          el(
            'div',
            { class: 'field' },
            el('label', { class: 'field__label' }, icon('save'), el('span', { text: '导出' })),
            R.backupPwd,
            el('div', { class: 'row', style: { gap: '8px', marginTop: '10px', alignItems: 'center' } }, R.backupExportBtn),
            el('div', { class: 'field__hint', text: '填了密码会加密导出，忘记密码将无法恢复。' }),
          ),
          el(
            'div',
            { class: 'field' },
            el('label', { class: 'field__label' }, icon('upload'), el('span', { text: '导入' })),
            R.backupImportPwd,
            el('div', { class: 'row', style: { gap: '8px', marginTop: '10px', alignItems: 'center' } }, R.backupImportBtn),
            el('div', { class: 'field__hint', text: '导入会覆盖当前数据，建议先导出一份当前的备份。' }),
          ),
        ),
        R.backupFeedback,
        R.backupScopeNote,
      ),
    );

    // ---- 云同步
    R.syncPwd = el('input', { class: 'input', type: 'password', placeholder: '同步密码（≥6 位，客户端加密后上传）', autocomplete: 'new-password' });
    R.syncSaveBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('shield'), el('span', { text: '保存密码' }));
    R.syncSaveBtn.addEventListener('click', async () => {
      const password = (R.syncPwd && R.syncPwd.value) || '';
      if (password.length < 6) {
        backupFeedback('同步密码至少 6 位', 'err');
        return;
      }
      const ok = await save({ backupSyncPassword: password });
      if (ok) {
        R.syncPwd.value = '';
        backupFeedback('同步密码已保存（用系统密钥库加密后只保存在本机，用于加解密云端备份）', 'ok');
      } else {
        backupFeedback('保存失败：当前版本尚未支持同步密码设置，请更新应用后再试。', 'err');
      }
    });
    R.syncPushBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('cloud'), el('span', { text: '上传到云端' }));
    R.syncPullBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('download'), el('span', { text: '从云端恢复' }));
    R.syncDeleteBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('trash'), el('span', { text: '清空云端备份' }));
    R.syncPushBtn.addEventListener('click', () => syncAction('push', { password: (R.syncPwd && R.syncPwd.value) || undefined }));
    R.syncPullBtn.addEventListener('click', () => syncAction('pull', {}));
    R.syncDeleteBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '清空云端备份？',
        desc: '云端只保存加密后的备份，清空后无法恢复。本机数据不受影响。',
        confirmLabel: '清空云端',
        cancelLabel: '保留',
        danger: true,
      });
      if (!ok) return;
      await syncAction('delete', {});
    });
    R.syncAutoSwitch = makeSwitch(true, async (on) => {
      const ok = await save({ backupAutoSync: on });
      if (ok) toast(on ? '已开启自动同步（每天一次）' : '已关闭自动同步', 'ok');
      else {
        setSwitch(R.syncAutoSwitch, !on);
        toast('自动同步设置保存失败，请更新应用后再试', 'err');
      }
    });
    R.syncMeta = el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '2px' } });
    R.syncSecurityHint = el('div', { class: 'field__error hidden' });
    R.syncNotice = el('div', { class: 'notice notice--warn' }, icon('info'), el('div', { class: 'notice__body', text: '云同步服务即将开放：本轮请使用本地导出/导入备份，云端接口就绪后即可一键恢复（服务端只保存加密后的密文）。' }));

    sec.appendChild(
      el(
        'div',
        { class: 'card' },
        cardHead('云同步（可选）', '用同步密码加密后上传，服务端只存密文，解不开也看不懂。', 'cloud'),
        R.syncNotice,
        el(
          'div',
          { class: 'field' },
          el('label', { class: 'field__label' }, icon('shield'), el('span', { text: '同步密码' })),
          el('div', { class: 'row', style: { gap: '8px' } }, R.syncPwd, R.syncSaveBtn),
          el('div', { class: 'field__hint', text: '至少 6 位。密码用系统密钥库加密后只保存在本机；换设备恢复时需要同一个密码。' }),
          R.syncSecurityHint,
        ),
        el(
          'div',
          { class: 'row', style: { gap: '8px', marginTop: '14px', flexWrap: 'wrap', alignItems: 'center' } },
          R.syncPushBtn,
          R.syncPullBtn,
          R.syncDeleteBtn,
          el('div', { class: 'row-item__ctrl', style: { marginLeft: 'auto' } }, el('span', { class: 'tiny dim', text: '自动同步' }), R.syncAutoSwitch),
        ),
        R.syncMeta,
      ),
    );

    // ---- 数据范围说明
    sec.appendChild(
      el(
        'div',
        { class: 'notice notice--info' },
        icon('info'),
        el(
          'div',
          { class: 'notice__body' },
          el('div', { class: 'h4', style: { color: '#b9f2ea' }, text: '备份里有什么？' }),
          el('div', {
            class: 'small',
            text: '生命状态与心情、成长与亲密度、专注记录、外观与皮肤选择、情侣资料。不包含：许可证密钥、支付信息、设备指纹。备份随时可以自己删除。',
          }),
        ),
      ),
    );

    updateBackup = function (state) {
      if (!state) return;
      const settings = state.settings || {};
      if (R.syncAutoSwitch) setSwitch(R.syncAutoSwitch, settings.backupAutoSync !== false);
      const entitled = app.isPro || can('skins_premium');
      for (const btn of [R.syncPushBtn, R.syncPullBtn, R.syncDeleteBtn]) if (btn) btn.disabled = !entitled;
      if (!entitled && R.syncMeta) {
        R.syncMeta.appendChild(el('span', { class: 'badge badge--locked' }, icon('lock'), el('span', { text: '云同步需要完整版或 AI 订阅' })));
      }
      // 安全存储不可用时：同步密码不落盘，重启后需重新输入
      const pwdDegraded = settings.backupPasswordSet === true && settings.backupPasswordEncrypted === false;
      if (R.syncSecurityHint) {
        R.syncSecurityHint.classList.toggle('hidden', !pwdDegraded);
        if (pwdDegraded) {
          clear(R.syncSecurityHint);
          R.syncSecurityHint.appendChild(icon('warning'));
          R.syncSecurityHint.appendChild(el('span', { text: '当前系统不支持安全存储，同步密码不会保存到磁盘，重启后需要重新输入。' }));
        }
      }
    };

    loadBackupInfo();
  }
  // =============================================================== 系统
  let updateSystem = null;

  function buildSystem() {
    const sec = document.getElementById('sec-system');
    sec.appendChild(sectionHead('系统', '位置重置、多宠物、许可服务地址与恢复出厂设置。'));

    // ---- 桌宠
    R.resetPosBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('rotate-ccw'), el('span', { text: '重置位置' }));
    R.resetPosBtn.addEventListener('click', async () => {
      const res = await app.invoke(IPC.PET_RESET_POSITION, {});
      if (res && res.ok) toast('方块仔已回到屏幕右下角', 'ok');
      else toast('重置位置失败', 'err');
    });

    R.countHost = el('div', { class: 'count-picker' });
    R.countButtons = [];
    for (const n of [1, 2, 3]) {
      const chip = el('button', { class: 'count-chip', type: 'button', dataset: { count: String(n) } }, el('span', { text: String(n) }));
      chip.addEventListener('click', async () => {
        const res = await app.invoke(IPC.MULTI_PET_SET, { count: n });
        if (res && res.ok) {
          toast(n === 1 ? '已恢复单只方块仔' : `现在有 ${n} 只方块仔同屏`, 'ok');
          await app.refresh();
        } else if (res && res.code !== 'FEATURE_LOCKED') {
          toast(res.message || '设置失败', 'err');
        }
      });
      R.countButtons.push({ n, chip });
      R.countHost.appendChild(chip);
    }

    const petCard = el(
      'div',
      { class: 'card' },
      cardHead('桌面宠物', '方块仔默认坐在屏幕右下角，可爱但不挡事。', 'monitor'),
      rowItem({
        title: '宠物位置',
        desc: '如果它跑到看不见的地方，可以一键重置回右下角。',
        iconName: 'target',
        ctrl: R.resetPosBtn,
      }).el,
      rowItem({
        title: '多宠物同屏',
        desc: '同时养最多 3 只方块仔，一起在桌面上晃。',
        iconName: 'users',
        ctrl: R.countHost,
        extra: (R.multiLock = lockNote('Pro')),
      }).el,
    );
    sec.appendChild(petCard);

    // ---- 高级：API 地址
    R.apiInput = el('input', {
      class: 'input',
      type: 'text',
      placeholder: 'http://127.0.0.1:8787',
      spellcheck: 'false',
    });
    R.apiSaveBtn = el('button', { class: 'btn', type: 'button' }, icon('check'), el('span', { text: '保存' }));
    R.apiResetBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, el('span', { text: '恢复默认' }));
    R.apiHint = el('div', { class: 'field__hint', text: '许可服务地址；自托管或私有部署时可修改。保存后立即生效（若服务不可达，商店会显示离线）。' });
    R.showFpsSwitch = makeSwitch(false, async (on) => {
      const ok = await save({ showFps: on });
      if (!ok) setSwitch(R.showFpsSwitch, !on);
    });

    R.advancedBody = el(
      'div',
      { class: 'advanced__body' },
      el('div', { class: 'api-row' }, R.apiInput, R.apiSaveBtn, R.apiResetBtn),
      R.apiHint,
      rowItem({ title: '显示帧率', desc: '在桌宠窗口左上角显示 FPS，用于性能排查。', iconName: 'chart', ctrl: R.showFpsSwitch }).el,
    );
    R.advancedBody.classList.add('hidden');
    R.advancedChev = icon('chevron-down');
    R.advancedChev.classList.add('advanced__chev');
    const advancedHead = el(
      'button',
      { class: 'advanced__head', type: 'button', 'aria-expanded': 'false' },
      icon('sliders'),
      el('span', { text: '高级设置' }),
      el('span', { class: 'small dim', text: 'API 地址 · 帧率' }),
      R.advancedChev,
    );
    R.advanced = el('div', { class: 'advanced' }, advancedHead, R.advancedBody);
    advancedHead.addEventListener('click', () => {
      const open = !R.advanced.classList.contains('is-open');
      R.advanced.classList.toggle('is-open', open);
      R.advancedBody.classList.toggle('hidden', !open);
      advancedHead.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    R.apiSaveBtn.addEventListener('click', async () => {
      const value = R.apiInput.value.trim();
      if (value && !/^https?:\/\//i.test(value)) {
        toast('API 地址需要以 http:// 或 https:// 开头', 'err', 3600);
        return;
      }
      const ok = await save({ apiBase: value }, value ? '已保存许可服务地址' : '已恢复默认许可服务地址');
      if (ok) {
        R.apiInput.value = (app.state && app.state.ui && app.state.ui.apiBase) || '';
        toast('商店与授权页会重新检测服务状态', 'info', 3200);
      }
    });
    R.apiResetBtn.addEventListener('click', async () => {
      const ok = await save({ apiBase: '' }, '已恢复默认许可服务地址');
      if (ok) R.apiInput.value = (app.state && app.state.ui && app.state.ui.apiBase) || '';
    });

    // ---- 危险区
    R.resetAllBtn = el('button', { class: 'btn btn--danger btn--sm', type: 'button' }, icon('trash'), el('span', { text: '重置所有设置' }));
    R.resetAllBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '恢复默认设置？',
        desc: '皮肤、大小、配色、快捷键与专注偏好都会恢复出厂值。专注统计与成长数据不会被删除。',
        confirmLabel: '恢复默认',
        cancelLabel: '取消',
        danger: true,
      });
      if (!ok) return;
      const res = await app.invoke(IPC.APP_SETTINGS_RESET, {});
      if (res && res.ok) {
        toast('已恢复默认设置', 'ok');
        await app.refresh();
      } else {
        toast('重置失败，请稍后重试', 'err');
      }
    });

    R.quitBtn = el('button', { class: 'btn btn--danger btn--sm', type: 'button' }, icon('power'), el('span', { text: '退出应用' }));
    R.quitBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '退出 方块仔？',
        desc: '方块仔会离开桌面。下次可以从开始菜单或桌面快捷方式再次唤醒它。',
        confirmLabel: '退出',
        cancelLabel: '再看看',
        danger: true,
      });
      if (!ok) return;
      try {
        if (app.panel && app.panel.quit) await app.panel.quit();
        else app.close();
      } catch (err) {
        console.warn('[quit]', err);
      }
    });

    sec.appendChild(
      el('div', { class: 'card' }, cardHead('许可服务', '只在购买/激活时需要联网；已激活后离线也能用。', 'globe'), R.advanced),
    );

    const dangerCard = el(
      'div',
      { class: 'card' },
      cardHead('重置与退出', '', 'warning'),
      rowItem({
        title: '重置所有设置',
        desc: '恢复出厂外观与行为设置，不会删除统计与成长数据。',
        iconName: 'rotate-ccw',
        ctrl: R.resetAllBtn,
      }).el,
      rowItem({
        title: '退出 方块仔',
        desc: '完全关闭应用与托盘图标。',
        iconName: 'power',
        ctrl: R.quitBtn,
      }).el,
    );
    sec.appendChild(dangerCard);

    updateSystem = function (state) {
      if (!state) return;
      const settings = state.settings || {};
      const multi = clamp(Number(settings.multiPetCount) || 1, 1, 3);
      const multiAllowed = can('multi_pet');
      for (const item of R.countButtons) {
        item.chip.classList.toggle('is-active', item.n === multi);
        const old = item.chip.querySelector('.count-chip__lock');
        if (old) old.remove();
        if (item.n > 1 && !multiAllowed) {
          item.chip.appendChild(el('span', { class: 'count-chip__lock' }, icon('lock')));
        }
      }
      if (R.multiLock) R.multiLock.style.display = multiAllowed ? 'none' : 'inline-flex';
      const apiBase = (state.ui && state.ui.apiBase) || '';
      if (document.activeElement !== R.apiInput) R.apiInput.value = apiBase;
      setSwitch(R.showFpsSwitch, settings.showFps);
    };
  }

  // =============================================================== 关于
  let updateAbout = null;

  function buildAbout() {
    const sec = document.getElementById('sec-about');
    sec.appendChild(sectionHead('关于', '版本、许可状态与法务信息。'));

    R.aboutVersion = el('span', { text: '' });
    R.aboutHero = el(
      'div',
      { class: 'about-hero' },
      el('div', { class: 'about-logo' }, icon('cube')),
      el(
        'div',
        { class: 'grow' },
        el('div', { class: 'about-name' }, el('span', { text: '方块仔' }), el('span', { text: 'Cubbit' })),
        el('div', { class: 'about-tag', text: '一只住在你桌面上的小方块。' }),
        el('div', { class: 'row mt-8', style: { gap: '8px' } }, R.aboutVersion),
      ),
    );
    sec.appendChild(R.aboutHero);

    R.aboutLicBadge = el('div', {});
    R.aboutLicMeta = el('div', { class: 'small muted', text: '' });
    R.aboutDevice = el('span', { text: '—' });
    R.aboutManageBtn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('shield'), el('span', { text: '管理授权' }));
    R.aboutManageBtn.addEventListener('click', () => app.openPanel('store'));

    const licCard = el(
      'div',
      { class: 'card' },
      cardHead('许可状态', '', 'shield'),
      el(
        'div',
        { class: 'row', style: { justifyContent: 'space-between', gap: '12px' } },
        el('div', { class: 'row', style: { gap: '10px' } }, R.aboutLicBadge, R.aboutLicMeta),
        R.aboutManageBtn,
      ),
      el('div', { class: 'divider' }),
      el(
        'div',
        { class: 'row', style: { justifyContent: 'space-between', gap: '12px' } },
        el('div', { class: 'small dim', text: '本机设备 ID' }),
        el('div', { class: 'row', style: { gap: '8px' } }, R.aboutDevice, (() => {
          const b = el('button', { class: 'btn btn--sm btn--icon', type: 'button', title: '复制设备 ID' }, icon('copy'));
          b.addEventListener('click', async () => {
            const id = (app.state && app.state.license && app.state.license.deviceId) || '';
            const ok = await UI.copyText(id);
            toast(ok ? '设备 ID 已复制' : '复制失败', ok ? 'ok' : 'err');
          });
          return b;
        })()),
      ),
    );
    sec.appendChild(licCard);

    // 链接
    const mkLink = (label, iconName, handler) => {
      const btn = el('button', { class: 'btn btn--sm', type: 'button' }, icon(iconName), el('span', { text: label }));
      btn.addEventListener('click', handler);
      return btn;
    };
    R.websiteBtn = mkLink('产品官网', 'globe', () => {
      const url = (app.state && app.state.product && app.state.product.website) || 'https://pingguye.cn/cubbit/';
      app.openExternal(url);
    });
    R.supportBtn = mkLink('联系支持', 'mail', async () => {
      const email = (app.state && app.state.product && app.state.product.supportEmail) || '';
      const contact = email || 'https://paypal.me/pinggu80';
      const ok = await UI.copyText(contact);
      const what = email ? `支持邮箱 ${email}` : '联系方式（PayPal 付款备注留言）paypal.me/pinggu80';
      toast(ok ? `${what} 已复制` : what, ok ? 'ok' : 'info', 3800);
    });
    R.eulaBtn = mkLink('许可协议', 'receipt', () => UI.legalModal('eula'));
    R.privacyBtn = mkLink('隐私政策', 'shield', () => UI.legalModal('privacy'));
    R.refundBtn = mkLink('退款政策', 'rotate-ccw', () => UI.legalModal('refund'));
    R.updateBtn = mkLink('检查更新', 'download', async () => {
      const version = (app.state && app.state.product && app.state.product.version) || '';
      let st = null;
      try { st = await app.invoke(IPC.UPDATE_CHECK, { manual: true }); } catch { st = null; }
      if (st && st.available && st.latest) {
        const url = st.latest.url || 'https://pingguye.cn/cubbit/dl/windows/latest';
        const m = modal({
          title: `发现新版本 v${st.latest.version}`,
          desc: `当前版本 v${version}。点「下载新版」会用浏览器下载安装包，下载后双击安装即可（设置和数据会保留）。`,
          iconName: 'download',
          actions: [
            { label: '稍后', kind: 'ghost', value: false },
            { label: '下载新版', kind: 'primary', value: true, autofocus: true },
          ],
        });
        if (m && m.result && (await m.result)) app.openExternal(url);
        return;
      }
      if (!st || st.error) {
        modal({
          title: '暂时无法检查更新',
          desc: `当前版本 v${version}。请稍后再试，或到官网 pingguye.cn/cubbit 查看最新版本。`,
          iconName: 'warning',
          actions: [{ label: '知道了', kind: 'primary', value: true, autofocus: true }],
        });
        return;
      }
      modal({
        title: '已经是最新版本',
        desc: `当前版本 v${version}，你正在使用最新的 方块仔。`,
        iconName: 'check-circle',
        actions: [{ label: '知道了', kind: 'primary', value: true, autofocus: true }],
      });
    });

    sec.appendChild(
      el(
        'div',
        { class: 'card' },
        cardHead('支持与法务', '所有条款都内置在应用里，离线也能查看。', 'receipt'),
        el('div', { class: 'about-actions' }, R.websiteBtn, R.supportBtn, R.updateBtn),
        el('div', { class: 'divider' }),
        el('div', { class: 'about-links' }, R.eulaBtn, R.privacyBtn, R.refundBtn),
      ),
    );

    R.aboutFoot = el('div', { class: 'small dim center mt-16', text: '© 2026 方块仔 · 个人开发者 叶永平' });
    sec.appendChild(R.aboutFoot);

    updateAbout = function (state) {
      if (!state) return;
      const product = state.product || {};
      const lic = state.license || {};
      R.aboutVersion.textContent = `v${product.version || '1.0.0'}`;
      clear(R.aboutLicBadge);
      R.aboutLicBadge.appendChild(UI.licenseBadgeNode(lic, state.ui));
      let meta = '';
      if (lic.state === 'pro') meta = lic.expiresAt ? `有效期至 ${formatDate(lic.expiresAt)}` : '永久授权';
      else if (lic.state === 'trial') meta = `体验期还剩 ${lic.trialDaysLeft || 0} 天，到期后自动回到免费版`;
      else meta = '升级 Pro 解锁全部功能';
      R.aboutLicMeta.textContent = meta;
      R.aboutDevice.textContent = shortId(lic.deviceId || '', 8, 8);
    };
  }

  // =============================================================== 装配
  function mountSections() {
    // 每个分区独立 try/catch：任何一个出错都不再拖垮其余分区（2026-11-05 修复大小/配色失效）
    for (const fn of [buildAppearance, buildInteraction, buildFocus, buildGrowth, buildCouple, buildLife, buildAi, buildBackup, buildSystem, buildAbout]) {
      try { fn(); } catch (err) { console.warn('[settings] section failed:', fn.name, err && err.message); }
    }
  }
})();
