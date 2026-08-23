const CACHE='playverse-v12-clean-reset-20260823-2220';
const SHELL=[
  '/',
  '/style-v12.css?v=12.0.0',
  '/app-v12.js?v=12.0.0',
  '/voice-worklet-v12.js?v=12.0.0',
  '/manifest-v12.webmanifest?v=12.0.0',
  '/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png',
  '/stickers/absolute-cinema.png','/stickers/hide-the-pain-harold.jpg','/stickers/ancient-aliens.jpg',
  '/stickers/two-buttons.jpg','/stickers/judging-cat.jpg','/stickers/drake.jpg','/stickers/this-is-fine.jpg',
  '/stickers/surprised-pikachu.jpg','/stickers/one-does-not-simply.jpg','/stickers/is-this-a-pigeon.jpg'
];
self.addEventListener('install',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.map(key=>caches.delete(key))))
      .then(()=>caches.open(CACHE))
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});
self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/socket.io/')||url.pathname.startsWith('/api/')||url.pathname==='/config'||url.pathname==='/health'||url.pathname==='/service-worker.js')return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put('/',copy))}return res}).catch(()=>caches.match('/')));
    return;
  }
  if(url.pathname.endsWith('.js')||url.pathname.endsWith('.css')||url.pathname.endsWith('.webmanifest')||url.pathname.includes('voice-worklet')){
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res}).catch(()=>caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res})));
});
