const CACHE_NAME = 'aura-attend-cache-v3';
const urlsToCache = [
  '/',
  '/globals.css',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap'
];

// Install: Immediately skip waiting to take over and cache core shell
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Activate: Purge all older caches immediately (like aura-attend-cache-v1) and claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[ServiceWorker] Purging stale cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: NETWORK-FIRST for HTML navigation to ensure installed PWAs always load the newest version
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always bypass cache for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-First for HTML navigation / document requests
  const isNavigation = event.request.mode === 'navigate' || 
                       url.pathname === '/' || 
                       (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // If network is unreachable (offline), fallback to cache
          return caches.match(event.request)
            .then(cached => cached || caches.match('/'));
        })
    );
    return;
  }

  // Stale-while-revalidate for static assets (css, js, fonts)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});
