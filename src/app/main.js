import './styles.css';
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
  if (ev === 'SIGNED_OUT' && location.hash.startsWith('#/staff')) route();
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
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// Text size chosen by the reader (small / larger / largest), remembered on this phone
try { const z = localStorage.getItem('alpha-text'); if (z) document.documentElement.style.fontSize = z + '%'; } catch { /* ignore */ }
