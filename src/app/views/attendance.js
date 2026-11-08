import { sb, db, watch, esc, fmtDate, fmtDateTime, toast, modal, uuid, todayISO, confirmDialog, skeleton, ROLE_LABEL } from '../core.js';
import { scanLoop } from '../qr.js';

/* Attendance: log in and log out by QR card.
   Only the President (Mayor) and the Vice Mayor (Internal and External) set an event and its category.
   The Marshals scan the students' cards and confirm each scan.
   The SAILS Secretary compiles who was missed (excused students unticked), then sends the fines report to the Mayor, Vice Mayor, Marshals and Treasurer.
   The SAILS PIO sends the report to the students through the app. */
const KINDS = { flag: 'Flag ceremony', event: 'Event (log in / log out)', inspection: 'Inspection' };   // inspection is only kept so old events still show a name; it is run from Watch
const needV2 = e => /relation|schema cache|does not exist|function .* not|could not find/i.test(e.message || '') ? 'Run the v21 and v22 SQL in Supabase first (supabase/v21_events_attendance.sql, then v22_attendance_report.sql).' : e.message;
const defStd = (k, stds) => (stds.find(s => (k === 'flag' ? /flag/i : /log\s*in|event log/i).test(s.title)) || stds.find(s => !s.kind) || {}).id || '';
const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH');

