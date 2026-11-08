import { sb, db, watch, esc, toast, modal, skeleton, todayISO, fmtDate, fmtDateTime } from '../core.js';
import { ROLE_LABEL } from '../core.js';

/* Directives: the chain of command. The President directs every officer; SAILS VP Internal directs the SAILS Secretary, Marshals and PIOs; SAILS VP External directs the PIOs.
   Whoever issues a directive confirms, returns or cancels it. One directive can go to several officers at once. The officer is alerted on the phone; the officer is alerted on the phone and answers inside the app.
   Flow: sent → received → working → done → confirmed. An officer who cannot do it asks to be released; the Mayor decides. */
const STATUS = { sent: ['Sent', 'warn'], received: ['Received', ''], working: ['Working', ''], done: ['Done · to confirm', 'warn'], confirmed: ['Confirmed', 'ok'], revoke_asked: ['Release asked', 'bad'], revoked: ['Closed', ''] };
const PRI = { urgent: ['Urgent', 'bad'], normal: ['Normal', ''], low: ['Low', ''] };
const CLASS_OFFICERS = ['secretary', 'treasurer', 'auditor', 'marshall', 'pio'];
const chainFor = ctx => ({
  mayor: ctx.mode === 'pres' ? ['vp_internal', 'vp_external', 'general_marshal'] : [],   // a Class Mayor only receives directives; the class officers have no system access
  vp_internal: ['mayor'], vp_external: ['mayor'], general_marshal: ['dept_marshal'] });
const OPEN = ['sent', 'received', 'working', 'done', 'revoke_asked'];

