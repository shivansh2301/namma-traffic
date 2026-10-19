#!/usr/bin/env node
/*
 * Calibrate the clock for every level from bot runs.
 *
 * commute:  a crash-free run should arrive about 3 game minutes before 10:00,
 *           so suggest a start time = deadline - (median ride + 3 min).
 * delivery: each order should be delivered about 1.5 game minutes before it
 *           is due, so suggest due = start + median delivery time + 1.5 min.
 * Medians use crash-free runs (or all completed runs if fewer than 3).
 * Re-run after changing levels, traffic or player tunables, then copy the
 * suggestions into shared/world.js (LEVELS[].start / LEVELS[].drops[].due).
 *
 *   node tools/calibrate.js [seeds=20] [levelIds=all, e.g. 1,4]
 */
'use strict';
const Sim = require('../shared/sim.js');
const Bot = require('../shared/bot.js');
const World = require('../shared/world.js');

const seeds = +(process.argv[2] || 20);
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : World.levelIds;
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

for (const def of World.LEVELS) {
  if (!only.includes(def.id)) continue;
  const L = World.level(def.id);
  const clean = { ride: [], drops: L.drops.map(() => []) };
  const all = { ride: [], drops: L.drops.map(() => []) };
  let fails = 0;
  const real = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const st = Sim.create(def.id, seed);
    const mem = Bot.create();
    const times = [];
    let t = 0;
    while (!Sim.result(st) && t < 30000) {
      for (const e of Sim.step(st, Bot.act(st, mem))) if (e.type === 'delivered') times[e.orderId - 1] = st.time - L.startTime;
      t++;
    }
    const r = Sim.result(st);
    if (!r || r.outcome === 'breakdown') { fails++; continue; }
    real.push(t / 30);
    const gameMin = (t * World.DT * L.clockRate) / 60;
    for (const bucket of r.stats.crashes === 0 ? [clean, all] : [all]) {
      bucket.ride.push(gameMin);
      times.forEach((v, i) => { if (v != null) bucket.drops[i].push(v); });
    }
  }
  const pick = (c, a) => (c.length >= 3 ? c : a);
  console.log(`L${def.id} [${L.mode}] ${def.name}: median ${median(real).toFixed(0)} s real, ${fails} failed`);
  if (L.mode === 'delivery') {
    L.drops.forEach((d, i) => {
      const ref = pick(clean.drops[i], all.drops[i]);
      if (!ref.length) { console.log(`   drop ${i + 1} ${d.name}: never delivered`); return; }
      const due = L.startTime + Math.ceil(median(ref) / 60 + 1.5) * 60;
      console.log(`   drop ${i + 1} ${d.name.padEnd(32)} current ${def.drops[i].due}  suggested ${World.fmtClock(due)}`);
    });
  } else {
    const ref = pick(clean.ride, all.ride);
    const startMin = L.deadline / 60 - Math.ceil(median(ref) + 3);
    console.log(`   start current ${def.start}  suggested ${World.fmtClock(startMin * 60)}  (median ride ${median(ref).toFixed(1)} game min)`);
  }
}
