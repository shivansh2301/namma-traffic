'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Synth = require('./synth.js');

test('without Web Audio every call is a safe no-op', () => {
  const s = Synth.create({ muted: false });
  assert.equal(s.unlock(), false);
  assert.equal(s.ready, false);
  s.tone({ freq: 440 });
  s.noise({ dur: 0.1 });
  const l = s.loop({ kind: 'noise', gain: 0.1 });
  l.set({ gain: 0.2 });
  l.stop();
  s.setMuted(true);
  assert.equal(s.muted, true);
});
