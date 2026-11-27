import { sb, db, watch, esc, fmtDateTime, toast, modal } from '../core.js';

/* Fund transparency requests.
   A student asks to see where the money went.
   1. The SAILS Treasurer writes the answer. 2. The SAILS Auditor verifies it; only then does the student see it.
   3. The SAILS Secretary and VP Internal sign as witnesses once it is released. Their names show on the answer.
   The President can read everything. Needs the v77 SQL. */
const ST = { open: ['Waiting for the Treasurer', 'warn'], review: ['Waiting for the Auditor', 'warn'], granted: ['Released: granted', 'ok'], declined: ['Released: declined', 'bad'] };

export async function mountFundReq(el, ctx) {
  const me = ctx.profile.role, isPres = ctx.profile.real === 'sails_president';
  let rows = [], only = 'todo';
  const mine = r => (me === 'treasurer' && r.status === 'open') || (me === 'auditor' && r.status === 'review')
    || (['granted', 'declined'].includes(r.status) && ((me === 'secretary' && !r.sec_witness_at) || (me === 'vp_internal' && !r.vpi_witness_at)));

  async function load() {
    try { rows = await db(sb.from('v2_fund_requests').select('*').order('created_at', { ascending: false })); }
    catch (e) { el.innerHTML = `<div class="card pad"><p class="empty">${esc(/relation|schema cache|does not exist/i.test(e.message || '') ? 'Run the v77 SQL in Supabase first (supabase/v77_fund_transparency.sql).' : e.message)}</p></div>`; return; }
    draw();
  }
  const wit = (label, name, at) => `<span class="tag ${at ? 'ok' : ''}">${label}: ${at ? `${esc(name)} · ${fmtDateTime(at)}` : 'not yet'}</span>`;
  function card(r) {
    const act = mine(r);
    const btn = me === 'treasurer' && r.status === 'open' ? `<button class="btn gold sm" data-a="ans" data-id="${r.id}">Write the answer</button>`
      : me === 'auditor' && r.status === 'review' ? `<button class="btn gold sm" data-a="ver" data-id="${r.id}">Verify</button>`
      : act ? `<button class="btn gold sm" data-a="wit" data-id="${r.id}">Sign as witness</button>` : '';
    return `<div class="card pad" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="m"><b>${esc(r.title)}</b><small>${esc(r.requester_name)} · ${fmtDateTime(r.created_at)}</small></div><span class="tag ${ST[r.status][1]}">${ST[r.status][0]}</span></div>
      ${r.note ? `<p class="muted" style="margin:6px 0 0">${esc(r.note)}</p>` : ''}
      ${r.audit_note && r.status === 'open' ? `<p style="margin:8px 0 0"><b>Auditor sent it back:</b> ${esc(r.audit_note)}</p>` : ''}
      ${r.answer_note ? `<p style="margin:8px 0 0;white-space:pre-wrap"><b>${r.status === 'review' ? 'Treasurer’s answer (not yet released)' : 'Answer'}:</b> ${esc(r.answer_note)}</p><small class="muted">${r.proposed_ok ? 'Grant' : 'Decline'} · ${esc(r.answered_by_name || '')}${r.audited_by_name && r.status !== 'open' ? ` · verified by ${esc(r.audited_by_name)}` : ''}</small>` : ''}
      ${['granted', 'declined'].includes(r.status) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${wit('Secretary', r.sec_witness_name, r.sec_witness_at)}${wit('VP Internal', r.vpi_witness_name, r.vpi_witness_at)}</div>` : ''}
      ${btn ? `<div style="margin-top:10px">${btn}</div>` : ''}</div>`;
  }
  function draw() {
    const list = only === 'todo' ? rows.filter(mine) : rows;
    const n = rows.filter(mine).length;
    el.innerHTML = `<p class="muted" style="margin:0 2px 8px">Students ask to see where the money went. The Treasurer answers, the Auditor verifies, and only then does the student see it. The Secretary and VP Internal sign as witnesses after.${isPres ? ' You can read everything here.' : ''}</p>
      <div style="display:flex;gap:6px;margin-bottom:10px">${!isPres ? `<button class="btn ${only === 'todo' ? 'gold' : 'ghost'} sm" data-f="todo">Needs me${n ? ` (${n})` : ''}</button>` : ''}<button class="btn ${only === 'all' || isPres ? 'gold' : 'ghost'} sm" data-f="all">All (${rows.length})</button></div>
      ${(isPres ? rows : list).length ? (isPres ? rows : list).map(card).join('') : `<div class="card pad"><p class="empty">${only === 'todo' ? 'Nothing waiting for you.' : 'No requests yet.'}</p></div>`}`;
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { only = b.dataset.f; draw(); });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a, rows.find(r => r.id === b.dataset.id)));
  }
  const run = async (fn, args, msg, close) => { try { await db(sb.rpc(fn, args)); close && close(); toast(msg); await load(); } catch (e) { toast(e.message, true); } };
  function act(a, r) {
    if (!r) return;
    if (a === 'wit') return run('v2_fund_witness', { p_id: r.id }, 'Signed as witness');
    if (a === 'ans') return modal(`<h3>Answer: ${esc(r.title)}</h3>${r.audit_note ? `<p><b>Auditor sent it back:</b> ${esc(r.audit_note)}</p>` : ''}
      <label>Decision</label><select id="fa-ok"><option value="1">Grant: show the figures</option><option value="0">Decline: give the reason</option></select>
      <label>Answer for the student (where to see the figures, or the reason)</label><textarea id="fa-n" rows="5" maxlength="1000">${esc(r.answer_note || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="fa-go" style="flex:1">Send to the Auditor</button><button class="btn ghost" id="fa-x">Cancel</button></div>`, (m, close) => {
      m.querySelector('#fa-x').onclick = close;
      m.querySelector('#fa-go').onclick = e => { e.target.disabled = true; run('v2_fund_answer', { p_id: r.id, p_ok: m.querySelector('#fa-ok').value === '1', p_note: m.querySelector('#fa-n').value }, 'Sent to the Auditor', close).finally(() => { e.target.disabled = false; }); };
    });
    if (a === 'ver') return modal(`<h3>Verify: ${esc(r.title)}</h3><p><b>${r.proposed_ok ? 'Grant' : 'Decline'}</b> by ${esc(r.answered_by_name || '')}</p><p style="white-space:pre-wrap">${esc(r.answer_note || '')}</p>
      <label>Note (required only if you send it back)</label><textarea id="fv-n" rows="3" maxlength="500"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn gold" id="fv-ok" style="flex:1">Verify and release</button><button class="btn ghost" id="fv-no">Send back</button><button class="btn ghost" id="fv-x">Cancel</button></div>`, (m, close) => {
      m.querySelector('#fv-x').onclick = close;
      m.querySelector('#fv-ok').onclick = () => run('v2_fund_verify', { p_id: r.id, p_ok: true, p_note: m.querySelector('#fv-n').value || null }, 'Released to the student', close);
      m.querySelector('#fv-no').onclick = () => run('v2_fund_verify', { p_id: r.id, p_ok: false, p_note: m.querySelector('#fv-n').value || null }, 'Sent back to the Treasurer', close);
    });
  }
  await load();
  let stop = () => {}; try { stop = watch(['v2_fund_requests'], load) || stop; } catch { /* refreshes on the next visit */ }
  return stop;
}
