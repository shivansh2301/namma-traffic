/*
 * Kit.Storage: JSON key/value persistence that never throws.
 *
 *   const store = Kit.Storage.create('nc.');           // key prefix
 *   const s = store.get('settings', { muted: false });  // fallback when missing or broken
 *   store.set('settings', s);
 *
 * Every localStorage access is wrapped in try/catch (private mode, blocked
 * cookies, quota, sandboxed iframes). If storage is unusable it silently
 * falls back to an in-memory map, so the game works and only loses
 * persistence. `store.persistent` tells you which one you got.
 * Pass a backend with getItem/setItem/removeItem to override (tests, Node).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Storage = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function memoryBackend() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
    };
  }

  function probe(b) {
    try {
      const k = '__kit_probe__';
      b.setItem(k, '1');
      const ok = b.getItem(k) === '1';
      b.removeItem(k);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function create(prefix, backend) {
    prefix = prefix || '';
    let b = backend || null;
    if (!b) {
      try { b = typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { b = null; }
    }
    const persistent = !!b && probe(b);
    if (!persistent) b = memoryBackend();

    return {
      persistent,
      get(key, fallback) {
        try {
          const raw = b.getItem(prefix + key);
          if (raw == null) return clone(fallback);
          const v = JSON.parse(raw);
          // Merge over plain-object fallbacks so new settings get their defaults.
          if (isPlain(fallback) && isPlain(v)) return Object.assign(clone(fallback), v);
          return v;
        } catch (_) {
          return clone(fallback);
        }
      },
      set(key, value) {
        try { b.setItem(prefix + key, JSON.stringify(value)); return true; } catch (_) { return false; }
      },
      remove(key) {
        try { b.removeItem(prefix + key); } catch (_) { /* ignore */ }
      },
    };
  }

  function isPlain(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  return { create, memoryBackend };
});
