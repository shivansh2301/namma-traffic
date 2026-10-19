# Namma Commute — Single-Player Spec (v1)

*Working title.* A browser game about riding a scooter to the office through Bengaluru traffic: wrong-side riders, potholes, missing footpaths, puddles and everything else on the road.

Status: draft v1 · Scope: single-player only, built so multiplayer can be added later without a rewrite.

---

## 1. Goals and non-goals

**Goals**
- Opens in a browser and is playable in under 3 seconds on a mid-range Android phone over 4G. No install and no login.
- The basic loop is fun: weave, brake, dodge, and get to the office on time with your karma intact.
- The hazards feel authentically Bengaluru. The game mocks the infrastructure, never the people on the road.
- The simulation is deterministic and shared, so the same `sim.js` can later run on a Node server (see §11).

**Non-goals for v1**
- Multiplayer, emotes, accounts, leaderboards, monetisation.
- Image or audio asset files. All graphics are drawn in code and all sound is synthesised.
- Traffic signals, traffic police, endless mode. These are listed under §14.

## 2. Platform and tech constraints

| Constraint | Value |
|---|---|
| Language | Plain JavaScript (ES2020), loaded with `<script>` tags. No framework, bundler or build step. |
| Rendering | Canvas 2D. Sprites are pre-rendered to offscreen canvases at load time. |
| Audio | Web Audio API with oscillators and noise buffers only. |
| Runtime dependencies | None. Node ≥ 20 is used only for tests. |
| Targets | Android Chrome (primary), desktop Chrome/Firefox/Safari, iOS Safari. |
| Orientation | Portrait first. On landscape or desktop, the game sits in a portrait column (aspect clamped between 9:16 and 3:4) with decorative side bars. |
| Payload budget | ≤ 200 KB gzipped in total. |
| Frame budget | 60 fps rendering with ≤ 80 on-screen entities on a mid-range Android phone. Sim step ≤ 2 ms. |
| Offline | PWA manifest plus a service worker, so the game can be installed and played offline. |

## 3. Architecture

```
blr-commute/
  SPEC.md
  shared/world.js     # constants, tunables, level data, geometry/collision helpers, seeded RNG
  shared/sim.js       # deterministic simulation: step(state, input) → events
  client/index.html
  client/input.js     # keyboard + touch → Input struct
  client/render.js    # camera, sprite cache, ground/entity/particle/HUD drawing
  client/audio.js     # synthesised engine, horn, splash, thud, rain
  client/main.js      # game loop, screens, persistence
  client/manifest.webmanifest, client/sw.js, client/icon.svg
  tests/sim.test.js   # node:test, headless sim runs
```

For development, serve the repo root with any static server (for example `python3 -m http.server`) and open `/client/`.

### 3.1 Shared modules (UMD)

`world.js` and `sim.js` use a UMD wrapper. `require()` returns the module in Node, and in the browser it attaches to `window.World` and `window.Sim`. Neither file may touch the DOM, `window`, `Date`, `performance`, `Math.random`, or anything else that depends on rendering.

### 3.2 Sim API

```js
const state  = Sim.create(levelId, seed);   // plain JSON-serialisable object
const events = Sim.step(state, input);      // advances exactly one tick, mutates state
const result = Sim.result(state);           // null while playing, else Result (§9.3)

// Input (one per tick)
{ steer: -1..1, brake: 0|1, horn: 0|1 }
```

- Fixed timestep: `DT = 1/30` s, so 30 ticks per real second.
- The RNG is a seeded mulberry32 whose integer state lives in `state.rng`, so state stays serialisable and replayable.
- `step` returns an array of **events** for this tick, which the client turns into effects and sound:
  `horn`, `splash {x,y,by,size}`, `pedSplashed {pedId,byPlayer}`, `pothole {x,y,speed}`, `bump {kind}`, `crash {with}`, `screenSplash`, `honkNpc`, `arrive`, `breakdown`.
- The sim holds no render state: no particles, shake or animation timers. Animation state that affects gameplay, such as `wobble` and `crashTimer`, lives in the sim.

### 3.3 Client loop

- The sim runs on a fixed-timestep accumulator driven by `requestAnimationFrame`.
- Before each step, the client copies every entity's previous `x,y`. The renderer interpolates between the previous and current positions with `alpha = accumulator / DT`.
- Inputs are sampled once per sim tick.
- The game auto-pauses on `visibilitychange` (hidden) and on window blur.

## 4. World model

