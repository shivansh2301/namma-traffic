/*
 * Kit.Pwa: register a service worker safely.
 *
 *   Kit.Pwa.register('sw.js', { skip: location.search.includes('nosw') });
 *
 * Skips silently on file://, when unsupported, or when opts.skip is set.
 * Registers after the load event so it never competes with first paint.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Pwa = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function register(url, opts) {
    opts = opts || {};
    if (opts.skip) return false;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    if (typeof location !== 'undefined' && location.protocol === 'file:') return false;
    const go = () => navigator.serviceWorker.register(url).catch(() => { /* offline support is best-effort */ });
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
    return true;
  }

  return { register };
});
