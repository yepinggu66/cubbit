/* ============================================================================
 * Cubbit 情侣模式面板
 *
 * 三种视图：未配对（双栏邀请）/ 已配对（伴侣卡 + 聊天 + 婚礼&情话侧栏）/ 未解锁
 * 所有状态来自 state.couple（主进程），操作走 couple:* IPC。
 * 服务不可用时只降级提示 + 重试，不白屏、不清空本地界面。
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
  const formatClock = UI.formatClock;
  const formatDuration = UI.formatDuration;
  const formatDateTime = UI.formatDateTime;

  const app = UI.createApp();

  const QUICK_PHRASES = ['早安', '晚安', '想你', '抱抱', '亲亲', '辛苦了', '吃饭了吗'];
  const LOVE_PRESETS = ['今天也要开开心心的', '在想你，也想你的方块仔', '辛苦了，抱一个'];
  const MAX_CHAT = 200;
  const MAX_LOVE = 140;

  const S = {
    state: null,
    couple: null,
    view: 'unpaired',
    // 邀请
    createState: 'idle', // idle | creating | ready | expired
    code: '',
    codeExpiresAt: 0,
    countdownTimer: null,
    waitingPollTimer: null,
    joinBusy: false,
    joinError: '',
    // 聊天
    chatDraft: '',
    sending: false,
    pairedPollTimer: null,
    // 情话
    loveDraft: '',
    loveBusy: false,
    // 求婚
    proposalModalOpen: false,
    declinedProposal: false,
    proposeBusy: false,
    // 其他
    retryBusy: false,
    unpairBusy: false,
  };

  const R = {};

  document.addEventListener('DOMContentLoaded', init);

  // =============================================================== 启动
  async function init() {
    mountTitlebar();
    buildUnpaired();
    buildPaired();
    fillStaticIcons();
    app.onState((state) => {
      S.state = state;
      renderAll();
    });
    await app.boot({});
    mountRoomEntry();
    renderAll();
  }

  /** 把 HTML 里 data-icon 占位换成内联 SVG */
  function fillStaticIcons() {
    for (const node of UI.$$('[data-icon]')) {
      const name = node.getAttribute('data-icon');
      clear(node);
      node.appendChild(icon(name));
    }
  }

  function mountTitlebar() {
    const { bar, rightSlot } = UI.mountTitlebar(app, { page: '情侣模式', brandSub: false });
    R.badgeHost = el('div', { class: 'row', style: { gap: '8px' } });
    rightSlot.insertBefore(R.badgeHost, rightSlot.firstChild);
    document.getElementById('titlebar-host').appendChild(bar);
    document.title = '方块仔 · 情侣模式';
  }

  // =============================================================== 状态判断
  function coupleFeatureOn() {
    const state = S.state || {};
    if (state.ui && state.ui.isPro) return true;
    const features = (state.license && state.license.features) || {};
    return !!features.couple_mode;
  }

  function serviceOnline() {
    const c = S.couple;
    if (!c) return false;
    return c.serverOnline !== false;
  }

  function currentCouple() {
    const state = S.state || {};
    return state.couple || null;
  }

  // =============================================================== 渲染调度
  function renderAll() {
    renderBadge();
    const couple = currentCouple();
    // 主进程尚未提供 state.couple 时，用一份「未联网」的占位，保证不白屏
    S.couple = couple || {
      enabled: false,
      serverOnline: false,
      error: '情侣服务暂不可用',
      messages: [],
      dailyLove: { sent: false, text: '', at: 0 },
      pendingProposal: false,
      proposalFrom: null,
    };

    renderNotice(couple);
    const pro = coupleFeatureOn();
    const view = !pro ? 'locked' : S.couple.enabled ? 'paired' : 'unpaired';
    if (view !== S.view) {
      S.view = view;
      if (view !== 'unpaired') stopUnpairedTimers();
      if (view !== 'paired') stopPairedPoll();
    }
    document.getElementById('viewLocked').classList.toggle('hidden', view !== 'locked');
    document.getElementById('viewUnpaired').classList.toggle('hidden', view !== 'unpaired');
    document.getElementById('viewPaired').classList.toggle('hidden', view !== 'paired');

    if (view === 'locked') renderLocked();
    else if (view === 'paired') {
      renderPartner();
      renderMessages();
      renderWedding();
      renderLove();
      startPairedPoll();
    } else {
      renderCreate();
      renderJoinState();
      renderUnpairedDisabled();
    }

    maybeShowProposal();
  }

  function renderBadge() {
    if (!R.badgeHost || !S.state) return;
    clear(R.badgeHost);
    R.badgeHost.appendChild(UI.licenseBadgeNode(S.state.license || {}, S.state.ui));
  }

  function topNotice(node, kind) {
    if (!node) return;
  }

  function renderNotice(couple) {
    const host = document.getElementById('coupleNotice');
    clear(host);
    if (!couple) {
      host.appendChild(offlineNotice('配对与聊天需要连接情侣服务；桌面上的方块仔不受影响，恢复后会自动重连。'));
      return;
    }
    if (couple.serverOnline === false || couple.error) {
      host.appendChild(
        offlineNotice(couple.error || '配对与聊天需要连接情侣服务；桌面上的方块仔不受影响，恢复后会自动重连。'),
      );
    }
  }

  function offlineNotice(text) {
    const notice = el(
      'div',
      { class: 'notice' },
      icon('wifi-off'),
      el(
        'div',
        { class: 'notice__body' },
        el('div', { class: 'h4', style: { color: '#ffc0c0' }, text: '情侣服务暂不可用' }),
        el('div', { class: 'small', text: String(text || '请检查网络后重试') }),
      ),
    );
    const btn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('refresh'), el('span', { text: '重试' }));
    btn.addEventListener('click', retryService);
    notice.appendChild(btn);
    return notice;
  }

  async function retryService() {
    if (S.retryBusy) return;
    S.retryBusy = true;
    const res = await app.invoke(IPC.COUPLE_RETRY, {}, { gate: false });
    S.retryBusy = false;
    if (res && res.ok) {
      toast('已重新连接情侣服务', 'ok');
      if (res.couple) S.couple = res.couple;
      await app.refresh();
      renderAll();
    } else {
      toast((res && res.message) || '仍然无法连接情侣服务', 'err', 4200);
    }
  }

  // =============================================================== 未解锁
  function renderLocked() {
    const host = document.getElementById('viewLocked');
    if (!host.firstChild) {
      const wrap = el(
        'div',
        { class: 'locked-hero' },
        el(
          'div',
          { class: 'locked-hero__art' },
          el('div', { class: 'locked-hero__ring' }, icon('ring')),
        ),
        el('div', { class: 'h2', text: '情侣模式是 Pro 功能' }),
        el('div', {
          class: 'muted',
          style: { fontSize: '12.5px', lineHeight: '1.7', maxWidth: '360px' },
          text: '两台电脑各自解锁 Pro 后，就能让两只方块仔配对：互道早安晚安、说情话、举行婚礼，并记住你们的纪念日。',
        }),
        el(
          'div',
          { class: 'row', style: { gap: '10px', marginTop: '4px' } },
          (() => {
            const b = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '查看 Pro 方案' }));
            b.addEventListener('click', () => app.openPanel('store'));
            return b;
          })(),
          (() => {
            const b = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('timer'), el('span', { text: '先体验 7 天' }));
            b.addEventListener('click', async () => {
              const res = await app.invoke(IPC.LICENSE_START_TRIAL, {}, { gate: false });
              if (res && res.ok) {
                toast('体验已开启，情侣模式解锁', 'ok');
                await app.refresh();
              } else {
                toast((res && res.message) || '开启体验失败', 'err', 3600);
              }
            });
            return b;
          })(),
        ),
      );
      host.appendChild(wrap);
    }
  }

  // =============================================================== 未配对
  function buildUnpaired() {
    document.getElementById('createIconTile').appendChild(icon('link'));
    document.getElementById('joinIconTile').appendChild(icon('keyboard'));

    R.createBody = document.getElementById('createBody');
    R.joinBody = document.getElementById('createJoin');

    // 输入 TA 的邀请码：6 个单格输入
    R.joinError = el('div', { class: 'join-error' });
    R.joinCells = [];
    const cells = el('div', { class: 'join-cells', id: 'joinCells' });
    for (let i = 0; i < 6; i++) {
      const cell = el('input', {
        class: 'join-cell',
        type: 'text',
        inputmode: 'numeric',
        maxlength: '1',
        autocomplete: 'off',
        'aria-label': `邀请码第 ${i + 1} 位`,
      });
      cell.addEventListener('input', () => onJoinCellInput(i));
      cell.addEventListener('keydown', (event) => onJoinCellKey(i, event));
      cell.addEventListener('paste', (event) => onJoinPaste(event, i));
      R.joinCells.push(cell);
      cells.appendChild(cell);
    }
    R.joinBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('heart'), el('span', { text: '加入情侣空间' }));
    R.joinBtn.addEventListener('click', doJoin);

    R.joinBody.appendChild(cells);
    R.joinBody.appendChild(R.joinError);
    R.joinBody.appendChild(el('div', { class: 'join-actions' }, R.joinBtn));
    R.joinBody.appendChild(
      el(
        'div',
        { class: 'create-hint' },
        icon('info'),
        el('span', { text: '输入完 6 位会自动就绪，也可以直接粘贴整串码' }),
      ),
    );
  }

  function onJoinCellInput(index) {
    const cell = R.joinCells[index];
    const digits = String(cell.value || '').replace(/\D/g, '');
    cell.value = digits.slice(-1);
    cell.classList.toggle('is-filled', !!cell.value);
    R.joinError.textContent = '';
    if (cell.value && index < R.joinCells.length - 1) R.joinCells[index + 1].focus();
    updateJoinBtn();
  }

  function onJoinCellKey(index, event) {
    if (event.key === 'Backspace' && !R.joinCells[index].value && index > 0) {
      R.joinCells[index - 1].focus();
      R.joinCells[index - 1].value = '';
      R.joinCells[index - 1].classList.remove('is-filled');
      updateJoinBtn();
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      R.joinCells[index - 1].focus();
      event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < R.joinCells.length - 1) {
      R.joinCells[index + 1].focus();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      doJoin();
    }
  }

  function onJoinPaste(event, index) {
    const text = (event.clipboardData || window.clipboardData).getData('text') || '';
    const digits = text.replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    fillJoinCells(digits, index);
  }

  function fillJoinCells(digits, startIndex) {
    let cursor = startIndex;
    for (const ch of digits) {
      if (cursor >= R.joinCells.length) break;
      R.joinCells[cursor].value = ch;
      R.joinCells[cursor].classList.add('is-filled');
      cursor += 1;
    }
    const next = Math.min(cursor, R.joinCells.length - 1);
    R.joinCells[next].focus();
    updateJoinBtn();
  }

  function joinCodeValue() {
    return R.joinCells.map((c) => c.value || '').join('');
  }

  function updateJoinBtn() {
    const value = joinCodeValue();
    R.joinBtn.disabled = value.length !== 6 || S.joinBusy || !serviceOnline();
  }

  function renderUnpairedDisabled() {
    const online = serviceOnline();
    if (R.createBtn) R.createBtn.disabled = !online || S.createState === 'creating';
    if (R.joinBtn) R.joinBtn.disabled = joinCodeValue().length !== 6 || S.joinBusy || !online;
    for (const cell of R.joinCells) cell.disabled = !online;
  }

  function renderCreate() {
    const online = serviceOnline();
    clear(R.createBody);
    R.createBtn = null;

    if (S.createState === 'ready' && S.code) {
      R.createBody.appendChild(buildCodeGrid(S.code));
      R.createBody.appendChild(
        el(
          'div',
          { class: 'code-timer' },
          icon('timer'),
          el('span', { text: '邀请码有效剩余' }),
          (R.codeTimerText = el('strong', { text: formatDuration(Math.max(0, S.codeExpiresAt - Date.now())) })),
        ),
      );
      const copyBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('copy'), el('span', { text: '复制邀请码' }));
      copyBtn.addEventListener('click', async () => {
        const ok = await UI.copyText(S.code);
        toast(ok ? '邀请码已复制，发给 TA 吧' : '复制失败，请手动输入', ok ? 'ok' : 'err');
      });

      // 二维码：编码 cubbit:// 深链（不消耗邀请码，扫不到也不会误占）
      const qrSvg = buildQrSvg('cubbit://pair?code=' + S.code);
      if (qrSvg) {
        R.createBody.appendChild(
          el(
            'div',
            { class: 'pair-qr' },
            qrSvg,
            el('div', { class: 'pair-qr__hint', text: '截图发给 TA 也行；最省事的还是点下面「复制邀请信息」整段发过去' }),
          ),
        );
      }
      // 待配对邀请链接：对方点开自动填码
      const link = inviteLink(S.code);
      R.inviteLinkInput = el('input', { class: 'input invite-link__input', type: 'text', readonly: 'readonly', value: link, 'aria-label': '待配对邀请链接' });
      const copyLinkBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('link'), el('span', { text: '复制邀请链接' }));
      copyLinkBtn.addEventListener('click', async () => {
        const ok = await UI.copyText(link);
        toast(ok ? '邀请链接已复制，发给 TA 即可' : '复制失败，请手动选中复制', ok ? 'ok' : 'err', 3200);
      });
      R.createBody.appendChild(
        el(
          'div',
          { class: 'invite-link-box' },
          el('div', { class: 'invite-link__head' }, icon('link'), el('span', { text: '待配对邀请链接' })),
          el('div', { class: 'invite-link__row' }, R.inviteLinkInput, copyLinkBtn),
          el('div', { class: 'create-hint', text: '对方点开链接会自动填好这串邀请码，10 分钟内有效。' }),
        ),
      );
      const cancelBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, el('span', { text: '取消' }));
      cancelBtn.addEventListener('click', () => {
        resetInvite();
        renderCreate();
      });
      const msgBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('chat'), el('span', { text: '复制邀请信息' }));
      msgBtn.addEventListener('click', async () => {
        const ok = await UI.copyText(inviteMessage(S.code));
        toast(ok ? '整段邀请信息已复制，直接发给 TA' : '复制失败，请手动选中', ok ? 'ok' : 'err', 3200);
      });
      R.createBody.appendChild(el('div', { class: 'code-actions' }, msgBtn, copyBtn, cancelBtn));
      R.createBody.appendChild(
        el(
          'div',
          { class: 'create-hint' },
          el('span', { class: 'waiting-dots' }, el('span'), el('span'), el('span')),
          el('span', { text: '等待 TA 输入邀请码…配对成功后会自动进入' }),
        ),
      );
      startCountdown();
      startWaitingPoll();
      return;
    }

    if (S.createState === 'expired') {
      R.createBody.appendChild(
        el(
          'div',
          { class: 'invite-empty' },
          buildPairArt(),
          el('div', { class: 'invite-empty__text', text: '邀请码已过期。没关系，重新生成一个就好。' }),
        ),
      );
      R.createBtn = el('button', { class: 'btn btn--primary', type: 'button' }, icon('refresh'), el('span', { text: '重新生成邀请码' }));
      R.createBtn.addEventListener('click', createInvite);
      R.createBody.appendChild(el('div', { class: 'code-actions' }, R.createBtn));
      R.createBtn.disabled = !online;
      return;
    }

    R.createBody.appendChild(
      el(
        'div',
        { class: 'invite-empty' },
        buildPairArt(),
        el('div', { class: 'invite-empty__text', text: '生成 6 位邀请码或一条邀请链接，发给 TA。' }),
      ),
    );
    R.createBtn = el(
      'button',
      { class: 'btn btn--primary', type: 'button' },
      icon('link'),
      el('span', { text: S.createState === 'creating' ? '正在生成…' : '生成邀请码' }),
    );
    R.createBtn.addEventListener('click', createInvite);
    R.createBtn.disabled = !online || S.createState === 'creating';
    R.createBody.appendChild(el('div', { class: 'code-actions' }, R.createBtn));
    R.createBody.appendChild(
      el('div', { class: 'create-hint' }, icon('shield'), el('span', { text: '邀请码 10 分钟内有效，只能使用一次' })),
    );
    if (!online) {
      R.createBody.appendChild(el('div', { class: 'create-hint' }, el('span', { text: '情侣服务离线中，暂时无法生成' })));
    }
  }

  function buildPairArt() {
    const art = el(
      'div',
      { class: 'invite-empty__art' },
      el('div', { class: 'invite-empty__heart' }, icon('heart')),
      el('div', { class: 'mini-cube mini-cube--a' }),
      el('div', { class: 'mini-cube mini-cube--b' }),
    );
    return art;
  }

  function buildCodeGrid(code) {
    const grid = el('div', { class: 'code-grid', 'aria-label': '邀请码' });
    for (const ch of String(code)) grid.appendChild(el('div', { class: 'code-cell', text: ch }));
    return grid;
  }

  /** 邀请二维码：把 cubbit:// 深链画成 SVG（qrcode-generator，MIT）。
   *  只读展示，不触发任何配对动作；库缺失时返回 null，面板正常降级。 */
  function buildQrSvg(text) {
    if (typeof window.qrcode !== 'function' || !text) return null;
    let qr = null;
    try {
      qr = window.qrcode(0, 'M');
      qr.addData(String(text));
      qr.make();
    } catch (err) {
      console.warn('[couple] qr failed', err && err.message);
      return null;
    }
    const count = qr.getModuleCount();
    const scale = 5;
    const quiet = 2;
    const size = (count + quiet * 2) * scale;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'pair-qr__svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '配对二维码');
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(size));
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (!qr.isDark(r, c)) continue;
        const x = (c + quiet) * scale;
        const y = (r + quiet) * scale;
        d += 'M' + x + ' ' + y + 'h' + scale + 'v' + scale + 'h-' + scale + 'z';
      }
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#14161a');
    svg.appendChild(path);
    return svg;
  }

  /** 一段可以直接转发的邀请信息：下载入口 + 3 步 + 邀请码 */
  function inviteMessage(code) {
    const cfg = window.CubbitLiteConfig || {};
    const download = cfg.downloadUrl || 'https://cubbit.app/download';
    return [
      '我在用「方块仔」，一只住在桌面上的小方块。你也装一个，我们俩的方块仔就能互相看见。',
      '',
      '1）下载（Windows 10/11）：' + download,
      '2）装好打开，右键它 →「💞 我们俩」→ 输入邀请码',
      '3）邀请码：' + code,
      '',
      '不用注册、不花钱；装好之后我戳它，你那边就会跳一下。邀请码 10 分钟内有效。',
    ].join('\n');
  }

  async function createInvite() {
    if (S.createState === 'creating') return;
    if (!serviceOnline()) {
      toast('情侣服务暂不可用，请先重试', 'warn');
      return;
    }
    S.createState = 'creating';
    renderCreate();
    const res = await app.invoke(IPC.COUPLE_CREATE, {}, { gate: false });
    if (res && res.ok) {
      S.createState = 'ready';
      S.code = String(res.code || '');
      S.codeExpiresAt = res.expiresAt || Date.now() + 10 * 60 * 1000;
      if (res.couple) S.couple = res.couple;
      renderCreate();
      toast('邀请码已生成，10 分钟内有效', 'ok', 3200);
    } else {
      S.createState = 'idle';
      renderCreate();
      toast((res && res.message) || '生成邀请码失败，请稍后重试', 'err', 4200);
    }
  }

  /** 生成邀请链接：${apiBase}/m/?join=<6位码> */
  function inviteLink(code) {
    const cfg = window.CubbitLiteConfig || {};
    const c = encodeURIComponent(String(code || ''));
    // 优先用邀请落地页（带下载按钮 + 一键唤起 cubbit://），比直达 API 的 /m/ 更适合发给对方
    if (cfg.joinBase) return String(cfg.joinBase).replace(/\/+$/, '') + '?code=' + c;
    const state = app.state || {};
    const couple = S.couple || {};
    const base = String(
      couple.apiBase ||
        (state.settings && state.settings.apiBase) ||
        (state.license && state.license.apiBase) ||
        'https://cubbit.app',
    ).replace(/\/+$/, '');
    return base + '/m/?join=' + c;
  }

  /** 情侣空间入口卡（配对后显示在情侣视图顶部） */
  function mountRoomEntry() {
    const host = document.getElementById('viewPaired');
    if (!host || host.querySelector('.room-entry')) return;
    const SCENES = [
      { emoji: '☕', name: '咖啡约会' },
      { emoji: '🎬', name: '深夜电影' },
      { emoji: '🌟', name: '阳台看星星' },
      { emoji: '🍳', name: '一起做饭' },
      { emoji: '🌧️', name: '雨天窗边' },
      { emoji: '🌙', name: '晚安故事' },
    ];
    const chips = el('div', { class: 'room-entry__chips' });
    for (const scene of SCENES) {
      chips.appendChild(el('span', { class: 'room-entry__chip' }, el('span', { class: 'emoji', text: scene.emoji }), el('span', { text: scene.name })));
    }
    const btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('sparkle'), el('span', { text: '进入情侣空间' }));
    btn.addEventListener('click', () => app.openPanel('coupleRoom'));
    const card = el(
      'div',
      { class: 'card room-entry' },
      el(
        'div',
        { class: 'room-entry__head' },
        el('div', { class: 'ico-tile ico-tile--couple' }, icon('heart')),
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'h4' }, el('span', { text: '情侣空间' }), el('span', { class: 'tag tag--accent', text: `${SCENES.length} 个场景` })),
          el('div', { class: 'card__desc', text: '6 个一起待着的场景：同步场景与明暗，一起计时 25 分钟，还能保存这一刻。' }),
        ),
        btn,
      ),
      chips,
    );
    host.insertBefore(card, host.firstChild);
  }

  function resetInvite() {
    stopCountdown();
    stopWaitingPoll();
    S.createState = 'idle';
    S.code = '';
    S.codeExpiresAt = 0;
  }

  function startCountdown() {
    stopCountdown();
    updateCountdown();
    S.countdownTimer = setInterval(updateCountdown, 1000);
  }

  function updateCountdown() {
    if (S.createState !== 'ready') return;
    const left = Math.max(0, S.codeExpiresAt - Date.now());
    if (R.codeTimerText) R.codeTimerText.textContent = formatDuration(left);
    if (left <= 0) {
      stopCountdown();
      stopWaitingPoll();
      S.createState = 'expired';
      renderCreate();
    }
  }

  function stopCountdown() {
    if (S.countdownTimer) clearInterval(S.countdownTimer);
    S.countdownTimer = null;
  }

  function startWaitingPoll() {
    if (S.waitingPollTimer) return;
    S.waitingPollTimer = setInterval(async () => {
      if (S.createState !== 'ready' || S.view !== 'unpaired') return;
      const res = await app.invoke(IPC.COUPLE_POLL, {}, { gate: false });
      if (res && res.ok && res.couple) {
        S.couple = res.couple;
        if (res.couple.enabled) {
          stopWaitingPoll();
          stopCountdown();
          S.createState = 'idle';
          toast('配对成功，欢迎来到两个人的空间', 'ok', 3600);
          await app.refresh();
          renderAll();
        }
      }
    }, 3000);
  }

  function stopWaitingPoll() {
    if (S.waitingPollTimer) clearInterval(S.waitingPollTimer);
    S.waitingPollTimer = null;
  }

  function stopUnpairedTimers() {
    stopCountdown();
    stopWaitingPoll();
  }

  function renderJoinState() {
    if (!R.joinBody) return;
    R.joinError.textContent = S.joinError || '';
    updateJoinBtn();
  }

  async function doJoin() {
    const code = joinCodeValue();
    if (code.length !== 6) {
      S.joinError = '请填写完整的 6 位邀请码';
      renderJoinState();
      return;
    }
    if (S.joinBusy) return;
    if (!serviceOnline()) {
      S.joinError = '情侣服务暂不可用，请稍后重试';
      renderJoinState();
      return;
    }
    S.joinBusy = true;
    R.joinBtn.disabled = true;
    const label = R.joinBtn.querySelector('span');
    if (label) label.textContent = '正在加入…';
    const res = await app.invoke(IPC.COUPLE_JOIN, { code }, { gate: false });
    S.joinBusy = false;
    if (label) label.textContent = '加入情侣空间';
    if (res && res.ok) {
      S.joinError = '';
      if (res.couple) S.couple = res.couple;
      for (const cell of R.joinCells) {
        cell.value = '';
        cell.classList.remove('is-filled');
      }
      toast('配对成功，开始你们的悄悄话吧', 'ok', 3600);
      await app.refresh();
      renderAll();
    } else {
      S.joinError = friendlyCoupleError(res);
      renderJoinState();
      updateJoinBtn();
      toast(S.joinError, 'err', 4200);
    }
  }

  function friendlyCoupleError(res) {
    if (!res) return '操作失败，请稍后重试';
    const code = res.code || '';
    if (code === 'SERVER_OFFLINE' || res.offline) return '情侣服务暂不可用，请检查网络后重试';
    if (code === 'COUPLE_CODE_INVALID' || code === 'INVALID_CODE') return '邀请码不存在或已过期';
    if (code === 'COUPLE_ALREADY_PAIRED') return '你已经在一个情侣空间里了';
    if (code === 'FEATURE_LOCKED') return '情侣模式需要 Pro 授权';
    if (code === 'COUPLE_NOT_PAIRED') return '还没有配对成功';
    if (code === 'RATE_LIMITED') return '操作太频繁，歇一会儿再试';
    return res.message || '操作失败，请稍后重试';
  }

  // =============================================================== 已配对
  function buildPaired() {
    // partner bar
    R.partnerAvatar = el('div', { class: 'partner-avatar' });
    R.partnerName = el('span', { text: 'TA' });
    R.partnerPresence = el('span', {});
    R.partnerSub = el('div', { class: 'partner-sub', text: '' });
    R.partnerAffection = el('strong', { text: '0 / 1000' });
    R.partnerProgressFill = el('div', { class: 'progress__fill', style: { width: '0%' } });
    R.partnerAnniversary = el('span', { text: '刚配对' });
    R.partnerMarried = el('span', {});
    R.proposeBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('ring'), el('span', { text: '向 TA 求婚' }));
    R.proposeBtn.addEventListener('click', proposeMarriage);
    R.loveShortcutBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('heart'), el('span', { text: '今日情话' }));
    R.loveShortcutBtn.addEventListener('click', () => focusLoveNote());
    R.unpairBtn = el('button', { class: 'btn btn--ghost btn--sm btn--icon', type: 'button', title: '解除配对' }, icon('unlink'));
    R.unpairBtn.addEventListener('click', unpair);

    document.getElementById('partnerBar').append(
      R.partnerAvatar,
      el(
        'div',
        { class: 'partner-id' },
        el('div', { class: 'partner-name' }, R.partnerName, R.partnerPresence),
        R.partnerSub,
      ),
      el(
        'div',
        { class: 'partner-metric' },
        el('div', { class: 'partner-metric__head' }, el('span', { text: '恋爱值' }), R.partnerAffection),
        el('div', { class: 'progress' }, R.partnerProgressFill),
        el('div', { class: 'partner-metric__foot' }, icon('calendar'), R.partnerAnniversary, R.partnerMarried),
      ),
      el('div', { class: 'partner-actions' }, R.proposeBtn, R.loveShortcutBtn, R.unpairBtn),
    );

    // chat
    R.chatUnread = el('span', { class: 'tag tag--accent hidden' });
    document.getElementById('chatHead').append(
      el('div', { class: 'chat-head__title' }, icon('chat'), el('span', { text: '和 TA 的悄悄话' }), R.chatUnread),
      el('div', { class: 'chat-head__spacer' }),
      el('span', { class: 'tiny dim', text: '只有你们两个人能看到' }),
    );

    R.chatList = document.getElementById('chatList');

    const quick = document.getElementById('chatQuick');
    for (const phrase of QUICK_PHRASES) {
      const pill = el('button', { class: 'quick-pill', type: 'button' }, el('span', { text: phrase }));
      pill.addEventListener('click', () => sendChat(phrase, 'emoji'));
      quick.appendChild(pill);
    }
    R.loveQuickBtn = el(
      'button',
      { class: 'quick-pill quick-pill--love', type: 'button' },
      icon('heart'),
      el('span', { text: '发送情话' }),
    );
    R.loveQuickBtn.addEventListener('click', () => focusLoveNote());
    quick.appendChild(R.loveQuickBtn);

    // composer
    R.chatInput = el('textarea', {
      class: 'chat-input',
      rows: '1',
      maxlength: String(MAX_CHAT),
      placeholder: '说点什么…（Enter 发送，Shift+Enter 换行）',
      'aria-label': '聊天输入框',
    });
    R.chatCount = el('span', { class: 'chat-count', text: `0 / ${MAX_CHAT}` });
    R.chatSend = el('button', { class: 'chat-send', type: 'button', disabled: 'disabled' }, icon('send'), el('span', { text: '发送' }));
    R.chatSend.addEventListener('click', () => sendChat(R.chatInput.value, 'text'));
    R.chatInput.addEventListener('input', () => {
      const len = R.chatInput.value.length;
      R.chatCount.textContent = `${len} / ${MAX_CHAT}`;
      R.chatSend.disabled = !R.chatInput.value.trim() || S.sending;
    });
    R.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChat(R.chatInput.value, 'text');
      }
    });
    document.getElementById('chatComposer').append(
      el('div', { class: 'composer-wrap' }, R.chatInput, R.chatCount),
      R.chatSend,
    );

    // 侧栏容器
    R.sideCol = document.getElementById('sideCol');
  }

  function applyCouple(couple) {
    if (!couple) return;
    S.couple = couple;
    renderPartner();
    renderMessages();
    renderWedding();
    renderLove();
    maybeShowProposal();
    renderNotice(couple);
  }

  function renderPartner() {
    const c = S.couple;
    const partner = (c && c.partner) || {};
    const presence = partner.presence || {};
    const online = partner.online !== false;
    const info = UI.presenceInfo(presence);
    const palette = partnerPalette(partner.skinId);

    R.partnerAvatar.style.background = `linear-gradient(155deg, ${palette.body1}, ${palette.body2} 56%, ${palette.body3})`;
    R.partnerAvatar.style.boxShadow = `0 10px 22px rgba(0,0,0,.4), inset 0 2px 0 rgba(255,255,255,.5), 0 0 22px ${palette.glow || 'transparent'}`;
    R.partnerAvatar.style.setProperty('--p-eye', palette.eye);

    R.partnerName.textContent = partner.name || 'TA';
    clear(R.partnerPresence);
    R.partnerPresence.appendChild(
      online ? UI.presenceBadge(presence) : el('span', { class: 'badge badge--locked' }, icon('wifi-off'), el('span', { text: '离线' })),
    );
    R.partnerSub.textContent = online
      ? `${info.title || info.label}${partner.lastSeenAt ? ' · 刚刚还在' : ''}`
      : partner.lastSeenAt
        ? `上次在线 ${UI.formatAgo(partner.lastSeenAt)}`
        : '暂时不在线，消息会保留';

    const affection = UI.clamp(Number(c.affection) || 0, 0, 1000);
    const pct = UI.affectionPercent(affection);
    R.partnerAffection.textContent = `${affection} / 1000`;
    R.partnerProgressFill.style.width = pct + '%';
    R.partnerAnniversary.textContent = c.married
      ? `相伴第 ${c.anniversaryDays || 0} 天`
      : c.pairId
        ? '已配对'
        : '未配对';
    clear(R.partnerMarried);
    if (c.married) R.partnerMarried.appendChild(el('span', { class: 'badge badge--pro' }, icon('ring'), el('span', { text: '已婚' })));

    R.proposeBtn.classList.toggle('hidden', !!c.married);
    R.proposeBtn.disabled = !!c.pendingProposal || S.proposeBusy;
    if (R.loveShortcutBtn) R.loveShortcutBtn.classList.toggle('hidden', !c.married);
    const proposeLabel = R.proposeBtn.querySelector('span');
    if (proposeLabel) proposeLabel.textContent = c.pendingProposal && c.proposalFrom === 'me' ? '等待回应…' : '向 TA 求婚';
  }

  function partnerPalette(skinId) {
    const state = S.state || {};
    const skins = state.skins || [];
    const skin = skins.find((s) => s.id === skinId);
    if (skin && skin.palette) return skin.palette;
    return { body1: '#ffe1ec', body2: '#f497b6', body3: '#c85f83', eye: '#3a1622', glow: 'rgba(255,140,180,.5)' };
  }

  /** 场景同步用的隐藏消息（[[scene]]<id>|<light>）不展示、不通知 */
  function isSceneMessage(msg) {
    return !!msg && typeof msg.text === 'string' && msg.text.indexOf('[[scene]]') === 0;
  }

  function renderMessages() {
    const c = S.couple || {};
    const rawMessages = Array.isArray(c.messages) ? c.messages : [];
    // v1.6：场景同步走隐藏前缀 [[scene]]<id>|<light>，不展示、不计入未读
    const sceneMessageCount = rawMessages.filter((m) => isSceneMessage(m)).length;
    const messages = rawMessages.filter((m) => !isSceneMessage(m));
    const list = R.chatList;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    clear(list);
    let lastDay = '';
    for (const msg of messages.slice(-20)) {
      const day = formatDate(msg.at);
      if (day !== lastDay && day !== '—') {
        lastDay = day;
        list.appendChild(el('div', { class: 'msg-day', text: day }));
      }
      const mine = msg.from === 'me';
      const bubble = el('div', { class: 'msg__bubble', text: msg.text });
      const body = el(
        'div',
        { class: 'msg__body' },
        bubble,
        el('span', { class: 'msg__time', text: formatClock(msg.at) }),
      );
      list.appendChild(el('div', { class: 'msg ' + (mine ? 'msg--me' : 'msg--partner') }, el('div', { class: 'msg__avatar' }), body));
    }
    if (messages.length === 0) {
      list.appendChild(
        el(
          'div',
          { class: 'invite-empty', style: { margin: 'auto' } },
          el('div', { class: 'invite-empty__text', text: '还没有悄悄话。点下面的快捷短语，或者直接说一句早安吧。' }),
        ),
      );
    }
    if (atBottom || messages.length <= 1) {
      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
    }
    clear(R.chatUnread);
    const unread = Math.max(0, Number(c.unread || 0) - sceneMessageCount);
    R.chatUnread.classList.toggle('hidden', !(unread > 0));
    if (unread > 0) R.chatUnread.textContent = `${unread} 条未读`;
  }

  async function sendChat(text, kind) {
    const value = String(text || '').slice(0, MAX_CHAT);
    if (!value.trim() || S.sending) return;
    if (!serviceOnline()) {
      toast('情侣服务暂不可用，消息没有发出去', 'err', 3600);
      return;
    }
    S.sending = true;
    R.chatSend.disabled = true;
    const res = await app.invoke(IPC.COUPLE_SEND, { text: value.trim(), kind: kind || 'text' }, { gate: false });
    S.sending = false;
    R.chatSend.disabled = !R.chatInput.value.trim();
    if (res && res.ok) {
      R.chatInput.value = '';
      R.chatCount.textContent = `0 / ${MAX_CHAT}`;
      if (res.couple) applyCouple(res.couple);
      else await app.refresh();
      requestAnimationFrame(() => {
        R.chatList.scrollTop = R.chatList.scrollHeight;
      });
    } else {
      toast(friendlyCoupleError(res), 'err', 4200);
    }
  }

  function renderWedding() {
    const c = S.couple || {};
    if (!R.sideCol) return;
    // 保留情话卡，重建婚礼卡
    if (R.weddingCard) R.weddingCard.remove();
    const card = el('div', { class: 'card wedding-card' });
    R.weddingCard = card;

    const head = el(
      'div',
      { class: 'wedding-card__head' },
      el('div', { class: 'ico-tile ico-tile--sm' }, icon(c.married ? 'ring' : 'heart')),
      el('div', { class: 'wedding-card__title', text: c.married ? '你们的婚礼' : '结婚进度' }),
      el('span', { class: 'wedding-card__state badge ' + (c.married ? 'badge--pro' : 'badge--locked') }, el('span', { text: c.married ? '已婚' : '未婚' })),
    );
    card.appendChild(head);

    if (c.married) {
      card.appendChild(
        el(
          'div',
          { class: 'wedding-rows' },
          el('div', { class: 'wedding-row' }, el('span', { text: '婚礼日期' }), el('strong', { text: formatDate(c.marriedAt) })),
          el('div', { class: 'wedding-row' }, el('span', { text: '共同恋爱值' }), el('strong', { text: `${c.affection || 0} / 1000` })),
          el('div', { class: 'wedding-row' }, el('span', { text: '每日情话' }), el('strong', { text: c.dailyLove && c.dailyLove.sent ? '今天已发' : '还没发' })),
        ),
      );
      card.appendChild(
        el(
          'div',
          { class: 'wedding-day' },
          el('div', { class: 'wedding-day__num', text: String(c.anniversaryDays || 0) }),
          el('div', { class: 'wedding-day__label', text: '相伴天数 · 每一天都算数' }),
        ),
      );

    } else {
      card.appendChild(
        el('div', {
          class: 'small muted',
          style: { lineHeight: '1.65' },
          text: '在两只方块仔的见证下结婚：婚礼日期会被永久记住，纪念日每天都会数着过。',
        }),
      );
      const steps = el('div', { class: 'steps-mini' });
      const mk = (done, text) =>
        el(
          'div',
          { class: 'steps-mini__item' + (done ? ' is-done' : '') },
          el('span', { class: 'steps-mini__dot', text: done ? '✓' : '' }),
          el('span', { text }),
        );
      steps.appendChild(mk(true, '已配对'));
      steps.appendChild(mk(!!c.pendingProposal && c.proposalFrom === 'me', '向 TA 求婚'));
      steps.appendChild(mk(!!c.married, '举行婚礼'));
      card.appendChild(steps);
      if (c.pendingProposal && c.proposalFrom === 'me') {
        card.appendChild(
          el(
            'div',
            { class: 'proposal-pending' },
            el('span', { class: 'waiting-dots' }, el('span'), el('span'), el('span')),
            el('span', { text: '求婚已发出，等待 TA 回应…' }),
          ),
        );
      } else if (c.pendingProposal && c.proposalFrom === 'partner') {
        const btn = el('button', { class: 'btn btn--primary btn--block', type: 'button' }, icon('ring'), el('span', { text: 'TA 向你求婚了，去看看' }));
        btn.addEventListener('click', () => {
          S.proposalModalOpen = false;
          maybeShowProposal();
        });
        card.appendChild(btn);
      } else {
        card.appendChild(
          el('div', { class: 'create-hint', style: { marginTop: '10px' } }, icon('info'), el('span', { text: '准备好时，点右上角「向 TA 求婚」' })),
        );
      }
    }

    // 插到侧栏开头
    if (R.sideCol.firstChild) R.sideCol.insertBefore(card, R.sideCol.firstChild);
    else R.sideCol.appendChild(card);
  }

  function renderLove() {
    const c = S.couple || {};
    const daily = c.dailyLove || { sent: false, text: '', at: 0 };
    if (!R.sideCol) return;
    if (R.loveCard) R.loveCard.remove();
    const card = el('div', { class: 'card love-card' });
    R.loveCard = card;
    card.appendChild(
      el(
        'div',
        { class: 'love-card__head' },
        el('div', { class: 'ico-tile ico-tile--sm' }, icon('heart')),
        el('div', { class: 'love-card__title', text: '今日情话' }),
        el(
          'span',
          { class: 'love-card__badge badge ' + (daily.sent ? 'badge--ok' : 'badge--locked') },
          el('span', { text: daily.sent ? '已发送' : '待发送' }),
        ),
      ),
    );

    if (daily.sent) {
      card.appendChild(
        el(
          'div',
          { class: 'love-sent-box' },
          el('div', { class: 'love-sent-box__text', text: daily.text || '（无内容）' }),
          el('div', { class: 'love-sent-box__meta', text: daily.at ? `${formatDateTime(daily.at)} 发送` : '今天已发送' }),
        ),
      );
      card.appendChild(el('div', { class: 'small dim', text: '每天一句，明天再来。TA 打开面板时第一眼就会看到。' }));
      R.sideCol.appendChild(card);
      return;
    }

    R.loveInput = el('textarea', {
      class: 'love-input',
      maxlength: String(MAX_LOVE),
      placeholder: '写一句只属于你们的话…',
      'aria-label': '今日情话',
    });
    R.loveInput.value = S.loveDraft || '';
    R.loveCount = el('span', { class: 'love-count', text: `${(S.loveDraft || '').length} / ${MAX_LOVE}` });
    R.loveInput.addEventListener('input', () => {
      S.loveDraft = R.loveInput.value;
      R.loveCount.textContent = `${R.loveInput.value.length} / ${MAX_LOVE}`;
    });

    const suggest = el('div', { class: 'love-suggest' });
    for (const text of LOVE_PRESETS) {
      const pill = el('button', { class: 'quick-pill', type: 'button' }, el('span', { text }));
      pill.addEventListener('click', () => {
        R.loveInput.value = text;
        S.loveDraft = text;
        R.loveCount.textContent = `${text.length} / ${MAX_LOVE}`;
        R.loveInput.focus();
      });
      suggest.appendChild(pill);
    }

    R.loveSend = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, icon('send'), el('span', { text: '发送' }));
    R.loveSend.addEventListener('click', sendLoveNote);

    card.appendChild(R.loveInput);
    card.appendChild(suggest);
    card.appendChild(el('div', { class: 'love-foot' }, R.loveCount, R.loveSend));
    R.sideCol.appendChild(card);
  }

  function focusLoveNote() {
    if (S.couple && S.couple.dailyLove && S.couple.dailyLove.sent) {
      toast('今天的情话已经发出啦，明天再来', 'info', 3200);
      return;
    }
    renderLove();
    if (R.loveInput) {
      R.loveInput.focus();
      R.loveInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function sendLoveNote() {
    const text = String((R.loveInput && R.loveInput.value) || S.loveDraft || '').slice(0, MAX_LOVE).trim();
    if (!text) {
      toast('先写一句情话吧', 'warn', 2600);
      R.loveInput && R.loveInput.focus();
      return;
    }
    if (S.loveBusy) return;
    S.loveBusy = true;
    R.loveSend.disabled = true;
    const res = await app.invoke(IPC.COUPLE_LOVE_NOTE, { text }, { gate: false });
    S.loveBusy = false;
    R.loveSend.disabled = false;
    if (res && res.ok) {
      S.loveDraft = '';
      if (res.couple) applyCouple(res.couple);
      toast('今日情话已送达', 'ok', 3200);
    } else {
      toast(friendlyCoupleError(res), 'err', 4200);
    }
  }

  // =============================================================== 求婚 / 结婚
  async function proposeMarriage() {
    const partner = (S.couple && S.couple.partner) || {};
    if (S.proposeBusy) return;
    const ok = await confirmDialog({
      title: `向「${partner.name || 'TA'}」求婚？`,
      desc: '接受之后，你们会在两只方块仔的见证下结婚。婚礼日期会被永久记录，从那天开始每天都会数纪念日。',
      confirmLabel: '现在就求婚',
      cancelLabel: '再想想',
    });
    if (!ok) return;
    S.proposeBusy = true;
    const res = await app.invoke(IPC.COUPLE_PROPOSE, {}, { gate: false });
    S.proposeBusy = false;
    if (res && res.ok) {
      toast('求婚已发出，等 TA 回应吧', 'ok', 3600);
      if (res.couple) applyCouple(res.couple);
      await app.refresh();
    } else {
      toast(friendlyCoupleError(res), 'err', 4200);
    }
  }

  function maybeShowProposal() {
    const c = S.couple;
    if (!c) return;
    if (!c.pendingProposal) S.declinedProposal = false;
    if (!c.pendingProposal || c.proposalFrom !== 'partner' || S.proposalModalOpen || S.declinedProposal) return;
    S.proposalModalOpen = true;
    const partner = c.partner || {};
    const body = el(
      'div',
      { class: 'upgrade-body' },
      el(
        'div',
        { class: 'love-sent-box', style: { marginBottom: '12px' } },
        el('div', { class: 'love-sent-box__text', text: `${partner.name || 'TA'} 想和你结婚，一起去过接下来的每一年。` }),
        el('div', { class: 'love-sent-box__meta', text: '接受后婚礼日期会被永久记住' }),
      ),
      el(
        'div',
        { class: 'upgrade-list' },
        el('div', { class: 'upgrade-item' }, el('div', { class: 'ico-tile ico-tile--sm ico-tile--gold' }, icon('ring')), el('span', { text: '共享婚礼与纪念日' })),
        el('div', { class: 'upgrade-item' }, el('div', { class: 'ico-tile ico-tile--sm ico-tile--gold' }, icon('heart')), el('span', { text: '恋爱值继续累积' })),
      ),
    );
    modal({
      title: `${partner.name || 'TA'} 想和你结婚`,
      desc: '这是只属于你们两个人的仪式，随时可以再决定。',
      iconName: 'ring',
      body,
      closable: true,
      onClose: () => {
        S.proposalModalOpen = false;
      },
      actions: [
        {
          label: '婉拒',
          kind: 'ghost',
          value: false,
          onClick: () => {
            S.declinedProposal = true;
            toast('已婉拒，可以稍后再谈这件事', 'info', 3200);
          },
        },
        {
          label: '我愿意',
          kind: 'primary',
          icon: 'ring',
          autofocus: true,
          value: true,
          onClick: async (btn) => {
            btn.disabled = true;
            const res = await app.invoke(IPC.COUPLE_ACCEPT, {}, { gate: false });
            btn.disabled = false;
            if (res && res.ok) {
              toast('恭喜！你们结婚啦 💍', 'ok', 4200);
              if (res.couple) applyCouple(res.couple);
              await app.refresh();
              renderAll();
            } else {
              toast(friendlyCoupleError(res), 'err', 4200);
            }
          },
        },
      ],
    });
  }

  // =============================================================== 解绑
  async function unpair() {
    if (S.unpairBusy) return;
    const partner = (S.couple && S.couple.partner) || {};
    const ok = await confirmDialog({
      title: '解除和 TA 的配对？',
      desc: `解除后，${partner.name || 'TA'} 会从你的情侣空间消失，聊天记录与每日情话都会被清空，且无法恢复。恋爱值与婚礼记录也会一并清除。`,
      confirmLabel: '确认解除',
      cancelLabel: '再想想',
      danger: true,
    });
    if (!ok) return;
    S.unpairBusy = true;
    const res = await app.invoke(IPC.COUPLE_UNPAIR, {}, { gate: false });
    S.unpairBusy = false;
    if (res && res.ok) {
      resetInvite();
      S.loveDraft = '';
      for (const cell of R.joinCells) {
        cell.value = '';
        cell.classList.remove('is-filled');
      }
      toast('已解除配对', 'info', 3200);
      if (res.couple) S.couple = res.couple;
      await app.refresh();
      renderAll();
    } else {
      toast(friendlyCoupleError(res), 'err', 4200);
    }
  }

  // =============================================================== 轮询
  function startPairedPoll() {
    if (S.pairedPollTimer) return;
    S.pairedPollTimer = setInterval(async () => {
      if (S.view !== 'paired' || !serviceOnline()) return;
      const res = await app.invoke(IPC.COUPLE_POLL, {}, { gate: false });
      if (res && res.ok && res.couple) {
        const before = ((S.couple && S.couple.messages) || []).length;
        S.couple = res.couple;
        if (res.couple.messages && res.couple.messages.length !== before) renderMessages();
        renderPartner();
        renderWedding();
        renderLove();
        renderNotice(res.couple);
        maybeShowProposal();
      }
    }, 8000);
  }

  function stopPairedPoll() {
    if (S.pairedPollTimer) clearInterval(S.pairedPollTimer);
    S.pairedPollTimer = null;
  }
})();
