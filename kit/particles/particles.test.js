'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Particles = require('./particles.js');

test('spawn fills to capacity then refuses', () => {
  const P = Particles.create(3);
  assert.equal(P.spawn(0, 0, 0, 0, 1, 1), 0);
  assert.equal(P.spawn(0, 0, 0, 0, 1, 1), 1);
  assert.equal(P.spawn(0, 0, 0, 0, 1, 1), 2);
  assert.equal(P.spawn(0, 0, 0, 0, 1, 1), -1);
  assert.equal(P.count, 3);
});

test('update integrates and retires expired particles, keeping the rest packed', () => {
  const P = Particles.create(8);
  P.spawn(0, 0, 1, 2, 0.05, 1, 0, 1);
  P.spawn(10, 10, 0, 0, 1.0, 1, 0, 2);
  P.spawn(20, 20, 0, 0, 0.05, 1, 0, 3);
  P.update(0.1);
  assert.equal(P.count, 1);
  assert.equal(P.color[0], 2);
  assert.equal(P.x[0], 10);
});

test('z arcs up and lands with gravity', () => {
  const P = Particles.create(1);
  P.spawn(0, 0, 0, 0, 5, 1, 0, 0, 3, 9.8);
  let peak = 0;
  for (let i = 0; i < 120; i++) { P.update(1 / 60); peak = Math.max(peak, P.z[0]); }
  assert.ok(peak > 0.3);
  assert.equal(P.z[0], 0);
});
