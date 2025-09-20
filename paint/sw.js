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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // --- VERSION ENDPOINT (måste vara först) ---
  const originOk = url.origin === self.location.origin;
  const isVersion = url.pathname === '/paint/version.txt' || url.pathname.endsWith('/version.txt');
  if (originOk && isVersion) {
    e.respondWith(new Response(CACHE_NAME, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
    }));
    return; // <-- superviktigt
  }

  // --- DIN BEFINTLIGA FETCH-STRATEGI (network-first) ---
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html')))
  );
});


self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // Broadcasta version till alla öppna fönster
    const clis = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const cli of clis) cli.postMessage({ type:'VERSION', cache: CACHE_NAME });
  })());
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

