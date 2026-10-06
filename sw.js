/* ===== ShakePick: offline support =====
   Saves the app files on the phone so it works without internet.
   IMPORTANT: after editing any file, change the version below (v1 -> v2)
   so phones download the new files. */
const CACHE = 'shakepick-v5';

const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './shake.js',
  './glass.js',
  './manifest.json',
  './icon.svg',
  './icon-512.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own copy, so updates are always fresh
  e.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Use the saved copy first; go online only for files not saved yet.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(saved => saved || fetch(e.request))
  );
});
