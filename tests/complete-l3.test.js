'use strict';
// SPEC §13.1 completability: the scripted bot finishes level 3 with condition > 0 on 20 seeds.
// One file per level so node --test runs the levels in parallel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { botFinish } = require('./helpers.js');

test('bot completes level 3 on seeds 1-20', () => {
  const failures = [];
  for (let seed = 1; seed <= 20; seed++) {
    const { result } = botFinish(3, seed);
    if (!result || result.outcome !== 'arrived' || !(result.condition > 0)) {
      failures.push(seed + ':' + (result ? result.outcome : 'timeout'));
    }
  }
  assert.deepEqual(failures, []);
});
