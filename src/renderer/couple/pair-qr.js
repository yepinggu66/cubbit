/* ============================================================================
 * 配对二维码 / 邀请信息（情侣面板共用）
 *
 * 为什么单独一个文件：情侣面板有两套视图（couple.js 的静态视图、couple-rt.js 的
 * 实时视图），实际显示的是后者。二维码与「整段邀请信息」必须两边都能用，所以抽出来。
 *
 * 只读展示：二维码编码 cubbit:// 深链，不会消耗邀请码，库缺失时返回 null 自动降级。
 * ========================================================================== */
(function () {
  'use strict';

  /** 把 cubbit:// 深链画成 SVG；qrcode-generator（MIT）缺失时返回 null */
  function svg(text) {
    if (typeof window.qrcode !== 'function' || !text) return null;
    let qr = null;
    try {
      qr = window.qrcode(0, 'M');
      qr.addData(String(text));
      qr.make();
    } catch (err) {
      console.warn('[pair-qr] build failed', err && err.message);
      return null;
    }
    const count = qr.getModuleCount();
    const scale = 4;
    const quiet = 2;
    const size = (count + quiet * 2) * scale;
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('class', 'pair-qr__svg');
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    el.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', '配对二维码');
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(size));
    bg.setAttribute('fill', '#ffffff');
    el.appendChild(bg);
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (!qr.isDark(r, c)) continue;
        d += 'M' + (c + quiet) * scale + ' ' + (r + quiet) * scale + 'h' + scale + 'v' + scale + 'h-' + scale + 'z';
      }
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#14161a');
    el.appendChild(path);
    return el;
  }

  /** 邀请落地页链接（带码，页面里有下载按钮和一键唤起） */
  function link(code) {
    const cfg = window.CubbitLiteConfig || {};
    const base = String(cfg.joinBase || 'https://pingguye.cn/cubbit/join').replace(/\/+$/, '');
    return base + '?code=' + encodeURIComponent(String(code || ''));
  }

  /** 可以直接转发的整段邀请信息 */
  function message(code) {
    const cfg = window.CubbitLiteConfig || {};
    const dl = cfg.downloadUrl || 'https://pingguye.cn/cubbit/dl/windows/latest';
    return [
      '我在用「方块仔」，一只住在桌面上的小方块。你也装一个，我们俩的方块仔就能互相看见。',
      '',
      '1）下载（Windows 10/11）：' + dl,
      '2）装好打开，右键它 →「💞 我们俩」→ 输入邀请码',
      '3）邀请码：' + code,
      '',
      '不用注册、不花钱；装好之后我戳它，你那边就会跳一下。邀请码 24 小时内有效。',
    ].join('\n');
  }

  window.CubbitPairQR = { svg, link, message };
})();
