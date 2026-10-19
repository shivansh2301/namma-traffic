'use strict';
// Focused checks of the gameplay rules in SPEC §5–§9, on hand-built states.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sim, World, bareState, stepN } = require('./helpers.js');
const { T } = World;

const IDLE = { steer: 0, brake: 0, horn: 0 };

test('auto-throttle accelerates to MAX_SPEED; braking decelerates', () => {
  const st = bareState({ v: 0, y: 30 });
  stepN(st, 30 * 6, IDLE, true);
  assert.ok(Math.abs(st.players[0].v - T.MAX_SPEED) < 1e-9);
  const v0 = st.players[0].v;
  stepN(st, 15, { steer: 0, brake: 1, horn: 0 }, true);
  assert.ok(Math.abs(st.players[0].v - (v0 - T.BRAKE_DECEL * 0.5)) < 0.05);
});

test('lateral speed follows steer x min(4, 1.2 + 0.25 v)', () => {
  const st = bareState({ v: 8, x: 1.0, y: 60 });
  const x0 = st.players[0].x;
  stepN(st, 1, { steer: 1, brake: 1, horn: 0 }, true);
  const v = st.players[0].v; // after this tick's braking
  const expect = Math.min(T.LAT_MAX, T.LAT_BASE + T.LAT_PER_SPEED * v) * World.DT;
  assert.ok(Math.abs(st.players[0].x - x0 - expect) < 1e-9);
});

test('pothole: speed x0.55, condition -(2 + 0.6v), wobble, event', () => {
  const st = bareState({ v: 10, x: 1.6, y: 40 });
  st.potholes.push({ id: 9001, x: 1.6, y: 41.5, r: 0.8, shape: 0, rot: 0, hidden: false });
  const ev = stepN(st, 3, IDLE, true);
  const hit = ev.find((e) => e.type === 'pothole');
  assert.ok(hit, 'pothole event');
  const p = st.players[0];
  assert.ok(Math.abs(p.condition - (100 - (2 + 0.6 * hit.speed))) < 1e-9);
  assert.ok(p.wobble > 0);
  assert.equal(p.stats.potholesHit, 1);
  assert.ok(p.v < hit.speed * 0.56 + 0.2);
});

test('pothole at walking pace does no damage', () => {
  const st = bareState({ v: 2, x: 1.6, y: 40 });
  st.potholes.push({ id: 9002, x: 1.6, y: 40.5, r: 0.8, shape: 0, rot: 0, hidden: true });
  stepN(st, 2, { steer: 0, brake: 1, horn: 0 }, true);
  assert.equal(st.players[0].condition, 100);
  assert.equal(st.potholes[0].hidden, false, 'touching reveals a hidden pothole');
});

test('puddle: speed x0.85 on entry and a splash event; splashing a pedestrian costs 10 karma', () => {
  const st = bareState({ v: 10, x: 1.6, y: 40 });
  st.puddles.push({ id: 9100, x: 1.6, y: 40.4, rx: 1.2, ry: 1.2, leak: 0 });
  st.peds.push({ id: 9101, side: 0, u: 0.5, x: 0.6, y: 41, dir: 1, v: 0, variant: 0, mode: 'wait', t: 0, vx: 0, vy: 0, cdir: 0, cx: 0, cmedian: false, dodge: 0, dodgeV: 0, splash: 0 });
  const before = st.players[0].v;
  const ev = Sim.step(st, IDLE);
  assert.ok(ev.some((e) => e.type === 'splash' && e.player));
  const sp = ev.find((e) => e.type === 'pedSplashed');
  assert.ok(sp && sp.byPlayer);
  const p = st.players[0];
  assert.equal(p.karma, T.KARMA_START - T.SPLASH_KARMA);
  assert.equal(p.stats.splashedPeds, 1);
  assert.ok(p.v < before);
});

