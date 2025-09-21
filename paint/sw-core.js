self.__MP_VERSION__ = self.__MP_VERSION__ || 'dev';
const CACHE_NAME = 'maxpaint-' + self.__MP_VERSION__;
const ASSETS = ['index.html','app.js','icons/icon-192.png','icons/icon-512.png','icons/icon-180.png','manifest.webmanifest'];

async function broadcast(msg){ const clis = await self.clients.matchAll({type:'window', includeUncontrolled:true}); for (const c of clis) c.postMessage(msg); }

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', e=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
    await broadcast({type:'VERSION', cache:CACHE_NAME, scope:self.registration.scope,
      scriptURL:self.registration.active?.scriptURL || 'n/a'});
  })());
});

self.addEventListener('message', ev=>{
  const t=ev.data?.type;
  if (t==='SKIP_WAITING') self.skipWaiting();
  if (t==='GET_VERSION'){
    const p={type:'VERSION', cache:CACHE_NAME, scope:self.registration.scope};
    (ev.ports?.[0] ? ev.ports[0] : ev.source).postMessage(p);
  }
  if (t==='__DIAG'){ (async ()=>{
    const keys = await caches.keys();
    await broadcast({type:'__DIAG_REPLY', keys, cache:CACHE_NAME, scope:self.registration.scope,
      scriptURL:self.registration.active?.scriptURL || 'n/a'});
  })(); }
});

function isSW(url){ try { return new URL(url).pathname.endsWith('/sw.js'); } catch { return false; } }

self.addEventListener('fetch', e=>{
  const r=e.request;
  if (r.method!=='GET') return;
  if (isSW(r.url)) return;

  if (r.mode==='navigate'){
    e.respondWith((async ()=>{
      try{
        const net=await fetch(r,{cache:'reload'});
        if(net.ok) (await caches.open(CACHE_NAME)).put('index.html', net.clone());
        return net;
      }catch{
        return (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async ()=>{
    try{
      const net=await fetch(r,{cache:'no-store'});
      if(net && net.ok) (await caches.open(CACHE_NAME)).put(r, net.clone());
      return net;
    }catch{
      return (await caches.match(r)) ||
             (await caches.match(r,{ignoreSearch:true})) ||
             (await caches.match('index.html')) || Response.error();
    }
  })());
});