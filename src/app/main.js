import './styles.css';
import { sb, esc } from './core.js';
import { renderPublic } from './views/public.js';
import { renderReceipt } from './views/receipt.js';
import { renderStaff, showRecovery } from './views/staff.js';

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
    else if (a === 'staff') stop = await renderStaff(root, b);
    else stop = await renderPublic(root);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="auth"><div class="card"><b>Something went wrong.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`;
  }
}
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange(ev => {
  if (ev === 'PASSWORD_RECOVERY') { history.replaceState(null, '', '#/staff'); showRecovery(root); }
  if (ev === 'SIGNED_OUT' && location.hash.startsWith('#/staff')) route();
});
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
