import { sb, db, watch, esc, toast, modal, resizeImage, blobToDataUrl, confirmDialog, askText } from '../core.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const bdText = o => (o.birth_month ? `${MONTHS[o.birth_month - 1]} ${o.birth_day}` : '');
const monthOpts = sel => `<option value="">—</option>${MONTHS.map((m, i) => `<option value="${i + 1}"${+sel === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}`;

/* the fields every profile has; the form is shared by the Mayor's direct edit and an officer's own submission */
const profileFields = (d = {}) => `<label>Term</label><input name="term" maxlength="80" placeholder="A.Y. 2026–2027" value="${esc(d.term)}">
  <label>In their words (short message to the class)</label><textarea name="bio" rows="3" maxlength="600">${esc(d.bio)}</textarea>
  <label>Leadership roles (one per line)</label><textarea name="credentials" rows="4" maxlength="1200" placeholder="SSG President, Libas NHS">${esc(d.credentials)}</textarea>
  <label>Trainings and awards (one per line)</label><textarea name="awards" rows="3" maxlength="1200">${esc(d.awards)}</textarea>
  <label>Birthday (optional)</label><div style="display:flex;gap:8px"><select name="bm" style="flex:2">${monthOpts(d.birth_month)}</select><input name="bd" type="number" min="1" max="31" placeholder="Day" style="flex:1" value="${d.birth_day || ''}"></div>
  <label class="ck" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" name="sb" ${d.show_birthday ? 'checked' : ''}> Show my birthday (month and day only) on the public page</label>`;
const readProfile = f => ({ term: f.get('term') || '', bio: f.get('bio') || '', credentials: f.get('credentials') || '', awards: f.get('awards') || '',
  birth_month: f.get('bm') ? +f.get('bm') : null, birth_day: f.get('bd') ? +f.get('bd') : null, show_birthday: f.get('sb') === 'on' });

