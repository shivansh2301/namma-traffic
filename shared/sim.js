/*
 * shared/sim.js: the deterministic simulation of a delivery shift.
 *
 *   const state  = Sim.create(levelId, seed);  // plain JSON-serialisable object
 *   const events = Sim.step(state, input);     // exactly one tick (DT = 1/30 s); mutates state
 *   const result = Sim.result(state);          // null while playing
 *
 * input = { steer: -1..1, brake: 0|1, horn: 0|1 }, or an array with one input
 * per entry of state.players (multiplayer-ready; v1 has one player).
 *
 * Rules: no DOM, window, Date, performance or Math.random. All randomness
 * comes from Rng over state.rng (runtime) or a layout stream derived from the
 * seed (placement), so (levelId, seed, inputs) always gives the same run.
 * The sim holds no render state; it reports what happened as events.
 * See docs/concepts/deterministic-sim.md.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const mod = factory(isNode ? require('./world.js') : root.World);
  if (isNode) module.exports = mod;
  else root.Sim = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (World) {
  'use strict';

  const { T, DT, VEHICLES, PED, Rng } = World;
  const LW = T.LANE_W;
  const NO_INPUT = Object.freeze({ steer: 0, brake: 0, horn: 0 });
  const NO_MERGE = -999; // npc.mergeX when not signalling a merge

  // Per-10-second chances converted to per-tick probabilities.
  const perTick = (p10) => (-Math.log(1 - p10) / 10) * DT;
  const P_AUTO_STOP = perTick(T.AUTO_STOP_CHANCE_PER_10S);
  const P_CAB_STOP = perTick(T.CAB_STOP_CHANCE_PER_10S);
  const P_BUS_STOP = perTick(T.BUS_STOP_ANYWHERE_PER_10S);

  // ---------------------------------------------------------------------------
  // Obstacle snapshot. Rebuilt at the start of every tick from the state
  // (module scratch, never part of the state), so every NPC decides from the
  // same picture of the world. Pooled objects: no per-tick allocation.
  // ---------------------------------------------------------------------------
  const K_VEH = 0, K_COW = 1, K_PED = 2, K_PLAYER = 3, K_BARRICADE = 4;
  const OB = [];
  let obN = 0;
  const LEAD = { gap: 0, vy: 0, ob: null };
  const PREV = []; // players' positions at the start of this tick, for low-speed contact
  const PENDING = []; // events raised deep inside NPC logic, flushed at the end of the tick

  function obPush(kind, ref, x, y, w, l, vx, vy, dir) {
    let o = OB[obN];
    if (!o) { o = { kind: 0, ref: null, x: 0, y: 0, w: 0, l: 0, vx: 0, vy: 0, dir: 0 }; OB[obN] = o; }
    obN++;
    o.kind = kind; o.ref = ref; o.x = x; o.y = y; o.w = w; o.l = l; o.vx = vx; o.vy = vy; o.dir = dir;
    return o;
  }

  function buildObstacles(st, L, py) {
    obN = 0;
    const lo = py - T.DESPAWN_BEHIND - 20;
    const hi = py + T.DESPAWN_AHEAD + 20;
    for (const p of st.players) obPush(K_PLAYER, p, p.x, p.y, T.PLAYER_W, T.PLAYER_L, 0, p.crash > 0 ? 0 : p.v, 1);
    for (const n of st.npcs) {
      if (n.y < lo || n.y > hi) continue;
      if (n.kind === 'cow') obPush(K_COW, n, n.x, n.y, n.w, n.l, Math.sin(n.h) * n.v, Math.cos(n.h) * n.v, 0);
      else obPush(K_VEH, n, n.x, n.y, n.w, n.l, n.vx, n.dir * n.v, n.ws ? -2 : n.dir);
    }
    for (const pd of st.peds) {
      if (pd.y < lo || pd.y > hi) continue;
      obPush(K_PED, pd, pd.x, pd.y, PED.w, PED.l, pd.vx, pd.vy, 0);
    }
    for (const b of L.barricades) {
      if (b.y1 < lo || b.y0 > hi) continue;
      obPush(K_BARRICADE, null, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.x1 - b.x0, b.y1 - b.y0, 0, 0, 0);
    }
    for (const k of st.stalls) {
      if (k.y < lo || k.y > hi) continue;
      obPush(K_BARRICADE, k, k.x, k.y, k.w, k.l, 0, 0, 0);
    }
    for (const d of st.dogs) {
      if (d.y < lo || d.y > hi) continue;
      obPush(K_COW, d, d.x, d.y, T.DOG_W, T.DOG_L, d.vx, d.vy, 0);
    }
  }

  /**
   * Nearest obstacle ahead of `n` (direction dir) whose body overlaps the
   * corridor [x - hw, x + hw]. Fills LEAD (gap is bumper to bumper).
   */
  function findLeader(n, x, hw, dir, ignorePlayers, maxGap) {
    let best = maxGap;
    let bo = null;
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (o.ref === n) continue;
      // Oncoming and wrong-side traffic never dodge a moving player (§6.5, §6.6),
      // but nobody ploughs into a scooter that has (nearly) stopped.
      if (ignorePlayers && o.kind === K_PLAYER && o.vy > 2) continue;
      const rel = (o.y - n.y) * dir;
      if (rel <= 0) continue;
      const gap = rel - (n.l + o.l) / 2;
      // Give way to a scooter nosing in, and to a vehicle signalling a merge into
      // this corridor, but only once it is clearly ahead: if it is alongside,
      // keep moving so it gets a gap behind us (otherwise both wait forever). 1.1 m: the
      // merger needs 1 m behind it (backClear), so closer than that we would wait in vain.
      const extra = o.kind === K_PLAYER && dir > 0 ? 0.35 : 0;
      const dx = Math.abs(o.x - x);
      if (dx >= hw + o.w / 2 + (gap > 0.5 ? extra : 0)) {
        const mx = o.kind === K_VEH ? o.ref.mergeX : NO_MERGE;
        if (!(mx !== NO_MERGE && gap > 1.1 && o.dir === dir && Math.abs(mx - x) < hw + o.w / 2 + 0.1)) continue;
      }
      if (gap < best) { best = gap; bo = o; }
    }
    LEAD.ob = bo;
    LEAD.gap = best;
    LEAD.vy = bo ? bo.vy * dir : 0;
    return bo;
  }

  /**
   * Nothing alongside `n` overlaps the lateral sweep from n.x to x. Things in
   * line with n (overlapping its current lateral span) are ahead or behind,
   * not beside, so they never block a sideways move.
   */
  function sweepClear(n, x, margin, alongGap, ignorePlayers) {
    const need = alongGap != null ? alongGap : 0.8;
    // The margin applies on the side we move towards, not the side we leave.
    const a = x < n.x ? x - n.w / 2 - margin : n.x - n.w / 2;
    const b = x > n.x ? x + n.w / 2 + margin : n.x + n.w / 2;
    const ca = n.x - n.w / 2;
    const cb = n.x + n.w / 2;
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (o.ref === n || (ignorePlayers && o.kind === K_PLAYER)) continue;
      if (o.x + o.w / 2 <= a || o.x - o.w / 2 >= b) continue;
      if (o.x + o.w / 2 > ca && o.x - o.w / 2 < cb) continue;
      // Ahead of us only blocks if it truly overlaps (sliding along a face is fine).
      const along = Math.abs(o.y - n.y) - (n.l + o.l) / 2;
      if (along < ((o.y - n.y) * n.dir > 0 ? 0.02 : need)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function lowerBoundY(arr, y) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].y < y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function puddleAt(st, x, y) {
    const arr = st.puddles;
    for (let i = lowerBoundY(arr, y - 2.2); i < arr.length && arr[i].y <= y + 2.2; i++) {
      const q = arr[i];
      const dx = (x - q.x) / q.rx;
      const dy = (y - q.y) / q.ry;
      if (dx * dx + dy * dy < 1) return q;
    }
    return null;
  }

  function potholeUnder(st, x, y) {
    const arr = st.potholes;
    const reach = T.PLAYER_L * 0.35;
    for (let i = lowerBoundY(arr, y - 1.3 - reach); i < arr.length && arr[i].y <= y + 1.3 + reach; i++) {
      const h = arr[i];
      if (Math.abs(x - h.x) < h.r * 0.8 && Math.abs(y - h.y) < h.r * 0.8 + reach) return h;
    }
    return null;
  }

  function visiblePotholeAhead(st, x, y, dist, hw) {
    const arr = st.potholes;
    for (let i = lowerBoundY(arr, y); i < arr.length && arr[i].y <= y + dist; i++) {
      const h = arr[i];
      if (!h.hidden && Math.abs(x - h.x) < h.r + hw) return h;
    }
    return null;
  }

  function addPuddle(st, x, y, rx, ry, leak) {
    const q = { id: st.nextId++, x, y, rx, ry, leak: leak ? 1 : 0 };
    st.puddles.splice(lowerBoundY(st.puddles, y), 0, q);
    return q;
  }

  function damage(p, amount) { p.condition = Math.max(0, p.condition - amount); }
  function loseKarma(p, amount) { p.karma = Math.max(0, p.karma - amount); }
  function gainKarma(p, amount) { p.karma = Math.min(100, p.karma + amount); }
  function pedById(st, id) {
    for (let i = 0; i < st.peds.length; i++) if (st.peds[i].id === id) return st.peds[i];
    return null;
  }

  function breakerAhead(L, y, dir, len) {
    for (const b of L.breakers) {
      const d = (b.y - y) * dir - len / 2;
      if (d > -len && d < 9) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Creation and placement
  // ---------------------------------------------------------------------------
  function newPlayer(st, opts) {
    return {
      id: st.nextId++,
      x: 1.4, y: 6, v: 0, steer: 0,
      wobble: 0, jitter: 0, crash: 0, crashWith: '', invuln: 0,
      condition: 100, karma: T.KARMA_START,
      skill: clamp((opts && opts.skill) | 0, 0, T.SKILL_MAX),
      hornCd: 0, hornLog: [],
      surface: 'road', pothole: 0, puddle: 0, bumpAcc: 0, scrapeT: 0,
      // fights (after a clash)
      fight: 0, fightWith: '', fightId: 0, fightSorry: 0, fightArgued: 0,
      // karma economy: luck timer, calm-riding timer, timed effects, wallet, XP gifts
      luckT: T.LUCK_FIRST, calmT: 0, letInT: 0,
      steadyT: 0, sugarT: 0, punctureT: 0, fadeT: 0, haltT: 0,
      money: 0, xpBonus: 0, goodDeeds: 0, fights: 0,
      // deliveries: bag condition, time stopped in a drop zone, handover in progress
      goods: 100, dropT: 0, handT: 0, handId: 0, handScene: '', handStep: 0, handStepT: 0, handHonk: 0,
      // street life: the last drain / manhole under us, gaali cooldown
      drain: 0, manhole: 0, gaaliT: 0,
      stats: { splashedPeds: 0, potholesHit: 0, crashes: 0, honks: 0, footpathSeconds: 0, slips: 0, dogBites: 0, gaalis: 0 },
    };
  }

  function newNpc(st, kind, x, y, dir) {
    const V = VEHICLES[kind];
    return {
      id: st.nextId++, kind, variant: Rng.int(st, 0, V.variants - 1),
      x, y, tx: x, off: 0, vx: 0, dir, ws: false,
      w: V.w, l: V.l, v: 0, vDes: 0,
      lane: -1, mergeX: NO_MERGE, blocked: 0, byPlayer: 0, lcCool: 0, plan: 0,
      stop: 0, stopHard: false, hold: 0, holdOff: 0,
      cab: false, busDone: -1, leak: 0, pud: 0, warned: false, honk: 0,
      thanked: 0, pickup: 0, fare: 0, argueT: 0, boardT: 0, parked: 0, gone: 0,
      trait: '', passed: 0, honkN: 0, honkTick: 0, gaali: 0,
    };
  }

  function cowBox(n) {
    const c = Math.abs(Math.cos(n.h));
    const s = Math.abs(Math.sin(n.h));
    n.w = VEHICLES.cow.w * c + VEHICLES.cow.l * s;
    n.l = VEHICLES.cow.l * c + VEHICLES.cow.w * s;
  }

  function nearBreaker(L, y, pad) {
    for (const b of L.breakers) if (Math.abs(b.y - y) < pad) return true;
    return false;
  }

  function placeHazards(st, L, h) {
    const rain = L.weather === 'rain';
    for (const s of L.segs) {
      const xMax = s.xs.roadR;
      const first = st.potholes.length;
      const nP = Rng.poisson(h, (s.potholes * T.POTHOLES_PER_100M * s.len) / 100);
      for (let i = 0; i < nP; i++) {
        const u = Rng.next(h);
        const r = 0.4 + 0.8 * u * u;
        const y = Rng.range(h, s.y0 + 2, s.y1 - 2);
        const x = Rng.range(h, 0.25 + r * 0.5, xMax - 0.25 - r * 0.5);
        const shape = Rng.int(h, 0, 5);
        const rot = Rng.range(h, 0, Math.PI * 2);
        if (y < 25 || nearBreaker(L, y, 1.5 + r) || World.barricadeAt(L, x, y, r)) continue;
        st.potholes.push({ id: st.nextId++, x, y, r, shape, rot, hidden: false });
      }
      const segPotholes = st.potholes.length - first;
      const nW = Rng.poisson(h, ((s.puddles * T.PUDDLES_PER_100M * s.len) / 100) * (rain ? T.RAIN_PUDDLE_MULT : 1));
      for (let i = 0; i < nW; i++) {
        const rx = Rng.range(h, 0.5, 2.0);
        const ry = Rng.range(h, 0.6, 2.0);
        let x;
        let y;
        if (segPotholes > 0 && Rng.chance(h, rain ? 0.45 : 0.2)) {
          const ph = st.potholes[first + Rng.int(h, 0, segPotholes - 1)];
          x = ph.x + Rng.range(h, -0.5, 0.5);
          y = ph.y + Rng.range(h, -0.5, 0.5);
        } else {
          x = Rng.chance(h, 0.5) ? Rng.range(h, rx * 0.5, 2.6) : Rng.range(h, 0, xMax);
          y = Rng.range(h, s.y0 + 2, s.y1 - 2);
        }
        if (y < 20 || World.barricadeAt(L, x, y, 0.5)) continue;
        st.puddles.push({ id: st.nextId++, x: clamp(x, 0.2, xMax - 0.2), y, rx, ry, leak: 0 });
      }
    }
    st.potholes.sort((a, b) => a.y - b.y);
    st.puddles.sort((a, b) => a.y - b.y);
    if (rain) {
      for (const ph of st.potholes) {
        if (puddleAt(st, ph.x, ph.y) && Rng.chance(h, T.HIDDEN_POTHOLE_CHANCE)) ph.hidden = true;
      }
    }
  }

  function placeCows(st, L, h) {
    for (const s of L.segs) {
      const n = Rng.poisson(h, (s.cows * T.COWS_PER_100M * s.len) / 100);
      for (let i = 0; i < n; i++) {
        const y = Rng.range(h, s.y0 + 5, s.y1 - 5);
        const where = Rng.next(h);
        let x;
        if (where < 0.55) x = Rng.range(h, 0.6, s.xs.ownR - 0.6);
        else if (where < 0.8 || s.xs.divided) x = Rng.range(h, s.xs.wallL + 0.8, 0.8);
        else x = Rng.range(h, s.xs.ownR + 0.6, s.xs.roadR - 0.6);
        const heading = Rng.range(h, 0, Math.PI * 2);
        const sit = Rng.chance(h, 0.6);
        const variant = Rng.int(h, 0, VEHICLES.cow.variants - 1);
        if (y < 45 || World.barricadeAt(L, x, y, 1.5)) continue;
        const cow = {
          id: st.nextId++, kind: 'cow', variant, x, y, tx: x, off: 0, vx: 0, dir: 1, ws: false,
          w: 0, l: 0, v: 0, vDes: 0, h: heading, mode: sit ? 'sit' : 'stand', modeT: 3 + 10 * Rng.next(h), boredT: 0,
        };
        cowBox(cow);
        st.npcs.push(cow);
      }
    }
  }

  /**
   * Cars parked along the kerbs: on the road beside a footpath, or half on the
   * shoulder in gullies; on the right edge too where parkedR > 0. Static, they
   * eat into the lane. Never inside a drop zone, at a bus stop or a breaker.
   */
  function placeParked(st, L, h) {
    const placed = [[], []];
    const CW = VEHICLES.car.w;
    for (const s of L.segs) {
      for (let side = 0; side < 2; side++) {
        const dens = side === 0 ? s.parked : s.xs.divided ? 0 : s.parkedR;
        const n = Rng.poisson(h, (dens * T.PARKED_PER_100M * s.len) / 100);
        for (let i = 0; i < n; i++) {
          const y = Rng.range(h, s.y0 + 5, s.y1 - 5);
          const variant = Rng.int(h, 0, VEHICLES.car.variants - 1);
          const inset = Rng.range(h, 0.15, 0.4);
          const fp = side === 0 ? s.footpathL : s.footpathR;
          const ew = -s.xs.wallL;
          let x;
          if (side === 0) x = fp ? CW / 2 + inset : -ew + CW / 2 + 0.15;
          else x = fp ? s.xs.roadR - CW / 2 - inset : s.xs.roadR + ew - CW / 2 - 0.15;
          if (y < 50 || World.barricadeAt(L, x, y, 3) || nearBreaker(L, y, 8)) continue;
          if (side === 0 && (L.busStops.some((f) => Math.abs(f.y - y) < 14) || L.drops.some((d) => Math.abs(d.y - y) < T.DROP_ZONE / 2 + 7))) continue;
          if (placed[side].some((py) => Math.abs(py - y) < VEHICLES.car.l + 1.5)) continue;
          const a = World.segmentAt(L, y - 5);
          const b = World.segmentAt(L, y + 5);
          if (a !== s || b !== s) continue; // keep clear of segment changes and junctions
          placed[side].push(y);
          const car = newNpc(st, 'car', x, y, side === 0 ? 1 : -1);
          car.variant = variant;
          car.parked = 1;
          car.lane = 0;
          car.stop = 1e5; // never moves
          st.npcs.push(car);
        }
      }
    }
  }

  function newPed(st, h, side, u, x, y, dir) {
    return {
      id: st.nextId++, side, u, x, y, dir,
      v: Rng.range(h, PED.vMin, PED.vMax), variant: Rng.int(h, 0, PED.variants - 1),
      mode: 'walk', t: 0, vx: 0, vy: 0, cdir: 0, cx: 0, cmedian: false,
      dodge: 0, dodgeV: 0, splash: 0,
      thanked: 0, chatted: 0, chatWith: 0,
      honkN: 0, honkTick: 0, gaali: 0, stall: 0, blockT: 0,
    };
  }

  function placePeds(st, L, h) {
    for (const s of L.segs) {
      for (let side = 0; side < 2; side++) {
        if (side === 1 && s.xs.divided) continue;
        const fp = side === 0 ? s.footpathL : s.footpathR;
        const mean = ((s.peds * T.PEDS_PER_100M * s.len) / 100) * (fp ? T.FOOTPATH_PED_MULT : 1) * (side ? 0.6 : 1);
        const n = Rng.poisson(h, mean);
        for (let i = 0; i < n; i++) {
          const y = Rng.range(h, s.y0, s.y1);
          const u = Rng.next(h);
          const dir = Rng.sign(h);
          const band = World.pedBand(s, side);
          if (y < 22) continue;
          st.peds.push(newPed(st, h, side, u, band[0] + u * (band[1] - band[0]), y, dir));
        }
      }
      for (const f of s.features) {
        if (f.kind !== 'busStop') continue;
        const n = Rng.int(h, 3, 6);
        const band = World.pedBand(s, 0);
        for (let i = 0; i < n; i++) {
          const u = Rng.range(h, 0.4, 1);
          const pd = newPed(st, h, 0, u, band[0] + u * (band[1] - band[0]), f.y + Rng.range(h, -4, 4), 1);
          pd.mode = 'wait';
          st.peds.push(pd);
        }
      }
    }
    st.peds.sort((a, b) => a.y - b.y);
  }

  // ---------------------------------------------------------------------------
  // Busy gully stretches: school's out, market day, a wedding procession...
  // More traffic, carts and people, and they cross more often.
  // ---------------------------------------------------------------------------

  /** A few random stretches of gully get crowded. Own RNG stream, so the rest of the layout is unchanged. */
  function placeBusy(L, levelId, seed) {
    const h = { rng: Rng.hash(seed, levelId, 'busy') | 0 };
    const out = [];
    for (const s of L.segs) {
      if (s.area !== 'gully' || !Rng.chance(h, T.BUSY_CHANCE)) continue;
      const len = Rng.range(h, T.BUSY_LEN_MIN, T.BUSY_LEN_MAX);
      const lo = Math.max(s.y0 + 8, T.BUSY_MIN_Y);
      const hi = s.y1 - 8 - len;
      if (hi <= lo) continue;
      const y0 = Math.round(Rng.range(h, lo, hi));
      out.push({ y0, y1: Math.round(y0 + len), kind: Rng.pick(h, World.BUSY_KINDS), seen: 0 });
    }
    // The crowd itself: extra pedestrians on both edges.
    for (const b of out) {
      const s = World.segmentAt(L, b.y0);
      const n = Rng.poisson(h, (T.BUSY_PEDS_PER_100M * (b.y1 - b.y0)) / 100);
      b.peds = [];
      for (let i = 0; i < n; i++) b.peds.push({ side: Rng.chance(h, 0.6) ? 0 : s.xs.divided ? 0 : 1, y: Rng.range(h, b.y0, b.y1), u: Rng.next(h), dir: Rng.sign(h) });
    }
    return out;
  }

  function busyAt(st, y) {
    const b = st.busy;
    for (let i = 0; i < b.length; i++) if (y >= b[i].y0 && y < b[i].y1) return b[i];
    return null;
  }

  /** Announce each busy stretch once as the player approaches. */
  function busyTick(st, p, ev) {
    for (const b of st.busy) {
      if (b.seen || p.y < b.y0 - T.BUSY_WARN || p.y > b.y1) continue;
      b.seen = 1;
      ev.push({ type: 'busyAhead', kind: b.kind, y0: b.y0, y1: b.y1, pid: p.id });
    }
  }

  // ---------------------------------------------------------------------------
  // Street life on the edges (docs/concepts/street-life.md): chai, momo and
  // biryani stalls with their customers, street dogs, missing drain slabs on
  // footpaths, sunken manhole covers, puddles on the footpath. Own RNG stream.
  // ---------------------------------------------------------------------------

  /** The edges of a segment: [x0, x1] of the left edge and (undivided roads) the right edge. */
  function edgesOf(s) {
    const out = [{ side: 0, x0: s.xs.wallL, x1: 0, footpath: s.footpathL }];
    if (!s.xs.divided) out.push({ side: 1, x0: s.xs.roadR, x1: s.xs.wallR, footpath: s.footpathR });
    return out;
  }

  /** Room for something at (side, y) on an edge: clear of drops, bus stops, breakers, segment changes and parked cars. */
  function edgeFree(st, L, s, side, y, pad) {
    if (y < 30 || y > L.length - 10) return false;
    if (World.segmentAt(L, y - pad - 3) !== s || World.segmentAt(L, y + pad + 3) !== s) return false;
    if (nearBreaker(L, y, pad + 2)) return false;
    if (side === 0 && (L.busStops.some((f) => Math.abs(f.y - y) < 10 + pad) || L.drops.some((d) => Math.abs(d.y - y) < T.DROP_ZONE / 2 + pad + 2))) return false;
    for (const n of st.npcs) if (n.parked && (n.x < s.xs.ownR / 2 ? 0 : 1) === side && Math.abs(n.y - y) < n.l / 2 + pad + 1) return false;
    for (const k of st.stalls) if (k.side === side && Math.abs(k.y - y) < k.l / 2 + pad + 2) return false;
    for (const d of st.drains) if (Math.abs(d.y - y) < d.l / 2 + pad + 1) return false;
    return true;
  }

  function placeStreet(st, L, levelId, seed) {
    const h = { rng: Rng.hash(seed, levelId, 'street') | 0 };
    for (const s of L.segs) {
      const gully = s.area === 'gully';
      for (const e of edgesOf(s)) {
        const ew = e.x1 - e.x0;
        const inner = (x) => (e.side === 0 ? x : e.x0 + e.x1 - x); // mirror for the right edge
        // Stalls: a cart under a tarp against the wall, customers standing on the road side of it.
        const nS = Rng.poisson(h, (T.STALLS_PER_100M * s.len) / 100 * (gully ? 1.3 : 1));
        for (let i = 0; i < nS; i++) {
          const y = Math.round(Rng.range(h, s.y0 + 6, s.y1 - 6) * 10) / 10;
          const kind = Rng.pick(h, World.STALL_KINDS);
          const nc = Rng.int(h, 1, 3);
          const w = Math.min(T.STALL_W, ew - 0.15);
          if (w < 0.7 || !edgeFree(st, L, s, e.side, y, T.STALL_L / 2 + 1)) continue;
          const x = inner(e.x0 + 0.08 + w / 2);
          const k = { id: st.nextId++, kind, side: e.side, x, y, w, l: T.STALL_L };
          st.stalls.push(k);
          for (let c = 0; c < nc; c++) {
            // Wide footpath: customers between the stall and the kerb. Narrow shoulder: beside it, not in the road.
            const wide = ew >= 2;
            const cx = wide ? inner(e.x0 + 0.08 + w + 0.35 + Rng.range(h, 0, 0.3)) : inner(e.x0 + ew / 2);
            const cy = wide ? y + Rng.range(h, -1.1, 1.1) : y + (c & 1 ? 1 : -1) * (T.STALL_L / 2 + 0.4 + (c >> 1) * 0.6);
            const pd = newPed(st, h, e.side, 0.5, cx, cy, Rng.sign(h));
            pd.mode = 'wait';
            pd.stall = k.id;
            st.peds.push(pd);
          }
        }
        // Missing drain slabs: footpaths only.
        if (e.footpath) {
          const nD = Rng.poisson(h, (T.DRAINS_PER_100M * s.len) / 100);
          for (let i = 0; i < nD; i++) {
            const y = Math.round(Rng.range(h, s.y0 + 4, s.y1 - 4) * 10) / 10;
            const x = inner(Rng.range(h, e.x0 + 0.5 + T.DRAIN_W / 2, e.x1 - 0.4 - T.DRAIN_W / 2));
            if (!edgeFree(st, L, s, e.side, y, T.DRAIN_L / 2 + 0.5)) continue;
            st.drains.push({ id: st.nextId++, x, y, w: T.DRAIN_W, l: T.DRAIN_L });
          }
        }
        // Puddles on the edge (footpath or shoulder).
        const nW = Rng.poisson(h, (T.FOOTPATH_PUDDLES_PER_100M * s.len) / 100 * (L.weather === 'rain' ? T.RAIN_PUDDLE_MULT : 1));
        for (let i = 0; i < nW; i++) {
          const rx = Rng.range(h, 0.35, Math.min(0.9, ew / 2 - 0.1));
          const ry = Rng.range(h, 0.5, 1.2);
          const y = Rng.range(h, s.y0 + 3, s.y1 - 3);
          if (y < 20 || rx < 0.3) continue;
          st.puddles.push({ id: st.nextId++, x: (e.x0 + e.x1) / 2 + Rng.range(h, -0.2, 0.2), y, rx, ry, leak: 0 });
        }
        // Street dogs asleep on the edge; in gullies some sleep at the edge of the lane.
        const nG = Rng.poisson(h, (T.DOGS_PER_100M * s.len) / 100 * (gully ? 1.6 : 1));
        for (let i = 0; i < nG; i++) {
          const y = Math.round(Rng.range(h, s.y0 + 4, s.y1 - 4) * 10) / 10;
          const inLane = gully && Rng.chance(h, 0.3);
          const x = inLane ? (e.side === 0 ? Rng.range(h, 0.35, 0.9) : Rng.range(h, e.x0 - 0.9, e.x0 - 0.35)) : inner(Rng.range(h, e.x0 + 0.35, e.x1 - 0.35));
          if (y < 40 || World.barricadeAt(L, x, y, 1) || st.stalls.some((k) => Math.abs(k.y - y) < 2.5 && Math.abs(k.x - x) < 1.5)) continue;
          if (inLane && st.npcs.some((n) => n.parked && Math.abs(n.y - y) < n.l / 2 + 3 && Math.abs(n.x - x) < 3)) continue; // never trap a lane beside a parked car
          st.dogs.push({ id: st.nextId++, x, y, hx: x, hy: y, variant: Rng.int(h, 0, 2), mode: 'sleep', t: 0, vx: 0, vy: 0, face: Rng.sign(h), woke: 0, bit: 0, barkT: 0 });
        }
      }
      // Sunken manhole covers in the road.
      const xr = (s.xs.divided ? s.xs.ownR : s.xs.roadR) - 0.8;
      const nM = Rng.poisson(h, (T.MANHOLES_PER_100M * s.len) / 100);
      for (let i = 0; i < nM; i++) {
        const y = Math.round(Rng.range(h, s.y0 + 3, s.y1 - 3) * 10) / 10;
        const x = Rng.range(h, 0.8, xr);
        if (y < 25 || nearBreaker(L, y, 3) || World.barricadeAt(L, x, y, 1) || st.potholes.some((ph) => Math.abs(ph.y - y) < ph.r + 1 && Math.abs(ph.x - x) < ph.r + 1)) continue;
        st.manholes.push({ id: st.nextId++, x, y, r: T.MANHOLE_R });
      }
    }
    for (const a of [st.stalls, st.drains, st.dogs, st.manholes, st.puddles, st.peds]) a.sort((p, q) => p.y - q.y);
  }

  /** Street dogs: asleep until you whizz past; then they chase, bark, and bite if they catch you. */
  function updateDogs(st, L, p, ev) {
    for (const d of st.dogs) {
      const dy = d.y - p.y;
      if (dy < -60 || dy > T.ACTIVE_RANGE) continue;
      if (d.mode === 'sleep') {
        d.vx = d.vy = 0;
        // A scooter stopped right next to it: it gets up and flops down a few metres on, by the wall.
        if (p.v < 0.5 && p.crash <= 0 && Math.abs(dy) < 3.5 && Math.abs(d.x - p.x) < 1.6) {
          const s = World.segmentAt(L, d.y);
          d.mode = 'return';
          d.woke = 1;
          d.hy = d.y + (dy >= 0 ? 4 : -4);
          d.hx = d.x < s.xs.ownR ? s.xs.wallL + 0.35 : s.xs.wallR - 0.35;
          continue;
        }
        if (!d.woke && p.crash <= 0 && Math.abs(dy) < T.DOG_WAKE_DIST && Math.abs(d.x - p.x) < 2.5 && p.v > T.DOG_WAKE_SPEED) {
          d.woke = 1;
          const chance = T.DOG_WAKE_CHANCE * (p.surface === 'footpath' ? 1.6 : 1) * (1 + Math.max(0, 50 - p.karma) / 50);
          if (Rng.chance(st, Math.min(0.95, chance))) {
            d.mode = 'chase';
            d.t = T.DOG_CHASE_TIME;
            d.barkT = 0;
            ev.push({ type: 'dogChase', id: d.id, x: d.x, y: d.y, pid: p.id });
          }
        }
        continue;
      }
      const s = World.segmentAt(L, d.y);
      let tx = d.hx;
      let ty = d.hy;
      let sp = 2.2;
      if (d.mode === 'chase') {
        d.t -= DT;
        tx = p.x;
        ty = p.y - 0.3;
        sp = T.DOG_CHASE_SPEED;
        d.barkT -= DT;
        if (d.barkT <= 0) {
          d.barkT = Rng.range(st, 0.6, 1.0);
          ev.push({ type: 'bark', id: d.id, x: d.x, y: d.y });
        }
      }
      const ddx = tx - d.x;
      const ddy = ty - d.y;
      const dist = Math.hypot(ddx, ddy);
      const v = Math.min(sp, dist * 4);
      d.vx = dist > 0.01 ? (ddx / dist) * v : 0;
      d.vy = dist > 0.01 ? (ddy / dist) * v : 0;
      if (Math.abs(d.vx) > 0.2) d.face = d.vx > 0 ? 1 : -1;
      d.x = clamp(d.x + d.vx * DT, s.xs.limitL + 0.3, s.xs.limitR - 0.3);
      d.y += d.vy * DT;
      if (d.mode === 'chase') {
        if (!d.bit && p.crash <= 0 && p.invuln <= 0 && p.handT <= 0 && Math.hypot(d.x - p.x, d.y - p.y) < T.DOG_BITE_DIST) {
          d.bit = 1;
          d.mode = 'return';
          const amount = Math.min(p.money, T.DOG_BITE_COST);
          p.money -= amount;
          p.wobble = Math.max(p.wobble, T.WOBBLE_TIME);
          p.v *= 0.5;
          p.calmT = 0;
          p.stats.dogBites++;
          ev.push({ type: 'dogBite', id: d.id, amount, x: p.x, y: p.y, pid: p.id });
        } else if (d.t <= 0) d.mode = 'return';
      } else if (dist < 0.1) { // home again: back to sleep
        d.mode = 'sleep';
        d.vx = d.vy = 0;
      }
    }
  }

  function drainUnder(st, x, y) {
    const reach = T.PLAYER_L * 0.3;
    for (const d of st.drains) {
      if (d.y > y + 3) break;
      if (Math.abs(x - d.x) < d.w / 2 + 0.05 && Math.abs(y - d.y) < d.l / 2 + reach) return d;
    }
    return null;
  }

  function manholeUnder(st, x, y) {
    for (const m of st.manholes) {
      if (m.y > y + 2) break;
      if (Math.abs(x - m.x) < m.r + 0.1 && Math.abs(y - m.y) < m.r + T.PLAYER_L * 0.3) return m;
    }
    return null;
  }

  /** Slip and fall: hitting a puddle (or a wet manhole cover) too fast, worse when steering hard. */
  function slipChance(st, p, base) {
    if (p.steadyT > 0 || p.invuln > 0) return 0;
    return base * (st.weather === 'rain' ? 1.5 : 1) * (Math.abs(p.steer) > 0.5 ? 2 : 1) * (1 - 0.05 * p.skill);
  }

  // ---------------------------------------------------------------------------
  // Honking etiquette: honk at someone too often and they let you have it.
  // ---------------------------------------------------------------------------
  function honkedAt(st, t) {
    if (st.tick - t.honkTick > Math.round(T.HORN_WINDOW / DT)) t.honkN = 0;
    t.honkN++;
    t.honkTick = st.tick;
  }

  /** Nearest person or (moving) vehicle ahead in the scooter's path, within GAALI_RANGE. */
  function hornTarget(st, p) {
    let best = T.GAALI_RANGE;
    let t = null;
    for (const pd of st.peds) {
      const dy = pd.y - p.y;
      if (dy < 0 || dy >= best || Math.abs(pd.x - p.x) > T.PLAYER_W / 2 + 0.9 || pd.mode === 'gone') continue;
      best = dy; t = pd;
    }
    for (const n of st.npcs) {
      if (n.parked || n.kind === 'cow') continue;
      const dy = n.y - n.dir * n.l / 2 - p.y;
      if (dy < 0 || dy >= best || Math.abs(n.x - p.x) > (n.w + T.PLAYER_W) / 2 + 0.4) continue;
      best = dy; t = n;
    }
    return t;
  }

  function gaali(st, p, who, id, x, y, ev) {
    loseKarma(p, T.GAALI_KARMA);
    p.gaaliT = T.GAALI_COOLDOWN;
    p.stats.gaalis++;
    ev.push({ type: 'gaali', who, id, x, y, karma: T.GAALI_KARMA, pid: p.id });
  }

  /** opts: { skill } (rider skill level 0..SKILL_MAX from the player's profile). */
  function create(levelId, seed, opts) {
    const L = World.level(levelId);
    seed = seed >>> 0;
    const st = {
      v: 1,
      levelId,
      seed,
      tick: 0,
      rng: Rng.hash(seed, 'run') | 0,
      weather: L.weather,
      time: L.startTime,
      deadline: L.deadline,
      nextId: 1,
      done: false,
      result: null,
      players: [],
      npcs: [],
      peds: [],
      potholes: [],
      puddles: [],
      stalls: [],
      drains: [],
      manholes: [],
      dogs: [],
      orders: L.drops.map((d) => ({ id: d.i + 1, y: d.y, kind: d.kind, name: d.name, due: d.due, status: 'pending', at: 0, rating: 0, tip: 0, late: 0 })),
    };
    const layout = { rng: Rng.hash(seed, levelId, 'layout') | 0 };
    st.players.push(newPlayer(st, opts));
    placeHazards(st, L, layout);
    placeCows(st, L, layout);
    placeParked(st, L, layout);
    placePeds(st, L, layout);
    st.busy = placeBusy(L, levelId, seed);
    for (const b of st.busy) {
      const s = World.segmentAt(L, b.y0);
      for (const q of b.peds) {
        const band = World.pedBand(s, q.side);
        st.peds.push(newPed(st, layout, q.side, q.u, band[0] + q.u * (band[1] - band[0]), q.y, q.dir));
      }
      delete b.peds;
    }
    st.peds.sort((a, b) => a.y - b.y);
    placeStreet(st, L, levelId, seed);
    // Initial traffic around the start.
    const p = st.players[0];
    buildObstacles(st, L, p.y);
    for (let k = 0; k < 300; k++) {
      const y = p.y + Rng.range(st, -T.DESPAWN_BEHIND + 8, T.SPAWN_AHEAD_MAX);
      if (Math.abs(y - p.y) < T.START_CLEAR) continue;
      trySpawnSame(st, L, p, y, false);
      if (k % 2 === 0) trySpawnOncoming(st, L, p, y);
    }
    return st;
  }

  // ---------------------------------------------------------------------------
  // Spawning (§6.3)
  // ---------------------------------------------------------------------------

  /** True if a w×l box at (x, y) overlaps nothing and keeps `want` metres from same-direction traffic in its corridor. */
  function spawnClear(x, w, y, l, want, dir) {
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (Math.abs(o.x - x) >= (w + o.w) / 2 + 0.3) continue;
      const along = Math.abs(o.y - y) - (l + o.l) / 2;
      if (along < 1.5) return false;
      if ((o.kind === K_VEH || o.kind === K_PLAYER) && o.dir === dir && along < want) return false;
    }
    return true;
  }

  function rainMult(st) { return st.weather === 'rain' ? T.RAIN_NPC_SPEED_MULT : 1; }

  /**
   * Personalities: racing bikers, Bapido bike taxis (with a pillion), rival
   * delivery riders (Piggy, KinkIt, Tomato), learner drivers, horn-happy drivers;
   * every tanker leans on its air horn.
   */
  function npcTrait(st, kind) {
    if (kind === 'bike') {
      const m = World.level(st.levelId).mode === 'delivery' ? T.DELIVERY_BIKE_MULT : 1;
      let r = Rng.next(st);
      for (const k in T.BIKE_TRAITS) {
        r -= T.BIKE_TRAITS[k] * (World.DELIVERY_BRANDS.indexOf(k) >= 0 ? m : 1);
        if (r < 0) return k;
      }
      return '';
    }
    if (kind === 'car') return Rng.chance(st, T.SLOW_CAR_CHANCE) ? 'slow' : Rng.chance(st, T.HONKER_CHANCE) ? 'honker' : '';
    if (kind === 'auto') return Rng.chance(st, T.HONKER_CHANCE) ? 'honker' : '';
    if (kind === 'tanker') return 'honker';
    return '';
  }

  function traitSpeed(st, trait, vDes) {
    if (trait === 'racer') return Rng.range(st, T.RACER_V_MIN, T.RACER_V_MAX) * rainMult(st);
    if (World.DELIVERY_BRANDS.indexOf(trait) >= 0) return Rng.range(st, T.RIDER_V_MIN, T.RIDER_V_MAX) * rainMult(st);
    if (trait === 'slow') return Rng.range(st, T.SLOW_CAR_V_MIN, T.SLOW_CAR_V_MAX);
    return vDes;
  }

  function busyCart(st, s, busy) {
    if (!busy || !(s.mix.cart > 0)) return false;
    return Rng.chance(st, T.BUSY_CART_CHANCE * (busy.kind === 'market' ? 2 : 1));
  }

  function trySpawnSame(st, L, p, y, behind) {
    if (y < -T.DESPAWN_BEHIND || y > L.length + 40) return;
    const s = World.segmentAt(L, y);
    const busy = busyAt(st, y);
    const dens = (s.jam ? Math.max(T.JAM_MIN_DENSITY, s.traffic) : s.traffic) * (busy ? T.BUSY_TRAFFIC : 1);
    if (!(dens > 0)) return;
    let lane = Rng.int(st, 0, s.lanesOwn - 1);
    const kind = busyCart(st, s, busy) ? 'cart' : Rng.weighted(st, s.mix);
    if (!kind) return;
    const V = VEHICLES[kind];
    let jitter = kind === 'bike' ? Rng.range(st, -1.3, 1.3) : Rng.range(st, -0.25, 0.25);
    if (kind === 'cart') { lane = 0; jitter = -0.6; }
    const x = clamp(World.laneCenter(lane) + jitter, V.w / 2 + 0.2, s.xs.ownR - V.w / 2 - 0.2);
    const want = s.jam ? Rng.range(st, T.JAM_GAP_MIN, T.JAM_GAP_MAX) : (100 / (dens * T.TRAFFIC_PER_100M)) * Rng.range(st, 0.55, 1.45);
    const trait = s.jam ? '' : npcTrait(st, kind);
    const vDes = traitSpeed(st, trait, Rng.range(st, V.vMin, V.vMax) * rainMult(st));
    if (behind && p.v > vDes - 1.5) return;
    if (World.barricadeAt(L, x, y, V.l / 2 + 2)) return;
    if (World.laneBlocked(L, lane, y - V.l, y + 25) && kind !== 'bike') return;
    if (!spawnClear(x, V.w, y, V.l, want, 1)) return;
    const n = newNpc(st, kind, x, y, 1);
    n.lane = lane;
    n.trait = trait;
    n.vDes = vDes;
    n.v = s.jam ? Math.min(vDes, World.jamCap(y, st.tick * DT)) : vDes;
    if (kind === 'car') n.cab = Rng.chance(st, 0.25);
    st.npcs.push(n);
    obPush(K_VEH, n, n.x, n.y, n.w, n.l, 0, n.v, 1);
  }

  function trySpawnOncoming(st, L, p, y) {
    if (y > L.length + 60) return;
    const s = World.segmentAt(L, y);
    if (!(s.oncoming > 0) || s.xs.oncLanes <= 0) return;
    const j = Rng.int(st, 0, s.xs.oncLanes - 1);
    const busy = busyAt(st, y);
    const kind = busyCart(st, s, busy) ? 'cart' : Rng.weighted(st, s.mix);
    if (!kind) return;
    const V = VEHICLES[kind];
    const off = kind === 'bike' ? Rng.range(st, -1.0, 1.0) : kind === 'cart' ? 0.6 : Rng.range(st, -0.2, 0.2);
    const x = World.oncCenter(s, kind === 'cart' ? s.xs.oncLanes - 1 : j) + off;
    const want = (100 / (s.oncoming * T.ONCOMING_PER_100M * (busy ? T.BUSY_ONCOMING : 1))) * Rng.range(st, 0.55, 1.45);
    const trait = npcTrait(st, kind);
    const vDes = traitSpeed(st, trait, Rng.range(st, V.vMin, V.vMax) * rainMult(st));
    if (!spawnClear(x, V.w, y, V.l, want, -1)) return;
    const n = newNpc(st, kind, x, y, -1);
    n.lane = j;
    n.off = off;
    n.trait = trait;
    n.vDes = vDes;
    n.v = vDes;
    st.npcs.push(n);
    obPush(K_VEH, n, n.x, n.y, n.w, n.l, 0, -n.v, -1);
  }

  function trySpawnWrongSide(st, L, p) {
    const y = p.y + Rng.range(st, 74, 86);
    const s = World.segmentAt(L, y);
    if (!(s.wrongSide > 0) || y > L.length + 20) return;
    const kind = Rng.chance(st, 0.15) ? 'auto' : 'bike';
    const V = VEHICLES[kind];
    const x = kind === 'auto' ? Rng.range(st, 0.9, 1.6) : Rng.range(st, 0.45, 1.5);
    const vDes = Rng.range(st, 6, 9) * rainMult(st);
    for (const o of st.npcs) if (o.ws && Math.abs(o.y - y) < 20) return;
    if (World.barricadeAt(L, x, y, V.l)) return;
    if (!spawnClear(x, V.w, y, V.l, 3, -2)) return;
    const n = newNpc(st, kind, x, y, -1);
    n.ws = true;
    n.off = x;
    n.vDes = vDes;
    n.v = vDes;
    st.npcs.push(n);
    obPush(K_VEH, n, n.x, n.y, n.w, n.l, 0, -n.v, -2);
  }

  function spawnTick(st, L, p) {
    for (let k = 0; k < 2; k++) trySpawnSame(st, L, p, p.y + Rng.range(st, T.SPAWN_AHEAD_MIN, T.SPAWN_AHEAD_MAX), false);
    const sp = World.segmentAt(L, p.y);
    const dens = sp.jam ? Math.max(T.JAM_MIN_DENSITY, sp.traffic) : sp.traffic;
    if (dens > 0 && Rng.chance(st, dens * 0.6 * DT)) {
      trySpawnSame(st, L, p, p.y - Rng.range(st, T.SPAWN_BEHIND_MIN, T.SPAWN_BEHIND_MAX), true);
    }
    trySpawnOncoming(st, L, p, p.y + Rng.range(st, T.SPAWN_AHEAD_MIN + 5, T.SPAWN_AHEAD_MAX + 5));
    if (sp.wrongSide > 0 && Rng.chance(st, sp.wrongSide * T.WRONG_SIDE_PER_S * DT)) trySpawnWrongSide(st, L, p);
  }

  function despawn(st, p) {
    let w = 0;
    const a = st.npcs;
    for (let i = 0; i < a.length; i++) {
      const n = a[i];
      const dy = n.y - p.y;
      if (dy < -T.DESPAWN_BEHIND) continue;
      if (n.kind !== 'cow' && !n.parked && dy > T.DESPAWN_AHEAD) continue;
      if (n.gone) continue;
      a[w++] = n;
    }
    a.length = w;
    w = 0;
    const b = st.peds;
    for (let i = 0; i < b.length; i++) if (b[i].y - p.y >= -T.DESPAWN_BEHIND && b[i].mode !== 'gone') b[w++] = b[i];
    b.length = w;
    if (st.tick % 30 === 0) {
      w = 0;
      const q = st.puddles;
      for (let i = 0; i < q.length; i++) if (!q[i].leak || q[i].y > p.y - 60) q[w++] = q[i];
      q.length = w;
    }
  }

  // ---------------------------------------------------------------------------
  // NPC vehicles (§6)
  // ---------------------------------------------------------------------------

  function laneGapOk(n, cx, urgent) {
    const V = VEHICLES[n.kind];
    const need = urgent ? 0.6 : V.gapNeed;
    // Sweep margin only on the side we move towards (like sweepClear).
    const sweepA = cx < n.x ? cx - n.w / 2 - 0.15 : n.x - n.w / 2;
    const sweepB = cx > n.x ? cx + n.w / 2 + 0.15 : n.x + n.w / 2;
    const tA = cx - n.w / 2 - 0.2;
    const tB = cx + n.w / 2 + 0.2;
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (o.ref === n) continue;
      const rel = o.y - n.y;
      const along = Math.abs(rel) - (n.l + o.l) / 2;
      const inLine = Math.abs(o.x - n.x) < (o.w + n.w) / 2;
      if (along < 0.3 && !inLine && o.x + o.w / 2 > sweepA && o.x - o.w / 2 < sweepB) return false;
      if (o.x + o.w / 2 > tA && o.x - o.w / 2 < tB) {
        if (rel > 0 && along < need + 0.3 * Math.max(0, n.v - o.vy)) return false;
        if (rel < 0 && along < need + 0.6 * Math.max(0, o.vy - n.v)) return false;
      }
    }
    return true;
  }

  /** The nearest same-direction vehicle just behind n in corridor x, if it had to brake for n. */
  function followerIn(n, x) {
    let best = null;
    let bestGap = 1e9;
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (o.kind !== K_VEH || o.ref === n || o.dir !== 1 || o.y >= n.y) continue;
      if (Math.abs(o.x - x) >= (o.w + n.w) / 2) continue;
      const gap = n.y - o.y - (n.l + o.l) / 2;
      if (gap < bestGap) { bestGap = gap; best = o.ref; }
    }
    return best && bestGap < 2 + 0.4 * Math.max(0, best.v - n.v) ? best : null;
  }

  function nextBusStop(L, n) {
    for (const f of L.busStops) {
      const d = f.y - (n.y + n.l / 2);
      if (d > -1 && d < 90 && n.busDone !== f.y) return f;
    }
    return null;
  }

  function laneLateral(st, L, n, s) {
    const V = VEHICLES[n.kind];
    if (n.kind === 'cart') { // pushed along the kerb; edges around parked cars
      const cx = World.laneCenter(0) - 0.6;
      n.lane = 0;
      const hiC = (s.xs.divided ? s.xs.ownR : s.xs.roadR) - n.w / 2 - 0.15;
      if (n.hold <= 0) passObstacle(n, cx, n.w / 2 + 0.15, hiC, 2.6);
      n.tx = clamp(cx + (n.hold > 0 ? n.holdOff : 0), n.w / 2 + 0.15, hiC);
      return V;
    }
    const nlHere = s.lanesOwn;
    const sAhead = World.segmentAt(L, n.y + 25);
    // Lanes that end at a junction do not need merging: that traffic turns off there.
    const nl = sAhead !== s && sAhead.junction ? nlHere : Math.min(nlHere, sAhead.lanesOwn);
    if (n.lane >= nlHere) n.lane = nlHere - 1; // road narrowed under us: squeeze in
    let want = -1;
    let urgent = false;
    if (n.lane >= nl) { want = nl - 1; urgent = true; }
    else if (World.laneBlocked(L, n.lane, n.y, n.y + 45)) {
      urgent = true;
      let best = -1;
      let bestGap = -1;
      for (const c of [n.lane - 1, n.lane + 1]) {
        if (c < 0 || c >= nl || World.laneBlocked(L, c, n.y, n.y + 45)) continue;
        findLeader(n, World.laneCenter(c), n.w / 2 + 0.1, 1, false, 60);
        if (LEAD.gap > bestGap) { bestGap = LEAD.gap; best = c; }
      }
      if (best < 0) {
        // Both neighbours close too: step towards the nearest open lane through
        // the neighbour, while we can still physically be in it.
        let open = -1;
        for (let d = 2; d < nl && open < 0; d++) {
          for (const c of [n.lane - d, n.lane + d]) {
            if (c >= 0 && c < nl && !World.laneBlocked(L, c, n.y, n.y + 45)) { open = c; break; }
          }
        }
        const via = open < 0 ? -1 : n.lane + Math.sign(open - n.lane);
        if (via >= 0 && !World.laneBlocked(L, via, n.y - n.l / 2, n.y + n.l / 2 + 0.5)) best = via;
      }
      want = best;
    } else if (n.kind === 'bus' && n.lane > 0 && nextBusStop(L, n)) {
      want = n.lane - 1;
    } else if (n.blocked > (n.kind === 'auto' ? 0.5 : T.BLOCKED_BEFORE_LANE_CHANGE) && Math.abs(n.x - n.tx) < 0.05) {
      findLeader(n, World.laneCenter(n.lane), n.w / 2 + 0.1, 1, false, 60);
      let bestGap = LEAD.gap + 6;
      for (const c of [n.lane - 1, n.lane + 1]) {
        if (c < 0 || c >= nl || World.laneBlocked(L, c, n.y, n.y + 45)) continue;
        findLeader(n, World.laneCenter(c), n.w / 2 + 0.1, 1, false, 60);
        if (LEAD.gap > bestGap) { bestGap = LEAD.gap; want = c; }
      }
    }
    n.mergeX = NO_MERGE;
    if (want >= 0 && want !== n.lane && n.lcCool <= 0) {
      if (laneGapOk(n, World.laneCenter(want), urgent)) {
        n.lane = want;
        n.lcCool = 1.5;
        n.blocked = 0;
        n.hold = 0;
        const f = followerIn(n, World.laneCenter(want));
        if (f && Rng.chance(st, 0.5)) argue(st, f, n, 'cutIn', null);
      } else if (urgent) n.mergeX = World.laneCenter(want); // zipper: followers there will open a gap
    }
    const cx = World.laneCenter(n.lane);
    const hiX = (s.xs.divided ? s.xs.ownR : s.xs.roadR) - n.w / 2 - 0.15;
    if (n.hold <= 0) passObstacle(n, cx, n.w / 2 + 0.15, hiX, s.lanesOwn === 1 ? 2.8 : 1.8);
    let off = 0;
    if (n.kind === 'bus' && n.lane === 0 && nextBusStop(L, n)) off = -0.5;
    if (n.pickup) {
      if (n.lane > 0 && n.lcCool <= 0 && laneGapOk(n, World.laneCenter(n.lane - 1), true)) { n.lane--; n.lcCool = 1.5; }
      else if (n.lane === 0) { const pd = pedById(st, n.pickup); if (pd && pd.y - n.y < 15) off = -0.5; } // edge to the kerb only at the end
    }
    if (n.cab && n.stop > 0 && n.lane === 0) off = -0.6;
    if (n.hold > 0) off = n.holdOff;
    n.tx = clamp(cx + off, n.w / 2 + 0.15, n.hold > 0 ? hiX : s.xs.ownR - n.w / 2 - 0.15);
    if (n.kind === 'tanker' && n.hold <= 0) tankerSway(st, n, n.w / 2 + 0.15, hiX);
    return V;
  }

  /** Water tankers wander across their lane, and do not stop wandering because you are beside them. */
  function tankerSway(st, n, lo, hi) {
    const nx = clamp(n.tx + T.TANKER_SWAY * Math.sin((st.tick * DT * 2 * Math.PI) / T.TANKER_SWAY_PERIOD + n.id), lo, hi);
    if (sweepClear(n, nx, 0.05, 0.8, true)) n.tx = nx;
  }

  /**
   * Edge sideways around a small, slow or stopped obstacle ahead (pedestrian,
   * cow, crawling bike, a vehicle stopped for a passenger) if the shifted
   * corridor is clear of anything coming the other way. Sets n.hold/n.holdOff
   * so the offset persists until the obstacle has been passed.
   */
  function passObstacle(n, base, lo, hi, maxShift) {
    const ob = findLeader(n, base, n.w / 2 + 0.1, n.dir, n.dir < 0, 16);
    if (!ob) return;
    const along = ob.vy * n.dir;
    const slow = ob.kind === K_PED || ob.kind === K_COW || (ob.kind === K_PLAYER && Math.abs(ob.vy) < 1) ||
      (ob.kind === K_VEH && (ob.w < 1 ? along < 2 : (ob.ref.stop > 0 || ob.ref.kind === 'cart') && along < 1.5));
    if (!slow) return;
    const shiftR = ob.x + ob.w / 2 + 0.3 - (base - n.w / 2);
    const shiftL = base + n.w / 2 - (ob.x - ob.w / 2 - 0.3);
    const first = shiftR <= shiftL ? shiftR : -shiftL;
    const second = shiftR <= shiftL ? -shiftL : shiftR;
    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? first : second;
      if (Math.abs(off) > maxShift) continue;
      const nx = base + off;
      if (nx < lo || nx > hi || !sweepClear(n, nx, 0.1)) continue;
      const lead = findLeader(n, nx, n.w / 2 + 0.1, n.dir, n.dir < 0, 30);
      if (lead && lead.vy * n.dir < -0.5) continue; // traffic coming the other way
      n.holdOff = off;
      n.hold = 0.6 + (ob.l + n.l + 2) / Math.max(2, n.v);
      return;
    }
  }

  /**
   * Room behind in corridor c. A player closing fast gets a speed-scaled gap
   * (no unfair cut-ins); NPCs just need a metre, since they brake for us.
   */
  function backClear(n, c, hw) {
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (o.ref === n || o.y >= n.y) continue;
      if (Math.abs(o.x - c) >= hw + o.w / 2) continue;
      if (Math.abs(o.x - n.x) < (o.w + n.w) / 2) continue; // our own follower, in line behind us
      const along = n.y - o.y - (n.l + o.l) / 2;
      const need = o.kind === K_PLAYER ? 1 + 0.6 * Math.max(0, o.vy - n.v) : 1;
      if (along < need) return false;
    }
    return true;
  }

  function bikeLateral(st, L, n, s) {
    const lo = 0.55;
    const hi = s.xs.ownR - 0.55;
    n.plan -= DT;
    if (n.hold > 0) { n.tx = clamp(n.tx, lo, hi); return; }
    let replan = n.plan <= 0;
    if (!replan) {
      const lead = findLeader(n, n.x, 0.5, 1, false, 14);
      if (lead && LEAD.gap < 5 + n.v * 0.4 && LEAD.vy < n.v - 0.5) replan = true;
      else if (visiblePotholeAhead(st, n.x, n.y, 12, 0.4)) replan = true;
    }
    if (replan) {
      n.plan = n.trait && n.trait !== 'bapido' ? 0.2 + Rng.next(st) * 0.2 : 0.4 + Rng.next(st) * 0.4;
      // 1. Pick the line with the most room ahead: current x, +/- 0.35, every
      //    lane centre and lane line, and hugging the kerb.
      let goal = n.x;
      let goalScore = -1e9;
      const lanes = s.lanesOwn;
      for (let k = -3; k <= lanes * 2 + 1; k++) {
        let c;
        if (k === -3) c = n.x;
        else if (k === -2) c = n.x - 0.35;
        else if (k === -1) c = n.x + 0.35;
        else if (k === lanes * 2 + 1) c = lo;
        else c = (k * LW) / 2;
        c = clamp(c, lo, hi);
        const lead = findLeader(n, c, 0.5, 1, false, 45);
        let g = lead ? LEAD.gap + Math.max(0, LEAD.vy) * 2 : 50;
        if (visiblePotholeAhead(st, c, n.y, 14, 0.4)) g -= 15;
        if (World.barricadeAt(L, c, n.y + 3, 0.6) || World.barricadeAt(L, c, n.y + 12, 0.6) || World.barricadeAt(L, c, n.y + 22, 0.6)) g -= 30;
        const score = g - 0.35 * Math.abs(c - n.x) + (c === n.x ? 1.5 : 0) + Rng.next(st) * 2;
        if (score > goalScore) { goalScore = score; goal = c; }
      }
      // 2. Creep towards it as far as the sideways sweep allows right now.
      let tx = n.x;
      const d = goal - n.x;
      for (let k = 1; k <= 40 && tx !== goal; k++) {
        const c = Math.abs(d) <= k * 0.3 ? goal : n.x + Math.sign(d) * k * 0.3;
        if (!sweepClear(n, c, 0.1, 0.3) || !backClear(n, c, 0.5)) break;
        tx = c;
      }
      n.tx = tx;
      // Walled in (barricade, stopped vehicle) and cannot move yet: nose in, so
      // traffic in the line we want lets us in.
      n.mergeX = NO_MERGE;
      if (tx === n.x && goal !== n.x && n.v < 0.5 && n.blocked > 1) n.mergeX = n.x + Math.sign(d) * 0.9;
    }
    n.tx = clamp(n.tx, lo, hi);
  }

  function oncomingLateral(st, L, n, s) {
    const nl = s.xs.oncLanes;
    if (nl <= 0) { n.tx = n.x; return; }
    if (n.lane >= nl) n.lane = nl - 1;
    const base = World.oncCenter(s, n.lane) + n.off;
    const lo = s.xs.oncL + n.w / 2 + 0.15;
    const hi = s.xs.oncL + nl * LW - n.w / 2 - 0.15;
    if (n.hold <= 0) passObstacle(n, base, s.xs.divided ? lo : lo - 1.5, hi, 2.8);
    n.tx = clamp(base + (n.hold > 0 ? n.holdOff : 0), s.xs.divided ? lo : lo - 1.5, hi);
    if (n.kind === 'tanker' && n.hold <= 0) tankerSway(st, n, s.xs.divided ? lo : lo - 0.6, hi);
  }

  function wrongSideLateral(st, L, n, s) {
    const lo = s.xs.wallL + 0.5;
    const hi = s.xs.ownR - 0.5;
    if (n.blocked > 0.4) {
      // Squeeze towards the kerb; pinned against the wall, go around instead.
      n.off = n.x - 0.9 >= lo ? n.x - 0.9 : Math.min(hi, n.x + 1.4);
      n.blocked = 0;
    }
    n.tx = clamp(n.off, lo, hi);
  }

  function updateVehicle(st, L, n, p, ev) {
    const s = World.segmentAt(L, n.y);
    if (n.lcCool > 0) n.lcCool -= DT;
    if (n.hold > 0) n.hold -= DT;
    if (n.honk > 0) n.honk -= DT;
    if (n.stop > 0) {
      n.stop -= DT;
      if (n.stop <= 0) { n.stop = 0; n.stopHard = false; }
    }
    const near = Math.abs(n.y - p.y) < 60;

    // Random stops (§6.1)
    if (n.dir > 0 && !n.ws && n.stop <= 0 && near) {
      if (n.kind === 'auto' && Rng.chance(st, P_AUTO_STOP)) { n.stop = Rng.range(st, 2.5, 5); n.stopHard = true; }
      else if (n.kind === 'car' && n.cab && n.lane === 0 && Rng.chance(st, P_CAB_STOP)) n.stop = 4;
      else if (n.kind === 'bus' && Rng.chance(st, P_BUS_STOP)) n.stop = 4;
    }

    let latV;
    if (n.ws) { wrongSideLateral(st, L, n, s); latV = 2.5; }
    else if (n.dir < 0) { oncomingLateral(st, L, n, s); latV = 2.2; }
    else if (n.kind === 'bike') { bikeLateral(st, L, n, s); latV = Math.min(LW / VEHICLES.bike.lcTime, Math.max(1.5, Math.abs(n.tx - n.x) / 0.5)); }
    else { laneLateral(st, L, n, s); latV = LW / VEHICLES[n.kind].lcTime; }

    // Longitudinal: car-following with target gap 2 m + 0.8 s x speed (§6.2)
    let vCap = n.vDes;
    if (n.dir > 0 && !n.ws && s.jam) vCap = Math.min(vCap, World.jamCap(n.y, st.tick * DT) + (n.kind === 'bike' ? T.JAM_BIKE_BONUS : 0));
    if (breakerAhead(L, n.y, n.dir, n.l)) vCap = Math.min(vCap, T.BREAKER_NPC_SPEED);
    if (n.kind === 'bus' && n.dir > 0 && n.lane === 0 && n.stop <= 0) {
      const bs = nextBusStop(L, n);
      if (bs) {
        const d = bs.y - (n.y + n.l / 2);
        if (d <= 0.5) { n.stop = T.BUS_STOP_TIME; n.busDone = bs.y; }
        else vCap = Math.min(vCap, Math.sqrt(2 * 2.5 * d));
      }
    }
    if (n.kind === 'auto' && n.dir > 0 && !n.ws) vCap = Math.min(vCap, autoPickup(st, n, ev));
    if (n.kind === 'bus' && n.stop > 0 && n.busDone >= 0) busBoarding(st, n, ev);
    if (n.stop > 0) vCap = 0;
    const lead = findLeader(n, n.x, n.w / 2 + 0.1, n.dir, n.dir < 0, 60);
    if (n.argueT > 0) n.argueT -= DT;
    // A wrong-side rider nose to nose with a driver: words are exchanged.
    if (n.ws && lead && lead.kind === K_VEH && lead.ref.dir > 0 && LEAD.gap < 4 && n.v < 2) argue(st, lead.ref, n, 'wrongSide', ev);
    let vT = vCap;
    if (lead) vT = n.trait === 'racer' ? Math.min(vCap, Math.max(0, (LEAD.gap - 1.2) / 0.45)) : Math.min(vCap, Math.max(0, (LEAD.gap - T.FOLLOW_GAP) / T.FOLLOW_HEADWAY));
    const decel = n.stopHard ? T.NPC_STOP_DEAD_DECEL : T.NPC_DECEL;
    let a = (vT - n.v) * 3;
    if (a > T.NPC_ACCEL) a = T.NPC_ACCEL;
    else if (a < -decel) a = -decel;
    n.v = Math.max(0, n.v + a * DT);

    if (lead && vT < vCap - 1 && LEAD.gap < 14) {
      n.blocked += DT;
      n.byPlayer = lead.kind === K_PLAYER ? n.byPlayer + DT : 0;
    } else {
      n.blocked = 0;
      n.byPlayer = 0;
    }
    // Gridlock valve: nose to nose with opposite traffic (or a stopped scooter coming
    // the other way: there is no reverse gear) for too long, or stuck behind anything
    // but the player for much longer, and it ducks into a side gate or driveway.
    // In real gullies someone reverses.
    const faceOff = lead && ((lead.kind === K_VEH && lead.ref.dir !== n.dir) || (lead.kind === K_PLAYER && n.dir < 0));
    if (!n.ws && ((faceOff && n.blocked > T.GRIDLOCK_TIME) || (n.blocked > T.GRIDLOCK_TIME * 2.5 && !(lead && lead.kind === K_PLAYER)))) {
      n.gone = 1;
      ev.push({ type: 'npcTurnOff', id: n.id, x: n.x, y: n.y, kind: n.kind });
    }
    if (n.byPlayer > 1.5 && n.honk <= 0) {
      n.honk = 3;
      ev.push({ type: 'honkNpc', id: n.id, x: n.x, y: n.y, kind: n.kind, atPlayer: true });
    }
    if (near && n.honk <= 0 && !n.parked) {
      if (n.trait === 'honker' && Math.abs(n.y - p.y) < 35) { // leans on the horn, faster when we are in the way
        n.honk = Rng.range(st, T.HONKER_EVERY_MIN, T.HONKER_EVERY_MAX) * (n.byPlayer > 0.3 ? 0.6 : 1);
        ev.push({ type: 'honkNpc', id: n.id, x: n.x, y: n.y, kind: n.kind, atPlayer: !!lead && lead.kind === K_PLAYER, trait: 'honker' });
      } else if (lead && lead.kind === K_VEH && lead.ref.trait === 'slow' && n.blocked > 1.5) { // stuck behind a learner
        n.honk = Rng.range(st, 2, 4);
        ev.push({ type: 'honkNpc', id: n.id, x: n.x, y: n.y, kind: n.kind, atPlayer: false });
      }
    }

    // NPCs never drive into whatever is ahead of them.
    let move = n.v * DT;
    if (lead) {
      const room = LEAD.gap + Math.max(0, LEAD.vy) * DT - 0.05;
      if (move > room) {
        move = Math.max(0, room);
        n.v = Math.min(n.v, Math.max(0, LEAD.vy));
      }
    }
    const prevY = n.y;
    n.y += n.dir * move;
    if (L.junctions.length) junctionTurnOff(L, n, prevY);
    if (n.kind === 'bike' && n.trait && n.trait !== 'bapido' && !n.passed && (prevY - p.y) * (n.y - p.y) <= 0 && Math.abs(n.x - p.x) < 2.5) {
      n.passed = 1;
      ev.push({ type: 'bikePass', id: n.id, trait: n.trait, x: n.x, y: n.y, dir: n.dir });
    }
    // Auto drivers and Bapido bike taxis: not friends.
    if (n.kind === 'auto' && near && n.argueT <= 0) {
      for (let i = 0; i < obN; i++) {
        const o = OB[i];
        if (o.kind !== K_VEH || o.ref.trait !== 'bapido' || Math.abs(o.y - n.y) > T.RANT_RANGE || Math.abs(o.x - n.x) > 3) continue;
        n.argueT = T.RANT_COOLDOWN;
        ev.push({ type: 'autoRant', id: n.id, at: o.ref.id, x: n.x, y: n.y });
        break;
      }
    }

    const dx = n.tx - n.x;
    const stp = latV * DT;
    const ox = n.x;
    n.x = Math.abs(dx) <= stp ? n.tx : n.x + Math.sign(dx) * stp;
    n.vx = (n.x - ox) / DT;

    // Wrong-side telegraph (§6.6): fire 2 s before the rider would enter the view.
    if (n.ws && !n.warned) {
      const beyond = n.y - n.l / 2 - (p.y + T.VIEW_AHEAD);
      const closing = n.v + p.v;
      if (beyond <= 0 || beyond <= closing * T.TELEGRAPH_TIME) {
        n.warned = true;
        ev.push({ type: 'wrongSide', id: n.id, x: n.x, y: n.y });
      }
    }

    if (!near) return;
    // Puddles: splash pedestrians and the player (§7.2)
    const q = puddleAt(st, n.x, n.y + n.dir * n.l * 0.3);
    if (q) {
      if (n.pud !== q.id) {
        n.pud = q.id;
        if (n.v > T.SPLASH_MIN_SPEED) {
          ev.push({ type: 'splash', x: n.x, y: q.y, by: n.id, size: Math.min(1, (q.rx + q.ry) / 3) });
          splashPeds(st, n.x, n.w, q, null, ev);
          if ((n.kind === 'bus' || n.kind === 'tanker' || n.kind === 'car') &&
              Math.abs(n.x - p.x) < n.w / 2 + T.SCREEN_SPLASH_DIST &&
              Math.abs(q.y - p.y) < n.l / 2 + T.SCREEN_SPLASH_DIST &&
              Math.abs(n.dir * n.v - p.v) > T.SCREEN_SPLASH_REL_SPEED) {
            ev.push({ type: 'screenSplash', by: n.id });
          }
        }
      }
    } else n.pud = 0;
    // Tankers leak (§6.1)
    if (n.kind === 'tanker') {
      n.leak += move;
      if (n.leak > T.TANKER_LEAK_EVERY_M) {
        n.leak = 0;
        if (Rng.chance(st, 0.55)) {
          addPuddle(st, n.x + Rng.range(st, -0.4, 0.4), n.y - n.dir * (n.l / 2 + 0.7), Rng.range(st, 0.4, 0.8), Rng.range(st, 0.5, 1.0), true);
        }
      }
    }
  }

  /** An auto with no passenger pulls over for a pedestrian hailing it. Returns a speed cap. */
  function autoPickup(st, n, ev) {
    if (n.fare) return n.vDes;
    let pd = n.pickup ? pedById(st, n.pickup) : null;
    if (n.pickup && (!pd || pd.mode !== 'hail' || pd.y < n.y - 3)) { if (pd && pd.mode === 'hail') pd.mode = 'walk'; n.pickup = 0; pd = null; }
    if (!n.pickup) {
      for (const c of st.peds) {
        const d = c.y - n.y;
        if (c.mode === 'hail' && !c.thanked && c.side === 0 && d > 6 && d < 30) { n.pickup = c.id; c.thanked = 2; pd = c; break; }
      }
      if (!pd) return n.vDes;
    }
    const d = pd.y - n.y;
    if (n.blocked > 4) { // stuck behind something: give up this fare; they go back to waving
      pd.thanked = 0;
      n.pickup = 0;
      return n.vDes;
    }
    // Alongside, or stopped just behind them (in a gully they stand in the lane): they walk over and get in.
    if (((Math.abs(d) < 1.2 && Math.abs(n.x - n.tx) < 0.2) || (d > 0 && d < 4.5)) && n.v < 0.6) {
      pd.mode = 'gone';
      n.fare = 1;
      n.pickup = 0;
      n.stop = 2;
      ev.push({ type: 'pickup', id: n.id, pedId: pd.id, x: n.x, y: n.y });
      return 0;
    }
    return Math.sqrt(2 * 2.5 * Math.max(0, d - 0.3));
  }

  /** A bus stopped at a bus stop takes on the people waiting there, one at a time. */
  function busBoarding(st, n, ev) {
    n.boardT -= DT;
    if (n.boardT > 0) return;
    n.boardT = 0.7;
    for (const pd of st.peds) {
      if (pd.mode !== 'wait' || pd.side !== 0 || Math.abs(pd.y - n.busDone) > 7) continue;
      pd.mode = 'gone';
      n.stop = Math.max(n.stop, 0.8);
      ev.push({ type: 'board', id: n.id, pedId: pd.id, x: pd.x, y: pd.y });
      return;
    }
  }

  /** Two road users trade words (a = the aggrieved, b = the cause). */
  function argue(st, a, b, kind, ev) {
    if (a.argueT > 0 || b.argueT > 0) return;
    a.argueT = b.argueT = T.ARGUE_COOLDOWN;
    const out = ev || PENDING;
    if (a.kind !== 'cow') { a.honk = Math.max(a.honk || 0, 1); out.push({ type: 'honkNpc', id: a.id, x: a.x, y: a.y, kind: a.kind, atPlayer: false }); }
    out.push({ type: 'npcArgue', a: a.id, b: b.id, kind, x: b.x, y: b.y });
  }

  /** Crossing a junction boundary into a road where this vehicle's lane does not exist: it turns off. */
  function junctionTurnOff(L, n, prevY) {
    for (const jy of L.junctions) {
      if (n.dir > 0 && prevY < jy && n.y >= jy) {
        const sN = World.segmentAt(L, jy + 0.01);
        if (n.ws ? false : n.kind === 'bike' ? n.x > sN.xs.ownR - 0.4 : n.lane >= sN.lanesOwn) n.gone = 1;
      } else if (n.dir < 0 && prevY >= jy && n.y < jy) {
        const sA = World.segmentAt(L, jy + 0.01);
        const sB = World.segmentAt(L, jy - 0.01);
        if (n.ws) { if (n.x > sB.xs.ownR - 0.4) n.gone = 1; }
        else if (Math.abs(sA.xs.oncL - sB.xs.oncL) > T.MEDIAN_W + 1e-9 || n.lane >= sB.xs.oncLanes) n.gone = 1;
      }
    }
  }

  function updateCow(st, L, n) {
    n.modeT -= DT;
    // Cows never yield, but a scooter waiting right next to one for a while bores it into wandering off.
    const p = st.players[0];
    if (n.mode !== 'amble' && p.v < 0.5 && Math.hypot(n.x - p.x, n.y - p.y) < 3.2) {
      n.boredT += DT;
      if (n.boredT > 2.5) {
        n.boredT = 0;
        n.mode = 'amble';
        n.modeT = 6;
        n.h = Math.atan2(n.x - p.x, Math.max(0.5, n.y - p.y)); // away from us, onwards
        n.v = 0.45;
        cowBox(n);
      }
    } else n.boredT = 0;
    if (n.modeT <= 0) {
      const r = Rng.next(st);
      n.mode = r < 0.4 ? 'amble' : r < 0.7 ? 'stand' : 'sit';
      n.modeT = Rng.range(st, 4, 12);
      if (n.mode === 'amble') {
        n.h += Rng.range(st, -0.8, 0.8);
        n.v = Rng.range(st, 0.2, VEHICLES.cow.vMax);
      } else n.v = 0;
      cowBox(n);
    }
    if (n.v > 0) {
      const s = World.segmentAt(L, n.y);
      n.x += Math.sin(n.h) * n.v * DT;
      n.y += Math.cos(n.h) * n.v * DT;
      const lo = s.xs.wallL + 0.7;
      const hi = s.xs.limitR - 0.7;
      if (n.x < lo || n.x > hi) {
        n.x = clamp(n.x, lo, hi);
        n.h = -n.h;
        cowBox(n);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pedestrians (§7.3)
  // ---------------------------------------------------------------------------

  function crossBlocked(pd) {
    const x0 = Math.min(pd.x, pd.x + pd.cdir) - 0.3;
    const x1 = Math.max(pd.x, pd.x + pd.cdir) + 0.3;
    for (let i = 0; i < obN; i++) {
      const o = OB[i];
      if (o.kind !== K_VEH && o.kind !== K_PLAYER) continue;
      if (Math.abs(o.vy) < 1) continue; // stopped vehicles do not scare anyone
      const rel = (pd.y - o.y) * Math.sign(o.vy); // > 0: pedestrian is ahead of the vehicle
      if (rel < -o.l / 2 || rel > T.PED_CROSS_PAUSE_DIST + o.l / 2) continue;
      if (o.x + o.w / 2 < x0 || o.x - o.w / 2 > x1) continue;
      return true;
    }
    return false;
  }

  function startCross(pd, s) {
    const xs = s.xs;
    if (pd.side === 0) {
      pd.cdir = 1;
      if (xs.divided) { pd.cx = xs.ownR + T.MEDIAN_W / 2; pd.cmedian = true; }
      else { const b = World.pedBand(s, 1); pd.cx = (b[0] + b[1]) / 2; pd.cmedian = false; }
    } else {
      if (xs.divided) return;
      pd.cdir = -1;
      const b = World.pedBand(s, 0);
      pd.cx = (b[0] + b[1]) / 2;
      pd.cmedian = false;
    }
    pd.mode = 'cross';
  }

  function settleBand(pd, s) {
    const b = World.pedBand(s, pd.side);
    pd.u = clamp((pd.x - b[0]) / Math.max(0.01, b[1] - b[0]), 0, 1);
  }

  function updatePed(st, L, pd, p, ev) {
    if (pd.splash > 0) { pd.splash -= DT; pd.vx = pd.vy = 0; return; }
    if (pd.mode === 'stumble') {
      pd.t -= DT;
      pd.vx = pd.vy = 0;
      if (pd.t <= 0) pd.mode = pd.cdir ? 'cross' : 'walk';
      return;
    }
    const s = World.segmentAt(L, pd.y);
    if (pd.dodge > 0) {
      pd.dodge -= DT;
      pd.x = clamp(pd.x + pd.dodgeV * DT, s.xs.wallL + 0.3, s.xs.wallR - 0.3);
      pd.vx = pd.dodgeV;
      pd.vy = 0;
      if (pd.dodge <= 0 && pd.mode === 'walk') settleBand(pd, s);
      return;
    }
    // Standing about (waiting, chatting, hailing) right in front of a stopped scooter: step aside.
    if ((pd.mode === 'wait' || pd.mode === 'chat' || pd.mode === 'hail') && p.v < 0.5 && p.crash <= 0) {
      const ahead = pd.y - p.y;
      if (ahead > -0.2 && ahead < T.PLAYER_L / 2 + 2.5 && Math.abs(pd.x - p.x) < T.PLAYER_W / 2 + PED.w / 2 + 0.45) {
        const sA = World.segmentAt(L, pd.y);
        let dir = pd.side === 0 ? -1 : 1; // towards their own edge...
        if ((p.x - pd.x) * dir > 0) dir = -dir; // ...unless the scooter is on that side
        if (pd.x + dir * 0.6 < sA.xs.wallL + 0.3 || pd.x + dir * 0.6 > sA.xs.wallR - 0.3) dir = -dir; // or the wall is
        pd.dodge = 0.6;
        pd.dodgeV = dir * 1.2;
        return;
      }
    }
    if (pd.mode === 'wait' || pd.mode === 'gone') { pd.vx = pd.vy = 0; return; }
    if (pd.mode === 'hail' || pd.mode === 'chat') {
      pd.vx = pd.vy = 0;
      // The auto that stopped for us turned off or drove away: go back to waving (and give up in time).
      if (pd.thanked === 2 && !st.npcs.some((n) => n.pickup === pd.id)) pd.thanked = 0;
      if (pd.mode === 'chat' || pd.thanked !== 2) pd.t -= DT; // hailing: wait for the auto that stopped for us
      if (pd.t <= 0) { pd.mode = 'walk'; pd.thanked = pd.thanked === 2 ? 0 : pd.thanked; }
      return;
    }
    if (pd.mode === 'cross') {
      pd.vy = 0;
      if (crossBlocked(pd)) { pd.vx = 0; return; }
      // A scooter stopped across our path: walk round its nose or tail instead of into it.
      const nx = pd.x + pd.cdir * 0.6;
      if (p.v < T.PED_SAFE_SPEED && Math.abs(p.x - nx) < T.PLAYER_W / 2 + PED.w / 2 + 0.1 && Math.abs(p.y - pd.y) < T.PLAYER_L / 2 + PED.l / 2 + 0.15) {
        pd.vx = 0;
        pd.vy = (pd.y >= p.y ? 1 : -1) * 0.9;
        pd.y += pd.vy * DT;
        return;
      }
      pd.vx = pd.cdir * T.PED_CROSS_SPEED;
      pd.x += pd.vx * DT;
      if ((pd.cdir > 0 && pd.x >= pd.cx) || (pd.cdir < 0 && pd.x <= pd.cx)) {
        pd.x = pd.cx;
        if (pd.cmedian) pd.mode = 'wait';
        else {
          pd.side = pd.cdir > 0 ? 1 : 0;
          pd.mode = 'walk';
          settleBand(pd, s);
        }
        pd.cdir = 0;
        pd.vx = 0;
      }
      return;
    }
    // walking along the edge; a stopped scooter in the way: step round it (pause until clear of it)
    const CLEAR = (T.PLAYER_W + PED.w) / 2 + 0.15;
    const meAhead = p.v < T.PED_SAFE_SPEED && Math.abs(p.y - (pd.y + pd.dir * 0.9)) < T.PLAYER_L / 2 + 0.5 && Math.abs(p.x - pd.x) < CLEAR + 0.3;
    if (!meAhead || Math.abs(p.x - pd.x) >= CLEAR) { pd.y += pd.dir * pd.v * DT; pd.blockT = 0; }
    else if ((pd.blockT += DT) > 1.5) { pd.dir = -pd.dir; pd.blockT = 0; } // cannot get round: turn back
    const b = World.pedBand(s, pd.side);
    let tx = b[0] + pd.u * (b[1] - b[0]);
    if (meAhead) {
      let side = pd.x <= p.x ? -1 : 1;
      if (p.x + side * (CLEAR + 0.25) < s.xs.wallL + 0.3 || p.x + side * (CLEAR + 0.25) > s.xs.wallR - 0.3) side = -side;
      tx = p.x + side * (CLEAR + 0.25);
    }
    for (const k of st.stalls) { // round the chai stall, on the road side
      if (k.side !== pd.side || Math.abs(k.y - (pd.y + pd.dir * 0.8)) > k.l / 2 + 0.6) continue;
      if (k.side === 0) tx = Math.max(tx, k.x + k.w / 2 + 0.3);
      else tx = Math.min(tx, k.x - k.w / 2 - 0.3);
    }
    if (!(pd.side === 0 ? s.footpathL : s.footpathR)) {
      // no footpath: step out into the road around parked cars
      const ahead = pd.y + pd.dir * 0.8;
      for (const c of st.npcs) {
        if (!c.parked || Math.abs(c.y - ahead) > c.l / 2 + 0.8) continue;
        if (pd.side === 0 && c.x < s.xs.ownR / 2 + 0.5) tx = Math.max(tx, c.x + c.w / 2 + 0.35);
        else if (pd.side === 1 && c.x > s.xs.oncL) tx = Math.min(tx, c.x - c.w / 2 - 0.35);
      }
    }
    const dx = tx - pd.x;
    const stp = 0.8 * DT;
    const ox = pd.x;
    pd.x = Math.abs(dx) <= stp ? tx : pd.x + Math.sign(dx) * stp;
    pd.vx = (pd.x - ox) / DT;
    pd.vy = pd.dir * pd.v;
    const dy = pd.y - p.y;
    if (s.peds > 0 && dy > 14 && dy < 70 && Rng.chance(st, T.PED_CROSS_PER_S * DT * (busyAt(st, pd.y) ? T.BUSY_CROSS_MULT : 1))) startCross(pd, s);
    else if (pd.side === 0 && dy > 15 && dy < 80 && Rng.chance(st, T.HAIL_PER_S * DT)) { pd.mode = 'hail'; pd.t = T.HAIL_TIME; pd.thanked = 0; ev.push({ type: 'hail', pedId: pd.id, x: pd.x, y: pd.y }); }
  }

  /** Pedestrians walking towards each other on the same side sometimes stop for a chat. */
  function pedChats(st, p, ev) {
    const a = st.peds;
    for (let i = 0; i < a.length; i++) {
      const u = a[i];
      if (u.mode !== 'walk' || u.chatted || Math.abs(u.y - p.y) > 70) continue;
      for (let j = i + 1; j < a.length; j++) {
        const w = a[j];
        if (w.mode !== 'walk' || w.chatted || w.side !== u.side || w.dir === u.dir) continue;
        const ahead = (w.y - u.y) * u.dir;
        if (ahead <= 0 || ahead > 1.4 || Math.abs(w.x - u.x) > 1.0) continue;
        u.chatted = w.chatted = 1;
        if (!Rng.chance(st, T.CHAT_CHANCE)) continue;
        u.mode = w.mode = 'chat';
        u.t = w.t = Rng.range(st, T.CHAT_MIN, T.CHAT_MAX);
        u.chatWith = w.id;
        w.chatWith = u.id;
        ev.push({ type: 'chat', a: u.id, b: w.id, x: u.x, y: u.y });
        break;
      }
    }
  }

  function splashPeds(st, vx, vw, q, p, ev) {
    for (const pd of st.peds) {
      if (pd.splash > 0 || pd.mode === 'stumble') continue;
      if (Math.abs(pd.y - q.y) > q.ry + T.SPLASH_PED_ALONG) continue;
      if (Math.abs(pd.x - vx) > vw / 2 + T.SPLASH_PED_SIDE) continue;
      pd.splash = T.PED_SPLASH_STOP;
      ev.push({ type: 'pedSplashed', pedId: pd.id, byPlayer: !!p, x: pd.x, y: pd.y });
      if (p) {
        loseKarma(p, T.SPLASH_KARMA);
        p.stats.splashedPeds++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Player (§5, §7)
  // ---------------------------------------------------------------------------

  function hornEffects(st, L, p, ev) {
    // The honk is aimed at whoever is nearest ahead in our path. Honk at the same
    // one too often, or lean on the horn, and someone gives us a gaali.
    let angry = null;
    const target = hornTarget(st, p);
    if (target) {
      honkedAt(st, target);
      if (!target.gaali && target.honkN >= T.GAALI_HONKS) angry = target;
    }
    if (!angry && p.hornLog.length > T.GAALI_SPAM) { // leaning on the horn: whoever is nearest answers
      let best = T.GAALI_RANGE;
      for (const pd of st.peds) {
        const d = Math.hypot(pd.x - p.x, pd.y - p.y);
        if (!pd.gaali && pd.mode !== 'gone' && d < best) { best = d; angry = pd; }
      }
      for (const n of st.npcs) {
        if (n.parked || n.kind === 'cow' || n.kind === 'cart' || n.gaali) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < best) { best = d; angry = n; }
      }
    }
    if (angry && p.gaaliT <= 0) {
      angry.gaali = 1;
      const isPed = angry.kind == null;
      gaali(st, p, isPed ? 'ped' : angry.kind, angry.id, angry.x, angry.y, ev);
      if (!isPed && angry.honk <= 0) { angry.honk = 2; ev.push({ type: 'honkNpc', id: angry.id, x: angry.x, y: angry.y, kind: angry.kind, atPlayer: true, angry: true }); }
    }
    for (const pd of st.peds) {
      const dy = pd.y - p.y;
      if (dy < 0 || dy > T.HORN_PED_RANGE || Math.abs(pd.x - p.x) > T.HORN_PED_SIDE) continue;
      if (pd.mode === 'stumble' || pd.dodge > 0) continue;
      const s = World.segmentAt(L, pd.y);
      const mid = s.xs.roadR / 2;
      const d = pd.x < mid ? -1 : 1;
      pd.dodge = T.HORN_PED_TIME;
      pd.dodgeV = (d * T.HORN_PED_STEP) / T.HORN_PED_TIME;
      ev.push({ type: 'pedDodge', pedId: pd.id });
    }
    for (const n of st.npcs) {
      if (n.kind !== 'bike' && n.kind !== 'auto') continue;
      const dy = n.y - p.y;
      if (n.ws) {
        if (dy > 0 && dy < T.HORN_WS_RANGE && Math.abs(n.x - p.x) < 3 && Rng.chance(st, T.HORN_WS_CHANCE)) {
          const s = World.segmentAt(L, n.y);
          n.off = Math.max(s.xs.wallL + 0.5, n.x - 1.2);
          ev.push({ type: 'npcYield', id: n.id });
        }
        continue;
      }
      if (dy <= 0 || dy > T.HORN_NPC_RANGE) continue;
      if (Math.abs(n.x - p.x) >= (n.w + T.PLAYER_W) / 2 + 0.3) continue;
      if (!Rng.chance(st, T.HORN_NPC_CHANCE)) continue;
      const s = World.segmentAt(L, n.y);
      const lo = n.dir > 0 ? n.w / 2 + 0.15 : s.xs.oncL + n.w / 2 + 0.15;
      const hi = n.dir > 0 ? s.xs.ownR - n.w / 2 - 0.15 : s.xs.oncL + s.xs.oncLanes * LW - n.w / 2 - 0.15;
      const first = n.x >= p.x ? 1 : -1;
      for (let k = 0; k < 2; k++) {
        const d = k === 0 ? first : -first;
        const nx = n.x + d * T.HORN_NPC_SHIFT;
        if (nx < lo || nx > hi || !sweepClear(n, nx, 0.1)) continue;
        if (n.dir > 0 && n.kind === 'bike') { n.tx = nx; n.hold = 2; }
        else if (n.dir > 0) { n.holdOff = nx - World.laneCenter(n.lane); n.hold = 2.5; }
        else { n.holdOff = nx - (World.oncCenter(s, n.lane) + n.off); n.hold = 2.5; }
        ev.push({ type: 'npcYield', id: n.id });
        break;
      }
    }
  }

  function crash(st, p, withKind, other, ev) {
    damage(p, T.CRASH_COST[withKind] * (1 - T.SKILL_DAMAGE * p.skill));
    p.goods = Math.max(0, p.goods - T.GOODS_CRASH);
    p.dropT = 0;
    loseKarma(p, T.CRASH_KARMA[withKind] || 0);
    p.stats.crashes++;
    p.crash = T.CRASH_TIME;
    p.crashWith = withKind;
    p.v = 0;
    p.wobble = 0;
    p.calmT = 0;
    if (other && withKind === 'ped') { other.mode = 'stumble'; other.t = T.FIGHT_TIME; other.dodge = 0; }
    else if (other && withKind === 'dog') { other.mode = 'return'; other.woke = 1; } // yelps and runs home
    else if (other && withKind !== 'cow' && withKind !== 'stall') { other.stop = Math.max(other.stop || 0, 1.2); other.v *= 0.3; }
    if (withKind === 'slip') p.stats.slips++;
    ev.push({ type: 'crash', with: withKind, x: p.x, y: p.y, id: other ? other.id : 0, pid: p.id });
    // A clash with a person or a vehicle turns into an argument (docs/concepts/karma-and-luck.md).
    const party = withKind === 'ped' ? 'ped' : withKind === 'stall' ? 'vendor' : other && !other.parked && (withKind === 'vehicle' || withKind === 'headOn') ? other.kind : '';
    if (party && T.FIGHT_KARMA[party] != null) {
      p.fight = T.FIGHT_TIME;
      p.fightWith = party;
      p.fightId = other.id;
      p.fightSorry = 0;
      p.fightArgued = 0;
      p.fights++;
      if (party !== 'ped' && party !== 'vendor') other.stop = Math.max(other.stop, T.FIGHT_TIME);
      ev.push({ type: 'fight', phase: 'start', with: party, id: other.id, pid: p.id });
    }
  }

  /** During an argument: hold BRAKE to apologise, HORN to argue back. Returns true if the horn was used. */
  function fightTick(st, p, inp, ev) {
    p.fight -= DT;
    const party = p.fightWith;
    let used = false;
    if (inp.brake && !p.fightArgued) {
      p.fightSorry += DT;
      if (p.fightSorry >= T.APOLOGY_HOLD) {
        loseKarma(p, T.APOLOGY_KARMA);
        ev.push({ type: 'fight', phase: 'sorry', with: party, id: p.fightId, karma: T.APOLOGY_KARMA, pid: p.id });
        p.fight = 0;
        p.fightWith = '';
        return false;
      }
    }
    if (inp.horn && p.hornCd <= 0) {
      used = true;
      p.hornCd = Math.round(T.HORN_COOLDOWN / DT);
      p.stats.honks++;
      const cost = p.fightArgued ? T.ARGUE_MORE_KARMA : T.FIGHT_KARMA[party];
      p.fightArgued++;
      loseKarma(p, cost);
      p.fight = Math.min(p.fight + 1, 5);
      ev.push({ type: 'horn', x: p.x, y: p.y, costly: false, angry: true, pid: p.id });
      ev.push({ type: 'fight', phase: 'argue', with: party, id: p.fightId, karma: cost, pid: p.id });
    }
    if (p.fight <= 0) {
      p.fight = 0;
      if (!p.fightArgued) {
        const cost = T.FIGHT_KARMA[party] / 2;
        loseKarma(p, cost);
        ev.push({ type: 'fight', phase: 'shouted', with: party, id: p.fightId, karma: cost, pid: p.id });
      } else ev.push({ type: 'fight', phase: 'end', with: party, id: p.fightId, pid: p.id });
      p.fightWith = '';
    }
    return used;
  }

  // ---------------------------------------------------------------------------
  // Karma economy: good deeds, luck (docs/concepts/karma-and-luck.md)
  // ---------------------------------------------------------------------------
  function deed(st, p, kind, karma, id, ev) {
    gainKarma(p, karma);
    p.goodDeeds++;
    ev.push({ type: 'goodDeed', kind, karma, id, pid: p.id });
    if (kind !== 'calm' && kind !== 'breaker' && Rng.chance(st, T.DEED_GIFT_CHANCE)) luck(st, p, true, ev, kind);
  }

  function deedsTick(st, p, ev) {
    if (p.letInT > 0) p.letInT -= DT;
    if (p.crash > 0 || p.fight > 0) return;
    if (p.v < T.GIVE_WAY_SPEED) {
      for (const pd of st.peds) {
        if (pd.mode !== 'cross' || pd.thanked) continue;
        const dy = pd.y - p.y;
        if (dy < 0.5 || dy > 12 || Math.abs(pd.x - p.x) > 3.5) continue;
        pd.thanked = 1;
        deed(st, p, 'giveWay', T.GIVE_WAY_KARMA, pd.id, ev);
      }
      for (const n of st.npcs) {
        if (p.letInT > 0) break;
        if (n.kind === 'cow' || n.kind === 'bike' || n.thanked || n.mergeX === NO_MERGE || n.dir < 0) continue;
        const dy = n.y - p.y;
        if (dy < 0 || dy > 12 || Math.abs(n.mergeX - p.x) > 1.6) continue;
        n.thanked = 1;
        p.letInT = T.LET_IN_COOLDOWN;
        deed(st, p, 'letIn', T.LET_IN_KARMA, n.id, ev);
      }
    }
    if (p.calmT >= T.CALM_EVERY) {
      p.calmT = 0;
      deed(st, p, 'calm', T.CALM_KARMA, 0, ev);
    }
  }

  function luck(st, p, good, ev, source) {
    const kind = Rng.weighted(st, good ? T.LUCK_GOOD : T.LUCK_BAD);
    let amount = 0;
    switch (kind) {
      case 'tip': amount = 10 * Rng.int(st, 1, 5); p.money += amount; break;
      case 'water': p.steadyT = T.STEADY_TIME; break;
      case 'sweets': p.sugarT = T.SUGAR_TIME; break;
      case 'skill': amount = Rng.int(st, 15, 35); p.xpBonus += amount; break;
      case 'greenWave': amount = T.GREEN_WAVE_S; st.time -= amount; break;
      case 'puncture': p.punctureT = T.PUNCTURE_TIME; break;
      case 'fine': amount = Math.min(p.money, T.FINE_AMOUNT); p.money -= amount; p.haltT = T.FINE_HALT; break;
      case 'brakes': p.fadeT = T.FADE_TIME; break;
      case 'cancel': amount = Math.min(p.money, 20); p.money -= amount; break;
      case 'skillSlow': amount = Rng.int(st, 10, 25); p.xpBonus -= amount; break;
      default: break;
    }
    // Water and sweets near a street stall come from the stall: chai, momos, biryani.
    let vendor = '';
    if (good && (kind === 'water' || kind === 'sweets')) for (const k of st.stalls) if (Math.abs(k.y - p.y) < 25) { vendor = k.kind; break; }
    ev.push({ type: 'luck', good, kind, amount, source, vendor, pid: p.id });
  }

  function luckTick(st, p, ev) {
    p.luckT -= DT;
    if (p.luckT > 0) return;
    p.luckT = Rng.range(st, T.LUCK_EVERY_MIN, T.LUCK_EVERY_MAX);
    const pg = Math.max(0, (p.karma - 50) / 50) * T.LUCK_MAX_P;
    const pb = Math.max(0, (50 - p.karma) / 50) * T.LUCK_MAX_P;
    const r = Rng.next(st);
    if (r < pg) luck(st, p, true, ev, 'karma');
    else if (r < pg + pb) luck(st, p, false, ev, 'karma');
  }

  function isFree(st, L, x, y) {
    const hw = T.PLAYER_W / 2 + 0.3;
    const hl = T.PLAYER_L / 2 + 1.0;
    for (const n of st.npcs) {
      if (Math.abs(n.y - y) < hl + n.l / 2 && Math.abs(n.x - x) < hw + n.w / 2) return false;
    }
    for (const pd of st.peds) {
      if (Math.abs(pd.y - y) < hl + PED.l / 2 && Math.abs(pd.x - x) < hw + PED.w / 2) return false;
    }
    return !World.barricadeAt(L, x, y, hl);
  }

  function respawn(st, L, p) {
    const s = World.segmentAt(L, p.y);
    const lo = s.xs.limitL + 0.5;
    const hi = s.xs.limitR - 0.5;
    const x0 = clamp(p.x, lo, hi);
    for (let k = 0; k <= 80; k++) {
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        if (k === 0 && sgn > 0) continue;
        const x = x0 + sgn * k * 0.25;
        if (x < lo || x > hi) continue;
        if (isFree(st, L, x, p.y)) { p.x = x; return; }
      }
    }
    p.x = x0;
  }

  function updatePlayer(st, L, p, inp, ev) {
    if (p.hornCd > 0) p.hornCd--; // ticks (integer: no float drift)
    p.invuln = Math.max(0, p.invuln - DT);
    p.steer = clamp(+inp.steer || 0, -1, 1);
    if (p.steadyT > 0) p.steadyT = Math.max(0, p.steadyT - DT);
    if (p.sugarT > 0) p.sugarT = Math.max(0, p.sugarT - DT);
    if (p.punctureT > 0) p.punctureT = Math.max(0, p.punctureT - DT);
    if (p.fadeT > 0) p.fadeT = Math.max(0, p.fadeT - DT);
    if (p.gaaliT > 0) p.gaaliT = Math.max(0, p.gaaliT - DT);
    let horn = inp.horn;
    if (p.fight > 0 && fightTick(st, p, inp, ev)) horn = 0;
    else if (p.fight > 0) horn = 0;
    if (p.crash > 0) {
      p.crash -= DT;
      p.v = 0;
      if (p.crash <= 0) {
        p.crash = 0;
        respawn(st, L, p);
        p.invuln = T.INVULN_TIME;
        ev.push({ type: 'respawn', pid: p.id });
      }
      return;
    }
    if (p.handT > 0) { // handing over an order: a short scene at the gate or the door
      p.v = 0;
      const o = st.orders.find((q) => q.id === p.handId);
      if (horn && p.hornCd <= 0) { // honking inside the society: the guard (or the customer) is not amused
        p.hornCd = Math.round(T.HORN_COOLDOWN / DT);
        p.stats.honks++;
        ev.push({ type: 'horn', x: p.x, y: p.y, costly: false, pid: p.id });
        if (!p.handHonk) { p.handHonk = 1; gaali(st, p, o && o.kind === 'apartment' ? 'guard' : 'customer', 0, p.x - 1.5, p.y + 1, ev); }
      }
      p.handT -= DT;
      p.handStepT -= DT;
      const sc = o ? sceneOf(o.kind, p.handScene) : null;
      if (sc && p.handStepT <= 0 && p.handStep < sc.steps.length - 1) {
        p.handStep++;
        p.handStepT += sc.steps[p.handStep][1];
        handStepEvent(p, o, sc, ev);
      }
      if (p.handT <= 0) {
        p.handT = 0;
        if (o && o.status === 'pending') deliverOrder(st, p, o, ev);
      }
      return;
    }
    if (p.fight > 0 || p.haltT > 0) { // arguing, or stopped by the police
      p.haltT = Math.max(0, p.haltT - DT);
      p.v = 0;
      return;
    }
    const rain = st.weather === 'rain';
    const sk = p.skill;
    const maxV = T.MAX_SPEED * (p.sugarT > 0 ? T.SUGAR_SPEED : 1) * (p.punctureT > 0 ? T.PUNCTURE_SPEED : 1);
    const brake = T.BRAKE_DECEL * (rain ? T.RAIN_BRAKE_MULT : 1) * (1 + T.SKILL_BRAKE * sk) * (p.fadeT > 0 ? T.FADE_MULT : 1);
    if (inp.brake) p.v = Math.max(0, p.v - brake * DT);
    else if (p.wobble > 0) p.v = Math.max(0, p.v - T.COAST_DECEL * DT);
    else if (p.v > maxV) p.v = Math.max(maxV, p.v - 3 * DT);
    else p.v = Math.min(maxV, p.v + T.ACCEL * (p.sugarT > 0 ? 1.2 : 1) * DT);

    let lat = p.steer * Math.min(T.LAT_MAX, T.LAT_BASE + T.LAT_PER_SPEED * p.v) * (1 + T.SKILL_LAT * sk);
    if (p.wobble > 0) {
      p.wobble = Math.max(0, p.wobble - DT);
      if (p.steadyT <= 0) { // water: steady hands, no wobble
        lat *= T.WOBBLE_STEER_MULT;
        if (st.tick % 3 === 0) p.jitter = Rng.range(st, -1, 1) * T.WOBBLE_JITTER;
        lat += p.jitter;
      }
    } else p.jitter = 0;
    // Bends push the scooter to the outside of the curve; steer to hold your line.
    lat -= World.curveAt(L, p.y) * p.v * p.v * T.CURVE_DRIFT;

    const prevY = p.y;
    p.x += lat * DT;
    p.y += p.v * DT;
    if (p.v > 1 && !horn) p.calmT += DT;

    // Walls and the median; a narrowing road pushes rather than teleports.
    const s = World.segmentAt(L, p.y);
    const lo = s.xs.limitL + T.PLAYER_W / 2;
    const hi = s.xs.limitR - T.PLAYER_W / 2;
    const push = T.GEOMETRY_PUSH * DT;
    if (p.x < lo) p.x = Math.min(lo, p.x + push);
    else if (p.x > hi) p.x = Math.max(hi, p.x - push);

    // Surface: kerbs, footpath riding, rubble (§5.2, §7.3)
    const surf = World.surfaceAt(s, p.x);
    if (surf !== p.surface) {
      const kerb = (surf === 'footpath') !== (p.surface === 'footpath');
      if (kerb && p.v > T.KERB_MIN_SPEED) {
        p.v *= T.KERB_SPEED_MULT;
        damage(p, T.KERB_CONDITION);
        p.goods = Math.max(0, p.goods - T.GOODS_KERB);
        p.wobble = Math.max(p.wobble, T.MINOR_WOBBLE);
        ev.push({ type: 'bump', kind: 'kerb', x: p.x, y: p.y, pid: p.id });
      }
      p.surface = surf;
    }
    if (surf === 'footpath') {
      loseKarma(p, T.FOOTPATH_KARMA_PER_S * DT);
      p.stats.footpathSeconds += DT;
      p.calmT = 0;
    }
    if (surf !== 'road') {
      p.bumpAcc += p.v * DT;
      const every = surf === 'footpath' ? T.SLAB_BUMP_EVERY_M : T.RUBBLE_BUMP_EVERY_M;
      if (p.bumpAcc > every) {
        p.bumpAcc = Rng.range(st, 0, every * 0.5);
        if (p.v > 3) {
          p.wobble = Math.max(p.wobble, T.MINOR_WOBBLE);
          ev.push({ type: 'bump', kind: surf === 'footpath' ? 'slab' : 'rubble', x: p.x, y: p.y, pid: p.id });
        }
      }
    } else p.bumpAcc = 0;

    // Missing drain slabs: the front wheel drops in (crawl across and you just lurch).
    const dr = drainUnder(st, p.x, p.y);
    if (dr) {
      if (p.drain !== dr.id) {
        p.drain = dr.id;
        if (p.v > T.DRAIN_SAFE_SPEED && p.invuln <= 0) { crash(st, p, 'drain', null, ev); return; }
        p.wobble = Math.max(p.wobble, T.MINOR_WOBBLE);
        ev.push({ type: 'bump', kind: 'drain', x: p.x, y: p.y, pid: p.id });
      }
    } else p.drain = 0;
    // Sunken manhole covers: a clunk; slippery when wet.
    const mh = manholeUnder(st, p.x, p.y);
    if (mh) {
      if (p.manhole !== mh.id) {
        p.manhole = mh.id;
        if (p.v > 3) {
          p.wobble = Math.max(p.wobble, T.MINOR_WOBBLE);
          ev.push({ type: 'bump', kind: 'manhole', x: p.x, y: p.y, pid: p.id });
          if (rain && p.v > T.SLIP_MIN_SPEED && Rng.chance(st, slipChance(st, p, T.MANHOLE_SLIP_CHANCE) * (Math.abs(p.steer) > 0.5 ? 1 : 0))) { crash(st, p, 'slip', null, ev); return; }
        }
      }
    } else p.manhole = 0;

    // Speed breakers (§7.6): full road width, not the footpath.
    for (const b of L.breakers) {
      if (prevY < b.y && p.y >= b.y && surf === 'road') {
        if (p.v > T.BREAKER_MIN_SPEED) {
          damage(p, (T.BREAKER_COST_BASE + T.BREAKER_COST_PER_V * p.v) * (1 - T.SKILL_DAMAGE * sk));
          p.goods = Math.max(0, p.goods - T.GOODS_BREAKER);
          p.wobble = T.WOBBLE_TIME * (1 - T.SKILL_WOBBLE * sk);
          ev.push({ type: 'bump', kind: 'breaker', hard: true, marked: !!b.marked, x: p.x, y: b.y, speed: p.v, pid: p.id });
        } else {
          ev.push({ type: 'bump', kind: 'breaker', hard: false, marked: !!b.marked, x: p.x, y: b.y, speed: p.v, pid: p.id });
          if (p.v < 3) deed(st, p, 'breaker', T.BREAKER_SLOW_KARMA, 0, ev);
        }
      }
    }

    // Potholes (§7.1)
    const ph = potholeUnder(st, p.x, p.y);
    if (ph) {
      if (p.pothole !== ph.id) {
        p.pothole = ph.id;
        if (p.v > T.POTHOLE_MIN_SPEED) {
          const v0 = p.v;
          p.v *= T.POTHOLE_SPEED_MULT;
          damage(p, (T.POTHOLE_COST_BASE + T.POTHOLE_COST_PER_V * v0) * (1 - T.SKILL_DAMAGE * sk));
          p.goods = Math.max(0, p.goods - T.GOODS_POTHOLE * (0.5 + v0 / T.MAX_SPEED));
          p.wobble = T.WOBBLE_TIME * (1 - T.SKILL_WOBBLE * sk);
          p.stats.potholesHit++;
          ev.push({ type: 'pothole', x: ph.x, y: ph.y, speed: v0, hidden: ph.hidden, pid: p.id });
        }
        ph.hidden = false;
      }
    } else p.pothole = 0;

    // Puddles (§7.2)
    const q = puddleAt(st, p.x, p.y);
    if (q) {
      if (p.puddle !== q.id) {
        p.puddle = q.id;
        const v0 = p.v;
        p.v *= T.PUDDLE_SPEED_MULT;
        ev.push({ type: 'splash', x: p.x, y: p.y, by: p.id, size: Math.min(1, (q.rx + q.ry) / 3) * Math.min(1, v0 / 8), player: true });
        if (v0 > T.SPLASH_MIN_SPEED) splashPeds(st, p.x, T.PLAYER_W, q, p, ev);
        if (v0 > T.SLIP_MIN_SPEED && Rng.chance(st, slipChance(st, p, T.SLIP_CHANCE))) { crash(st, p, 'slip', null, ev); return; }
      }
    } else p.puddle = 0;

    // Deliveries: stop at the kerb inside the drop zone to hand over.
    const o = nextOrder(st);
    if (o) {
      const dy = p.y - o.y;
      if (Math.abs(dy) <= T.DROP_ZONE / 2 && p.x <= T.DROP_MAX_X && p.v < T.DROP_STOP_SPEED) {
        p.dropT += DT;
        if (p.dropT >= T.DROP_STOP_HOLD) {
          p.dropT = 0;
          p.v = 0;
          const sc = pickScene(st, p, o.kind);
          p.handScene = sc.id;
          p.handStep = 0;
          p.handStepT = sc.steps[0][1];
          p.handT = sc.steps.reduce((a, q) => a + q[1], 0);
          p.handHonk = 0;
          p.handId = o.id;
          ev.push({ type: 'handover', orderId: o.id, kind: o.kind, name: o.name, scene: sc.id, total: p.handT, x: p.x, y: o.y, pid: p.id });
          handStepEvent(p, o, sc, ev);
        }
      } else p.dropT = 0;
      if (dy > T.DROP_ZONE / 2 + 1) missOrder(st, p, o, ev);
    }

    // Horn (§7.4)
    if (horn) p.calmT = 0;
    if (horn && p.hornCd <= 0) {
      p.hornCd = Math.round(T.HORN_COOLDOWN / DT);
      p.stats.honks++;
      const win = Math.round(T.HORN_WINDOW / DT);
      while (p.hornLog.length && p.hornLog[0] <= st.tick - win) p.hornLog.shift();
      p.hornLog.push(st.tick);
      const costly = p.hornLog.length > T.HORN_FREE;
      if (costly) loseKarma(p, T.HORN_KARMA);
      ev.push({ type: 'horn', x: p.x, y: p.y, costly, pid: p.id });
      hornEffects(st, L, p, ev);
      for (const d of st.dogs) {
        if (d.mode === 'chase' && Math.hypot(d.x - p.x, d.y - p.y) < T.DOG_SCARE_RANGE) { d.mode = 'return'; ev.push({ type: 'dogScared', id: d.id, x: d.x, y: d.y }); }
      }
    }
  }

  /**
   * Contact below SCRAPE_SPEED (relative) is a scrape, not a crash: the
   * scooter stays where it was at the start of the tick and stops. Crawling
   * into a car in a jam should not cost a fifth of the bike.
   */
  function scrape(p, prev, n, ev, hw, hl, f) {
    // Already overlapping at the start of the tick (it moved into us): let us slide out.
    if (Math.abs(n.x - prev.x) < hw + (n.w / 2) * f && Math.abs(n.y - prev.y) < hl + (n.l / 2) * f) return true;
    const lat = (p.x - prev.x) / DT - (n.vx || 0);
    const lon = (p.y - prev.y) / DT - n.dir * n.v;
    if (lat * lat + lon * lon >= T.SCRAPE_SPEED * T.SCRAPE_SPEED) return false;
    p.x = prev.x;
    p.y = prev.y;
    p.v = 0;
    if (p.scrapeT <= 0) {
      p.scrapeT = 0.5;
      ev.push({ type: 'bump', kind: 'scrape', x: p.x, y: p.y, id: n.id, pid: p.id });
    }
    return true;
  }

  function playerCollisions(st, L, p, prev, ev) {
    if (p.scrapeT > 0) p.scrapeT -= DT;
    if (p.crash > 0 || p.invuln > 0) return;
    const f = T.HITBOX_FORGIVE;
    const hw = (T.PLAYER_W / 2) * f;
    const hl = (T.PLAYER_L / 2) * f;
    for (const n of st.npcs) {
      const dy = n.y - p.y;
      if (dy > 15 || dy < -15) continue;
      if (Math.abs(n.x - p.x) < hw + (n.w / 2) * f && Math.abs(dy) < hl + (n.l / 2) * f) {
        if (n.kind !== 'cow' && scrape(p, prev, n, ev, hw, hl, f)) return;
        crash(st, p, n.kind === 'cow' ? 'cow' : n.dir < 0 ? 'headOn' : 'vehicle', n, ev);
        return;
      }
    }
    for (const pd of st.peds) {
      if (pd.mode === 'stumble') continue;
      const dy = pd.y - p.y;
      if (dy > 3 || dy < -3) continue;
      if (Math.abs(pd.x - p.x) < hw + (PED.w / 2) * f && Math.abs(dy) < hl + (PED.l / 2) * f) {
        if (p.v < T.PED_SAFE_SPEED) { // we are (nearly) stopped: they bumped into us. A nudge, not a crash.
          if (pd.dodge <= 0) {
            const away = pd.x >= p.x ? 1 : -1;
            pd.dodge = 0.5;
            pd.dodgeV = away * 1.4;
            ev.push({ type: 'pedNudge', pedId: pd.id, x: pd.x, y: pd.y });
          }
          continue;
        }
        crash(st, p, 'ped', pd, ev);
        return;
      }
    }
    for (const d of st.dogs) {
      if (d.mode !== 'sleep' || d.y > p.y + 3 || d.y < p.y - 3) continue;
      if (Math.abs(d.x - p.x) < hw + (T.DOG_W / 2) * f && Math.abs(d.y - p.y) < hl + (T.DOG_L / 2) * f) {
        if (p.v < T.PED_SAFE_SPEED) { p.x = prev.x; p.y = prev.y; p.v = 0; continue; }
        crash(st, p, 'dog', d, ev);
        return;
      }
    }
    for (const k of st.stalls) {
      if (k.y > p.y + 4 || k.y < p.y - 4) continue;
      if (Math.abs(k.x - p.x) < hw + k.w / 2 && Math.abs(k.y - p.y) < hl + k.l / 2) {
        if (p.v < T.PED_SAFE_SPEED) { p.x = prev.x; p.y = prev.y; p.v = 0; continue; }
        crash(st, p, 'stall', k, ev);
        return;
      }
    }
    for (const b of L.barricades) {
      if (p.x + hw > b.x0 && p.x - hw < b.x1 && p.y + hl > b.y0 && p.y - hl < b.y1) {
        crash(st, p, 'barricade', null, ev);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Deliveries and scoring (docs/concepts/delivery-missions.md)
  // ---------------------------------------------------------------------------
  function nextOrder(st) {
    for (let i = 0; i < st.orders.length; i++) if (st.orders[i].status === 'pending') return st.orders[i];
    return null;
  }

  function sceneOf(kind, id) {
    const list = World.HANDOVER_SCENES[kind] || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }

  /** Good karma makes the friendly scenes likelier, bad karma the slow ones. */
  function pickScene(st, p, kind) {
    const list = World.HANDOVER_SCENES[kind];
    const lean = ((p.karma - 50) / 50) * T.SCENE_MOOD;
    const w = {};
    for (const sc of list) w[sc.id] = Math.max(0.1, sc.w * (1 + sc.mood * lean));
    return sceneOf(kind, Rng.weighted(st, w));
  }

  function handStepEvent(p, o, sc, ev) {
    const step = sc.steps[p.handStep];
    if (step[0] === 'water') p.steadyT = T.STEADY_TIME;
    ev.push({ type: 'handStep', orderId: o.id, kind: o.kind, scene: sc.id, step: step[0], i: p.handStep, n: sc.steps.length, t: step[1], x: p.x, y: o.y, pid: p.id });
  }

  function deliverOrder(st, p, o, ev) {
    const late = Math.max(0, (st.time - o.due) / 60);
    let rating = 5 - Math.ceil(late - 1e-9) * T.LATE_STAR_PER_MIN;
    if (p.goods < 70) rating--;
    if (p.goods < 40) rating--;
    if (p.handHonk) rating--; // honked at the gate
    rating = clamp(rating, 1, 5);
    const sc = sceneOf(o.kind, p.handScene);
    let tip = 0;
    if (rating === 5) tip = 10 * Rng.int(st, T.TIP_5[0] / 10, T.TIP_5[1] / 10);
    else if (rating === 4) tip = 10 * Rng.int(st, T.TIP_4[0] / 10, T.TIP_4[1] / 10);
    if (sc && sc.tipMult != null) tip = Math.round(tip * sc.tipMult);
    if (sc && sc.tipBonus && rating >= 4) tip += sc.tipBonus;
    p.money += tip;
    if (rating === 5) gainKarma(p, T.HAPPY_KARMA);
    o.status = 'delivered';
    o.at = Math.round(st.time);
    o.rating = rating;
    o.tip = tip;
    o.late = Math.round(late * 10) / 10;
    ev.push({ type: 'delivered', orderId: o.id, kind: o.kind, name: o.name, scene: p.handScene, honked: p.handHonk, rating, tip, late: o.late, goods: Math.round(p.goods), x: p.x, y: o.y, pid: p.id });
  }

  function missOrder(st, p, o, ev) {
    o.status = 'missed';
    o.rating = 1;
    loseKarma(p, T.MISSED_KARMA);
    ev.push({ type: 'missed', orderId: o.id, kind: o.kind, name: o.name, x: p.x, y: o.y, pid: p.id });
  }

  /** Score a result (either mode). */
  function score(r) {
    if (!r || r.mode !== 'delivery') return scoreCommute(r);
    if (r.outcome !== 'completed') return { deliveryPts: 0, karmaPts: 0, conditionPts: 0, tipsPts: 0, score: 0, stars: 0 };
    let deliveryPts = 0;
    for (const o of r.orders) if (o.status === 'delivered') deliveryPts += 200 + 60 * o.rating + (o.late === 0 ? 100 : 0);
    const karmaPts = 5 * r.karma;
    const conditionPts = 3 * r.condition;
    const tipsPts = r.money || 0;
    const all = r.delivered === r.total;
    let stars = r.delivered > 0 ? 1 : 0;
    if (all && r.onTime === r.total && r.avgRating >= 4.5 && r.karma >= 70) stars = 3;
    else if (all && r.avgRating >= 3.5) stars = 2;
    return { deliveryPts, karmaPts, conditionPts, tipsPts, score: deliveryPts + karmaPts + conditionPts + tipsPts, stars };
  }

  /** Commute (SPEC §9.3): punctuality + karma + condition + tips. */
  function scoreCommute(r) {
    if (!r || r.outcome !== 'arrived') return { punctuality: 0, karmaPts: 0, conditionPts: 0, tipsPts: 0, score: 0, stars: 0 };
    const onTime = r.minutesEarly >= 0;
    const punctuality = Math.round(onTime ? 1000 + 20 * r.minutesEarly : Math.max(0, 1000 - 100 * -r.minutesEarly));
    const karmaPts = 5 * r.karma;
    const conditionPts = 3 * r.condition;
    let stars = 1;
    if (onTime && r.karma >= 70 && r.condition >= 50) stars = 3;
    else if (onTime || (r.minutesEarly >= -5 && r.karma >= 40)) stars = 2;
    const tipsPts = r.money || 0;
    return { punctuality, karmaPts, conditionPts, tipsPts, score: punctuality + karmaPts + conditionPts + tipsPts, stars };
  }

  function finish(st, p, outcome, ev) {
    const L = World.level(st.levelId);
    st.done = true;
    const orders = st.orders.map((o) => ({ name: o.name, kind: o.kind, status: o.status, rating: o.rating, tip: o.tip, late: o.late, due: o.due, at: o.at }));
    const delivered = orders.filter((o) => o.status === 'delivered');
    const r = {
      mode: L.mode,
      outcome,
      finishedAt: Math.round(st.time),
      goods: Math.round(p.goods),
      karma: Math.round(p.karma),
      condition: Math.round(p.condition),
      stats: {
        splashedPeds: p.stats.splashedPeds,
        potholesHit: p.stats.potholesHit,
        crashes: p.stats.crashes,
        honks: p.stats.honks,
        footpathSeconds: Math.round(p.stats.footpathSeconds * 10) / 10,
        goodDeeds: p.goodDeeds,
        fights: p.fights,
      },
      money: Math.max(0, Math.round(p.money)),
      skill: p.skill,
    };
    if (L.mode === 'delivery') {
      Object.assign(r, {
        orders,
        total: orders.length,
        delivered: delivered.length,
        onTime: delivered.filter((o) => o.late === 0).length,
        avgRating: orders.length ? Math.round((orders.reduce((a, o) => a + o.rating, 0) / orders.length) * 10) / 10 : 0,
      });
    } else {
      r.arrivalGameTime = outcome === 'arrived' ? Math.round(st.time) : null;
      r.minutesEarly = Math.round((st.deadline - st.time) / 6) / 10;
    }
    Object.assign(r, score(r));
    // Rider XP: riding, good deeds and stars, scaled by karma (bad karma slows learning).
    r.xpMult = p.karma >= 70 ? 1.5 : p.karma >= 40 ? 1 : 0.5;
    const base = Math.min(p.y, L.length) / 20 + p.goodDeeds * 4 + r.stars * 15 + (r.delivered || 0) * 10;
    r.xp = Math.max(0, Math.round(base * r.xpMult * (outcome === 'breakdown' ? 0.5 : 1) + p.xpBonus));
    st.result = r;
    ev.push({ type: outcome === 'completed' ? 'shiftDone' : outcome === 'arrived' ? 'arrive' : 'breakdown' });
  }

  // ---------------------------------------------------------------------------
  // Step
  // ---------------------------------------------------------------------------
  function step(st, input) {
    const ev = [];
    if (st.done) return ev;
    const L = World.level(st.levelId);
    PENDING.length = 0;
    st.tick++;
    st.time += L.clockRate * DT;
    const p = st.players[0];
    buildObstacles(st, L, p.y);

    for (let i = 0; i < st.players.length; i++) {
      const pl = st.players[i];
      PREV[i] = PREV[i] || { x: 0, y: 0 };
      PREV[i].x = pl.x;
      PREV[i].y = pl.y;
      const inp = Array.isArray(input) ? input[i] || NO_INPUT : input || NO_INPUT;
      updatePlayer(st, L, pl, inp, ev);
    }

    const lo = p.y - T.ACTIVE_RANGE;
    const hi = p.y + T.ACTIVE_RANGE;
    for (let i = 0; i < st.npcs.length; i++) {
      const n = st.npcs[i];
      if (n.kind === 'cow') { if (n.y > lo && n.y < hi) updateCow(st, L, n); }
      else if (!n.parked) updateVehicle(st, L, n, p, ev);
    }
    for (let i = 0; i < st.peds.length; i++) {
      const pd = st.peds[i];
      if (pd.y > lo && pd.y < hi) updatePed(st, L, pd, p, ev);
    }

    updateDogs(st, L, p, ev);
    for (let i = 0; i < st.players.length; i++) playerCollisions(st, L, st.players[i], PREV[i], ev);
    for (let i = 0; i < st.players.length; i++) { deedsTick(st, st.players[i], ev); luckTick(st, st.players[i], ev); }
    if (st.tick % 15 === 0) pedChats(st, p, ev);
    while (PENDING.length) ev.push(PENDING.shift());

    spawnTick(st, L, p);
    busyTick(st, p, ev);
    despawn(st, p);

    // Ambient horns: audio only (§7.4)
    const s = World.segmentAt(L, p.y);
    if (st.npcs.length && Rng.chance(st, (0.25 + s.traffic * 0.6 + (s.jam ? 1.2 : 0)) * DT)) {
      const n = st.npcs[Rng.int(st, 0, st.npcs.length - 1)];
      if (n.kind !== 'cow' && Math.abs(n.y - p.y) < 50) ev.push({ type: 'honkNpc', id: n.id, x: n.x, y: n.y, kind: n.kind, atPlayer: false });
    }

    if (p.condition <= 0) {
      finish(st, p, 'breakdown', ev);
    } else if (L.mode === 'delivery') {
      if (!nextOrder(st) && p.handT <= 0) finish(st, p, 'completed', ev); // every order delivered or missed
      else if (p.y >= L.length + T.DROP_ZONE) {
        for (const o of st.orders) if (o.status === 'pending') missOrder(st, p, o, ev);
        finish(st, p, 'completed', ev);
      }
    } else if (p.y >= L.length) {
      finish(st, p, 'arrived', ev);
    }
    return ev;
  }

  function result(st) { return st.result; }

  /** Debug only: what is NPC `id` following right now? Does not change the state. */
  function debugLeader(st, id) {
    const L = World.level(st.levelId);
    buildObstacles(st, L, st.players[0].y);
    const n = st.npcs.find((o) => o.id === id);
    if (!n || n.kind === 'cow') return null;
    const o = findLeader(n, n.x, n.w / 2 + 0.1, n.dir, n.dir < 0, 60);
    if (!o) return { id, leader: null };
    const kinds = ['vehicle', 'cow', 'ped', 'player', 'barricade'];
    return { id, leader: kinds[o.kind], leaderId: o.ref ? o.ref.id : null, gap: +LEAD.gap.toFixed(2), x: +o.x.toFixed(2), y: +o.y.toFixed(2), mergeX: n.mergeX };
  }

  return { VERSION: 4, create, step, result, score, nextOrder, NO_INPUT, debugLeader };
});
