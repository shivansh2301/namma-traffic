/*
 * Kit.Synth: tiny Web Audio synthesiser for games with no audio files.
 *
 *   const synth = Kit.Synth.create({ volume: 0.8 });
 *   button.onclick = () => synth.unlock();           // must run inside a user gesture
 *   synth.tone({ type: 'square', freq: 440, dur: 0.2, gain: 0.2 });
 *   synth.noise({ dur: 0.3, gain: 0.3, filter: { type: 'lowpass', freq: 400 } });
 *   const eng = synth.loop({ type: 'sawtooth', freq: 60, gain: 0, filter: { type: 'lowpass', freq: 500 } });
 *   eng.set({ freq: 120, gain: 0.05 });
 *   synth.setMuted(true);
 *
 * Everything is a no-op until unlock() succeeds, and when Web Audio is
 * missing (Node, very old browsers). Sounds are built per call from
 * oscillators and one shared white-noise buffer; nodes clean themselves up.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Kit = root.Kit || {}).Synth = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(opts) {
    opts = opts || {};
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let muted = !!opts.muted;
    const volume = opts.volume != null ? opts.volume : 0.8;
    const loops = [];

    const synth = {
      get ctx() { return ctx; },
      get ready() { return !!ctx && ctx.state === 'running'; },
      get muted() { return muted; },
      get now() { return ctx ? ctx.currentTime : 0; },

      /** Create or resume the AudioContext. Call from a user gesture handler. */
      unlock() {
        if (!AC) return false;
        try {
          if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : volume;
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -12;
            comp.ratio.value = 4;
            master.connect(comp);
            comp.connect(ctx.destination);
            for (const l of loops) l._build();
          }
          if (ctx.state === 'suspended') ctx.resume();
          return true;
        } catch (_) {
          return false;
        }
      },

      setMuted(m) {
        muted = !!m;
        if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
      },

      /** Pause all audio processing, e.g. when the tab is hidden. */
      suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
      resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },

      /**
       * One-shot oscillator.
       * { type, freq, freqEnd, dur, gain, attack, release, delay, pan, detune, filter:{type,freq,Q} }
       */
      tone(o) {
        if (!synth.ready || muted) return;
        const t0 = ctx.currentTime + (o.delay || 0);
        const dur = o.dur || 0.2;
        const osc = ctx.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(o.freq || 440, t0);
        if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur);
        if (o.detune) osc.detune.value = o.detune;
        const out = envelope(t0, dur, o.gain != null ? o.gain : 0.2, o.attack || 0.005, o.release || 0.05);
        chain(osc, o.filter, out, o.pan);
        osc.start(t0);
        osc.stop(t0 + dur + (o.release || 0.05) + 0.02);
      },

      /** One-shot filtered noise burst. { dur, gain, attack, release, delay, pan, filter:{type,freq,freqEnd,Q} } */
      noise(o) {
        if (!synth.ready || muted) return;
        const t0 = ctx.currentTime + (o.delay || 0);
        const dur = o.dur || 0.2;
        const src = ctx.createBufferSource();
        src.buffer = getNoise();
        src.loop = true;
        src.playbackRate.value = o.rate || 1;
        const out = envelope(t0, dur, o.gain != null ? o.gain : 0.2, o.attack || 0.003, o.release || 0.08);
        const f = chain(src, o.filter, out, o.pan);
        if (f && o.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filter.freqEnd), t0 + dur);
        src.start(t0, Math.random() * 1.5);
        src.stop(t0 + dur + (o.release || 0.08) + 0.02);
      },

      /**
       * Continuous source you can retune: { kind:'osc'|'noise', type, freq, gain, filter, pan }.
       * Returns { set({freq, gain, filterFreq}, smoothing), stop() }. Safe to create before unlock().
       */
      loop(o) {
        const l = {
          o: Object.assign({ kind: 'osc', type: 'sawtooth', freq: 100, gain: 0 }, o),
          src: null, g: null, f: null,
          _build() {
            if (!ctx) return;
            const lo = l.o;
            if (lo.kind === 'noise') {
              l.src = ctx.createBufferSource();
              l.src.buffer = getNoise();
              l.src.loop = true;
            } else {
              l.src = ctx.createOscillator();
              l.src.type = lo.type;
              l.src.frequency.value = lo.freq;
            }
            l.g = ctx.createGain();
            l.g.gain.value = lo.gain;
            l.f = chain(l.src, lo.filter, l.g, lo.pan);
            l.g.connect(master);
            l.src.start();
          },
          set(p, smooth) {
            Object.assign(l.o, p);
            if (!ctx || !l.src) return;
            const t = ctx.currentTime;
            const k = smooth != null ? smooth : 0.05;
            if (p.gain != null) l.g.gain.setTargetAtTime(p.gain, t, k);
            if (p.freq != null && l.src.frequency) l.src.frequency.setTargetAtTime(p.freq, t, k);
            if (p.filterFreq != null && l.f) l.f.frequency.setTargetAtTime(p.filterFreq, t, k);
          },
          stop() {
            const i = loops.indexOf(l);
            if (i >= 0) loops.splice(i, 1);
            try { if (l.src) l.src.stop(); } catch (_) { /* already stopped */ }
            if (l.g) l.g.disconnect();
            l.src = l.g = l.f = null;
          },
        };
        loops.push(l);
        if (ctx) l._build();
        return l;
      },
    };

    function envelope(t0, dur, peak, attack, release) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + Math.max(attack, dur - release * 0.5));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
      g.connect(master);
      return g;
    }

    // src -> [filter] -> [panner] -> dest. Returns the filter node if any.
    function chain(src, filter, dest, pan) {
      let node = src;
      let f = null;
      if (filter) {
        f = ctx.createBiquadFilter();
        f.type = filter.type || 'lowpass';
        f.frequency.value = filter.freq || 1000;
        if (filter.Q != null) f.Q.value = filter.Q;
        node.connect(f);
        node = f;
      }
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        node.connect(p);
        node = p;
      }
      node.connect(dest);
      return f;
    }

    function getNoise() {
      if (noiseBuf) return noiseBuf;
      const len = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }

    return synth;
  }

  return { create };
});
