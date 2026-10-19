# Kit.FixedStep: fixed-timestep loop + interpolation

## Purpose
Run a simulation at a fixed rate (30 Hz in Namma Commute) independent of the
display refresh, and draw smooth frames in between by interpolating entity
positions. Classic "fix your timestep" accumulator with a spiral-of-death guard.

## API
```js
const loop = Kit.FixedStep.createLoop({
  dt: 1 / 30,                 // seconds per step
  step(dt) {},                // 0..n times per frame
  render(alpha, frameDt) {},  // once per frame, alpha = leftover / dt in [0, 1)
  maxFrame: 0.25,             // optional: clamp long frames (tab switches)
  raf, now,                   // optional: injectable for tests
});
loop.start(); loop.stop();
loop.pause(); loop.resume();  // resume does not replay the paused time
loop.reset();                 // drop banked time (new level)
loop.tick(ms);                // drive manually (tests)
loop.alpha; loop.paused; loop.steps;

const interp = Kit.FixedStep.createInterp();
// before each sim step:
interp.begin(); interp.add(state.players); interp.add(state.npcs);
// in render:
interp.x(entity, alpha); interp.y(entity, alpha); interp.dx(entity); interp.clear();
```

## Invariants
- `step` is always called with the same `dt`.
- `render` runs every frame, also while paused (alpha frozen), so menus can
  draw over a frozen game.
- Interp keys by `entity.id`; entities need unique ids across all lists you
  add. Unknown ids draw at their current position. Stale ids are pruned
  every 64 snapshots. Teleports interpolate across one frame (acceptable).

## Used by
`client/main.js` (loop and interp), `client/render*.js` (reads interp).

## Tests
`kit/fixed-step/fixed-step.test.js`: step count vs elapsed time, long-frame
clamp, pause/resume, interpolation.

## Rebuild prompt
> UMD `Kit.FixedStep` with `createLoop({dt, step, render, maxFrame=0.25,
> maxSteps, raf})` returning `{start, stop, pause, resume, reset, tick(ms),
> alpha, paused, running, steps}`. tick: frameDt = (t - last) clamped to
> [0, maxFrame]; when not paused add to an accumulator and call step(dt) while
> acc >= dt (cap maxSteps, then drop the remainder); then render(alpha,
> frameDt). Pause freezes alpha; resume restores it and resets `last` so paused
> time is skipped. Also `createInterp()` returning `{begin, add(list), x(e,a),
> y(e,a), dx(e), dy(e), clear, size}` storing previous {x, y, gen} per id in a
> Map, pruning entries older than 2 generations every 64 begins.

## Evolving
- Networked play: keep the same loop; replace `step` with "apply confirmed
  server state, then predict locally". Interp still smooths render.
- Variable-rate rendering (e.g. 120 Hz) needs no change.
