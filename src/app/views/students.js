import { sb, db, watch, esc, toast, modal, skeleton, downloadCSV, uuid } from '../core.js';
import { showMemberCards } from '../qr.js';

export async function mountStudents(el, ctx) {
  const canEdit = ctx.can('mayor', 'vice_mayor', 'secretary'), canQR = ctx.can('mayor', 'treasurer');
  let q = '', rows = [];
  el.innerHTML = skeleton(6);

  function paint() {
    const shown = rows.filter(r => !q || (r.full_name + r.student_no).toLowerCase().includes(q.toLowerCase()));
    const pend = rows.filter(r => r.status === 'pending' || /^PENDING/i.test(r.student_no)).length;
    el.innerHTML = `<div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>Active students</small><b>${rows.filter(r => r.status === 'active').length}</b></div><div class="stat"><small>Missing Student ID</small><b>${pend}</b></div></div>
      <div class="bar"><input id="q" class="grow" placeholder="Search name or ID…" value="${esc(q)}">${canEdit ? '<button class="btn gold" id="add">+ Add</button>' : ''}${canQR ? '<button class="btn" id="cards">QR cards</button>' : ''}<button class="btn ghost" id="csv">CSV</button></div>
      <div class="card">${shown.map(r => `<div class="row"><div class="m"><b>${esc(r.full_name)} ${r.status !== 'active' ? `<span class="tag warn">${r.status}</span>` : ''}</b>
        <small>${/^PENDING/i.test(r.student_no) ? '<span style="color:var(--bad)">ID to follow up</span>' : esc(r.student_no)}${r.section ? ' · ' + esc(r.section) : ''}</small></div>
        <div style="display:flex;gap:4px">${canEdit ? `<button class="btn ghost sm" data-e="${r.id}">Edit</button>` : ''}</div></div>`).join('') || '<p class="empty">No students found.</p>'}</div>`;
    const qi = el.querySelector('#q'); qi.oninput = () => { q = qi.value; const p = qi.selectionStart; paint(); const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(p, p); };
    el.querySelector('#add')?.addEventListener('click', () => form(null));
    el.querySelector('#cards')?.addEventListener('click', () => showMemberCards().catch(e => toast(e.message, true)));
    el.querySelector('#csv').onclick = () => downloadCSV('students.csv', [{ label: 'Student ID', key: 'student_no' }, { label: 'Name', key: 'full_name' }, { label: 'Section', key: 'section' }, { label: 'Status', key: 'status' }], rows);
    el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(rows.find(r => r.id === b.dataset.e)));
  }

  function form(s) {
    modal(`<h3>${s ? 'Edit' : 'Add'} student</h3><form id="sf"><label>Full name</label><input name="n" required value="${esc(s?.full_name)}">
      <label>Student ID</label><input name="i" required placeholder="26-0000-000" value="${esc(s?.student_no)}">
      <label>Section / group</label><input name="s" value="${esc(s?.section)}"><label>Status</label>
      <select name="st">${['active', 'pending', 'inactive'].map(x => `<option${(s?.status || 'active') === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button>${s && canQR ? '<button type="button" class="btn ghost" id="rv">Replace QR</button>' : ''}<button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#rv')?.addEventListener('click', async () => { if (!confirm('The old printed QR for this student will stop working. Continue?')) return;
        try { await db(sb.from('v2_members').update({ token_version: s.token_version + 1 }).eq('id', s.id)); toast('QR replaced — print a new card'); close(); } catch (e) { m.querySelector('#er').textContent = e.message; } });
      m.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        const row = { full_name: f.get('n').trim(), student_no: f.get('i').trim(), section: f.get('s').trim() || null, status: f.get('st'), updated_at: new Date().toISOString() };
        try { await db(s ? sb.from('v2_members').update(row).eq('id', s.id) : sb.from('v2_members').insert({ id: uuid(), ...row })); toast('Saved'); close(); }
        catch (x) { m.querySelector('#er').textContent = /duplicate/i.test(x.message) ? 'That Student ID is already used.' : x.message; } };
    });
  }
  async function load() { rows = await db(sb.from('v2_members').select('*').order('full_name')); paint(); }
  await load();
  return watch(['v2_members'], () => load().catch(() => {}));
}
