'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Storage = require('./storage.js');

test('round-trips JSON with a prefix', () => {
  const b = Storage.memoryBackend();
  const s = Storage.create('nc.', b);
  assert.equal(s.persistent, true);
  s.set('progress', { 1: { stars: 2 } });
  assert.deepEqual(s.get('progress', {}), { 1: { stars: 2 } });
  assert.ok(b.getItem('nc.progress'));
});

test('merges stored objects over defaults', () => {
  const s = Storage.create('x.', Storage.memoryBackend());
  s.set('settings', { muted: true });
  assert.deepEqual(s.get('settings', { muted: false, reduceShake: false }), { muted: true, reduceShake: false });
});

test('a throwing backend falls back to memory and never throws', () => {
  const evil = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  const s = Storage.create('nc.', evil);
  assert.equal(s.persistent, false);
  assert.equal(s.set('a', 1), true); // memory fallback
  assert.equal(s.get('a', 0), 1);
});

test('corrupt JSON returns the fallback', () => {
  const b = Storage.memoryBackend();
  b.setItem('nc.bad', '{nope');
  const s = Storage.create('nc.', b);
  assert.deepEqual(s.get('bad', { ok: 1 }), { ok: 1 });
});
