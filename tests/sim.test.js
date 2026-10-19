'use strict';
// SPEC §13.1: determinism, serialisation and performance of shared/sim.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sim, World, H, recordBot } = require('./helpers.js');

test('determinism: same level, seed and inputs give identical states', () => {
  for (const levelId of World.levelIds) {
    const rec = recordBot(levelId, 11, 2400);
    const r = H.checkDeterminism(Sim, { levelId, seed: 11, inputs: rec.inputs });
    assert.ok(r.ok, `level ${levelId}: ${r.hashA} vs ${r.hashB}`);
  }
});

test('determinism: a different seed gives a different run', () => {
  const a = H.run(Sim, { levelId: 1, seed: 1, maxTicks: 300, policy: () => ({ steer: 0, brake: 0, horn: 0 }) });
  const b = H.run(Sim, { levelId: 1, seed: 2, maxTicks: 300, policy: () => ({ steer: 0, brake: 0, horn: 0 }) });
  assert.notEqual(H.hashState(a.state), H.hashState(b.state));
});

test('serialisation: a JSON round-trip mid-run continues identically', () => {
  for (const levelId of World.levelIds) {
    const rec = recordBot(levelId, 5, 3000);
    const r = H.checkSerialisation(Sim, { levelId, seed: 5, inputs: rec.inputs, splitAt: 1234 });
    assert.ok(r.ok, `level ${levelId}`);
  }
});

test('state is plain JSON: no functions, NaN, Infinity or undefined fields', () => {
  const rec = recordBot(3, 9, 1500);
  const walk = (v, path) => {
    if (typeof v === 'function') assert.fail('function at ' + path);
    if (typeof v === 'number') assert.ok(Number.isFinite(v), 'non-finite number at ' + path);
    if (v === undefined) assert.fail('undefined at ' + path);
    if (v && typeof v === 'object') {
      assert.ok(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, 'non-plain object at ' + path);
      for (const k of Object.keys(v)) walk(v[k], path + '.' + k);
    }
  };
  walk(rec.state, 'state');
});

test('performance: 10,000 ticks of level 2 average <= 2 ms per step', () => {
  const rec = recordBot(2, 3, 10000);
  const r = H.timeSteps(Sim, { levelId: 2, seed: 3, inputs: rec.inputs, ticks: 10000 });
  assert.ok(r.avgMs <= 2, `avg ${r.avgMs.toFixed(3)} ms`);
});

test('replays survive the compact input encoding', () => {
  const rec = recordBot(1, 4, 900);
  const decoded = H.decodeInputs(H.encodeInputs(rec.inputs));
  const a = H.run(Sim, { levelId: 1, seed: 4, inputs: rec.inputs });
  const b = H.run(Sim, { levelId: 1, seed: 4, inputs: decoded });
  assert.equal(H.hashState(a.state), H.hashState(b.state));
});

test('multiplayer-ready: players[] and per-player input arrays', () => {
  const st = Sim.create(1, 1);
  assert.equal(st.players.length, 1);
  const a = Sim.create(1, 1);
  for (let i = 0; i < 200; i++) {
    Sim.step(st, { steer: 0.2, brake: 0, horn: 0 });
    Sim.step(a, [{ steer: 0.2, brake: 0, horn: 0 }]);
  }
  assert.equal(H.hashState(st), H.hashState(a));
});
