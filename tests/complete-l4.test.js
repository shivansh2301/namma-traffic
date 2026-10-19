'use strict';
// Delivery completability: the scripted bot finishes shift 4 with condition > 0
// and every order delivered, on 20 seeds. One file per level so they run in parallel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { botFinish } = require('./helpers.js');

test('bot delivers every order of level 4 on seeds 1-20', () => {
  const failures = [];
  for (let seed = 1; seed <= 20; seed++) {
    const { result } = botFinish(4, seed);
    if (!result || result.outcome !== 'completed' || !(result.condition > 0) || result.delivered !== result.total) {
      failures.push(seed + ':' + (result ? result.outcome + ' ' + result.delivered + '/' + result.total : 'timeout'));
    }
  }
  assert.deepEqual(failures, []);
});