export async function mountOfficers(el, ctx) {
  el.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  const can = ctx.can('mayor', 'vice_mayor', 'secretary', 'pio');
  const boss = ctx.can('mayor', 'vice_mayor');
  async function draw() {
    const rows = await db(sb.from('v2_officers').select('*').order('sort_order'));
    let mine = null, pend = [];
    try { mine = await db(sb.rpc('v2_my_officer')); } catch { /* profile feature not installed yet */ }
    if (boss) { try { pend = await db(sb.from('v2_officer_edits').select('*, v2_officers(full_name, position)').eq('status', 'pending').order('created_at')); } catch { /* ignore */ } }
    const mineBox = mine && mine.officer ? `<div class="card pad"><b>My public profile</b><p class="muted" style="margin:4px 0 10px">${mine.pending ? 'Your changes are waiting for the Mayor’s approval.' : mine.last_note && mine.last_note.status === 'rejected' ? `Your last change was not approved${mine.last_note.note ? `: ${esc(mine.last_note.note)}` : '.'}` : 'Add your leadership roles, trainings and awards. The Mayor approves changes before students see them.'}</p>
      <button class="btn gold" id="mine">${mine.pending ? 'Edit my pending changes' : 'Update my profile'}</button></div>` : '';
    const pendBox = pend.length ? `<div class="card pad pendbox"><b>Profile changes to review (${pend.length})</b>${pend.map(e => `<div class="rq" style="margin-top:10px"><div><b>${esc(e.v2_officers?.full_name)}</b> <small class="muted">${esc(e.v2_officers?.position)}</small></div>
        <small class="muted">${e.data.term ? esc(e.data.term) + ' · ' : ''}${e.data.credentials ? esc(e.data.credentials.split('\n').filter(Boolean).length) + ' roles · ' : ''}${e.data.awards ? esc(e.data.awards.split('\n').filter(Boolean).length) + ' awards · ' : ''}${e.data.bio ? 'bio' : ''}${e.data.show_birthday ? ' · birthday shown' : ''}</small>
        <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm" data-view="${e.id}">View</button><button class="btn gold sm" data-ok="${e.id}">Approve</button><button class="btn ghost sm" data-no="${e.id}">Reject</button></div></div>`).join('')}</div>` : '';
    el.innerHTML = `<div class="bar"><h2 style="flex:1;font-size:1.2rem">Officers</h2>${can ? '<button class="btn gold" id="add">+ Add</button>' : ''}</div>${pendBox}${mineBox}
      <div class="card">${rows.map(o => `<div class="row"><div class="officer"><div class="av">${o.photo ? `<img src="${o.photo}" alt="" style="object-position:${o.photo_pos_x}% ${o.photo_pos_y}%">` : esc(o.full_name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
        <div><b>${esc(o.full_name)}</b><br><small class="muted">${esc(o.position)}${o.user_id ? ' · account linked' : ''}</small></div></div>${can ? `<button class="btn ghost sm" data-e="${o.id}">Edit</button>` : ''}</div>`).join('')}</div>`;
    el.querySelector('#add')?.addEventListener('click', () => form(null, rows.length));
    el.querySelector('#mine')?.addEventListener('click', () => mineForm(mine));
    el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(rows.find(r => r.id === b.dataset.e), 0));
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const e = pend.find(x => x.id === b.dataset.view); modal(`<h3>${esc(e.v2_officers?.full_name)}</h3>
      <p><b>Term:</b> ${esc(e.data.term) || '—'}</p><p><b>In their words:</b><br>${esc(e.data.bio) || '—'}</p><p><b>Leadership roles:</b><br>${esc(e.data.credentials).replace(/\n/g, '<br>') || '—'}</p>
      <p><b>Trainings and awards:</b><br>${esc(e.data.awards).replace(/\n/g, '<br>') || '—'}</p><p><b>Birthday:</b> ${e.data.birth_month ? bdText(e.data) + (e.data.show_birthday ? ' (shown publicly)' : ' (hidden)') : '—'}</p>
      <button class="btn ghost" id="cx" style="width:100%">Close</button>`, (m, close) => { m.querySelector('#cx').onclick = close; }); });
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { b.disabled = true; try { await db(sb.rpc('v2_review_officer_edit', { p_id: b.dataset.ok, p_approve: true, p_note: '' })); toast('Approved. It is now public.'); draw(); } catch (x) { toast(x.message, true); b.disabled = false; } });
    el.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
      const note = await askText('Reject this change?', 'Reason (the officer will see it)', { ok: 'Reject' }); if (note == null) return;
      try { await db(sb.rpc('v2_review_officer_edit', { p_id: b.dataset.no, p_approve: false, p_note: note })); toast('Rejected'); draw(); } catch (x) { toast(x.message, true); } });
  }
  function mineForm(mine) {
    const d = mine.pending ? mine.pending.data : mine.officer;
    modal(`<h3>My public profile</h3><p class="muted" style="margin-top:0">${esc(mine.officer.full_name)} · ${esc(mine.officer.position)}</p><form id="mf">${profileFields(d)}
      <p class="muted" style="font-size:.85rem">Students see this only after the Mayor approves it.</p><div id="er" class="err"></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Submit for approval</button><button type="button" class="btn ghost" id="cx">Cancel</button></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#mf').onsubmit = async e => { e.preventDefault(); try { await db(sb.rpc('v2_submit_officer_edit', { p_data: readProfile(new FormData(e.target)) })); toast('Sent to the Mayor for approval'); close(); draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }
  async function form(o, n) {
    let accts = [];
    if (boss) { try { accts = await db(sb.from('v2_profiles').select('user_id,full_name,email,role').neq('role', 'pending').order('full_name')); } catch { /* ignore */ } }
    modal(`<h3>${o ? 'Edit' : 'Add'} officer</h3><form id="of"><label>Full name</label><input name="n" required value="${esc(o?.full_name)}"><label>Position</label><input name="p" required value="${esc(o?.position)}">
      <label>Photo</label><input name="i" type="file" accept="image/*">
      ${boss ? `<label>Linked account (lets this officer submit their own profile)</label><select name="u"><option value="">Not linked</option>${accts.map(a => `<option value="${a.user_id}"${o?.user_id === a.user_id ? ' selected' : ''}>${esc(a.full_name || a.email)} · ${esc(a.email)}</option>`).join('')}</select>${profileFields(o || {})}` : ''}
      <div id="er" class="err"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button>${o ? '<button type="button" class="btn danger" id="rm">Delete</button>' : ''}<button type="button" class="btn ghost" id="cx">Cancel</button></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#rm')?.addEventListener('click', async () => { if (!await confirmDialog('They will be removed from the public page.', { ok: 'Delete', danger: true, title: 'Delete this officer?' })) return; try { await db(sb.from('v2_officers').delete().eq('id', o.id)); toast('Deleted'); close(); draw(); } catch (x) { toast(x.message, true); } });
        m.querySelector('#of').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { const row = { full_name: f.get('n'), position: f.get('p'), updated_at: new Date().toISOString() };
            if (boss) { Object.assign(row, readProfile(f)); row.user_id = f.get('u') || null; }
            const file = f.get('i'); if (file && file.size) row.photo = await blobToDataUrl(await resizeImage(file, 400, 0.7));
            await db(o ? sb.from('v2_officers').update(row).eq('id', o.id) : sb.from('v2_officers').insert({ ...row, sort_order: n + 1 }));
            toast('Saved'); close(); draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }
  await draw();
  return watch(['v2_officers', 'v2_officer_edits'], () => draw().catch(() => {}));
}
