import { sb, esc, skeleton } from '../core.js';

/* The President's audit trail: role changes and account approvals, account removals, deputy changes, meeting privacy changes, inspections opened and closed.
   Role changes and inspections come from their own logs; the rest from v2_admin_log (v59). */
const FILTERS = [['all', 'Everything'], ['accounts', 'Accounts and roles'], ['inspections', 'Inspections'], ['other', 'Other']];
export async function mountAudit(el) {
  let rows = [], f = 'all', q = '';
  el.innerHTML = skeleton(4);
  const OK = r => r.error ? [] : r.data || [];
  async function load() {
    const [adm, roles, insp] = await Promise.all([
      sb.from('v2_admin_log').select('*').order('at', { ascending: false }).limit(150).then(OK, () => []),
      sb.from('v2_role_log').select('*').order('at', { ascending: false }).limit(150).then(OK, () => []),
      sb.from('v2_inspections').select('*').order('opened_at', { ascending: false }).limit(60).then(OK, () => []),
    ]);
    rows = [
      ...adm.map(a => ({ at: a.at, by: a.actor_name, what: a.action, detail: a.detail, g: /account/i.test(a.action) ? 'accounts' : 'other' })),
      ...roles.map(r => ({ at: r.at, by: r.by_name, what: r.old_role === 'pending' ? 'Account approved' : 'Role changed', detail: `${r.user_name}: ${r.old_role} to ${r.new_role}`, g: 'accounts' })),
      ...insp.flatMap(i => [{ at: i.opened_at, by: i.opened_by_name, what: 'Inspection opened', detail: i.note, g: 'inspections' }, ...(i.closed_at ? [{ at: i.closed_at, by: i.closed_by_name, what: 'Inspection closed', detail: i.note, g: 'inspections' }] : [])]),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    paint();
  }
  const when = t => new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  function paint() {
    const s = q.trim().toLowerCase(), list = rows.filter(r => (f === 'all' || r.g === f) && (!s || (r.what + ' ' + (r.detail || '') + ' ' + (r.by || '')).toLowerCase().includes(s))).slice(0, 200);
    el.innerHTML = `<div class="subtabs" role="tablist">${FILTERS.map(([id, l]) => `<button type="button" role="tab" aria-selected="${id === f}" data-f="${id}">${l}</button>`).join('')}</div>
      <input id="aq" type="search" placeholder="Search a name or action…" value="${esc(q)}" style="margin-bottom:10px">
      <div class="card">${list.map(r => `<div class="row"><div class="m"><b>${esc(r.what)}</b><small>${esc(r.detail || '')} · by ${esc(r.by || 'the database')} · ${when(r.at)}</small></div></div>`).join('') || '<p class="empty">Nothing logged yet.</p>'}</div>`;
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; paint(); });
    const a = el.querySelector('#aq'); a.oninput = () => { q = a.value; const p = a.selectionStart; paint(); const n = el.querySelector('#aq'); n.focus(); n.setSelectionRange(p, p); };
  }
  await load();
}
