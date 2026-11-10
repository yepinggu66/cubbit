'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const DIY = require('../src/shared/diy');
const EXPR = require('../src/shared/expressions');

test('DIY normalization rejects unknown values and preserves defaults', () => {
  const cfg = DIY.normalize({
    enabled: 1,
    paletteId: 'missing',
    hat: 'missing',
    ears: 'missing',
    tail: 'missing',
    heldId: 'missing',
    temperament: 'missing',
  });

  assert.equal(cfg.enabled, true);
  assert.equal(cfg.animalId, DIY.DEFAULT.animalId);
  assert.equal(cfg.paletteId, DIY.DEFAULT.paletteId);
  assert.equal(cfg.hat, DIY.DEFAULT.hat);
  assert.equal(cfg.ears, DIY.DEFAULT.ears);
  assert.equal(cfg.tail, DIY.DEFAULT.tail);
  assert.equal(cfg.heldId, DIY.DEFAULT.heldId);
  assert.equal(cfg.temperament, DIY.DEFAULT.temperament);
});

test('DIY palettes expose every renderer color variable', () => {
  const keys = ['body1', 'body2', 'body3', 'eye', 'pupil', 'blush', 'rim', 'glow'];
  for (const palette of DIY.PALETTES) {
    for (const key of keys) assert.ok(palette[key], `${palette.id}.${key}`);
  }
});

test('DIY held items resolve to glyphs and auto keeps the skin item', () => {
  assert.equal(DIY.heldGlyph({ heldId: 'orange' }), '🍊');
  assert.equal(DIY.heldGlyph({ heldId: 'none' }), '');
  assert.equal(DIY.heldGlyph({ heldId: 'auto' }), null);
});

test('temperaments only expose known idle multipliers', () => {
  for (const temperament of DIY.TEMPERAMENTS) {
    const weights = DIY.weights({ temperament: temperament.id });
    assert.ok(Object.keys(weights).length > 0);
    for (const value of Object.values(weights)) assert.ok(value > 0);
  }
});

test('randomize produces a concrete, valid DIY pet', () => {
  const cfg = DIY.randomize({ enabled: false, paletteId: 'peach' });
  assert.equal(cfg.enabled, true);
  assert.notEqual(cfg.paletteId, 'peach');
  assert.notEqual(cfg.hat, 'auto');
  assert.notEqual(cfg.ears, 'auto');
  assert.notEqual(cfg.tail, 'auto');
  assert.notEqual(cfg.heldId, 'auto');
  assert.deepEqual(DIY.normalize(cfg), cfg);
});

test('animal presets are publicly selectable and keep the cube as fallback', () => {
  assert.equal(DIY.ANIMAL_PRESETS_ENABLED, true);
  assert.ok(DIY.ANIMALS.length >= 11, `expected >= 11 animals, got ${DIY.ANIMALS.length}`);
  for (const animal of DIY.ANIMALS) {
    assert.ok(DIY.PALETTES.some((item) => item.id === animal.paletteId), animal.paletteId);
    assert.ok(DIY.HATS.some((item) => item.id === animal.hat), animal.hat);
    assert.ok(DIY.EARS.some((item) => item.id === animal.ears), animal.ears);
    assert.ok(DIY.TAILS.some((item) => item.id === animal.tail), animal.tail);
    assert.ok(DIY.HELD.some((item) => item.id === animal.heldId), animal.heldId);
    assert.equal(DIY.normalize({ ...animal, animalId: animal.id }).animalId, animal.id);
    assert.ok(Array.isArray(animal.lines) && animal.lines.length > 0, `${animal.id} needs lines`);
    assert.equal(DIY.animalById(animal.id).id, animal.id);
  }
  // 方块仔仍是合法选项，未知 id 回落到方块仔
  assert.equal(DIY.normalize({ animalId: 'custom' }).animalId, 'custom');
  assert.equal(DIY.normalize({ animalId: 'unicorn' }).animalId, 'custom');
});

test('every named expression uses known expression parts', () => {
  for (const [name, expression] of Object.entries(EXPR.EXPRESSIONS)) {
    for (const key of ['eyes', 'mouth', 'body', 'fx']) {
      if (expression[key]) {
        assert.ok(EXPR.PARTS[key].includes(expression[key]), `${name}.${key}=${expression[key]}`);
      }
    }
  }
});

test('cute-expression additions are present and reachable by events', () => {
  for (const name of ['blep', 'puddle', 'peekaboo', 'bonk', 'tinyWave', 'sleepySmile', 'shyPeek']) {
    assert.ok(EXPR.EXPRESSIONS[name], name);
  }

  const eventNames = Object.values(EXPR.EVENT_EXPRESSIONS).flat().map((item) => item.e);
  for (const name of ['blep', 'bonk', 'puddle', 'sleepySmile']) {
    assert.ok(eventNames.includes(name), name);
  }
});

test('every animal ships a real two-frame sprite set (12 只 × idle/blink)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  assert.equal(DIY.ANIMALS.length, 11, '11 只动物 + 方块仔 = 12 种形态');
  const ALL = ['custom'].concat(DIY.ANIMALS.map((a) => a.id));
  assert.equal(ALL.length, 12);

  for (const id of ALL) {
    assert.ok(DIY.hasArt(id), `${id} 应有渲染图`);
    // 经典方块仔只有一张静态头像（桌面上是 CSS 立体方块），不再用旧毛绒 blink 帧
    for (const state of id === 'custom' ? ['idle'] : ['idle', 'blink']) {
      const rel = DIY.artFile(id, state);
      const abs = path.join(__dirname, '..', 'src', 'renderer', rel.replace('../', ''));
      assert.ok(fs.existsSync(abs), `缺少素材：${abs}`);
      assert.ok(fs.statSync(abs).size > 8 * 1024, `${id} 的 ${state} 帧体积异常`);
    }
    if (id !== 'custom') assert.ok(DIY.hasArtFrame(id, 'blink'), `${id} 应具备 blink 帧`);
  }

  // 方块仔没有 ANIMALS 条目，但必须能解析到自己的渲染图
  assert.match(DIY.artFile('custom', 'idle'), /classic-cube\.png$/);
  // 未声明/不存在的东西要返回 null 或回落，不能拼出半个路径
  assert.equal(DIY.hasArt('nope'), false);
  assert.equal(DIY.artFile('nope', 'idle'), null);
  assert.equal(DIY.artFile('kitten', 'nope'), DIY.artFile('kitten', 'idle'));
});
