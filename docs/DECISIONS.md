# Decisions and deviations from SPEC.md

SPEC.md (v1) is the baseline. These are the places where the build differs,
and why. Newest first.

| # | Date | Decision | Why |
|---|---|---|---|
| 24 | 2026-10-19 | Busy gully stretches: random per seed in gully segments, more traffic, carts and pedestrians, announced by a toast and marked with bunting | "Increase traffic in some random gully areas" (user request); own RNG stream so existing layouts stay put |
| 23 | 2026-10-19 | Touch steering is a visible **left handle**: a grip on a slide track bottom left that follows the thumb, with a first-run tutorial; replaces the invisible "drag anywhere low" zone and its text hint | Steering on touch was not apparent (user request); mirrors holding the real left handlebar, while the right thumb keeps BRAKE/HORN |
| 22 | 2026-10-19 | Default road view is a **chase camera** (4.6 m behind, 2.6 m up) showing the rider; the cockpit view stays as "from the seat" | Requested: see nearby traffic more closely. Existing players are migrated once to the new default (`viewV: 2`) |
| 21 | 2026-10-19 | All brand names replaced with parody names: Yolo (the e-scooter), Zebto (grocery delivery), Sonny World signal, BMTeaCee buses | Anonymise before publishing (user request) |
| 20 | 2026-10-19 | Every level 40% shorter: commutes 0.72 / 0.84 / 0.87 km, delivery shifts 0.72 / 0.84 / 0.87 km; sharp junction turns keep their full length; times recalibrated | Trips felt longer than necessary (user request); runs are now about 2 minutes |
| 19 | 2026-10-19 | Two modes: **Office commute** (levels 1–3, now ending at a tech-park gate) and **Grocery delivery** (levels 4–6, Zebto-style 10-minute orders). Levels carry `mode` and `clockRate`; unlocks are per mode | Requested. No delivery-brand logo or marks are drawn; the rider wears purple in delivery mode |
| 18 | 2026-10-19 | Delivery rules: kerb drop zones, timed handovers (apartment 4 s, house 2.5 s), 5★ ratings from lateness and bag condition, tips, missed drops | docs/concepts/delivery-missions.md |
| 17 | 2026-10-19 | Segment `area` (main, gully, highrise, techpark), `edgeW`, right-side parking `parkedR`, `junction` turns where ending lanes' traffic turns off, vegetable carts | Choti gullies, apartment towers and tech parks need different streets |
| 16 | 2026-10-19 | More cars: traffic 12/100 m/lane (oncoming 10), car-heavy mixes, cars parked at the kerb | Requested: more cars to make it harder |
| 15 | 2026-10-19 | Commute start times recalibrated to 09:22 / 09:04 / 09:07 | Denser traffic |
| 14 | 2026-10-19 | Level lengths 1.2 / 1.4 / 1.45 km (spec 1.2 / 2.0 / 1.6), start times 09:23 / 09:08 / 09:10 from `tools/calibrate.js` | The Yolo tops out at 30 km/h; keeps runs at about 3–4 minutes |
| 13 | 2026-10-19 | Level data has `curves` (bends and junction turns); the renderer bends the road, the sim adds outward drift `k·v²·0.6` | Requested: "not a straight road only" |
| 12 | 2026-10-19 | NPC life: hailing autos, auto pickups, bus boarding, pedestrian chats, driver arguments | Requested: NPCs interact with each other |
| 11 | 2026-10-19 | Traffic density constant 10/100 m/lane (was 7), oncoming 8, pedestrians 9 per side | Requested: more traffic |
| 10 | 2026-10-19 | Karma is two-way (starts 60), with fights, good deeds, luck events and persistent rider skill; tips add to score | Requested karma mechanics (docs/concepts/karma-and-luck.md) |
| 9 | 2026-10-19 | The player rides a Yolo-style EV scooter: 30 km/h top speed, accel 3.2, 0.7 × 1.7 m, EV whine | Requested. Real Yolos cap at 25 km/h; 30 keeps it playable. No logo or brand marks are drawn |
| 8 | 2026-10-19 | Default view is first person (pseudo-3D); top-down kept as a "map view" setting | Requested first-person POV |
| 7 | 2026-10-19 | Contact below 1.5 m/s relative speed is a scrape (you stop) rather than a crash | Crawling into a car in a jam costing 20 condition felt unfair |
| 6 | 2026-10-19 | Oncoming and wrong-side traffic brake for a player who has (nearly) stopped | They "hold their line" against a moving player (spec), but ploughing into a stationary scooter was unfair |
| 5 | 2026-10-19 | Zipper-merge and nose-in courtesy rules, two-lane closure "via" lane changes, bikes creep and signal | Fixes traffic deadlocks found by the 20-seed bot runs |
| 4 | 2026-10-19 | Oncoming lane index counts from the centre line; levels keep `lanesOwn` across divided/undivided changes (test-enforced) | Otherwise oncoming traffic jumps 5 m sideways at boundaries |
| 3 | 2026-10-19 | `TRAFFIC_PER_100M` 7 then 10 instead of 4 | 4 per 100 m per lane read as empty roads for "1 = gridlock" |
| 2 | 2026-10-19 | Portrait phones taller than 9:16 use the full height | The 9:16–3:4 clamp is applied to landscape/desktop as the spec describes; tall phones would otherwise get bars |
| 1 | 2026-10-19 | Shared modules depend on `kit/rng`, `world.js` re-exports it as `World.Rng` | Reusable components live in `kit/` (user request) |

## Open questions from SPEC §15
1. Final title: still "Namma Commute".
2. Touch steering: the left handle (drag, relative) is the default; "follow finger" remains in Settings. Decide after phone tests.
3. Karma for riding in oncoming lanes: none yet (the head-on risk is the cost).
4. More real places: landmarks name real areas (Koramangala, ORR, Silk Board, HSR).
