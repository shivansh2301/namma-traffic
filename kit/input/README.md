# Kit.Input: keyboard, drag axis, hold buttons

## Purpose
Small input primitives that combine into a per-tick input struct, the same on
desktop and touch. Pointer Events throughout, so mouse, pen and touch share code.

## API
```js
const keys = Kit.Input.keys(window, ['ArrowLeft', 'Space']); // e.code values to preventDefault
keys.down('KeyA'); keys.any(['ArrowLeft', 'KeyA']); keys.pressed('KeyP'); keys.clear();

value = Kit.Input.ramp(value, target, ratePerSec, dt);       // analogue feel for digital keys

const drag = Kit.Input.drag(canvas, {
  zone: (clientX, clientY, rect) => clientY > rect.top + rect.height * 0.4, // where steering may start
  pxPerUnit: 60,                 // relative mode: 60 px from the touch start = full lock (or (rect) => px)
  mode: 'relative' | 'absolute',
  absolute: (clientX, rect) => -1..1,  // absolute mode: the game maps finger x to a value
});
drag.value; drag.active; drag.used; drag.mode = 'absolute'; drag.refresh(); drag.release();

const btn = Kit.Input.button(element, { onDown, onUp });    // btn.down, btn.release()
```
Every factory returns an object with `destroy()`.

## Invariants
- `keys` ignores events from text inputs, clears on window blur, and records
  press edges so `pressed()` is true once per physical press.
- `drag` tracks one pointer (the first one inside `zone`) with pointer
  capture. Buttons stop propagation, so a thumb on BRAKE and another
  steering work together.
- Elements need `touch-action: none` in CSS for drag to work on mobile.

## Used by
`client/input.js` builds `{ steer, brake, horn }`: ramped keys (0 to ±1 in
0.1 s), the drag axis in the lower 60% of the screen, BRAKE/HORN buttons.

## Tests
`kit/input/input.test.js`: ramp timing, key state with a fake target.

## Rebuild prompt
> UMD `Kit.Input` with `keys(target, captureCodes)`, `ramp(v, target, rate,
> dt)`, `drag(el, {zone, pxPerUnit, mode, absolute})` and `button(el,
> {onDown, onUp})` as documented. Use Pointer Events and setPointerCapture
> (wrapped in try/catch); listen to pointerup, pointercancel and
> lostpointercapture to release. Buttons add/remove a `down` CSS class and
> preventDefault on contextmenu.

## Evolving
Gamepad support fits as another source: poll `navigator.getGamepads()` in the
game's `sample()` and merge like the drag axis.
