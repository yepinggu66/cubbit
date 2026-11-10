/**
 * 相亲角 —— 写需求、看候选、等回信、谈恋爱。
 *
 * 界面只做一件事：把"看起来合适"和"其实不合适"同时摆出来。
 * 所以每张候选卡下面必须有两组话：像的地方（绿）和差得远的地方（橙）。
 * 只夸不挑的功能，用户第一次见面就会知道是假的。
 *
 * IPC：mate:state / mate:seek / mate:propose / mate:retry / mate:confirm / mate:breakup
 */
(function () {
  'use strict';

  const M = window.CUBBIT_MATE;
  const DIY = window.CUBBIT_DIY;
  const api = (window.cubbit && window.cubbit.panel) || null;

  const CH = {
    state: 'mate:state',
    seek: 'mate:seek',
    propose: 'mate:propose',
    retry: 'mate:retry',
    confirm: 'mate:confirm',
    breakup: 'mate:breakup',
    photoList: 'pet:photo:list',
    panelWindow: 'app:panel:window',
  };

  const R = {
    selfCard: document.getElementById('selfCard'),
    wish: document.getElementById('wish'),
    wishText: document.getElementById('wishText'),
    sliders: document.getElementById('sliders'),
    seekBtn: document.getElementById('seekBtn'),
    seekTip: document.getElementById('seekTip'),
    listCol: document.getElementById('listCol'),
    statusPill: document.getElementById('statusPill'),
    footNote: document.getElementById('footNote'),
    historyNote: document.getElementById('historyNote'),
    closeBtn: document.getElementById('closeBtn'),
  };

  const S = {
    snap: null,
    ownArt: '../assets/pets/classic-cube.png',
    ownName: '方块仔',
    busy: false,
    pact: false,
  };

  const ART = (name) => `../assets/pets/${name}-idle-01.webp`;

  function invoke(channel, payload) {
    if (!api) return Promise.resolve(null);
    return api.invoke(channel, payload).catch((err) => {
      console.warn('[mate] invoke failed', channel, err);
      return null;
    });
  }

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) node.appendChild(kid);
    return node;
  }

  function note(text) {
    R.footNote.textContent = text;
  }

  // ------------------------------------------------------------------ 自己

  function renderSelf(snap) {
    R.selfCard.textContent = '';
    const rel = snap && snap.relation;
    const traits = (snap && snap.desire && snap.desire.expect) || {};
    const bars = M.TRAITS.slice(0, 3).map((t) =>
      el('div', { class: 'mini' },
        el('span', { text: t.label }),
        el('i', null, el('em', { style: `width:${Math.round(traits[t.id] || 40)}%` })),
      ),
    );
    R.selfCard.append(
      el('div', { class: 'self__art' }, el('img', { src: S.ownArt, alt: S.ownName })),
      el('div', { class: 'self__meta' },
        el('b', { text: S.ownName }),
        el('p', {
          text: rel
            ? `正在和 ${rel.name} 谈，第 ${rel.days || 1} 天。`
            : '单身。想要什么样的，可以自己写。',
        }),
        el('div', { class: 'self__bars' }, ...bars),
      ),
    );
  }

  // ------------------------------------------------------------------ 需求

  function renderSliders(desire) {
    const expect = (desire && desire.expect) || {};
    R.sliders.textContent = '';
    for (const t of M.TRAITS.slice(0, 3)) {
      const input = el('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(expect[t.id] == null ? 50 : expect[t.id])),
        dataset: { trait: t.id },
      });
      const label = el('span', { class: 'slider__val', text: t.low });
      const sync = () => {
        const v = Number(input.value);
        label.textContent = v >= 66 ? t.high : v <= 33 ? t.low : '中间';
      };
      input.addEventListener('input', sync);
      sync();
      R.sliders.appendChild(
        el('div', { class: 'slider' }, el('span', { text: t.label }), input, label),
      );
    }
    R.wishText.value = (desire && desire.text) || '';
  }

  function desireInput() {
    const out = { text: R.wishText.value.trim() };
    for (const input of R.sliders.querySelectorAll('input[type="range"]')) {
      out[input.dataset.trait] = Number(input.value);
    }
    return out;
  }

  // ------------------------------------------------------------------ 候选

  function fitClass(score) {
    return score >= 74 ? 'fit--high' : score >= 56 ? 'fit--mid' : 'fit--low';
  }

  function candidateCard(cand) {
    const fit = cand.fit || { score: 0, reasons: [], gaps: [] };
    const reasons = (fit.reasons || []).map((r) => el('li', { text: r.text }));
    const gaps = (fit.gaps || []).map((r) => el('li', { text: r.text }));
    return el('article', { class: 'cand' },
      el('div', { class: 'cand__art' },
        el('img', { src: ART(cand.art || 'cube'), alt: cand.name }),
      ),
      el('div', { class: 'cand__main' },
        el('div', { class: 'cand__head' },
          el('b', { text: cand.name }),
          el('span', { class: 'species', text: `${cand.emoji || ''} ${cand.speciesLabel || ''} · 走了 ${cand.steps || 0} 步` }),
          el('span', { class: `fit ${fitClass(fit.score)}`, text: `${fit.score} 分` }),
        ),
        el('p', { class: 'cand__bio', text: cand.bio || '' }),
        reasons.length ? el('ul', { class: 'why' }, ...reasons) : null,
        gaps.length ? el('ul', { class: 'why why--bad' }, ...gaps) : null,
        el('div', { class: 'cand__acts' },
          el('button', { class: 'btn btn--primary', type: 'button', onclick: () => propose(cand.id) }, document.createTextNode('发出邀请')),
        ),
      ),
    );
  }

  function renderCandidates(snap) {
    R.listCol.textContent = '';
    if (snap.status === 'dating') return renderCouple(snap);
    if (snap.status === 'proposed') return renderReply(snap);

    const cands = snap.candidates || [];
    if (!cands.length) {
      R.listCol.appendChild(
        el('div', { class: 'empty' },
          el('b', { text: '先说清楚要找什么样的' }),
          document.createTextNode('左边写完，点「开始找」。候选来自同一天在线的单身宠物；离线时用本地缘分池，流程一样。'),
        ),
      );
      return;
    }
    R.listCol.appendChild(
      el('div', { class: 'listHead' },
        el('b', { text: `今天遇到 ${cands.length} 只` }),
        el('span', { text: '按契合度排序，差得远的地方也写着' }),
      ),
    );
    for (const cand of cands.slice().sort((a, b) => (b.fit.score - a.fit.score))) {
      R.listCol.appendChild(candidateCard(cand));
    }
  }

  // ------------------------------------------------------------------ 回信

  function renderReply(snap) {
    R.listCol.textContent = '';
    const picked = snap.picked || {};
    const reply = snap.reply || {};
    const decision = reply.decision || 'hesitate';
    const head = {
      accept: `答应得很快`,
      conditional: '它提了一个条件',
      hesitate: '它还想再看看',
      decline: '它婉拒了',
    }[decision] || '它回信了';

    const pactBox = el('div', { class: 'reply__pact' },
      el('b', { text: head }),
      el('label', null,
        el('input', {
          type: 'checkbox',
          checked: S.pact ? 'checked' : null,
          onchange: (e) => {
            S.pact = !!e.target.checked;
            renderReply(S.snap);
          },
        }),
        document.createTextNode(reply.pact ? reply.pact.label : ''),
      ),
    );

    const acts = el('div', { class: 'reply__acts' });
    if (decision === 'decline') {
      acts.appendChild(el('button', { class: 'btn btn--primary', type: 'button', onclick: () => seek() }, document.createTextNode('换一批人看看')));
    } else if (decision === 'hesitate') {
      if (snap.canRetry) {
        acts.appendChild(el('button', { class: 'btn btn--primary', type: 'button', onclick: () => retry() }, document.createTextNode('再争取一次')));
      } else {
        acts.appendChild(el('button', { class: 'btn btn--primary', type: 'button', onclick: () => seek() }, document.createTextNode('换一批人看看')));
      }
    } else {
      acts.appendChild(
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: () => confirmRelation(),
        }, document.createTextNode('我也愿意，确定关系')),
      );
    }
    acts.appendChild(el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => seek() }, document.createTextNode('算了，重新找')));

    R.listCol.appendChild(
      el('div', { class: 'reply' },
        el('div', { class: 'reply__from' },
          el('img', { src: ART(picked.art || 'cube'), alt: picked.name || '' }),
          el('b', { text: picked.name || '对方' }),
          el('span', { class: 'fit ' + fitClass(reply.score || 0), text: `${reply.score || 0} 分` }),
        ),
        el('div', { class: 'reply__line', text: reply.line || '' }),
        decision === 'conditional' ? pactBox : null,
        decision === 'hesitate' ? el('p', { class: 'hint', text: '再争取只能用一次。它说想再看看，就是真的还没想清楚。' }) : null,
        decision === 'decline' ? el('p', { class: 'hint', text: '被拒不是失败：它的分数和你的需求差得远，早点知道比拖着好。' }) : null,
        acts,
      ),
    );
  }

  // ------------------------------------------------------------------ 恋爱

  function renderCouple(snap) {
    R.listCol.textContent = '';
    const rel = snap.relation || {};
    R.listCol.appendChild(
      el('div', { class: 'couple' },
        el('div', { class: 'couple__arts' },
          el('img', { src: S.ownArt, alt: S.ownName }),
          el('span', { class: 'couple__heart', text: '💗' }),
          el('img', { src: ART(rel.art || 'cube'), alt: rel.name || '' }),
        ),
        el('div', { class: 'couple__name', text: `${S.ownName} 和 ${rel.name || '它'}` }),
        el('div', { class: 'couple__sub', text: rel.score ? `在一起的第 ${rel.days || 1} 天 · 契合度 ${rel.score} 分` : '' }),
        el('div', { class: 'couple__grid' },
          el('div', { class: 'couple__cell' }, el('span', { text: '在一起' }), el('b', { text: `${rel.days || 1} 天` })),
          el('div', { class: 'couple__cell' }, el('span', { text: '契合度' }), el('b', { text: `${rel.score || 0} 分` })),
          el('div', { class: 'couple__cell' }, el('span', { text: '它走了' }), el('b', { text: `${(snap.picked && snap.picked.steps) || 0} 步` })),
        ),
        rel.pact ? el('p', { class: 'couple__pact', text: `你们之间的约定：${rel.pact}` }) : null,
        el('div', { class: 'reply__acts' },
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, document.createTextNode('回去陪它')),
          el('button', { class: 'btn btn--danger', type: 'button', onclick: () => breakup() }, document.createTextNode('分开')),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ 动作

  function setSnap(snap) {
    if (!snap || !snap.ok) return;
    S.snap = snap;
    R.statusPill.textContent = snap.status === 'dating' ? '恋爱中' : snap.status === 'proposed' ? '在等回信' : '单身';
    R.statusPill.className = 'pill' + (snap.status === 'dating' ? ' pill--dating' : '');
    R.wish.hidden = snap.status === 'dating';
    renderSelf(snap);
    renderSliders(snap.desire);
    renderCandidates(snap);

    const hist = snap.history || [];
    const proposed = hist.filter((h) => h.kind === 'propose').length;
    R.historyNote.textContent = proposed ? `相过 ${proposed} 次亲` : '';
  }

  async function seek() {
    if (S.busy) return;
    S.busy = true;
    R.seekBtn.disabled = true;
    R.seekBtn.textContent = '正在找……';
    const res = await invoke(CH.seek, desireInput());
    S.busy = false;
    R.seekBtn.disabled = false;
    R.seekBtn.textContent = '开始找';
    if (!res || !res.ok) {
      note((res && res.message) || '这次没找到，稍后再试。');
      return;
    }
    S.pact = false;
    setSnap(res);
    note(res.source === 'remote' ? '候选来自在线的单身宠物。' : '候选来自本地缘分池（没连上服务时也能用）。');
  }

  async function propose(id) {
    if (S.busy) return;
    S.busy = true;
    const res = await invoke(CH.propose, { id });
    S.busy = false;
    if (!res || !res.ok) {
      note((res && res.message) || '邀请没发出去。');
      return;
    }
    S.pact = false;
    setSnap(res);
    note('等回信。对方要先点头，这件事才算成一半。');
  }

  async function retry() {
    const res = await invoke(CH.retry);
    if (!res || !res.ok) {
      note((res && res.message) || '不能再争取了。');
      return;
    }
    setSnap(res);
    note('第二次争取，成了就成了，不成也别缠着。');
  }

  async function confirmRelation() {
    const res = await invoke(CH.confirm, { acceptPact: S.pact });
    if (!res || !res.ok) {
      note((res && res.message) || '还差一步。');
      return;
    }
    setSnap(res);
    note('两边都点头了，从今天开始算。');
  }

  async function breakup() {
    const res = await invoke(CH.breakup);
    if (!res || !res.ok) return;
    setSnap(res);
    note('分开了。它不会闹，但今天会安静一点。');
  }

  function close() {
    if (api) api.invoke(CH.panelWindow, { action: 'close' });
  }

  // ------------------------------------------------------------------ 演示态

  /** ?demo=candidates|reply|dating 直接把界面推到对应状态，用于视觉验收。 */
  function demo(kind) {
    const cands = M.makeCandidates({ seed: 'demo', count: 4 });
    const desire = M.parseDesire({ text: '想找个安静一点的，能一起吃饭，别太能花钱', warmth: 62, thrift: 68 });
    let state = M.seek(M.blank(), desire, cands);
    if (kind === 'reply' || kind === 'dating') {
      const best = cands
        .map((c) => ({ c, s: M.score(c, desire).score }))
        .sort((a, b) => b.s - a.s)[0].c;
      const prop = M.propose(state, best.id);
      state = prop.state;
      if (kind === 'dating') {
        const r = M.confirm(state, { acceptPact: true });
        if (r.ok) state = r.state;
      }
    }
    const snap = M.snapshot(state);
    return {
      ok: true,
      status: snap.status,
      desire: snap.desire,
      candidates: snap.candidates.map((c) => Object.assign({}, c, { fit: M.score(c, snap.desire) })),
      picked: snap.picked,
      reply: snap.reply,
      relation: snap.relation,
      attempts: snap.attempts,
      history: snap.history,
      canRetry: snap.canRetry,
    };
  }

  // ------------------------------------------------------------------ 启动

  async function boot() {
    // 照片宠物要先注册，DIY.artFile 才认识它们；否则自己那只永远显示方块仔
    if (api) {
      const photos = await invoke(CH.photoList);
      if (photos && photos.ok && photos.items && photos.items.length) {
        DIY.registerPhotoPets(photos.items);
      }
      const app = await api.state();
      const diy = DIY.normalize(app && app.settings && app.settings.diyPet);
      if (diy.enabled && diy.animalId === 'custom') {
        // 经典方块仔：静态头像用 classic-cube.png
        S.ownArt = '../assets/pets/classic-cube.png';
      } else if (diy.enabled && diy.animalId === DIY.EXPLORER_ID) {
        // 探险方块仔：插画 idle 帧，按用户配色只给身体换色
        if (window.CubbitSprite) S.ownArt = await window.CubbitSprite.url(DIY.palette(diy).body2, 'idle');
      } else if (diy.enabled) {
        S.ownArt = DIY.artFile(diy.animalId, 'idle') || S.ownArt;
        const actor = DIY.animalById(diy.animalId) || (DIY.isPhotoId(diy.animalId) ? DIY.photoPets().find((p) => p.id === diy.animalId) : null);
        if (actor && actor.label) S.ownName = actor.label;
      }
    }

    const demoKind = new URLSearchParams(location.search).get('demo');
    if (demoKind) {
      setSnap(demo(demoKind));
      return;
    }

    const res = await invoke(CH.state);
    if (!res || !res.ok) {
      R.listCol.appendChild(el('div', { class: 'empty' }, el('b', { text: '相亲角打不开' }), document.createTextNode('稍后重启试试。')));
      renderSliders(null);
      return;
    }
    setSnap(res);
  }

  R.seekBtn.addEventListener('click', seek);
  R.closeBtn.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  boot();
})();
