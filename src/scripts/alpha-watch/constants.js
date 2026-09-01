/* Alpha Watch — constants.js
   Static config (default standard, roles, fine amount) and pure
   formatting/display helpers. Nothing here touches state or the network. */

/* Path to the logo asset, relative to alpha-watch.html (the project root) */
export const LOGO_PATH = 'assets/logo.png';

/* ============== Default data ============== */
export const DEFAULT_STANDARD = [
  {id:'s1', title:'T-Shirt / Polo', local:'T-Shirt', rule:'Must be neatly pressed — no wrinkles or creases.', sanction:'1st Offense: Verbal Warning'},
  {id:'s2', title:'Nails', local:'Nails', rule:'Must be trimmed short, including the sides.', sanction:'1st Offense: Verbal Warning'},
  {id:'s3', title:'Belt', local:'Belt', rule:'Must be worn, clean, and polished to a shine.', sanction:'1st Offense: Verbal Warning'},
  {id:'s4', title:'Shoes', local:'Sapatos', rule:'Must be polished and shined.', sanction:'1st Offense: Verbal Warning'},
];

export const PUBLIC_OUTSTANDING_STATUSES = ['pending','resolve_requested','resolve_forwarded'];

/* ============== DEGREES OF VIOLATION ==============
   Progressive discipline policy: a student's 1st approved offense (combined
   across every checkpoint, not tracked separately per checkpoint) draws a
   verbal warning; every offense after that draws the same fixed fine.
   Nothing here is stored on the violation record — it's always computed
   fresh from the current ledger, so editing or removing an earlier record
   automatically renumbers everything that comes after it. */
export const REPEAT_OFFENSE_FINE = 25; // ₱ — fixed fine from the 2nd offense onward

export function ordinal(n){
  const rem100 = n % 100;
  if(rem100>=11 && rem100<=13) return n+'th';
  switch(n%10){
    case 1: return n+'st';
    case 2: return n+'nd';
    case 3: return n+'rd';
    default: return n+'th';
  }
}
export function offenseSanctionLabel(offenseNumber, waived){
  if(!offenseNumber) return 'Awaiting approval';
  if(offenseNumber===1) return '1st Offense: Verbal Warning';
  const base = `${ordinal(offenseNumber)} Offense: Fine (₱${REPEAT_OFFENSE_FINE})`;
  return waived ? `${base} — Waived` : base;
}

/* ============== Password hashing (SHA-256, salted with username) ============== */
export async function hashPassword(username, password){
  const enc = new TextEncoder();
  const data = enc.encode('alpha-watch::'+String(username).trim().toLowerCase()+'::'+password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function roleLabel(role){ return role==='mayor'?'Mayor':role==='marshall'?'Marshall':role==='sails'?'SAILS Officer':role==='vice_mayor'?'Vice Mayor':'Secretary'; }

/* Central status metadata so every screen renders workflow states consistently.
   Depends on ICON, so it's imported here rather than duplicated per screen. */
import { ICONS as ICON } from '../shared/icons.js';
export function statusMeta(status){
  switch(status){
    case 'resolved': return {label:'resolved', icon:ICON.check, cls:'resolved'};
    case 'awaiting_approval': return {label:'awaiting approval', icon:ICON.clock, cls:'awaiting'};
    case 'resolve_requested': return {label:'resolve requested', icon:ICON.send, cls:'resolvereq'};
    case 'resolve_forwarded': return {label:'awaiting VP approval', icon:ICON.send, cls:'forwarded'};
    default: return {label:'pending', icon:ICON.clock, cls:'pending'};
  }
}
export function statusChipHTML(v){
  const m = statusMeta(v.status);
  return `<span class="status-chip ${m.cls}">${m.icon}${m.label}</span>`;
}

export function formatPeso(n){ return '₱'+n.toLocaleString('en-PH'); }

/* ---- Formatting / display helpers ---- */
export function initials(name){ return (name||'').split(' ').filter(Boolean).slice(0,2).map(n=>n[0].toUpperCase()).join(''); }
export function avatarHTML(person, extraStyle){
  const style = extraStyle ? ` style="${extraStyle}"` : '';
  if(person && person.photo){
    return `<div class="avatar"${style}><img src="${person.photo}" alt=""/></div>`;
  }
  return `<div class="avatar"${style}>${escapeHtml(initials(person?person.name:'?'))}</div>`;
}
export function resizeImageFile(file, maxSize){
  return new Promise((resolve, reject)=>{
    if(!file.type || !file.type.startsWith('image/')){ reject(new Error('Not an image')); return; }
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('Could not read file'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('Could not load image'));
      img.onload = ()=>{
        let {width, height} = img;
        const scale = Math.min(1, maxSize/Math.max(width, height));
        width = Math.max(1, Math.round(width*scale));
        height = Math.max(1, Math.round(height*scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
export function escapeHtml(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function todayISO(){ const d=new Date(); return d.toISOString().slice(0,10); }
export function nowTimeHHMM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
export function formatDate(iso){ if(!iso) return '—'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
export function formatTime(t){
  if(!t) return '';
  const [hStr,mStr] = t.split(':');
  const h = parseInt(hStr,10), m = parseInt(mStr,10);
  if(isNaN(h)||isNaN(m)) return '';
  const period = h>=12 ? 'PM' : 'AM';
  const h12 = ((h+11)%12)+1;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}
export function formatDateTime(iso, t){
  const time = formatTime(t);
  return time ? `${formatDate(iso)} · ${time}` : formatDate(iso);
}
export function emptyState(title,sub,icon){ return `<div class="empty"><div class="empty-icon-wrap">${icon||ICON.clipboard}</div><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)}</span></div>`; }
export function todayLongDate(){
  return new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
}
