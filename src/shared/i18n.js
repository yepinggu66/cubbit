/* ============================================================================
 * 方块仔 i18n 运行时（主进程 + 渲染层通用，UMD）
 *  · 词典 i18n-dict.js：以中文原文为 key，{ en, de, ja, ko, fr, it } 为值（机器翻译 + 人工校对关键术语）
 *  · tr(lang, text)：精确匹配 → 模板匹配（{} / {name} 占位）→ 原文
 *  · 渲染层：translateDom + MutationObserver 自动翻译面板里所有中文文本 / placeholder / title
 * ========================================================================== */
(function (root, factory) {
  let dict = null;
  if (typeof module === 'object' && module.exports) {
    try { dict = require('./i18n-dict.js'); } catch { dict = {}; }
    module.exports = factory(dict);
  } else {
    root.CubbitI18N = factory(root.CubbitI18NDict || {});
  }
})(typeof self !== 'undefined' ? self : this, function (DICT) {
  'use strict';

  const LANGS = [
    { id: 'zh-CN', short: 'zh', label: '中文', name: '中文(简体)', culture: 'zh-CN' },
    { id: 'en', short: 'en', label: 'English', name: 'English', culture: 'en-US' },
    { id: 'de', short: 'de', label: 'Deutsch', name: 'Deutsch', culture: 'de-DE' },
    { id: 'ja', short: 'ja', label: '日本語', name: '日本語', culture: 'ja-JP' },
    { id: 'ko', short: 'ko', label: '한국어', name: '한국어', culture: 'ko-KR' },
    { id: 'fr', short: 'fr', label: 'Français', name: 'Français', culture: 'fr-FR' },
    { id: 'it', short: 'it', label: 'Italiano', name: 'Italiano', culture: 'it-IT' },
  ];
  const CJK = /[\u3400-\u9fff]/;
  const PH = /\{[^{}]*\}/g;

  function normLang(v) {
    const s = String(v || '').toLowerCase();
    if (!s || s.startsWith('zh')) return 'zh-CN';
    for (const l of LANGS) if (s === l.id.toLowerCase() || s.startsWith(l.short)) return l.id;
    return 'zh-CN';
  }
  function info(lang) { return LANGS.find((l) => l.id === normLang(lang)) || LANGS[0]; }
  function short(lang) { return info(lang).short; }

  const cache = {};
  const templates = {};
  function tplFor(code) {
    if (templates[code]) return templates[code];
    const list = [];
    for (const key of Object.keys(DICT)) {
      if (!key.includes('{')) continue;
      const val = DICT[key] && DICT[key][code];
      if (!val) continue;
      const names = key.match(PH) || [];
      if (!names.length) continue;
      const parts = key.split(PH).map((p) => p.replace(/[.*+?^$()|[\]\\]/g, '\\$&'));
      if (parts.join('').replace(/\s/g, '').length < 2) continue;
      let src = '^' + parts[0];
      for (let i = 1; i < parts.length; i++) src += '([\\s\\S]*?)' + parts[i];
      src += '$';
      try { list.push({ re: new RegExp(src), names, val, len: key.length }); } catch { /* ignore */ }
    }
    list.sort((a, b) => b.len - a.len);
    templates[code] = list;
    return list;
  }

  function trCore(code, text) {
    const e = DICT[text];
    if (e && e[code]) return e[code];
    if (!CJK.test(text)) return text;
    for (const t of tplFor(code)) {
      const m = t.re.exec(text);
      if (!m) continue;
      const vals = m.slice(1);
      let i = 0;
      const used = {};
      return t.val.replace(PH, (ph) => {
        let idx = ph === '{}' ? -1 : t.names.indexOf(ph);
        if (idx < 0 || used[idx]) { while (used[i]) i++; idx = i; }
        used[idx] = 1;
        const v = vals[idx] === undefined ? '' : vals[idx];
        return CJK.test(v) ? tr(code, v) : v;
      });
    }
    return text;
  }

  /** 翻译一段文本；保留首尾空白 */
  function tr(lang, text) {
    if (text === null || text === undefined) return text;
    const s = String(text);
    const code = short(lang);
    if (code === 'zh' || !CJK.test(s)) return s;
    // 已经是日文（含假名）或韩文（谚文）的句子不再翻译，避免把日文汉字当中文切碎
    if (/[\u3040-\u30ff\uac00-\ud7af]/.test(s)) return s;
    const c = cache[code] || (cache[code] = new Map());
    if (c.has(s)) return c.get(s);
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    const core = s.trim();
    let out = trCore(code, core);
    if (out === core && core.includes('\n')) out = core.split('\n').map((x) => trCore(code, x.trim())).join('\n');
    out = lead + out + trail;
    if (c.size > 5000) c.clear();
    c.set(s, out);
    return out;
  }

  function trMenu(lang, template) {
    if (short(lang) === 'zh' || !Array.isArray(template)) return template;
    return template.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const out = { ...item };
      if (typeof out.label === 'string') out.label = tr(lang, out.label);
      if (typeof out.toolTip === 'string') out.toolTip = tr(lang, out.toolTip);
      if (Array.isArray(out.submenu)) out.submenu = trMenu(lang, out.submenu);
      return out;
    });
  }

  // ------------------------------------------------------------ 渲染层 DOM 翻译
  let current = 'zh-CN';
  let observer = null;
  // DONE / ADONE：上一次写回的译文；ORIG / AORIG：中文原文。切换语言时从原文重新翻译（含切回中文）。
  const WM = () => (typeof WeakMap !== 'undefined' ? new WeakMap() : { get() {}, set() {} });
  const DONE = WM();
  const ADONE = WM();
  const ORIG = WM();
  const AORIG = WM();
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function translateNode(node) {
    if (node.nodeType === 3) {
      const pe = node.parentElement;
      if (pe && pe.closest && pe.closest('[data-no-i18n]')) return;
      const v = node.nodeValue;
      if (!v) return;
      // 当前值不是我们写回的译文 → 被页面脚本改过，以它为新的原文
      let orig = DONE.get(node) === v ? ORIG.get(node) : v;
      if (orig === undefined) orig = v;
      if (orig !== ORIG.get(node)) ORIG.set(node, orig);
      if (!CJK.test(orig)) { DONE.set(node, v); return; }
      const t = tr(current, orig);
      DONE.set(node, t);
      if (t !== v) node.nodeValue = t;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || (node.dataset && node.dataset.noI18n !== undefined) || (node.closest && node.closest('[data-no-i18n]'))) return;
    for (const a of ATTRS) {
      const v = node.getAttribute && node.getAttribute(a);
      if (!v) continue;
      const done = ADONE.get(node) || {};
      const origs = AORIG.get(node) || {};
      const orig = done[a] === v && origs[a] !== undefined ? origs[a] : v;
      if (!CJK.test(orig)) continue;
      origs[a] = orig; AORIG.set(node, origs);
      const t = tr(current, orig);
      done[a] = t; ADONE.set(node, done);
      if (t !== v) node.setAttribute(a, t);
    }
    if (tag === 'INPUT' && (node.type === 'button' || node.type === 'submit')) {
      const v = node.value;
      const done = ADONE.get(node) || {};
      const origs = AORIG.get(node) || {};
      const orig = done.value === v && origs.value !== undefined ? origs.value : v;
      if (CJK.test(orig)) {
        origs.value = orig; AORIG.set(node, origs);
        const t = tr(current, orig);
        done.value = t; ADONE.set(node, done);
        if (t !== v) node.value = t;
      }
    }
    for (const ch of node.childNodes) translateNode(ch);
  }
  let titleOrig = null;
  let titleDone = null;
  function translateDom(rootEl) {
    if (typeof document === 'undefined') return;
    const r = rootEl || document.body;
    if (!r) return;
    translateNode(r);
    if (typeof document.title === 'string') {
      if (titleOrig === null || document.title !== titleDone) titleOrig = document.title;
      if (CJK.test(titleOrig)) { titleDone = tr(current, titleOrig); document.title = titleDone; }
    }
  }
  function observe() {
    if (typeof MutationObserver === 'undefined' || observer || !document.body) return;
    observer = new MutationObserver((muts) => {
      if (short(current) === 'zh') return;
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else for (const n of m.addedNodes) translateNode(n);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function setLang(lang) {
    const next = normLang(lang);
    const changed = next !== current;
    current = next;
    if (typeof document !== 'undefined') {
      try { localStorage.setItem('cubbit.lang', next); } catch { /* ignore */ }
      if (document.documentElement) document.documentElement.lang = next;
      if (changed) translateDom();
    }
    return current;
  }
  function getLang() { return current; }
  function t(text) { return tr(current, text); }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try { current = normLang(localStorage.getItem('cubbit.lang') || 'zh-CN'); } catch { /* ignore */ }
    const boot = () => {
      translateDom();
      observe();
      const api = window.cubbit && (window.cubbit.panel || window.cubbit.pet);
      if (api && typeof api.state === 'function') {
        Promise.resolve(api.state()).then((s) => s && s.settings && setLang(s.settings.language)).catch(() => {});
      }
      if (api && typeof api.onState === 'function') api.onState((s) => s && s.settings && setLang(s.settings.language));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return { LANGS, normLang, info, short, tr, trMenu, translateDom, setLang, getLang, t, _dict: DICT };
});
