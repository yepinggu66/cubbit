/* ============================================================================
 * Cubbit AI 对话面板
 *
 * 契约：
 *   · window.cubbit.panel.invoke('ai:status' | 'ai:chat' | 'ai:test' | 'ai:config:set'
 *                                | 'ai:history:get' | 'ai:history:clear', payload)
 *   · 事件 'ai:message'（主进程主动推送，例如桌宠替你搭话）
 *   · state.ai = { enabled, provider, model, ready, pro, chatting, lastError, messages[] }
 *
 * 没有 Electron 时用 ui/mock.js 的 mock state 独立预览（?mock=1&ai=ready|locked|unconfigured|openai）。
 * ========================================================================== */
(function () {
  'use strict';

  const UI = window.CubbitUI;
  const IPC = UI.IPC;
  const EVENTS = UI.EVENTS || {};
  const el = UI.el;
  const icon = UI.icon;
  const clear = UI.clear;
  const toast = UI.toast;
  const confirmDialog = UI.confirm;
  const formatClock = UI.formatClock;

  const app = UI.createApp();

  const MAX_LEN = 200;
  const QUICK_PHRASES = ['今天累死了', '夸夸我', '讲个冷笑话', '晚安'];
  const PERSONALITY_LABEL = { warm: '温暖', sassy: '毒舌', quiet: '安静' };
  const DAY_MS = 86400000;

  const S = {
    ai: null,
    messages: [],
    typing: false,
    sending: false,
    locked: false,
    lastUserText: '',
    error: '',
    historyLoaded: false,
    streamTimer: null,
    unsubscribe: [],
    lastEventAt: 0,
    lastEventText: '',
  };

  const R = {};

  document.addEventListener('DOMContentLoaded', init);

  // =============================================================== 启动
  async function init() {
    mountTitlebar();
    renderHead();
    buildQuick();
    buildComposer();

    app.onState((state) => {
      applyAiState(state);
    });

    await app.boot({});
    applyAiState(app.state);
    subscribeAiEvents();
    loadHistory();
  }

  function mountTitlebar() {
    const { bar, rightSlot } = UI.mountTitlebar(app, { page: '和 TA 聊聊', brandSub: false });
    R.badgeHost = el('div', { class: 'row', style: { gap: '8px' } });
    rightSlot.insertBefore(R.badgeHost, rightSlot.firstChild);
    document.getElementById('titlebar-host').appendChild(bar);
    document.title = '方块仔 · 和 TA 聊聊';
  }

  // =============================================================== 状态
  function applyAiState(state) {
    if (state) S.ai = state.ai || null;
    const ai = S.ai;

    // 门控：免费版也有 ai_chat（每天 10 轮），只有 ai_chat 被关或明确未授权才上锁
    const feats = (state && state.features) || (app.state && app.state.features) || {};
    if (ai) S.locked = ai.pro === false && feats.ai_chat !== true;
    else S.locked = false;

    renderBadge(state || app.state);
    renderHead();
    if (!S.historyLoaded && ai && Array.isArray(ai.messages) && ai.messages.length && !S.messages.length) {
      S.messages = ai.messages.map(normalizeMessage);
      S.historyLoaded = true;
      renderMessages();
    }
    renderLocked();
    renderComposerState();
    document.querySelector('.chat-shell')?.classList.toggle('is-locked', S.locked);
  }

  function renderBadge(state) {
    if (!R.badgeHost || !state) return;
    clear(R.badgeHost);
    R.badgeHost.appendChild(UI.licenseBadgeNode(state.license || {}, state.ui));
    const ai = S.ai;
    if (ai && ai.ready) {
      R.badgeHost.appendChild(
        el('span', { class: 'badge badge--teal' }, el('span', { class: 'dot dot--ok' }), el('span', { text: 'AI 在线' })),
      );
    }
  }

  function aiStatus() {
    const ai = S.ai;
    if (!ai) return { label: 'AI 准备中', cls: 'badge--locked', icon: 'info' };
    if (ai.pro === false) return { label: 'Pro 专属', cls: 'badge--locked', icon: 'lock' };
    if (!ai.enabled) return { label: '未启用', cls: 'badge--locked', icon: 'power' };
    if (ai.chatting || S.typing) return { label: '正在回复…', cls: 'badge--trial', icon: 'sparkle' };
    if (ai.lastError) return { label: '连接异常', cls: 'badge--danger', icon: 'warning' };
    if (!ai.ready) return { label: '未连接', cls: 'badge--locked', icon: 'wifi-off' };
    if (ai.provider === 'ollama') return { label: '本地模型', cls: 'badge--ok', icon: 'monitor' };
    if (ai.provider === 'openai') return { label: '云端模型', cls: 'badge--ok', icon: 'globe' };
    return { label: '已连接', cls: 'badge--ok', icon: 'check-circle' };
  }

  function quotaLabel() {
    const ai = S.ai;
    if (!ai || ai.roundsLeft == null) return '';
    if (ai.unlimited) return 'AI 无限';
    return `今日 AI 剩余 ${ai.roundsLeft}/${ai.roundsPerDay || ''}${ai.roundsPerDay ? ' 轮' : ''}`;
  }

  function renderHead() {
    const host = document.getElementById('chatHead');
    if (!host) return;
    const ai = S.ai || {};
    const state = app.state || {};
    const product = state.product || {};
    const personality = (state.settings && state.settings.aiPersonality) || ai.personality || 'warm';
    const status = aiStatus();

    clear(host);
    R.avatar = el('div', { class: 'chat-avatar' + (S.typing || ai.chatting ? ' is-typing' : '') }, el('div', { class: 'chat-avatar__ring' }));

    const nameHost = el(
      'div',
      { class: 'chat-id' },
      el(
        'div',
        { class: 'chat-name' },
        el('span', { text: product.zhName || '方块仔' }),
        ai.model ? el('span', { class: 'chat-name__model', text: ai.model }) : null,
      ),
      el(
        'div',
        { class: 'chat-status' },
        el('span', { class: 'badge ' + status.cls }, icon(status.icon), el('span', { text: status.label })),
        el('span', { class: 'tag', text: '性格 · ' + (PERSONALITY_LABEL[personality] || '温暖') }),
        quotaLabel() ? el('span', { class: 'tag tag--teal', text: quotaLabel() }) : null,
        ai.lastError ? el('span', { class: 'tiny', style: { color: '#ff9b9b' }, text: shorten(ai.lastError, 34) }) : null,
      ),
    );

    R.clearBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: '清空对话' }, icon('trash'), el('span', { text: '清空对话' }));
    R.clearBtn.addEventListener('click', clearHistory);
    R.settingsBtn = el('button', { class: 'btn btn--ghost btn--sm btn--icon', type: 'button', title: 'AI 设置' }, icon('sliders'));
    R.settingsBtn.addEventListener('click', () => app.openPanel('settings'));

    host.append(R.avatar, nameHost, el('div', { class: 'chat-head__actions' }, R.settingsBtn, R.clearBtn));
  }

  // =============================================================== 消息
  function normalizeMessage(msg) {
    if (!msg) return { role: 'assistant', text: '', at: Date.now() };
    return {
      role: msg.role === 'user' ? 'user' : 'assistant',
      text: String(msg.text || ''),
      at: Number(msg.at) || Date.now(),
      source: msg.source === 'rules' || msg.source === 'ai' ? msg.source : undefined,
    };
  }

  function renderMessages() {
    const list = document.getElementById('chatStream');
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    clear(list);

    if (!S.messages.length && !S.typing) {
      list.appendChild(buildEmpty());
      return;
    }

    let lastDay = '';
    for (const msg of S.messages) {
      const day = UI.formatDate(msg.at);
      if (day !== lastDay && day !== '—') {
        lastDay = day;
        list.appendChild(el('div', { class: 'chat-day', text: day }));
      }
      list.appendChild(buildMessageNode(msg));
    }
    if (S.typing) {
      list.appendChild(
        el(
          'div',
          { class: 'msg msg--ai' },
          el('div', { class: 'msg__avatar' }),
          el(
            'div',
            { class: 'msg__body' },
            el(
              'div',
              { class: 'msg__bubble is-typing' },
              el('span', { class: 'typing-dot' }),
              el('span', { class: 'typing-dot' }),
              el('span', { class: 'typing-dot' }),
            ),
          ),
        ),
      );
    }
    if (atBottom || S.typing) scrollToBottom();
  }

  function buildEmpty() {
    const ai = S.ai;
    const greeting = ai && !ai.enabled
      ? 'AI 陪伴还没打开。去「设置 → AI 陪伴」开启之后，就能和我随便聊了。'
      : '我在呢。今天想聊点什么？工作、天气、还是一句废话都可以。';
    const wrap = el(
      'div',
      { class: 'chat-empty' },
      el('div', { class: 'chat-empty__art' }, el('div', { class: 'mini-cube' }), el('div', { class: 'chat-empty__spark' }, icon('sparkle'))),
      el('div', { class: 'chat-empty__title', text: '你们还没聊过' }),
      el('div', { class: 'chat-empty__desc', text: greeting }),
    );
    if (!ai || !ai.enabled) {
      const btn = el('button', { class: 'btn btn--sm', type: 'button' }, icon('sliders'), el('span', { text: '去开启 AI 陪伴' }));
      btn.addEventListener('click', () => app.openPanel('settings'));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function buildMessageNode(msg) {
    const mine = msg.role === 'user';
    const meta = el(
      'div',
      { class: 'msg__meta' },
      !mine && msg.source === 'rules' ? el('span', { class: 'msg__source msg__source--rules' }, icon('sparkle'), el('span', { text: '规则回复' })) : null,
      !mine && msg.source === 'ai' ? el('span', { class: 'msg__source' }, icon('bolt'), el('span', { text: 'AI' })) : null,
      el('span', { text: formatClock(msg.at) }),
    );
    return el(
      'div',
      { class: 'msg ' + (mine ? 'msg--me' : 'msg--ai') },
      el('div', { class: 'msg__avatar' }),
      el('div', { class: 'msg__body' }, el('div', { class: 'msg__bubble', text: msg.text }), meta),
    );
  }

  function pushMessage(msg) {
    S.messages.push(normalizeMessage(msg));
    // 只保留最近 60 条在内存里
    if (S.messages.length > 60) S.messages = S.messages.slice(-60);
    renderMessages();
  }

  function scrollToBottom() {
    const list = document.getElementById('chatStream');
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }

  /** 模拟逐字输出（真实流式由主进程决定；这里只是呈现层效果） */
  function typeOut(reply, meta) {
    return new Promise((resolve) => {
      S.typing = false;
      const node = normalizeMessage({ role: 'assistant', text: '', at: Date.now(), source: meta && meta.source });
      S.messages.push(node);
      renderMessages();
      const index = S.messages.length - 1;
      const bubbleText = reply;
      let pos = 0;
      const stepMs = UI.clamp(Math.round(1400 / Math.max(12, bubbleText.length)), 12, 34);
      if (app.state && app.state.settings && app.state.settings.reduceMotion) {
        S.messages[index].text = bubbleText;
        renderMessages();
        resolve();
        return;
      }
      const tick = () => {
        pos += Math.max(1, Math.round(bubbleText.length / 40));
        if (pos >= bubbleText.length) {
          S.messages[index].text = bubbleText;
          renderMessages();
          scrollToBottom();
          resolve();
          return;
        }
        S.messages[index].text = bubbleText.slice(0, pos);
        // 局部更新，避免整列表重建闪烁
        const bubbles = document.querySelectorAll('#chatStream .msg--ai .msg__bubble');
        const last = bubbles[bubbles.length - 1];
        if (last) {
          last.textContent = S.messages[index].text;
          last.appendChild(el('span', { class: 'caret' }));
        }
        scrollToBottom();
        S.streamTimer = setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  function stopStreaming() {
    if (S.streamTimer) clearTimeout(S.streamTimer);
    S.streamTimer = null;
  }

  // =============================================================== 输入 / 发送
  function buildComposer() {
    R.input = el('textarea', {
      class: 'chat-input',
      rows: '1',
      maxlength: String(MAX_LEN),
      placeholder: '和它说点什么…（Enter 发送，Shift+Enter 换行）',
      'aria-label': '消息输入框',
    });
    R.count = el('span', { class: 'chat-count', text: `0 / ${MAX_LEN}` });
    R.sendBtn = el('button', { class: 'chat-send', type: 'button', disabled: 'disabled' }, icon('send'), el('span', { text: '发送' }));

    R.input.addEventListener('input', () => {
      R.count.textContent = `${R.input.value.length} / ${MAX_LEN}`;
      updateSendState();
    });
    R.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    R.sendBtn.addEventListener('click', send);
    R.micBtn = el('button', { class: 'chat-send chat-mic', type: 'button', title: '按一下说话（离线中文识别）' }, el('span', { text: '🎤 说话' }));
    R.micBtn.addEventListener('click', async () => {
      if (S.sending || R.micBtn.disabled) return;
      R.micBtn.disabled = true;
      R.micBtn.querySelector('span').textContent = '🎤 在听…';
      try {
        const res = await app.invoke('voice:listen', { mode: 'text' }, { gate: false });
        if (res && res.ok && res.text) {
          R.input.value = String(res.text).slice(0, MAX_LEN);
          R.count.textContent = `${R.input.value.length} / ${MAX_LEN}`;
          updateSendState();
          send();
        } else if (res && res.ok) UI.toast('没听清，再说一次？', 'ok');
        else UI.toast((res && res.message) || '语音输入不可用', 'err');
      } finally {
        R.micBtn.disabled = false;
        R.micBtn.querySelector('span').textContent = '🎤 说话';
      }
    });

    document.getElementById('chatComposer').append(
      el('div', { class: 'chat-input-wrap' }, R.input, R.count),
      R.micBtn,
      R.sendBtn,
    );
    updateSendState();
  }

  function buildQuick() {
    const host = document.getElementById('chatQuick');
    clear(host);
    R.quickButtons = [];
    for (const phrase of QUICK_PHRASES) {
      const pill = el('button', { class: 'quick-pill', type: 'button' }, el('span', { text: phrase }));
      pill.addEventListener('click', () => {
        if (R.input) {
          R.input.value = phrase;
          R.count.textContent = `${phrase.length} / ${MAX_LEN}`;
          updateSendState();
        }
        send();
      });
      R.quickButtons.push(pill);
      host.appendChild(pill);
    }
    host.appendChild(el('span', { class: 'quick-pill--hint', text: 'AI 回复可能不准确，重要的事请再确认' }));
  }

  function updateSendState() {
    if (!R.sendBtn) return;
    const text = (R.input && R.input.value.trim()) || '';
    R.sendBtn.disabled = !text || S.sending || S.locked;
    R.sendBtn.querySelector('span').textContent = S.sending ? '发送中…' : '发送';
    if (R.quickButtons) for (const btn of R.quickButtons) btn.disabled = S.sending || S.locked;
  }

  function renderComposerState() {
    updateSendState();
    if (R.input) R.input.disabled = S.locked;
  }

  function showError(message) {
    S.error = message || '';
    const bar = document.getElementById('chatErrorBar');
    if (!bar) return;
    clear(bar);
    if (!S.error) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    bar.appendChild(icon('warning'));
    bar.appendChild(el('div', { class: 'chat-errorbar__body', text: S.error }));
    if (S.lastUserText) {
      const retry = el('button', { class: 'btn btn--sm', type: 'button' }, icon('refresh'), el('span', { text: '重试' }));
      retry.addEventListener('click', () => {
        showError('');
        sendText(S.lastUserText, { appendUser: false, retry: true });
      });
      bar.appendChild(retry);
    }
    const settingsBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('sliders'), el('span', { text: '检查配置' }));
    settingsBtn.addEventListener('click', () => app.openPanel('settings'));
    bar.appendChild(settingsBtn);
  }

  function friendlyAiError(res) {
    if (!res) return '发送失败，请稍后再试';
    const code = res.code || '';
    if (code === 'FEATURE_LOCKED') return 'AI 陪伴是 Pro 功能，升级后即可对话';
    if (code === 'AI_NOT_CONFIGURED') return 'AI 还没有配置好，请到「设置 → AI 陪伴」填写服务地址与模型';
    if (code === 'AI_UNREACHABLE' || code === 'SERVER_OFFLINE' || res.offline) {
      return '连不上 AI 服务：本地模型请确认 Ollama 已启动，云端请检查 Base URL 与网络';
    }
    if (code === 'AI_TIMEOUT') return 'AI 想了太久没有回应，可以再试一次';
    if (code === 'AI_RATE_LIMITED') return '请求太频繁了，歇一会儿再聊';
    if (code === 'AI_NOT_ENABLED') return 'AI 陪伴未启用，可在设置里打开';
    if (code === 'BAD_REQUEST') return '消息不能为空';
    return res.message || '发送失败，请稍后再试';
  }

  async function send() {
    const text = ((R.input && R.input.value) || '').trim();
    if (!text || S.sending) return;
    if (S.locked) {
      toast('AI 陪伴是 Pro 功能，升级后即可对话', 'warn', 3200);
      return;
    }
    R.input.value = '';
    R.count.textContent = `0 / ${MAX_LEN}`;
    updateSendState();
    await sendText(text, { appendUser: true });
  }

  async function sendText(text, opts = {}) {
    const clean = String(text || '').slice(0, MAX_LEN).trim();
    if (!clean || S.sending) return;
    S.sending = true;
    S.lastUserText = clean;
    showError('');
    if (opts.appendUser !== false) {
      pushMessage({ role: 'user', text: clean, at: Date.now() });
    }
    S.typing = true;
    renderHead();
    renderMessages();
    updateSendState();

    let res = null;
    try {
      res = await app.invoke(IPC.AI_CHAT, { text: clean }, { gate: false });
    } catch (err) {
      res = { ok: false, code: 'IPC_FAILED', message: String((err && err.message) || err) };
    }
    S.sending = false;

    if (res && res.ok && res.reply) {
      const source = res.source ? (res.source === 'rules' ? 'rules' : 'ai') : S.ai && S.ai.enabled === false ? 'rules' : 'ai';
      await typeOut(String(res.reply), { source });
      S.typing = false;
      renderHead();
      updateSendState();
      if (res.ai) S.ai = Object.assign({}, S.ai, res.ai);
      renderHead();
      return;
    }

    S.typing = false;
    renderHead();
    renderMessages();
    updateSendState();
    if (res && res.code === 'FEATURE_LOCKED') {
      S.locked = true;
      renderLocked();
      toast('AI 陪伴是 Pro 功能，升级后即可对话', 'warn', 3600);
      return;
    }
    showError(friendlyAiError(res));
    toast(friendlyAiError(res), 'err', 4200);
  }

  // =============================================================== 历史 & 清空
  async function loadHistory() {
    if (S.historyLoaded) return;
    const res = await app.invoke(IPC.AI_HISTORY_GET, {}, { gate: false });
    if (res && res.ok && Array.isArray(res.messages) && res.messages.length) {
      S.messages = res.messages.map(normalizeMessage);
      S.lastUserText = [...S.messages].reverse().find((m) => m.role === 'user')?.text || '';
    }
    S.historyLoaded = true;
    renderMessages();
  }

  async function clearHistory() {
    if (S.sending) return;
    const ok = await confirmDialog({
      title: '清空全部对话？',
      desc: '这段对话会从本机删除，无法恢复。它的「记忆」也会一起清空，但你们的亲密度和成长数据不受影响。',
      confirmLabel: '清空对话',
      cancelLabel: '保留',
      danger: true,
    });
    if (!ok) return;
    const res = await app.invoke(IPC.AI_HISTORY_CLEAR, {}, { gate: false });
    if (res && res.ok) {
      stopStreaming();
      S.messages = [];
      S.lastUserText = '';
      S.typing = false;
      showError('');
      renderMessages();
      toast('对话已清空', 'info', 2600);
    } else {
      toast((res && res.message) || '清空失败，请稍后重试', 'err', 3600);
    }
  }

  // =============================================================== 事件订阅
  /** 兼容多种 preload 暴露方式：onAiMessage / onEvent(channel, cb) / on(channel, cb) */
  function subscribeAiEvents() {
    const panel = app.panel;
    if (!panel) return;
    const onMessage = (payload) => {
      if (!payload || !payload.text) return;
      const now = Date.now();
      if (payload.text === S.lastEventText && now - S.lastEventAt < 3000) return;
      S.lastEventAt = now;
      S.lastEventText = payload.text;
      // 主进程主动搭话：只有在不是发送中（避免和请求回复重复）时才追加
      if (S.sending || S.typing) return;
      pushMessage({ role: 'assistant', text: String(payload.text), at: now, source: payload.source || 'rules' });
    };
    try {
      if (typeof panel.onAiMessage === 'function') {
        const off = panel.onAiMessage(onMessage);
        if (typeof off === 'function') S.unsubscribe.push(off);
        return;
      }
      if (typeof panel.onEvent === 'function') {
        const off = panel.onEvent(EVENTS.AI_MESSAGE || 'ai:message', onMessage);
        if (typeof off === 'function') S.unsubscribe.push(off);
        return;
      }
      if (typeof panel.on === 'function') {
        const off = panel.on(EVENTS.AI_MESSAGE || 'ai:message', onMessage);
        if (typeof off === 'function') S.unsubscribe.push(off);
      }
    } catch (err) {
      console.warn('[chat] subscribe ai:message failed', err);
    }
  }

  // =============================================================== 未解锁
  function renderLocked() {
    const host = document.getElementById('chatLocked');
    if (!host) return;
    const show = S.locked;
    host.classList.toggle('hidden', !show);
    if (!show) {
      clear(host);
      return;
    }
    if (host.firstChild) return;
    const features = [
      { icon: 'chat', text: '随时聊天，记得你说过的话' },
      { icon: 'sparkle', text: '三种性格：温暖 / 毒舌 / 安静' },
      { icon: 'monitor', text: '支持本地 Ollama，对话不出本机' },
    ];
    const ring = el('div', { class: 'chat-locked__ring' }, icon('chat'));
    host.appendChild(ring);
    host.appendChild(el('div', { class: 'chat-locked__title', text: 'AI 陪伴是 Pro 功能' }));
    host.appendChild(
      el('div', {
        class: 'chat-locked__desc',
        text: '升级 Pro 之后，方块仔可以真正听懂你说话：有记忆、有性格，也能在桌宠里主动接话。',
      }),
    );
    const list = el('div', { class: 'chat-locked__features' });
    for (const f of features) {
      list.appendChild(el('div', { class: 'chat-locked__feature' }, icon(f.icon), el('span', { text: f.text })));
    }
    host.appendChild(list);
    const upgrade = el('button', { class: 'btn btn--primary', type: 'button' }, icon('crown'), el('span', { text: '升级 Pro 解锁' }));
    upgrade.addEventListener('click', () => app.openPanel('store'));
    const later = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('sliders'), el('span', { text: '先看看设置' }));
    later.addEventListener('click', () => app.openPanel('settings'));
    host.appendChild(el('div', { class: 'chat-locked__actions' }, later, upgrade));
  }

  function shorten(text, n) {
    const s = String(text || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // 卸载时清理
  window.addEventListener('beforeunload', () => {
    stopStreaming();
    for (const off of S.unsubscribe) {
      try {
        off();
      } catch (err) {
        /* ignore */
      }
    }
  });
})();
