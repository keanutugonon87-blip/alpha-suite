import { sb, db, esc, fmtDate, toast, modal, skeleton, todayISO, confirmDialog } from '../core.js';
/* Document tracker: letters, minutes, requests and forms move from Drafting to For signature to Submitted. */
const KINDS = { letter: 'Letter', minutes: 'Minutes', request: 'Request', form: 'Form', report: 'Report', other: 'Other' };
const STAGES = [['drafting', 'Drafting', 'for_signature', 'Send for signature'], ['for_signature', 'For signature', 'submitted', 'Mark submitted'], ['submitted', 'Submitted (last 30 days)', null, null]];

export async function mountDocs(el, ctx) {
  const canDelete = ctx.can('mayor', 'secretary');
  el.innerHTML = skeleton(4);
  let docs = [];
  const save = (d, patch) => db(sb.rpc('v2_doc_save', { p_id: d.id || null, p_title: patch.title ?? d.title, p_kind: patch.kind ?? d.kind, p_status: patch.status ?? d.status, p_due_on: (patch.due_on !== undefined ? patch.due_on : d.due_on) || null, p_note: (patch.note !== undefined ? patch.note : d.note) || null }));
  async function draw() {
    docs = (await db(sb.rpc('v2_docs_list'))) || []; const today = todayISO();
    const card = (d, next, label) => {
      const late = d.status !== 'submitted' && d.due_on && d.due_on < today, soon = !late && d.status !== 'submitted' && d.due_on && d.due_on <= new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      return `<div class="card pad" style="margin-bottom:8px"><div class="row" style="border:0;padding:0;align-items:flex-start"><div class="m"><b>${esc(d.title)}</b>
        <small>${KINDS[d.kind] || 'Other'}${d.due_on ? ` · due ${esc(fmtDate(d.due_on))}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</small></div>
        ${late ? '<span class="tag bad">Overdue</span>' : soon ? '<span class="tag warn">Due soon</span>' : ''}</div>
        <div class="acts" style="margin-top:8px">${next ? `<button class="btn gold sm" data-go="${d.id}" data-to="${next}">${label}</button>` : ''}<button class="btn ghost sm" data-edit="${d.id}">Edit</button></div></div>`;
    };
    const open = docs.filter(d => d.status !== 'submitted'), late = open.filter(d => d.due_on && d.due_on < today).length;
    el.innerHTML = `<div class="bar"><div style="flex:1"><h2 style="margin:0">Documents</h2><small class="muted">${open.length ? `${open.length} open${late ? `, ${late} overdue` : ''}` : 'Nothing open'}</small></div><button class="btn gold" id="add">+ Add</button></div>
      ${STAGES.map(([k, title, next, label]) => { const l = docs.filter(d => d.status === k); return `<h3 style="margin:16px 0 8px">${title} <small class="muted">${l.length}</small></h3>${l.length ? l.map(d => card(d, next, label)).join('') : '<p class="muted" style="margin:0">None.</p>'}`; }).join('')}`;
    el.querySelector('#add').onclick = () => edit({});
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => { b.disabled = true; try { await save(docs.find(x => x.id === b.dataset.go), { status: b.dataset.to }); toast(b.dataset.to === 'submitted' ? 'Marked submitted' : 'Sent for signature'); await draw(); } catch (x) { toast(x.message, true); b.disabled = false; } });
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(docs.find(x => x.id === b.dataset.edit)));
  }
  function edit(d) {
    modal(`<h3>${d.id ? 'Edit document' : 'Add a document'}</h3><form id="f"><label>Title</label><input name="title" required maxlength="100" value="${esc(d.title || '')}" placeholder="Letter to the Dean">
      <label>Kind</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${(d.kind || 'other') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label>Status</label><select name="status">${STAGES.map(s => `<option value="${s[0]}"${(d.status || 'drafting') === s[0] ? ' selected' : ''}>${s[1].replace(' (last 30 days)', '')}</option>`).join('')}</select>
      <label>Due date (optional)</label><input name="due" type="date" value="${esc(d.due_on || '')}">
      <label>Note (optional)</label><input name="note" maxlength="200" value="${esc(d.note || '')}" placeholder="Needs the adviser's signature">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="x">Cancel</button></div>
      ${d.id && canDelete ? '<button type="button" class="btn ghost" id="del" style="width:100%;margin-top:8px;color:var(--flag)">Delete this document</button>' : ''}<div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#x').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('button.gold'); btn.disabled = true;
        try { await save(d, { title: f.get('title'), kind: f.get('kind'), status: f.get('status'), due_on: f.get('due') || null, note: f.get('note') }); close(); toast('Saved'); await draw(); }
        catch (x) { btn.disabled = false; m.querySelector('#er').textContent = x.message; } };
      const del = m.querySelector('#del');
      if (del) del.onclick = async () => { if (!await confirmDialog('This removes it from the list for good.', { ok: 'Delete', danger: true, title: 'Delete this document?' })) return; try { await db(sb.rpc('v2_doc_delete', { p_id: d.id })); close(); toast('Deleted'); await draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  await draw();
}
