// Offline support. App files: network first (so updates arrive right away), cached copy when offline.
// Google Fonts: cache first. Bump VERSION to force a fresh precache.
const VERSION = 'vf-2026-09-29a';
const APP = [
  './', 'index.html', 'css/style.css', 'manifest.json', 'icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'js/app.js', 'js/geom.js', 'js/construct.js', 'js/expr.js', 'js/data.js', 'js/exact.js',
  'js/boolean.js', 'js/links.js', 'js/commands.js', 'js/graphs.js', 'js/stats.js', 'js/puzzle.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'vf-fonts').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // fonts: cache first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('vf-fonts').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; } catch { return hit || Response.error(); }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // app files: network first, falling back to the cache (and to the app page for navigations)
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([fetch(req), timeout(4000)]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
      return Response.error();
    }
  })());
});
