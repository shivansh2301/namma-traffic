/*
 * client/input.js: keyboard + touch -> Input struct { steer, brake, horn }.
 * Built from kit/input primitives. Sampled once per sim tick.
 *
 * Keyboard: ← → / A D steer (ramped 0 -> ±1 over 0.1 s), ↓ / S brake,
 * Space / H horn, P / Esc pause.
 * Touch: drag horizontally in the lower 60% of the screen. 'drag' mode is
 * relative to where the touch started (60 px = full lock); 'follow' mode
 * steers toward the finger's x (SPEC §15 open question 2; switch in settings).
 */
(function (root) {
  'use strict';

  const LEFT = ['ArrowLeft', 'KeyA'];
  const RIGHT = ['ArrowRight', 'KeyD'];
  const BRAKE = ['ArrowDown', 'KeyS'];
  const HORN = ['Space', 'KeyH'];

  function create(canvas, btns, steerToward) {
    const keys = Kit.Input.keys(window, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
    const brakeBtn = Kit.Input.button(btns.brake);
    const hornBtn = Kit.Input.button(btns.horn);
    const drag = Kit.Input.drag(canvas, {
      pxPerUnit: 60,
      zone: (x, y, r) => y > r.top + r.height * 0.4,
      absolute: (clientX, r) => steerToward(clientX - r.left),
    });
    let kSteer = 0;
    const out = { steer: 0, brake: 0, horn: 0 };

    return {
      get touchUsed() { return drag.used; },
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
