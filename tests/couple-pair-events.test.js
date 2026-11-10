'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CoupleService } = require('../src/main/couple/service');

function fakeTimers() {
  return {
    setTimeout() {
      return { unref() {} };
    },
    clearTimeout() {},
  };
}

test('createInvite emits pair intent and pair failure for analytics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubbit-pair-'));
  try {
    const service = new CoupleService({
      dir,
      adapter: {},
      backend: {
        async createInvite() {
          const error = new Error('offline');
          error.code = 'NETWORK';
          throw error;
        },
      },
      timers: fakeTimers(),
    });
    const intents = [];
    const failures = [];
    service.on('pairIntent', (event) => intents.push(event));
    service.on('pairFailure', (event) => failures.push(event));

    const result = await service.createInvite();
    assert.equal(result.ok, false);
    assert.deepEqual(intents, [{ role: 'inviter', method: 'invite_code' }]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].role, 'inviter');
    assert.equal(failures[0].code, 'NETWORK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
