// Enkel offline-cache för MaxPaint
// sw.js
const CACHE_NAME = 'maxpaint-v1.10'; // byt denna för “appVersion”
const ASSETS = [
  'index.html',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'manifest.webmanifest'
];

// Install: cacha offline-resurser
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
  );
  // Viktigt: vi skippar väntan först när sidan säger till
  // (vi låter sidan styra meddelandeflödet)
});

// När en NY SW är installerad men waiting – berätta för klient(er)
self.addEventListener('install', () => {
  // Kan inte veta om det blir waiting direkt här; därför skickar vi även i 'statechange' från sidan.
});

// Activate: rensa gamla cacher + claim
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();

    // Broadcasta version till alla öppna fönster
    const clis = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const cli of clis) {
      cli.postMessage({ type:'VERSION', cache: CACHE_NAME });
    }
  })());
});

// Ta emot kommandon från sidan
self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();

  if (type === 'GET_VERSION') {
    const payload = { type:'VERSION', cache: CACHE_NAME };
    if (event.ports?.[0]) event.ports[0].postMessage(payload);
    else event.source?.postMessage(payload);
  }
});

// Fetch: network-first för GET; cachea bara OK-svar; fallback till index.html för navigering
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // låt POST mm gå direkt

  // Navigeringar: försök nätet, annars index.html
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        // Bypass HTTP cache för navigeringar
        const net = await fetch(req, { cache: 'reload' });
        const cache = await caches.open(CACHE_NAME);
        cache.put('index.html', net.clone());
        return net;
      } catch {
        return (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Övriga GET: network-first → cache; annars cache → fallback 404
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return (await caches.match(req)) || (await caches.match('index.html')) || Response.error();
    }
  })());
});

