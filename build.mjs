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
