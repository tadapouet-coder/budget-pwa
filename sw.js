const CACHE_NAME = 'budget-pwa-v8';

const ASSETS = [
  '/budget-pwa/',
  '/budget-pwa/index.html',
  '/budget-pwa/style.css',
  '/budget-pwa/manifest.json',
  '/budget-pwa/icon-192.png',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ❌ Ne jamais intercepter OAuth / Google
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    return;
  }

  // ❌ Ne jamais cacher app.js
  if (url.pathname.endsWith('/app.js')) {
    return;
  }

  // ✅ Navigation HTML : toujours réseau d'abord
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/budget-pwa/index.html'))
    );
    return;
  }

  // ✅ Autres assets : cache-first
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached ||
      fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      })
    )
  );
});