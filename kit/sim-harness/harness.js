/*
 * Kit.SimHarness: Node-side tools for any deterministic simulation that has
 * the shape  Sim.create(levelId, seed) -> state,  Sim.step(state, input) -> events,
 * Sim.result(state) -> null | result.
 *
 *   const H = require('../kit/sim-harness/harness.js');
 *   const run = H.run(Sim, { levelId: 1, seed: 7, policy: (state) => input, maxTicks: 9000 });
 *   H.hashState(run.state);                       // sha256 of JSON.stringify(state)
 *   H.checkDeterminism(Sim, { levelId, seed, inputs });
 *   H.checkSerialisation(Sim, { levelId, seed, inputs, splitAt });
 *   H.timeSteps(Sim, { levelId, seed, inputs, ticks });
 *   const s = H.encodeInputs(inputs); H.decodeInputs(s);   // compact replays / ghosts
 *
 * Inputs are { steer: -1..1, brake: 0|1, horn: 0|1 }. Recorded inputs are
 * quantised (steer to 1/127) so a replay feeds the sim exactly what it saw.
 * CommonJS only (uses node:crypto).
 */
'use strict';
const crypto = require('node:crypto');

function hashState(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function quantise(inp) {
  const steer = Math.max(-127, Math.min(127, Math.round((+inp.steer || 0) * 127))) / 127;
  return { steer, brake: inp.brake ? 1 : 0, horn: inp.horn ? 1 : 0 };
}

/**
 * Run until the sim reports a result or maxTicks.
 * opts: { levelId, seed, policy(state, tick) -> input | inputs[] (array replays), maxTicks, onEvents(events, state) }
 */
function run(Sim, opts) {
  const state = opts.state || Sim.create(opts.levelId, opts.seed);
  const maxTicks = opts.maxTicks || 20000;
  const recorded = [];
  const eventCounts = {};
  let t = 0;
  while (t < maxTicks && !Sim.result(state)) {
    let inp;
    if (Array.isArray(opts.inputs)) {
      if (t >= opts.inputs.length) break;
      inp = opts.inputs[t];
    } else {
      inp = quantise(opts.policy ? opts.policy(state, t) : {});
    }
    recorded.push(inp);
    const ev = Sim.step(state, inp);
    for (let i = 0; i < ev.length; i++) eventCounts[ev[i].type] = (eventCounts[ev[i].type] || 0) + 1;
    if (opts.onEvents) opts.onEvents(ev, state);
    t++;
  }
  return { state, ticks: t, inputs: recorded, eventCounts, result: Sim.result(state) };
}

/** Two fresh runs with the same inputs must end in identical states. */
function checkDeterminism(Sim, opts) {
  const a = run(Sim, { levelId: opts.levelId, seed: opts.seed, inputs: opts.inputs });
  const b = run(Sim, { levelId: opts.levelId, seed: opts.seed, inputs: opts.inputs });
  const ha = hashState(a.state);
  const hb = hashState(b.state);
  return { ok: ha === hb, hashA: ha, hashB: hb, ticks: a.ticks };
}

/** Clone via JSON at splitAt; both copies must continue identically. */
function checkSerialisation(Sim, opts) {
  const inputs = opts.inputs;
  const split = opts.splitAt != null ? opts.splitAt : Math.floor(inputs.length / 2);
  const a = run(Sim, { levelId: opts.levelId, seed: opts.seed, inputs: inputs.slice(0, split) });
  const clone = JSON.parse(JSON.stringify(a.state));
  const rest = inputs.slice(split);
  run(Sim, { state: a.state, inputs: rest });
  run(Sim, { state: clone, inputs: rest });
  const ha = hashState(a.state);
  const hb = hashState(clone);
  return { ok: ha === hb, hashA: ha, hashB: hb };
}

/** Time only Sim.step. Restarts the level whenever a run ends. */
function timeSteps(Sim, opts) {
  const ticks = opts.ticks || 10000;
  const inputs = opts.inputs || [];
  let state = Sim.create(opts.levelId, opts.seed);
  let total = 0n;
  let worst = 0n;
  let k = 0;
  for (let t = 0; t < ticks; t++) {
    if (Sim.result(state)) { state = Sim.create(opts.levelId, opts.seed + t); k = 0; }
    const inp = inputs.length ? inputs[k % inputs.length] : { steer: 0, brake: 0, horn: 0 };
    k++;
    const t0 = process.hrtime.bigint();
    Sim.step(state, inp);
    const dt = process.hrtime.bigint() - t0;
    total += dt;
    if (dt > worst) worst = dt;
  }
  return { avgMs: Number(total) / 1e6 / ticks, maxMs: Number(worst) / 1e6, ticks };
}

/** Compact text encoding: 3 chars per tick (steer as 2 hex digits of int8, then flags 0-3). */
function encodeInputs(inputs) {
  let s = '';
  for (const i of inputs) {
    const q = Math.round(i.steer * 127) & 0xff;
    s += (q < 16 ? '0' : '') + q.toString(16) + ((i.brake ? 1 : 0) | (i.horn ? 2 : 0));
  }
  return s;
}

function decodeInputs(s) {
  const out = [];
  for (let i = 0; i + 2 < s.length; i += 3) {
    let q = parseInt(s.substr(i, 2), 16);
    if (q > 127) q -= 256;
    const f = +s[i + 2];
    out.push({ steer: q / 127, brake: f & 1, horn: (f >> 1) & 1 });
  }
  return out;
}

module.exports = { hashState, quantise, run, checkDeterminism, checkSerialisation, timeSteps, encodeInputs, decodeInputs };
