import { sb, db, esc, fmtDate, toast, modal, skeleton, todayISO, confirmDialog, askText, uuid, SB_URL, SB_KEY } from '../core.js';
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
const FOLDER = '<svg class="drv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" fill="currentColor"/></svg>';
const when = iso => { try { return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
async function driveCall(action, extra = {}) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`${SB_URL}/functions/v1/drive-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${data.session?.access_token || ''}` }, body: JSON.stringify({ action, ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === 'not_configured' ? 'not_configured' : j.error || (r.status === 404 ? 'The Google Drive function is not deployed yet' : 'Google Drive did not answer'));
  return j;
}
const sizeText = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

export async function mountDocs(el, ctx) {
  const canManage = ctx.can('mayor', 'secretary');
  el.innerHTML = skeleton(4);
  let docs = [], folders = [], ds = null, here = null, syncing = false;   // here: null = top level, or the id of the open folder
  const folderName = id => (folders.find(f => f.id === id) || {}).name;
  const save = (d, patch) => db(sb.rpc('v2_doc_save', { p_id: d.id || null, p_title: patch.title ?? d.title, p_kind: patch.kind ?? d.kind, p_status: patch.status ?? d.status,
    p_due_on: (patch.due_on !== undefined ? patch.due_on : d.due_on) || null, p_note: (patch.note !== undefined ? patch.note : d.note) || null, p_folder: (patch.folder !== undefined ? patch.folder : d.folder_id) || null }));

  // Copy anything new to Google Drive. Quiet when nothing is linked. Loops because each call copies a limited number of files.
  async function syncDrive(announce = false) {
    if (!ds || !ds.linked || syncing) return; syncing = true; drawBar();
    try {
      let tot = { folders: 0, files: 0, failed: 0 };
      for (let i = 0; i < 6; i++) { const r = await driveCall('sync'); tot.folders += r.folders; tot.files += r.files; tot.failed += r.failed; if (!r.remaining || (!r.files && !r.folders)) break; }
      if (announce) toast(tot.failed ? `${tot.failed} could not be copied. Try again later.` : tot.folders + tot.files ? `Copied to Google Drive: ${tot.folders} folder${tot.folders === 1 ? '' : 's'}, ${tot.files} file${tot.files === 1 ? '' : 's'}` : 'Google Drive is up to date', !!tot.failed);
    } catch (x) { if (announce || /taken away|expired/.test(x.message)) toast(x.message, true); }
    finally { syncing = false; try { await draw(); } catch { /* stay on the current screen */ } }
  }
  function setupSteps() {
    modal(`<h3>Set up Google Drive (one time)</h3><ol style="padding-left:18px;margin:0;line-height:1.5">
      <li>Open <b>console.cloud.google.com</b>, make a project called “Alpha 28”.</li>
      <li><b>APIs & Services > Library</b>: turn on <b>Google Drive API</b>.</li>
      <li><b>OAuth consent screen</b> (Google Auth Platform): choose <b>External</b>, app name “Alpha 28”, add the scope <b>…/auth/drive.file</b>, then set it to <b>In production</b>. If you leave it in Testing, the link stops working after 7 days.</li>
      <li><b>Credentials > Create OAuth client ID > Web application</b>. Under Authorized redirect URIs add:<br><code style="word-break:break-all;user-select:all">${SB_URL}/functions/v1/drive-sync</code></li>
      <li>In Supabase, <b>Edge Functions > Secrets</b>: add <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b> from that client.</li>
      <li>Deploy the <b>drive-sync</b> function with <b>Verify JWT off</b>, run the v18 SQL, then tap <b>Link Google Drive</b> again.</li></ol>
      <p class="muted" style="margin:10px 0 0">Alpha ’28 only gets permission for files and folders it makes itself. It cannot see the rest of your Drive.</p>
      <button type="button" class="btn ghost" id="x" style="width:100%;margin-top:12px">Close</button>`, (m, close) => { m.querySelector('#x').onclick = close; });
  }
  async function link() {
    try { const r = await driveCall('connect'); location.href = r.url; }
    catch (x) { if (x.message === 'not_configured') setupSteps(); else toast(x.message, true); }
  }
  function drawBar() {
    const bar = el.querySelector('#dbar'); if (!bar) return;
    const mayor = ctx.can('mayor');
    if (!ds) { bar.innerHTML = mayor ? '<span class="muted">Google Drive copy is not switched on in the database yet. Run the v18 SQL.</span>' : ''; return; }
    if (!ds.linked) { bar.innerHTML = `<div class="m"><b>Google Drive</b><small>${mayor ? 'Not linked. Link it to keep a copy of every folder and file.' : 'Not linked. Ask the Mayor to link it.'}</small></div>${mayor ? '<button class="btn gold sm" id="dl">Link Google Drive</button>' : ''}`; bar.querySelector('#dl')?.addEventListener('click', link); return; }
    const wait = (ds.pending_folders || 0) + (ds.pending_files || 0);
    bar.innerHTML = `<div class="m"><b>${syncing ? 'Copying to Google Drive…' : wait ? `${wait} waiting to copy to Google Drive` : '✓ Copied to Google Drive'}</b>
      <small>${esc(ds.email || 'Linked')}${ds.last_sync ? ` · last copy ${esc(when(ds.last_sync))}` : ''}</small>${ds.last_error ? `<small style="color:var(--flag)">${esc(ds.last_error)}</small>` : ''}</div>
      <button class="btn ghost sm" id="ds"${syncing ? ' disabled' : ''}>Sync now</button>${mayor ? '<button class="btn ghost sm" id="du">Unlink</button>' : ''}`;
    bar.querySelector('#ds').onclick = () => syncDrive(true);
    bar.querySelector('#du')?.addEventListener('click', async () => { if (!await confirmDialog('Copies already in your Drive stay there. New folders and files stop being copied.', { ok: 'Unlink', danger: true, title: 'Unlink Google Drive?' })) return;
      try { await driveCall('unlink'); toast('Google Drive unlinked'); await draw(); } catch (x) { toast(x.message, true); } });
  }

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
    const [r, st] = await Promise.all([db(sb.rpc('v2_docs_list')), sb.rpc('v2_drive_status').then(x => (x.error ? null : x.data), () => null)]);
    docs = (r || {}).docs || []; folders = (r || {}).folders || []; ds = st;
    if (here && !folderName(here)) here = null;
    const today = todayISO(), soonCut = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const shown = docs.filter(d => (here ? d.folder_id === here : !d.folder_id));
    const inFolder = id => docs.filter(d => d.folder_id === id).length;
    const card = (d, next, label) => {
      const late = d.status !== 'submitted' && d.due_on && d.due_on < today, soon = !late && d.status !== 'submitted' && d.due_on && d.due_on <= soonCut;
      return `<div class="card pad" style="margin-bottom:8px"><div class="row" style="border:0;padding:0;align-items:flex-start"><div class="m"><b>${esc(d.title)}</b>
        <small>${KINDS[d.kind] || 'Other'}${d.due_on ? ` · due ${esc(fmtDate(d.due_on))}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</small></div>
        ${late ? '<span class="tag bad">Overdue</span>' : soon ? '<span class="tag warn">Due soon</span>' : ''}</div>
        ${d.files.length ? `<div class="chips">${d.files.map(f => `<button type="button" data-file="${f.id}" data-doc="${d.id}" title="${esc(f.name)} (${sizeText(f.size)})">📎 ${esc(f.name.length > 26 ? f.name.slice(0, 24) + '…' : f.name)}${ds && ds.linked ? (f.synced ? ' ✓' : ' …') : ''}</button>`).join('')}</div>` : ''}
        <div class="acts" style="margin-top:8px">${next ? `<button class="btn gold sm" data-go="${d.id}" data-to="${next}">${label}</button>` : ''}<button class="btn ghost sm" data-edit="${d.id}">Edit</button></div></div>`;
    };
    const openDocs = docs.filter(d => d.status !== 'submitted'), lateN = openDocs.filter(d => d.due_on && d.due_on < today).length;
    const sections = STAGES.map(([k, title, next, label]) => { const l = shown.filter(d => d.status === k); return l.length ? `<h3 style="margin:16px 0 8px">${title} <small class="muted">${l.length}</small></h3>${l.map(d => card(d, next, label)).join('')}` : ''; }).join('');
    const row = f => { const n = inFolder(f.id); return `<div class="drv-row" role="listitem"><button type="button" class="drv-open" data-open="${f.id}" aria-label="Open folder ${esc(f.name)}">${FOLDER}<span class="m"><b>${esc(f.name)}</b>
        <small>${n} document${n === 1 ? '' : 's'}${ds && ds.linked ? (f.failed ? ' · <span style="color:var(--flag)">could not copy to Drive</span>' : f.synced ? ' · in Google Drive' : ' · waiting for Google Drive') : ''}</small></span></button>
        ${canManage ? `<button type="button" class="drv-kebab" data-k="${f.id}" aria-label="Options for ${esc(f.name)}">⋮</button>` : ''}</div>`; };
    const cur = here ? folders.find(f => f.id === here) : null;
    el.innerHTML = `<div class="bar"><div style="flex:1"><h2 style="margin:0">Documents</h2><small class="muted">${openDocs.length ? `${openDocs.length} open${lateN ? `, ${lateN} overdue` : ''}` : 'Nothing open'}</small></div>${canManage && !here ? '<button class="btn ghost" id="nf">+ Folder</button>' : ''}<button class="btn gold" id="add">+ Document</button></div>
      <div class="card pad drv-bar" id="dbar"></div>
      ${cur ? `<nav class="crumbs" aria-label="Folder path"><button type="button" id="up">Documents</button><span aria-hidden="true">›</span><b>${esc(cur.name)}</b></nav>` : ''}
      ${here ? '' : `<div class="drv-list" role="list" aria-label="Folders">${folders.map(row).join('') || '<p class="muted" style="margin:8px 0">No folders yet.</p>'}</div>`}
      ${here ? '' : `<h3 style="margin:18px 0 0">Not in a folder</h3>`}${sections || `<p class="muted" style="margin:8px 0">${here ? 'No documents in this folder yet.' : 'Nothing here.'}</p>`}`;
    drawBar();
    el.querySelector('#add').onclick = () => edit({ folder_id: here });
    el.querySelector('#nf')?.addEventListener('click', newFolder);
    el.querySelector('#up')?.addEventListener('click', () => { here = null; draw().catch(() => {}); });
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { here = b.dataset.open; draw().catch(() => {}); window.scrollTo(0, 0); });
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => folderOptions(folders.find(f => f.id === b.dataset.k)));
    el.querySelectorAll('[data-file]').forEach(b => b.onclick = () => open(docs.find(x => x.id === b.dataset.doc).files.find(f => f.id === b.dataset.file)));
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = async () => { b.disabled = true; try { await save(docs.find(x => x.id === b.dataset.go), { status: b.dataset.to }); toast(b.dataset.to === 'submitted' ? 'Marked submitted' : 'Sent for signature'); await draw(); } catch (x) { toast(x.message, true); b.disabled = false; } });
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(docs.find(x => x.id === b.dataset.edit)));
  }
  async function newFolder() {
    const nm = await askText('New folder', 'Folder name', { ok: 'Create' }); if (!nm) return;
    try { await db(sb.rpc('v2_folder_save', { p_id: null, p_name: nm })); toast('Folder created'); await draw(); syncDrive(); } catch (x) { toast(x.message, true); }
  }
  function folderOptions(f) {
    modal(`<h3>${esc(f.name)}</h3><div style="display:grid;gap:8px"><button type="button" class="btn ghost" id="ren">Rename</button><button type="button" class="btn ghost" id="del" style="color:var(--flag)">Delete folder</button><button type="button" class="btn ghost" id="x">Cancel</button></div>
      <p class="muted" style="margin:10px 0 0">Deleting a folder keeps its documents. They move to “Not in a folder”. Copies already in Google Drive stay there.</p><div class="err" id="er"></div>`, (m, close) => {
      const fail = x => { m.querySelector('#er').textContent = x.message; };
      m.querySelector('#x').onclick = close;
      m.querySelector('#ren').onclick = async () => { close(); const nn = await askText('Rename folder', 'Name', { ok: 'Rename' }); if (!nn || nn.trim() === f.name) return;
        try { await db(sb.rpc('v2_folder_save', { p_id: f.id, p_name: nn })); toast('Renamed'); await draw(); syncDrive(); } catch (x) { toast(x.message, true); } };
      m.querySelector('#del').onclick = async () => { if (!await confirmDialog(`“${f.name}” is removed. Its documents stay.`, { ok: 'Delete folder', danger: true, title: 'Delete this folder?' })) return;
        try { await db(sb.rpc('v2_folder_delete', { p_id: f.id })); close(); toast('Folder deleted'); await draw(); } catch (x) { fail(x); } };
    });
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
          close(); toast(picked.length ? `Saved, ${n} of ${picked.length} file${picked.length === 1 ? '' : 's'} attached` : 'Saved'); await draw(); if (n || f.get('folder') !== (d.folder_id || '')) syncDrive();
        } catch (x) { btn.disabled = false; btn.textContent = 'Save'; m.querySelector('#er').textContent = x.message; } };
      const del = m.querySelector('#del');
      if (del) del.onclick = async () => { if (!await confirmDialog('The document and its attached files are removed for good.', { ok: 'Delete', danger: true, title: 'Delete this document?' })) return;
        try { const paths = await db(sb.rpc('v2_doc_delete', { p_id: d.id })); if (paths && paths.length) await sb.storage.from('v2-docs').remove(paths); close(); toast('Deleted'); await draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }

  await draw();
  try { const q = new URLSearchParams(location.search), r = q.get('drive');
    if (r) { history.replaceState(null, '', location.pathname + location.hash); if (r === 'ok') { toast('Google Drive linked'); await draw(); syncDrive(true); } else toast(`Google Drive was not linked${q.get('why') ? ': ' + q.get('why') : ''}`, true); } } catch { /* ignore */ }
}
