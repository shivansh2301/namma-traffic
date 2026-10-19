/*
 * client/input.js: keyboard + touch -> Input struct { steer, brake, horn }.
 * Built from kit/input primitives. Sampled once per sim tick.
 *
 * Keyboard: ← → / A D steer (ramped 0 -> ±1 over 0.1 s), ↓ / S brake,
 * Space / H horn, P / Esc pause.
 * Touch: hold the LEFT HANDLE (bottom-left of the screen, drawn by the
 * renderer as a handlebar grip on a slide track) and slide it left/right.
 * 'drag' mode is relative to where the touch started (HANDLE_TRAVEL px =
 * full lock, less on narrow screens; the drawn grip follows the thumb); 'follow' mode steers
 * toward the finger's x (switch in settings). BRAKE and HORN are DOM
 * buttons on the right.
 */
(function (root) {
  'use strict';

  const LEFT = ['ArrowLeft', 'KeyA'];
  const RIGHT = ['ArrowRight', 'KeyD'];
  const BRAKE = ['ArrowDown', 'KeyS'];
  const HORN = ['Space', 'KeyH'];

  const HANDLE_TRAVEL = 70; // px of thumb travel for full steering lock
  // Narrow phones get a shorter track so it clears the BRAKE button (96 px + 16 px margin on the right).
  function handleTravel(w) { return Math.max(44, Math.min(HANDLE_TRAVEL, Math.floor((w - 216) / 2))); }

  function create(canvas, btns, steerToward) {
    const keys = Kit.Input.keys(window, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
    const brakeBtn = Kit.Input.button(btns.brake);
    const hornBtn = Kit.Input.button(btns.horn);
    // The left handle lives in the bottom-left of the screen; a generous zone so a thumb always finds it.
    const drag = Kit.Input.drag(canvas, {
      pxPerUnit: (r) => handleTravel(r.width),
      zone: (x, y, r) => y > r.top + r.height * 0.55 && x < r.left + r.width * 0.62,
      absolute: (clientX, r) => steerToward(clientX - r.left),
    });
    let kSteer = 0;
    const out = { steer: 0, brake: 0, horn: 0 };
    const handle = { active: false, value: 0, travel: HANDLE_TRAVEL };

    return {
      get touchUsed() { return drag.used; },
      /** What the renderer needs to draw the left-handle control. */
      handle() {
        handle.active = drag.active;
        handle.value = drag.active ? drag.value : 0;
        handle.travel = handleTravel(canvas.getBoundingClientRect().width);
        return handle;
      },
      setTouchMode(m) { drag.mode = m === 'follow' ? 'absolute' : 'relative'; },
      sample(dt) {
        const dir = (keys.any(RIGHT) ? 1 : 0) - (keys.any(LEFT) ? 1 : 0);
        kSteer = Kit.Input.ramp(kSteer, dir, 10, dt);
        if (drag.active && drag.mode === 'absolute') drag.refresh();
        out.steer = drag.active ? drag.value : kSteer;
        out.brake = keys.any(BRAKE) || brakeBtn.down ? 1 : 0;
        out.horn = keys.any(HORN) || hornBtn.down ? 1 : 0;
        return out;
      },
      /** True once per press of P or Esc. */
      pausePressed() {
        const a = keys.pressed('KeyP');
        const b = keys.pressed('Escape');
        return a || b;
      },
      reset() {
        kSteer = 0;
        keys.clear();
        drag.release();
        brakeBtn.release();
        hornBtn.release();
      },
    };
  }

  root.GameInput = { create };
})(window);
