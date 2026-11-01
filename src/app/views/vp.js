import { sb, db, watch, esc, toast, modal, skeleton, confirmDialog, fmtDate, todayISO } from '../core.js';

/* VP Desk: the Vice President Internal (Chief Mate – Internal) and Vice President External (Chief Mate – External) each get a dashboard.
   A VP proposes; the Mayor approves or returns. Run supabase/v28_vice_presidents.sql once for this screen to work. */
const SK = 'alpha-vp-view';
const dayMs = 864e5;
const ST = { proposed: ['with the Mayor', 'warn'], returned: ['returned', 'bad'], approved: ['approved', 'ok'], active: ['active', 'ok'], inactive: ['inactive', ''], done: ['done', 'ok'], cancelled: ['cancelled', ''], ongoing: ['ongoing', 'warn'],
  todo: ['to do', 'bad'], doing: ['doing', 'warn'], pending: ['not started', 'bad'], open: ['open', 'warn'], adopted: ['adopted', 'ok'], dropped: ['dropped', ''] };
const ADV = { pending: 'Adviser has not reviewed yet', endorsed: 'Adviser endorsed', not_endorsed: 'Adviser did not endorse' };
const tag = s => `<span class="tag ${(ST[s] || [])[1] || ''}">${(ST[s] || [s])[0]}</span>`;

const SIDE = {
  int: { label: 'Internal', title: 'Chief Mate – Internal', panes: [['over', 'Overview'], ['meet', 'Meetings'], ['res', 'Resolutions'], ['com', 'Committee'], ['del', 'From Mayor']] },
  ext: { label: 'External', title: 'Chief Mate – External', panes: [['over', 'Overview'], ['par', 'Partners'], ['act', 'Activities'], ['reg', 'Register'], ['rep', 'Rep log'], ['cou', 'Council']] },
};

