/**
 * 人生账本 · 牌桌
 *
 * 一次只呈现一件事：今天的三张卡。
 * 收益在选之前是隐藏的——这是原作的核心设计，也正好是桌面宠物能做的事：
 * 它替你把"成本摆在明面上，收益留给你赌"，然后在结算时把结果念给你听。
 *
 * 依赖：shared/lifegame.js（纯逻辑，浏览器里也会用同一份）
 * IPC：life:state / life:choose / life:restart
 */
(function () {
  'use strict';

  const G = window.CUBBIT_LIFEGAME;
  const api = (window.cubbit && window.cubbit.panel) || null;

  const CH = {
    state: 'life:state',
    choose: 'life:choose',
    restart: 'life:restart',
    duo: 'life:duo',
    hand: 'life:hand',
    panelWindow: 'app:panel:window',
  };

  const R = {
    stage: document.getElementById('stage'),
    meters: document.getElementById('meters'),
    step: document.getElementById('step'),
    insight: document.getElementById('insight'),
    closeBtn: document.getElementById('closeBtn'),
    trialsBtn: document.getElementById('trialsBtn'),
    longBtn: document.getElementById('longBtn'),
    findBtn: document.getElementById('findBtn'),
    handoffBtn: document.getElementById('handoffBtn'),
    duo: document.getElementById('duo'),
  };

  const S = {
    state: null,
    cards: [],
    selected: null,
    busy: false,
    view: 'trials',
    trial: null,
    trialSelected: null,
    trialResults: {},
  };

  const METERS = [
    { key: 'lifeYears', label: '寿命', cls: 'life', max: 62, fmt: (v) => `${v.toFixed(1)}`, unit: '年' },
    { key: 'cash', label: '现金', cls: 'cash', max: 300000, fmt: (v) => `${(v / 10000).toFixed(1)}`, unit: '万' },
    { key: 'energy', label: '精力', cls: 'energy', max: 100, fmt: (v) => `${Math.round(v)}`, unit: '' },
    { key: 'free', label: '自由', cls: 'free', max: 100, fmt: (v) => `${Math.round(v)}`, unit: '' },
  ];

  // ------------------------------------------------------------------ 工具

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) node.appendChild(kid);
    return node;
  }

  function invoke(channel, payload) {
    if (!api) return Promise.resolve(null);
    return api.invoke(channel, payload).catch((err) => {
      console.warn('[ledger] invoke failed', channel, err);
      return null;
    });
  }

  function money(n) {
    const abs = Math.abs(n);
    if (abs >= 10000) return `${(abs / 10000).toFixed(1)} 万`;
    return `${Math.round(abs)}`;
  }

  function deltaChips(deltas) {
    const specs = [
      { key: 'lifeYears', label: '寿命', unit: '年', digits: 1 },
      { key: 'cash', label: '现金', unit: '元', money: true },
      { key: 'energy', label: '精力', unit: '' },
      { key: 'free', label: '自由', unit: '' },
    ];
    const out = [];
    for (const s of specs) {
      const v = deltas[s.key];
      if (v === undefined || v === null || Math.round(v * 10) === 0) continue;
      const up = v > 0;
      const num = s.money ? money(v) : s.digits ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v));
      out.push(
        el(
          'div',
          { class: `delta ${up ? 'up' : 'down'}` },
          el('span', { text: `${up ? '↑' : '↓'} ${s.label} ${up ? '+' : '−'}${num}${s.unit ? ' ' + s.unit : ''}` }),
        ),
      );
    }
    if (!out.length) out.push(el('div', { class: 'delta' }, el('span', { text: '这一年的账基本平了' })));
    return out;
  }

  // ------------------------------------------------------------------ 资源

  function renderMeters(state) {
    R.meters.textContent = '';
    for (const m of METERS) {
      const v = Number(state[m.key]) || 0;
      const pct = Math.max(0, Math.min(100, (v / m.max) * 100));
      const low = (m.key === 'energy' || m.key === 'free') ? v < 30 : m.key === 'cash' ? v < 10000 : v < 10;
      R.meters.appendChild(
        el(
          'div',
          { class: `meter meter--${m.cls}${low ? ' is-low' : ''}` },
          el('div', { class: 'meter__key' },
            el('span', { text: m.label }),
            el('span', { class: 'meter__val' },
              el('span', { text: m.fmt(v) }),
              m.unit ? el('small', { text: m.unit }) : null,
            ),
          ),
          el('div', { class: 'meter__bar' }, el('i', { style: `width:${pct}%` })),
        ),
      );
    }
    // 口径要和页脚一致：能走时说的是"下一步"，走完了就报"已完成"
    // 整句放进一个文本节点，切换语言时才能整句翻译（原来拆在 <b> 里会漏翻）
    R.step.textContent =
      state.canPlay === false
        ? `已完成 ${state.turn} / ${state.total} 步`
        : `下一步：第 ${state.turn + 1} / ${state.total} 步`;
    R.insight.textContent = state.insight || '';
  }

  // ------------------------------------------------------------------ 健康检索

  const CARDS = Array.isArray(window.LIFE_CARDS) ? window.LIFE_CARDS : [];
  const SHARE = window.CUBBIT_SHARE || null;
  // 与"身体"直接相关的章节：不要早死 / 不要慢慢死 / 紧急情况 / 慢性病 /
  // 家里有老人 / 看病 / 别为了外形把身体搞坏 / 常备药
  const HEALTH_SECTIONS = [1, 2, 13, 16, 17, 24, 28, 34];

  const FIND_SECS = [
    { id: 'health', label: '健康相关' },
    { id: 'all', label: '全部章节' },
    { id: '1', label: '不要早死' },
    { id: '13', label: '紧急情况' },
    { id: '24', label: '看病' },
    { id: '34', label: '常备药' },
    { id: '16', label: '慢性病' },
  ];

  const FIND = { q: '', sec: 'health', ev: 'all', checked: new Set() };

  function findCards() {
    const q = FIND.q.trim();
    // 「健康相关」是浏览时的默认范围；一旦开始打字，就搜全部章节——
    // 想找"体检"的人不该因为那条卡归在"不要慢慢死"里就搜不到。
    const healthBrowse = FIND.sec === 'health' && !q;
    return CARDS.filter((c) => {
      if (healthBrowse && !HEALTH_SECTIONS.includes(c.sec)) return false;
      if (!healthBrowse && FIND.sec !== 'all' && FIND.sec !== 'health' && String(c.sec) !== FIND.sec) return false;
      if (FIND.ev !== 'all' && c.ev !== FIND.ev) return false;
      if (!q) return true;
      return `${c.title}${c.plain}${c.secName}`.includes(q);
    });
  }

  function renderFind() {
    S.view = 'find';
    R.stage.textContent = '';
    const rows = findCards();
    const box = el('div', { class: 'find' });

    const input = el('input', {
      class: 'find__input',
      type: 'search',
      placeholder: '搜一件具体的事，比如：体检、血压、摔伤、常备药、医保',
      value: FIND.q,
    });
    input.addEventListener('input', () => {
      FIND.q = input.value;
      const keep = input.selectionStart;
      renderFind();
      const next = R.stage.querySelector('.find__input');
      if (next) {
        next.focus();
        try {
          next.setSelectionRange(keep, keep);
        } catch {
          /* ignore */
        }
      }
    });

    box.appendChild(
      el('div', { class: 'find__bar' },
        input,
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderPlay() }, document.createTextNode('回到今天')),
      ),
    );

    const chips = el('div', { class: 'find__chips' });
    for (const s of FIND_SECS) {
      chips.appendChild(
        el('button', {
          class: 'chip' + (FIND.sec === s.id ? ' is-on' : ''),
          type: 'button',
          onclick: () => {
            FIND.sec = s.id;
            renderFind();
          },
        }, document.createTextNode(s.label)),
      );
    }
    for (const ev of ['all', 'A', 'B']) {
      chips.appendChild(
        el('button', {
          class: 'chip chip--ev' + (FIND.ev === ev ? ' is-on' : ''),
          type: 'button',
          onclick: () => {
            FIND.ev = ev;
            renderFind();
          },
        }, document.createTextNode(ev === 'all' ? '不限证据' : `只看证据 ${ev}`)),
      );
    }
    box.appendChild(chips);

    box.appendChild(
      el('div', { class: 'find__meta' },
        el('span', { text: `找到 ${rows.length} 条` }),
        el('span', {
          text: FIND.q.trim() && FIND.sec === 'health'
            ? '打字时自动搜全部章节 · 勾几条可以合成一份清单'
            : '勾选几条，可以合成一份清单分享出去',
        }),
      ),
    );

    const list = el('div', { class: 'find__list' });
    for (const c of rows.slice(0, 60)) {
      const checked = FIND.checked.has(c.id);
      list.appendChild(
        el('div', { class: 'frow' + (checked ? ' is-checked' : '') },
          el('label', { class: 'frow__tick' },
            el('input', {
              type: 'checkbox',
              checked: checked ? 'checked' : null,
              onchange: (e) => {
                if (e.target.checked) FIND.checked.add(c.id);
                else FIND.checked.delete(c.id);
                renderFind();
              },
            }),
          ),
          el('div', { class: 'frow__body' },
            el('div', { class: 'frow__head' },
              el('b', { text: c.title }),
              el('span', { class: `ev ev--${c.ev}`, text: `证据 ${c.ev}` }),
              el('span', { class: 'frow__sec', text: c.secName }),
            ),
            el('p', { class: 'frow__plain', text: c.plain || '' }),
          ),
          el('button', {
            class: 'btn btn--ghost frow__share',
            type: 'button',
            onclick: () => openShare({ kind: 'card', title: c.title, plain: c.plain, ev: c.ev, secName: c.secName }),
          }, document.createTextNode('分享')),
        ),
      );
    }
    if (!rows.length) {
      list.appendChild(el('div', { class: 'hint' }, document.createTextNode('没搜到。换个词试试，比如「体检」「摔伤」「药」。')));
    }
    box.appendChild(list);

    const picked = CARDS.filter((c) => FIND.checked.has(c.id)).slice(0, SHARE ? SHARE.LIST_MAX : 5);
    box.appendChild(
      el('div', { class: 'find__acts' },
        el('span', { class: 'find__count', text: `已选 ${FIND.checked.size} 条` }),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          disabled: rows.length ? null : '',
          onclick: () => {
            FIND.checked = new Set(rows.slice(0, 5).map((c) => c.id));
            renderFind();
          },
        }, document.createTextNode('选前 5 条')),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: () => {
            FIND.checked.clear();
            renderFind();
          },
        }, document.createTextNode('清空')),
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          disabled: picked.length ? null : '',
          onclick: () => openShare({
            kind: 'list',
            head: `我挑了 ${picked.length} 条关于${FIND.sec === 'health' ? '健康' : '过日子'}的建议`,
            items: picked,
          }),
        }, document.createTextNode('分享这份清单')),
      ),
    );

    R.stage.appendChild(box);
  }

  // ------------------------------------------------------------------ 分享

  /** 画分享卡：纯矢量，不画外部图片——file:// 页面把图片画进 canvas 会污染画布。 */
  function drawSheet(input) {
    const W = 1200;
    const H = 630;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');

    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0d13');
    bg.addColorStop(0.55, '#141018');
    bg.addColorStop(1, '#1b1114');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);

    const glow = x.createRadialGradient(760, -60, 40, 760, -60, 620);
    glow.addColorStop(0, 'rgba(255,176,110,0.20)');
    glow.addColorStop(1, 'rgba(255,176,110,0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, W, H);

    x.strokeStyle = 'rgba(255,255,255,0.10)';
    x.lineWidth = 2;
    x.strokeRect(48, 48, W - 96, H - 96);

    x.fillStyle = '#ffb469';
    x.fillRect(48, 48, 6, H - 96);

    const wrap = (text, maxWidth, font, maxLines) => {
      x.font = font;
      const chars = [...String(text || '')];
      const lines = [];
      let line = '';
      for (const ch of chars) {
        if (x.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = ch;
          if (lines.length === maxLines) break;
        } else {
          line += ch;
        }
      }
      if (lines.length < maxLines && line) lines.push(line);
      if (lines.length === maxLines && chars.join('').length > lines.join('').length) {
        lines[maxLines - 1] = lines[maxLines - 1].replace(/[，。；、]$/, '') + '…';
      }
      return lines;
    };

    const isList = input.kind === 'list';
    const isEnding = input.kind === 'ending';

    x.fillStyle = '#8a93a6';
    x.font = '500 22px "Microsoft YaHei", sans-serif';
    const kicker = isEnding ? '四十步走完一辈子' : isList ? `${(input.items || []).length} 条 · 附证据等级` : `${input.secName || '人生账本'} · 证据 ${input.ev || 'A'} 级`;
    x.fillText(kicker, 92, 148);

    const title = isEnding ? `我的结局：${input.title || ''}` : isList ? input.head || '一份清单' : input.title || '';
    const titleLines = wrap(title, W - 200, '700 46px "Microsoft YaHei", sans-serif', 2);
    x.fillStyle = '#f3f5fa';
    titleLines.forEach((line, i) => x.fillText(line, 92, 214 + i * 60));

    let y = 214 + titleLines.length * 60 + 18;
    x.fillStyle = '#c3cad9';
    if (isList) {
      const items = (input.items || []).slice(0, 5);
      items.forEach((it, i) => {
        const lines = wrap(`${i + 1}. ${it.title}`, W - 200, '400 24px "Microsoft YaHei", sans-serif', 1);
        x.fillStyle = '#ffb469';
        x.fillText(`${i + 1}`, 92, y);
        x.fillStyle = '#c3cad9';
        x.fillText(lines[0].replace(/^\d+\.\s*/, ''), 128, y);
        y += 44;
      });
    } else if (isEnding) {
      const lines = wrap(input.summary || '', W - 200, '400 25px "Microsoft YaHei", sans-serif', 3);
      lines.forEach((line) => {
        x.fillText(line, 92, y);
        y += 40;
      });
      y += 8;
      x.fillStyle = '#ffb469';
      x.font = '600 26px "Microsoft YaHei", sans-serif';
      const bits = [];
      if (input.age) bits.push(`活到 ${Math.round(input.age)} 岁`);
      if (input.cash != null) bits.push(`手里 ${(input.cash / 10000).toFixed(1)} 万`);
      if (input.done != null) bits.push(`执行了 ${input.done} 条`);
      x.fillText(bits.join(' · '), 92, y);
    } else {
      const lines = wrap(input.plain || '', W - 200, '400 25px "Microsoft YaHei", sans-serif', 5);
      lines.forEach((line) => {
        x.fillText(line, 92, y);
        y += 40;
      });
    }

    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.font = '400 20px "Microsoft YaHei", sans-serif';
    x.fillText('方块仔 · 人生账本 —— 一天一步，四十步走完一辈子', 92, H - 88);
    x.textAlign = 'right';
    x.fillText('内容来自《高性价比人生指南》CC BY 4.0', W - 92, H - 88);
    x.textAlign = 'left';

    return c;
  }

  /**
   * 结局卡：四十步走完才有一张，所以它必须是这局里最值得发出去的一张图。
   *
   * 和清单卡的区别：清单卡是"我挑了这几条"，结局卡是"我把一辈子过成了这样"。
   * 后者是唯一会被人主动发到朋友圈的东西——它是一份自我介绍，不是一份笔记。
   */
  function drawEndingCard(state, end) {
    const W = 1200;
    const H = 630;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');

    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0a0c12');
    bg.addColorStop(0.5, '#151017');
    bg.addColorStop(1, '#1d1210');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);

    const glow = x.createRadialGradient(900, 30, 30, 900, 30, 700);
    glow.addColorStop(0, 'rgba(255,164,96,0.22)');
    glow.addColorStop(1, 'rgba(255,164,96,0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, W, H);

    x.strokeStyle = 'rgba(255,255,255,0.09)';
    x.lineWidth = 2;
    x.strokeRect(44, 44, W - 88, H - 88);
    x.fillStyle = '#ff9f57';
    x.fillRect(44, 44, 7, H - 88);

    const wrap = (text, maxWidth, font, maxLines) => {
      x.font = font;
      const chars = [...String(text || '')];
      const lines = [];
      let line = '';
      for (const ch of chars) {
        if (x.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = ch;
          if (lines.length === maxLines) break;
        } else {
          line += ch;
        }
      }
      if (lines.length < maxLines && line) lines.push(line);
      if (lines.length === maxLines && chars.join('').length > lines.join('').length) {
        lines[maxLines - 1] = lines[maxLines - 1].replace(/[，。；、]$/, '') + '…';
      }
      return lines;
    };

    const done = state.log.filter((r) => r.action !== 'skip').length;
    const duo = state.duo && state.duo.on ? state.duo.names : null;

    x.fillStyle = '#8b93a6';
    x.font = '500 21px "Microsoft YaHei", sans-serif';
    x.fillText(duo ? `同命局 · ${duo[0]} 与 ${duo[1]} 共用一条命` : `第 ${state.lifeIndex || 1} 条命 · 四十步走完`, 92, 128);

    x.fillStyle = '#ff9f57';
    x.font = '600 19px "Microsoft YaHei", sans-serif';
    x.fillText('人生账本 · 结局', 92, 166);

    const titleLines = wrap(end.title || '结束了', W - 220, '700 66px "Microsoft YaHei", sans-serif', 1);
    x.fillStyle = '#f4f6fb';
    x.fillText(titleLines[0] || '结束了', 92, 240);

    // 三格数据：这是整张图的证据，不放这三格就只是句狠话
    const tiles = [
      { k: '活到', v: `${Math.round(state.age)} 岁` },
      { k: '最后手里', v: `${(state.cash / 10000).toFixed(1)} 万` },
      { k: '真正执行', v: `${done} 条` },
    ];
    const tw = 300;
    tiles.forEach((t, i) => {
      const tx = 92 + i * (tw + 26);
      x.fillStyle = 'rgba(255,255,255,0.045)';
      x.fillRect(tx, 286, tw, 104);
      x.fillStyle = '#7f8798';
      x.font = '400 19px "Microsoft YaHei", sans-serif';
      x.fillText(t.k, tx + 22, 322);
      x.fillStyle = '#ffd0a3';
      x.font = '700 38px "Microsoft YaHei", sans-serif';
      x.fillText(t.v, tx + 22, 370);
    });

    x.fillStyle = '#c6cddc';
    x.font = '400 24px "Microsoft YaHei", sans-serif';
    wrap(end.summary || '', W - 220, '400 24px "Microsoft YaHei", sans-serif', 2)
      .forEach((line, i) => x.fillText(line, 92, 448 + i * 36));

    // 最后三步：让这张图有个"过程"，而不只是一个结果。
    // 每条裁到 16 字并给 fillText 传 maxWidth——不裁的话长标题会把文字顶出边框。
    const tail = state.log.slice(-3).map((r) => {
      const t = String(r.title || '');
      return `${r.action === 'skip' ? '停' : '做'} · ${t.length > 16 ? t.slice(0, 16) + '…' : t}`;
    });
    x.fillStyle = '#6f7889';
    x.font = '400 18px "Microsoft YaHei", sans-serif';
    x.fillText(tail.join('　/　'), 92, 520, W - 184);

    x.fillStyle = 'rgba(255,255,255,0.42)';
    x.font = '400 19px "Microsoft YaHei", sans-serif';
    x.fillText('方块仔 · 人生账本 —— 一天一步，四十步走完一辈子', 92, H - 74);
    x.textAlign = 'right';
    x.fillText('内容来自《高性价比人生指南》CC BY 4.0', W - 92, H - 74);
    x.textAlign = 'left';

    return c;
  }

  function closeSheet() {
    const old = document.querySelector('.sheet');
    if (old) old.remove();
  }

  async function openShare(input) {
    if (!SHARE) return;
    closeSheet();
    const info = await invoke('share:info');
    const base = (info && info.ok && info.base) || SHARE.DEFAULT_BASE;
    const pack = SHARE.pack(input, { base });
    // 结局卡单独画：它要能被当成一份"自我介绍"发出去，不是一条笔记。
    const canvas = input.kind === 'ending' ? drawEndingCard(input.state || S.state, input.end || input) : drawSheet(input);

    const note = el('span', { class: 'sheet__note', text: `${[...pack.text].length} 字 · 链接里带着内容，落地页不需要登录` });
    const panel = el('div', { class: 'sheet__panel' });

    panel.appendChild(
      el('div', { class: 'sheet__head' },
        el('b', { text: '分享' }),
        el('button', { class: 'btn btn--icon', type: 'button', onclick: closeSheet }, document.createTextNode('✕')),
      ),
    );

    canvas.className = 'sheet__canvas';
    panel.appendChild(canvas);

    panel.appendChild(el('p', { class: 'sheet__text', text: pack.text }));

    const acts = el('div', { class: 'sheet__acts' });
    for (const p of pack.platforms) {
      acts.appendChild(
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          title: p.note,
          onclick: async () => {
            const r = await invoke('share:open', { url: p.url });
            if (!r || !r.ok) note.textContent = (r && r.message) || '打不开这个平台。';
          },
        }, document.createTextNode(`分享到 ${p.label}`)),
      );
    }
   acts.appendChild(
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onclick: async () => {
          const r = await invoke('share:text', { text: pack.url });
          note.textContent = r && r.ok ? '链接已复制。' : '复制失败。';
        },
      }, document.createTextNode('复制链接')),
    );
    acts.appendChild(
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onclick: async () => {
          const r = await invoke('share:text', { text: pack.text });
          note.textContent = r && r.ok ? '文案已复制。' : '复制失败。';
        },
      }, document.createTextNode('复制文案')),
    );
    acts.appendChild(
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: async () => {
          note.textContent = '正在保存……';
          const r = await invoke('share:card', { dataUrl: canvas.toDataURL('image/png'), kind: input.kind });
          note.textContent = r && r.ok
            ? `已保存并复制到剪贴板：${String(r.path).split(/[\\/]/).pop()}`
            : (r && r.message) || '保存失败。';
        },
      }, document.createTextNode('存成图片')),
    );
    panel.appendChild(acts);
    panel.appendChild(note);

    const sheet = el('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, panel);
    document.body.appendChild(sheet);
  }

  // ------------------------------------------------------------------ 同命局

  /**
   * 同命局：四十步，两个人轮流按，共用一条命。
   *
   * 这里不做"两份资源"，因为那只是两个单人局并排跑；
   * 也不锁"只能轮到谁按"——情侣多数时候挤在同一台电脑前，锁了就得换设备。
   * 唯一硬规则写在 lifegame.choose 里：每一步都记下是谁按的，结局能算清账。
   */
  function renderDuo(state) {
    const box = R.duo;
    if (!box) return;
    box.hidden = false;
    box.textContent = '';
    const d = state && state.duo;

    if (!d || !d.on) {
      box.className = 'duo duo--off';
      box.appendChild(el('span', { class: 'duo__k', text: '同命局' }));
      box.appendChild(el('span', { class: 'duo__t', text: '四十步，两个人轮流按，共用一条命。' }));
      const blocked = !!(state && (state.turn > 0 || state.ending));
      box.appendChild(
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          disabled: blocked ? '' : null,
          title: blocked ? '这一局已经走过了，同命局只能从第一天开始' : '',
          onclick: () => openDuoSheet(),
        }, document.createTextNode(blocked ? '这一局已经开始，下一世再一起走' : '两个人一起走')),
      );
      return;
    }

    box.className = 'duo duo--on';
    const owner = d.names[d.owner] || '你';
    box.appendChild(el('span', { class: 'duo__k', text: '同命局' }));
    box.appendChild(
      el('span', { class: 'duo__t' },
        document.createTextNode('轮到 '),
        el('b', { text: owner }),
        document.createTextNode(` · ${d.steps[0]} : ${d.steps[1]} 步 · 还剩 ${d.left} 轮`),
      ),
    );
    box.appendChild(
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onclick: async () => {
          const r = await invoke(CH.duo, { action: 'stop' });
          if (r && r.ok) {
            await load();
            window.__toast && window.__toast('已退出同命局，回到一个人的一局。');
          }
        },
      }, document.createTextNode('拆伙')),
    );
  }

  function openDuoSheet() {
    closeSheet();
    const a = el('input', { class: 'find__input', type: 'text', maxlength: '8', value: '你', placeholder: '你的名字' });
    const b = el('input', { class: 'find__input', type: 'text', maxlength: '8', value: 'TA', placeholder: '对方的称呼' });
    const note = el('span', { class: 'sheet__note', text: '两个人的名字只存在这台电脑上，不上传。' });

    const panel = el('div', { class: 'sheet__panel' },
      el('div', { class: 'sheet__head' },
        el('b', { text: '开一局同命局' }),
        el('button', { class: 'btn btn--icon', type: 'button', onclick: closeSheet }, document.createTextNode('✕')),
      ),
      el('p', { class: 'sheet__text', text: '四十步，每人二十步，共用同一条命、同一个钱包。你替对方做的决定，对方也要承担；反过来也一样。这一步按下之后，两个人都不能单独重开。' }),
      el('div', { class: 'duo__form' }, a, b),
      el('div', { class: 'sheet__acts' },
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: async () => {
            const names = [String(a.value || '你').trim() || '你', String(b.value || 'TA').trim() || 'TA'];
            const r = await invoke(CH.duo, { names });
            if (!r || !r.ok) {
              note.textContent = (r && r.message) || '没开成，稍后再试。';
              return;
            }
            closeSheet();
            await load();
          },
        }, document.createTextNode('就这么办')),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: closeSheet }, document.createTextNode('再想想')),
      ),
      note,
    );
    const sheet = el('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, panel);
    document.body.appendChild(sheet);
    a.focus();
  }

  // ------------------------------------------------------------------ 跨端接续

  /**
   * 手机上想，电脑上按。
   *
   * 只带走"今天这一手"，不带走整局状态：used 里有几百个卡 id，塞进 URL 会到几 KB，
   * 微信/短信里必断。手机端看到的是三张卡和四条资源，选完得到一个 8 字符的决定码，
   * 带回来点一下即可落账——决定是手机做的，账还是这台电脑的。
   */
  async function openHandoffSheet() {
    closeSheet();
    const hand = await invoke(CH.hand);
    if (!hand || !hand.ok) {
      alert((hand && hand.message) || '今天没有可看的牌。');
      return;
    }
    const info = await invoke('share:info');
    const base = (info && info.ok && info.base) || (SHARE && SHARE.DEFAULT_BASE) || 'https://cubbit.app/share.html';
    const url = String(base).replace(/[^/]*$/, 'life.html') + '#h=' + hand.code;

    const note = el('span', { class: 'sheet__note', text: `第 ${hand.turn + 1}/40 步 · 链接里带着今天的三张卡，不需要登录` });
    const codeInput = el('input', { class: 'find__input', type: 'text', placeholder: '把手机上的决定码贴在这里，例如 D1.1.d' });

    const panel = el('div', { class: 'sheet__panel' },
      el('div', { class: 'sheet__head' },
        el('b', { text: '手机上想这一步' }),
        el('button', { class: 'btn btn--icon', type: 'button', onclick: closeSheet }, document.createTextNode('✕')),
      ),
      el('p', { class: 'sheet__text', text: '在手机上打开下面的链接，看今天这三张卡、慢慢想。选完它会给你一个决定码，回来贴在下面，这一步就落账了。' }),
      el('div', { class: 'hand__url' }, el('code', { text: url.length > 96 ? url.slice(0, 96) + '…' : url })),
      el('div', { class: 'sheet__acts' },
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: async () => {
            const r = await invoke('share:text', { text: url });
            note.textContent = r && r.ok ? '链接已复制，发到手机上打开。' : '复制失败，长按上面的地址手动复制。';
          },
        }, document.createTextNode('复制链接')),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: async () => {
            const r = await invoke('share:open', { url });
            if (!r || !r.ok) note.textContent = (r && r.message) || '打不开。';
          },
        }, document.createTextNode('在本机浏览器打开')),
      ),
      el('div', { class: 'hand__in' },
        codeInput,
        el('button', {
          class: 'btn',
          type: 'button',
          onclick: () => applyHandCode(codeInput.value, note),
        }, document.createTextNode('用这个决定')),
      ),
      note,
    );
    const sheet = el('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, panel);
    document.body.appendChild(sheet);
  }

  /**
   * 解析决定码并预选卡片。
   * 不直接落账——手机上点错一个数字就会少活几年，这种事必须再给人一次确认。
   */
  function applyHandCode(raw, noteEl) {
    const d = G.parseDecision(raw);
    if (!d) {
      if (noteEl) noteEl.textContent = '这个码不对，应该是 D1.0.d 这种格式。';
      return false;
    }
    const card = S.cards[d.index];
    if (!card) {
      if (noteEl) noteEl.textContent = '今天的牌里没有这一张，可能已经走过一步了。';
      return false;
    }
    if (S.view !== 'play') renderPlay();
    S.selected = card.id;
    renderCards();
    renderActions();
    if (noteEl) noteEl.textContent = `手机上说：${d.action === 'skip' ? '放弃' : '执行'}《${card.title}》。确认就按下面那个按钮。`;
    return true;
  }

  // ------------------------------------------------------------------ 卡片

  const COST_TEXT = {
    money: { 0: '不花钱', 少: '花点钱', 多: '花大钱' },
    time: { 少: '耗点时间', 中: '耗时间', 多: '很耗时间' },
    will: { 否: '不用硬撑', 些: '要一点毅力', 是: '很要毅力' },
  };

  function buildCard(card) {
    const node = el(
      'button',
      {
        class: 'card' + (S.selected === card.id ? ' is-sel' : ''),
        type: 'button',
        dataset: { id: card.id },
        onclick: () => {
          if (S.busy) return;
          S.selected = card.id;
          renderCards();
          renderActions();
        },
      },
      el('div', { class: 'card__sec' },
        el('span', { text: card.secName }),
        el('span', { class: `ev ev--${card.ev}`, text: `证据 ${card.ev}` }),
      ),
      el('div', { class: 'card__title', text: card.title }),
      el('div', { class: 'card__plain', text: card.plain || '' }),
      el('div', { class: 'card__cost' },
        el('span', { class: 'chip' }, el('b', { text: '钱 ' }), document.createTextNode(COST_TEXT.money[card.money] || '不花钱')),
        el('span', { class: 'chip' }, el('b', { text: '时间 ' }), document.createTextNode(COST_TEXT.time[card.time] || '少')),
        el('span', { class: 'chip' }, el('b', { text: '毅力 ' }), document.createTextNode(COST_TEXT.will[card.will] || '否')),
        el('span', { class: 'chip chip--hide', text: '收益 ？' }),
      ),
    );
    return node;
  }

  function renderCards() {
    S.view = 'play';
    const wrap = el('div', { class: 'cards' });
    for (const card of S.cards) wrap.appendChild(buildCard(card));
    R.stage.textContent = '';
    R.stage.appendChild(
      el('div', { class: 'hint' },
        el('b', { text: '抽 3 张，选 1 张。' }),
        document.createTextNode(' 卡面只给成本，收益要等你选完才知道——这是故意的。'),
      ),
    );
    R.stage.appendChild(wrap);
    renderRecent();
  }

  /** 最近三步：让人看见"我这一路是怎么走的"，也是它记住你的证据。 */
  function renderRecent() {
    const log = (S.state && S.state.log) || [];
    if (!log.length) return;
    const box = el('div', { class: 'recent' },
      el('div', { class: 'recent__head', text: '最近三步' }),
    );
    for (const row of log.slice(-3).reverse()) {
      box.appendChild(
        el('div', { class: 'recent__row' },
          el('span', { class: 'recent__turn', text: `第 ${row.turn} 步` }),
          el('span', { class: 'recent__title', text: row.title }),
          el('span', { class: `recent__act recent__act--${row.action === 'skip' ? 'skip' : 'do'}`, text: row.action === 'skip' ? '放弃' : '执行' }),
        ),
      );
    }
    R.stage.appendChild(box);
  }

  /** 从检索页回来：按当前状态把牌桌重新铺一遍。 */
  function renderPlay() {
    S.view = 'play';
    if (!S.state) return;
    if (S.state.ending) return renderEnding(S.state, null);
    if (!S.state.canPlay) return renderWait(S.state);
    if (!S.cards.length) {
      R.stage.textContent = '';
      R.stage.appendChild(el('div', { class: 'hint' }, document.createTextNode('这个年龄段暂时没有可抽的卡，明天再来。')));
      return;
    }
    renderCards();
    renderActions();
  }

  function renderActions() {
    const old = R.stage.querySelector('.actions');
    if (old) old.remove();
    const picked = S.cards.find((c) => c.id === S.selected);
    const bar = el('div', { class: 'actions' },
      el('span', { class: 'actions__pick' },
        picked ? el('span', null, document.createTextNode('已选：'), el('b', { text: picked.title })) : el('span', { text: '先点一张卡，再决定做不做。' }),
      ),
      el('div', { class: 'actions__btns' },
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => decide('skip'), disabled: picked ? null : '' }, document.createTextNode('什么也不做（+精力）')),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => decide('do'), disabled: picked ? null : '' }, document.createTextNode('执行这条')),
      ),
    );
    R.stage.appendChild(bar);
  }

  // ------------------------------------------------------------------ 决策

  async function decide(action) {
    if (S.busy || !S.selected) return;
    S.busy = true;
    const res = await invoke(CH.choose, { cardId: S.selected, action });
    S.busy = false;
    if (!res || !res.ok) {
      alert((res && res.message) || '这一步没走成，稍后再试。');
      return;
    }
    S.state = res.state;
    renderMeters(S.state);
    if (res.result.ended) renderEnding(S.state, res.result);
    else renderResult(S.state, res.result);
  }

  // ------------------------------------------------------------------ 结果

  function renderResult(state, result) {
    R.stage.textContent = '';
    const box = el('div', { class: 'result' });

    box.appendChild(
      el('div', { class: 'result__head' },
        el('span', { text: result.action === 'skip' ? '这一年你什么都没做' : '你执行了这条' }),
        el('span', { text: '·' }),
        el('span', { text: result.card.secName }),
        el('span', { class: `ev ev--${result.card.ev}`, text: `证据 ${result.card.ev}` }),
      ),
    );
    box.appendChild(el('div', { class: 'result__title', text: result.card.title }));

    const chips = el('div', { class: 'deltas' }, ...deltaChips(result.deltas));
    box.appendChild(chips);

    // 时间流逝必须单独一行：每年都会发生，和"你选了什么"无关。
    if (result.passing) {
      const p = result.passing;
      const bits = [];
      if (p.lifeYears) bits.push(`寿命 ${p.lifeYears > 0 ? '+' : '−'}${Math.abs(p.lifeYears).toFixed(1)} 年`);
      if (p.cash) bits.push(`工资 − 开销 ${p.cash > 0 ? '+' : '−'}${money(p.cash)} 元`);
      if (p.energy) bits.push(`精力 +${Math.round(p.energy)}`);
      if (bits.length) {
        box.appendChild(
          el('div', { class: 'passing' },
            el('span', { class: 'passing__tag', text: '又过一年' }),
            el('span', { text: bits.join(' · ') }),
          ),
        );
      }
    }

    if (result.event) {
      box.appendChild(
        el('div', { class: 'event' },
          el('b', { text: `${result.event.title}：` }),
          document.createTextNode(result.event.text),
        ),
      );
    }

    if (result.line) box.appendChild(el('div', { class: 'result__line', text: result.line }));

    if (result.factor && result.factor !== 1 && result.card.ev !== 'A') {
      box.appendChild(
        el('div', { class: 'hint' },
          document.createTextNode(
            result.card.ev === 'B'
              ? '证据 B：这类结论在人群里有 ±30% 的浮动，所以收益每次不一样。'
              : '证据 C：这类结论更多是经验，浮动最大——别把它当成定律。',
          ),
        ),
      );
    }

    box.appendChild(
      el('div', { class: 'actions' },
        el('span', { class: 'actions__pick' }, document.createTextNode('今天就到这儿。明天再来走下一步。')),
        el('div', { class: 'actions__btns' },
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => openShare({
              kind: 'card',
              title: result.card.title,
              plain: result.card.plain,
              ev: result.card.ev,
              secName: result.card.secName,
            }),
          }, document.createTextNode('分享这条')),
          el('button', { class: 'btn btn--primary', type: 'button', onclick: () => close() }, document.createTextNode('好，明天见')),
        ),
      ),
    );

    R.stage.appendChild(box);
    renderRecent();
  }

  // ------------------------------------------------------------------ 等待

  function renderWait(state) {
    R.stage.textContent = '';
    const last = state.log && state.log.length ? state.log[state.log.length - 1] : null;
    const box = el('div', { class: 'wait' });

    box.appendChild(
      el('div', { class: 'result__head' },
        el('span', { text: '今天的这一步已经走完了' }),
      ),
    );

    if (last) {
      box.appendChild(el('div', { class: 'result__title', text: last.title }));
      const chips = el('div', { class: 'deltas' }, ...deltaChips(last.deltas || {}));
      box.appendChild(chips);
    }

    box.appendChild(
      el('div', { class: 'result__line' },
        document.createTextNode(
          `距离下一步还有 ${untilTomorrow()}。\n这个玩法就是一天一步——连玩它都要讲性价比。`,
        ),
      ),
    );

    box.appendChild(
      el('div', { class: 'actions' },
        el('span', { class: 'actions__pick' }, document.createTextNode(`连续 ${state.streak || 1} 天`)),
        el('div', { class: 'actions__btns' },
          el('button', { class: 'btn', type: 'button', onclick: () => close() }, document.createTextNode('关掉，去干活')),
        ),
      ),
    );

    R.stage.appendChild(box);
    renderRecent();
  }

  function untilTomorrow() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const mins = Math.max(1, Math.round((next - now) / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
  }

  // ------------------------------------------------------------------ 结局

  function renderEnding(state, result) {
    R.stage.textContent = '';
    const end = (result && result.ended) || state.ending || {};
    const box = el('div', { class: 'ending' });

    box.appendChild(el('div', { class: 'result__head' }, el('span', { text: `第 ${state.lifeIndex} 条命 · 结算` })));
    box.appendChild(el('div', { class: 'ending__title', text: end.title || '结束了' }));
    box.appendChild(el('div', { class: 'ending__sum', text: end.summary || '' }));

    if (result && result.line) box.appendChild(el('div', { class: 'result__line', text: result.line }));

    // 同命局要交代清楚：这一条命是谁按出来的。两个人共用一条命，
    // 结算时只写"你"会让另一半觉得这一局跟自己无关。
    if (state.duo && state.duo.on && state.duo.steps) {
      const n = state.duo.names;
      const s0 = state.duo.steps[0];
      const s1 = state.duo.steps[1];
      box.appendChild(
        el('div', { class: 'duo__tally' },
          document.createTextNode(`${n[0]} 按了 ${s0} 步（执行 ${state.duo.acted[0]}），${n[1]} 按了 ${s1} 步（执行 ${state.duo.acted[1]}）。这条命是两个人一起过的。`),
        ),
      );
    }

    const grid = el('div', { class: 'ending__grid' },
      el('div', { class: 'ending__cell' }, el('span', { text: '活到' }), el('b', { text: `${Math.round(state.age)} 岁` })),
      el('div', { class: 'ending__cell' }, el('span', { text: '最后手里' }), el('b', { text: `${(state.cash / 10000).toFixed(1)} 万` })),
      el('div', { class: 'ending__cell' }, el('span', { text: '真正执行' }), el('b', { text: `${state.log.filter((r) => r.action !== 'skip').length} 条` })),
    );
    box.appendChild(grid);

    box.appendChild(
      el('div', { class: 'actions' },
        el('span', { class: 'actions__pick' }, document.createTextNode('下一世会换一批卡，但你的习惯还在。')),
        el('div', { class: 'actions__btns' },
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => openShare({
              kind: 'ending',
              title: end.title,
              summary: end.summary,
              plain: `${end.summary} 活到 ${Math.round(state.age)} 岁，手里 ${(state.cash / 10000).toFixed(1)} 万，真正执行了 ${state.log.filter((r) => r.action !== 'skip').length} 条。你也来走一局：`,
              age: state.age,
              cash: state.cash,
              done: state.log.filter((r) => r.action !== 'skip').length,
              state,
              end,
            }),
          }, document.createTextNode('导出结局卡')),
          el('button', { class: 'btn', type: 'button', onclick: () => close() }, document.createTextNode('先关掉')),
          el('button', { class: 'btn btn--primary', type: 'button', onclick: () => restart() }, document.createTextNode('再来一条命')),
        ),
      ),
    );

    R.stage.appendChild(box);
    renderRecent();
  }

  async function restart() {
    const res = await invoke(CH.restart);
    if (!res || !res.ok) return;
    await load();
  }

  // 关闭本面板：优先走 preload 的 close()/window('close')，失败或不可用时退回 window.close()（修复“关不掉”）
  function closePanel() {
    const fallback = () => { try { window.close(); } catch (_) { /* ignore */ } };
    try {
      const p = api && (api.close ? api.close() : api.window ? api.window('close') : api.invoke('app:panel:window', { action: 'close' }));
      if (!p || typeof p.then !== 'function') return fallback();
      p.then((r) => { if (r === false || (r && r.ok === false)) fallback(); }, fallback);
    } catch (_) { fallback(); }
  }
  function close() {
    closePanel();
  }

  // ------------------------------------------------------------------ 启动

  function fallback() {
    // 没有 Electron preload 时（例如单独用浏览器打开本页做视觉检查），
    // 用一份本地演示数据把界面撑起来，方便截图核对布局。
    let state = G.create();
    for (let i = 0; i < 7; i++) {
      state.lastPlayDay = 'x';
      const cards = G.cardsFor(state, new Date(2026, 0, i + 2));
      if (!cards.length) break;
      const r = G.choose(state, cards[i % cards.length].id, i % 4 === 3 ? 'skip' : 'do', new Date(2026, 0, i + 2));
      state = r.state;
    }
    state.lastPlayDay = null;
    return { ok: true, state: G.snapshot(state), cards: G.cardsFor(state).map((c) => ({
      id: c.id, secName: c.secName, title: c.title, plain: c.plain,
      ev: c.ev, money: c.money, time: c.time, will: c.will, channel: G.channelOf(c),
    })) };
  }

  function syncNavButtons() {
    if (R.trialsBtn) R.trialsBtn.className = 'btn ' + (S.view === 'trials' ? 'btn--primary' : 'btn--ghost');
    if (R.longBtn) R.longBtn.className = 'btn ' + (S.view === 'play' ? 'btn--primary' : 'btn--ghost');
    if (R.findBtn) R.findBtn.className = 'btn ' + (S.view === 'find' ? 'btn--primary' : 'btn--ghost');
  }

  // ------------------------------------------------------------------ 三场短试炼（立即可玩 · 高低分分流）

  function renderTrials() {
    S.view = 'trials';
    syncNavButtons();
    if (S.trial) {
      if (S.trial.finished && S.trial.outcome) {
        renderTrialOutcome(S.trial.outcome);
      } else {
        renderTrialRound(S.trial);
      }
      return;
    }

    R.stage.textContent = '';
    R.stage.appendChild(
      el('div', { class: 'hint' },
        el('b', { text: '⚡ 三场短试炼（每场 5 步，随时可玩，不受每天一步限制）' }),
        document.createTextNode(' · 高分（≥75）生成分享卡与「保持清单」，中低分自动定制「专属健康与避坑方案」。'),
      ),
    );

    const grid = el('div', { class: 'cards' });
    const trials = (G && Array.isArray(G.TRIALS)) ? G.TRIALS : [];
    for (const t of trials) {
      const prev = S.trialResults[t.id];
      grid.appendChild(
        el('div', { class: 'card trial-card' },
          el('div', { class: 'card__sec' },
            el('span', { text: `${t.icon} 5 步快速试炼` }),
            prev
              ? el('span', { class: `ev ev--${prev.tier === 'high' ? 'A' : 'B'}`, text: `上次 ${prev.score} 分` })
              : el('span', { class: 'ev ev--A', text: '立即可测' }),
          ),
          el('div', { class: 'card__title', text: t.title }),
          el('div', { class: 'card__plain', text: t.subtitle }),
          el('div', { class: 'card__cost' },
            el('span', { class: 'chip' }, el('b', { text: '节奏 ' }), document.createTextNode('5 步立出结果')),
            el('span', { class: 'chip' }, el('b', { text: '分流 ' }), document.createTextNode('高分分享 / 低分方案')),
          ),
          el('div', { class: 'actions__btns', style: 'margin-top:8px' },
            el('button', {
              class: 'btn btn--primary',
              type: 'button',
              onclick: () => beginTrial(t.id),
            }, document.createTextNode(prev ? '再测一次' : '开始这场试炼')),
            prev
              ? el('button', {
                  class: 'btn btn--ghost',
                  type: 'button',
                  onclick: () => renderTrialOutcome(prev),
                }, document.createTextNode('查看上次报告'))
              : null,
          ),
        ),
      );
    }
    R.stage.appendChild(grid);

    R.stage.appendChild(
      el('div', { class: 'actions' },
        el('span', { class: 'actions__pick', text: '想慢节奏一天走一步？随时可切回「📅 四十步长局」。' }),
        el('div', { class: 'actions__btns' },
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderPlay() }, document.createTextNode('切换到四十步长局')),
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderFind() }, document.createTextNode('打开健康检索')),
        ),
      ),
    );
  }

  function beginTrial(trialId) {
    S.trial = G.startTrial(trialId);
    const hand = (S.trial.hands && S.trial.hands[0]) || [];
    S.trialSelected = hand[0] ? hand[0].id : null;
    renderTrials();
  }

  function renderTrialRound(trial) {
    R.stage.textContent = '';
    const hand = (trial.hands && trial.hands[trial.round]) || [];
    if (!S.trialSelected || !hand.some((c) => c.id === S.trialSelected)) {
      S.trialSelected = hand[0] ? hand[0].id : null;
    }

    R.stage.appendChild(
      el('div', { class: 'hint' },
        el('b', { text: `${trial.icon} ${trial.title} · 第 ${trial.round + 1} / ${trial.total} 步` }),
        document.createTextNode(`（当前试炼得分：${trial.score} 分 · 满 75 分解锁高分保持清单）`),
      ),
    );

    const wrap = el('div', { class: 'cards' });
    for (const card of hand) {
      const sel = S.trialSelected === card.id;
      wrap.appendChild(
        el('button', {
          class: 'card' + (sel ? ' is-sel' : ''),
          type: 'button',
          onclick: () => {
            S.trialSelected = card.id;
            renderTrialRound(trial);
          },
        },
          el('div', { class: 'card__sec' },
            el('span', { text: card.secName }),
            el('span', { class: `ev ev--${card.ev}`, text: `证据 ${card.ev}` }),
          ),
          el('div', { class: 'card__title', text: card.title }),
          el('div', { class: 'card__plain', text: card.plain || '' }),
          el('div', { class: 'card__cost' },
            el('span', { class: 'chip' }, el('b', { text: '钱 ' }), document.createTextNode(COST_TEXT.money[card.money] || '不花钱')),
            el('span', { class: 'chip' }, el('b', { text: '时间 ' }), document.createTextNode(COST_TEXT.time[card.time] || '少')),
            el('span', { class: 'chip' }, el('b', { text: '毅力 ' }), document.createTextNode(COST_TEXT.will[card.will] || '否')),
          ),
        ),
      );
    }
    R.stage.appendChild(wrap);

    const picked = hand.find((c) => c.id === S.trialSelected);
    R.stage.appendChild(
      el('div', { class: 'actions' },
        el('span', { class: 'actions__pick' },
          picked
            ? el('span', null, document.createTextNode('当前选中：'), el('b', { text: picked.title }))
            : el('span', { text: '请点选一张卡片' }),
        ),
        el('div', { class: 'actions__btns' },
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => { S.trial = null; renderTrials(); },
          }, document.createTextNode('← 返回试炼列表')),
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            disabled: picked ? null : '',
            onclick: () => decideTrial('skip'),
          }, document.createTextNode('这步跳过')),
          el('button', {
            class: 'btn btn--primary',
            type: 'button',
            disabled: picked ? null : '',
            onclick: () => decideTrial('do'),
          }, document.createTextNode('执行这条（进入下一步）')),
        ),
      ),
    );
  }

  function decideTrial(action) {
    if (!S.trial || !S.trialSelected) return;
    const res = G.stepTrial(S.trial, S.trialSelected, action);
    if (!res || !res.ok) return;
    S.trial = res.trial;
    if (S.trial.finished && S.trial.outcome) {
      S.trialResults[S.trial.id] = S.trial.outcome;
      renderTrialOutcome(S.trial.outcome);
    } else {
      const nextHand = (S.trial.hands && S.trial.hands[S.trial.round]) || [];
      S.trialSelected = nextHand[0] ? nextHand[0].id : null;
      renderTrialRound(S.trial);
    }
  }

  function renderTrialOutcome(outcome) {
    R.stage.textContent = '';
    const isHigh = outcome.tier === 'high';
    const items = isHigh ? outcome.keepList : outcome.planList;
    const box = el('div', { class: 'result' });

    box.appendChild(
      el('div', { class: 'result__head' },
        el('span', { text: `${outcome.icon} ${outcome.title}` }),
        el('span', { text: '·' }),
        el('span', { class: `ev ev--${isHigh ? 'A' : 'B'}`, text: `${outcome.score} 分 · ${outcome.badge}` }),
      ),
    );
    box.appendChild(
      el('div', { class: 'result__title' },
        document.createTextNode(isHigh ? `🎉 高分通关（${outcome.score} 分）· 你的「保持清单」` : `🩺 试炼诊断（${outcome.score} 分）· 你的「专属健康方案」`),
      ),
    );
    box.appendChild(el('div', { class: 'result__line', text: outcome.headline }));

    const listWrap = el('div', { class: 'find__list', style: 'max-height:220px;overflow:auto' });
    for (const c of items) {
      listWrap.appendChild(
        el('div', { class: 'frow is-checked' },
          el('div', { class: 'frow__body' },
            el('div', { class: 'frow__head' },
              el('b', { text: isHigh ? `✅ 保持：${c.title}` : `📌 方案：${c.title}` }),
              el('span', { class: `ev ev--${c.ev}`, text: `证据 ${c.ev}` }),
              el('span', { class: 'frow__sec', text: c.secName }),
            ),
            el('p', { class: 'frow__plain', text: c.plain || '' }),
          ),
          el('button', {
            class: 'btn btn--ghost frow__share',
            type: 'button',
            onclick: () => openShare({ kind: 'card', title: c.title, plain: c.plain, ev: c.ev, secName: c.secName }),
          }, document.createTextNode('单张分享')),
        ),
      );
    }
    box.appendChild(listWrap);

    box.appendChild(
      el(
        'div',
        {
          class: 'passing',
          style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-radius:12px;background:rgba(255,180,105,0.1);border:1px solid rgba(255,180,105,0.28)',
        },
        el(
          'span',
          {
            text: isHigh
              ? '👑 会员特权：让方块仔永久记住你的高分习惯，免费领「照片定制宠物」+ 每月 100 💎 探险晶石'
              : '🔔 怕三分钟热度？开启会员「21 天桌面健康督促计划」，让方块仔每天盯你落实这 5 条方案！',
          },
        ),
        el(
          'button',
          {
            class: 'btn btn--primary',
            type: 'button',
            style: 'white-space:nowrap;padding:6px 12px;font-size:12px',
            onclick: () => invoke('app:panel:open', { name: 'store' }),
          },
          document.createTextNode('👑 开通会员'),
        ),
      ),
    );

    box.appendChild(
      el('div', { class: 'actions' },
        el('span', { class: 'actions__pick', text: isHigh ? '高分习惯值得分享给关心的人！' : '先从上面最省钱省力的一条开始做起。' }),
        el('div', { class: 'actions__btns' },
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => { S.trial = null; renderTrials(); },
          }, document.createTextNode('← 换一场试炼')),
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => beginTrial(outcome.trialId),
          }, document.createTextNode('🔄 再测一次')),
          el('button', {
            class: 'btn btn--primary',
            type: 'button',
            onclick: () => openShare({
              kind: 'list',
              head: isHigh
                ? `我在「${outcome.shortTitle}」试炼拿到 ${outcome.score} 分！这是我的高性价比保持清单`
                : `我的「${outcome.shortTitle}」专属健康与避坑行动方案（${outcome.score} 分定制）`,
              items,
            }),
          }, document.createTextNode(isHigh ? '📤 生成分享卡 & 保持清单' : '📋 导出专属健康方案卡')),
        ),
      ),
    );

    R.stage.appendChild(box);
  }

  async function load() {
    const res = (await invoke(CH.state)) || fallback();
    if (!res || !res.ok) {
      R.stage.textContent = '';
      R.stage.appendChild(el('div', { class: 'hint' }, document.createTextNode('账本打不开，稍后重启试试。')));
      return;
    }
    S.state = res.state;
    S.cards = res.cards || [];
    S.selected = null;
    renderMeters(S.state);
    renderDuo(S.state);

    // 视觉验收用：?demo=result / wait / ending / find / play 直接把界面推到对应状态
    const demo = new URLSearchParams(location.search).get('demo');
    if (!demo) {
      renderTrials();
      return;
    }
    if (demo === 'play') {
      renderPlay();
      return;
    }
    if (demo === 'find') {
      renderFind();
    } else if (demo === 'result' && S.cards.length) {
      const r = G.choose(S.state, S.cards[0].id, 'do', new Date());
      if (r.result && r.result.ok) {
        S.state = Object.assign({}, r.state, { canPlay: false });
        renderMeters(S.state);
        renderResult(S.state, r.result);
      }
    } else if (demo === 'wait') {
      const waited = Object.assign({}, S.state, { lastPlayDay: G.todayKey(), canPlay: false });
      renderMeters(waited);
      renderWait(waited);
    } else if (demo === 'ending') {
      const dead = Object.assign({}, S.state, { lifeYears: 0 });
      renderEnding(dead, { ended: G.endingOf(dead) });
    }
  }

  R.closeBtn.addEventListener('click', close);
  R.handoffBtn.addEventListener('click', openHandoffSheet);
  if (R.trialsBtn) {
    R.trialsBtn.addEventListener('click', () => {
      S.trial = null;
      renderTrials();
    });
  }
  if (R.longBtn) {
    R.longBtn.addEventListener('click', () => {
      renderPlay();
      syncNavButtons();
    });
  }
  R.findBtn.addEventListener('click', () => {
    if (S.view === 'find') {
      renderTrials();
    } else {
      renderFind();
      syncNavButtons();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.sheet')) closeSheet();
    else close();
  });

  load();
})();
