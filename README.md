# Namma Commute

Ride a Yolo through Bengaluru traffic, in first person. **Office commute:**
reach the tech park by 10:00 through potholes, cows, autos, wrong-side riders
and the Silk Board junction. **Grocery delivery:** 10-minute orders to
apartment towers and houses deep in the gullies; pull over at the purple pin. Give way and stay calm for good karma, which
brings tips, water and sweets. Clash and argue, and luck turns against you.

## Play
Online: <https://shivansh2301.github.io/namma-traffic/>

Locally:
```bash
python3 -m http.server 8000     # from this folder
```
Open <http://localhost:8000/client/>.

Keyboard: ← → steer (throttle is automatic) · ↓ brake · Space horn · P pause.
Touch: drag on the lower screen to steer; BRAKE and HORN buttons bottom right.
In an argument: hold BRAKE to apologise, HORN to argue back.

## Develop
Node ≥ 20 for tests (`node --test`). No build step, no dependencies. Start
with [AGENTS.md](AGENTS.md); reusable components are in [kit/](kit/README.md),
design notes in [docs/concepts/](docs/concepts/).

## License
Copyright © 2026 shivansh2301. **All rights reserved.** No permission is
granted to use, copy, modify or distribute any part of this repository. See
[LICENSE](LICENSE).
