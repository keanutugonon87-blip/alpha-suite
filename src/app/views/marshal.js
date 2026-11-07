import { sb, db, watch, esc, toast, modal, skeleton, fmtDate, todayISO, confirmDialog } from '../core.js';

/* The Marshal line: the General Marshal and Department Marshals 1-4 have their own desk.
   President -> General Marshal -> Department Marshals. A Department Marshal never orders a class officer: they ask the section's Class Mayor,
   who accepts (directives go to the class Marshals) or declines. Class incident files stay with the class. */
const INC = { filed: ['Filed', 'warn'], reviewed: ['Reviewed', ''], referred: ['Referred', 'bad'], closed: ['Closed', 'ok'] };
const MREQ = { open: ['Waiting for the Mayor', 'warn'], accepted: ['Accepted', 'ok'], declined: ['Declined', 'bad'] };

export async function mountMarshal(el, ctx) {
  const gm = ctx.profile.role === 'general_marshal', me = ctx.profile.user_id || ctx.user?.id;
  const panes = gm ? [['over', 'Overview'], ['blocks', 'Blocks'], ['inc', 'Incident reports']] : [['block', 'My block'], ['inc', 'Incident reports'], ['ask', 'Ask a class']];
  let pane = panes[0][0], X = { blocks: [], inc: [], req: [], dir: [], dms: [] }, setup = false;
  el.innerHTML = skeleton(4);

  const ANY = p => Promise.resolve(p).then(r => r.error ? (setup = true, []) : (r.data || []), () => []);
  async function load() {
    const [ov, inc, req, dir, dms] = await Promise.all([
      sb.rpc('v2_marshal_overview').then(r => r.error ? (setup = true, []) : (r.data || []), () => []),
      ANY(sb.from('v2_marshal_incidents').select('*').order('created_at', { ascending: false }).limit(200)),
      ANY(sb.from('v2_marshal_requests').select('*').order('created_at', { ascending: false }).limit(100)),
      ANY(sb.from('v2_directives').select('id,title,status,assignee_name,assignee_id,issued_by,due_on').order('issued_at', { ascending: false }).limit(200)),
      gm ? ANY(sb.from('v2_profiles').select('user_id,full_name').eq('role', 'dept_marshal').order('full_name')) : Promise.resolve([]),
    ]);
    X = { blocks: ov, inc, req, dir, dms };
    draw();
  }

  const tag = (m, k) => `<span class="tag ${m[k][1]}">${m[k][0]}</span>`;
  const sections = b => (b.sections || []).map(s => `<div class="row"><div class="m"><b>${esc(s.name)}</b><small>${s.students} student${s.students === 1 ? '' : 's'}</small></div><span class="tag ${s.has_mayor ? 'ok' : ''}">${s.has_mayor ? 'Mayor on Alpha ’28' : 'no Mayor account yet'}</span></div>`).join('') || '<p class="empty">No sections in this block yet.</p>';
  const setupNote = () => setup ? '<p class="muted" style="margin:0 2px 8px">If a list stays empty or shows an error, run <b>v45_marshal_line.sql</b> in Supabase first.</p>' : '';

  function overview() {
    const filed = X.inc.filter(i => i.status === 'filed').length, referred = X.inc.filter(i => i.status === 'referred').length;
    const mine = X.dir.filter(d => d.issued_by === me), toConfirm = mine.filter(d => d.status === 'done').length, open = mine.filter(d => ['sent', 'received', 'working'].includes(d.status)).length;
    const unset = X.blocks.filter(b => !b.user_id).length;
    return `${setupNote()}<div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>Reports to review</small><b>${filed}</b></div><div class="stat"><small>Referred upward</small><b>${referred}</b></div><div class="stat"><small>Directives to confirm</small><b>${toConfirm}</b></div><div class="stat"><small>Directives open</small><b>${open}</b></div></div>
      <div class="card">${X.blocks.map(b => `<div class="row"><div class="m"><b>Block ${esc(b.letter)}</b><small>${(b.sections || []).length} section${(b.sections || []).length === 1 ? '' : 's'} · ${(b.sections || []).reduce((a, s) => a + s.students, 0)} students</small></div><span class="tag ${b.user_id ? 'ok' : 'bad'}">${b.user_id ? esc(b.user_name || 'assigned') : 'no Marshal assigned'}</span></div>`).join('')}</div>
      <p class="muted" style="margin:10px 2px">${unset ? `${unset} block${unset === 1 ? ' has' : 's have'} no Department Marshal yet. Assign them in Blocks. ` : ''}You report to the SAILS President and direct the four Department Marshals. To give a Department Marshal a task, use <b>Directives</b>. You do not give orders to class officers: a class is asked through its Mayor.</p>`;
  }
  function blocks() {
    return `${setupNote()}<p class="muted" style="margin:0 2px 8px">Marshal 1 covers Alpha, 2 covers Bravo, 3 covers Charlie, 4 covers Delta, across every year level. Pick who covers each block.</p>
      ${X.blocks.map(b => `<div class="card" style="margin-bottom:10px"><div class="row"><div class="m" style="flex:1;min-width:70px"><b>Block ${esc(b.letter)}</b></div><select style="width:auto;flex:0 1 220px;min-width:140px" data-bl="${esc(b.letter)}" aria-label="Marshal for block ${esc(b.letter)}"><option value="">No one yet</option>${X.dms.map(m => `<option value="${m.user_id}"${b.user_id === m.user_id ? ' selected' : ''}>${esc(m.full_name)}</option>`).join('')}</select></div>${sections(b)}</div>`).join('') || '<p class="empty">No blocks yet.</p>'}
      ${X.dms.length ? '' : '<p class="muted" style="margin:6px 2px">There are no Department Marshal accounts yet. The President or the Mayor approves them under Accounts, with the role “Department Marshal”.</p>'}`;
  }
  function myBlock() {
    const b = X.blocks[0];
    return `${setupNote()}${b ? `<p class="muted" style="margin:0 2px 8px">You cover <b>Block ${esc(b.letter)}</b>. You report to the General Marshal. You can see who leads each section, but you never order a class officer: ask the Class Mayor.</p><div class="card">${sections(b)}</div>` : '<p class="empty">The General Marshal has not assigned your block yet.</p>'}`;
  }
  function incidents() {
    const list = X.inc;
    return `${setupNote()}${gm ? '<p class="muted" style="margin:0 2px 8px">Reports filed by the Department Marshals during department events. Class incident files stay with each class. You can refer a serious report to the President or the adviser.</p>' : '<p class="muted" style="margin:0 2px 8px">File a report for something that happened during a department event or your section duty. Write facts only. Do not name or shame a student; the General Marshal decides whether it goes higher.</p>'}
      <div class="bar"><button class="btn gold" id="ni">+ File a report</button></div>
      ${list.length ? `<div class="card">${list.map(i => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(i.event || 'Department duty')}</b><small>${fmtDate(i.occurred_on + 'T00:00:00+08:00')}${i.section ? ' · ' + esc(i.section) : ''}${gm ? ' · ' + esc(i.reporter_name || '') : ''}</small></div>${tag(INC, i.status)}</div>
        <p style="margin:6px 0 0;white-space:pre-wrap">${esc(i.summary)}</p>${i.action_taken ? `<small class="muted">Action taken: ${esc(i.action_taken)}</small>` : ''}${i.gm_note ? `<p class="muted" style="margin:6px 0 0">${i.referred_to ? 'Referred to the ' + esc(i.referred_to) + ': ' : 'General Marshal: '}${esc(i.gm_note)}</p>` : ''}
        ${gm && i.status !== 'closed' ? `<div class="acts" style="margin-top:8px">${i.status === 'filed' ? `<button class="btn ghost sm" data-ir="review" data-i="${i.id}">Mark reviewed</button>` : ''}${i.status !== 'referred' ? `<button class="btn gold sm" data-ir="refer_president" data-i="${i.id}">Refer to the President</button><button class="btn ghost sm" data-ir="refer_adviser" data-i="${i.id}">Refer to the adviser</button>` : ''}<button class="btn ghost sm" data-ir="close" data-i="${i.id}">Close</button></div>` : ''}</div>`).join('')}</div>` : '<p class="empty">No reports yet.</p>'}`;
  }
  function ask() {
    const b = X.blocks[0], opts = ((b && b.sections) || []).filter(s => s.has_mayor);
    return `${setupNote()}<p class="muted" style="margin:0 2px 8px">To get a class’s help at a department event, send the request to that section’s Class Mayor. The Mayor accepts, which sends directives to the class Marshals, or declines with a reason. You cannot order class officers yourself.</p>
      <div class="bar"><button class="btn gold" id="na"${opts.length ? '' : ' disabled'}>+ New request</button></div>${opts.length ? '' : '<p class="muted" style="margin:6px 2px">No section in your block has a Mayor on Alpha ’28 yet.</p>'}
      ${X.req.length ? `<div class="card">${X.req.map(r => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(r.title)}</b><small>${esc(r.unit_name)}${r.needed_on ? ' · needed ' + fmtDate(r.needed_on + 'T00:00:00+08:00') : ''}</small></div>${tag(MREQ, r.status)}</div>${r.details ? `<p style="margin:6px 0 0">${esc(r.details)}</p>` : ''}${r.answer_note ? `<p class="muted" style="margin:6px 0 0">Mayor: ${esc(r.answer_note)}</p>` : ''}</div>`).join('')}</div>` : '<p class="empty">No requests yet.</p>'}`;
  }

  function draw() {
    const html = { over: overview, blocks, block: myBlock, inc: incidents, ask }[pane]();
    el.innerHTML = `<div class="bar" role="tablist" style="margin-bottom:10px">${panes.map(([k, l]) => `<button class="btn ${pane === k ? 'gold' : 'ghost'} sm" role="tab" aria-selected="${pane === k}" data-p="${k}">${l}</button>`).join('')}</div>${html}`;
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { pane = b.dataset.p; draw(); });
    el.querySelectorAll('[data-bl]').forEach(s => s.onchange = async () => { try { await db(sb.rpc('v2_marshal_block_set', { p_letter: s.dataset.bl, p_user: s.value || null })); toast('Saved'); await load(); } catch (e) { toast(e.message, true); await load(); } });
    el.querySelector('#ni')?.addEventListener('click', incidentForm);
    el.querySelector('#na')?.addEventListener('click', askForm);
    el.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => review(b.dataset.i, b.dataset.ir));
  }

  function incidentForm() {
    const secs = ((X.blocks[0] && !gm ? X.blocks[0].sections : X.blocks.flatMap(b => b.sections || [])) || []);
    modal(`<h3>File an incident report</h3><form id="f"><label>Event or duty</label><input name="e" maxlength="120" placeholder="e.g. Foundation Day gate duty" required>
      <label>Date</label><input name="d" type="date" max="${todayISO()}" value="${todayISO()}" required>
      <label>Section (optional)</label><select name="s"><option value="">Not section-specific</option>${secs.map(s => `<option>${esc(s.name)}</option>`).join('')}</select>
      <label>What happened (facts only, no names or shaming)</label><textarea name="m" rows="4" minlength="5" maxlength="1000" required></textarea>
      <label>Action taken (optional)</label><textarea name="a" rows="2" maxlength="500"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">File report</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_incident_file', { p_section: f.get('s'), p_event: f.get('e'), p_on: f.get('d'), p_summary: f.get('m'), p_action: f.get('a') })); toast(gm ? 'Report filed' : 'Report sent to the General Marshal'); close(); load(); }
        catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  function review(id, act) {
    const needNote = act.startsWith('refer'), title = { review: 'Mark as reviewed', refer_president: 'Refer to the President', refer_adviser: 'Refer to the adviser', close: 'Close the report' }[act];
    modal(`<h3>${title}</h3><form id="f"><label>${needNote ? 'Note (required)' : 'Note (optional)'}</label><textarea name="n" rows="3" maxlength="500"${needNote ? ' required' : ''}></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault();
        try { await db(sb.rpc('v2_incident_review', { p_id: id, p_action: act, p_note: new FormData(e.target).get('n') })); toast('Saved'); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  function askForm() {
    const opts = ((X.blocks[0] && X.blocks[0].sections) || []).filter(s => s.has_mayor);
    modal(`<h3>Ask a class for help</h3><form id="f"><label>Section</label><select name="u" required>${opts.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <label>What do you need?</label><input name="t" required minlength="3" maxlength="140" placeholder="e.g. 2 Marshals for the gate on Friday">
      <label>Details (optional)</label><textarea name="d" rows="3" maxlength="600"></textarea><label>Needed on (optional)</label><input name="o" type="date" min="${todayISO()}">
      <p class="muted" style="font-size:.85em;margin:8px 0 0">The Class Mayor decides. If accepted, the Mayor’s directive reaches the class Marshals.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send to the Mayor</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_marshal_ask', { p_unit: f.get('u'), p_title: f.get('t'), p_details: f.get('d'), p_on: f.get('o') || null })); toast('Request sent to the Class Mayor'); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }

  await load();
  return watch(['v2_marshal_incidents', 'v2_marshal_requests', 'v2_marshal_blocks', 'v2_directives'], () => load().catch(() => {}));
}
