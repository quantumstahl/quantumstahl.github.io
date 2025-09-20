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
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// NYTT: svara på /paint/version.txt med din CACHE_NAME
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Anpassa path om din app ligger under /paint/
  if (url.origin === self.location.origin && url.pathname.endsWith('/paint/version.txt')) {
    e.respondWith(new Response(CACHE_NAME, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    }));
    return; // sluta här, övrig fetch hanteras som vanligt nedan
  }

  // ...din befintliga fetch-strategi här (network-first m.m.)
});

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
});

