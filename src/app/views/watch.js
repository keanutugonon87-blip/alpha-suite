import { t, getLang } from '../i18n.js';
import { studentSearch, sb, db, watch, esc, fmtDate, toast, modal, skeleton, safeWrite, uuid, todayISO, confirmDialog, resizeImage, blobToDataUrl, askText } from '../core.js';
import { exportXLSX } from '../xlsx.js';
import { scanLoop, showReceipt } from '../qr.js';

const FINE = 25;
const ordinal = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
const peso0 = n => '₱' + Number(n).toLocaleString('en-PH');
const ATT = /flag|log\s*in|log\s*out|event log/i;   // attendance and event standards, kept apart from grooming and uniform violations
const VCOLS = 'id,member_id,standard_id,occurred_on,source,status,reported_by,resolve_requested_by,forwarded_by,resolved_by,created_at,updated_at,excuse_note,excuse_status,excuse_by,excuse_decided_by';
const needV19 = e => /column|schema cache|does not exist/i.test(e.message || '') ? 'Run the v19 SQL in Supabase first (supabase/v19_constitution_fines.sql).' : e.message;
const sanction = n => n === 1 ? '1st Offense: Verbal Warning' : `${ordinal(n)} Offense: Fine (₱${FINE})`;
const STATUS = { awaiting_approval:['awaiting approval','warn'], pending:['pending','bad'], resolve_requested:['resolve requested','warn'], resolve_forwarded:['awaiting VP approval','warn'], resolved:['resolved','ok'], rejected:['rejected',''] };

