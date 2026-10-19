'use strict';
// Shared helpers for the test suite.
const Sim = require('../shared/sim.js');
const Bot = require('../shared/bot.js');
const World = require('../shared/world.js');
const H = require('../kit/sim-harness/harness.js');

/** Record a bot run (quantised inputs) for replay tests. */
function recordBot(levelId, seed, maxTicks) {
  const mem = Bot.create();
  return H.run(Sim, { levelId, seed, maxTicks, policy: (st) => Bot.act(st, mem) });
}

/** Run the bot to the end of a level; returns the result (or null on timeout). */
function botFinish(levelId, seed) {
  const st = Sim.create(levelId, seed);
  const mem = Bot.create();
  let t = 0;
  while (!Sim.result(st) && t < 30000) {
    Sim.step(st, Bot.act(st, mem));
    t++;
  }
  return { result: Sim.result(st), ticks: t, state: st };
}

/**
 * A level-1 state stripped of traffic, pedestrians and hazards near the start,
 * for rule tests. The player sits at (x, y) with speed v.
 */
function bareState(opts) {
  const o = Object.assign({ levelId: 1, seed: 1, x: 1.6, y: 30, v: 10 }, opts);
  const st = Sim.create(o.levelId, o.seed);
  st.npcs = [];
  st.peds = [];
  st.potholes = [];
  st.puddles = [];
  const p = st.players[0];
  p.x = o.x;
  p.y = o.y;
  p.v = o.v;
  p.surface = World.surfaceAt(World.segmentAt(World.level(o.levelId), p.y), p.x);
  return st;
}

/** Step with a constant input, collecting events. Clears spawned traffic each tick if `quiet`. */
function stepN(st, n, input, quiet) {
  const events = [];
  for (let i = 0; i < n && !Sim.result(st); i++) {
    if (quiet) { st.npcs = []; st.peds = []; }
    for (const e of Sim.step(st, input || { steer: 0, brake: 0, horn: 0 })) events.push(e);
  }
  return events;
}

module.exports = { Sim, Bot, World, H, recordBot, botFinish, bareState, stepN };
