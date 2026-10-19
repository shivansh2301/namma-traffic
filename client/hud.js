/*
 * client/hud.js: the heads-up display, shared by both views.
 *
 *   GameHud.draw(ctx, state, W, { speed: true })
 *
 * Top bar. Commute: clock vs 10:00 (red when late). Delivery: clock and the
 * next order's countdown. Then tips, speed (optional), Yolo condition, karma
 * (and the grocery bag in delivery mode), and route progress with ticks for
 * landmarks or drop points.
 * Below it: chips for active luck effects (good in green, bad in red).
 * Drawn in CSS pixels; all text >= 14 px (SPEC §12).
 */
(function (root) {
  'use strict';
  const { T } = World;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const H = 68;
  const COL = {
    bg: 'rgba(14,17,22,0.8)', text: '#f5f1e8', dim: '#b8b2a3', late: '#ff6a5c', cond: '#4fc3f7', money: '#ffd166',
    good: '#62d26f', mid: '#ffb703', bad: '#ff6a5c', track: 'rgba(255,255,255,0.15)', cyan: '#22e5ff',
  };

  function bar(ctx, x, y, w, h, frac, color, label) {
    ctx.fillStyle = COL.dim;
    ctx.font = '700 14px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + h / 2);
    const lw = ctx.measureText(label).width + 8;
    ctx.fillStyle = COL.track;
    ctx.fillRect(x + lw, y, w - lw, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + lw, y, (w - lw) * Math.max(0, Math.min(1, frac)), h);
    return x + lw;
  }

  function chip(ctx, x, y, text, color) {
    ctx.font = '700 14px ' + FONT;
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(14,17,22,0.78)';
    Kit.Sprites.roundRect(ctx, x, y, w, 24, 12);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + 12.5);
    return w;
  }

  function draw(ctx, st, W, opts) {
    const L = World.level(st.levelId);
    const p = st.players[0];
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.font = '700 17px ' + FONT;
    ctx.textAlign = 'left';
    const delivery = L.mode === 'delivery';
    const next = delivery ? Sim.nextOrder(st) : null;
    if (delivery) {
      ctx.fillStyle = COL.text;
      ctx.fillText(World.fmtClock(st.time), 12, 17);
      if (next) {
        const left = next.due - st.time;
        const s = Math.floor(Math.abs(left));
        ctx.fillStyle = left < 0 ? COL.late : left < 60 ? COL.mid : '#e0aaff';
        ctx.fillText('Drop ' + (st.orders.indexOf(next) + 1) + '/' + st.orders.length + ' · ' + (left < 0 ? 'late +' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), 80, 17);
      }
    } else {
      ctx.fillStyle = st.time > st.deadline ? COL.late : COL.text;
      ctx.fillText(World.fmtClock(st.time) + ' / ' + World.fmtClock(st.deadline), 12, 17);
    }
    ctx.textAlign = 'right';
    let right = W - 60;
    if (opts && opts.speed && !delivery) {
      ctx.fillStyle = COL.text;
      ctx.fillText(Math.round(p.v * 3.6) + ' km/h', right, 17);
      right -= ctx.measureText('00 km/h').width + 14;
    }
    ctx.fillStyle = COL.money;
    ctx.fillText('₹' + Math.max(0, Math.round(p.money)), right, 17);

    const n = delivery ? 3 : 2;
    const wb = (W - 12 * (n + 1)) / n;
    bar(ctx, 12, 32, wb, 10, p.condition / 100, p.condition < 30 ? COL.bad : COL.cond, 'YOLO');
    const kc = p.karma >= 70 ? COL.good : p.karma >= 40 ? COL.mid : COL.bad;
    const kx0 = 24 + wb;
    const kx = bar(ctx, kx0, 32, wb, 10, p.karma / 100, kc, 'KARMA');
    // mark the 50 line: above it luck turns good, below it bad
    ctx.fillStyle = COL.text;
    ctx.fillRect(kx + (kx0 + wb - kx) * 0.5 - 1, 30, 2, 14);
    if (delivery) bar(ctx, 36 + 2 * wb, 32, wb, 10, p.goods / 100, p.goods < 40 ? COL.bad : p.goods < 70 ? COL.mid : '#c77dff', 'BAG');

    const x0 = 12;
    const x1 = W - 12;
    const yb = 56;
    ctx.fillStyle = COL.track;
    ctx.fillRect(x0, yb, x1 - x0, 4);
    const frac = Math.max(0, Math.min(1, p.y / L.length));
    ctx.fillStyle = COL.good;
    ctx.fillRect(x0, yb, (x1 - x0) * frac, 4);
    ctx.fillStyle = 'rgba(255,152,0,0.9)'; // busy gullies
    for (const b of st.busy || []) ctx.fillRect(x0 + (x1 - x0) * (b.y0 / L.length), yb - 1, Math.max(3, (x1 - x0) * ((b.y1 - b.y0) / L.length)), 6);
    ctx.fillStyle = COL.text;
    for (const m of L.landmarks) ctx.fillRect(x0 + (x1 - x0) * (m.at / L.length) - 1, yb - 3, 2, 10);
    for (const o of st.orders || []) {
      ctx.fillStyle = o.status === 'delivered' ? COL.good : o.status === 'missed' ? COL.bad : '#c77dff';
      ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * Math.min(1, o.y / L.length), yb + 2, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x0 + (x1 - x0) * frac, yb + 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = COL.cyan;
    ctx.fill();

    // active effects
    let cx = 10;
    const cy = H + 6;
    const fx = [
      [p.steadyT, 'Steady hands', COL.good],
      [p.sugarT, 'Sugar rush', COL.good],
      [p.punctureT, 'Puncture', COL.bad],
      [p.fadeT, 'Weak brakes', COL.bad],
      [p.haltT, 'Police stop', COL.bad],
    ];
    for (const [t, label, color] of fx) {
      if (t > 0) cx += chip(ctx, cx, cy, label + ' ' + Math.ceil(t) + 's', color) + 6;
    }
  }

  /**
   * The left handle (touch): a handlebar grip on a slide track at the bottom
   * left. Hold it with your thumb and slide; the grip follows the thumb and
   * the rider leans. Pulses with a label until it has been used. `lift` raises
   * it (px), e.g. above the cockpit dashboard.
   */
  function drawHandle(ctx, W, H, h, hint, time, lift) {
    const travel = h.travel;
    const cx = travel + 48; // the track is 8 px from the left edge, half-width travel + 40
    const cy = H - 74 - (lift || 0);
    const v = Math.max(-1, Math.min(1, h.value));
    ctx.fillStyle = 'rgba(10,12,16,0.5)';
    Kit.Sprites.roundRect(ctx, cx - travel - 40, cy - 31, (travel + 40) * 2, 62, 31); ctx.fill();
    ctx.strokeStyle = h.active ? 'rgba(34,229,255,0.8)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    chevronSide(ctx, cx - travel - 26, cy, -1);
    chevronSide(ctx, cx + travel + 26, cy, 1);
    ctx.save();
    ctx.translate(cx + v * travel, cy);
    ctx.rotate(v * 0.25);
    ctx.fillStyle = '#6b7178';
    ctx.fillRect(28, -6, 34, 12); // the bar, heading off toward the bike
    ctx.fillStyle = '#2b2b2b';
    Kit.Sprites.roundRect(ctx, -38, -18, 72, 36, 14); ctx.fill();
    ctx.fillStyle = '#3e3e3e';
    for (let x = -28; x < 30; x += 8) ctx.fillRect(x, -16, 3, 32);
    ctx.fillStyle = '#1fb5c4';
    ctx.beginPath(); ctx.arc(-38, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(22, -20, 6, 0, Math.PI * 2); ctx.fill(); // the horn switch, for looks
    ctx.restore();
    if (!h.active) {
      const pulse = 0.45 + 0.35 * Math.sin(time * 4);
      ctx.strokeStyle = 'rgba(255,209,102,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 3;
      Kit.Sprites.roundRect(ctx, cx - 46, cy - 26, 92, 52, 18); ctx.stroke();
      ctx.font = '800 15px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd166';
      if (!hint) ctx.fillText('HOLD & SLIDE', cx, cy - 46);
      else {
        const line = 'Hold the LEFT HANDLE, slide ◀ ▶ to steer';
        if (ctx.measureText(line).width < W - 24) ctx.fillText(line, W / 2, cy - 46);
        else { ctx.fillText('Hold the LEFT HANDLE,', W / 2, cy - 64); ctx.fillText('slide ◀ ▶ to steer', W / 2, cy - 45); }
      }
      if (hint) { // a ghost thumb shows the motion
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.arc(cx + Math.sin(time * 2.2) * travel, cy + 4, 15, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function chevronSide(ctx, X, Y, dir) {
    ctx.beginPath();
    ctx.moveTo(X + dir * 9, Y);
    ctx.lineTo(X - dir * 6, Y - 10);
    ctx.lineTo(X - dir * 6, Y + 10);
    ctx.closePath();
    ctx.fill();
  }

  root.GameHud = { draw, drawHandle, HEIGHT: H };
})(window);
