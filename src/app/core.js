/* Alpha Suite — core: database client, formatting, UI helpers, live updates,
   offline write queue, and exports. Everything else imports from here. */
import { createClient } from '@supabase/supabase-js';

export const sb = createClient('https://gxwgkbplscsduscoeoph.supabase.co', 'sb_publishable_m3l1Dxhwj6bIse-3UwBB4w_fqZXLuD0', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'alpha-auth' },
});

export const ROLE_LABEL = { pending: 'Pending', mayor: 'Mayor', vice_mayor: 'Vice Mayor', secretary: 'Secretary', treasurer: 'Treasurer',
  auditor: 'Auditor', marshall: 'Marshall', sails: 'SAILS Officer', pio: 'PIO' };
export const ROLES = Object.keys(ROLE_LABEL).filter(r => r !== 'pending');

/* ---- formatting ---- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const peso = n => { const v = Math.round((+n || 0) * 100) / 100; return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
const TZ = 'Asia/Manila';
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ }) : '—';
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—';
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const uuid = () => crypto.randomUUID();

/* ---- toast + modal ---- */
export function toast(msg, bad = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 3400);
}
export function modal(html, onMount) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  const close = () => m.remove();
  m.addEventListener('mousedown', e => { if (e.target === m) close(); });
  document.body.appendChild(m);
  onMount && onMount(m, close);
  return m;
}
export const skeleton = (n = 4) => Array.from({ length: n }, () => '<div class="skel"></div>').join('');

/* ---- sync status ---- */
let syncState = 'live', syncDetail = '';
const listeners = new Set();
export function onSync(fn) { listeners.add(fn); fn(syncState, syncDetail, queueSize()); return () => listeners.delete(fn); }
export function setSync(s, d = '') { syncState = s; syncDetail = d; listeners.forEach(f => f(s, d, queueSize())); }

/* Every database call goes through db(): real errors, no silent failures. */
export async function db(promise) {
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (syncState !== 'live') setSync('live');
    return data;
  } catch (e) {
    const msg = e?.message || String(e);
    const offline = !navigator.onLine || /failed to fetch|networkerror|load failed|network request/i.test(msg);
    setSync(offline ? 'offline' : 'error', msg);
    const err = new Error(offline ? 'No connection — your change was not saved.' : msg);
    err.offline = offline; throw err;
  }
}

/* ---- live updates: realtime + safety-net refresh ---- */
export function watch(tables, onChange) {
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
  const ch = sb.channel('w-' + tables.join('-') + '-' + Math.random().toString(36).slice(2, 7));
  tables.forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, fire));
  ch.subscribe();
  const vis = () => { if (document.visibilityState === 'visible') fire(); };
  document.addEventListener('visibilitychange', vis); window.addEventListener('online', fire);
  const iv = setInterval(fire, 45000);
  return () => { sb.removeChannel(ch); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', fire); clearInterval(iv); clearTimeout(timer); };
}

/* ---- offline write queue (entries, violations). Rows carry a client-made id, so a retry can never duplicate. ---- */
const QKEY = 'alpha-queue-v2';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full/blocked: queue stays in memory only for this call */ } };
export const queueSize = () => readQ().length;

export const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataUrlToBlob = async u => (await fetch(u)).blob();

async function sendWrite(item) {
  let row = { ...item.row };
  if (item.photo) {
    const path = `${row.id}.jpg`;
    const { error } = await sb.storage.from('v2-receipts').upload(path, await dataUrlToBlob(item.photo), { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    row.receipt_image = path;
  }
  await db(sb.from(item.table).upsert(row, { onConflict: 'id', ignoreDuplicates: true }));
}

/* Returns {queued:boolean}. Offline -> queued and retried automatically. Real errors (permissions, validation) are thrown. */
export async function safeWrite(table, row, photoBlob) {
  const item = { table, row, photo: photoBlob ? await blobToDataUrl(photoBlob) : null };
  try { await sendWrite(item); return { queued: false }; }
  catch (e) {
    if (!(e.offline || !navigator.onLine)) throw e;
    const q = readQ(); q.push(item); writeQ(q); setSync('offline', 'Saved on this device; will send when online'); return { queued: true };
  }
}
let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return; flushing = true;
  try {
    let q = readQ();
    while (q.length) {
      try { await sendWrite(q[0]); q.shift(); writeQ(q); toast('Sent a saved entry'); }
      catch (e) {
        if (e.offline) break;
        q.shift(); writeQ(q); toast('A saved entry was rejected: ' + e.message, true);   // permanent failure: don't block the rest
      }
    }
    setSync(queueSize() ? 'offline' : 'live');
  } finally { flushing = false; }
}
window.addEventListener('online', flushQueue);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushQueue(); });
setInterval(flushQueue, 30000);

/* ---- images ---- */
export function resizeImage(file, max = 900, q = 0.6) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('Could not process image')), 'image/jpeg', q);
    };
    img.onerror = () => rej(new Error('Not a valid image')); img.src = url;
  });
}

/* ---- exports ---- */
export function downloadCSV(filename, columns, rows) {
  const cell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const text = [columns.map(c => cell(c.label)).join(','), ...rows.map(r => columns.map(c => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function printHTML(title, body) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
  w.document.write(`<!doctype html><title>${esc(title)}</title><style>body{font-family:Inter,sans-serif;max-width:760px;margin:24px auto;padding:0 14px;color:#14141f}
   h1,h2{font-family:Georgia,serif}table{width:100%;border-collapse:collapse;margin:8px 0 18px}td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;font-size:13px}
   td.r,th.r{text-align:right}.row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #ddd}.sum{display:flex;gap:18px;flex-wrap:wrap}.sum div{border:1px solid #ccc;border-radius:8px;padding:8px 12px}</style>${body}`);
  w.document.close(); setTimeout(() => w.print(), 400);
}

/* ---- auth ---- */
export async function getProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('v2_profiles').select('*').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return { ...(data || { user_id: session.user.id, email: session.user.email, full_name: session.user.email, role: 'pending' }) };
}
