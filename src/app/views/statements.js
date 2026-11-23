import { sb, db, esc, peso, toast, skeleton, fmtDate, printHTML, letterhead } from '../core.js';

/* Financial statements (monthly or yearly) for one section or for all of SAILS, plus the budget against what was spent.
   Run supabase/v74_budget_close_statements.sql once (needs v73). */
const pad = n => String(n).padStart(2, '0');

export async function mountStatements(el, ctx) {
  const role = ctx.profile.role, glob = ctx.profile.real === 'sails_president' || ['vp_internal', 'vp_external', 'treasurer', 'auditor'].includes(role);
  const now = new Date(Date.now() + 8 * 3600e3), thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`, thisYear = now.getUTCFullYear();
  let units = [], unit = glob ? '' : null, mode = 'month', month = thisMonth, year = thisYear, stmt = null, budget = [], busy = false, note = '';
  el.innerHTML = skeleton(3);

  async function init() {
    if (glob) units = await sb.from('v2_units').select('id,name').eq('kind', 'section').order('name').then(x => x.data || [], () => []);
    else unit = await sb.from('v2_periods').select('unit_id').limit(1).then(x => x.data?.[0]?.unit_id || null, () => null);
    await run();
  }

  function range() {
    if (mode === 'year') return [`${year}-01-01`, `${year}-12-31`];
    const [y, m] = month.split('-').map(Number); return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`];
  }

  async function run() {
    busy = true; note = ''; draw();
    try {
      const [f, t] = range();
      stmt = await db(sb.rpc('v2_statement', { p_unit: glob ? (unit || null) : unit, p_from: f, p_to: t }));
      budget = await db(sb.rpc('v2_budget_vs_actual')).catch(() => []);
    } catch (e) { stmt = null; note = /could not find the function|schema cache/i.test(e.message || '') ? 'Run the v74 SQL in Supabase to turn this on.' : e.message; }
    busy = false; draw();
  }

  const sum = a => (a || []).reduce((s, r) => s + +r.amount, 0);
  const rows = a => (a || []).length ? a.map(r => `<div class="row"><div class="m"><b>${esc(r.category)}</b><small>${r.count} entr${r.count === 1 ? 'y' : 'ies'}</small></div><div class="amt">${peso(r.amount)}</div></div>`).join('') : '<p class="muted" style="margin:8px 12px">None in this period.</p>';

  function draw() {
    const [f, t] = range();
    const ctl = `<div class="card pad" style="margin-bottom:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      ${glob ? `<div style="flex:1;min-width:150px"><label>Section</label><select id="su"><option value="">All sections (SAILS)</option>${units.map(u => `<option value="${u.id}"${u.id === unit ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}
      <div><label>Statement</label><select id="sm"><option value="month"${mode === 'month' ? ' selected' : ''}>Monthly</option><option value="year"${mode === 'year' ? ' selected' : ''}>Yearly</option></select></div>
      <div>${mode === 'month' ? `<label>Month</label><input id="sv" type="month" value="${month}">` : `<label>Year</label><input id="sv" type="number" min="2020" max="2100" value="${year}" style="width:90px">`}</div>
      <button class="btn gold sm" id="go"${busy ? ' disabled' : ''}>Show</button></div></div>`;
    if (!stmt) { el.innerHTML = ctl + (busy ? skeleton(2) : `<div class="card"><p class="empty">${esc(note || 'Choose a period and press Show.')}</p></div>`); wire(); return; }
    const tin = sum(stmt.in), tout = sum(stmt.out), closing = +stmt.opening + tin - tout, nd = +stmt.cash_not_deposited, bs = stmt.batches || {};
    const bud = budget.map(b => { const pct = +b.approved ? Math.min(100, Math.round(+b.spent / +b.approved * 100)) : 0, over = +b.spent > +b.approved;
      return `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><div class="m"><b>${esc(b.title)}</b><small>${esc(b.req_no || '')} · ${esc(b.category || '')}</small></div><span class="tag ${over ? 'bad' : ''}">${over ? 'Over by ' + peso(+b.spent - +b.approved) : peso(b.remaining) + ' left'}</span></div>
        <div class="prog" style="margin-top:6px"><i style="width:${pct}%"></i></div><small class="muted">${peso(b.spent)} spent of ${peso(b.approved)} approved</small></div>`; }).join('');
    el.innerHTML = ctl + `<div class="card pad" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><b>${esc(stmt.scope)}</b><small class="muted" style="display:block">${fmtDate(f + 'T00:00:00+08:00')} to ${fmtDate(t + 'T00:00:00+08:00')}</small></div><button class="btn ghost sm" id="pr">Print / PDF</button></div>
      <div class="grid" style="margin-top:10px"><div class="stat"><small>Opening</small><b>${peso(stmt.opening)}</b></div><div class="stat gold"><small>Collected</small><b>${peso(tin)}</b></div><div class="stat"><small>Spent</small><b>${peso(tout)}</b></div><div class="stat"><small>Closing</small><b>${peso(closing)}</b></div></div>
      <h3 style="margin:14px 2px 6px">Collected by category</h3><div class="card">${rows(stmt.in)}</div>
      <h3 style="margin:14px 2px 6px">Spent by category</h3><div class="card">${rows(stmt.out)}</div>
      <p class="muted" style="margin:10px 2px 0">Cash collected but not deposited yet: <b>${peso(nd)}</b>${nd ? ' (waiting for a batch to be verified and countersigned)' : ''}.<br>Batches in this period: ${['submitted', 'verified', 'deposited', 'returned'].map(k => `${bs[k] || 0} ${k}`).join(' · ')}.</p></div>
      <h3 style="margin:14px 2px 6px">Budget against what was spent</h3><div class="card">${bud || '<p class="empty">No approved budget request yet.</p>'}</div>`;
    wire();
  }

  function wire() {
    const g = id => el.querySelector(id);
    g('#su')?.addEventListener('change', e => { unit = e.target.value; });
    g('#sm')?.addEventListener('change', e => { mode = e.target.value; stmt = null; draw(); });
    g('#sv')?.addEventListener('change', e => { if (mode === 'month') month = e.target.value || thisMonth; else year = +e.target.value || thisYear; });
    g('#go')?.addEventListener('click', () => { if (g('#sv')) { if (mode === 'month') month = g('#sv').value || thisMonth; else year = +g('#sv').value || thisYear; } run(); });
    g('#pr')?.addEventListener('click', () => {
      const [f, t] = range(), tin = sum(stmt.in), tout = sum(stmt.out), closing = +stmt.opening + tin - tout;
      const tb = (title, a) => `<h2>${title}</h2><table><thead><tr><th>Category</th><th class="r">Entries</th><th class="r">Amount</th></tr></thead><tbody>${(a || []).map(r => `<tr><td>${esc(r.category)}</td><td class="r">${r.count}</td><td class="r">${peso(r.amount)}</td></tr>`).join('') || '<tr><td colspan="3">None</td></tr>'}</tbody></table>`;
      printHTML('Statement - ' + stmt.scope, `${letterhead((mode === 'year' ? 'Yearly' : 'Monthly') + ' financial statement', stmt.scope + ' · ' + f + ' to ' + t)}
        <div class="sum"><div>Opening<b>${peso(stmt.opening)}</b></div><div>Collected<b>${peso(tin)}</b></div><div>Spent<b>${peso(tout)}</b></div><div>Closing<b>${peso(closing)}</b></div></div>
        ${tb('Collected by category', stmt.in)}${tb('Spent by category', stmt.out)}<p>Cash collected but not deposited yet: ${peso(stmt.cash_not_deposited)}</p>`);
    });
  }

  await init();
  return () => {};
}
