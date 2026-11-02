import { sb, db, watch, esc, toast, modal, skeleton, confirmDialog, fmtDate, todayISO, printHTML, letterhead, peso } from '../core.js';
import { ymManila } from '../money.js';

/* Office desks for the Secretary (Second Mate), Auditor (Third Mate), PIO (OIC) and Marshals (Bosun).
   Each officer gets an overview that works out what needs them from records the app already keeps, plus their own records.
   Run supabase/v29_office_records.sql once for the records to save. */
const dayMs = 864e5;
const ST = { draft: ['draft', 'warn'], filed: ['filed', 'ok'], adopted: ['adopted', 'ok'], implemented: ['implemented', 'ok'], open: ['open', 'warn'], replied: ['replied', 'ok'], review: ['in review', 'warn'], reported: ['reported', 'warn'],
  resolved: ['resolved', 'ok'], approved: ['approved', 'ok'], published: ['published', 'ok'], planned: ['planned', 'warn'], done: ['done', 'ok'], cancelled: ['cancelled', ''] };
const tag = s => `<span class="tag ${(ST[s] || [])[1] || ''}">${(ST[s] || [s])[0]}</span>`;
const FLOW = { draft: ['draft', 'warn'], reviewed: ['with the approver', 'warn'], returned: ['returned', 'bad'], approved: ['approved', 'ok'], classified: ['classified', 'ok'], published: ['posted to members', 'ok'] };
const ftag = r => r.flow ? `<span class="tag ${FLOW[r.flow][1]}">${FLOW[r.flow][0]}</span>` : tag(r.status);
const SEC = ['minutes', 'resolution', 'letter_in', 'letter_out'];
const LEVEL = { low: ['low', 'ok'], medium: ['medium', 'warn'], high: ['high', 'bad'] };
const CHECKLIST = 'Venue opened and arranged\nSeating and crowd flow set\nFirst-aid kit at the venue\nExits kept clear\nAttendance scanners ready\nMarshal posts assigned\nWater, trash and cleanup';

const KIND = {
  minutes: { l: 'Minutes', t: 'Meeting', p: 'Presided by and attendees', b: 'Minutes (what was discussed and decided)', conf: 1, link: 'Link to the signed copy', st: [['draft', 'Draft'], ['filed', 'Filed']] },
  resolution: { l: 'Resolution', t: 'Resolution title', p: 'Moved by', b: 'Resolution text', conf: 1, st: [['draft', 'Draft'], ['adopted', 'Adopted'], ['implemented', 'Implemented']] },
  letter_in: { l: 'Letter received', t: 'Subject', p: 'From', b: 'Summary', conf: 1, link: 'Link to the scanned letter', st: [['open', 'Needs a reply'], ['replied', 'Replied'], ['filed', 'Filed']] },
  letter_out: { l: 'Letter sent', t: 'Subject', p: 'To', b: 'Summary', conf: 1, link: 'Link to the signed copy', st: [['draft', 'Draft'], ['filed', 'Sent and filed']] },
  finding: { l: 'Audit finding', t: 'Finding', p: 'Concerning (entry, fund or person)', b: 'What was found and the evidence', level: 1, st: [['open', 'Open'], ['reported', 'Reported'], ['resolved', 'Resolved']],
    flags: [['board', 'Reported to the Executive Board'], ['adviser', 'Reported to the adviser'], ['assembly', 'Presented to the General Assembly']] },
  post: { l: 'Post or publication', t: 'Title', p: 'Channel (page, bulletin, poster…)', b: 'Content or caption', link: 'Link to the post', st: [['draft', 'Draft'], ['review', 'In review'], ['approved', 'Approved'], ['published', 'Published']],
    flags: [['privacy', 'Privacy checked (no private data, consent for photos)'], ['branding', 'Branding rules followed'], ['comms', 'Communication rules followed (facts, tone, approvals)']] },
  plan: { l: 'Activity plan', t: 'Activity', p: 'Posts and assignments', b: 'Notes', event: 1, items: 'Logistics and safety checklist (one line each)', st: [['planned', 'Planned'], ['done', 'Done'], ['cancelled', 'Cancelled']] },
  incident: { l: 'Safety log', t: 'What happened', p: 'Where', b: 'Details and who was told', st: [['open', 'Open'], ['resolved', 'Resolved']] },
};
const OFFICES = {
  secretary: { title: 'Secretary (Second Mate)', blurb: 'Maintain minutes, attendance records, resolutions, notices, membership records and official correspondence; safeguard records; give members reasonable access to non-confidential documents.',
    panes: [['over', 'Overview'], ['minutes', 'Minutes', ['minutes']], ['resolutions', 'Resolutions', ['resolution']], ['letters', 'Letters', ['letter_in', 'letter_out']]], go: [['docs', 'Documents'], ['students', 'Students'], ['notices', 'Notices'], ['attendance', 'Attendance']] },
  auditor: { title: 'Auditor (Third Mate)', blurb: 'Independently examine financial records, verify receipts and disbursements, report discrepancies to the Executive Board and adviser, and present findings to the General Assembly. The Auditor does not approve or carry out the transactions being audited.',
    panes: [['over', 'Overview'], ['classify', 'Classify files'], ['findings', 'Findings', ['finding']], ['report', 'GA report']], go: [['treasury', 'Treasury'], ['balances', 'Balances'], ['requests', 'Budget']] },
  pio: { title: 'Public Information Officer (OIC)', blurb: 'Manage official announcements, publications, documentation and media, following the PIT communication, privacy and branding rules.',
    panes: [['over', 'Overview'], ['publish', 'Post files'], ['posts', 'Posts', ['post']]], go: [['notices', 'Notices'], ['attendance', 'Attendance']] },
  marshall: { title: 'Marshal (Bosun)', blurb: 'Help keep order, logistics, attendance support and safety during authorized activities. Marshals report and assist. They do not use coercive or disciplinary powers.',
    panes: [['over', 'Overview'], ['plans', 'Activity plans', ['plan']], ['safety', 'Safety log', ['incident']]], go: [['attendance', 'Attendance'], ['watch', 'Watch']] },
};
const ANY = async (p, dflt = []) => { try { return await db(p); } catch { return dflt; } };

