'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Camera = require('./camera.js');

test('target sits at the anchor and world<->screen round-trips', () => {
  const cam = Camera.create({ viewMin: 18, viewMax: 21, anchorY: 0.8 });
  cam.resize(360, 640);
  cam.update(1 / 60, 3, 100, 0);
  assert.ok(Math.abs(cam.sx(3) - 180) < 1e-9);
  assert.ok(Math.abs(cam.sy(100) - 512) < 1e-9);
  assert.ok(Math.abs(cam.wx(cam.sx(7.5)) - 7.5) < 1e-9);
  assert.ok(Math.abs(cam.wy(cam.sy(123)) - 123) < 1e-9);
  assert.ok(cam.top() > 100 && cam.bottom() < 100);
});

test('view zooms out with speed', () => {
  const cam = Camera.create({ viewMin: 18, viewMax: 21 });
  cam.resize(360, 640);
  cam.snap(0, 0, 0);
  for (let i = 0; i < 600; i++) cam.update(1 / 60, 0, 0, 1);
  assert.ok(Math.abs(cam.viewW - 21) < 0.01);
});

test('horizontal clamp keeps the view inside bounds', () => {
  const cam = Camera.create({ viewMin: 10, viewMax: 10 });
  cam.resize(100, 200);
  cam.snap(0, 0, 0);
  cam.update(1, -100, 0, 0, -5, 30);
  assert.ok(cam.left() >= -5 - 1e-9);
});

test('reduceShake disables shake', () => {
  const cam = Camera.create();
  cam.resize(100, 100);
  cam.reduceShake = true;
  cam.shake(1);
  cam.update(1 / 60, 0, 0, 0);
  assert.equal(cam.shakeX, 0);
  assert.equal(cam.shakeY, 0);
});
