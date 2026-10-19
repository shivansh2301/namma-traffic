# Concept: the deterministic, shared simulation

**Files:** `shared/world.js`, `shared/sim.js`, `shared/bot.js` · **Tests:** `tests/sim.test.js`, `tests/rules.test.js`, `tests/karma.test.js`

## The contract
```js
const state  = Sim.create(levelId, seed, { skill });  // plain JSON object
const events = Sim.step(state, input);                // exactly one tick, DT = 1/30 s
const result = Sim.result(state);                     // null while playing
input = { steer: -1..1, brake: 0|1, horn: 0|1 }       // or an array, one per state.players[i]
```
Same `(levelId, seed, opts, input sequence)` ⇒ same state, in one JS engine.
This is what makes replays, the bot tests, start-time calibration and a
future authoritative multiplayer server possible.

## Rules that keep it deterministic
1. `shared/*.js` never touch `window`, `document`, `Date`, `performance`,
   `Math.random`, storage or rAF. `tests/purity.test.js` greps for them.
2. All randomness comes from `World.Rng` over integer state in the state:
   - **layout stream** `Rng.hash(seed, levelId, 'layout')`: potholes,
     puddles, cows and pedestrians are placed once in `create`;
   - **run stream** `state.rng = Rng.hash(seed, 'run')`: everything at runtime.
   Keep them separate so traffic tweaks never move a pothole.
3. State is plain JSON: no functions, class instances, `undefined`, `NaN` or
   `Infinity` (checked by `tests/sim.test.js`). Timers that must count exactly
   use integer ticks (the horn cooldown), not float seconds.
4. Static level data (`World.level(id)`, resolved and cached) is never
   mutated; it is not stored in the state.
5. Module-level scratch (the obstacle snapshot `OB`, `PREV`, `PENDING`) is
   rebuilt every tick from the state and never carries information across ticks.

## Tick order (`Sim.step`)
1. `tick++`, game clock `+= CLOCK_RATE * DT` (12 game s per real s).
2. Rebuild the **obstacle snapshot** from the state (players, NPCs, people,
   barricades): every NPC decides from the same picture of the world.
3. Players: fights → crash/respawn → halts → longitudinal (throttle, brake,
   effects, skill) → lateral (steer, wobble, bend drift) → walls → surface
   (kerbs, footpath, rubble) → breakers → potholes → puddles → horn.
4. NPC vehicles (lateral planner by type, car-following, special behaviours),
   cows, pedestrians (only within `ACTIVE_RANGE` of the player).
5. Player collisions (crash or low-speed scrape), good deeds, luck rolls,
   pedestrian chats (every 15 ticks), queued NPC events.
6. Spawning in bands around the player, despawning behind and far ahead.
7. Ambient horns, then breakdown/arrival checks → `state.result`.

## Events (the only output besides state)
`horn, splash, pedSplashed, pothole, bump{kind: kerb|slab|rubble|breaker|scrape}, crash{with}, respawn,
screenSplash, honkNpc, npcYield, pedDodge, wrongSide, arrive, breakdown,
fight{phase: start|sorry|argue|shouted|end}, goodDeed{kind}, luck{good, kind, amount},
hail, pickup, board, chat, npcArgue`.
The client turns them into sound, particles, bubbles and toasts. The sim
holds no render state; animation state that matters to gameplay (wobble,
crash timer, fight timer) lives in the player record.

## The bot (`shared/bot.js`)
Reads the state, returns an input. Evaluates lateral candidates every 0.25 m
by time-to-collision (scored at a ≥ 5 m/s speed floor so standing still
never looks safe), "flow" (the speed a corridor allows), soft costs
(potholes, puddles in rain, footpath karma, kerb hops, oncoming lanes), and
reachability at the real speed. It creeps toward the best corridor when it
cannot reach it yet, gets more patient the longer it is stuck, brakes for
breakers, apologises in fights, and steers into bends. It exists for:
completability tests (20 seeds × every level), `tools/calibrate.js`, and the
title-screen demo.

## Multiplayer path (not built)
- Server runs the same `sim.js` at 30 Hz with `input` arrays; clients send
  inputs, receive state deltas/events; spawning uses `players[0]` today. Make
  spawn bands the union around all players before going multiplayer.
- Emotes are a separate message, never sim input (SPEC §11).
- `kit/sim-harness` encoders give ghost races for free.

## Debugging recipes
- `Sim.debugLeader(state, npcId)`: what an NPC is following and why it waits.
- `Bot.create({ trace: true })`, then `mem.last` has every candidate's TTC and value.
- `tools/snapshot.js level seed seconds out.png [first|top]`: render a frame without a browser.
- Most traffic deadlocks found so far were "two parties both waiting for the
  other": check courtesy rules (nose-in, zipper merge) apply only when the
  other party is clearly ahead, and that sideways sweeps ignore things in line.
