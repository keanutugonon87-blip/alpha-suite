import { sb, db, watch, esc, toast, modal, skeleton, fmtDate, fmtDateTime, resizeImage, blobToDataUrl, confirmDialog } from '../core.js';
import { STAGES, progressBlock, photoStrip, wirePhotos } from './progress.js';

/* Procurement updates (Siglakas shirt, Nameplate and any other item bought from a SAILS contribution).
   The SAILS VP Internal posts them; Class Mayors, the SAILS President, Treasurer, Secretary and VP External read them.
   Run supabase/v71_procurement_updates.sql once. */
const like = s => s.replace(/[\\%_]/g, c => '\\' + c);

export async function mountProcurement(el, ctx, opts = {}) {
  const canPost = ctx.profile.role === 'vp_internal';
  let rows = [], photos = new Map(), setup = false;
  if (!opts.compact) el.innerHTML = skeleton(3);

  async function load() {
    const r = await sb.from('v2_procurement').select('*').order('created_at', { ascending: false }).limit(200);
    if (r.error) { setup = true; rows = []; } else { setup = false; rows = r.data || []; }
    photos = new Map();
    if (rows.length) {
      const p = await sb.from('v2_procurement_photos').select('id,update_id,image,caption,by_name,created_at').in('update_id', rows.map(x => x.id)).order('created_at').then(x => x.error ? [] : x.data || [], () => []);
      p.forEach(x => photos.set(x.update_id, [...(photos.get(x.update_id) || []), x]));
    }
    draw();
  }

  function draw() {
    if (setup) { el.innerHTML = '<div class="card"><p class="empty">Run the v71 SQL in Supabase to turn this on.</p></div>'; return; }
    const byItem = new Map(); rows.forEach(r => byItem.set(r.item, [...(byItem.get(r.item) || []), r]));
    const view = r => ({ ...r, amount: r.collected });
    const card = list => { const [last, ...older] = list;
      return `<div class="card" style="margin-bottom:12px"><div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(last.title)}</b><small>From the SAILS VP Internal${last.by_name ? ' · ' + esc(last.by_name) : ''} · ${fmtDateTime(last.created_at)}</small></div>${canPost ? `<div class="acts"><button class="btn ghost sm" data-ph-add="${last.id}">Photo</button><button class="btn ghost sm" data-del="${last.id}">Take down</button></div>` : ''}</div>
        ${progressBlock(view(last))}${last.note ? `<p style="margin:8px 0 0">${esc(last.note)}</p>` : ''}${photoStrip(photos.get(last.id))}</div>
        ${older.length ? `<details style="margin-top:8px"><summary><small>Earlier updates (${older.length})</small></summary>${older.map(o => `<div class="row" style="display:block"><b>${esc((STAGES.find(s => s[0] === o.stage) || [])[1] || o.stage)}</b><small class="muted" style="display:block">${fmtDateTime(o.created_at)}${o.eta ? ' · expected ' + fmtDate(o.eta + 'T00:00:00+08:00') : ''}${o.qty_total != null ? ` · ${o.qty_paid || 0} of ${o.qty_total} paid` : ''}</small>${o.note ? `<small style="display:block">${esc(o.note)}</small>` : ''}${photoStrip(photos.get(o.id))}${canPost ? `<div class="acts" style="margin-top:4px"><button class="btn ghost sm" data-del="${o.id}">Take down</button></div>` : ''}</div>`).join('')}</details>` : ''}</div>`; };
    el.innerHTML = `${opts.compact ? '<div class="bar"><b>Procurement updates from the SAILS VP Internal</b></div>' : `<p class="muted" style="margin:0 2px 8px">The SAILS VP Internal sends the updates on what is being bought from the SAILS contributions: Siglakas shirt, Nameplate and other items.</p>${canPost ? '<div class="bar"><span class="grow"></span><button class="btn gold sm" id="post">+ New update</button></div>' : ''}`}
      ${rows.length ? [...byItem.values()].map(card).join('') : '<div class="empty"><b>No updates yet</b>When the SAILS VP Internal posts one, it shows here.</div>'}`;
    wirePhotos(el, photos);
    const post = el.querySelector('#post'); if (post) post.onclick = newUpdate;
    el.querySelectorAll('[data-ph-add]').forEach(b => b.onclick = () => addPhoto(b.dataset.phAdd));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('Take this update down? Everyone will stop seeing it.', { ok: 'Take down', danger: true }))) return;
      try { await db(sb.rpc('v2_proc_delete', { p_id: b.dataset.del })); toast('Update removed'); load().catch(() => {}); } catch (e) { toast(e.message, true); }
    });
  }

  async function newUpdate() {
    const titles = await sb.from('v2_charges').select('title').order('title').then(x => x.error ? [] : [...new Set((x.data || []).map(c => c.title))], () => []);
    const extra = titles.filter(t => !/nameplate|siglakas/i.test(t));
    const opts2 = [['nameplate', 'Nameplate'], ['siglakas', 'Siglakas shirt'], ...extra.map(t => ['charge:' + t, t])];
    modal(`<h3>New procurement update</h3><form id="f"><label>Item</label><select name="k">${opts2.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')}</select>
      <label>Where is it now?</label><select name="s">${STAGES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
      <div class="twocol"><div><label>Total ordered</label><input name="t" type="number" min="0" step="1" inputmode="numeric" required></div><div><label>Paid so far</label><input name="p" type="number" min="0" step="1" inputmode="numeric" required></div></div>
      <div class="twocol"><div><label>Collected ₱</label><input name="c" type="number" min="0" step="0.01" inputmode="decimal"></div><div><label>Target ₱</label><input name="g" type="number" min="0" step="0.01" inputmode="decimal"></div></div>
      <label>Expected date (optional)</label><input name="e" type="date"><label>Note (optional)</label><textarea name="d" rows="3" maxlength="800" placeholder="Supplier, sizes still missing, problems"></textarea>
      <label>Photo (optional)</label><input name="i" type="file" accept="image/*">
      <button type="button" class="btn ghost sm" id="pull" style="margin-top:10px">Fill in from the collection records</button><p class="muted" id="hint" style="margin:6px 0 0"></p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const f = m.querySelector('#f'), put = (n, v) => { if (v != null) f.elements[n].value = v; };
      const label = () => f.elements.k.selectedOptions[0].textContent;
      const prefill = () => { const l = rows.find(a => a.item === f.elements.k.value); m.querySelector('#hint').textContent = l ? 'Started from the last update. Change what is new.' : ''; if (l) { put('s', l.stage); put('t', l.qty_total); put('p', l.qty_paid); put('c', l.collected); put('g', l.target); put('e', l.eta); } };
      f.elements.k.onchange = prefill; prefill();
      m.querySelector('#pull').onclick = async () => { const h = m.querySelector('#hint'); h.textContent = 'Reading the collection records of every section…';
        try { const k = f.elements.k.value, pat = k === 'nameplate' ? '%nameplate%' : k === 'siglakas' ? '%siglakas%' : like(k.replace(/^charge:/, ''));
          const r = await db(sb.rpc('v2_proc_figures', { p_pattern: pat }));
          if (!r.found) { h.textContent = 'No charge with that name was found in the Treasury yet. Type the figures.'; return; }
          put('t', r.members); put('p', r.paid); put('c', r.collected); put('g', r.target);
          h.textContent = `From the records of every section: ${r.paid} of ${r.members} paid, ₱${Number(r.collected).toLocaleString('en-PH')} confirmed${Number(r.pending) ? ` (₱${Number(r.pending).toLocaleString('en-PH')} more is not confirmed yet)` : ''}.`;
        } catch (x) { h.textContent = x.message; } };
      f.onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target), num = n => d.get(n) === '' ? null : Number(d.get(n)), b = m.querySelector('.btn.gold'); b.disabled = true;
        if (num('p') > num('t')) { m.querySelector('#er').textContent = 'Paid cannot be more than the total ordered.'; b.disabled = false; return; }
        try { const id = await db(sb.rpc('v2_proc_post', { p_item: d.get('k'), p_title: label(), p_stage: d.get('s'), p_total: num('t'), p_paid: num('p'), p_collected: num('c'), p_target: num('g'), p_eta: d.get('e') || null, p_note: d.get('d') }));
          const file = d.get('i'); if (file && file.size) await db(sb.from('v2_procurement_photos').insert({ update_id: id, image: await blobToDataUrl(await resizeImage(file, 1100, 0.7)) }));
          toast('Update sent'); close(); load().catch(() => {}); } catch (x) { m.querySelector('#er').textContent = x.message; b.disabled = false; } };
    });
  }

  function addPhoto(id) {
    modal(`<h3>Add a photo</h3><form id="f"><label>Photo (supplier receipt, sample, delivered stock)</label><input name="i" type="file" accept="image/*" capture="environment" required><label>What is it? (optional)</label><input name="c" maxlength="200">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Add</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), file = f.get('i'), b = m.querySelector('.btn.gold'); b.disabled = true;
        try { if (!file || !file.size) throw new Error('Choose a photo'); await db(sb.from('v2_procurement_photos').insert({ update_id: id, image: await blobToDataUrl(await resizeImage(file, 1100, 0.7)), caption: (f.get('c') || '').trim() || null })); toast('Photo added'); close(); load().catch(() => {}); }
        catch (x) { m.querySelector('#er').textContent = x.message; b.disabled = false; } };
    });
  }

  await load();
  return opts.compact ? () => {} : watch(['v2_procurement', 'v2_procurement_photos'], () => load().catch(() => {}));
}
