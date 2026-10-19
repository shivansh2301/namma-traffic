'use strict';
// Karma economy, fights, luck, skill, bends and NPC life (docs/concepts/karma-and-luck.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Sim, World, bareState, stepN, botFinish } = require('./helpers.js');
const { T } = World;

const IDLE = { steer: 0, brake: 0, horn: 0 };
const BRAKE = { steer: 0, brake: 1, horn: 0 };
const HORN = { steer: 0, brake: 0, horn: 1 };

function npc(kind, x, y, extra) {
  const V = World.VEHICLES[kind];
  return Object.assign({
    id: 9000 + Math.floor(Math.random() * 999), kind, variant: 0, x, y, tx: x, off: 0, vx: 0, dir: 1, ws: false, w: V.w, l: V.l, v: 0, vDes: 0,
    lane: 0, mergeX: -999, blocked: 0, byPlayer: 0, lcCool: 0, plan: 0, stop: 30, stopHard: false, hold: 0, holdOff: 0,
    cab: false, busDone: -1, leak: 0, pud: 0, warned: false, honk: 0, thanked: 0, pickup: 0, fare: 1, argueT: 0, boardT: 0,
  }, extra);
}

function clash(input) {
  const st = bareState({ v: 8, x: 1.75, y: 40 });
  st.npcs.push(npc('auto', 1.75, 43));
  const ev = [];
  for (let i = 0; i < 30 * 8 && !ev.some((e) => e.type === 'fight' && e.phase !== 'start'); i++) {
    st.peds = [];
    for (const e of Sim.step(st, ev.some((x) => x.type === 'fight') ? input : IDLE)) ev.push(e);
  }
  return { st, ev, p: st.players[0] };
}

test('a clash with an auto starts an argument and stops you', () => {
  const { ev, p } = clash(BRAKE);
  const start = ev.find((e) => e.type === 'fight' && e.phase === 'start');
  assert.ok(start && start.with === 'auto');
  assert.equal(p.fights, 1);
});

test('apologising (hold brake) costs a little karma', () => {
  const { ev, p } = clash(BRAKE);
  const end = ev.find((e) => e.type === 'fight' && e.phase === 'sorry');
  assert.ok(end, 'apologised');
  assert.equal(p.karma, T.KARMA_START - T.APOLOGY_KARMA);
});

test('arguing back (horn) costs a lot of karma', () => {
  const { ev, p } = clash(HORN);
  assert.ok(ev.some((e) => e.type === 'fight' && e.phase === 'argue'));
  assert.ok(p.karma <= T.KARMA_START - T.FIGHT_KARMA.auto);
});

test('saying nothing gets you shouted at: half the karma', () => {
  const { ev, p } = clash(IDLE);
  assert.ok(ev.some((e) => e.type === 'fight' && e.phase === 'shouted'));
  assert.equal(p.karma, T.KARMA_START - T.FIGHT_KARMA.auto / 2);
});

test('giving way to a crossing pedestrian earns karma once', () => {
  const st = bareState({ v: 0, x: 1.6, y: 40 });
  st.npcs = [];
  st.peds.push({ id: 7001, side: 0, u: 0.5, x: 0.8, y: 46, dir: 1, v: 1.2, variant: 0, mode: 'cross', t: 0, vx: 1.2, vy: 0, cdir: 1, cx: 7.5, cmedian: false, dodge: 0, dodgeV: 0, splash: 0, thanked: 0, chatted: 0, chatWith: 0 });
  const ev = [];
  for (let i = 0; i < 60; i++) { st.npcs = []; for (const e of Sim.step(st, BRAKE)) ev.push(e); }
  const deeds = ev.filter((e) => e.type === 'goodDeed' && e.kind === 'giveWay');
  assert.equal(deeds.length, 1);
  assert.ok(st.players[0].karma >= T.KARMA_START + T.GIVE_WAY_KARMA);
});

