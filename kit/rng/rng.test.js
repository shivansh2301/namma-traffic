'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Rng = require('./rng.js');

test('same seed gives the same sequence', () => {
  const a = Rng.create(42), b = Rng.create(42);
  for (let i = 0; i < 1000; i++) assert.equal(Rng.next(a), Rng.next(b));
});

test('state survives a JSON round-trip mid-sequence', () => {
  const a = { rng: Rng.hash('seed', 7), other: 'data' };
  for (let i = 0; i < 37; i++) Rng.next(a);
  const b = JSON.parse(JSON.stringify(a));
  for (let i = 0; i < 100; i++) assert.equal(Rng.next(a), Rng.next(b));
});

test('hash is stable, order-sensitive and separator-aware', () => {
  assert.equal(Rng.hash('a', 1), Rng.hash('a', 1));
  assert.notEqual(Rng.hash('ab', 'c'), Rng.hash('a', 'bc'));
  assert.notEqual(Rng.hash(1, 2), Rng.hash(2, 1));
  const v = Rng.hash('x');
  assert.ok(Number.isInteger(v) && v >= 0 && v < 2 ** 32);
});

test('next is in [0,1) with a sane mean', () => {
  const h = Rng.create(1);
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const x = Rng.next(h);
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01);
});

test('int is inclusive and covers the range', () => {
  const h = Rng.create(9);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = Rng.int(h, 2, 5);
    assert.ok(v >= 2 && v <= 5);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4, 5]);
});

test('weighted never returns zero-weight keys', () => {
  const h = Rng.create(3);
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 3000; i++) counts[Rng.weighted(h, { a: 1, b: 0, c: 3 })]++;
  assert.equal(counts.b, 0);
  assert.ok(counts.c > counts.a * 2);
  assert.equal(Rng.weighted(h, { a: 0 }), null);
});

test('poisson mean is roughly right', () => {
  const h = Rng.create(5);
  let sum = 0;
  for (let i = 0; i < 5000; i++) sum += Rng.poisson(h, 4);
  assert.ok(Math.abs(sum / 5000 - 4) < 0.15);
  assert.equal(Rng.poisson(h, 0), 0);
});
