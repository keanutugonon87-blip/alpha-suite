import { sb, db, watch, esc, toast, modal, skeleton, confirmDialog, fmtDate, todayISO, printHTML, letterhead, peso, askText } from '../core.js';
import { ymManila } from '../money.js';

/* Office desks for the SAILS Secretary (Second Mate), Auditor (Third Mate), PIO (OIC) and Marshals (Bosun).
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

/* The Public Information Officer's four kinds of work (CBL Section 7). The type lives in flags.type, so no new column is needed. */
const PTYPE = { announcement: ['Announcement'], publication: ['Publication'], documentation: ['Documentation'], media: ['Media'] };
const ptype = r => (r.flags || {}).type || 'publication';
const postChecks = type => [['privacy', 'Privacy checked: no personal data, private letters, disciplinary information or financial account details, and consent given where needed', 'Privacy'], ['branding', 'Branding rules followed', 'Branding'],
  ['comms', 'Communication rules followed: accurate, respectful, accessible, and clearly an official statement and not a personal opinion', 'Communication rules'], ...(['documentation', 'media'].includes(type) ? [['consent', 'Everyone shown, recorded or named agreed to it', 'Consent']] : [])];
const KIND = {
  minutes: { l: 'Minutes', t: 'Meeting', p: 'Presided by and attendees', b: 'Minutes (what was discussed and decided)', conf: 1, link: 'Link to the signed copy', st: [['draft', 'Draft'], ['filed', 'Filed']] },
  resolution: { l: 'Resolution', t: 'Resolution title', p: 'Moved by', b: 'Resolution text', conf: 1, st: [['draft', 'Draft'], ['adopted', 'Adopted'], ['implemented', 'Implemented']] },
  letter_in: { l: 'Letter received', t: 'Subject', p: 'From', b: 'Summary', conf: 1, link: 'Link to the scanned letter', st: [['open', 'Needs a reply'], ['replied', 'Replied'], ['filed', 'Filed']] },
  letter_out: { l: 'Letter sent', t: 'Subject', p: 'To', b: 'Summary', conf: 1, link: 'Link to the signed copy', st: [['draft', 'Draft'], ['filed', 'Sent and filed']] },
  finding: { l: 'Audit finding', t: 'Finding', p: 'Concerning (entry, fund or person)', b: 'What was found and the evidence', level: 1, st: [['open', 'Open'], ['reported', 'Reported'], ['resolved', 'Resolved']],
    flags: [['board', 'Reported to the Executive Board'], ['adviser', 'Reported to the adviser'], ['assembly', 'Presented to the General Assembly']] },
  post: { l: 'Post or publication', t: 'Title', p: 'Channel (page, bulletin, poster, album…)', b: 'Content or caption', link: 'Link to the post or album', event: 1, st: [['draft', 'Draft'], ['review', 'In review'], ['approved', 'Approved'], ['published', 'Published']],
    flags: [] },
  plan: { l: 'Activity plan', t: 'Activity', p: 'Posts and assignments', b: 'Notes', event: 1, items: 'Logistics and safety checklist (one line each)', st: [['planned', 'Planned'], ['done', 'Done'], ['cancelled', 'Cancelled']] },
  incident: { l: 'Safety log', t: 'What happened', p: 'Where', b: 'Details and who was told', st: [['open', 'Open'], ['resolved', 'Resolved']] },
};
const OFFICES = {
  secretary: { title: 'Secretary (Second Mate)', blurb: 'Maintain minutes, attendance records, resolutions, notices, membership records and official correspondence; safeguard records; give members reasonable access to non-confidential documents.',
    panes: [['over', 'Overview'], ['minutes', 'Minutes', ['minutes']], ['resolutions', 'Resolutions', ['resolution']], ['letters', 'Letters', ['letter_in', 'letter_out']], ['requests', 'Member requests'], ['coa', 'Calendar'], ['faq', 'FAQ'], ['trash', 'Trash']], go: [['docs', 'Documents'], ['students', 'Students'], ['notices', 'Notices'], ['attendance', 'Attendance']] },
  auditor: { title: 'Auditor (Third Mate)', blurb: 'Independently examine financial records, verify receipts and disbursements, report discrepancies to the Executive Board and adviser, and present findings to the General Assembly. The SAILS Auditor does not approve or carry out the transactions being audited.',
    panes: [['over', 'Overview'], ['classify', 'Classify files'], ['findings', 'Findings', ['finding']], ['report', 'GA report']], go: [['treasury', 'Treasury'], ['balances', 'Balances'], ['requests', 'Budget']] },
  pio: { title: 'Public Information Officer (OIC)', blurb: 'Manage official announcements, publications, documentation and media, following the PIT communication, privacy and branding rules.',
    panes: [['over', 'Overview'], ['announce', 'Announcements', ['post'], ['announcement']], ['pubs', 'Publications', ['post'], ['publication']], ['media', 'Photos and media', ['post'], ['documentation', 'media']], ['publish', 'Post files']], go: [['notices', 'Notices'], ['attendance', 'Attendance']] },
  mayor: { title: 'President’s desk', blurb: 'The President approves what is sent up the line: the Vice Presidents’ proposals, the SAILS Secretary’s records and the SAILS PIO’s announcements. You decide here. You do not work inside the officers’ own desks.',
    panes: [['over', 'Needs you'], ['secs', 'Sections'], ['score', 'Scorecards'], ['funds', 'Funds'], ['vpa', 'VP approvals'], ['hist', 'History'], ['marsh', 'Marshal referrals'], ['rec', 'Records'], ['announce', 'Announcements', ['post'], ['announcement']], ['coa', 'Calendar'], ['faq', 'FAQ'], ['trash', 'Trash']], go: [['attendance', 'Attendance'], ['notices', 'Notices']] },
  marshall: { title: 'Marshal (Bosun)', blurb: 'Help keep order, logistics, attendance support and safety during authorized activities. Marshals report and assist. They do not use coercive or disciplinary powers.',
    panes: [['over', 'Overview'], ['plans', 'Activity plans', ['plan']], ['safety', 'Safety log', ['incident']]], go: [['attendance', 'Attendance'], ['watch', 'Watch']] },
};
const ANY = async (p, dflt = []) => { try { return await db(p); } catch { return dflt; } };

