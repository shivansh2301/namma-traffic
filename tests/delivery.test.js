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

test('apartment handovers take longer than houses', () => {
  const house = atDrop(4, 0);
  const apt = atDrop(4, 2);
  const tick = (st) => { const ev = stopAndWait(st, 30 * 10); const a = ev.findIndex((e) => e.type === 'handover'); return { ev, a }; };
  const timeOf = (st) => {
    let t = 0, h = -1, d = -1;
    while (t < 300 && d < 0) { st.npcs = []; st.peds = []; for (const e of Sim.step(st, BRAKE)) { if (e.type === 'handover') h = t; if (e.type === 'delivered') d = t; } t++; }
    return (d - h) / 30;
  };
  assert.ok(Math.abs(timeOf(house) - T.HANDOVER.house) < 0.1);
  assert.ok(Math.abs(timeOf(apt) - T.HANDOVER.apartment) < 0.1);
  void tick;
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