### 4.1 Coordinates and units
- Units are metres and seconds. `y` increases in the direction of travel, so the road scrolls *upward* on screen. `x` increases to the right.
- **India drives on the left.** The player's carriageway is the left part of the road. On undivided roads, oncoming lanes are to the right and their traffic moves down the screen.
- `x = 0` is the left kerb of the carriageway. A left footpath, if present, occupies `[-FOOTPATH_W, 0]`.

### 4.2 Road sections
A level is an ordered list of **segments**. Each segment sets the road properties for its length:

```js
{
  len: 200,                 // metres
  road: 'undivided' | 'divided',
  lanesOwn: 1..3,           // lanes in the player's direction (LANE_W = 3.5 m)
  lanesOncoming: 0..2,      // undivided only
  footpathL: true|false,    // false = missing footpath → dirt shoulder + pedestrians on road
  footpathR: true|false,    // undivided only (far side)
  traffic: 0..1,            // same-direction density (1 = gridlock)
  oncoming: 0..1,
  wrongSide: 0..1,          // wrong-side rider spawn rate
  potholes: 0..1, puddles: 0..1, peds: 0..1, cows: 0..1,
  jam: false,               // stop-go jam zone (§6.4)
  features: [ {kind:'speedBreaker', at:120, marked:false},
              {kind:'busStop', at:60},
              {kind:'barricade', at:20, len:80, lanes:[0]} ]
}
```

- **Divided roads:** a median with plants is drawn after the last own lane, and the player cannot cross it. The far carriageway is decoration only and is not simulated.
- **Undivided roads:** the player may move into oncoming lanes to overtake. There is no karma penalty, but head-on crashes are severe (§7.5).
- The outer edges (buildings and shop fronts) are hard walls, and the player's `x` is clamped to them.
- Lane markings fade and disappear at random. This is cosmetic only.

### 4.3 Hazard placement
When the level is created, potholes, puddles, cows and the initial pedestrians are placed procedurally from the level seed and the segment densities, and hand-placed `features` are added. With the same seed, the layout is identical on every run.

## 5. Player

### 5.1 Controls

Throttle is **automatic**. The scooter accelerates toward its maximum speed unless the player brakes. The player's job is steering, braking and honking.

| Action | Keyboard | Touch |
|---|---|---|
| Steer | ← → or A D | Drag horizontally anywhere in the lower 60% of the screen. `steer = clamp(dx / 60px, -1, 1)`, measured from where the touch started. |
| Brake | ↓, S | Large button at bottom right |
| Horn | Space, H | Smaller button above Brake |
| Pause | P, Esc | Pause icon at top right |

Keyboard steering ramps from 0 to ±1 over 0.1 s, so it feels analogue.

### 5.2 Motion (initial tunables, all in `world.js`)

| Tunable | Value |
|---|---|
| `MAX_SPEED` | 12.5 m/s (45 km/h) |
| `ACCEL` | 2.8 m/s² |
| `BRAKE_DECEL` | 7.0 m/s² (×0.7 in rain) |
| `COAST_DECEL` | 0.5 m/s² (only while wobbling or crashed) |
| Lateral speed | `steer × min(4.0, 1.2 + 0.25 × v)` m/s, so the scooter can still shuffle sideways in a jam |
| Player hitbox | 0.8 × 1.9 m |

- **Wobble:** after a pothole or bump, steering effectiveness is halved for 0.6 s and small lateral jitter is added.
- **Kerb:** moving between road and footpath at more than 5 m/s multiplies speed by 0.6 and costs 2 condition.

### 5.3 Meters
- **Condition** goes from 100 to 0. At 0 the bike breaks down and the run ends ("Bike went to the mechanic").
- **Karma** goes from 100 to 0. It feeds into the score and stars. It never ends the run.
- **Clock:** game time advances 12 game seconds per real second. Each level has a start time and a 10:00 deadline.

## 6. Traffic

### 6.1 Vehicle types

| Type | Size w×l (m) | Desired speed (m/s) | Personality |
|---|---|---|---|
| Two-wheeler | 0.8 × 1.9 | 9–13 | Weaves, filters between lanes, changes lane often |
| Auto-rickshaw (green body, yellow top) | 1.4 × 2.7 | 7–10 | Cuts in abruptly. 2% chance per 10 s to stop dead for a passenger |
| Car / cab | 1.8 × 4.3 | 8–12 | Stays in lane. Cabs occasionally stop for a pickup |
| Bus | 2.6 × 12 | 6–9 | Pulls to the left lane and stops 5 s at bus stops. Sometimes stops anywhere |
| Water tanker | 2.4 × 8 | 6–8 | Slow. Leaks, leaving a wet patch that counts as a puddle |
| Cow | 0.9 × 2.1 | 0–0.5 | Sits or ambles in lane. Never yields |