export async function mountDirectives(el, ctx) {
  const CHAIN = chainFor(ctx), role = ctx.profile.role, issuer = !!(CHAIN[role] && CHAIN[role].length), me = ctx.profile.user_id || ctx.user?.id;
  const mayor = issuer;   // issuers see the board and the officer names
  const canDecide = d => d.issued_by === me || (ctx.mode !== 'class' && ctx.can('mayor'));
  let rows = [], tab = 'open', officers = [], mreq = [], memos = [], acked = new Set(), qs = [];
  el.innerHTML = skeleton(4);

  const overdue = d => d.due_on && OPEN.includes(d.status) && !['done', 'revoke_asked'].includes(d.status) && d.due_on < todayISO();
  const note = (title, label, cb, ok = 'Send') => modal(`<h3>${esc(title)}</h3><form id="nf"><label>${esc(label)}</label><textarea name="n" rows="4" required></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">${ok}</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelector('#nf').onsubmit = async e => { e.preventDefault(); try { await cb(new FormData(e.target).get('n')); close(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
  });
  const act = (id, a, n = null) => db(sb.rpc('v2_directive_act', { p_id: id, p_action: a, p_note: n })).then(() => load());
  const decide = (id, a, n = null) => db(sb.rpc('v2_directive_decide', { p_id: id, p_action: a, p_note: n })).then(() => load());

  function card(d) {
    const [sl, sc] = STATUS[d.status], [pl, pc] = PRI[d.priority];
    const mine = d.assignee_id === me, od = overdue(d);
    const btn = [];
    if (mine && d.status === 'sent') btn.push(['rc', 'Received', 'gold']);
    if (mine && ['sent', 'received'].includes(d.status)) btn.push(['wk', 'Start working', '']);
    if (mine && ['sent', 'received', 'working'].includes(d.status)) btn.push(['dn', 'Mark done', 'gold'], ['rv', 'Can’t do this', 'ghost']);
    if (canDecide(d) && d.status === 'done') btn.push(['cf', 'Confirm', 'gold'], ['rt', 'Return', 'ghost']);
    if (canDecide(d) && d.status === 'revoke_asked') btn.push(['rl', 'Release', 'gold'], ['kp', 'Keep it', 'ghost']);
    if (canDecide(d) && ['sent', 'received', 'working', 'done'].includes(d.status)) btn.push(['cn', 'Cancel', 'ghost']);
    return `<div class="row" data-id="${d.id}" style="align-items:flex-start"><div class="m"><b>${esc(d.title)}</b>
      <small>${mine ? (d.issued_by_name ? 'from ' + esc(d.issued_by_name) + ' · ' : '') : esc(d.assignee_name) + ' · ' + esc(ROLE_LABEL[d.assignee_role] || d.assignee_role) + ' · '}${d.due_on ? 'due ' + fmtDate(d.due_on) : 'no due date'} · issued ${fmtDateTime(d.issued_at)}</small>
      ${d.details ? `<small style="display:block;white-space:pre-wrap;margin-top:4px">${esc(d.details)}</small>` : ''}
      ${d.link_note ? `<small style="display:block">🔗 ${esc(d.link_note)}</small>` : ''}
      <small style="display:block;margin-top:4px">${d.received_at ? '👁 received ' + fmtDateTime(d.received_at) : '⏳ not opened yet'}${d.done_note ? ` · ✅ ${esc(d.done_note)}` : ''}</small>
      ${d.return_note ? `<small style="display:block;color:var(--bad)">↩ Returned: ${esc(d.return_note)}</small>` : ''}
      ${d.revoke_reason ? `<small style="display:block;color:var(--bad)">Release asked: ${esc(d.revoke_reason)}</small>` : ''}
      ${d.revoke_answer ? `<small style="display:block">${esc(d.issued_by_name || 'Issuer')}: ${esc(d.revoke_answer)}</small>` : ''}
      ${btn.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${btn.map(([k, l, c]) => `<button class="btn sm ${c}" data-a="${k}">${l}</button>`).join('')}</div>` : ''}</div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${od ? '<span class="tag bad">overdue</span>' : ''}<span class="tag ${sc}">${sl}</span>${d.priority !== 'normal' ? `<span class="tag ${pc}">${pl}</span>` : ''}</div></div>`;
  }

  function paint() {
    const open = rows.filter(d => OPEN.includes(d.status)), shown = tab === 'open' ? open : rows.filter(d => !OPEN.includes(d.status));
    const c = f => rows.filter(f).length;
    let board = '';
    if (mayor) {
      const by = new Map(); open.forEach(d => { const o = by.get(d.assignee_name) || { n: 0, od: 0, unseen: 0 }; o.n++; if (overdue(d)) o.od++; if (d.status === 'sent') o.unseen++; by.set(d.assignee_name, o); });
      board = `<div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>Open</small><b>${open.length}</b></div><div class="stat"><small>To confirm</small><b>${c(d => d.status === 'done')}</b></div><div class="stat"><small>Release asked</small><b>${c(d => d.status === 'revoke_asked')}</b></div><div class="stat"><small>Overdue</small><b>${c(overdue)}</b></div></div>
        ${by.size ? `<div class="card" style="margin-bottom:12px">${[...by].map(([n, o]) => `<div class="row"><div class="m"><b>${esc(n)}</b></div><div style="display:flex;gap:4px"><span class="tag">${o.n} open</span>${o.unseen ? `<span class="tag warn">${o.unseen} unopened</span>` : ''}${o.od ? `<span class="tag bad">${o.od} overdue</span>` : ''}</div></div>`).join('')}</div>` : ''}`;
    }
    const reqBox = mreq.length ? `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--gold,#c9a227)"><h3 style="margin:0 0 6px">Requests from the Department</h3><p class="muted" style="margin:0 0 8px">A SAILS Marshal asks your class for help. Accept sends a directive to your class Marshals. Decline needs a short reason.</p>${mreq.map(r => `<div class="row" style="display:block" data-mr="${r.id}"><b>${esc(r.title)}</b><small class="muted" style="display:block">From ${esc(r.from_name || 'SAILS Marshal')}${r.needed_on ? ' · needed ' + fmtDate(r.needed_on + 'T00:00:00+08:00') : ''}</small>${r.details ? `<p style="margin:4px 0">${esc(r.details)}</p>` : ''}<div class="acts"><button class="btn gold sm" data-ma="1">Accept</button><button class="btn ghost sm" data-ma="0">Decline</button></div></div>`).join('')}</div>` : '';
    const pend = memos.filter(m => !acked.has(m.id));
    const memoBox = pend.length ? `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--gold,#c9a227)"><h3 style="margin:0 0 6px">Memo${pend.length === 1 ? '' : 's'} from the SAILS President</h3>${pend.map(m => `<div class="row" style="display:block"><b>${m.urgent ? '🔴 ' : ''}${esc(m.title)}</b><small class="muted" style="display:block">${fmtDateTime(m.created_at)}</small>${m.body ? `<p style="margin:6px 0;white-space:pre-wrap">${esc(m.body)}</p>` : ''}<div class="acts"><button class="btn gold sm" data-ak="${m.id}">Acknowledge</button></div></div>`).join('')}</div>` : '';
    const qBox = qs.length ? `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--gold,#c9a227)"><h3 style="margin:0 0 6px">A question from the President</h3>${qs.map(q => `<div class="row" style="display:block"><b>${esc(q.item_title || 'Your item')}</b><p style="margin:4px 0">${esc(q.question)}</p><div class="acts"><button class="btn gold sm" data-qa="${q.id}">Answer</button></div></div>`).join('')}</div>` : '';
    el.innerHTML = `${memoBox}${qBox}${reqBox}${board}<div class="bar"><button class="btn ${tab === 'open' ? 'gold' : 'ghost'} sm" data-t="open">Open (${open.length})</button><button class="btn ${tab === 'closed' ? 'gold' : 'ghost'} sm" data-t="closed">Closed</button><span class="grow"></span>${issuer ? '<button class="btn ghost" id="tpl">Templates</button><button class="btn gold" id="new">+ New directive</button>' : ''}</div>
      <div class="card">${shown.map(card).join('') || `<p class="empty">${issuer ? 'No directives here. Tap “+ New directive” to assign a task to an officer.' : 'Nothing has been assigned to you.'}</p>`}</div>`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    el.querySelector('#new')?.addEventListener('click', form);
    el.querySelector('#tpl')?.addEventListener('click', templates);
    el.querySelectorAll('[data-ak]').forEach(b => b.onclick = async () => { try { await db(sb.rpc('v2_memo_ack', { p_id: b.dataset.ak })); toast('Acknowledged'); await load(); } catch (e) { toast(e.message, true); } });
    el.querySelectorAll('[data-qa]').forEach(b => b.onclick = () => note('Answer the question', 'Your answer', n => db(sb.rpc('v2_question_answer', { p_id: b.dataset.qa, p_answer: n })).then(() => { toast('Answer sent'); return load(); }), 'Send answer'));
    el.querySelectorAll('[data-ma]').forEach(b => b.onclick = () => {
      const id = b.closest('[data-mr]').dataset.mr, yes = b.dataset.ma === '1', fail = e => toast(e.message, true);
      const go = n => db(sb.rpc('v2_marshal_answer', { p_id: id, p_accept: yes, p_note: n || null })).then(n2 => { toast(yes ? 'Accepted. Your class Marshals were notified.' : 'Declined'); return load(); });
      if (yes) go('').catch(fail); else note('Decline the request', 'Reason (required)', n => { if (!n || n.trim().length < 3) throw new Error('Please give a short reason'); return go(n); }, 'Decline');
    });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id, a = b.dataset.a, fail = e => toast(e.message, true);
      if (a === 'rc') act(id, 'receive').catch(fail);
      else if (a === 'wk') act(id, 'work').catch(fail);
      else if (a === 'dn') note('Mark as done', 'What was done? (short note or proof)', n => act(id, 'done', n), 'Send for confirmation');
      else if (a === 'rv') note('Ask to be released', 'Why can’t you do this? (e.g. away, sick, conflict)', n => act(id, 'revoke', n), 'Ask to be released');
      else if (a === 'cf') decide(id, 'confirm').then(() => toast('Confirmed')).catch(fail);
      else if (a === 'rt') note('Return for fixing', 'What needs to be fixed?', n => decide(id, 'return', n), 'Return');
      else if (a === 'rl') decide(id, 'release').then(() => toast('Released')).catch(fail);
      else if (a === 'kp') note('Keep the directive', 'Reason for keeping it with this officer', n => decide(id, 'keep', n), 'Keep it');
      else if (a === 'cn') note('Cancel this directive', 'Reason (optional note shown to the officer)', n => decide(id, 'cancel', n), 'Cancel directive');
    });
  }

  function form() {
    const roles = [...new Set(officers.map(o => o.role))], units = [...new Set(officers.map(o => o.unit).filter(Boolean))];
    modal(`<h3>New directive</h3><form id="df"><label>Assign to (choose one or several)</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${officers.length > 1 ? '<button type="button" class="btn ghost sm" data-q="all">Everyone</button>' : ''}${roles.length > 1 ? roles.map(r => `<button type="button" class="btn ghost sm" data-q="r:${esc(r)}">Every ${esc(ROLE_LABEL[r] || r)}</button>`).join('') : ''}${units.length > 1 ? units.map(u => `<button type="button" class="btn ghost sm" data-q="u:${esc(u)}">${esc(u)}</button>`).join('') : ''}${officers.length > 1 ? '<button type="button" class="btn ghost sm" data-q="none">Clear</button>' : ''}</div>
      <div class="card" style="max-height:210px;overflow:auto;padding:2px 10px;margin-bottom:4px">${officers.map(o => `<label class="ck"><input type="checkbox" name="a" value="${o.user_id}" data-r="${esc(o.role)}" data-u="${esc(o.unit || '')}"><span>${esc(o.full_name)} — ${esc(ROLE_LABEL[o.role] || o.role)}${o.unit ? ' · ' + esc(o.unit) : ''}</span></label>`).join('') || '<p class="empty">No officers to assign to yet.</p>'}</div><small class="muted" id="cnt">0 chosen</small>
      <label>Task</label><input name="t" required minlength="3" maxlength="140" placeholder="e.g. Prepare the attendance sheet for Friday">
      <label>Details (optional)</label><textarea name="d" rows="3"></textarea>
      <label>Due date (optional)</label><input name="u" type="date" min="${todayISO()}">
      <label>Priority</label><select name="p"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="low">Low</option></select>
      <label>Related to (optional)</label><input name="l" placeholder="Event, budget request or document">
      <p class="muted" style="font-size:.85em;margin:8px 0 0">${role === 'mayor' ? (ctx.mode === 'pres' ? 'You direct the Vice Presidents and the SAILS General Marshal.' : ctx.mode === 'class' ? 'You delegate to your class officers. They report to you.' : 'You direct every officer.') : role === 'vp_internal' ? 'You direct the SAILS Secretary, Marshals and PIOs.' : role === 'general_marshal' ? 'You direct the SAILS Marshals.' : 'You direct the PIOs.'} Each officer gets their own copy, a phone alert right away if their device is linked, and answers it themselves.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send directive</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const boxes = [...m.querySelectorAll('input[name=a]')], count = () => { m.querySelector('#cnt').textContent = boxes.filter(b => b.checked).length + ' chosen'; };
      boxes.forEach(b => b.onchange = count);
      m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const q = b.dataset.q; boxes.forEach(x => { x.checked = q === 'all' ? true : q === 'none' ? false : q.startsWith('r:') ? (x.dataset.r === q.slice(2) ? true : x.checked) : (x.dataset.u === q.slice(2) ? true : x.checked); }); count(); });
      m.querySelector('#df').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), ids = boxes.filter(b => b.checked).map(b => b.value);
        if (!ids.length) { m.querySelector('#er').textContent = 'Choose at least one officer.'; return; }
        const args = { p_title: f.get('t'), p_details: f.get('d'), p_due: f.get('u') || null, p_priority: f.get('p'), p_link: f.get('l') };
        try { if (ids.length === 1) await db(sb.rpc('v2_directive_issue', { p_assignee: ids[0], ...args })); else await db(sb.rpc('v2_directive_issue_many', { p_assignees: ids, ...args })); toast(ids.length === 1 ? 'Directive sent' : `Directive sent to ${ids.length} officers`); close(); load(); }
        catch (x) { m.querySelector('#er').textContent = /v2_directive_issue/.test(x.message) && /could not find|schema cache/.test(x.message) ? 'Run the v36 and v44 SQL first (System › Setup).' : x.message; } };
    });
  }

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  async function templates() {
    const list = await sb.from('v2_directive_templates').select('*').order('created_at').then(r => (r.error ? null : r.data || []), () => null);
    if (list === null) return toast('Run the v50 SQL in Supabase first', true);
    const when = t => t.kind === 'weekly' ? 'Every ' + DAYS[t.weekday - 1] : t.kind === 'monthly' ? 'Monthly on day ' + t.month_day : 'Send when I tap';
    modal(`<h3>Templates and recurring tasks</h3><p class="muted" style="margin:0 0 8px">A task you give often. Send it with one tap, or set it to go out by itself.</p>
      <div class="card">${list.map(t => `<div class="row" style="display:block"><b>${esc(t.title)}</b><small class="muted" style="display:block">To every ${esc(ROLE_LABEL[t.to_role] || t.to_role)} · ${when(t)} · due in ${t.due_in} day${t.due_in === 1 ? '' : 's'}${t.active ? '' : ' · paused'}</small><div class="acts" style="margin-top:6px"><button class="btn gold sm" data-ts="${t.id}">Send now</button><button class="btn ghost sm" data-te="${t.id}">Edit</button><button class="btn ghost sm" data-td="${t.id}">Delete</button></div></div>`).join('') || '<p class="empty">No templates yet.</p>'}</div>
      <div class="acts" style="margin-top:10px"><button class="btn gold" id="tn">+ New template</button><button class="btn ghost" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#tn').onclick = () => { close(); tform(null); };
      m.querySelectorAll('[data-ts]').forEach(b => b.onclick = async () => { try { const n = await db(sb.rpc('v2_template_send_now', { p_id: b.dataset.ts })); toast(`Sent to ${n} officer${n === 1 ? '' : 's'}`); close(); load(); } catch (e) { m.querySelector('#er').textContent = e.message; } });
      m.querySelectorAll('[data-te]').forEach(b => b.onclick = () => { close(); tform(list.find(t => t.id === b.dataset.te)); });
      m.querySelectorAll('[data-td]').forEach(b => b.onclick = async () => { try { await db(sb.rpc('v2_template_delete', { p_id: b.dataset.td })); toast('Deleted'); close(); templates(); } catch (e) { m.querySelector('#er').textContent = e.message; } });
    });
  }
  function tform(t) {
    const roles = CHAIN[role] || [];
    modal(`<h3>${t ? 'Edit template' : 'New template'}</h3><form id="f"><label>Task</label><input name="t" required minlength="3" maxlength="140" value="${esc(t?.title || '')}" placeholder="e.g. Send your weekly attendance summary">
      <label>Details (optional)</label><textarea name="d" rows="3" maxlength="800">${esc(t?.details || '')}</textarea>
      <label>To every</label><select name="r">${roles.map(r => `<option value="${r}"${t?.to_role === r ? ' selected' : ''}>${esc(ROLE_LABEL[r] || r)}</option>`).join('')}</select>
      <label>When</label><select name="k"><option value="manual"${t?.kind === 'manual' ? ' selected' : ''}>Only when I tap Send now</option><option value="weekly"${t?.kind === 'weekly' ? ' selected' : ''}>Every week</option><option value="monthly"${t?.kind === 'monthly' ? ' selected' : ''}>Every month</option></select>
      <label>Weekday (weekly)</label><select name="w">${DAYS.map((d, i) => `<option value="${i + 1}"${(t?.weekday || 5) === i + 1 ? ' selected' : ''}>${d}</option>`).join('')}</select>
      <label>Day of the month, 1 to 28 (monthly)</label><input name="m" type="number" min="1" max="28" value="${t?.month_day || 1}">
      <label>Due after how many days</label><input name="u" type="number" min="0" max="30" value="${t?.due_in ?? 3}">
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" name="a" style="width:auto"${t?.active === false ? '' : ' checked'}> Active</label>
      <p class="muted" style="font-size:.85rem;margin:8px 0 0">Recurring ones go out at 7:00 in the morning.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_template_save', { p_id: t?.id || null, p_title: f.get('t'), p_details: f.get('d'), p_to_role: f.get('r'), p_kind: f.get('k'), p_weekday: +f.get('w'), p_month_day: +f.get('m'), p_due_in: +f.get('u'), p_active: !!f.get('a') })); toast('Saved'); close(); templates(); }
        catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  async function load() {
    try { rows = await db(sb.from('v2_directives').select('*').order('issued_at', { ascending: false })); }
    catch (e) { el.innerHTML = `<div class="card"><p class="empty">Directives are not set up yet. Run the v36 SQL in Supabase.</p></div>`; return; }
    if (issuer && !officers.length) {
      officers = (await sb.from('v2_profiles').select('user_id,full_name,role').in('role', CHAIN[role]).neq('user_id', me).order('full_name').then(r => r.data || [], () => []));
      const sec = await sb.from('v2_seat_holders').select('user_id,v2_units(name,kind)').in('status', ['active', 'acting']).then(r => r.data || [], () => []);   // empty until v37 is run
      const unitOf = new Map(sec.filter(x => x.v2_units && x.v2_units.kind === 'section').map(x => [x.user_id, x.v2_units.name]));
      officers.forEach(o => { o.unit = unitOf.get(o.user_id) || ''; });
    }
    [memos, acked, qs] = await Promise.all([
      sb.from('v2_memos').select('*').order('created_at', { ascending: false }).limit(20).then(r => (r.error || ctx.mode === 'pres' ? [] : r.data || []), () => []),
      sb.from('v2_memo_acks').select('memo_id').eq('user_id', me).then(r => new Set((r.data || []).map(a => a.memo_id)), () => new Set()),
      sb.from('v2_approval_questions').select('*').eq('to_user', me).is('answer', null).order('created_at').then(r => r.data || [], () => []),
    ]);
    if (role === 'mayor' && ctx.mode !== 'pres') mreq = await sb.from('v2_marshal_requests').select('*').eq('to_mayor_id', me).eq('status', 'open').order('created_at').then(r => r.data || [], () => []);
    paint();
  }
  await load();
  return watch(['v2_directives'], () => load().catch(() => {}));
}
