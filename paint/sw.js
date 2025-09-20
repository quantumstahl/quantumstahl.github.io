// Enkel offline-cache för MaxPaint
const CACHE_NAME = 'v1.03';
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
    // Broadcasta version till alla öppna fönster
    const clis = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const cli of clis) cli.postMessage({ type:'VERSION', cache: CACHE_NAME });
  })());
});

// Svara när sidan frågar
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    const payload = { type:'VERSION', cache: CACHE_NAME };
    if (event.ports?.[0]) event.ports[0].postMessage(payload);
    else event.source?.postMessage(payload);
  }
});