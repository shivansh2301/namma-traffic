/*
 * shared/bot.js: a scripted rider for tests, tuning and the title-screen demo.
 *
 *   const mem = Bot.create();
 *   const input = Bot.act(state, mem);       // { steer, brake, horn } for players[0]
 *
 * Deliveries: when the next drop is near, it heads for the left kerb, slows,
 * stops inside the drop zone and waits out the handover.
 *
 * Policy (SPEC §13.1): steer toward the reachable lateral position with the
 * most clearance (time-to-collision), brake when the time-to-collision in
 * the current path is under 1.5 s. Extras: slows for speed breakers, avoids
 * visible potholes (and puddles in the rain), keeps off footpaths and
 * oncoming lanes unless that is the only way through, steers round stalls,
 * sleeping dogs and missing drain slabs, honks sparingly (never three times
 * at the same person: that earns a gaali) and honks chasing dogs away.
 *
 * Reads the state, never writes it. Deterministic (no randomness), so
 * bot runs are reproducible. UMD like world.js.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const mod = factory(isNode ? require('./world.js') : root.World);
  if (isNode) module.exports = mod;
  else root.Bot = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (World) {
  'use strict';

  const { T, DT, PED } = World;
  const STEP = 0.25;

  function create(opts) {
    return Object.assign({ target: null, hornT: 0, caution: 1.5, stuck: 0 }, opts);
  }

  function gather(st, L, p) {
    const obs = [];
    for (const n of st.npcs) {
      const dy = n.y - p.y;
      if (dy < -14 || dy > 55) continue;
      if (n.kind === 'cow') obs.push({ x: n.x, y: n.y, w: n.w, l: n.l, vx: 0, vy: Math.cos(n.h) * n.v, kind: 'cow' });
      else obs.push({ x: n.x, y: n.y, w: n.w, l: n.l, vx: n.vx, vy: n.dir * n.v, kind: n.ws ? 'ws' : n.kind, honkN: n.honkN, honkTick: n.honkTick });
    }
    for (const pd of st.peds) {
      const dy = pd.y - p.y;
      if (dy < -3 || dy > 45) continue;
      obs.push({ x: pd.x, y: pd.y, w: PED.w + 0.1, l: PED.l + 0.1, vx: pd.vx, vy: pd.vy, kind: 'ped', honkN: pd.honkN, honkTick: pd.honkTick });
    }
    for (const b of L.barricades) {
      if (b.y1 < p.y - 3 || b.y0 > p.y + 55) continue;
      obs.push({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, l: b.y1 - b.y0, vx: 0, vy: 0, kind: 'barricade' });
    }
    for (const k of st.stalls) {
      if (k.y < p.y - 3 || k.y > p.y + 55) continue;
      obs.push({ x: k.x, y: k.y, w: k.w, l: k.l, vx: 0, vy: 0, kind: 'stall' });
    }
    for (const d of st.dogs) {
      if (d.mode !== 'sleep' || d.y < p.y - 3 || d.y > p.y + 45) continue;
      obs.push({ x: d.x, y: d.y, w: T.DOG_W + 0.1, l: T.DOG_L + 0.1, vx: 0, vy: 0, kind: 'dog' });
    }
    for (const d of st.drains) { // a wall at speed; up close and slow we creep across instead (see act)
      if (d.y < p.y - 2 || d.y > p.y + 40) continue;
      if (d.y - p.y > 3 || p.v > T.DRAIN_SAFE_SPEED + 0.1) obs.push({ x: d.x, y: d.y, w: d.w + 0.1, l: d.l + 0.4, vx: 0, vy: 0, kind: 'drain' });
    }
    const soft = [];
    for (const m of st.manholes) {
      if (m.y < p.y - 1 || m.y > p.y + 26) continue;
      soft.push({ x: m.x, y: m.y, r: m.r, k: st.weather === 'rain' ? 2.5 : 1 });
    }
    for (const h of st.potholes) {
      if (h.y < p.y - 1 || h.y > p.y + 32) continue;
      if (!h.hidden) soft.push({ x: h.x, y: h.y, r: h.r * 0.8, k: 6 });
    }
    if (st.weather === 'rain') {
      for (const q of st.puddles) {
        if (q.y < p.y - 1 || q.y > p.y + 26) continue;
        soft.push({ x: q.x, y: q.y, r: q.rx, k: q.leak ? 0.5 : 2.2 });
      }
    }
    return { obs, soft };
  }

  /**
   * Time until the scooter, riding straight at x, meets something.
   * mode 'score': beside-but-clear counts as a tight squeeze (t = 1).
   * mode 'reach': only real collisions count (can we get there in time?).
   * mode 'brake': ignore things beside or behind (braking never helps with those).
   */
  function corridorTTC(x, p, obs, vEval, squeeze, mode) {
    const aheadOnly = mode === 'brake';
    let best = 99;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const reach = (o.w + T.PLAYER_W) / 2;
      const lat = Math.abs(o.x - x);
      const pad = (0.22 + Math.min(1.6, Math.abs(o.vx) * 1.1) + (o.kind === 'ws' ? 0.6 : 0)) * squeeze;
      if (lat >= reach + pad) continue;
      const rel = o.y - p.y;
      const along = Math.abs(rel) - (o.l + T.PLAYER_L) / 2;
      // Already inside it (it drove into us): moving or braking will not make it worse.
      if (mode !== 'score' && along < 0 && Math.abs(o.x - p.x) < reach) continue;
      if (aheadOnly && (rel <= 0 || (along <= 0.25 && lat >= reach))) continue; // behind, or beside
      let t;
      if (along <= 0.25) {
        // Touching distance. Directly behind us (in line with where we are now)
        // means it is following us; beside us but not overlapping is a squeeze, not a wall.
        const inLineBehind = rel < 0 && Math.abs(o.x - p.x) < reach;
        if (mode === 'reach' && rel > 0 && along > 0) t = 99; // touching ahead: we can slide along its face (braking keeps us off it)
        else t = inLineBehind ? 99 : lat < reach + 0.05 ? 0 : mode === 'reach' ? 99 : 1.0;
      } else if (rel > 0) {
        const c = vEval - o.vy;
        t = c > 0.05 ? along / c : 99;
      } else {
        const c = o.vy - p.v; // something catching us up from behind
        t = c > 0.05 ? along / c : 99;
        if (t > 1.2) t = 99;
      }
      if (t < best) best = t;
    }
    return best;
  }

  /**
   * Speed we could hold riding straight at x: car-following behind the
   * nearest thing ahead. A wall scores 0, a moving queue scores its pace.
   */
  function corridorFlow(x, p, obs) {
    let v = T.MAX_SPEED;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (Math.abs(o.x - x) >= (o.w + T.PLAYER_W) / 2 + 0.1) continue;
      const rel = o.y - p.y;
      if (rel <= 0) continue;
      const gap = rel - (o.l + T.PLAYER_L) / 2;
      if (gap > 50) continue;
      const vt = Math.max(0, Math.min(T.MAX_SPEED, o.vy + (gap - 1) / 0.6));
      if (vt < v) v = vt;
    }
    return v;
  }

  function softCost(x, p, soft) {
    let c = 0;
    for (let i = 0; i < soft.length; i++) {
      const h = soft[i];
      if (h.y < p.y - 0.5) continue;
      if (Math.abs(h.x - x) < h.r + 0.5) c += h.k * Math.max(0.2, 1 - (h.y - p.y) / 35);
    }
    return c;
  }

  // Cost of being at x: karma on footpaths, risk in oncoming lanes, and the
  // kerb hop (condition) if x is across a kerb from where we are now.
  function surfaceCost(s, x, here) {
    const surf = World.surfaceAt(s, x);
    let c = 0;
    if (surf === 'footpath') c = here === 'footpath' ? 2.5 : 5;
    else if (surf === 'shoulder') c = 0.7;
    if (!s.xs.divided && x > s.xs.roadR) c += 4; // far side: only reachable through oncoming traffic
    else if (!s.xs.divided && x > s.xs.ownR) c += 2.5;
    if ((surf === 'footpath') !== (here === 'footpath')) c += 3;
    return c;
  }

  function act(st, mem, pi) {
    const out = { steer: 0, brake: 0, horn: 0 };
    const p = st.players[pi || 0];
    if (!p || st.done) return out;
    if (p.fight > 0 || p.handT > 0) { out.brake = 1; return out; } // apologise; wait out a handover
    if (p.crash > 0) return out;
    mem.hornT = Math.max(0, mem.hornT - DT);
    const L = World.level(st.levelId);
    const s = World.segmentAt(L, p.y);
    const sA = World.segmentAt(L, p.y + 10);
    const lo = Math.max(s.xs.limitL, sA.xs.limitL) + 0.5;
    const hi = Math.min(s.xs.limitR, sA.xs.limitR) - 0.5;
    const { obs, soft } = gather(st, L, p);
    const vEval = Math.max(p.v, 5);
    // Patience: the longer we sit still, the tighter the gaps we accept.
    mem.stuck = p.v < 0.5 ? mem.stuck + DT : Math.max(0, mem.stuck - DT * 2);
    const squeeze = mem.stuck > 2 ? Math.max(0.25, 1 - (mem.stuck - 2) * 0.25) : 1;
    const latS = Math.min(T.LAT_MAX, T.LAT_BASE + T.LAT_PER_SPEED * p.v) * (p.wobble > 0 ? 0.5 : 1);

    const n = Math.max(1, Math.floor((hi - lo) / STEP) + 1);
    const cx = new Array(n);
    const ttc = new Array(n); // scored with a speed floor, so standing still never looks "safe"
    const now = new Array(n); // at the real speed, for "can I get there in time"
    const vNow = p.v;
    let cur = 0;
    let curD = 1e9;
    for (let i = 0; i < n; i++) {
      cx[i] = lo + i * STEP;
      ttc[i] = corridorTTC(cx[i], p, obs, vEval, squeeze, 'score');
      now[i] = corridorTTC(cx[i], p, obs, vNow, squeeze, 'reach');
      const d = Math.abs(cx[i] - p.x);
      if (d < curD) { curD = d; cur = i; }
    }

    // Value every line; then walk outward from where we are while lines are
    // passable in time. If the best line overall is beyond what we can reach
    // right now, head for the reachable edge nearest to it.
    const val = new Array(n);
    let gBest = cur;
    const o = st.orders ? st.orders.find((q) => q.status === 'pending') : null;
    const dropD = o ? o.y - p.y : 1e9;
    const dropping = dropD < 60 && dropD > -T.DROP_ZONE / 2;
    const kerbBonus = dropping ? 10 * (1 - Math.max(0, dropD - 15) / 45) : 0;
    for (let i = 0; i < n; i++) {
      const x = cx[i];
      val[i] = Math.min(ttc[i], 4) * 2.5 + 0.5 * corridorFlow(x, p, obs) - softCost(x, p, soft) - surfaceCost(sA, x, p.surface) - 0.35 * Math.abs(x - p.x);
      if (kerbBonus && x >= 0.35 && x <= T.DROP_MAX_X - 0.35) val[i] += kerbBonus;
      if (val[i] > val[gBest]) gBest = i;
    }
    let best = cur;
    let left = cur;
    let right = cur;
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let i = cur + dir; i >= 0 && i < n; i += dir) {
        const tReach = Math.abs(cx[i] - p.x) / latS;
        if (now[i] < tReach + 0.3 && now[i] < 3) break;
        if (dir < 0) left = i; else right = i;
        if (val[i] > val[best]) best = i;
      }
    }
    if ((gBest < left || gBest > right) && val[gBest] > val[best] + 2) best = gBest < left ? left : right;
    if (mem.trace) mem.last = { cx, ttc, now, val, left, right, cur, best, gBest };
    let target = cx[best];
    const prev = mem.target != null ? Math.round((mem.target - lo) / STEP) : -1;
    if (prev >= left && prev <= right && val[prev] > val[best] - 0.6) target = mem.target; // hysteresis
    mem.target = target;

    const dx = target - p.x;
    const drift = World.curveAt(L, p.y) * p.v * p.v * T.CURVE_DRIFT / Math.max(0.5, latS);
    out.steer = Math.max(-1, Math.min(1, (Math.abs(dx) < 0.04 ? 0 : dx * 2.2) + drift));

    // Braking. Hop kerbs below the speed that costs condition.
    if ((World.surfaceAt(sA, target) === 'footpath') !== (p.surface === 'footpath') && p.v > T.KERB_MIN_SPEED - 0.4 &&
        Math.abs(dx) < 1.2) out.brake = 1;
    const here = corridorTTC(p.x, p, obs, Math.max(p.v, 1.0), squeeze, 'brake');
    const tgt = corridorTTC(target, p, obs, Math.max(p.v, 0.5), squeeze, 'brake');
    if (here < mem.caution && (Math.abs(dx) > 0.35 || here < 0.8)) out.brake = 1;
    if (tgt < mem.caution) out.brake = 1;
    const decel = T.BRAKE_DECEL * (st.weather === 'rain' ? T.RAIN_BRAKE_MULT : 1);
    for (const b of L.breakers) {
      const d = b.y - p.y;
      if (d > 0 && p.v > 3.6 && d < (p.v * p.v - 3.3 * 3.3) / (2 * decel * 0.8) + 2.5) out.brake = 1;
    }
    for (let i = 0; i < soft.length; i++) {
      const h = soft[i];
      if (h.k < 5) continue;
      const d = h.y - p.y - h.r;
      if (d < 0 || Math.abs(h.x - target) > h.r + 0.45 || Math.abs(h.x - p.x) > h.r + 0.45) continue;
      if (p.v > 3.1 && d < (p.v * p.v - 2.8 * 2.8) / (2 * decel * 0.85) + 1) out.brake = 1;
    }

    // Creep across a missing drain slab we could not avoid (slow enough is safe).
    for (const d of st.drains) {
      const dd = d.y - d.l / 2 - (p.y + T.PLAYER_L / 2);
      if (dd > -d.l - T.PLAYER_L && dd < 2.5 && Math.abs(d.x - p.x) < d.w / 2 + T.PLAYER_W / 2 && p.v > T.DRAIN_SAFE_SPEED - 0.5) out.brake = 1;
    }

    // Deliveries: arrive slowly and stop inside the zone at the kerb.
    if (dropping) {
      const atKerb = p.x <= T.DROP_MAX_X - 0.15;
      if (Math.abs(dropD) < T.DROP_ZONE / 2 - 1.2) {
        if (atKerb || p.v > 1.2 || dropD < 2) out.brake = 1; // not at the kerb yet: hold here and edge across
      } else if (dropD > 0 && p.v * p.v > 2 * decel * 0.55 * Math.max(0.2, dropD - 1) + 0.6) out.brake = 1;
    }

    // Honk at someone in the way, within the free allowance (and never a third time at the same one),
    // or at a dog chasing us.
    if (mem.hornT <= 0) {
      const win = Math.round(T.HORN_WINDOW / DT);
      let recent = 0;
      for (const t of p.hornLog) if (t > st.tick - win) recent++;
      if (recent < T.HORN_FREE) {
        for (const d of st.dogs) {
          if (d.mode === 'chase' && Math.hypot(d.x - p.x, d.y - p.y) < T.DOG_SCARE_RANGE) { out.horn = 1; mem.hornT = 1.2; break; }
        }
        let annoyed = false; // anyone just ahead already honked at twice: hold off
        for (const o of obs) {
          const dy = o.y - p.y;
          if (o.honkN != null && dy > -1 && dy < T.GAALI_RANGE + 3 && Math.abs(o.x - p.x) < 2 && st.tick - o.honkTick <= win && o.honkN >= T.GAALI_HONKS - 1) annoyed = true;
        }
        for (const o of obs) {
          if (out.horn || annoyed) break;
          const dy = o.y - p.y;
          if (dy > 1 && dy < 10 && Math.abs(o.x - p.x) < 1.4 && (o.kind === 'bike' || o.kind === 'auto' || o.kind === 'ws')) {
            out.horn = 1;
            mem.hornT = 1.2;
            break;
          }
        }
      }
    }
    return out;
  }

  return { create, act };
});