export async function mountAttendance(el, ctx) {
  el.innerHTML = skeleton(3);
  const unwatch = watch(['v2_events', 'v2_event_scans', 'v2_violations'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  await load();
  return unwatch;
  async function load() {
    const [members, standards] = await Promise.all([
      db(sb.from('v2_members').select('id,full_name,section,status').order('full_name')),
      db(sb.from('v2_standards').select('*').eq('active', true).order('sort_order')),
    ]);
    return draw(el, ctx, members, standards, () => load().catch(() => {}));
  }
}

async function draw(host, ctx, members, standards, redraw) {
  const manage = ctx.can('mayor', 'vice_mayor'), scanRoles = ctx.can('mayor', 'vice_mayor', 'secretary', 'marshall', 'sails'), isMayor = ctx.can('mayor'), uid = ctx.profile.user_id, canCompile = ctx.can('mayor', 'secretary'), canNotify = ctx.can('mayor', 'pio');
  const sees = ctx.can('mayor', 'vice_mayor', 'marshall', 'treasurer', 'secretary', 'pio', 'auditor'), collects = ctx.can('mayor', 'treasurer');
  const act = members.filter(x => x.status === 'active'), mname = id => members.find(m => m.id === id)?.full_name || '?';
  let events, scans, viol = [], paid = new Set(), posts = [];
  try {
    [events, scans] = await Promise.all([
      db(sb.from('v2_events').select('*').order('event_date', { ascending: false }).order('created_at', { ascending: false })),
      db(sb.from('v2_event_scans').select('event_id,member_id,kind,scanned_by_name')),
    ]);
  } catch (e) { host.innerHTML = `<div class="card pad"><p class="empty">${esc(needV2(e))}</p></div>`; return; }
  if (sees) {
    viol = await db(sb.from('v2_violations').select('id,member_id,standard_id,event_id,status,excuse_status').not('event_id', 'is', null)).catch(() => []);
    paid = new Set(await db(sb.from('v2_entries').select('violation_id').not('violation_id', 'is', null).neq('status', 'voided')).then(r => r.map(x => x.violation_id)).catch(() => []));
  }
  if (sees) posts = await db(sb.from('v2_office_records').select('id,title,status,flags,event_id').eq('kind', 'post').not('event_id', 'is', null)).catch(() => []);
  /* Line of authority: the Mayor orders the event and names who scans (v35). Before v35 is installed the old rule applies. */
  const ordersOn = events.some(e => 'ordered_at' in e), waiting = e => ordersOn && !e.ordered_at && !e.legacy_open;
  const assigned = e => !ordersOn ? scanRoles : e.ordered_at ? (e.scanner_ids || []).includes(uid) : !!(e.legacy_open && scanRoles);
  const std = id => standards.find(s => s.id === id);
  const chain = e => { const ps = posts.filter(p => p.event_id === e.id), fl = p => p.flags || {}, ann = ps.filter(p => fl(p).type === 'announcement'), doc = ps.filter(p => ['documentation', 'media'].includes(fl(p).type));
    const c = cnt(e.id), who = [...new Set(scans.filter(x => x.event_id === e.id && x.scanned_by_name).map(x => x.scanned_by_name))], on = x => x ? fmtDateTime(x) : '';
    const sent = ann.find(p => fl(p).notice), okd = ann.find(p => p.status === 'approved'), rev = ann.find(p => p.status === 'review');
    return [
      [e.ordered_at ? 'ok' : waiting(e) ? 'warn' : '', 'Ordered by the Mayor', e.ordered_at ? `${e.ordered_by_name || 'Mayor'} · ${on(e.ordered_at)}` : waiting(e) ? 'Waiting for the Mayor’s order' : 'Set before orders were required'],
      [(e.scanner_names || []).length ? 'ok' : '', 'Scanners assigned', (e.scanner_names || []).join(', ') || (e.legacy_open ? 'Any scanning officer' : '—')],
      [sent ? 'ok' : okd || rev ? 'warn' : '', 'Announced by the SAILS PIO', sent ? 'Sent as a notice' : okd ? `Approved by ${fl(okd).approved_by || 'the Mayor'}, ready to send` : rev ? 'Waiting for the Mayor’s approval' : ann.length ? 'Draft' : 'Not drafted yet'],
      [c.in.size ? 'ok' : '', 'Attendance scanned', `In ${c.in.size} of ${act.length}${who.length ? ' · by ' + who.join(', ') : ''}`],
      [e.finalized_at ? 'ok' : '', 'Compiled by the SAILS Secretary', e.finalized_at ? `${e.compiled_by_name || 'Secretary'} · ${on(e.finalized_at)}` : 'Not yet'],
      [e.report_sent_at ? 'ok' : '', 'Fines report sent', e.report_sent_at ? `${e.report_by_name || 'Secretary'} · ${on(e.report_sent_at)}` : 'Not yet'],
      [e.notified_at ? 'ok' : '', 'Students notified', e.notified_at ? `${e.notified_by_name || 'PIO'} · ${on(e.notified_at)}` : 'Not yet'],
      [doc.some(p => ['approved', 'published'].includes(p.status)) ? 'ok' : doc.length ? 'warn' : '', 'Documented by the SAILS PIO', doc.some(p => ['approved', 'published'].includes(p.status)) ? 'Photos and media filed' : doc.length ? 'In draft' : 'Not yet'],
    ]; };
  const cnt = id => { const o = { in: new Set(), out: new Set() }; scans.filter(s => s.event_id === id).forEach(s => o[s.kind].add(s.member_id)); return o; };
  const finesOf = id => viol.filter(v => v.event_id === id && !['rejected', 'awaiting_approval'].includes(v.status) && v.excuse_status !== 'accepted');
  const stage = e => e.notified_at ? ['Students notified', 'ok'] : e.report_sent_at ? ['Report sent', 'warn'] : e.finalized_at ? ['Compiled', 'warn'] : e.status === 'open' ? ['Open', 'ok'] : ['Closed', ''];
  const card = e => { const c = cnt(e.id), open = e.status === 'open', [lbl, cls] = stage(e), fl = finesOf(e.id), tot = fl.reduce((t, v) => t + (+std(v.standard_id)?.fine || 0), 0);
    const report = sees && e.report_sent_at ? `<div class="card pad" style="margin:8px 0 0"><b>Fines report from ${esc(e.report_by_name || 'the SAILS Secretary')}</b>
        <p class="muted" style="margin:4px 0">${fl.length} student${fl.length === 1 ? '' : 's'}, ${peso(tot)} in fines. ${collects ? 'Please collect them.' : 'Treasurer and Mayor collect.'}${e.report_note ? `<br>“${esc(e.report_note)}”` : ''}</p>
        <details${collects ? ' open' : ''}><summary>Show the list</summary>${fl.map(v => { const f = +std(v.standard_id)?.fine || 0; return `<div class="fr"><span>${esc(mname(v.member_id))}</span><b>${paid.has(v.id) ? 'paid' : peso(f)}</b>${collects && f && !paid.has(v.id) ? `<button class="btn gold sm" data-co="${v.id}">Collect</button>` : ''}</div>`; }).join('')}</details></div>` : '';
    return `<div class="row stk vw"><div class="m"><b>${esc(e.title)} <span class="tag ${cls}">${lbl}</span></b>
      <small>${KINDS[e.kind] || e.kind} · ${fmtDate(e.event_date)}${e.created_by_name ? ` · set by ${esc(e.created_by_name)}` : ''}<br>In ${c.in.size} of ${act.length}${e.needs_out ? ` · Out ${c.out.size} of ${act.length}` : ''}${waiting(e) ? '<br><b>Waiting for the Mayor’s order. Nobody can scan yet.</b>' : (e.scanner_names || []).length ? `<br>Scanners: ${esc(e.scanner_names.join(', '))}` : ''}</small>${report}
      <details style="margin-top:8px"><summary>Chain of command</summary>${chain(e).map(([k, l, d]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid var(--line)"><span>${k === 'ok' ? '✓' : k === 'warn' ? '…' : '○'} ${l}</span><small class="muted" style="text-align:right">${esc(d)}</small></div>`).join('')}</details></div>
      <div class="acts">${open && assigned(e) ? `<button class="btn gold sm" data-sc="${e.id}">📷 Scan attendance</button>` : ''}
      ${isMayor && open && ordersOn ? `<button class="btn ${e.ordered_at ? 'ghost' : 'gold'} sm" data-od="${e.id}">${e.ordered_at ? 'Change scanners' : 'Order scanners'}</button>` : ''}
      ${canCompile && !e.finalized_at ? `<button class="btn ${open ? 'ghost' : 'gold'} sm" data-rv="${e.id}">Compile attendance</button>` : ''}
      ${canCompile && e.finalized_at && !e.report_sent_at ? `<button class="btn gold sm" data-sr="${e.id}">Send fines report</button>` : ''}
      ${canNotify && e.report_sent_at && !e.notified_at ? `<button class="btn gold sm" data-nt="${e.id}">Send to students</button>` : ''}
      ${manage ? `<button class="btn ghost sm" data-cl="${e.id}">${open ? 'Close' : 'Reopen'}</button><button class="btn ghost sm" data-dl="${e.id}">Delete</button>` : ''}</div></div>`; };
  host.innerHTML = `${manage ? '<div class="bar"><button class="btn gold" id="ne">+ New event</button></div>' : '<p class="swipe-hint">The President sets the event and names the officers who scan. The SAILS Secretary compiles, the SAILS PIO tells the students.</p>'}
    <div class="card">${events.map(card).join('') || '<p class="empty">No events yet.</p>'}</div>`;
  const ev = id => events.find(e => e.id === id);
  host.querySelector('#ne')?.addEventListener('click', () => newEvent());
  host.querySelectorAll('[data-od]').forEach(b => b.onclick = () => orderEvent(ev(b.dataset.od)));
  host.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => scanEvent(ev(b.dataset.sc)));
  host.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => compile(ev(b.dataset.rv)));
  host.querySelectorAll('[data-sr]').forEach(b => b.onclick = () => sendReport(ev(b.dataset.sr)));
  host.querySelectorAll('[data-nt]').forEach(b => b.onclick = async () => { const e = ev(b.dataset.nt);
    if (!(await confirmDialog(`This posts a notice about “${e.title}” and sends a phone alert to students who turned alerts on. Each student sees their own fine on their card.`, { ok: 'Send to students', title: 'Send the report to students?' }))) return;
    try { await db(sb.rpc('v2_event_notify', { p_event: e.id })); toast('Students notified'); redraw(); } catch (x) { toast(needV2(x), true); } });
  host.querySelectorAll('[data-co]').forEach(b => b.onclick = () => { const v = viol.find(x => x.id === b.dataset.co), s = std(v.standard_id), e = ev(v.event_id);
    try { sessionStorage.setItem('alpha-prefill', JSON.stringify({ member: v.member_id, amount: s.fine, purpose: `Fine: ${s.title}${e ? ' · ' + e.title : ''}`, cat: 'Fines', fund: 'sails', violation: v.id })); } catch { /* ignore */ }
    location.hash = '#/staff/treasury'; });
  host.querySelectorAll('[data-cl]').forEach(b => b.onclick = async () => { const e = ev(b.dataset.cl);
    try { await db(sb.from('v2_events').update(e.status === 'open' ? { status: 'closed' } : { status: 'open', closed_at: null }).eq('id', e.id)); redraw(); } catch (x) { toast(needV2(x), true); } });
  host.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => { const e = ev(b.dataset.dl);
    if (!(await confirmDialog(`Delete “${e.title}” and its scans? Absences already recorded stay in the Watch ledger.`, { ok: 'Delete', danger: true }))) return;
    try { await db(sb.from('v2_events').delete().eq('id', e.id)); toast('Deleted'); redraw(); } catch (x) { toast(needV2(x), true); } });

  function newEvent() {
    modal(`<h3>New event</h3><form id="nf">
      <label>Type</label><select name="k">${Object.entries(KINDS).filter(([k]) => k !== 'inspection').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <label>Name</label><input name="t" maxlength="80" required value="Flag ceremony">
      <label>Date</label><input name="d" type="date" value="${todayISO()}" required>
      <label class="ck" id="oc" hidden><input type="checkbox" name="o" checked><span>Students also log out</span></label>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Create and open</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      const f = m.querySelector('#nf'), k = f.elements.k, t = f.elements.t; let touched = false;
      t.oninput = () => { touched = true; };
      const sync = () => { m.querySelector('#oc').hidden = k.value !== 'event'; if (!touched) t.value = k.value === 'event' ? '' : KINDS[k.value]; };
      k.onchange = sync; sync(); m.querySelector('#cx').onclick = close;
      f.onsubmit = async e => { e.preventDefault(); const x = f.elements;
        try { await db(sb.from('v2_events').insert({ id: uuid(), title: x.t.value.trim(), kind: x.k.value, event_date: x.d.value, needs_out: x.k.value === 'event' && x.o.checked, standard_id: defStd(x.k.value, standards) || null }));
          const row = await db(sb.from('v2_events').select('*').eq('title', x.t.value.trim()).eq('event_date', x.d.value).order('created_at', { ascending: false }).limit(1)).then(r => r[0], () => null);
          close(); redraw();
          if (row && 'ordered_at' in row) { if (isMayor) { toast('Event created. Now name the officers who scan.'); orderEvent(row); } else toast('Event created. It waits for the Mayor’s order before anyone can scan.'); } else toast('Event is open. Officers can scan now.'); } catch (er) { m.querySelector('#er').textContent = needV2(er); } };
    });
  }

  /* The Mayor's order: who is assigned to scan this event */
  async function orderEvent(e) {
    if (!e) return;
    const off = await db(sb.from('v2_profiles').select('user_id,full_name,role').in('role', ['mayor', 'vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'marshall', 'sails']).order('full_name')).catch(() => []), cur = new Set(e.scanner_ids || []);
    modal(`<h3>Order: ${esc(e.title)}</h3><p class="muted" style="margin:0 0 8px">Only the officers you tick can scan this event. Nobody else can, not even you, unless you tick yourself.</p>
      <div class="card" style="max-height:40vh;overflow:auto;padding:6px 10px">${off.map(o => `<label class="ck"><input type="checkbox" data-u="${o.user_id}"${cur.has(o.user_id) ? ' checked' : ''}><span>${esc(o.full_name)} · ${esc(ROLE_LABEL[o.role] || o.role)}</span></label>`).join('') || '<p class="empty">No officers found.</p>'}</div>
      <label>Note for the officers (optional)</label><input id="on" maxlength="300" value="${esc(e.order_note || '')}" placeholder="Gate 1, 6:30 AM, bring your phones">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="os" style="flex:1">${e.ordered_at ? 'Update the order' : 'Issue the order'}</button><button class="btn ghost" id="oc">Later</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#oc').onclick = close;
      m.querySelector('#os').onclick = async () => { const ids = [...m.querySelectorAll('[data-u]:checked')].map(i => i.dataset.u);
        if (!ids.length) { m.querySelector('#er').textContent = 'Tick at least one officer to scan.'; return; }
        try { await db(sb.rpc('v2_event_order', { p_event: e.id, p_scanners: ids, p_note: m.querySelector('#on').value.trim() || null })); close(); toast('Order issued. The assigned officers can scan now.'); redraw(); }
        catch (x) { m.querySelector('#er').textContent = /function|schema cache/i.test(x.message || '') ? 'Run the v35 SQL in Supabase first (supabase/v35_event_orders.sql).' : x.message; } };
    });
  }

  /* Secretary: who never scanned? Untick the excused, then record the rest as absences. */
  function compile(e) {
    const c = cnt(e.id), need = x => !c.in.has(x.id) || (e.needs_out && !c.out.has(x.id));
    const why = x => !c.in.has(x.id) && e.needs_out && !c.out.has(x.id) ? 'No log in, no log out' : !c.in.has(x.id) ? (e.needs_out ? 'No log in' : 'Not scanned') : 'No log out';
    const pool = act.filter(need), s = std(e.standard_id);
    modal(`<h3>Compile attendance</h3><p class="muted" style="margin:0 0 8px">${esc(e.title)} · ${fmtDate(e.event_date)}${e.status === 'open' ? '<br><b>Still open.</b> Compiling closes the event, so scanning stops.' : ''}</p>
      <p class="muted" style="margin:0 0 8px">Recorded as <b>${esc(s?.title || 'no standard set')}</b>${s?.fine ? `, fine ${peso(s.fine)} each` : ''}. ${pool.length} to record. Untick anyone who was excused.</p>
      <div class="rvl">${pool.map(x => `<label class="ck"><input type="checkbox" data-a="${x.id}" checked><span>${esc(x.full_name)}<small>${why(x)}</small></span></label>`).join('') || '<p class="muted">Everyone is accounted for.</p>'}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:2">${pool.length ? 'Record absences' : 'Close event'}</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#go').onclick = async () => { const ids = [...m.querySelectorAll('[data-a]:checked')].map(x => x.dataset.a); m.querySelector('#go').disabled = true;
        try { const n = await db(sb.rpc('v2_event_compile', { p_event: e.id, p_members: ids })); toast(`${n} absence${n === 1 ? '' : 's'} recorded. Now send the fines report.`); close(); redraw(); }
        catch (x) { m.querySelector('#er').textContent = needV2(x); m.querySelector('#go').disabled = false; } };
    });
  }

  /* Secretary: send the fines report to the officers who collect. */
  function sendReport(e) {
    const fl = finesOf(e.id), tot = fl.reduce((t, v) => t + (+std(v.standard_id)?.fine || 0), 0);
    modal(`<h3>Send fines report</h3><p class="muted" style="margin:0 0 8px">${esc(e.title)} · goes to the President, Vice Mayor, Marshals and Treasurer.</p>
      <div class="card pad"><b>${fl.length} student${fl.length === 1 ? '' : 's'} · ${peso(tot)} in fines</b>${fl.map(v => `<div class="fr"><span>${esc(mname(v.member_id))}</span><b>${peso(std(v.standard_id)?.fine)}</b></div>`).join('')}</div>
      <label>Note (optional)</label><textarea id="nt" rows="2" maxlength="500" placeholder="Please collect these fines this week."></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:2">Send report</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#go').onclick = async () => { m.querySelector('#go').disabled = true;
        try { await db(sb.rpc('v2_event_send_report', { p_event: e.id, p_note: m.querySelector('#nt').value })); toast('Report sent to the officers'); close(); redraw(); }
        catch (x) { m.querySelector('#er').textContent = needV2(x); m.querySelector('#go').disabled = false; } };
    });
  }

  /* Officers: scan, then confirm. */
  function scanEvent(e) {
    const mine = cnt(e.id), byId = Object.fromEntries(act.map(x => [x.id, x]));
    let dir = 'in', confirmEach = true, stage = 'scan', pending = null, busy = false, last = '', lastAt = 0, lastOk = false; const hist = [];
    const tm = () => new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
    const mo = modal(`<div class="scn full">
      <div class="scn-h"><b>${esc(e.title)}</b><span class="steps" id="stp"></span><button type="button" class="x" id="sx" aria-label="Close">✕</button></div>
      <div class="sb idle" id="sb" role="status" aria-live="polite">Starting camera…</div>
      <div id="g1">
        ${e.needs_out ? '<div class="seg" id="ph"><button data-ph="in" class="on">Log in</button><button data-ph="out">Log out</button></div>' : ''}
        <div class="vid" id="vd"><video id="sv" playsinline muted></video><button type="button" class="torch" id="tc" hidden aria-label="Flashlight">🔦</button><span class="pill" id="cn"></span></div>
        <label class="ck" style="margin:6px 0"><input type="checkbox" id="cf" checked><span>Confirm each scan</span></label>
        <div class="scn-b"><button type="button" class="btn ghost big" id="un" hidden>↩ Undo last</button><button type="button" class="btn ghost big" id="pkb">Can’t scan? Pick</button><button type="button" class="btn gold big" id="dn">Done</button></div>
        <div id="pkw" hidden></div></div>
      <div id="g2" hidden></div></div>`, (el, close) => {
      el.classList.add('scnm');
      const $ = q => el.querySelector(q);
      let ac = null;
      const beep = ok => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = ok ? 880 : 300; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.28)); } catch { /* no sound */ } };
      const say = (txt, kind = 'idle') => { const b = $('#sb'); b.className = 'sb ' + kind; b.textContent = txt;
        if (kind !== 'idle') { const v = $('#vd'); v.classList.remove('flash', 'ok', 'warn', 'bad'); void v.offsetWidth; v.classList.add('flash', kind); beep(kind === 'ok'); try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 60 : [80, 60, 80]); } catch { /* ignore */ } } };
      const showSteps = () => { $('#stp').innerHTML = [['scan', 'Scan'], ['conf', 'Confirm']].map(([k, l], i) => { const at = stage === 'scan' ? 0 : 1; return `<span class="${i === at ? 'on' : i < at ? 'done' : ''}"><i>${i < at ? '✓' : i + 1}</i>${l}</span>`; }).join(''); };
      const go = st => { stage = st; $('#g1').hidden = st !== 'scan'; $('#g2').hidden = st === 'scan'; showSteps(); if (st === 'scan') scanPane(); else confPane(); };
      const label = () => dir === 'in' ? 'log in' : 'log out';
      function scanPane() { $('#cn').textContent = `In ${mine.in.size} of ${act.length}${e.needs_out ? ` · Out ${mine.out.size}` : ''}`; $('#un').hidden = !hist.length; }
      /* write one scan; the database refuses a second scan of the same student in the same direction */
      async function record(mem, d) {
        const id = uuid();
        try { await db(sb.from('v2_event_scans').insert({ id, event_id: e.id, member_id: mem.id, kind: d })); }
        catch (x) { if (/duplicate|unique/i.test(x.message)) { mine[d].add(mem.id); say(`${mem.name} already ${d === 'in' ? 'logged in' : 'logged out'}.`, 'warn'); } else say(/closed/i.test(x.message) ? 'This event was closed by the President.' : needV2(x), 'bad'); return false; }
        mine[d].add(mem.id); hist.unshift({ label: `${d} ${mem.name}`, undo: async () => { await db(sb.from('v2_event_scans').delete().eq('id', id)); mine[d].delete(mem.id); } });
        say(`✓ ${d === 'in' ? 'Logged in' : 'Logged out'}: ${mem.name} · ${tm()}`, 'ok'); return true;
      }
      function confPane() {
        const g = $('#g2'), noIn = dir === 'out' && !mine.in.has(pending.id);
        g.innerHTML = `<div class="stg"><p class="who">${esc(pending.name)}</p><p class="muted">${e.needs_out ? `Confirm ${label()} for` : 'Confirm attendance for'} ${esc(e.title)}.</p>
          ${noIn ? '<p class="sb warn" style="margin:8px 0">No log in yet for this student.</p>' : ''}</div>
          <div class="scn-b stick"><button class="btn ghost big" id="bk">‹ Cancel</button><button class="btn gold big" id="ok" style="flex:2">✓ Confirm ${e.needs_out ? label() : 'present'}</button></div>`;
        $('#bk').onclick = () => { pending = null; say('Cancelled. Scan the next card.'); go('scan'); };
        $('#ok').onclick = async () => { $('#ok').disabled = true; const p = pending; pending = null; await record(p, dir); go('scan'); };
      }
      function got(s0) {
        if (!byId[s0.id]) return void say('That student is not on the active list.', 'bad');
        if (stage !== 'scan') return void say(`Finish ${pending ? pending.name : 'this step'} first.`, 'warn');
        if (mine[dir].has(s0.id)) return void say(`${s0.name} already ${dir === 'in' ? 'logged in' : 'logged out'}.`, 'warn');
        const p = { id: s0.id, name: s0.name };
        if (!confirmEach) { record(p, dir).then(scanPane); return true; }
        pending = p; say(`✓ Scanned: ${s0.name}. Confirm to record.`, 'ok'); go('conf'); return true;
      }
      function pickList() {
        const w = $('#pkw'); w.hidden = !w.hidden; if (w.hidden) return;
        w.innerHTML = `<select id="pk"><option value="">Choose a student…</option>${act.filter(x => !mine[dir].has(x.id)).map(x => `<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select>`;
        w.querySelector('#pk').onchange = ev2 => { const mem = byId[ev2.target.value]; w.hidden = true; if (mem) got({ id: mem.id, name: mem.full_name }); };
      }
      const onRaw = async raw => {
        const now = Date.now(); if (busy || (raw === last && now - lastAt < (lastOk ? 3000 : 1200))) return; busy = true; last = raw; lastAt = now; lastOk = false;
        try { const s0 = await db(sb.rpc('v2_resolve_token', { p_token: raw })); lastOk = !!got(s0); } catch (x) { say(x.message, 'bad'); }
        busy = false;
      };
      el.addEventListener('scan', ev2 => onRaw(ev2.detail));       // lets a test or a hardware scanner feed codes without the camera
      el.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => { dir = b.dataset.ph; el.querySelectorAll('[data-ph]').forEach(x => x.classList.toggle('on', x === b)); say(`${label()[0].toUpperCase() + label().slice(1)}: scan students.`); scanPane(); });
      $('#cf').onchange = ev2 => { confirmEach = ev2.target.checked; say(confirmEach ? 'Each scan will ask for confirmation.' : 'Scans are recorded straight away.'); };
      $('#un').onclick = async () => { const h = hist.shift(); if (!h) return; try { await h.undo(); say('Undone: ' + h.label, 'warn'); } catch (x) { toast(x.message, true); hist.unshift(h); } scanPane(); };
      $('#pkb').onclick = pickList; $('#sx').onclick = $('#dn').onclick = () => { close(); redraw(); }; say(`${e.title}: scan a student’s card.`); go('scan');
      scanLoop(el, $('#sv'), onRaw, stream => { const tr = stream.getVideoTracks()[0]; if (tr?.getCapabilities?.().torch) { const b = $('#tc'); b.hidden = false; let on = false; b.onclick = () => { on = !on; tr.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); b.classList.toggle('on', on); }; } })
        .then(() => {}, er => say('Camera unavailable (' + (er.message || er) + '). Use “Can’t scan? Pick”.', 'bad'));
      $('#sv').addEventListener('playing', () => say('Camera ready. Point at a student’s QR card.'));
    });
    return mo;
  }
}
