/* Alpha Suite v2 — shared client library.
   One Supabase client, one login, live updates, and honest sync status. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const SUPABASE_URL = 'https://gxwgkbplscsduscoeoph.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_m3l1Dxhwj6bIse-3UwBB4w_fqZXLuD0';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'alpha-v2-auth' },
});

export const ROLE_LABEL = { pending:'Pending', mayor:'Mayor', vice_mayor:'Vice Mayor', secretary:'Secretary', treasurer:'Treasurer',
  auditor:'Auditor', marshall:'Marshall', sails:'SAILS Officer', pio:'PIO' };
export const ROLES = Object.keys(ROLE_LABEL).filter(r => r !== 'pending');

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const peso = n => { const v = Math.round((+n || 0) * 100) / 100; return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric', timeZone:'Asia/Manila' }) : '—';
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-PH', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZone:'Asia/Manila' }) : '—';

/* ---- toast ---- */
export function toast(msg, bad = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 3200);
}

/* ---- sync status chip: live / syncing / offline / error ---- */
let syncState = 'syncing', syncDetail = '';
const syncListeners = new Set();
export const onSync = fn => { syncListeners.add(fn); fn(syncState, syncDetail); return () => syncListeners.delete(fn); };
export function setSync(s, detail = '') { syncState = s; syncDetail = detail; syncListeners.forEach(f => f(s, detail)); }

/* Every database call goes through here: real error messages, no silent failures. */
export async function db(promise) {
  setSync('syncing');
  try {
    const { data, error } = await promise;
    if (error) throw error;
    setSync('live');
    return data;
  } catch (e) {
    const msg = e?.message || String(e);
    const offline = !navigator.onLine || /fetch|network|load failed/i.test(msg);
    setSync(offline ? 'offline' : 'error', msg);
    throw new Error(offline ? 'No connection — your change was NOT saved. Try again when online.' : msg);
  }
}

/* ---- live updates: realtime + safety-net refresh (focus, reconnect, every 45s) ---- */
export function watch(tables, onChange) {
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 250); };
  const ch = sb.channel('v2-' + tables.join('-') + '-' + Math.random().toString(36).slice(2, 7));
  tables.forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, fire));
  ch.subscribe();
  const onVis = () => { if (document.visibilityState === 'visible') fire(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', fire);
  const iv = setInterval(fire, 45000);
  return () => { sb.removeChannel(ch); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', fire); clearInterval(iv); clearTimeout(timer); };
}

/* ---- auth ---- */
export async function getProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('v2_profiles').select('*').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, session } : { user_id: session.user.id, email: session.user.email, full_name: session.user.email, role: 'pending', session };
}

/* ---- image: resize to a small JPEG blob ---- */
export function resizeImage(file, max = 900, q = 0.6) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('Could not process image')), 'image/jpeg', q);
    };
    img.onerror = () => rej(new Error('Not a valid image'));
    img.src = url;
  });
}
export const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

export function modal(html, onMount) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  onMount && onMount(m, () => m.remove());
  return m;
}
