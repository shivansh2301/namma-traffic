'use strict';
// client/lines.js: every dialogue key the client asks for exists (docs/concepts/dialogue.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'client/lines.js'), 'utf8').replace('})(window);', '})(globalThis);'), ctx);
const G = ctx.GameLines;

test('every pool is a non-empty list of non-empty strings', () => {
  const walk = (o, at) => {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) {
        assert.ok(v.length > 0, at + k + ' is empty');
        for (const s of v) assert.ok(typeof s === 'string' && s.trim().length > 0, at + k + ' has a blank line');
      } else walk(v, at + k + '.');
    }
  };
  walk(G.LINES, '');
});

test('every literal key the client uses exists', () => {
  const keys = new Set();
  for (const f of ['client/render.js', 'client/main.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/\b(?:S|say)\('([a-z]+\.[A-Za-z_]+)'\s*[,)]/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 20, 'found the keys');
  for (const k of keys) assert.ok(G.has(k), 'missing line pool ' + k);
  for (const kind of ['school', 'market', 'temple', 'wedding', 'cricket']) assert.ok(G.has('toast.busy_' + kind));
  for (const w of ['slip', 'drain', 'dog', 'stall']) assert.ok(G.has('toast.crash_' + w));
  for (const k of ['tip', 'water', 'sweets', 'chai', 'momo', 'biryani', 'skill', 'greenWave', 'puncture', 'fine', 'warning', 'brakes', 'cancel', 'skillSlow']) assert.ok(G.has('toast.' + k), k);
});

test('gaali lines are partly masked, placeholders fill in', () => {
  for (const k of ['ped', 'driver']) {
    const p = G.pool('gaali.' + k);
    assert.ok(p.filter((s) => s.includes('*')).length * 2 >= p.length, 'most gaali.' + k + ' lines are masked');
  }
  assert.equal(G.fill('{Who} shouted', { who: 'the auto driver' }), 'The auto driver shouted');
  assert.equal(G.say('toast.dogBite', { amount: 40 }, 0), 'Bitten! Anti-rabies shot: −₹40.');
  assert.equal(G.say('no.such', {}), '');
});
