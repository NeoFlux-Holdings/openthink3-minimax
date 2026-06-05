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
        keys.reduce((deletes, k) => {
          if (!k.startsWith(CACHE_VERSION)) deletes.push(caches.delete(k));
          return deletes;
        }, [])
      ))
      .then(() => self.clients.claim())
  );
});

const isApiRequest = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/thread/') ||
  url.hostname.includes('workers.dev') ||
  url.hostname.includes('exe.dev');

const isCacheableUrl = (url) =>
  url.protocol === 'http:' || url.protocol === 'https:';

const safePut = (cacheName, req, res) => {
  try {
    const url = new URL(req.url);
    if (!isCacheableUrl(url)) return;
    if (res.type !== 'basic' && res.type !== 'default') return;
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
  } catch {
    // ignore — Cache API rejects non-http(s) schemes, opaque responses, etc.
  }
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isApiRequest(url)) {
    // Network-first for API; cache only on success
    event.respondWith(
      fetch(req)
        .then((res) => {
          safePut(API_CACHE, req, res);
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
          if (res.ok) safePut(SHELL_CACHE, req, res);
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('/');
          return new Response('Offline', { status: 503 });
        });
    })
  );
});
