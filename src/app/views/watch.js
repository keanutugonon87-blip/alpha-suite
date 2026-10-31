import { t, getLang } from '../i18n.js';
import { sb, db, watch, esc, fmtDate, toast, modal, skeleton, safeWrite, uuid, todayISO, confirmDialog, resizeImage, blobToDataUrl } from '../core.js';
import { exportXLSX } from '../xlsx.js';
import { scanLoop } from '../qr.js';

const FINE = 25;
const ordinal = n => { const r = n % 100; if (r >= 11 && r <= 13) return n + 'th'; return n + (['th','st','nd','rd'][n % 10] || 'th'); };
const peso0 = n => '₱' + Number(n).toLocaleString('en-PH');
const ATT = /flag|inspection|log\s*in|log\s*out|event log/i;   // attendance and event standards, kept apart from grooming and uniform violations
const VCOLS = 'id,member_id,standard_id,occurred_on,source,status,reported_by,resolve_requested_by,forwarded_by,resolved_by,created_at,updated_at,excuse_note,excuse_status,excuse_by,excuse_decided_by';
const needV19 = e => /column|schema cache|does not exist/i.test(e.message || '') ? 'Run the v19 SQL in Supabase first (supabase/v19_constitution_fines.sql).' : e.message;
const sanction = n => n === 1 ? '1st Offense: Verbal Warning' : `${ordinal(n)} Offense: Fine (₱${FINE})`;
const STATUS = { awaiting_approval:['awaiting approval','warn'], pending:['pending','bad'], resolve_requested:['resolve requested','warn'], resolve_forwarded:['awaiting VP approval','warn'], resolved:['resolved','ok'], rejected:['rejected',''] };

