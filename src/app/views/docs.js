import { sb, db, esc, fmtDate, toast, modal, skeleton, todayISO, confirmDialog, askText, uuid } from '../core.js';
/* Document tracker: letters, minutes, requests and forms move from Drafting to For signature to Submitted.
   Documents sit in folders and can carry attached files (private storage, short-lived download links). */
const KINDS = { letter: 'Letter', minutes: 'Minutes', request: 'Request', form: 'Form', report: 'Report', other: 'Other' };
const STAGES = [['drafting', 'Drafting', 'for_signature', 'Send for signature'], ['for_signature', 'For signature', 'submitted', 'Mark submitted'], ['submitted', 'Submitted (last 30 days)', null, null]];
const MAX = 10 * 1024 * 1024;
const BY_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const mimeOf = f => BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || null;
const safeName = n => n.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80) || 'file';
const sizeText = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

export async function mountDocs(el, ctx) {
  const canManage = ctx.can('mayor', 'secretary');
  el.innerHTML = skeleton(4);
  let docs = [], folders = [], pick = 'all';   // pick: 'all', 'none', or a folder id
  const folderName = id => (folders.find(f => f.id === id) || {}).name;
  const save = (d, patch) => db(sb.rpc('v2_doc_save', { p_id: d.id || null, p_title: patch.title ?? d.title, p_kind: patch.kind ?? d.kind, p_status: patch.status ?? d.status,
    p_due_on: (patch.due_on !== undefined ? patch.due_on : d.due_on) || null, p_note: (patch.note !== undefined ? patch.note : d.note) || null, p_folder: (patch.folder !== undefined ? patch.folder : d.folder_id) || null }));

  async function open(file) {
    const w = window.open('', '_blank');   // opened first so phone browsers do not block it
    try { const { data, error } = await sb.storage.from('v2-docs').createSignedUrl(file.path, 120, { download: file.name }); if (error) throw error; if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl; }
    catch (x) { if (w) w.close(); toast(x.message, true); }
  }
  // Returns how many files went up; shows a message for the ones that did not.
  async function upload(docId, files) {
    let ok = 0; const bad = [];
    for (const f of files) {
      const mime = f.type || mimeOf(f);
      if (f.size > MAX) { bad.push(`${f.name} is over 10 MB`); continue; }
      if (!mime || !Object.values(BY_EXT).includes(mime)) { bad.push(`${f.name}: this file type is not allowed`); continue; }
      const path = `${docId}/${uuid()}-${safeName(f.name)}`;
      try {
        const up = await sb.storage.from('v2-docs').upload(path, f, { contentType: mime, upsert: false }); if (up.error) throw up.error;
        try { await db(sb.rpc('v2_doc_file_add', { p_doc: docId, p_path: path, p_name: f.name, p_size: f.size, p_mime: mime })); ok++; }
        catch (x) { await sb.storage.from('v2-docs').remove([path]); throw x; }
      } catch (x) { bad.push(`${f.name}: ${x.message}`); }
    }
    if (bad.length) toast(bad.join('. '), true);
    return ok;
  }

  async function draw() {
    const r = (await db(sb.rpc('v2_docs_list'))) || {}; docs = r.docs || []; folders = r.folders || [];
    if (pick !== 'all' && pick !== 'none' && !folderName(pick)) pick = 'all';
    const today = todayISO(), soonCut = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const shown = docs.filter(d => pick === 'all' || (pick === 'none' ? !d.folder_id : d.folder_id === pick));
    const count = id => docs.filter(d => id === 'all' || (id === 'none' ? !d.folder_id : d.folder_id === id)).length;
    const card = (d, next, label) => {
      const late = d.status !== 'submitted' && d.due_on && d.due_on < today, soon = !late && d.status !== 'submitted' && d.due_on && d.due_on <= soonCut;
      return `<div class="card pad" style="margin-bottom:8px"><div class="row" style="border:0;padding:0;align-items:flex-start"><div class="m"><b>${esc(d.title)}</b>
        <small>${KINDS[d.kind] || 'Other'}${d.folder_id ? ` · in ${esc(folderName(d.folder_id) || '')}` : ''}${d.due_on ? ` · due ${esc(fmtDate(d.due_on))}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</small></div>
        ${late ? '<span class="tag bad">Overdue</span>' : soon ? '<span class="tag warn">Due soon</span>' : ''}</div>
        ${d.files.length ? `<div class="chips">${d.files.map(f => `<button type="button" data-file="${f.id}" data-doc="${d.id}" title="${esc(f.name)} (${sizeText(f.size)})">📎 ${esc(f.name.length > 26 ? f.name.slice(0, 24) + '…' : f.name)}</button>`).join('')}</div>` : ''}
        <div class="acts" style="margin-top:8px">${next ? `<button class="btn gold sm" data-go="${d.id}" data-to="${next}">${label}</button>` : ''}<button class="btn ghost sm" data-edit="${d.id}">Edit</button></div></div>`;
    };
    const openDocs = docs.filter(d => d.status !== 'submitted'), lateN = openDocs.filter(d => d.due_on && d.due_on < today).length;
    const chip = (id, label) => `<button type="button" data-pick="${id}" role="radio" aria-checked="${pick === id}" class="${pick === id ? 'on' : ''}">${esc(label)} ${count(id)}</button>`;
    el.innerHTML = `<div class="bar"><div style="flex:1"><h2 style="margin:0">Documents</h2><small class="muted">${openDocs.length ? `${openDocs.length} open${lateN ? `, ${lateN} overdue` : ''}` : 'Nothing open'}</small></div><button class="btn gold" id="add">+ Add</button></div>
      <div class="chips pick" role="radiogroup" aria-label="Folders" style="margin:10px 0">${chip('all', 'All')}${folders.map(f => chip(f.id, f.name)).join('')}${chip('none', 'No folder')}${canManage ? '<button type="button" id="fm">Manage folders</button>' : ''}</div>
      ${STAGES.map(([k, title, next, label]) => { const l = shown.filter(d => d.status === k); return `<h3 style="margin:16px 0 8px">${title} <small class="muted">${l.length}</small></h3>${l.length ? l.map(d => card(d, next, label)).join('') : '<p class="muted" style="margin:0">None.</p>'}`; }).join('')}`;
    el.querySelector('#add').onclick = () => edit({ folder_id: ['all', 'none'].includes(pick) ? null : pick });
    el.querySelector('#fm')?.addEventListener('click', manageFolders);
    el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { pick = b.dataset.pick; draw().catch(() => {}); });
    el.querySelectorAll('[data-file]').forEach(b => b.onclick = () => open(docs.find(x => x.id === b.dataset.doc).files.find(f => f.id === b.dataset.file)));
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => { b.disabled = true; try { await save(docs.find(x => x.id === b.dataset.go), { status: b.dataset.to }); toast(b.dataset.to === 'submitted' ? 'Marked submitted' : 'Sent for signature'); await draw(); } catch (x) { toast(x.message, true); b.disabled = false; } });
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(docs.find(x => x.id === b.dataset.edit)));
  }

  function edit(d) {
    const files = d.files || [];
    modal(`<h3>${d.id ? 'Edit document' : 'Add a document'}</h3><form id="f"><label>Title</label><input name="title" required maxlength="100" value="${esc(d.title || '')}" placeholder="Letter to the Dean">
      <label>Folder</label><select name="folder"><option value="">No folder</option>${folders.map(f => `<option value="${f.id}"${d.folder_id === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      <label>Kind</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${(d.kind || 'other') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label>Status</label><select name="status">${STAGES.map(s => `<option value="${s[0]}"${(d.status || 'drafting') === s[0] ? ' selected' : ''}>${s[1].replace(' (last 30 days)', '')}</option>`).join('')}</select>
      <label>Due date (optional)</label><input name="due" type="date" value="${esc(d.due_on || '')}">
      <label>Note (optional)</label><input name="note" maxlength="200" value="${esc(d.note || '')}" placeholder="Needs the adviser's signature">
      <label>Attached files</label>
      ${files.length ? `<div id="fl">${files.map(f => `<div class="row" style="padding:6px 0"><div class="m"><b style="font-weight:600">${esc(f.name)}</b><small>${sizeText(f.size)}</small></div><button type="button" class="btn ghost sm" data-open="${f.id}">Open</button>${canManage ? `<button type="button" class="btn ghost sm" data-rm="${f.id}" style="color:var(--flag)">Remove</button>` : ''}</div>`).join('')}</div>` : ''}
      <input name="files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp" aria-label="Attach files">
      <small class="muted">PDF, Word, Excel, PowerPoint, text or photos. Up to 10 MB each, 10 files per document.</small>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="x">Cancel</button></div>
      ${d.id && canManage ? '<button type="button" class="btn ghost" id="del" style="width:100%;margin-top:8px;color:var(--flag)">Delete this document</button>' : ''}<div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#x').onclick = close;
      m.querySelectorAll('[data-open]').forEach(b => b.onclick = () => open(files.find(f => f.id === b.dataset.open)));
      m.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { const f = files.find(x => x.id === b.dataset.rm);
        if (!await confirmDialog(f.name, { ok: 'Remove file', danger: true, title: 'Remove this file?' })) return;
        try { const pth = (await db(sb.rpc('v2_doc_file_remove', { p_id: f.id }))); if (pth) await sb.storage.from('v2-docs').remove([pth]); close(); toast('File removed'); await draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('button.gold'); btn.disabled = true;
        try {
          const id = await save(d, { title: f.get('title'), kind: f.get('kind'), status: f.get('status'), due_on: f.get('due') || null, note: f.get('note'), folder: f.get('folder') || null });
          const picked = [...e.target.querySelector('[name=files]').files]; let n = 0;
          if (picked.length) { btn.textContent = 'Uploading…'; n = await upload(d.id || id, picked); }
          close(); toast(picked.length ? `Saved, ${n} of ${picked.length} file${picked.length === 1 ? '' : 's'} attached` : 'Saved'); await draw();
        } catch (x) { btn.disabled = false; btn.textContent = 'Save'; m.querySelector('#er').textContent = x.message; } };
      const del = m.querySelector('#del');
      if (del) del.onclick = async () => { if (!await confirmDialog('The document and its attached files are removed for good.', { ok: 'Delete', danger: true, title: 'Delete this document?' })) return;
        try { const paths = await db(sb.rpc('v2_doc_delete', { p_id: d.id })); if (paths && paths.length) await sb.storage.from('v2-docs').remove(paths); close(); toast('Deleted'); await draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }

  function manageFolders() {
    modal(`<h3>Folders</h3><p class="muted" style="margin:0 0 8px">Deleting a folder keeps its documents. They move to “No folder”.</p><div id="fl">${folders.map(f => `<div class="row" style="padding:6px 0"><div class="m"><b style="font-weight:600">${esc(f.name)}</b><small>${docs.filter(d => d.folder_id === f.id).length} documents</small></div><button type="button" class="btn ghost sm" data-ren="${f.id}">Rename</button><button type="button" class="btn ghost sm" data-delf="${f.id}" style="color:var(--flag)">Delete</button></div>`).join('') || '<p class="muted">No folders yet.</p>'}</div>
      <form id="nf" style="display:flex;gap:8px;margin-top:12px"><input name="n" required minlength="2" maxlength="40" placeholder="New folder name" aria-label="New folder name" style="flex:1"><button class="btn gold sm">Add</button></form>
      <button type="button" class="btn ghost" id="x" style="width:100%;margin-top:12px">Done</button><div class="err" id="er"></div>`, (m, close) => {
      const fail = x => { m.querySelector('#er').textContent = x.message; };
      m.querySelector('#x').onclick = close;
      m.querySelector('#nf').onsubmit = async e => { e.preventDefault(); try { await db(sb.rpc('v2_folder_save', { p_id: null, p_name: new FormData(e.target).get('n') })); close(); toast('Folder added'); await draw(); manageFolders(); } catch (x) { fail(x); } };
      m.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => { const f = folders.find(x => x.id === b.dataset.ren); const nn = await askText('Rename folder', 'Name', { ok: 'Rename' }); if (!nn || nn.trim() === f.name) return;
        try { await db(sb.rpc('v2_folder_save', { p_id: f.id, p_name: nn })); close(); toast('Renamed'); await draw(); manageFolders(); } catch (x) { fail(x); } });
      m.querySelectorAll('[data-delf]').forEach(b => b.onclick = async () => { const f = folders.find(x => x.id === b.dataset.delf);
        if (!await confirmDialog(`“${f.name}” is removed. Its documents stay.`, { ok: 'Delete folder', danger: true, title: 'Delete this folder?' })) return;
        try { await db(sb.rpc('v2_folder_delete', { p_id: f.id })); close(); toast('Folder deleted'); await draw(); manageFolders(); } catch (x) { fail(x); } });
    });
  }
  await draw();
}
