# Kit.Particles: zero-allocation particle pool

## Purpose
Splashes, dust, debris and sparks without garbage-collector hitches: a fixed
capacity struct-of-arrays pool where live particles stay packed in
`[0, count)`.

## API
```js
const P = Kit.Particles.create(500);
P.spawn(x, y, vx, vy, life, size, kind, color, vz, grav, drag);  // index, or -1 if full
P.update(dt);    // integrate x/y, drag, z with gravity (bounces to rest on z = 0), retire expired
for (let i = 0; i < P.count; i++) draw(P.x[i], P.y[i], P.z[i], P.size[i], P.life[i] / P.max[i], P.kind[i], P.color[i]);
P.clear();
```
Fields: `x y z vx vy vz life max size drag grav` (Float32Array), `kind color` (Uint8Array).

## Invariants
- Retiring swaps the last particle into the freed slot; order is not stable.
- `z` is height above the ground for top-down or first-person arcs; with
  `grav` > 0 a particle lands, halves its ground speed and stays at z = 0.
- No allocation after `create()`.

## Used by
Both renderers: water (kind 0), dust (1), debris (2), sparks (3), positioned
in world metres and projected at draw time.

## Tests
`kit/particles/particles.test.js`: capacity, retirement and packing, gravity arcs.

## Rebuild prompt
> UMD `Kit.Particles.create(capacity)` returning an object with typed arrays
> per field (as listed), `count`, `spawn(...)` that writes slot `count++`
> (returns -1 when full), `update(dt)` that decrements life, swap-removes
> expired particles, applies drag `max(0, 1 - drag*dt)`, integrates position,
> and integrates z with gravity, clamping at 0, and `clear()`.

## Evolving
Add per-kind behaviour by branching on `kind` in the game's draw loop rather
than in the pool, to keep the pool generic.
