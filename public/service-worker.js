const CACHE='playverse-v10-shell';
const SHELL=['/','/style.css','/app.js','/legal.css','/legal.js','/manifest.webmanifest','/terms','/privacy','/refund-policy','/shipping-policy','/pricing','/contact','/data-safety','/delete-account','/delete-account.js','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
const GAME_ROUTES=new Set(['/','/snakes','/tic-tac-toe','/word-search']);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/socket.io/')||url.pathname.startsWith('/api/')||url.pathname==='/config'||url.pathname==='/health')return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const copy=res.clone(),key=GAME_ROUTES.has(url.pathname)?'/':url.pathname;caches.open(CACHE).then(c=>c.put(key,copy));return res}).catch(async()=>await caches.match(GAME_ROUTES.has(url.pathname)?'/':url.pathname)||caches.match('/')));
    return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res})));
});
