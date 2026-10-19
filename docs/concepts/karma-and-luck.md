# Concept: karma, fights, luck and rider skill

**Files:** `shared/sim.js` (`crash`, `fightTick`, `deed`, `deedsTick`, `luck`, `luckTick`, `finish`), tunables in `shared/world.js`, UI in `client/main.js` · **Tests:** `tests/karma.test.js`

Karma is a two-way meter from 0 to 100, starting at **60**. Ride well and it
rises; clash and argue and it falls. Its level then feeds back into the run
(luck) and into progression (skill XP).

## Losing karma
| Cause | Karma |
|---|---|
| Footpath riding | −3 / s |
| More than 3 honks in 10 s | −1 per extra honk |
| Splashing a pedestrian | −10 |
| Hitting a pedestrian / cow | −20 / −15 (plus the argument below) |
| **Argument after a clash** (vehicle or person) | see below |

### Fights
A crash with a vehicle (any kind, including head-on) or a pedestrian starts
an argument. You stand still for up to 3 s (on top of the 1.5 s fall), and
the other driver stops too. A prompt shows the choice:
- **hold BRAKE** (0.4 s) to apologise: −2 karma, ends at once;
- **HORN** to argue back: −`FIGHT_KARMA[kind]` (auto 15, car/bike 10, bus/tanker 8, person 15), +1 s, and −4 more per extra honk;
- **do nothing**: you get shouted at, −half.
The bot always apologises.

## Earning karma (good deeds)
| Deed | Condition | Karma |
|---|---|---|
| Give way | a crossing pedestrian 0.5–12 m ahead within 3.5 m sideways while you are under 2.5 m/s | +5 (once per person) |
| Let them in | a car/auto/bus/tanker signalling a merge into your line ahead while you are under 3 m/s | +3 (10 s cooldown) |
| Gentle on the breaker | cross a speed breaker under 3 m/s | +1 |
| Calm riding | 30 s moving without honking, footpath riding or crashing | +2 |
A give-way or let-in deed has a 35% chance of an **immediate gift** from the
person you helped (a good luck event, below).

## Luck
Every 10–16 s: chance of a **good** event = `max(0, (karma − 50) / 50) × 0.8`;
chance of a **bad** event = `max(0, (50 − karma) / 50) × 0.8`. At karma 50,
nothing happens; at 100, a good event 80% of the time.
| Good (weight) | Effect | Bad (weight) | Effect |
|---|---|---|---|
| tip (4) | +₹10–50 (adds to score) | puncture (2) | top speed ×0.6 for 8 s |
| water (2) | steady hands: no wobble for 12 s | police fine (2) | −₹50 (what you have) and stopped 2 s |
| sweets (2) | sugar rush: top speed ×1.18, accel ×1.2 for 10 s | spongy brakes (1) | braking ×0.6 for 10 s |
| skill tip (1) | +15–35 XP | cancelled order (2) | −₹20 |
| green wave (1) | clock −45 game s | bad day (1) | −10–25 XP |

## Rider skill (persistent progression)
- Stored client-side in `nc.rider.xp`; level = `World.skillLevel(xp)`,
  thresholds `50·n·(n+1)` XP, max 10. Passed into `Sim.create(..., { skill })`.
- Each level: lateral speed +2.5%, braking +3%, wobble time −4%, crash and
  pothole damage −3%.
- XP per run = `(distance/20 + goodDeeds×4 + stars×15) × karmaMult × (½ if
  broken down) + luck XP`, where `karmaMult` is **1.5** for final karma ≥ 70,
  **1** for ≥ 40, **0.5** below: bad karma slows learning.

## Score
`punctuality + 5 × karma + 3 × condition + tips`. Stars: ★★★ on time with
karma ≥ 70 and condition ≥ 50 (so you must earn karma: you start at 60).

## Tuning knobs
All in `World.T`: `KARMA_START`, `FIGHT_*`, `APOLOGY_*`, `GIVE_WAY_*`,
`LET_IN_*`, `CALM_*`, `DEED_GIFT_CHANCE`, `LUCK_*` (including the weight tables
`LUCK_GOOD` / `LUCK_BAD`), effect durations, `SKILL_*`.

## Ideas for later
Spend tips on upgrades (better tyres = smaller pothole penalty, brighter
headlight in rain), daily deliveries with customers who rate your karma, a
"karma streak" multiplier.
