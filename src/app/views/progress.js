import { sb, db, esc, fmtDate, fmtDateTime, toast, modal, resizeImage, blobToDataUrl } from '../core.js';

/* Nameplate and Siglakas shirt progress reports: the Class Mayor sends them to the SAILS VP Internal.
   Shared by the Class Mayor's SAILS Report tab and the VP Internal's class screen. Run supabase/v61_class_treasurer_progress.sql once. */
export const ITEMS = { nameplate: 'Nameplate', siglakas: 'Siglakas shirt' };
export const STAGES = [['names', 'Collecting names and sizes'], ['payments', 'Collecting payments'], ['ordered', 'Order placed'], ['production', 'In production'], ['ready', 'Ready for pickup'], ['distributed', 'Distributed']];
export const isProgress = a => a.kind === 'nameplate' || a.kind === 'siglakas';
export const KIND = { funds: 'Class funds', activity: 'Activity', other: 'Other', ...ITEMS };
const peso = n => '₱' + Number(n).toLocaleString('en-PH');

export function progressBlock(a) {
  const at = STAGES.findIndex(s => s[0] === a.stage), pct = a.qty_total ? Math.min(100, Math.round((a.qty_paid || 0) / a.qty_total * 100)) : null;
  const money = a.target ? Math.min(100, Math.round((Number(a.amount) || 0) / Number(a.target) * 100)) : null;
  return `<div style="margin:8px 0 0">
    <div style="display:flex;gap:3px" aria-label="Stage ${at + 1} of ${STAGES.length}: ${esc(STAGES[at]?.[1] || '')}">${STAGES.map((s, i) => `<i style="flex:1;height:5px;border-radius:3px;background:${i <= at ? 'var(--gold, #d4a017)' : 'var(--line, #ddd)'}"></i>`).join('')}</div>
    <small class="muted" style="display:block;margin-top:4px">Stage ${at + 1} of ${STAGES.length}: ${esc(STAGES[at]?.[1] || '')}</small>
    ${pct !== null ? `<small style="display:block;margin-top:6px"><b>${a.qty_paid || 0}</b> of <b>${a.qty_total}</b> paid (${pct}%)${a.qty_total - (a.qty_paid || 0) > 0 ? ` · ${a.qty_total - (a.qty_paid || 0)} still to pay` : ' · everyone has paid'}</small>` : ''}
    ${a.amount != null ? `<small style="display:block;margin-top:2px">Collected <b>${peso(a.amount)}</b>${a.target ? ` of ${peso(a.target)} (${money}%)` : ''}</small>` : ''}
    ${a.eta ? `<small style="display:block;margin-top:2px">Expected ${fmtDate(a.eta + 'T00:00:00+08:00')}</small>` : ''}</div>`;
}

/* Photos on a progress report: the VP Internal adds them, the Class Mayor who sent the report sees them. */
export const loadPhotos = async ids => {
  if (!ids.length) return new Map();
  const r = await sb.from('v2_class_ask_photos').select('id,ask_id,image,caption,by_name,created_at').in('ask_id', ids).order('created_at').then(x => x.error ? [] : x.data || [], () => []);
  const m = new Map(); r.forEach(p => m.set(p.ask_id, [...(m.get(p.ask_id) || []), p])); return m;
};
export const photoStrip = list => list && list.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${list.map(p => `<button type="button" data-ph="${p.id}" aria-label="Photo${p.caption ? ': ' + esc(p.caption) : ''}" style="border:0;padding:0;background:none;cursor:pointer"><img src="${p.image}" alt="${esc(p.caption || 'Progress photo')}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;display:block"></button>`).join('')}</div>` : '';
export function wirePhotos(root, all) {
  const flat = [...all.values()].flat();
  root.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => { const p = flat.find(x => x.id === b.dataset.ph); if (!p) return;
    modal(`<img src="${p.image}" alt="${esc(p.caption || 'Progress photo')}" style="width:100%;border-radius:10px"><p style="margin:10px 0 0"><b>${esc(p.caption || 'Photo')}</b></p><small class="muted">${esc(p.by_name || 'SAILS VP Internal')} · ${fmtDateTime(p.created_at)}</small><div style="margin-top:12px"><button type="button" class="btn ghost" id="cx" style="width:100%">Close</button></div>`, (m, close) => { m.querySelector('#cx').onclick = close; }); });
}
export const addPhoto = (askId, done) => modal(`<h3>Add a photo</h3><form id="f"><label>Photo (receipt, sample, delivered stock)</label><input name="i" type="file" accept="image/*" capture="environment" required><label>What is it? (optional)</label><input name="c" maxlength="200" placeholder="Supplier receipt, sample shirt, delivered nameplates">
  <p class="muted" style="margin:8px 0 0">The Class Mayor who sent this report will be alerted.</p><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Add</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
  m.querySelector('#cx').onclick = close;
  m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), file = f.get('i'), b = m.querySelector('.btn.gold'); b.disabled = true;
    try { if (!file || !file.size) throw new Error('Choose a photo'); const image = await blobToDataUrl(await resizeImage(file, 1100, 0.7));
      await db(sb.from('v2_class_ask_photos').insert({ ask_id: askId, image, caption: (f.get('c') || '').trim() || null })); toast('Photo added'); close(); done && done(); }
    catch (x) { m.querySelector('#er').textContent = x.message; b.disabled = false; } };
});
