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
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  // OBS: skipWaiting gör vi först när sidan ber om det
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    const clis = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const cli of clis) cli.postMessage({ type:'VERSION', cache: CACHE_NAME });
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    const payload = { type:'VERSION', cache: CACHE_NAME };
    if (event.ports?.[0]) event.ports[0].postMessage(payload);
    else event.source?.postMessage(payload);
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Låt POST/PUT m.m. gå rakt ut
  if (req.method !== 'GET') return;

  // Rör aldrig sw.js i SW-cachen
  const url = new URL(req.url);
  if (url.pathname.endsWith('/sw.js')) return;

  // Navigeringar: nät först (bypass HTTP-cache), annars cache-fallback
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req, { cache: 'reload' }); // bypass HTTP-cache
        const c = await caches.open(CACHE_NAME);
        c.put('index.html', net.clone());
        return net;
      } catch {
        return (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Övriga GET: network-first (no-store) → lägg i cache → fallback till cache
  e.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-store' }); // <- viktig bit
      if (net && net.ok) {
        const c = await caches.open(CACHE_NAME);
        c.put(req, net.clone());
      }
      return net;
    } catch {
      return (await caches.match(req)) || (await caches.match('index.html')) || Response.error();
    }
  })());
});