/* ===== ShakePick: shake detection =====
   Reads the phone's accelerometer and calls a function when the phone is shaken.
   Too sensitive? Raise THRESHOLD. Not sensitive enough? Lower it. */
(function (global) {
  'use strict';

  const THRESHOLD = 15;     // how hard a jolt must be (m/s² change between readings)
  const JOLTS_NEEDED = 2;   // jolts needed in a short time to count as a shake
  const WINDOW_MS = 600;    // the "short time" for those jolts
  const COOLDOWN_MS = 1200; // wait this long before another shake can count

  let onShake = null;
  let onReady = null;
  let onMotion = null;      // gets every reading, so the water can tilt and slosh
  let grav = null;          // smoothed gravity, for phones that don't separate it
  // iPhone and Android report motion with opposite signs. We work out which one
  // this phone uses from how it's held (top of the screen up), then flip if needed.
  let signVotes = 0;
  let sign = 0;             // 0 = not decided yet, 1 = standard, -1 = flipped
  let listening = false;
  let gotReading = false;
  let last = null;
  let jolts = [];
  let lastShakeAt = 0;

  function handleMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;

    if (!gotReading) {
      gotReading = true;
      if (onReady) onReady(); // sensor is working
    }

    if (onMotion) reportMotion(e, a);

    if (!last) { last = { x: a.x, y: a.y, z: a.z }; return; }

    const change = Math.hypot(a.x - last.x, a.y - last.y, a.z - last.z);
    last = { x: a.x, y: a.y, z: a.z };
    if (change < THRESHOLD) return;

    const now = Date.now();
    if (now - lastShakeAt < COOLDOWN_MS) return;

    jolts = jolts.filter(t => now - t < WINDOW_MS);
    jolts.push(now);

    if (jolts.length >= JOLTS_NEEDED) {
      jolts = [];
      lastShakeAt = now;
      if (onShake) onShake();
    }
  }

  // Turns a phone-axis vector into screen directions (x = right, y = down),
  // taking screen rotation (portrait/landscape) into account.
  function toScreen(vx, vy) {
    const deg = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle : (window.orientation || 0);
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: vx * c - vy * s, y: -vx * s - vy * c };
  }

  function reportMotion(e, a) {
    // Gravity (as the phone measures it) and movement without gravity, phone axes
    const lin = e.acceleration;
    let gx, gy, mx, my;
    if (lin && lin.x !== null && lin.y !== null) {
      gx = a.x - lin.x; gy = a.y - lin.y; mx = lin.x; my = lin.y;
    } else {
      if (!grav) grav = { x: a.x, y: a.y };
      grav.x = grav.x * 0.85 + a.x * 0.15;
      grav.y = grav.y * 0.85 + a.y * 0.15;
      gx = grav.x; gy = grav.y; mx = a.x - grav.x; my = a.y - grav.y;
    }

    // Which way does "down" point on screen? (Standard phones report the
    // opposite of gravity, so a phone held upright reads +9.8 upward.)
    let down = toScreen(-gx, -gy);
    if (sign === 0) {
      if (Math.abs(down.y) > 2.5) signVotes += down.y > 0 ? 1 : -1;
      if (Math.abs(signVotes) >= 6) sign = signVotes > 0 ? 1 : -1;
    }
    const f = sign || 1;
    down = { x: down.x * f, y: down.y * f };
    const move = toScreen(mx * f, my * f);

    // move: phone acceleration on screen (m/s², x right, y down)
    // down: direction of gravity on screen (m/s²), or null until we're sure of the sign
    onMotion(move.x, move.y, sign ? down : null);
  }

  function listen() {
    if (listening) return;
    window.addEventListener('devicemotion', handleMotion);
    listening = true;
  }

  // Returns: 'ready' | 'needs-permission' | 'insecure' | 'unsupported'
  function getStatus() {
    if (!('DeviceMotionEvent' in window)) return 'unsupported';
    if (!window.isSecureContext) return 'insecure';
    if (typeof DeviceMotionEvent.requestPermission === 'function' && !gotReading) {
      return 'needs-permission'; // iPhone / iPad
    }
    return 'ready';
  }

  // Start detecting. shakeFn runs on each shake; readyFn runs once the sensor
  // sends data; motionFn (optional) gets every movement reading.
  function init(shakeFn, readyFn, motionFn) {
    onShake = shakeFn;
    onReady = readyFn;
    onMotion = motionFn || null;
    const status = getStatus();
    // Listen even on iPhone: if permission was already given this session,
    // readings arrive and readyFn hides the "Allow shake" button.
    if (status === 'ready' || status === 'needs-permission') listen();
    return status;
  }

  // iPhone only: must be called from a button tap.
  async function requestPermission() {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result === 'granted') { listen(); return true; }
    } catch (err) { /* user denied or browser blocked it */ }
    return false;
  }

  global.Shake = { init, requestPermission };
})(window);
