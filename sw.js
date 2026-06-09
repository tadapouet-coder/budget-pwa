const CACHE_NAME = 'budget-pwa-v27';
const ASSETS = [
  '/budget-pwa/',
  '/budget-pwa/index.html',
  '/budget-pwa/app.js',
  '/budget-pwa/style.css',
  '/budget-pwa/manifest.json',
  '/budget-pwa/icon-192.png',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Ne pas intercepter les appels API Google Sheets
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/budget-pwa/index.html'));
    })
  );
});

// Notifications push
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'Budget', body: 'Alerte budget' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/budget-pwa/icon-192.png', badge: '/budget-pwa/icon-192.png'
  }));
});
