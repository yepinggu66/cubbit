/**
 * 分享（站点 + 社交平台）的纯逻辑。
 *
 * 设计约束：
 *  - 产物只是一个链接，链接里带着内容（hash 里的紧凑 base64url）。
 *    这样不需要服务器就能让"分享出去的页面"真的显示那张卡，
 *    落地页见 site/share.html（同一份 decode）。
 *  - 文本必须自己裁：X 对 CJK 每字计 2 个权重，220 字直接超；
 *    所以这里按"字符预算"截断，而不是按字节。
 *  - 不做静默上传：本模块只拼 URL / 生成文本，网络动作由主进程 shell.openExternal 完成。
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (typeof window !== 'undefined') window.CUBBIT_SHARE = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const DEFAULT_BASE = 'https://cubbit.app/share.html';
  // 文本预算：X 的 280 权重里给 URL 留 23，剩下 257；CJK 一字算 2，
  // 所以正文控制在 120 字左右最安全，超了就在这里截。
  const TEXT_BUDGET = 118;
  const LIST_MAX = 5;

  const enc = encodeURIComponent;

  const PLATFORMS = [
    {
      id: 'x',
      label: 'X',
      note: '发一条带链接的推文',
      build: ({ text, url }) => `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      note: '分享到时间线',
      build: ({ text, url }) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}`,
    },
    {
      id: 'weibo',
      label: '微博',
      note: '国内能直接打开',
      build: ({ text, url }) => `https://service.weibo.com/share/share.php?title=${enc(text)}&url=${enc(url)}`,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      note: '发给朋友或频道',
      build: ({ text, url }) => `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
    },
  ];

  // ------------------------------------------------------------------ 文本

  /** 按"人眼长度"截断：CJK 算 1，其它算 0.5，末尾补省略号。 */
  function clip(text, budget) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const limit = budget || TEXT_BUDGET;
    let used = 0;
    let out = '';
    for (const ch of s) {
      const w = /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.5;
      if (used + w > limit) return out.replace(/[，、；：,;:\s]+$/, '') + '…';
      used += w;
      out += ch;
    }
    return out;
  }

  /** 第一句：卡片原文动辄 150 字，分享只需要最锋利的那一句。 */
  function firstSentence(text) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const m = s.match(/^[^。！？!?]{6,}[。！？!?]/);
    return (m ? m[0] : s).replace(/[。！？!?]$/, '');
  }

  /**
   * 生成分享文案。
   * kind: 'card' | 'list' | 'ending'
   */
  function textOf(input) {
    const src = input && typeof input === 'object' ? input : {};
    const kind = src.kind || 'card';
    const app = src.app || '方块仔 · 人生账本';

    if (kind === 'ending') {
      const bits = [];
      if (src.age) bits.push(`活到 ${Math.round(src.age)} 岁`);
      if (src.cash != null) bits.push(`最后手里 ${(Number(src.cash) / 10000).toFixed(1)} 万`);
      if (src.done != null) bits.push(`真正执行了 ${src.done} 条`);
      const head = src.title ? `我的结局是「${src.title}」` : '我走完了一辈子';
      const body = bits.length ? `${head}：${bits.join('，')}。` : `${head}。`;
      return `${clip(body, 78)} 四十步，一天一步。${clip(app, 20)}`;
    }

    if (kind === 'list') {
      const items = (src.items || []).slice(0, LIST_MAX).map((it, i) => `${i + 1}. ${firstSentence(it.title || it)}`);
      const head = src.head || `我挑了 ${items.length} 条关于健康的建议`;
      return clip(`${head}：${items.join(' ')} —— 都来自 ${app}，每条都标了证据等级。`, 150);
    }

    const title = clip(src.title || '', 46);
    const plain = firstSentence(src.plain || '');
    const ev = src.ev ? `（证据 ${src.ev} 级）` : '';
    const tail = src.app ? '' : ` —— ${app}`;
    return clip(`「${title}」${ev} ${plain}${tail}`, TEXT_BUDGET);
  }

  // ------------------------------------------------------------------ 链接

  function toBase64Url(str) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(s) {
    const raw = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : '';
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(raw + pad, 'base64').toString('utf8');
    }
    const bin = atob(raw + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** 把要分享的东西压成一个短码，塞进链接 hash。不含任何身份信息。 */
  function encodePayload(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = { v: VERSION, k: src.kind || 'card' };
    if (src.title || src.head) out.t = String(src.title || src.head).slice(0, 120);
    if (src.plain) out.p = String(src.plain).slice(0, 320);
    if (src.ev) out.e = String(src.ev).slice(0, 2);
    if (src.secName) out.s = String(src.secName).slice(0, 24);
    if (src.summary) out.m = String(src.summary).slice(0, 300);
    if (src.age != null) out.a = Math.round(Number(src.age) || 0);
    if (src.cash != null) out.c = Math.round(Number(src.cash) || 0);
    if (src.done != null) out.d = Math.round(Number(src.done) || 0);
    if (Array.isArray(src.items)) {
      out.i = src.items.slice(0, LIST_MAX).map((it) => ({
        t: String((it && it.title) || it || '').slice(0, 90),
        e: String((it && it.ev) || '').slice(0, 2),
      }));
    }
    if (src.pet) out.g = String(src.pet).slice(0, 24);
    return toBase64Url(JSON.stringify(out));
  }

  function decodePayload(code) {
    try {
      const obj = JSON.parse(fromBase64Url(code));
      if (!obj || typeof obj !== 'object') return null;
      if (obj.v !== VERSION) return null;
      return {
        kind: obj.k || 'card',
        title: obj.t || '',
        plain: obj.p || '',
        ev: obj.e || '',
        secName: obj.s || '',
        summary: obj.m || '',
        age: obj.a,
        cash: obj.c,
        done: obj.d,
        pet: obj.g || '',
        items: Array.isArray(obj.i) ? obj.i.map((it) => ({ title: it.t || '', ev: it.e || '' })) : [],
      };
    } catch {
      return null;
    }
  }

  function shareUrl(base, payload) {
    const root = String(base || DEFAULT_BASE).replace(/#.*$/, '');
    return `${root}#d=${payload}`;
  }

  function intentUrl(platformId, { text, url }) {
    const p = PLATFORMS.find((x) => x.id === platformId);
    if (!p) return null;
    const safe = { text: String(text || ''), url: String(url || '') };
    if (!/^https?:\/\//i.test(safe.url)) return null;
    return p.build(safe);
  }

  /** 交给主进程前先白名单校验：只允许我们自己拼的这几个域名。 */
  const ALLOWED_HOSTS = ['x.com', 'twitter.com', 'www.facebook.com', 'www.weibo.com', 'service.weibo.com', 't.me', 'telegram.me'];

  function isAllowedShareUrl(url) {
    try {
      const u = new URL(String(url));
      if (u.protocol !== 'https:') return false;
      return ALLOWED_HOSTS.includes(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /** 一站式：给定分享内容，返回 {text, code, url, platforms:[{id,label,note,url}]} */
  function pack(input, opts = {}) {
    const text = textOf(input);
    const code = encodePayload(input);
    const url = shareUrl(opts.base || DEFAULT_BASE, code);
    const platforms = PLATFORMS.map((p) => ({
      id: p.id,
      label: p.label,
      note: p.note,
      url: intentUrl(p.id, { text, url }),
    }));
    return { text, code, url, platforms, maxChars: TEXT_BUDGET };
  }

  return {
    VERSION,
    DEFAULT_BASE,
    TEXT_BUDGET,
    LIST_MAX,
    PLATFORMS,
    clip,
    firstSentence,
    textOf,
    encodePayload,
    decodePayload,
    shareUrl,
    intentUrl,
    isAllowedShareUrl,
    pack,
  };
});
