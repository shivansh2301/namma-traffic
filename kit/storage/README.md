# Kit.Storage: persistence that never throws

## Purpose
`localStorage` throws in private windows, with blocked cookies, in sandboxed
iframes and when the quota is full. Games must still work. This wraps every
access in try/catch and silently falls back to memory.

## API
```js
const store = Kit.Storage.create('nc.');               // key prefix; optional backend {getItem,setItem,removeItem}
store.persistent;                                      // false when using the memory fallback
const s = store.get('settings', { muted: false });     // missing/corrupt -> deep copy of fallback
store.set('settings', s);                              // true on success
store.remove('settings');
Kit.Storage.memoryBackend();                           // for tests
```

## Invariants
- Values are JSON. `get` merges stored plain objects over plain-object
  fallbacks, so new settings fields get defaults automatically.
- `get` returns copies, never the fallback object itself.

## Used by
`client/main.js`: `nc.settings`, `nc.progress`, `nc.rider` (skill XP and tips).

## Tests
`kit/storage/storage.test.js`: prefix round trip, default merging, throwing backend, corrupt JSON.

## Rebuild prompt
> UMD `Kit.Storage.create(prefix, backend?)`: pick `localStorage` inside
> try/catch; probe it with a set/get/remove of a temp key; on any failure
> use an in-memory Map backend. `get(key, fallback)` parses JSON in
> try/catch, returns a JSON clone of the fallback when missing or invalid, and
> merges objects over object fallbacks. `set` stringifies in try/catch.

## Evolving
Cloud sync later: keep this API and add an async mirror that pushes on `set`;
the game code does not change.
