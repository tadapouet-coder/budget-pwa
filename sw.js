const CACHE_NAME = 'budget-pwa-v8';
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
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ne jamais intercepter OAuth / API Google : on évite les réponses obsolètes.
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com')) return;

  // Pour les fichiers de l'app, stratégie network-first :
  // dès qu'une nouvelle version est poussée sur GitHub, app.js/style.css/index.html sont repris du réseau.
  const isAppAsset = ASSETS.includes(url.pathname) || ASSETS.includes(e.request.url);
  if (isAppAsset || url.pathname.startsWith('/budget-pwa/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('/budget-pwa/index.html')))
    );
    return;
  }

  // Pour les ressources tierces : cache-first avec fallback réseau.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return resp;
    }))
  );
});

// Notifications push
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'Budget', body: 'Alerte budget' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/budget-pwa/icon-192.png',
    badge: '/budget-pwa/icon-192.png'
  }));
});
