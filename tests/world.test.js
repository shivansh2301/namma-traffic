'use strict';
// Level data validation. Run after editing LEVELS in shared/world.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('./helpers.js');
const { T } = World;

for (const def of World.LEVELS) {
  test(`level ${def.id} (${def.name}) is well formed`, () => {
    const L = World.level(def.id);
    assert.ok(L.length > 0);
    assert.ok(L.startTime < L.deadline, 'starts before the deadline');
    assert.ok(['clear', 'rain'].includes(L.weather));
    let y = 0;
    for (const s of L.segs) {
      assert.equal(s.y0, y);
      y = s.y1;
      assert.ok(['undivided', 'divided'].includes(s.road));
      assert.ok(s.lanesOwn >= 1 && s.lanesOwn <= 3, 'lanesOwn 1..3');
      if (s.road === 'undivided') assert.ok(s.lanesOncoming >= 0 && s.lanesOncoming <= 2, 'lanesOncoming 0..2');
      for (const k of ['traffic', 'oncoming', 'wrongSide', 'potholes', 'puddles', 'peds', 'cows']) {
        assert.ok(s[k] >= 0 && s[k] <= 1, `${k} in 0..1 (segment ${s.i})`);
      }
      const mix = s.mix;
      assert.ok(Object.values(mix).some((w) => w > 0), 'mix has weight');
      for (const k of Object.keys(mix)) assert.ok(World.VEHICLES[k], 'known vehicle ' + k);
      for (const f of s.features) {
        assert.ok(['speedBreaker', 'busStop', 'barricade'].includes(f.kind));
        assert.ok(f.at >= 0 && f.at + (f.len || 0) <= s.len, `feature inside its segment (segment ${s.i})`);
        if (f.kind === 'barricade') {
          assert.ok(f.lanes.length < s.lanesOwn, 'a barricade leaves at least one lane open');
          for (const lane of f.lanes) assert.ok(lane >= 0 && lane < s.lanesOwn);
        }
      }
    }
    for (const h of L.hints) assert.ok(h.at >= 0 && h.at <= L.length && h.text.length > 0);
    let prevEnd = -1;
    for (const c of L.curves) {
      assert.ok(c.y0 >= 0 && c.y1 <= L.length, 'curve inside the level');
      assert.ok(c.y0 >= prevEnd, 'curves do not overlap');
      assert.ok(Math.abs(c.k) <= 0.06, 'curvature at most 1/16 m');
      prevEnd = c.y1;
    }
    for (const m of L.landmarks) assert.ok(m.at >= 0 && m.at <= L.length);
    assert.ok(['commute', 'delivery'].includes(L.mode));
    if (L.mode === 'delivery') {
      assert.ok(L.drops.length >= 1, 'a shift has orders');
      let prev = null;
      for (const d of L.drops) {
        assert.ok(['apartment', 'house'].includes(d.kind));
        assert.ok(d.y >= 30 && d.y <= L.length, 'drop inside the route');
        assert.ok(d.due > L.startTime, 'due after the shift starts');
        if (prev) {
          assert.ok(d.y - prev.y >= T.DROP_ZONE * 2, 'drops are well apart');
          assert.ok(d.due >= prev.due, 'due times in route order');
        }
        prev = d;
        assert.ok(!World.barricadeAt(L, 1.0, d.y, T.DROP_ZONE / 2), 'the kerb lane at a drop is not barricaded');
      }
    } else {
      assert.ok(L.destination, 'a commute ends somewhere');
      assert.equal(L.drops.length, 0);
    }
  });

  test(`level ${def.id}: oncoming lanes never jump sideways by more than a median`, () => {
    // Otherwise oncoming traffic swerves across the shoulder at the boundary.
    // Exception: a junction (traffic in lanes that end turns off) at a sharp turn.
    const L = World.level(def.id);
    for (let i = 1; i < L.segs.length; i++) {
      const a = L.segs[i - 1].xs;
      const b = L.segs[i].xs;
      if (L.segs[i].junction) {
        const y0 = L.segs[i].y0;
        assert.ok(L.curves.some((c) => Math.abs(c.k) >= 0.03 && c.y0 <= y0 + 30 && c.y1 >= y0 - 30), `junction at ${y0} needs a sharp turn`);
        continue;
      }
      if (a.oncLanes > 0 && b.oncLanes > 0) {
        assert.ok(Math.abs(a.oncL - b.oncL) <= T.MEDIAN_W + 1e-9, `segments ${i - 1}->${i}: oncL ${a.oncL} -> ${b.oncL}`);
      }
    }
  });
}

test('modes: levels unlock within their own mode', () => {
  assert.deepEqual(World.levelsOf('commute'), [1, 2, 3]);
  assert.deepEqual(World.levelsOf('delivery'), [4, 5, 6]);
  assert.equal(World.prevInMode(1), null);
  assert.equal(World.prevInMode(4), null);
  assert.equal(World.prevInMode(5), 4);
  assert.equal(World.prevInMode(3), 2);
});

test('geometry helpers', () => {
  const L = World.level(2);
  assert.equal(World.segmentAt(L, -5), L.segs[0]);
  assert.equal(World.segmentAt(L, L.length + 5), L.segs[L.segs.length - 1]);
  for (const s of L.segs) assert.equal(World.segmentAt(L, (s.y0 + s.y1) / 2), s);
  const s = L.segs[0];
  assert.equal(World.surfaceAt(s, -1), s.footpathL ? 'footpath' : 'shoulder');
  assert.equal(World.surfaceAt(s, 2), 'road');
  assert.equal(World.parseClock('09:35'), 9 * 3600 + 35 * 60);
  assert.equal(World.fmtClock(9 * 3600 + 47 * 60 + 30), '09:47');
  for (let t = 0; t < 20; t += 0.7) {
    const v = World.jamCap(100, t);
    assert.ok(v >= T.JAM_SPEED_MIN && v <= T.JAM_SPEED_MAX);
  }
});
