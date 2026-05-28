const CACHE = 'networth-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/styles.css',
        '/app.js',
        '/favicon.svg',
        '/manifest.json',
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
