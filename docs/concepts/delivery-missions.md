# Concept: the two modes, and grocery delivery

**Files:** `shared/world.js` (`LEVELS[].mode`, `drops`, delivery tunables), `shared/sim.js` (`deliverOrder`, `missOrder`, `nextOrder`, `score`), `shared/bot.js` (drop approach), `client/main.js` (mode screen, briefing, results), `client/render.js` (pins, zones, gates, houses, phone) · **Tests:** `tests/delivery.test.js`, `tests/complete-l4..6.test.js`

## Modes
| Mode | Levels | Goal | Clock | Result |
|---|---|---|---|---|
| `commute` (Office commute) | 1–3 | reach the tech-park gate at the end before 10:00 | 12 game s per real s | punctuality + 5×karma + 3×condition + tips |
| `delivery` (Grocery delivery) | 4–6 | deliver every order before it is due | 3 game s per real s (a shift is ~10 game minutes: the 10-minute promise) | per order 200 + 60×rating + 100 if on time, + 5×karma + 3×condition + tips |
Levels unlock within their own mode (`World.prevInMode`). Karma, luck, fights,
rider skill and tips work the same in both modes; tips and XP go to the same rider.

## A delivery shift
- The bag starts loaded with every order (`state.orders`, from `LEVELS[].drops`:
  `{ at, kind: 'apartment' | 'house', name, due: 'HH:MM' }`), in route order.
- **Drop zone:** 12 m along the road centred on the address, at the left kerb
  (`x ≤ 2.3`: the left half of lane 0, or the footpath/shoulder). The address
  has a floating purple pin with the distance, the zone glows on the ground,
  and the building is marked (apartment security gate with a boom barrier and
  name board; a house with a purple door and nameplate).
- **Handover:** stop (under 0.8 m/s) inside the zone at the kerb for 0.4 s.
  You are held for the handover: apartment 4 s (security, register, lift),
  house 2.5 s. Then the order is rated.
- **Rating:** 5★ minus 1 per (started) game minute late, minus 1 if the bag is
  below 70%, minus another below 40%. Min 1★. **Tip:** 5★ ₹20–50, 4★ ₹10–20.
  A 5★ delivery is +3 karma.
- **Missed:** ride more than 1 m past the zone without handing over: the
  order is cancelled, rating 1★, −10 karma.
- **The bag** (groceries) takes damage: pothole −6×(0.5 + v/vmax), hard
  breaker −4, crash −20, kerb hop −2.
- The shift ends when every order is delivered or missed. Stars: ★★★ all
  delivered on time, average ≥ 4.5★ and karma ≥ 70; ★★ all delivered with
  average ≥ 3.5★; ★ at least one delivered.

## Places
Segments have an `area` that sets the scenery and feel:
- `gully` (choti gully): 1+1 lanes, edge zone 1 m (houses right at the lane),
  no footpaths, cars parked on **both** kerbs (`parked`, `parkedR`),
  pedestrians stepping out around parked cars, vegetable carts, cows, two-way
  traffic squeezing past, no lane paint. Houses: 1–3 storeys, gates, a water tank.
- `highrise`: compound walls with apartment towers set back 9 m (30–55 m tall,
  window bands).
- `techpark`: hedges and glass office towers set back 6 m; commute levels end
  at a tech-park gate arch with the destination's name.
- `main`: shops with awnings and signboards (the v1 look).

## Busy gullies
Some gully stretches are crowded: school's out, santhe (market) day, a temple
utsava, a wedding procession, gully cricket (`World.BUSY_KINDS`). At create
time each `gully` segment gets one with probability `BUSY_CHANCE` (0.7),
`BUSY_LEN_MIN`–`BUSY_LEN_MAX` (35–60 m) long, never before
`BUSY_MIN_Y`. They come from their own RNG stream
(`Rng.hash(seed, levelId, 'busy')`), so the rest of the layout is unchanged, and
live in `st.busy = [{ y0, y1, kind, seen }]`. Inside one:
- same-direction traffic spawns at `BUSY_TRAFFIC` × density, oncoming at `BUSY_ONCOMING` ×;
- `BUSY_CART_CHANCE` of spawns become handcarts (doubled on market day);
- `BUSY_PEDS_PER_100M` extra pedestrians stand and walk along the edges, and
  pedestrians cross `BUSY_CROSS_MULT` × as often (more give-way karma, more
  chances to clash).

A `busyAhead` event fires once, `BUSY_WARN` m before the stretch (a toast
in the client); the HUD progress bar marks busy stretches in orange; the road
view hangs bunting and a banner. They may overlap a drop zone, which makes that
drop harder. Tests: `tests/busy.test.js`.

## Junctions
`junction: true` on a segment marks a turn into a road of a different width:
same-direction traffic in lanes that do not continue, and oncoming traffic
whose lanes would jump sideways, "turn off" (are removed) at the boundary,
instead of merging. A junction must sit on a sharp turn (|k| ≥ 0.03 within
30 m), so the change happens around a corner (test-enforced). This is how
delivery shifts go from gullies (1+1) to wider roads (2+1) and back.

## The bot
Within 60 m of the next drop it strongly prefers the kerb lane, limits its
approach speed, and inside the zone holds position (brakes) until it has
edged across to the kerb, then waits out the handover. It always apologises
in fights. It must deliver every order on 20 seeds per shift.

## Calibrating due times
`node tools/calibrate.js 20` suggests each order's due time: start + median
crash-free bot delivery time + 1.5 game minutes (and commute start times).

## Ideas
Busy-stretch extras: a wedding band walking in the lane, a cricket ball
bouncing across, school vans double-parked. New orders arriving mid-shift (a phone ping, re-routing), cash-on-delivery
change, customers who come down vs "leave at the door", rain making the bag
soggy, a dark-store pickup at the start.
