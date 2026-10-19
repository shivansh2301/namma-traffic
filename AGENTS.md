# AGENTS.md: start here

Namma Commute: a browser game about riding a Yolo (small EV scooter) through
Bengaluru traffic, seen from just behind the scooter (or from the seat), in two modes: **Office commute** (reach the
tech park by 10:00, levels 1–3) and **Grocery delivery** (10-minute orders to
apartment towers and gully houses, levels 4–6). Plain JavaScript, Canvas 2D, Web Audio,
no build step, no runtime dependencies. `SPEC.md` is the original v1 spec;
`docs/DECISIONS.md` lists where the build deliberately differs.

## Run, test, look
```bash
export PATH="$PWD/.tools/node/bin:$PATH"     # local Node 22 (gitignored); any Node >= 20 works
python3 -m http.server 8000                  # then open http://localhost:8000/client/
node --test                                  # everything: kit units, sim rules, karma, client smoke, 20-seed bot runs (~4 min)
node --test tests/sim.test.js tests/rules.test.js tests/karma.test.js   # fast inner loop
node tools/calibrate.js 20                   # suggested level start times after balance changes
node tools/snapshot.js 2 4 110 .work/a.png   # render a real frame to PNG (level seed seconds out [chase|first|top][+touch])
```
`tools/snapshot.js` needs `npm install --prefix .tools/canvas @napi-rs/canvas dejavu-fonts-ttf`.
Handy URLs: `/client/?level=2&seed=123`, `&view=top`, `&debug`, `&sw` (enable the service worker on localhost).

## Map
```
SPEC.md                    original spec (v1)
AGENTS.md / CLAUDE.md      this guide
LICENSE                    proprietary, all rights reserved (temporary); do not relicense without the owner
index.html, .nojekyll      GitHub Pages: root redirects to client/; serve files as-is
docs/DECISIONS.md          deviations from the spec and why
docs/concepts/             design concepts (read the one for the area you touch)
  deterministic-sim.md       sim contract, tick order, events, bot, multiplayer path, debugging
  road-and-levels.md         coordinates, cross-sections, level format and authoring rules
  traffic-and-npc-life.md    vehicles, following, lane changes, courtesy, spawning, jams, NPC interactions
  karma-and-luck.md          karma, fights, good deeds, luck events, rider skill, score
  delivery-missions.md       the two modes, delivery shifts, drop zones, ratings, areas, busy gullies, junctions
  first-person-view.md       pseudo-3D projection, chase camera vs cockpit, bends, draw order, touch left handle
  procedural-art.md          palette, silhouettes, streets, tone of voice
kit/                       reusable, game-agnostic components, each with README + test (see kit/README.md)
shared/world.js            tunables T, VEHICLES, PED, LEVELS, geometry helpers, skill levels (pure)
shared/sim.js              deterministic simulation: create/step/result/score (pure)
shared/bot.js              scripted rider for tests, calibration and the title demo (pure)
client/index.html          page, CSS, screens; loads every script with <script defer>
client/main.js             loop, screens, toasts, persistence, PWA registration
client/render.js           road renderer: chase camera (default) and cockpit
client/render-top.js       top-down map renderer
client/hud.js              shared HUD and the touch left-handle control
client/input.js            keyboard + touch -> { steer, brake, horn }
client/audio.js            synthesised sounds (EV motor, horns, splashes, luck chimes)
client/sw.js, manifest.webmanifest, icon.svg   offline/PWA
tests/                     node:test suites (helpers.js has bareState/stepN/botFinish)
tools/calibrate.js         bot-based start-time tuning
tools/snapshot.js          headless frame rendering
.tools/ .work/             local toolchain and scratch (gitignored)
```

## Invariants (do not break)
1. `shared/*.js` stay pure and deterministic: no DOM, `Date`, `performance`,
   `Math.random`; randomness only through `World.Rng` on state. State stays
   plain JSON. (`tests/purity.test.js`, `tests/sim.test.js`)
2. Every tunable lives in `World.T`; every level in `World.LEVELS`.
3. Every level must be finished by the bot on seeds 1–20 (`tests/complete-l*.test.js`).
   If you change traffic or player physics and a seed fails, debug the
   deadlock (`Sim.debugLeader`, `Bot.create({ trace: true })`) rather than
   weakening the test.
4. Levels obey the authoring rules in `docs/concepts/road-and-levels.md` (test-enforced).
5. Every script in `index.html` is precached in `client/sw.js` (test-enforced);
   bump `VERSION` there when shipping.
6. Payload ≤ 200 KB gzipped (test-enforced). Text ≥ 14 px. Keyboard-only and
   touch-only must both work. Satire targets infrastructure, not people.

## Recipes
- **New tunable or balance change:** edit `World.T` → `node --test tests/rules.test.js tests/karma.test.js`
  → `node tools/calibrate.js` → update `start` times → full `node --test`.
- **New level:** follow "Adding a level" in `docs/concepts/road-and-levels.md`; set `mode`
  (commute needs a `destination`, delivery needs `drops` and `clockRate: 3`); add a
  `tests/complete-l<id>.test.js` (copy one of the same mode).
- **New vehicle type:** add to `VEHICLES` (size, speeds, lcTime, gapNeed,
  variants) and to level `mix`; add `HGT[kind]` and front/rear sprite recipes
  in `client/render.js` (`registerSprites`), a top-down recipe in
  `client/render-top.js`, a horn in `client/audio.js`; snapshot it.
- **New hazard:** place it in `create` (layout stream) or spawn it at runtime
  (run stream); interact in `updatePlayer`; emit an event; draw it in both
  renderers (ground items go in `drawGround`, upright ones in `collect`);
  add a rule test.
- **New karma deed or luck event:** add to `deedsTick` / `luck()` and the
  `LUCK_GOOD` / `LUCK_BAD` weights; add toast text in `client/main.js`
  (`DEED_TEXT` / `LUCK_TEXT`) and an HUD chip in `client/hud.js` if it is timed.
- **New NPC interaction:** add a mode/state to the record (initialise it in
  `newNpc`/`newPed` so JSON stays consistent), emit an event, add bubble
  lines in `client/render.js` `onEvents`; add it to the NPC-life test.
- **Reusable piece of code?** Put it in `kit/` with a README (see `kit/README.md`).

## Rebuilding from scratch (cheapest path)
1. `kit/*`: regenerate each from its README "Rebuild prompt"; run its test.
2. `shared/world.js` from `road-and-levels.md` + the tunables table in
   `karma-and-luck.md` (copy `LEVELS` from git history if available).
3. `shared/sim.js` from `deterministic-sim.md`, `traffic-and-npc-life.md`,
   `karma-and-luck.md`; then `shared/bot.js`; then run the tests and fix deadlocks
   with the debugging recipes.
4. `client/*` from `first-person-view.md` and `procedural-art.md`; check with
   `tools/snapshot.js` and `tests/client-smoke.test.js`.

## Status (2026-10-19)
v1 spec milestones M1–M6 are built, plus: first-person view, Yolo, karma
economy (fights, deeds, luck, skill, tips), bends and turns, NPC life, more cars
and kerb parking, tech-park finishes, and the grocery delivery mode (gullies,
towers, drop zones, ratings), short ~2-minute trips, parody brand names,
phone touch controls (a visible left handle to steer, BRAKE/HORN buttons, auto
quality), a chase camera behind the scooter as the default view, and random
busy gully stretches. All tests pass (`node --test`). Not yet verified on a
real phone.
