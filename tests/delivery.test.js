'use strict';
// Delivery mode rules (docs/concepts/delivery-missions.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sim, World, stepN } = require('./helpers.js');
const { T } = World;

const IDLE = { steer: 0, brake: 0, horn: 0 };
const BRAKE = { steer: 0, brake: 1, horn: 0 };

/** A delivery state with no traffic, the player just before order `i`'s zone. */
function atDrop(levelId, i, opts) {
  const o = Object.assign({ x: 1.0, v: 3, before: 3 }, opts);
  const st = Sim.create(levelId, 1);
  st.npcs = []; st.peds = []; st.potholes = []; st.puddles = [];
  st.stalls = []; st.drains = []; st.manholes = []; st.dogs = [];
  for (let k = 0; k < i; k++) st.orders[k].status = 'delivered';
  const p = st.players[0];
  p.y = st.orders[i].y - o.before;
  p.x = o.x;
  p.v = o.v;
  p.surface = World.surfaceAt(World.segmentAt(World.level(levelId), p.y), p.x);
  return st;
}

function stopAndWait(st, ticks) {
  const ev = [];
  for (let t = 0; t < ticks && !Sim.result(st); t++) {
    st.npcs = []; st.peds = [];
    for (const e of Sim.step(st, BRAKE)) ev.push(e);
  }
  return ev;
}

test('stopping at the kerb inside the zone hands the order over', () => {
  const st = atDrop(4, 0);
  const ev = stopAndWait(st, 30 * 6);
  const h = ev.find((e) => e.type === 'handover');
  const d = ev.find((e) => e.type === 'delivered');
  assert.ok(h && h.kind === 'house');
  assert.ok(d, 'delivered');
  assert.equal(st.orders[0].status, 'delivered');
  assert.equal(d.rating, 5);
  assert.ok(d.tip >= T.TIP_5[0] && d.tip <= T.TIP_5[1]);
  assert.ok(st.players[0].money >= d.tip);
});

test('a handover plays its scene step by step and lasts exactly as long as its steps', () => {
  const seen = { apartment: new Set(), house: new Set() };
  for (const [i, kind] of [[0, 'house'], [2, 'apartment']]) {
    for (let seed = 1; seed <= 12; seed++) {
      const st = atDrop(4, i);
      st.rng = World.Rng.hash(seed, 'scene') | 0;
      let t = 0, h = null, d = -1, t0 = -1;
      const steps = [];
      while (t < 400 && d < 0) {
        st.npcs = []; st.peds = [];
        for (const e of Sim.step(st, BRAKE)) {
          if (e.type === 'handover') { h = e; t0 = t; }
          if (e.type === 'handStep') steps.push(e.step);
          if (e.type === 'delivered') d = t;
        }
        t++;
      }
      assert.ok(h && h.kind === kind, 'handover started');
      const sc = World.HANDOVER_SCENES[kind].find((q) => q.id === h.scene);
      assert.deepEqual(steps, sc.steps.map((q) => q[0]));
      const total = sc.steps.reduce((a, q) => a + q[1], 0);
      assert.ok(Math.abs((d - t0) / 30 - total) < 0.1, kind + ' ' + sc.id + ': ' + (d - t0) / 30 + ' vs ' + total);
      seen[kind].add(sc.id);
    }
  }
  assert.ok(seen.apartment.size >= 2 && seen.house.size >= 2, 'scenes vary');
  const mean = (kind) => { const l = World.HANDOVER_SCENES[kind]; const w = l.reduce((a, q) => a + q.w, 0); return l.reduce((a, q) => a + q.w * q.steps.reduce((b, z) => b + z[1], 0), 0) / w; };
  assert.ok(mean('apartment') > mean('house'), 'society approval takes longer than a doorbell');
});

test('good karma brings friendlier handover scenes than bad karma', () => {
  const count = (karma) => {
    let friendly = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const st = atDrop(4, 2);
      st.rng = World.Rng.hash(seed, 'mood') | 0;
      st.players[0].karma = karma;
      for (let t = 0; t < 60; t++) for (const e of Sim.step(st, BRAKE)) if (e.type === 'handover') { const sc = World.HANDOVER_SCENES.apartment.find((q) => q.id === e.scene); if (sc.mood > 0) friendly++; else if (sc.mood < 0) friendly--; }
    }
    return friendly;
  };
  assert.ok(count(95) > count(5) + 10);
});

