const CACHE_NAME = 'budget-pwa-v2';
const APP_SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(() => null))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => { const req = event.request; if (req.method !== 'GET') return; event.respondWith(fetch(req).then(resp => { const copy = resp.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null); return resp; }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))); });
