/*
 * Kit.Rng: seeded, serialisable PRNG (mulberry32).
 *
 * The generator state is one int32 kept on a plain object you own, e.g.
 * `state.rng`. Every helper takes that holder and advances it, so the state
 * survives JSON round-trips and replays bit-exactly in one JS engine.
 *
 * UMD: require() in Node, window.Kit.Rng in the browser. No dependencies.
 * See README.md in this folder.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Rng = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Hash any mix of strings/numbers into a uint32 seed (FNV-1a + murmur finaliser). */
  function hash() {
    let h = 0x811c9dc5;
    for (let a = 0; a < arguments.length; a++) {
      const s = String(arguments[a]);
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      h ^= 0xff; // separator, so ('ab','c') and ('a','bc') differ
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** A fresh holder: { rng: int32 }. Any object with an int `rng` field works. */
  function create(seed) {
    return { rng: seed | 0 };
  }

  /** Uniform float in [0, 1). Advances h.rng. */
  function next(h) {
    let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  function range(h, a, b) { return a + (b - a) * next(h); }

  /** Uniform integer in [a, b], inclusive. */
  function int(h, a, b) { return a + Math.floor(next(h) * (b - a + 1)); }

  /** true with probability p. Always consumes exactly one draw. */
  function chance(h, p) { return next(h) < p; }

  /** -1 or +1. */
  function sign(h) { return next(h) < 0.5 ? -1 : 1; }

  /** Random element of a non-empty array. */
  function pick(h, arr) { return arr[Math.floor(next(h) * arr.length)]; }

  /**
   * Weighted key from { key: weight }. Key order is insertion order, which is
   * deterministic. Non-positive weights never win. Returns null if all are 0.
   */
  function weighted(h, weights) {
    let total = 0;
    for (const k in weights) if (weights[k] > 0) total += weights[k];
    if (total <= 0) return null;
    let r = next(h) * total;
    let last = null;
    for (const k in weights) {
      const w = weights[k];
      if (!(w > 0)) continue;
      last = k;
      r -= w;
      if (r < 0) return k;
    }
    return last;
  }

  /** Poisson-distributed integer with the given mean (Knuth; fine for mean < ~50). */
  function poisson(h, mean) {
    if (!(mean > 0)) return 0;
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do { k++; p *= next(h); } while (p > L && k < 1000);
    return k - 1;
  }

  return { hash, create, next, range, int, chance, sign, pick, weighted, poisson };
});
