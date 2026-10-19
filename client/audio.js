/*
 * client/audio.js: every sound in the game, synthesised with kit/synth.
 * The Yolo is electric: a motor whine plus tyre hiss instead of an engine.
 * Motor, tyres and rain are continuous loops; everything else reacts to sim events.
 */
(function (root) {
  'use strict';
  const { T } = World;

  function create(synth) {
    let engine = null;
    let engineSub = null;
    let rain = null;

    function loops() {
      if (engine) return;
      engine = synth.loop({ kind: 'osc', type: 'triangle', freq: 220, gain: 0, filter: { type: 'bandpass', freq: 900, Q: 2 } });
      engineSub = synth.loop({ kind: 'noise', gain: 0, filter: { type: 'lowpass', freq: 500 } });
      rain = synth.loop({ kind: 'noise', gain: 0, filter: { type: 'bandpass', freq: 2600, Q: 0.4 } });
    }

    const pan = (e, p) => (e.x != null && p ? Math.max(-1, Math.min(1, (e.x - p.x) / 8)) : 0);

    const sfx = {
      horn() {
        synth.tone({ type: 'square', freq: 415, dur: 0.2, gain: 0.06, filter: { type: 'lowpass', freq: 2400 } });
        synth.tone({ type: 'square', freq: 523, dur: 0.2, gain: 0.05, filter: { type: 'lowpass', freq: 2400 } });
      },
      npcHorn(kind, pn) {
        const g = 0.025;
        if (kind === 'bus' || kind === 'tanker') {
          synth.tone({ type: 'sawtooth', freq: 196, dur: 0.45, gain: g, pan: pn, filter: { type: 'lowpass', freq: 1200 } });
          synth.tone({ type: 'sawtooth', freq: 247, dur: 0.45, gain: g, pan: pn, filter: { type: 'lowpass', freq: 1200 } });
        } else if (kind === 'car') {
          synth.tone({ type: 'square', freq: 330, dur: 0.25, gain: g, pan: pn, filter: { type: 'lowpass', freq: 1800 } });
          synth.tone({ type: 'square', freq: 415, dur: 0.25, gain: g, pan: pn, filter: { type: 'lowpass', freq: 1800 } });
        } else if (kind === 'auto') {
          synth.tone({ type: 'square', freq: 560, dur: 0.1, gain: g, pan: pn, filter: { type: 'lowpass', freq: 2200 } });
          synth.tone({ type: 'square', freq: 560, dur: 0.1, gain: g, pan: pn, delay: 0.16, filter: { type: 'lowpass', freq: 2200 } });
        } else {
          synth.tone({ type: 'square', freq: 640 + Math.random() * 120, dur: 0.14, gain: g, pan: pn, filter: { type: 'lowpass', freq: 2600 } });
        }
      },
      splash(size, pn) {
        synth.noise({ dur: 0.18 + size * 0.25, gain: 0.12 + size * 0.2, pan: pn, filter: { type: 'bandpass', freq: 1400, freqEnd: 450, Q: 0.8 } });
      },
      thud(strength) {
        synth.noise({ dur: 0.16, gain: 0.25 + strength * 0.25, filter: { type: 'lowpass', freq: 260 } });
        synth.tone({ type: 'sine', freq: 95, freqEnd: 38, dur: 0.22, gain: 0.25 + strength * 0.2 });
      },
      bump() {
        synth.noise({ dur: 0.07, gain: 0.14, filter: { type: 'lowpass', freq: 420 } });
      },
      scrape() {
        synth.noise({ dur: 0.12, gain: 0.07, filter: { type: 'highpass', freq: 1800 } });
      },
      crash() {
        synth.noise({ dur: 0.45, gain: 0.45, filter: { type: 'lowpass', freq: 900, freqEnd: 200 } });
        synth.tone({ type: 'square', freq: 150, freqEnd: 55, dur: 0.28, gain: 0.08, filter: { type: 'lowpass', freq: 900 } });
      },
      warn() {
        synth.tone({ type: 'sine', freq: 1320, dur: 0.07, gain: 0.1 });
        synth.tone({ type: 'sine', freq: 1320, dur: 0.07, gain: 0.1, delay: 0.13 });
      },
      arrive() {
        [523, 659, 784, 1047].forEach((f, i) => synth.tone({ type: 'triangle', freq: f, dur: 0.16, gain: 0.09, delay: i * 0.11 }));
      },
      breakdown() {
        synth.tone({ type: 'sawtooth', freq: 300, freqEnd: 90, dur: 0.8, gain: 0.07, filter: { type: 'lowpass', freq: 900 } });
      },
      good() {
        [660, 880, 1320].forEach((fq, i) => synth.tone({ type: 'sine', freq: fq, dur: 0.12, gain: 0.07, delay: i * 0.08 }));
      },
      bad() {
        synth.tone({ type: 'square', freq: 330, freqEnd: 180, dur: 0.35, gain: 0.05, filter: { type: 'lowpass', freq: 1200 } });
      },
      deed() {
        synth.tone({ type: 'sine', freq: 990, dur: 0.12, gain: 0.06 });
      },
      grumble() {
        for (let i = 0; i < 3; i++) synth.tone({ type: 'sawtooth', freq: 140 + Math.random() * 60, dur: 0.14, gain: 0.035, delay: i * 0.16, filter: { type: 'lowpass', freq: 700 } });
      },
      hiss() {
        synth.noise({ dur: 0.9, gain: 0.12, filter: { type: 'highpass', freq: 3000 } });
      },
      bark(pn) {
        for (let i = 0; i < 2; i++) synth.tone({ type: 'sawtooth', freq: 520, freqEnd: 260, dur: 0.09, gain: 0.06, pan: pn, delay: i * 0.18, filter: { type: 'bandpass', freq: 900, Q: 1.2 } });
      },
      yelp() {
        synth.tone({ type: 'sawtooth', freq: 900, freqEnd: 1400, dur: 0.18, gain: 0.06, filter: { type: 'bandpass', freq: 1200, Q: 1 } });
      },
      whoosh(pn) {
        synth.noise({ dur: 0.35, gain: 0.08, pan: pn, filter: { type: 'bandpass', freq: 600, freqEnd: 1800, Q: 0.7 } });
      },
      ping() { // app notification
        synth.tone({ type: 'sine', freq: 1046, dur: 0.08, gain: 0.07 });
        synth.tone({ type: 'sine', freq: 1568, dur: 0.12, gain: 0.06, delay: 0.09 });
      },
      doorbell() {
        synth.tone({ type: 'triangle', freq: 659, dur: 0.35, gain: 0.08 });
        synth.tone({ type: 'triangle', freq: 523, dur: 0.5, gain: 0.08, delay: 0.32 });
      },
      coins() {
        for (let i = 0; i < 4; i++) synth.tone({ type: 'square', freq: 1800 + i * 220, dur: 0.05, gain: 0.03, delay: 0.5 + i * 0.06, filter: { type: 'lowpass', freq: 4000 } });
      },
      ringtone() {
        for (let i = 0; i < 2; i++) { synth.tone({ type: 'square', freq: 880, dur: 0.12, gain: 0.04, delay: i * 0.4 }); synth.tone({ type: 'square', freq: 740, dur: 0.12, gain: 0.04, delay: i * 0.4 + 0.14 }); }
      },
      click() {
        synth.tone({ type: 'sine', freq: 880, dur: 0.04, gain: 0.04 });
      },
    };

    return {
      sfx,
      /** Call every frame. active = a run is being played (not paused or in menus). */
      update(st, active) {
        loops();
        if (!st || !active) {
          engine.set({ gain: 0 }, 0.08);
          engineSub.set({ gain: 0 }, 0.08);
          rain.set({ gain: 0 }, 0.2);
          return;
        }
        const p = st.players[0];
        const f = p.v / T.MAX_SPEED;
        const on = p.crash > 0 ? 0 : 1;
        engine.set({ freq: 180 + 520 * f + (p.wobble > 0 ? 20 : 0), gain: on * (0.006 + 0.014 * f), filterFreq: 500 + 1400 * f });
        engineSub.set({ gain: on * 0.03 * f, filterFreq: 300 + 600 * f });
        rain.set({ gain: st.weather === 'rain' ? 0.045 : 0 }, 0.3);
      },
      onEvents(ev, st) {
        const p = st.players[0];
        for (let i = 0; i < ev.length; i++) {
          const e = ev[i];
          switch (e.type) {
            case 'horn': sfx.horn(); break;
            case 'honkNpc': if (Math.random() < (e.atPlayer ? 1 : 0.7)) sfx.npcHorn(e.kind, pan(e, p)); break;
            case 'splash': if (Math.abs(e.y - p.y) < 25) sfx.splash(e.size || 0.5, pan(e, p)); break;
            case 'screenSplash': sfx.splash(1, 0); break;
            case 'pothole': sfx.thud(Math.min(1, e.speed / T.MAX_SPEED)); break;
            case 'bump': if (e.kind === 'scrape') sfx.scrape(); else if (e.kind === 'breaker' && e.hard) sfx.thud(0.5); else sfx.bump(); break;
            case 'crash': sfx.crash(); break;
            case 'wrongSide': sfx.warn(); break;
            case 'arrive': case 'shiftDone': sfx.arrive(); break;
            case 'handover': sfx.ping(); break;
            case 'handStep': if (/bell|door/.test(e.step)) sfx.doorbell(); else sfx.ping(); break;
            case 'bark': case 'dogChase': if (Math.abs(e.y - p.y) < 25) sfx.bark(pan(e, p)); break;
            case 'dogBite': sfx.yelp(); break;
            case 'dogScared': sfx.yelp(); break;
            case 'bikePass': sfx.whoosh(pan(e, p)); break;
            case 'gaali': sfx.grumble(); break;
            case 'delivered': sfx.doorbell(); if (e.tip) sfx.coins(); break;
            case 'missed': sfx.ringtone(); break;
            case 'breakdown': sfx.breakdown(); break;
            case 'luck': if (e.kind === 'puncture') sfx.hiss(); if (e.good) sfx.good(); else sfx.bad(); break;
            case 'goodDeed': sfx.deed(); break;
            case 'fight': if (e.phase === 'start' || e.phase === 'shouted') sfx.grumble(); break;
            case 'npcArgue': if (Math.abs(e.y - p.y) < 30) sfx.grumble(); break;
            default: break;
          }
        }
      },
    };
  }

  root.GameAudio = { create };
})(window);
