import { sb, db, watch, esc, toast, modal, skeleton, fmtDate, fmtDateTime } from '../core.js';

/* The Class Mayor reports up to the SAILS VP Internal: a weekly report built from his directives, and requests for approval (funds, activities, other). */
const ASK = { open: ['Waiting for the SAILS VP Internal', 'warn'], approved: ['Approved', 'ok'], declined: ['Declined', 'bad'] };
const KIND = { funds: 'Class funds', activity: 'Activity', other: 'Other' };

export async function mountClassReport(el, ctx) {
  let S = null, reps = [], asks = [], setup = false;
  el.innerHTML = skeleton(4);
  async function load() {
    const [b, r, a] = await Promise.all([
      sb.rpc('v2_class_report_build').then(x => x.error ? (setup = true, null) : x.data, () => null),
      sb.from('v2_class_reports').select('*').order('week_start', { ascending: false }).limit(12).then(x => x.error ? [] : x.data || [], () => []),
      sb.from('v2_class_asks').select('*').order('created_at', { ascending: false }).limit(50).then(x => x.error ? [] : x.data || [], () => []),
    ]);
    S = b; reps = r; asks = a; draw();
  }
  const wk = d => fmtDate(d + 'T00:00:00+08:00');
  function draw() {
    if (setup || !S) { el.innerHTML = '<div class="card"><p class="empty">Run the v46 SQL in Supabase to turn this on.</p></div>'; return; }
    const sent = reps.find(r => r.week_start === S.week_start);
    el.innerHTML = `<p class="muted" style="margin:0 2px 8px">You delegate to your class officers and report to the SAILS VP Internal. Every Friday this report builds itself from your directives.</p>
      <div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px">This week (from ${wk(S.week_start)})</h3>
        <div class="grid" style="margin-bottom:10px"><div class="stat"><small>Sent out</small><b>${S.issued}</b></div><div class="stat gold"><small>Finished</small><b>${S.confirmed}</b></div><div class="stat"><small>Still open</small><b>${S.open}</b></div><div class="stat"><small>Late</small><b>${S.late.length}</b></div></div>
        ${S.late.length ? S.late.map(l => `<div class="row"><div class="m"><b>${esc(l.title)}</b><small>${esc(l.who)} · due ${wk(l.due)}</small></div><span class="tag bad">late</span></div>`).join('') : '<p class="muted" style="margin:0 0 8px">Nothing is late.</p>'}
        <div class="acts" style="margin-top:8px"><button class="btn gold" id="send">${sent ? 'Update and resend' : 'Send to the SAILS VP Internal'}</button>${sent ? `<span class="tag ${sent.reviewed_at ? 'ok' : 'warn'}">${sent.reviewed_at ? 'Reviewed' : 'Sent, not yet read'}</span>` : ''}</div></div>
      <div class="bar"><b>Requests to the SAILS VP Internal</b><span class="grow"></span><button class="btn gold sm" id="ask">+ New request</button></div>
      ${asks.length ? `<div class="card">${asks.map(a => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(a.title)}</b><small>${KIND[a.kind]}${a.amount != null ? ' · ₱' + Number(a.amount).toLocaleString('en-PH') : ''} · ${fmtDateTime(a.created_at)}</small></div><span class="tag ${ASK[a.status][1]}">${ASK[a.status][0]}</span></div>${a.details ? `<p style="margin:6px 0 0">${esc(a.details)}</p>` : ''}${a.decision_note ? `<p class="muted" style="margin:6px 0 0">${esc(a.decided_by_name || 'SAILS VP Internal')}: ${esc(a.decision_note)}</p>` : ''}</div>`).join('')}</div>` : '<p class="empty">No requests yet.</p>'}
      ${reps.length ? `<h4 style="margin:14px 2px 6px">Past reports</h4><div class="card">${reps.map(r => `<div class="row"><div class="m"><b>Week of ${wk(r.week_start)}</b><small>${r.summary.confirmed || 0} finished · ${r.summary.open || 0} open · ${(r.summary.late || []).length} late${r.review_note ? ' · “' + esc(r.review_note) + '”' : ''}</small></div><span class="tag ${r.reviewed_at ? 'ok' : ''}">${r.reviewed_at ? 'Reviewed' : 'Sent'}</span></div>`).join('')}</div>` : ''}`;
    el.querySelector('#send').onclick = () => modal(`<h3>Send the weekly report</h3><form id="f"><label>Your note to the SAILS VP Internal (optional)</label><textarea name="n" rows="4" maxlength="1000" placeholder="What went well, what is stuck, what you need"></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); try { await db(sb.rpc('v2_class_report_submit', { p_note: new FormData(e.target).get('n') })); toast('Report sent'); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
    el.querySelector('#ask').onclick = () => modal(`<h3>Request to the SAILS VP Internal</h3><form id="f"><label>Type</label><select name="k"><option value="funds">Class funds</option><option value="activity">Activity</option><option value="other">Other</option></select>
      <label>What do you need approved?</label><input name="t" required minlength="3" maxlength="140"><label>Details (optional)</label><textarea name="d" rows="3" maxlength="800"></textarea><label>Amount in ₱ (optional)</label><input name="a" type="number" min="0" step="0.01" inputmode="decimal">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_class_ask', { p_kind: f.get('k'), p_title: f.get('t'), p_details: f.get('d'), p_amount: f.get('a') ? Number(f.get('a')) : null })); toast('Request sent'); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  await load();
  return watch(['v2_class_reports', 'v2_class_asks', 'v2_directives'], () => load().catch(() => {}));
}