export async function mountOffice(el, ctx) {
  const role = ctx.profile.role, O = ctx.only && OFFICES[role] ? { ...OFFICES[role], panes: OFFICES[role].panes.filter(p => ctx.only.includes(p[0])) } : OFFICES[role];
  if (!O) { el.innerHTML = '<p class="empty">This desk is for the SAILS Secretary, Auditor, PIO and Marshals.</p>'; return () => {}; }
  let pane = ctx.pane && (O.panes || []).some(p => p[0] === ctx.pane) ? ctx.pane : 'over', recs = [], X = {}, missing = false;

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
    if (role === 'mayor' || role === 'secretary') x.faq = await ANY(sb.from('v2_faq').select('*').order('sort').order('created_at'));
    if (role === 'mayor') x.decisions = await ANY(sb.from('v2_decisions').select('*').order('decided_at', { ascending: false }).limit(300));   // empty until v44 is run
    if (role === 'mayor') x.pendAcc = await sb.from('v2_profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'pending').then(r => (r.error ? 0 : r.count || 0), () => 0);
    if (role === 'mayor') { x.creps = await ANY(sb.from('v2_class_reports').select('*').is('reviewed_at', null)); x.casks = await ANY(sb.from('v2_class_asks').select('*').eq('status', 'open')); x.clash = await sb.rpc('v2_coa_conflicts').then(r => r.error ? [] : r.data || [], () => []); }
    if (role === 'mayor') x.q = await ANY(sb.from('v2_approval_questions').select('*').order('created_at'));
    if (role === 'mayor') {
      const [nx] = await ANY(sb.from('v2_council_meetings').select('*').in('status', ['planned', 'held']).gte('held_on', today).order('held_on').limit(1));
      const [mm] = await ANY(sb.from('v2_memos').select('*').order('created_at', { ascending: false }).limit(1));
      const ms = mm ? await sb.rpc('v2_memo_status', { p_id: mm.id }).then(r => r.data || [], () => []) : [];
      x.week = { next: nx, memo: mm, memoTo: ms.length, memoAck: ms.filter(m => m.acked_at).length, deputy: await sb.rpc('v2_deputy_status').then(r => r.data, () => null) };
    }
    if (role === 'mayor') x.insp = await import('./inspection.js').then(m => m.inspectionAlerts(ctx.profile.user_id || ctx.user?.id), () => null);
    if (role === 'mayor') x.secs = await sb.rpc('v2_president_overview').then(r => r.error ? null : r.data, () => null);
    if (role === 'mayor') x.marsh = await ANY(sb.from('v2_marshal_incidents').select('*').order('created_at', { ascending: false }).limit(50));
    if (role === 'mayor') { const [a, b, c] = await Promise.all([ANY(sb.from('v2_vp_meetings').select('*').order('created_at', { ascending: false }).limit(100)), ANY(sb.from('v2_vp_partners').select('*').order('created_at', { ascending: false }).limit(100)), ANY(sb.from('v2_vp_activities').select('*').order('created_at', { ascending: false }).limit(100))]); x.vpa = { meet: a, par: b, act: c }; }
    if (role === 'mayor' || role === 'secretary') x.coa = await ANY(sb.from('v2_coa').select('*').order('starts_on'));   // empty until v42 is run
    if (role === 'mayor' || role === 'secretary') x.trash = await ANY(sb.from('v2_trash').select('*').order('removed_at', { ascending: false }));   // empty until v41 is run
    if (role === 'mayor') x.faq = await ANY(sb.from('v2_faq').select('*').order('sort').order('created_at'));
    if (role === 'secretary') {
      x.faq = await ANY(sb.from('v2_faq').select('*').order('sort').order('created_at'));   // empty until v39 is run
      x.rreq = await ANY(sb.from('v2_record_requests').select('*').order('created_at', { ascending: false }).limit(200));   // empty until v33 is run
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
    const today = todayISO(), n = [], add = (t, p, u) => n.push({ t, p, u });
    const c = (a, label, p, u) => { if (a) add(`${a} ${label}`, p, u); };
    if (role === 'secretary') {
      c(X.events.filter(e => e.status === 'closed' && !e.report_sent_at).length, 'closed event(s) where the absences are not compiled and sent yet', 'go:attendance');
      c((X.rreq || []).filter(r => r.status === 'open').length, 'record request(s) from members waiting for an answer', 'requests'); c((X.rreq || []).filter(r => r.status === 'open' && Date.now() - new Date(r.created_at) > 7 * dayMs).length, 'of them waiting more than 7 days', 'requests');
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
    } else if (role === 'mayor') {
      const rv = of('post').filter(r => ptype(r) === 'announcement' && r.status === 'review'); c(rv.length, 'announcement(s) waiting for your approval', 'announce');
      if (X.insp && (X.insp.open || X.insp.unread)) add(X.insp.unread && X.insp.latest ? `Inspection ${X.insp.latest.kind}: ${X.insp.latest.note}${X.insp.unread > 1 ? ' (' + X.insp.unread + ' new)' : ''}` : `Inspection is open: ${X.insp.open.note}`, 'go:inspection', !!X.insp.open);
      c(X.pendAcc || 0, 'account request(s) waiting for your approval', 'go:accounts');
      const day3 = t => Date.now() - new Date(t || Date.now()) > 3 * dayMs, wt = vpItems().filter(i => i.st === 'proposed');
      c(wt.length, 'VP or Secretary proposal(s) waiting for you' + (wt.some(i => day3(i.since)) ? ' (' + wt.filter(i => day3(i.since)).length + ' waiting more than 3 days)' : ''), 'vpa', wt.some(i => day3(i.since)));
      c((X.coa || []).filter(r => r.status === 'proposed').length, 'calendar activit' + ((X.coa || []).filter(r => r.status === 'proposed').length === 1 ? 'y' : 'ies') + ' waiting for your approval', 'coa');
      c((X.marsh || []).filter(i => i.status === 'referred' && i.referred_to === 'president' && !i.president_action).length, 'incident report(s) referred to you', 'marsh', true);
      c((X.creps || []).filter(r => day3(r.submitted_at)).length, 'weekly report(s) the SAILS VP Internal has not read for over 3 days', 'go:classup', true);
      c((X.casks || []).filter(r => day3(r.created_at)).length, 'Class Mayor request(s) the SAILS VP Internal has not answered for over 3 days', 'go:classup', true);
      c((X.clash || []).length, 'calendar clash(es): two activities on the same dates', 'coa');
      const FL = { no_mayor: 'no Class Mayor yet', no_report: 'no weekly report for 2 weeks', many_late: '3 or more directives late', idle: 'no directives sent in 2 weeks' };
      ((X.secs || {}).sections || []).forEach(s => { if ((s.flags || []).length) add(s.name + ': ' + s.flags.map(f => FL[f] || f).join(', '), 'secs', s.flags.includes('many_late')); });
    } else if (role === 'pio') {
      const posts = of('post'), typed = ts => posts.filter(r => ts.includes(ptype(r))), live = r => ['approved', 'published'].includes(r.status);
      const pp = rs => rs.some(r => ptype(r) === 'announcement') ? 'announce' : rs.some(r => ['documentation', 'media'].includes(ptype(r))) ? 'media' : 'pubs';
      const iso = d => new Date(Date.now() + d * dayMs).toISOString().slice(0, 10);
      c(X.events.filter(e => e.report_sent_at && !e.notified_at).length, 'attendance fines report(s) waiting to be sent to the students', 'go:attendance');
      c(recs.filter(r => r.flow === 'classified' && r.classification === 'public').length, 'public file(s) ready to post to the members', 'publish');
      const ann = typed(['announcement']), fl = r => r.flags || {};
      c(ann.filter(r => r.status === 'draft' && fl(r).return_note).length, 'announcement(s) returned by the Mayor with a note', 'announce');
      c(ann.filter(r => r.status === 'approved' && !fl(r).notice).length, 'announcement(s) approved by the Mayor, ready to send as a notice', 'announce');
      c(ann.filter(r => r.status === 'review').length, 'announcement(s) waiting for the Mayor’s approval', 'announce');
      const rv = posts.filter(r => r.status === 'review' && ptype(r) !== 'announcement'); c(rv.length, 'post(s) in review', pp(rv));
      const ap = posts.filter(r => r.status === 'approved' && ptype(r) !== 'announcement'); c(ap.length, 'approved post(s) not published yet', pp(ap));
      const bad = posts.filter(r => live(r) && !postChecks(ptype(r)).every(([k]) => (r.flags || {})[k])); c(bad.length, 'approved or published post(s) with a privacy, branding or communication check not ticked', pp(bad));
      const annEv = new Set(typed(['announcement']).map(r => r.event_id).filter(Boolean));
      c(X.events.filter(e => e.status === 'open' && e.event_date >= today && !annEv.has(e.id)).length, 'upcoming event(s) with no announcement drafted (announce events the Mayor ordered first)', 'announce');
      const docEv = new Set(typed(['documentation', 'media']).map(r => r.event_id).filter(Boolean));
      c(X.events.filter(e => e.event_date < today && e.event_date >= iso(-30) && !docEv.has(e.id)).length, 'recent event(s) with no photos or media filed', 'media');
      c(posts.filter(r => r.status === 'draft').length, 'draft(s) to finish', pp(posts.filter(r => r.status === 'draft')));
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
    if (role === 'mayor') return s('Waiting for your approval', of('post').filter(r => ptype(r) === 'announcement' && r.status === 'review').length, 'gold') + s('Approved this month', of('post').filter(r => ptype(r) === 'announcement' && (r.flags || {}).approved_at && String((r.flags || {}).approved_at).startsWith(todayISO().slice(0, 7))).length) + s('Sent as notices', of('post').filter(r => (r.flags || {}).notice).length) + s('Returned for changes', of('post').filter(r => ptype(r) === 'announcement' && r.status === 'draft' && (r.flags || {}).return_note).length);
    if (role === 'pio') { const mon = r => (r.on_date || '').startsWith(todayISO().slice(0, 7)) && ['approved', 'published'].includes(r.status), np = ts => of('post').filter(r => ts.includes(ptype(r)) && mon(r)).length;
      return s('Announcements this month', np(['announcement']), 'gold') + s('Publications this month', np(['publication'])) + s('Photos and media this month', np(['documentation', 'media'])) + s('In review', of('post').filter(r => r.status === 'review').length); }
    return s('Events ahead', up, 'gold') + s('Plans ready', of('plan').filter(r => r.status === 'planned').length) + s('Open safety entries', of('incident').filter(r => r.status === 'open').length) + s('Events open to scan', X.events.filter(e => e.status === 'open').length);
  }

  /* PIO: which events have been announced and documented, and the rules to follow (CBL Section 7 and Article XVI, Sections 4 and 5) */
  function coverage() {
    const today = todayISO(), iso = d => new Date(Date.now() + d * dayMs).toISOString().slice(0, 10), ev = X.events.filter(e => e.event_date >= iso(-30) && e.event_date <= iso(60)).sort((a, b) => a.event_date.localeCompare(b.event_date));
    const has = (e, ts) => of('post').some(r => r.event_id === e.id && ts.includes(ptype(r)) && ['approved', 'published'].includes(r.status));
    return `<h3 style="margin:16px 2px 8px">Event coverage</h3><div class="card">${ev.map(e => { const past = e.event_date <= today, a = has(e, ['announcement']), d = has(e, ['documentation', 'media']);
      return `<div class="row"><div class="m"><b>${esc(e.title)}</b><small>${fmtDate(e.event_date)}</small></div><span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"><span class="tag ${a ? 'ok' : 'warn'}">${a ? 'announced' : 'not announced'}</span>${past ? `<span class="tag ${d ? 'ok' : 'warn'}">${d ? 'documented' : 'no photos yet'}</span>` : ''}</span></div>`; }).join('') || '<p class="empty">No events in the last 30 days or the next 60.</p>'}</div>`;
  }
  function rules() {
    return `<h3 style="margin:16px 2px 8px">Before you post</h3><div class="card pad"><ul style="margin:0;padding-left:18px;line-height:1.6">
      <li>Follow the PIT communication, privacy and branding rules.</li>
      <li>Never publish personal data, private letters, disciplinary information or financial account details without lawful authority and consent.</li>
      <li>Photos and videos need the consent of the people shown.</li>
      <li>Announcements must be accurate, respectful and accessible, and must be clearly official statements, not personal opinions.</li></ul>
      <p class="muted" style="margin:8px 0 0;font-size:.85rem">CBL Section 7 and Article XVI, Sections 4 and 5. A post cannot be approved or published until its checks are ticked.</p></div>`;
  }

  function presHome() {
    const nd = needs(), ur = nd.filter(x => x.u), rest = nd.filter(x => !x.u);
    const row = x => `<div class="row" data-n="${nd.indexOf(x)}" style="cursor:pointer"><div class="m"><b>${esc(x.t)}</b></div>${x.u ? '<span class="tag bad">urgent</span>' : ''}<span class="muted">›</span></div>`;
    const W = X.week || {}, late = ((X.secs || {}).sections || []).reduce((a, s) => a + (s.late || 0), 0);
    const wr = (t, sub, go) => `<button type="button" class="weekrow" data-w="${go}"><div><b>${esc(t)}</b><small>${esc(sub)}</small></div><span class="muted">›</span></button>`;
    return `<div class="twocol"><div><h3 style="margin:0 2px 8px">Needs you</h3>${nd.length ? `<div class="card">${ur.map(row).join('')}${rest.map(row).join('')}</div>` : '<div class="card"><p class="caught">You are all caught up. Nothing is waiting for you.</p></div>'}</div>
      <div><h3 style="margin:0 2px 8px">This week</h3><div class="card" style="padding:4px 14px">
        ${wr(W.next ? W.next.title : 'No council meeting planned', W.next ? fmtDate(W.next.held_on + 'T00:00:00+08:00') + (W.next.held_at ? ' · ' + W.next.held_at : '') : 'Plan the next one in Council', 'council')}
        ${wr(W.memo ? W.memo.title : 'No memos sent', W.memo ? W.memoAck + ' of ' + W.memoTo + ' acknowledged' : 'Send one to the Class Mayors', 'memos')}
        ${wr(late ? late + ' late directive' + (late === 1 ? '' : 's') : 'No late directives', late ? 'Across the sections' : 'The sections are on time', 'secs')}
        ${wr(W.deputy ? 'Deputy: ' + W.deputy.user_name : 'No deputy named', W.deputy ? 'Until ' + fmtDate(W.deputy.to_on + 'T00:00:00+08:00') : 'Name one if you will be away', 'rec')}</div></div></div>`;
  }
  function overview() {
    if (role === 'mayor' && ctx.bare) return presHome();
    const nd = needs();
    return `<div class="grid">${stats()}</div><h3 style="margin:16px 2px 8px">Needs you</h3>
      <div class="card">${nd.length ? nd.map((x, i) => `<div class="row" data-n="${i}" style="cursor:pointer"><div class="m"><b>${esc(x.t)}</b></div><span class="muted">›</span></div>`).join('') : '<p class="empty">Nothing is waiting. Everything is up to date.</p>'}</div>
      ${role === 'pio' ? coverage() + rules() : ''}
      <h3 style="margin:16px 2px 8px">Go to</h3><div style="display:flex;flex-wrap:wrap;gap:8px">${O.go.map(([id, l]) => `<button class="btn ghost" data-go="${id}">${l}</button>`).join('')}</div>
      <p class="muted" style="margin:14px 2px 0;font-size:.85rem">${esc(O.blurb)}</p>`;
  }

  function list(kinds, types) {
    const rows = recs.filter(r => kinds.includes(r.kind) && (!types || types.includes(ptype(r)))), K = KIND[kinds[0]], what = types ? (types.length > 1 ? 'photos or media' : PTYPE[types[0]][0].toLowerCase()) : null;
    return `${role === 'mayor' ? '<p class="muted" style="margin:0 2px 8px">Open an announcement the SAILS PIO sent you. Approve it, or return it with a note saying what to fix.</p>' : ''}${role === 'marshall' && kinds[0] === 'incident' ? '<p class="muted" style="margin:0 2px 8px">Record what happened and who was told. Marshals do not take disciplinary action.</p>' : ''}${role === 'mayor' ? '' : `<button class="btn gold" id="add" style="width:100%;margin-bottom:10px">+ Add ${what || (kinds.length > 1 ? 'letter' : K.l.toLowerCase())}</button>`}
      <div class="card">${rows.map(r => `<div class="row" data-i="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(r.title)}</b><small>${[r.ref_no, r.kind === 'post' ? PTYPE[ptype(r)][0] : KIND[r.kind].l, fmtDate(r.on_date), r.party].filter(Boolean).map(esc).join(' · ')}${r.confidential ? ' · 🔒' : ''}${r.kind === 'plan' ? ` · ${(r.items || []).filter(i => i.done).length}/${(r.items || []).length} checked` : ''}</small></div>
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

  /* Article XVI, Section 2: members ask for non-confidential records and the SAILS Secretary answers */
  function reqPane() {
    const list = X.rreq || [], late = r => r.status === 'open' && Date.now() - new Date(r.created_at) > 7 * dayMs;
    if (!list.length) return '<p class="empty">No requests from members yet. They ask from the Archive tab on their own screen. If you expected some, run <b>v33_records_access.sql</b> in Supabase first.</p>';
    return `<p class="muted" style="margin:0 2px 8px">Requests shall be answered within a reasonable time. A request open for more than 7 days is marked late. Only non-confidential records can be granted.</p>
      <div class="card">${list.map(r => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(r.title)}</b><small>${esc(r.requester_name)} · ${fmtDate(r.created_at)}</small></div><span class="tag ${r.status === 'open' ? (late(r) ? 'bad' : 'warn') : r.status === 'granted' ? 'ok' : 'bad'}">${r.status === 'open' ? (late(r) ? 'late' : 'open') : r.status}</span></div>
        ${r.note ? `<p style="margin:6px 0 0">${esc(r.note)}</p>` : ''}${r.answer_note ? `<p class="muted" style="margin:6px 0 0">Answer: ${esc(r.answer_note)}</p>` : ''}
        <div class="acts" style="margin-top:8px">${r.status === 'open' ? `<button class="btn gold sm" data-ra="${r.id}" data-ok="1">Grant</button><button class="btn ghost sm" data-ra="${r.id}" data-ok="0">Decline</button>` : ''}<button class="btn ghost sm" data-rx="${r.id}">Remove</button></div></div>`).join('')}</div>`;
  }
  /* FAQ shown on the student screen */
  function faqPane() {
    const list = X.faq || [];
    return `<p class="muted" style="margin:0 2px 8px">Students read this on their own screen, signed in or not. Keep answers short and plain. If nothing shows here, run <b>v39_faq.sql</b> in Supabase first.</p>
      <div class="bar"><button class="btn gold" id="fa">+ Add question</button></div>
      <div class="card">${list.map(f => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(f.question)}</b><small>${esc(f.topic || 'General')}${f.published ? '' : ' · hidden'}</small></div><div style="display:flex;gap:4px"><button class="btn ghost sm" data-fe="${f.id}">Edit</button><button class="btn ghost sm" data-fd="${f.id}">Delete</button></div></div><p style="margin:6px 0 0;white-space:pre-wrap">${esc(f.answer)}</p></div>`).join('') || '<p class="empty">No questions yet.</p>'}</div>`;
  }
  function faqForm(f) {
    modal(`<h3>${f ? 'Edit' : 'Add'} question</h3><form id="ff"><label>Question</label><input name="q" required maxlength="200" value="${esc(f?.question)}"><label>Answer</label><textarea name="a" rows="5" required maxlength="2000">${esc(f?.answer)}</textarea>
      <label>Topic (optional, groups questions)</label><input name="t" maxlength="40" value="${esc(f?.topic)}" placeholder="Payments, Account, Records…">
      <label class="ck"><input type="checkbox" name="p"${f && !f.published ? '' : ' checked'}><span>Show to students</span></label>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#ff').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
        const row = { question: d.get('q').trim(), answer: d.get('a').trim(), topic: d.get('t').trim() || null, published: d.get('p') === 'on', updated_by_name: ctx.profile.full_name, updated_at: new Date().toISOString() };
        try { await db(f ? sb.from('v2_faq').update(row).eq('id', f.id) : sb.from('v2_faq').insert({ ...row, sort: ((X.faq || []).reduce((t, x) => Math.max(t, x.sort || 0), 0)) + 1 })); toast('Saved'); close(); await load(); }
        catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  /* Line of authority: the Vice Presidents propose, the SAILS Secretary sends records, and the President decides. The President does not work inside their desks. */
  function vpItems() {
    const v = X.vpa || { meet: [], par: [], act: [] }, day = d => fmtDate(d + 'T00:00:00+08:00'), out = [];
    v.meet.forEach(r => out.push({ key: 'meet:' + r.id, who: 'SAILS VP Internal', kind: r.kind === 'program' ? 'Program' : 'Meeting', title: r.title, sub: [day(r.held_on), r.held_at, r.venue].filter(Boolean).join(' · '), body: r.agenda, by: r.created_by_name, st: r.status, note: r.mayor_note, since: r.updated_at }));
    v.par.forEach(r => out.push({ key: 'par:' + r.id, who: 'SAILS VP External', kind: 'Partner', title: r.name, sub: [r.kind, r.contact_name].filter(Boolean).join(' · '), body: r.notes, by: r.created_by_name, st: r.status, note: r.mayor_note, adv: r.adviser_status, since: r.updated_at }));
    v.act.forEach(r => out.push({ key: 'act:' + r.id, who: 'SAILS VP External', kind: 'Joint activity', title: r.title, sub: [(v.par.find(p => p.id === r.partner_id) || {}).name || 'No partner', r.planned_on ? day(r.planned_on) : ''].filter(Boolean).join(' · '), body: r.details, by: r.created_by_name, st: r.status, note: r.mayor_note, adv: r.adviser_status, auth: r.authority_ok, since: r.updated_at }));
    recs.filter(r => r.flow === 'reviewed').forEach(r => out.push({ key: 'doc:' + r.id, who: 'Secretary', kind: 'Record', title: r.title, sub: [r.ref_no, fmtDate(r.on_date)].filter(Boolean).join(' · '), body: r.body, by: r.reviewed_by_name, st: 'proposed', since: r.reviewed_at }));
    return out;
  }
  function vpaPane() {
    const all = vpItems(), wait = all.filter(i => i.st === 'proposed'), back = all.filter(i => i.st === 'returned'), done = all.filter(i => ['approved', 'active'].includes(i.st)).slice(0, 6);
    const waited = i => Math.floor((Date.now() - new Date(i.since || Date.now())) / dayMs), late = i => i.st === 'proposed' && waited(i) >= 3;
    const row = (i, act) => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(i.title)}</b><small>${esc(i.kind)} · from ${esc(i.who)}${i.by ? ' (' + esc(i.by) + ')' : ''}</small>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>
      <span class="tag ${i.st === 'returned' ? 'bad' : i.st === 'proposed' ? (late(i) ? 'bad' : 'warn') : 'ok'}">${i.st === 'proposed' ? (late(i) ? waited(i) + ' days waiting' : 'waiting for you') : i.st === 'returned' ? 'returned' : 'approved'}</span></div>
      ${i.body ? `<p style="margin:6px 0 0;white-space:pre-wrap">${esc(String(i.body).slice(0, 400))}</p>` : ''}${i.adv ? `<small class="muted">Adviser: ${esc(i.adv.replace('_', ' '))}${i.auth === false ? ' · SAILS authority wording not checked' : ''}</small>` : ''}${i.note ? `<p class="muted" style="margin:6px 0 0">Your note: ${esc(i.note)}</p>` : ''}
      ${(X.q || []).filter(q => q.src_id === i.key.split(':')[1]).map(q => `<div style="margin:8px 0 0;padding:8px;border-radius:8px;background:var(--soft,rgba(120,140,170,.12))"><small class="muted">You asked ${esc(q.to_name || '')}:</small><div>${esc(q.question)}</div>${q.answer ? `<small class="muted" style="display:block;margin-top:4px">Answer:</small><div>${esc(q.answer)}</div>` : '<small class="muted">Waiting for the answer</small>'}</div>`).join('')}
      ${act ? `<div class="acts" style="margin-top:8px"><button class="btn gold sm" data-vo="${i.key}">Approve</button><button class="btn ghost sm" data-vq="${i.key}">Ask a question</button><button class="btn ghost sm" data-vr="${i.key}">Return with a note</button></div>` : ''}</div>`;
    return `<details style="margin:0 2px 8px"><summary class="muted" style="cursor:pointer;font-size:.85rem">How this works</summary><p class="muted" style="margin:6px 0 0">The line of authority: the Vice Presidents propose, the SAILS Secretary sends records, and you decide. Anything waiting more than 3 days is flagged, and you and the officer get a phone alert. To give an officer a task, use Directives. A plain SAILS VP Internal meeting needs no approval, so it does not appear here.</p></details>
      <p class="muted" style="margin:10px 4px 4px;font-weight:600">Waiting for your decision</p>${wait.length ? `<div class="card">${wait.map(i => row(i, true)).join('')}</div>` : '<p class="empty">Nothing is waiting for you.</p>'}
      ${back.length ? `<p class="muted" style="margin:12px 4px 4px;font-weight:600">Returned, with the officer</p><div class="card">${back.map(i => row(i, false)).join('')}</div>` : ''}
      ${done.length ? `<p class="muted" style="margin:12px 4px 4px;font-weight:600">Recently approved</p><div class="card">${done.map(i => row(i, false)).join('')}</div>` : ''}`;
  }
  /* every approval, return and cancellation, kept as a log the President can filter and print */
  let histF = 'all', histQ = '';
  function secsPane() {
    const d = X.secs; if (!d) return '<div class="card"><p class="empty">Run the v48 SQL in Supabase to turn this on.</p></div>';
    const O = d.officers || {}, n = k => O[k] || 0, wk = w => w ? fmtDate(w + 'T00:00:00+08:00') : 'none yet';
    return `<p class="muted" style="margin:0 2px 8px">Every section, its Class Mayor and how they are doing. Class Mayors report to the SAILS VP Internal; you see it all here.</p>
      <div class="grid" style="margin-bottom:12px"><div class="stat"><small>Class Mayors</small><b>${n('mayor')}</b></div><div class="stat"><small>VPs</small><b>${n('vp_internal') + n('vp_external')}</b></div><div class="stat"><small>Marshals</small><b>${n('general_marshal') + n('dept_marshal')}</b></div><div class="stat"><small>Waiting for approval</small><b>${n('pending')}</b></div></div>
      ${(d.sections || []).length ? `<div class="card">${d.sections.map(s => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(s.name)}</b><small>${s.mayor_name ? 'Class Mayor ' + esc(s.mayor_name) : 'no Class Mayor yet'} · ${s.students} student${s.students === 1 ? '' : 's'}</small></div><span class="tag ${(s.flags || []).length || s.late ? 'bad' : s.mayor_id ? 'ok' : ''}">${s.late ? s.late + ' late' : (s.flags || []).length ? 'warning' : s.mayor_id ? 'on track' : 'no Mayor'}</span></div>
        ${s.mayor_id ? `<small class="muted" style="display:block;margin-top:4px">${s.open} directive${s.open === 1 ? '' : 's'} open · report: ${wk(s.report_week)}${s.report_week ? (s.report_reviewed ? ' (reviewed)' : ' (not yet read)') : ''}${s.asks_open ? ' · ' + s.asks_open + ' request' + (s.asks_open === 1 ? '' : 's') + ' waiting' : ''}</small>` : ''}${(s.flags || []).length ? `<small style="display:block;margin-top:4px;color:var(--bad,#b3261e)">${s.flags.map(f => ({ no_mayor: 'No Class Mayor', no_report: 'No weekly report for 2 weeks', many_late: '3 or more directives late', idle: 'No directives sent in 2 weeks' })[f] || f).join(' · ')}</small>` : ''}</div>`).join('')}</div>` : '<p class="empty">No sections yet.</p>'}`;
  }
  function marshPane() {
    const all = X.marsh || [], pend = all.filter(i => i.status === 'referred' && i.referred_to === 'president'), done = all.filter(i => i.president_action && !pend.includes(i));
    const PA = { acknowledged: 'Acknowledged', sent_back: 'Sent back', closed: 'Closed' };
    const card = (i, open) => `<button type="button" class="row" data-mi="${i.id}" style="display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line,#e3e8ee);cursor:pointer"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(i.event || 'Department duty')}</b><small>${fmtDate(i.occurred_on + 'T00:00:00+08:00')}${i.section ? ' · ' + esc(i.section) : ''} · filed by ${esc(i.reporter_name || '')}</small></div><span class="tag ${open ? (i.president_action ? 'ok' : 'warn') : ''}">${i.president_action ? PA[i.president_action] : 'Needs you'}</span></div></button>`;
    return `<p class="muted" style="margin:0 2px 8px">Incident reports the SAILS General Marshal referred to the President. Tap one to read it and decide.</p>${pend.length ? `<div class="card">${pend.map(i => card(i, true)).join('')}</div>` : '<p class="empty">Nothing is waiting for you.</p>'}${done.length ? `<h4 style="margin:14px 2px 6px">Already handled</h4><div class="card">${done.map(i => card(i, false)).join('')}</div>` : ''}`;
  }
  function marshOpen(id) {
    const i = (X.marsh || []).find(r => r.id === id); if (!i) return;
    const live = i.status === 'referred' && i.referred_to === 'president';
    modal(`<h3>${esc(i.event || 'Department duty')}</h3><p class="muted" style="margin:0 0 8px">${fmtDate(i.occurred_on + 'T00:00:00+08:00')}${i.section ? ' · ' + esc(i.section) : ''} · filed by ${esc(i.reporter_name || '')}</p>
      <p style="white-space:pre-wrap;margin:0 0 8px">${esc(i.summary)}</p>${i.action_taken ? `<p class="muted" style="margin:0 0 8px">Action taken: ${esc(i.action_taken)}</p>` : ''}${i.gm_note ? `<p style="margin:0 0 8px"><b>SAILS General Marshal:</b> ${esc(i.gm_note)}</p>` : ''}${i.president_note ? `<p style="margin:0 0 8px"><b>You:</b> ${esc(i.president_note)}</p>` : ''}
      ${live ? `<label>Your note or instruction</label><textarea id="pn" rows="3" maxlength="500"></textarea><div class="acts" style="margin-top:10px"><button class="btn ghost sm" data-pa="acknowledge">Acknowledge</button><button class="btn gold sm" data-pa="send_back">Send back</button><button class="btn ghost sm" data-pa="close">Close</button></div><small class="muted" style="display:block;margin-top:6px">Send back and Close need a note. Send back returns it to the SAILS General Marshal with your instruction.</small>` : '<div class="acts" style="margin-top:10px"></div>'}<div class="err" id="er"></div><div style="margin-top:12px"><button type="button" class="btn ghost" id="cx">Close window</button></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelectorAll('[data-pa]').forEach(b => b.onclick = async () => { try { await db(sb.rpc('v2_incident_president', { p_id: id, p_action: b.dataset.pa, p_note: m.querySelector('#pn').value })); toast('Saved'); close(); await load(); } catch (e) { m.querySelector('#er').textContent = e.message; } });
    });
  }
  function histPane() {
    const all = X.decisions || [], q = histQ.trim().toLowerCase(), SRC = { vp_meeting: 'Meeting or program', vp_partner: 'Partner', vp_activity: 'Joint activity', record: 'Record', coa: 'Calendar activity' };
    const list = all.filter(d => (histF === 'all' || d.decision === histF) && (!q || (d.title + ' ' + (d.note || '') + ' ' + (d.proposer_name || '')).toLowerCase().includes(q)));
    return `<p class="muted" style="margin:0 2px 8px">Everything you approved, returned or cancelled, with the date and your note. Print it for the adviser or the General Assembly. If it stays empty after you decide on something, run <b>v44_chain_of_command.sql</b> in Supabase first.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${[['all', 'All'], ['approved', 'Approved'], ['returned', 'Returned'], ['cancelled', 'Cancelled']].map(([k, l]) => `<button class="btn ${histF === k ? 'gold' : 'ghost'} sm" data-hf="${k}">${l}</button>`).join('')}<button class="btn ghost sm" id="hp">Print</button></div>
      <input id="hq" placeholder="Search by title, note or name" value="${esc(histQ)}" style="margin-bottom:8px">
      ${list.length ? `<div class="card">${list.map(d => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(d.title)}</b><small>${esc(SRC[d.src] || d.src)}${d.proposer_name ? ' · from ' + esc(d.proposer_name) : ''}</small><small>${fmtDate(d.decided_at)}${d.decided_by_name ? ' · ' + esc(d.decided_by_name) : ''}</small></div><span class="tag ${d.decision === 'approved' ? 'ok' : 'bad'}">${d.decision}</span></div>${d.note ? `<p class="muted" style="margin:6px 0 0">${esc(d.note)}</p>` : ''}</div>`).join('')}</div>` : '<p class="empty">No decisions yet.</p>'}`;
  }
  function histPrint(list) {
    const SRC = { vp_meeting: 'Meeting or program', vp_partner: 'Partner', vp_activity: 'Joint activity', record: 'Record', coa: 'Calendar activity' };
    printHTML('Decision history', `${letterhead('Decision history of the SAILS President', 'BSMT 1-Alpha · Batch 28 · PIT-COMED')}<table style="width:100%;border-collapse:collapse;font-size:12px"><tr><th align="left">Date</th><th align="left">Item</th><th align="left">From</th><th align="left">Decision</th><th align="left">Note</th></tr>${list.map(d => `<tr><td style="border-top:1px solid #ccc;padding:4px">${esc(fmtDate(d.decided_at))}</td><td style="border-top:1px solid #ccc;padding:4px">${esc(d.title)}<br><small>${esc(SRC[d.src] || d.src)}</small></td><td style="border-top:1px solid #ccc;padding:4px">${esc(d.proposer_name || '')}</td><td style="border-top:1px solid #ccc;padding:4px">${esc(d.decision)}</td><td style="border-top:1px solid #ccc;padding:4px">${esc(d.note || '')}</td></tr>`).join('')}</table>`);
  }
  async function vpDecide(key, ok) {
    const [src, id] = key.split(':'), item = vpItems().find(i => i.key === key); if (!item) return;
    let note = null;
    if (!ok) { note = await askText('Return it', 'What should be changed?', { ok: 'Return' }); if (note === null) return; if (!String(note).trim()) return toast('Say what needs to change', true); note = String(note).trim().slice(0, 300); }
    else if (src === 'act' && (item.adv !== 'endorsed' || !item.auth) && !(await confirmDialog(`${item.adv !== 'endorsed' ? 'The adviser has not endorsed this yet. ' : ''}${!item.auth ? 'The SAILS authority wording has not been checked. ' : ''}Approve anyway?`, { ok: 'Approve anyway', title: 'Not ready' }))) return;
    try {
      if (src === 'doc') await db(sb.rpc('v2_doc_approve', { p_id: id, p_ok: ok, p_note: note }));
      else await db(sb.from({ meet: 'v2_vp_meetings', par: 'v2_vp_partners', act: 'v2_vp_activities' }[src]).update(ok ? { status: src === 'par' ? 'active' : 'approved', mayor_note: null } : { status: 'returned', mayor_note: note }).eq('id', id));
      toast(ok ? 'Approved' : 'Returned'); await load();
    } catch (e) { toast(e.message, true); }
  }

  /* Calendar of Activities (COA): the SAILS Secretary drafts from the council minutes, the SAILS President approves */
  const COA_CAT = { activity: 'Activity', program: 'Program', meeting: 'Meeting', deadline: 'Deadline', holiday: 'Holiday' };
  const COA_ST = { proposed: ['waiting for the President', 'warn'], returned: ['returned', 'bad'], draft: ['draft', ''], approved: ['approved', 'ok'], cancelled: ['cancelled', 'bad'] };
  function coaPane() {
    const list = X.coa || [], mayor = role === 'mayor';
    const order = ['proposed', 'returned', 'draft', 'approved', 'cancelled'], day = d => fmtDate(d + 'T00:00:00+08:00');
    const acts = c => {
      const a = [];
      if (mayor) {
        if (c.status === 'proposed') a.push(`<button class="btn gold sm" data-ad="${c.id}" data-act="approve">Approve</button><button class="btn ghost sm" data-vq="coa:${c.id}">Ask a question</button><button class="btn ghost sm" data-ad="${c.id}" data-act="return">Return</button>`);
        if (c.status === 'approved') a.push(`<button class="btn ghost sm" data-ad="${c.id}" data-act="cancel">Cancel activity</button>`);
        if (c.status === 'cancelled') a.push(`<button class="btn ghost sm" data-ad="${c.id}" data-act="reinstate">Bring back</button>`);
        a.push(`<button class="btn ghost sm" data-ae="${c.id}">Edit</button><button class="btn ghost sm" data-ax="${c.id}">Remove</button>`);
      } else if (['draft', 'returned'].includes(c.status)) a.push(`<button class="btn gold sm" data-ad="${c.id}" data-act="submit">Send to the President</button><button class="btn ghost sm" data-ae="${c.id}">Edit</button><button class="btn ghost sm" data-ax="${c.id}">Remove</button>`);
      return a.join('');
    };
    const row = c => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(c.title)}</b><small>${esc(COA_CAT[c.category] || 'Activity')} · ${day(c.starts_on)}${c.ends_on && c.ends_on !== c.starts_on ? ' – ' + day(c.ends_on) : ''}${c.time_note ? ' · ' + esc(c.time_note) : ''}${c.venue ? ' · ' + esc(c.venue) : ''}</small>
      <small>${c.minutes_title ? 'From the minutes: ' + esc(c.minutes_title) : 'No minutes linked yet'}${c.approved_by_name && c.status === 'approved' ? ' · approved by ' + esc(c.approved_by_name) : ''}</small></div><span class="tag ${COA_ST[c.status][1]}">${COA_ST[c.status][0]}</span></div>
      ${c.details ? `<p style="margin:6px 0 0">${esc(c.details)}</p>` : ''}${c.return_note ? `<p class="muted" style="margin:6px 0 0">${c.status === 'cancelled' ? 'Reason' : 'President’s note'}: ${esc(c.return_note)}</p>` : ''}
      ${acts(c) ? `<div class="acts" style="margin-top:8px">${acts(c)}</div>` : ''}</div>`;
    const groups = order.map(st => [st, list.filter(c => c.status === st)]).filter(g => g[1].length);
    return `<p class="muted" style="margin:0 2px 8px">${mayor ? 'You approve the final Calendar of Activities. Approve or return what the SAILS Secretary sends from the council minutes. You can edit, cancel or remove any activity, and what you add yourself is approved at once.' : 'Write each activity from the council minutes, link those minutes, then send it to the SAILS President. Only approved activities show on the students’ Calendar. After you send one, only the President can change it.'} If nothing works here, run <b>v42_coa.sql</b> in Supabase first.</p>
      <div class="bar"><button class="btn gold" id="ca">+ Add activity</button></div>
      ${groups.length ? groups.map(([st, l]) => `<p class="muted" style="margin:12px 4px 4px;font-weight:600;text-transform:capitalize">${st === 'proposed' ? 'Waiting for approval' : st}</p><div class="card">${l.map(row).join('')}</div>`).join('') : '<p class="empty">No activities yet.</p>'}`;
  }
  function coaForm(c) {
    const mins = recs.filter(r => r.kind === 'minutes'), mayor = role === 'mayor';
    modal(`<h3>${c ? 'Edit' : 'Add'} activity</h3><form id="cf"><label>Activity</label><input name="t" required maxlength="120" value="${esc(c?.title)}">
      <label>Type</label><select name="c">${Object.entries(COA_CAT).map(([k, l]) => `<option value="${k}"${(c?.category || 'activity') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <label>Starts</label><input name="s" type="date" required value="${esc(c?.starts_on || '')}"><label>Ends (optional, for several days)</label><input name="e" type="date" value="${esc(c?.ends_on || '')}">
      <label>Time (optional)</label><input name="tm" maxlength="60" placeholder="8:00 AM – 5:00 PM" value="${esc(c?.time_note)}"><label>Place (optional)</label><input name="v" maxlength="100" value="${esc(c?.venue)}">
      <label>Details (optional)</label><textarea name="d" rows="3" maxlength="1000">${esc(c?.details)}</textarea>
      <label>Council minutes where this was decided${mayor ? ' (optional for the President)' : ''}</label><select name="m"><option value="">${mins.length ? 'Pick the minutes' : 'No minutes yet. Add them in the Minutes tab first'}</option>${mins.map(r => `<option value="${r.id}"${c?.minutes_id === r.id ? ' selected' : ''}>${esc(r.title)} · ${fmtDate(r.on_date)}</option>`).join('')}</select>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#cf').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
        try { await db(sb.rpc('v2_coa_save', { p_id: c?.id || null, p_title: d.get('t').trim(), p_details: d.get('d').trim() || null, p_category: d.get('c'), p_starts: d.get('s'), p_ends: d.get('e') || null, p_time: d.get('tm').trim() || null, p_venue: d.get('v').trim() || null, p_minutes: d.get('m') || null }));
          toast('Saved'); close(); await load(); } catch (x) { m.querySelector('#er').textContent = /function|schema cache|could not find/i.test(x.message) ? 'Run the v42 SQL in Supabase first (supabase/v42_coa.sql).' : x.message; } };
    });
  }
  async function coaAct(id, act) {
    let note = null;
    if (act === 'return') { note = await askText('Return the activity', 'What should the SAILS Secretary fix?', { ok: 'Return' }); if (note === null) return; if (!String(note).trim()) return toast('Say what to fix', true); }
    if (act === 'cancel') { note = await askText('Cancel the activity', 'Reason (optional, students can see the activity is cancelled)', { ok: 'Cancel activity' }); if (note === null) return; }
    try { await db(act === 'submit' ? sb.rpc('v2_coa_submit', { p_id: id }) : sb.rpc('v2_coa_decide', { p_id: id, p_action: act, p_note: note ? String(note).trim() : null }));
      toast({ submit: 'Sent to the President', approve: 'Approved. It is on the Calendar now.', return: 'Returned to the SAILS Secretary', cancel: 'Cancelled', reinstate: 'Back on the Calendar' }[act]); await load(); } catch (e) { toast(e.message, true); }
  }

  /* Trash: removed items wait here for 7 days, then are deleted for good */
  function trashPane() {
    const list = X.trash || [], left = t => Math.max(0, Math.ceil((new Date(t.expires_at) - Date.now()) / dayMs));
    return `<p class="muted" style="margin:0 2px 8px">Removed requests and records stay here for 7 days. Restore one to put it back exactly as it was. After 7 days it is deleted for good. If nothing works here, run <b>v41_trash.sql</b> in Supabase first.</p>
      ${list.length ? `<div class="card">${list.map(t => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(t.title)}</b><small>${t.source === 'record_request' ? 'Member request' : t.source === 'coa' ? 'Calendar activity' : 'Record'} · ${esc(t.subtitle || '')}</small><small>Removed ${fmtDate(t.removed_at)}${t.removed_by_name ? ' by ' + esc(t.removed_by_name) : ''}</small></div><span class="tag ${left(t) <= 1 ? 'bad' : 'warn'}">${left(t) <= 1 ? 'deleted soon' : left(t) + ' days left'}</span></div>
        <div class="acts" style="margin-top:8px"><button class="btn gold sm" data-tr="${t.id}">Restore</button><button class="btn ghost sm" data-td="${t.id}">Delete forever</button></div></div>`).join('')}</div>` : '<p class="empty">The trash is empty.</p>'}`;
  }
  async function removeItem(source, id, title) {
    if (!await confirmDialog(`"${title || 'This item'}" goes to the Trash. You can restore it for 7 days, then it is deleted for good.`, { ok: 'Remove', title: 'Remove this?' })) return;
    try { await db(sb.rpc('v2_trash_remove', { p_source: source, p_id: id })); toast('Moved to the Trash'); await load(); } catch (e) { toast(/function|schema cache|could not find/i.test(e.message) ? 'Run the v41 SQL in Supabase first (supabase/v41_trash.sql).' : e.message, true); }
  }
  async function answer(id, ok) {
    const note = await askText(ok ? 'Grant the request' : 'Decline the request', ok ? 'Tell the member where to get the record (optional)' : 'Say why it is declined', { ok: ok ? 'Grant' : 'Decline' });
    if (note === null) return;
    if (!ok && !String(note).trim()) return toast('Say why the request is declined', true);
    try { await db(sb.rpc('v2_record_answer', { p_id: id, p_ok: ok, p_note: String(note).trim() || null })); toast(ok ? 'Granted' : 'Declined'); await load(); } catch (e) { toast(e.message, true); }
  }

  function draw() {
    if (missing && !['over', 'report'].includes(pane)) { el.innerHTML = '<div class="card pad"><b>One more step.</b><p class="muted">Run <b>v29_office_records.sql</b> in the Supabase SQL Editor, then reload this screen.</p></div>'; return; }
    const P = O.panes.find(p => p[0] === pane) || O.panes[0];
    el.innerHTML = `${ctx.bare ? '' : `<div style="margin:0 2px 8px"><b>${O.title}</b></div>
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;padding-bottom:2px">${O.panes.map(([id, l]) => `<button class="btn ${id === pane ? 'gold' : 'ghost'} sm" data-pane="${id}" style="white-space:nowrap">${l}</button>`).join('')}</div>`}
      <div id="pb">${pane === 'over' ? overview() : pane === 'report' ? report() : pane === 'requests' ? reqPane() : pane === 'faq' ? faqPane() : pane === 'trash' ? trashPane() : pane === 'coa' ? coaPane() : pane === 'vpa' ? vpaPane() : pane === 'hist' ? histPane() : pane === 'marsh' ? marshPane() : pane === 'secs' ? secsPane() : (pane === 'score' || pane === 'funds' || pane === 'rec') ? '<div id="svb"></div>' : pane === 'classify' ? flowList(r => ['approved', 'classified', 'published'].includes(r.flow), 'Nothing approved yet. Approved files appear here for you to classify.', 'Files the SAILS Secretary reviewed and the Mayor or SAILS VP Internal approved. Open one, read it, and mark it non-confidential (members can read it once the SAILS PIO posts it) or confidential (only the Mayor, Secretary and Auditor can read it).') : pane === 'publish' ? flowList(r => ['classified', 'published'].includes(r.flow) && r.classification === 'public', 'Nothing to post yet. Files the SAILS Auditor marks non-confidential appear here.', 'Non-confidential files. Posting one puts it on the Documents tab of every member\'s screen. You cannot post a confidential file.') : list(P[2], P[3])}</div>`;
    el.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => { pane = b.dataset.pane; draw(); });
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = '#/staff/' + b.dataset.go; });
    if (pane === 'over') { el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { if (ctx.go) ctx.go(b.dataset.w); }); const nd = needs(); el.querySelectorAll('[data-n]').forEach(r => r.onclick = () => { const p = nd[+r.dataset.n].p; if (ctx.go && ctx.go(p.startsWith('go:') ? p.slice(3) : p)) return; if (p.startsWith('go:')) location.hash = '#/staff/' + p.slice(3); else { pane = p; draw(); } }); return; }
    if (pane === 'faq') { el.querySelector('#fa').onclick = () => faqForm(null);
      el.querySelectorAll('[data-fe]').forEach(b => b.onclick = () => faqForm((X.faq || []).find(f => f.id === b.dataset.fe)));
      el.querySelectorAll('[data-fd]').forEach(b => b.onclick = async () => { if (!await confirmDialog('Students will no longer see it.', { ok: 'Delete', danger: true, title: 'Delete this question?' })) return; try { await db(sb.from('v2_faq').delete().eq('id', b.dataset.fd)); toast('Deleted'); await load(); } catch (e) { toast(e.message, true); } }); return; }
    if (pane === 'requests') { el.querySelectorAll('[data-ra]').forEach(b => b.onclick = () => answer(b.dataset.ra, b.dataset.ok === '1')); el.querySelectorAll('[data-rx]').forEach(b => b.onclick = () => removeItem('record_request', b.dataset.rx, (X.rreq || []).find(r => r.id === b.dataset.rx)?.title)); return; }
    if (pane === 'marsh') el.querySelectorAll('[data-mi]').forEach(b => b.onclick = () => marshOpen(b.dataset.mi));
    if (pane === 'score' || pane === 'funds' || pane === 'rec') import('./supervise.js').then(m => m.mountSupervise(el.querySelector('#svb'), pane, ctx));
    if (pane === 'hist') { el.querySelectorAll('[data-hf]').forEach(b => b.onclick = () => { histF = b.dataset.hf; draw(); });
      el.querySelector('#hq').oninput = e => { histQ = e.target.value; const pos = e.target.selectionStart; draw(); const n = el.querySelector('#hq'); n.focus(); n.setSelectionRange(pos, pos); };
      el.querySelector('#hp').onclick = () => histPrint((X.decisions || []).filter(d => (histF === 'all' || d.decision === histF) && (!histQ.trim() || (d.title + ' ' + (d.note || '') + ' ' + (d.proposer_name || '')).toLowerCase().includes(histQ.trim().toLowerCase())))); return; }
    if (pane === 'vpa') { el.querySelectorAll('[data-vo]').forEach(b => b.onclick = () => vpDecide(b.dataset.vo, true)); el.querySelectorAll('[data-vr]').forEach(b => b.onclick = () => vpDecide(b.dataset.vr, false)); return; }
    el.querySelectorAll('[data-vq]').forEach(b => b.onclick = () => { const [k, id] = b.dataset.vq.split(':'), src = { meet: 'vp_meeting', par: 'vp_partner', act: 'vp_activity', doc: 'record', coa: 'coa' }[k];
      modal(`<h3>Ask a question</h3><form id="f"><label>Your question</label><textarea name="q" rows="3" required minlength="3" maxlength="500"></textarea><p class="muted" style="font-size:.85rem;margin:6px 0 0">The writer gets a phone alert and answers in their Directives. You decide after you read the answer.</p><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send question</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
        m.querySelector('#cx').onclick = close;
        m.querySelector('#f').onsubmit = async e => { e.preventDefault(); try { await db(sb.rpc('v2_question_ask', { p_src: src, p_id: id, p_question: new FormData(e.target).get('q') })); toast('Question sent'); close(); await load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
      }); });
    if (pane === 'coa') { el.querySelector('#ca')?.addEventListener('click', () => coaForm(null));
      const find = id => (X.coa || []).find(c => c.id === id);
      el.querySelectorAll('[data-ae]').forEach(b => b.onclick = () => coaForm(find(b.dataset.ae)));
      el.querySelectorAll('[data-ax]').forEach(b => b.onclick = () => removeItem('coa', b.dataset.ax, find(b.dataset.ax)?.title));
      el.querySelectorAll('[data-ad]').forEach(b => b.onclick = () => coaAct(b.dataset.ad, b.dataset.act));
      return; }
    if (pane === 'trash') { el.querySelectorAll('[data-tr]').forEach(b => b.onclick = async () => { try { await db(sb.rpc('v2_trash_restore', { p_id: b.dataset.tr })); toast('Restored'); await load(); } catch (e) { toast(e.message, true); } });
      el.querySelectorAll('[data-td]').forEach(b => b.onclick = async () => { if (!await confirmDialog('It will be deleted for good and cannot be brought back.', { ok: 'Delete forever', danger: true, title: 'Delete forever?' })) return; try { await db(sb.rpc('v2_trash_delete', { p_id: b.dataset.td })); toast('Deleted'); await load(); } catch (e) { toast(e.message, true); } }); return; }
    if (pane === 'report') { el.querySelector('#pr').onclick = () => printHTML('Audit report', reportHTML()); return; }
    el.querySelector('#add')?.addEventListener('click', () => form(P[2], null, P[3]));
    el.querySelectorAll('[data-i]').forEach(r => r.onclick = () => view(recs.find(x => x.id === r.dataset.i)));
  }

  /* open a record; checklist boxes and "reported to" boxes save as soon as they are ticked */
  function view(r) {
    if (!r) return; const K = KIND[r.kind], canW = ['secretary', 'auditor', 'pio', 'marshall'].includes(role) && ({ minutes: 'secretary', resolution: 'secretary', letter_in: 'secretary', letter_out: 'secretary', finding: 'auditor', post: 'pio', plan: 'marshall', incident: 'marshall' }[r.kind] === role);
    const ev = X.events.find(e => e.id === r.event_id), FL = r.kind === 'post' ? postChecks(ptype(r)) : K.flags, KL = r.kind === 'post' ? PTYPE[ptype(r)][0] : K.l;
    modal(`<h3>${esc(r.title)}</h3><p style="margin:0 0 8px">${tag(r.status)} ${r.level ? `<span class="tag ${LEVEL[r.level][1]}">${LEVEL[r.level][0]}</span>` : ''} <small class="muted">${esc([r.ref_no, KL, fmtDate(r.on_date)].filter(Boolean).join(' · '))}${r.confidential ? ' · confidential' : ''}</small></p>
      ${r.flow ? `<div class="card pad" style="margin:6px 0"><small class="muted">Where it is</small><div>${ftag(r)} ${r.classification ? `<span class="tag ${r.classification === 'public' ? 'ok' : 'bad'}">${r.classification === 'public' ? 'non-confidential' : 'confidential'}</span>` : ''}</div>${r.flow_note ? `<div style="margin-top:6px"><small class="muted">Note</small><div>${esc(r.flow_note)}</div></div>` : ''}
        <small class="muted" style="display:block;margin-top:6px">${[r.reviewed_by_name && 'Sent by ' + r.reviewed_by_name, r.approved_by_name && 'Approved by ' + r.approved_by_name, r.classified_by_name && 'Classified by ' + r.classified_by_name, r.published_by_name && 'Posted by ' + r.published_by_name].filter(Boolean).map(esc).join(' · ')}</small></div>` : ''}
      ${r.party ? `<div style="margin:6px 0"><small class="muted">${esc(K.p)}</small><div>${esc(r.party)}</div></div>` : ''}${ev ? `<div style="margin:6px 0"><small class="muted">Event</small><div>${esc(ev.title)} · ${fmtDate(ev.event_date)}</div></div>` : ''}
      ${r.body ? `<div style="margin:6px 0"><small class="muted">${esc(K.b)}</small><div style="white-space:pre-wrap">${esc(r.body)}</div></div>` : ''}
      ${r.link ? `<div style="margin:6px 0"><small class="muted">Link</small><div><a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a></div></div>` : ''}
      ${FL && FL.length ? `<div style="margin:8px 0">${FL.map(([k, l]) => `<label class="ck"><input type="checkbox" data-f="${k}"${(r.flags || {})[k] ? ' checked' : ''}${canW ? '' : ' disabled'}><span>${esc(l)}</span></label>`).join('')}</div>` : ''}
      ${K.items ? `<div style="margin:8px 0">${(r.items || []).map((it, i) => `<label class="ck"><input type="checkbox" data-it="${i}"${it.done ? ' checked' : ''}${canW ? '' : ' disabled'}><span>${esc(it.t)}</span></label>`).join('') || '<small class="muted">No checklist.</small>'}</div>` : ''}
      <small class="muted">Added by ${esc(r.created_by_name || '—')}</small>
      ${r.kind === 'post' && ptype(r) === 'announcement' ? `<div class="card pad" style="margin:8px 0"><small class="muted">Official announcement</small><div>${(r.flags || {}).approved_by ? `Approved by ${esc(r.flags.approved_by)}${r.flags.approved_at ? ' · ' + fmtDate(r.flags.approved_at) : ''}` : r.status === 'review' ? 'Waiting for the Mayor’s approval' : 'Not sent to the Mayor yet'}</div>${(r.flags || {}).return_note ? `<div style="margin-top:6px"><small class="muted">Returned by the Mayor</small><div>${esc(r.flags.return_note)}</div></div>` : ''}</div>` : ''}
      ${role === 'mayor' && r.kind === 'post' && ptype(r) === 'announcement' && ['review', 'approved'].includes(r.status) && !(r.flags || {}).notice ? `<div style="display:flex;gap:8px;margin-top:10px">${r.status === 'review' ? '<button class="btn gold" id="ma">Approve announcement</button>' : ''}<button class="btn ghost" id="mr">Return with a note</button></div>` : ''}
      ${r.kind === 'post' && ptype(r) === 'announcement' && canW && ['approved', 'published'].includes(r.status) && (r.flags || {}).approved_by && !(r.flags || {}).notice ? '<div style="margin-top:10px"><button class="btn gold" id="sn">Send as a notice (phone alert)</button></div>' : ''}${(r.flags || {}).notice ? '<small class="muted" style="display:block;margin-top:6px">Sent as a notice with a phone alert.</small>' : ''}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${canW && r.flow && ['draft', 'returned'].includes(r.flow) ? '<button class="btn gold" id="sa">Send for approval</button>' : ''}${role === 'auditor' && ['approved', 'classified', 'published'].includes(r.flow) ? `<button class="btn ${r.classification === 'public' ? 'gold' : 'ghost'}" data-cl="public">Non-confidential</button><button class="btn ${r.classification === 'confidential' ? 'gold' : 'ghost'}" data-cl="confidential">Confidential</button>` : ''}${role === 'pio' && r.flow === 'classified' && r.classification === 'public' ? '<button class="btn gold" id="po">Post to members</button>' : ''}${role === 'pio' && r.flow === 'published' ? '<button class="btn ghost" id="td">Take down</button>' : ''}${canW && (!r.flow || ['draft', 'returned'].includes(r.flow)) ? '<button class="btn ghost" id="ed">Edit</button>' : ''}${role === 'sails_president' || (canW && (!r.flow || ['draft', 'returned'].includes(r.flow))) ? '<button class="btn ghost" id="rm" style="color:#c0392b">Delete</button>' : ''}${canW && r.flow && !['draft', 'returned'].includes(r.flow) ? '<small class="muted" style="width:100%">An approved record can only be deleted by the SAILS President.</small>' : ''}<button class="btn ghost" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const save = async patch => { try { await db(sb.from('v2_office_records').update(patch).eq('id', r.id)); Object.assign(r, patch); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
      m.querySelectorAll('[data-f]').forEach(b => b.onchange = () => { const flags = { ...(r.flags || {}), [b.dataset.f]: b.checked }; save({ flags }); });
      m.querySelectorAll('[data-it]').forEach(b => b.onchange = () => { const items = (r.items || []).map((x, i) => i === +b.dataset.it ? { ...x, done: b.checked } : x); save({ items }); });
      const rpc = (fn, args, msg) => async () => { try { await db(sb.rpc(fn, args)); close(); toast(msg); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
      m.querySelector('#sa')?.addEventListener('click', rpc('v2_doc_review', { p_id: r.id }, 'Sent for approval'));
      m.querySelectorAll('[data-cl]').forEach(b => b.onclick = rpc('v2_doc_classify', { p_id: r.id, p_class: b.dataset.cl }, b.dataset.cl === 'public' ? 'Marked non-confidential' : 'Marked confidential'));
      m.querySelector('#po')?.addEventListener('click', rpc('v2_doc_publish', { p_id: r.id, p_on: true }, 'Posted. Members can read it now.'));
      m.querySelector('#td')?.addEventListener('click', rpc('v2_doc_publish', { p_id: r.id, p_on: false }, 'Taken down'));
      m.querySelector('#sn')?.addEventListener('click', async () => { if (!(await confirmDialog(`Send "${r.title}" as a notice? Everyone who turned phone alerts on gets an alert.`, { ok: 'Send notice', title: 'Send notice' }))) return;
        try { await db(sb.rpc('v2_announce_post', { p_post: r.id })); close(); toast('Notice sent'); load(); } catch (x) { m.querySelector('#er').textContent = /function|schema cache/i.test(x.message || '') ? 'Run the v35 SQL in Supabase first (supabase/v35_event_orders.sql).' : x.message; } });
      m.querySelector('#ma')?.addEventListener('click', async () => { try { await db(sb.from('v2_office_records').update({ status: 'approved' }).eq('id', r.id)); close(); toast('Approved. The SAILS PIO can send it now.'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
      m.querySelector('#mr')?.addEventListener('click', async () => { const note = await askText('Return the announcement', 'What should the SAILS PIO fix?', { ok: 'Return' }); if (note === null) return; if (!String(note).trim()) { m.querySelector('#er').textContent = 'Say what needs to change.'; return; }
        try { await db(sb.from('v2_office_records').update({ status: 'draft', flags: { ...(r.flags || {}), return_note: String(note).trim().slice(0, 300) } }).eq('id', r.id)); close(); toast('Returned to the SAILS PIO'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
      m.querySelector('#ed')?.addEventListener('click', () => { close(); form([r.kind], r); });
      m.querySelector('#rm')?.addEventListener('click', async () => { const bin = ['secretary', 'mayor', 'sails_president'].includes(role); if (!(await confirmDialog(bin ? `"${r.title}" goes to the Trash. You can restore it for 7 days.` : `Delete "${r.title}"?`, { ok: 'Delete', title: bin ? 'Delete this record?' : 'Delete' }))) return; try { await db(bin ? sb.rpc('v2_trash_remove', { p_source: 'office_record', p_id: r.id }) : sb.from('v2_office_records').delete().eq('id', r.id)); close(); toast(bin ? 'Moved to the Trash' : 'Deleted'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
    });
  }

  /* an announcement goes draft, then to the Mayor; only the Mayor approves it, so the SAILS PIO is never offered approved or published for one */
  function statusOpts(k, type, cur) {
    const K = KIND[k], lock = k === 'post' && type === 'announcement' && role === 'pio', list = lock ? [['draft', 'Draft'], ['review', 'Send to the Mayor for approval'], ...K.st.filter(s => s[0] === cur && !['draft', 'review'].includes(s[0]))] : K.st;
    return list.map(s => `<option value="${s[0]}"${(cur || K.st[0][0]) === s[0] ? ' selected' : ''}>${s[1]}</option>`).join('');
  }
  function form(kinds, r, types) {
    const k0 = r ? r.kind : kinds[0], editing = !!r, t0 = r ? ptype(r) : (types ? types[0] : 'publication');
    const html = k => { const K = KIND[k], v = r || {}, plan = k === 'plan';
      return `${kinds.length > 1 && !editing ? `<label>Type</label><select name="kind" id="kk">${kinds.map(x => `<option value="${x}"${x === k ? ' selected' : ''}>${KIND[x].l}</option>`).join('')}</select>` : ''}
        <label>${K.t}</label><input name="title" maxlength="120" required value="${esc(v.title || '')}"><label>Date</label><input name="on_date" type="date" required value="${esc(v.on_date || todayISO())}">
        <label>${K.p}</label><input name="party" maxlength="100" value="${esc(v.party || '')}">
        ${K.event ? `<label>Event (optional)</label><select name="event_id"><option value="">Not linked to an event</option>${X.events.map(e => `<option value="${e.id}"${v.event_id === e.id ? ' selected' : ''}>${esc(e.title)} · ${fmtDate(e.event_date)}</option>`).join('')}</select>` : ''}
        <label>${K.b}</label><textarea name="body" rows="4" maxlength="3000">${esc(v.body || '')}</textarea>
        ${K.link ? `<label>${K.link}</label><input name="link" type="url" maxlength="300" placeholder="https://" value="${esc(v.link || '')}">` : ''}
        ${K.items ? `<label>${K.items}</label><textarea name="items" rows="6">${esc(editing ? (v.items || []).map(i => i.t).join('\n') : CHECKLIST)}</textarea>` : ''}
        ${K.level ? `<label>How serious</label><select name="level"><option value="low"${v.level === 'low' ? ' selected' : ''}>Low</option><option value="medium"${!v.level || v.level === 'medium' ? ' selected' : ''}>Medium</option><option value="high"${v.level === 'high' ? ' selected' : ''}>High</option></select>` : ''}
        ${k === 'post' ? `<label>What is it</label><select name="ptype" id="pt">${Object.entries(PTYPE).map(([x, l]) => `<option value="${x}"${x === t0 ? ' selected' : ''}>${l[0]}</option>`).join('')}</select>
          <div style="margin:10px 0 2px"><b>Checks before it can be approved or posted</b></div>${postChecks('media').map(([c, l]) => `<label class="ck"${c === 'consent' ? ' id="consrow"' : ''}${c === 'consent' && !['documentation', 'media'].includes(t0) ? ' style="display:none"' : ''}><input type="checkbox" name="fl_${c}"${(v.flags || {})[c] ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}` : ''}
        <label>Status</label><select name="status" id="stt">${statusOpts(k, t0, v.status)}</select>
        ${K.conf ? `<label class="ck" style="margin-top:10px"><input type="checkbox" name="confidential"${v.confidential ? ' checked' : ''}><span>Looks confidential (keeps it hidden from other officers until the SAILS Auditor classifies it)</span></label>` : ''}`; };
    modal(`<h3>${editing ? 'Edit' : 'Add'} ${kinds.length > 1 && !editing ? 'letter' : KIND[k0].l.toLowerCase()}</h3><form id="f"><div id="fb">${html(k0)}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const bindKk = () => m.querySelector('#kk')?.addEventListener('change', e => { m.querySelector('#fb').innerHTML = html(e.target.value); bindKk(); });
      bindKk();
      m.querySelector('#fb').addEventListener('change', e => { if (e.target.id === 'pt') { const sx = m.querySelector('#stt'); if (sx) sx.innerHTML = statusOpts('post', e.target.value, sx.value); const c = m.querySelector('#consrow'); if (c) c.style.display = ['documentation', 'media'].includes(e.target.value) ? '' : 'none'; } });
      m.querySelector('#f').onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target), kind = f.get('kind') || k0, K = KIND[kind], n = s => String(f.get(s) ?? '').trim() || null;
        const p = { title: n('title'), on_date: f.get('on_date'), party: n('party'), body: n('body'), status: f.get('status') };
        if (kind === 'post') {
          const type = f.get('ptype') || 'publication', fl = { ...(r?.flags || {}), type }, need = postChecks(type);
          ['privacy', 'branding', 'comms', 'consent'].forEach(c => { fl[c] = f.get('fl_' + c) === 'on'; });
          const miss = need.filter(([c]) => !fl[c]);
          if (['approved', 'published'].includes(p.status) && miss.length) { m.querySelector('#er').textContent = 'Tick these checks before approving or posting: ' + miss.map(x => x[2]).join(', ') + '.'; return; }
          p.flags = fl;
        }
        if (K.link) p.link = n('link'); if (K.event) p.event_id = f.get('event_id') || null; if (K.level) p.level = f.get('level'); if (K.conf) p.confidential = f.get('confidential') === 'on';
        if (K.items) { const old = r?.items || []; p.items = String(f.get('items') || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 40).map(t => ({ t, done: !!old.find(o => o.t === t)?.done })); }
        try { await db(editing ? sb.from('v2_office_records').update(p).eq('id', r.id) : sb.from('v2_office_records').insert({ ...p, kind })); close(); toast('Saved'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; }
      };
    });
  }

  const off = watch(['v2_office_records', 'v2_events', 'v2_entries', 'v2_budget_requests', 'v2_liquidations', 'v2_documents', 'v2_coa'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  el.innerHTML = skeleton(4);
  await load();
  return off;
}
