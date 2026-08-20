// FeeZo Service Worker
// Strategy: network-first for the app shell (so users always get the latest
// code/bugfixes when online), cache-first for icons, offline fallback only
// when there's no network at all. This avoids the classic PWA trap where
// users get stuck on an old cached version of the app.

const CACHE_NAME = 'feezo-cache-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── INSTALL: pre-cache the app shell ──────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old cache versions ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for navigation/HTML, cache-first for icons ──
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests; let everything else (POST to Supabase, etc.) pass through
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept cross-origin requests (Supabase API, CDN scripts, fonts, etc.)
  // — always go to the network for those.
  if (url.origin !== self.location.origin) return;

  // App shell files: try network first (fresh code), fall back to cache when offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Save a copy of the latest successful response for offline use
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
