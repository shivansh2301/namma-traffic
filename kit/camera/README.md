# Kit.Camera: top-down scrolling camera

## Purpose
Camera for "drive up the screen" games in world units (metres), +y up the
screen. Keeps the target at a fixed screen height, zooms out with speed,
eases horizontally, clamps to world bounds, and shakes with a trauma model.

## API
```js
const cam = Kit.Camera.create({ viewMin: 18, viewMax: 21, anchorY: 0.8, followX: 5, zoomRate: 1.5, maxShake: 0.35 });
cam.resize(cssW, cssH);
cam.update(frameDt, targetX, targetY, speedFrac /*0..1*/, minX, maxX);
cam.snap(x, y, speedFrac);        // jump without easing
cam.shake(0.5);                   // add trauma; shake = trauma^2 * maxShake
cam.reduceShake = true;           // accessibility: disables shake entirely
cam.sx(wx); cam.sy(wy);           // world -> CSS px
cam.wx(sx); cam.wy(sy);           // CSS px -> world
cam.top(); cam.bottom(); cam.left(); cam.right();  // visible world edges
cam.ppm; cam.viewW;               // px per metre, visible width in metres
```

## Invariants
- `viewW` eases toward `viewMin + (viewMax - viewMin) * speedFrac`.
- y follows the target exactly (the player never drifts vertically).
- If the bounds are narrower than the view, the camera centres on them.

## Used by
`client/render-top.js` (top-down map view). The first-person view
(`client/render.js`) has its own projection and does not use it.

## Tests
`kit/camera/camera.test.js`: anchor + round trip, zoom, clamp, reduceShake.

## Rebuild prompt
> UMD `Kit.Camera.create(opts)` returning a mutable camera object with fields
> {viewMin, viewMax, anchorY, followX, zoomRate, maxShake, reduceShake, w, h,
> x, y, viewW, ppm, trauma, shakeX, shakeY} and methods resize, snap, update,
> shake, sx, sy, wx, wy, top, bottom, left, right as documented above.
> Exponential easing: v += (target - v) * (1 - exp(-rate * dt)). Trauma
> decays 1.6/s; shake offsets are sinusoids of time scaled by trauma^2.

## Evolving
Add look-ahead (offset the anchor by velocity) or rotation for curved roads by
transforming in `sx/sy`; keep the inverse functions in sync.
