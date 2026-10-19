'use strict';
// Busy gully stretches (docs/concepts/delivery-missions.md, "Busy gullies").
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sim, World, Bot } = require('./helpers.js');
const { T } = World;

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test('busy stretches sit inside gully segments, clear of the start, and are seed-deterministic', () => {
  let total = 0;
  for (const id of World.levelIds) {
    const L = World.level(id);
    for (const seed of SEEDS) {
      const a = Sim.create(id, seed);
      assert.deepEqual(a.busy, Sim.create(id, seed).busy);
      for (const b of a.busy) {
        total++;
        const s = World.segmentAt(L, b.y0);
        assert.equal(s.area, 'gully', `L${id} s${seed}: busy at ${b.y0} is in ${s.area}`);
        assert.equal(World.segmentAt(L, b.y1), s, 'a busy stretch stays in one segment');
        assert.ok(b.y0 >= T.BUSY_MIN_Y && b.y1 - b.y0 >= T.BUSY_LEN_MIN - 1 && b.y1 - b.y0 <= T.BUSY_LEN_MAX + 1);
        assert.ok(World.BUSY_KINDS.includes(b.kind));
      }
    }
    if (!L.segs.some((s) => s.area === 'gully')) for (const seed of SEEDS) assert.equal(Sim.create(id, seed).busy.length, 0);
  }
  assert.ok(total > 20, 'gully levels get busy stretches on most seeds');
});

test('busy stretches leave the rest of the layout unchanged (own RNG stream)', () => {
  const st = Sim.create(4, 1);
  assert.ok(st.busy.length > 0);
  const chance = T.BUSY_CHANCE;
  T.BUSY_CHANCE = 0;
  let quiet;
  try { quiet = Sim.create(4, 1); } finally { T.BUSY_CHANCE = chance; }
  assert.equal(quiet.busy.length, 0);
  const parked = (s) => s.npcs.filter((n) => n.parked).map((n) => [n.x, n.y]);
  const at = (a) => a.map((q) => [q.x, q.y]); // ids shift (the crowd takes ids), places do not
  assert.deepEqual(at(st.potholes), at(quiet.potholes));
  assert.deepEqual(at(st.puddles), at(quiet.puddles));
  assert.deepEqual(at(st.stalls), at(quiet.stalls));
  assert.deepEqual(parked(st), parked(quiet));
});

test('a busy stretch is more crowded than the rest of its gully', () => {
  let inside = 0, insideLen = 0, outside = 0, outsideLen = 0;
  for (const seed of SEEDS) {
    for (const id of [4, 6]) {
      const st = Sim.create(id, seed);
      const L = World.level(id);
      for (const s of L.segs) {
        if (s.area !== 'gully') continue;
        const len = s.y1 - s.y0;
        const busy = st.busy.filter((b) => b.y0 >= s.y0 && b.y1 <= s.y1);
        const bl = busy.reduce((a, b) => a + (b.y1 - b.y0), 0);
        const n = (y0, y1) => st.peds.filter((p) => p.y >= y0 && p.y < y1).length;
        const nb = busy.reduce((a, b) => a + n(b.y0, b.y1), 0);
        inside += nb; insideLen += bl;
        outside += n(s.y0, s.y1) - nb; outsideLen += len - bl;
      }
    }
  }
  const di = inside / insideLen;
  const doo = outside / outsideLen;
  assert.ok(di > doo * 2, `pedestrians per metre: busy ${di.toFixed(2)} vs elsewhere ${doo.toFixed(2)}`);
});

test('the busy stretch is announced once, ahead of it', () => {
  const st = Sim.create(4, 1);
  const b = st.busy[0];
  const mem = Bot.create();
  const seen = [];
  for (let t = 0; t < 30 * 120 && !Sim.result(st); t++) {
    for (const e of Sim.step(st, Bot.act(st, mem))) if (e.type === 'busyAhead') seen.push({ e, y: st.players[0].y });
  }
  const first = seen.filter((s) => s.e.y0 === b.y0);
  assert.equal(first.length, 1);
  assert.equal(first[0].e.kind, b.kind);
  assert.ok(first[0].y < b.y0 && first[0].y >= b.y0 - T.BUSY_WARN - 1, `announced at ${first[0].y.toFixed(1)} for ${b.y0}`);
});
