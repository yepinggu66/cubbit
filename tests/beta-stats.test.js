'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BetaStats,
  EVENT_FIELDS,
  hashPairingGroup,
  localDay,
  normalizeCohort,
} = require('../src/main/beta-stats');

test('beta event v2 carries cohort and stable pair hash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-beta-'));
  try {
    const beta = new BetaStats({
      dir,
      version: '2.7.2-soft',
      installId: 'aaaaaaaaaaaa',
      now: () => Date.parse('2026-11-06T09:00:00+08:00'),
      cohortProvider: () => 'couple',
      groupProvider: () => 'couple-123',
      sessionId: 'session-1',
    });
    const event = beta.log('app_open', { cold: true });
    assert.equal(event.schema, 2);
    assert.equal(event.c, 'couple');
    assert.equal(event.g, hashPairingGroup('couple-123'));
    assert.equal(event.day, '2026-11-06');
    assert.match(event.eid, /^[0-9a-f-]{36}$/);
    assert.equal(event.cold, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('beta event schema ignores unknown events and fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-beta-'));
  try {
    const beta = new BetaStats({
      dir,
      version: '2.7.2-soft',
      installId: 'aaaaaaaaaaaa',
      cohortProvider: () => 'solo',
    });
    assert.equal(beta.log('chat_text', { text: 'secret' }), null);
    const event = beta.log('interaction_local', {
      type: 'pet',
      text: 'must not be logged',
      apiKey: 'must not be logged',
    });
    assert.equal(event.type, 'pet');
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'text'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'apiKey'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cohort and date helpers normalize', () => {
  assert.equal(normalizeCohort('couple'), 'couple');
  assert.equal(normalizeCohort('SOLO'), 'solo');
  assert.equal(normalizeCohort('other'), 'unknown');
  assert.equal(localDay(Date.parse('2026-11-06T00:10:00+08:00')), '2026-11-06');
});

test('event whitelist does not contain content fields', () => {
  const fields = Object.values(EVENT_FIELDS).flat();
  for (const forbidden of ['text', 'message', 'screen', 'email', 'apiKey']) {
    assert.equal(fields.includes(forbidden), false);
  }
});
