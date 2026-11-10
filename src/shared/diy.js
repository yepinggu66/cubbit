/**
 * Cubbit DIY pet data and normalization.
 *
 * Main process loads this through require(); renderer pages load it as a
 * browser script and expose it as window.CUBBIT_DIY. Keep this file free of
 * Electron and DOM APIs so it can be used by tests and both processes.
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (typeof window !== 'undefined') window.CUBBIT_DIY = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  // 11 种旧动物形象已撤下：桌面默认是经典橙色方块仔，形象馆另有探险方块仔（小灯 + 小包插画），外加用户自拍照。
  const ANIMAL_PRESETS_ENABLED = false;

  const PALETTES = [
    {
      // 经典方块仔的原色（和默认皮肤「橙红经典」一致）：亮橙大眼睛那只
      id: 'classic',
      label: '经典橙',
      emoji: '🟧',
      body1: '#ff8a50',
      body2: '#ff5a1f',
      body3: '#e8440c',
      eye: '#2a1610',
      pupil: '#120805',
      blush: '#ffb199',
      rim: '#ffd2bd',
      glow: 'rgba(255,110,50,.45)',
    },
    {
      id: 'peach',
      label: '橙红',
      emoji: '🧡',
      body1: '#ffd2b3',
      body2: '#f08a62',
      body3: '#e56b45',
      eye: '#3a211c',
      pupil: '#1c100d',
      blush: '#ff9c9c',
      rim: '#fff4ee',
      glow: 'rgba(229,107,69,.42)',
    },
    {
      id: 'cream',
      label: '奶油',
      emoji: '🍦',
      body1: '#fff7dc',
      body2: '#f0d7a1',
      body3: '#c8a568',
      eye: '#43331f',
      pupil: '#241a10',
      blush: '#ffb4ad',
      rim: '#fffdf1',
      glow: 'rgba(246,218,159,.42)',
    },
    {
      id: 'mint',
      label: '薄荷',
      emoji: '🌿',
      body1: '#e5fff5',
      body2: '#9bdec6',
      body3: '#58aa86',
      eye: '#173a31',
      pupil: '#0d211b',
      blush: '#ffaaa7',
      rim: '#f3fffb',
      glow: 'rgba(117,218,177,.4)',
    },
    {
      id: 'sky',
      label: '海盐',
      emoji: '🫧',
      body1: '#e9f7ff',
      body2: '#9bd7f5',
      body3: '#5fa9cf',
      eye: '#193442',
      pupil: '#0d1d26',
      blush: '#ffa9c3',
      rim: '#f6fdff',
      glow: 'rgba(120,199,238,.42)',
    },
    {
      id: 'grape',
      label: '葡萄',
      emoji: '🍇',
      body1: '#f6eeff',
      body2: '#c5a8ef',
      body3: '#886bc4',
      eye: '#33233f',
      pupil: '#1c1226',
      blush: '#ff96c1',
      rim: '#fcf8ff',
      glow: 'rgba(188,147,241,.42)',
    },
    {
      id: 'caramel',
      label: '焦糖',
      emoji: '🍮',
      body1: '#fff0dc',
      body2: '#dda46e',
      body3: '#a96d42',
      eye: '#3e291b',
      pupil: '#21150d',
      blush: '#ff9d86',
      rim: '#fffaf2',
      glow: 'rgba(225,164,105,.42)',
    },
    {
      id: 'cloud',
      label: '棉花糖',
      emoji: '☁️',
      body1: '#ffffff',
      body2: '#eeeaf4',
      body3: '#c8c1d3',
      eye: '#302c38',
      pupil: '#19161e',
      blush: '#ffb8ce',
      rim: '#ffffff',
      glow: 'rgba(230,220,245,.5)',
    },
    {
      id: 'night',
      label: '夜巡',
      emoji: '🌙',
      body1: '#625d82',
      body2: '#433d63',
      body3: '#292543',
      eye: '#fff1c4',
      pupil: '#392c4b',
      blush: '#f49bb6',
      rim: '#e9deff',
      glow: 'rgba(160,142,255,.42)',
      dark: true,
    },
    {
      id: 'fox',
      label: '狐狸',
      emoji: '🦊',
      body1: '#ffd7ad',
      body2: '#ef9b55',
      body3: '#c86127',
      eye: '#3c2413',
      pupil: '#1f1109',
      blush: '#ff9a8f',
      rim: '#fff5e8',
      glow: 'rgba(245,150,78,.42)',
    },
    {
      id: 'panda',
      label: '熊猫',
      emoji: '🐼',
      body1: '#ffffff',
      body2: '#e8e8e8',
      body3: '#b8b8b8',
      eye: '#202020',
      pupil: '#0d0d0d',
      blush: '#ffb7c7',
      rim: '#ffffff',
      glow: 'rgba(210,220,230,.45)',
    },
    {
      id: 'penguin',
      label: '企鹅',
      emoji: '🐧',
      body1: '#f4fbff',
      body2: '#9fc3dc',
      body3: '#36536c',
      eye: '#183044',
      pupil: '#0b1824',
      blush: '#ffb4c4',
      rim: '#f9feff',
      glow: 'rgba(125,194,232,.42)',
    },
    {
      id: 'duck',
      label: '小黄鸭',
      emoji: '🐤',
      body1: '#fffbdd',
      body2: '#ffe066',
      body3: '#e8b52f',
      eye: '#3c2f10',
      pupil: '#1e1706',
      blush: '#ffb1a1',
      rim: '#fffff2',
      glow: 'rgba(255,222,120,.46)',
    },
  ];

  /* ---- 自定义主色 ---------------------------------------------------------
   * 用户在取色器里挑任意颜色 → paletteId 'custom' + bodyColor '#rrggbb'。
   * 由这一个颜色推出 亮/中/暗 三档机身色和配套的眼睛/腮红/光晕，
   * 插画换色层（shared/pet-sprite.js）按 body2 重映射，明暗关系保留原图。 */
  const CUSTOM_PALETTE_ID = 'custom';
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  function cleanHex(v) {
    const s = String(v == null ? '' : v).trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(s);
    return m ? '#' + m[1].toLowerCase() : '';
  }
  function hexToHsl(hex) {
    const h = cleanHex(hex) || '#f08a62';
    const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let hh = mx === r ? (((g - b) / d) % 6 + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hh * 60, Math.min(1, s), l];
  }
  function hslToHex(h, s, l) {
    s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }
  function derivePalette(hex) {
    const body2 = cleanHex(hex) || '#f08a62';
    const [h, s, l] = hexToHsl(body2);
    const dark = l < 0.3;
    const r = parseInt(body2.slice(1, 3), 16), g = parseInt(body2.slice(3, 5), 16), b = parseInt(body2.slice(5, 7), 16);
    return {
      id: CUSTOM_PALETTE_ID,
      label: '自定义',
      emoji: '🎨',
      body1: hslToHex(h + 6, s * 0.9, l + (1 - l) * 0.62),
      body2,
      body3: hslToHex(h - 3, Math.min(1, s * 1.04 + 0.03), l * 0.82),
      eye: dark ? '#fff1c4' : hslToHex(h, 0.35, 0.16),
      pupil: dark ? hslToHex(h, 0.3, 0.2) : hslToHex(h, 0.35, 0.08),
      blush: '#ff9c9c',
      rim: hslToHex(h, s * 0.5, 0.96),
      glow: `rgba(${r},${g},${b},.42)`,
      dark,
    };
  }

  const HATS = [
    { id: 'auto', label: '跟随皮肤', emoji: '✨' },
    { id: 'none', label: '不戴帽子', emoji: '○' },
    { id: 'sprout', label: '小嫩芽', emoji: '🌱' },
    { id: 'flower', label: '小花花', emoji: '🌸' },
    { id: 'halo', label: '软光环', emoji: '😇' },
    { id: 'raindrop', label: '小雨滴', emoji: '💧' },
    { id: 'witch', label: '夜行帽', emoji: '🪄' },
    { id: 'chef', label: '厨师帽', emoji: '👩‍🍳' },
  ];

  const EARS = [
    { id: 'auto', label: '跟随皮肤', emoji: '✨' },
    { id: 'none', label: '不戴耳朵', emoji: '○' },
    { id: 'cat', label: '猫猫耳', emoji: '🐱' },
    { id: 'bunny', label: '兔兔耳', emoji: '🐰' },
    { id: 'bear', label: '小熊耳', emoji: '🐻' },
    { id: 'fox', label: '狐狸耳', emoji: '🦊' },
    { id: 'dog', label: '柴犬耳', emoji: '🐕' },
    { id: 'sheep', label: '小羊耳', emoji: '🐑' },
    { id: 'dino', label: '小龙角', emoji: '🦕' },
    { id: 'frog', label: '蛙蛙眼', emoji: '🐸' },
    { id: 'antenna', label: '小天线', emoji: '📡' },
  ];

  const TAILS = [
    { id: 'auto', label: '跟随皮肤', emoji: '✨' },
    { id: 'none', label: '没有尾巴', emoji: '○' },
    { id: 'cat', label: '猫尾巴', emoji: '〰️' },
    { id: 'puff', label: '绒球尾', emoji: '⚪' },
    { id: 'wings', label: '小翅膀', emoji: '🪽' },
    { id: 'stinger', label: '蜂蜜尾', emoji: '🐝' },
    { id: 'fox', label: '狐狸尾', emoji: '🦊' },
  ];

  const HELD = [
    { id: 'auto', label: '跟随皮肤', glyph: '' },
    { id: 'none', label: '空着小手', glyph: '' },
    { id: 'orange', label: '小橘子', glyph: '🍊' },
    { id: 'heart', label: '小爱心', glyph: '💗' },
    { id: 'cookie', label: '小饼干', glyph: '🍪' },
    { id: 'coffee', label: '小咖啡', glyph: '☕' },
    { id: 'star', label: '小星星', glyph: '⭐' },
    { id: 'flower', label: '小花', glyph: '🌼' },
    { id: 'fish', label: '小鱼干', glyph: '🐟' },
  ];

  const TEMPERAMENTS = [
    {
      id: 'soft',
      label: '软乎乎',
      emoji: '🫠',
      desc: '动作慢半拍，喜欢发呆、伸展和偷偷融化。',
    },
    {
      id: 'dreamy',
      label: '小困包',
      emoji: '😴',
      desc: '经常打哈欠、原地打盹，醒了还要愣一会儿。',
    },
    {
      id: 'curious',
      label: '好奇鬼',
      emoji: '👀',
      desc: '爱东张西望、歪头和凑近闻闻，偶尔撞到桌角。',
    },
    {
      id: 'clingy',
      label: '黏人精',
      emoji: '🫶',
      desc: '喜欢看你、挥小手、哼歌，安安静静也要待在旁边。',
    },
  ];

  // Multipliers applied to the renderer's idle action weights.
  const IDLE_WEIGHTS = {
    soft: { stretch: 1.4, daze: 1.3, doze: 1.2, flop: 3.2, melt: 2.6, yawn: 1.5 },
    dreamy: { yawn: 2.6, doze: 2.8, daze: 2.2, flop: 1.8, melt: 1.6, sigh: 1.8 },
    curious: { lookAround: 2.2, sniff: 2.8, peek: 2.4, headTilt: 1.8, think: 1.7, bonk: 1.4 },
    clingy: { lookAround: 1.7, wave: 3.4, hum: 1.8, tailChase: 1.6, headTilt: 1.5, peek: 1.6 },
  };

  const ANIMALS = [
    {
      id: 'cat', label: '小奶猫', emoji: '🐱', desc: '奶油猫猫，抱着小鱼干到处看。',
      paletteId: 'cloud', hat: 'none', ears: 'cat', tail: 'cat', heldId: 'fish', temperament: 'clingy',
      art: 'kitten',
      artFrames: ['idle', 'blink'],
      lines: ['喵～你今天回来得好早', '尾巴借你摸一下，就一下', '小鱼干我先帮你看着'],
    },
    {
      id: 'bunny', label: '奶油兔', emoji: '🐰', desc: '软软兔耳，喜欢偷偷比心。',
      paletteId: 'cream', hat: 'none', ears: 'bunny', tail: 'puff', heldId: 'heart', temperament: 'soft',
      art: 'bunny',
      artFrames: ['idle', 'blink'],
      lines: ['耳朵垂下来一点，是放松的意思', '我偷偷比了个心，你看见了吗', '跳不动了，让我靠一会儿'],
    },
    {
      id: 'bear', label: '焦糖熊', emoji: '🐻', desc: '焦糖小熊，慢吞吞地抱着饼干。',
      paletteId: 'caramel', hat: 'none', ears: 'bear', tail: 'puff', heldId: 'cookie', temperament: 'dreamy',
      art: 'bear',
      artFrames: ['idle', 'blink'],
      lines: ['饼干分你半块，别嫌弃', '我慢，但我一直在', '抱一下就不累了'],
    },
    {
      id: 'fox', label: '小狐狸', emoji: '🦊', desc: '橘色狐狸，耳朵和尾巴会轻轻晃。',
      paletteId: 'fox', hat: 'none', ears: 'fox', tail: 'fox', heldId: 'none', temperament: 'curious',
      art: 'fox',
      artFrames: ['idle', 'blink'],
      lines: ['你屏幕上那个是什么，让我看看', '尾巴不是我弄乱的，真的', '我在听，你继续说'],
    },
    {
      id: 'panda', label: '团子熊猫', emoji: '🐼', desc: '黑白团子，抱着饼干发一会儿呆。',
      paletteId: 'panda', hat: 'none', ears: 'bear', tail: 'puff', heldId: 'cookie', temperament: 'dreamy',
      art: 'panda',
      artFrames: ['idle', 'blink'],
      lines: ['今天也要慢慢来', '黑眼圈是天生的，不是熬夜', '竹子味的饼干，要试试吗'],
    },
    {
      id: 'frog', label: '薄荷蛙', emoji: '🐸', desc: '薄荷蛙蛙，东张西望又想蹦一下。',
      paletteId: 'mint', hat: 'none', ears: 'frog', tail: 'none', heldId: 'none', temperament: 'curious',
      art: 'frog',
      artFrames: ['idle', 'blink'],
      lines: ['呱，这里凉快', '我跳一下，你别吓到', '下雨天最适合发呆了'],
    },
    {
      id: 'penguin', label: '小企鹅', emoji: '🐧', desc: '蓝白企鹅，扇着小翅膀等你回来。',
      paletteId: 'penguin', hat: 'none', ears: 'none', tail: 'wings', heldId: 'fish', temperament: 'soft',
      art: 'penguin',
      artFrames: ['idle', 'blink'],
      lines: ['我走路有点晃，但不会摔', '翅膀扇不动，抱抱可以', '冷的话，靠过来点'],
    },
    {
      id: 'dog', label: '小柴犬', emoji: '🐕', desc: '奶油柴犬，立着耳朵等你下班。',
      paletteId: 'caramel', hat: 'none', ears: 'dog', tail: 'puff', heldId: 'none', temperament: 'clingy',
      art: 'dog',
      artFrames: ['idle', 'blink'],
      lines: ['你回来啦！我一直在这儿', '今天也守着你', '摸摸头，就现在'],
    },
    {
      id: 'sheep', label: '棉花羊', emoji: '🐑', desc: '云朵一样的毛，走路轻轻的。',
      paletteId: 'cloud', hat: 'none', ears: 'sheep', tail: 'puff', heldId: 'none', temperament: 'dreamy',
      art: 'sheep',
      artFrames: ['idle', 'blink'],
      lines: ['毛茸茸的，可以靠', '数我不如数羊，数着数着就睡了', '今天风很软'],
    },
    {
      id: 'dino', label: '小恐龙', emoji: '🦕', desc: '薄荷小恐龙，尾巴甩来甩去。',
      paletteId: 'mint', hat: 'none', ears: 'dino', tail: 'puff', heldId: 'none', temperament: 'curious',
      art: 'dino',
      artFrames: ['idle', 'blink'],
      lines: ['我不咬人，真的', '尾巴甩到你了？对不起', '我其实很小一只'],
    },
    {
      id: 'duck', label: '小黄鸭', emoji: '🐤', desc: '扁嘴巴小黄鸭，走路一摇一摆。',
      paletteId: 'duck', hat: 'none', ears: 'none', tail: 'puff', heldId: 'none', temperament: 'soft',
      art: 'duck',
      artFrames: ['idle', 'blink'],
      lines: ['嘎，今天也要开心', '我摇起来是不是有点好笑', '嘴巴扁，但心是圆的'],
    },
  ];

  const DEFAULT = Object.freeze({
    version: VERSION,
    enabled: false,
    animalId: 'custom',
    paletteId: 'peach',
    bodyColor: '',
    hat: 'auto',
    ears: 'auto',
    tail: 'auto',
    heldId: 'auto',
    temperament: 'soft',
  });

  const byId = (list, id) => list.find((item) => item.id === id) || null;

  function normalize(input) {
    const src = input && typeof input === 'object' ? input : {};
    const palette = byId(PALETTES, src.paletteId);
    const hat = byId(HATS, src.hat);
    const ears = byId(EARS, src.ears);
    const tail = byId(TAILS, src.tail);
    const held = byId(HELD, src.heldId);
    const temperament = byId(TEMPERAMENTS, src.temperament);
    // 动物预设关闭时，只认方块仔本体和用户自己拍的照片宠物
    const animalId = src.animalId === 'custom' || src.animalId === EXPLORER_ID || isPhotoId(src.animalId) || (ANIMAL_PRESETS_ENABLED && byId(ANIMALS, src.animalId))
      ? src.animalId
      : DEFAULT.animalId;
    const bodyColor = cleanHex(src.bodyColor);
    const paletteId = src.paletteId === CUSTOM_PALETTE_ID && bodyColor ? CUSTOM_PALETTE_ID : palette ? palette.id : DEFAULT.paletteId;

    return {
      version: VERSION,
      enabled: !!src.enabled,
      animalId,
      paletteId,
      bodyColor,
      hat: hat ? hat.id : DEFAULT.hat,
      ears: ears ? ears.id : DEFAULT.ears,
      tail: tail ? tail.id : DEFAULT.tail,
      heldId: held ? held.id : DEFAULT.heldId,
      temperament: temperament ? temperament.id : DEFAULT.temperament,
    };
  }

  function palette(input) {
    const cfg = normalize(input);
    if (cfg.paletteId === CUSTOM_PALETTE_ID && cfg.bodyColor) return derivePalette(cfg.bodyColor);
    return byId(PALETTES, cfg.paletteId) || PALETTES[0];
  }

  function heldGlyph(input) {
    const cfg = normalize(input);
    const item = byId(HELD, cfg.heldId);
    return item && cfg.heldId !== 'auto' ? item.glyph || '' : null;
  }

  function accessory(input) {
    return normalize(input);
  }

  /* ---- 位图形象 ----------------------------------------------------------
   * 只有配了 art 的形象才走渲染图。art 是 assets/pets 下的文件名主干，
   * 完整路径为 <art>-idle-01.png（相对于 src/renderer/ 解析，
   * 所以 pet / wardrobe / settings 三个页面都用同一个前缀）。
   * 没有 art 的形象自动回落到原有 CSS 轮廓。 */
  const ART_DIR = '../assets/pets/';
  // 每个形象按状态出帧。blink 是「闭眼」帧，同时兼任眯眼笑和睡觉，
  // 一帧覆盖三个状态，是位图宠物"活起来"最划算的一帧。
  const ART_STATES = {
    idle: 'idle-01',
    blink: 'blink-01',
  };
  const ART_FRAMES = ['idle', 'blink'];

  // 方块仔（custom）是最初的 mascot，也是新用户的默认形象。
  // 它同样要有渲染图，否则第一眼就是劣质造型——这是最贵的一屏。
  // v3.3：经典方块仔回到原来的 CSS 立体方块（42 种表情、眼神跟随、配色/配件全保留）。
  // 需要静态图的地方（例如配对页头像）用 classic-cube.png——不再用旧的白色毛绒 cube-idle-01.webp。
  const CUSTOM_ACTOR = { art: 'classic-cube', artFrames: ['idle'], files: { idle: ART_DIR + 'classic-cube.png' } };

  // 探险方块仔：头顶小灯 + 探险小包的插画版（renderer/pet/sprites），在形象馆里单独可选。
  const EXPLORER_ID = 'explorer';
  const EXPLORER = {
    id: EXPLORER_ID,
    label: '探险方块仔',
    emoji: '🎒',
    desc: '头顶小灯、背着探险小包的插画版，会走路、伸懒腰、睡觉、被点晕。',
    lines: ['小灯亮了，出发去探险'],
    sprite: true,
  };

  /* ---- 照片宠物 ----------------------------------------------------------
   * 用户拍一张路边的小动物，主进程抠底/归一化后存到 userData/pets/。
   * 这些文件不在 src 里（打包后 asar 只读），所以它们带的是 file:// 绝对地址，
   * 由 registerPhotoPets() 在页面启动时注入。未注册时 artFile 返回 null，
   * 自动回落到 CSS 轮廓，不会出现裂图。 */
  const PHOTO_RE = /^photo-[a-z0-9]{4,24}$/;
  const externals = new Map();

  function registerPhotoPets(list) {
    externals.clear();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || !PHOTO_RE.test(String(item.id || ''))) continue;
      if (!item.idle) continue;
      const frames = item.blink ? ['idle', 'blink'] : ['idle'];
      externals.set(item.id, {
        id: item.id,
        label: item.name || '路边捡到的',
        emoji: '📷',
        desc: '你亲手拍下的那一只。',
        photo: true,
        art: item.id,
        artFrames: frames,
        files: { idle: item.idle, blink: item.blink || null },
        paletteId: 'caramel',
        hat: 'none',
        ears: 'none',
        tail: 'none',
        heldId: 'none',
        temperament: item.temperament || 'curious',
        lines: ['你把我从路边带回来了', '这张照片拍得我有点呆', '今天也陪你一会儿'],
      });
    }
    return photoPets();
  }

  function photoPets() {
    return [...externals.values()];
  }

  function isPhotoId(id) {
    return PHOTO_RE.test(String(id || ''));
  }

  /** 把 animalId 解析成"有素材的演员"，custom 走内置描述。 */
  function actorOf(animalId) {
    if (externals.has(animalId)) return externals.get(animalId);
    if (animalId === 'custom') return CUSTOM_ACTOR;
    if (animalId === EXPLORER_ID) return { art: 'explorer', artFrames: ['idle'], files: { idle: '../pet/sprites/idle.png' } };
    return byId(ANIMALS, animalId);
  }

  /** 取某形象某状态的帧路径；没有这一帧就回落到 idle，避免出现碎图。 */
  function artFile(animalId, stateName) {
    const animal = actorOf(animalId);
    if (!animal || !animal.art) return null;
    const want = ART_STATES[stateName] ? stateName : 'idle';
    const frames = animal.artFrames || ['idle'];
    const state = frames.includes(want) ? want : 'idle';
    // 照片宠物是运行时文件，带完整 file:// 地址，不走 ART_DIR 前缀
    if (animal.files) return animal.files[state] || animal.files.idle || null;
    return ART_DIR + animal.art + '-' + ART_STATES[state] + '.webp';
  }

  /** 该形象是否具备某状态的帧（渲染层据此决定要不要挂动画/叠加层）。 */
  function hasArtFrame(animalId, stateName) {
    const animal = actorOf(animalId);
    if (!animal || !animal.art) return false;
    return (animal.artFrames || ['idle']).includes(stateName);
  }

  function hasArt(animalId) {
    const animal = actorOf(animalId);
    return !!(animal && animal.art);
  }

  function weights(input) {
    const cfg = normalize(input);
    return Object.assign({}, IDLE_WEIGHTS[cfg.temperament] || {});
  }

  function randomize(input) {
    const current = normalize(input);
    const pick = (list, currentId, concreteOnly) => {
      const choices = list.filter((item) => {
        if (concreteOnly && (item.id === 'auto' || item.id === 'none')) return false;
        return list.length < 2 || item.id !== currentId;
      });
      return choices[Math.floor(Math.random() * choices.length)] || list[0];
    };
    if (ANIMAL_PRESETS_ENABLED && Math.random() < 0.7) {
      const animals = ANIMALS.filter((animal) => animal.id !== current.animalId);
      const animal = animals[Math.floor(Math.random() * animals.length)] || ANIMALS[0];
      return normalize({
        ...animal,
        animalId: animal.id,
        enabled: true,
        temperament: pick(TEMPERAMENTS, current.temperament, false).id,
      });
    }
    return normalize({
      enabled: true,
      animalId: 'custom',
      paletteId: pick(PALETTES, current.paletteId, false).id,
      hat: pick(HATS, current.hat, true).id,
      ears: pick(EARS, current.ears, true).id,
      tail: pick(TAILS, current.tail, true).id,
      heldId: pick(HELD, current.heldId, true).id,
      temperament: pick(TEMPERAMENTS, current.temperament, false).id,
    });
  }

  function optionLabel(list, id) {
    const item = byId(list, id);
    return item ? item.label : '';
  }

  return {
    VERSION,
    ANIMAL_PRESETS_ENABLED,
    PALETTES,
    CUSTOM_PALETTE_ID,
    EXPLORER_ID,
    EXPLORER,
    isExplorer: (id) => id === EXPLORER_ID,
    derivePalette,
    cleanHex,
    HATS,
    EARS,
    TAILS,
    HELD,
    TEMPERAMENTS,
    ANIMALS,
    DEFAULT,
    normalize,
    palette,
    heldGlyph,
    accessory,
    animalById: (id) => byId(ANIMALS, id),
    ART_DIR,
    ART_STATES,
    ART_FRAMES,
    PHOTO_RE,
    registerPhotoPets,
    photoPets,
    isPhotoId,
    artFile,
    hasArt,
    hasArtFrame,
    weights,
    randomize,
    optionLabel,
  };
});
