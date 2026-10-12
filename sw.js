const V='alpha-3UT5UF6V',SHELL=["./","index.html","assets/build/app.3UT5UF6V.js","assets/build/app.LLWXQ2HG.css","assets/wolf-crest.png","assets/icon-192.png","manifest.webmanifest"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==V).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){}e.waitUntil(self.registration.showNotification(d.title||'Alpha ’28',{body:d.body||'',icon:'assets/icon-192.png',badge:'assets/favicon-32.png',data:{url:d.url||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c)return c.focus()}return clients.openWindow((e.notification.data&&e.notification.data.url)||'./')}))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(x=>{const c=x.clone();caches.open(V).then(h=>h.put('index.html',c));return x}).catch(()=>caches.match('index.html')));return}
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(x=>{if(x.ok){const c=x.clone();caches.open(V).then(h=>h.put(r,c))}return x})))});
