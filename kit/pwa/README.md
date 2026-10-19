# Kit.Pwa: installable, offline-capable static games

## Purpose
Make a no-build static game installable and playable offline: a safe
registration helper and a service-worker template (precache +
stale-while-revalidate).

## API
```js
Kit.Pwa.register('sw.js', { skip: false });  // returns true if registration was attempted
```
`sw-template.js`: copy next to your `index.html`, fill `ASSETS`, bump `VERSION` on release.

## Invariants
- Registration is skipped on `file://`, when unsupported, or with `skip`, and
  waits for `load` so it never competes with first paint.
- A worker at `client/sw.js` controls pages under `client/` but intercepts
  every same-origin request they make, so `'../shared/sim.js'` can be precached.
- Fetch strategy: answer from cache at once, refresh the cache from the
  network in the background. Navigations fall back to `index.html` offline.
  Edits appear on the second reload after a deploy.
- Namma Commute skips the worker on localhost unless `?sw`, so development
  reloads are never stale.

## Used by
`client/main.js` (registration), `client/sw.js` (the filled-in template),
`client/manifest.webmanifest` (name, standalone display, portrait, SVG icon).
`tests/purity.test.js` fails if a script in `index.html` is missing from `ASSETS`.

## Rebuild prompt
> UMD `Kit.Pwa.register(url, {skip})` (guard navigator.serviceWorker,
> file:, document.readyState). Template worker: install = caches.open(CACHE)
> .addAll(ASSETS) then skipWaiting; activate = delete other caches then
> clients.claim; fetch (GET, same origin) = cache.match(ignoreSearch) and
> a network fetch that cache.put()s ok responses; return the hit and
> waitUntil the refresh, else the network response, else index.html for
> navigations.

## Evolving
For larger games, split ASSETS into "shell" (precache) and "levels"
(cache on first use).
