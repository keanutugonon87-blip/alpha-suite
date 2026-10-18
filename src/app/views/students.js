import { sb, db, watch, esc, toast, modal, skeleton, uuid, confirmDialog, peso } from '../core.js';
import { exportXLSX } from '../xlsx.js';
import { showMemberCards } from '../qr.js';

export async function mountStudents(el, ctx) {
  const canEdit = ctx.can('mayor', 'vice_mayor', 'secretary'), canQR = ctx.can('mayor', 'treasurer');
  const canCollect = ctx.can('mayor', 'treasurer');
  let q = '', rows = [], pins = new Map(), owes = new Map();
  el.innerHTML = skeleton(6);

  function paint() {
    const shown = rows.filter(r => !q || (r.full_name + r.student_no).toLowerCase().includes(q.toLowerCase()));
    const pend = rows.filter(r => r.status === 'pending' || /^PENDING/i.test(r.student_no)).length;
    el.innerHTML = `<div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>Active students</small><b>${rows.filter(r => r.status === 'active').length}</b></div><div class="stat"><small>Missing Student ID</small><b>${pend}</b></div><div class="stat"><small>PIN set</small><b>${rows.filter(r => r.status === 'active' && pins.has(r.id)).length}</b></div></div>
      <div class="bar"><input id="q" class="grow" placeholder="Search name or ID…" value="${esc(q)}">${canEdit ? '<button class="btn gold" id="add">+ Add</button>' : ''}${canQR ? '<button class="btn" id="cards">QR cards</button>' : ''}<button class="btn ghost" id="csv">Excel</button></div>
      <div class="card">${shown.map(r => `<div class="row"><div class="m"><b>${esc(r.full_name)} ${r.status !== 'active' ? `<span class="tag warn">${r.status}</span>` : ''}</b>
        <small>${/^PENDING/i.test(r.student_no) ? '<span style="color:var(--bad)">ID to follow up</span>' : esc(r.student_no)}${r.section ? ' · ' + esc(r.section) : ''}${pins.has(r.id) ? ` · <span class="tag ${pins.get(r.id).locked ? 'bad' : 'ok'}" title="Signs in with Student ID and PIN">${pins.get(r.id).locked ? 'PIN locked' : 'PIN ✓'}</span>` : ''}</small></div>
        <div style="display:flex;gap:4px">${owes.has(r.id) ? `<span class="tag bad" title="Total still owed">owes ${peso(owes.get(r.id).total)}</span>` : ''}${canCollect && owes.has(r.id) ? `<button class="btn gold sm" data-col="${r.id}">Collect</button>` : ''}${canEdit ? `<button class="btn ghost sm" data-e="${r.id}">Edit</button>` : ''}</div></div>`).join('') || '<p class="empty">No students found.</p>'}</div>`;
    const qi = el.querySelector('#q'); qi.oninput = () => { q = qi.value; const p = qi.selectionStart; paint(); const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(p, p); };
    el.querySelector('#add')?.addEventListener('click', () => form(null));
    el.querySelector('#cards')?.addEventListener('click', () => showMemberCards().catch(e => toast(e.message, true)));
    el.querySelector('#csv').onclick = async () => {
      try { toast('Preparing Excel…'); await exportXLSX({ filename: 'Alpha-Student-Roster.xlsx', by: ctx.profile.full_name, sheets: [
        { name: 'Roster', title: 'Class Roster', subtitle: 'BSMT 1-Alpha · Batch 28 · PIT-COMED', summary: [['Active', rows.filter(r => r.status === 'active').length], ['Total listed', rows.length], ['ID to follow up', pend]],
          columns: [{ label: '#', get: r => rows.indexOf(r) + 1, type: 'int', width: 6 }, { label: 'Student ID', key: 'student_no', width: 18 }, { label: 'Name', key: 'full_name', width: 34 }, { label: 'Section', key: 'section', width: 24 }, { label: 'Status', get: r => /^PENDING/i.test(r.student_no) ? 'Pending' : r.status, type: 'status' }],
          rows: rows.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)) }] }); toast('Excel ready'); } catch (e) { toast(e.message, true); } };
    el.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { const o = owes.get(b.dataset.col); sessionStorage.setItem('alpha-prefill', JSON.stringify({ member: b.dataset.col, charge: o.charge, amount: o.owed })); location.hash = '#/staff/treasury'; });
    el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => form(rows.find(r => r.id === b.dataset.e)));
  }

  function form(s) {
    modal(`<h3>${s ? 'Edit' : 'Add'} student</h3><form id="sf"><label>Full name</label><input name="n" required value="${esc(s?.full_name)}">
      <label>Student ID</label><input name="i" required placeholder="26-0000-000" value="${esc(s?.student_no)}">
      <label>Section / group</label><input name="s" value="${esc(s?.section)}"><label>Status</label>
      <select name="st">${['active', 'pending', 'inactive'].map(x => `<option${(s?.status || 'active') === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button>${s && canQR ? '<button type="button" class="btn ghost" id="rv">Replace QR</button>' : ''}${s && canQR && pins.has(s.id) ? '<button type="button" class="btn ghost" id="rp">Reset PIN</button>' : ''}<button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#rv')?.addEventListener('click', async () => { if (!await confirmDialog('The old printed QR for this student will stop working. Their PIN is also cleared, so they set a new one with the new card.', { ok: 'Replace QR', title: 'Replace this QR code?' })) return;
        try { await db(sb.from('v2_members').update({ token_version: s.token_version + 1 }).eq('id', s.id)); await sb.rpc('v2_reset_member_pin', { p_member: s.id }).then(() => {}, () => {}); toast('QR replaced — print a new card'); close(); load().catch(() => {}); } catch (e) { m.querySelector('#er').textContent = e.message; } });
      m.querySelector('#rp')?.addEventListener('click', async () => { if (!await confirmDialog('The student signs in with the QR card, then sets a new PIN. A locked PIN is unlocked too.', { ok: 'Reset PIN', title: `Reset ${s.full_name}'s PIN?` })) return;
        try { await db(sb.rpc('v2_reset_member_pin', { p_member: s.id })); toast('PIN reset'); close(); load().catch(() => {}); } catch (e) { m.querySelector('#er').textContent = e.message; } });
      m.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        const row = { full_name: f.get('n').trim(), student_no: f.get('i').trim(), section: f.get('s').trim() || null, status: f.get('st'), updated_at: new Date().toISOString() };
        try { await db(s ? sb.from('v2_members').update(row).eq('id', s.id) : sb.from('v2_members').insert({ id: uuid(), ...row })); toast('Saved'); close(); }
        catch (x) { m.querySelector('#er').textContent = /duplicate/i.test(x.message) ? 'That Student ID is already used.' : x.message; } };
    });
  }
  async function load() {
    rows = await db(sb.from('v2_members').select('*').order('full_name'));
    owes = new Map(); (await sb.rpc('v2_balances').then(r => r.data || [], () => [])).filter(b => +b.owed > 0 && !b.waived).forEach(b => { const o = owes.get(b.member_id) || { total: 0, owed: 0, charge: null }; o.total += +b.owed; if (+b.owed > o.owed) { o.owed = +b.owed; o.charge = b.charge_id; } owes.set(b.member_id, o); });
    pins = new Map(await sb.rpc('v2_pin_members').then(r => (r.data || []).map(x => [x.member_id, x]), () => []));   // empty until the v6 SQL is run
    paint();
  }
  await load();
  return watch(['v2_members'], () => load().catch(() => {}));
}
