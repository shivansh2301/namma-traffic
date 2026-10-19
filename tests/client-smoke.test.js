'use strict';
// Headless smoke test of the browser client: loads every script from
// client/index.html into a fake DOM + no-op canvas, plays each level for a
// while, clicks through the screens, and fails on any thrown error.
// It cannot judge visuals; it catches crashes, typos and missing globals.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function fakeCtx() {
  const props = {};
  const noop = () => {};
  const special = {
    measureText: () => ({ width: 40 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return new Proxy({}, {
    get: (t, k) => (k in special ? special[k] : k in props ? props[k] : noop),
    set: (t, k, v) => { props[k] = v; return true; },
  });
}

function fakeElement(id) {
  const listeners = {};
  const el = {
    id, hidden: false, textContent: '', innerHTML: '', disabled: false, className: '', style: {}, children: [],
    width: 300, height: 150,
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatch(t, e) { for (const f of listeners[t] || []) f(Object.assign({ preventDefault() {}, stopPropagation() {}, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, target: el }, e)); },
    setAttribute() {}, getAttribute: () => null, focus() {}, blur() {},
    querySelector: () => null,
    appendChild(c) { el.children.push(c); return c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640, right: 360, bottom: 640 }),
    getContext: () => fakeCtx(),
    setPointerCapture() {}, releasePointerCapture() {},
  };
  return el;
}

function makeEnv(search, opts) {
  opts = opts || {};
  const els = {};
  const winListeners = {};
  let rafCb = null;
  let now = 0;
  const document = {
    hidden: false, readyState: 'complete', activeElement: null,
    getElementById: (id) => (els[id] = els[id] || fakeElement(id)),
    createElement: (tag) => fakeElement(tag),
    querySelectorAll: (sel) => (sel === '.settings' ? [els['settings-a'] || (els['settings-a'] = fakeElement('settings-a'))] : []),
    addEventListener() {},
  };
  const ctx = {
    console, Math, JSON, Date, Map, Set, Proxy, Promise, URLSearchParams, Float32Array, Uint8Array, Uint8ClampedArray, Array, Object, Number, String, Symbol, Error,
    document,
    devicePixelRatio: 2,
    location: { search: search || '', hostname: 'localhost', protocol: 'http:' },
    navigator: { vibrate: () => true },
    performance: { now: () => now },
    matchMedia: (q) => ({ matches: !!opts.touch && q.includes('coarse') }),
    requestAnimationFrame: (f) => { rafCb = f; return 1; },
    addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener() {},
    OffscreenCanvas: class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fakeCtx(); } },
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => path.join(root, 'client', m[1]));
  for (const f of scripts) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  return {
    ctx, els,
    frames(n, ms) { for (let i = 0; i < n; i++) { now += ms || 16.7; const f = rafCb; rafCb = null; if (f) f(now); } },
    key(type, code) { for (const f of winListeners[type] || []) f({ code, target: null, preventDefault() {} }); },
    click(id) { els[id].dispatch('click', {}); },
  };
}

test('touch only: drag steers, the BRAKE button slows, buttons show on phones', () => {
  const env = makeEnv('?level=1&seed=4&debug', { touch: true });
  env.frames(60);
  assert.equal(env.els.touch.hidden, false, 'touch buttons visible during play');
  const g = env.ctx.__game;
  const x0 = g.state().players[0].x;
  env.els.game.dispatch('pointerdown', { clientX: 150, clientY: 500, pointerId: 1, pointerType: 'touch' });
  env.els.game.dispatch('pointermove', { clientX: 260, clientY: 500, pointerId: 1, pointerType: 'touch' });
  env.frames(30);
  const x1 = g.state().players[0].x;
  assert.ok(x1 > x0 + 0.5, 'dragging right steers right: ' + x0.toFixed(2) + ' -> ' + x1.toFixed(2));
  env.els.game.dispatch('pointerup', { pointerId: 1, pointerType: 'touch' });
  env.frames(10);
  const v0 = g.state().players[0].v;
  env.els['btn-brake'].dispatch('pointerdown', { pointerId: 2, pointerType: 'touch' });
  env.frames(20);
  assert.ok(g.state().players[0].v < v0 - 1, 'holding BRAKE slows down');
  env.els['btn-brake'].dispatch('pointerup', { pointerId: 2, pointerType: 'touch' });
  env.els['btn-pause'].dispatch('click', {});
  assert.equal(env.els['scr-pause'].hidden, false, 'pause button works');
});