export async function mountWatch(el, ctx) {
  const r = ctx.profile.role, name = ctx.profile.full_name;
  const canReport = ctx.can('mayor','vice_mayor','secretary','marshall','sails');
  const canApprove = ctx.can('mayor','vice_mayor');
  const TK = 'alpha-f-watch-tab';
  let kind = (() => { try { const k = localStorage.getItem('alpha-f-watch-kind'); return ['viol', 'att'].includes(k) ? k : 'all'; } catch { return 'all'; } })();
  let tab = (() => { try { const t = localStorage.getItem(TK); return ['ledger', 'standing', 'standards'].includes(t) ? t : 'ledger'; } catch { return 'ledger'; } })(), q = '';
  el.innerHTML = skeleton(5);

  async function draw() {
    const [members, standards, viol, paidRows] = await Promise.all([
      db(sb.from('v2_members').select('id,full_name,section,status').order('full_name')),
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
      if (v.status === 'pending' && ctx.can('marshall','sails','mayor','vice_mayor','secretary')) a.push(`<button class="btn ghost sm" data-act="reqres" data-id="${v.id}">Request resolve</button>`);
      if (v.status === 'resolve_requested' && ctx.can('secretary','mayor','vice_mayor')) a.push(`<button class="btn ghost sm" data-act="forward" data-id="${v.id}">Forward to VP</button>`);
      if (v.status === 'resolve_forwarded' && canApprove) a.push(`<button class="btn gold sm" data-act="resolve" data-id="${v.id}">Resolve</button>`);
      const s = std(v.standard_id);
      if (isCounted(v) && s?.fine && !paid.has(v.id) && v.excuse_status !== 'accepted' && ctx.can('mayor', 'treasurer')) a.push(`<button class="btn gold sm" data-act="collect" data-id="${v.id}">Collect ${peso0(s.fine)}</button>`);
      if (isCounted(v) && !s?.kind && !v.excuse_status && canReport) a.push(`<button class="btn ghost sm" data-act="excuse" data-id="${v.id}">Excuse letter</button>`);
      if (v.excuse_status === 'pending' && canApprove) a.push(`<button class="btn gold sm" data-act="review" data-id="${v.id}">Review excuse</button>`);
      if (ctx.can('mayor')) a.push(`<button class="btn ghost sm" data-act="del" data-id="${v.id}">Delete</button>`);
      return a.join('');
    }

    let body;
    if (tab === 'ledger') {
      const isAtt = v => { const s0 = std(v.standard_id); return !!s0 && (!!s0.kind || ATT.test(s0.title)); };
      const shown = viol.filter(v => (!q || mname(v.member_id).toLowerCase().includes(q.toLowerCase())) && (kind === 'all' || (kind === 'att' ? isAtt(v) : !isAtt(v)))).slice().reverse();
      body = `<div class="seg" id="kf" style="margin-bottom:8px">${[['all', 'All'], ['viol', 'Violations'], ['att', 'Attendance and events']].map(([k, l]) => `<button data-k="${k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="bar"><input id="q" placeholder="Search student…" value="${esc(q)}" style="flex:1 1 100%">${canReport ? `<button class="btn gold" id="add">+ Report</button><button class="btn ghost" id="insp">${t('wInspect')}</button><button class="btn gold" id="qri">📷 Scan</button>` : ''}<button class="btn ghost" id="csv">Excel</button></div>
        ${awaiting.length || open.length ? '<p class="swipe-hint">Tip: on a phone, swipe a row right to approve or resolve it.</p>' : ''}<div class="card">${shown.map(vrow).join('') || '<p class="empty">No records.</p>'}</div>`;
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
    el.innerHTML = `<div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>${t('wOutstanding')}</small><b>${open.length}</b></div><div class="stat"><small>${t('wAwaiting')}</small><b>${awaiting.length}</b></div><div class="stat"><small>${t('wTotal')}</small><b>${viol.length}</b></div></div>
      <div class="bar"><button class="btn ${tab==='ledger'?'':'ghost'}" data-t="ledger">${t('wLedger')}</button><button class="btn ${tab==='standing'?'':'ghost'}" data-t="standing">${t('wStanding')}</button><button class="btn ${tab==='standards'?'':'ghost'}" data-t="standards">${t('wStandards')}</button></div>${body}`;

    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; try { localStorage.setItem('alpha-f-watch-kind', kind); } catch { /* ignore */ } draw(); });
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; try { localStorage.setItem(TK, tab); } catch { /* ignore */ } draw(); });
    const qi = el.querySelector('#q'); if (qi) { qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw().then(() => { const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(pos, pos); }); }; }
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
  /* Scan inspection, in stages on a full screen so the camera stays big:
       1 Scan   - aim at the QR card; every scan is confirmed by a banner, a flash, a beep and a vibration
       2 Category - (Violations only) tap what the student failed
       3 Finalize - check the report, then submit
     Violations: grooming and uniform.  Roll call: flag ceremony, inspection (the unscanned are recorded absent).  Event log in/out: arrival and leaving. */
  function scanInspect(members, standards) {
    const act = members.filter(x => x.status === 'active'), byId = Object.fromEntries(act.map(x => [x.id, x]));
    const checkable = standards.filter(x => !x.kind && !ATT.test(x.title));       // grooming and uniform standards only
    const rollStds = standards.filter(x => /flag|inspection/i.test(x.title));
    const logStd = standards.find(x => /log\s*in|log\s*out|event log/i.test(x.title));
    let absId = (rollStds[0] || standards.find(x => !x.kind))?.id, logId = logStd?.id || '', mode = 'find', phase = 'in', stage = 'scan', pending = null, busy = false, last = '', lastAt = 0, lastOk = false, dateV = todayISO();
    const checked = new Set(), present = new Set(), inAt = new Map(), outAt = new Map(), hist = []; let nFail = 0;
    const status = canApprove ? 'pending' : 'awaiting_approval';
    const write = async (mid, sid, d) => { const id = uuid(); await safeWrite('v2_violations', { id, member_id: mid, standard_id: sid, occurred_on: d, reported_by: `${r} ${name}`, status }); return id; };
    const tm = d0 => d0.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
    const peso1 = n => '₱' + Number(n).toLocaleString('en-PH');
    const m = modal(`<div class="scn full">
      <div class="scn-h"><b>Scan inspection</b><span class="steps" id="stp"></span><button type="button" class="x" id="sx" aria-label="Close">✕</button></div>
      <div class="sb idle" id="sb" role="status" aria-live="polite">Starting camera…</div>
      <div id="g1"><div class="seg" id="sm"><button data-md="find" class="on">Violations</button><button data-md="roll">Roll call</button><button data-md="log">Event log in/out</button></div>
        <div id="ph" hidden class="seg"><button data-ph="in" class="on">Log in</button><button data-ph="out">Log out</button></div>
        <div class="vid" id="vd"><video id="sv" playsinline muted></video><button type="button" class="torch" id="tc" hidden aria-label="Flashlight">🔦</button><span class="pill" id="cn"></span></div>
        <div class="scn-b"><button type="button" class="btn ghost big" id="un" hidden>↩ Undo last</button><button type="button" class="btn ghost big" id="pkb">Can’t scan? Pick</button><button type="button" class="btn gold big" id="fin" hidden>Finish ›</button></div>
        <div id="pkw" hidden></div></div>
      <div id="g2" hidden></div></div>`, (el, close) => {
      el.classList.add('scnm');
      const $ = q => el.querySelector(q);
      let ac = null;
      const beep = ok => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = ok ? 880 : 300; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.28)); } catch { /* no sound */ } };
      const say = (txt, kind = 'idle') => { const b = $('#sb'); b.className = 'sb ' + kind; b.textContent = txt;
        if (kind !== 'idle') { const v = $('#vd'); v.classList.remove('flash', 'ok', 'warn', 'bad'); void v.offsetWidth; v.classList.add('flash', kind); beep(kind === 'ok'); try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 60 : [80, 60, 80]); } catch { /* ignore */ } } };
      const stepsFor = () => mode === 'find' ? [['scan', 'Scan'], ['cat', 'Category'], ['fin', 'Finalize']] : [['scan', 'Scan'], ['fin', 'Finalize']];
      const showSteps = () => { const list = stepsFor(), at = list.findIndex(x => x[0] === stage); $('#stp').innerHTML = list.map(([k, l], i) => `<span class="${i === at ? 'on' : i < at ? 'done' : ''}"><i>${i < at ? '✓' : i + 1}</i>${l}</span>`).join(''); };
      const go = st => { stage = st; $('#g1').hidden = st !== 'scan'; $('#g2').hidden = st === 'scan'; showSteps(); if (st === 'scan') scanPane(); else (st === 'cat' ? catPane : finPane)(); };
      function scanPane() {
        $('#ph').hidden = mode !== 'log';
        const n = mode === 'find' ? checked.size : mode === 'roll' ? present.size : Math.max(inAt.size, outAt.size);
        $('#cn').textContent = mode === 'log' ? `In ${inAt.size} · Out ${outAt.size} of ${act.length}` : `${n} of ${act.length} ${mode === 'find' ? 'checked' : 'present'}${mode === 'find' && nFail ? ` · ${nFail} flagged` : ''}`;
        $('#un').hidden = !hist.length; $('#fin').hidden = mode === 'find';
      }
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
        $('#ps').onclick = async () => { const mid = pending.id, nm = pending.name; checked.add(mid); hist.unshift({ label: `${nm} · passed`, undo: async () => { checked.delete(mid); } }); pending = null; say(`${nm} passed. Scan the next card.`, 'ok'); go('scan'); };
      }
      /* stage 3: check and submit */
      function finPane() {
        const g = $('#g2'), dateBox = `<label>Date</label><input id="sd" type="date" value="${dateV}">`;
        say(mode === 'find' ? 'Check the report, then submit it.' : 'Check the list, then submit it.');
        const bind = () => { $('#sd').onchange = e => { dateV = e.target.value || todayISO(); }; };
        if (mode === 'find') {
          const rows = [...pending.bad].map(id => standards.find(y => y.id === id)), total = rows.reduce((t, x) => t + (+x.fine || 0), 0);
          g.innerHTML = `<div class="stg"><p class="who">${esc(pending.name)}</p><p class="muted">Check the report, then submit.</p>
            <div class="card pad">${rows.map(x => `<div class="fr"><span>${esc(x.title)}</span><b>${x.fine ? peso1(x.fine) : 'usual rule'}</b></div>`).join('')}${total ? `<div class="fr tot"><span>Fines</span><b>${peso1(total)}</b></div>` : ''}</div>
            <p class="muted" style="margin:6px 0">${canApprove ? 'Saved straight away.' : 'Goes to the Mayor or Vice Mayor for approval.'}</p>${dateBox}</div>
            <div class="scn-b stick"><button class="btn ghost big" id="bk">‹ Edit</button><button class="btn gold big" id="ok" style="flex:2">Submit report</button></div>`;
          bind(); $('#bk').onclick = () => go('cat');
          $('#ok').onclick = async () => { $('#ok').disabled = true; const nm = pending.name, mid = pending.id, bad = pending.bad, ids = [];
            try { for (const sid of bad) ids.push(await write(mid, sid, dateV)); checked.add(mid); nFail++;
              hist.unshift({ label: `${nm} · ${bad.size} failed`, undo: async () => { for (const id of ids) await db(sb.from('v2_violations').delete().eq('id', id)); checked.delete(mid); nFail--; } });
              pending = null; say(`Report submitted for ${nm}. Scan the next card.`, 'ok'); go('scan'); }
            catch (x) { toast(x.message, true); $('#ok').disabled = false; } };
          return;
        }
        const isRoll = mode === 'roll', pool = isRoll ? left0() : act.filter(x => !inAt.has(x.id) || !outAt.has(x.id)).map(x => x);
        const why = x => !inAt.has(x.id) && !outAt.has(x.id) ? 'No log in, no log out' : !inAt.has(x.id) ? 'No log in' : 'No log out';
        const stdOpts = isRoll ? (rollStds.length ? rollStds : standards.filter(x => !x.kind)) : (logStd ? [logStd] : standards.filter(x => !x.kind));
        const cur = isRoll ? absId : logId, sd = standards.find(x => x.id === cur);
        g.innerHTML = `<div class="stg"><p class="who">${pool.length} ${isRoll ? 'not scanned' : 'missed log in or log out'}</p><p class="muted">${isRoll ? 'These students were not scanned.' : 'The Constitution fines a missed log in or log out.'} Untick anyone who was excused.</p>
          ${stdOpts.length === 1 ? '' : `<label>Record for</label><select id="as">${stdOpts.map(x => `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${esc(x.title)}${x.fine ? ` (${peso1(x.fine)} fine)` : ''}</option>`).join('')}</select>`}
          ${sd ? `<p class="muted" style="margin:6px 0">Recorded as <b>${esc(sd.title)}</b>${sd.fine ? `, fine ${peso1(sd.fine)} each` : ''}.</p>` : ''}${dateBox}
          <div class="rvl">${pool.map(x => `<label class="ck"><input type="checkbox" data-a="${x.id}" checked><span>${esc(x.full_name)}${isRoll ? '' : `<small>${why(x)}</small>`}</span></label>`).join('') || '<p class="muted">Everyone is accounted for.</p>'}</div></div>
          <div class="scn-b stick"><button class="btn ghost big" id="bk">‹ Back</button><button class="btn gold big" id="rc" style="flex:2"${pool.length ? '' : ' disabled'}>Submit report</button></div>`;
        bind(); $('#as')?.addEventListener('change', e => { if (isRoll) absId = e.target.value; else logId = e.target.value; finPane(); });
        $('#bk').onclick = () => go('scan');
        $('#rc').onclick = async () => { const sid = isRoll ? absId : logId; if (!sid) return void say('Choose what to record these under.', 'warn');
          const ids = [...g.querySelectorAll('[data-a]:checked')].map(c => c.dataset.a); $('#rc').disabled = true; let done = 0;
          try { for (const id of ids) { await write(id, sid, dateV); done++; } toast(`${done} recorded${canApprove ? '' : ' for approval'}`); close(); draw().catch(() => {}); }
          catch (x) { toast(`${done} saved before the error: ${x.message}`, true); $('#rc').disabled = false; } };
      }
      const left0 = () => act.filter(x => !present.has(x.id));
      function got(s0) {
        if (!byId[s0.id]) return void say('That student is not on the active list.', 'bad');
        if (stage !== 'scan') return void say(`Finish ${pending ? pending.name : 'this step'} first.`, 'warn');
        if (mode === 'find') {
          if (checked.has(s0.id)) return void say(`${s0.name} is already checked.`, 'warn');
          if (!checkable.length) return void say('No violation standards yet. Add some in the Standards tab.', 'bad');
          pending = { id: s0.id, name: s0.name, bad: new Set() }; say(`✓ Scanned: ${s0.name}. Now choose the category.`, 'ok'); go('cat'); return true;
        }
        if (mode === 'roll') {
          if (present.has(s0.id)) return void say(`${s0.name} is already marked present.`, 'warn');
          present.add(s0.id); hist.unshift({ label: `✓ ${s0.name}`, undo: async () => { present.delete(s0.id); } }); say(`✓ Present: ${s0.name}`, 'ok'); scanPane(); return true;
        }
        const set = phase === 'in' ? inAt : outAt;
        if (set.has(s0.id)) return void say(`${s0.name} already logged ${phase === 'in' ? 'in' : 'out'} at ${tm(set.get(s0.id))}.`, 'warn');
        set.set(s0.id, new Date()); hist.unshift({ label: `${phase} ${s0.name}`, undo: async () => { set.delete(s0.id); } }); say(`✓ Logged ${phase}: ${s0.name}`, 'ok'); scanPane(); return true;
      }
      const onRaw = async raw => {
        const now = Date.now(); if (busy || (raw === last && now - lastAt < (lastOk ? 3000 : 1200))) return; busy = true; last = raw; lastAt = now; lastOk = false;
        try { const s0 = await db(sb.rpc('v2_resolve_token', { p_token: raw })); lastOk = !!got(s0); } catch (x) { say(x.message, 'bad'); }
        busy = false;
      };
      el.addEventListener('scan', e => onRaw(e.detail));           // lets a test or a hardware scanner feed codes without the camera
      el.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { mode = b.dataset.md; pending = null; el.querySelectorAll('[data-md]').forEach(x => x.classList.toggle('on', x === b));
        say({ find: 'Violations: scan a student’s card.', roll: 'Roll call: scan everyone who is present.', log: phase === 'in' ? 'Log in: scan students as they arrive.' : 'Log out: scan students as they leave.' }[mode]); go('scan'); });
      el.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => { phase = b.dataset.ph; el.querySelectorAll('[data-ph]').forEach(x => x.classList.toggle('on', x === b)); say(phase === 'in' ? 'Log in: scan students as they arrive.' : 'Log out: scan students as they leave.'); });
      $('#un').onclick = async () => { const h = hist.shift(); if (!h) return; try { await h.undo(); say('Undone: ' + h.label, 'warn'); } catch (x) { toast(x.message, true); hist.unshift(h); } scanPane(); };
      $('#pkb').onclick = pickList; $('#fin').onclick = () => go('fin'); $('#sx').onclick = close; go('scan');
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
  return watch(['v2_violations', 'v2_members', 'v2_standards'], () => draw().catch(() => {}));
}
