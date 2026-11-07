import { sb, esc } from '../core.js';

/* Which database updates (SQL files) are installed, checked from the app, so nobody has to guess what is missing. */
const MISS = /does not exist|schema cache|could not find|not found/i;
const table = (t, col = 'id') => async () => { const r = await sb.from(t).select(col).limit(0); return !(r.error && MISS.test(r.error.message || '')); };
const fn = (name, args) => async () => { const r = await sb.rpc(name, args); return !(r.error && (r.error.code === 'PGRST202' || /could not find the function/i.test(r.error.message || ''))); };
const ZERO = '00000000-0000-0000-0000-000000000000';
export const STEPS = [
  { v: 'v21', file: 'v21_events_attendance.sql', does: 'Attendance events and scanning', check: table('v2_events') },
  { v: 'v22', file: 'v22_attendance_report.sql', does: 'Attendance fines report, Secretary compile, PIO notice', check: table('v2_events', 'report_sent_at') },
  { v: 'v23', file: 'v23_promises_budgets.sql', does: 'Payment promises on the Treasurer’s desk', check: table('v2_promises') },
  { v: 'v24', file: 'v24_budget_requests.sql', does: 'Fund budget requests', check: table('v2_budget_requests') },
  { v: 'v25', file: 'v25_liquidation_audit.sql', does: 'Liquidation and audit reports', check: table('v2_liquidations') },
  { v: 'v26', file: 'v26_delete_requests.sql', does: 'Mayor can delete requests and reports', check: fn('v2_fbr_delete', { p_id: ZERO }) },
  { v: 'v27', file: 'v27_event_creators.sql', does: 'Mayor and Vice Mayor create events', check: null },
  { v: 'v28', file: 'v28_vice_presidents.sql', does: 'VP Internal and VP External desks', check: table('v2_vp_meetings') },
  { v: 'v29', file: 'v29_office_records.sql', does: 'Secretary, Auditor, PIO and Marshal desks', check: table('v2_office_records') },
  { v: 'v30', file: 'v30_document_flow.sql', does: 'Document approval, classification and posting to members', check: table('v2_office_records', 'flow') },
  { v: 'v32', file: 'v32_auditor_independence.sql', does: 'Auditor no longer approves spending', check: async () => null },
  { v: 'v33', file: 'v33_records_access.sql', does: 'Members request records from the Secretary (Archive tab)', check: table('v2_record_requests') },
  { v: 'v34', file: 'v34_pio_checks.sql', does: 'PIO posts need privacy, branding and communication checks before approval', check: null },
  { v: 'v44', file: 'v44_chain_of_command.sql', does: 'Chain of command for directives (VPs direct their line), directives to many officers, waiting alerts, decision history, routine meetings, Monday summary', check: fn('v2_directive_issue_many', { p_assignees: [], p_title: '', p_details: null, p_due: null, p_priority: 'normal', p_link: null }) },
  { v: 'v45', file: 'v45_marshal_line.sql', does: 'Marshal line: General Marshal and four Department Marshals with their own desk, blocks by section letter, incident reports, requests to Class Mayors', check: fn('v2_marshal_overview', {}) },
  { v: 'v46', file: 'v46_class_mayor_line.sql', does: 'Class Mayor line: separate SAILS President role, class officers get an inbox only, weekly report and requests up to the VP Internal', check: fn('v2_class_report_build', {}) },
  { v: 'v47', file: 'v47_president_referrals.sql', does: 'The President acknowledges, sends back or closes incident reports the General Marshal referred', check: fn('v2_incident_president', { p_id: '00000000-0000-0000-0000-000000000000', p_action: '', p_note: null }) },
  { v: 'v48', file: 'v48_line_of_authority_access.sql', does: 'SAILS-level access belongs to the SAILS President: a Class Mayor manages only his class officers and sees only his own section', check: fn('v2_president_overview', {}) },
  { v: 'v43', file: 'v43_line_of_authority.sql', does: 'The President decides on what the VPs and Secretary send up, and no longer works inside the VP desks', check: null },
  { v: 'v42', file: 'v42_coa.sql', does: 'Calendar of Activities: the Secretary drafts from council minutes, the SAILS President approves, students see a live calendar', check: table('v2_coa') },
  { v: 'v41', file: 'v41_trash.sql', does: 'Trash bin: removed requests and records can be restored for 7 days, then are deleted for good', check: table('v2_trash') },
  { v: 'v40', file: 'v40_unlink_voided.sql', does: 'Deleting a budget request no longer fails when it has a voided expense', check: null },
  { v: 'v39', file: 'v39_faq.sql', does: 'FAQ on the student screen, written by the Secretary', check: table('v2_faq') },
  { v: 'v38', file: 'v38_collections_no_approval.sql', does: 'Collections count at once, no approval (expenses keep theirs)', check: null },
  { v: 'v37', file: 'v37_units_seats.sql', does: 'Department blueprint, phase 1: SAILS and class sections as units, seat types and seat holders (adds only; nothing changes on screen)', check: table('v2_units') },
  { v: 'v36', file: 'v36_directives.sql', does: 'Directives: the Mayor assigns tasks to officers, with instant phone alerts', check: table('v2_directives') },
  { v: 'v35', file: 'v35_event_orders.sql', does: 'The Mayor orders each event and approves official announcements', check: table('v2_events', 'ordered_at') },
  { v: 'v31', file: 'v31_treasurer_controls.sql', does: 'Treasurer: approval needed to disburse, acknowledgments for funds received', check: table('v2_entries', 'approval_ref') },
];
export async function checkSetup() { return Promise.all(STEPS.map(async s => { let ok = null; if (s.check) { try { ok = await s.check(); } catch { ok = null; } } return { ...s, ok }; })); }

export function setupHtml(list) {
  const miss = list.filter(s => s.ok === false);
  return `<h3 class="sec">Database updates</h3>
    <div class="alertbar ${miss.length ? 'bad' : 'ok'}" style="margin-bottom:8px"><span>${miss.length ? `⚠️ ${miss.length} update${miss.length === 1 ? ' is' : 's are'} not installed yet. Run ${miss.map(s => '<b>' + s.v + '</b>').join(', ')} in the Supabase SQL Editor, in that order.` : '✅ Every update is installed.'}</span></div>
    <div class="card">${list.map(s => `<div class="row"><div class="m"><b>${s.v} · ${esc(s.does)}</b><small>${esc(s.file)}</small></div><span class="tag ${s.ok === true ? 'ok' : s.ok === false ? 'bad' : ''}">${s.ok === true ? 'Installed' : s.ok === false ? 'Not installed' : 'Can’t check'}</span></div>`).join('')}</div>`;
}
