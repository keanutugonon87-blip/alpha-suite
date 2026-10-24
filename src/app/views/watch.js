import { sb, db, watch, esc, fmtDate, toast, modal, skeleton, safeWrite, uuid, todayISO, confirmDialog } from '../core.js';
import { exportXLSX } from '../xlsx.js';

const FINE = 25;
const ordinal = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
const sanction = n => n === 1 ? '1st Offense: Verbal Warning' : `${ordinal(n)} Offense: Fine (₱${FINE})`;
const STATUS = { awaiting_approval:['awaiting approval','warn'], pending:['pending','bad'], resolve_requested:['resolve requested','warn'], resolve_forwarded:['awaiting VP approval','warn'], resolved:['resolved','ok'], rejected:['rejected',''] };

export async function mountWatch(el, ctx) {
  const r = ctx.profile.role, name = ctx.profile.full_name;
  const canReport = ctx.can('mayor','vice_mayor','secretary','marshall','sails');
  const canApprove = ctx.can('mayor','vice_mayor');
  let tab = 'ledger', q = '';
  el.innerHTML = skeleton(5);

  async function draw() {
    const [members, standards, viol] = await Promise.all([
      db(sb.from('v2_members').select('id,full_name,section,status').order('full_name')),
      db(sb.from('v2_standards').select('*').eq('active', true).order('sort_order')),
      db(sb.from('v2_violations').select('*').order('created_at')),
    ]);
    const mname = id => members.find(m => m.id === id)?.full_name || '?';
    const std = id => standards.find(s => s.id === id);
    // Offense numbers are always computed fresh: every approved report counts, oldest first.
    const counted = viol.filter(v => !['awaiting_approval','rejected'].includes(v.status));
    const seen = {}, num = {};
    counted.forEach(v => { seen[v.member_id] = (seen[v.member_id] || 0) + 1; num[v.id] = seen[v.member_id]; });
    const open = viol.filter(v => ['pending','resolve_requested','resolve_forwarded'].includes(v.status));
    const awaiting = viol.filter(v => v.status === 'awaiting_approval');

    const vrow = v => { const [lbl, cls] = STATUS[v.status] || [v.status, '']; return `<div class="row"><div class="m"><b>${esc(mname(v.member_id))} <span class="tag ${cls}">${lbl}</span></b>
      <small>${esc(std(v.standard_id)?.title || 'Violation')} · ${fmtDate(v.occurred_on)} · ${num[v.id] ? sanction(num[v.id]) : 'awaiting approval'}${v.reported_by ? ` · by ${esc(v.reported_by)}` : ''}</small></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${actions(v)}</div></div>`; };
    function actions(v) {
      const a = [];
      if (v.status === 'awaiting_approval' && canApprove) a.push(`<button class="btn gold sm" data-act="approve" data-id="${v.id}">Approve</button><button class="btn ghost sm" data-act="reject" data-id="${v.id}">Reject</button>`);
      if (v.status === 'pending' && ctx.can('marshall','sails','mayor','vice_mayor','secretary')) a.push(`<button class="btn ghost sm" data-act="reqres" data-id="${v.id}">Request resolve</button>`);
      if (v.status === 'resolve_requested' && ctx.can('secretary','mayor','vice_mayor')) a.push(`<button class="btn ghost sm" data-act="forward" data-id="${v.id}">Forward to VP</button>`);
      if (v.status === 'resolve_forwarded' && canApprove) a.push(`<button class="btn gold sm" data-act="resolve" data-id="${v.id}">Resolve</button>`);
      if (ctx.can('mayor')) a.push(`<button class="btn ghost sm" data-act="del" data-id="${v.id}">Delete</button>`);
      return a.join('');
    }

    let body;
    if (tab === 'ledger') {
      const shown = viol.filter(v => !q || mname(v.member_id).toLowerCase().includes(q.toLowerCase())).slice().reverse();
      body = `<div class="bar"><input id="q" placeholder="Search student…" value="${esc(q)}" style="flex:1">${canReport ? '<button class="btn gold" id="add">+ Report</button><button class="btn ghost" id="insp">Inspect</button>' : ''}<button class="btn ghost" id="csv">Excel</button></div>
        ${awaiting.length || open.length ? '<p class="swipe-hint">Tip: on a phone, swipe a row right to approve or resolve it.</p>' : ''}<div class="card">${shown.map(vrow).join('') || '<p class="empty">No records.</p>'}</div>`;
    } else if (tab === 'standing') {
      const by = {}; open.forEach(v => by[v.member_id] = (by[v.member_id] || 0) + 1);
      body = `<div class="card">${members.filter(m => m.status === 'active').map(m => `<div class="row"><div class="m"><b>${esc(m.full_name)}</b><small>${esc(m.section || '')}</small></div>
        <span class="tag ${by[m.id] ? 'bad' : 'ok'}">${by[m.id] ? by[m.id] + ' outstanding' : 'clear'}</span></div>`).join('')}</div>`;
    } else {
      body = `<div class="bar">${ctx.can('mayor','vice_mayor') ? '<button class="btn gold" id="addStd">+ Standard</button>' : ''}</div><div class="card">${standards.map(s => `<div class="row"><div class="m"><b>${esc(s.title)}</b><small>${esc(s.rule)}</small></div>
        ${ctx.can('mayor','vice_mayor') ? `<button class="btn ghost sm" data-rs="${s.id}">Remove</button>` : ''}</div>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>Outstanding</small><b>${open.length}</b></div><div class="stat"><small>Awaiting approval</small><b>${awaiting.length}</b></div><div class="stat"><small>Total records</small><b>${viol.length}</b></div></div>
      <div class="bar"><button class="btn ${tab==='ledger'?'':'ghost'}" data-t="ledger">Ledger</button><button class="btn ${tab==='standing'?'':'ghost'}" data-t="standing">Standing</button><button class="btn ${tab==='standards'?'':'ghost'}" data-t="standards">Standards</button></div>${body}`;

    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    const qi = el.querySelector('#q'); if (qi) { qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw().then(() => { const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(pos, pos); }); }; }
    el.querySelector('#add')?.addEventListener('click', () => report(members, standards));
    el.querySelector('#insp')?.addEventListener('click', () => inspect(members, standards));
    el.querySelector('#csv')?.addEventListener('click', async () => {
      const counted2 = viol.filter(v => !['awaiting_approval', 'rejected'].includes(v.status));
      const byM = {}; counted2.forEach(v => { const o = byM[v.member_id] ||= { total: 0, open: 0 }; o.total++; if (v.status !== 'resolved') o.open++; });
      try { toast('Preparing Excel…'); await exportXLSX({ filename: `Alpha-Violation-Ledger-${new Date().toISOString().slice(0, 10)}.xlsx`, by: `${ctx.profile.full_name}`, sheets: [
        { name: 'Violation Ledger', title: 'Violation Ledger', subtitle: 'BSMT 1-Alpha · Alpha Watch', summary: [['Outstanding', open.length], ['Awaiting approval', awaiting.length], ['Resolved', viol.filter(v => v.status === 'resolved').length], ['Total records', viol.length]],
          columns: [{ label: 'Date', get: v => v.occurred_on, type: 'date' }, { label: 'Student', get: v => mname(v.member_id), width: 28 }, { label: 'Violation', get: v => std(v.standard_id)?.title, width: 28 }, { label: 'Offense', get: v => num[v.id] ? ordinal(num[v.id]) + ' offense' : '' },
            { label: 'Sanction', get: v => num[v.id] ? (num[v.id] === 1 ? 'Verbal warning' : `Fine ₱${FINE}`) : 'Awaiting approval' }, { label: 'Status', get: v => (STATUS[v.status] || [v.status])[0], type: 'status' }, { label: 'Reported by', key: 'reported_by', width: 22 }, { label: 'Resolved by', key: 'resolved_by', width: 22 }], rows: viol.slice().sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)) },
        { name: 'Standing', title: 'Class Standing', subtitle: 'Outstanding violations per student', summary: [['Active students', members.filter(m => m.status === 'active').length], ['With outstanding', Object.values(byM).filter(o => o.open).length]],
          columns: [{ label: 'Student', key: 'full_name', width: 30 }, { label: 'Section', key: 'section', width: 24 }, { label: 'Outstanding', get: m => byM[m.id]?.open || 0, type: 'int', total: true }, { label: 'All records', get: m => byM[m.id]?.total || 0, type: 'int', total: true }, { label: 'Standing', get: m => byM[m.id]?.open ? 'Outstanding' : 'Clear', type: 'status' }], rows: members.filter(m => m.status === 'active') }] }); toast('Excel ready'); }
      catch (e) { toast(e.message, true); } });
    el.querySelector('#addStd')?.addEventListener('click', () => newStandard());
    // swipe a row right to approve / resolve it (touch screens)
    el.querySelectorAll('.row').forEach(row => {
      const go = row.querySelector('[data-act=approve],[data-act=resolve]'); if (!go) return;
      let x0 = null, y0 = 0;
      row.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      row.addEventListener('touchmove', e => { if (x0 === null) return; const dx = e.touches[0].clientX - x0; if (Math.abs(e.touches[0].clientY - y0) < 30 && dx > 0) row.style.transform = `translateX(${Math.min(dx, 90)}px)`; }, { passive: true });
      row.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - (x0 ?? 0); row.style.transform = ''; if (x0 !== null && dx > 90) go.click(); x0 = null; });
    });
    el.querySelectorAll('[data-rs]').forEach(b => b.onclick = async () => { if (await confirmDialog('Past records keep it.', { ok: 'Remove standard', danger: true, title: 'Remove this standard?' })) db(sb.from('v2_standards').update({ active: false }).eq('id', b.dataset.rs)).then(draw).catch(e => toast(e.message, true)); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const id = b.dataset.id, a = b.dataset.act;
      const patch = { approve:{ status:'pending' }, reject:{ status:'rejected' }, reqres:{ status:'resolve_requested', resolve_requested_by:`${r} ${name}` },
        forward:{ status:'resolve_forwarded', forwarded_by:`${r} ${name}` }, resolve:{ status:'resolved', resolved_by:`${r} ${name}` } }[a];
      try {
        if (a === 'del') { if (!await confirmDialog('This record will be removed permanently.', { ok: 'Delete', danger: true })) return; await db(sb.from('v2_violations').delete().eq('id', id)); }
        else await db(sb.from('v2_violations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
        toast('Updated'); } catch (e) { toast(e.message, true); } });
  }

  const RK = 'alpha-recent-reports';
  const recent = () => { try { return JSON.parse(localStorage.getItem(RK) || '[]'); } catch { return []; } };
  const remember = (mi, si, members, standards) => { try {
    const l = `${(members.find(x => x.id === mi) || {}).full_name || ''} · ${(standards.find(x => x.id === si) || {}).title || ''}`, k = `${mi}|${si}`;
    localStorage.setItem(RK, JSON.stringify([[k, l], ...recent().filter(x => x[0] !== k)].slice(0, 4))); } catch { /* ignore */ } };
  function report(members, standards) {
    modal(`<h3>Report a violation</h3><form id="rf"><label>Student</label><select name="m" required><option value="">Select…</option>${members.filter(m=>m.status==='active').map(m=>`<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}</select>
      <label>Standard</label><select name="s" required><option value="">Select…</option>${standards.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>
      <div class="chips" id="rs">${recent().map(([k, l]) => `<button type="button" data-k="${k}">${esc(l)}</button>`).join('')}</div>
      <label>Date</label><input name="d" type="date" required value="${todayISO()}">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Submit</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelectorAll('#rs [data-k]').forEach(b => b.onclick = () => { const [mi, si] = b.dataset.k.split('|'); m.querySelector('[name=m]').value = mi; m.querySelector('[name=s]').value = si; });
        m.querySelector('#rf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { remember(f.get('m'), f.get('s'), members, standards); const res = await safeWrite('v2_violations', { id: uuid(), member_id: f.get('m'), standard_id: f.get('s'), occurred_on: f.get('d'), reported_by: `${r} ${name}`, status: canApprove ? 'pending' : 'awaiting_approval' });
            toast(res.queued ? 'No signal — saved on this device, will send automatically' : canApprove ? 'Recorded' : 'Submitted for approval'); close(); draw().catch(() => {}); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }
  // Inspection: pick one standard, tap the students who failed it, record them all at once.
  function inspect(members, standards) {
    const act = members.filter(m => m.status === 'active');
    modal(`<h3>Inspection</h3><p class="muted" style="margin:0 0 8px">Choose what you checked, then tap only the students who failed it.</p><form id="if">
      <label>Standard</label><select name="s" required><option value="">Select…</option>${standards.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>
      <label>Date</label><input name="d" type="date" required value="${todayISO()}">
      <div class="chips" id="il" style="max-height:42vh;overflow:auto;margin-top:10px">${act.map(m => `<button type="button" role="checkbox" aria-checked="false" data-m="${m.id}">${esc(m.full_name)}</button>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1" id="go">Record 0</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        const picked = new Set(), go = m.querySelector('#go'), upd = () => { go.textContent = `Record ${picked.size}`; };
        m.querySelectorAll('#il [data-m]').forEach(b => b.onclick = () => { const id = b.dataset.m, on = !picked.has(id); on ? picked.add(id) : picked.delete(id); b.setAttribute('aria-checked', on); b.classList.toggle('on', on); upd(); });
        m.querySelector('#if').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          if (!picked.size) return void (m.querySelector('#er').textContent = 'Tap at least one student, or close if everyone passed.');
          go.disabled = true; let queued = false, done = 0;
          try { for (const id of picked) { const res = await safeWrite('v2_violations', { id: uuid(), member_id: id, standard_id: f.get('s'), occurred_on: f.get('d'), reported_by: `${r} ${name}`, status: canApprove ? 'pending' : 'awaiting_approval' }); queued = queued || res.queued; done++; picked.delete(id); }
            toast(queued ? 'No signal. Saved on this device, will send automatically' : `${done} recorded${canApprove ? '' : ' for approval'}`); close(); draw().catch(() => {}); }
          catch (x) { go.disabled = false; upd(); m.querySelectorAll('#il [data-m]').forEach(b => { if (!picked.has(b.dataset.m)) { b.setAttribute('aria-checked', 'false'); b.classList.remove('on'); } }); m.querySelector('#er').textContent = `${done} saved before the error: ${x.message}. Only the rest are still selected.`; } }; });
  }
  function newStandard() {
    modal(`<h3>New standard</h3><form id="sf"><label>Title</label><input name="t" required><label>Rule</label><textarea name="r" rows="3"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { await db(sb.from('v2_standards').insert({ title: f.get('t'), rule: f.get('r'), sort_order: 999 })); toast('Added'); close(); draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }

  await draw();
  return watch(['v2_violations', 'v2_members', 'v2_standards'], () => draw().catch(() => {}));
}
