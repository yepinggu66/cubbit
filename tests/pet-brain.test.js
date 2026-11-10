'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PetBrain } = require('../src/main/pet-brain');

test('pet brain chooses exploration when curious and idle', () => {
  let now = Date.parse('2026-11-07T10:00:00+08:00');
  const brain = new PetBrain({ now: () => now, random: () => 0.2 });
  now += 5 * 60 * 1000;
  const decision = brain.observe({
    visible: true,
    busy: false,
    pointerNear: false,
    enabled: true,
    paired: false,
    presenceKind: 'working',
    lastInteractionAt: 0,
  });
  assert.ok(decision);
  assert.equal(decision.action, 'crawl');
  assert.equal(decision.scene, 'belly_crawl');
  assert.equal(decision.reason, 'curiosity');
});

test('pet brain rests when energy is low', () => {
  const file = path.join(os.tmpdir(), `cubbit-brain-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ energy: 10, curiosity: 80, social: 20, lastTickAt: Date.now() - 60000 }));
  try {
    const brain = new PetBrain({ file });
    const decision = brain.observe({
      visible: true,
      busy: false,
      pointerNear: false,
      enabled: true,
      paired: false,
      presenceKind: 'working',
      lastInteractionAt: 0,
    });
    assert.equal(decision.action, 'rest');
    assert.equal(decision.scene, 'sleepy_nod');
    assert.equal(decision.reason, 'low_energy');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('focus context turns a quiet thought into a work-companion scene', () => {
  const file = path.join(os.tmpdir(), `cubbit-brain-focus-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      energy: 50,
      curiosity: 20,
      social: 20,
      lastTickAt: Date.now() - 60000,
      lastDecisionAt: 0,
    })
  );
  try {
    const brain = new PetBrain({ file, random: () => 0.1 });
    const decision = brain.observe({
      visible: true,
      busy: false,
      pointerNear: false,
      enabled: true,
      paired: false,
      presenceKind: 'focus',
      lastInteractionAt: 0,
    });
    assert.equal(decision.action, 'think');
    assert.equal(decision.scene, 'focus_quiet');
    assert.equal(brain.snapshot().lastScene, 'focus_quiet');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('pet brain does not decide while hidden or interacting', () => {
  const brain = new PetBrain({ random: () => 0.2 });
  assert.equal(brain.observe({ visible: false, lastInteractionAt: 0 }), null);
  assert.equal(brain.observe({ visible: true, busy: true, lastInteractionAt: 0 }), null);
  assert.equal(
    brain.observe({
      visible: true,
      busy: false,
      enabled: true,
      pointerNear: false,
      presenceKind: 'working',
      lastInteractionAt: Date.now(),
    }),
    null
  );
});
