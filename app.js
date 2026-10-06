/* ===== ShakePick: app logic =====
   Saved lists, items (each one is an ice cube), picking, pick counts, history. */
(function () {
  'use strict';

  const STORAGE_KEY = 'shakepick:v2';
  const OLD_KEY = 'shakepick:v1';
  const MAX_ITEMS = 60;      // a glass holds this many cubes
  const MAX_LISTS = 20;
  const MAX_LENGTH = 60;     // characters per item
  const HISTORY_SIZE = 5;
  const MIX_TIME = 1100;     // ms of mixing before the pick floats up
  const SHOW_TIME = 1500;    // ms the picked cube stays up

  const $ = id => document.getElementById(id);
  const el = {
    count: $('count'), result: $('result'), glass: $('glass'), hint: $('hint'), allowBtn: $('allowBtn'),
    listSelect: $('listSelect'), newListBtn: $('newListBtn'), renameListBtn: $('renameListBtn'), deleteListBtn: $('deleteListBtn'),
    form: $('addForm'), input: $('itemInput'), list: $('list'), empty: $('empty'),
    resetCountsBtn: $('resetCountsBtn'), clearBtn: $('clearBtn'),
    optRemove: $('optRemove'), optVibrate: $('optVibrate'), vibrateRow: $('vibrateRow'),
    historyBox: $('historyBox'), history: $('history')
  };

  const canVibrate = typeof navigator.vibrate === 'function';
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ----- Data -----
  // { lists: [{ id, name, items: [{ id, text, count }], history: [text] }], currentId, removeAfter, vibrate }
  let state = null;
  let busy = false;

  function newList(name, items) {
    return { id: uid(), name, items: (items || []).map(t => ({ id: uid(), text: t, count: 0 })), history: [] };
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.lists) && data.lists.length) { state = data; }
    } catch (e) { /* start fresh */ }
    if (!state) {
      // Bring over the list from the first version of the app, if there is one
      let oldItems = [], oldHistory = [], removeAfter = false, vibrate = true;
      try {
        const old = JSON.parse(localStorage.getItem(OLD_KEY));
        if (old) {
          oldItems = (old.items || []).filter(s => typeof s === 'string').slice(0, MAX_ITEMS);
          oldHistory = (old.history || []).filter(s => typeof s === 'string');
          removeAfter = old.removeAfter === true;
          vibrate = old.vibrate !== false;
        }
      } catch (e) { /* ignore */ }
      const first = newList('My list', oldItems);
      first.history = oldHistory.slice(0, HISTORY_SIZE);
      state = { lists: [first], currentId: first.id, removeAfter, vibrate };
      save();
    }
    if (!state.lists.find(l => l.id === state.currentId)) state.currentId = state.lists[0].id;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* app still works */ }
  }

  const current = () => state.lists.find(l => l.id === state.currentId);

  // ----- Fair random number (0 to n-1) -----
  function randomIndex(n) {
    if (window.crypto && crypto.getRandomValues) {
      const limit = Math.floor(4294967296 / n) * n;
      const buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // ----- Small UI helpers -----
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function setResult(text, isPlaceholder) {
    el.result.textContent = text;
    el.result.classList.toggle('is-placeholder', !!isPlaceholder);
    el.result.classList.remove('pop');
    if (!isPlaceholder) { void el.result.offsetWidth; el.result.classList.add('pop'); }
  }

  // In-app pop-up. input: true shows a text box. Resolves with text (or true), or null.
  function showDialog(o) {
    return new Promise(resolve => {
      const box = $('dialog'), form = $('dialogForm'), inp = $('dialogInput');
      const ok = $('dialogOk'), cancel = $('dialogCancel');
      $('dialogTitle').textContent = o.title;
      $('dialogText').textContent = o.text || '';
      inp.hidden = !o.input;
      inp.value = o.value || '';
      inp.placeholder = o.placeholder || '';
      ok.textContent = o.ok || 'OK';
      ok.classList.toggle('is-danger', !!o.danger);
      box.hidden = false;
      setTimeout(() => { if (o.input) { inp.focus(); inp.select(); } else ok.focus(); }, 60);
      const finish = v => {
        box.hidden = true;
        form.removeEventListener('submit', onOk);
        cancel.removeEventListener('click', onCancel);
        box.removeEventListener('click', onBg);
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const onOk = e => { e.preventDefault(); finish(o.input ? inp.value : true); };
      const onCancel = () => finish(null);
      const onBg = e => { if (e.target === box) finish(null); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
      form.addEventListener('submit', onOk);
      cancel.addEventListener('click', onCancel);
      box.addEventListener('click', onBg);
      document.addEventListener('keydown', onKey, true);
    });
  }
  const askText = o => showDialog(Object.assign({}, o, { input: true }));
  const askConfirm = o => showDialog(o).then(v => v !== null);

  // ----- The glass -----
  const glass = Glass.create(el.glass, { reducedMotion: reduceMotion });

  // ----- Rendering -----
  function render() {
    const list = current();
    const n = list.items.length;
    el.count.textContent = n === 1 ? '1 item' : n + ' items';

    // list picker
    el.listSelect.textContent = '';
    state.lists.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name + ' (' + l.items.length + ')';
      el.listSelect.appendChild(opt);
    });
    el.listSelect.value = list.id;

    // chips
    el.list.textContent = '';
    list.items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'chip';
      const span = document.createElement('span');
      span.className = 'chip-text';
      span.textContent = item.text;
      li.appendChild(span);
      if (item.count > 0) {
        const c = document.createElement('span');
        c.className = 'chip-count';
        c.textContent = item.count;
        c.setAttribute('aria-label', 'picked ' + item.count + (item.count === 1 ? ' time' : ' times'));
        c.title = 'Times picked';
        li.appendChild(c);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip-del';
      del.dataset.id = item.id;
      del.setAttribute('aria-label', 'Remove ' + item.text);
      del.textContent = '✕';
      li.appendChild(del);
      el.list.appendChild(li);
    });
    el.empty.hidden = n > 0;
    el.clearBtn.disabled = n === 0;
    el.resetCountsBtn.hidden = !list.items.some(i => i.count > 0);

    // history
    el.history.textContent = '';
    list.history.forEach(t => { const li = document.createElement('li'); li.textContent = t; el.history.appendChild(li); });
    el.historyBox.hidden = list.history.length === 0;

    glass.setItems(list.items);
  }

  function showReadyText() {
    const list = current();
    if (!list.items.length) setResult('Add a few items, then shake', true);
    else setResult(tapFallback ? 'Tap the glass to pick' : 'Shake to pick', true);
  }

  // ----- Items -----
  function addFromText(text) {
    const list = current();
    const parts = text.split(/[\n,]+/).map(s => s.trim().slice(0, MAX_LENGTH)).filter(Boolean);
    let added = 0;
    for (const t of parts) {
      if (list.items.length >= MAX_ITEMS) { toast('A glass holds up to ' + MAX_ITEMS + ' items.'); break; }
      list.items.push({ id: uid(), text: t, count: 0 });
      added++;
    }
    if (added) { save(); render(); if (!busy) showReadyText(); }
    return added;
  }

  // ----- Picking -----
  async function pick() {
    if (busy) return;
    const list = current();
    const n = list.items.length;
    if (!n) {
      setResult('Add at least one item first', true);
      glass.splash(el.glass.clientWidth / 2);
      el.input.focus();
      return;
    }
    busy = true;
    const winner = list.items[randomIndex(n)]; // decided now, revealed after mixing
    setResult('Mixing…', true);
    glass.stir(1);
    await wait(reduceMotion ? 0 : MIX_TIME);
    await glass.lift(winner.id);

    setResult(winner.text);
    if (state.vibrate && canVibrate) navigator.vibrate([30, 50, 70]);
    winner.count++;
    list.history.unshift(winner.text);
    list.history = list.history.slice(0, HISTORY_SIZE);
    save();
    render();

    await wait(reduceMotion ? 900 : SHOW_TIME);
    if (state.removeAfter && current() === list) {
      list.items = list.items.filter(i => i.id !== winner.id);
      save();
    }
    glass.release();
    render();
    busy = false;
  }

  // ----- Saved lists -----
  function switchList(id) {
    if (busy) { el.listSelect.value = state.currentId; return; }
    state.currentId = id;
    save();
    render();
    showReadyText();
  }

  async function createList() {
    if (busy) return;
    if (state.lists.length >= MAX_LISTS) { toast('You can keep up to ' + MAX_LISTS + ' lists.'); return; }
    const name = await askText({ title: 'New list', placeholder: 'For example: Lunch, Classmates, Chores', ok: 'Create' });
    if (name === null) return;
    const l = newList(name.trim().slice(0, 30) || 'List ' + (state.lists.length + 1));
    state.lists.push(l);
    switchList(l.id);
    el.input.focus();
  }

  async function renameList() {
    const list = current();
    const name = await askText({ title: 'Rename list', value: list.name, ok: 'Save' });
    if (name === null || !name.trim()) return;
    list.name = name.trim().slice(0, 30);
    save();
    render();
  }

  async function deleteList() {
    if (busy) return;
    const list = current();
    const what = list.items.length ? ' and its ' + list.items.length + (list.items.length === 1 ? ' item' : ' items') : '';
    if (!(await askConfirm({ title: 'Delete “' + list.name + '”?', text: 'This deletes the list' + what + '.', ok: 'Delete', danger: true }))) return;
    state.lists = state.lists.filter(l => l.id !== list.id);
    if (!state.lists.length) state.lists.push(newList('My list'));
    state.currentId = state.lists[0].id;
    save();
    render();
    showReadyText();
    toast('Deleted ' + list.name);
  }

  // ----- Events -----
  el.form.addEventListener('submit', e => {
    e.preventDefault();
    addFromText(el.input.value);
    el.input.value = '';
    autoGrow();
    el.input.focus();
  });
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
    if (!btn || busy) return;
    const list = current();
    list.items = list.items.filter(i => i.id !== btn.dataset.id);
    save();
    render();
    if (!list.items.length) showReadyText();
  });

  el.clearBtn.addEventListener('click', async () => {
    const list = current();
    if (!list.items.length || busy) return;
    if (!(await askConfirm({ title: 'Clear all ' + list.items.length + ' items?', text: 'The list “' + list.name + '” stays, but it will be empty.', ok: 'Clear', danger: true }))) return;
    list.items = [];
    save();
    render();
    showReadyText();
  });

  el.resetCountsBtn.addEventListener('click', async () => {
    const list = current();
    if (!(await askConfirm({ title: 'Reset pick counts?', text: 'Every item in “' + list.name + '” goes back to 0.', ok: 'Reset' }))) return;
    list.items.forEach(i => { i.count = 0; });
    save();
    render();
  });

  el.listSelect.addEventListener('change', () => switchList(el.listSelect.value));
  el.newListBtn.addEventListener('click', createList);
  el.renameListBtn.addEventListener('click', renameList);
  el.deleteListBtn.addEventListener('click', deleteList);

  el.optRemove.addEventListener('change', () => { state.removeAfter = el.optRemove.checked; save(); });
  el.optVibrate.addEventListener('change', () => { state.vibrate = el.optVibrate.checked; save(); });

  // ----- Shaking -----
  // Shaking is the only way to pick on a phone. Tapping the glass just splashes.
  // On devices with no motion sensor (laptops), tapping the glass picks instead.
  let sensorWorking = false;
  let tapFallback = false;

  function enableTapFallback(message) {
    if (sensorWorking) return;
    tapFallback = true;
    el.glass.classList.add('tappable');
    el.glass.setAttribute('role', 'button');
    el.glass.setAttribute('tabindex', '0');
    el.glass.setAttribute('aria-label', 'Pick an item');
    el.hint.textContent = message;
    if (!busy) showReadyText();
  }

  function shakeReady() {
    sensorWorking = true;
    tapFallback = false;
    el.glass.classList.remove('tappable');
    el.glass.setAttribute('role', 'img');
    el.glass.removeAttribute('tabindex');
    el.glass.setAttribute('aria-label', 'A glass of water with one ice cube for each item');
    el.allowBtn.hidden = true;
    el.hint.textContent = 'Shake your phone to pick';
    if (!busy) showReadyText();
  }

  el.glass.addEventListener('click', e => {
    if (tapFallback) { pick(); return; }
    const rect = el.glass.getBoundingClientRect();
    glass.splash(e.clientX - rect.left);
  });
  el.glass.addEventListener('keydown', e => {
    if (tapFallback && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); }
  });

  const shakeStatus = Shake.init(pick, shakeReady, (ax, ay) => glass.motion(ax, ay));

  if (shakeStatus === 'needs-permission') {
    el.allowBtn.hidden = false;
    el.hint.textContent = 'Tap Allow shake once, then shake to pick';
  } else if (shakeStatus === 'insecure') {
    enableTapFallback('Shaking needs an https:// link. Tap the glass for now.');
  } else if (shakeStatus === 'unsupported') {
    enableTapFallback('No motion sensor found. Tap the glass to pick.');
  } else {
    // Phones send motion readings right away; if none arrive, it's probably a laptop.
    setTimeout(() => { if (!sensorWorking) enableTapFallback('No motion sensor found. Tap the glass to pick.'); }, 1500);
  }

  el.allowBtn.addEventListener('click', async () => {
    const ok = await Shake.requestPermission();
    if (ok) shakeReady();
    else el.hint.textContent = 'Shake is blocked. Allow Motion & Orientation Access in Settings > Safari, then reload.';
  });

  // ----- Start -----
  load();
  el.optRemove.checked = state.removeAfter;
  el.optVibrate.checked = state.vibrate;
  el.vibrateRow.hidden = !canVibrate; // iPhone browsers can't vibrate
  render();
  const h = current().history;
  if (h.length) setResult(h[0], false); else showReadyText();
  el.result.classList.remove('pop');

  // Offline support (works on https:// or localhost)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
