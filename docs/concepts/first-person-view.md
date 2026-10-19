# Concept: the first-person view (pseudo-3D on Canvas 2D)

**File:** `client/render.js` (`GameRender`) · alternate top-down map view: `client/render-top.js` (`GameRenderTop`) · shared HUD: `client/hud.js`

## Projection
Camera on the rider: lateral `camX = player.x`, `camY = player.y`, height 1.3 m
(lower while falling), looking along the road.
```
screenX = W/2 + (x − camX + bend(d)) × f / d
screenY = horizon + (camH − z) × f / d          d = y − camY (depth), near plane 0.6 m, far 150 m
f = max(W, 0.62 H) × 0.8,   horizon = 0.4 H
```
`bend(d)` integrates the level curvature ahead, strip by strip:
`off += slope·dd + ½k·dd²; slope += k·dd`. Because the sim is road-aligned,
bends are purely a projection effect (plus the sim's outward drift), and every
object on the road follows them for free. The skyline scrolls with the
accumulated heading. A small camera roll follows steering and bends.

## Draw order (painter's algorithm)
1. Sky gradient + procedural skyline silhouettes.
2. **Ground strips** far → near: depths grow ×1.075 per strip (≈ 80 strips);
   each strip draws its segment's bands (ground, footpath/shoulder, asphalt
   with alternating shade for a sense of speed, median, far carriageway) as
   trapezoids, overlapped by 0.6% to avoid seams. Then flat items: lane dashes
   (faded/missing by hash), kerb stones near by, speed breakers, puddles and
   potholes (projected polygons).
3. **Facades** (6 m cells per side, far → near): wall, shutter, goods,
   signboard, upper windows, a slanted awning. Facades are always drawn before
   anything on the road, which is always correct because everything
   on the road is laterally inside the walls.
4. **Depth-sorted items** far → near: vehicles as boxes (side face as a
   projected quad with window/canopy bands + a baked front or rear sprite on
   the near face, brake-light glow, headlights on oncoming traffic, extra
   glare on wrong-side riders), pedestrians (3 frames: walk ×2, hailing),
   cows (side/front/sitting), trees, poles with sagging cable bundles,
   barricades split into 6 m chunks so they sort correctly against traffic,
   bus shelters, median shrubs.
5. Particles (world-space, projected), rain overlay, speech bubbles, screen splatter.
6. **Cockpit:** the Yolo's teal front panel, wire basket and handlebar
   (rotates with steering, shakes with wobble, brake levers pull), hands and
   orange sleeves from the bottom corners, a speed display, and two rear-view
   mirrors that show blips for traffic within 32 m behind you.
7. HUD, plus a pulsing "WRONG-SIDE RIDER AHEAD" banner and chevrons over
   warned riders.

## Fog and fade
Ground and facade colours are lerped toward the fog colour beyond 35 m
(quantised to 16 steps and cached); items beyond 75 m fade in alpha.

## Sprites
Baked by `kit/sprites` at `min(220, f/2.2 × dpr)` px/m: `car.{r,f}.v`,
`cab.{r,f}`, `auto.{r,rp,f}.v` (rp = with passenger), `bus/tanker.{r,f}.v`,
`bike.{r,f}.v`, `ped.v.frame`, `cow.{s,z,f}.v`, `tree.v`, `shrub.v`.

## Checking it without a browser
`node tools/snapshot.js <level> <seed> <seconds> <out.png> [first|top]`
(needs `npm install --prefix .tools/canvas @napi-rs/canvas dejavu-fonts-ttf`).

## Performance notes
About 600–900 path fills and 50–100 sprite blits per frame. If phones
struggle: lower the DPR cap, reduce strips (×1.1 growth), cut facade details
beyond 60 m, or bake facade cells into sprites.

## Evolving
- Hills/flyovers: add `elev(y)` and offset screenY by `elev(camY) − elev(y)`;
  then clip items behind crests using the minimum screen-y of nearer strips.
- Junction scenery (cross streets) at sharp turns: draw gaps in the facades.
- Left/right look: shift `cx0` with steering for a subtle head turn.
