const CACHE='grading-carte-images-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.destination!=='image')return;
  if(!['images.pokemontcg.io','images.ygoprodeck.com'].includes(u.hostname))return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(e.request);
    if(hit)return hit;
    const r=await fetch(e.request);
    if(r&&(r.ok||r.type==='opaque'))c.put(e.request,r.clone());
    return r;
  }));
});