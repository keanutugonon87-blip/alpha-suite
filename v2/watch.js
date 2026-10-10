import { sb, db, watch, esc, fmtDate, toast, modal } from './lib.js?v=1';

const FINE = 25;
const ordinal = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
const sanction = n => n === 1 ? '1st Offense: Verbal Warning' : `${ordinal(n)} Offense: Fine (₱${FINE})`;
const STATUS = { awaiting_approval:['awaiting approval','warn'], pending:['pending','bad'], resolve_requested:['resolve requested','warn'], resolve_forwarded:['awaiting VP approval','warn'], resolved:['resolved','ok'], rejected:['rejected',''] };

export async function mount(el, ctx) {
  const r = ctx.profile.role, name = ctx.profile.full_name;
  const canReport = ctx.can('mayor','vice_mayor','secretary','marshall','sails');
  const canApprove = ctx.can('mayor','vice_mayor');
  let tab = 'ledger', q = '';

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
      body = `<div class="bar"><input id="q" placeholder="Search student…" value="${esc(q)}" style="flex:1">${canReport ? '<button class="btn gold" id="add">+ Report</button>' : ''}</div>
        <div class="card">${shown.map(vrow).join('') || '<p class="empty">No records.</p>'}</div>`;
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
    el.querySelector('#addStd')?.addEventListener('click', () => newStandard());
    el.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { if (confirm('Remove this standard? Past records keep it.')) db(sb.from('v2_standards').update({ active: false }).eq('id', b.dataset.rs)).then(draw).catch(e => toast(e.message, true)); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const id = b.dataset.id, a = b.dataset.act;
      const patch = { approve:{ status:'pending' }, reject:{ status:'rejected' }, reqres:{ status:'resolve_requested', resolve_requested_by:`${r} ${name}` },
        forward:{ status:'resolve_forwarded', forwarded_by:`${r} ${name}` }, resolve:{ status:'resolved', resolved_by:`${r} ${name}` } }[a];
      try {
        if (a === 'del') { if (!confirm('Delete this record permanently?')) return; await db(sb.from('v2_violations').delete().eq('id', id)); }
        else await db(sb.from('v2_violations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
        toast('Updated'); } catch (e) { toast(e.message, true); } });
  }

  function report(members, standards) {
    modal(`<h3>Report a violation</h3><form id="rf"><label>Student</label><select name="m" required><option value="">Select…</option>${members.filter(m=>m.status==='active').map(m=>`<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}</select>
      <label>Standard</label><select name="s" required><option value="">Select…</option>${standards.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>
      <label>Date</label><input name="d" type="date" required value="${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})}">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Submit</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#rf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { await db(sb.from('v2_violations').insert({ member_id: f.get('m'), standard_id: f.get('s'), occurred_on: f.get('d'), reported_by: `${r} ${name}`, status: canApprove ? 'pending' : 'awaiting_approval' }));
            toast(canApprove ? 'Recorded' : 'Submitted for approval'); close(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
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
