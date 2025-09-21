// Enkel offline-cache för MaxPaint
const CACHE_NAME = 'maxpaint-v1.10';
const ASSETS = [
  'index.html',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(/* precache */);
  self.skipWaiting(); // gå direkt till activate
});

// i activate
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // rensa gamla caches...
    await self.clients.claim(); // TA ÖVER alla öppna flikar inom scope
  })());
});

// lägg till i message-handlaren:
self.addEventListener('message', (ev) => {
  const t = ev.data && ev.data.type;
  if (t === 'SKIP_WAITING') self.skipWaiting();
  if (t === 'CLAIM') {        // <- NYTT: explicit claim på begäran
    self.clients.claim();
    ev.source && ev.source.postMessage({ type:'CLAIMED' });
  }
});


/*
// Network-first för allt dynamiskt, fallback till cache offline
self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req).then(m => m || caches.match('/')))
  );
});*/

