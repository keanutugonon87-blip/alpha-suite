import { sb, todayISO } from '../core.js';

/* What is waiting for this officer on the new desks (budget, VP, records, document flow). Every query is quiet: a missing SQL update just means nothing is listed. */
const q = async p => { try { const r = await p; return r.error ? [] : r.data || []; } catch { return []; } };
const n = (list, pred) => list.filter(pred).length;
const s = c => (c === 1 ? '' : 's'), w = c => (c === 1 ? 'waits' : 'wait');

export async function deskItems(ctx) {
  const role = ctx.profile.role, can = ctx.can, me = role, out = [], add = (icon, text, sub, tab) => out.push([icon, text, sub, tab]);
  const isVp = ['vp_internal', 'vp_external'].includes(role), mayor = can('mayor');
  const want = (cond, query) => (cond ? q(query) : Promise.resolve([]));
  const [fbr, liq, recs, meet, par, act, deleg, evs, finds, rreq] = await Promise.all([
    want(can('mayor', 'treasurer', 'secretary'), sb.from('v2_budget_requests').select('id,status')),
    want(can('mayor', 'treasurer', 'secretary', 'auditor'), sb.from('v2_liquidations').select('id,status')),
    want(can('mayor', 'vice_mayor', 'secretary', 'auditor', 'pio'), sb.from('v2_office_records').select('id,kind,flow,classification,status,on_date').limit(500)),
    want(can('mayor', 'vice_mayor'), sb.from('v2_vp_meetings').select('id,status')),
    want(can('mayor', 'vice_mayor'), sb.from('v2_vp_partners').select('id,status')),
    want(can('mayor', 'vice_mayor'), sb.from('v2_vp_activities').select('id,status')),
    want(can('mayor', 'vice_mayor'), sb.from('v2_vp_delegations').select('id,status,to_role')),
    want(can('secretary', 'pio'), sb.from('v2_events').select('id,status,report_sent_at,notified_at')),
    want(can('auditor'), sb.from('v2_office_records').select('id,status').eq('kind', 'finding')),
    want(can('secretary'), sb.from('v2_record_requests').select('id,status')),   // empty until v33 is run
  ]);
  const SEC = r => ['minutes', 'resolution', 'letter_in', 'letter_out'].includes(r.kind);
  if (role === 'treasurer') {
    const c = n(fbr, r => ['draft', 'returned'].includes(r.status)); if (c) add('📝', `${c} budget request${s(c)} to finish or fix`, 'Budget', 'requests');
    const l = n(fbr, r => ['approved', 'filed'].includes(r.status)) && n(liq, r => ['draft', 'returned'].includes(r.status)); if (l) add('📑', `${l} liquidation report${s(l)} to finish or fix`, 'Budget', 'requests');
  }
  if (mayor) {
    const c = n(fbr, r => r.status === 'submitted'); if (c) add('📝', `${c} budget request${s(c)} ${w(c)} for your approval`, 'Budget', 'requests');
    const l = n(liq, r => r.status === 'submitted'); if (l) add('📑', `${l} liquidation report${s(l)} ${w(l)} for your approval`, 'Budget', 'requests');
  }
  if (mayor || isVp || role === 'vice_mayor') {
    const d = n(recs, r => r.flow === 'reviewed'); if (d && (mayor || role !== 'vp_external')) add('🗂️', `${d} record${s(d)} from the Secretary ${w(d)} for approval`, 'VP Desk › Records', 'vp');
  }
  if (mayor) {
    const p = n(meet, r => r.status === 'proposed') + n(par, r => r.status === 'proposed') + n(act, r => r.status === 'proposed'); if (p) add('🧭', `${p} VP proposal${s(p)} ${w(p)} for your decision`, 'VP Desk', 'vp');
    const o = n(deleg, r => r.status === 'open'); if (o) add('📌', `${o} task${s(o)} you gave the VPs not done yet`, 'VP Desk', 'vp');
  } else if (isVp || role === 'vice_mayor') {
    const o = n(deleg, r => r.status === 'open' && (role === 'vice_mayor' || r.to_role === 'both' || r.to_role === role)); if (o) add('📌', `${o} task${s(o)} from the Mayor for you`, 'VP Desk › From Mayor', 'vp');
    const r1 = n(meet, r => r.status === 'returned') + n(par, r => r.status === 'returned') + n(act, r => r.status === 'returned'); if (r1) add('↩️', `${r1} proposal${s(r1)} returned by the Mayor`, 'VP Desk', 'vp');
  }
  if (role === 'secretary') {
    const f = n(fbr, r => r.status === 'approved') + n(liq, r => r.status === 'audited'); if (f) add('🗄️', `${f} approved request${s(f)} or report${s(f)} to file`, 'Budget', 'requests');
    const rq = n(rreq, r => r.status === 'open'); if (rq) add('📨', `${rq} record request${s(rq)} from members to answer`, 'Secretary Desk › Member requests', 'office');
    const rt = n(recs, r => SEC(r) && r.flow === 'returned'); if (rt) add('↩️', `${rt} record${s(rt)} returned for changes`, 'Secretary Desk', 'office');
    const dr = n(recs, r => SEC(r) && r.flow === 'draft'); if (dr) add('✍️', `${dr} record${s(dr)} not sent for approval yet`, 'Secretary Desk', 'office');
    const ce = n(evs, e => e.status === 'closed' && !e.report_sent_at); if (ce) add('📋', `${ce} closed event${s(ce)} not compiled yet`, 'Attendance', 'attendance');
  }
  if (role === 'auditor') {
    const a = n(liq, r => r.status === 'approved'); if (a) add('🔍', `${a} liquidation report${s(a)} waiting for your audit`, 'Budget', 'requests');
    const c = n(recs, r => SEC(r) && r.flow === 'approved'); if (c) add('🏷️', `${c} approved file${s(c)} to classify`, 'Audit Desk › Classify files', 'office');
    const f = n(finds, r => r.status === 'open'); if (f) add('⚠️', `${f} open finding${s(f)} not reported yet`, 'Audit Desk', 'office');
  }
  if (role === 'pio') {
    const p = n(recs, r => SEC(r) && r.flow === 'classified' && r.classification === 'public'); if (p) add('📣', `${p} public file${s(p)} ready to post to the members`, 'PIO Desk › Post files', 'office');
    const e = n(evs, v => v.report_sent_at && !v.notified_at); if (e) add('📢', `${e} fines report${s(e)} waiting to be sent to the students`, 'Attendance', 'attendance');
  }
  void todayISO; void me;
  return out;
}
