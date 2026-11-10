'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/shared/petphoto.js');

/** 造一张白底 + 中间一个红圆的图（模拟"路边拍到的猫"）。 */
function makeSubject(w = 240, h = 240, opts = {}) {
  const img = P.create(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * (opts.radius || 0.3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      if (inside) {
        img.data[i] = 210;
        img.data[i + 1] = 120;
        img.data[i + 2] = 70;
      } else {
        img.data[i] = 250;
        img.data[i + 1] = 249;
        img.data[i + 2] = 246;
      }
      img.data[i + 3] = 255;
    }
  }
  if (opts.eyes) {
    for (const [ex, ey] of opts.eyes) {
      for (let y = -4; y <= 4; y++) {
        for (let x = -4; x <= 4; x++) {
          if (x * x + y * y > 16) continue;
          const i = ((ey + y) * w + (ex + x)) * 4;
          img.data[i] = 30;
          img.data[i + 1] = 25;
          img.data[i + 2] = 22;
        }
      }
    }
  }
  return img;
}

test('抠底：白底变透明，主体保留，四角 alpha 归零', () => {
  const img = makeSubject();
  const cut = P.cutout(img);
  assert.ok(cut.bgRatio > 0.5 && cut.bgRatio < 0.95, `bgRatio=${cut.bgRatio}`);
  assert.equal(cut.ok, true);
  assert.equal(cut.img.data[3], 0, '左上角必须透明');
  const center = (120 * 240 + 120) * 4;
  assert.equal(cut.img.data[center + 3], 255);
  assert.ok(cut.img.data[center] > 180, '主体颜色不该被改');
});

test('抠底：整张纯色时会报 low confidence，不会假装成功', () => {
  const flat = P.create(64, 64);
  for (let i = 0; i < flat.data.length; i += 4) {
    flat.data[i] = 240;
    flat.data[i + 1] = 240;
    flat.data[i + 2] = 240;
    flat.data[i + 3] = 255;
  }
  const cut = P.cutout(flat);
  assert.equal(cut.ok, false);
});

test('alphaBBox 能框住主体，空白图返回 null', () => {
  const img = P.create(100, 100);
  for (let y = 20; y < 60; y++) {
    for (let x = 30; x < 70; x++) img.data[(y * 100 + x) * 4 + 3] = 255;
  }
  const box = P.alphaBBox(img);
  assert.equal(box.x, 30);
  assert.equal(box.y, 20);
  assert.equal(box.width, 40);
  assert.equal(box.height, 40);
  assert.equal(P.alphaBBox(P.create(10, 10)), null);
});

test('归一化：角色高度约占 86%，脚底落在 96%，与内置形象同一套比例', () => {
  const src = P.create(400, 400);
  for (let y = 100; y < 220; y++) {
    for (let x = 150; x < 250; x++) src.data[(y * 400 + x) * 4 + 3] = 255;
  }
  const out = P.normalize(src, { size: 256 });
  const box = P.alphaBBox(out, 8);
  assert.ok(box, '归一化后必须有内容');
  const ratio = box.height / 256;
  assert.ok(Math.abs(ratio - 0.86) < 0.04, `高度占比 ${ratio.toFixed(3)}`);
  const foot = (box.y + box.height) / 256;
  assert.ok(Math.abs(foot - 0.96) < 0.04, `脚底位置 ${foot.toFixed(3)}`);
  const cx = (box.x + box.width / 2) / 256;
  assert.ok(Math.abs(cx - 0.5) < 0.05, '必须水平居中');
});

test('归一化对透明图返回全透明画布而不是崩', () => {
  const out = P.normalize(P.create(50, 50), { size: 64 });
  assert.equal(out.width, 64);
  assert.equal(out.data.every((v) => v === 0), true);
});

test('detectEyes 找到成对的深色块，并拒绝只有一只眼的情况', () => {
  const two = makeSubject(240, 240, { eyes: [[100, 105], [140, 105]] });
  const cut = P.cutout(two);
  const norm = P.normalize(P.feather(cut.img, 1), { size: 240 });
  const eyes = P.detectEyes(norm);
  assert.ok(eyes, '应该能找到两只眼睛');
  assert.equal(eyes.length, 2);
  assert.ok(eyes[0].x < eyes[1].x, '必须按左右排序');

  const one = makeSubject(240, 240, { eyes: [[120, 105]] });
  const cut2 = P.cutout(one);
  const norm2 = P.normalize(P.feather(cut2.img, 1), { size: 240 });
  assert.equal(P.detectEyes(norm2), null, '单只眼不该被当成一对');
});

test('drawBlink 只在眼睛附近改像素，且不改动透明区', () => {
  const two = makeSubject(240, 240, { eyes: [[100, 105], [140, 105]] });
  const cut = P.cutout(two);
  const norm = P.normalize(P.feather(cut.img, 1), { size: 240 });
  const eyes = P.detectEyes(norm);
  const blink = P.drawBlink(norm, eyes);
  let diff = 0;
  for (let i = 0; i < norm.data.length; i += 4) {
    if (norm.data[i + 3] === 0) {
      assert.equal(blink.data[i + 3], 0, '透明像素必须还是透明');
      continue;
    }
    if (norm.data[i] !== blink.data[i]) diff++;
  }
  assert.ok(diff > 20, '闭眼帧应该有变化');
  assert.ok(diff < 240 * 240 * 0.2, '不该把整张图刷黑');
});

test('build 端到端：产出 idle + blink 和可读的元信息', () => {
  const two = makeSubject(300, 300, { eyes: [[130, 130], [170, 130]] });
  const res = P.build(two, { size: 256 });
  assert.equal(res.ok, true);
  assert.equal(res.idle.width, 256);
  assert.ok(res.blink, '检测到眼睛时应该出闭眼帧');
  assert.equal(res.meta.size, 256);
  assert.equal(res.meta.eyes, 2);
  assert.ok(res.meta.bgRatio > 0.5);
});

test('build 遇到全透明输入返回 EMPTY 而不是抛错', () => {
  const res = P.build(P.create(64, 64));
  assert.equal(res.ok, false);
  assert.equal(res.code, 'EMPTY');
});

test('stylize / rimLight 不改尺寸，不弄丢 alpha', () => {
  const img = P.create(32, 32);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 120;
    img.data[i + 1] = 130;
    img.data[i + 2] = 140;
    img.data[i + 3] = i % 3 === 0 ? 0 : 255;
  }
  const s = P.stylize(img);
  const r = P.rimLight(s, { width: 1 });
  assert.equal(r.width, 32);
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(r.data[i + 3], img.data[i + 3], 'alpha 必须原样保留');
  }
});
