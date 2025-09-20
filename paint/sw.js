// Enkel offline-cache för MaxPaint
const CACHE_NAME = 'v1';
const ASSETS = [
  'index.html',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Network-first för allt dynamiskt, fallback till cache offline
self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req).then(m => m || caches.match('index.html')))
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'SKIP_WAITING') self.skipWaiting();

  if (msg?.type === 'GET_VERSION') {
    const payload = { type: 'VERSION', cache: CACHE_NAME };
    // Svara via MessageChannel om finns, annars direkt till källan
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
    else if (event.source) event.source.postMessage(payload);
  }
});