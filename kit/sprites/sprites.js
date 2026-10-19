/*
 * Kit.Sprites: bake procedural drawings into offscreen canvases once,
 * then blit them every frame. Recipes draw in world units (e.g. metres)
 * centred on the origin; the cache handles pixel scale and padding.
 *
 *   const sprites = Kit.Sprites.create();
 *   sprites.register('car.0', 1.8, 4.3, (ctx) => { ctx.fillRect(-0.9, -2.15, 1.8, 4.3); });
 *   sprites.setScale(pxPerUnit * devicePixelRatio);   // (re)bakes every recipe
 *   sprites.draw(ctx, 'car.0', sx, sy, rotation, unitsToCssPx);
 *
 * Helpers: makeCanvas, roundRect, shade(hex, amount), hashColor.
 * Browser-only for baking; helpers are pure.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Sprites = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeCanvas(w, h) {
    w = Math.max(1, Math.ceil(w));
    h = Math.max(1, Math.ceil(h));
    if (typeof OffscreenCanvas !== 'undefined') {
      try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function create(opts) {
    opts = opts || {};
    const pad = opts.pad != null ? opts.pad : 0.25; // units of padding for shadows/outlines
    const recipes = new Map();
    const baked = new Map();
    let scale = opts.scale || 32; // device px per unit

    function bake(key) {
      const r = recipes.get(key);
      const wu = r.w + pad * 2;
      const hu = r.h + pad * 2;
      const c = makeCanvas(wu * scale, hu * scale);
      const g = c.getContext('2d');
      g.setTransform(scale, 0, 0, scale, (wu * scale) / 2, (hu * scale) / 2);
      r.draw(g, r.w, r.h);
      const s = { canvas: c, wu, hu };
      baked.set(key, s);
      return s;
    }

    const cache = {
      get scale() { return scale; },
      register(key, w, h, draw) {
        recipes.set(key, { w, h, draw });
        baked.delete(key);
      },
      has(key) { return recipes.has(key); },
      /** Change device-px-per-unit; sprites re-bake lazily on next use. */
      setScale(s) {
        if (Math.abs(s - scale) < 1e-6 && baked.size) return;
        scale = s;
        baked.clear();
      },
      get(key) { return baked.get(key) || (recipes.has(key) ? bake(key) : null); },
      /** Bake everything now (avoids hitches during play). */
      warm() { for (const k of recipes.keys()) cache.get(k); },
      /**
       * Draw centred at (x, y) CSS px, rotated by rot radians, at `ppu` CSS px per unit.
       * Leaves ctx transform as identity * baseTransform.
       */
      draw(ctx, key, x, y, rot, ppu, alpha) {
        const s = cache.get(key);
        if (!s) return;
        const w = s.wu * ppu;
        const h = s.hu * ppu;
        if (alpha != null && alpha < 1) ctx.globalAlpha = alpha;
        if (rot) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          ctx.drawImage(s.canvas, -w / 2, -h / 2, w, h);
          ctx.restore();
        } else {
          ctx.drawImage(s.canvas, x - w / 2, y - h / 2, w, h);
        }
        if (alpha != null && alpha < 1) ctx.globalAlpha = 1;
      },
      clear() { baked.clear(); },
    };
    return cache;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. amt in [-1, 1]. */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) {
      r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
    } else {
      r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
    }
    return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
  }

  /** Cheap deterministic hash of integers to [0,1). For cosmetic variety only. */
  function hash01(a, b, c) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((c | 0) + 0x5bd1e995, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  return { create, makeCanvas, roundRect, shade, hash01 };
});
