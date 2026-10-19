#!/usr/bin/env node
/*
 * Render real frames of the game to PNG without a browser, for checking the
 * art (and for agents, who cannot open a browser). Uses @napi-rs/canvas,
 * installed locally:  npm install --prefix .tools/canvas @napi-rs/canvas
 *
 *   node tools/snapshot.js <level> <seed> <seconds> <out.png> [view=chase|first|top] [width] [height]
 * Append "+touch" to the view (e.g. chase+touch) to draw the phone's left-handle control,
 * held at the bot's current steer.
 *
 * Plays the level with the bot for <seconds>, then draws one frame with the
 * HUD. Loads the same scripts as client/index.html into a fake window.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
let napi;
try {
  napi = require(path.join(root, '.tools/canvas/node_modules/@napi-rs/canvas'));
} catch (e) {
  console.error('Missing @napi-rs/canvas. Install: npm install --prefix .tools/canvas @napi-rs/canvas');
  process.exit(1);
}

// Fonts: register DejaVu (npm install --prefix .tools/canvas dejavu-fonts-ttf) under the names the game asks for.
try {
  const dir = path.join(root, '.tools/canvas/node_modules/dejavu-fonts-ttf/ttf');
  for (const alias of ['system-ui', 'Roboto', 'sans-serif']) {
    napi.GlobalFonts.registerFromPath(path.join(dir, 'DejaVuSans.ttf'), alias);
    napi.GlobalFonts.registerFromPath(path.join(dir, 'DejaVuSans-Bold.ttf'), alias);
  }
} catch (_) { /* text will be missing from snapshots */ }

const [levelId = '1', seed = '1', seconds = '20', out = '.work/snap.png', viewArg = 'chase', w = '390', h = '780'] = process.argv.slice(2);
const [view, extra] = viewArg.split('+');
const W = +w;
const H = +h;
const canvas = napi.createCanvas(W, H);
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });

const ctx = {
  console, Math, JSON, Map, Set, Float32Array, Float64Array, Uint8Array, Array, Object, Number, String, Symbol, Error, Date, Promise, URLSearchParams,
  devicePixelRatio: 1,
  OffscreenCanvas: class { constructor(cw, ch) { return napi.createCanvas(cw, ch); } },
  location: { search: '', hostname: 'localhost', protocol: 'http:' },
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
const files = [
  'kit/rng/rng.js', 'kit/fixed-step/fixed-step.js', 'kit/camera/camera.js', 'kit/sprites/sprites.js', 'kit/particles/particles.js',
  'shared/world.js', 'shared/sim.js', 'shared/bot.js', 'client/hud.js', 'client/render.js', 'client/render-top.js',
];
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

const { Sim, Bot, Kit, GameRender, GameRenderTop } = ctx;
const R = (view === 'top' ? GameRenderTop : GameRender).create(canvas);
if (R.setCamMode) R.setCamMode(view === 'first' ? 'cockpit' : 'chase');
const interp = Kit.FixedStep.createInterp();
const st = Sim.create(+levelId, +seed, { skill: 0 });
const mem = Bot.create();
const ticks = Math.round(+seconds * 30);
let inp = { steer: 0, brake: 0, horn: 0 };
for (let t = 0; t < ticks && !Sim.result(st); t++) {
  interp.begin(); interp.add(st.players); interp.add(st.npcs); interp.add(st.peds);
  inp = Bot.act(st, mem);
  const ev = Sim.step(st, inp);
  R.onEvents(ev, st);
  if (t > ticks - 40) R.draw(st, 1, interp, 1 / 30, { hud: true, brake: inp.brake });
}
const touch = extra === 'touch' ? { active: inp.steer !== 0, value: inp.steer, travel: Math.max(44, Math.min(70, Math.floor((W - 216) / 2))) } : null;
R.draw(st, 1, interp, 1 / 30, { hud: true, brake: inp.brake, touch, touchHint: !!touch && !touch.active });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, canvas.toBuffer('image/png'));
const p = st.players[0];
console.log(`wrote ${out}  level ${levelId} seed ${seed} t=${seconds}s  y=${p.y.toFixed(0)} x=${p.x.toFixed(2)} v=${(p.v * 3.6).toFixed(0)}km/h karma=${p.karma.toFixed(0)}`);
