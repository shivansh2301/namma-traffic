# Kit.Rng: seeded, serialisable PRNG

## Purpose
Deterministic randomness for simulations that must replay exactly (tests,
replays, a future authoritative multiplayer server). The generator state is a
single int32 stored on an object you own, typically `state.rng`, so it survives
`JSON.stringify` and continues identically after a round-trip.

## API
```js
const Rng = require('kit/rng/rng.js');      // or window.Kit.Rng
Rng.hash(...parts)        // uint32 from any strings/numbers (FNV-1a + murmur finaliser); order- and boundary-sensitive
Rng.create(seed)          // { rng: int32 } holder (any object with an int `rng` field works)
Rng.next(h)               // float in [0, 1), advances h.rng
Rng.range(h, a, b)        // float in [a, b)
Rng.int(h, a, b)          // integer in [a, b] inclusive
Rng.chance(h, p)          // boolean, consumes exactly one draw
Rng.sign(h)               // -1 | +1
Rng.pick(h, array)        // random element
Rng.weighted(h, {k: w})   // key by weight; zero/negative weights never win; null if all zero
Rng.poisson(h, mean)      // Knuth; fine for mean < ~50
```

## Invariants
- mulberry32: `t = (h.rng = (h.rng + 0x6D2B79F5) | 0); t = imul(t ^ t>>>15, t|1); t ^= t + imul(t ^ t>>>7, t|61); return ((t ^ t>>>14) >>> 0) / 2^32`.
- Deterministic within one JS engine. Cross-engine bit-exactness is not
  promised by the game design (the server will be authoritative).
- `weighted` iterates object keys in insertion order (deterministic in JS).
- Use **separate streams** for independent concerns so changes in one do not
  reshuffle the other. Namma Commute derives the level layout from
  `Rng.hash(seed, levelId, 'layout')` and runtime events from
  `Rng.hash(seed, 'run')`: tweaking traffic never moves a pothole.

## Used by
`shared/world.js` re-exports it as `World.Rng`; `shared/sim.js` uses it for
everything random; never `Math.random` (enforced by `tests/purity.test.js`).

## Tests
`kit/rng/rng.test.js`: same seed same sequence, JSON round-trip mid-sequence,
hash properties, distribution sanity, int bounds, weighted, poisson.

## Rebuild prompt
> Write a UMD module (`window.Kit.Rng` / `module.exports`) with no
> dependencies. State is `{ rng: int32 }` owned by the caller. Provide
> `hash(...parts)` (FNV-1a over the string of each part with a 0xff separator
> after each, then murmur3 fmix32, return uint32), `create(seed)`, `next(h)`
> (mulberry32 as above), `range`, `int` (inclusive), `chance`, `sign`, `pick`,
> `weighted(h, {key: weight})` (skip non-positive, null if total 0) and
> `poisson(h, mean)` (Knuth). Every helper advances `h.rng`; no globals.

## Evolving
- Need a sub-stream inside a sim? Store another holder in the state
  (`state.weatherRng = Rng.hash(seed, 'weather') | 0`) rather than sharing one.
- For ghosts/replays, record inputs, not random draws: the seed reproduces them.