/* one entry per list: table, who may write, form fields, what the Mayor approves into, and the next steps a VP may take */
const CFG = {
  meet: { t: 'v2_vp_meetings', name: 'meeting or program', who: ['mayor', 'vp_internal', 'vice_mayor'], approval: 'approved', order: ['held_on', false],
    fields: [{ k: 'kind', l: 'Type', type: 'select', o: [['meeting', 'Meeting'], ['program', 'Program or activity']] }, { k: 'title', l: 'Title', req: 1 }, { k: 'held_on', l: 'Date', type: 'date', req: 1 }, { k: 'held_at', l: 'Time (optional)', ph: '3:00 PM' }, { k: 'venue', l: 'Venue' },
      { k: 'agenda', l: 'Agenda or plan', type: 'area' }, { k: 'assigned', l: 'Who is assigned', ph: 'Section reps, committee heads…' }, { k: 'outcome', l: 'What happened (after it is held)', type: 'area' }],
    next: r => r.status === 'approved' ? [['Mark held', 'done'], ['Cancel', 'cancelled']] : ['proposed', 'returned'].includes(r.status) ? [['Cancel', 'cancelled']] : [],
    row: r => [r.title, `${r.kind === 'program' ? 'Program' : 'Meeting'} · ${fmtDate(r.held_on)}${r.held_at ? ' ' + esc(r.held_at) : ''}${r.venue ? ' · ' + esc(r.venue) : ''}`, r.status] },
  com: { t: 'v2_vp_tasks', name: 'task', who: ['mayor', 'vp_internal', 'vp_external', 'vice_mayor'], order: ['created_at', false],
    fields: [{ k: 'title', l: 'Task', req: 1 }, { k: 'scope', l: 'Section or year level', ph: '1-Alpha, all 1st years…' }, { k: 'assignee', l: 'Assigned to' }, { k: 'due_on', l: 'Due date', type: 'date' }, { k: 'note', l: 'Note', type: 'area' }],
    next: r => r.status === 'todo' ? [['Start', 'doing'], ['Done', 'done']] : r.status === 'doing' ? [['Done', 'done'], ['Back to to-do', 'todo']] : [['Reopen', 'todo']],
    row: r => [r.title, [r.scope, r.assignee, r.due_on ? 'due ' + fmtDate(r.due_on) : ''].filter(Boolean).map(esc).join(' · ') || 'No details', r.status] },
  res: { t: 'v2_vp_resolutions', name: 'resolution', who: ['mayor', 'vp_internal', 'vice_mayor'], order: ['created_at', false],
    fields: [{ k: 'title', l: 'Resolution', req: 1 }, { k: 'details', l: 'What it requires', type: 'area' }, { k: 'status', l: 'Status', type: 'select', o: [['pending', 'Not started'], ['ongoing', 'Ongoing'], ['done', 'Implemented']] }, { k: 'progress', l: 'Progress report', type: 'area', ph: 'What has been done so far' }],
    before: (p, old) => { if ((p.progress || null) !== (old?.progress || null)) p.reported_on = todayISO(); return p; },
    row: r => [r.title, r.progress ? `Report ${fmtDate(r.reported_on)}: ${esc(r.progress).slice(0, 70)}` : 'No progress report yet', r.status] },
  del: { t: 'v2_vp_delegations', name: 'task from the Mayor', who: ['mayor'], order: ['created_at', false],
    fields: [{ k: 'to_role', l: 'Given to', type: 'select', o: [['both', 'Both Vice Presidents'], ['vp_internal', 'VP Internal'], ['vp_external', 'VP External']] }, { k: 'title', l: 'Task', req: 1 }, { k: 'details', l: 'Details', type: 'area' }, { k: 'from_date', l: 'From', type: 'date' }, { k: 'to_date', l: 'Until', type: 'date' }],
    row: r => [r.title, `${{ both: 'Both VPs', vp_internal: 'VP Internal', vp_external: 'VP External' }[r.to_role]}${r.to_date ? ' · until ' + fmtDate(r.to_date) : ''}${r.status === 'done' ? ' · done by ' + esc(r.done_by_name || '') : ''}`, r.status === 'done' ? 'done' : 'open'] },
  par: { t: 'v2_vp_partners', name: 'partner', who: ['mayor', 'vp_external', 'vice_mayor'], approval: 'active', order: ['name', true],
    fields: [{ k: 'name', l: 'Name', req: 1 }, { k: 'kind', l: 'Kind', type: 'select', o: [['organization', 'Student organization'], ['institution', 'Institution or school'], ['alumni', 'Alumni'], ['community', 'Community group']] }, { k: 'contact_name', l: 'Contact person' }, { k: 'contact', l: 'Phone, email or page' },
      { k: 'notes', l: 'Notes', type: 'area' }, { k: 'adviser_status', l: 'Adviser review', type: 'select', o: [['pending', ADV.pending], ['endorsed', ADV.endorsed], ['not_endorsed', ADV.not_endorsed]] }, { k: 'adviser_note', l: 'Adviser note' }],
    next: r => r.status === 'active' ? [['Mark inactive', 'inactive']] : r.status === 'inactive' ? [['Mark active', 'active']] : [],
    row: r => [r.name, `${{ organization: 'Student organization', institution: 'Institution', alumni: 'Alumni', community: 'Community group' }[r.kind]}${r.contact_name ? ' · ' + esc(r.contact_name) : ''}`, r.status] },
  act: { t: 'v2_vp_activities', name: 'joint activity', who: ['mayor', 'vp_external', 'vice_mayor'], approval: 'approved', order: ['created_at', false],
    fields: [{ k: 'title', l: 'Activity or collaboration', req: 1 }, { k: 'partner_id', l: 'Partner', type: 'partner' }, { k: 'details', l: 'What it is and what SAILS contributes', type: 'area' }, { k: 'planned_on', l: 'Planned date', type: 'date' },
      { k: 'papers', l: 'Letters, MOA and other papers (and where they are kept)' }, { k: 'adviser_status', l: 'Adviser review', type: 'select', o: [['pending', ADV.pending], ['endorsed', ADV.endorsed], ['not_endorsed', ADV.not_endorsed]] }, { k: 'adviser_note', l: 'Adviser note' },
      { k: 'authority_ok', l: 'The wording of every outside letter and message states SAILS authority correctly', type: 'check' }],
    next: r => r.status === 'approved' ? [['Start', 'ongoing'], ['Mark done', 'done']] : r.status === 'ongoing' ? [['Mark done', 'done']] : [],
    row: (r, d) => [r.title, `${esc(d.par.find(p => p.id === r.partner_id)?.name || 'No partner')}${r.planned_on ? ' · ' + fmtDate(r.planned_on) : ''}`, r.status] },
  rep: { t: 'v2_vp_reps', name: 'representation', who: ['mayor', 'vp_external', 'vice_mayor'], order: ['held_on', false],
    fields: [{ k: 'held_on', l: 'Date', type: 'date', req: 1 }, { k: 'title', l: 'Meeting, forum or event', req: 1 }, { k: 'organizer', l: 'Organized by' }, { k: 'delegated_by', l: 'Delegated by', ph: 'The President' }, { k: 'notes', l: 'What was discussed or agreed', type: 'area' }],
    row: r => [r.title, `${fmtDate(r.held_on)}${r.organizer ? ' · ' + esc(r.organizer) : ''}`, null] },
  cou: { t: 'v2_vp_council', name: 'council item', who: ['mayor', 'vp_external', 'vice_mayor'], order: ['created_at', false],
    fields: [{ k: 'kind', l: 'Type', type: 'select', o: [['agenda', 'Agenda item'], ['resolution', 'Resolution']] }, { k: 'title', l: 'Title', req: 1 }, { k: 'body', l: 'Details', type: 'area' }, { k: 'meet_on', l: 'Meeting date', type: 'date' }, { k: 'status', l: 'Status', type: 'select', o: [['open', 'Open'], ['adopted', 'Adopted'], ['dropped', 'Dropped']] }],
    row: r => [r.title, `${r.kind === 'resolution' ? 'Resolution' : 'Agenda'}${r.meet_on ? ' · ' + fmtDate(r.meet_on) : ''}`, r.status] },
};
const FETCH = { meet: 'v2_vp_meetings', com: 'v2_vp_tasks', res: 'v2_vp_resolutions', del: 'v2_vp_delegations', par: 'v2_vp_partners', act: 'v2_vp_activities', rep: 'v2_vp_reps', cou: 'v2_vp_council' };

