/*
 * Service worker: precache + stale-while-revalidate (from kit/pwa/sw-template.js).
 * Bump VERSION when shipping. ASSETS must list every file index.html loads
 * (tests/purity.test.js checks this).
 */
const VERSION = 'v5';
const CACHE = 'namma-commute-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  '../kit/rng/rng.js',
  '../kit/fixed-step/fixed-step.js',
  '../kit/camera/camera.js',
  '../kit/input/input.js',
  '../kit/synth/synth.js',
  '../kit/sprites/sprites.js',
  '../kit/particles/particles.js',
  '../kit/storage/storage.js',
  '../kit/pwa/register.js',
  '../shared/world.js',
  '../shared/sim.js',
  '../shared/bot.js',
  './lines.js',
  './input.js',
  './hud.js',
  './render.js',
  './render-top.js',
  './audio.js',
  './main.js',
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
