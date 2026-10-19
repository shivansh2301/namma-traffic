# kit/: reusable game components

Game-agnostic building blocks extracted from Namma Commute. Each folder is
self-contained: one source file, one test file, and a README with the API,
invariants, and a **rebuild prompt** an agent can use to regenerate the file
from scratch if it is lost or needs a rewrite.

All browser-facing modules are UMD: `require()` in Node, `window.Kit.<Name>`
in the browser, loaded with plain `<script>` tags (no bundler). None depends
on another kit module or on the game.

| Component | File | Global | Runs in | What it is for |
|---|---|---|---|---|
| [rng](rng/README.md) | `rng/rng.js` | `Kit.Rng` | Node + browser | Seeded, JSON-serialisable PRNG (mulberry32) for deterministic sims |
| [fixed-step](fixed-step/README.md) | `fixed-step/fixed-step.js` | `Kit.FixedStep` | browser (testable in Node) | Fixed-timestep loop + render interpolation |
| [camera](camera/README.md) | `camera/camera.js` | `Kit.Camera` | Node + browser | Top-down scrolling camera: anchor, speed zoom, follow, trauma shake |
| [input](input/README.md) | `input/input.js` | `Kit.Input` | browser | Keyboard state, analogue ramps, pointer drag axis, hold buttons |
| [synth](synth/README.md) | `synth/synth.js` | `Kit.Synth` | browser (no-op in Node) | Web Audio synthesiser: tones, noise bursts, retunable loops, mute |
| [sprites](sprites/README.md) | `sprites/sprites.js` | `Kit.Sprites` | browser | Bake procedural drawings to offscreen canvases; colour helpers |
| [particles](particles/README.md) | `particles/particles.js` | `Kit.Particles` | Node + browser | Fixed-capacity struct-of-arrays particle pool, zero allocation |
| [storage](storage/README.md) | `storage/storage.js` | `Kit.Storage` | Node + browser | localStorage JSON that never throws, with memory fallback |
| [pwa](pwa/README.md) | `pwa/register.js`, `pwa/sw-template.js` | `Kit.Pwa` | browser | Service-worker registration and an offline cache template |
| [sim-harness](sim-harness/README.md) | `sim-harness/harness.js` | (CommonJS) | Node | Determinism, serialisation, perf and replay tools for any `create/step/result` sim |

## Conventions

- **UMD header** (copy for new components):
  ```js
  (function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Kit = root.Kit || {}).Name = mod;
  })(typeof globalThis !== 'undefined' ? globalThis : this, function () { 'use strict'; /* ... */ return api; });
  ```
- **No hidden state across calls** unless it is an explicit object you create
  (a loop, a pool, a cache). Anything a deterministic sim touches must keep
  its state in plain JSON (see `rng`).
- **Tests** sit next to the source as `<name>.test.js` and run with
  `node --test` from the repo root (Node ≥ 20; a local Node lives in
  `.tools/node/bin/` in this checkout).
- **No dependencies**, no build step, ES2020.

## Adding a component

1. Create `kit/<name>/<name>.js` with the UMD header above.
2. Add `kit/<name>/<name>.test.js` (node:test).
3. Write `kit/<name>/README.md` using the same sections as the others:
   Purpose, API, Invariants, Used by, Tests, Rebuild prompt, Evolving.
4. Add a row to the table above, and the script tag + service-worker entry
   (`client/sw.js`) if the browser loads it. `tests/purity.test.js` checks
   that the service worker precaches everything `index.html` loads.
