import { sb, db, watch, esc, toast, modal, skeleton, todayISO, fmtDate, fmtDateTime } from '../core.js';
import { ROLE_LABEL } from '../core.js';

/* Directives: the Mayor assigns a task to an officer; the officer is alerted on the phone and answers inside the app.
   Flow: sent → received → working → done → confirmed. An officer who cannot do it asks to be released; the Mayor decides. */
const STATUS = { sent: ['Sent', 'warn'], received: ['Received', ''], working: ['Working', ''], done: ['Done · to confirm', 'warn'], confirmed: ['Confirmed', 'ok'], revoke_asked: ['Release asked', 'bad'], revoked: ['Closed', ''] };
const PRI = { urgent: ['Urgent', 'bad'], normal: ['Normal', ''], low: ['Low', ''] };
const OPEN = ['sent', 'received', 'working', 'done', 'revoke_asked'];

export async function mountDirectives(el, ctx) {
  const mayor = ctx.can('mayor'), me = ctx.profile.user_id || ctx.user?.id;
  let rows = [], tab = 'open', officers = [];
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
    if (mayor && d.status === 'done') btn.push(['cf', 'Confirm', 'gold'], ['rt', 'Return', 'ghost']);
    if (mayor && d.status === 'revoke_asked') btn.push(['rl', 'Release', 'gold'], ['kp', 'Keep it', 'ghost']);
    if (mayor && ['sent', 'received', 'working', 'done'].includes(d.status)) btn.push(['cn', 'Cancel', 'ghost']);
    return `<div class="row" data-id="${d.id}" style="align-items:flex-start"><div class="m"><b>${esc(d.title)}</b>
      <small>${mayor ? esc(d.assignee_name) + ' · ' + esc(ROLE_LABEL[d.assignee_role] || d.assignee_role) + ' · ' : ''}${d.due_on ? 'due ' + fmtDate(d.due_on) : 'no due date'} · issued ${fmtDateTime(d.issued_at)}</small>
      ${d.details ? `<small style="display:block;white-space:pre-wrap;margin-top:4px">${esc(d.details)}</small>` : ''}
      ${d.link_note ? `<small style="display:block">🔗 ${esc(d.link_note)}</small>` : ''}
      <small style="display:block;margin-top:4px">${d.received_at ? '👁 received ' + fmtDateTime(d.received_at) : '⏳ not opened yet'}${d.done_note ? ` · ✅ ${esc(d.done_note)}` : ''}</small>
      ${d.return_note ? `<small style="display:block;color:var(--bad)">↩ Returned: ${esc(d.return_note)}</small>` : ''}
      ${d.revoke_reason ? `<small style="display:block;color:var(--bad)">Release asked: ${esc(d.revoke_reason)}</small>` : ''}
      ${d.revoke_answer ? `<small style="display:block">Mayor: ${esc(d.revoke_answer)}</small>` : ''}
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
    el.innerHTML = `${board}<div class="bar"><button class="btn ${tab === 'open' ? 'gold' : 'ghost'} sm" data-t="open">Open (${open.length})</button><button class="btn ${tab === 'closed' ? 'gold' : 'ghost'} sm" data-t="closed">Closed</button><span class="grow"></span>${mayor ? '<button class="btn gold" id="new">+ New directive</button>' : ''}</div>
      <div class="card">${shown.map(card).join('') || `<p class="empty">${mayor ? 'No directives here. Tap “+ New directive” to assign a task to an officer.' : 'Nothing has been assigned to you.'}</p>`}</div>`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    el.querySelector('#new')?.addEventListener('click', form);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id, a = b.dataset.a, fail = e => toast(e.message, true);
      if (a === 'rc') act(id, 'receive').catch(fail);
      else if (a === 'wk') act(id, 'work').catch(fail);
      else if (a === 'dn') note('Mark as done', 'What was done? (short note or proof)', n => act(id, 'done', n), 'Send to the Mayor');
      else if (a === 'rv') note('Ask to be released', 'Why can’t you do this? (e.g. away, sick, conflict)', n => act(id, 'revoke', n), 'Ask the Mayor');
      else if (a === 'cf') decide(id, 'confirm').then(() => toast('Confirmed')).catch(fail);
      else if (a === 'rt') note('Return for fixing', 'What needs to be fixed?', n => decide(id, 'return', n), 'Return');
      else if (a === 'rl') decide(id, 'release').then(() => toast('Released')).catch(fail);
      else if (a === 'kp') note('Keep the directive', 'Reason for keeping it with this officer', n => decide(id, 'keep', n), 'Keep it');
      else if (a === 'cn') note('Cancel this directive', 'Reason (optional note shown to the officer)', n => decide(id, 'cancel', n), 'Cancel directive');
    });
  }

  function form() {
    modal(`<h3>New directive</h3><form id="df"><label>Assign to</label><select name="a" required><option value="">Choose an officer…</option>${officers.map(o => `<option value="${o.user_id}">${esc(o.full_name)} — ${esc(ROLE_LABEL[o.role] || o.role)}</option>`).join('')}</select>
      <label>Task</label><input name="t" required minlength="3" maxlength="140" placeholder="e.g. Prepare the attendance sheet for Friday">
      <label>Details (optional)</label><textarea name="d" rows="3"></textarea>
      <label>Due date (optional)</label><input name="u" type="date" min="${todayISO()}">
      <label>Priority</label><select name="p"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="low">Low</option></select>
      <label>Related to (optional)</label><input name="l" placeholder="Event, budget request or document">
      <p class="muted" style="font-size:.85em;margin:8px 0 0">The officer gets a phone alert right away if their device is linked, and sees it first thing in the app.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send directive</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#df').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_directive_issue', { p_assignee: f.get('a'), p_title: f.get('t'), p_details: f.get('d'), p_due: f.get('u') || null, p_priority: f.get('p'), p_link: f.get('l') })); toast('Directive sent'); close(); load(); }
        catch (x) { m.querySelector('#er').textContent = /v2_directive_issue/.test(x.message) ? 'Run the v36 SQL first (System › Setup).' : x.message; } };
    });
  }

  async function load() {
    try { rows = await db(sb.from('v2_directives').select('*').order('issued_at', { ascending: false })); }
    catch (e) { el.innerHTML = `<div class="card"><p class="empty">Directives are not set up yet. Run the v36 SQL in Supabase.</p></div>`; return; }
    if (mayor && !officers.length) officers = (await sb.from('v2_profiles').select('user_id,full_name,role').in('role', ['vice_mayor', 'vp_internal', 'vp_external', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio']).order('full_name').then(r => r.data || [], () => []));
    paint();
  }
  await load();
  return watch(['v2_directives'], () => load().catch(() => {}));
}
