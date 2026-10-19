# Kit.SimHarness: test tools for deterministic simulations

## Purpose
Generic Node tooling for any sim with the shape
`create(levelId, seed) → state`, `step(state, input) → events`,
`result(state) → null | result`: run with a policy, record and replay
inputs, prove determinism and JSON round-trips, time the step function, and
encode replays compactly (ghosts later).

## API
```js
const H = require('./kit/sim-harness/harness.js');
const run = H.run(Sim, { levelId, seed, policy: (state, tick) => input, maxTicks, onEvents });
// run = { state, ticks, inputs /*quantised*/, eventCounts, result }
H.run(Sim, { levelId, seed, inputs });           // replay recorded inputs
H.run(Sim, { state, inputs });                   // continue an existing state
H.hashState(state);                              // sha256 of JSON.stringify(state)
H.checkDeterminism(Sim, { levelId, seed, inputs });               // { ok, hashA, hashB }
H.checkSerialisation(Sim, { levelId, seed, inputs, splitAt });    // { ok, ... }
H.timeSteps(Sim, { levelId, seed, inputs, ticks: 10000 });        // { avgMs, maxMs }
H.encodeInputs(inputs) / H.decodeInputs(str);    // 3 hex chars per tick
H.quantise(input);                               // steer to 1/127, flags to 0|1
```

## Invariants
- Inputs are `{ steer: -1..1, brake: 0|1, horn: 0|1 }`; recording quantises
  them so a replay feeds the sim exactly what the original run saw.
- `timeSteps` measures only `Sim.step` and restarts the level when a run ends.

## Used by
`tests/sim.test.js` (determinism, serialisation, perf, replay encoding),
`tests/helpers.js`. `tools/calibrate.js` uses the same run pattern.

## Rebuild prompt
> CommonJS module using node:crypto. `run(Sim, opts)` loops until
> `Sim.result(state)` or maxTicks; input comes from `opts.inputs[t]` (stop at
> the end) or `quantise(opts.policy(state, t))`; collect inputs and event
> counts by `type`. `checkDeterminism` runs twice and compares hashes.
> `checkSerialisation` runs to splitAt, JSON-clones, continues both with the
> remaining inputs, compares. `timeSteps` uses process.hrtime.bigint around
> each step. Encoding: steer*127 as an 8-bit two's-complement hex pair, then
> a digit of flags (brake = 1, horn = 2).

## Evolving
Multiplayer: let `policy` return an array of inputs (one per player); the sim
already accepts arrays. A ghost race is `decodeInputs` + a second state.
