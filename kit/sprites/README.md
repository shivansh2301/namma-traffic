# Kit.Sprites: bake procedural art once, blit every frame

## Purpose
Games that draw everything in code still should not re-run path drawing for
every vehicle every frame. Register a recipe that draws in world units
(metres) around the origin; the cache bakes it to an offscreen canvas at the
current pixel scale and blits it with `drawImage`.

## API
```js
const sprites = Kit.Sprites.create({ pad: 0.25 });          // pad: units of margin for shadows/outlines
sprites.register('car.r.0', 1.8, 1.45, (g, w, h) => { /* draw centred on 0,0; +y down */ });
sprites.setScale(devicePxPerUnit);                           // clears the cache; re-bakes lazily
sprites.get(key);                                            // { canvas, wu, hu } (bakes on demand)
sprites.warm();                                              // bake everything now
sprites.draw(ctx, key, cssX, cssY, rotation, cssPxPerUnit, alpha);  // centred blit

Kit.Sprites.makeCanvas(w, h);        // OffscreenCanvas or <canvas>
Kit.Sprites.roundRect(ctx, x, y, w, h, r);
Kit.Sprites.shade('#204060', -0.5);  // darken/lighten a hex colour
Kit.Sprites.hash01(a, b, c);         // deterministic cosmetic noise in [0, 1)
```

## Invariants
- Recipes are pure drawing functions of their arguments; they may be re-run
  whenever the scale changes (resize, DPR change).
- The baked canvas covers `(w + 2*pad) × (h + 2*pad)` units; `draw` sizes the
  blit by the same padded extent, so scaling is exact.
- `hash01` is for looks only (stripes, missing lane dashes), never gameplay.

## Used by
`client/render.js` (first-person: rear/front views of vehicles, people,
cows, trees) and `client/render-top.js` (top-down sprites, asphalt tiles).
Art recipes and palette: `docs/concepts/procedural-art.md`.

## Tests
`kit/sprites/sprites.test.js`: shade, hash01, lazy baking with a fake OffscreenCanvas.

## Rebuild prompt
> UMD `Kit.Sprites` exporting `create({pad, scale})`, `makeCanvas`,
> `roundRect` (arcTo path), `shade(hex, amt)` (lerp to white for amt > 0,
> scale toward black for amt < 0) and `hash01(a, b, c)` (imul-based integer
> hash to [0,1)). The cache keeps a Map of recipes {w, h, draw} and a Map of
> baked {canvas, wu, hu}; bake sets transform (scale, 0, 0, scale,
> centreX, centreY) and calls draw(g, w, h). draw() blits centred, with
> optional rotation via save/translate/rotate/restore and optional alpha.

## Evolving
For many colour variants, bake a greyscale sprite once and tint with
`globalCompositeOperation = 'source-atop'` at bake time.
