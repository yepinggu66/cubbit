/**
 * v2.2 可分享瞬间：纪念日判定 + 纯 JS GIF89a 编码（无原生依赖，便于打包）。
 */
'use strict';

const DAY = 86400000;
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/** 今天是不是值得放烟花的日子：周年、整百天、520 天、1314 天 */
function anniversaryMoment(since, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since || ''))) return null;
  const [y, m, d] = since.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - start) / DAY) + 1;
  if (days < 2) return null;
  if (today.getMonth() === m - 1 && today.getDate() === d && today.getFullYear() > y) {
    const years = today.getFullYear() - y;
    return { kind: 'year', days, years, title: `在一起 ${years} 周年快乐！` };
  }
  if (days === 520 || days === 1314) return { kind: 'special', days, title: `在一起第 ${days} 天 💗` };
  if (days % 100 === 0) return { kind: 'hundred', days, title: `在一起 ${days} 天啦！` };
  return null;
}

function momentFileName(kind, now = new Date()) {
  const t = ymd(now).replace(/-/g, '') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
  return `cubbit-${t}.${kind === 'gif' ? 'gif' : 'png'}`;
}

// ---------- GIF 编码 ----------
/** 6x6x6 web 调色板 + 索引 216 透明 */
function paletteRGB() {
  const p = Buffer.alloc(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) { p[i++] = r * 51; p[i++] = g * 51; p[i++] = b * 51; }
  return p;
}
const TRANSPARENT = 216;

/** RGBA（或 Electron toBitmap 的 BGRA）→ 调色板索引 */
function quantize(pixels, bgra = false) {
  const n = pixels.length >> 2;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    if (pixels[o + 3] < 128) { out[i] = TRANSPARENT; continue; }
    const r = bgra ? pixels[o + 2] : pixels[o];
    const b = bgra ? pixels[o] : pixels[o + 2];
    out[i] = Math.round(r / 51) * 36 + Math.round(pixels[o + 1] / 51) * 6 + Math.round(b / 51);
  }
  return out;
}

/** 标准 GIF LZW（minCodeSize=8），输出子块 */
function lzw(indices) {
  const minCode = 8, clear = 256, eoi = 257;
  const bytes = [];
  let cur = 0, nbits = 0;
  let size = minCode + 1;
  const emit = (code) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { bytes.push(cur & 255); cur >>>= 8; nbits -= 8; } };
  let dict = new Map(); let next = eoi + 1;
  emit(clear);
  let prefix = indices.length ? indices[0] : 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear); dict = new Map(); next = eoi + 1; size = minCode + 1; }
    prefix = k;
  }
  if (indices.length) emit(prefix);
  emit(eoi);
  if (nbits > 0) bytes.push(cur & 255);
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) { const c = bytes.slice(i, i + 255); out.push(c.length, ...c); }
  out.push(0);
  return Buffer.from(out);
}

/**
 * frames: [{ pixels: Uint8Array RGBA|BGRA, delayMs }]，所有帧同尺寸。
 */
function encodeGif(width, height, frames, { bgra = false, loop = true } = {}) {
  const parts = [];
  const hdr = Buffer.alloc(13);
  hdr.write('GIF89a', 0); hdr.writeUInt16LE(width, 6); hdr.writeUInt16LE(height, 8);
  hdr[10] = 0xf7; // 全局色表 256 色
  parts.push(hdr, paletteRGB());
  if (loop) parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0]));
  for (const f of frames) {
    const delay = Math.max(2, Math.round((f.delayMs || 100) / 10));
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x09, delay & 255, delay >> 8, TRANSPARENT, 0])); // dispose=2 + 透明
    const id = Buffer.alloc(10); id[0] = 0x2c; id.writeUInt16LE(width, 5); id.writeUInt16LE(height, 7);
    parts.push(id, Buffer.from([8]), lzw(quantize(f.pixels, bgra)));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

module.exports = { anniversaryMoment, momentFileName, encodeGif, quantize, lzw, TRANSPARENT };
