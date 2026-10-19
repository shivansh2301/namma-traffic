/*
 * shared/world.js: constants, tunables, mission (level) data, road geometry
 * and the seeded RNG (re-exported from kit/rng). Pure data and pure functions.
 *
 * Two modes, one rider on a Yolo:
 *   commute  - get to the tech park by 10:00 (levels 1-3)
 *   delivery - 10-minute grocery orders to apartment towers and gully houses (levels 4-6)
 *
 * Shared by the browser client and Node (tests now, an authoritative server
 * later). Must not touch the DOM, window, Date, performance or Math.random.
 * UMD: require('./world.js') in Node, window.World in the browser
 * (load kit/rng/rng.js first).
 *
 * Coordinates: metres; +y is the direction of travel; x = 0 is the left kerb
 * of the player's carriageway; India drives on the left.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const mod = factory(isNode ? require('../kit/rng/rng.js') : root.Kit.Rng);
  if (isNode) module.exports = mod;
  else root.World = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rng) {
  'use strict';

  const DT = 1 / 30;

  // ---------------------------------------------------------------------------
  // Tunables. Everything gameplay-relevant lives here so it can be tuned in one
  // place. Section numbers refer to SPEC.md.
  // ---------------------------------------------------------------------------
  const T = {
    // Road geometry (§4)
    LANE_W: 3.5,
    EDGE_W: 2.6, // footpath or dirt shoulder between kerb and shop fronts
    MEDIAN_W: 1.6,
    PED_ROAD_BAND: 1.2, // pedestrians walk within this of the kerb when there is no footpath

    // Player motion (§5.2). The rider is on a Yolo-style EV delivery scooter:
    // small, quick off the line, speed-limited (real ones cap at 25 km/h).
    MAX_SPEED: 8.3, // 30 km/h
    ACCEL: 3.2,
    BRAKE_DECEL: 7.0,
    RAIN_BRAKE_MULT: 0.7,
    COAST_DECEL: 0.5,
    LAT_MAX: 4.0,
    LAT_BASE: 1.2,
    LAT_PER_SPEED: 0.25,
    PLAYER_W: 0.7,
    PLAYER_L: 1.7,
    WOBBLE_TIME: 0.6,
    WOBBLE_STEER_MULT: 0.5,
    WOBBLE_JITTER: 0.9, // m/s of random lateral drift while wobbling
    MINOR_WOBBLE: 0.3, // broken slabs, rubble, kerbs
    KERB_MIN_SPEED: 5,
    KERB_SPEED_MULT: 0.6,
    KERB_CONDITION: 2,
    FOOTPATH_KARMA_PER_S: 3,
    SLAB_BUMP_EVERY_M: 9,
    RUBBLE_BUMP_EVERY_M: 14,
    GEOMETRY_PUSH: 8, // m/s; how fast a narrowing road pushes the player inward
    CURVE_DRIFT: 0.6, // lateral drift = curvature x v^2 x this (s); bends push you outward

    // Clock (§5.3). Slower than the v1 commute (12x): a shift is ~10 game minutes,
    // matching the 10-minute delivery promise.
    CLOCK_RATE: 12, // game seconds per real second (commute); levels may override with clockRate
    DEADLINE: 10 * 3600, // unused by missions (kept for old tools); orders have their own due times

    // Deliveries (docs/concepts/delivery-missions.md)
    DROP_ZONE: 12, // m along the road, centred on the address
    DROP_MAX_X: 2.3, // stop at the kerb: x <= this (left half of lane 0, or the footpath/shoulder)
    DROP_STOP_SPEED: 0.8,
    DROP_STOP_HOLD: 0.4, // s stopped inside the zone before the handover starts
    HANDOVER: { apartment: 4, house: 2.5 }, // s: security gate + lift vs knock on the door
    LATE_STAR_PER_MIN: 1, // -1 star per game minute late
    GOODS_POTHOLE: 6, // bag damage (eggs, milk...)
    GOODS_BREAKER: 4,
    GOODS_CRASH: 20,
    GOODS_KERB: 2,
    TIP_5: [20, 50], // tip range by rating (rupees, multiples of 10)
    TIP_4: [10, 20],
    HAPPY_KARMA: 3, // a 5-star delivery
    MISSED_KARMA: 10, // rode past the drop

    // Crashes (§7.5)
    CRASH_TIME: 1.5,
    INVULN_TIME: 2.0,
    CRASH_COST: { vehicle: 20, headOn: 30, cow: 20, barricade: 15, ped: 10 },
    CRASH_KARMA: { vehicle: 0, headOn: 0, cow: 15, barricade: 0, ped: 20 },
    HITBOX_FORGIVE: 0.9, // collision boxes are scaled by this; feels fairer
    SCRAPE_SPEED: 1.5, // m/s relative; slower contact with a vehicle stops you instead of crashing (docs/DECISIONS.md)

    // Karma is two-way: start mid-scale, earn it by riding well (docs/concepts/karma-and-luck.md).
    KARMA_START: 60,

    // Fights: clashing with a vehicle or a person starts an argument. Hold BRAKE
    // to apologise (cheap), HORN to argue (expensive), or get shouted at (half).
    FIGHT_TIME: 3.0,
    APOLOGY_HOLD: 0.4,
    APOLOGY_KARMA: 2,
    ARGUE_MORE_KARMA: 4,
    FIGHT_KARMA: { auto: 15, car: 10, bike: 10, bus: 8, tanker: 8, ped: 15 },

    // Good deeds
    GIVE_WAY_SPEED: 2.5,
    GIVE_WAY_KARMA: 5,
    LET_IN_KARMA: 3,
    LET_IN_COOLDOWN: 10,
    BREAKER_SLOW_KARMA: 1,
    CALM_EVERY: 30, // s without honking, footpath riding or crashing
    CALM_KARMA: 2,
    DEED_GIFT_CHANCE: 0.35, // a good deed may be rewarded on the spot

    // Luck: every LUCK_EVERY s, karma above 50 can bring something good, below 50 something bad.
    LUCK_FIRST: 10,
    LUCK_EVERY_MIN: 10,
    LUCK_EVERY_MAX: 16,
    LUCK_MAX_P: 0.8,
    LUCK_GOOD: { tip: 4, water: 2, sweets: 2, skill: 1, greenWave: 1 },
    LUCK_BAD: { puncture: 2, fine: 2, brakes: 1, cancel: 2, skillSlow: 1 },
    STEADY_TIME: 12, // water: no wobble
    SUGAR_TIME: 10, // sweets: faster
    SUGAR_SPEED: 1.18,
    PUNCTURE_TIME: 8,
    PUNCTURE_SPEED: 0.6,
    FADE_TIME: 10,
    FADE_MULT: 0.6,
    FINE_HALT: 2,
    FINE_AMOUNT: 50,
    GREEN_WAVE_S: 30, // game seconds given back

    // Rider skill (persistent, 0..SKILL_MAX). Each level improves handling a little.
    SKILL_MAX: 10,
    SKILL_LAT: 0.025,
    SKILL_BRAKE: 0.03,
    SKILL_WOBBLE: 0.04,
    SKILL_DAMAGE: 0.03,

    // NPC life: people hail autos, board buses, stop to chat; drivers argue.
    HAIL_PER_S: 0.015,
    HAIL_TIME: 12,
    CHAT_CHANCE: 0.4,
    CHAT_MIN: 3,
    CHAT_MAX: 6,
    ARGUE_COOLDOWN: 8,

    // Hazards (§7)
    POTHOLE_MIN_SPEED: 3,
    POTHOLE_SPEED_MULT: 0.55,
    POTHOLE_COST_BASE: 2,
    POTHOLE_COST_PER_V: 0.6,
    PUDDLE_SPEED_MULT: 0.85,
    SPLASH_MIN_SPEED: 5,
    SPLASH_PED_SIDE: 2,
    SPLASH_PED_ALONG: 2,
    SPLASH_KARMA: 10,
    PED_SPLASH_STOP: 1.0,
    SCREEN_SPLASH_DIST: 2.5,
    SCREEN_SPLASH_REL_SPEED: 5,
    HIDDEN_POTHOLE_CHANCE: 0.5,
    BREAKER_MIN_SPEED: 4,
    BREAKER_COST_BASE: 1,
    BREAKER_COST_PER_V: 0.5,
    BREAKER_NPC_SPEED: 3.5,

    // Horn (§7.4)
    HORN_COOLDOWN: 0.3,
    HORN_FREE: 3,
    HORN_WINDOW: 10,
    HORN_KARMA: 1,
    HORN_PED_RANGE: 10,
    HORN_PED_SIDE: 2,
    HORN_PED_STEP: 0.6,
    HORN_PED_TIME: 0.5,
    HORN_NPC_RANGE: 12,
    HORN_NPC_CHANCE: 0.5,
    HORN_NPC_SHIFT: 1.2,
    HORN_WS_RANGE: 15,
    HORN_WS_CHANCE: 0.5,

    // Weather (§8)
    RAIN_PUDDLE_MULT: 2,
    RAIN_NPC_SPEED_MULT: 0.85,

    // Densities, per 100 m of road at density value 1
    TRAFFIC_PER_100M: 12, // per lane. SPEC §6.3 says 4, which reads sparse for "1 = gridlock"; see docs/DECISIONS.md
    ONCOMING_PER_100M: 10,
    PARKED_PER_100M: 5, // cars parked along the kerb (left: footpath or gully; right: parkedR on undivided roads)
    GULLY_EDGE_W: 1.0, // houses come right up to the lane in gullies
    POTHOLES_PER_100M: 7,
    PUDDLES_PER_100M: 3,
    PEDS_PER_100M: 9, // per side
    COWS_PER_100M: 1.5,
    FOOTPATH_PED_MULT: 1.5,
    WRONG_SIDE_PER_S: 0.22,
    PED_CROSS_PER_S: 0.025, // per walking pedestrian near the player
    PED_CROSS_SPEED: 1.2,
    PED_CROSS_PAUSE_DIST: 6,

    // Traffic behaviour (§6.2)
    FOLLOW_GAP: 2,
    FOLLOW_HEADWAY: 0.8,
    NPC_DECEL: 6,
    NPC_ACCEL: 2,
    NPC_STOP_DEAD_DECEL: 9,
    BLOCKED_BEFORE_LANE_CHANGE: 1.0,
    AUTO_STOP_CHANCE_PER_10S: 0.02,
    CAB_STOP_CHANCE_PER_10S: 0.03,
    BUS_STOP_ANYWHERE_PER_10S: 0.02,
    BUS_STOP_TIME: 5,
    TANKER_LEAK_EVERY_M: 7,

    // Jam zones (§6.4)
    JAM_MIN_DENSITY: 0.85,
    JAM_PERIOD: 8,
    JAM_WAVELENGTH: 45,
    JAM_SPEED_MIN: 0.2,
    JAM_SPEED_MAX: 3,
    JAM_GAP_MIN: 1.5, // bumper-to-bumper spacing when spawning into a jam
    JAM_GAP_MAX: 4.5,
    JAM_BIKE_BONUS: 3, // two-wheelers filter through a jam faster than the queue moves

    // Spawning (§6.3)
    SPAWN_AHEAD_MIN: 40,
    SPAWN_AHEAD_MAX: 80,
    SPAWN_BEHIND_MIN: 30,
    SPAWN_BEHIND_MAX: 40,
    DESPAWN_BEHIND: 40,
    DESPAWN_AHEAD: 120,
    ACTIVE_RANGE: 120, // cows and pedestrians outside this sleep
    START_CLEAR: 14, // no traffic spawns this close to the start position

    // Presentation contract. The sim times the wrong-side telegraph with these,
    // so the client camera should give roughly this much look-ahead.
    VIEW_AHEAD: 28,
    TELEGRAPH_TIME: 2,
  };

  // §6.1. `variants` is how many colour variants the renderer provides.
  const VEHICLES = {
    bike: { w: 0.8, l: 1.9, vMin: 9, vMax: 13, lcTime: 0.5, gapNeed: 1.0, variants: 8 },
    auto: { w: 1.4, l: 2.7, vMin: 7, vMax: 10, lcTime: 0.7, gapNeed: 1.0, variants: 3 },
    car: { w: 1.8, l: 4.3, vMin: 8, vMax: 12, lcTime: 1.2, gapNeed: 3.0, variants: 8 },
    bus: { w: 2.6, l: 12, vMin: 6, vMax: 9, lcTime: 1.2, gapNeed: 3.0, variants: 3 },
    tanker: { w: 2.4, l: 8, vMin: 6, vMax: 8, lcTime: 1.2, gapNeed: 3.0, variants: 2 },
    cow: { w: 0.9, l: 2.1, vMin: 0, vMax: 0.5, variants: 3 },
    cart: { w: 1.1, l: 1.9, vMin: 0.6, vMax: 1.2, lcTime: 1.5, gapNeed: 1.0, variants: 2 }, // vegetable push-cart
  };
  const PED = { w: 0.5, l: 0.45, vMin: 1.1, vMax: 1.5, variants: 10 };

  // ---------------------------------------------------------------------------
  // Levels (§9.1). Segments inherit every field from the previous segment
  // except `len`, `jam` and `features`, so each segment only states changes.
  // `at` in features, hints and landmarks is metres from the segment start
  // (features) or from the level start (hints, landmarks).
  // ---------------------------------------------------------------------------
  const SEG_DEFAULTS = {
    len: 100,
    road: 'undivided',
    lanesOwn: 1,
    lanesOncoming: 1,
    lanesFar: 0, // divided only: decorative far-carriageway lanes (0 = same as lanesOwn, max 2)
    footpathL: true,
    footpathR: true,
    traffic: 0.2,
    oncoming: 0.2,
    wrongSide: 0,
    potholes: 0.3,
    puddles: 0.2,
    peds: 0.3,
    cows: 0,
    parked: 0,
    parkedR: 0, // undivided only: cars parked on the far (right) edge too
    area: 'main', // 'main' | 'gully' | 'highrise': scenery and feel
    edgeW: 0, // width of the edge zone (footpath/shoulder); 0 = T.EDGE_W
    jam: false,
    junction: false, // a turn into a road of a different width: traffic in lanes that end turns off here
    mix: null, // null = level mix
  };

  // Gully mix: lots of bikes and autos, carts, fewer cars (but they are parked everywhere).
  const GULLY_MIX = { bike: 5, auto: 3, car: 3, cart: 1.2, bus: 0, tanker: 0 };

  const LEVELS = [
    // ---- Office commute: be at the tech park by 10:00 -------------------------
    {
      id: 1,
      mode: 'commute',
      name: 'Koramangala Back Roads',
      weather: 'clear',
      start: '09:36',
      blurb: 'Narrow 1+1 lanes, cows, potholes and footpaths that come and go, then the tech park gate. Wrong-side riders near the end.',
      mix: { bike: 4, auto: 3, car: 4, bus: 0, tanker: 0 },
      destination: { kind: 'techpark', name: 'Koramangala Tech Hub' },
      landmarks: [
        { at: 0, name: 'Home, 6th Block' },
        { at: 210, name: 'Sonny World signal' },
        { at: 480, name: '80 Feet Road' },
        { at: 720, name: 'Tech park gate' },
      ],
      // Bends and junction turns: k = curvature (1/radius, 1/m), > 0 bends right.
      curves: [
        { at: 64, len: 38, k: -0.04 },
        { at: 192, len: 35, k: 0.045 },
        { at: 336, len: 48, k: 0.012 },
        { at: 389, len: 48, k: -0.012 },
        { at: 490, len: 40, k: 0.04 },
        { at: 612, len: 72, k: -0.01 },
      ],
      hints: [
        { at: 0, key: 'controls', text: 'Throttle is automatic. Steer with ← → or drag. Brake with ↓ or the brake button.' },
        { at: 35, key: 'pothole', text: 'Potholes slow you down and hurt your Yolo. Steer around the dark patches.' },
        { at: 70, key: 'turn', text: 'Turn ahead! Bends push you outwards, so steer into them.' },
        { at: 105, key: 'nofootpath', text: 'No footpath here, so people walk on the road. Give them room.' },
        { at: 180, key: 'breaker', text: 'Speed breaker ahead. Cross it slower than 15 km/h or the bike suffers.' },
        { at: 252, key: 'cow', text: 'Cows never yield. Go around, slowly.' },
        { at: 288, key: 'giveway', text: 'Stop for people crossing: good karma. Good karma brings tips, water and sweets.' },
        { at: 360, key: 'horn', text: 'Honk (Space / horn button) to warn people ahead. More than 3 honks in 10 s costs karma.' },
        { at: 456, key: 'wrongside', text: 'Wrong-side riders ahead! Headlights and a ▼ mean one is coming at you.' },
        { at: 540, key: 'footpath', text: 'You can ride on the footpath. You will lose karma, and the slabs are broken.' },
        { at: 636, key: 'techpark', text: 'The tech park! Ride through the gate before 10:00.' },
      ],
      segments: [
        { len: 90, road: 'undivided', lanesOwn: 1, lanesOncoming: 1, footpathL: true, footpathR: true, traffic: 0.15, oncoming: 0.2, potholes: 0.3, puddles: 0.1, peds: 0.35, cows: 0, parked: 0.4 },
        { len: 120, footpathL: false, traffic: 0.18, oncoming: 0.2, potholes: 0.55, peds: 0.6, cows: 0.15, features: [{ kind: 'speedBreaker', at: 102, marked: true }] },
        { len: 120, footpathL: true, footpathR: false, potholes: 0.45, peds: 0.4, cows: 0.6, features: [{ kind: 'busStop', at: 36 }, { kind: 'speedBreaker', at: 96, marked: false }] },
        { len: 150, footpathL: false, footpathR: false, traffic: 0.22, potholes: 0.7, puddles: 0.35, peds: 0.55, cows: 0.25 },
        { len: 150, footpathL: true, footpathR: false, wrongSide: 0.6, traffic: 0.25, oncoming: 0.25, potholes: 0.45, puddles: 0.2, peds: 0.45, cows: 0.15, features: [{ kind: 'speedBreaker', at: 72, marked: true }] },
        { len: 90, area: 'techpark', footpathR: true, wrongSide: 0.3, potholes: 0.15, cows: 0, peds: 0.4, parked: 0.2 },
      ],
    },
    {
      id: 2,
      mode: 'commute',
      name: 'Outer Ring Road',
      weather: 'clear',
      start: '09:25',
      blurb: 'Three lanes, heavy traffic, two jams, metro barricades, buses, and wrong-side riders along the kerb. The tech park is at the far end.',
      mix: { bike: 5, auto: 2, car: 8, bus: 1.4, tanker: 0.3 },
      destination: { kind: 'techpark', name: 'ORR Tech Park' },
      landmarks: [
        { at: 0, name: 'Agara' },
        { at: 240, name: 'Bellandur junction' },
        { at: 540, name: 'Marathahalli bridge' },
        { at: 840, name: 'Tech park gate' },
      ],
      // Bends and junction turns: k = curvature (1/radius, 1/m), > 0 bends right.
      curves: [
        { at: 90, len: 90, k: 0.006 },
        { at: 288, len: 108, k: -0.008 },
        { at: 510, len: 90, k: 0.01 },
        { at: 660, len: 72, k: -0.006 },
        { at: 756, len: 60, k: 0.012 },
      ],
      hints: [
        { at: 12, key: 'filter', text: 'Heavy traffic. Filter between lanes where there is a gap.' },
        { at: 234, key: 'jam', text: 'Jam ahead. Traffic moves in stop-go waves. Look for gaps you fit through.' },
        { at: 708, key: 'techpark', text: 'Tech park ahead. Glass towers, a gate, and your 10:00 stand-up.' },
      ],
      segments: [
        { len: 120, road: 'divided', lanesOwn: 3, lanesFar: 2, footpathL: true, traffic: 0.55, oncoming: 0.45, potholes: 0.25, puddles: 0.1, peds: 0.25, cows: 0.03, wrongSide: 0.3, parked: 0.4, features: [{ kind: 'busStop', at: 84 }] },
        { len: 120, traffic: 0.65, features: [{ kind: 'barricade', at: 12, len: 96, lanes: [2] }] },
        { len: 90, jam: true, traffic: 0.9, potholes: 0.35, features: [{ kind: 'barricade', at: 12, len: 66, lanes: [2] }] },
        { len: 120, traffic: 0.55, footpathL: false, wrongSide: 0.6, peds: 0.4, potholes: 0.5, parked: 0, features: [{ kind: 'speedBreaker', at: 60, marked: false }, { kind: 'busStop', at: 102 }] },
        { len: 120, traffic: 0.7, footpathL: true, wrongSide: 0.3, potholes: 0.3, parked: 0.3, features: [{ kind: 'barricade', at: 12, len: 84, lanes: [0] }] },
        { len: 90, jam: true, traffic: 0.9, wrongSide: 0.4 },
        { len: 180, area: 'techpark', traffic: 0.5, wrongSide: 0.5, potholes: 0.25, features: [{ kind: 'busStop', at: 60 }, { kind: 'barricade', at: 102, len: 60, lanes: [2] }] },
      ],
    },
    {
      id: 3,
      mode: 'commute',
      name: 'Silk Board in the Rain',
      weather: 'rain',
      start: '09:28',
      blurb: 'Rain. Puddles hide potholes, tankers leak, the junction is one long jam, and the tech park is on the other side of it.',
      mix: { bike: 5, auto: 3, car: 7, bus: 1.1, tanker: 1.4 },
      destination: { kind: 'techpark', name: 'HSR Tech Park' },
      landmarks: [
        { at: 0, name: 'BTM 2nd Stage' },
        { at: 300, name: 'Hosur Road' },
        { at: 480, name: 'Silk Board junction' },
        { at: 870, name: 'Tech park gate' },
      ],
      // Bends and junction turns: k = curvature (1/radius, 1/m), > 0 bends right.
      curves: [
        { at: 108, len: 36, k: -0.02 },
        { at: 244, len: 45, k: 0.03 },
        { at: 498, len: 84, k: 0.02 },
        { at: 690, len: 48, k: -0.02 },
        { at: 792, len: 54, k: 0.012 },
      ],
      hints: [
        { at: 6, key: 'rain', text: 'Rain: brakes are weaker, and a puddle may hide a pothole. Avoid puddles when you can.' },
        { at: 468, key: 'silkboard', text: 'Silk Board. Patience, or the footpath. Your karma, your call.' },
      ],
      segments: [
        { len: 150, road: 'undivided', lanesOwn: 3, lanesOncoming: 1, footpathL: true, footpathR: false, traffic: 0.45, oncoming: 0.4, potholes: 0.45, puddles: 0.55, peds: 0.35, cows: 0.1, wrongSide: 0.2, parked: 0.35 },
        { len: 150, footpathL: false, potholes: 0.6, puddles: 0.65, peds: 0.45, features: [{ kind: 'speedBreaker', at: 66, marked: false }] },
        { len: 180, road: 'divided', lanesOwn: 3, lanesFar: 2, footpathL: true, traffic: 0.55, oncoming: 0.4, potholes: 0.5, puddles: 0.55, peds: 0.3, cows: 0, wrongSide: 0.4, features: [{ kind: 'busStop', at: 72 }] },
        { len: 180, jam: true, traffic: 0.95, potholes: 0.4, puddles: 0.45, wrongSide: 0.2, features: [{ kind: 'barricade', at: 30, len: 108, lanes: [2] }] },
        { len: 120, road: 'undivided', lanesOwn: 3, lanesOncoming: 1, footpathL: false, footpathR: true, traffic: 0.45, oncoming: 0.4, potholes: 0.6, puddles: 0.7, peds: 0.45, wrongSide: 0.3, features: [{ kind: 'speedBreaker', at: 60, marked: true }] },
        { len: 90, area: 'techpark', footpathL: true, potholes: 0.3, puddles: 0.5, parked: 0.25 },
      ],
    },

    // ---- Grocery delivery: 10-minute orders to towers and gully houses --------
    {
      id: 4,
      mode: 'delivery',
      clockRate: 3,
      name: 'First Shift: Koramangala Gullies',
      weather: 'clear',
      start: '18:30',
      blurb: 'Three orders. Two houses deep in the gullies, then an apartment tower. Parked cars, cows, carts and two-way traffic in lanes barely wide enough.',
      mix: { bike: 4, auto: 3, car: 4, cart: 0.6, bus: 0, tanker: 0 },
      drops: [
        { at: 198, kind: 'house', name: 'No. 42, 3rd Cross', due: '18:34' },
        { at: 422, kind: 'house', name: 'Sri Lakshmi Nilaya, 5th Main', due: '18:36' },
        { at: 685, kind: 'apartment', name: 'Sunshine Residency, B-304', due: '18:39' },
      ],
      landmarks: [
        { at: 0, name: 'Dark store, 6th Block' },
        { at: 270, name: 'Gully maze' },
        { at: 494, name: '80 Feet Road' },
      ],
      // Bends and junction turns: k = curvature (1/radius, 1/m), > 0 bends right.
      curves: [
        { at: 48, len: 38, k: -0.04 },
        { at: 137, len: 36, k: 0.012 },
        { at: 258, len: 35, k: 0.045 },
        { at: 337, len: 36, k: -0.015 },
        { at: 462, len: 40, k: 0.04 },
        { at: 579, len: 38, k: -0.04 },
      ],
      hints: [
        { at: 0, key: 'controls', text: 'Throttle is automatic. Steer with ← → or drag. Brake with ↓ or the brake button.' },
        { at: 35, key: 'drop', text: 'Purple pins are your drops. Pull over to the LEFT kerb inside the purple zone and stop to hand over.' },
        { at: 70, key: 'turn', text: 'Turn ahead! Bends push you outwards, so steer into them.' },
        { at: 105, key: 'gully', text: 'Gully: cars parked on both sides, people walking around them, traffic both ways. Squeeze through, gently.' },
        { at: 240, key: 'bag', text: 'Potholes and crashes squash the groceries in your bag. Broken eggs mean bad ratings.' },
        { at: 312, key: 'giveway', text: 'Stop for people crossing: good karma. Good karma brings tips, water and sweets.' },
        { at: 373, key: 'horn', text: 'Honk (Space / horn) to warn people ahead. More than 3 honks in 10 s costs karma.' },
        { at: 482, key: 'wrongside', text: 'Wrong-side riders ahead! Headlights and a ▼ mean one is coming at you.' },
        { at: 602, key: 'apartment', text: 'Apartment gates take longer: security, entry register, the lift. Stop at the gate.' },
      ],
      segments: [
        { len: 65, road: 'undivided', lanesOwn: 1, lanesOncoming: 1, footpathL: true, footpathR: true, traffic: 0.2, oncoming: 0.25, potholes: 0.3, puddles: 0.1, peds: 0.35, cows: 0, parked: 0.3, area: 'main' },
        { len: 205, area: 'gully', edgeW: T.GULLY_EDGE_W, footpathL: false, footpathR: false, mix: GULLY_MIX, traffic: 0.25, oncoming: 0.35, potholes: 0.6, puddles: 0.2, peds: 0.6, cows: 0.35, parked: 0.6, parkedR: 0.5, features: [{ kind: 'speedBreaker', at: 72, marked: false }] },
        { len: 200, potholes: 0.7, puddles: 0.35, cows: 0.3, features: [{ kind: 'speedBreaker', at: 120, marked: true }] },
        { len: 120, area: 'main', edgeW: 0, mix: null, footpathL: true, footpathR: false, wrongSide: 0.6, traffic: 0.3, oncoming: 0.3, potholes: 0.45, puddles: 0.2, peds: 0.45, cows: 0.1, parked: 0.3, parkedR: 0, features: [{ kind: 'busStop', at: 48 }] },
        { len: 130, area: 'highrise', footpathL: true, footpathR: true, wrongSide: 0.3, traffic: 0.25, peds: 0.35, cows: 0, parked: 0.2 },
      ],
    },
    {
      id: 5,
      mode: 'delivery',
      clockRate: 3,
      name: 'Tower Rush: Bellandur',
      weather: 'clear',
      start: '19:00',
      blurb: 'Three apartment towers off the Outer Ring Road. Heavy traffic, two jams, metro barricades, and security gates that take their time.',
      mix: { bike: 5, auto: 2, car: 8, bus: 1.4, tanker: 0.3 },
      drops: [
        { at: 216, kind: 'apartment', name: 'Lakeview Heights, Tower C-1204', due: '19:04' },
        { at: 528, kind: 'apartment', name: 'Green Meadows, Block 7-602', due: '19:07' },
        { at: 810, kind: 'apartment', name: 'Skyline Residency, T2-1801', due: '19:10' },
      ],
      landmarks: [
        { at: 0, name: 'Dark store, Agara' },
        { at: 330, name: 'Bellandur junction' },
        { at: 660, name: 'Marathahalli bridge' },
      ],
      // Bends and junction turns: k = curvature (1/radius, 1/m), > 0 bends right.
      curves: [
        { at: 90, len: 90, k: 0.006 },
        { at: 288, len: 108, k: -0.008 },
        { at: 510, len: 90, k: 0.01 },
        { at: 660, len: 72, k: -0.006 },
        { at: 750, len: 36, k: 0.012 },
      ],
      hints: [
        { at: 12, key: 'filter', text: 'Heavy traffic. Filter between lanes, and keep left for the tower gates.' },
        { at: 234, key: 'jam', text: 'Jam ahead. Traffic moves in stop-go waves. Look for gaps you fit through.' },
      ],
      segments: [
        { len: 120, road: 'divided', lanesOwn: 3, lanesFar: 2, footpathL: true, traffic: 0.55, oncoming: 0.45, potholes: 0.25, puddles: 0.1, peds: 0.25, cows: 0.03, wrongSide: 0.3, parked: 0.5, area: 'main', features: [{ kind: 'busStop', at: 84 }] },
        { len: 120, area: 'highrise', traffic: 0.6, parked: 0.45, features: [{ kind: 'barricade', at: 12, len: 96, lanes: [2] }] },
        { len: 90, area: 'main', jam: true, traffic: 0.9, potholes: 0.35, features: [{ kind: 'barricade', at: 12, len: 66, lanes: [2] }] },
        { len: 120, traffic: 0.55, footpathL: false, wrongSide: 0.6, peds: 0.4, potholes: 0.5, parked: 0, features: [{ kind: 'speedBreaker', at: 60, marked: false }, { kind: 'busStop', at: 102 }] },
        { len: 120, area: 'highrise', traffic: 0.65, footpathL: true, wrongSide: 0.3, potholes: 0.3, parked: 0.45, features: [{ kind: 'barricade', at: 12, len: 84, lanes: [2] }] },
        { len: 90, area: 'main', jam: true, traffic: 0.9, wrongSide: 0.4, parked: 0 },
        { len: 180, area: 'highrise', traffic: 0.5, wrongSide: 0.5, potholes: 0.35, parked: 0.45, features: [{ kind: 'busStop', at: 36 }, { kind: 'barricade', at: 96, len: 60, lanes: [2] }] },
      ],
    },
    {
      id: 6,
      mode: 'delivery',
      clockRate: 3,
      name: 'Monsoon Mix: HSR Layout',
      weather: 'rain',
      start: '20:00',
      blurb: 'Rain, four orders: gully houses and apartment towers. Puddles hide potholes, tankers leak, and every turn changes the road.',
      mix: { bike: 5, auto: 3, car: 7, bus: 1.1, tanker: 1.4 },
      drops: [
        { at: 132, kind: 'house', name: 'Ashirwad, 14th Cross', due: '20:03' },
        { at: 372, kind: 'apartment', name: 'Silver Oak Towers, A-902', due: '20:05' },
        { at: 648, kind: 'house', name: 'Sri Krishna Krupa, 2nd Main', due: '20:08' },
        { at: 840, kind: 'apartment', name: 'Palm Grove, Tower 4-1102', due: '20:10' },
      ],
      landmarks: [
        { at: 0, name: 'Dark store, HSR' },
        { at: 180, name: '27th Main' },
        { at: 420, name: 'Agara junction' },
        { at: 690, name: 'Sector 2' },
      ],
      // Bends and junction turns: k = curvature (1/radius, 1/m), > 0 bends right.
      curves: [
        { at: 72, len: 30, k: -0.02 },
        { at: 160, len: 40, k: 0.04 },
        { at: 312, len: 48, k: -0.01 },
        { at: 520, len: 38, k: -0.042 },
        { at: 672, len: 38, k: 0.042 },
        { at: 780, len: 36, k: -0.012 },
      ],
      hints: [
        { at: 6, key: 'rain', text: 'Rain: brakes are weaker, and a puddle may hide a pothole. Avoid puddles when you can.' },
        { at: 156, key: 'junction', text: 'Junction turn: the road changes width. Traffic in lanes that end turns off.' },
      ],
      segments: [
        { len: 180, road: 'undivided', lanesOwn: 1, lanesOncoming: 1, area: 'gully', edgeW: T.GULLY_EDGE_W, footpathL: false, footpathR: false, mix: GULLY_MIX, traffic: 0.3, oncoming: 0.35, potholes: 0.5, puddles: 0.6, peds: 0.5, cows: 0.2, parked: 0.5, parkedR: 0.4 },
        { len: 240, junction: true, lanesOwn: 2, lanesOncoming: 1, area: 'highrise', edgeW: 0, mix: null, footpathL: true, footpathR: true, traffic: 0.45, oncoming: 0.4, potholes: 0.45, puddles: 0.55, peds: 0.35, cows: 0.05, wrongSide: 0.3, parked: 0.3, parkedR: 0, features: [{ kind: 'speedBreaker', at: 48, marked: true }] },
        { len: 120, area: 'main', jam: true, traffic: 0.95, potholes: 0.4, puddles: 0.45, wrongSide: 0.2, parked: 0, features: [{ kind: 'barricade', at: 24, len: 72, lanes: [1] }] },
        { len: 150, junction: true, lanesOwn: 1, lanesOncoming: 1, area: 'gully', edgeW: T.GULLY_EDGE_W, footpathL: false, footpathR: false, mix: GULLY_MIX, traffic: 0.3, oncoming: 0.35, potholes: 0.6, puddles: 0.7, peds: 0.5, cows: 0.25, parked: 0.5, parkedR: 0.4 },
        { len: 180, junction: true, lanesOwn: 2, lanesOncoming: 1, area: 'highrise', edgeW: 0, mix: null, footpathL: true, footpathR: true, traffic: 0.4, oncoming: 0.4, potholes: 0.5, puddles: 0.6, peds: 0.35, cows: 0, wrongSide: 0.3, parked: 0.3, parkedR: 0, features: [{ kind: 'busStop', at: 60 }] },
      ],
    },
  ];

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------

  /**
   * Cross-section of a segment. All x in metres.
   *   wallL ... 0          left footpath / shoulder (shop fronts at wallL)
   *   0 ... ownR           player's carriageway (lanesOwn lanes)
   *   undivided: ownR ... roadR oncoming lanes, roadR ... wallR right edge zone
   *   divided:   ownR ... farL median, farL ... farR far carriageway (decoration), farR ... wallR far footpath
   *   limitL/limitR        where the player is clamped
   *   oncL, oncLanes       oncoming lanes (on the far carriageway when divided)
   */
  function crossSection(s) {
    const LW = T.LANE_W;
    const ownR = s.lanesOwn * LW;
    const ew = s.edgeW || T.EDGE_W;
    const xs = { divided: s.road === 'divided', wallL: -ew, ownR };
    if (xs.divided) {
      const far = Math.min(2, s.lanesFar || s.lanesOwn);
      xs.farL = ownR + T.MEDIAN_W;
      xs.farR = xs.farL + far * LW;
      xs.roadR = ownR;
      xs.wallR = xs.farR + ew;
      xs.limitR = ownR;
      xs.oncL = xs.farL;
      xs.oncLanes = far;
    } else {
      xs.roadR = ownR + s.lanesOncoming * LW;
      xs.wallR = xs.roadR + ew;
      xs.limitR = xs.wallR;
      xs.oncL = ownR;
      xs.oncLanes = s.lanesOncoming;
    }
    xs.limitL = xs.wallL;
    return xs;
  }

  function parseClock(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 3600 + m * 60;
  }

  function resolveLevel(def) {
    const segs = [];
    let y = 0;
    let prev = SEG_DEFAULTS;
    for (const raw of def.segments) {
      const s = {};
      for (const k in SEG_DEFAULTS) s[k] = prev[k];
      s.jam = false;
      s.junction = false;
      s.features = [];
      Object.assign(s, raw);
      s.mix = s.mix || def.mix;
      s.i = segs.length;
      s.y0 = y;
      s.y1 = y + s.len;
      y = s.y1;
      s.xs = crossSection(s);
      s.features = (raw.features || []).map((f) => Object.assign({}, f, { y: s.y0 + f.at, y1: s.y0 + f.at + (f.len || 0), seg: s.i }));
      segs.push(s);
      prev = s;
    }
    const features = [];
    for (const s of segs) for (const f of s.features) features.push(f);
    features.sort((a, b) => a.y - b.y);
    // One rect per run of adjacent closed lanes (lanes [1,2] is one wide barricade).
    const barricades = [];
    for (const f of features) {
      if (f.kind !== 'barricade') continue;
      const lanes = [...f.lanes].sort((a, b) => a - b);
      for (let i = 0; i < lanes.length; ) {
        let j = i;
        while (j + 1 < lanes.length && lanes[j + 1] === lanes[j] + 1) j++;
        barricades.push({ x0: lanes[i] * T.LANE_W + 0.15, x1: (lanes[j] + 1) * T.LANE_W - 0.15, y0: f.y, y1: f.y1, lanes: lanes.slice(i, j + 1) });
        i = j + 1;
      }
    }
    return {
      id: def.id,
      mode: def.mode || 'commute',
      clockRate: def.clockRate || T.CLOCK_RATE,
      destination: def.destination || null,
      name: def.name,
      blurb: def.blurb,
      weather: def.weather,
      startTime: parseClock(def.start),
      drops: (def.drops || []).map((d, i) => ({ i, y: d.at, kind: d.kind, name: d.name, due: parseClock(d.due) })),
      deadline: def.drops && def.drops.length ? parseClock(def.drops[def.drops.length - 1].due) : T.DEADLINE,
      length: y,
      segs,
      features,
      breakers: features.filter((f) => f.kind === 'speedBreaker'),
      busStops: features.filter((f) => f.kind === 'busStop'),
      barricades,
      hints: def.hints || [],
      junctions: segsJunctions(segs),
      curves: (def.curves || []).map((c) => ({ y0: c.at, y1: c.at + c.len, k: c.k })).sort((a, b) => a.y0 - b.y0),
      landmarks: def.landmarks || [],
      mix: def.mix,
    };
  }

  function segsJunctions(segs) {
    const out = [];
    for (const s of segs) if (s.junction && s.i > 0) out.push(s.y0);
    return out;
  }

  /** Level ids of a mode, in play order. */
  function levelsOf(mode) { return LEVELS.filter((d) => (d.mode || 'commute') === mode).map((d) => d.id); }
  /** The level that unlocks this one (the previous one in the same mode), or null. */
  function prevInMode(id) {
    const def = LEVELS.find((d) => d.id === id);
    const ids = levelsOf((def && def.mode) || 'commute');
    const i = ids.indexOf(id);
    return i > 0 ? ids[i - 1] : null;
  }

  const cache = new Map();
  /** Resolved, cached, read-only level. Never mutate it: it is shared by all runs. */
  function level(id) {
    let L = cache.get(id);
    if (!L) {
      const def = LEVELS.find((d) => d.id === id);
      if (!def) throw new Error('Unknown level ' + id);
      L = resolveLevel(def);
      cache.set(id, L);
    }
    return L;
  }

  /** Segment containing y (clamped to the level). Binary search. */
  function segmentAt(L, y) {
    const segs = L.segs;
    if (y <= 0) return segs[0];
    if (y >= L.length) return segs[segs.length - 1];
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].y0 <= y) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  /** Road curvature (1/m, > 0 bends right) at y. Gameplay uses it for drift; the renderer bends the road. */
  function curveAt(L, y) {
    const c = L.curves;
    for (let i = 0; i < c.length; i++) {
      if (y < c[i].y0) return 0;
      if (y < c[i].y1) return c[i].k;
    }
    return 0;
  }

  /** 'road' | 'footpath' | 'shoulder' under x for the player (no median: the player is clamped). */
  function surfaceAt(s, x) {
    if (x < 0) return s.footpathL ? 'footpath' : 'shoulder';
    if (!s.xs.divided && x > s.xs.roadR) return s.footpathR ? 'footpath' : 'shoulder';
    return 'road';
  }

  /** x range where pedestrians walk on a side (0 = left, 1 = right). */
  function pedBand(s, side) {
    const xs = s.xs;
    if (side === 0) return s.footpathL ? [xs.wallL + 0.5, -0.45] : [0.3, T.PED_ROAD_BAND];
    if (xs.divided) return [xs.farR + 0.45, xs.wallR - 0.5];
    return s.footpathR ? [xs.roadR + 0.45, xs.wallR - 0.5] : [xs.roadR - T.PED_ROAD_BAND, xs.roadR - 0.3];
  }

  const laneCenter = (i) => (i + 0.5) * T.LANE_W;
  // Oncoming lane j counts outward from the centre line / median (j = 0 is the
  // fast lane), so lanes line up across divided/undivided transitions.
  const oncCenter = (s, j) => s.xs.oncL + (j + 0.5) * T.LANE_W;

  /** Stop-go speed cap inside a jam: a wave of period JAM_PERIOD travelling backwards. */
  function jamCap(y, simTime) {
    const ph = simTime / T.JAM_PERIOD + y / T.JAM_WAVELENGTH;
    const v = 1.5 + 2.2 * Math.sin(ph * Math.PI * 2);
    return v < T.JAM_SPEED_MIN ? T.JAM_SPEED_MIN : v > T.JAM_SPEED_MAX ? T.JAM_SPEED_MAX : v;
  }

  /** The barricade rect covering (x, y) widened by `pad`, or null. */
  function barricadeAt(L, x, y, pad) {
    pad = pad || 0;
    for (const b of L.barricades) {
      if (y >= b.y0 - pad && y <= b.y1 + pad && x >= b.x0 - pad && x <= b.x1 + pad) return b;
    }
    return null;
  }

  /** True if lane i is blocked by a barricade anywhere in [y0, y1]. */
  function laneBlocked(L, lane, y0, y1) {
    for (const b of L.barricades) if (b.lanes.indexOf(lane) >= 0 && b.y1 >= y0 && b.y0 <= y1) return true;
    return false;
  }

  /** XP needed to reach skill level n. */
  function xpForLevel(n) { return 50 * n * (n + 1); }
  /** Skill level for a total XP, capped at SKILL_MAX. */
  function skillLevel(xp) {
    let n = 0;
    while (n < T.SKILL_MAX && xp >= xpForLevel(n + 1)) n++;
    return n;
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  return {
    DT, T, VEHICLES, PED, LEVELS, SEG_DEFAULTS, Rng,
    level, segmentAt, surfaceAt, curveAt, levelsOf, prevInMode, pedBand, crossSection, laneCenter, oncCenter,
    jamCap, barricadeAt, laneBlocked, parseClock, fmtClock, xpForLevel, skillLevel,
    levelIds: LEVELS.map((l) => l.id),
  };
});
