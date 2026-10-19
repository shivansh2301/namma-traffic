# Concept: traffic model and NPC life

**Files:** `shared/sim.js` (NPC sections), tunables in `shared/world.js` (`T`, `VEHICLES`, `PED`)

## Vehicle catalogue (`VEHICLES`)
| kind | w × l (m) | desired speed (m/s) | lateral style |
|---|---|---|---|
| bike | 0.8 × 1.9 | 9–13 | free lateral planner (filters between lanes) |
| auto | 1.4 × 2.7 | 7–10 | lane-based, 0.7 s lane changes, cuts in, stops for passengers |
| car | 1.8 × 4.3 | 8–12 | lane-based; 25% are cabs that stop for pickups |
| bus | 2.6 × 12 | 6–9 | lane-based; pulls to lane 0 and stops 5 s at bus stops |
| tanker | 2.4 × 8 | 6–8 | lane-based; leaks puddles |
| cow | 0.9 × 2.1 | 0–0.5 | sits, stands or ambles; never yields |
Rain multiplies desired speeds by 0.85. The player's Yolo (0.7 × 1.7, 30 km/h)
is slower than most traffic, so you are constantly overtaken.

## Following and lane changes
- **Leader search:** nearest obstacle ahead whose body overlaps the
  corridor. Oncoming and wrong-side traffic ignore a *moving* player (they do
  not dodge), but brake for one that has stopped.
- **Speed:** target speed `max(0, (gap − 2) / 0.8)` (gap 2 m + 0.8 s ×
  speed), capped by desired speed, jam wave, breakers (3.5 m/s) and stops;
  accel ≤ 2, decel ≤ 6 (9 for an auto stopping dead). NPCs never overlap
  what they follow (position clamp).
- **Lane change** (lane-based kinds): blocked > 1 s (autos 0.5 s), or urgent
  (lane ends, barricade within 45 m, bus heading to a stop, auto heading to a
  fare). Needs a gap ahead and behind that scales with closing speed; the
  sideways sweep only checks the side you move toward and ignores things in
  line with you.
- **Courtesy (anti-deadlock):** followers give way to a vehicle signalling a
  merge (`mergeX`) only when it is clearly ahead; same-direction traffic gives
  way to a scooter nosing in only when it is ahead. If both rules applied
  side by side, both parties would wait forever.
- **Passing small obstacles:** lane vehicles edge around people, cows and
  stopped bikes or vehicles if the shifted corridor has no oncoming traffic,
  holding the offset until past (`hold/holdOff`).
- **Bikes:** score candidate lines (lane centres, lane lines, ±0.35 m, kerb)
  by room ahead, minus potholes and barricades; creep toward the best line as
  far as the sweep allows, signalling `mergeX` when walled in.

## Spawning
Bands around the player: same-direction ahead 40–80 m, overtakers from behind
30–40 m when slower than them, oncoming ahead 45–85 m, wrong-side riders
74–86 m ahead. Spacing check per corridor at `100 / (density × 10)` m
(oncoming 8), or 1.5–4.5 m bumper gaps in jams. Despawn 40 m behind or 120 m ahead.

## Jams
Desired speed capped by a backward-travelling wave
`clamp(1.5 + 2.2 sin(2π (t/8 + y/45)), 0.2, 3)`; bikes get +3 m/s (they filter).

## NPC life (people and drivers interact)
| Behaviour | Trigger | What happens | Event |
|---|---|---|---|
| Hail an auto | walking pedestrian on the left, ahead of the player, chance 1.5%/s | stands with an arm up for up to 12 s | `hail` |
| Auto pickup | empty auto within 6–30 m behind a hailing pedestrian | moves to lane 0, edges to the kerb in the last 15 m, stops alongside (or just behind them, when they stand in a gully lane), passenger walks over and boards (removed), auto shows a passenger; gives up after 4 s stuck | `pickup` |
| Bus boarding | bus stopped at a bus stop | waiting pedestrians board one every 0.7 s | `board` |
| Chat | two pedestrians on the same side walk into each other | 40% stop and chat for 3–6 s (blocking a no-footpath road edge) | `chat` |
| Driver argument | a lane change forces the follower to brake; a wrong-side rider nose to nose with a driver | honk + exchange of words, 8 s cooldown | `npcArgue` |
| Splash | vehicle through a puddle > 5 m/s near a pedestrian | pedestrian stops, "Ayyo!" | `pedSplashed` |
The client turns these into speech bubbles (gentle Kannada/English lines; the
satire targets the infrastructure, never the people).
