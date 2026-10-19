/*
 * client/main.js: game loop, screens, toasts, persistence, PWA registration.
 *
 * Screens: title -> mode (commute | delivery) -> levels -> play <-> pause -> result.
 * The title and level screens show the bot riding level 1 behind them.
 * Views: road view (render.js) behind the scooter (default) or from the seat, or top-down map (render-top.js).
 *
 * Persistence (kit/storage, keys under nc.):
 *   nc.settings  { muted, reduceShake, touchHintSeen, view, viewV }
 *   nc.progress  { levelId: { stars, bestScore, bestTime } }
 *   nc.rider     { xp, money, runs }  -> rider skill = World.skillLevel(xp)
 *
 * URL options: ?level=2&seed=123 (jump into a run), ?view=top, ?debug,
 * ?sw (register the service worker on localhost too), ?nosw.
 */
(function () {
  'use strict';
  const { T, DT } = World;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // --- persistence ---------------------------------------------------------------
  const store = Kit.Storage.create('nc.');
  const settings = store.get('settings', { muted: false, reduceShake: false, touchHintSeen: false, view: 'first', viewV: 3 });
  if (settings.viewV !== 3) { settings.view = 'first'; settings.viewV = 3; settings.touchHintSeen = false; } // from the seat is the default again; show the left-handle tutorial once
  delete settings.touchSteer; // "follow finger" steering was removed
  if (['chase', 'first', 'top'].includes(params.get('view'))) settings.view = params.get('view');
  const progress = store.get('progress', {});
  const rider = store.get('rider', { xp: 0, money: 0, runs: 0 });
  const saveSettings = () => store.set('settings', settings);

  // --- systems ---------------------------------------------------------------------
  const canvas = $('game');
  // Views: chase (camera behind you, default) and first (from the seat) share the 3D renderer.
  const views = { road: GameRender.create(canvas), top: GameRenderTop.create(canvas) };
  let R = views.road;
  function applyView() {
    if (settings.view === 'top') R = views.top;
    else { R = views.road; R.setCamMode(settings.view === 'first' ? 'cockpit' : 'chase'); }
    R.resize();
    R.reset();
  }
  applyView();
  for (const v of Object.values(views)) v.setReduceShake(settings.reduceShake);
  const synth = Kit.Synth.create({ muted: settings.muted, volume: 0.8 });
  const audio = GameAudio.create(synth);
  const interp = Kit.FixedStep.createInterp();
  let state = null; // the run being played
  let demo = null; // attract mode: { st, mem }
  let mode = 'title';
  let levelId = 1;
  let rideMode = 'commute';
  let seed = 0;
  let hintIdx = 0;
  let hintTimer = 0;
  let toastTimer = 0;
  let resultTimer = 0;
  let lastInput = { steer: 0, brake: 0, horn: 0 };

  const input = GameInput.create(canvas, { brake: $('btn-brake'), horn: $('btn-horn') });

  let isTouch = matchMedia('(pointer: coarse)').matches;
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !isTouch) { isTouch = true; $('touch').hidden = mode !== 'play'; renderAllSettings(); renderControlsHelp(); }
  }, { capture: true });

  const skill = () => World.skillLevel(rider.xp);

  // --- screens -----------------------------------------------------------------------
  const screens = ['title', 'mode', 'levels', 'pause', 'result'];
  function setMode(m) {
    mode = m;
    for (const s of screens) $('scr-' + s).hidden = s !== m;
    $('hud').hidden = !(m === 'play' || m === 'pause');
    $('touch').hidden = !(isTouch && m === 'play');
    if (m === 'play') {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } else {
      const el = $('scr-' + m) && $('scr-' + m).querySelector('[data-focus]');
      if (el) el.focus({ preventScroll: true });
    }
    if (m === 'title') renderRider();
  }

  function stars(n) {
    let s = '';
    for (let i = 0; i < 3; i++) s += i < n ? '★' : '☆';
    return s;
  }

  function unlocked(id) {
    const prevId = World.prevInMode(id);
    if (prevId == null) return true;
    const prev = progress[prevId];
    return !!(prev && prev.stars >= 1);
  }

  function renderRider() {
    const lv = skill();
    const next = lv < T.SKILL_MAX ? World.xpForLevel(lv + 1) : null;
    $('rider').textContent = 'Rider skill ' + lv + (next ? ' · ' + rider.xp + ' / ' + next + ' XP' : ' (max)') + ' · ₹' + rider.money + ' in tips';
  }

  function renderLevels() {
    const list = $('level-list');
    list.innerHTML = '';
    $('levels-title').textContent = rideMode === 'delivery' ? 'Choose your delivery shift' : 'Choose your commute';
    for (const def of World.LEVELS.filter((d) => (d.mode || 'commute') === rideMode)) {
      const L = World.level(def.id);
      const pr = progress[def.id];
      const open = unlocked(def.id);
      const b = document.createElement('button');
      b.className = 'level';
      b.disabled = !open;
      b.innerHTML =
        '<span class="lv-num">' + def.id + '</span>' +
        '<span class="lv-body"><span class="lv-name">' + def.name + '</span>' +
        '<span class="lv-meta">' + (L.length / 1000).toFixed(1) + ' km · ' + (def.weather === 'rain' ? 'Rain' : 'Clear') + ' · ' + (L.mode === 'delivery' ? L.drops.length + ' orders from ' + def.start : 'leave ' + def.start) + '</span></span>' +
        '<span class="lv-stars" aria-label="' + (pr ? pr.stars : 0) + ' stars">' + (open ? stars(pr ? pr.stars : 0) : 'Locked') + '</span>';
      b.addEventListener('click', () => { click(); startRun(def.id); });
      list.appendChild(b);
    }
  }


  function renderSettings(el) {
    el.innerHTML = '';
    const items = [
      ['View: ' + ({ chase: 'behind the scooter', first: 'from the seat', top: 'top-down map' }[settings.view] || 'from the seat'), () => settings.view !== 'top', () => {
        settings.view = { first: 'chase', chase: 'top', top: 'first' }[settings.view] || 'first';
        applyView();
      }],
      ['Sound: ' + (settings.muted ? 'off' : 'on'), () => !settings.muted, () => { settings.muted = !settings.muted; synth.setMuted(settings.muted); }],
      ['Reduce shake: ' + (settings.reduceShake ? 'on' : 'off'), () => settings.reduceShake, () => {
        settings.reduceShake = !settings.reduceShake;
        for (const v of Object.values(views)) v.setReduceShake(settings.reduceShake);
      }],
    ];
    for (const [label, get, toggle] of items) {
      const b = document.createElement('button');
      b.className = 'toggle';
      b.setAttribute('aria-pressed', String(get()));
      b.textContent = label;
      b.addEventListener('click', () => { toggle(); saveSettings(); renderAllSettings(); click(); });
      el.appendChild(b);
    }
  }
  function renderAllSettings() {
    for (const el of document.querySelectorAll('.settings')) renderSettings(el);
  }

  // --- toasts ----------------------------------------------------------------------------
  function toast(text, kind) {
    const el = $('toast');
    el.textContent = text;
    el.className = 'show ' + (kind || '');
    toastTimer = kind === 'bad' || kind === 'good' ? 3.2 : 2.2;
  }

  // All toast text lives in client/lines.js (toast.*), so it can be tweaked without touching code.
  const say = (key, vars) => GameLines.say(key, vars);
  const WHO = GameLines.WHO;
  const LUCK_VARS = { steady: T.STEADY_TIME, sugar: T.SUGAR_TIME, puncture: T.PUNCTURE_TIME, fade: T.FADE_TIME };
  const DEED_KARMA = { giveWay: T.GIVE_WAY_KARMA, letIn: T.LET_IN_KARMA, calm: T.CALM_KARMA, breaker: T.BREAKER_SLOW_KARMA };
  const GAALI_POOL = { ped: 'gaali.ped', guard: 'gaali.guard', customer: 'gaali.customer' };

  /** Give a gaali its line before the renderer and the toast both use it, so the bubble and toast match. */
  function prepareEvents(ev) {
    for (const e of ev) if (e.type === 'gaali' && !e.line) e.line = say(GAALI_POOL[e.who] || 'gaali.driver');
  }

  function luckText(e) {
    const vars = Object.assign({ amount: e.amount }, LUCK_VARS);
    let key = e.vendor && GameLines.has('toast.' + e.vendor) ? e.vendor : e.kind;
    if (key === 'fine' && !e.amount) key = 'warning';
    let text = key === 'cancel' && !e.amount ? 'Customer cancelled.' : say('toast.' + key, vars);
    if (e.source === 'giveWay') text = say('toast.prefixGiveWay') + text;
    else if (e.source === 'letIn') text = say('toast.prefixLetIn') + text;
    return text;
  }

  function eventToasts(ev) {
    for (const e of ev) {
      if (e.type === 'luck') toast(luckText(e), e.good ? 'good' : 'bad');
      else if (e.type === 'goodDeed') toast(say('toast.' + e.kind, { karma: DEED_KARMA[e.kind] }) || 'Good karma', 'deed');
      else if (e.type === 'delivered') {
        toast(say('toast.delivered', {
          name: e.name,
          stars: '★'.repeat(e.rating) + '☆'.repeat(5 - e.rating),
          tip: e.tip ? ' · tip ₹' + e.tip : '',
          late: e.late > 0 ? ' · ' + e.late + ' min late' : '',
        }), e.rating >= 4 ? 'good' : 'bad');
      } else if (e.type === 'busyAhead') toast(say('toast.busy_' + e.kind) || 'Busy stretch ahead.', 'deed');
      else if (e.type === 'missed') toast(say('toast.missed', { name: e.name, karma: T.MISSED_KARMA }), 'bad');
      else if (e.type === 'dogChase') toast(say('toast.dogChase'), 'bad');
      else if (e.type === 'dogBite') toast(say('toast.dogBite', { amount: e.amount }), 'bad');
      else if (e.type === 'dogScared') toast(say('toast.dogScared'), 'deed');
      else if (e.type === 'gaali') toast(say('toast.gaali', { line: e.line, karma: e.karma }), 'bad');
      else if (e.type === 'crash' && GameLines.has('toast.crash_' + e.with)) toast(say('toast.crash_' + e.with), 'bad');
      else if (e.type === 'fight') {
        const vars = { who: WHO[e.with] || 'them', karma: e.karma };
        if (e.phase === 'sorry') toast(say('toast.fightSorry', vars), 'deed');
        else if (e.phase === 'moveOn') toast(say('toast.fightMoveOn', vars), 'good');
        else if (e.phase === 'argue') toast(say('toast.fightArgue', vars), 'bad');
        else if (e.phase === 'shouted') toast(say('toast.fightShouted', vars), 'bad');
      }
    }
  }

  // --- runs ------------------------------------------------------------------------------
  function startRun(id, forcedSeed) {
    levelId = id;
    rideMode = World.level(id).mode;
    seed = forcedSeed != null ? forcedSeed >>> 0 : (Math.random() * 4294967296) >>> 0;
    state = Sim.create(levelId, seed, { skill: skill() });
    interp.clear();
    R.reset();
    input.reset();
    hintIdx = 0;
    hintTimer = 0;
    toastTimer = 0;
    resultTimer = 0;
    $('hint').classList.remove('show');
    $('toast').className = '';
    $('fight').hidden = true;
    loop.reset();
    if (loop.paused) loop.resume();
    setMode('play');
  }

  function pause() {
    if (mode !== 'play') return;
    loop.pause();
    input.reset();
    $('pause-seed').textContent = 'Level ' + levelId + ' · seed ' + seed;
    setMode('pause');
  }

  function resume() {
    if (mode !== 'pause') return;
    loop.resume();
    setMode('play');
  }

  function quit() {
    state = null;
    if (loop.paused) loop.resume();
    renderLevels();
    setMode('levels');
  }

  function summaryLine(r) {
    const s = r.stats;
    if (r.mode === 'delivery' && r.outcome === 'completed') {
      const eggs = r.goods >= 70 ? 'The eggs survived.' : r.goods >= 40 ? 'Some eggs did not make it.' : 'Omelette, anyone?';
      return r.delivered + ' of ' + r.total + ' delivered, ' + r.onTime + ' on time, average ' + r.avgRating.toFixed(1) + '★. ' + eggs + (s.fights ? ' ' + s.fights + ' argument' + (s.fights > 1 ? 's' : '') + ' on the way.' : '');
    }
    if (r.outcome !== 'arrived') {
      return pick([
        'The service centre says "two days, sir". You took an auto home.',
        'Your Yolo has given up. The potholes send their regards.',
        'Breakdown. You called your manager from under a rain tree.',
      ]);
    }
    const bits = [];
    if (s.goodDeeds) bits.push('did ' + s.goodDeeds + ' good deed' + (s.goodDeeds > 1 ? 's' : ''));
    if (s.fights) bits.push('got into ' + s.fights + ' argument' + (s.fights > 1 ? 's' : ''));
    if (s.splashedPeds) bits.push('splashed ' + s.splashedPeds + ' pedestrian' + (s.splashedPeds > 1 ? 's' : ''));
    if (s.potholesHit) bits.push('hit ' + s.potholesHit + ' pothole' + (s.potholesHit > 1 ? 's' : ''));
    if (s.footpathSeconds >= 3) bits.push('spent ' + Math.round(s.footpathSeconds) + ' s on the footpath');
    const when = World.fmtClock(r.arrivalGameTime + (T.TOD_SHIFT[state.tod] || 0)).replace(/^0/, '');
    if (!bits.length) return 'Zero potholes, zero drama. Are you sure this was Bengaluru? In by ' + when + '.';
    const list = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0];
    return 'You ' + list + (r.minutesEarly >= 0 ? ', and still made it by ' : ', and rolled in at ') + when + '.';
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function finishRun() {
    const r = Sim.result(state);
    let best = false;
    if (r.outcome !== 'breakdown') {
      const pr = progress[levelId] || { stars: 0, bestScore: 0, bestTime: null };
      best = r.score > pr.bestScore;
      progress[levelId] = {
        stars: Math.max(pr.stars, r.stars),
        bestScore: Math.max(pr.bestScore, r.score),
        bestTime: pr.bestTime == null ? r.finishedAt : Math.min(pr.bestTime, r.finishedAt),
      };
      store.set('progress', progress);
    }
    const before = skill();
    rider.xp += r.xp;
    rider.money += r.money;
    rider.runs = (rider.runs || 0) + 1;
    store.set('rider', rider);
    const after = skill();

    const early = r.minutesEarly;
    $('res-title').textContent = r.outcome === 'breakdown'
      ? 'Your Yolo broke down'
      : r.mode === 'delivery' ? (r.delivered === r.total ? 'Shift complete!' : 'Shift over: ' + r.delivered + '/' + r.total + ' delivered')
      : early >= 0 ? 'Made it! ' + World.fmtClock(r.arrivalGameTime + (T.TOD_SHIFT[state.tod] || 0)) : 'Late by ' + Math.ceil(-early) + ' min';
    $('res-stars').textContent = stars(r.stars);
    $('res-stars').setAttribute('aria-label', r.stars + ' of 3 stars');
    $('res-summary').textContent = summaryLine(r);
    let rows;
    if (r.mode === 'delivery' && r.outcome === 'completed') {
      rows = r.orders.map((o) => [o.name, o.status === 'delivered' ? '★'.repeat(o.rating) + (o.tip ? ' ₹' + o.tip : '') : 'missed']);
      rows.push(['Deliveries', r.deliveryPts], ['Karma ' + r.karma + ' × 5', r.karmaPts], ['Yolo ' + r.condition + ' × 3', r.conditionPts], ['Tips', '₹' + r.money], ['Score' + (best ? ' · new best!' : ''), r.score]);
    } else if (r.outcome === 'arrived') {
      rows = [['Punctuality', r.punctuality], ['Karma ' + r.karma + ' × 5', r.karmaPts], ['Yolo ' + r.condition + ' × 3', r.conditionPts], ['Tips', '₹' + r.money], ['Score' + (best ? ' · new best!' : ''), r.score]];
    } else rows = [['Tips kept', '₹' + r.money], ['Score', 0]];
    $('res-table').innerHTML = rows.map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('');
    const multText = r.xpMult > 1 ? 'Good karma: XP ×1.5' : r.xpMult < 1 ? 'Bad karma slowed your learning: XP ×0.5' : 'XP ×1';
    $('res-xp').textContent = '+' + r.xp + ' skill XP (' + multText + ')' + (after > before ? ' · Skill up! Now level ' + after : '');
    $('res-xp').className = r.xpMult > 1 ? 'good' : r.xpMult < 1 ? 'bad' : '';
    const ids = World.levelsOf(World.level(levelId).mode);
    const nextId = ids[ids.indexOf(levelId) + 1];
    $('b-next').hidden = !(nextId && unlocked(nextId));
    $('fight').hidden = true;
    setMode('result');
  }

  function checkHints() {
    const L = World.level(levelId);
    const p = state.players[0];
    if (hintTimer > 0) {
      hintTimer -= DT;
      if (hintTimer <= 0) $('hint').classList.remove('show');
    }
    while (hintIdx < L.hints.length && p.y >= L.hints[hintIdx].at) {
      const h = L.hints[hintIdx++];
      if (h.key === 'controls' && isTouch) $('hint').textContent = 'Throttle is automatic. Slide the left handle to steer; hold BRAKE to slow down.';
      else $('hint').textContent = h.text;
      $('hint').classList.add('show');
      hintTimer = 5;
    }
    if (toastTimer > 0) {
      toastTimer -= DT;
      if (toastTimer <= 0) $('toast').className = '';
    }
    $('fight').hidden = !(p.fight > 0 && p.fightWith);
    if (p.fight > 0) {
      $('fight-who').textContent = (p.fightDebate ? 'Heated debate with ' : 'Argument with ') + (WHO[p.fightWith] || 'them') + '!';
      $('fight-how').textContent = p.fightDebate
        ? 'HORN to argue back (costly) · BRAKE to be responsible and move on'
        : 'Hold BRAKE to apologise (−' + T.APOLOGY_KARMA + ' karma) · HORN to argue back (costly)';
    }
  }

  // --- loop --------------------------------------------------------------------------------
  function newDemo() {
    const st = Sim.create(Math.random() < 0.5 ? 1 : 4, (Math.random() * 4294967296) >>> 0);
    demo = { st, mem: Bot.create() };
    interp.clear();
  }

  let simMs = 0;
  function step() {
    if (mode === 'play' && state) {
      if (input.pausePressed()) { pause(); return; }
      const inp = input.sample(DT);
      lastInput = inp;
      if (!settings.touchHintSeen && input.touchUsed) {
        settings.touchHintSeen = true;
        saveSettings();
      }
      interp.begin(); interp.add(state.players); interp.add(state.npcs); interp.add(state.peds);
      const t0 = performance.now();
      const ev = Sim.step(state, inp);
      simMs = simMs * 0.95 + (performance.now() - t0) * 0.05;
      prepareEvents(ev);
      R.onEvents(ev, state);
      audio.onEvents(ev, state);
      eventToasts(ev);
      buzz(ev);
      checkHints();
      if (Sim.result(state)) {
        resultTimer += DT;
        if (resultTimer > 1.2) finishRun();
      }
    } else if (mode === 'result' || mode === 'pause') {
      // frozen
    } else {
      if (!demo || Sim.result(demo.st)) newDemo();
      interp.begin(); interp.add(demo.st.players); interp.add(demo.st.npcs); interp.add(demo.st.peds);
      const inp = Bot.act(demo.st, demo.mem);
      lastInput = inp;
      const ev = Sim.step(demo.st, inp);
      prepareEvents(ev);
      R.onEvents(ev, demo.st);
    }
  }

  let fps = 60;
  function render(alpha, dt) {
    fps = fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    autoQuality(dt);
    const inRun = state && (mode === 'play' || mode === 'pause' || mode === 'result');
    const st = inRun ? state : demo && demo.st;
    const touch = isTouch && mode === 'play' ? input.handle() : null; // the left-handle control
    if (st) R.draw(st, alpha, interp, dt, { hud: inRun, brake: lastInput.brake, touch, touchHint: !settings.touchHintSeen });
    audio.update(inRun ? state : null, mode === 'play');
    if (debugEl) debugEl.textContent = fps.toFixed(0) + ' fps · sim ' + simMs.toFixed(2) + ' ms · ' + (st ? st.npcs.length + ' npcs ' + st.peds.length + ' peds' : '');
  }

  const loop = Kit.FixedStep.createLoop({ dt: DT, step, render });
  const debugEl = params.has('debug') ? $('debug') : null;
  if (debugEl) {
    debugEl.hidden = false;
    window.__game = { state: () => state, mode: () => mode }; // for tests and the console
  }

  // --- wiring ------------------------------------------------------------------------------
  function click() { audio.sfx.click(); }
  const on = (id, f) => $(id).addEventListener('click', () => { click(); f(); });
  on('b-play', () => setMode('mode'));
  on('b-gear', () => {
    const open = $('title-settings').hidden;
    $('title-settings').hidden = !open;
    $('b-gear').setAttribute('aria-expanded', String(open));
  });
  on('b-mode-commute', () => { rideMode = 'commute'; renderLevels(); setMode('levels'); });
  on('b-mode-delivery', () => { rideMode = 'delivery'; renderLevels(); setMode('levels'); });
  on('b-mode-back', () => setMode('title'));
  on('b-levels-back', () => setMode('mode'));
  on('btn-pause', pause);
  on('b-resume', resume);
  on('b-restart', () => startRun(levelId));
  on('b-quit', quit);
  on('b-retry', () => startRun(levelId));
  on('b-next', () => { const ids = World.levelsOf(World.level(levelId).mode); startRun(ids[ids.indexOf(levelId) + 1]); });
  on('b-res-levels', () => { state = null; renderLevels(); setMode('levels'); });

  // Audio needs a user gesture (SPEC §10.4).
  const unlock = () => synth.unlock();
  // iOS only unlocks audio on touchend/click; others accept pointerdown.
  for (const t of ['pointerdown', 'touchend', 'click']) window.addEventListener(t, unlock, { capture: true });
  window.addEventListener('keydown', (e) => {
    unlock();
    if (mode === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) { e.preventDefault(); resume(); }
  }, { capture: true });

  // Auto-pause (SPEC §3.3, §12).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); synth.suspend(); } else synth.resume();
  });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', () => R.resize());

  function renderControlsHelp() {
    $('title-controls').textContent = isTouch
      ? 'Touch controls\nSlide the LEFT HANDLE (bottom left) to steer\nBRAKE and HORN: bottom right\n❚❚ (top right) to pause'
      : 'Keyboard controls\n← →  steer\n↓  brake\nSpace  horn\nP  pause';
  }

  // Phone feel: a short buzz on hits (Android; iOS has no vibration API). Off with "Reduce shake".
  function buzz(ev) {
    if (!isTouch || settings.reduceShake || !navigator.vibrate) return;
    for (const e of ev) {
      if (e.type === 'crash') navigator.vibrate(120);
      else if (e.type === 'pothole') navigator.vibrate(40);
      else if (e.type === 'bump' && e.kind === 'breaker' && e.hard) navigator.vibrate(30);
    }
  }

  // Auto quality: if a phone cannot hold ~40 fps, lower the rendering resolution.
  let slowFor = 0;
  let dprCap = 2;
  function autoQuality(dt) {
    if (mode !== 'play' || dprCap <= 1) return;
    slowFor = fps < 40 ? slowFor + dt : 0;
    if (slowFor > 2) {
      dprCap = dprCap > 1.5 ? 1.5 : 1;
      for (const v of Object.values(views)) v.setMaxDpr(dprCap);
      slowFor = -2;
    }
  }

  renderControlsHelp();
  renderAllSettings();
  newDemo();
  loop.start();

  if (params.has('level')) {
    const id = +params.get('level');
    if (World.LEVELS.some((d) => d.id === id)) startRun(id, params.has('seed') ? +params.get('seed') : null);
  } else setMode('title');

  // Offline play (SPEC §2). Skipped on localhost unless ?sw, so edits show up on reload.
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  Kit.Pwa.register('sw.js', { skip: params.has('nosw') || (local && !params.has('sw')) });
})();
