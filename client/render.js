/*
 * client/render.js: first-person view from the rider's seat of a Yolo.
 *
 *   const R = GameRender.create(canvas);
 *   R.draw(state, alpha, interp, frameDt, { hud })   // every frame
 *   R.onEvents(events, state)                        // shake, splashes, bubbles
 *   R.reset(); R.resize(); R.setReduceShake(bool)
 *
 * Pseudo-3D on Canvas 2D (docs/concepts/first-person-view.md):
 * - Sim coordinates are road-aligned (x across, y along). The camera sits on
 *   the rider (x, y, 1.3 m up) looking along the road. A point at lateral x,
 *   depth d projects to screenX = cx + (x - camX + bend(d)) * f / d,
 *   screenY = horizon + (camH - z) * f / d.
 * - bend(d) integrates the level's curvature ahead, so bends and junction
 *   turns sweep the road (and everything on it) sideways. Gameplay never
 *   sees this; it only feels the outward drift on bends.
 * - Painter's order: sky -> ground strips (far to near) -> shop facades ->
 *   depth-sorted things (vehicles as boxes with a sprite face, people, cows,
 *   trees, poles, barricade chunks) -> particles -> rain -> bubbles ->
 *   cockpit (handlebar, display, mirrors) -> HUD.
 */
(function (root) {
  'use strict';
  const { T, DT, VEHICLES } = World;
  const SP = Kit.Sprites;
  const h01 = SP.hash01;
  const shade = SP.shade;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  const CAM_H = 1.3;
  const NEAR = 0.6;
  const FAR = 150;
  const HGT = { bike: 1.55, auto: 1.75, car: 1.45, bus: 3.1, tanker: 2.9, cart: 1.4 };
  const PURPLE = '#7b2cbf';

  const PAL = {
    sky0: '#7fb2d9', sky1: '#e6dfcb', skyRain0: '#5e6b77', skyRain1: '#a7aeb2',
    fog: '#d9d4c3', fogRain: '#9aa2a6',
    ground: '#76694f', asphalt: '#474b52', asphalt2: '#43474e', asphaltWet: '#33383f', asphaltWet2: '#30353b',
    line: '#ece6d6', yellow: '#f4c20d', slab: '#b9b09e', dirt: '#8a7253', median: '#5b8a3c', kerbA: '#202020', kerbB: '#e8c547',
    puddle: 'rgba(92,120,148,0.9)', puddleHi: 'rgba(225,238,248,0.55)', pothole: '#1c1814', potholeRim: '#5a534a',
    barA: '#1f6fc4', barB: '#eef2f5',
    yolo: '#1fb5c4', yoloDark: '#13808c',
  };
  const C = {
    bike: ['#c0392b', '#2c3e50', '#7f8c8d', '#16a085', '#8e44ad', '#d35400', '#1f1f1f', '#bdc3c7'],
    helmet: ['#f1c40f', '#ecf0f1', '#e74c3c', '#3498db', '#111111', '#2ecc71', '#ff9ff3', '#555555'],
    shirt: ['#34495e', '#e67e22', '#2980b9', '#ecf0f1', '#27ae60', '#7f8c8d', '#c0392b', '#f39c12'],
    car: ['#f2f2f2', '#b8bcc2', '#b3261e', '#1f4e8c', '#222222', '#6b7078', '#6d1a36', '#d9cbb0'],
    bus: ['#b8312f', '#1f5fa8', '#2e7d32'],
    tankerCab: ['#1565c0', '#d38b00'],
    tank: ['#dfe6ec', '#f3f3f3'],
    cow: ['#f1ede4', '#cfc4b2', '#8d8070'],
    ped: ['#e74c3c', '#3498db', '#f39c12', '#9b59b6', '#1abc9c', '#e84393', '#2d3436', '#fdcb6e', '#00b894', '#6c5ce7'],
    skin: ['#8d5a3b', '#a9714b', '#6b4428', '#c48a5c'],
    wall: ['#e9c46a', '#f4a261', '#8ecae6', '#a8dadc', '#cdb4db', '#f1e3c8', '#b5e48c', '#e5989b', '#d8d0c0', '#c9ada7'],
    awning: ['#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085'],
    sign: ['#ffd23f', '#3bceac', '#ee4266', '#0ead69', '#540d6e', '#f7f7f7', '#1d3557'],
  };

  // ---------------------------------------------------------------------------
  // Sprite recipes: front or rear views, in metres, origin at the centre,
  // ground at +h/2. Baked once per screen size by kit/sprites.
  // ---------------------------------------------------------------------------
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); g.fill(); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function box(g, x, y, w, h, r) { SP.roundRect(g, x, y, w, h, r || 0.0001); g.fill(); }
  function poly(g, pts) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); }
  function shadowUnder(g, w, h) { g.fillStyle = 'rgba(0,0,0,0.35)'; ell(g, 0, h / 2 - 0.02, w * 0.55, 0.07); }

  function carFace(g, col, cab, front) {
    const top = -0.725;
    const bot = 0.725;
    shadowUnder(g, 1.8, 1.45);
    g.fillStyle = '#111'; box(g, -0.86, bot - 0.32, 0.3, 0.32, 0.06); box(g, 0.56, bot - 0.32, 0.3, 0.32, 0.06);
    g.fillStyle = col; box(g, -0.9, -0.08, 1.8, 0.7, 0.14);
    g.fillStyle = shade(col, -0.06); poly(g, [-0.74, -0.06, 0.74, -0.06, 0.58, top + 0.04, -0.58, top + 0.04]);
    g.fillStyle = front ? '#3c4e5b' : '#28343f'; poly(g, [-0.64, -0.12, 0.64, -0.12, 0.5, top + 0.13, -0.5, top + 0.13]);
    g.fillStyle = 'rgba(255,255,255,0.14)'; poly(g, [-0.5, -0.14, -0.2, -0.14, -0.02, top + 0.15, -0.3, top + 0.15]);
    if (front) {
      g.fillStyle = '#fff8d6'; box(g, -0.84, 0.0, 0.32, 0.13, 0.04); box(g, 0.52, 0.0, 0.32, 0.13, 0.04);
      g.fillStyle = '#1c1c1c'; box(g, -0.32, 0.04, 0.64, 0.12, 0.03);
    } else {
      g.fillStyle = '#c62828'; box(g, -0.86, 0.0, 0.32, 0.14, 0.04); box(g, 0.54, 0.0, 0.32, 0.14, 0.04);
    }
    g.fillStyle = cab ? '#f9d71c' : '#eeeeee'; box(g, -0.25, 0.25, 0.5, 0.13, 0.02);
    g.fillStyle = shade(col, -0.4); box(g, -0.9, 0.5, 1.8, 0.12, 0.05);
    if (cab) { g.fillStyle = '#f9d71c'; box(g, -0.2, top - 0.0, 0.4, 0.06, 0.02); }
  }

  function autoFace(g, v, front, fare) {
    const top = -0.875;
    const bot = 0.875;
    const body = shade('#2e7d32', v * 0.06);
    const yel = shade('#f4c20d', -v * 0.05);
    shadowUnder(g, 1.4, 1.75);
    g.fillStyle = '#111';
    if (front) box(g, -0.1, bot - 0.3, 0.2, 0.3, 0.05);
    else { box(g, -0.72, bot - 0.3, 0.2, 0.3, 0.05); box(g, 0.52, bot - 0.3, 0.2, 0.3, 0.05); }
    g.fillStyle = body; box(g, front ? -0.6 : -0.7, 0.05, front ? 1.2 : 1.4, 0.62, 0.14);
    g.fillStyle = yel;
    g.beginPath(); g.moveTo(-0.7, 0.1); g.lineTo(-0.7, -0.5); g.quadraticCurveTo(-0.7, top, -0.3, top); g.lineTo(0.3, top);
    g.quadraticCurveTo(0.7, top, 0.7, -0.5); g.lineTo(0.7, 0.1); g.closePath(); g.fill();
    g.fillStyle = '#222'; box(g, -0.7, 0.04, 1.4, 0.06);
    if (front) {
      g.fillStyle = '#3c4e5b'; box(g, -0.55, -0.6, 1.1, 0.52, 0.08);
      g.fillStyle = '#1b1b1b'; circ(g, -0.12, -0.32, 0.11); box(g, -0.24, -0.22, 0.24, 0.16, 0.05);
      g.fillStyle = '#fff6c8'; circ(g, 0, 0.3, 0.09);
    } else {
      g.fillStyle = '#1b1d20'; box(g, -0.52, -0.55, 1.04, 0.58, 0.08);
      g.fillStyle = '#6d4c41'; box(g, -0.48, -0.1, 0.96, 0.15, 0.04);
      if (fare) { g.fillStyle = '#1b1410'; circ(g, -0.18, -0.28, 0.11); g.fillStyle = '#3498db'; box(g, -0.32, -0.18, 0.28, 0.1, 0.04); }
      g.fillStyle = '#c62828'; box(g, -0.66, 0.15, 0.14, 0.08, 0.02); box(g, 0.52, 0.15, 0.14, 0.08, 0.02);
      g.fillStyle = '#f9d71c'; box(g, -0.2, 0.38, 0.4, 0.12, 0.02);
    }
  }

  function busFace(g, col, front) {
    shadowUnder(g, 2.6, 3.1);
    g.fillStyle = '#111'; box(g, -1.25, 1.2, 0.4, 0.35, 0.06); box(g, 0.85, 1.2, 0.4, 0.35, 0.06);
    g.fillStyle = col; box(g, -1.3, -1.55, 2.6, 3.0, 0.16);
    g.fillStyle = '#f4f4f4'; box(g, -1.3, 0.05, 2.6, 0.14);
    if (front) {
      g.fillStyle = '#3c4e5b'; box(g, -1.15, -1.22, 2.3, 1.2, 0.12);
      g.fillStyle = col; box(g, -0.03, -1.22, 0.06, 1.2);
      g.fillStyle = '#111'; box(g, -1.0, -1.5, 2.0, 0.24, 0.04);
      g.fillStyle = '#ff9800'; box(g, -0.85, -1.45, 1.7, 0.13, 0.02);
      g.fillStyle = '#fff8d6'; box(g, -1.2, 0.85, 0.4, 0.15, 0.04); box(g, 0.8, 0.85, 0.4, 0.15, 0.04);
    } else {
      g.fillStyle = '#28343f'; box(g, -1.1, -1.35, 2.2, 1.0, 0.1);
      g.fillStyle = '#ff9800'; box(g, -0.4, -1.5, 0.8, 0.12, 0.02);
      g.fillStyle = shade(col, -0.35); box(g, -0.9, 0.45, 1.8, 0.55, 0.06);
      g.fillStyle = '#c62828'; box(g, -1.25, 0.6, 0.25, 0.3, 0.04); box(g, 1.0, 0.6, 0.25, 0.3, 0.04);
    }
    g.fillStyle = '#f9d71c'; box(g, -0.3, 1.1, 0.6, 0.15, 0.02);
    g.fillStyle = shade(col, -0.45); box(g, -1.3, 1.3, 2.6, 0.12, 0.04);
  }

  function tankerFace(g, cabC, tankC, front) {
    shadowUnder(g, 2.4, 2.9);
    g.fillStyle = '#111'; box(g, -1.2, 1.05, 0.45, 0.4, 0.06); box(g, 0.75, 1.05, 0.45, 0.4, 0.06);
    if (front) {
      g.fillStyle = tankC; ell(g, 0, -1.25, 1.0, 0.22);
      g.fillStyle = cabC; box(g, -1.15, -1.15, 2.3, 2.3, 0.2);
      g.fillStyle = '#3c4e5b'; box(g, -1.0, -0.98, 2.0, 0.8, 0.1);
      g.fillStyle = '#1b1b1b'; box(g, -0.6, 0.15, 1.2, 0.4, 0.05);
      g.fillStyle = '#fff8d6'; box(g, -1.05, 0.45, 0.3, 0.14, 0.04); box(g, 0.75, 0.45, 0.3, 0.14, 0.04);
    } else {
      g.fillStyle = '#2b2b2b'; box(g, -1.1, 0.55, 2.2, 0.5, 0.05);
      g.fillStyle = tankC; ell(g, 0, -0.3, 1.15, 1.05);
      g.strokeStyle = shade(tankC, -0.3); g.lineWidth = 0.06; g.beginPath(); g.ellipse(0, -0.3, 1.0, 0.9, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = shade(tankC, -0.35); circ(g, 0, 0.35, 0.12);
      g.strokeStyle = '#555'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(0.75, -1.1); g.lineTo(0.75, 0.6); g.moveTo(0.95, -0.9); g.lineTo(0.95, 0.6);
      for (let y = -0.8; y < 0.6; y += 0.25) { g.moveTo(0.75, y); g.lineTo(0.95, y); }
      g.stroke();
      g.fillStyle = '#c62828'; box(g, -1.1, 0.75, 0.25, 0.14, 0.03); box(g, 0.85, 0.75, 0.25, 0.14, 0.03);
      g.fillStyle = 'rgba(80,140,200,0.8)'; ell(g, -0.2, 1.35, 0.12, 0.04);
    }
    g.fillStyle = '#f9d71c'; box(g, -0.28, 0.95, 0.56, 0.14, 0.02);
  }

  function bikeFace(g, body, helmet, shirt, front) {
    const bot = 0.775;
    shadowUnder(g, 0.8, 1.55);
    g.fillStyle = '#111'; box(g, -0.06, bot - 0.42, 0.12, 0.42, 0.04);
    g.fillStyle = body; box(g, -0.17, 0.0, 0.34, 0.42, 0.09);
    g.fillStyle = shade(shirt, -0.4); box(g, -0.24, -0.02, 0.14, 0.38, 0.05); box(g, 0.1, -0.02, 0.14, 0.38, 0.05);
    g.fillStyle = shirt; poly(g, [-0.24, 0.06, 0.24, 0.06, 0.2, -0.46, -0.2, -0.46]);
    g.strokeStyle = shirt; g.lineWidth = 0.09; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.19, -0.38); g.lineTo(-0.36, -0.2); g.moveTo(0.19, -0.38); g.lineTo(0.36, -0.2); g.stroke();
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(-0.38, -0.18); g.lineTo(0.38, -0.18); g.stroke();
    g.fillStyle = '#cfd8dc'; circ(g, -0.4, -0.36, 0.05); circ(g, 0.4, -0.36, 0.05);
    g.fillStyle = helmet; circ(g, 0, -0.6, 0.15);
    if (front) {
      g.fillStyle = 'rgba(15,20,30,0.8)'; box(g, -0.11, -0.64, 0.22, 0.09, 0.03);
      g.fillStyle = '#fffbe0'; circ(g, 0, 0.06, 0.09);
    } else {
      g.fillStyle = '#c62828'; box(g, -0.08, 0.08, 0.16, 0.06, 0.02);
    }
  }

  function pedFace(g, clothes, v, frame) {
    const bot = 0.825;
    const skin = C.skin[v % C.skin.length];
    shadowUnder(g, 0.55, 1.65);
    const saree = v % 3 === 1;
    const swing = frame === 1 ? 0.07 : frame === 0 ? -0.07 : 0;
    if (saree) {
      g.fillStyle = clothes; poly(g, [-0.18, -0.1, 0.18, -0.1, 0.24, bot - 0.05, -0.24, bot - 0.05]);
      g.fillStyle = shade(clothes, 0.35); box(g, -0.24, bot - 0.14, 0.48, 0.06);
      g.fillStyle = '#2a1e16'; box(g, -0.12 + swing, bot - 0.06, 0.1, 0.05); box(g, 0.02 - swing, bot - 0.06, 0.1, 0.05);
    } else {
      const trouser = v % 2 ? '#2d2a26' : '#3a4a5c';
      g.fillStyle = trouser; box(g, -0.15 + swing, 0.05, 0.12, bot - 0.08, 0.04); box(g, 0.03 - swing, 0.05, 0.12, bot - 0.08, 0.04);
      g.fillStyle = '#1b1b1b'; box(g, -0.16 + swing, bot - 0.06, 0.14, 0.06, 0.02); box(g, 0.02 - swing, bot - 0.06, 0.14, 0.06, 0.02);
    }
    g.fillStyle = clothes; box(g, -0.2, -0.47, 0.4, 0.58, 0.1);
    if (saree) { g.fillStyle = shade(clothes, 0.3); poly(g, [0.2, -0.45, 0.05, -0.45, -0.2, 0.05, -0.1, 0.1]); }
    g.fillStyle = skin;
    if (frame === 2) { // hailing: right arm up
      box(g, -0.28, -0.42, 0.09, 0.42, 0.04); box(g, 0.2, -0.95, 0.09, 0.5, 0.04);
    } else {
      box(g, -0.28, -0.42 - swing * 0.3, 0.09, 0.44, 0.04); box(g, 0.19, -0.42 + swing * 0.3, 0.09, 0.44, 0.04);
    }
    circ(g, 0, -0.63, 0.13);
    g.fillStyle = v % 4 === 3 ? '#cfcfcf' : '#1b1410';
    g.beginPath(); g.arc(0, -0.65, 0.135, Math.PI, 0); g.fill();
    if (saree) { g.fillStyle = '#ffffff'; circ(g, 0.12, -0.7, 0.025); circ(g, 0.14, -0.66, 0.025); }
  }

  function cowSide(g, col, sitting) {
    shadowUnder(g, 2.1, 1.45);
    const dk = shade(col, -0.35);
    const by = sitting ? 0.3 : -0.05;
    if (!sitting) {
      g.fillStyle = dk;
      for (const x of [-0.6, -0.4, 0.4, 0.6]) box(g, x - 0.06, 0.05, 0.12, 0.66, 0.04);
    } else { g.fillStyle = dk; box(g, -0.7, 0.55, 0.5, 0.12, 0.05); box(g, 0.3, 0.55, 0.4, 0.12, 0.05); }
    g.strokeStyle = dk; g.lineWidth = 0.05; g.beginPath(); g.moveTo(0.8, by - 0.2); g.quadraticCurveTo(0.95, by + 0.1, 0.9, by + 0.4); g.stroke();
    g.fillStyle = col; ell(g, 0, by, 0.82, 0.36);
    g.fillStyle = shade(col, -0.2); ell(g, 0.25, by - 0.05, 0.22, 0.16); ell(g, -0.2, by + 0.08, 0.15, 0.12);
    g.fillStyle = shade(col, -0.05); ell(g, -0.45, by - 0.32, 0.22, 0.16);
    g.fillStyle = shade(col, -0.1); ell(g, -0.92, by - 0.18, 0.22, 0.17);
    g.fillStyle = '#d6a0a0'; ell(g, -1.08, by - 0.12, 0.07, 0.06);
    g.strokeStyle = '#efe4c8'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(-0.88, by - 0.32); g.quadraticCurveTo(-0.84, by - 0.5, -0.74, by - 0.56); g.stroke();
    g.fillStyle = '#1b1b1b'; circ(g, -0.98, by - 0.22, 0.03);
  }

  function cowFront(g, col) {
    shadowUnder(g, 0.9, 1.45);
    const dk = shade(col, -0.35);
    g.fillStyle = dk; box(g, -0.3, 0.1, 0.13, 0.62, 0.04); box(g, 0.17, 0.1, 0.13, 0.62, 0.04);
    g.fillStyle = col; ell(g, 0, 0.0, 0.42, 0.36);
    g.fillStyle = shade(col, -0.1); ell(g, 0, -0.22, 0.2, 0.28);
    g.fillStyle = shade(col, -0.2); ell(g, -0.25, -0.32, 0.1, 0.05); ell(g, 0.25, -0.32, 0.1, 0.05);
    g.strokeStyle = '#efe4c8'; g.lineWidth = 0.05;
    g.beginPath(); g.moveTo(-0.1, -0.44); g.quadraticCurveTo(-0.22, -0.55, -0.24, -0.68); g.moveTo(0.1, -0.44); g.quadraticCurveTo(0.22, -0.55, 0.24, -0.68); g.stroke();
    g.fillStyle = '#d6a0a0'; ell(g, 0, -0.02, 0.11, 0.07);
    g.fillStyle = '#1b1b1b'; circ(g, -0.09, -0.27, 0.03); circ(g, 0.09, -0.27, 0.03);
  }

  function tree(g, v) {
    g.fillStyle = '#5d4630'; box(g, -0.18, 0.4, 0.36, 3.1, 0.08);
    const greens = ['#2f6b37', '#3b8044', '#2a5e30', '#46914f'];
    for (let i = 0; i < 9; i++) {
      g.fillStyle = greens[(i + v) % 4];
      circ(g, (h01(v, i, 1) - 0.5) * 3.6, -1.2 + (h01(v, i, 2) - 0.5) * 2.6, 0.9 + h01(v, i, 3) * 0.7);
    }
  }

  function shrub(g, v) {
    g.fillStyle = v ? '#3d6a29' : '#4e7e32';
    circ(g, -0.2, 0.05, 0.35); circ(g, 0.2, 0.1, 0.32); circ(g, 0, -0.15, 0.32);
  }

  /** Vegetable push-cart with its vendor (rear view: vendor in front of us; front view: vendor behind the pile). */
  function cartFace(g, v, front) {
    shadowUnder(g, 1.1, 1.4);
    const veg = v ? ['#2e7d32', '#f57c00', '#c62828', '#558b2f'] : ['#43a047', '#fbc02d', '#8e24aa', '#ef6c00'];
    const vendor = () => {
      g.fillStyle = '#3a4a5c'; box(g, -0.14, 0.1, 0.12, 0.55, 0.03); box(g, 0.02, 0.1, 0.12, 0.55, 0.03);
      g.fillStyle = v ? '#6d4c41' : '#ff7043'; box(g, -0.19, -0.42, 0.38, 0.55, 0.08);
      g.fillStyle = '#8d5a3b'; circ(g, 0, -0.56, 0.12);
      g.fillStyle = '#f5f5f5'; box(g, -0.13, -0.7, 0.26, 0.08, 0.03);
    };
    if (!front) { g.save(); g.translate(0.0, 0.0); }
    g.fillStyle = '#4e342e'; circ(g, -0.5, 0.48, 0.2); circ(g, 0.5, 0.48, 0.2);
    g.fillStyle = '#8d6e63'; circ(g, -0.5, 0.48, 0.1); circ(g, 0.5, 0.48, 0.1);
    g.fillStyle = '#795548'; box(g, -0.55, 0.0, 1.1, 0.32, 0.04);
    for (let i = 0; i < 14; i++) { g.fillStyle = veg[i % 4]; circ(g, -0.45 + (i % 7) * 0.15, -0.04 - Math.floor(i / 7) * 0.1, 0.09); }
    if (!front) g.restore();
    if (!front) vendor();
  }

  function registerSprites(sp) {
    for (let v = 0; v < 2; v++) {
      sp.register('cart.r.' + v, 1.1, 1.4, (g) => cartFace(g, v, false));
      sp.register('cart.f.' + v, 1.1, 1.4, (g) => cartFace(g, v, true));
    }
    for (let v = 0; v < 8; v++) {
      sp.register('car.r.' + v, 1.8, 1.45, (g) => carFace(g, C.car[v], false, false));
      sp.register('car.f.' + v, 1.8, 1.45, (g) => carFace(g, C.car[v], false, true));
      sp.register('bike.r.' + v, 0.8, 1.55, (g) => bikeFace(g, C.bike[v], C.helmet[v], C.shirt[v], false));
      sp.register('bike.f.' + v, 0.8, 1.55, (g) => bikeFace(g, C.bike[v], C.helmet[v], C.shirt[v], true));
    }
    sp.register('cab.r', 1.8, 1.45, (g) => carFace(g, '#f7f7f2', true, false));
    sp.register('cab.f', 1.8, 1.45, (g) => carFace(g, '#f7f7f2', true, true));
    for (let v = 0; v < 3; v++) {
      sp.register('auto.r.' + v, 1.4, 1.75, (g) => autoFace(g, v, false, false));
      sp.register('auto.rp.' + v, 1.4, 1.75, (g) => autoFace(g, v, false, true));
      sp.register('auto.f.' + v, 1.4, 1.75, (g) => autoFace(g, v, true, false));
      sp.register('bus.r.' + v, 2.6, 3.1, (g) => busFace(g, C.bus[v], false));
      sp.register('bus.f.' + v, 2.6, 3.1, (g) => busFace(g, C.bus[v], true));
      sp.register('cow.s.' + v, 2.1, 1.45, (g) => cowSide(g, C.cow[v], false));
      sp.register('cow.z.' + v, 2.1, 1.45, (g) => cowSide(g, C.cow[v], true));
      sp.register('cow.f.' + v, 0.9, 1.45, (g) => cowFront(g, C.cow[v]));
    }
    for (let v = 0; v < 2; v++) {
      sp.register('tanker.r.' + v, 2.4, 2.9, (g) => tankerFace(g, C.tankerCab[v], C.tank[v], false));
      sp.register('tanker.f.' + v, 2.4, 2.9, (g) => tankerFace(g, C.tankerCab[v], C.tank[v], true));
      sp.register('shrub.' + v, 1.0, 0.9, (g) => shrub(g, v));
    }
    for (let v = 0; v < 10; v++) for (let f = 0; f < 3; f++) sp.register('ped.' + v + '.' + f, 0.55, 1.65, (g) => pedFace(g, C.ped[v], v, f));
    for (let v = 0; v < 4; v++) sp.register('tree.' + v, 5, 7, (g) => tree(g, v));
  }

  // ---------------------------------------------------------------------------
  function create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const sprites = SP.create({ pad: 0.1 });
    registerSprites(sprites);
    const P = Kit.Particles.create(500);
    const PCOL = ['rgba(205,225,240,0.9)', 'rgba(170,145,105,0.85)', 'rgba(40,34,28,0.95)', 'rgba(255,214,90,0.95)'];
    const bubbles = [];
    const splat = [];
    const items = [];
    let nItems = 0;
    const rain = new Float32Array(160 * 3);
    for (let i = 0; i < 160; i++) { rain[i * 3] = Math.random(); rain[i * 3 + 1] = Math.random(); rain[i * 3 + 2] = 0.6 + Math.random() * 0.6; }
    const DS = new Float64Array(200);
    const OFF = new Float64Array(200);
    let nDS = 0;
    let W = 1;
    let H = 1;
    let dpr = 1;
    let maxDpr = 2;
    let time = 0;
    let f = 300;
    let hY = 300;
    let cx0 = 180;
    let camX = 0;
    let camY = 0;
    let camH = CAM_H;
    let heading = 0;
    let trauma = 0;
    let reduceShake = false;
    let shakeY = 0;
    let hornFlash = 0;
    let skyline = null;
    const colorCache = new Map();

    function resize() {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      dpr = Math.min(maxDpr, root.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      f = Math.max(W, H * 0.62) * 0.8;
      hY = H * 0.4;
      cx0 = W / 2;
      sprites.setScale(Math.min(220, (f / 2.2) * dpr));
      skyline = null;
    }

    // --- fog -------------------------------------------------------------------
    function mixHex(a, b, t) {
      const na = parseInt(a.slice(1), 16);
      const nb = parseInt(b.slice(1), 16);
      const r = Math.round(((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t);
      const g = Math.round(((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t);
      const bl = Math.round((na & 255) * (1 - t) + (nb & 255) * t);
      return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
    }
    let fogCol = PAL.fog;
    function fogged(hex, d) {
      const t = d < 35 ? 0 : Math.min(0.85, (d - 35) / (FAR - 35));
      const q = Math.round(t * 16);
      if (q === 0) return hex;
      const key = hex + fogCol + q;
      let c = colorCache.get(key);
      if (!c) { c = mixHex(hex, fogCol, q / 16); colorCache.set(key, c); }
      return c;
    }

    // --- projection --------------------------------------------------------------
    function buildBends(L) {
      let d = NEAR;
      let off = 0;
      let slope = 0;
      nDS = 0;
      DS[nDS] = d; OFF[nDS] = 0; nDS++;
      while (d < FAR && nDS < 199) {
        const dd = Math.max(0.45, d * 0.075);
        const k = World.curveAt(L, camY + d + dd / 2);
        off += slope * dd + 0.5 * k * dd * dd;
        slope += k * dd;
        d += dd;
        DS[nDS] = d; OFF[nDS] = off; nDS++;
      }
    }
    function bendAt(d) {
      if (d <= DS[0]) return 0;
      let lo = 0;
      let hi = nDS - 1;
      if (d >= DS[hi]) return OFF[hi];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (DS[m] <= d) lo = m; else hi = m; }
      const t = (d - DS[lo]) / (DS[hi] - DS[lo]);
      return OFF[lo] + (OFF[hi] - OFF[lo]) * t;
    }
    const PX = (x, d, b) => cx0 + (x - camX + b) * f / d;
    const PY = (z, d) => hY + (camH - z) * f / d + shakeY;

    function gquad(x0, x1, da, db, ba, bb, color) {
      const ka = f / da;
      const kb = f / db;
      const ya = hY + camH * ka + shakeY;
      const yb = hY + camH * kb + shakeY;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx0 + (x0 - camX + ba) * ka, ya);
      ctx.lineTo(cx0 + (x1 - camX + ba) * ka, ya);
      ctx.lineTo(cx0 + (x1 - camX + bb) * kb, yb);
      ctx.lineTo(cx0 + (x0 - camX + bb) * kb, yb);
      ctx.closePath();
      ctx.fill();
    }
    /** Ground rectangle in world coordinates [x0,x1] x [y0,y1]. */
    function gRect(x0, x1, y0, y1, color) {
      let da = y0 - camY;
      const db = y1 - camY;
      if (db <= NEAR || da > FAR) return;
      if (da < NEAR) da = NEAR;
      gquad(x0, x1, da, db, bendAt(da), bendAt(db), color);
    }
    /** Vertical wall at x from y0 to y1, heights z0..z1. */
    function vquad(x, y0, y1, z0, z1, color) {
      let da = y0 - camY;
      const db = y1 - camY;
      if (db <= NEAR || da > FAR) return;
      if (da < NEAR) da = NEAR;
      const ba = bendAt(da);
      const bb = bendAt(db);
      const ka = f / da;
      const kb = f / db;
      const xa = cx0 + (x - camX + ba) * ka;
      const xb = cx0 + (x - camX + bb) * kb;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(xa, hY + (camH - z0) * ka + shakeY);
      ctx.lineTo(xa, hY + (camH - z1) * ka + shakeY);
      ctx.lineTo(xb, hY + (camH - z1) * kb + shakeY);
      ctx.lineTo(xb, hY + (camH - z0) * kb + shakeY);
      ctx.closePath();
      ctx.fill();
    }
    /** Horizontal slab at height z (e.g. an awning or shelter roof seen from below). */
    function hquad(x0, x1, y0, y1, z, color) {
      let da = y0 - camY;
      const db = y1 - camY;
      if (db <= NEAR || da > FAR) return;
      if (da < NEAR) da = NEAR;
      const ba = bendAt(da);
      const bb = bendAt(db);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(PX(x0, da, ba), PY(z, da));
      ctx.lineTo(PX(x1, da, ba), PY(z, da));
      ctx.lineTo(PX(x1, db, bb), PY(z, db));
      ctx.lineTo(PX(x0, db, bb), PY(z, db));
      ctx.closePath();
      ctx.fill();
    }

    // --- sky -------------------------------------------------------------------
    function makeSkyline() {
      const pts = [];
      let x = 0;
      let i = 0;
      while (x < W * 3) {
        const w = 18 + h01(i, 3, 1) * 50;
        const h = 14 + h01(i, 3, 2) * 46 + (h01(i, 3, 5) < 0.12 ? 50 : 0);
        pts.push(x, h, w);
        x += w;
        i++;
      }
      return pts;
    }
    function drawSky(wet) {
      const g = ctx.createLinearGradient(0, 0, 0, hY);
      g.addColorStop(0, wet ? PAL.skyRain0 : PAL.sky0);
      g.addColorStop(1, wet ? PAL.skyRain1 : PAL.sky1);
      ctx.fillStyle = g;
      ctx.fillRect(-W, -H, W * 3, hY + H + 2);
      if (!skyline) skyline = makeSkyline();
      const shift = ((heading * W * 0.9) % (W * 3) + W * 3) % (W * 3);
      ctx.fillStyle = wet ? '#848d93' : '#b9b8ae';
      for (let k = -1; k <= 1; k++) {
        for (let i = 0; i < skyline.length; i += 3) {
          const x = skyline[i] - shift + k * W * 3 - W;
          if (x > W * 2 || x + skyline[i + 2] < -W) continue;
          ctx.fillRect(x, hY - skyline[i + 1] + shakeY, skyline[i + 2] - 2, skyline[i + 1] + 2);
        }
      }
      ctx.fillStyle = fogCol;
      ctx.fillRect(-W, hY - 3 + shakeY, W * 3, 6);
    }

    // --- ground ------------------------------------------------------------------
    function drawGround(st, L) {
      const wet = st.weather === 'rain';
      ctx.fillStyle = fogged(PAL.ground, FAR);
      ctx.fillRect(-W, hY + shakeY, W * 3, H - hY + 40);
      for (let i = nDS - 2; i >= 0; i--) {
        const da = DS[i];
        const db = DS[i + 1] * 1.006;
        const ba = OFF[i];
        const bb = OFF[i + 1];
        const ym = camY + (DS[i] + DS[i + 1]) / 2;
        const s = World.segmentAt(L, ym);
        const xs = s.xs;
        gquad(xs.wallL - 30, xs.wallR + 30, da, db, ba, bb, fogged(PAL.ground, da));
        gquad(xs.wallL, 0.02, da, db, ba, bb, fogged(s.footpathL ? PAL.slab : PAL.dirt, da));
        const alt = Math.floor(ym / 3) & 1;
        const asp = wet ? (alt ? PAL.asphaltWet : PAL.asphaltWet2) : alt ? PAL.asphalt : PAL.asphalt2;
        if (xs.divided) {
          gquad(0, xs.ownR + 0.02, da, db, ba, bb, fogged(asp, da));
          gquad(xs.ownR, xs.farL, da, db, ba, bb, fogged(PAL.median, da));
          gquad(xs.farL - 0.02, xs.farR + 0.02, da, db, ba, bb, fogged(asp, da));
          gquad(xs.farR, xs.wallR, da, db, ba, bb, fogged(PAL.slab, da));
        } else {
          gquad(0, xs.roadR + 0.02, da, db, ba, bb, fogged(asp, da));
          gquad(xs.roadR, xs.wallR, da, db, ba, bb, fogged(s.footpathR ? PAL.slab : PAL.dirt, da));
        }
      }
      const y0 = camY + NEAR;
      const y1 = camY + 70;
      // lane markings (faded and missing at random, SPEC §4.2)
      for (let y = Math.floor(y0 / 7.5) * 7.5; y < y1; y += 7.5) {
        const s = World.segmentAt(L, y + 1.5);
        const xs = s.xs;
        const lines = [];
        if (s.area === 'gully') continue;
        for (let k = 1; k < s.lanesOwn; k++) lines.push(k * T.LANE_W);
        if (!xs.divided && s.lanesOncoming > 0) { lines.push(xs.ownR - 0.12, xs.ownR + 0.12); for (let k = 1; k < s.lanesOncoming; k++) lines.push(xs.ownR + k * T.LANE_W); }
        for (let i = 0; i < lines.length; i++) {
          const a = h01(Math.round(y / 7.5), Math.round(lines[i] * 10), 99);
          if (a < 0.22) continue;
          ctx.globalAlpha = 0.3 + 0.6 * a;
          gRect(lines[i] - 0.07, lines[i] + 0.07, y, y + 3, fogged(PAL.line, y - camY));
        }
      }
      ctx.globalAlpha = 1;
      // kerb stones near by
      for (let y = Math.floor(y0); y < camY + 36; y++) {
        const s = World.segmentAt(L, y + 0.5);
        if (s.footpathL) gRect(-0.22, 0, y, y + 1, (y & 1) ? PAL.kerbA : PAL.kerbB);
        if (!s.xs.divided && s.footpathR) gRect(s.xs.roadR, s.xs.roadR + 0.22, y, y + 1, (y & 1) ? PAL.kerbA : PAL.kerbB);
        if (s.xs.divided) gRect(s.xs.ownR, s.xs.ownR + 0.2, y, y + 1, '#cfc9bc');
      }
      // speed breakers
      for (const b of L.breakers) {
        if (b.y < y0 - 1 || b.y > camY + FAR) continue;
        const s = World.segmentAt(L, b.y);
        const xr = s.xs.divided ? s.xs.ownR : s.xs.roadR;
        if (b.marked) {
          gRect(0, xr, b.y - 0.35, b.y + 0.35, '#1d1d1d');
          for (let x = 0; x < xr; x += 0.7) gRect(x, Math.min(xr, x + 0.35), b.y - 0.35, b.y + 0.35, fogged(PAL.yellow, b.y - camY));
        } else gRect(0, xr, b.y - 0.35, b.y + 0.35, fogged(wet ? '#3b4047' : '#51555c', b.y - camY));
      }
      // puddles and potholes
      for (const q of st.puddles) {
        const d = q.y - camY;
        if (d < -q.ry || d > 90) continue;
        flatEllipse(q.x, q.y, q.rx, q.ry, PAL.puddle);
        flatEllipse(q.x - q.rx * 0.25, q.y + q.ry * 0.25, q.rx * 0.4, q.ry * 0.15, PAL.puddleHi);
      }
      for (const h of st.potholes) {
        const d = h.y - camY;
        if (h.hidden || d < -h.r || d > 90) continue;
        flatBlob(h, h.r, PAL.potholeRim);
        flatBlob(h, h.r * 0.8, PAL.pothole);
      }
      // delivery drop zones: pull over to the kerb and stop inside
      const next = Sim.nextOrder(st);
      for (const o of st.orders || []) {
        if (o.status !== 'pending' || o.y - camY > 100 || o.y + T.DROP_ZONE / 2 < camY) continue;
        const pulse = o === next ? 0.32 + 0.12 * Math.sin(time * 5) : 0.15;
        ctx.globalAlpha = pulse;
        gRect(-0.3, T.DROP_MAX_X, o.y - T.DROP_ZONE / 2, o.y + T.DROP_ZONE / 2, PURPLE);
        ctx.globalAlpha = Math.min(1, pulse * 2.2);
        gRect(T.DROP_MAX_X - 0.12, T.DROP_MAX_X, o.y - T.DROP_ZONE / 2, o.y + T.DROP_ZONE / 2, '#e0aaff');
        for (const yy of [o.y - T.DROP_ZONE / 2, o.y + T.DROP_ZONE / 2 - 0.25]) gRect(-0.3, T.DROP_MAX_X, yy, yy + 0.25, '#e0aaff');
        ctx.globalAlpha = 1;
      }
    }

    function flatEllipse(x, y, rx, ry, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const d = y + Math.sin(a) * ry - camY;
        if (d < NEAR) continue;
        const px = PX(x + Math.cos(a) * rx, d, bendAt(d));
        const py = PY(0, d);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      if (started) { ctx.closePath(); ctx.fill(); }
    }
    function flatBlob(h, r, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + h.rot;
        const rr = r * (0.75 + 0.25 * h01(h.shape, i, 3));
        const d = h.y + Math.sin(a) * rr - camY;
        if (d < NEAR) continue;
        const px = PX(h.x + Math.cos(a) * rr, d, bendAt(d));
        const py = PY(0, d);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      if (started) { ctx.closePath(); ctx.fill(); }
    }

    // --- facades -----------------------------------------------------------------
    function facades(L, st) {
      const CELL = 6;
      for (let k = Math.floor((camY + FAR) / CELL); k >= Math.floor((camY - 20) / CELL); k--) {
        const ya = k * CELL;
        const yb = ya + CELL;
        if (yb - camY <= NEAR && k % 3 !== 0) continue;
        const s = World.segmentAt(L, ya + CELL / 2);
        for (const dir of [-1, 1]) {
          const wx = dir < 0 ? s.xs.wallL : s.xs.wallR;
          if (s.area === 'gully') gullyHouse(dir, wx, ya, yb, k);
          else if (s.area === 'highrise') towerCell(dir, wx, ya, yb, k);
          else if (s.area === 'techpark') techCell(dir, wx, ya, yb, k);
          else if (yb - camY > NEAR) facade(dir, wx, ya, yb, k);
        }
      }
      // delivery addresses on the left (drawn after: always nearer the road than the cells behind)
      for (const o of st.orders || []) {
        if (o.y - camY > FAR || o.y + 4 < camY) continue;
        const s = World.segmentAt(L, o.y);
        if (o.kind === 'apartment') apartmentGate(s.xs.wallL, o);
        else houseDoor(s.xs.wallL, o);
      }
    }

    function gullyHouse(dir, wx, ya, yb, k) {
      if (yb - camY <= NEAR) return;
      const salt = dir < 0 ? 5 : 9;
      const a = h01(k, salt, 13);
      const b = h01(k, salt, 29);
      const c = h01(k, salt, 41);
      const d = ya - camY;
      const hgt = 3.2 + Math.floor(b * 3) * 2.9;
      vquad(wx, ya, yb, 0, hgt, fogged(C.wall[Math.floor(c * C.wall.length)], d));
      if (a < 0.2) { // a tiny kirana shop
        vquad(wx, ya + 0.8, yb - 0.8, 0, 2.3, fogged('#5b4a3a', d));
        vquad(wx, ya + 0.5, yb - 0.5, 2.5, 3.0, fogged(C.sign[Math.floor(b * 7) % C.sign.length], d));
      } else { // gate and door
        vquad(wx, ya + 1.6, ya + 3.6, 0, 1.7, fogged(a < 0.6 ? '#2f4f4f' : '#5d4037', d));
        vquad(wx, ya + 4.0, ya + 5.0, 0.9, 2.0, fogged('#3a3f45', d));
      }
      for (let fl = 1; fl * 2.9 < hgt - 0.5; fl++) {
        vquad(wx, ya + 0.3, yb - 0.3, fl * 2.9 - 0.15, fl * 2.9 + 0.05, fogged(shade(C.wall[Math.floor(c * C.wall.length)], -0.25), d));
        vquad(wx, ya + 1.0, ya + 2.4, fl * 2.9 + 0.8, fl * 2.9 + 2.0, fogged('#2c3640', d));
        vquad(wx, yb - 2.4, yb - 1.0, fl * 2.9 + 0.8, fl * 2.9 + 2.0, fogged('#2c3640', d));
      }
      vquad(wx, ya + 1.2, ya + 2.4, hgt, hgt + 1.0, fogged('#1d1d1d', d)); // water tank
    }

    function towerCell(dir, wx, ya, yb, k) {
      const d = ya - camY;
      if (yb - camY > NEAR) {
        vquad(wx, ya, yb, 0, 1.9, fogged('#e9e1d0', d));
        vquad(wx, ya, yb, 1.75, 1.95, fogged('#b9b0a0', d));
      }
      if (k % 3 !== 0) return;
      const salt = dir < 0 ? 15 : 19;
      const b = h01(k, salt, 29);
      const c = h01(k, salt, 41);
      const tx = wx + dir * 9;
      const t0 = ya + 1;
      const t1 = ya + 16;
      const hgt = 30 + Math.floor(b * 9) * 3;
      const col = ['#efe1c6', '#f3d2b3', '#d9d4cc', '#e8c9a8', '#cfd8dc'][Math.floor(c * 5)];
      vquad(tx, t0, t1, 0, hgt, fogged(col, d + 10));
      if (d < 90) {
        for (let z = 3; z < hgt - 1; z += 3) {
          vquad(tx, t0 + 0.8, t1 - 0.8, z + 0.9, z + 2.1, fogged('#36454f', d + 10));
          vquad(tx, t0 + 0.4, t1 - 0.4, z - 0.08, z + 0.08, fogged(shade(col, -0.2), d + 10));
        }
      }
      vquad(tx, t0 + 4, t1 - 4, hgt, hgt + 2.5, fogged(shade(col, -0.15), d + 10));
    }

    function techCell(dir, wx, ya, yb, k) {
      const d = ya - camY;
      if (yb - camY > NEAR) vquad(wx, ya, yb, 0, 0.8, fogged('#4e7e32', d));
      if (k % 2 !== 0) return;
      const salt = dir < 0 ? 25 : 27;
      const b = h01(k, salt, 29);
      const tx = wx + dir * 6;
      const t0 = ya + 1;
      const t1 = ya + 11;
      const hgt = 18 + Math.floor(b * 7) * 3;
      vquad(tx, t0, t1, 0, hgt, fogged(b > 0.5 ? '#5f8fa8' : '#6d8f9c', d + 6));
      if (d < 70) {
        for (let y = t0 + 1.2; y < t1 - 0.5; y += 1.6) vquad(tx, y, y + 0.08, 0, hgt, fogged('#a9cbd9', d + 6));
        for (let z = 3.5; z < hgt; z += 3.5) vquad(tx, t0, t1, z, z + 0.25, fogged('#3f6170', d + 6));
      }
      vquad(tx, t0 + 1, t1 - 1, hgt - 2.2, hgt - 1.0, fogged('#f4f4f4', d + 6));
    }

    function apartmentGate(wx, o) {
      const d = o.y - 3 - camY;
      vquad(wx, o.y - 3.5, o.y + 3.5, 0, 2.7, fogged('#2b2f33', d));
      vquad(wx, o.y - 4.0, o.y - 3.4, 0, 3.6, fogged('#cfc9bc', d));
      vquad(wx, o.y + 3.4, o.y + 4.0, 0, 3.6, fogged('#cfc9bc', d));
      vquad(wx, o.y - 4.0, o.y + 4.0, 3.0, 3.7, fogged('#3c096c', d));
      for (let y = o.y - 3.3; y < o.y + 3.3; y += 0.8) vquad(wx, y, y + 0.4, 0.95, 1.08, (Math.round(y * 2) & 1) ? '#d32f2f' : '#f5f5f5');
      label(wx + 0.05, o.y, 3.35, o.name.split(',')[0]);
    }

    function houseDoor(wx, o) {
      const d = o.y - 2 - camY;
      vquad(wx, o.y - 1.6, o.y + 1.6, 0, 2.2, fogged('#5a189a', d));
      vquad(wx, o.y - 1.4, o.y + 1.4, 0.1, 2.0, fogged('#7b2cbf', d));
      vquad(wx, o.y - 2.0, o.y + 2.0, 2.3, 2.75, fogged('#f5f5f5', d));
      label(wx + 0.05, o.y, 2.52, o.name.split(',')[0]);
    }

    /** Text painted on a wall facing the road (only when it is large enough to read). */
    function label(x, y, z, text) {
      const d = y - camY;
      if (d < 3 || d > 45) return;
      const k = f / d;
      const px = Math.min(22, 0.38 * k);
      if (px < 14) return;
      ctx.font = '800 ' + px.toFixed(0) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, PX(x, d, bendAt(d)) + (x < camX ? px * 0.6 : -px * 0.6), PY(z, d));
    }

    function facade(dir, wx, ya, yb, k) {
      const salt = dir < 0 ? 3 : 7;
      const a = h01(k, salt, 13);
      const b = h01(k, salt, 29);
      const c = h01(k, salt, 41);
      const d = ya - camY;
      if (a < 0.62) {
        const hgt = 4 + Math.floor(b * 3) * 3;
        const wall = fogged(C.wall[Math.floor(c * C.wall.length)], d);
        vquad(wx, ya, yb, 0, hgt, wall);
        vquad(wx, ya + 0.6, yb - 0.6, 0, 2.5, fogged(b > 0.5 ? '#3a3a3a' : '#5b4a3a', d));
        if (b > 0.3) vquad(wx, ya + 1.0, yb - 1.0, 0.3, 2.2, fogged(C.awning[Math.floor(b * 6)], d));
        vquad(wx, ya + 0.3, yb - 0.3, 3.0, 3.8, fogged(C.sign[Math.floor(b * 7) % C.sign.length], d));
        for (let fl = 1; fl < hgt / 3 - 0.5; fl++) {
          vquad(wx, ya + 1.0, ya + 2.4, fl * 3 + 1.2, fl * 3 + 2.4, fogged('#2c3640', d));
          vquad(wx, yb - 2.4, yb - 1.0, fl * 3 + 1.2, fl * 3 + 2.4, fogged('#2c3640', d));
        }
        const aw = fogged(C.awning[Math.floor(c * C.awning.length)], d);
        const ax = wx - dir * 0.9;
        let da = ya - camY;
        const db = yb - camY;
        if (db > NEAR && da < FAR) {
          if (da < NEAR) da = NEAR;
          const ba = bendAt(da);
          const bb = bendAt(db);
          ctx.fillStyle = aw;
          ctx.beginPath();
          ctx.moveTo(PX(wx, da, ba), PY(2.9, da));
          ctx.lineTo(PX(ax, da, ba), PY(2.5, da));
          ctx.lineTo(PX(ax, db, bb), PY(2.5, db));
          ctx.lineTo(PX(wx, db, bb), PY(2.9, db));
          ctx.closePath();
          ctx.fill();
        }
      } else if (a < 0.85) {
        vquad(wx, ya, yb, 0, 1.6, fogged('#ddd5c6', d));
        vquad(wx, ya, yb, 1.45, 1.6, fogged('#b9b0a0', d));
      } else {
        vquad(wx, ya, yb, 0, 1.1, fogged('#8b7f6c', d));
      }
    }

    // --- depth-sorted things -------------------------------------------------------
    function addItem(d, kind, ref, a, b) {
      let it = items[nItems];
      if (!it) { it = { d: 0, kind: 0, ref: null, a: 0, b: 0 }; items[nItems] = it; }
      nItems++;
      it.d = d; it.kind = kind; it.ref = ref; it.a = a; it.b = b;
    }
    const byDepth = (p, q) => q.d - p.d;
    const K_VEH = 1, K_PED = 2, K_COW = 3, K_TREE = 4, K_POLE = 5, K_BAR = 6, K_SHRUB = 7, K_SHELTER = 8, K_PIN = 9, K_GATE = 10;

    function collect(st, L, alpha, interp) {
      nItems = 0;
      for (const n of st.npcs) {
        const d = n.y - camY;
        if (d < -n.l || d > FAR) continue;
        const x = interp.x(n, alpha);
        const y = interp.y(n, alpha);
        addItem(y - camY, n.kind === 'cow' ? K_COW : K_VEH, n, x, y);
      }
      for (const pd of st.peds) {
        const d = pd.y - camY;
        if (d < 0.3 || d > FAR || pd.mode === 'gone') continue;
        addItem(interp.y(pd, alpha) - camY, K_PED, pd, interp.x(pd, alpha), interp.y(pd, alpha));
      }
      // trees on compound cells, street trees, poles with cables
      const CELL = 6;
      for (let k = Math.floor((camY + NEAR) / CELL); k * CELL < camY + FAR; k++) {
        const ym = k * CELL + CELL / 2;
        const s = World.segmentAt(L, ym);
        for (let side = 0; side < 2; side++) {
          const salt = side ? 7 : 3;
          const a = h01(k, salt, 13);
          const wx = side ? s.xs.wallR : s.xs.wallL;
          if (a >= 0.62 && a < 0.85) addItem(ym - camY, K_TREE, null, wx + (side ? 1.8 : -1.8), (k + side) & 3);
          else if (h01(k, salt, 61) < 0.12) addItem(ym - camY, K_TREE, null, wx + (side ? -0.6 : 0.6), (k + side + 1) & 3);
        }
      }
      for (let k = Math.floor((camY + NEAR) / 33); k * 33 < camY + FAR; k++) {
        const y = k * 33 + h01(k, 9, 9) * 8;
        if (y - camY < NEAR) continue;
        addItem(y - camY, K_POLE, null, y, 0);
      }
      for (const b of L.barricades) {
        for (let y = Math.max(b.y0, Math.floor(camY / 6) * 6); y < b.y1 && y < camY + FAR; y += 6) {
          const y2 = Math.min(b.y1, y + 6);
          if (y2 - camY <= NEAR) continue;
          addItem((y + y2) / 2 - camY, K_BAR, b, y, y2);
        }
      }
      const next = Sim.nextOrder(st);
      for (const o of st.orders || []) {
        if (o.status === 'pending' && o.y - camY > 1 && o.y - camY < FAR) addItem(o.y - camY, K_PIN, o, o === next ? 1 : 0, 0);
      }
      if (L.destination && L.length - camY > -2 && L.length - camY < FAR) addItem(L.length - camY, K_GATE, L, 0, 0);
      for (const fbs of L.busStops) {
        if (fbs.y - camY > -3 && fbs.y - camY < FAR) addItem(fbs.y - camY, K_SHELTER, fbs, 0, 0);
      }
      for (let y = Math.ceil((camY + 2) / 3.5) * 3.5; y < camY + 55; y += 3.5) {
        const s = World.segmentAt(L, y);
        if (s.xs.divided) addItem(y - camY, K_SHRUB, s, (s.xs.ownR + s.xs.farL) / 2, Math.round(y) & 1);
      }
      const list = items.slice(0, nItems).sort(byDepth);
      return list;
    }

    function fade(d) { return d > 75 ? Math.max(0.15, 1 - (d - 75) / 75) : 1; }

    function billboard(key, x, y, w, h, flip, rot) {
      const d = y - camY;
      if (d < NEAR || d > FAR) return null;
      const k = f / d;
      const sx = PX(x, d, bendAt(d));
      const sy = PY(h / 2, d);
      ctx.globalAlpha = fade(d);
      if (flip || rot) {
        ctx.save();
        ctx.translate(sx, sy);
        if (rot) ctx.rotate(rot);
        if (flip) ctx.scale(-1, 1);
        sprites.draw(ctx, key, 0, 0, 0, k);
        ctx.restore();
      } else sprites.draw(ctx, key, sx, sy, 0, k);
      ctx.globalAlpha = 1;
      return { sx, sy: PY(h, d), k };
    }

    function drawVehicle(n, x, y, wet) {
      const hgt = HGT[n.kind] || 1.5;
      const yN = y - n.l / 2;
      const yF = y + n.l / 2;
      const dN = yN - camY;
      if (yF - camY <= NEAR || dN > FAR) return;
      const x0 = x - n.w / 2;
      const x1 = x + n.w / 2;
      const front = n.dir < 0;
      const col = n.kind === 'car' ? (n.cab ? '#f7f7f2' : C.car[n.variant]) : n.kind === 'bus' ? C.bus[n.variant] : n.kind === 'tanker' ? C.tank[n.variant] : n.kind === 'auto' ? '#2e7d32' : C.bike[n.variant];
      ctx.globalAlpha = fade(dN);
      // shadow footprint
      gRect(x0 - 0.05, x1 + 0.05, yN - 0.1, yF, 'rgba(0,0,0,0.28)');
      if (n.kind !== 'bike' && n.kind !== 'cart') {
        const side = camX < x0 - 0.05 ? x0 : camX > x1 + 0.05 ? x1 : null;
        if (side !== null) {
          const d0 = Math.max(dN, NEAR);
          const sc = fogged(shade(col, -0.25), d0);
          vquad(side, yN, yF, 0.3, hgt * 0.93, sc);
          vquad(side, yN + 0.4, yF - 0.4, 0, 0.42, '#1a1a1a');
          if (n.kind === 'car') vquad(side, yN + 1.3, yF - 0.9, 0.92, 1.33, fogged('#2b3743', d0));
          else if (n.kind === 'bus') {
            vquad(side, yN + 0.6, yF - 0.6, 1.35, 2.55, fogged('#2b3743', d0));
            for (let yy = yN + 2.4; yy < yF - 0.6; yy += 1.8) vquad(side, yy, yy + 0.12, 1.35, 2.55, fogged(col, d0));
          } else if (n.kind === 'auto') vquad(side, yN + 0.3, yF - 0.2, 0.95, 1.7, fogged('#f4c20d', d0));
          else if (n.kind === 'tanker') vquad(side, yN + 2.3, yF - 0.2, 0.9, 2.7, fogged(C.tank[n.variant], d0));
        }
      }
      if (dN > NEAR) {
        const k = f / dN;
        const b = bendAt(dN);
        const sx = PX(x, dN, b);
        let key;
        if (n.kind === 'car') key = (n.cab ? 'cab.' : 'car.') + (front ? 'f' : 'r') + (n.cab ? '' : '.' + n.variant);
        else if (n.kind === 'auto') key = 'auto.' + (front ? 'f' : n.fare ? 'rp' : 'r') + '.' + n.variant;
        else key = n.kind + '.' + (front ? 'f' : 'r') + '.' + n.variant;
        const lean = n.kind === 'bike' ? Math.max(-0.25, Math.min(0.25, (n.vx || 0) * 0.08)) * (front ? -1 : 1) : 0;
        if (lean) { ctx.save(); ctx.translate(sx, PY(0, dN)); ctx.rotate(lean); sprites.draw(ctx, key, 0, -hgt * k / 2, 0, k); ctx.restore(); }
        else sprites.draw(ctx, key, sx, PY(hgt / 2, dN), 0, k);
        if (n.parked && Math.floor(time * 2.5) % 2 === 0) { // hazard lights
          ctx.fillStyle = 'rgba(255,170,30,0.9)';
          const ly = PY(hgt * 0.48, dN);
          ctx.beginPath(); ctx.arc(sx - n.w * 0.38 * k, ly, Math.max(2, 0.14 * k), 0, Math.PI * 2); ctx.arc(sx + n.w * 0.38 * k, ly, Math.max(2, 0.14 * k), 0, Math.PI * 2); ctx.fill();
        } else if (!front && n.v < 1.5 && n.kind !== 'bike' && n.kind !== 'cart') {
          ctx.fillStyle = 'rgba(255,40,30,0.45)';
          const ly = PY(hgt * (n.kind === 'bus' ? 0.3 : 0.48), dN);
          ctx.beginPath(); ctx.arc(sx - n.w * 0.38 * k, ly, Math.max(2, 0.18 * k), 0, Math.PI * 2); ctx.arc(sx + n.w * 0.38 * k, ly, Math.max(2, 0.18 * k), 0, Math.PI * 2); ctx.fill();
          if (wet) { ctx.fillStyle = 'rgba(255,60,40,0.18)'; ctx.fillRect(sx - n.w * 0.45 * k, PY(0, dN), n.w * 0.9 * k, Math.min(60, 0.9 * k)); }
        }
        if (front && n.kind !== 'cart') {
          const gl = Math.max(10, 1.6 * k) * (n.ws ? 1.6 : 1);
          const gy = PY(n.kind === 'bike' ? 0.75 : 0.65, dN);
          const g = ctx.createRadialGradient(sx, gy, 1, sx, gy, gl);
          g.addColorStop(0, n.ws ? 'rgba(255,248,200,0.9)' : 'rgba(255,248,210,0.5)');
          g.addColorStop(1, 'rgba(255,248,210,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sx, gy, gl, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawPed(pd, x, y) {
      let frame = (pd.mode === 'walk' || pd.mode === 'cross') && (Math.abs(pd.vx) + Math.abs(pd.vy) > 0.1) ? (Math.floor(time * 4 + pd.id) & 1) : 1;
      if (pd.mode === 'hail') frame = 2;
      const rot = pd.mode === 'stumble' ? Math.sin(time * 16) * 0.5 : 0;
      billboard('ped.' + pd.variant + '.' + frame, x, y, 0.55, 1.65, false, rot);
      if (pd.splash > 0) {
        const d = y - camY;
        if (d > NEAR) {
          ctx.fillStyle = 'rgba(120,180,230,0.85)';
          const k = f / d;
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(PX(x + (i - 1.5) * 0.15, d, bendAt(d)), PY(1.4 - ((time * 3 + i * 0.25) % 1) * 1.2, d), Math.max(1.5, 0.05 * k), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    function drawCow(n, x, y) {
      const sideOn = Math.abs(Math.sin(n.h)) > 0.55;
      if (n.mode === 'sit') billboard('cow.z.' + n.variant, x, y, 2.1, 1.45, Math.sin(n.h) > 0);
      else if (sideOn) billboard('cow.s.' + n.variant, x, y, 2.1, 1.45, Math.sin(n.h) > 0);
      else billboard('cow.f.' + n.variant, x, y, 0.9, 1.45);
    }

    function drawPole(y, L) {
      const s = World.segmentAt(L, y);
      const xl = s.footpathL ? -0.35 : -0.6;
      const xr = s.xs.divided ? s.xs.ownR + 0.8 : s.xs.roadR + (s.footpathR ? 0.35 : 0.6);
      const d = y - camY;
      if (d < NEAR) return;
      const b = bendAt(d);
      const k = f / d;
      ctx.globalAlpha = fade(d);
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = Math.max(1, 0.18 * k);
      ctx.beginPath();
      ctx.moveTo(PX(xl, d, b), PY(0, d)); ctx.lineTo(PX(xl, d, b), PY(7.5, d));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,20,20,0.75)';
      ctx.lineWidth = Math.max(0.8, 0.03 * k);
      for (let i = 0; i < 4; i++) {
        const z = 7.2 - i * 0.35;
        ctx.beginPath();
        ctx.moveTo(PX(xl, d, b), PY(z, d));
        ctx.quadraticCurveTo(PX((xl + xr) / 2, d, b), PY(z - 1.2 - i * 0.2, d), PX(xr, d, b), PY(z - 0.3, d));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function drawBarricade(b, y0, y1) {
      const hgt = 2.1;
      const d0 = y0 - camY;
      if (camX < b.x0 - 0.05) {
        vquad(b.x0, y0, y1, 0, hgt, fogged(PAL.barA, Math.max(d0, NEAR)));
        if (d0 < 40) for (let y = y0; y < y1; y += 2) vquad(b.x0, y, y + 1, 0.1, hgt - 0.1, PAL.barB);
      } else if (camX > b.x1 + 0.05) {
        vquad(b.x1, y0, y1, 0, hgt, fogged(PAL.barA, Math.max(d0, NEAR)));
        if (d0 < 40) for (let y = y0; y < y1; y += 2) vquad(b.x1, y, y + 1, 0.1, hgt - 0.1, PAL.barB);
      }
      if (y0 === b.y0 && d0 > NEAR) {
        const k = f / d0;
        const bb = bendAt(d0);
        const left = PX(b.x0, d0, bb);
        const right = PX(b.x1, d0, bb);
        const top = PY(hgt, d0);
        const bot = PY(0, d0);
        ctx.fillStyle = fogged(PAL.barA, d0);
        ctx.fillRect(left, top, right - left, bot - top);
        ctx.fillStyle = fogged(PAL.barB, d0);
        for (let x = b.x0 + 0.5; x < b.x1 - 0.2; x += 1.0) ctx.fillRect(PX(x, d0, bb), top + 0.1 * k, 0.5 * k, bot - top - 0.2 * k);
        const on = Math.floor(time * 3) % 2 === 0;
        ctx.fillStyle = on ? '#ff9800' : '#7a4a10';
        ctx.beginPath(); ctx.arc(left + 0.2 * k, top - 0.1 * k, Math.max(2, 0.12 * k), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = on ? '#7a4a10' : '#ff9800';
        ctx.beginPath(); ctx.arc(right - 0.2 * k, top - 0.1 * k, Math.max(2, 0.12 * k), 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawPin(o, isNext) {
      const d = o.y - camY;
      if (d < NEAR) return;
      const k = f / d;
      const b = bendAt(d);
      const x = PX(-0.4, d, b);
      const z = 4.2 + Math.sin(time * 3 + o.id) * 0.25;
      const y = PY(z, d);
      const r = Math.max(7, 0.55 * k) * (isNext ? 1 : 0.7);
      ctx.globalAlpha = isNext ? 1 : 0.55;
      ctx.strokeStyle = 'rgba(123,44,191,0.6)';
      ctx.lineWidth = Math.max(1, 0.05 * k);
      ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, PY(0, d)); ctx.stroke();
      ctx.fillStyle = PURPLE;
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(x, y + r * 1.9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      if (isNext && r > 9) {
        ctx.font = '800 14px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const t = Math.round(d) + ' m';
        const tw = ctx.measureText(t).width + 12;
        ctx.fillStyle = 'rgba(60,9,108,0.9)';
        SP.roundRect(ctx, x - tw / 2, y - r - 26, tw, 22, 6); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(t, x, y - r - 7);
      }
      ctx.globalAlpha = 1;
    }

    function drawTechGate(L) {
      const d = L.length - camY;
      if (d < NEAR) return;
      const s = World.segmentAt(L, L.length - 1);
      const x0 = -0.6;
      const x1 = (s.xs.divided ? s.xs.ownR : s.xs.roadR) + 0.6;
      const k = f / d;
      const b = bendAt(d);
      const left = PX(x0, d, b);
      const right = PX(x1, d, b);
      ctx.globalAlpha = fade(d);
      ctx.fillStyle = '#b0bec5';
      ctx.fillRect(left - 0.35 * k, PY(6.4, d), 0.7 * k, 6.4 * k);
      ctx.fillRect(right - 0.35 * k, PY(6.4, d), 0.7 * k, 6.4 * k);
      ctx.fillStyle = '#263238';
      ctx.fillRect(left - 0.35 * k, PY(6.6, d), right - left + 0.7 * k, 1.5 * k);
      ctx.fillStyle = '#4fc3f7';
      ctx.fillRect(left, PY(6.45, d), right - left, 0.12 * k);
      const px = Math.min(30, 0.75 * k);
      if (px >= 14) {
        ctx.font = '800 ' + px.toFixed(0) + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(L.destination.name.toUpperCase(), (left + right) / 2, PY(5.85, d));
      }
      ctx.fillStyle = '#ffcc80';
      ctx.fillRect(left + 0.4 * k, PY(1.3, d), 0.9 * k, 1.3 * k);
      ctx.globalAlpha = 1;
    }

    function drawShelter(L, bs) {
      const s = World.segmentAt(L, bs.y);
      const x0 = s.xs.wallL + 0.3;
      const x1 = -0.6;
      const ya = bs.y - 2.5;
      const yb = bs.y + 2.5;
      hquad(x0, x1, ya, yb, 2.5, '#2f5e50');
      vquad(x1, ya, yb, 2.35, 2.6, '#3c7564');
      for (const y of [ya + 0.2, yb - 0.2]) vquad(x1, y, y + 0.1, 0, 2.5, '#9aa0a6');
      vquad(x0 + 0.05, ya, yb, 0.4, 2.4, 'rgba(160,200,220,0.35)');
      const d = yb + 0.6 - camY;
      if (d > NEAR) {
        const b = bendAt(d);
        const k = f / d;
        ctx.fillStyle = '#1565c0';
        ctx.fillRect(PX(-0.45, d, b) - 0.25 * k, PY(2.7, d), 0.5 * k, 0.35 * k);
        ctx.fillStyle = '#9aa0a6';
        ctx.fillRect(PX(-0.45, d, b) - 0.03 * k, PY(2.35, d), Math.max(1, 0.06 * k), 2.35 * k);
      }
    }

    // --- effects -------------------------------------------------------------------
    function burst(x, y, n, kind, speed, life, size, up) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.4 + Math.random() * 0.8);
        P.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), kind, kind, up * (0.5 + Math.random()), 9.8, 1.5);
      }
    }
    function drawParticles(dt) {
      P.update(dt);
      for (let i = 0; i < P.count; i++) {
        const d = P.y[i] - camY;
        if (d < NEAR) continue;
        const k = f / d;
        const s = Math.max(1.5, P.size[i] * k);
        ctx.globalAlpha = Math.min(1, (P.life[i] / P.max[i]) * 1.6);
        ctx.fillStyle = PCOL[P.kind[i]];
        ctx.fillRect(PX(P.x[i], d, bendAt(d)) - s / 2, PY(P.z[i], d) - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    function drawRain(dt) {
      ctx.fillStyle = 'rgba(40,52,68,0.12)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(205,218,235,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 160; i++) {
        const j = i * 3;
        rain[j + 1] += rain[j + 2] * dt * 1.7;
        if (rain[j + 1] > 1) { rain[j + 1] -= 1; rain[j] = Math.random(); }
        const x = rain[j] * W;
        const y = rain[j + 1] * H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y + 16 * rain[j + 2]);
      }
      ctx.stroke();
    }
    function addSplat(n) {
      for (let i = 0; i < (n || 14); i++) splat.push({ x: W * (0.05 + Math.random() * 0.9), y: H * (0.2 + Math.random() * 0.7), r: 18 + Math.random() * 46, t: 1.5, max: 1.5 });
      while (splat.length > 40) splat.shift();
    }
    function drawSplat(dt) {
      for (let i = splat.length - 1; i >= 0; i--) {
        const b = splat[i];
        b.t -= dt;
        if (b.t <= 0) { splat.splice(i, 1); continue; }
        const a = b.t / b.max;
        ctx.fillStyle = 'rgba(110,98,78,' + (0.55 * a).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(b.x, b.y + (1 - a) * 18, b.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,215,225,' + (0.25 * a).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3 + (1 - a) * 18, b.r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }

    // --- bubbles -----------------------------------------------------------------------
    function bubble(kind, id, text, delay) {
      for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].kind === kind && bubbles[i].id === id) bubbles.splice(i, 1);
      if (bubbles.length >= 4) bubbles.shift();
      bubbles.push({ kind, id, text, t: 2.0 + (delay || 0), delay: delay || 0 });
    }
    function findRef(st, kind, id) {
      const arr = kind === 'ped' ? st.peds : kind === 'player' ? st.players : st.npcs;
      for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    }
    function drawBubbles(st, dt, alpha, interp) {
      ctx.font = '700 14px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.t -= dt;
        if (b.delay > 0) { b.delay -= dt; continue; }
        const ref = findRef(st, b.kind, b.id);
        if (b.t <= 0 || (!ref && b.kind !== 'player')) { bubbles.splice(i, 1); continue; }
        let X;
        let Y;
        if (b.kind === 'player') { X = W / 2; Y = H * 0.62; }
        else {
          const y = interp.y(ref, alpha);
          const d = Math.max(NEAR + 0.4, (ref.l ? y - ref.l / 2 : y) - camY);
          if (d > 70) continue;
          const hgt = ref.kind ? (HGT[ref.kind] || 1.5) : 1.65;
          X = PX(interp.x(ref, alpha), d, bendAt(d));
          Y = Math.max(HUD_TOP + 34, PY(hgt + 0.3, d) - 14);
        }
        const w = ctx.measureText(b.text).width + 16;
        X = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, X));
        ctx.globalAlpha = Math.min(1, b.t * 3);
        ctx.fillStyle = '#fffdf6';
        SP.roundRect(ctx, X - w / 2, Y - 13, w, 26, 9); ctx.fill();
        ctx.beginPath(); ctx.moveTo(X - 6, Y + 12); ctx.lineTo(X, Y + 20); ctx.lineTo(X + 6, Y + 12); ctx.fill();
        ctx.fillStyle = '#1b1b1b';
        ctx.fillText(b.text, X, Y + 1);
        ctx.globalAlpha = 1;
      }
    }
    const HUD_TOP = 68;

    // --- telegraphs ------------------------------------------------------------------------
    function chevron(X, Y, down, size) {
      ctx.beginPath();
      if (down) { ctx.moveTo(X - size, Y - size * 0.6); ctx.lineTo(X, Y + size * 0.6); ctx.lineTo(X + size, Y - size * 0.6); }
      else { ctx.moveTo(X - size, Y + size * 0.6); ctx.lineTo(X, Y - size * 0.6); ctx.lineTo(X + size, Y + size * 0.6); }
      ctx.closePath();
      ctx.fill();
    }
    function drawTelegraphs(st) {
      const p = st.players[0];
      let warn = false;
      for (const n of st.npcs) {
        if (!n.ws || !n.warned) continue;
        const d = n.y - n.l / 2 - camY;
        if (d < 4 || d > FAR) continue;
        if (d / Math.max(1, n.v + p.v) > 4) continue;
        warn = true;
        const sx = PX(n.x, d, bendAt(d));
        const sy = PY(HGT[n.kind] + 0.8, d);
        ctx.fillStyle = '#ff5a3c';
        chevron(sx, sy - 10 - Math.abs(Math.sin(time * 8)) * 4, true, 9);
      }
      if (warn) {
        ctx.font = '800 15px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const t = 'WRONG-SIDE RIDER AHEAD';
        const w = ctx.measureText(t).width + 40;
        ctx.fillStyle = 'rgba(200,40,30,' + (0.75 + 0.2 * Math.sin(time * 10)).toFixed(3) + ')';
        SP.roundRect(ctx, W / 2 - w / 2, HUD_TOP + 34, w, 26, 8); ctx.fill();
        ctx.fillStyle = '#fff';
        chevron(W / 2 - w / 2 + 14, HUD_TOP + 47, true, 6);
        ctx.fillText(t, W / 2, HUD_TOP + 47);
      }
    }

    // --- cockpit: the Yolo's handlebar, display and mirrors ----------------------------------------
    function drawCockpit(st, braking) {
      const p = st.players[0];
      const s = Math.min(W / 360, (H * 0.62) / 360);
      const cx = W / 2;
      const by = H - 40 * s;
      const jitter = p.wobble > 0 ? Math.sin(time * 40) * 0.04 : 0;
      const ang = (p.crash > 0 ? 0.5 : p.steer * 0.16) + jitter;
      ctx.save();
      ctx.translate(cx, by);
      ctx.scale(s, s);
      // front body panel and mudguard (fixed to the frame)
      ctx.fillStyle = PAL.yoloDark;
      ctx.beginPath(); ctx.moveTo(-70, 60); ctx.lineTo(-38, -6); ctx.lineTo(38, -6); ctx.lineTo(70, 60); ctx.closePath(); ctx.fill();
      ctx.save();
      ctx.rotate(ang);
      // basket in front of the bars
      ctx.fillStyle = 'rgba(19,128,140,0.25)';
      ctx.fillRect(-52, -78, 104, 60);
      ctx.strokeStyle = PAL.yolo;
      ctx.lineWidth = 4;
      ctx.strokeRect(-52, -78, 104, 60);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = -40; x < 52; x += 13) { ctx.moveTo(x, -78); ctx.lineTo(x, -18); }
      for (let y = -66; y < -18; y += 12) { ctx.moveTo(-52, y); ctx.lineTo(52, y); }
      ctx.stroke();
      // bars, grips, levers
      ctx.strokeStyle = '#1f1f1f';
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-150, -2); ctx.quadraticCurveTo(0, -24, 150, -2); ctx.stroke();
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 18;
      ctx.beginPath(); ctx.moveTo(-170, 2); ctx.lineTo(-130, -4); ctx.moveTo(130, -4); ctx.lineTo(170, 2); ctx.stroke();
      const pull = braking ? 10 : 0;
      ctx.strokeStyle = '#9aa0a6';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-125, -12); ctx.lineTo(-175, -22 + pull); ctx.moveTo(125, -12); ctx.lineTo(175, -22 + pull); ctx.stroke();
      // mirrors with blips for traffic behind
      for (const side of [-1, 1]) {
        const mx = side * 150;
        const my = -92;
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(side * 128, -10); ctx.lineTo(mx, my + 18); ctx.stroke();
        ctx.fillStyle = '#1d1d1d';
        ctx.beginPath(); ctx.ellipse(mx, my, 30, 21, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9fb7c9';
        ctx.beginPath(); ctx.ellipse(mx, my, 26, 17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.ellipse(mx, my, 26, 17, 0, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#5c6066';
        ctx.fillRect(mx - 26, my, 52, 17);
        for (const n of st.npcs) {
          if (n.dir < 0 || n.kind === 'cow') continue;
          const back = p.y - n.y;
          if (back < 1.5 || back > 32) continue;
          const dx = n.x - p.x;
          if (side < 0 ? dx > 0.6 : dx < -0.6) continue;
          const z = 1 - back / 32;
          const bw = (n.w * 6 + 4) * (0.4 + z);
          ctx.fillStyle = n.kind === 'car' ? C.car[n.variant] : n.kind === 'bus' ? C.bus[n.variant] : n.kind === 'auto' ? '#f4c20d' : n.kind === 'tanker' ? C.tank[n.variant] : C.bike[n.variant];
          ctx.fillRect(mx + Math.max(-20, Math.min(20, dx * 4)) - bw / 2, my + 4 - z * 10, bw, bw * 0.7);
        }
        ctx.restore();
      }
      // hands
      ctx.fillStyle = '#9c6a45';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(side * 150, -2, 24, 15, side * -0.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // phone in its handlebar mount: the delivery app, or navigation to the office
      const L = World.level(st.levelId);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(-8, 10, 16, 26);
      ctx.fillStyle = '#111';
      SP.roundRect(ctx, -80, -62, 160, 76, 10); ctx.fill();
      ctx.fillStyle = L.mode === 'delivery' ? '#24093f' : '#0c2233';
      SP.roundRect(ctx, -75, -57, 150, 66, 7); ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = '800 14px ' + FONT;
      if (L.mode === 'delivery') {
        const o = Sim.nextOrder(st);
        const idx = o ? st.orders.indexOf(o) + 1 : st.orders.length;
        ctx.fillStyle = '#e0aaff';
        ctx.fillText(o ? 'DROP ' + idx + '/' + st.orders.length : 'ALL DONE', -68, -44);
        if (o) {
          const left = o.due - st.time;
          ctx.fillStyle = left < 0 ? '#ff6a5c' : left < 60 ? '#ffd166' : '#ffffff';
          ctx.font = '800 22px ' + FONT;
          ctx.fillText((left < 0 ? '+' : '') + mmss(Math.abs(left)), -68, -20);
          ctx.font = '700 14px ' + FONT;
          ctx.fillStyle = '#c8b6e2';
          ctx.fillText(Math.max(0, Math.round(o.y - p.y)) + ' m', -68, 1);
        }
      } else {
        ctx.fillStyle = '#7ef7ff';
        ctx.fillText('OFFICE', -68, -44);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 22px ' + FONT;
        ctx.fillText((Math.max(0, L.length - p.y) / 1000).toFixed(2) + ' km', -68, -20);
        ctx.font = '700 14px ' + FONT;
        ctx.fillStyle = '#9ec9dc';
        ctx.fillText('by ' + World.fmtClock(st.deadline), -68, 1);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 14px ' + FONT;
      ctx.fillText(Math.round(p.v * 3.6) + ' km/h', 68, 1);
      ctx.textAlign = 'center';
      if (hornFlash > 0) {
        ctx.fillStyle = 'rgba(255,209,102,' + hornFlash.toFixed(3) + ')';
        ctx.fillText('BEEP', 0, -18);
      }
      // sleeves from the bottom corners
      ctx.restore();
      ctx.strokeStyle = World.level(st.levelId).mode === 'delivery' ? '#5a189a' : '#e8590c';
      ctx.lineWidth = 34 * s;
      ctx.lineCap = 'round';
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (const side of [-1, 1]) {
        const hx = cx + (side * 150 * ca + 2 * sa) * s;
        const hy = by + (side * 150 * sa - 2 * ca) * s;
        ctx.beginPath(); ctx.moveTo(cx + side * W * 0.62, H + 30); ctx.lineTo(hx, hy + 14 * s); ctx.stroke();
      }
    }

    // --- main draw ---------------------------------------------------------------------------
    function draw(st, alpha, interp, dt, opts) {
      time += dt;
      hornFlash = Math.max(0, hornFlash - dt * 3);
      const L = World.level(st.levelId);
      const p = st.players[0];
      const wet = st.weather === 'rain';
      fogCol = wet ? PAL.fogRain : PAL.fog;
      camX = interp.x(p, alpha);
      camY = interp.y(p, alpha);
      heading += World.curveAt(L, camY) * p.v * dt;
      trauma = Math.max(0, trauma - dt * 1.8);
      shakeY = reduceShake ? 0 : trauma * trauma * 14 * Math.sin(time * 55);
      camH = CAM_H + (p.crash > 0 ? -0.6 * (1 - p.crash / T.CRASH_TIME) : 0) + Math.sin(time * 9) * 0.008 * p.v;
      const roll = (p.crash > 0 ? 0.35 * (1 - p.crash / T.CRASH_TIME) : -p.steer * 0.045 * Math.min(1, p.v / 4)) +
        Math.max(-0.08, Math.min(0.08, World.curveAt(L, camY) * p.v * p.v * 0.03)) + (p.wobble > 0 && !reduceShake ? Math.sin(time * 37) * 0.02 : 0);
      buildBends(L);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(W / 2, H * 0.92);
      ctx.rotate(roll);
      ctx.translate(-W / 2, -H * 0.92);
      drawSky(wet);
      drawGround(st, L);
      facades(L, st);
      const list = collect(st, L, alpha, interp);
      for (const it of list) {
        switch (it.kind) {
          case K_VEH: drawVehicle(it.ref, it.a, it.b, wet); break;
          case K_PED: drawPed(it.ref, it.a, it.b); break;
          case K_COW: drawCow(it.ref, it.a, it.b); break;
          case K_TREE: billboard('tree.' + it.b, it.a, camY + it.d, 5, 7); break;
          case K_POLE: drawPole(it.a, L); break;
          case K_BAR: drawBarricade(it.ref, it.a, it.b); break;
          case K_SHRUB: billboard('shrub.' + it.b, it.a, camY + it.d, 1.0, 0.9); break;
          case K_SHELTER: drawShelter(L, it.ref); break;
          case K_PIN: drawPin(it.ref, it.a); break;
          case K_GATE: drawTechGate(L); break;
          default: break;
        }
      }
      drawParticles(dt);
      ctx.restore();
      if (wet) drawRain(dt);
      drawBubbles(st, dt, alpha, interp);
      drawSplat(dt);
      drawCockpit(st, opts && opts.brake);
      if (opts && opts.hud) {
        drawTelegraphs(st);
        GameHud.draw(ctx, st, W, { speed: false });
      }
    }

    function onEvents(ev, st) {
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        switch (e.type) {
          case 'splash':
            if (e.player) addSplat(Math.round(4 + (e.size || 0.5) * 6));
            else burst(e.x, e.y, 6 + Math.round((e.size || 0.5) * 12), 0, 3, 0.6, 0.12, 2.5);
            break;
          case 'pedSplashed': bubble('ped', e.pedId, e.byPlayer ? 'Ayyo! My clothes!' : 'Ayyo!'); break;
          case 'pothole': trauma = Math.min(1, trauma + 0.45 + e.speed / 25); if (e.hidden) bubble('player', 0, 'Hidden pothole!'); break;
          case 'bump': trauma = Math.min(1, trauma + (e.kind === 'breaker' && e.hard ? 0.5 : e.kind === 'scrape' ? 0.1 : 0.22)); break;
          case 'crash': trauma = 1; break;
          case 'screenSplash': addSplat(14); break;
          case 'horn': hornFlash = 1; break;
          case 'honkNpc': if (e.atPlayer) bubble('npc', e.id, 'Swalpa adjust maadi!'); break;
          case 'npcYield': if (Math.random() < 0.5) bubble('npc', e.id, 'Sari, sari'); break;
          case 'fight': {
            const who = e.with === 'ped' ? 'ped' : 'npc';
            if (e.phase === 'start') bubble(who, e.id, pick(['Ey! Kannu kaanalva?', 'Enu guru idu?!', 'Nodkondu hogi!']));
            else if (e.phase === 'sorry') { bubble('player', 0, 'Sorry, sorry!'); bubble(who, e.id, 'Hmm. Hushaaru!', 0.5); }
            else if (e.phase === 'argue') { bubble('player', 0, pick(['You started it!', 'Neeve nodi!', 'Side kodi!'])); bubble(who, e.id, pick(['Yen guru?!', 'Police kareetini!', 'Nimdu tappu!']), 0.4); }
            else if (e.phase === 'shouted') bubble(who, e.id, 'Hogi, hogi...');
            break;
          }
          case 'npcArgue':
            bubble('npc', e.a, e.kind === 'wrongSide' ? pick(['Wrong side, guru!', 'Ulta yaake?']) : pick(['Ey! Side kodi!', 'Indicator haaki!']));
            bubble('npc', e.b, pick(['Swalpa adjust maadi!', 'Sari, hogi!', 'Hurry ide!']), 0.6);
            break;
          case 'hail': bubble('ped', e.pedId, pick(['Auto!', 'Auto! Barthira?'])); break;
          case 'pickup': bubble('npc', e.id, pick(['Banni, kootkoli', 'Meter haakteeni'])); break;
          case 'board': bubble('npc', e.id, 'Majestic! Majestic!'); break;
          case 'chat': bubble('ped', e.a, pick(['Oota aayta?', 'Chennagideera?'])); bubble('ped', e.b, pick(['Aaytu! Neevu?', 'Hoon, chennagideeni']), 0.8); break;
          case 'handover': bubble('player', 0, e.kind === 'apartment' ? pick(['Security: Entry register, sir!', 'Security: Flat number?', 'Lift is slow, sir...']) : pick(['Aunty: Coming, coming!', 'Customer: One minute!'])); break;
          case 'delivered': bubble('player', 0, e.rating >= 5 ? pick(['Super fast! Thank you!', 'Thanks, anna!']) : e.goods < 60 ? 'Customer: The eggs are broken!' : e.late > 0 ? 'Customer: So late!' : 'Customer: Okay, thanks.'); break;
          case 'missed': bubble('player', 0, 'Phone: "Where are you?!" Order cancelled.'); break;
          case 'goodDeed': if (e.kind === 'giveWay') bubble('ped', e.id, pick(['Thank you, anna!', 'Dhanyavaada!'])); else if (e.kind === 'letIn') bubble('npc', e.id, 'Thanks, guru!'); break;
          default: break;
        }
      }
    }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function mmss(sec) { const s = Math.floor(sec); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    function reset() {
      P.clear();
      bubbles.length = 0;
      splat.length = 0;
      trauma = 0;
      heading = 0;
    }

    resize();
    return {
      resize,
      draw,
      onEvents,
      reset,
      /** Cap the device pixel ratio (auto quality on slow phones). */
      setMaxDpr(v) { if (v !== maxDpr) { maxDpr = v; resize(); } },
      setReduceShake(v) { reduceShake = !!v; },
      /** World x under a canvas-relative CSS x at the scooter's front (for follow-the-finger steering). */
      worldX(cssX) { const d = 4; return camX + ((cssX - cx0) * d) / f - bendAt(d); },
    };
  }

  root.GameRender = { create };
})(window);
