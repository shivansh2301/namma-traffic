# Concept: road geometry and level authoring

**Files:** `shared/world.js` (`LEVELS`, `resolveLevel`, `crossSection`, helpers) · **Tests:** `tests/world.test.js`

## Coordinates
Metres. `y` runs along the road in the direction of travel; `x` runs across
it, `x = 0` is the left kerb of the player's carriageway. India drives on the
left: own lanes are `[0, lanesOwn × 3.5]`, oncoming traffic is to the right.
Coordinates are **road-aligned**: bends are a property of the level
(`curves`), applied by the renderer and as a lateral drift in the sim. The
geometry itself is always "straightened out".

## Cross-section (`crossSection(seg)`)
```
undivided:  wallL ─ footpath/shoulder ─ 0 ─ own lanes ─ ownR ─ oncoming lanes ─ roadR ─ footpath/shoulder ─ wallR
divided:    wallL ─ footpath/shoulder ─ 0 ─ own lanes ─ ownR ─ median ─ farL ─ far lanes ─ farR ─ footpath ─ wallR
```
`limitL/limitR` clamp the player (walls; the median on divided roads).
`oncL/oncLanes` locate oncoming lanes; lane `j = 0` is next to the centre
line or median, so lanes line up across divided/undivided changes.

## Level data
```js
{ id, name, weather: 'clear'|'rain', start: '09:23', blurb, mix: { bike, auto, car, bus, tanker },
  landmarks: [{ at, name }], hints: [{ at, key, text }],
  curves: [{ at, len, k }],   // k = 1/radius (1/m), > 0 bends right; |k| <= 0.06; no overlaps
  segments: [ { len, road, lanesOwn, lanesOncoming, lanesFar, footpathL, footpathR,
                traffic, oncoming, wrongSide, potholes, puddles, peds, cows, jam, mix,
                features: [ { kind: 'speedBreaker', at, marked }, { kind: 'busStop', at },
                            { kind: 'barricade', at, len, lanes: [..] } ] } ] }
```
Also per segment: `area` ('main' | 'gully' | 'highrise' | 'techpark'), `edgeW`
(edge zone width, 0 = default 2.6 m; gullies use 1 m), `parked` / `parkedR`
(kerbside parking left / right), `junction` (see delivery-missions.md). Per
level: `mode`, `clockRate`, `destination` (commute) or `drops` (delivery).

Segments **inherit every field from the previous segment** except `len`,
`jam` and `features`, so each segment states only what changes. Densities are
0..1 multipliers of the per-100 m constants in `T`.

## Authoring rules (enforced by tests)
- Features sit inside their segment; a barricade leaves at least one lane open.
- **Oncoming lanes may shift sideways by at most one median width between
  segments.** Keep `lanesOwn` equal across divided/undivided changes,
  otherwise oncoming traffic swerves across the shoulder at the boundary.
- Curves stay inside the level, do not overlap, |k| ≤ 0.06.
- After any change to levels, traffic or player tunables, run
  `node tools/calibrate.js` and copy the suggested `start` times: a
  crash-free bot run should arrive about 3 game minutes before 10:00.
- Then `node --test`: completability needs every level finished on 20 seeds.

## Design lessons
- Two adjacent closed lanes at a barricade are a traffic bottleneck: vehicles
  need the zipper merge (`mergeX`) and the "via" lane-change rule.
- A Yolo tops out at 30 km/h, so levels are 0.7–0.9 km to keep runs at about
  2 minutes of real time. Jams are about 90–180 m for the same reason.

## Adding a level
1. Append to `LEVELS` with the next `id` (unlocking is sequential).
2. Pick a `mix`, write segments, place features, add a few `curves` (junction
   turns: k ≈ ±0.04 over 35–40 m; gentle bends: ±0.006–0.012 over 100–200 m).
3. Add hints for any new mechanic, landmarks for the progress bar.
4. Calibrate, test, snapshot (`tools/snapshot.js`).
