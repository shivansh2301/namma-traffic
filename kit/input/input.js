/*
 * Kit.Input: small, framework-free input primitives for action games.
 *
 *   const keys = Kit.Input.keys(window, ['ArrowLeft','KeyA','Space']); // e.code values
 *   keys.down('ArrowLeft'); keys.any(['ArrowLeft','KeyA']); keys.pressed('KeyP');
 *
 *   value = Kit.Input.ramp(value, target, ratePerSec, dt)   // analogue feel for keys
 *
 *   const drag = Kit.Input.drag(el, { zone, pxPerUnit: 60, mode: 'relative', absolute });
 *   drag.value  // -1..1 while a steering pointer is down, else 0
 *
 *   const btn = Kit.Input.button(el, { onDown, onUp });  btn.down
 *
 * All listeners use Pointer Events, so mouse, pen and touch behave the same.
 * Every factory returns an object with destroy(). Browser-only.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Input = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Keyboard state by KeyboardEvent.code. preventDefault on the listed codes. */
  function keys(target, captureCodes) {
    const held = new Set();
    const edges = new Set(); // pressed since last pressed() read
    const capture = new Set(captureCodes || []);
    function isTyping(e) {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    }
    function onDown(e) {
      if (isTyping(e)) return;
      if (capture.has(e.code)) e.preventDefault();
      if (!held.has(e.code)) edges.add(e.code);
      held.add(e.code);
    }
    function onUp(e) {
      if (capture.has(e.code)) e.preventDefault();
      held.delete(e.code);
    }
    function onBlur() { held.clear(); }
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
    return {
      down(code) { return held.has(code); },
      any(codes) { for (let i = 0; i < codes.length; i++) if (held.has(codes[i])) return true; return false; },
      /** True once per physical press. */
      pressed(code) { const p = edges.has(code); edges.delete(code); return p; },
      clear() { held.clear(); edges.clear(); },
      destroy() {
        target.removeEventListener('keydown', onDown);
        target.removeEventListener('keyup', onUp);
        target.removeEventListener('blur', onBlur);
      },
    };
  }

  /** Move value toward target at ratePerSec (e.g. 10 = full scale in 0.1 s). */
  function ramp(value, target, ratePerSec, dt) {
    const d = target - value;
    const step = ratePerSec * dt;
    if (Math.abs(d) <= step) return target;
    return value + Math.sign(d) * step;
  }

  /**
   * One-pointer horizontal drag axis.
   *   zone(x, y, rect) -> bool   where a pointerdown may start steering (client coords)
   *   mode 'relative': value = clamp((x - startX) / pxPerUnit)   (pxPerUnit may be a function of rect)
   *   mode 'absolute': value = absolute(clientX, rect) supplied by the game
   */
  function drag(el, opts) {
    const o = Object.assign({ pxPerUnit: 60, mode: 'relative', zone: () => true, absolute: null }, opts);
    const st = { value: 0, active: false, pointerId: -1, startX: 0, x: 0, mode: o.mode, used: false };
    function rect() { return el.getBoundingClientRect(); }
    function update() {
      if (!st.active) { st.value = 0; return; }
      if (st.mode === 'absolute' && o.absolute) st.value = clamp1(o.absolute(st.x, rect()));
      else st.value = clamp1((st.x - st.startX) / (typeof o.pxPerUnit === 'function' ? o.pxPerUnit(rect()) : o.pxPerUnit));
    }
    function onDown(e) {
      if (st.active) return;
      const r = rect();
      if (!o.zone(e.clientX, e.clientY, r)) return;
      st.active = true;
      st.used = true;
      st.pointerId = e.pointerId;
      st.startX = st.x = e.clientX;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ }
      update();
      e.preventDefault();
    }
    function onMove(e) {
      if (!st.active || e.pointerId !== st.pointerId) return;
      st.x = e.clientX;
      update();
    }
    function onUp(e) {
      if (e.pointerId !== st.pointerId) return;
      st.active = false;
      st.pointerId = -1;
      update();
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    st.refresh = update; // call each tick in absolute mode (the target moves)
    st.release = () => { st.active = false; st.pointerId = -1; st.value = 0; };
    st.destroy = () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
    };
    return st;
  }

  /** Hold-to-press button. Works with multi-touch alongside a drag axis. */
  function button(el, opts) {
    const o = opts || {};
    const st = { down: false, pointerId: -1 };
    function onDown(e) {
      e.preventDefault();
      e.stopPropagation();
      st.down = true;
      st.pointerId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      el.classList.add('down');
      if (o.onDown) o.onDown();
    }
    function onUp(e) {
      if (e.pointerId !== st.pointerId) return;
      st.down = false;
      st.pointerId = -1;
      el.classList.remove('down');
      if (o.onUp) o.onUp();
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    st.release = () => { st.down = false; st.pointerId = -1; el.classList.remove('down'); };
    st.destroy = () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
    };
    return st;
  }

  function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

  return { keys, ramp, drag, button };
});
