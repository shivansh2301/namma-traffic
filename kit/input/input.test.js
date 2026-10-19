'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Input = require('./input.js');

test('ramp reaches full scale in 1/rate seconds and never overshoots', () => {
  let v = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 3; i++) v = Input.ramp(v, 1, 10, dt); // 0.1 s at 30 Hz
  assert.ok(Math.abs(v - 1) < 1e-9);
  v = Input.ramp(v, 1, 10, dt);
  assert.equal(v, 1);
  v = Input.ramp(v, -1, 10, dt);
  assert.ok(v < 1 && v > 0.6);
});

test('keys() tracks held keys and single presses', () => {
  const listeners = {};
  const target = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} };
  const k = Input.keys(target, ['Space']);
  let prevented = 0;
  const ev = (code) => ({ code, target: null, preventDefault: () => prevented++ });
  listeners.keydown(ev('Space'));
  listeners.keydown(ev('Space')); // auto-repeat
  assert.ok(k.down('Space'));
  assert.equal(k.pressed('Space'), true);
  assert.equal(k.pressed('Space'), false);
  listeners.keyup(ev('Space'));
  assert.ok(!k.down('Space'));
  assert.equal(prevented, 3);
});
