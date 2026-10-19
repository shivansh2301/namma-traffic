'use strict';
// SPEC §3.1: shared modules must not touch the DOM, wall-clock time or Math.random.
// Also: the payload budget (SPEC §2) and that every client script is precached.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

for (const f of ['shared/world.js', 'shared/sim.js', 'shared/bot.js', 'kit/rng/rng.js']) {
  test(`${f} is pure`, () => {
    const src = strip(read(f));
    for (const bad of ['Math.random', 'Date', 'performance', 'window', 'document', 'localStorage', 'requestAnimationFrame']) {
      assert.ok(!new RegExp('\\b' + bad.replace('.', '\\.') + '\\b').test(src), `${f} uses ${bad}`);
    }
  });
}

function clientScripts() {
  const html = read('client/index.html');
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => path.normalize(path.join('client', m[1])));
}

test('payload: everything the page loads is <= 200 KB gzipped', () => {
  const files = ['client/index.html', 'client/manifest.webmanifest', 'client/icon.svg', ...clientScripts()];
  let total = 0;
  for (const f of files) total += zlib.gzipSync(fs.readFileSync(path.join(root, f)), { level: 9 }).length;
  assert.ok(total <= 200 * 1024, `gzipped total ${(total / 1024).toFixed(1)} KB`);
});

test('service worker precaches every script the page loads', () => {
  const sw = read('client/sw.js');
  for (const f of clientScripts()) {
    const rel = path.relative('client', f).split(path.sep).join('/');
    const asUrl = rel.startsWith('..') ? rel : './' + rel;
    assert.ok(sw.includes(`'${asUrl}'`), `sw.js is missing ${asUrl}`);
  }
});
