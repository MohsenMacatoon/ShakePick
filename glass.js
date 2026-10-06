/* ===== ShakePick: the glass of water =====
   A small physics simulation drawn on a <canvas>, with no libraries:
   - Water: a row of springy columns, so the surface ripples and sloshes.
   - Ice cubes: float (buoyancy), bump into each other and the glass, and spin.
   - The phone's real movement pushes the water and ice.
   It only animates while something is moving, then sleeps to save battery.

   Want a different feel? Tune the numbers in TUNING. */
(function (global) {
  'use strict';

  const TUNING = {
    gravity: 1500,        // px/s²
    buoyancy: 1.3,        // >1 makes ice float; higher floats higher
    waterLevel: 0.34,     // water starts this far down the glass (0 = top)
    waveStiffness: 55,    // how fast the surface springs back
    waveDamping: 2.6,     // how quickly ripples fade
    waveSpread: 1400,     // how far ripples travel
    motionScale: 70,      // phone acceleration (m/s²) to screen push (px/s²)
    maxCubes: 60
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const N = 44;                       // water columns
    let W = 0, H = 0, dpr = 1, geo = null;
    let cols = [];
    const cubes = [];                   // { id, text, x, y, vx, vy, a, w, r, alpha, state, scale }
    const bubbles = [];
    let reduced = !!opts.reducedMotion;
    let running = false, lastT = 0, idle = 0;
    let pushX = 0, pushY = 0;           // phone movement waiting to be applied
    let swirl = 0;                      // seconds of stirring left
    let lifted = null;                  // the cube shown as the result

    // ----- Size and shape of the glass -----
    function layout() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const top = 14, bottom = H - 8;
      const topHalf = Math.min(W * 0.42, (bottom - top) * 0.55);
      const botHalf = topHalf * 0.8;
      geo = { cx: W / 2, top, bottom, topHalf, botHalf, level: top + (bottom - top) * TUNING.waterLevel };
      if (cols.length !== N) cols = Array.from({ length: N }, () => ({ h: 0, v: 0 }));
      sizeCubes();
      cubes.forEach(keepInside);
      if (reduced) settle(); else wake();
      draw();
    }

    const halfAt = y => {
      const t = clamp((geo.bottom - y) / (geo.bottom - geo.top), 0, 1);
      return geo.botHalf + (geo.topHalf - geo.botHalf) * t;
    };
    const colX = i => geo.cx - geo.topHalf + (i + 0.5) * (2 * geo.topHalf / N);
    const colAt = x => clamp(Math.round((x - (geo.cx - geo.topHalf)) / (2 * geo.topHalf) * N - 0.5), 0, N - 1);
    function surfaceAt(x) {
      const f = (x - (geo.cx - geo.topHalf)) / (2 * geo.topHalf) * N - 0.5;
      const i = clamp(Math.floor(f), 0, N - 1), j = Math.min(N - 1, i + 1), t = clamp(f - i, 0, 1);
      return geo.level - (cols[i].h * (1 - t) + cols[j].h * t);
    }

    // Cubes shrink as more items are added, so they all fit.
    function cubeSize(n) {
      const area = (geo.topHalf + geo.botHalf) * (geo.bottom - geo.level + 30);
      return clamp(Math.sqrt(area / Math.max(1, n)) * 0.42, 13, 34);
    }
    function sizeCubes() {
      if (!geo) return;
      const live = cubes.filter(c => c.state === 'live' || c.state === 'lifted');
      const r = cubeSize(live.length);
      live.forEach(c => { if (Math.abs(c.r - r) > 0.5) { c.r = r; c.font = null; c.bigFont = null; } });
    }

    // ----- Items in, items out -----
    function setItems(items) {
      const ids = new Set(items.map(it => it.id));
      cubes.forEach(c => { if (!ids.has(c.id) && c.state !== 'removing') { c.state = 'removing'; } });
      const have = new Map(cubes.map(c => [c.id, c]));
      let dropIndex = 0;
      items.slice(0, TUNING.maxCubes).forEach(it => {
        const c = have.get(it.id);
        if (c) { if (c.text !== it.text) { c.text = it.text; c.font = null; c.bigFont = null; } return; }
        const r = geo ? cubeSize(items.length) : 24;
        const x = geo ? geo.cx + rand(-0.6, 0.6) * (geo.botHalf - r) : 0;
        cubes.push({
          id: it.id, text: it.text, r, font: null,
          x, y: geo ? geo.top - r * 2 - dropIndex * r * 1.6 : 0,
          vx: rand(-30, 30), vy: rand(0, 60), a: rand(-0.4, 0.4), w: rand(-2, 2),
          alpha: 1, state: 'live', scale: 1
        });
        dropIndex++;
      });
      sizeCubes();
      if (reduced) { cubes.forEach(c => { if (c.state === 'removing') c.alpha = 0; }); cleanup(); settle(); draw(); }
      else wake();
    }

    function cleanup() {
      for (let i = cubes.length - 1; i >= 0; i--) if (cubes[i].state === 'removing' && cubes[i].alpha <= 0) cubes.splice(i, 1);
    }

    // ----- Outside forces -----
    // Phone movement in m/s² (x right, y up). Contents lag behind the glass.
    function motion(ax, ay) {
      if (reduced) return;
      const k = TUNING.motionScale;
      pushX = clamp(pushX - ax * k, -2600, 2600);
      pushY = clamp(pushY + ay * k, -2600, 2600);
      if (Math.abs(ax) + Math.abs(ay) > 0.6) wake();
    }

    // A strong mix, used for every pick.
    function stir(strength) {
      if (reduced || !geo) return;
      strength = strength || 1;
      swirl = 0.9 * strength;
      cubes.forEach(c => {
        if (c.state !== 'live') return;
        c.vx += rand(-1, 1) * 520 * strength;
        c.vy -= rand(250, 650) * strength;
        c.w += rand(-7, 7) * strength;
      });
      cols.forEach((col, i) => { col.v += Math.sin(i * 0.7) * 90 * strength + rand(-40, 40); });
      addBubbles(Math.round(26 * strength));
      wake();
    }

    // A small splash where the user taps.
    function splash(x) {
      if (reduced || !geo) return;
      const k = colAt(x);
      for (let i = -3; i <= 3; i++) {
        const j = k + i;
        if (j >= 0 && j < N) cols[j].v -= 160 * (1 - Math.abs(i) / 4);
      }
      cubes.forEach(c => {
        if (c.state !== 'live') return;
        const d = Math.abs(c.x - x);
        if (d < 90) { c.vy -= 260 * (1 - d / 90); c.vx += (c.x - x) * 2; c.w += rand(-3, 3); }
      });
      addBubbles(6, x);
      wake();
    }

    function addBubbles(n, atX) {
      for (let i = 0; i < n && bubbles.length < 70; i++) {
        const y = geo.bottom - rand(6, 30);
        const half = halfAt(y) - 10;
        bubbles.push({ x: atX != null ? atX + rand(-20, 20) : geo.cx + rand(-half, half), y, r: rand(1.5, 4.5), vy: rand(-170, -90), ph: rand(0, 6) });
      }
    }

    // ----- Lift the picked cube out in front of the glass -----
    function lift(id) {
      const c = cubes.find(q => q.id === id && q.state === 'live');
      if (!c || !geo) return Promise.resolve();
      c.state = 'lifted';
      lifted = { c, t: 0, dur: reduced ? 0 : 0.6, fx: c.x, fy: c.y, fa: c.a, tx: geo.cx, ty: geo.top + c.r * 2.1 };
      wake();
      if (reduced) { stepLift(1); draw(); return Promise.resolve(); }
      return new Promise(res => { lifted.done = res; });
    }

    // Drop the picked cube back in (or let it melt away if it was removed).
    function release() {
      if (!lifted) return;
      const c = lifted.c;
      lifted = null;
      if (c.state === 'lifted') { c.state = 'live'; c.scale = 1; c.vy = 80; c.vx = rand(-40, 40); }
      if (reduced) settle();
      wake();
      draw();
    }

    function stepLift(dt) {
      const L = lifted;
      L.t = L.dur ? Math.min(1, L.t + dt / L.dur) : 1;
      const k = L.t, e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // ease out with a little bounce
      L.c.x = L.fx + (L.tx - L.fx) * e;
      L.c.y = L.fy + (L.ty - L.fy) * e;
      L.c.a = L.fa * (1 - k);
      L.c.scale = 1 + 0.75 * e;
      if (k >= 1 && L.done) { const d = L.done; L.done = null; d(); }
    }

    // ----- Physics -----
    function keepInside(c) {
      if (!geo) return;
      const half = halfAt(c.y) - c.r * 0.92;
      if (c.x < geo.cx - half) { c.x = geo.cx - half; c.vx = Math.abs(c.vx) * 0.35; c.w += c.vy * 0.004; }
      if (c.x > geo.cx + half) { c.x = geo.cx + half; c.vx = -Math.abs(c.vx) * 0.35; c.w -= c.vy * 0.004; }
      if (c.y > geo.bottom - c.r) { c.y = geo.bottom - c.r; c.vy = -Math.abs(c.vy) * 0.25; }
      if (c.y < geo.top - c.r * 2.5) { c.y = geo.top - c.r * 2.5; c.vy = Math.abs(c.vy) * 0.3; }
    }

    function step(dt) {
      const g = TUNING.gravity;
      const px = pushX, py = pushY;
      pushX *= Math.exp(-14 * dt); pushY *= Math.exp(-14 * dt);

      // Water surface
      const K = TUNING.waveStiffness, D = TUNING.waveDamping, S = TUNING.waveSpread;
      const span = 2 * geo.topHalf / N;
      const maxH = (geo.level - geo.top) * 0.85;
      for (let i = 0; i < N; i++) {
        const c = cols[i];
        const l = cols[Math.max(0, i - 1)].h, r = cols[Math.min(N - 1, i + 1)].h;
        const xn = (colX(i) - geo.cx) / geo.topHalf;
        let acc = -K * c.h - D * c.v + S * (l + r - 2 * c.h) / (span * span) * 0.02;
        acc += px * xn * 0.32;                 // side-to-side movement tips the surface
        acc += -py * 0.02;                     // up and down movement bounces it a little
        if (swirl > 0) acc += Math.sin(i * 0.5 + performance.now() / 120) * 120;
        c.v += acc * dt;
      }
      for (let i = 0; i < N; i++) cols[i].h = clamp(cols[i].h + cols[i].v * dt, -maxH, maxH);

      // Ice cubes
      const midY = (geo.level + geo.bottom) / 2;
      for (const c of cubes) {
        if (c.state === 'lifted') continue;
        const surf = surfaceAt(c.x);
        const sub = clamp((c.y + c.r - surf) / (2 * c.r), 0, 1);  // how much is under water
        c.vy += (g - g * TUNING.buoyancy * sub) * dt;
        c.vx += px * dt * 0.9;
        c.vy += py * dt * 0.9;
        if (swirl > 0) {                                        // stirring: spin around the middle
          const dx = c.x - geo.cx, dy = c.y - midY;
          c.vx += -dy * 9 * dt; c.vy += dx * 9 * dt;
          c.w += 3 * dt;
        }
        const slope = (surfaceAt(c.x + 5) - surfaceAt(c.x - 5)) / 10;
        c.vx += -slope * g * 0.35 * sub * dt;                   // slide down a tilted surface
        if (swirl <= 0) c.w += -Math.sin(c.a) * 18 * dt;        // slowly turn upright so words are readable
        const drag = Math.exp(-(sub > 0 ? 2.4 * sub + 0.35 : 0.15) * dt);
        c.vx *= drag; c.vy *= drag; c.w *= Math.exp(-2.2 * dt);
        c.w = clamp(c.w, -9, 9);
        c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.w * dt;
        if (sub > 0.05 && sub < 0.95 && Math.abs(c.vy) > 8) cols[colAt(c.x)].v += c.vy * 0.05;  // cubes make ripples
        if (c.state === 'removing') c.alpha -= dt / 0.35;
      }

      // Cubes bump into each other (two passes for stability)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < cubes.length; i++) {
          const a = cubes[i];
          if (a.state === 'lifted' || a.state === 'removing') continue;
          for (let j = i + 1; j < cubes.length; j++) {
            const b = cubes[j];
            if (b.state === 'lifted' || b.state === 'removing') continue;
            const dx = b.x - a.x, dy = b.y - a.y, min = (a.r + b.r) * 0.98;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, push = (min - d) / 2;
            a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
              const imp = -vn * 0.6;
              a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
              if (vn < -40) {                       // only real knocks make cubes spin
                const vt = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
                a.w += vt * 0.004; b.w -= vt * 0.004;
              }
            }
            // friction between touching cubes, so a crowded glass settles down
            a.vx *= 0.985; a.vy *= 0.985; b.vx *= 0.985; b.vy *= 0.985;
            a.w *= 0.97; b.w *= 0.97;
          }
        }
        cubes.forEach(c => { if (c.state !== 'lifted') keepInside(c); });
      }

      // Bubbles rise and pop at the surface
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y += b.vy * dt; b.ph += dt * 8; b.x += Math.sin(b.ph) * 0.4;
        if (b.y < surfaceAt(b.x) + 2) bubbles.splice(i, 1);
      }

      if (swirl > 0) swirl -= dt;
      if (lifted) stepLift(dt);
      cleanup();
    }

    // Run the physics quickly without drawing, so cubes settle in place.
    function settle() {
      if (!geo) return;
      const saved = swirl; swirl = 0;
      for (let i = 0; i < 240; i++) step(1 / 60);
      cols.forEach(c => { c.h = 0; c.v = 0; });
      cubes.forEach(c => { c.vx = c.vy = c.w = 0; });
      bubbles.length = 0;
      swirl = saved > 0 ? 0 : 0;
    }

    // "Still" means nothing moved on screen since the last frame
    // (less than a fifth of a pixel), so the loop can sleep.
    function isStill() {
      let still = !(swirl > 0 || lifted || bubbles.length || Math.abs(pushX) + Math.abs(pushY) > 5);
      for (const c of cols) {
        if (Math.abs(c.h - (c.ph || 0)) > 0.05) still = false;
        c.ph = c.h;
      }
      for (const c of cubes) {
        if (c.state === 'removing') still = false;
        if (c.state === 'live' && (Math.abs(c.x - (c.px || 0)) > 0.2 || Math.abs(c.y - (c.py || 0)) > 0.2 || Math.abs(c.a - (c.pa || 0)) > 0.004)) still = false;
        c.px = c.x; c.py = c.y; c.pa = c.a;
      }
      return still;
    }

    // ----- Animation loop (sleeps when nothing moves) -----
    function wake() {
      idle = 0;
      if (running || !geo) return;
      running = true;
      lastT = performance.now();
      requestAnimationFrame(frame);
    }
    function frame(now) {
      const dt = Math.min(1 / 30, (now - lastT) / 1000 || 1 / 60);
      lastT = now;
      const sub = 2;
      for (let i = 0; i < sub; i++) step(dt / sub);
      draw();
      idle = isStill() ? idle + dt : 0;
      if (idle > 0.6) { running = false; return; }
      requestAnimationFrame(frame);
    }

    // ----- Drawing -----
    function glassPath() {
      const { cx, top, bottom, topHalf, botHalf } = geo, R = 22;
      ctx.beginPath();
      ctx.moveTo(cx - topHalf, top);
      ctx.lineTo(cx - botHalf, bottom - R);
      ctx.quadraticCurveTo(cx - botHalf, bottom, cx - botHalf + R, bottom);
      ctx.lineTo(cx + botHalf - R, bottom);
      ctx.quadraticCurveTo(cx + botHalf, bottom, cx + botHalf, bottom - R);
      ctx.lineTo(cx + topHalf, top);
      ctx.closePath();
    }
    function waterPath() {
      ctx.beginPath();
      ctx.moveTo(geo.cx - geo.topHalf - 2, geo.level - cols[0].h);
      for (let i = 0; i < N; i++) ctx.lineTo(colX(i), geo.level - cols[i].h);
      ctx.lineTo(geo.cx + geo.topHalf + 2, geo.level - cols[N - 1].h);
      ctx.lineTo(geo.cx + geo.topHalf + 2, geo.bottom + 4);
      ctx.lineTo(geo.cx - geo.topHalf - 2, geo.bottom + 4);
      ctx.closePath();
    }

    function fitLabel(c, big) {
      let size = c.r * 0.62;
      const max = c.r * 1.62;
      const min = big ? Math.max(5, c.r * 0.22) : Math.max(8, c.r * 0.36);
      ctx.font = `700 ${size}px ui-rounded, system-ui, -apple-system, sans-serif`;
      while (size > min && ctx.measureText(c.text).width > max) {
        size -= 1;
        ctx.font = `700 ${size}px ui-rounded, system-ui, -apple-system, sans-serif`;
      }
      let label = c.text;
      if (ctx.measureText(label).width > max) {
        while (label.length > 1 && ctx.measureText(label + '…').width > max) label = label.slice(0, -1);
        label += '…';
      }
      const f = { size, label };
      if (big) c.bigFont = f; else c.font = f;
      return f;
    }

    function drawCube(c, glow) {
      if (!c.font) fitLabel(c);
      const f = glow ? (c.bigFont && c.bigFont.text === c.text ? c.bigFont : Object.assign(fitLabel(c, true), { text: c.text })) : c.font;
      const s = c.r * 0.92;
      ctx.save();
      ctx.globalAlpha = clamp(c.alpha, 0, 1);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.scale(c.scale, c.scale);
      if (glow) { ctx.shadowColor = 'rgba(255, 210, 63, .95)'; ctx.shadowBlur = 24; }
      const grad = ctx.createLinearGradient(-s, -s, s, s);
      grad.addColorStop(0, 'rgba(255,255,255,.97)');
      grad.addColorStop(1, 'rgba(205,232,255,.9)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-s, -s, 2 * s, 2 * s, s * 0.3);
      else ctx.rect(-s, -s, 2 * s, 2 * s);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = glow ? 3 : 1.5;
      ctx.strokeStyle = glow ? '#FFD23F' : 'rgba(255,255,255,.95)';
      ctx.stroke();
      // a little shine in the corner
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-s * 0.62, -s * 0.15); ctx.lineTo(-s * 0.62, -s * 0.6); ctx.lineTo(-s * 0.2, -s * 0.6); ctx.stroke();
      ctx.fillStyle = '#1B2A6B';
      ctx.font = `700 ${f.size}px ui-rounded, system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.label, 0, s * 0.06);
      ctx.restore();
    }

    function draw() {
      if (!geo) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // back of the glass
      glassPath();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fill();

      ctx.save();
      glassPath();
      ctx.clip();
      // water behind the ice
      waterPath();
      ctx.fillStyle = 'rgba(150,215,255,.16)';
      ctx.fill();
      // ice
      cubes.forEach(c => { if (c.state !== 'lifted') drawCube(c, false); });
      // water in front tints the parts under water
      waterPath();
      const wg = ctx.createLinearGradient(0, geo.level, 0, geo.bottom);
      wg.addColorStop(0, 'rgba(160,220,255,.30)');
      wg.addColorStop(1, 'rgba(70,150,245,.42)');
      ctx.fillStyle = wg;
      ctx.fill();
      // surface line
      ctx.beginPath();
      for (let i = 0; i < N; i++) { const x = colX(i), y = geo.level - cols[i].h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // bubbles
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1.2;
      bubbles.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); });
      // shine on the glass
      const sh = ctx.createLinearGradient(geo.cx - geo.topHalf, 0, geo.cx - geo.topHalf + 40, 0);
      sh.addColorStop(0, 'rgba(255,255,255,.22)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(geo.cx - geo.topHalf, geo.top, 40, geo.bottom - geo.top);
      ctx.restore();

      // glass outline and rim
      ctx.save();
      glassPath();
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(geo.cx, geo.top, geo.topHalf, 6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // the picked cube, in front of everything
      if (lifted) drawCube(lifted.c, true);
    }

    // ----- Setup -----
    if ('ResizeObserver' in window) new ResizeObserver(layout).observe(canvas);
    else window.addEventListener('resize', layout);
    layout();

    return {
      setItems, motion, stir, splash, lift, release,
      setReducedMotion(v) { reduced = !!v; if (reduced) { settle(); draw(); } },
      relayout: layout
    };
  }

  global.Glass = { create };
})(window);
