import { sb, db, esc, toast, modal, fmtDate, fmtDateTime, peso, printHTML, letterhead, ROLE_LABEL, todayISO } from '../core.js';

/* The President's supervision panes: scorecards, funds overview, and records (deputy, role log, access map, monthly report). Read only except the deputy. */
const RG = { vp_internal: 'VP Internal', vp_external: 'VP External', general_marshal: 'General Marshal', dept_marshal: 'Department Marshal', mayor: 'Class Mayor' };
const NOTE = '<div class="card"><p class="empty">Run the v49 SQL in Supabase to turn this on.</p></div>';
const rpc = (n, a) => sb.rpc(n, a || {}).then(r => (r.error ? null : r.data), () => null);

export async function mountSupervise(el, part, ctx) {
  el.innerHTML = '<div class="card"><p class="empty">Loading…</p></div>';
  if (part === 'score') return score(el);
  if (part === 'funds') return funds(el);
  return records(el, ctx);
}

async function score(el) {
  const rows = await rpc('v2_scorecard', { p_days: 28 });
  if (!rows) { el.innerHTML = NOTE; return; }
  const spark = w => (w || []).map(p => p == null ? '·' : p >= 80 ? '▇' : p >= 50 ? '▄' : '▁').join('');
  el.innerHTML = `<p class="muted" style="margin:0 2px 8px">The last 28 days of directives for each Vice President, Marshal and Class Mayor. “On time” is finished and confirmed by the due date. The bars show the last 4 weeks, oldest first.</p>
    ${rows.length ? `<div class="card">${rows.map(r => { const pct = r.confirmed ? Math.round(100 * r.on_time / r.confirmed) : null; return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(r.name)}</b><small>${esc(RG[r.role] || ROLE_LABEL[r.role] || r.role)} · ${r.total} directive${r.total === 1 ? '' : 's'} · ${r.confirmed} finished${r.avg_response_h != null ? ' · replies in ~' + r.avg_response_h + ' h' : ''}</small></div><span class="tag ${r.late_open ? 'bad' : pct != null && pct >= 80 ? 'ok' : 'warn'}">${pct != null ? pct + '% on time' : 'no finished work'}</span></div>
      <small class="muted" style="display:block;margin-top:4px">${r.late_open ? r.late_open + ' late now · ' : ''}${r.returned ? r.returned + ' returned for fixing · ' : ''}<span title="last 4 weeks, oldest first" style="letter-spacing:2px">${spark(r.weeks)}</span></small></div>`; }).join('')}</div>` : '<p class="empty">No directives in the last 28 days.</p>'}`;
}

async function funds(el) {
  const f = await rpc('v2_funds_overview');
  if (!f) { el.innerHTML = NOTE; return; }
  const bal = +f.opening + +f.collected - +f.spent;
  el.innerHTML = `<p class="muted" style="margin:0 2px 8px">The class fund of the open period. Read only. The Auditor checks it, and the Class Mayor runs it.</p>
    <div class="grid" style="margin-bottom:12px"><div class="stat gold"><small>Balance</small><b>${peso(bal)}</b></div><div class="stat"><small>Collected</small><b>${peso(f.collected)}</b></div><div class="stat"><small>Spent</small><b>${peso(f.spent)}</b></div><div class="stat"><small>Pending entries</small><b>${f.pending}</b></div></div>
    <div class="card">
      <div class="row"><div class="m"><b>Opening balance</b></div><span>${peso(f.opening)}</span></div>
      <div class="row"><div class="m"><b>Largest expense</b><small>${f.largest ? esc(f.largest.purpose || 'no purpose written') : 'none yet'}</small></div><span>${f.largest ? peso(f.largest.amount) : '—'}</span></div>
      <div class="row"><div class="m"><b>Voided entries (30 days)</b><small>Many voids can mean careless recording</small></div><span class="tag ${f.voided_30d > 3 ? 'bad' : ''}">${f.voided_30d}</span></div>
      <div class="row"><div class="m"><b>Budget requests waiting</b></div><span class="tag ${f.budget_waiting ? 'warn' : ''}">${f.budget_waiting}</span></div>
      <div class="row"><div class="m"><b>Liquidation reports waiting</b></div><span class="tag ${f.liquidation_waiting ? 'warn' : ''}">${f.liquidation_waiting}</span></div></div>`;
}

const ACCESS = [
  ['Own directives inbox', '✓', '✓', '✓', '✓', '✓'],
  ['Issue directives', 'VPs, General Marshal', 'Class officers', 'Class Mayors', 'Dept. Marshals (General Marshal)', '—'],
  ['Accounts and roles', 'All except the President role', 'Own class officers', '—', '—', '—'],
  ['VP meetings, partners, activities', 'Approve', '—', 'Own work', '—', '—'],
  ['Calendar', 'Decide', 'Own drafts', 'Own drafts', '—', '—'],
  ['Class money, Watch, documents', 'Read', 'Run it', 'Read', '—', '—'],
  ['Marshal blocks and incident reports', 'Read, act on referrals', '—', '—', 'Run it', '—'],
  ['Class Mayors’ reports and requests', 'Read all', 'Own', 'Decide (VP Internal)', '—', '—'],
  ['Role log, scorecards', 'Read', '—', '—', '—', '—'],
];

async function records(el, ctx) {
  const real = ctx.mode === 'pres' || ctx.mode === 'acting';
  const [dep, log] = await Promise.all([rpc('v2_deputy_status'), sb.from('v2_role_log').select('*').order('at', { ascending: false }).limit(40).then(r => r.error ? null : r.data || [], () => null)]);
  const tonight = todayISO();
  el.innerHTML = `
    <h3 style="margin:0 2px 8px">Deputy while you are away</h3>
    <div class="card" style="margin-bottom:14px">${dep ? `<div class="row"><div class="m"><b>${esc(dep.user_name)}</b><small>Acts for the President from ${fmtDate(dep.from_on + 'T00:00:00+08:00')} to ${fmtDate(dep.to_on + 'T00:00:00+08:00')}${dep.active_now ? ' · active now' : ''}. Decisions are marked “acting for the President”. Roles stay with you.</small></div>${dep.me ? '' : '<button class="btn ghost sm" id="dr">End</button>'}</div>`
      : '<p class="muted" style="margin:0 0 8px">Nobody is named. If you are away, name a Vice President or the General Marshal for up to 14 days.</p>'}
      ${real ? '<div class="acts" style="margin-top:8px"><button class="btn gold sm" id="dn">Name a deputy</button></div>' : ''}</div>
    <h3 style="margin:0 2px 8px">Monthly report for the adviser</h3>
    <div class="card" style="margin-bottom:14px"><div class="row"><div class="m"><b>SAILS monthly report</b><small>Approvals, directives, reports from Class Mayors, incidents, funds and the activities of the month. Opens a page you can print or save as PDF.</small></div><div style="display:flex;gap:6px"><input type="month" id="mm" value="${tonight.slice(0, 7)}" style="width:auto"><button class="btn gold sm" id="mp">Open</button></div></div></div>
    <h3 style="margin:0 2px 8px">Who can do what</h3>
    <div class="card" style="margin-bottom:14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.85rem"><thead><tr><th style="text-align:left;padding:6px">Area</th><th>President</th><th>Class Mayor</th><th>VPs</th><th>Marshals</th><th>Class officers</th></tr></thead><tbody>${ACCESS.map(r => `<tr style="border-top:1px solid var(--line,#e3e8ee)"><td style="padding:6px"><b>${esc(r[0])}</b></td>${[1, 2, 3, 4, 5].map(i => `<td style="padding:6px;text-align:center">${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="muted" style="margin:8px 6px 0;font-size:.8rem">A reference for how the database rules are set (v46 to v49). Class officers see only their own directives.</p></div>
    <h3 style="margin:0 2px 8px">Role changes</h3>
    <div class="card">${log === null ? '<p class="empty">Run the v49 SQL in Supabase to turn this on.</p>' : log.length ? log.map(l => `<div class="row"><div class="m"><b>${esc(l.user_name || 'Someone')}</b><small>${esc(ROLE_LABEL[l.old_role] || l.old_role)} → ${esc(ROLE_LABEL[l.new_role] || l.new_role)} · by ${esc(l.by_name || 'unknown')} · ${fmtDateTime(l.at)}</small></div></div>`).join('') : '<p class="empty">No role changes recorded yet.</p>'}</div>`;

  el.querySelector('#dr')?.addEventListener('click', async () => { try { await db(sb.rpc('v2_deputy_revoke')); toast('Deputy ended'); records(el, ctx); } catch (e) { toast(e.message, true); } });
  el.querySelector('#dn')?.addEventListener('click', async () => {
    const vps = await sb.from('v2_profiles').select('user_id,full_name,role').in('role', ['vp_internal', 'vp_external', 'general_marshal']).order('full_name').then(r => r.data || [], () => []);
    modal(`<h3>Name a deputy</h3><form id="f"><label>Who acts for you</label><select name="u" required>${vps.map(v => `<option value="${v.user_id}">${esc(v.full_name)} · ${esc(ROLE_LABEL[v.role])}</option>`).join('')}</select>
      <label>From</label><input name="a" type="date" value="${tonight}" min="${tonight}" required><label>To (14 days at most)</label><input name="b" type="date" min="${tonight}" required>
      <p class="muted" style="font-size:.85rem;margin:8px 0 0">The deputy can approve, return, decide on the calendar and direct the Vice Presidents. The deputy cannot change anyone’s role.</p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Name deputy</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.rpc('v2_deputy_set', { p_user: f.get('u'), p_from: f.get('a'), p_to: f.get('b') })); toast('Deputy named'); close(); records(el, ctx); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  });
  el.querySelector('#mp')?.addEventListener('click', async () => {
    const ym = el.querySelector('#mm').value; if (!ym) return;
    const d = await rpc('v2_sails_monthly', { p_month: ym + '-01' }); if (!d) return toast('Run the v49 SQL in Supabase first', true);
    const n = (o, k) => (o && o[k]) || 0, dec = d.decisions || {}, ask = d.asks || {};
    const month = new Date(ym + '-01T00:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
    const li = t => `<li>${t}</li>`;
    printHTML('SAILS monthly report', `${letterhead('SAILS monthly report · ' + month)}
      <h3>Approvals decided</h3><ul>${li(`Approved: ${n(dec, 'approved')}`)}${li(`Returned for changes: ${n(dec, 'returned')}`)}${li(`Cancelled: ${n(dec, 'cancelled')}`)}</ul>
      <h3>Directives</h3><ul>${li(`Sent: ${d.directives.issued}`)}${li(`Finished and confirmed: ${d.directives.confirmed}`)}${li(`Late right now: ${d.directives.late_now}`)}</ul>
      <h3>Class Mayors</h3><ul>${li(`Weekly reports received: ${d.reports.received} (${d.reports.mayors} Class Mayor${d.reports.mayors === 1 ? '' : 's'})`)}${li(`Requests approved: ${n(ask, 'approved')}, declined: ${n(ask, 'declined')}, still open: ${n(ask, 'open')}`)}</ul>
      <h3>Marshals</h3><ul>${li(`Incident reports filed: ${d.incidents.filed}`)}${li(`Referred to the President: ${d.incidents.referred}`)}${li(`Closed: ${d.incidents.closed}`)}</ul>
      <h3>Class fund</h3><ul>${li(`Collected: ${peso(d.funds.collected)}`)}${li(`Spent: ${peso(d.funds.spent)}`)}</ul>
      <h3>Activities</h3>${(d.activities || []).length ? `<ul>${d.activities.map(a => li(`${esc(a.title)} · ${fmtDate(a.on + 'T00:00:00+08:00')}`)).join('')}</ul>` : '<p>No approved activities this month.</p>'}`);
  });
}