test('horn: 3 honks per 10 s are free, the 4th costs 1 karma; cooldown 0.3 s', () => {
  const st = bareState({ v: 5, y: 40 });
  const ev = stepN(st, 30, { steer: 0, brake: 0, horn: 1 }, true); // 1 s held
  const honks = ev.filter((e) => e.type === 'horn').length;
  assert.equal(honks, 4); // t = 0, 0.3, 0.6, 0.9 s (cooldown)
  assert.equal(st.players[0].karma, T.KARMA_START - T.HORN_KARMA);
});

test('footpath riding drains 3 karma per second; kerb hop at speed costs 2 condition', () => {
  const st = bareState({ v: 8, x: 0.5, y: 40 }); // level 1 starts with a left footpath
  stepN(st, 12, { steer: -1, brake: 0, horn: 0 }, true);
  const p = st.players[0];
  assert.equal(p.surface, 'footpath');
  assert.equal(p.condition, 100 - T.KERB_CONDITION);
  const k0 = p.karma;
  stepN(st, 30, IDLE, true);
  assert.ok(Math.abs(k0 - p.karma - T.FOOTPATH_KARMA_PER_S) < 0.05);
  assert.ok(p.stats.footpathSeconds > 1);
});

test('crash with a vehicle: -20 condition, stop, respawn, then 2 s invulnerability', () => {
  const st = bareState({ v: 10, x: 1.6, y: 40 });
  st.npcs.push({ id: 9200, kind: 'car', variant: 0, x: 1.75, y: 44, tx: 1.75, off: 0, vx: 0, dir: 1, ws: false, w: 1.8, l: 4.3, v: 0, vDes: 0, lane: 0, mergeX: -999, blocked: 0, byPlayer: 0, lcCool: 0, plan: 0, stop: 5, stopHard: false, hold: 0, holdOff: 0, cab: false, busDone: -1, leak: 0, pud: 0, warned: false, honk: 0 });
  let ev = [];
  for (let i = 0; i < 20 && !ev.some((e) => e.type === 'crash'); i++) ev = Sim.step(st, IDLE);
  const c = ev.find((e) => e.type === 'crash');
  assert.ok(c);
  assert.equal(c.with, 'vehicle');
  const p = st.players[0];
  assert.equal(p.condition, 100 - T.CRASH_COST.vehicle);
  assert.equal(p.v, 0);
  ev = [];
  for (let i = 0; i < 60; i++) ev = ev.concat(Sim.step(st, { steer: 0, brake: 1, horn: 0 }));
  assert.ok(ev.some((e) => e.type === 'respawn'));
  assert.ok(p.invuln > 0);
});

test('crawling into a vehicle is a scrape, not a crash', () => {
  const st = bareState({ v: 0.8, x: 1.75, y: 40 });
  st.npcs.push({ id: 9300, kind: 'car', variant: 0, x: 1.75, y: 43.15, tx: 1.75, off: 0, vx: 0, dir: 1, ws: false, w: 1.8, l: 4.3, v: 0, vDes: 0, lane: 0, mergeX: -999, blocked: 0, byPlayer: 0, lcCool: 0, plan: 0, stop: 5, stopHard: false, hold: 0, holdOff: 0, cab: false, busDone: -1, leak: 0, pud: 0, warned: false, honk: 0 });
  let crashed = false;
  for (let i = 0; i < 20; i++) {
    for (const e of Sim.step(st, { steer: 0, brake: 1, horn: 0 })) if (e.type === 'crash') crashed = true;
    st.players[0].v = 0.8; // keep nudging
  }
  assert.equal(crashed, false);
  assert.equal(st.players[0].condition, 100);
});

test('speed breaker: fast crossing costs 1 + 0.5v; slow crossing is free', () => {
  const L = World.level(1);
  const b = L.breakers[0];
  const fast = bareState({ v: 10, x: 1.6, y: b.y - 0.2 });
  const ev = stepN(fast, 2, IDLE, true);
  const bump = ev.find((e) => e.type === 'bump' && e.kind === 'breaker');
  assert.ok(bump && bump.hard);
  assert.ok(Math.abs(fast.players[0].condition - (100 - (1 + 0.5 * bump.speed))) < 1e-9);
  const slow = bareState({ v: 3, x: 1.6, y: b.y - 0.05 });
  stepN(slow, 2, { steer: 0, brake: 1, horn: 0 }, true);
  assert.equal(slow.players[0].condition, 100);
});

