/*
 * Kit.FixedStep: fixed-timestep game loop with render interpolation.
 *
 *   const loop = Kit.FixedStep.createLoop({ dt: 1/30, step, render });
 *   loop.start();               // drives itself with requestAnimationFrame
 *   loop.pause(); loop.resume();
 *
 *   step(dt)                    // called 0..n times per frame, always with the same dt
 *   render(alpha, frameDt)      // once per frame; alpha = accumulator / dt in [0,1)
 *
 * Kit.FixedStep.createInterp() keeps the previous x,y of every entity, keyed
 * by entity.id, so the renderer can draw lerp(prev, current, alpha).
 *
 * UMD, no dependencies. `now`/`raf` are injectable so it runs in Node tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).FixedStep = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createLoop(opts) {
    const dt = opts.dt;
    const maxFrame = opts.maxFrame != null ? opts.maxFrame : 0.25; // s; avoids the spiral of death
    const maxSteps = opts.maxSteps != null ? opts.maxSteps : Math.ceil(maxFrame / dt) + 1;
    const raf = opts.raf || ((f) => requestAnimationFrame(f));
    let acc = 0;
    let last = -1;
    let running = false;
    let paused = false;
    let frozenAlpha = 0;

    const loop = {
      steps: 0,
      get alpha() { return paused ? frozenAlpha : acc / dt; },
      get running() { return running; },
      get paused() { return paused; },
      start() {
        if (running) return;
        running = true;
        last = -1;
        raf(frame);
      },
      stop() { running = false; },
      pause() {
        if (paused) return;
        frozenAlpha = acc / dt;
        paused = true;
      },
      resume() {
        paused = false;
        acc = frozenAlpha * dt;
        last = -1; // do not simulate the time spent paused
      },
      /** Drop any banked time, e.g. after loading a new level. */
      reset() { acc = 0; frozenAlpha = 0; last = -1; },
      /** Advance one frame at time tMs (ms). Exposed for tests and manual driving. */
      tick,
    };

    function frame(tMs) {
      if (!running) return;
      tick(tMs);
      raf(frame);
    }

    function tick(tMs) {
      const t = tMs / 1000;
      let frameDt = last < 0 ? 0 : t - last;
      last = t;
      if (frameDt > maxFrame) frameDt = maxFrame;
      if (frameDt < 0) frameDt = 0;
      if (!paused) {
        acc += frameDt;
        let n = 0;
        while (acc >= dt && n < maxSteps) {
          opts.step(dt);
          acc -= dt;
          n++;
          loop.steps++;
          if (paused) break; // step() may pause the loop (e.g. on game over)
        }
        if (n >= maxSteps) acc = 0;
      }
      if (opts.render) opts.render(loop.alpha, frameDt);
    }

    return loop;
  }

  /**
   * Previous-position store for interpolation.
   *   interp.begin(); interp.add(list); interp.add(otherList);  // before each sim step
   *   interp.x(e, alpha), interp.y(e, alpha)                     // in render
   * Entries for ids that stop appearing are pruned automatically.
   */
  function createInterp() {
    const prev = new Map();
    let gen = 0;
    return {
      begin() {
        gen++;
        if ((gen & 63) === 0) {
          for (const [id, o] of prev) if (o.g < gen - 2) prev.delete(id);
        }
      },
      add(list) {
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          let o = prev.get(e.id);
          if (!o) { o = { x: e.x, y: e.y, g: gen }; prev.set(e.id, o); }
          else { o.x = e.x; o.y = e.y; o.g = gen; }
        }
      },
      x(e, a) {
        const o = prev.get(e.id);
        return o && o.g >= gen - 1 ? o.x + (e.x - o.x) * a : e.x;
      },
      y(e, a) {
        const o = prev.get(e.id);
        return o && o.g >= gen - 1 ? o.y + (e.y - o.y) * a : e.y;
      },
      /** Per-tick displacement (current - previous), handy for yaw from motion. */
      dx(e) { const o = prev.get(e.id); return o ? e.x - o.x : 0; },
      dy(e) { const o = prev.get(e.id); return o ? e.y - o.y : 0; },
      clear() { prev.clear(); },
      get size() { return prev.size; },
    };
  }

  return { createLoop, createInterp };
});
