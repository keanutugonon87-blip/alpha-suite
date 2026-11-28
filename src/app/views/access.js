import { sb, db, watch, esc, fmtDateTime, toast, modal } from '../core.js';

/* Student access: a student reads the rules, scans the QR card the officers gave them, and waits here.
   The SAILS VP Internal approves first, then the SAILS President. The President can also approve directly, decline, or revoke.
   The Secretary can read the queue. Needs the v80 SQL. */
const ST = { pending: ['Waiting for the VP Internal', 'warn'], vpi_ok: ['Waiting for the President', 'warn'], approved: ['Approved', 'ok'], denied: ['Declined', 'bad'] };
const missing = e => /relation|schema cache|does not exist|function/i.test(e?.message || '');

export async function mountAccess(el, ctx) {
  const me = ctx.profile.role, isPres = ctx.profile.real === 'sails_president';
  let rows = [], only = 'todo';
  const mine = r => !r.grandfathered && (isPres ? ['pending', 'vpi_ok'].includes(r.status) : me === 'vp_internal' && r.status === 'pending');
  async function load() {
    try { rows = await db(sb.rpc('v2_access_list')); }
    catch (e) { el.innerHTML = `<div class="card pad"><p class="empty">${esc(missing(e) ? 'Run the v80 SQL in Supabase first (supabase/v80_student_access.sql).' : e.message)}</p></div>`; return; }
    draw();
  }
  const step = (label, name, at, wait) => `<span class="tag ${at ? 'ok' : ''}">${label}: ${at ? `${esc(name)} · ${fmtDateTime(at)}` : wait}</span>`;
  function card(r) {
    const can = isPres || me === 'vp_internal';
    const btns = !can || r.grandfathered ? '' : mine(r) ? `<button class="btn gold sm" data-a="ok" data-id="${r.member_id}">${isPres && r.status === 'pending' ? 'Approve directly' : 'Approve'}</button> <button class="btn ghost sm" data-a="no" data-id="${r.member_id}">Decline</button>`
      : isPres && r.status === 'approved' ? `<button class="btn ghost sm" data-a="no" data-id="${r.member_id}">Revoke access</button>` : '';
    return `<div class="card pad" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="m"><b>${esc(r.name)}</b><small>${esc(r.student_no)}${r.section ? ' · ' + esc(r.section) : ''}${r.grandfathered ? '' : ' · asked ' + fmtDateTime(r.requested_at)}</small></div><span class="tag ${ST[r.status][1]}">${r.grandfathered ? 'Active before approvals' : ST[r.status][0]}</span></div>
      ${r.grandfathered ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><span class="tag ok">Card scanned${r.rules_at ? ' · rules read ' + fmtDateTime(r.rules_at) : ''}</span>${step('VP Internal', r.vpi_name, r.vpi_at, 'not yet')}${r.pres_direct ? `<span class="tag ok">President: ${esc(r.pres_name)} · ${fmtDateTime(r.pres_at)} (directly)</span>` : step('President', r.pres_name, r.pres_at, 'not yet')}</div>`}
      ${r.status === 'denied' ? `<p style="margin:8px 0 0"><b>Declined by ${esc(r.denied_by_name || '')}:</b> ${esc(r.deny_note || '')}</p>` : ''}
      ${btns ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${btns}</div>` : ''}</div>`;
  }
  function draw() {
    const todo = rows.filter(mine), n = todo.length, list = only === 'todo' ? todo : rows, can = isPres || me === 'vp_internal';
    el.innerHTML = `<p class="muted" style="margin:0 2px 8px">A student reads the rules, scans the QR card the officers gave them, and waits here. The VP Internal approves first, then the President. Only then can the student set a PIN and sign in.${can ? '' : ' You can read the queue.'}</p>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">${can ? `<button class="btn ${only === 'todo' ? 'gold' : 'ghost'} sm" data-f="todo">Needs me${n ? ` (${n})` : ''}</button>` : ''}<button class="btn ${only === 'all' || !can ? 'gold' : 'ghost'} sm" data-f="all">All (${rows.length})</button>${can && n > 1 ? `<button class="btn ghost sm" id="ac-all">Approve all ${n}</button>` : ''}</div>
      ${(can ? list : rows).length ? (can ? list : rows).map(card).join('') : `<div class="card pad"><p class="empty">${only === 'todo' && can ? 'Nothing waiting for you.' : 'No requests yet.'}</p></div>`}`;
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { only = b.dataset.f; draw(); });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a, rows.find(r => r.member_id === b.dataset.id)));
    el.querySelector('#ac-all')?.addEventListener('click', approveAll);
  }
  async function decide(id, ok, note) { await db(sb.rpc('v2_access_decide', { p_member: id, p_ok: ok, p_note: note || null })); }
  async function approveAll() {
    const todo = rows.filter(mine); if (!todo.length) return;
    modal(`<h3>Approve ${todo.length} students?</h3><p>${todo.map(r => esc(r.name)).join(', ')}</p><p class="muted">Check the names against the list the Class Mayor sent. Each approval is logged under your name.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="aa-go" style="flex:1">Approve all</button><button class="btn ghost" id="aa-x">Cancel</button></div>`, (m, close) => {
      m.querySelector('#aa-x').onclick = close;
      m.querySelector('#aa-go').onclick = async e => { e.target.disabled = true; let ok = 0; try { for (const r of todo) { await decide(r.member_id, true); ok++; } } catch (x) { toast(x.message, true); } close(); if (ok) toast(`Approved ${ok}`); await load(); };
    });
  }
  function act(a, r) {
    if (!r) return;
    if (a === 'ok') return decide(r.member_id, true).then(() => { toast('Approved'); return load(); }).catch(e => toast(e.message, true));
    modal(`<h3>${r.status === 'approved' ? 'Revoke access' : 'Decline'}: ${esc(r.name)}</h3><label>Reason (the student will see it)</label><textarea id="ad-n" rows="3" maxlength="300" required></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="ad-go" style="flex:1">${r.status === 'approved' ? 'Revoke' : 'Decline'}</button><button class="btn ghost" id="ad-x">Cancel</button></div>`, (m, close) => {
      m.querySelector('#ad-x').onclick = close;
      m.querySelector('#ad-go').onclick = async e => { e.target.disabled = true; try { await decide(r.member_id, false, m.querySelector('#ad-n').value); close(); toast('Done'); await load(); } catch (x) { toast(x.message, true); e.target.disabled = false; } };
    });
  }
  await load();
  let stop = () => {}; try { stop = watch(['v2_access'], load) || stop; } catch { /* refreshes on the next visit */ }
  return stop;
}

