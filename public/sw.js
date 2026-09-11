const CACHE_NAME = 'aura-attend-cache-v5';
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

// Activate: Purge all older caches immediately and force-navigate any active clients
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
    })
    .then(() => self.clients.claim())
    .then(() => {
      // Find all running PWA windows / WebAPK clients and reload them so the new shell takes effect immediately
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    })
    .then(clients => {
      clients.forEach(client => {
        if ('navigate' in client && client.url) {
          client.navigate(client.url);
        } else if (client.postMessage) {
          client.postMessage({ type: 'FORCE_REFRESH_PWA' });
        }
      });
    })
  );
});

// Listen for explicit message triggers
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
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
