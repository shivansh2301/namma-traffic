/*
 * client/render-top.js: the top-down "map view" (the original v1 renderer).
 * The default view is the road view (render.js); this one is kept as an
 * option (?view=top or the View setting) and for debugging traffic. Bends
 * are not drawn here: it shows the road straightened out, like a route map.
 *
 *   const R = GameRenderTop.create(canvas);
 *   R.resize();                                // on window resize
 *   R.draw(state, alpha, interp, frameDt, opts) // every frame; opts.hud
 *   R.onEvents(events, state)                  // particles, shake, bubbles, splatter
 *   R.reset()                                  // new run
 *
 * Draw order (SPEC §10.2): ground -> puddles/potholes -> entities by y ->
 * particles -> rain -> screen splatter -> HUD. Everything is drawn in code;
 * sprites are baked once per zoom level by kit/sprites. Art recipes and the
 * palette are documented in docs/concepts/procedural-art.md.
 */
(function (root) {
  'use strict';
  const { T, DT, VEHICLES, PED } = World;
  const SP = Kit.Sprites;
  const h01 = SP.hash01;
  const shade = SP.shade;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const HUD_H = 68;

  const PAL = {
    ground: '#6f6250',
    asphalt: '#3e4249', asphaltWet: '#2e333a',
    line: '#ece6d6', yellow: '#f4c20d',
    slab: '#b9b09e', slabJoint: '#958c7b', slabBroken: '#8a806d',
    kerbA: '#202020', kerbB: '#e8c547', kerbGrey: '#cfc9bc',
    dirt: '#8a7253', rubble: '#66533b', rubble2: '#a8906b',
    median: '#5b8a3c', shrub: '#3d6a29', shrub2: '#4e7e32',
    puddle: 'rgba(78,104,130,0.85)', puddleHi: 'rgba(214,230,242,0.45)',
    barA: '#1f6fc4', barB: '#f2f2f2', pit: '#5c4630', pit2: '#3e2e1f',
    hudBg: 'rgba(14,17,22,0.8)', hudText: '#f5f1e8', hudDim: '#b8b2a3', late: '#ff6a5c', karma: '#ffb703', cond: '#4fc3f7',
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
    roof: ['#c9b79c', '#a7a39a', '#d4c4a8', '#9e8f7a', '#c2a68a', '#b7aa95'],
    awning: ['#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#16a085'],
    sign: ['#ffd23f', '#3bceac', '#ee4266', '#0ead69', '#540d6e', '#f7f7f7'],
  };

  // ---------------------------------------------------------------------------
  // Sprite recipes (metres, origin at centre, front of the vehicle at -y)
  // ---------------------------------------------------------------------------
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function box(g, x, y, w, h, r) { SP.roundRect(g, x, y, w, h, r || 0.0001); g.fill(); }

  function drawBike(g, body, helmet, shirt, outline) {
    g.fillStyle = 'rgba(0,0,0,0.28)'; ell(g, 0.1, 0.12, 0.42, 0.98);
    g.fillStyle = '#151515'; box(g, -0.075, -0.97, 0.15, 0.44, 0.07); box(g, -0.08, 0.52, 0.16, 0.46, 0.07);
    g.fillStyle = body; box(g, -0.21, -0.74, 0.42, 1.52, 0.2);
    g.fillStyle = shade(body, -0.28); box(g, -0.16, 0.22, 0.32, 0.52, 0.12);
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 0.07; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.37, -0.57); g.lineTo(0.37, -0.57); g.stroke();
    g.fillStyle = '#cfd8dc'; circ(g, -0.4, -0.62, 0.06); circ(g, 0.4, -0.62, 0.06);
    g.fillStyle = '#fff3b0'; box(g, -0.09, -0.82, 0.18, 0.08, 0.03);
    g.fillStyle = '#e53935'; box(g, -0.09, 0.76, 0.18, 0.06, 0.03);
    g.strokeStyle = shirt; g.lineWidth = 0.11;
    g.beginPath(); g.moveTo(-0.24, -0.1); g.lineTo(-0.33, -0.52); g.moveTo(0.24, -0.1); g.lineTo(0.33, -0.52); g.stroke();
    g.fillStyle = shirt; ell(g, 0, 0.02, 0.29, 0.19);
    g.fillStyle = helmet; circ(g, 0, -0.06, 0.165);
    g.fillStyle = 'rgba(15,20,30,0.75)'; ell(g, 0, -0.17, 0.11, 0.05);
    if (outline) {
      g.strokeStyle = outline; g.lineWidth = 0.09;
      SP.roundRect(g, -0.25, -0.8, 0.5, 1.62, 0.22); g.stroke();
      g.beginPath(); g.ellipse(0, 0.02, 0.33, 0.23, 0, 0, Math.PI * 2); g.stroke();
    }
  }

  function drawAuto(g, v) {
    const body = shade('#2e7d32', v * 0.06);
    const top = shade('#f4c20d', -v * 0.05);
    g.fillStyle = 'rgba(0,0,0,0.28)'; ell(g, 0.12, 0.15, 0.75, 1.42);
    g.fillStyle = '#151515'; box(g, -0.09, -1.38, 0.18, 0.36, 0.06); box(g, -0.76, 0.6, 0.16, 0.48, 0.06); box(g, 0.6, 0.6, 0.16, 0.48, 0.06);
    g.fillStyle = body; box(g, -0.7, -1.05, 1.4, 2.4, 0.32); box(g, -0.42, -1.35, 0.84, 0.6, 0.28);
    g.fillStyle = '#2b3a44'; box(g, -0.52, -1.0, 1.04, 0.3, 0.1);
    g.fillStyle = top; box(g, -0.66, -0.72, 1.32, 1.95, 0.28);
    g.strokeStyle = shade(top, -0.2); g.lineWidth = 0.05;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-0.6, -0.35 + i * 0.45); g.lineTo(0.6, -0.35 + i * 0.45); g.stroke(); }
    g.fillStyle = '#fff3b0'; circ(g, 0, -1.3, 0.08);
    g.fillStyle = '#111'; box(g, -0.22, 1.24, 0.44, 0.14, 0.05);
  }

  function drawCar(g, body, cab) {
    g.fillStyle = 'rgba(0,0,0,0.28)'; ell(g, 0.14, 0.18, 0.98, 2.25);
    g.fillStyle = '#121212';
    box(g, -0.96, -1.55, 0.14, 0.58, 0.05); box(g, 0.82, -1.55, 0.14, 0.58, 0.05);
    box(g, -0.96, 0.95, 0.14, 0.58, 0.05); box(g, 0.82, 0.95, 0.14, 0.58, 0.05);
    g.fillStyle = body; box(g, -0.9, -2.15, 1.8, 4.3, 0.5);
    g.fillStyle = shade(body, -0.07); box(g, -0.76, -2.0, 1.52, 1.1, 0.35);
    g.fillStyle = '#26323d';
    g.beginPath(); g.moveTo(-0.72, -0.86); g.lineTo(0.72, -0.86); g.lineTo(0.62, -0.3); g.lineTo(-0.62, -0.3); g.closePath(); g.fill();
    g.fillStyle = shade(body, 0.08); box(g, -0.66, -0.3, 1.32, 1.55, 0.2);
    g.fillStyle = '#26323d';
    g.beginPath(); g.moveTo(-0.62, 1.25); g.lineTo(0.62, 1.25); g.lineTo(0.7, 1.62); g.lineTo(-0.7, 1.62); g.closePath(); g.fill();
    g.fillStyle = '#fff6c4'; box(g, -0.78, -2.13, 0.32, 0.12, 0.05); box(g, 0.46, -2.13, 0.32, 0.12, 0.05);
    g.fillStyle = '#d32f2f'; box(g, -0.8, 2.03, 0.3, 0.1, 0.04); box(g, 0.5, 2.03, 0.3, 0.1, 0.04);
    g.fillStyle = shade(body, -0.3); box(g, -1.02, -0.76, 0.14, 0.12, 0.03); box(g, 0.88, -0.76, 0.14, 0.12, 0.03);
    if (cab) { g.fillStyle = '#f9d71c'; box(g, -0.32, 0.3, 0.64, 0.24, 0.06); box(g, -0.3, -2.18, 0.6, 0.08, 0.02); }
  }

  function drawBus(g, body) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; ell(g, 0.18, 0.25, 1.4, 6.1);
    g.fillStyle = body; box(g, -1.3, -6, 2.6, 12, 0.35);
    g.fillStyle = '#e4e4e4'; box(g, -1.1, -5.2, 2.2, 10.9, 0.25);
    g.fillStyle = '#9aa3ab'; box(g, -0.7, -3.4, 1.4, 1.6, 0.15); box(g, -0.7, 0.9, 1.4, 1.6, 0.15);
    g.fillStyle = '#c4cacf'; box(g, -0.45, -0.9, 0.9, 0.7, 0.1); box(g, -0.45, 3.6, 0.9, 0.7, 0.1);
    g.fillStyle = '#22303a'; box(g, -1.2, -5.96, 2.4, 0.62, 0.25);
    g.fillStyle = '#ff9800'; box(g, -0.8, -5.5, 1.6, 0.16, 0.04);
    g.fillStyle = '#d32f2f'; box(g, -1.15, 5.85, 0.4, 0.1, 0.03); box(g, 0.75, 5.85, 0.4, 0.1, 0.03);
  }

  function drawTanker(g, cabC, tankC) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; ell(g, 0.16, 0.2, 1.3, 4.1);
    g.fillStyle = '#121212';
    box(g, -1.25, -3.2, 0.16, 0.7, 0.05); box(g, 1.09, -3.2, 0.16, 0.7, 0.05);
    box(g, -1.25, 1.9, 0.16, 1.3, 0.05); box(g, 1.09, 1.9, 0.16, 1.3, 0.05);
    g.fillStyle = cabC; box(g, -1.15, -4, 2.3, 2.2, 0.3);
    g.fillStyle = '#22303a'; box(g, -1.0, -3.96, 2.0, 0.55, 0.2);
    g.fillStyle = shade(cabC, 0.12); box(g, -0.9, -3.3, 1.8, 1.3, 0.2);
    g.fillStyle = '#2b2b2b'; box(g, -1.0, -1.85, 2.0, 5.8, 0.1);
    g.fillStyle = tankC; box(g, -1.18, -1.75, 2.36, 5.65, 0.9);
    g.fillStyle = shade(tankC, 0.25); box(g, -0.35, -1.6, 0.7, 5.35, 0.3);
    g.strokeStyle = '#8f9aa3'; g.lineWidth = 0.07;
    for (const y of [-0.5, 1.15, 2.8]) { g.beginPath(); g.moveTo(-1.15, y); g.lineTo(1.15, y); g.stroke(); }
    g.fillStyle = '#5c6b75'; circ(g, 0, 0.3, 0.28); circ(g, 0, 2.0, 0.28);
    g.fillStyle = 'rgba(80,140,200,0.7)'; circ(g, 0.3, 3.95, 0.08);
  }

  function drawCow(g, col, sitting) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; ell(g, 0.08, 0.12, sitting ? 0.55 : 0.46, 1.0);
    g.strokeStyle = shade(col, -0.45); g.lineWidth = 0.05; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0.95); g.quadraticCurveTo(0.05, 1.1, 0.16, 1.15); g.stroke();
    if (sitting) { g.fillStyle = shade(col, -0.35); ell(g, -0.45, -0.25, 0.12, 0.08); ell(g, 0.45, 0.45, 0.12, 0.08); }
    g.fillStyle = col; ell(g, 0, 0.15, sitting ? 0.5 : 0.42, 0.82);
    g.fillStyle = shade(col, -0.22); ell(g, 0.14, 0.35, 0.15, 0.22); ell(g, -0.16, -0.05, 0.12, 0.16);
    g.fillStyle = shade(col, -0.06); ell(g, 0, -0.42, 0.26, 0.2);
    g.save(); if (sitting) g.rotate(0.25);
    g.fillStyle = shade(col, -0.1); ell(g, 0, -0.82, 0.19, 0.27);
    g.fillStyle = shade(col, -0.2); ell(g, -0.21, -0.86, 0.09, 0.05); ell(g, 0.21, -0.86, 0.09, 0.05);
    g.strokeStyle = '#efe4c8'; g.lineWidth = 0.06;
    g.beginPath(); g.moveTo(-0.1, -0.95); g.quadraticCurveTo(-0.2, -1.0, -0.22, -1.14); g.moveTo(0.1, -0.95); g.quadraticCurveTo(0.2, -1.0, 0.22, -1.14); g.stroke();
    g.fillStyle = '#d6a0a0'; ell(g, 0, -1.04, 0.1, 0.06);
    g.restore();
  }

  function drawPed(g, clothes, v) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; ell(g, 0.05, 0.06, 0.25, 0.19);
    g.fillStyle = shade(clothes, -0.2); ell(g, -0.23, 0.03, 0.06, 0.09); ell(g, 0.23, 0.03, 0.06, 0.09);
    g.fillStyle = clothes; ell(g, 0, 0.03, 0.22, 0.13);
    if (v % 2 === 0) { g.strokeStyle = shade(clothes, 0.35); g.lineWidth = 0.06; g.beginPath(); g.moveTo(-0.18, -0.05); g.lineTo(0.16, 0.12); g.stroke(); }
    g.fillStyle = v % 3 === 0 ? '#d9d9d9' : '#1b1410'; circ(g, 0, -0.01, 0.105);
  }

  function drawPothole(g, k) {
    const N = 11;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 0.72 + 0.28 * h01(k, i, 3);
      pts.push([Math.cos(a) * r, Math.sin(a) * r * (0.8 + 0.2 * h01(k, 9, 1))]);
    }
    const poly = (s, dx, dy) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, p[0] * s + dx, p[1] * s + dy)); g.closePath(); g.fill(); };
    g.fillStyle = '#5a534a'; poly(1.0, 0, 0);
    g.fillStyle = '#2a2521'; poly(0.86, 0, 0);
    g.fillStyle = '#16120f'; poly(0.58, 0.06, 0.05);
    g.fillStyle = '#4a443d';
    for (let i = 0; i < 6; i++) box(g, (h01(k, i, 7) - 0.5) * 2.0, (h01(k, i, 8) - 0.5) * 2.0, 0.08, 0.06, 0.01);
  }

  function drawAsphaltTile(g, wet) {
    // 8 m x 8 m, origin at the centre; transparent where the base colour shows.
    for (let i = 0; i < 5; i++) {
      g.fillStyle = h01(i, 2, wet ? 5 : 4) < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
      box(g, (h01(i, 1, 1) - 0.5) * 6.5, (h01(i, 1, 2) - 0.5) * 6.5, 1 + h01(i, 1, 3) * 2.2, 0.8 + h01(i, 1, 6) * 2.4, 0.4);
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = h01(i, 5, 1) < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.09)';
      g.fillRect((h01(i, 5, 2) - 0.5) * 8, (h01(i, 5, 3) - 0.5) * 8, 0.06, 0.06);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.035;
    for (let i = 0; i < 2; i++) {
      let x = (h01(i, 8, 1) - 0.5) * 7;
      let y = (h01(i, 8, 2) - 0.5) * 7;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (h01(i, j, 9) - 0.5) * 0.9; y += 0.25 + h01(i, j, 10) * 0.3; g.lineTo(x, y); }
      g.stroke();
    }
    if (wet) {
      g.fillStyle = 'rgba(160,190,220,0.06)';
      for (let i = 0; i < 4; i++) ell(g, (h01(i, 11, 1) - 0.5) * 6, (h01(i, 11, 2) - 0.5) * 6, 1.2, 0.5);
    }
  }

  function drawCartTop(g, v) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; ell(g, 0.08, 0.1, 0.6, 1.0);
    g.fillStyle = '#4e342e'; box(g, -0.62, -0.3, 0.14, 0.6, 0.04); box(g, 0.48, -0.3, 0.14, 0.6, 0.04);
    g.fillStyle = '#795548'; box(g, -0.55, -0.85, 1.1, 1.4, 0.08);
    const veg = v ? ['#2e7d32', '#f57c00', '#c62828', '#558b2f'] : ['#43a047', '#fbc02d', '#8e24aa', '#ef6c00'];
    for (let i = 0; i < 18; i++) { g.fillStyle = veg[i % 4]; circ(g, -0.4 + (i % 5) * 0.2, -0.7 + Math.floor(i / 5) * 0.32, 0.11); }
    g.fillStyle = '#ff7043'; ell(g, 0, 0.78, 0.25, 0.15);
    g.fillStyle = '#1b1410'; circ(g, 0, 0.78, 0.1);
  }

  function registerSprites(sp) {
    for (let v = 0; v < 2; v++) sp.register('cart.' + v, 1.1, 1.9, (g) => drawCartTop(g, v));
    for (let v = 0; v < 8; v++) sp.register('bike.' + v, 0.8, 1.9, (g) => drawBike(g, C.bike[v], C.helmet[v], C.shirt[v], null));
    sp.register('player', 0.7, 1.7, (g) => drawBike(g, '#1fb5c4', '#ffffff', '#e8590c', '#22e5ff'));
    for (let v = 0; v < 3; v++) sp.register('auto.' + v, 1.4, 2.7, (g) => drawAuto(g, v));
    for (let v = 0; v < 8; v++) sp.register('car.' + v, 1.8, 4.3, (g) => drawCar(g, C.car[v], false));
    sp.register('cab', 1.8, 4.3, (g) => drawCar(g, '#f7f7f2', true));
    for (let v = 0; v < 3; v++) sp.register('bus.' + v, 2.6, 12, (g) => drawBus(g, C.bus[v]));
    for (let v = 0; v < 2; v++) sp.register('tanker.' + v, 2.4, 8, (g) => drawTanker(g, C.tankerCab[v], C.tank[v]));
    for (let v = 0; v < 3; v++) {
      sp.register('cow.' + v, 0.9, 2.1, (g) => drawCow(g, C.cow[v], false));
      sp.register('cowsit.' + v, 1.1, 2.1, (g) => drawCow(g, C.cow[v], true));
    }
    for (let v = 0; v < 10; v++) sp.register('ped.' + v, 0.5, 0.45, (g) => drawPed(g, C.ped[v], v));
    for (let k = 0; k < 6; k++) sp.register('ph.' + k, 2, 2, (g) => drawPothole(g, k));
  }

  // ---------------------------------------------------------------------------
  function create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const cam = Kit.Camera.create({ viewMin: 18, viewMax: 21, anchorY: 0.8 });
    const sprites = SP.create({ pad: 0.3 });
    const tiles = SP.create({ pad: 0 });
    registerSprites(sprites);
    tiles.register('asphalt', 8, 8, (g) => drawAsphaltTile(g, false));
    tiles.register('asphaltWet', 8, 8, (g) => drawAsphaltTile(g, true));
    const P = Kit.Particles.create(600);
    const PCOL = ['rgba(205,225,240,0.9)', 'rgba(170,145,105,0.8)', 'rgba(40,34,28,0.95)', 'rgba(255,214,90,0.95)'];
    const bubbles = [];
    const splat = [];
    const ents = [];
    let nEnt = 0;
    const rain = new Float32Array(160 * 3);
    for (let i = 0; i < 160; i++) { rain[i * 3] = Math.random(); rain[i * 3 + 1] = Math.random(); rain[i * 3 + 2] = 0.6 + Math.random() * 0.6; }
    let W = 1;
    let H = 1;
    let dpr = 1;
    let maxDpr = 2;
    let time = 0;
    let ppm = 1;

    const sx = (x) => cam.sx(x);
    const sy = (y) => cam.sy(y);
    function rectW(x0, y0, x1, y1, color) {
      ctx.fillStyle = color;
      ctx.fillRect(sx(x0), sy(y1), (x1 - x0) * ppm, (y1 - y0) * ppm);
    }
    function circW(x, y, r, color) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(sx(x), sy(y), r * ppm, 0, Math.PI * 2); ctx.fill();
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      dpr = Math.min(maxDpr, root.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      cam.resize(W, H);
      const ppmMax = W / cam.viewMin;
      sprites.setScale(ppmMax * dpr);
      tiles.setScale(ppmMax * dpr);
    }

    // --- ground --------------------------------------------------------------
    function asphalt(xa, xb, y0, y1, wet) {
      rectW(xa, y0, xb, y1, wet ? PAL.asphaltWet : PAL.asphalt);
      const tile = tiles.get(wet ? 'asphaltWet' : 'asphalt');
      ctx.save();
      ctx.beginPath(); ctx.rect(sx(xa), sy(y1), (xb - xa) * ppm, (y1 - y0) * ppm); ctx.clip();
      const TS = 8;
      const sz = TS * ppm + 1;
      for (let ty = Math.floor(y0 / TS) * TS; ty < y1; ty += TS) {
        for (let tx = Math.floor(xa / TS) * TS; tx < xb; tx += TS) ctx.drawImage(tile.canvas, sx(tx), sy(ty + TS), sz, sz);
      }
      ctx.restore();
    }

    function dashes(x, y0, y1, color, salt) {
      const DL = 3;
      const PER = 7.5;
      ctx.fillStyle = color;
      for (let k = Math.floor(y0 / PER); k * PER < y1; k++) {
        const a = h01(k, salt, 99);
        if (a < 0.22) continue; // faded away (SPEC §4.2)
        ctx.globalAlpha = 0.3 + 0.65 * a;
        ctx.fillRect(sx(x - 0.07), sy(k * PER + DL), 0.14 * ppm, DL * ppm);
      }
      ctx.globalAlpha = 1;
    }

    function edgeZone(xa, xb, y0, y1, footpath, kerbAt, salt) {
      if (footpath) {
        rectW(xa, y0, xb, y1, PAL.slab);
        ctx.fillStyle = PAL.slabJoint;
        for (let j = Math.floor(y0 / 0.9); j * 0.9 < y1; j++) {
          ctx.fillRect(sx(xa), sy(j * 0.9), (xb - xa) * ppm, Math.max(1, 0.05 * ppm));
          if (h01(j, salt, 7) < 0.13) {
            const half = h01(j, salt, 8) < 0.5;
            rectW(half ? xa : (xa + xb) / 2, j * 0.9 + 0.05, half ? (xa + xb) / 2 : xb, j * 0.9 + 0.9, PAL.slabBroken);
          }
        }
        ctx.fillStyle = PAL.slabJoint;
        ctx.fillRect(sx((xa + xb) / 2), sy(y1), Math.max(1, 0.05 * ppm), (y1 - y0) * ppm);
        const k0 = kerbAt > xa ? kerbAt - 0.22 : kerbAt;
        for (let k = Math.floor(y0); k < y1; k++) rectW(k0, k, k0 + 0.22, k + 1, (k & 1) ? PAL.kerbA : PAL.kerbB);
      } else {
        rectW(xa, y0, xb, y1, PAL.dirt);
        for (let j = Math.floor(y0 / 1.1); j * 1.1 < y1; j++) {
          for (let i = 0; i < 3; i++) {
            const rx = xa + h01(j, i, salt) * (xb - xa);
            const ry = j * 1.1 + h01(j, i, salt + 1) * 1.1;
            const r = 0.06 + 0.1 * h01(j, i, salt + 2);
            circW(rx, ry, r, i === 0 ? PAL.rubble2 : PAL.rubble);
          }
        }
      }
    }

    function buildings(dir, wx, y0, y1) {
      const CELL = 6;
      const salt = dir < 0 ? 3 : 7;
      for (let k = Math.floor(y0 / CELL); k * CELL < y1; k++) {
        const a = h01(k, salt, 13);
        const b = h01(k, salt, 29);
        const c = h01(k, salt, 41);
        const ya = k * CELL;
        const yb = ya + CELL - 0.25;
        const xa = dir < 0 ? wx - 14 : wx;
        const xb = dir < 0 ? wx : wx + 14;
        if (a < 0.62) {
          rectW(xa, ya, xb, yb, C.roof[Math.floor(b * C.roof.length)]);
          circW(wx + dir * (4 + c * 6), ya + 1.6 + b * 2.8, 0.6, '#1d1d1d');
          if (b > 0.6) circW(wx + dir * (8 + c * 3), ya + 4, 0.5, '#1d1d1d');
          const aw = C.awning[Math.floor(c * C.awning.length)];
          const a0 = dir < 0 ? wx - 1.1 : wx;
          for (let s = ya; s < yb; s += 0.5) rectW(a0, s, a0 + 1.1, Math.min(yb, s + 0.25), aw);
          for (let s = ya + 0.25; s < yb; s += 0.5) rectW(a0, s, a0 + 1.1, Math.min(yb, s + 0.25), '#f4efe4');
          const s0 = dir < 0 ? wx - 1.5 : wx + 1.1;
          rectW(s0, ya + 0.3, s0 + 0.4, yb - 0.3, C.sign[Math.floor(b * 7) % C.sign.length]);
        } else if (a < 0.85) {
          rectW(xa, ya, xb, yb + 0.25, '#73674c');
          rectW(dir < 0 ? wx - 0.18 : wx, ya, dir < 0 ? wx : wx + 0.18, yb + 0.25, '#ddd5c6');
          ctx.globalAlpha = 0.95;
          circW(wx + dir * 3.2, ya + CELL / 2, 2.1 + b * 0.8, '#2f6b37');
          circW(wx + dir * 3.0, ya + CELL / 2 + 0.4, 1.3 + b * 0.5, '#3b8044');
          ctx.globalAlpha = 1;
        } else {
          rectW(xa, ya, xb, yb + 0.25, '#8b7859');
          for (let i = 0; i < 4; i++) circW(wx + dir * (1 + h01(k, i, 50) * 10), ya + h01(k, i, 51) * CELL, 0.15 + h01(k, i, 52) * 0.25, '#6c5a42');
        }
      }
    }

    function median(xa, xb, y0, y1) {
      rectW(xa, y0, xb, y1, PAL.kerbGrey);
      rectW(xa + 0.15, y0, xb - 0.15, y1, PAL.median);
      const mid = (xa + xb) / 2;
      for (let j = Math.floor(y0 / 1.7); j * 1.7 < y1; j++) {
        const h = h01(j, 77, 1);
        circW(mid + (h - 0.5) * 0.5, j * 1.7, 0.3 + 0.2 * h, h < 0.5 ? PAL.shrub : PAL.shrub2);
      }
    }

    function drawGround(st, L) {
      const wet = st.weather === 'rain';
      const yb = cam.bottom() - 1;
      const yt = cam.top() + 1;
      ctx.fillStyle = PAL.ground;
      ctx.fillRect(0, 0, W, H);
      const last = L.segs.length - 1;
      for (const s of L.segs) {
        let y0 = s.i === 0 ? Math.min(s.y0, yb) : s.y0;
        let y1 = s.i === last ? Math.max(s.y1, yt) : s.y1;
        if (y1 < yb || y0 > yt) continue;
        y0 = Math.max(y0, yb);
        y1 = Math.min(y1, yt);
        const xs = s.xs;
        buildings(-1, xs.wallL, y0, y1);
        buildings(1, xs.wallR, y0, y1);
        edgeZone(xs.wallL, 0, y0, y1, s.footpathL, 0, 11);
        if (xs.divided) {
          asphalt(0, xs.ownR, y0, y1, wet);
          median(xs.ownR, xs.farL, y0, y1);
          asphalt(xs.farL, xs.farR, y0, y1, wet);
          edgeZone(xs.farR, xs.wallR, y0, y1, true, xs.farR, 23);
          for (let k = 1; k < xs.oncLanes; k++) dashes(xs.farL + k * T.LANE_W, y0, y1, PAL.line, 300 + k);
        } else {
          asphalt(0, xs.roadR, y0, y1, wet);
          edgeZone(xs.roadR, xs.wallR, y0, y1, s.footpathR, xs.roadR, 23);
          if (s.lanesOncoming > 0) {
            dashes(xs.ownR - 0.12, y0, y1, PAL.line, 200);
            dashes(xs.ownR + 0.12, y0, y1, PAL.line, 201);
          }
          for (let k = 1; k < s.lanesOncoming; k++) dashes(xs.ownR + k * T.LANE_W, y0, y1, PAL.line, 250 + k);
        }
        for (let k = 1; k < s.lanesOwn; k++) dashes(k * T.LANE_W, y0, y1, PAL.line, 100 + k);
      }
      for (const f of L.busStops) {
        if (f.y < yb - 4 || f.y > yt + 4) continue;
        const s = World.segmentAt(L, f.y);
        const x0 = s.xs.wallL + 0.25;
        rectW(x0, f.y - 2.5, -0.7, f.y + 2.5, '#2f5e50');
        rectW(x0 + 0.15, f.y - 2.35, -0.85, f.y + 2.35, '#3c7564');
        circW(-0.45, f.y + 3.1, 0.2, '#1565c0');
      }
      for (const b of L.breakers) {
        if (b.y < yb - 1 || b.y > yt + 1) continue;
        const s = World.segmentAt(L, b.y);
        const xr = s.xs.divided ? s.xs.ownR : s.xs.roadR;
        if (b.marked) {
          rectW(0, b.y - 0.35, xr, b.y + 0.35, '#1d1d1d');
          for (let x = 0; x < xr; x += 0.7) rectW(x, b.y - 0.35, Math.min(xr, x + 0.35), b.y + 0.35, PAL.yellow);
        } else {
          rectW(0, b.y - 0.35, xr, b.y + 0.35, wet ? '#363a41' : '#474b52');
          rectW(0, b.y - 0.35, xr, b.y - 0.25, 'rgba(0,0,0,0.25)');
        }
      }
    }

    /** Delivery drop zones (purple, at the left kerb) and the tech-park gate line. */
    function drawDestinations(st, L) {
      const yb = cam.bottom() - 8;
      const yt = cam.top() + 8;
      const next = Sim.nextOrder(st);
      for (const o of st.orders || []) {
        if (o.status !== 'pending' || o.y < yb || o.y > yt) continue;
        ctx.globalAlpha = o === next ? 0.4 + 0.15 * Math.sin(time * 5) : 0.2;
        rectW(-0.3, o.y - T.DROP_ZONE / 2, T.DROP_MAX_X, o.y + T.DROP_ZONE / 2, '#7b2cbf');
        ctx.globalAlpha = 1;
        const s = World.segmentAt(L, o.y);
        circW(s.xs.wallL + 0.6, o.y, 0.55, '#7b2cbf');
        circW(s.xs.wallL + 0.6, o.y, 0.25, '#ffffff');
      }
      for (const b of st.busy || []) { // busy gully: a warm wash and bunting lines
        if (b.y1 < yb || b.y0 > yt) continue;
        const s = World.segmentAt(L, b.y0);
        ctx.globalAlpha = 0.12;
        rectW(s.xs.wallL, b.y0, s.xs.wallR, b.y1, '#ff9800');
        ctx.globalAlpha = 1;
        for (let y = b.y0; y <= b.y1; y += 12) {
          for (let x = s.xs.wallL + 0.3, i = 0; x < s.xs.wallR; x += 0.6, i++) circW(x, y, 0.12, i & 1 ? '#ffeb3b' : '#e91e63');
        }
      }
      if (L.destination && L.length > yb && L.length < yt) {
        const s = World.segmentAt(L, L.length - 1);
        rectW(s.xs.wallL, L.length - 0.3, s.xs.wallR, L.length + 0.3, '#263238');
        rectW(s.xs.wallL, L.length - 0.08, s.xs.wallR, L.length + 0.08, '#4fc3f7');
      }
    }

    function drawBarricades(L) {
      const yb = cam.bottom() - 2;
      const yt = cam.top() + 2;
      for (const b of L.barricades) {
        if (b.y1 < yb || b.y0 > yt) continue;
        rectW(b.x0, b.y0, b.x1, b.y1, PAL.pit);
        if (b.y1 - b.y0 > 8 && b.x1 - b.x0 > 2) rectW(b.x0 + 0.7, b.y0 + 3, b.x1 - 0.7, b.y1 - 3, PAL.pit2);
        const t = 0.22;
        const ya = Math.max(b.y0, yb);
        const yz = Math.min(b.y1, yt);
        for (let y = Math.floor(ya); y < yz; y++) {
          const col = (y & 1) ? PAL.barA : PAL.barB;
          rectW(b.x0, y, b.x0 + t, y + 1, col);
          rectW(b.x1 - t, y, b.x1, y + 1, col);
        }
        for (const ye of [b.y0, b.y1 - t]) {
          if (ye < yb || ye > yt) continue;
          for (let x = b.x0, i = 0; x < b.x1; x += 1, i++) rectW(x, ye, Math.min(b.x1, x + 1), ye + t, (i & 1) ? PAL.barA : PAL.barB);
          const on = Math.floor(time * 3) % 2 === 0;
          circW(b.x0 + 0.2, ye + 0.1, 0.13, on ? '#ff9800' : '#7a4a10');
          circW(b.x1 - 0.2, ye + 0.1, 0.13, on ? '#7a4a10' : '#ff9800');
        }
      }
    }

    function lowerBound(arr, y) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].y < y) lo = m + 1; else hi = m; }
      return lo;
    }

    function drawHazards(st) {
      const yb = cam.bottom() - 3;
      const yt = cam.top() + 3;
      const wet = st.weather === 'rain';
      for (let i = lowerBound(st.puddles, yb); i < st.puddles.length && st.puddles[i].y < yt; i++) {
        const q = st.puddles[i];
        ctx.fillStyle = PAL.puddle;
        ctx.beginPath(); ctx.ellipse(sx(q.x), sy(q.y), q.rx * ppm, q.ry * ppm, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PAL.puddleHi;
        ctx.beginPath(); ctx.ellipse(sx(q.x - q.rx * 0.25), sy(q.y + q.ry * 0.3), q.rx * 0.45 * ppm, q.ry * 0.12 * ppm, -0.4, 0, Math.PI * 2); ctx.fill();
        if (wet) {
          const ph = (time * 0.9 + q.id * 0.37) % 1;
          ctx.strokeStyle = 'rgba(220,235,245,' + (0.5 * (1 - ph)).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(sx(q.x + q.rx * 0.2), sy(q.y), q.rx * 0.5 * ph * ppm + 1, q.ry * 0.35 * ph * ppm + 1, 0, 0, Math.PI * 2); ctx.stroke();
        }
      }
      for (let i = lowerBound(st.potholes, yb); i < st.potholes.length && st.potholes[i].y < yt; i++) {
        const h = st.potholes[i];
        if (h.hidden) continue;
        sprites.draw(ctx, 'ph.' + h.shape, sx(h.x), sy(h.y), h.rot, ppm * h.r);
      }
    }

    // --- entities -------------------------------------------------------------
    function addEnt(ref, kind, x, y) {
      let e = ents[nEnt];
      if (!e) { e = { ref: null, kind: 0, x: 0, y: 0 }; ents[nEnt] = e; }
      nEnt++;
      e.ref = ref; e.kind = kind; e.x = x; e.y = y;
    }
    const byY = (a, b) => b.y - a.y;

    function drawEntities(st, alpha, interp) {
      const yb = cam.bottom() - 7;
      const yt = cam.top() + 7;
      nEnt = 0;
      for (const p of st.players) addEnt(p, 0, interp.x(p, alpha), interp.y(p, alpha));
      for (const n of st.npcs) if (n.y > yb && n.y < yt) addEnt(n, 1, interp.x(n, alpha), interp.y(n, alpha));
      for (const pd of st.peds) if (pd.y > yb && pd.y < yt) addEnt(pd, 2, interp.x(pd, alpha), interp.y(pd, alpha));
      ents.length = Math.max(ents.length, nEnt);
      const list = ents.slice(0, nEnt).sort(byY);
      for (const e of list) {
        const X = sx(e.x);
        const Y = sy(e.y);
        if (e.kind === 1) drawNpc(e.ref, X, Y);
        else if (e.kind === 2) drawPedestrian(e.ref, X, Y);
        else drawPlayer(e.ref, X, Y);
      }
    }

    function drawNpc(n, X, Y) {
      if (n.kind === 'cow') {
        sprites.draw(ctx, (n.mode === 'sit' ? 'cowsit.' : 'cow.') + n.variant, X, Y, n.h, ppm);
        return;
      }
      if (n.ws) {
        const fy = Y + (n.l / 2) * ppm;
        const g = ctx.createRadialGradient(X, fy, 2, X, fy + 2.5 * ppm, 4 * ppm);
        g.addColorStop(0, 'rgba(255,244,190,0.55)');
        g.addColorStop(1, 'rgba(255,244,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(X, fy + 2.5 * ppm, 1.6 * ppm, 3 * ppm, 0, 0, Math.PI * 2); ctx.fill();
      }
      const key = n.kind === 'car' && n.cab ? 'cab' : n.kind + '.' + n.variant;
      let rot = Math.atan2(n.vx || 0, n.dir * Math.max(n.v, 2));
      if (n.dir > 0) rot = Math.max(-0.35, Math.min(0.35, rot));
      sprites.draw(ctx, key, X, Y, rot, ppm);
    }

    function drawPedestrian(pd, X, Y) {
      let rot;
      if (Math.abs(pd.vx) + Math.abs(pd.vy) > 0.1) rot = Math.atan2(pd.vx, pd.vy);
      else rot = pd.dir > 0 ? 0 : Math.PI;
      if (pd.mode === 'stumble') rot += Math.sin(time * 18) * 0.6;
      const bob = pd.mode === 'walk' || pd.mode === 'cross' ? Math.sin(time * 9 + pd.id) * 0.04 : 0;
      sprites.draw(ctx, 'ped.' + pd.variant, X, Y, rot + bob, ppm);
      if (pd.splash > 0) {
        ctx.fillStyle = 'rgba(120,180,230,0.8)';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(X + (i - 1) * 0.18 * ppm, Y - 0.35 * ppm - ((time * 3 + i * 0.3) % 1) * 0.3 * ppm, 0.05 * ppm, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    function drawPlayer(p, X, Y) {
      if (p.invuln > 0 && Math.floor(time * 10) % 2 === 0) ctx.globalAlpha = 0.35;
      ctx.fillStyle = 'rgba(34,229,255,0.16)';
      ctx.beginPath(); ctx.ellipse(X, Y, 0.75 * ppm, 1.25 * ppm, 0, 0, Math.PI * 2); ctx.fill();
      let rot = Math.atan2(p.steer * Math.min(T.LAT_MAX, T.LAT_BASE + T.LAT_PER_SPEED * p.v), Math.max(p.v, 2)) * 0.7;
      if (p.wobble > 0) rot += Math.sin(time * 38) * 0.1;
      if (p.crash > 0) rot = (1 - p.crash / T.CRASH_TIME) * 1.5 * (p.crashWith === 'headOn' ? -1 : 1) + 0.2;
      sprites.draw(ctx, 'player', X, Y, rot, ppm);
      ctx.globalAlpha = 1;
    }

    // --- effects ---------------------------------------------------------------
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
        const k = P.kind[i];
        ctx.globalAlpha = Math.min(1, (P.life[i] / P.max[i]) * 1.6);
        ctx.fillStyle = PCOL[k];
        const s = Math.max(1.5, P.size[i] * ppm);
        ctx.fillRect(sx(P.x[i]) - s / 2, sy(P.y[i] + P.z[i]) - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }

    function drawRain(dt) {
      ctx.fillStyle = 'rgba(30,42,60,0.16)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(200,215,235,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 160; i++) {
        const j = i * 3;
        rain[j + 1] += rain[j + 2] * dt * 1.6;
        if (rain[j + 1] > 1) { rain[j + 1] -= 1; rain[j] = Math.random(); }
        const x = rain[j] * W;
        const y = rain[j + 1] * H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 14 * rain[j + 2]);
      }
      ctx.stroke();
    }

    function addSplat() {
      for (let i = 0; i < 14; i++) {
        splat.push({ x: W * (0.1 + Math.random() * 0.8), y: H * (0.3 + Math.random() * 0.65), r: 18 + Math.random() * 46, t: 1.5, max: 1.5 });
      }
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

    function bubble(kind, id, text) {
      for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].kind === kind && bubbles[i].id === id) bubbles.splice(i, 1);
      if (bubbles.length >= 4) bubbles.shift();
      bubbles.push({ kind, id, text, t: 1.6 });
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
        const ref = findRef(st, b.kind, b.id);
        if (b.t <= 0 || !ref) { bubbles.splice(i, 1); continue; }
        const X = sx(interp.x(ref, alpha));
        const Y = sy(interp.y(ref, alpha)) - ((ref.l || 0.5) / 2) * ppm - 22;
        const w = ctx.measureText(b.text).width + 16;
        ctx.globalAlpha = Math.min(1, b.t * 3);
        ctx.fillStyle = '#fffdf6';
        SP.roundRect(ctx, X - w / 2, Y - 13, w, 26, 9); ctx.fill();
        ctx.beginPath(); ctx.moveTo(X - 6, Y + 12); ctx.lineTo(X, Y + 20); ctx.lineTo(X + 6, Y + 12); ctx.fill();
        ctx.fillStyle = '#1b1b1b';
        ctx.fillText(b.text, X, Y + 1);
        ctx.globalAlpha = 1;
      }
    }

    function chevron(X, Y, down, size) {
      ctx.beginPath();
      if (down) { ctx.moveTo(X - size, Y - size * 0.6); ctx.lineTo(X, Y + size * 0.6); ctx.lineTo(X + size, Y - size * 0.6); }
      else { ctx.moveTo(X - size, Y + size * 0.6); ctx.lineTo(X, Y - size * 0.6); ctx.lineTo(X + size, Y + size * 0.6); }
      ctx.closePath();
      ctx.fill();
    }

    function drawTelegraphs(st, hudOn) {
      const p = st.players[0];
      const top = cam.top();
      const bottom = cam.bottom();
      const edge = hudOn ? HUD_H + 10 : 10;
      for (const n of st.npcs) {
        if (n.ws && n.warned && n.y - n.l / 2 > top) {
          const tt = (n.y - n.l / 2 - top) / Math.max(1, n.v + p.v);
          if (tt > 2.4) continue;
          const X = sx(n.x);
          const pulse = 0.65 + 0.35 * Math.sin(time * 14);
          const g = ctx.createRadialGradient(X, edge, 2, X, edge, 46);
          g.addColorStop(0, 'rgba(255,240,170,' + (0.85 * pulse).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(255,240,170,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(X, edge, 46, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff5a3c';
          chevron(X, edge + 16, true, 11);
          ctx.fillStyle = '#ffffff';
          chevron(X, edge + 14, true, 6);
        } else if (n.dir > 0 && !n.ws && n.kind !== 'cow' && n.y + n.l / 2 < bottom && n.y > bottom - 30 && n.v > p.v + 0.5) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          chevron(sx(n.x), H - 14, false, 9);
        }
      }
    }

    // --- HUD -------------------------------------------------------------------
    function bar(x, y, w, h, frac, color, label) {
      ctx.fillStyle = PAL.hudDim;
      ctx.font = '700 14px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + h / 2);
      const lw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + lw, y, w - lw, h);
      ctx.fillStyle = frac < 0.3 ? PAL.late : color;
      ctx.fillRect(x + lw, y, (w - lw) * Math.max(0, Math.min(1, frac)), h);
    }

    function drawHud(st, L) {
      const p = st.players[0];
      ctx.fillStyle = PAL.hudBg;
      ctx.fillRect(0, 0, W, HUD_H);
      ctx.textBaseline = 'middle';
      ctx.font = '700 17px ' + FONT;
      ctx.textAlign = 'left';
      const late = st.time > st.deadline;
      ctx.fillStyle = late ? PAL.late : PAL.hudText;
      ctx.fillText(World.fmtClock(st.time) + ' / ' + World.fmtClock(st.deadline), 12, 17);
      ctx.fillStyle = PAL.hudText;
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(p.v * 3.6) + ' km/h', W - 60, 17);
      const half = (W - 36) / 2;
      bar(12, 32, half, 10, p.condition / 100, PAL.cond, 'BIKE');
      bar(24 + half, 32, half, 10, p.karma / 100, PAL.karma, 'KARMA');
      const x0 = 12;
      const x1 = W - 12;
      const yb = 56;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x0, yb, x1 - x0, 4);
      const frac = Math.max(0, Math.min(1, p.y / L.length));
      ctx.fillStyle = '#62d26f';
      ctx.fillRect(x0, yb, (x1 - x0) * frac, 4);
      ctx.fillStyle = PAL.hudText;
      for (const m of L.landmarks) ctx.fillRect(x0 + (x1 - x0) * (m.at / L.length) - 1, yb - 3, 2, 10);
      ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * frac, yb + 2, 5, 0, Math.PI * 2); ctx.fillStyle = '#22e5ff'; ctx.fill();
    }

    // ---------------------------------------------------------------------------
    function draw(st, alpha, interp, dt, opts) {
      time += dt;
      const L = World.level(st.levelId);
      const p = st.players[0];
      const px = interp.x(p, alpha);
      const py = interp.y(p, alpha);
      const s = World.segmentAt(L, py);
      cam.update(dt, px, py, p.v / T.MAX_SPEED, s.xs.wallL - 5, s.xs.wallR + 5);
      ppm = cam.ppm;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGround(st, L);
      drawHazards(st);
      drawBarricades(L);
      drawDestinations(st, L);
      drawEntities(st, alpha, interp);
      drawParticles(dt);
      if (st.weather === 'rain') drawRain(dt);
      drawBubbles(st, dt, alpha, interp);
      drawTelegraphs(st, opts && opts.hud);
      drawSplat(dt);
      if (opts && opts.hud) GameHud.draw(ctx, st, W, { speed: true });
      if (opts && opts.hud && opts.touch) GameHud.drawHandle(ctx, W, H, opts.touch, opts.touchHint, time);
    }

    function onEvents(ev, st) {
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        switch (e.type) {
          case 'splash': burst(e.x, e.y, 6 + Math.round((e.size || 0.5) * 12), 0, 3, 0.6, 0.12, 2.5); break;
          case 'pedSplashed': bubble('ped', e.pedId, e.byPlayer ? 'Ayyo! My clothes!' : 'Ayyo!'); break;
          case 'pothole':
            burst(e.x, e.y, 10, 2, 2, 0.5, 0.1, 2);
            burst(e.x, e.y, 6, 1, 1.5, 0.8, 0.18, 1);
            cam.shake(0.35 + e.speed / 30);
            if (e.hidden) bubble('player', e.pid, 'Hidden pothole!');
            break;
          case 'bump':
            if (e.kind === 'scrape') burst(e.x, e.y + 0.9, 3, 3, 1.5, 0.3, 0.08, 0.5);
            else { burst(e.x, e.y, 4, 1, 1.2, 0.6, 0.15, 0.8); cam.shake(e.kind === 'breaker' && e.hard ? 0.35 : 0.15); }
            break;
          case 'crash': {
            burst(e.x, e.y + 0.6, 12, 3, 4, 0.5, 0.09, 2);
            burst(e.x, e.y, 8, 1, 2, 0.9, 0.2, 1);
            cam.shake(0.8);
            const lines = { vehicle: 'Enu guru?!', headOn: 'Wrong side, sir!', cow: 'Mooo.', barricade: 'Metro work, no?', ped: 'Ayyo! Watch it!' };
            if (e.with === 'ped') bubble('ped', e.id, lines.ped);
            else if (e.with === 'barricade') bubble('player', e.pid, lines.barricade);
            else bubble('npc', e.id, lines[e.with]);
            break;
          }
          case 'screenSplash': addSplat(); break;
          case 'honkNpc': if (e.atPlayer) bubble('npc', e.id, 'Swalpa adjust maadi'); break;
          case 'npcYield': if (Math.random() < 0.5) bubble('npc', e.id, 'Sari, sari'); break;
          default: break;
        }
      }
    }

    function reset() {
      P.clear();
      bubbles.length = 0;
      splat.length = 0;
      cam.snapped = false;
      cam.trauma = 0;
    }

    resize();
    return {
      cam,
      resize,
      draw,
      onEvents,
      reset,
      /** Cap the device pixel ratio (auto quality on slow phones). */
      setMaxDpr(v) { if (v !== maxDpr) { maxDpr = v; resize(); } },
      setReduceShake(v) { cam.reduceShake = !!v; },
      /** World x under a canvas-relative CSS x (for follow-the-finger steering). */
      worldX(cssX) { return cam.wx(cssX); },
    };
  }

  root.GameRenderTop = { create, HUD_H };
})(window);