Each spawned vehicle gets a desired speed sampled from its range (×0.85 in rain) and a random colour variant.

### 6.2 Same-direction behaviour
- **Car-following:** target gap = `2 m + 0.8 s × speed`. Decelerate (up to 6 m/s²) when closer than the target gap and accelerate (2 m/s²) otherwise.
- **Lane change:** happens when blocked for more than 1 s and the adjacent lane has a gap. It takes 1.2 s (autos 0.7 s and two-wheelers 0.5 s, with smaller gap requirements of 1.0 m at the sides).
- **Filtering:** two-wheeler NPCs, like the player, may sit between lanes when there is ≥ 1.0 m of lateral clearance.
- NPCs never collide with each other. Following and lane-change rules keep them apart, and rare visual overlaps are acceptable.

### 6.3 Spawning
- Target density is `traffic × 4` vehicles per 100 m per lane. Mix weights for each segment come from the level data.
- Vehicles spawn 40–80 m ahead of the player, out of view. They despawn when more than 40 m behind or more than 120 m ahead.
- **Overtakers from behind:** when the player is slower than a sampled NPC desired speed, that NPC may spawn 30–40 m behind. A small arrow at the bottom edge of the screen marks where it is coming from.

### 6.4 Jam zones (`jam: true`)
- Same-direction desired speed is capped at 1–3 m/s, with a stop-go wave of about 8 s period that travels backward through the queue.
- Density is forced to ≥ 0.85.
- In a jam, filtering is the player's main skill. Hitboxes alone decide whether the scooter fits through a gap.

### 6.5 Oncoming traffic (undivided roads)
Oncoming vehicles drive in the right-hand lanes toward the player with the same following logic, mirrored. They do not dodge a player who has moved into their lane, except when the player honks (§7.4).

### 6.6 Wrong-side riders
- Two-wheelers, and occasionally autos, travel *against* traffic inside the player's carriageway at 6–9 m/s, usually within 1.5 m of the left kerb.
- **Telegraph:** a headlight glow appears at the top edge 2 s before the rider enters the screen, together with a short double-beep. The telegraph must be shape-based as well as colour-based (§12).
- They hold their line. If the player honks within 15 m, there is a 50% chance they swerve toward the kerb.

## 7. Hazards

### 7.1 Potholes
- Dark irregular ellipses with radius 0.4–1.2 m.
- Hitting one at more than 3 m/s multiplies speed by 0.55, costs `2 + 0.6 × v` condition, and triggers a wobble and a `pothole` event (thud sound and screen shake).
- NPC two-wheelers steer around visible potholes. Other NPCs ignore them.

### 7.2 Puddles
- Grey-blue ellipses, 1–4 m across.
- Driving through one multiplies speed by 0.85 per entry and emits a `splash` event.
- **Hidden potholes:** in rain, 50% of potholes that overlap a puddle are invisible until hit.
- **Splashing pedestrians:** if any vehicle passes through a puddle at more than 5 m/s with a pedestrian within 2 m to the side and 2 m along the road, that pedestrian is splashed. They stop for 1 s and a bubble says "Ayyo!". If the player caused it, karma −10.
- **Getting splashed:** a bus, tanker or car hitting a puddle within 2.5 m of the player at more than 5 m/s relative speed emits `screenSplash`. Water splatters the screen and fades over 1.5 s (visual only).

### 7.3 Missing footpaths and pedestrians
- Where `footpathL` is false, the edge is a dirt shoulder with rubble. Pedestrians walk *on the road* within 1.2 m of the kerb, in both directions, at 1.1–1.5 m/s.
- Where a footpath exists, pedestrians use it. The player may ride on it (Bengaluru style), but it drains karma at 3/s, slabs are broken (minor bumps), and pedestrian density is ×1.5.
- Pedestrians sometimes cross the road at 1.2 m/s. A crossing pedestrian pauses if a vehicle is within 6 m in their path, but they do not account for the player's speed, so the player still has to brake.
- Hitting a pedestrian ends in a non-graphic stumble and a shouted bubble. It counts as a crash (§7.5), costs condition −10, and karma −30.