export async function mountVp(el, ctx) {
  const role = ctx.profile.role, isMayor = ctx.can('mayor'), both = !['vp_internal', 'vp_external'].includes(role);
  const sides = role === 'vp_internal' ? ['int'] : role === 'vp_external' ? ['ext'] : ['int', 'ext'];
  let side = (() => { try { const s = localStorage.getItem(SK); return sides.includes(s) ? s : sides[0]; } catch { return sides[0]; } })(), pane = 'over', d = null, snap = null, missing = false;
  async function load() {
    try {
      const out = await Promise.all(Object.entries(FETCH).map(([k, t]) => db(sb.from(t).select('*').order(CFG[k] ? CFG[k].order[0] : 'created_at', { ascending: CFG[k] ? CFG[k].order[1] : false }).limit(500)).then(r => [k, r])));
      d = Object.fromEntries(out); missing = false;
    } catch (e) { if (/does not exist|schema cache|relation/i.test(e.message || '')) { missing = true; d = null; } else throw e; }
    try {   // how the class is turning out, from the latest event
      const [ev] = await db(sb.from('v2_events').select('id,title,event_date').order('event_date', { ascending: false }).limit(1));
      if (ev) { const [sc, mem] = await Promise.all([db(sb.from('v2_event_scans').select('member_id').eq('event_id', ev.id).eq('kind', 'in')), db(sb.from('v2_members').select('id').eq('status', 'active'))]); snap = { ev, in: new Set(sc.map(x => x.member_id)).size, all: mem.length }; } else snap = null;
    } catch { snap = null; }
    draw();
  }

  const mine = r => role === 'vice_mayor' || isMayor || r.to_role === 'both' || r.to_role === role;
  function needs() {
    const today = todayISO(), n = [], add = (t, s, p) => n.push({ t, s, p });
    const soon = x => x && (new Date(x) - new Date(today)) / dayMs;
    const dels = d.del.filter(x => x.status === 'open' && mine(x));
    if (dels.length) add(`${dels.length} task${dels.length === 1 ? '' : 's'} from the Mayor ${isMayor ? 'not done yet' : 'for you'}`, sides.includes('int') ? 'int' : 'ext', 'del');
    if (isMayor) {
      const w = (k, label, s, p) => { const c = d[k].filter(x => x.status === 'proposed').length; if (c) add(`${c} ${label} waiting for your decision`, s, p); };
      w('meet', 'meeting or program(s)', 'int', 'meet'); w('par', 'partner(s)', 'ext', 'par'); w('act', 'joint activit' + (d.act.filter(x => x.status === 'proposed').length === 1 ? 'y' : 'ies'), 'ext', 'act');
    }
    if (side === 'int' || both) {
      const ret = d.meet.filter(x => x.status === 'returned').length; if (ret && !isMayor) add(`${ret} meeting or program(s) returned by the Mayor`, 'int', 'meet');
      const soonM = d.meet.filter(x => x.status === 'approved' && soon(x.held_on) >= 0 && soon(x.held_on) <= 2); if (soonM.length) add(`${soonM.length} meeting or program(s) in the next 2 days`, 'int', 'meet');
      const late = d.com.filter(x => x.status !== 'done' && x.due_on && x.due_on < today).length; if (late) add(`${late} committee task(s) past the due date`, 'int', 'com');
      const stale = d.res.filter(x => x.status !== 'done' && (!x.reported_on || (new Date(today) - new Date(x.reported_on)) / dayMs > 14)).length; if (stale) add(`${stale} resolution(s) with no progress report in 14 days`, 'int', 'res');
    }
    if (side === 'ext' || both) {
      const ret = d.act.filter(x => x.status === 'returned').length + d.par.filter(x => x.status === 'returned').length; if (ret && !isMayor) add(`${ret} partner or activity proposal(s) returned by the Mayor`, 'ext', 'act');
      const noAdv = d.act.filter(x => ['proposed', 'returned'].includes(x.status) && x.adviser_status !== 'endorsed').length; if (noAdv) add(`${noAdv} proposal(s) the adviser has not endorsed yet`, 'ext', 'act');
      const noAuth = d.act.filter(x => !x.authority_ok && ['proposed', 'returned', 'approved'].includes(x.status)).length; if (noAuth) add(`${noAuth} activit${noAuth === 1 ? 'y' : 'ies'} where the SAILS authority wording is not checked`, 'ext', 'act');
      const agenda = d.cou.filter(x => x.status === 'open' && x.meet_on && soon(x.meet_on) >= 0 && soon(x.meet_on) <= 3).length; if (agenda) add(`${agenda} Coordinating Council item(s) coming up in 3 days`, 'ext', 'cou');
    }
    return n;
  }

  function overview() {
    const mo = todayISO().slice(0, 7), stat = (l, v, c = '') => `<div class="stat ${c}"><small>${l}</small><b>${v}</b></div>`;
    const stats = side === 'int'
      ? stat('Meetings and programs ahead', d.meet.filter(x => ['approved', 'proposed'].includes(x.status) && x.held_on >= todayISO()).length, 'gold') + stat('Waiting for the Mayor', d.meet.filter(x => x.status === 'proposed').length) + stat('Open committee tasks', d.com.filter(x => x.status !== 'done').length) + stat('Resolutions ongoing', d.res.filter(x => x.status === 'ongoing').length)
      : stat('Active partners', d.par.filter(x => x.status === 'active').length, 'gold') + stat('Activities in progress', d.act.filter(x => ['approved', 'ongoing'].includes(x.status)).length) + stat('Waiting for the Mayor', d.par.concat(d.act).filter(x => x.status === 'proposed').length) + stat('Representations this month', d.rep.filter(x => (x.held_on || '').startsWith(mo)).length);
    const nd = needs();
    return `<div class="grid">${stats}</div>
      ${side === 'int' && snap ? `<div class="card pad" style="margin:12px 0"><div style="display:flex;justify-content:space-between"><b>Latest attendance</b><small class="muted">${esc(snap.ev.title)} · ${fmtDate(snap.ev.event_date)}</small></div><div class="prog" style="margin-top:8px"><i style="width:${snap.all ? Math.min(100, snap.in / snap.all * 100) : 0}%"></i></div><small class="muted">${snap.in} of ${snap.all} students scanned in${snap.all ? ' (' + Math.round(snap.in / snap.all * 100) + '%)' : ''}</small></div>` : ''}
      <h3 style="margin:16px 2px 8px">Needs you</h3>
      <div class="card">${nd.length ? nd.map((x, i) => `<div class="row" data-n="${i}" style="cursor:pointer"><div class="m"><b>${esc(x.t)}</b></div><span class="muted">›</span></div>`).join('') : '<p class="empty">Nothing is waiting. Everything is up to date.</p>'}</div>
      <p class="muted" style="margin:12px 2px 0;font-size:.85rem">${side === 'int'
        ? 'Internal Affairs: assist the President and act in the President’s place during a temporary absence; coordinate internal committees, member engagement and section or year-level work; follow up internal resolutions and report progress.'
        : 'External Affairs: coordinate authorized relations with other organizations, alumni and outside partners; prepare partnership proposals for adviser and institutional review; make sure outside communications describe SAILS authority correctly; keep records of approved collaborations.'}</p>`;
  }

  function register() {
    const ok = d.act.filter(x => ['approved', 'ongoing', 'done'].includes(x.status));
    return `<p class="muted" style="margin:0 2px 8px">Approved collaborations and where their papers are kept.</p><div class="card">${ok.map(r => `<div class="row" data-reg="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(r.title)}</b><small>${esc(d.par.find(p => p.id === r.partner_id)?.name || 'No partner')}${r.planned_on ? ' · ' + fmtDate(r.planned_on) : ''}<br>${r.papers ? esc(r.papers) : 'No papers recorded'}</small></div>${tag(r.status)}</div>`).join('') || '<p class="empty">No approved collaborations yet.</p>'}</div>`;
  }

  function list(k) {
    const c = CFG[k], canW = c.who.includes(role), rows = d[FETCH_KEY(k)];
    return `${canW ? `<button class="btn gold" id="add" style="width:100%;margin-bottom:10px">+ Add ${c.name}${c.approval && !isMayor ? ' (goes to the Mayor)' : ''}</button>` : ''}
      <div class="card">${rows.map(r => { const [a, b, s] = c.row(r, d); return `<div class="row" data-i="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(a)}</b><small>${b}</small></div>${s ? tag(s) : '<span class="muted">›</span>'}</div>`; }).join('') || `<p class="empty">Nothing here yet.</p>`}</div>`;
  }
  const FETCH_KEY = k => k;

  function draw() {
    if (missing) { el.innerHTML = '<div class="card pad"><b>One more step.</b><p class="muted">Run <b>v28_vice_presidents.sql</b> in the Supabase SQL Editor, then reload this screen.</p></div>'; return; }
    const S = SIDE[side];
    el.innerHTML = `${sides.length > 1 ? `<div style="display:flex;gap:6px;margin-bottom:8px">${sides.map(s => `<button class="btn ${s === side ? 'gold' : 'ghost'}" data-side="${s}" style="flex:1">${SIDE[s].label}</button>`).join('')}</div>` : ''}
      <div style="margin:0 2px 8px"><b>${S.title}</b></div>
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;padding-bottom:2px">${S.panes.map(([id, l]) => `<button class="btn ${id === pane ? 'gold' : 'ghost'} sm" data-pane="${id}" style="white-space:nowrap">${l}</button>`).join('')}</div>
      <div id="pb">${pane === 'over' ? overview() : pane === 'reg' ? register() : list(pane)}</div>`;
    el.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { side = b.dataset.side; pane = 'over'; try { localStorage.setItem(SK, side); } catch { /* ignore */ } draw(); });
    el.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => { pane = b.dataset.pane; draw(); });
    if (pane === 'over') { const nd = needs(); el.querySelectorAll('[data-n]').forEach(r => r.onclick = () => { const x = nd[+r.dataset.n]; side = x.s; pane = x.p; draw(); }); return; }
    if (pane === 'reg') { el.querySelectorAll('[data-reg]').forEach(r => r.onclick = () => view('act', d.act.find(x => x.id === r.dataset.reg))); return; }
    el.querySelector('#add')?.addEventListener('click', () => form(pane, null));
    el.querySelectorAll('[data-i]').forEach(r => r.onclick = () => view(pane, d[pane].find(x => x.id === r.dataset.i)));
  }

  const val = (c, f, r) => { const v = r[f.k]; if (f.type === 'check') return v ? 'Yes' : 'No'; if (f.type === 'partner') return esc(d.par.find(p => p.id === v)?.name || '—'); if (f.type === 'select') return esc((f.o.find(o => o[0] === v) || [, v || '—'])[1]); if (f.type === 'date') return fmtDate(v); return v ? esc(v) : '—'; };

  function view(k, r) {
    if (!r) return;
    const c = CFG[k], canW = c.who.includes(role), pending = c.approval && r.status === 'proposed';
    const steps = canW && c.next && !isMayorOnlyBlock(r) ? c.next(r) : [];
    const canDel = canW && (isMayor || !c.approval || ['proposed', 'returned'].includes(r.status)) && k !== 'del' || (k === 'del' && isMayor);
    modal(`<h3>${esc(r.title || r.name)}</h3>${r.status && k !== 'rep' ? `<p style="margin:0 0 8px">${tag(k === 'del' ? (r.status === 'done' ? 'done' : 'open') : r.status)}</p>` : ''}
      ${r.mayor_note ? `<div class="card pad" style="margin-bottom:8px"><small class="muted">Mayor's note</small><div>${esc(r.mayor_note)}</div></div>` : ''}
      ${k === 'del' && r.status === 'done' ? `<div class="card pad" style="margin-bottom:8px"><small class="muted">Done by ${esc(r.done_by_name || '')}</small><div>${esc(r.done_note || '')}</div></div>` : ''}
      ${c.fields.filter(f => f.k !== 'title' && f.k !== 'name').map(f => `<div style="margin:6px 0"><small class="muted">${esc(f.l)}</small><div style="white-space:pre-wrap">${val(c, f, r)}</div></div>`).join('')}
      <small class="muted">Added by ${esc(r.created_by_name || '—')}</small>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
        ${isMayor && pending ? '<button class="btn gold" id="ap">Approve</button><button class="btn ghost" id="rt">Return with a note</button>' : ''}
        ${!isMayor && r.status === 'returned' && c.approval ? '<button class="btn gold" id="rs">Fix and send again</button>' : ''}
        ${k === 'del' && r.status === 'open' && mine(r) ? '<button class="btn gold" id="dn">Mark done</button>' : ''}
        ${steps.map(([l, s]) => `<button class="btn ghost" data-s="${s}">${l}</button>`).join('')}
        ${canW ? '<button class="btn ghost" id="ed">Edit</button>' : ''}${canDel ? '<button class="btn ghost" id="rm" style="color:#c0392b">Delete</button>' : ''}<button class="btn ghost" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      const go = async (patch, msg) => { try { await db(sb.from(c.t).update(patch).eq('id', r.id)); close(); toast(msg || 'Saved'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
      m.querySelector('#cx').onclick = close;
      m.querySelector('#ed')?.addEventListener('click', () => { close(); form(k, r); });
      m.querySelector('#rm')?.addEventListener('click', async () => { if (!(await confirmDialog(`Delete this ${c.name}?`, { ok: 'Delete', title: 'Delete' }))) return; try { await db(sb.from(c.t).delete().eq('id', r.id)); close(); toast('Deleted'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
      m.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go({ status: b.dataset.s }));
      m.querySelector('#rs')?.addEventListener('click', () => go({ status: 'proposed' }, 'Sent to the Mayor again'));
      m.querySelector('#ap')?.addEventListener('click', async () => {
        if (k === 'act' && (r.adviser_status !== 'endorsed' || !r.authority_ok) && !(await confirmDialog(`${r.adviser_status !== 'endorsed' ? 'The adviser has not endorsed this yet. ' : ''}${!r.authority_ok ? 'The SAILS authority wording has not been checked. ' : ''}Approve anyway?`, { ok: 'Approve anyway', title: 'Not ready' }))) return;
        go({ status: c.approval }, 'Approved');
      });
      m.querySelector('#rt')?.addEventListener('click', () => { close(); modal(`<h3>Return with a note</h3><label>What needs to change</label><textarea id="nt" rows="3" maxlength="300" required></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:1">Return</button><button class="btn ghost" id="cx2">Cancel</button></div><div class="err" id="er"></div>`, (m2, close2) => {
        m2.querySelector('#cx2').onclick = close2;
        m2.querySelector('#go').onclick = async () => { const n = m2.querySelector('#nt').value.trim(); if (!n) return void (m2.querySelector('#er').textContent = 'Write what needs to change.'); try { await db(sb.from(c.t).update({ status: 'returned', mayor_note: n }).eq('id', r.id)); close2(); toast('Returned'); load(); } catch (x) { m2.querySelector('#er').textContent = x.message; } }; }); });
      m.querySelector('#dn')?.addEventListener('click', () => { close(); modal(`<h3>Mark done</h3><label>Note (optional)</label><textarea id="nt" rows="3" maxlength="300"></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:1">Mark done</button><button class="btn ghost" id="cx2">Cancel</button></div><div class="err" id="er"></div>`, (m2, close2) => {
        m2.querySelector('#cx2').onclick = close2;
        m2.querySelector('#go').onclick = async () => { try { await db(sb.rpc('v2_deleg_done', { p_id: r.id, p_note: m2.querySelector('#nt').value.trim() || null })); close2(); toast('Marked done'); load(); } catch (x) { m2.querySelector('#er').textContent = x.message; } }; }); });
    });
  }
  const isMayorOnlyBlock = r => !isMayor && r.status === 'proposed';   // a VP cannot move a proposal along while the Mayor is deciding

  function form(k, r) {
    const c = CFG[k], editing = !!r;
    const inp = f => { const v = r ? r[f.k] : '';
      if (f.type === 'area') return `<textarea name="${f.k}" rows="3" maxlength="1000" placeholder="${esc(f.ph || '')}">${esc(r?.[f.k] || '')}</textarea>`;
      if (f.type === 'check') return `<label class="ck"><input type="checkbox" name="${f.k}"${r?.[f.k] ? ' checked' : ''}><span>${esc(f.l)}</span></label>`;
      if (f.type === 'select') return `<select name="${f.k}">${f.o.map(o => `<option value="${o[0]}"${(r ? r[f.k] : f.o[0][0]) === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
      if (f.type === 'partner') return `<select name="${f.k}"><option value="">No partner yet</option>${d.par.filter(p => p.status !== 'proposed' || true).map(p => `<option value="${p.id}"${r?.[f.k] === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
      return `<input name="${f.k}" type="${f.type === 'date' ? 'date' : 'text'}" value="${esc(v ?? '')}" maxlength="120" placeholder="${esc(f.ph || '')}"${f.req ? ' required' : ''}>`; };
    modal(`<h3>${editing ? 'Edit' : 'Add'} ${c.name}</h3><form id="f">${c.fields.map(f => f.type === 'check' ? inp(f) : `<label>${esc(f.l)}</label>${inp(f)}`).join('')}
      ${c.approval && !isMayor ? '<p class="muted" style="margin:10px 0 0">After you save, this goes to the Mayor for approval.</p>' : ''}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target); let p = {};
        c.fields.forEach(x => { p[x.k] = x.type === 'check' ? f.get(x.k) === 'on' : (String(f.get(x.k) ?? '').trim() || null); });
        if (c.before) p = c.before(p, r);
        if (!editing && c.approval && isMayor) p.status = c.approval;
        if (!editing && k === 'del') p.status = 'open';
        try { await db(editing ? sb.from(c.t).update(p).eq('id', r.id) : sb.from(c.t).insert(p)); close(); toast(editing ? 'Saved' : c.approval && !isMayor ? 'Saved. Waiting for the Mayor.' : 'Added'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; }
      };
    });
  }

  el.innerHTML = skeleton(4);
  const off = watch(Object.values(FETCH).concat(['v2_events']), () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  await load();
  return off;
}
