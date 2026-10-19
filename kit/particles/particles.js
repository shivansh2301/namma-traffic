/*
 * Kit.Particles: fixed-capacity particle pool, struct-of-arrays, zero
 * allocations after create(). Live particles are packed in [0, count),
 * so render loops are plain index loops.
 *
 *   const P = Kit.Particles.create(512);
 *   P.spawn(x, y, vx, vy, life, size, kind, color);   // returns index or -1 when full
 *   P.update(dt);                                      // integrate, apply drag/gravity, retire
 *   for (let i = 0; i < P.count; i++) draw(P.x[i], P.y[i], P.size[i], P.life[i] / P.max[i]);
 *
 * Units are whatever you choose (world metres here). `grav` is a per-particle
 * acceleration on y (use it for "fall back to the road" on a top-down view by
 * pairing it with a z field, or leave it 0). UMD, no dependencies.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Particles = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(capacity) {
    const N = capacity | 0;
    const P = {
      capacity: N,
      count: 0,
      x: new Float32Array(N),
      y: new Float32Array(N),
      z: new Float32Array(N), // height above ground, for top-down "arc" effects
      vx: new Float32Array(N),
      vy: new Float32Array(N),
      vz: new Float32Array(N),
      life: new Float32Array(N), // seconds left
      max: new Float32Array(N), // initial life
      size: new Float32Array(N),
      drag: new Float32Array(N), // 1/s
      grav: new Float32Array(N), // on z
      kind: new Uint8Array(N),
      color: new Uint8Array(N),

      /** Spawn one particle. Returns its index, or -1 if the pool is full. */
      spawn(x, y, vx, vy, life, size, kind, color, vz, grav, drag) {
        if (P.count >= N) return -1;
        const i = P.count++;
        P.x[i] = x; P.y[i] = y; P.z[i] = 0;
        P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz || 0;
        P.life[i] = life; P.max[i] = life;
        P.size[i] = size;
        P.kind[i] = kind || 0;
        P.color[i] = color || 0;
        P.grav[i] = grav || 0;
        P.drag[i] = drag || 0;
        return i;
      },

      update(dt) {
        let i = 0;
        while (i < P.count) {
          P.life[i] -= dt;
          if (P.life[i] <= 0) { kill(i); continue; } // swap-remove; re-check slot i
          const d = P.drag[i] > 0 ? Math.max(0, 1 - P.drag[i] * dt) : 1;
          P.vx[i] *= d; P.vy[i] *= d;
          P.x[i] += P.vx[i] * dt;
          P.y[i] += P.vy[i] * dt;
          if (P.grav[i] !== 0 || P.vz[i] !== 0) {
            P.vz[i] -= P.grav[i] * dt;
            P.z[i] += P.vz[i] * dt;
            if (P.z[i] < 0) { P.z[i] = 0; P.vz[i] = 0; P.vx[i] *= 0.5; P.vy[i] *= 0.5; }
          }
          i++;
        }
      },

      clear() { P.count = 0; },
    };

    const fields = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'max', 'size', 'drag', 'grav', 'kind', 'color'];
    function kill(i) {
      const last = --P.count;
      if (i !== last) for (let f = 0; f < fields.length; f++) P[fields[f]][i] = P[fields[f]][last];
    }

    return P;
  }

  return { create };
});
