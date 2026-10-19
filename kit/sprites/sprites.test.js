'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sprites = require('./sprites.js');

test('shade lightens and darkens', () => {
  assert.equal(Sprites.shade('#808080', 0), '#808080');
  assert.equal(Sprites.shade('#000000', 1), '#ffffff');
  assert.equal(Sprites.shade('#ffffff', -1), '#000000');
  assert.equal(Sprites.shade('#204060', -0.5), '#102030');
});

test('hash01 is deterministic and in [0,1)', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = Sprites.hash01(i, 3, 7);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, Sprites.hash01(i, 3, 7));
    seen.add(Math.floor(v * 10));
  }
  assert.equal(seen.size, 10);
});

test('cache bakes lazily with a fake canvas', () => {
  const calls = [];
  global.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return { setTransform: (...a) => calls.push(['t', ...a]), fillRect: () => calls.push(['f']) }; }
  };
  try {
    const c = Sprites.create({ pad: 0 });
    c.register('box', 2, 1, (g) => g.fillRect(-1, -0.5, 2, 1));
    c.setScale(10);
    const s = c.get('box');
    assert.equal(s.canvas.width, 20);
    assert.equal(s.canvas.height, 10);
    assert.equal(c.get('box'), s); // cached
    c.setScale(20);
    assert.notEqual(c.get('box'), s); // re-baked at the new scale
  } finally {
    delete global.OffscreenCanvas;
  }
});