test('high karma brings good luck, low karma bad luck', () => {
  const count = (karma) => {
    const st = bareState({ v: 6, y: 40 });
    st.players[0].karma = karma;
    const tally = { good: 0, bad: 0 };
    for (let i = 0; i < 30 * 120; i++) {
      st.npcs = []; st.peds = [];
      st.players[0].y = 40; st.players[0].karma = karma; st.players[0].haltT = 0;
      for (const e of Sim.step(st, IDLE)) if (e.type === 'luck') tally[e.good ? 'good' : 'bad']++;
    }
    return tally;
  };
  const hi = count(100);
  const lo = count(0);
  assert.ok(hi.good >= 3 && hi.bad === 0, JSON.stringify(hi));
  assert.ok(lo.bad >= 3 && lo.good === 0, JSON.stringify(lo));
});

test('luck effects: sugar rush raises top speed, puncture lowers it', () => {
  const fast = bareState({ v: T.MAX_SPEED, y: 40 });
  fast.players[0].sugarT = 5;
  stepN(fast, 60, IDLE, true);
  assert.ok(fast.players[0].v > T.MAX_SPEED * 1.1);
  const slow = bareState({ v: T.MAX_SPEED, y: 40 });
  slow.players[0].punctureT = 5;
  stepN(slow, 60, IDLE, true);
  assert.ok(slow.players[0].v <= T.MAX_SPEED * T.PUNCTURE_SPEED + 1e-9);
});

test('skill improves steering and braking', () => {
  const lat = (skill) => {
    const st = Sim.create(1, 1, { skill });
    st.npcs = []; st.peds = []; st.potholes = []; st.puddles = [];
    const p = st.players[0];
    p.y = 60; p.v = 6; p.x = 1.0;
    Sim.step(st, { steer: 1, brake: 1, horn: 0 });
    return { dx: p.x - 1.0, v: p.v };
  };
  const a = lat(0);
  const b = lat(10);
  assert.ok(b.dx > a.dx * 1.2, 'steers faster');
  assert.ok(b.v < a.v, 'brakes harder');
  assert.equal(World.skillLevel(0), 0);
  assert.equal(World.skillLevel(World.xpForLevel(3)), 3);
  assert.equal(World.skillLevel(1e9), T.SKILL_MAX);
});

test('bends push you outward unless you steer', () => {
  const L = World.level(1);
  const c = L.curves.find((q) => Math.abs(q.k) > 0.02);
  const st = bareState({ v: T.MAX_SPEED, x: 1.75, y: c.y0 + 1 });
  const x0 = st.players[0].x;
  stepN(st, 20, IDLE, true);
  const moved = st.players[0].x - x0;
  assert.ok(Math.sign(moved) === -Math.sign(c.k) && Math.abs(moved) > 0.2, 'drifted ' + moved);
});

test('bad karma slows learning: XP multiplier follows final karma', () => {
  const L = World.level(1);
  const run = (karma) => {
    const st = bareState({ v: 8, x: 1.6, y: L.length - 0.2 });
    st.players[0].karma = karma;
    stepN(st, 3, IDLE, true);
    return Sim.result(st);
  };
  const good = run(90);
  const bad = run(10);
  assert.equal(good.xpMult, 1.5);
  assert.equal(bad.xpMult, 0.5);
  assert.ok(good.xp > bad.xp * 2);
});

test('the bot apologises in fights and still finishes', () => {
  const { result } = botFinish(1, 2);
  assert.equal(result.outcome, 'arrived');
});

test('NPC life: people hail autos, board buses, chat; drivers argue', () => {
  const counts = {};
  for (const levelId of [1, 2, 3]) {
    for (const seed of [1, 2]) {
      const st = Sim.create(levelId, seed);
      const mem = require('../shared/bot.js').create();
      for (let i = 0; i < 30 * 150 && !Sim.result(st); i++) {
        for (const e of Sim.step(st, require('../shared/bot.js').act(st, mem))) counts[e.type] = (counts[e.type] || 0) + 1;
      }
    }
  }
  for (const k of ['hail', 'pickup', 'chat', 'npcArgue']) assert.ok(counts[k] > 0, k + ' never happened: ' + JSON.stringify(counts));
});
