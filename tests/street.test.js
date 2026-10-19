'use strict';
// Street life: stalls, dogs, drains, manholes, gaali and the heated debate,
// people stepping round a stopped scooter (docs/concepts/street-life.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sim, World, bareState, stepN } = require('./helpers.js');
const { T } = World;

const NONE = { steer: 0, brake: 0, horn: 0 };

test('street items are deterministic, off the carriageway lanes for stalls and drains, and out of drop zones', () => {
  for (const id of World.levelIds) {
    const L = World.level(id);
    for (let seed = 1; seed <= 10; seed++) {
      const a = Sim.create(id, seed);
      const b = Sim.create(id, seed);
      for (const k of ['stalls', 'drains', 'manholes', 'dogs']) assert.deepEqual(a[k], b[k]);
      for (const k of a.stalls) {
        const s = World.segmentAt(L, k.y);
        assert.ok(k.x < 0 || k.x > s.xs.roadR, `L${id} s${seed}: stall at x ${k.x.toFixed(2)} is in the road`);
        assert.ok(World.STALL_KINDS.includes(k.kind));
      }
      for (const d of a.drains) assert.ok(World.segmentAt(L, d.y).footpathL || World.segmentAt(L, d.y).footpathR, 'drains sit on footpaths');
      for (const o of L.drops || []) {
        for (const k of a.stalls) if (k.x < 0) assert.ok(Math.abs(k.y - o.y) > T.DROP_ZONE / 2, `L${id} s${seed}: stall in drop zone`);
      }
    }
  }
});

test('time of day is seed-deterministic and leaves the layout unchanged', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const a = Sim.create(4, seed);
    assert.equal(a.tod, Sim.create(4, seed).tod);
    seen.add(a.tod);
  }
  assert.deepEqual([...seen].sort(), ['day', 'evening', 'night']);
  const n = T.TOD_NIGHT;
  T.TOD_NIGHT = 1;
  let night;
  try { night = Sim.create(4, 1); } finally { T.TOD_NIGHT = n; }
  const day = Sim.create(4, 1);
  assert.equal(night.tod, 'night');
  assert.deepEqual(night.potholes, day.potholes);
  assert.deepEqual(night.stalls, day.stalls);
});

test('an open drain at speed is a crash; crawling across is just a lurch', () => {
  const fast = bareState({ x: 1.6, y: 30, v: 9 });
  fast.drains = [{ id: 900, x: 1.6, y: 34, w: T.DRAIN_W, l: T.DRAIN_L }];
  const ev = stepN(fast, 30, NONE, true);
  assert.ok(ev.some((e) => e.type === 'crash' && e.with === 'drain'));
  const slow = bareState({ x: 1.6, y: 30, v: 1 });
  slow.drains = [{ id: 900, x: 1.6, y: 31.5, w: T.DRAIN_W, l: T.DRAIN_L }];
  const ev2 = stepN(slow, 60, { steer: 0, brake: 0.6, horn: 0 }, true);
  assert.ok(!ev2.some((e) => e.type === 'crash'), 'no crash at walking pace');
});

test('nosing slowly into a stall walks the scooter round it instead of pinning it', () => {
  const st = bareState({ x: -1.0, y: 30, v: 1 });
  st.stalls = [{ id: 901, kind: 'chai', x: -1.0, y: 30 + T.PLAYER_L / 2 + T.STALL_L / 2 + 0.02, w: T.STALL_W, l: T.STALL_L, side: 'L' }];
  const x0 = st.players[0].x;
  const ev = stepN(st, 90, NONE, true);
  assert.ok(!ev.some((e) => e.type === 'crash'));
  assert.ok(st.players[0].x > x0 + 0.3, 'slid toward the road');
});

test('a stopped scooter is not "crashed into": people step round it', () => {
  const ref = Sim.create(1, 1).peds[0];
  const st = bareState({ x: 1.6, y: 30, v: 0 });
  st.peds = [Object.assign({}, ref, { x: 1.6, y: 31.0, mode: 'cross', vx: 0, vy: -1, dir: -1 })];
  const ev = stepN(st, 60, { steer: 0, brake: 1, horn: 0 });
  assert.ok(!ev.some((e) => e.type === 'crash'));
});

test('honk at the same person again and again: a gaali, then a heated debate; BRAKE moves on for free', () => {
  const ref = Sim.create(1, 1).peds[0];
  const setup = () => {
    const st = bareState({ x: 1.6, y: 30, v: 0 });
    st.peds = [Object.assign({}, ref, { x: 1.6, y: 36, mode: 'wait', t: 99, vx: 0, vy: 0, dodge: 0 })];
    return st;
  };
  const honk = (st) => {
    const ev = [];
    for (let i = 0; i < T.GAALI_HONKS; i++) {
      ev.push(...stepN(st, 1, { steer: 0, brake: 1, horn: 1 }));
      ev.push(...stepN(st, Math.ceil(T.HORN_COOLDOWN * 30) + 2, { steer: 0, brake: 1, horn: 0 }));
      if (ev.some((e) => e.type === 'gaali')) break;
    }
    return ev;
  };
  const st = setup();
  const p = st.players[0];
  const ev = honk(st);
  assert.ok(ev.some((e) => e.type === 'gaali' && e.who === 'ped'), 'got a gaali');
  assert.ok(ev.some((e) => e.type === 'fight' && e.phase === 'start' && e.debate), 'a debate starts');
  const k = p.karma;
  const ev2 = stepN(st, 30, { steer: 0, brake: 1, horn: 0 });
  assert.ok(ev2.some((e) => e.type === 'fight' && e.phase === 'moveOn'), 'brake: be responsible, move on');
  assert.equal(p.karma, k, 'moving on costs no karma');
  // Argue back instead: costly.
  const st2 = setup();
  st2.players[0].hornCd = 0;
  honk(st2);
  const k2 = st2.players[0].karma;
  stepN(st2, 2, { steer: 0, brake: 0, horn: 1 });
  assert.ok(st2.players[0].karma < k2, 'arguing costs karma');
});

test('every level gets tankers and cars in its traffic mix', () => {
  for (const def of World.LEVELS) {
    const L = World.level(def.id);
    for (const s of L.segs) {
      assert.ok(s.mix.tanker > 0, `L${def.id}: no tankers in a ${s.area} segment`);
      assert.ok(s.mix.car > 0, `L${def.id}: no cars in a ${s.area} segment`);
    }
  }
});
