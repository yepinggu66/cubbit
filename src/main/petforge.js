'use strict';
/**
 * PetForge —— 把一张照片做成一只桌宠。
 *
 * 分工：
 *   nativeImage（Electron）负责解码 / 裁切 / 缩放 / 编码；
 *   shared/petphoto.js 负责像素（抠底、归一化、调色、边缘光、闭眼帧）。
 *
 * 产物落在 <userData>/pets/：
 *   index.json                  注册表（渲染层通过 IPC 拿到 file:// 地址）
 *   <id>-idle-01.png
 *   <id>-blink-01.png           只有检测到成对的眼睛才会生成
 *
 * 为什么不用 WebP：nativeImage 只能导 PNG/JPEG，而这里必须要 alpha。
 * 单帧 PNG 约 150–300 KB，只在用户主动拍照时产生，可以接受。
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { nativeImage } = require('electron');
const P = require('../shared/petphoto');

const MAX_NAME = 12;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/**
 * toBitmap() 的通道顺序在不同平台不一致（Windows 上是 BGRA，macOS 上是 RGBA）。
 * 与其写死，不如用一张已知颜色（纯红）的 1×1 PNG 现场验一次——
 * 省掉一整类"照片变成蓝色"的玄学 bug。
 */
// 1×1 纯红 PNG（RGBA 8888）
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
let ORDER = null;
function channelOrder() {
  if (ORDER) return ORDER;
  try {
    const raw = nativeImage.createFromDataURL(RED_PNG).toBitmap();
    // RGBA：第 0 字节是红；BGRA：第 2 字节是红
    ORDER = raw[0] > 200 ? 'rgba' : 'bgra';
  } catch {
    ORDER = 'bgra';
  }
  return ORDER;
}

function toRgba(buf) {
  const order = channelOrder();
  const out = new Uint8ClampedArray(buf.length);
  if (order === 'rgba') {
    out.set(buf);
    return out;
  }
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = buf[i + 2];
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i];
    out[i + 3] = buf[i + 3];
  }
  return out;
}

function toPlatformBitmap(rgba) {
  const order = channelOrder();
  if (order === 'rgba') return Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

function sanitizeName(input) {
  const s = String(input == null ? '' : input)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return s || '路边捡到的';
}

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

class PetForge {
  constructor(opts = {}) {
    this.dir = opts.dir || path.join(require('electron').app.getPath('userData'), 'pets');
    this.now = opts.now || (() => Date.now());
    this.file = path.join(this.dir, 'index.json');
    this._items = null;
  }

  _load() {
    if (this._items) return this._items;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this._items = Array.isArray(raw && raw.items) ? raw.items : [];
    } catch {
      this._items = [];
    }
    return this._items;
  }

  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ version: 1, items: this._items }, null, 2), 'utf8');
  }

  /** 给渲染层的注册表：只有 file:// 地址，不含任何原始照片。 */
  list() {
    return this._load().map((it) => ({
      id: it.id,
      name: it.name,
      createdAt: it.createdAt,
      idle: it.idle,
      blink: it.blink || null,
      frames: it.blink ? ['idle', 'blink'] : ['idle'],
      temperament: it.temperament || 'curious',
      meta: it.meta || null,
    }));
  }

  _publicPath(file) {
    return pathToFileURL(file).href;
  }

  /**
   * @param {object} input
   *   dataUrl   data:image/...;base64  —— 渲染层读文件/拍照后直接给 dataURL
   *   crop      {x,y,width,height} 源图像素坐标（可选）
   *   name      宠物名
   *   temperament soft|dreamy|curious|clingy
   */
  forge(input = {}) {
    const dataUrl = String(input.dataUrl || '');
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) {
      return { ok: false, code: 'BAD_IMAGE', message: '只支持 PNG / JPEG 图片。' };
    }
    if (dataUrl.length * 0.75 > MAX_SOURCE_BYTES) {
      return { ok: false, code: 'TOO_LARGE', message: '这张图太大了（超过 12MB），先压缩一下。' };
    }

    let img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return { ok: false, code: 'DECODE_FAILED', message: '这张图读不出来。' };

    const size0 = img.getSize();
    const crop = input.crop;
    if (crop && crop.width > 8 && crop.height > 8) {
      const x = Math.max(0, Math.min(size0.width - 1, Math.round(crop.x)));
      const y = Math.max(0, Math.min(size0.height - 1, Math.round(crop.y)));
      const w = Math.max(8, Math.min(size0.width - x, Math.round(crop.width)));
      const h = Math.max(8, Math.min(size0.height - y, Math.round(crop.height)));
      img = img.crop({ x, y, width: w, height: h });
    }

    // 统一缩到 512 再进管线：像素运算量固定，抠底容差也才有可比性
    const target = 512;
    const afterCrop = img.getSize();
    const scale = target / Math.max(afterCrop.width, afterCrop.height);
    if (scale < 1 || Math.abs(scale - 1) > 0.05) {
      img = img.resize({
        width: Math.max(1, Math.round(afterCrop.width * Math.min(scale, 4))),
        height: Math.max(1, Math.round(afterCrop.height * Math.min(scale, 4))),
        quality: 'best',
      });
    }

    const size = img.getSize();
    const rgba = toRgba(img.toBitmap());
    const srcImg = { data: rgba, width: size.width, height: size.height };

    const built = P.build(srcImg, {
      size: target,
      tol: input.tol,
      sat: input.sat,
      bright: input.bright,
      rim: input.rim,
      blink: input.blink === false ? false : true,
    });
    if (!built.ok) return { ok: false, code: built.code || 'EMPTY', message: built.message || '没抠出主体。' };

    fs.mkdirSync(this.dir, { recursive: true });
    // padStart：hash 转十六进制会丢掉前导 0，偶尔只出 6 位，id 长度就飘了。
    // 文件名长度不稳定会让"photo-xxxxxxxx"这条约定失效，也难做测试断言。
    const id = `photo-${hash(`${this.now()}#${input.name || ''}#${Math.random()}`).toString(16).padStart(8, '0').slice(0, 8)}`;
    const idleFile = path.join(this.dir, `${id}-idle-01.png`);
    const blinkFile = path.join(this.dir, `${id}-blink-01.png`);

    const encode = (image) => {
      const ni = nativeImage.createFromBitmap(toPlatformBitmap(image.data), {
        width: image.width,
        height: image.height,
      });
      return ni.toPNG();
    };

    fs.writeFileSync(idleFile, encode(built.idle));
    let blinkPath = null;
    if (built.blink) {
      fs.writeFileSync(blinkFile, encode(built.blink));
      blinkPath = this._publicPath(blinkFile);
    }

    const item = {
      id,
      name: sanitizeName(input.name),
      createdAt: this.now(),
      idle: this._publicPath(idleFile),
      blink: blinkPath,
      temperament: ['soft', 'dreamy', 'curious', 'clingy'].includes(input.temperament)
        ? input.temperament
        : 'curious',
      meta: built.meta,
    };
    this._load().push(item);
    this._save();
    return { ok: true, pet: item, meta: built.meta };
  }

  remove(id) {
    const items = this._load();
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return { ok: false, code: 'NOT_FOUND', message: '没有这只。' };
    const it = items[idx];
    for (const p of [it.idle, it.blink]) {
      if (!p) continue;
      try {
        const file = p.startsWith('file:') ? require('node:url').fileURLToPath(p) : p;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* 文件已经不在了就算了 */
      }
    }
    items.splice(idx, 1);
    this._items = items;
    this._save();
    return { ok: true, items: this.list() };
  }
}

module.exports = { PetForge, sanitizeName, channelOrder };
