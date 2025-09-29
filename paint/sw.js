const CACHE_NAME = 'v1.11d'; // <- this is what you'll show in the badge
const ASSETS = [
  'index.html',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'manifest.webmanifest'
];

// Install (optional pre-cache)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

// Activate: clean old caches + broadcast version
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();

    // Tell every window what version we are
    const clis = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cli of clis) {
      cli.postMessage({ type: 'VERSION', cache: CACHE_NAME });
    }
  })());
});

// Reply on demand
self.addEventListener('message', (ev) => {
  const t = ev.data && ev.data.type;
  if (t === 'SKIP_WAITING') self.skipWaiting();
  if (t === 'CLAIM') {
    self.clients.claim();
    ev.source && ev.source.postMessage({ type: 'CLAIMED' });
  }
  if (t === 'GET_VERSION') {
    ev.source && ev.source.postMessage({ type: 'VERSION', cache: CACHE_NAME });
  }
});

// Network-first with cache fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Bara GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navigationsförfrågningar (SPA)
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Cacha en kopia om ok
        if (fresh.ok) {
          const copy = fresh.clone();
          caches.open(CACHE_NAME).then(c => c.put('/index.html', copy)).catch(()=>{});
        }
        return fresh;
      } catch {
        // Offline fallback till cachad index
        const cached = await caches.match('/index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) Same-origin statik: stale-while-revalidate
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then(res => {
        // Cacha endast bra svar
        if (res.ok && res.type === 'basic') {
          cache.put(req, res.clone()).catch(()=>{});
        }
        return res;
      }).catch(() => null);

      // Ge cache snabbt, uppdatera i bakgrunden
      return cached || (await fetchPromise) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // 3) Cross-origin: låt nätet hantera; ingen caching
  // (Vill du lägga till särskild hantering för CDN-bilder etc, gör en
  // begränsad stale-while-revalidate här, men default är pass-through.)
});