export async function mountOffice(el, ctx) {
  const role = ctx.profile.role, O = OFFICES[role];
  if (!O) { el.innerHTML = '<p class="empty">This desk is for the Secretary, Auditor, PIO and Marshals.</p>'; return () => {}; }
  let pane = 'over', recs = [], X = {}, missing = false;

  async function load() {
    try { recs = await db(sb.from('v2_office_records').select('*').order('on_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)); missing = false; }
    catch (e) { if (/does not exist|schema cache|relation/i.test(e.message || '')) { missing = true; recs = []; } else throw e; }
    X = await extra();
    draw();
  }

  /* what the app already knows that concerns this office */
  async function extra() {
    const today = todayISO(), x = {};
    const events = await ANY(sb.from('v2_events').select('id,title,event_date,status,report_sent_at,notified_at').order('event_date', { ascending: false }).limit(60));
    x.events = events;
    if (role === 'secretary') {
      [x.fbr, x.liq, x.docs, x.meet] = await Promise.all([ANY(sb.from('v2_budget_requests').select('id,req_no,title,status').eq('status', 'approved')), ANY(sb.from('v2_liquidations').select('id,request_id,status').eq('status', 'audited')),
        ANY(sb.from('v2_documents').select('id,title,status,due_on').neq('status', 'submitted')), ANY(sb.from('v2_vp_meetings').select('id,title,held_on,status').in('status', ['approved', 'done']))]);
    }
    if (role === 'auditor') {
      const [ent, img, liq, close] = await Promise.all([ANY(sb.from('v2_entries').select('id,kind,amount,status,occurred_at,member_id,payer_name,recorded_by_name,approved_by_name,charge_id').neq('status', 'voided').order('occurred_at', { ascending: false }).limit(3000)),
        ANY(sb.from('v2_entries').select('id').not('receipt_image', 'is', null)), ANY(sb.from('v2_liquidations').select('id,status').eq('status', 'approved')), ANY(sb.from('v2_month_close').select('month,status'))]);
      const has = new Set(img.map(i => i.id)), now = Date.now(), cur = ymManila(new Date());
      x.noReceipt = ent.filter(e => e.kind === 'expense' && e.status !== 'rejected' && now - new Date(e.occurred_at) < 60 * dayMs && !has.has(e.id));
      x.self = ent.filter(e => e.status === 'approved' && e.approved_by_name && e.recorded_by_name && e.approved_by_name === e.recorded_by_name);
      const g = {}; ent.filter(e => e.status !== 'rejected').forEach(e => { const k = [e.kind, e.amount, e.member_id || e.payer_name || '', new Date(e.occurred_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), e.charge_id || ''].join('|'); (g[k] ||= []).push(e); });
      x.dups = Object.values(g).filter(a => a.length > 1);
      x.liq = liq;
      const done = new Set(close.filter(c => ['checked', 'closed'].includes(c.status)).map(c => c.month));
      x.months = [...new Set(ent.filter(e => e.status === 'approved').map(e => ymManila(e.occurred_at)))].filter(m => m < cur && !done.has(m)).sort();
      x.count = ent.length; x.sum = { in: ent.filter(e => e.kind === 'collection' && e.status === 'approved').reduce((t, e) => t + +e.amount, 0), out: ent.filter(e => e.kind === 'expense' && e.status === 'approved').reduce((t, e) => t + +e.amount, 0) };
    }
    return x;
  }

  const of = k => recs.filter(r => r.kind === k);
  function needs() {
    const today = todayISO(), n = [], add = (t, p) => n.push({ t, p });
    const c = (a, label, p) => { if (a) add(`${a} ${label}`, p); };
    if (role === 'secretary') {
      c(X.events.filter(e => e.status === 'closed' && !e.report_sent_at).length, 'closed event(s) where the absences are not compiled and sent yet', 'go:attendance');
      c((X.fbr || []).length, 'approved budget request(s) to file', 'go:requests'); c((X.liq || []).length, 'audited liquidation report(s) to file', 'go:requests');
      c((X.docs || []).filter(d => d.due_on && d.due_on <= new Date(Date.now() + 3 * dayMs).toISOString().slice(0, 10)).length, 'document(s) due within 3 days or late', 'go:docs');
      const minuted = new Set(of('minutes').map(r => r.on_date)); c((X.meet || []).filter(m => m.held_on < today && m.status !== 'cancelled' && !minuted.has(m.held_on)).length, 'meeting(s) held with no minutes recorded', 'minutes');
      c(of('letter_in').filter(r => r.status === 'open').length, 'letter(s) received that still need a reply', 'letters');
      c(recs.filter(r => r.flow === 'returned').length, 'record(s) returned for changes', 'minutes');
      c(recs.filter(r => r.flow === 'draft').length, 'record(s) not sent for approval yet', 'minutes');
      c(recs.filter(r => r.status === 'draft' && ['minutes', 'resolution', 'letter_out'].includes(r.kind)).length, 'draft record(s) not filed yet', 'minutes');
    } else if (role === 'auditor') {
      c((X.noReceipt || []).length, 'expense(s) in the last 60 days with no receipt photo', 'go:treasury'); c((X.dups || []).length, 'possible duplicate entry group(s)', 'go:treasury');
      c((X.self || []).length, 'entr' + ((X.self || []).length === 1 ? 'y' : 'ies') + ' recorded and approved by the same person', 'go:treasury'); c((X.liq || []).length, 'liquidation report(s) waiting for your audit', 'go:requests');
      c((X.months || []).length, 'past month(s) with no cash count verified (' + (X.months || []).slice(0, 3).join(', ') + ')', 'go:treasury');
      c(recs.filter(r => r.flow === 'approved').length, 'approved file(s) waiting for you to classify as public or confidential', 'classify');
      c(of('finding').filter(r => r.status === 'open').length, 'open finding(s) not reported yet', 'findings'); c(of('finding').filter(r => r.status === 'reported' && !(r.flags || {}).assembly).length, 'reported finding(s) not yet presented to the General Assembly', 'findings');
    } else if (role === 'pio') {
      c(X.events.filter(e => e.report_sent_at && !e.notified_at).length, 'attendance fines report(s) waiting to be sent to the students', 'go:attendance');
      c(recs.filter(r => r.flow === 'classified' && r.classification === 'public').length, 'public file(s) ready to post to the members', 'publish');
      c(of('post').filter(r => r.status === 'review').length, 'post(s) in review', 'posts'); c(of('post').filter(r => r.status === 'approved').length, 'approved post(s) not published yet', 'posts');
      const posted = new Set(of('post').map(r => r.event_id).filter(Boolean)); c(X.events.filter(e => e.status === 'open' && e.event_date >= today).length && X.events.filter(e => e.status === 'open' && e.event_date >= today && !posted.has(e.id)).length, 'upcoming event(s) with no announcement drafted', 'posts');
      c(of('post').filter(r => r.status === 'draft').length, 'draft(s) to finish', 'posts');
    } else if (role === 'marshall') {
      const planned = new Set(of('plan').map(r => r.event_id).filter(Boolean));
      c(X.events.filter(e => e.status === 'open' && e.event_date >= today && !planned.has(e.id)).length, 'upcoming event(s) with no activity plan', 'plans');
      c(of('plan').filter(r => r.status === 'planned' && r.on_date <= new Date(Date.now() + dayMs).toISOString().slice(0, 10) && (r.items || []).some(i => !i.done)).length, 'plan(s) for today or tomorrow with checklist items not done', 'plans');
      c(of('incident').filter(r => r.status === 'open').length, 'open safety log entr' + (of('incident').filter(r => r.status === 'open').length === 1 ? 'y' : 'ies'), 'safety');
      c(X.events.filter(e => e.status === 'open').length, 'event(s) open for scanning right now', 'go:attendance');
    }
    return n;
  }
  function stats() {
    const s = (l, v, c = '') => `<div class="stat ${c}"><small>${l}</small><b>${v}</b></div>`, up = X.events.filter(e => e.status === 'open' && e.event_date >= todayISO()).length;
    if (role === 'secretary') return s('Minutes on file', of('minutes').filter(r => r.status === 'filed').length, 'gold') + s('Resolutions adopted', of('resolution').filter(r => r.status !== 'draft').length) + s('Letters to answer', of('letter_in').filter(r => r.status === 'open').length) + s('Drafts', recs.filter(r => r.status === 'draft').length);
    if (role === 'auditor') return s('Entries examined', X.count ?? 0, 'gold') + s('Open findings', of('finding').filter(r => r.status !== 'resolved').length) + s('No receipt photo', (X.noReceipt || []).length) + s('Possible duplicates', (X.dups || []).length);
    if (role === 'pio') return s('Published this month', of('post').filter(r => r.status === 'published' && (r.on_date || '').startsWith(todayISO().slice(0, 7))).length, 'gold') + s('In review', of('post').filter(r => r.status === 'review').length) + s('Drafts', of('post').filter(r => r.status === 'draft').length) + s('Events ahead', up);
    return s('Events ahead', up, 'gold') + s('Plans ready', of('plan').filter(r => r.status === 'planned').length) + s('Open safety entries', of('incident').filter(r => r.status === 'open').length) + s('Events open to scan', X.events.filter(e => e.status === 'open').length);
  }

  function overview() {
    const nd = needs();
    return `<div class="grid">${stats()}</div><h3 style="margin:16px 2px 8px">Needs you</h3>
      <div class="card">${nd.length ? nd.map((x, i) => `<div class="row" data-n="${i}" style="cursor:pointer"><div class="m"><b>${esc(x.t)}</b></div><span class="muted">›</span></div>`).join('') : '<p class="empty">Nothing is waiting. Everything is up to date.</p>'}</div>
      <h3 style="margin:16px 2px 8px">Go to</h3><div style="display:flex;flex-wrap:wrap;gap:8px">${O.go.map(([id, l]) => `<button class="btn ghost" data-go="${id}">${l}</button>`).join('')}</div>
      <p class="muted" style="margin:14px 2px 0;font-size:.85rem">${esc(O.blurb)}</p>`;
  }

  function list(kinds) {
    const rows = recs.filter(r => kinds.includes(r.kind)), K = KIND[kinds[0]];
    return `${role === 'marshall' && kinds[0] === 'incident' ? '<p class="muted" style="margin:0 2px 8px">Record what happened and who was told. Marshals do not take disciplinary action.</p>' : ''}<button class="btn gold" id="add" style="width:100%;margin-bottom:10px">+ Add ${kinds.length > 1 ? 'letter' : K.l.toLowerCase()}</button>
      <div class="card">${rows.map(r => `<div class="row" data-i="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(r.title)}</b><small>${[r.ref_no, KIND[r.kind].l, fmtDate(r.on_date), r.party].filter(Boolean).map(esc).join(' · ')}${r.confidential ? ' · 🔒' : ''}${r.kind === 'plan' ? ` · ${(r.items || []).filter(i => i.done).length}/${(r.items || []).length} checked` : ''}</small></div>
        <span style="display:flex;gap:4px">${r.level ? `<span class="tag ${LEVEL[r.level][1]}">${LEVEL[r.level][0]}</span>` : ''}${ftag(r)}</span></div>`).join('') || '<p class="empty">Nothing here yet.</p>'}</div>`;
  }

  function flowList(test, empty, lead) {
    const rows = recs.filter(r => SEC.includes(r.kind) && test(r));
    return `<p class="muted" style="margin:0 2px 8px">${lead}</p><div class="card">${rows.map(r => `<div class="row" data-i="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(r.title)}</b><small>${[r.ref_no, KIND[r.kind].l, fmtDate(r.on_date)].filter(Boolean).map(esc).join(' · ')}${r.classification ? ' · ' + (r.classification === 'public' ? 'non-confidential' : 'confidential 🔒') : ''}</small></div>${ftag(r)}</div>`).join('') || `<p class="empty">${empty}</p>`}</div>`;
  }

  function report() {
    const f = of('finding'), pct = (a) => a.length;
    return `<p class="muted" style="margin:0 2px 8px">Findings and the checks the system runs on the books, ready to present to the General Assembly.</p>
      <div class="card pad"><div style="display:flex;justify-content:space-between"><span>Entries examined</span><b>${X.count ?? 0}</b></div><div style="display:flex;justify-content:space-between"><span>Collected (approved)</span><b>${peso(X.sum?.in)}</b></div><div style="display:flex;justify-content:space-between"><span>Spent (approved)</span><b>${peso(X.sum?.out)}</b></div>
        <div style="display:flex;justify-content:space-between"><span>Expenses with no receipt photo (60 days)</span><b>${(X.noReceipt || []).length}</b></div><div style="display:flex;justify-content:space-between"><span>Possible duplicates</span><b>${(X.dups || []).length}</b></div><div style="display:flex;justify-content:space-between"><span>Recorded and approved by the same person</span><b>${(X.self || []).length}</b></div>
        <div style="display:flex;justify-content:space-between"><span>Past months not verified</span><b>${(X.months || []).length}</b></div><div style="display:flex;justify-content:space-between"><span>Findings: open / reported / resolved</span><b>${f.filter(r => r.status === 'open').length} / ${f.filter(r => r.status === 'reported').length} / ${f.filter(r => r.status === 'resolved').length}</b></div></div>
      <button class="btn gold" id="pr" style="width:100%;margin-top:10px">Print or save as PDF</button>`;
  }
  function reportHTML() {
    const f = of('finding'), yn = v => v ? 'Yes' : 'No';
    return `${letterhead('Audit Report to the General Assembly', 'BSMT 1-Alpha · Batch 28 · PIT-COMED')}<p>Prepared ${fmtDate(todayISO())} by ${esc(ctx.profile.full_name)}, Auditor.</p>
      <table style="width:100%;border-collapse:collapse"><tbody>${[['Entries examined', X.count ?? 0], ['Collected (approved)', peso(X.sum?.in)], ['Spent (approved)', peso(X.sum?.out)], ['Expenses with no receipt photo (last 60 days)', (X.noReceipt || []).length], ['Possible duplicate entries', (X.dups || []).length], ['Entries recorded and approved by the same person', (X.self || []).length], ['Past months without a verified cash count', (X.months || []).length]]
        .map(([a, b]) => `<tr><td style="padding:4px;border-bottom:1px solid #ccc">${a}</td><td style="padding:4px;border-bottom:1px solid #ccc;text-align:right"><b>${b}</b></td></tr>`).join('')}</tbody></table>
      <h3>Findings</h3>${f.length ? f.map(r => `<div style="margin:8px 0;padding:6px;border:1px solid #ccc"><b>${esc(r.ref_no || '')} ${esc(r.title)}</b> · ${r.level || 'no level'} · ${r.status}<br>${esc(r.party || '')}<br>${esc(r.body || '')}<br><small>Reported to the Executive Board: ${yn((r.flags || {}).board)} · to the adviser: ${yn((r.flags || {}).adviser)} · presented to the General Assembly: ${yn((r.flags || {}).assembly)}</small></div>`).join('') : '<p>No findings recorded.</p>'}
      <p style="margin-top:36px">______________________________<br>${esc(ctx.profile.full_name)}, Auditor (Third Mate)</p>`;
  }

  function draw() {
    if (missing && !['over', 'report'].includes(pane)) { el.innerHTML = '<div class="card pad"><b>One more step.</b><p class="muted">Run <b>v29_office_records.sql</b> in the Supabase SQL Editor, then reload this screen.</p></div>'; return; }
    const P = O.panes.find(p => p[0] === pane) || O.panes[0];
    el.innerHTML = `<div style="margin:0 2px 8px"><b>${O.title}</b></div>
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;padding-bottom:2px">${O.panes.map(([id, l]) => `<button class="btn ${id === pane ? 'gold' : 'ghost'} sm" data-pane="${id}" style="white-space:nowrap">${l}</button>`).join('')}</div>
      <div id="pb">${pane === 'over' ? overview() : pane === 'report' ? report() : pane === 'classify' ? flowList(r => ['approved', 'classified', 'published'].includes(r.flow), 'Nothing approved yet. Approved files appear here for you to classify.', 'Files the Secretary reviewed and the Mayor or VP Internal approved. Open one, read it, and mark it non-confidential (members can read it once the PIO posts it) or confidential (only the Mayor, Secretary and Auditor can read it).') : pane === 'publish' ? flowList(r => ['classified', 'published'].includes(r.flow) && r.classification === 'public', 'Nothing to post yet. Files the Auditor marks non-confidential appear here.', 'Non-confidential files. Posting one puts it on the Documents tab of every member\'s screen. You cannot post a confidential file.') : list(P[2])}</div>`;
    el.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => { pane = b.dataset.pane; draw(); });
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = '#/staff/' + b.dataset.go; });
    if (pane === 'over') { const nd = needs(); el.querySelectorAll('[data-n]').forEach(r => r.onclick = () => { const p = nd[+r.dataset.n].p; if (p.startsWith('go:')) location.hash = '#/staff/' + p.slice(3); else { pane = p; draw(); } }); return; }
    if (pane === 'report') { el.querySelector('#pr').onclick = () => printHTML('Audit report', reportHTML()); return; }
    el.querySelector('#add')?.addEventListener('click', () => form(P[2], null));
    el.querySelectorAll('[data-i]').forEach(r => r.onclick = () => view(recs.find(x => x.id === r.dataset.i)));
  }

  /* open a record; checklist boxes and "reported to" boxes save as soon as they are ticked */
  function view(r) {
    if (!r) return; const K = KIND[r.kind], canW = ['secretary', 'auditor', 'pio', 'marshall'].includes(role) && ({ minutes: 'secretary', resolution: 'secretary', letter_in: 'secretary', letter_out: 'secretary', finding: 'auditor', post: 'pio', plan: 'marshall', incident: 'marshall' }[r.kind] === role);
    const ev = X.events.find(e => e.id === r.event_id);
    modal(`<h3>${esc(r.title)}</h3><p style="margin:0 0 8px">${tag(r.status)} ${r.level ? `<span class="tag ${LEVEL[r.level][1]}">${LEVEL[r.level][0]}</span>` : ''} <small class="muted">${esc([r.ref_no, K.l, fmtDate(r.on_date)].filter(Boolean).join(' · '))}${r.confidential ? ' · confidential' : ''}</small></p>
      ${r.flow ? `<div class="card pad" style="margin:6px 0"><small class="muted">Where it is</small><div>${ftag(r)} ${r.classification ? `<span class="tag ${r.classification === 'public' ? 'ok' : 'bad'}">${r.classification === 'public' ? 'non-confidential' : 'confidential'}</span>` : ''}</div>${r.flow_note ? `<div style="margin-top:6px"><small class="muted">Note</small><div>${esc(r.flow_note)}</div></div>` : ''}
        <small class="muted" style="display:block;margin-top:6px">${[r.reviewed_by_name && 'Sent by ' + r.reviewed_by_name, r.approved_by_name && 'Approved by ' + r.approved_by_name, r.classified_by_name && 'Classified by ' + r.classified_by_name, r.published_by_name && 'Posted by ' + r.published_by_name].filter(Boolean).map(esc).join(' · ')}</small></div>` : ''}
      ${r.party ? `<div style="margin:6px 0"><small class="muted">${esc(K.p)}</small><div>${esc(r.party)}</div></div>` : ''}${ev ? `<div style="margin:6px 0"><small class="muted">Event</small><div>${esc(ev.title)} · ${fmtDate(ev.event_date)}</div></div>` : ''}
      ${r.body ? `<div style="margin:6px 0"><small class="muted">${esc(K.b)}</small><div style="white-space:pre-wrap">${esc(r.body)}</div></div>` : ''}
      ${r.link ? `<div style="margin:6px 0"><small class="muted">Link</small><div><a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a></div></div>` : ''}
      ${K.flags ? `<div style="margin:8px 0">${K.flags.map(([k, l]) => `<label class="ck"><input type="checkbox" data-f="${k}"${(r.flags || {})[k] ? ' checked' : ''}${canW ? '' : ' disabled'}><span>${esc(l)}</span></label>`).join('')}</div>` : ''}
      ${K.items ? `<div style="margin:8px 0">${(r.items || []).map((it, i) => `<label class="ck"><input type="checkbox" data-it="${i}"${it.done ? ' checked' : ''}${canW ? '' : ' disabled'}><span>${esc(it.t)}</span></label>`).join('') || '<small class="muted">No checklist.</small>'}</div>` : ''}
      <small class="muted">Added by ${esc(r.created_by_name || '—')}</small>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${canW && r.flow && ['draft', 'returned'].includes(r.flow) ? '<button class="btn gold" id="sa">Send for approval</button>' : ''}${role === 'auditor' && ['approved', 'classified', 'published'].includes(r.flow) ? `<button class="btn ${r.classification === 'public' ? 'gold' : 'ghost'}" data-cl="public">Non-confidential</button><button class="btn ${r.classification === 'confidential' ? 'gold' : 'ghost'}" data-cl="confidential">Confidential</button>` : ''}${role === 'pio' && r.flow === 'classified' && r.classification === 'public' ? '<button class="btn gold" id="po">Post to members</button>' : ''}${role === 'pio' && r.flow === 'published' ? '<button class="btn ghost" id="td">Take down</button>' : ''}${canW && (!r.flow || ['draft', 'returned'].includes(r.flow)) ? '<button class="btn ghost" id="ed">Edit</button><button class="btn ghost" id="rm" style="color:#c0392b">Delete</button>' : ''}<button class="btn ghost" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const save = async patch => { try { await db(sb.from('v2_office_records').update(patch).eq('id', r.id)); Object.assign(r, patch); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
      m.querySelectorAll('[data-f]').forEach(b => b.onchange = () => { const flags = { ...(r.flags || {}), [b.dataset.f]: b.checked }; save({ flags }); });
      m.querySelectorAll('[data-it]').forEach(b => b.onchange = () => { const items = (r.items || []).map((x, i) => i === +b.dataset.it ? { ...x, done: b.checked } : x); save({ items }); });
      const rpc = (fn, args, msg) => async () => { try { await db(sb.rpc(fn, args)); close(); toast(msg); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
      m.querySelector('#sa')?.addEventListener('click', rpc('v2_doc_review', { p_id: r.id }, 'Sent for approval'));
      m.querySelectorAll('[data-cl]').forEach(b => b.onclick = rpc('v2_doc_classify', { p_id: r.id, p_class: b.dataset.cl }, b.dataset.cl === 'public' ? 'Marked non-confidential' : 'Marked confidential'));
      m.querySelector('#po')?.addEventListener('click', rpc('v2_doc_publish', { p_id: r.id, p_on: true }, 'Posted. Members can read it now.'));
      m.querySelector('#td')?.addEventListener('click', rpc('v2_doc_publish', { p_id: r.id, p_on: false }, 'Taken down'));
      m.querySelector('#ed')?.addEventListener('click', () => { close(); form([r.kind], r); });
      m.querySelector('#rm')?.addEventListener('click', async () => { if (!(await confirmDialog(`Delete "${r.title}"?`, { ok: 'Delete', title: 'Delete' }))) return; try { await db(sb.from('v2_office_records').delete().eq('id', r.id)); close(); toast('Deleted'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
    });
  }

  function form(kinds, r) {
    const k0 = r ? r.kind : kinds[0], editing = !!r;
    const html = k => { const K = KIND[k], v = r || {}, plan = k === 'plan';
      return `${kinds.length > 1 && !editing ? `<label>Type</label><select name="kind" id="kk">${kinds.map(x => `<option value="${x}"${x === k ? ' selected' : ''}>${KIND[x].l}</option>`).join('')}</select>` : ''}
        <label>${K.t}</label><input name="title" maxlength="120" required value="${esc(v.title || '')}"><label>Date</label><input name="on_date" type="date" required value="${esc(v.on_date || todayISO())}">
        <label>${K.p}</label><input name="party" maxlength="100" value="${esc(v.party || '')}">
        ${K.event ? `<label>Event (optional)</label><select name="event_id"><option value="">Not linked to an event</option>${X.events.map(e => `<option value="${e.id}"${v.event_id === e.id ? ' selected' : ''}>${esc(e.title)} · ${fmtDate(e.event_date)}</option>`).join('')}</select>` : ''}
        <label>${K.b}</label><textarea name="body" rows="4" maxlength="3000">${esc(v.body || '')}</textarea>
        ${K.link ? `<label>${K.link}</label><input name="link" type="url" maxlength="300" placeholder="https://" value="${esc(v.link || '')}">` : ''}
        ${K.items ? `<label>${K.items}</label><textarea name="items" rows="6">${esc(editing ? (v.items || []).map(i => i.t).join('\n') : CHECKLIST)}</textarea>` : ''}
        ${K.level ? `<label>How serious</label><select name="level"><option value="low"${v.level === 'low' ? ' selected' : ''}>Low</option><option value="medium"${!v.level || v.level === 'medium' ? ' selected' : ''}>Medium</option><option value="high"${v.level === 'high' ? ' selected' : ''}>High</option></select>` : ''}
        <label>Status</label><select name="status">${K.st.map(s => `<option value="${s[0]}"${(v.status || K.st[0][0]) === s[0] ? ' selected' : ''}>${s[1]}</option>`).join('')}</select>
        ${K.conf ? `<label class="ck" style="margin-top:10px"><input type="checkbox" name="confidential"${v.confidential ? ' checked' : ''}><span>Looks confidential (keeps it hidden from other officers until the Auditor classifies it)</span></label>` : ''}`; };
    modal(`<h3>${editing ? 'Edit' : 'Add'} ${kinds.length > 1 && !editing ? 'letter' : KIND[k0].l.toLowerCase()}</h3><form id="f"><div id="fb">${html(k0)}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const bindKk = () => m.querySelector('#kk')?.addEventListener('change', e => { m.querySelector('#fb').innerHTML = html(e.target.value); bindKk(); });
      bindKk();
      m.querySelector('#f').onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target), kind = f.get('kind') || k0, K = KIND[kind], n = s => String(f.get(s) ?? '').trim() || null;
        if (K.flags && ['approved', 'published'].includes(f.get('status')) && kind === 'post' && !K.flags.every(([k]) => (r?.flags || {})[k]) && !(await confirmDialog('The privacy, branding and communication checks are not all ticked. Open the post and tick them first, or continue anyway?', { ok: 'Continue anyway', title: 'Checks not done' }))) return;
        const p = { title: n('title'), on_date: f.get('on_date'), party: n('party'), body: n('body'), status: f.get('status') };
        if (K.link) p.link = n('link'); if (K.event) p.event_id = f.get('event_id') || null; if (K.level) p.level = f.get('level'); if (K.conf) p.confidential = f.get('confidential') === 'on';
        if (K.items) { const old = r?.items || []; p.items = String(f.get('items') || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 40).map(t => ({ t, done: !!old.find(o => o.t === t)?.done })); }
        try { await db(editing ? sb.from('v2_office_records').update(p).eq('id', r.id) : sb.from('v2_office_records').insert({ ...p, kind })); close(); toast('Saved'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; }
      };
    });
  }

  const off = watch(['v2_office_records', 'v2_events', 'v2_entries', 'v2_budget_requests', 'v2_liquidations', 'v2_documents'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  el.innerHTML = skeleton(4);
  await load();
  return off;
}
