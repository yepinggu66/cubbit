/**
 * 照片 → 桌宠 的像素处理（纯函数，不碰 Electron / 文件系统）。
 *
 * 为什么自己写：这台机器上没有 sharp / canvas 原生依赖，而 Electron 的
 * nativeImage 只能解码、缩放、裁切，不会抠背景。所以把它拆成两层：
 *   main/petforge.js —— 解码/缩放/编码（nativeImage）
 *   shared/petphoto.js —— 像素（本文件，node --test 可直接测）
 *
 * 管线（顺序有意义，不能换）：
 *   抠底 → 修边（羽化 + 去黑边） → 归一化构图 → 调色 → 补边缘光 → 生成闭眼帧
 *
 * 归一化用「角色高度占画布 86%、脚底落在 96%」这条家规，
 * 只有和 12 只内置形象同一套比例，换形象时才不会突然变大变小。
 *
 * 图像约定：{ data: Uint8ClampedArray(RGBA), width, height }，
 * 坐标原点左上。所有函数返回新对象，除标注 in-place 的以外不改入参。
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (typeof window !== 'undefined') window.CUBBIT_PETPHOTO = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 512;
  const BODY_RATIO = 0.86;
  const FOOT_Y = 0.96;

  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function create(width, height) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }

  function clone(img) {
    return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  }

  function at(img, x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  }

  // ------------------------------------------------------------------ 抠底

  /**
   * 从四边向内做连通域洪水填充，把"和边缘同色且连通"的像素判为背景。
   * tol 是每通道欧氏距离的均值容差（0-255），默认 46：能吃掉渐变阴影，
   * 又不会把浅色毛发一起吃掉。
   */
  function cutout(img, opts = {}) {
    const tol = Number(opts.tol) || 46;
    const w = img.width;
    const h = img.height;
    const src = img.data;
    const out = clone(img);

    // 种子色：四条边的中位数色，比"左上角单点"稳得多
    const samples = [];
    const stepX = Math.max(1, Math.floor(w / 64));
    const stepY = Math.max(1, Math.floor(h / 64));
    for (let x = 0; x < w; x += stepX) {
      samples.push(at(img, x, 0), at(img, x, h - 1));
    }
    for (let y = 0; y < h; y += stepY) {
      samples.push(at(img, 0, y), at(img, w - 1, y));
    }
    const med = (idx) => {
      const arr = samples.map((s) => s[idx]).sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)] || 255;
    };
    const seed = [med(0), med(1), med(2)];

    const near = (i) => {
      const dr = src[i] - seed[0];
      const dg = src[i + 1] - seed[1];
      const db = src[i + 2] - seed[2];
      return (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3 <= tol;
    };

    const mask = new Uint8Array(w * h); // 1 = 背景
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = y * w + x;
      if (mask[p]) return;
      if (!near(p * 4)) return;
      mask[p] = 1;
      stack.push(p);
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }

    let bg = 0;
    for (let p = 0; p < w * h; p++) {
      if (!mask[p]) continue;
      bg++;
      out.data[p * 4 + 3] = 0;
    }
    // 毛发缝隙里漏出来的背景（luma 很低且本身没什么饱和）判透明：
    // 不这么做，边缘会有一圈"黑描边"，其实是背景透出来的。
    // 但只处理紧贴背景的那一圈——否则深色的眼睛、鼻子会被一起抹掉。
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const i = p * 4;
        if (out.data[i + 3] === 0) continue;
        const touchesBg =
          mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w];
        if (!touchesBg) continue;
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (luma(r, g, b) < 46 && mx - mn < 26) out.data[i + 3] = 0;
      }
    }

    const bgRatio = bg / (w * h);
    return { img: out, bgRatio, seed, ok: bgRatio > 0.06 && bgRatio < 0.965 };
  }

  /** 羽化 alpha：只在边缘 softening，内部不糊。 */
  function feather(img, radius = 1) {
    const r = Math.max(1, Math.round(radius));
    const { width: w, height: h } = img;
    const out = clone(img);
    const a = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const self = a[i + 3];
        if (self === 0 || self === 255) continue;
        let sum = 0;
        let n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += a[(yy * w + xx) * 4 + 3];
            n++;
          }
        }
        out.data[i + 3] = n ? Math.round(sum / n) : self;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ 构图

  function alphaBBox(img, threshold = 24) {
    const { width: w, height: h, data } = img;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] <= threshold) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  /** 双线性重采样；先预乘 alpha，避免透明边缘带出一圈深色。 */
  function resample(src, srcRect, dw, dh) {
    const out = create(dw, dh);
    const sx = src.width;
    const sd = src.data;
    const { x: rx, y: ry, width: rw, height: rh } = srcRect;
    for (let y = 0; y < dh; y++) {
      const sy = ry + ((y + 0.5) / dh) * rh - 0.5;
      const y0 = Math.floor(sy);
      const wy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sxx = rx + ((x + 0.5) / dw) * rw - 0.5;
        const x0 = Math.floor(sxx);
        const wx = sxx - x0;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (const [ox, oy, wt] of [
          [0, 0, (1 - wx) * (1 - wy)],
          [1, 0, wx * (1 - wy)],
          [0, 1, (1 - wx) * wy],
          [1, 1, wx * wy],
        ]) {
          const px = clamp(x0 + ox, 0, src.width - 1);
          const py = clamp(y0 + oy, 0, src.height - 1);
          const i = (py * sx + px) * 4;
          const al = sd[i + 3] / 255;
          r += sd[i] * al * wt;
          g += sd[i + 1] * al * wt;
          b += sd[i + 2] * al * wt;
          a += sd[i + 3] * wt;
        }
        const o = (y * dw + x) * 4;
        const alpha = a;
        const norm = alpha > 0 ? 255 / alpha : 0;
        out.data[o] = r * norm;
        out.data[o + 1] = g * norm;
        out.data[o + 2] = b * norm;
        out.data[o + 3] = alpha;
      }
    }
    return out;
  }

  /**
   * 归一化：角色高度占画布 BODY_RATIO，脚底落在 FOOT_Y，水平居中。
   * 和 12 只内置形象用同一套规则，换形象时尺寸不会跳。
   */
  function normalize(img, opts = {}) {
    const size = opts.size || SIZE;
    const ratio = opts.ratio || BODY_RATIO;
    const footY = opts.footY == null ? FOOT_Y : opts.footY;
    const box = alphaBBox(img);
    if (!box) return create(size, size);

    const destH = size * ratio;
    const destW = destH * (box.width / box.height);
    const destX = size / 2 - destW / 2;
    const destY = size * footY - destH;

    const out = create(size, size);
    const sd = img.data;
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5 - destY) / destH;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5 - destX) / destW;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const fx = box.x + u * box.width - 0.5;
        const fy = box.y + v * box.height - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const wx = fx - x0;
        const wy = fy - y0;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (const [ox, oy, wt] of [
          [0, 0, (1 - wx) * (1 - wy)],
          [1, 0, wx * (1 - wy)],
          [0, 1, (1 - wx) * wy],
          [1, 1, wx * wy],
        ]) {
          const px = clamp(x0 + ox, 0, img.width - 1);
          const py = clamp(y0 + oy, 0, img.height - 1);
          const i = (py * img.width + px) * 4;
          const al = sd[i + 3] / 255;
          r += sd[i] * al * wt;
          g += sd[i + 1] * al * wt;
          b += sd[i + 2] * al * wt;
          a += sd[i + 3] * wt;
        }
        const o = (y * size + x) * 4;
        const norm = a > 0 ? 255 / a : 0;
        out.data[o] = r * norm;
        out.data[o + 1] = g * norm;
        out.data[o + 2] = b * norm;
        out.data[o + 3] = a;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ 调色

  /** 饱和度 / 亮度 / 对比度微调，只碰不透明像素。 */
  function stylize(img, opts = {}) {
    const sat = opts.sat == null ? 1.08 : opts.sat;
    const bright = opts.bright == null ? 1.03 : opts.bright;
    const contrast = opts.contrast == null ? 1.04 : opts.contrast;
    const out = clone(img);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      const gray = luma(r, g, b);
      r = gray + (r - gray) * sat;
      g = gray + (g - gray) * sat;
      b = gray + (b - gray) * sat;
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
      d[i] = clamp(r * bright, 0, 255);
      d[i + 1] = clamp(g * bright, 0, 255);
      d[i + 2] = clamp(b * bright, 0, 255);
    }
    return out;
  }

  /**
   * 边缘光：内置形象都有一圈柔光轮廓，照片宠物没有，
   * 直接放桌面会和其它形象不像"同一套资产"。这里补一圈。
   */
  function rimLight(img, opts = {}) {
    const width = Math.max(1, Math.round(opts.width || 2));
    const strength = opts.strength == null ? 0.5 : opts.strength;
    const color = opts.color || [255, 248, 240];
    const { width: w, height: h } = img;
    const out = clone(img);
    const a = img.data;
    const band = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (a[i + 3] < 90) continue;
        let edge = false;
        for (let d = 1; d <= width && !edge; d++) {
          if (x - d < 0 || x + d >= w || y - d < 0 || y + d >= h) {
            edge = true;
            break;
          }
          if (
            a[(y * w + (x - d)) * 4 + 3] < 90 ||
            a[(y * w + (x + d)) * 4 + 3] < 90 ||
            a[((y - d) * w + x) * 4 + 3] < 90 ||
            a[((y + d) * w + x) * 4 + 3] < 90
          ) {
            edge = true;
          }
        }
        if (edge) band[y * w + x] = 1;
      }
    }
    for (let p = 0; p < w * h; p++) {
      if (!band[p]) continue;
      const i = p * 4;
      const k = strength;
      out.data[i] = a[i] * (1 - k) + color[0] * k;
      out.data[i + 1] = a[i + 1] * (1 - k) + color[1] * k;
      out.data[i + 2] = a[i + 2] * (1 - k) + color[2] * k;
    }
    return out;
  }

  // ------------------------------------------------------------------ 闭眼帧

  /**
   * 找眼睛：上半身区域里成对、尺寸接近、左右分开的深色连通块。
   * 找不到就老实返回 null——宁可不眨眼，也不要给鼻子画一条眼皮。
   */
  function detectEyes(img) {
    const { width: w, height: h, data } = img;
    const yLimit = Math.floor(h * 0.62);
    const W = w;
    const dark = new Uint8Array(W * h);
    for (let y = 0; y < yLimit; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (data[i + 3] < 160) continue;
        if (luma(data[i], data[i + 1], data[i + 2]) > 78) continue;
        dark[y * W + x] = 1;
      }
    }

    const label = new Int32Array(W * h).fill(-1);
    const blobs = [];
    const stack = [];
    for (let p = 0; p < W * yLimit; p++) {
      if (!dark[p] || label[p] >= 0) continue;
      const id = blobs.length;
      let minX = W;
      let maxX = -1;
      let minY = h;
      let maxY = -1;
      let area = 0;
      stack.push(p);
      label[p] = id;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % W;
        const qy = (q - qx) / W;
        area++;
        if (qx < minX) minX = qx;
        if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy;
        if (qy > maxY) maxY = qy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= yLimit) continue;
          const np = ny * W + nx;
          if (!dark[np] || label[np] >= 0) continue;
          label[np] = id;
          stack.push(np);
        }
      }
      blobs.push({ id, area, minX, maxX, minY, maxY });
    }

    const total = W * h;
    const cands = blobs
      .filter((b) => {
        const bw = b.maxX - b.minX + 1;
        const bh = b.maxY - b.minY + 1;
        if (b.area < total * 0.0004 || b.area > total * 0.04) return false;
        const ar = bw / bh;
        return ar > 0.45 && ar < 2.6;
      })
      .map((b) => ({
        cx: (b.minX + b.maxX) / 2,
        cy: (b.minY + b.maxY) / 2,
        rx: Math.max(2, (b.maxX - b.minX + 1) / 2),
        ry: Math.max(2, (b.maxY - b.minY + 1) / 2),
        area: b.area,
      }));

    let best = null;
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        const a = cands[i];
        const b = cands[j];
        const dx = Math.abs(a.cx - b.cx);
        const dy = Math.abs(a.cy - b.cy);
        const sizeRatio = Math.min(a.rx, b.rx) / Math.max(a.rx, b.rx);
        if (dx < w * 0.12 || dx > w * 0.62) continue;
        if (dy > h * 0.09) continue;
        if (sizeRatio < 0.55) continue;
        const q = sizeRatio * 2 - dy / (h * 0.09) - Math.abs(dx / w - 0.3);
        if (!best || q > best.q) best = { q, a, b };
      }
    }
    if (!best) return null;
    const pair = best.a.cx <= best.b.cx ? [best.a, best.b] : [best.b, best.a];
    return pair.map((e) => ({ x: e.cx, y: e.cy, rx: e.rx, ry: e.ry }));
  }

  /** 画闭眼：一条比眼睛窄一点的弯月，外加一点点睫毛。 */
  function drawBlink(img, eyes, opts = {}) {
    if (!eyes || eyes.length !== 2) return img;
    const out = clone(img);
    const { width: w, height: h } = img;
    const color = opts.color || [58, 40, 34];
    const put = (x, y, alpha) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      if (out.data[i + 3] === 0) return;
      const k = clamp(alpha, 0, 1);
      out.data[i] = out.data[i] * (1 - k) + color[0] * k;
      out.data[i + 1] = out.data[i + 1] * (1 - k) + color[1] * k;
      out.data[i + 2] = out.data[i + 2] * (1 - k) + color[2] * k;
    };
    for (const e of eyes) {
      const rx = clamp(e.rx * 1.15, 3, w);
      const ry = clamp(e.ry * 0.5, 2, h);
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
        for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
          const u = dx / rx;
          const v = (dy - ry * 0.55 * (1 - u * u)) / ry; // 向下弯
          const d = u * u + v * v;
          if (d > 1) continue;
          const a = d > 0.72 ? 0.55 : 0.94;
          put(Math.round(e.x + dx), Math.round(e.y + dy), a);
        }
      }
      // 睫毛：两端各挑一点
      for (const s of [-1, 1]) {
        const bx = Math.round(e.x + s * rx * 0.95);
        const by = Math.round(e.y - ry * 0.15);
        put(bx, by, 0.8);
        put(bx + s, by - 1, 0.6);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ 一步到位

  /**
   * 完整管线。返回 {idle, blink, meta}。
   * meta 里带上每一步的判断，方便 UI 如实说"这次抠得不太干净，建议换张图"。
   */
  function build(img, opts = {}) {
    const cut = cutout(img, { tol: opts.tol });
    let work = feather(cut.img, 1);
    const box = alphaBBox(work);
    if (!box) return { ok: false, code: 'EMPTY', message: '这张图里没找到能抠出来的主体。' };

    work = normalize(work, { size: opts.size || SIZE });
    work = stylize(work, opts);
    work = rimLight(work, { width: 2, strength: opts.rim == null ? 0.42 : opts.rim });

    const eyes = opts.blink === false ? null : detectEyes(work);
    const blink = eyes ? drawBlink(work, eyes, opts) : null;

    return {
      ok: true,
      idle: work,
      blink,
      meta: {
        bgRatio: Math.round(cut.bgRatio * 100) / 100,
        confident: cut.ok,
        eyes: eyes ? eyes.length : 0,
        size: work.width,
        source: { width: img.width, height: img.height },
      },
    };
  }

  return {
    SIZE,
    BODY_RATIO,
    FOOT_Y,
    create,
    clone,
    alphaBBox,
    resample,
    cutout,
    feather,
    normalize,
    stylize,
    rimLight,
    detectEyes,
    drawBlink,
    build,
  };
});
