/* SAILS ’28 — core: database client, formatting, UI helpers, live updates,
   offline write queue, and exports. Everything else imports from here. */
import { createClient } from '@supabase/supabase-js';

export const SB_URL = 'https://gxwgkbplscsduscoeoph.supabase.co', SB_KEY = 'sb_publishable_m3l1Dxhwj6bIse-3UwBB4w_fqZXLuD0';
export const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'alpha-auth' },
});

export const ROLE_LABEL = { pending: 'Pending', mayor: 'Mayor', vp_internal: 'SAILS VP Internal', vp_external: 'SAILS VP External', secretary: 'SAILS Secretary', treasurer: 'SAILS Treasurer', class_treasurer: 'Class Treasurer', class_secretary: 'Class Secretary',
  auditor: 'SAILS Auditor', marshall: 'Class Marshal', pio: 'SAILS PIO', general_marshal: 'SAILS General Marshal', sails_president: 'SAILS President', dept_marshal: 'SAILS Marshal' };
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
  t.setAttribute('role', 'status'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 3400);
}
// Shows a message with an Undo button. onUndo runs if tapped within `ms`; onExpire runs when the time is up without Undo.
export function toastUndo(msg, onUndo, { ms = 6000, onExpire } = {}) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  clearTimeout(toast._t);
  t.setAttribute('role', 'status'); t.className = 'show'; t.textContent = '';
  const span = document.createElement('span'); span.textContent = msg + ' ';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'undo'; b.textContent = 'Undo';
  t.append(span, b); t.style.pointerEvents = 'auto';
  let done = false;
  const end = () => { t.className = ''; t.style.pointerEvents = ''; };
  const timer = setTimeout(() => { if (done) return; done = true; end(); onExpire && onExpire(); }, ms);
  b.onclick = () => { if (done) return; done = true; clearTimeout(timer); end(); onUndo && onUndo(); };
}
export function modal(html, onMount) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const sheet = m.firstElementChild, heading = sheet.querySelector('h1,h2,h3'); if (heading) { heading.id = heading.id || 'mh' + Math.random().toString(36).slice(2, 7); sheet.setAttribute('aria-labelledby', heading.id); }
  const prev = document.activeElement;
  const close = () => { document.removeEventListener('keydown', onKey); m.remove(); prev && prev.focus && prev.focus(); };
  const onKey = e => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;   // keep keyboard focus inside the open dialog
    const f = [...sheet.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  };
  m.addEventListener('mousedown', e => { if (e.target === m) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(m);
  const first = m.querySelector('input:not([type=file]),select,textarea,button'); first && first.focus && first.focus({ preventScroll: true });
  onMount && onMount(m, close);
  return m;
}
/* In-app replacements for confirm() / prompt(): resolve true/false and text/null. */
export function confirmDialog(message, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise(res => modal(`<h3>${esc(title)}</h3><p class="muted">${esc(message)}</p>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn ${danger ? 'danger' : 'gold'}" id="y" style="flex:1">${esc(ok)}</button><button class="btn ghost" id="n">Cancel</button></div>`, (m, close) => {
    m.querySelector('#y').onclick = () => { close(); res(true); }; m.querySelector('#n').onclick = () => { close(); res(false); };
    m.addEventListener('mousedown', e => { if (e.target === m) res(false); });
  }));
}
export function askText(title, label, { ok = 'Save', placeholder = '' } = {}) {
  return new Promise(res => modal(`<h3>${esc(title)}</h3><form id="f"><label>${esc(label)}</label><input name="v" required placeholder="${esc(placeholder)}">
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">${esc(ok)}</button><button type="button" class="btn ghost" id="n">Cancel</button></div></form>`, (m, close) => {
    m.querySelector('#f').onsubmit = e => { e.preventDefault(); const v = new FormData(e.target).get('v').trim(); close(); res(v || null); };
    m.querySelector('#n').onclick = () => { close(); res(null); };
    m.addEventListener('mousedown', e => { if (e.target === m) res(null); });
  }));
}
export const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const dayLabel = d => new Date(d).toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
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
const crestURL = () => new URL('assets/wolf-crest.png', location.href).href;
export const letterhead = (title, sub = 'PIT-COMED · Batch 28') => `<div class="lh"><img src="${crestURL()}" alt=""><div class="a">SEEKERS OF LOVE ADVENTURE INSPIRED BY THE LOVE OF THE SEA</div><div class="b">SAILS ’28</div><div class="c">PIT-COMED · Batch 28</div></div><h1 class="ttl">${esc(title)}</h1>${sub && sub !== 'PIT-COMED · Batch 28' ? `<div class="sub">${esc(sub)}</div>` : ''}`;
export function printHTML(title, body, { plain = false } = {}) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>
   @page{margin:14mm 14mm 16mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
   body{font-family:Georgia,"Times New Roman",serif;max-width:780px;margin:0 auto;padding:0 14px;color:#1a2a1f;position:relative}
   ${plain ? '' : `body:before{content:"";position:fixed;inset:0;background:url(${crestURL()}) center 55%/52% no-repeat;opacity:.06;z-index:-1}`}
   .lh{text-align:center;padding-bottom:10px;border-bottom:3px double #1c7a35;margin:6px 0 0}
   .lh img{width:84px;height:84px;object-fit:contain}
   .lh .a{font:700 10.5px Georgia,serif;letter-spacing:.32em;color:#8a6d00;margin-top:6px}.lh .b{font:700 13px Georgia,serif;color:#1c7a35;margin-top:2px;letter-spacing:.04em}.lh .c{font:11px Georgia,serif;color:#4a5a4e}
   h1.ttl{text-align:center;font:700 24px Georgia,serif;letter-spacing:.2em;text-transform:uppercase;color:#14532d;margin:18px 0 4px}
   .sub{text-align:center;font:italic 12.5px Georgia,serif;color:#4a5a4e;margin-bottom:14px}
   h1,h2{font-family:Georgia,serif;color:#14532d}h2{border-bottom:2px solid #f2c200;padding-bottom:3px;margin:22px 0 6px;font-size:16px;letter-spacing:.04em}
   table{width:100%;border-collapse:collapse;margin:6px 0 16px}th{background:#1c7a35;color:#fff;font:700 11.5px Georgia,serif;letter-spacing:.08em;text-transform:uppercase;border-bottom:3px solid #f2c200}
   td,th{padding:6px 8px;text-align:left;font-size:13px}td{border-bottom:1px solid #b9ccb9}tbody tr:nth-child(even) td,tr:nth-child(even) td{background:#f4f9f2}
   td.r,th.r{text-align:right}tr{break-inside:avoid}
   .row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #c9d8c9}
   .sum{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.sum div{flex:1;min-width:120px;background:#f7fbf5;border:1px solid #c9d8c9;border-left:5px solid #f2c200;border-radius:4px;padding:8px 12px;font-size:11.5px;color:#5a6b5e;text-transform:uppercase;letter-spacing:.06em}
   .sum b{display:block;font:700 18px Georgia,serif;color:#14532d;text-transform:none;letter-spacing:0;margin-top:2px}
   .foot{margin-top:28px;padding-top:8px;border-top:1px solid #c9d8c9;font-size:11px;color:#6a7a6e;display:flex;justify-content:space-between}
  </style>${body}${plain ? '' : `<div class="foot"><span>SAILS ’28 · PIT-COMED · Batch 28</span><span>${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>`}`);
  w.document.close(); setTimeout(() => w.print(), 700);
}

/* ---- auth ---- */
export async function getProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.user_metadata?.alpha_kind) return null;   // student and guest sessions are not officers
  const { data, error } = await sb.from('v2_profiles').select('*').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return { ...(data || { user_id: session.user.id, email: session.user.email, full_name: session.user.email, role: 'pending' }) };
}

/* ---- share (native sheet on phones, link copy elsewhere) ---- */
export async function share({ title, text, url }) {
  const data = { title, text, url: url || location.href };
  try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text ? text + ' ' : ''}${data.url}`); toast('Link copied'); } catch { toast(data.url); }
}

/* fund types: every collection and expense belongs to one of these (or is Unassigned) */
export const FUNDS = [{ k: 'class', label: 'Class Initiatives' }, { k: 'sails', label: 'SAILS Initiatives' }, { k: 'campus', label: 'Campus Wide Initiatives' }, { k: 'batch', label: 'Batch Project' }];
export const fundLabel = k => FUNDS.find(f => f.k === k)?.label || 'Unassigned';
export const fundOptions = (sel, blank = 'Unassigned') => `<option value="">${blank}</option>${FUNDS.map(f => `<option value="${f.k}"${f.k === sel ? ' selected' : ''}>${f.label}</option>`).join('')}`;

/* Turn a student <select> into a search-and-pick: type a name or Student ID and the list narrows (one match picks itself). */
export function studentSearch(sel, members) {
  if (!sel || sel.dataset.ss) return; sel.dataset.ss = '1';
  const label = m => m.full_name + (m.student_no && !/^PENDING/i.test(m.student_no) ? ' · ' + m.student_no : '');
  const keep = sel.value;
  const inp = document.createElement('input'); inp.type = 'search'; inp.placeholder = 'Type a name or Student ID…'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Search student by name or Student ID'); inp.style.marginBottom = '6px';
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  sel.parentNode.insertBefore(inp, sel);
  const fill = () => {
    const q = inp.value.trim().toLowerCase(), cur = sel.value, hits = members.filter(m => !q || (m.full_name + ' ' + (m.student_no || '')).toLowerCase().includes(q));
    const only = q && hits.length === 1;
    sel.innerHTML = (only ? '' : `<option value="">${hits.length ? 'Select… (' + hits.length + ')' : 'No match'}</option>`) + hits.slice(0, 200).map(m => `<option value="${m.id}">${esc(label(m))}</option>`).join('');
    if (only) sel.value = hits[0].id; else if (hits.some(m => m.id === cur)) sel.value = cur;
  };
  fill(); if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
}
