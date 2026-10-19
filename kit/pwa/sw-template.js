/*
 * Service worker template: precache + stale-while-revalidate.
 *
 * Copy next to your index.html, fill ASSETS with every file the game needs
 * (paths relative to this file; '../' is fine because a worker intercepts
 * every same-origin request its pages make), and bump VERSION on release.
 *
 * - install: precache ASSETS into CACHE, activate immediately.
 * - activate: delete caches from older versions, take control of open pages.
 * - fetch (GET, same origin): answer from cache at once, refresh the cache
 *   from the network in the background. Navigations fall back to index.html.
 *   The result: instant offline play, and edits show up on the next reload.
 */
const VERSION = 'v1';
const CACHE = 'app-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  // './main.js', '../shared/sim.js', ...
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        if (hit) {
          e.waitUntil(net);
          return hit;
        }
        return net.then((res) => res || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
      })
    )
  );
});
