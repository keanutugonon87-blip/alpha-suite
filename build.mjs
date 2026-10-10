// Bundles src/app into one hashed JS + CSS file and writes index.html from the template.
// Run: npm install && npm run build   (commit the output; GitHub Pages serves it as-is)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
mkdirSync('assets/build', { recursive: true });
for (const f of readdirSync('assets/build')) rmSync('assets/build/' + f);
const r = await build({
  entryPoints: { app: 'src/app/main.js' }, bundle: true, format: 'esm', minify: true, target: 'es2020',
  outdir: 'assets/build', entryNames: '[name].[hash]', metafile: true, loader: { '.css': 'css' }, logLevel: 'error',
});
const outs = Object.keys(r.metafile.outputs).map(p => p.replace(/\\/g, '/'));
const js = outs.find(p => p.endsWith('.js')), css = outs.find(p => p.endsWith('.css'));
const html = readFileSync('src/index.template.html', 'utf8').replace('%JS%', js).replace('%CSS%', css);
writeFileSync('index.html', html);
console.log('built', js, css);

// Service worker: app shell works offline; data calls always go to the network.
const shell = ['./', 'index.html', js.replace(/^.*assets\//, 'assets/'), css.replace(/^.*assets\//, 'assets/'), 'assets/wolf-crest.png', 'assets/icon-192.png', 'manifest.webmanifest'];
const ver = js.match(/app\.([A-Z0-9]+)\.js/)[1];
writeFileSync('sw.js', `const V='alpha-${ver}',SHELL=${JSON.stringify(shell)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==V).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(x=>{const c=x.clone();caches.open(V).then(h=>h.put('index.html',c));return x}).catch(()=>caches.match('index.html')));return}
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(x=>{if(x.ok){const c=x.clone();caches.open(V).then(h=>h.put(r,c))}return x})))});
`);
