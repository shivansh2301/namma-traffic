/*
 * client/lines.js: every line of dialogue in the game (speech bubbles and toasts),
 * in one place so it is cheap to tweak (docs/concepts/dialogue.md).
 *
 *   GameLines.say('ped.thanks')                 // random line from a pool
 *   GameLines.say('toast.dogBite', { amount })  // {amount} is filled in
 *
 * Editing rules:
 * - A key is a pool: an array of lines; one is picked at random. Add, remove or
 *   reword freely. Bubbles should stay short (about 30 characters).
 * - {name} placeholders are filled from the event (the comment on each pool
 *   says which are available). Unknown placeholders are left as they are.
 * - Bengaluru talks in Kannada, Hindi, English, Tamil, Telugu and every mix of
 *   them: keep the mix. Parody brand names only (Zebto, Piggy, KinkIt, Tomato,
 *   bOla, bUber, Bapido, MyGaate). Rude words keep a * or two (gaali pools).
 * - Satire targets the roads and the system, not communities.
 * tests/lines.test.js checks every key the game uses exists and is non-empty.
 */
(function (root) {
  'use strict';

  const LINES = {
    // ---- people on the street ------------------------------------------------
    ped: {
      thanks: ['Thank you, anna!', 'Dhanyavaada!', 'Thanks ji!', 'Nandri, thambi!', 'Super, guru!'],
      splashed: ['Ayyo! My clothes!', 'Ayyo! Office shirt!', 'Arre yaar! Pura geela!', 'Kannu ilva?!'],
      splashedOther: ['Ayyo!', 'Arre!', 'Chee!'],
      nudge: ['Sorry, sorry', 'Oops, anna', 'Arre, sorry', 'Swalpa jaaga kodi'],
      dodge: ['Ey!', 'Arre!', 'Horn yaake?!'],
      chatA: ['Oota aayta?', 'Chennagideera?', 'Kya scene hai?', 'Lets put one scene, macha', 'What ra, long time!'],
      chatB: ['Aaytu! Neevu?', 'Hoon, chennagideeni', 'Sab badhiya', 'Done, macha!', 'Busy ra, office'],
      // app bookers: nobody waves for an auto any more
      booking: ['bOla booked, 2 min...', 'bUber says arriving', 'Bapido OTP 4521', 'Driver cancelled AGAIN', 'Pin is wrong, come left!'],
      fightStart: ['Ey! Kannu kaanalva?', 'Enu guru idu?!', 'Nodkondu hogi!', 'Andha hai kya?', 'What ra this!'],
      fightCalm: ['Hmm. Hushaaru!', 'Okay okay, hogi', 'Theek hai, chalo'],
      fightAngry: ['Yen guru?!', 'Police kareetini!', 'Nimdu tappu!', 'Tere baap ka road hai?'],
      fightEnd: ['Hogi, hogi...', 'Chalo, jao', 'Pochu, poyittu va'],
    },
    // ---- drivers -----------------------------------------------------------------
    npc: {
      honkAtYou: ['Swalpa adjust maadi!', 'Side please!', 'Bhaiya, side!', 'Move ra!', 'Horn OK Please!'],
      honker: ['Pom pom!', 'PAAAM!', 'Pee-pee-peee!', 'Horn OK Please!', 'Side, side, side!'],
      yield: ['Sari, sari', 'Okay boss', 'Haan, jao'],
      cutInA: ['Ey! Side kodi!', 'Indicator haaki!', 'Indicator kidhar hai?'],
      wrongSideA: ['Wrong side, guru!', 'Ulta yaake?', 'Ulta kyun aa raha?'],
      cutInB: ['Swalpa adjust maadi!', 'Sari, hogi!', 'Hurry ide!', 'Chill maadi!'],
      thanksLetIn: ['Thanks, guru!', 'Shukriya!', 'Thanks boss'],
      pickup: ['OTP heli, madam', 'OTP bolo', 'Meter illa, 50 extra', 'Banni, kootkoli'],
      busBoard: ['Majestic! Majestic!', 'Shivajinagar! Banni!', 'Silk Board, Silk Board!'],
      learner: ['L board maga!', 'Learner, sorry!', 'First day, anna!'],
      behindLearner: ['L board maga!', 'Ayyo, L board!', 'Speed maadi, uncle!'],
      turnOff: ['Hogli, side road', 'Chalo, gali se', 'Short cut!'],
      autoVsBapido: ['Bapido-na! Namma hotte mele!', 'Bike taxi illegal, guru!', 'Saar, nimma Bapido...', 'Apps ruined everything!'],
      bapidoBack: ['Customer wants cheap, anna', 'Rating kodi please', 'App says go, I go'],
    },
    rider: { // rival delivery riders passing you
      racer: ['Zoooom!', 'Vroooom!', 'Nodkond hogu!'],
      piggy: ['Piggy 10 min, bro!', 'Same tower-aa, Zebto?', 'Orange army!'],
      kinkit: ['KinkIt in 8 min!', 'Bro, which block?', 'Yellow is faster!'],
      tomato: ['Tomato hot food!', 'Biryani on board!', 'Red alert, side!'],
    },
    dog: {
      bark: ['Woof!', 'WOOF WOOF!', 'Grrr...', 'Bow bow!'],
      scared: ['Yip!', 'Kai kai!'],
    },
    // ---- gaali: honk too much at someone and they let you have it ---------------
    gaali: {
      ped: ['Bevar*i! Horn nilsu!', 'Kivi ilva, lo*fer?', 'Abe ul*u, horn band kar!', 'Ka*ine, kya hai?!', 'Stop honking, id**t!', 'Loo*u, horn adikaadhe!'],
      driver: ['Thi*a muchko, horn nilsu!', 'Abe sa*le, dikh nahi raha?', 'Bl**dy horn-maniac!', 'Ninn ajji, horn yaake?!', 'Gad*e, wait maadu!'],
      guard: ['Sir, society-alli horn ilV!', 'No honking in society, sa*le!', 'Secretary-ge complaint kodtini!'],
      customer: ['Horn yaake?! Coming!', 'Uncle is sleeping, id**t!', 'One star for honking!'],
    },
    // ---- the drop: society approval, doorbells -----------------------------------
    hand: {
      guard: ['Security: Flat number?', 'Entry register, sir!', 'MyGaate approval, wait'],
      approvalWait: ['Resident not picking up...', 'MyGaate: approval pending', 'Calling flat 1402...'],
      lift: ['Approved! Lift is slow, sir', 'Up to the 14th floor...', 'Lift under maintenance!'],
      gate: ['"Leave it at the gate"', 'Keep with security, sir'],
      comesDown: ['Customer came down! Thanks!', 'Thanks, bhaiya! Here, tip'],
      wrongTower: ['Wrong tower! Go to B-block', 'This is C wing, saar!'],
      bell: ['Ding-dong!', 'Ding-dong... ding-dong!'],
      collect: ['Thanks, anna!', 'Okay, thanks', 'Ah, finally!'],
      kid: ['Kid: Thank you, uncle!', 'Mummy, Zebto came!'],
      checking: ['Aunty checks every tomato...', 'Aunty: Bread expiry date?'],
      change: ['Change for 500 iddiya?', '500 ka chutta hai?'],
      dogGate: ['WOOF! WOOF! (behind the gate)', 'Tommy, sit! Sit!'],
      water: ['Uncle: Have some water, beta', 'Neeru kudi, thamma'],
    },
    deliver: {
      happy: ['Super fast! Thank you!', 'Thanks, anna!', 'Wow, 9 minutes!'],
      broken: ['Customer: The eggs are broken!', 'Milk packet leaking!'],
      late: ['Customer: So late!', 'Ice cream melted, bro!'],
      ok: ['Customer: Okay, thanks.', 'Hmm, okay.'],
      missed: ['Phone: "Where are you?!" Cancelled.'],
    },
    me: {
      hiddenPothole: ['Hidden pothole!', 'Ayyo, pothole!'],
      sorry: ['Sorry, sorry!', 'Maaf karo!', 'Sorry anna!'],
      argue: ['You started it!', 'Neeve nodi!', 'Side kodi!', 'Tu dekh ke chala!'],
      slip: ['Whoa-oa-oa!', 'Ayyo, slipped!'],
      bitten: ['AAAH! My leg!', 'Ayyo, nayi!'],
    },

    // ---- toasts (top of the screen) ------------------------------------------------
    toast: {
      // luck: {amount} {steady} {sugar} {puncture} {fade}
      tip: ['A customer tips you ₹{amount}. Shabash!'],
      water: ['A shopkeeper hands you water. Steady hands for {steady} s!'],
      sweets: ['Someone shares Mysore pak. Sugar rush for {sugar} s!'],
      chai: ['The chai anna hands you a cutting chai. Steady hands for {steady} s!'],
      momo: ['Free momos from the momo cart! Sugar rush for {sugar} s!'],
      biryani: ['Biryani uncle insists you taste. Energy for {sugar} s!'],
      skill: ['A senior rider shares a trick. +{amount} skill XP.'],
      greenWave: ['A friendly cop waves you through. {amount} s saved!'],
      puncture: ['Puncture! Top speed down for {puncture} s.'],
      fine: ['Traffic police stop you. Fine: ₹{amount}.'],
      warning: ['Traffic police stop you. Just a warning.'],
      brakes: ['Brakes feel spongy. Weaker brakes for {fade} s.'],
      cancel: ['Customer cancelled. Lost ₹{amount}.', 'Customer cancelled.'],
      skillSlow: ['Bad day. -{amount} skill XP.'],
      prefixGiveWay: ['Thank you, beta! '],
      prefixLetIn: ['Thanks, guru! '],
      // deeds: {karma}
      giveWay: ['+{karma} karma: you let them cross'],
      letIn: ['+{karma} karma: you let them in'],
      calm: ['+{karma} karma: calm riding'],
      breaker: ['+{karma} karma: gentle over the breaker'],
      // deliveries: {name} {stars} {tip} {late} {karma}
      delivered: ['Delivered: {name} · {stars}{tip}{late}'],
      missed: ['Missed the drop: {name}. Order cancelled, −{karma} karma'],
      // fights: {who} {karma}
      fightSorry: ['You apologised to {who}. −{karma} karma'],
      fightArgue: ['You argued with {who}. −{karma} karma'],
      fightShouted: ['{Who} shouted at you. −{karma} karma'],
      // street life
      busy_school: ["School's out ahead: kids and parents everywhere. Go slow!"],
      busy_market: ['Santhe day ahead: vegetable carts and crowds.'],
      busy_temple: ['Temple utsava ahead: the crowd spills onto the road.'],
      busy_wedding: ['Wedding procession ahead: band, dancing, the works.'],
      busy_cricket: ['Gully cricket ahead. Mind the ball (and the fielders).'],
      dogChase: ['A street dog is chasing you! Speed up, or honk.'],
      dogBite: ['Bitten! Anti-rabies shot: −₹{amount}.', 'Bitten! The injection costs ₹{amount}.'],
      dogScared: ['The dog backs off.'],
      // gaali: {line} {karma}
      gaali: ['"{line}" −{karma} karma'],
      // crashes: {cost}
      crash_slip: ['You slipped in the puddle!', 'Splat! Slipped and fell.'],
      crash_drain: ['Front wheel into an open drain!', 'Missing drain slab! Ouch.'],
      crash_dog: ['You hit a sleeping dog. Bad karma.'],
      crash_stall: ['You crashed into a street stall!'],
    },
  };

  /** Who you argued with, for toasts. */
  const WHO = { auto: 'the auto driver', car: 'the car driver', bike: 'the biker', bus: 'the bus driver', tanker: 'the tanker driver', ped: 'the pedestrian', vendor: 'the vendor', cart: 'the vendor' };

  function pool(key) {
    let o = LINES;
    for (const part of key.split('.')) { o = o && o[part]; }
    return Array.isArray(o) ? o : null;
  }

  function fill(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => {
      if (vars[k] != null) return String(vars[k]);
      const low = k.charAt(0).toLowerCase() + k.slice(1); // {Who}: capitalised {who}
      if (low !== k && vars[low] != null) { const v = String(vars[low]); return v.charAt(0).toUpperCase() + v.slice(1); }
      return m;
    });
  }

  /** A random line from the pool at `key`, placeholders filled. '' if the pool is missing. */
  function say(key, vars, rnd) {
    const p = pool(key);
    if (!p || !p.length) return '';
    return fill(p[Math.floor((rnd != null ? rnd : Math.random()) * p.length)], vars);
  }

  root.GameLines = { LINES, WHO, say, pool, fill, has: (k) => !!pool(k) };
})(typeof window !== 'undefined' ? window : globalThis);