/* Request log: who asked for what, and when. For the Secretary, VP Internal and President. */
const KIND = { fund: 'Fund transparency', record: 'Record request', access: 'System access' };
const TAG = { open: 'warn', review: 'warn', pending: 'warn', vpi_ok: 'warn', granted: 'ok', approved: 'ok', declined: 'bad', denied: 'bad' };
const WORD = { open: 'Open', review: 'With the Auditor', pending: 'Pending', vpi_ok: 'With the President', granted: 'Granted', approved: 'Approved', declined: 'Declined', denied: 'Declined' };

export async function mountReqLog(el) {
  let rows = [], kind = 'all', q = '';
  async function load() {
    try { rows = await db(sb.rpc('v2_request_log')); }
    catch (e) { el.innerHTML = `<div class="card pad"><p class="empty">${esc(missing(e) ? 'Run the v80 SQL in Supabase first (supabase/v80_student_access.sql).' : e.message)}</p></div>`; return; }
    draw();
  }
  function draw() {
    const s = q.trim().toLowerCase(), list = rows.filter(r => (kind === 'all' || r.kind === kind) && (!s || `${r.name} ${r.student_no} ${r.title}`.toLowerCase().includes(s)));
    el.innerHTML = `<p class="muted" style="margin:0 2px 8px">Every request a student made, newest first: which student, what they asked for, when, and who answered.</p>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${[['all', 'All'], ['fund', 'Fund'], ['record', 'Records'], ['access', 'Access']].map(([k, l]) => `<button class="btn ${kind === k ? 'gold' : 'ghost'} sm" data-k="${k}">${l}</button>`).join('')}</div>
      <input id="rl-q" type="search" placeholder="Search a student or request" value="${esc(q)}" style="margin-bottom:10px">
      <div class="card">${list.map(r => `<div class="row"><div class="m"><b>${esc(r.name || '—')}</b><small>${esc(r.student_no || '')} · ${esc(KIND[r.kind])}: ${esc(r.title)}</small><small>${fmtDateTime(r.at)}${r.by_name ? ' · ' + esc(r.by_name) : ''}</small></div><span class="tag ${TAG[r.status] || ''}">${esc(WORD[r.status] || r.status)}</span></div>`).join('') || '<p class="empty">Nothing matches.</p>'}</div>`;
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; draw(); });
    const inp = el.querySelector('#rl-q'); inp.oninput = () => { q = inp.value; const p = inp.selectionStart; draw(); const n = el.querySelector('#rl-q'); n.focus(); n.setSelectionRange(p, p); };
  }
  await load();
  let stop = () => {}; try { stop = watch(['v2_fund_requests', 'v2_record_requests', 'v2_access'], load) || stop; } catch { /* refreshes on the next visit */ }
  return stop;
}