### 7.4 Horn
- 0.3 s cooldown. Each honk emits a `horn` event.
- **Effects:**
  - Pedestrians up to 10 m ahead and within ±2 m step 0.6 m toward the nearest edge over 0.5 s.
  - NPC two-wheelers and autos up to 12 m ahead in the same lane shift aside (50% chance) if there is room.
  - Wrong-side riders react as in §6.6.
- **Karma cost:** the first 3 honks in any rolling 10 s window are free. Each extra honk costs 1 karma.
- NPCs honk at random for ambience, which is audio only.

### 7.5 Crashes
Colliding with a vehicle, cow, pedestrian or barricade:
1. Speed drops to 0. A 1.5 s fall animation plays, then the player respawns at the same `y`, at the nearest free `x`.
2. The player is invulnerable for 2 s afterwards and blinks.
3. Condition cost:

| Collision | Condition |
|---|---|
| Vehicle | −20 |
| Head-on with oncoming vehicle | −30 |
| Cow | −20 (also karma −20) |
| Barricade | −15 |
| Pedestrian | −10 (also karma −30) |

### 7.6 Other features
- **Speed breakers:** full-width stripes. Unmarked ones are the same colour as the road. Going over one at more than 4 m/s costs `1 + 0.5 × v` condition and triggers a wobble.
- **Barricades (metro works):** blocked lanes for a length of road. The road narrows, and traffic merges with more aggressive cut-ins.
- **Bus stops:** buses stop there and pedestrians gather.

## 8. Weather

`weather: 'clear' | 'rain'` is set per level. Rain changes the following:
- puddle density ×2
- hidden potholes (§7.2)
- braking ×0.7
- NPC speeds ×0.85
- a rain-streak overlay and a rain noise loop

## 9. Levels, scoring and progression

### 9.1 v1 levels
Start times are initial values. Tune each so that a clean run arrives about 3 game minutes before the 10:00 deadline.

| # | Name | Length | Start | Character |
|---|---|---|---|---|
| 1 | Koramangala Back Roads | 1.2 km | 09:35 | Tutorial. Undivided 1+1 lanes, potholes, cows, missing footpaths, pedestrians. Wrong-side riders appear only in the last third. Light traffic. Contextual hint cards. |
| 2 | Outer Ring Road | 2.0 km | 09:30 | Divided, 3 lanes. Heavy traffic, two jam zones, metro barricades, buses, wrong-side riders along the kerb. |
| 3 | Silk Board in the Rain | 1.6 km | 09:32 | Rain. Mixed divided and undivided road. Tankers, puddles hiding potholes, one long jam at the junction. |

### 9.2 Ending a run
- **Arrive:** the player reaches the end of the last segment.
- **Breakdown:** condition reaches 0.
- **Quit:** chosen from the pause menu. No result is saved.

### 9.3 Result and score

```js
Result = { outcome:'arrived'|'breakdown', arrivalGameTime, minutesEarly /* negative = late */,
           karma, condition, stats:{ splashedPeds, potholesHit, crashes, honks, footpathSeconds } }
```

- **Punctuality** = `1000 + 20 × minutesEarly` if on time, otherwise `max(0, 1000 − 100 × minutesLate)`.
- **Score** = Punctuality + 5 × karma + 3 × condition. A breakdown scores 0.
- **Stars:**
  - ★★★: on time, karma ≥ 70, condition ≥ 50
  - ★★: on time, or ≤ 5 min late with karma ≥ 40
  - ★: arrived
- **Summary line** generated from stats, for example "You splashed 3 pedestrians, hit 7 potholes and still made it by 9:58." Tone is affectionate satire.

### 9.4 Progression and persistence
- Level *n+1* unlocks when level *n* is completed with at least 1 star.
- `localStorage` keys (every read and write wrapped in `try/catch`, and the game must work without storage):
  - `nc.progress`: `{levelId: {stars, bestScore, bestTime}}`
  - `nc.settings`: `{muted, reduceShake, touchHintSeen}`

## 10. Presentation

### 10.1 Camera and view
- At rest the view is 18 m of world across the screen. It zooms out smoothly to 21 m at maximum speed.
- The player is anchored at 80% of screen height, which gives about 28 m of look-ahead (≥ 2 s at max speed).
- Device pixel ratio is capped at 2.
- Screen shake on pothole hits and crashes is disabled when `reduceShake` is on.

### 10.2 Drawing
- **Draw order:**
  1. ground: asphalt with patch noise, faded markings, footpath slabs, shoulder, median, roadside shops and trees
  2. puddles and potholes
  3. entities, sorted by `y`
  4. particles: splashes, dust
  5. rain
  6. screen splatter
  7. HUD
