/* OpenThink PWA Service Worker
   - Cache-first for shell assets (HTML, CSS, JS, fonts, icons)
   - Network-first for API routes (Worker threads, brain proxy, etc.)
   - Falls back to cached shell when offline so the harness still boots
*/

const CACHE_VERSION = 'ot3-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_ASSETS = [
  '/',
  '/app',
  '/app-account',
  '/deploy',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isApiRequest = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/thread/') ||
  url.hostname.includes('workers.dev') ||
  url.hostname.includes('exe.dev');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isApiRequest(url)) {
    // Network-first for API; cache only on success
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Cache-first for shell + static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && (res.type === 'basic' || res.type === 'default')) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('/');
          return new Response('Offline', { status: 503 });
        });
    })
  );
});
