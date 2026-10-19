'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FixedStep = require('./fixed-step.js');

function drive(opts) {
  let steps = 0;
  const alphas = [];
  const loop = FixedStep.createLoop(Object.assign({
    dt: 1 / 30,
    raf: () => {},
    step: () => { steps++; },
    render: (a) => alphas.push(a),
  }, opts));
  return { loop, get steps() { return steps; }, alphas };
}

test('steps match elapsed time and alpha is the remainder', () => {
  const d = drive();
  d.loop.tick(0);
  for (let f = 1; f <= 60; f++) d.loop.tick(f * 1000 / 60); // 1 s at 60 fps
  assert.ok(d.steps === 29 || d.steps === 30, 'steps ' + d.steps); // float accumulation may leave one in the bank
  const a = d.alphas[d.alphas.length - 1];
  assert.ok(a >= 0 && a < 1.0001);
});

test('a long frame is clamped to maxFrame', () => {
  const d = drive({ maxFrame: 0.25 });
  d.loop.tick(0);
  d.loop.tick(5000);
  assert.ok(d.steps <= 8, 'steps ' + d.steps);
});

test('pause stops stepping and resume does not replay paused time', () => {
  const d = drive();
  d.loop.tick(0);
  d.loop.tick(100);
  const before = d.steps;
  d.loop.pause();
  d.loop.tick(200);
  d.loop.tick(3000);
  assert.equal(d.steps, before);
  d.loop.resume();
  d.loop.tick(3100);
  d.loop.tick(3200);
  assert.ok(d.steps - before <= 4);
});

test('interp lerps between previous and current positions', () => {
  const it = FixedStep.createInterp();
  const e = { id: 7, x: 0, y: 10 };
  it.begin(); it.add([e]);
  e.x = 2; e.y = 20;
  assert.equal(it.x(e, 0.5), 1);
  assert.equal(it.y(e, 0.25), 12.5);
  assert.equal(it.dx(e), 2);
  const fresh = { id: 8, x: 5, y: 5 };
  assert.equal(it.x(fresh, 0.5), 5); // unknown ids draw at their current position
});