- **Style:** flat colours with simple, readable silhouettes. Each vehicle type is recognisable by shape at a glance. The player's scooter has a distinct outline colour.
- Particles use a fixed-size object pool, with no allocations per frame.

### 10.3 HUD
- Clock as current time against the deadline (`09:47 / 10:00`), turning red when late.
- Progress bar with landmark ticks.
- Speed in km/h.
- Condition bar and karma meter.
- Pause button.
- Event bubbles over characters ("Ayyo!", "Swalpa adjust maadi").

### 10.4 Audio (all synthesised)
| Sound | How it's made |
|---|---|
| Engine | Oscillator whose pitch follows speed |
| Horn | Two-tone square wave |
| Splash, pothole thud | Filtered noise bursts |
| Wrong-side warning | Double beep |
| Ambient NPC horns | Random horn sounds |
| Rain | Noise loop |

The `AudioContext` is created or resumed on the first user gesture. The mute setting is persisted.

### 10.5 Screens
Title → Level select (stars, locks) → Briefing card (name, weather, start time) → Play ⇄ Pause (Resume / Restart / Quit) → Result (stars, score breakdown, summary line, Next / Retry).

## 11. Multiplayer readiness (constraints only, nothing built in v1)
- `sim.js` is deterministic for a given `(levelId, seed, input sequence)` within one JS engine. Cross-engine bit-exactness is not required, because the future server will be authoritative.
- State must be JSON-serialisable, with no functions, class instances or circular references.
- Inputs stay in the small fixed struct from §3.2. Emotes will be added later as a separate message, not as sim input.
- The player is stored as one entry in `state.players[]`, even though v1 always has exactly one player.

## 12. Accessibility
- Every hazard telegraph uses shape or motion as well as colour, for example the headlight glow plus an arrow shape.
- `reduceShake` setting.
- All text is at least 14 CSS px at a 360 px-wide viewport.
- The game is fully playable with keyboard only and with touch only.
- The game auto-pauses when the tab is hidden.

## 13. Testing and acceptance

### 13.1 Automated (`node --test tests/`)
- **Determinism:** two runs with the same level, seed and recorded inputs end with identical `JSON.stringify(state)` hashes.
- **Completability:** a scripted bot (steer toward the gap with the most clearance, brake when the time-to-collision is under 1.5 s) completes every level with condition above 0 across 20 seeds.
- **Performance:** 10,000 ticks of level 2 average ≤ 2 ms per step in Node.
- **Serialisation:** `JSON.parse(JSON.stringify(state))` continues the run identically to the original state.

### 13.2 Milestones and acceptance criteria
| # | Milestone | Done when |
|---|---|---|
| M1 | Road and scooter | A segment-based road renders and scrolls. Steering, braking and auto-throttle work with keyboard and touch. Camera zooms with speed. Runs at 60 fps on a phone. |
| M2 | Same-direction traffic | NPCs spawn and despawn, follow, change lanes and filter. Crashes and respawn work. Condition meter works. |
| M3 | Hazards | Potholes, puddles, splashes, pedestrians, missing footpaths, footpath riding, speed breakers, barricades and cows all work as specified. |
| M4 | Oncoming, wrong-side and horn | Undivided roads have oncoming traffic. Wrong-side riders appear with their telegraph. Horn effects and horn karma work. |
| M5 | Levels and meta | All 3 levels play through. Clock, scoring, stars, result screen, progression and persistence work. Rain modifier works. |
| M6 | Polish | Audio, particles, screen splatter, briefing and hint cards, PWA install and offline play. Payload budget met. |

## 14. Out of scope for v1 / later
- Multiplayer rooms, preset emotes ("Swalpa adjust maadi", "Enu guru?", horn), ghost races
- Traffic signals, traffic police, endless or daily-seed mode
- Bike upgrades, cosmetics, leaderboards

## 15. Open questions
1. Final title.
2. Touch steering: relative drag (specified above) or the scooter follows the finger's `x` directly? Decide after testing both on a phone.
3. Should riding into oncoming lanes on undivided roads cost karma?
4. Should the levels name more real places, or stay with the three above?

## References
- The architecture follows the pattern used by mantar-pantar.example, observed from its public files: shared UMD `world.js`/`sim.js` loaded by both the browser and a Node server, a 30 Hz authoritative tick, procedural Canvas 2D drawing, and synthesised audio. No code is reused from it.
