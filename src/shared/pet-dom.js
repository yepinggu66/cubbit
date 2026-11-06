/* 方块仔外形的唯一来源：桌宠 / 小农场 / 预览共用同一套 DOM + pet.css
 * 用法：CubbitPetDom.build(palette, { skin, partner }) → <div class="pet xv2">
 *        CubbitPetDom.name(text, petName) 把台词里的「方块仔」换成用户起的名字 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CubbitPetDom = api;
})(this, function () {
  'use strict';
  const MARKUP = `
      <div class="shadow"></div>
      <div class="skin-fx"></div>
      <div class="pose">
      <div class="squash">
      <div class="pet-bob">
        <div class="acc acc-tail"></div>
        <div class="arm l"></div>
        <div class="arm r"></div>
        <div class="leg l"></div>
        <div class="leg r"></div>
        <div class="body"></div>
        <div class="face">
          <div class="eye l">
            <div class="eye-inner">
              <div class="sclera"></div>
              <div class="pupil"></div>
              <div class="hl"></div>
              <div class="hl small"></div>
            </div>
            <div class="eye-happy"></div>
            <div class="eye-glyph"></div>
            <div class="tear"></div>
          </div>
          <div class="eye r">
            <div class="eye-inner">
              <div class="sclera"></div>
              <div class="pupil"></div>
              <div class="hl"></div>
              <div class="hl small"></div>
            </div>
            <div class="eye-happy"></div>
            <div class="eye-glyph"></div>
            <div class="tear"></div>
          </div>
          <div class="brow l"></div>
          <div class="brow r"></div>
          <div class="blush l"></div>
          <div class="blush r"></div>
          <div class="mouth"><i class="tongue"></i><i class="teeth"></i></div>
          <div class="emote-fx" aria-hidden="true"></div>
        </div>
        <div class="acc acc-ears"></div>
        <div class="acc acc-hat"></div>
        <div class="acc acc-held"></div>
      </div>
      </div>
      </div>`;
  const VARS = ['body1', 'body2', 'body3', 'eye', 'pupil', 'blush', 'rim', 'glow'];
  const DEFAULT_NAME = '方块仔';
  const ALIASES = /方块仔|Cubbit|キュービット|큐빗/g;
  function palette(el, p) {
    if (!el || !p) return;
    for (const k of VARS) if (p[k]) el.style.setProperty('--' + k, p[k]);
    el.classList.toggle('pet-dark', !!p.dark);
  }
  function skin(el, id, meta) {
    const acc = (meta && meta.accessory) || {};
    el.dataset.skin = id || 'blaze';
    el.dataset.skinFx = (meta && meta.effect) || 'warm-glow';
    el.dataset.hat = acc.hat || ''; el.dataset.ears = acc.ears || ''; el.dataset.tail = acc.tail || '';
    el.dataset.idle = (meta && meta.idle) || 'wiggle';
    const held = el.querySelector('.acc-held'); if (held) held.textContent = acc.held || '';
  }
  function build(p, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = opts.partner ? 'pet pet-partner xv2' : 'pet xv2';
    wrap.innerHTML = MARKUP;
    palette(wrap, p);
    if (opts.skinId || opts.meta) skin(wrap, opts.skinId, opts.meta);
    return wrap;
  }
  function cleanName(n) { const s = String(n == null ? '' : n).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16); return s || DEFAULT_NAME; }
  function name(text, petName) {
    const n = cleanName(petName);
    if (n === DEFAULT_NAME || text == null) return text;
    return String(text).replace(ALIASES, n);
  }
  return { MARKUP, VARS, DEFAULT_NAME, build, palette, skin, name, cleanName };
});
