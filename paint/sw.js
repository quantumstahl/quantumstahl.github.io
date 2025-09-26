const CACHE_NAME = 'v1.9'; // <- this is what you'll show in the badge
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
self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req).then(m => m || caches.match('/')))
  );
});