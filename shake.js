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

  // Start detecting. shakeFn runs on each shake; readyFn runs once the sensor sends data.
  function init(shakeFn, readyFn) {
    onShake = shakeFn;
    onReady = readyFn;
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
