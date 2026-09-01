/* Alpha Treasury — constants.js
   Static config (categories, roles) and pure formatting/helper functions.
   Nothing here touches state or the network. */

export const COLLECTION_CATEGORIES = ['Class Dues', 'Contribution', 'Fundraising', 'Donation', 'Other'];
export const EXPENSE_CATEGORIES = ['Supplies', 'Printing', 'Event Expenses', 'Transportation', 'Snacks / Food', 'Other'];
export const ROLES = ['mayor', 'vice_mayor', 'treasurer', 'auditor'];

export function roleLabel(role) {
  return role === 'mayor' ? 'Mayor' : role === 'vice_mayor' ? 'Vice Mayor' : role === 'treasurer' ? 'Treasurer' : 'Auditor';
}

/* ---- Password hashing (SHA-256, salted with username) ---- */
export async function hashPassword(username, password) {
  const enc = new TextEncoder();
  const data = enc.encode('alpha-treasury::' + String(username).trim().toLowerCase() + '::' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---- Formatting / display helpers ---- */
export function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }
export function nowTimeHHMM() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
export function formatDate(iso) { if (!iso) return '—'; const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
export function formatTime(t) {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return '';
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
export function formatDateTime(iso, t) { const time = formatTime(t); return time ? `${formatDate(iso)} · ${time}` : formatDate(iso); }
export function formatPeso(n) { const v = Math.round((n || 0) * 100) / 100; return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
export function initials(name) { return (name || '').split(' ').filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join(''); }
export function avatarHTML(person, extraStyle) {
  const style = extraStyle ? ` style="${extraStyle}"` : '';
  if (person && person.photo) {
    return `<div class="avatar"${style}><img src="${person.photo}" alt=""/></div>`;
  }
  return `<div class="avatar"${style}>${escapeHtml(initials(person ? person.name : '?'))}</div>`;
}
/* Resizes/compresses an uploaded image client-side before it's stored as a
   base64 data URL — keeps receipt photos from bloating the shared_data row.
   maxSize is the longest side in pixels. */
export function resizeImageFile(file, maxSize) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('Not an image')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
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
