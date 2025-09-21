// ==== SW: maxpaint – robust uppdateringsstrategi ====
const CACHE_NAME = 'maxpaint-v1.20'; // <-- byt denna när du släpper ny version
const ASSETS = [
  'index.html',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'manifest.webmanifest'
];

// Hjälp: skicka diag/info till klienter
async function broadcast(msg){
  const clis = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  for (const c of clis) c.postMessage(msg);
}

self.addEventListener('install', (e) => {
  // Precache app-skalet
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE_NAME);
    await c.addAll(ASSETS);
    // OBS: vi SKIPPAR INTE waiting här; låt sidan styra takeover
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Rensa gamla cachenamn
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // Skicka version & diag
    await broadcast({
      type:'VERSION',
      cache: CACHE_NAME,
      scope: self.registration.scope,
      scriptURL: (self.registration.active && self.registration.active.scriptURL) || 'n/a'
    });
  })());
});

self.addEventListener('message', (event) => {
  const t = event.data?.type;
  if (t === 'SKIP_WAITING') self.skipWaiting();
  if (t === 'GET_VERSION') {
    const payload = { type:'VERSION', cache: CACHE_NAME, scope: self.registration.scope };
    if (event.ports?.[0]) event.ports[0].postMessage(payload);
    else event.source?.postMessage(payload);
  }
  if (t === '__DIAG') (async () => {
    const keys = await caches.keys();
    await broadcast({ type:'__DIAG_REPLY', keys, cache: CACHE_NAME, scope: self.registration.scope,
      scriptURL: (self.registration.active && self.registration.active.scriptURL) || 'n/a'
    });
  })();
});

// Viktigt: cachea ALDRIG sw.js i SW-cachen
function isSW(url){ try{ return new URL(url).pathname.endsWith('/sw.js'); }catch{return false;} }

// Navigeringar: nät först (bypass HTTP-cache), fallback till index.html
async function handleNavigate(req){
  try {
    const net = await fetch(req, { cache: 'reload' }); // tvinga färskt
    const c = await caches.open(CACHE_NAME);
    // Uppdatera index.html i cachen (hjälper offline nästa gång)
    const clone = net.clone();
    if (clone.ok) c.put('index.html', clone);
    return net;
  } catch {
    return (await caches.match('index.html')) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Låt alltid sw.js gå direkt till nätet / http-cache – inte via vår SW-cache
  if (isSW(req.url)) return;

  if (req.mode === 'navigate') {
    e.respondWith(handleNavigate(req));
    return;
  }

  // Övriga GET: network-first (no-store) → cache → fallback
  e.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-store' }); // bypass http-cache
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