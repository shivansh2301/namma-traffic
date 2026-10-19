'use strict';
// No leftover git merge-conflict markers in shipped files (a stray one broke the page once).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const DIRS = ['client', 'shared', 'kit', 'docs', 'tests', 'tools'];

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(js|html|md|json|webmanifest)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('no merge-conflict markers', () => {
  const bad = [];
  for (const d of DIRS) for (const f of files(path.join(root, d))) {
    if (/^(<{7}|>{7}) /m.test(fs.readFileSync(f, 'utf8'))) bad.push(path.relative(root, f));
  }
  for (const f of ['index.html', 'AGENTS.md', 'README.md']) if (/^(<{7}|>{7}) /m.test(fs.readFileSync(path.join(root, f), 'utf8'))) bad.push(f);
  assert.deepEqual(bad, []);
});
