# Kit.Synth: Web Audio synthesiser for asset-free games

## Purpose
Every sound built at runtime from oscillators and one shared white-noise
buffer: no audio files, no payload. Safe to call anywhere: it is a no-op until
unlocked and when Web Audio is missing (Node, old browsers).

## API
```js
const synth = Kit.Synth.create({ volume: 0.8, muted: false });
button.addEventListener('pointerdown', () => synth.unlock());  // must be inside a user gesture
synth.tone({ type: 'square', freq: 415, freqEnd, dur: 0.2, gain: 0.06, attack, release, delay, pan, detune, filter: { type, freq, Q } });
synth.noise({ dur: 0.3, gain: 0.2, rate, delay, pan, filter: { type: 'bandpass', freq: 1400, freqEnd: 450, Q: 0.8 } });
const loop = synth.loop({ kind: 'osc' | 'noise', type: 'triangle', freq: 220, gain: 0, filter, pan }); // safe before unlock
loop.set({ freq, gain, filterFreq }, smoothing); loop.stop();
synth.setMuted(true); synth.suspend(); synth.resume();
synth.ready; synth.muted; synth.ctx;
```

## Invariants
- Signal chain: source → optional BiquadFilter → optional StereoPanner →
  envelope gain → master gain → compressor (threshold −12 dB, 4:1) → out.
- Envelopes use exponential ramps from 0.0001, so there are no clicks.
- One-shot nodes stop themselves; loops persist until `stop()`.
- Loops created before `unlock()` are built when the context appears.

## Recipes used by Namma Commute (`client/audio.js`)
| Sound | Recipe |
|---|---|
| EV motor | triangle loop 180–700 Hz through a bandpass, gain rises with speed; plus a low-passed noise loop for tyre hiss |
| Player horn | two square tones, 415 + 523 Hz, 0.2 s, lowpass 2.4 kHz |
| NPC horns | bike: square ~650 Hz 0.14 s; auto: square 560 Hz double beep; car: 330 + 415 Hz; bus/tanker: sawtooth 196 + 247 Hz 0.45 s; panned by x |
| Splash | noise, bandpass 1400 → 450 Hz, 0.2–0.45 s |
| Pothole thud | noise lowpass 260 Hz + sine 95 → 38 Hz |
| Crash | noise lowpass 900 → 200 Hz + square 150 → 55 Hz |
| Wrong-side warning | sine 1320 Hz, 70 ms, twice |
| Good luck / deed | rising sines 660–880–1320 Hz / single 990 Hz |
| Bad luck | square 330 → 180 Hz |
| Argument | three short low sawtooth grumbles |
| Puncture | high-passed noise 0.9 s |
| Rain | noise loop, bandpass 2.6 kHz |

## Tests
`kit/synth/synth.test.js`: everything is a safe no-op without Web Audio.

## Rebuild prompt
> UMD `Kit.Synth.create({volume, muted})`. Lazily create an AudioContext in
> `unlock()` (also resume if suspended), with master gain → dynamics
> compressor → destination. `tone` and `noise` build a source, optional
> biquad, optional stereo panner, an exponential envelope gain, and stop
> themselves. `loop` returns a retunable source whose nodes are (re)built on
> unlock. A 2 s mono white-noise buffer is shared. All methods no-op when not
> ready or muted.

## Evolving
Add a `voice()` helper (formant filters over a sawtooth) for gibberish
"Ayyo!" barks; keep it here so other games can reuse it.