test('touch phones get touch instructions on the title screen', () => {
  const env = makeEnv('', { touch: true });
  env.frames(5);
  assert.ok(env.els['title-controls'].textContent.startsWith('Touch'));
});

test('client boots to the title screen and runs the attract demo', () => {
  const env = makeEnv('');
  env.frames(600);
  assert.equal(env.els['scr-title'].hidden, false);
});

for (const level of [1, 2, 3]) {
  test(`client plays level ${level} for 40 s with keyboard input, pause and resume`, () => {
    const env = makeEnv(`?level=${level}&seed=7&debug`);
    env.key('keydown', 'ArrowRight');
    env.frames(120);
    env.key('keyup', 'ArrowRight');
    env.key('keydown', 'Space');
    env.frames(30);
    env.key('keyup', 'Space');
    env.key('keydown', 'KeyP');
    env.frames(5);
    assert.equal(env.els['scr-pause'].hidden, false, 'paused');
    env.key('keyup', 'KeyP');
    env.click('b-resume');
    env.frames(60 * 40);
    assert.equal(env.els['scr-pause'].hidden, true);
  });
}

test('client plays a delivery shift for 40 s (both views)', () => {
  for (const view of ['first', 'top']) {
    const env = makeEnv('?level=6&seed=3&view=' + view);
    env.frames(60 * 40);
    assert.equal(env.els['scr-pause'].hidden, true);
  }
});

test('client mode screen leads to the delivery shifts', () => {
  const env = makeEnv('');
  env.frames(5);
  env.click('b-play');
  assert.equal(env.els['scr-mode'].hidden, false);
  env.click('b-mode-delivery');
  assert.equal(env.els['scr-levels'].hidden, false);
  assert.equal(env.els['level-list'].children.length, 3);
  env.els['level-list'].children[0].dispatch('click', {});
  assert.equal(env.els['scr-brief'].hidden, false);
  assert.equal(env.els['brief-orders'].hidden, false);
});

test('client runs the top-down map view', () => {
  const env = makeEnv('?level=3&seed=2&view=top');
  env.frames(60 * 20);
  assert.equal(env.els['scr-pause'].hidden, true);
});

test('client walks the screens: title -> levels -> brief -> ride -> quit', () => {
  const env = makeEnv('');
  env.frames(10);
  env.click('b-play');
  assert.equal(env.els['scr-mode'].hidden, false);
  env.click('b-mode-commute');
  assert.equal(env.els['scr-levels'].hidden, false);
  const list = env.els['level-list'];
  assert.equal(list.children.length, 3);
  list.children[0].dispatch('click', {});
  assert.equal(env.els['scr-brief'].hidden, false);
  env.click('b-ride');
  env.frames(300);
  env.click('btn-pause');
  env.click('b-quit');
  assert.equal(env.els['scr-levels'].hidden, false);
});

test('client finishes a run and shows the result screen', () => {
  const env = makeEnv('?level=1&seed=3');
  // Hand the controls to the bot so the run ends.
  const { Sim, Bot } = env.ctx;
  env.frames(2);
  env.frames(1);
  // Drive the bot directly against the client's state through the debug hook-free path:
  // keep pressing nothing; the auto-throttle plus the long timeout ends the run by breakdown or arrival.
  for (let i = 0; i < 60 * 400 && env.els['scr-result'].hidden; i++) env.frames(1);
  assert.ok(Sim && Bot);
  assert.equal(env.els['scr-result'].hidden, false, 'result screen shown');
  assert.ok(env.els['res-title'].textContent.length > 0);
});