test('clock runs 12 game seconds per real second', () => {
  const st = bareState({});
  const t0 = st.time;
  stepN(st, 30, IDLE, true);
  assert.ok(Math.abs(st.time - t0 - T.CLOCK_RATE) < 1e-9);
});

test('arriving ends the run with a scored result', () => {
  const L = World.level(1);
  const st = bareState({ v: 12, x: 1.6, y: L.length - 0.2 });
  const ev = stepN(st, 3, IDLE, true);
  assert.ok(ev.some((e) => e.type === 'arrive'));
  const r = Sim.result(st);
  assert.equal(r.outcome, 'arrived');
  assert.ok(r.score > 0 && r.stars >= 1);
  assert.deepEqual(Object.keys(r.stats).sort(), ['crashes', 'fights', 'footpathSeconds', 'goodDeeds', 'honks', 'potholesHit', 'splashedPeds']);
  assert.ok(r.xp > 0 && [0.5, 1, 1.5].includes(r.xpMult));
  assert.deepEqual(Sim.step(st, IDLE), [], 'no events after the run ends');
});

test('condition 0 is a breakdown with score 0', () => {
  const st = bareState({ v: 10, x: 1.6, y: 40 });
  st.players[0].condition = 1;
  st.potholes.push({ id: 9400, x: 1.6, y: 41.2, r: 0.8, shape: 0, rot: 0, hidden: false });
  const ev = stepN(st, 3, IDLE, true);
  assert.ok(ev.some((e) => e.type === 'breakdown'));
  const r = Sim.result(st);
  assert.equal(r.outcome, 'breakdown');
  assert.equal(r.score, 0);
  assert.equal(r.stars, 0);
});

test('scoring formula and stars (SPEC §9.3)', () => {
  const base = { outcome: 'arrived', karma: 80, condition: 60, stats: {} };
  let s = Sim.score(Object.assign({}, base, { minutesEarly: 3 }));
  assert.equal(s.punctuality, 1060);
  assert.equal(s.score, 1060 + 400 + 180);
  assert.equal(s.stars, 3);
  s = Sim.score(Object.assign({}, base, { minutesEarly: -2, karma: 50 }));
  assert.equal(s.punctuality, 800);
  assert.equal(s.stars, 2);
  s = Sim.score(Object.assign({}, base, { minutesEarly: -8 }));
  assert.equal(s.punctuality, 200);
  assert.equal(s.stars, 1);
  s = Sim.score(Object.assign({}, base, { minutesEarly: -20 }));
  assert.equal(s.punctuality, 0);
  assert.equal(Sim.score({ outcome: 'breakdown' }).score, 0);
});

test('rain: weaker brakes, hidden potholes exist, more puddles', () => {
  const dry = Sim.create(1, 3);
  const wet = Sim.create(3, 3);
  assert.equal(wet.weather, 'rain');
  assert.ok(wet.potholes.some((h) => h.hidden));
  assert.ok(!dry.potholes.some((h) => h.hidden));
  const st = bareState({ levelId: 3, v: 10, x: 1.6, y: 40 });
  stepN(st, 15, { steer: 0, brake: 1, horn: 0 }, true);
  assert.ok(Math.abs(st.players[0].v - (10 - T.BRAKE_DECEL * T.RAIN_BRAKE_MULT * 0.5)) < 0.05);
});

test('wrong-side riders are telegraphed before they reach the view', () => {
  let warned = 0;
  let seen = 0;
  const st = Sim.create(2, 7);
  for (let i = 0; i < 30 * 60; i++) {
    for (const e of Sim.step(st, { steer: 0, brake: 0, horn: 0 })) if (e.type === 'wrongSide') warned++;
    if (Sim.result(st)) break;
  }
  for (const n of st.npcs) if (n.ws) seen++;
  assert.ok(warned > 0 || seen === 0, 'riders appeared without a telegraph');
});