export async function mountWatch(el, ctx) {
  const r = ctx.profile.role, name = ctx.profile.full_name;
  const canReport = ctx.can('mayor','vice_mayor','secretary','marshall','sails','general_marshal','dept_marshal');
  const canApprove = ctx.can('mayor','vice_mayor');
  const TK = 'alpha-f-watch-tab', openSet = new Set();
  let tab = (() => { try { const t = localStorage.getItem(TK); return ['ledger', 'standing', 'standards', 'inspection'].includes(t) ? t : 'ledger'; } catch { return 'ledger'; } })(), q = '';
  el.innerHTML = skeleton(5);

  async function draw() {
    const [insp, members, standards, viol, paidRows] = await Promise.all([
      sb.from('v2_inspections').select('*').order('opened_at', { ascending: false }).limit(1).then(x => (x.data && x.data[0]) || null, () => null),
      db(sb.from('v2_members').select('id,full_name,student_no,section,status').order('full_name')),
      db(sb.from('v2_standards').select('*').eq('active', true).order('sort_order')),
      db(sb.from('v2_violations').select(VCOLS).order('created_at')).catch(() => db(sb.from('v2_violations').select('*').order('created_at'))),
      db(sb.from('v2_entries').select('violation_id').not('violation_id', 'is', null).neq('status', 'voided')).catch(() => []),   // not everyone can read payments, and v19 may not be installed yet
    ]);
    const paid = new Set(paidRows.map(x => x.violation_id));
    const mname = id => members.find(m => m.id === id)?.full_name || '?';
    const std = id => standards.find(s => s.id === id);
    // Offense numbers are always computed fresh: every approved report counts, oldest first.
    const counted = viol.filter(v => !['awaiting_approval','rejected'].includes(v.status));
    const seen = {}, num = {};
    // A standard with its own fine (or an attendance record) is not part of the "1st offense: warning" count.
    const ruled = v => { const s = std(v.standard_id); return !(s && (s.fine || s.kind)); };
    counted.forEach(v => { if (!ruled(v)) return; seen[v.member_id] = (seen[v.member_id] || 0) + 1; num[v.id] = seen[v.member_id]; });
    const sanctionOf = v => { const s = std(v.standard_id); if (['awaiting_approval', 'rejected'].includes(v.status)) return 'awaiting approval'; if (v.excuse_status === 'accepted') return 'excused, no fine';
      if (s?.kind) return 'attendance record'; if (s?.fine) return `Fine ${peso0(s.fine)}`; return num[v.id] ? sanction(num[v.id]) : 'awaiting approval'; };
    const isCounted = v => !['awaiting_approval', 'rejected'].includes(v.status);
    const open = viol.filter(v => ['pending','resolve_requested','resolve_forwarded'].includes(v.status));
    const awaiting = viol.filter(v => v.status === 'awaiting_approval');

    const vrow = v => { const [lbl0, cls] = STATUS[v.status] || [v.status, '']; const lbl = getLang() === 'ceb' ? t({ pending: 'sPending', awaiting_approval: 'sAwaiting', resolve_requested: 'sResReq', resolve_forwarded: 'sFwd', resolved: 'sResolved', rejected: 'sRejected' }[v.status] || 'x') : lbl0; return `<div class="row stk vw"><div class="m"><b>${esc(mname(v.member_id))} <span class="tag ${cls}">${lbl}</span></b>
      <small>${esc(std(v.standard_id)?.title || 'Violation')} · ${fmtDate(v.occurred_on)} · ${sanctionOf(v)}${paid.has(v.id) ? ' · fine paid' : ''}${v.excuse_status === 'pending' ? ' · excuse letter waiting' : v.excuse_status === 'rejected' ? ' · excuse rejected' : ''}${v.reported_by ? ` · by ${esc(v.reported_by)}` : ''}</small></div>
      <div class="acts">${actions(v)}</div></div>`; };
    function actions(v) {
      const a = [];
      if (v.status === 'awaiting_approval' && canApprove) a.push(`<button class="btn gold sm" data-act="approve" data-id="${v.id}">Approve</button><button class="btn ghost sm" data-act="reject" data-id="${v.id}">Reject</button>`);
      if (v.status === 'pending' && ctx.can('marshall','sails','mayor','vice_mayor','secretary','general_marshal','dept_marshal')) a.push(`<button class="btn ghost sm" data-act="reqres" data-id="${v.id}">Request resolve</button>`);
      if (v.status === 'resolve_requested' && ctx.can('secretary','mayor','vice_mayor')) a.push(`<button class="btn ghost sm" data-act="forward" data-id="${v.id}">Forward to VP</button>`);
      if (v.status === 'resolve_forwarded' && canApprove) a.push(`<button class="btn gold sm" data-act="resolve" data-id="${v.id}">Resolve</button>`);
      const s = std(v.standard_id);
      if (isCounted(v) && s?.fine && !paid.has(v.id) && v.excuse_status !== 'accepted' && ctx.collects) a.push(`<button class="btn gold sm" data-act="collect" data-id="${v.id}">Collect ${peso0(s.fine)}</button>`);
      if (isCounted(v) && !s?.kind && !v.excuse_status && canReport) a.push(`<button class="btn ghost sm" data-act="excuse" data-id="${v.id}">Excuse letter</button>`);
      if (v.excuse_status === 'pending' && canApprove) a.push(`<button class="btn gold sm" data-act="review" data-id="${v.id}">Review excuse</button>`);
      if (ctx.can('mayor')) a.push(`<button class="btn ghost sm" data-act="del" data-id="${v.id}">Delete</button>`);
      return a.join('');
    }

    const canPay = !!ctx.collects;
    const payable = v => isCounted(v) && std(v.standard_id)?.fine && !paid.has(v.id) && v.excuse_status !== 'accepted';
    const fineOf = v => +std(v.standard_id).fine;
    /* One collapsible block per student: their violations together, with tick-boxes to pay chosen fines or everything owed. */
    function groupedLedger(list) {
      const groups = new Map(); list.forEach(v => { if (!groups.has(v.member_id)) groups.set(v.member_id, []); groups.get(v.member_id).push(v); });
      if (!groups.size) return '<div class="card"><p class="empty">No records.</p></div>';
      const sorted = [...groups].sort((a, b) => b[1].filter(payable).length - a[1].filter(payable).length || mname(a[0]).localeCompare(mname(b[0])));
      return sorted.map(([mid, vs]) => {
        const pay = vs.filter(payable), due = pay.reduce((t, v) => t + fineOf(v), 0), m = members.find(x => x.id === mid);
        const rows = vs.map(v => canPay && payable(v) ? `<div style="display:flex;align-items:center;gap:8px;padding-left:10px"><input type="checkbox" data-pv="${v.id}" data-m="${mid}" aria-label="Select this fine to pay"><div style="flex:1;min-width:0">${vrow(v)}</div></div>` : vrow(v)).join('');
        return `<details class="card grp-v" data-m="${mid}"${openSet.has(mid) || q ? ' open' : ''} style="margin-bottom:10px"><summary><span><b>${esc(mname(mid))}</b><small>${m?.student_no && !/^PENDING/i.test(m.student_no) ? esc(m.student_no) + ' · ' : ''}${vs.length} violation${vs.length === 1 ? '' : 's'}</small></span>${due ? `<span class="tag bad">owes ${peso0(due)}</span>` : '<span class="tag ok">no fine due</span>'}</summary>
          ${canPay && pay.length ? `<div class="bar" style="padding:8px 10px"><button class="btn gold sm" data-paysel="${mid}" disabled>Pay selected fines</button><button class="btn ghost sm" data-payall="${mid}">Pay all · ${peso0(due)}</button><small class="muted">Tick the fines to pay, or pay everything this student owes.</small></div>` : ''}${rows}</details>`;
      }).join('');
    }
    async function payFines(mid, ids) {
      const vs = ids.map(id => viol.find(x => x.id === id)).filter(v => v && payable(v));
      if (!vs.length) return toast('Nothing to pay.', true);
      const cur = (await db(sb.from('v2_periods').select('id').eq('status', 'open').limit(1)))[0];
      if (!cur) return toast('No open period. Open one in Treasury first.', true);
      const total = vs.reduce((t, v) => t + fineOf(v), 0);
      modal(`<h3>${esc(mname(mid))} pays fines</h3>${vs.map(v => `<div style="display:flex;justify-content:space-between;margin:6px 0"><span>${esc(std(v.standard_id).title)} <small class="muted">${fmtDate(v.occurred_on)}</small></span><b>${peso0(fineOf(v))}</b></div>`).join('')}
        <div style="display:flex;justify-content:space-between;margin:10px 0;font-size:1.05rem"><span>Total</span><b>${peso0(total)}</b></div>
        <label>Payment method</label><div class="segpay" role="radiogroup"><label><input type="radio" name="method" value="cash" checked><span>💵 Cash</span></label><label><input type="radio" name="method" value="gcash"><span>📱 GCash</span></label></div>
        <div id="gc" style="display:none"><label>GCash reference no.</label><input id="gr" maxlength="40"></div>
        <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:2">Collect ${peso0(total)}</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
        m.querySelector('#cx').onclick = close;
        m.querySelectorAll('[name=method]').forEach(r => r.onchange = () => { m.querySelector('#gc').style.display = m.querySelector('[name=method]:checked').value === 'gcash' ? 'block' : 'none'; });
        m.querySelector('#go').onclick = async () => {
          const method = m.querySelector('[name=method]:checked').value, gref = method === 'gcash' ? m.querySelector('#gr').value.trim() : '', made = []; m.querySelector('#go').disabled = true;
          try {
            for (const v of vs) { const id = uuid();
              await safeWrite('v2_entries', { id, period_id: cur.id, kind: 'collection', category: 'Fines', member_id: mid, violation_id: v.id, fund: 'sails', amount: fineOf(v), method, gcash_ref: gref || null,
                purpose: `Fine: ${std(v.standard_id).title}`, recorded_by_name: name, status: 'approved', approved_by_name: 'No approval needed', source: 'manual' }); made.push(id); }
            close(); toast(`${made.length} fine${made.length === 1 ? '' : 's'} paid · ${peso0(total)}`);
            if (made.length === 1) showReceipt(made[0]).catch(() => {}); else toast('One receipt per fine is in Treasury.');
            draw().catch(() => {});
          } catch (x) { m.querySelector('#er').textContent = made.length ? `${made.length} saved before the error: ${x.message}` : x.message; m.querySelector('#go').disabled = false; if (made.length) draw().catch(() => {}); }
        };
      });
    }

    const gated = ['marshall', 'dept_marshal'].includes(r) && !(insp && insp.status === 'open');
    let body;
    if (tab === 'inspection') body = '<div id="inspHost"></div>';
    else if (tab === 'ledger') {
      const isAtt = v => { const s0 = std(v.standard_id); return !!s0 && (!!s0.kind || ATT.test(s0.title)); };
      const shown = viol.filter(v => (!q || (mname(v.member_id) + ' ' + (members.find(m => m.id === v.member_id)?.student_no || '')).toLowerCase().includes(q.toLowerCase())) && !isAtt(v)).slice().reverse();
      body = `<div class="bar"><input id="q" placeholder="Search name or Student ID…" value="${esc(q)}" style="flex:1 1 100%">${canReport ? `<button class="btn gold" id="add">+ Report</button><button class="btn ghost" id="insp"${gated ? ' disabled' : ''}>${t('wInspect')}</button><button class="btn gold" id="qri"${gated ? ' disabled' : ''}>📷 Scan</button>` : ''}<button class="btn ghost" id="csv">Excel</button></div>
        ${awaiting.length || open.length ? '<p class="swipe-hint">Tip: on a phone, swipe a row right to approve or resolve it.</p>' : ''}${groupedLedger(shown)}`;
    } else if (tab === 'standing') {
      const by = {}; open.forEach(v => by[v.member_id] = (by[v.member_id] || 0) + 1);
      // Attendance (PIT Handbook): every 3 tardies count as 1 absence.
      const att = {}; counted.forEach(v => { const k = std(v.standard_id)?.kind; if (!k || v.excuse_status === 'accepted') return; const o = att[v.member_id] ||= { t: 0, a: 0 }; k === 'tardy' ? o.t++ : o.a++; });
      const attLine = id => { const o = att[id]; if (!o) return ''; const abs = o.a + Math.floor(o.t / 3), left = 3 - (o.t % 3);
        return ` · ${o.t} tardy, ${o.a} absent = ${abs} absence${abs === 1 ? '' : 's'}${o.t % 3 ? ` (${left} more tardies makes another)` : ''}`; };
      body = `<div class="card">${members.filter(m => m.status === 'active').map(m => `<div class="row"><div class="m"><b>${esc(m.full_name)}</b><small>${esc(m.section || '')}${attLine(m.id)}</small></div>
        <span class="tag ${by[m.id] ? 'bad' : 'ok'}">${by[m.id] ? by[m.id] + ' outstanding' : 'clear'}</span></div>`).join('')}</div>`;
    } else {
      body = `<div class="bar">${ctx.can('mayor','vice_mayor') ? '<button class="btn gold" id="addStd">+ Standard</button>' : ''}</div><div class="card">${standards.map(s => `<div class="row"><div class="m"><b>${esc(s.title)}${s.fine ? ` <span class="tag warn">Fine ${peso0(s.fine)}</span>` : ''}${s.kind ? ' <span class="tag">attendance</span>' : ''}</b><small>${esc(s.rule)}</small></div>
        ${ctx.can('mayor','vice_mayor') ? `<div style="display:flex;gap:4px"><button class="btn ghost sm" data-es="${s.id}">Edit</button><button class="btn ghost sm" data-rs="${s.id}">Remove</button></div>` : ''}</div>`).join('')}</div>`;
    }
    const on = !!(insp && insp.status === 'open'), isGM = r === 'general_marshal';
    const banner = `<div class="card pad" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1 1 200px"><b>${on ? 'Inspection is open' : 'Inspection is closed'}</b><br><small class="muted">${on ? esc(insp.note) + ' · opened by ' + esc(insp.opened_by_name || '') + ' · ' + fmtDate(insp.opened_at) : insp ? 'Last closed ' + fmtDate(insp.closed_at) + (insp.closed_by_name ? ' by ' + esc(insp.closed_by_name) : '') : 'The SAILS General Marshal opens it.'}${gated ? ' Scanning starts when it opens.' : ''}</small></div>${isGM ? (on ? '<button class="btn danger" id="icl">Close inspection</button>' : '<button class="btn gold" id="iop">Open inspection</button>') : ''}</div>`;
    el.innerHTML = `${banner}<div class="grid" style="margin-bottom:12px${tab === 'inspection' ? ';display:none' : ''}"><div class="stat gold"><small>${t('wOutstanding')}</small><b>${open.length}</b></div><div class="stat"><small>${t('wAwaiting')}</small><b>${awaiting.length}</b></div><div class="stat"><small>${t('wTotal')}</small><b>${viol.length}</b></div></div>
      <div class="bar"><button class="btn ${tab==='ledger'?'':'ghost'}" data-t="ledger">${t('wLedger')}</button><button class="btn ${tab==='standing'?'':'ghost'}" data-t="standing">${t('wStanding')}</button><button class="btn ${tab==='standards'?'':'ghost'}" data-t="standards">${t('wStandards')}</button><button class="btn ${tab==='inspection'?'':'ghost'}" data-t="inspection">Inspection</button></div>${body}`;
    if (tab === 'inspection') import('./inspection.js').then(m => m.mountInspection(el.querySelector('#inspHost'), ctx)).catch(() => {});

    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; try { localStorage.setItem(TK, tab); } catch { /* ignore */ } draw(); });
    const qi = el.querySelector('#q'); if (qi) { qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw().then(() => { const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(pos, pos); }); }; }
    el.querySelector('#iop')?.addEventListener('click', async () => {
      const note = await askText('Open inspection', 'What is being inspected?', { ok: 'Open', placeholder: 'e.g. Uniform inspection, Block Alpha' }); if (!note) return;
      try { await db(sb.rpc('v2_inspection_open', { p_note: note })); toast('Inspection opened. The SAILS President and the Class Mayors were notified.'); draw().catch(() => {}); } catch (e) { toast(e.message || 'Could not open', true); }
    });
    el.querySelector('#icl')?.addEventListener('click', async () => {
      if (!await confirmDialog('The SAILS President and the Class Mayors will be notified.', { ok: 'Close inspection', title: 'Close inspection?' })) return;
      try { await db(sb.rpc('v2_inspection_close')); toast('Inspection closed. The SAILS President and the Class Mayors were notified.'); draw().catch(() => {}); } catch (e) { toast(e.message || 'Could not close', true); }
    });
    el.querySelector('#add')?.addEventListener('click', () => report(members, standards));
    el.querySelector('#insp')?.addEventListener('click', () => inspect(members, standards));
    el.querySelector('#qri')?.addEventListener('click', () => scanInspect(members, standards));
    el.querySelector('#csv')?.addEventListener('click', async () => {
      const counted2 = viol.filter(v => !['awaiting_approval', 'rejected'].includes(v.status));
      const byM = {}; counted2.forEach(v => { const o = byM[v.member_id] ||= { total: 0, open: 0 }; o.total++; if (v.status !== 'resolved') o.open++; });
      try { toast('Preparing Excel…'); await exportXLSX({ filename: `Alpha-Violation-Ledger-${new Date().toISOString().slice(0, 10)}.xlsx`, by: `${ctx.profile.full_name}`, sheets: [
        { name: 'Violation Ledger', title: 'Violation Ledger', subtitle: 'BSMT 1-Alpha · Alpha Watch', summary: [['Outstanding', open.length], ['Awaiting approval', awaiting.length], ['Resolved', viol.filter(v => v.status === 'resolved').length], ['Total records', viol.length]],
          columns: [{ label: 'Date', get: v => v.occurred_on, type: 'date' }, { label: 'Student', get: v => mname(v.member_id), width: 28 }, { label: 'Violation', get: v => std(v.standard_id)?.title, width: 28 }, { label: 'Offense', get: v => num[v.id] ? ordinal(num[v.id]) + ' offense' : '' },
            { label: 'Sanction', get: v => sanctionOf(v) }, { label: 'Fine paid', get: v => paid.has(v.id) ? 'Yes' : '' }, { label: 'Status', get: v => (STATUS[v.status] || [v.status])[0], type: 'status' }, { label: 'Reported by', key: 'reported_by', width: 22 }, { label: 'Resolved by', key: 'resolved_by', width: 22 }], rows: viol.slice().sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)) },
        { name: 'Standing', title: 'Class Standing', subtitle: 'Outstanding violations per student', summary: [['Active students', members.filter(m => m.status === 'active').length], ['With outstanding', Object.values(byM).filter(o => o.open).length]],
          columns: [{ label: 'Student', key: 'full_name', width: 30 }, { label: 'Section', key: 'section', width: 24 }, { label: 'Outstanding', get: m => byM[m.id]?.open || 0, type: 'int', total: true }, { label: 'All records', get: m => byM[m.id]?.total || 0, type: 'int', total: true }, { label: 'Standing', get: m => byM[m.id]?.open ? 'Outstanding' : 'Clear', type: 'status' }], rows: members.filter(m => m.status === 'active') }] }); toast('Excel ready'); }
      catch (e) { toast(e.message, true); } });
    el.querySelector('#addStd')?.addEventListener('click', () => newStandard());
    el.querySelectorAll('details.grp-v').forEach(d => d.addEventListener('toggle', () => { d.open ? openSet.add(d.dataset.m) : openSet.delete(d.dataset.m); }));
    const syncPay = d => { const on = [...d.querySelectorAll('[data-pv]:checked')], b = d.querySelector('[data-paysel]'); if (!b) return; b.disabled = !on.length; b.textContent = on.length ? `Pay selected · ${peso0(on.reduce((t, c) => t + fineOf(viol.find(x => x.id === c.dataset.pv)), 0))}` : 'Pay selected fines'; };
    el.querySelectorAll('details.grp-v').forEach(d => { d.querySelectorAll('[data-pv]').forEach(c => c.onchange = () => syncPay(d));
      d.querySelector('[data-paysel]')?.addEventListener('click', () => payFines(d.dataset.m, [...d.querySelectorAll('[data-pv]:checked')].map(c => c.dataset.pv)));
      d.querySelector('[data-payall]')?.addEventListener('click', () => payFines(d.dataset.m, [...d.querySelectorAll('[data-pv]')].map(c => c.dataset.pv))); });
    el.querySelectorAll('[data-es]').forEach(b => b.onclick = () => editStandard(standards.find(x => x.id === b.dataset.es)));
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
      if (a === 'collect') { const v = viol.find(x => x.id === id), s = std(v.standard_id);
        try { sessionStorage.setItem('alpha-prefill', JSON.stringify({ member: v.member_id, amount: s.fine, purpose: `Fine: ${s.title}`, cat: 'Fines', fund: 'sails', violation: v.id })); } catch { /* ignore */ }
        location.hash = '#/staff/treasury'; return; }
      if (a === 'excuse') return void excuseForm(viol.find(x => x.id === id), mname, std);
      if (a === 'review') return void reviewExcuse(viol.find(x => x.id === id), mname, std);
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
      <label>Standard</label><select name="s" required><option value="">Select…</option>${standards.map(s=>`<option value="${s.id}">${esc(s.title)}${s.fine ? ` (₱${s.fine} fine)` : ''}</option>`).join('')}</select>
      <div class="chips" id="rs">${recent().map(([k, l]) => `<button type="button" data-k="${k}">${esc(l)}</button>`).join('')}</div>
      <label>Date</label><input name="d" type="date" required value="${todayISO()}">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Submit</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close; studentSearch(m.querySelector('[name=m]'), members.filter(x => x.status === 'active'));
        m.querySelectorAll('#rs [data-k]').forEach(b => b.onclick = () => { const [mi, si] = b.dataset.k.split('|'); m.querySelector('[name=m]').value = mi; m.querySelector('[name=s]').value = si; });
        m.querySelector('#rf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { remember(f.get('m'), f.get('s'), members, standards); const res = await safeWrite('v2_violations', { id: uuid(), member_id: f.get('m'), standard_id: f.get('s'), occurred_on: f.get('d'), reported_by: `${r} ${name}`, status: canApprove ? 'pending' : 'awaiting_approval' });
            toast(res.queued ? 'No signal — saved on this device, will send automatically' : canApprove ? 'Recorded' : 'Submitted for approval'); close(); draw().catch(() => {}); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }
  // Inspection: pick one standard, tap the students who failed it, record them all at once.
  function inspect(members, standards) {
    const act = members.filter(m => m.status === 'active');
    modal(`<h3>Inspection</h3><p class="muted" style="margin:0 0 8px">Choose what you checked, then tap only the students who failed it.</p><form id="if">
      <div class="insp-fields"><div><label>Standard</label><select name="s" required><option value="">Select…</option>${standards.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></div>
      <div><label>Date</label><input name="d" type="date" required value="${todayISO()}"></div></div>
      <div class="insp-head"><b>Who failed it?</b><span class="muted" id="ic">0 selected</span></div>
      <input id="iq" type="search" placeholder="Search a student…" autocomplete="off">
      <div class="pickrows" id="il">${act.map(m => `<button type="button" role="checkbox" aria-checked="false" data-m="${m.id}" data-n="${esc(m.full_name.toLowerCase())}"><span class="ck" aria-hidden="true"></span><span>${esc(m.full_name)}</span></button>`).join('')}</div>
      <div class="insp-foot"><button class="btn gold" style="flex:1" id="go">Record 0</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        const picked = new Set(), go = m.querySelector('#go'), upd = () => { go.textContent = `Record ${picked.size}`; m.querySelector('#ic').textContent = `${picked.size} selected`; };
        m.querySelector('#iq').oninput = e => { const f = e.target.value.trim().toLowerCase(); m.querySelectorAll('#il [data-m]').forEach(b => { b.hidden = !!f && !b.dataset.n.includes(f); }); };
        m.querySelectorAll('#il [data-m]').forEach(b => b.onclick = () => { const id = b.dataset.m, on = !picked.has(id); on ? picked.add(id) : picked.delete(id); b.setAttribute('aria-checked', on); b.classList.toggle('on', on); upd(); });
        m.querySelector('#if').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          if (!picked.size) return void (m.querySelector('#er').textContent = 'Tap at least one student, or close if everyone passed.');
          go.disabled = true; let queued = false, done = 0;
          try { for (const id of picked) { const res = await safeWrite('v2_violations', { id: uuid(), member_id: id, standard_id: f.get('s'), occurred_on: f.get('d'), reported_by: `${r} ${name}`, status: canApprove ? 'pending' : 'awaiting_approval' }); queued = queued || res.queued; done++; picked.delete(id); }
            toast(queued ? 'No signal. Saved on this device, will send automatically' : `${done} recorded${canApprove ? '' : ' for approval'}`); close(); draw().catch(() => {}); }
          catch (x) { go.disabled = false; upd(); m.querySelectorAll('#il [data-m]').forEach(b => { if (!picked.has(b.dataset.m)) { b.setAttribute('aria-checked', 'false'); b.classList.remove('on'); } }); m.querySelector('#er').textContent = `${done} saved before the error: ${x.message}. Only the rest are still selected.`; } }; });
  }
  /* Scan inspection (violations only), in stages on a full screen so the camera stays big:
       1 Scan     - aim at the QR card; every scan is confirmed by a banner, a flash, a beep and a vibration
       2 Category - tap what the student failed
       3 Finalize - check the report, then submit
     Attendance (flag ceremony, inspection, event log in/out) is on the Attendance tab. */
  function scanInspect(members, standards) {
    const act = members.filter(x => x.status === 'active'), byId = Object.fromEntries(act.map(x => [x.id, x]));
    const checkable = standards.filter(x => !x.kind && !ATT.test(x.title));       // grooming and uniform standards only
    let stage = 'scan', pending = null, busy = false, last = '', lastAt = 0, lastOk = false, dateV = todayISO();
    const checked = new Set(), hist = []; let nFail = 0;
    const status = canApprove ? 'pending' : 'awaiting_approval';
    const write = async (mid, sid, d) => { const id = uuid(); await safeWrite('v2_violations', { id, member_id: mid, standard_id: sid, occurred_on: d, reported_by: `${r} ${name}`, status }); return id; };
    const peso1 = n => '₱' + Number(n).toLocaleString('en-PH');
    const m = modal(`<div class="scn full">
      <div class="scn-h"><b>Scan inspection</b><span class="steps" id="stp"></span><button type="button" class="x" id="sx" aria-label="Close">✕</button></div>
      <div class="sb idle" id="sb" role="status" aria-live="polite">Starting camera…</div>
      <div id="g1">
        <div class="vid" id="vd"><video id="sv" playsinline muted></video><button type="button" class="torch" id="tc" hidden aria-label="Flashlight">🔦</button><span class="pill" id="cn"></span></div>
        <div class="scn-b"><button type="button" class="btn ghost big" id="un" hidden>↩ Undo last</button><button type="button" class="btn ghost big" id="pkb">Can’t scan? Pick</button></div>
        <div id="pkw" hidden></div></div>
      <div id="g2" hidden></div></div>`, (el, close) => {
      el.classList.add('scnm');
      const $ = q => el.querySelector(q);
      let ac = null;
      const beep = ok => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = ok ? 880 : 300; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.28)); } catch { /* no sound */ } };
      const say = (txt, kind = 'idle') => { const b = $('#sb'); b.className = 'sb ' + kind; b.textContent = txt;
        if (kind !== 'idle') { const v = $('#vd'); v.classList.remove('flash', 'ok', 'warn', 'bad'); void v.offsetWidth; v.classList.add('flash', kind); beep(kind === 'ok'); try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 60 : [80, 60, 80]); } catch { /* ignore */ } } };
      const STEPS = [['scan', 'Scan'], ['cat', 'Category'], ['fin', 'Finalize']];
      const showSteps = () => { const at = STEPS.findIndex(x => x[0] === stage); $('#stp').innerHTML = STEPS.map(([k, l], i) => `<span class="${i === at ? 'on' : i < at ? 'done' : ''}"><i>${i < at ? '✓' : i + 1}</i>${l}</span>`).join(''); };
      const go = st => { stage = st; $('#g1').hidden = st !== 'scan'; $('#g2').hidden = st === 'scan'; showSteps(); if (st === 'scan') scanPane(); else (st === 'cat' ? catPane : finPane)(); };
      function scanPane() { $('#cn').textContent = `${checked.size} of ${act.length} checked${nFail ? ` · ${nFail} flagged` : ''}`; $('#un').hidden = !hist.length; }
      function pickList() {
        const w = $('#pkw'); w.hidden = !w.hidden; if (w.hidden) return;
        w.innerHTML = `<select id="pk"><option value="">Choose a student…</option>${act.filter(x => !checked.has(x.id)).map(x => `<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select>`;
        w.querySelector('#pk').onchange = e => { const mem = byId[e.target.value]; w.hidden = true; if (mem) got({ id: mem.id, name: mem.full_name }); };
      }
      /* stage 2: what did they fail? */
      function catPane() {
        const g = $('#g2'), bad = pending.bad;
        g.innerHTML = `<div class="stg"><p class="who">${esc(pending.name)}</p><p class="muted">Tap everything this student failed.</p>
          <div class="cats">${checkable.map(x => `<button type="button" data-f="${x.id}" class="${bad.has(x.id) ? 'on' : ''}"><b>${esc(x.title)}</b>${x.fine ? `<small>${peso1(x.fine)} fine</small>` : ''}</button>`).join('')}</div></div>
          <div class="scn-b stick"><button class="btn ghost big" id="bk">‹ Cancel</button><button class="btn ghost big" id="ps">✓ Passed</button><button class="btn gold big" id="nx"${bad.size ? '' : ' disabled'}>Review ›</button></div>`;
        g.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { bad.has(b.dataset.f) ? bad.delete(b.dataset.f) : bad.add(b.dataset.f); catPane(); });
        $('#bk').onclick = () => { pending = null; say('Cancelled. Scan the next card.'); go('scan'); };
        $('#nx').onclick = () => go('fin');
        $('#ps').onclick = () => { const mid = pending.id, nm = pending.name; checked.add(mid); hist.unshift({ label: `${nm} · passed`, undo: async () => { checked.delete(mid); } }); pending = null; say(`${nm} passed. Scan the next card.`, 'ok'); go('scan'); };
      }
      /* stage 3: check and submit */
      function finPane() {
        const g = $('#g2'), rows = [...pending.bad].map(id => standards.find(y => y.id === id)), total = rows.reduce((t, x) => t + (+x.fine || 0), 0);
        say('Check the report, then submit it.');
        g.innerHTML = `<div class="stg"><p class="who">${esc(pending.name)}</p><p class="muted">Check the report, then submit.</p>
          <div class="card pad">${rows.map(x => `<div class="fr"><span>${esc(x.title)}</span><b>${x.fine ? peso1(x.fine) : 'usual rule'}</b></div>`).join('')}${total ? `<div class="fr tot"><span>Fines</span><b>${peso1(total)}</b></div>` : ''}</div>
          <p class="muted" style="margin:6px 0">${canApprove ? 'Saved straight away.' : 'Goes to the Mayor or Vice Mayor for approval.'}</p><label>Date</label><input id="sd" type="date" value="${dateV}"></div>
          <div class="scn-b stick"><button class="btn ghost big" id="bk">‹ Edit</button><button class="btn gold big" id="ok" style="flex:2">Submit report</button></div>`;
        $('#sd').onchange = e => { dateV = e.target.value || todayISO(); }; $('#bk').onclick = () => go('cat');
        $('#ok').onclick = async () => { $('#ok').disabled = true; const nm = pending.name, mid = pending.id, bad = pending.bad, ids = [];
          try { for (const sid of bad) ids.push(await write(mid, sid, dateV)); checked.add(mid); nFail++;
            hist.unshift({ label: `${nm} · ${bad.size} failed`, undo: async () => { for (const id of ids) await db(sb.from('v2_violations').delete().eq('id', id)); checked.delete(mid); nFail--; } });
            pending = null; say(`Report submitted for ${nm}. Scan the next card.`, 'ok'); go('scan'); draw().catch(() => {}); }
          catch (x) { toast(x.message, true); $('#ok').disabled = false; } };
      }
      function got(s0) {
        if (!byId[s0.id]) return void say('That student is not on the active list.', 'bad');
        if (stage !== 'scan') return void say(`Finish ${pending ? pending.name : 'this step'} first.`, 'warn');
        if (checked.has(s0.id)) return void say(`${s0.name} is already checked.`, 'warn');
        if (!checkable.length) return void say('No violation standards yet. Add some in the Standards tab.', 'bad');
        pending = { id: s0.id, name: s0.name, bad: new Set() }; say(`✓ Scanned: ${s0.name}. Now choose the category.`, 'ok'); go('cat'); return true;
      }
      const onRaw = async raw => {
        const now = Date.now(); if (busy || (raw === last && now - lastAt < (lastOk ? 3000 : 1200))) return; busy = true; last = raw; lastAt = now; lastOk = false;
        try { const s0 = await db(sb.rpc('v2_resolve_token', { p_token: raw })); lastOk = !!got(s0); } catch (x) { say(x.message, 'bad'); }
        busy = false;
      };
      el.addEventListener('scan', e => onRaw(e.detail));           // lets a test or a hardware scanner feed codes without the camera
      $('#un').onclick = async () => { const h = hist.shift(); if (!h) return; try { await h.undo(); say('Undone: ' + h.label, 'warn'); draw().catch(() => {}); } catch (x) { toast(x.message, true); hist.unshift(h); } scanPane(); };
      $('#pkb').onclick = pickList; $('#sx').onclick = close; say('Violations: scan a student’s card.'); go('scan');
      scanLoop(el, $('#sv'), onRaw, stream => { const tr = stream.getVideoTracks()[0]; if (tr?.getCapabilities?.().torch) { const b = $('#tc'); b.hidden = false; let on = false; b.onclick = () => { on = !on; tr.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); b.classList.toggle('on', on); }; } })
        .then(() => {}, e => say('Camera unavailable (' + (e.message || e) + '). Use “Can’t scan? Pick”.', 'bad'));
      $('#sv').addEventListener('playing', () => say('Camera ready. Point at a student’s QR card.'));
    });
    return m;
  }
  function excuseForm(v, mname, std) {
    modal(`<h3>Excuse letter</h3><p class="muted" style="margin:0 0 8px">${esc(mname(v.member_id))} · ${esc(std(v.standard_id)?.title || 'Violation')} · ${fmtDate(v.occurred_on)}. The Mayor or Vice Mayor decides. Accepted means no fine.</p><form id="xf">
      <label>What the student said (illness, accident or another valid reason)</label><textarea name="n" rows="3" maxlength="500" required></textarea>
      <label>Photo of the letter or proof (optional)</label><input name="img" type="file" accept="image/*">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send for review</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#xf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), file = f.get('img');
          try { const img = file && file.size ? await blobToDataUrl(await resizeImage(file)) : null;
            await db(sb.from('v2_violations').update({ excuse_note: f.get('n').trim(), excuse_image: img, excuse_status: 'pending', excuse_by: `${r} ${name}`, updated_at: new Date().toISOString() }).eq('id', v.id));
            toast('Sent for review'); close(); draw().catch(() => {}); } catch (x) { m.querySelector('#er').textContent = needV19(x); } }; });
  }
  async function reviewExcuse(v, mname, std) {
    let img = null; try { img = (await db(sb.from('v2_violations').select('excuse_image').eq('id', v.id).single())).excuse_image; } catch { /* ignore */ }
    modal(`<h3>Review excuse</h3><p class="muted" style="margin:0 0 8px">${esc(mname(v.member_id))} · ${esc(std(v.standard_id)?.title || 'Violation')} · ${fmtDate(v.occurred_on)}</p>
      <div class="card pad"><b>Reason</b><p style="margin:4px 0 0;white-space:pre-wrap">${esc(v.excuse_note || '')}</p><small class="muted">Recorded by ${esc(v.excuse_by || '')}</small></div>
      ${img ? `<img src="${img}" alt="Proof" style="width:100%;border-radius:12px;margin-top:10px">` : '<p class="muted">No photo attached.</p>'}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1" id="ok">Accept</button><button class="btn ghost" style="flex:1" id="no">Reject</button></div>
      <button type="button" class="btn ghost" id="cx" style="width:100%;margin-top:8px">Close</button><div class="err" id="er"></div>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        const go = (patch, msg) => async () => { try { await db(sb.from('v2_violations').update({ ...patch, excuse_decided_by: `${r} ${name}`, updated_at: new Date().toISOString() }).eq('id', v.id)); toast(msg); close(); draw().catch(() => {}); } catch (x) { m.querySelector('#er').textContent = x.message; } };
        m.querySelector('#ok').onclick = go({ excuse_status: 'accepted', status: 'resolved', resolved_by: `Excused by ${r} ${name}` }, 'Excuse accepted');
        m.querySelector('#no').onclick = go({ excuse_status: 'rejected' }, 'Excuse rejected'); });
  }
  function editStandard(s) {
    modal(`<h3>${esc(s.title)}</h3><form id="ef"><label>Rule</label><textarea name="r" rows="3">${esc(s.rule)}</textarea>
      ${s.kind ? '' : `<label>Fine each time (₱). Leave empty to use the usual rule: 1st offense a warning, then ₱${FINE}.</label><input name="f" type="number" min="1" step="1" inputmode="numeric" value="${s.fine || ''}">`}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#ef').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), patch = { rule: f.get('r') };
          if (!s.kind) patch.fine = f.get('f') ? +f.get('f') : null;
          try { await db(sb.from('v2_standards').update(patch).eq('id', s.id)); toast('Saved'); close(); draw(); } catch (x) { m.querySelector('#er').textContent = needV19(x); } }; });
  }
  function newStandard() {
    modal(`<h3>New standard</h3><form id="sf"><label>Title</label><input name="t" required><label>Rule</label><textarea name="r" rows="3"></textarea><label>Fine each time (₱, optional)</label><input name="f" type="number" min="1" step="1" inputmode="numeric">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
          try { await db(sb.from('v2_standards').insert({ title: f.get('t'), rule: f.get('r'), sort_order: 999, ...(f.get('f') ? { fine: +f.get('f') } : {}) })); toast('Added'); close(); draw(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; });
  }

  await draw();
  return watch(['v2_violations', 'v2_members', 'v2_standards', 'v2_inspections'], () => draw().catch(() => {}));
}
