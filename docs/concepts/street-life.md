# Street life

**Files:** `shared/world.js` (street tunables, `STALL_KINDS`, `HANDOVER_SCENES`, `BIKE_TRAITS`), `shared/sim.js` (`placeStreet`, dogs, `drainUnder`, `manholeUnder`, `hornEffects`, `startDebate`, `fightTick`), `client/render.js` / `client/render-top.js` (drawing), `client/lines.js` (all text) · **Tests:** `tests/street.test.js`, `tests/lines.test.js`, `tests/delivery.test.js`

Footpaths and gully edges are not a free escape lane.

| Thing | Where | What happens | Tunables |
|---|---|---|---|
| Chai / momo / biryani stall | edges, customers beside it | crash at speed → argument with the vendor; nose in slowly and you walk the scooter round it (road side); good luck nearby comes from the stall | `STALLS_PER_100M`, `STALL_W/L`, `EDGE_ROUND_SPEED` |
| Street dog | asleep on edges | ride past fast or close and it may wake and chase; a bite costs ₹ and health; HORN scares it off; hitting a sleeping one is a crash | `DOG_*` |
| Missing drain slab | footpaths | above `DRAIN_SAFE_SPEED` the front wheel drops in (crash); slower is a lurch | `DRAIN_*` |
| Sunken manhole | road | a clunk; slippery when wet | `MANHOLES_PER_100M`, `MANHOLE_SLIP_CHANCE` |
| Footpath puddle | footpaths | at speed you may slip and fall (more in rain and when steering hard) | `FOOTPATH_PUDDLES_PER_100M`, `SLIP_*` |

All of these come from their own `'street'` RNG stream, so other layout stays put.

**Stopped means safe.** Below `PED_SAFE_SPEED` a pedestrian touching the scooter is a nudge, not a crash; waiting/chatting crowds step aside.

**Gaali and the heated debate.** Honk at the same person or vehicle `GAALI_HONKS` times (or lean on the horn) and they give you a gaali (`−GAALI_KARMA`). It turns into a debate (`DEBATE_TIME`): HORN argues back (costly), hold BRAKE to be responsible and move on (free). Honking during a handover gets a gaali from the guard or customer and costs a star.

**Time of day.** `st.tod` is `day`, `evening` or `night` (`TOD_EVENING`, `TOD_NIGHT`, own `'tod'` stream). It changes only the look and the clock shown (`TOD_SHIFT`).
