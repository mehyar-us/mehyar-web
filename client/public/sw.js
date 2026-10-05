// Public discovery shell only. Build script injects hashed entry assets/version.
const VERSION = 'discovery-dev';
const PRECACHE = ['/','/explore/','/offline.html','/manifest.webmanifest','/assets/mehyarsoft-mark-new-192.png','/assets/mehyarsoft-mark-new-512.png','/assets/mayor-avatar.webp'];
const CACHE = `mehyar-discovery-${VERSION}`;
const publicPages=new Set(['/','/explore','/mayor','/enterprise','/services','/industries','/pricing','/portfolio','/apps','/about','/blog','/privacy-policy','/terms','/data-deletion']);
const industries=['barbershops-salons','clinics-dentists','real-estate','restaurants-cafes','spas-fitness','home-services','professional-services','auto-services','pet-care','retail'];
industries.forEach(id=>publicPages.add(`/industries/${id}`));
const clean=path=>path==='/'?'/':path.replace(/\/$/,'');
const publicAsset=path=>/^\/assets\/[a-zA-Z0-9_./-]+\.(js|css|png|jpg|jpeg|webp|svg|woff2)$/.test(path)||path==='/manifest.webmanifest'||path==='/offline.html';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE))));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('mehyar-discovery-')||key.startsWith('mehyar-shell-'))&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.search)return;
  const page=request.mode==='navigate'&&publicPages.has(clean(url.pathname));
  const asset=request.mode!=='navigate'&&publicAsset(url.pathname);
  if(!page&&!asset)return; // APIs, private/transaction routes and unknown pages stay network-only.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{const response=await fetch(request);if(response.ok&&!response.headers.has('set-cookie'))await cache.put(request,response.clone());return response;}
    catch{const cached=await cache.match(request)||await cache.match(clean(url.pathname))||await cache.match(`${clean(url.pathname)}/`);if(cached)return cached;if(page)return await cache.match('/offline.html');return Response.error();}
  })());
});
