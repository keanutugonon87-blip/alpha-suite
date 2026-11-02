import './styles.css';
import { applyDisplay } from './display.js';
applyDisplay();
import { sb, esc } from './core.js';
import { renderPublic } from './views/public.js';
import { renderReceipt } from './views/receipt.js';

const root = document.getElementById('root');
let stop = null;

async function route() {
  stop && stop(); stop = null;
  const h = location.hash.replace(/^#\/?/, '');
  if (/^(access_token|error|type=)/.test(h)) return;          // Supabase auth redirect; auth listener handles it
  const [a, b] = h.split('/');
  try {
    if (a === 'receipt' && b) stop = await renderReceipt(root, { code: b });
    else if (a === 'legacy' && b) stop = await renderReceipt(root, { legacy: b });
    else if (a === 'staff') stop = await (await import('./views/staff.js')).renderStaff(root, b);
    else stop = await renderPublic(root);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="auth"><div class="card"><b>Something went wrong.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`;
  }
}
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange(ev => {
  if (ev === 'PASSWORD_RECOVERY') { history.replaceState(null, '', '#/staff'); import('./views/staff.js').then(m => m.showRecovery(root)); }
  if (ev === 'SIGNED_OUT') route();
});
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;   // a first visit has none, so no "update" notice then
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.getElementById('upd')) return;
    const b = document.createElement('div'); b.id = 'upd'; b.className = 'updbar'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>A new version of Alpha ’28 is ready.</span><button class="btn gold sm">Refresh</button>';
    b.querySelector('button').onclick = () => location.reload(); document.body.appendChild(b);
  });
  // An app left open for days never reloads by itself, so ask the browser to look for a new version when it comes back to the front and every 20 minutes
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    const look = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
    setInterval(look, 20 * 60 * 1000);
  }).catch(() => {}));
}

