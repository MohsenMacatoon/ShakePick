/* ===== ShakePick: app logic =====
   Word list, random picking, animation, history, and saving. */
(function () {
  'use strict';

  const STORAGE_KEY = 'shakepick:v1';
  const MAX_ITEMS = 500;
  const MAX_LENGTH = 120;   // characters per item
  const HISTORY_SIZE = 5;
  const ROLL_STEPS = 12;    // how many items flash by before the result

  const state = {
    items: [],
    history: [],
    removeAfter: false,
    vibrate: true
  };
  let rolling = false;

  // ----- Elements -----
  const $ = id => document.getElementById(id);
  const el = {
    count: $('count'),
    ticket: $('ticket'),
    result: $('result'),
    hint: $('hint'),
    pickBtn: $('pickBtn'),
    allowBtn: $('allowBtn'),
    form: $('addForm'),
    input: $('itemInput'),
    list: $('list'),
    empty: $('empty'),
    clearBtn: $('clearBtn'),
    optRemove: $('optRemove'),
    optVibrate: $('optVibrate'),
    vibrateRow: $('vibrateRow'),
    historyBox: $('historyBox'),
    history: $('history')
  };

  const canVibrate = typeof navigator.vibrate === 'function';
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ----- Saving -----
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!data) return;
      if (Array.isArray(data.items)) {
        state.items = data.items.filter(s => typeof s === 'string').slice(0, MAX_ITEMS);
      }
      if (Array.isArray(data.history)) {
        state.history = data.history.filter(s => typeof s === 'string').slice(0, HISTORY_SIZE);
      }
      state.removeAfter = data.removeAfter === true;
      state.vibrate = data.vibrate !== false;
    } catch (err) { /* nothing saved yet, or storage blocked */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (err) { /* private mode or storage full: app still works */ }
  }

  // ----- Fair random number (0 to n-1) -----
  function randomIndex(n) {
    if (window.crypto && crypto.getRandomValues) {
      const limit = Math.floor(4294967296 / n) * n; // avoids bias
      const buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // ----- Showing things -----
  function setResult(text, isPlaceholder) {
    el.result.textContent = text;
    el.result.classList.toggle('is-placeholder', !!isPlaceholder);
  }

  function playAnimation(name) {
    el.ticket.classList.remove('rolling', 'landed', 'nudge');
    void el.ticket.offsetWidth; // restart the animation
    if (name) el.ticket.classList.add(name);
  }

  function render() {
    const n = state.items.length;
    el.count.textContent = n === 1 ? '1 item' : n + ' items';

    el.list.textContent = '';
    state.items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'chip';

      const span = document.createElement('span');
      span.className = 'chip-text';
      span.textContent = item; // textContent keeps any characters safe

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip-del';
      del.dataset.index = i;
      del.setAttribute('aria-label', 'Remove ' + item);
      del.textContent = '✕';

      li.append(span, del);
      el.list.appendChild(li);
    });

    el.empty.hidden = n > 0;
    el.clearBtn.disabled = n === 0;

    el.history.textContent = '';
    state.history.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      el.history.appendChild(li);
    });
    el.historyBox.hidden = state.history.length === 0;
  }

  // ----- Adding and removing -----
  function addFromText(text) {
    const parts = text.split(/[\n,]+/)
      .map(s => s.trim().slice(0, MAX_LENGTH))
      .filter(Boolean);

    let added = 0;
    for (const part of parts) {
      if (state.items.length >= MAX_ITEMS) break;
      state.items.push(part);
      added++;
    }
    if (added) { save(); render(); }
    return added;
  }

  function removeAt(index) {
    state.items.splice(index, 1);
    save();
    render();
  }

  // ----- Picking -----
  function pick() {
    if (rolling) return;

    const n = state.items.length;
    if (n === 0) {
      setResult('Add at least one item first', true);
      playAnimation('nudge');
      el.input.focus();
      return;
    }

    rolling = true;
    el.pickBtn.disabled = true;
    const winner = state.items[randomIndex(n)]; // decided now, shown at the end

    if (reduceMotion || n === 1) { land(winner); return; }

    playAnimation('rolling');
    let step = 0;
    let delay = 40;
    let shown = -1;

    (function tick() {
      // flash a random item (not the same one twice in a row)
      let i;
      do { i = randomIndex(n); } while (i === shown && n > 1);
      shown = i;
      setResult(state.items[i]);

      step++;
      if (step < ROLL_STEPS) {
        delay *= 1.13; // slow down gradually
        setTimeout(tick, delay);
      } else {
        setTimeout(() => land(winner), delay * 1.3);
      }
    })();
  }

  function land(winner) {
    setResult(winner);
    playAnimation('landed');
    if (state.vibrate && canVibrate) navigator.vibrate([30, 50, 70]);

    state.history.unshift(winner);
    state.history = state.history.slice(0, HISTORY_SIZE);

    if (state.removeAfter) {
      const i = state.items.indexOf(winner);
      if (i !== -1) state.items.splice(i, 1);
    }

    save();
    render();
    rolling = false;
    el.pickBtn.disabled = false;
  }

  // ----- Events -----
  el.form.addEventListener('submit', e => {
    e.preventDefault();
    const added = addFromText(el.input.value);
    el.input.value = '';
    autoGrow();
    if (added && state.history.length === 0 && !rolling) {
      setResult('Ready. Shake or tap Pick', true);
    }
    el.input.focus();
  });

  // Enter adds; Shift+Enter makes a new line. Pasted lists keep their line breaks.
  el.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.form.requestSubmit ? el.form.requestSubmit() : el.form.dispatchEvent(new Event('submit'));
    }
  });

  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 140) + 'px';
  }
  el.input.addEventListener('input', autoGrow);

  el.list.addEventListener('click', e => {
    const btn = e.target.closest('.chip-del');
    if (btn) removeAt(Number(btn.dataset.index));
  });

  el.clearBtn.addEventListener('click', () => {
    if (!state.items.length) return;
    if (confirm('Remove all ' + state.items.length + ' items?')) {
      state.items = [];
      save();
      render();
      setResult('Add a few items, then shake', true);
    }
  });

  el.pickBtn.addEventListener('click', pick);

  el.optRemove.addEventListener('change', () => {
    state.removeAfter = el.optRemove.checked;
    save();
  });
  el.optVibrate.addEventListener('change', () => {
    state.vibrate = el.optVibrate.checked;
    save();
  });

  // ----- Shake setup -----
  function shakeReady() {
    el.allowBtn.hidden = true;
    el.hint.textContent = 'Shake your phone or tap Pick';
  }

  const shakeStatus = Shake.init(pick, shakeReady);

  if (shakeStatus === 'needs-permission') {
    el.allowBtn.hidden = false;
    el.hint.textContent = 'Tap Allow shake once to use shaking';
  } else if (shakeStatus === 'insecure') {
    el.hint.textContent = 'Shaking needs an https:// link. Tap Pick for now.';
  } else if (shakeStatus === 'unsupported') {
    el.hint.textContent = 'Tap Pick to choose';
  }

  el.allowBtn.addEventListener('click', async () => {
    const ok = await Shake.requestPermission();
    if (ok) shakeReady();
    else el.hint.textContent = 'Shake is blocked. Tap Pick, or allow Motion in Safari settings.';
  });

  // ----- Start -----
  load();
  el.optRemove.checked = state.removeAfter;
  el.optVibrate.checked = state.vibrate;
  el.vibrateRow.hidden = !canVibrate; // iPhone browsers can't vibrate
  if (state.history.length) setResult(state.history[0]);
  else if (state.items.length) setResult('Ready. Shake or tap Pick', true);
  else setResult('Add a few items, then shake', true);
  render();

  // Offline support (only works on https:// or localhost)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
