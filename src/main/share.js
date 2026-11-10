'use strict';
/**
 * 分享的主进程侧：落盘、剪贴板、把用户送到目的地。
 *
 * 边界：
 *  - 渲染层只给 dataURL 和 intent URL，能不能打开由这里判。
 *  - 只 shell.openExternal 白名单域名（X / Facebook / 微博 / Telegram）和我们自己的站点；
 *    intent URL 由 shared/share.js 拼，但这里仍要复查一遍——预加载白名单挡不住"参数被换掉"。
 *  - 不做任何自动上传：图片留在本机，链接里的内容是编码，不是服务器上的副本。
 */

const fs = require('node:fs');
const path = require('node:path');
const { shell, clipboard, nativeImage, app } = require('electron');
const S = require('../shared/share');

const OWN_HOSTS = ['cubbit.app', 'www.cubbit.app', 'pingguye.cn', 'www.pingguye.cn'];
const MAX_PNG_BYTES = 8 * 1024 * 1024;

class ShareKit {
  constructor(opts = {}) {
    this.dir = opts.dir || path.join(app.getPath('userData'), 'exports');
    this.now = opts.now || (() => Date.now());
    this.openExternal = opts.openExternal || ((url) => shell.openExternal(url));
  }

  exportDir() {
    fs.mkdirSync(this.dir, { recursive: true });
    return this.dir;
  }

  /** 保存分享卡 PNG；同时复制到剪贴板，用户可以直接粘进任何聊天框。 */
  saveCard(input = {}) {
    const dataUrl = String(input.dataUrl || '');
    if (!/^data:image\/png;base64,/i.test(dataUrl)) {
      return { ok: false, code: 'BAD_IMAGE', message: '分享卡没生成成功。' };
    }
    if (dataUrl.length * 0.75 > MAX_PNG_BYTES) {
      return { ok: false, code: 'TOO_LARGE', message: '图片太大了。' };
    }
    const img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return { ok: false, code: 'DECODE_FAILED', message: '图片解不出来。' };

    const kind = String(input.kind || 'card').replace(/[^a-z]/g, '').slice(0, 12) || 'card';
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(this.exportDir(), `cubbit-${kind}-${stamp}.png`);
    fs.writeFileSync(file, img.toPNG());

    let copied = false;
    if (input.copy !== false) {
      try {
        clipboard.writeImage(img);
        copied = true;
      } catch {
        copied = false;
      }
    }
    return { ok: true, path: file, copied };
  }

  copyText(text) {
    const s = String(text == null ? '' : text).slice(0, 2000);
    clipboard.writeText(s);
    return { ok: true, length: s.length };
  }

  /** 打开分享落地页或平台 intent。 */
  open(url) {
    const target = String(url || '');
    let allowed = S.isAllowedShareUrl(target);
    if (!allowed) {
      try {
        const u = new URL(target);
        if (u.protocol === 'https:' && OWN_HOSTS.includes(u.hostname.toLowerCase())) allowed = true;
        // 开发态：允许用浏览器看本地 share.html，方便验证落地页
        if (u.protocol === 'file:' && /share\.html$/.test(u.pathname)) allowed = true;
      } catch {
        allowed = false;
      }
    }
    if (!allowed) return { ok: false, code: 'URL_NOT_ALLOWED', message: '这个链接不在允许范围内。' };
    this.openExternal(target);
    return { ok: true, url: target };
  }

  reveal(file) {
    const p = String(file || '');
    if (!p || !fs.existsSync(p)) return { ok: false, code: 'NOT_FOUND' };
    shell.showItemInFolder(p);
    return { ok: true };
  }
}

module.exports = { ShareKit, OWN_HOSTS };
