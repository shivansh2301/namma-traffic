/*
 * Kit.Camera: top-down scrolling camera for "drive up the screen" games.
 *
 * World units are metres with +y pointing up the screen (direction of travel).
 * The target is anchored at `anchorY` of the screen height (0 = top, 1 = bottom).
 * The visible width eases between viewMin and viewMax as speedFrac goes 0..1,
 * so the view zooms out at speed. Horizontal follow is eased and clamped.
 * Screen shake uses a trauma model (shake = trauma^2) and can be disabled.
 *
 *   const cam = Kit.Camera.create({ viewMin: 18, viewMax: 21, anchorY: 0.8 });
 *   cam.resize(cssW, cssH);
 *   cam.update(frameDt, targetX, targetY, speedFrac, minX, maxX);
 *   const sx = cam.sx(wx), sy = cam.sy(wy);   // CSS pixels
 *
 * UMD, no dependencies, no DOM access.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Camera = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(opts) {
    opts = opts || {};
    const cam = {
      viewMin: opts.viewMin || 18,
      viewMax: opts.viewMax || 21,
      anchorY: opts.anchorY != null ? opts.anchorY : 0.8,
      followX: opts.followX || 5, // 1/s, horizontal easing rate
      zoomRate: opts.zoomRate || 1.5, // 1/s, zoom easing rate
      maxShake: opts.maxShake || 0.35, // metres at trauma 1
      reduceShake: false,
      w: 1, h: 1, // CSS px
      x: 0, y: 0, // world point under the anchor
      viewW: opts.viewMin || 18,
      ppm: 1, // CSS px per metre
      trauma: 0,
      shakeX: 0, shakeY: 0,
      _t: 0,
      snapped: false,

      resize(w, h) {
        cam.w = Math.max(1, w);
        cam.h = Math.max(1, h);
        cam.ppm = cam.w / cam.viewW;
      },

      /** Jump without easing (level start, respawn far away). */
      snap(x, y, speedFrac) {
        cam.viewW = cam.viewMin + (cam.viewMax - cam.viewMin) * clamp01(speedFrac || 0);
        cam.ppm = cam.w / cam.viewW;
        cam.x = x;
        cam.y = y;
        cam.snapped = true;
      },

      update(dt, tx, ty, speedFrac, minX, maxX) {
        if (!cam.snapped) cam.snap(tx, ty, speedFrac);
        const wantW = cam.viewMin + (cam.viewMax - cam.viewMin) * clamp01(speedFrac);
        cam.viewW += (wantW - cam.viewW) * (1 - Math.exp(-cam.zoomRate * dt));
        cam.ppm = cam.w / cam.viewW;
        cam.x += (tx - cam.x) * (1 - Math.exp(-cam.followX * dt));
        if (minX != null && maxX != null) {
          const half = cam.viewW / 2;
          if (maxX - minX <= cam.viewW) cam.x = (minX + maxX) / 2;
          else cam.x = Math.min(maxX - half, Math.max(minX + half, cam.x));
        }
        cam.y = ty;
        cam._t += dt;
        cam.trauma = Math.max(0, cam.trauma - dt * 1.6);
        if (cam.reduceShake || cam.trauma <= 0) {
          cam.shakeX = cam.shakeY = 0;
        } else {
          const s = cam.trauma * cam.trauma * cam.maxShake;
          cam.shakeX = s * Math.sin(cam._t * 47.3) * Math.cos(cam._t * 13.1);
          cam.shakeY = s * Math.sin(cam._t * 39.7 + 1.3);
        }
      },

      /** Add trauma in [0,1]; shake grows with trauma squared. */
      shake(amount) {
        if (!cam.reduceShake) cam.trauma = Math.min(1, cam.trauma + amount);
      },

      sx(wx) { return (wx - cam.x - cam.shakeX) * cam.ppm + cam.w / 2; },
      sy(wy) { return cam.h * cam.anchorY - (wy - cam.y - cam.shakeY) * cam.ppm; },
      wx(sx) { return (sx - cam.w / 2) / cam.ppm + cam.x + cam.shakeX; },
      wy(sy) { return (cam.h * cam.anchorY - sy) / cam.ppm + cam.y + cam.shakeY; },
      /** World y at the top and bottom screen edges. */
      top() { return cam.y + (cam.h * cam.anchorY) / cam.ppm; },
      bottom() { return cam.y - (cam.h * (1 - cam.anchorY)) / cam.ppm; },
      left() { return cam.x - cam.viewW / 2; },
      right() { return cam.x + cam.viewW / 2; },
    };
    return cam;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  return { create };
});
