/* 方块仔插画渲染层（v3.2）
 * 桌宠 / 形象馆 / 设置预览 / 小农场共用。它只做两件事：
 *   1. 按宠物身上已有的状态类（is-walk / is-sleep / eyes--swirl / idle-stretch …）挑一张插画动作帧；
 *   2. 把插画里「身体」那部分换成当前配色，小黄灯、棕色小包/背带、眼睛、腮红、深色描边都不动。
 *
 * 换色不是 hue-rotate（那样灯和包也会被染色），而是逐像素重映射：
 *   每个动作帧配一张身体遮罩（mask/*.png，离线按色相+连通区域抠出来，腮红处软擦除），
 *   遮罩内的像素保持原图的明暗关系，只把色相/饱和度/亮度整体平移到目标主色，
 *   所以高光、暗面、描边的立体感都还在。
 * 用法：CubbitSprite.attach(petEl)  —— 之后宠物身上的类名/配色变化会自动同步
 *       CubbitSprite.hold(petEl, 'dizzy', 1200) —— 临时摆一个动作
 *       CubbitSprite.setAgentPose(petEl, 'listen' | 'think' | 'work' | 'report' | null)
 *       CubbitSprite.url(hex, pose) → Promise<src>  —— 给非宠物 DOM 的预览用 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CubbitSprite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const POSES = ['idle', 'follow', 'walk', 'stretch', 'sleep', 'dizzy', 'discover', 'listen', 'think', 'work', 'report'];
  const AGENT_POSES = ['listen', 'think', 'work', 'report'];
  // 额外的叠加帧：blink 不是独立姿势，只在 idle 时叠在 .pet-art-fx 上随 art-blink 眨眼（和经典方块同一节奏）
  const FRAMES = POSES.concat(['blink']);
  const DIR = '../pet/sprites/';
  const REF_HEX = '#f08a62';
  // 这几种主色就是插画原本的橙红（默认皮肤 / DIY 橙红 / 旧自定义默认），直接用原图，不重算
  const NATIVE = ['#f08a62', '#ff5a1f', '#ef7a52', '#e56b45'];

  const hasDom = typeof document !== 'undefined';
  const cache = new Map(); // `${hex}|${pose}` -> src | Promise
  const loaded = new Map(); // pose -> Promise<{img, mask}>
  const attached = new Set();

  function cleanHex(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    let m = /^#?([0-9a-f]{6})$/.exec(s);
    if (m) return '#' + m[1];
    m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
    if (m) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s);
    if (m) return '#' + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, +x)).toString(16).padStart(2, '0')).join('');
    return '';
  }

  function rgb2hsl(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2, d = mx - mn;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1) + 1e-9);
    let h;
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, Math.min(1, s), l];
  }

  function hsl2rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  function hexHsl(hex) {
    const h = cleanHex(hex) || REF_HEX;
    return rgb2hsl(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  }

  function isNative(hex) {
    const h = cleanHex(hex);
    return !h || NATIVE.includes(h);
  }

  /** 逐像素换色（纯函数，方便测试）：data 是 RGBA Uint8ClampedArray，mask 是同尺寸 RGBA，取 R 通道当权重 */
  function recolor(data, mask, hex) {
    const [h0, s0, l0] = hexHsl(REF_HEX);
    const [ht, st, lt] = hexHsl(hex);
    const sRatio = st / (s0 || 1);
    for (let i = 0; i < data.length; i += 4) {
      const w = mask[i] / 255;
      if (w <= 0.004 || data[i + 3] === 0) continue;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const [h, s, l] = rgb2hsl(r, g, b);
      const dh = ((h - h0 + 540) % 360) - 180;
      const nh = ht + dh * 0.6;
      const ns = Math.max(0, Math.min(1, s * sRatio));
      const nl = l >= l0 ? lt + (l - l0) * (1 - lt) / (1 - l0 + 1e-9) : lt * l / (l0 + 1e-9);
      const [nr, ng, nb] = hsl2rgb(nh, ns, Math.max(0, Math.min(1, nl)));
      data[i] = Math.round((r * (1 - w) + nr * w) * 255);
      data[i + 1] = Math.round((g * (1 - w) + ng * w) * 255);
      data[i + 2] = Math.round((b * (1 - w) + nb * w) * 255);
    }
    return data;
  }

  function fileUrl(pose) { return DIR + pose + '.png'; }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function loadPose(pose) {
    if (loaded.has(pose)) return loaded.get(pose);
    const data = (typeof window !== 'undefined' && window.CUBBIT_SPRITE_DATA) || {};
    const entry = data[pose];
    const p = entry
      ? Promise.all([loadImg(entry.img), loadImg(entry.mask)]).then(([img, mask]) => ({ img, mask }))
      : Promise.reject(new Error('sprite data missing: ' + pose));
    loaded.set(pose, p);
    p.catch(() => loaded.delete(pose));
    return p;
  }

  function pixels(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { c, ctx, id: ctx.getImageData(0, 0, c.width, c.height) };
  }

  /** 取某主色某动作的图片地址。原生橙红直接回原图文件；其它颜色现算并缓存 */
  function url(hex, pose) {
    const ps = FRAMES.includes(pose) ? pose : 'idle';
    if (isNative(hex) || !hasDom) return Promise.resolve(fileUrl(ps));
    const key = cleanHex(hex) + '|' + ps;
    const hit = cache.get(key);
    if (typeof hit === 'string') return Promise.resolve(hit);
    if (hit) return hit;
    const job = loadPose(ps).then(({ img, mask }) => {
      const a = pixels(img);
      const m = pixels(mask);
      recolor(a.id.data, m.id.data, hex);
      a.ctx.putImageData(a.id, 0, 0);
      const src = a.c.toDataURL('image/png');
      cache.set(key, src);
      if (cache.size > 80) cache.delete(cache.keys().next().value);
      return src;
    }).catch((err) => {
      cache.delete(key);
      console.warn('[sprite] recolor failed, using original art', err && err.message);
      return fileUrl(ps);
    });
    cache.set(key, job);
    return job;
  }

  /** 同步取已缓存的地址（没有就返回 null） */
  function cached(hex, pose) {
    if (isNative(hex)) return fileUrl(pose);
    const hit = cache.get(cleanHex(hex) + '|' + pose);
    return typeof hit === 'string' ? hit : null;
  }

  // ------------------------------------------------------------ 状态 → 动作帧
  function has(el, ...names) {
    const c = el.classList;
    for (const n of names) if (c.contains(n)) return true;
    return false;
  }

  function poseOf(el) {
    const d = el.dataset || {};
    if (d.spriteHold && POSES.includes(d.spriteHold)) return d.spriteHold;
    if (d.agentPose && AGENT_POSES.includes(d.agentPose)) return d.agentPose;
    const act = d.idleAct || '';
    const bodyCls = hasDom && document.body ? document.body.classList : null;
    if (has(el, 'is-dizzy', 'is-spin', 'is-trash', 'eyes--swirl', 'eyes--dead')) return 'dizzy';
    if (has(el, 'is-sleep', 'is-drool', 'idle-flop', 'idle-melt', 'eyes--sleepy') || act === 'doze' || (has(el, 'eyes--closed') && has(el, 'fx--zzz'))) return 'sleep';
    if (has(el, 'is-walk', 'is-crawl', 'is-climb', 'is-autonomy-jump')) return 'walk';
    if (has(el, 'idle-stretch') || act === 'stretch' || act === 'yawn' || act === 'sneeze') return 'stretch';
    if (bodyCls && bodyCls.contains('is-listening') && !el.classList.contains('pet-partner')) return 'listen';
    if (has(el, 'eyes--star', 'eyes--sparkle', 'idle-sig', 'is-surprised', 'm-surprised', 'is-land', 'idle-hop') || (has(el, 'fx--sparkle') && !has(el, 'idle-wave'))) return 'discover';
    if (has(el, 'idle-nod', 'is-focus', 'is-drag', 'is-dragged', 'look-left', 'look-right', 'idle-peek', 'idle-sniff', 'idle-tiptoe')) return 'follow';
    if (has(el, 'fx--question', 'mouth--frown', 'eyes--tears', 'fx--gloom', 'fx--sweat', 'eyes--angry', 'is-sad', 'm-sad')) return 'think';
    if (has(el, 'idle-wave', 'eyes--crescent', 'eyes--heart', 'mouth--laugh', 'fx--heart', 'is-happy', 'm-happy', 'is-poked')) return 'report';
    if (has(el, 'eyes--look', 'eyes--half')) return 'follow';
    return 'idle';
  }

  function bodyHex(el) {
    let v = el.style.getPropertyValue('--body2');
    if (!v && hasDom && el.isConnected) v = getComputedStyle(el).getPropertyValue('--body2');
    return cleanHex(v) || REF_HEX;
  }

  function paint(el) {
    if (!el || !el.classList.contains('sprite-form')) return;
    const img = el.querySelector('.pet-art');
    if (!img) return;
    const pose = poseOf(el);
    const hex = bodyHex(el);
    const want = hex + '|' + pose;
    if (el.dataset.spritePose !== pose) el.dataset.spritePose = pose;
    if (el._spriteBlink) paintBlink(img, hex);
    if (img.dataset.want === want && img.getAttribute('src')) return;
    img.dataset.want = want;
    const now = cached(hex, pose);
    if (now) { if (img.getAttribute('src') !== now) img.setAttribute('src', now); return; }
    url(hex, pose).then((src) => {
      if (img.dataset.want !== want) return; // 期间状态又变了
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
    // 后台把这只颜色的其它动作也算好，切换时不闪
    warm(hex);
  }

  /** 闭眼叠加帧：跟着当前主色准备好，CSS 只在 idle + art-blink 时把它点亮（opacity 切换，不重新解码不闪） */
  function paintBlink(img, hex) {
    const fx = img.parentElement && img.parentElement.querySelector('.pet-art-fx');
    if (!fx) return;
    const want = cleanHex(hex) + '|blink';
    if (fx.dataset.want === want && fx.getAttribute('src')) return;
    fx.dataset.want = want;
    const now = cached(hex, 'blink');
    if (now) { fx.setAttribute('src', now); return; }
    url(hex, 'blink').then((src) => { if (fx.dataset.want === want) fx.setAttribute('src', src); });
  }

  const warming = new Set();
  function warm(hex) {
    const h = cleanHex(hex);
    if (!h || isNative(h) || warming.has(h)) return;
    warming.add(h);
    const idle = (typeof requestIdleCallback === 'function') ? requestIdleCallback : (fn) => setTimeout(fn, 60);
    let i = 0;
    const next = () => { if (i >= FRAMES.length) return; url(h, FRAMES[i++]).then(() => idle(next)); };
    idle(next);
  }

  let rafPending = false;
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    const run = () => {
      rafPending = false;
      for (const el of attached) {
        if (el.isConnected) { el._spriteSeen = true; paint(el); }
        else if (el._spriteSeen) detach(el); // 宠物被移除：停止监听，避免泄漏
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
  }

  /** 让某只宠物走插画渲染：挂类名、清掉旧位图、监听状态变化 */
  function attach(el, opts) {
    if (!el || !hasDom) return el;
    el._spriteBlink = !!(opts && opts.blink);
    el.classList.add('art-form', 'sprite-form');
    const fx = el.querySelector('.pet-art-fx');
    if (fx) { if (fx.hasAttribute('src')) fx.removeAttribute('src'); delete fx.dataset.want; }
    if (!el._spriteObs && typeof MutationObserver === 'function') {
      el._spriteObs = new MutationObserver(schedule);
      el._spriteObs.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-idle-act', 'data-sprite-hold', 'data-agent-pose'] });
    }
    attached.add(el);
    paint(el);
    if (!el.isConnected) setTimeout(() => paint(el), 0);
    return el;
  }

  function detach(el) {
    if (!el) return el;
    if (el._spriteObs) { el._spriteObs.disconnect(); el._spriteObs = null; }
    attached.delete(el);
    if (el.classList.contains('sprite-form')) {
      el.classList.remove('sprite-form', 'art-form');
      const img = el.querySelector('.pet-art');
      if (img) { img.removeAttribute('src'); delete img.dataset.want; }
      const fx = el.querySelector('.pet-art-fx');
      if (fx) { fx.removeAttribute('src'); delete fx.dataset.want; }
      delete el.dataset.spritePose;
    }
    return el;
  }

  function refresh(el) { if (el) paint(el); else schedule(); }

  function hold(el, pose, ms) {
    if (!el || !POSES.includes(pose)) return;
    el.dataset.spriteHold = pose;
    clearTimeout(el._spriteHoldTimer);
    el._spriteHoldTimer = setTimeout(() => { if (el.dataset.spriteHold === pose) delete el.dataset.spriteHold; }, Math.max(100, ms || 1200));
  }

  function setAgentPose(el, pose) {
    if (!el) return;
    if (pose && AGENT_POSES.includes(pose)) el.dataset.agentPose = pose;
    else delete el.dataset.agentPose;
  }

  // body 上的 is-listening 也会影响姿势
  if (hasDom && typeof MutationObserver === 'function') {
    const hook = () => { if (document.body) new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] }); };
    if (document.body) hook(); else document.addEventListener('DOMContentLoaded', hook);
  }

  return { POSES, AGENT_POSES, FRAMES, DIR, REF_HEX, cleanHex, isNative, recolor, url, cached, poseOf, attach, detach, refresh, hold, setAgentPose, fileUrl };
});
