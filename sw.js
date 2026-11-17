/* Vela service worker — offline support for the app shell. */
const VERSION = '4.20.1';
const SHELL_CACHE = `vela-shell-${VERSION}`;
const CDN_CACHE = 'vela-cdn-v1';

const SHELL = [
  './',
  './index.html',
  './style.css?v=4.20.1',
  './app.js?v=4.20.1',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Versioned third-party files: safe to serve from cache forever.
const CDN = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
];
const CACHE_FIRST_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    // CDN files are best-effort: a failure here must not block installing the app.
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN.map((url) => cdn.add(new Request(url, { mode: 'cors' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CDN_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const putInCache = async (cacheName, request, response) => {
  if (!response || (!response.ok && response.type !== 'opaque')) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Page navigations: network first so updates arrive, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        event.waitUntil(putInCache(SHELL_CACHE, './index.html', response.clone()));
        return response;
      } catch (err) {
        return (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Shop and bank logos never change within a version: cache first, so lists draw them at once (and offline).
  if (url.origin === self.location.origin && url.pathname.includes('/logos/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      event.waitUntil(putInCache(SHELL_CACHE, request, response.clone()));
      return response;
    })());
    return;
  }

  // Our own files: network first, cache fallback.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        event.waitUntil(putInCache(SHELL_CACHE, request, response.clone()));
        return response;
      } catch (err) {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Fonts and pinned libraries: cache first.
  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      event.waitUntil(putInCache(CDN_CACHE, request, response.clone()));
      return response;
    })());
  }
  // Everything else (Supabase, exchange-rate API) goes straight to the network and is never cached.
});