test('honking during the handover: a gaali from security and one star less', () => {
  const st = atDrop(4, 2);
  const ev = [];
  for (let t = 0; t < 30 * 12 && !ev.some((e) => e.type === 'delivered'); t++) {
    st.npcs = []; st.peds = [];
    const handing = st.players[0].handT > 0;
    for (const e of Sim.step(st, { steer: 0, brake: 1, horn: handing && t % 20 === 0 ? 1 : 0 })) ev.push(e);
  }
  const g = ev.filter((e) => e.type === 'gaali');
  assert.equal(g.length, 1);
  assert.equal(g[0].who, 'guard');
  assert.equal(ev.find((e) => e.type === 'delivered').rating, 4);
});

test('stopping mid-road (not at the kerb) does not deliver', () => {
  const st = atDrop(5, 0, { x: 5.25 });
  const ev = stopAndWait(st, 30 * 3);
  assert.ok(!ev.some((e) => e.type === 'handover'));
});

test('riding past the zone misses the order and costs karma', () => {
  const st = atDrop(4, 0, { v: T.MAX_SPEED, before: 8 });
  const k0 = st.players[0].karma;
  const ev = stepN(st, 30 * 4, IDLE, true);
  assert.ok(ev.some((e) => e.type === 'missed'));
  assert.equal(st.orders[0].status, 'missed');
  assert.equal(st.players[0].karma, k0 - T.MISSED_KARMA);
});

test('late orders and a squashed bag lower the rating', () => {
  const late = atDrop(4, 0);
  late.time = late.orders[0].due + 150; // 2.5 min late
  const d1 = stopAndWait(late, 30 * 6).find((e) => e.type === 'delivered');
  assert.equal(d1.rating, 5 - 3);
  assert.equal(d1.tip, 0);
  const squashed = atDrop(4, 0);
  squashed.players[0].goods = 35;
  const d2 = stopAndWait(squashed, 30 * 6).find((e) => e.type === 'delivered');
  assert.equal(d2.rating, 3);
});

test('potholes squash the groceries', () => {
  const st = atDrop(4, 0, { v: 6, before: 40 });
  st.potholes.push({ id: 8001, x: 1.0, y: st.players[0].y + 1.2, r: 0.8, shape: 0, rot: 0, hidden: false });
  stepN(st, 3, IDLE, true);
  assert.ok(st.players[0].goods < 100);
});

test('the shift ends when every order is resolved, with a delivery result', () => {
  const st = atDrop(4, 2);
  stopAndWait(st, 30 * 8);
  const r = Sim.result(st);
  assert.equal(r.mode, 'delivery');
  assert.equal(r.outcome, 'completed');
  assert.equal(r.total, 3);
  assert.equal(r.delivered, 3); // the first two were marked delivered by the setup
  assert.equal(r.orders[2].rating, 5);
  assert.equal(r.orders.length, 3);
  assert.ok(r.score > 0 && r.stars >= 1);
});

test('delivery scoring and stars', () => {
  const o = (rating, late) => ({ status: 'delivered', rating, late, tip: 0 });
  const base = { mode: 'delivery', outcome: 'completed', karma: 80, condition: 60, money: 50, total: 3, delivered: 3, onTime: 3, avgRating: 5, orders: [o(5, 0), o(5, 0), o(5, 0)] };
  const s = Sim.score(base);
  assert.equal(s.deliveryPts, 3 * (200 + 300 + 100));
  assert.equal(s.score, s.deliveryPts + 400 + 180 + 50);
  assert.equal(s.stars, 3);
  assert.equal(Sim.score(Object.assign({}, base, { onTime: 2, avgRating: 4 })).stars, 2);
  assert.equal(Sim.score(Object.assign({}, base, { delivered: 2 })).stars, 1);
  assert.equal(Sim.score(Object.assign({}, base, { outcome: 'breakdown' })).score, 0);
});

test('commute levels are unaffected: no orders, arrive at the tech park', () => {
  const st = Sim.create(2, 1);
  assert.equal(st.orders.length, 0);
  assert.equal(World.level(2).destination.kind, 'techpark');
});
