import { sb, db, esc, peso, fmtDate, toast, modal, FUNDS, todayISO } from '../core.js';
import { showReceipt } from '../qr.js';
import { ymManila } from '../money.js';

/* Treasurer overview: where the money is, what needs the Treasurer, who owes and for how long, and the last eight weeks.
   Everything is worked out from records the app already keeps, so there is no extra setup. */
const dayMs = 864e5;
const wkStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const short = d => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

async function entries() {   // the request, approval and acknowledgment columns exist only after the v24 and v31 SQL are run, so fall back step by step
  for (const cols of ['id,kind,amount,fund,status,occurred_at,member_id,payer_name,receipt_no,source,purpose,request_id,approval_ref,ack_at', 'id,kind,amount,fund,status,occurred_at,member_id,payer_name,receipt_no,source,purpose,request_id', 'id,kind,amount,fund,status,occurred_at,member_id,payer_name,receipt_no,source,purpose']) {
    try { return await db(sb.from('v2_entries').select(cols).in('status', ['approved', 'pending']).order('occurred_at', { ascending: false }).limit(5000)); } catch { /* try fewer columns */ }
  }
  return [];
}

export async function drawOverview(host, ctx, base, { goal, rows, collect, isMayor, readonly }) {
  const [ent, reqs, liqs, closes, img] = await Promise.all([
    entries(),
    db(sb.from('v2_budget_requests').select('id,req_no,title,status,total')).catch(() => []),          // empty until the v24 SQL is run
    db(sb.from('v2_liquidations').select('request_id,status')).catch(() => []),                        // empty until the v25 SQL is run
    sb.from('v2_month_close').select('month,status').then(r => r.data || [], () => []),
    db(sb.from('v2_entries').select('id').not('receipt_image', 'is', null)).catch(() => []),
  ]);
  const now = new Date(), today = todayISO(), mem = Object.fromEntries((base.members || []).map(m => [m.id, m.full_name]));
  const limit = await sb.from('v2_settings').select('value').eq('key', 'expense_second_approval').maybeSingle().then(r => { const v = r.data?.value; return v != null && v !== '' && !isNaN(+v) ? +v : 500; }, () => 500);
  const ok = ent.filter(e => e.status === 'approved'), pend = ent.filter(e => e.status === 'pending');
  const sum = a => a.reduce((t, e) => t + +e.amount, 0);

  /* money by fund (approved entries only) */
  const funds = [...FUNDS.map(f => [f.k, f.label]), ['', 'Unassigned']].map(([k, label]) => ({ k, label, v: sum(ok.filter(e => (e.fund || '') === k && e.kind === 'collection')) - sum(ok.filter(e => (e.fund || '') === k && e.kind === 'expense')) })).filter(f => f.v !== 0 || f.k);
  const total = funds.reduce((t, f) => t + f.v, 0), ym = ymManila(now);
  const monthOut = sum(ok.filter(e => e.kind === 'expense' && ymManila(e.occurred_at) === ym)), monthIn = sum(ok.filter(e => e.kind === 'collection' && ymManila(e.occurred_at) === ym));
  const wk = wkStart(now).getTime(), weekIn = sum(ok.filter(e => e.kind === 'collection' && new Date(e.occurred_at).getTime() >= wk));

  /* what needs the Treasurer (or the Mayor, when it is the Mayor looking) */
  const needs = [];
  const add = (n, text, hash, act) => { if (n > 0) needs.push({ text: text.replace('{n}', n), hash, act }); };
  add(pend.length, isMayor ? '{n} entries are waiting for your approval' : '{n} entries are waiting for the Mayor to approve', '#/staff/treasury');
  const lq = id => liqs.find(l => l.request_id === id)?.status;
  if (isMayor) {
    add(reqs.filter(r => r.status === 'submitted').length, '{n} budget request(s) wait for your approval', '#/staff/requests');
    add(liqs.filter(l => l.status === 'submitted').length, '{n} liquidation report(s) wait for your approval', '#/staff/requests');
  } else {
    add(reqs.filter(r => ['draft', 'returned'].includes(r.status)).length, '{n} budget request(s) to finish or fix', '#/staff/requests');
    add(reqs.filter(r => ['approved', 'filed'].includes(r.status) && (!lq(r.id) || ['draft', 'returned'].includes(lq(r.id)))).length, '{n} liquidation report(s) to prepare or fix', '#/staff/requests');
  }
  add((base.promises || []).filter(x => x.promised_on <= today).length, '{n} promise(s) to pay are due', null, collect);
  const fineRows = rows.flatMap(r => r.items.filter(i => i.kind === 'fine').map(i => ({ ...i, m: r.m })));
  add(fineRows.length, `{n} fine(s) not collected yet (${peso(fineRows.reduce((t, i) => t + i.owed, 0))})`, null, collect);
  add(base.charges.filter(c => !c.closed && c.due_on && (new Date(c.due_on) - now) / dayMs <= 7).length, '{n} charge(s) due within a week or late', '#/staff/balances');
  const pm = ymManila(new Date(now - 31 * dayMs)), locked = new Set(closes.filter(c => c.status === 'closed').map(c => c.month));
  if (ok.some(e => ymManila(e.occurred_at) === pm) && !locked.has(pm)) needs.push({ text: 'Last month is not closed yet', hash: '#/staff/treasury' });
  const has = new Set(img.map(x => x.id));
  add(ok.filter(e => e.kind === 'expense' && now - new Date(e.occurred_at) < 60 * dayMs && !has.has(e.id)).length, '{n} expense(s) from the last 60 days have no receipt photo', '#/staff/treasury');

  /* the Purser's duties (CBL Section 5), each with where it stands */
  const hasAck = ent.some(e => 'ack_at' in e), recent = e => now - new Date(e.occurred_at) < 60 * dayMs;
  const unack = hasAck ? ok.filter(e => e.kind === 'collection' && !e.ack_at) : [];
  const exps = ok.concat(pend).filter(e => e.kind === 'expense' && recent(e)), noPhoto = exps.filter(e => !has.has(e.id));
  const noBasis = exps.filter(e => (e.source || 'manual') === 'manual' && limit > 0 && +e.amount >= limit && !e.request_id && !e.approval_ref);
  const stage = s => reqs.filter(r => r.status === s).length, liqOpen = reqs.filter(r => ['approved', 'filed'].includes(r.status) && (!lq(r.id) || ['draft', 'returned'].includes(lq(r.id)))).length;
  const prevOpen = ok.some(e => ymManila(e.occurred_at) === pm) && !locked.has(pm);
  const duties = [
    ['Book of accounts', pend.length || prevOpen ? 'warn' : 'ok', `${ent.length} entries in the book · ${peso(total)} on hand. ${pend.length ? pend.length + ' waiting for the Mayor to approve. ' : ''}${prevOpen ? 'Last month is not closed yet.' : 'Books are up to date.'}`, '#/staff/treasury'],
    ['Acknowledgments for funds received', !hasAck ? '' : unack.length ? 'warn' : 'ok', !hasAck ? 'Run the v31 SQL to track which payments already have an acknowledgment (receipt) issued.' : unack.length ? `${unack.length} approved payment${unack.length === 1 ? '' : 's'} (${peso(sum(unack))}) with no acknowledgment issued yet.` : 'Every approved payment has an acknowledgment.', null, hasAck && unack.length ? 'ack' : null],
    ['Budgets and financial reports', stage('draft') + stage('returned') + liqOpen ? 'warn' : 'ok', `Requests: ${stage('draft')} draft · ${stage('returned')} returned · ${stage('submitted')} with the Mayor · ${stage('approved')} approved · ${stage('filed')} filed. ${liqOpen} liquidation report${liqOpen === 1 ? '' : 's'} to prepare. Reports (monthly, period, ledger) are in Treasury.`, '#/staff/requests'],
    ['Receipts and supporting documents', noPhoto.length || noBasis.length ? 'warn' : 'ok', exps.length ? `${exps.length - noPhoto.length} of ${exps.length} recent expenses have a receipt photo. ${noPhoto.length ? noPhoto.length + ' missing a photo. ' : ''}` : 'No expenses in the last 60 days.', '#/staff/treasury'],
    ['No disbursement without approval', noBasis.length ? 'bad' : 'ok', `Every expense needs the Mayor's approval${limit > 0 ? `, and from ${peso(limit)} a budget request or approval reference` : ''}. ${noBasis.length ? noBasis.length + ' recent expense' + (noBasis.length === 1 ? '' : 's') + ' of that size ' + (noBasis.length === 1 ? 'has' : 'have') + ' none on record.' : 'No gaps found in the last 60 days.'}`, '#/staff/treasury'],
  ];

  /* who owes, and for how long (by the charge's due date) */
  const B = [['Not due yet', 0, 0], ['1 to 7 days late', 0, 0], ['8 to 30 days late', 0, 0], ['Over 30 days late', 0, 0]], seen = [new Set(), new Set(), new Set(), new Set()];
  const due = Object.fromEntries(base.charges.filter(c => !c.closed).map(c => [c.id, c.due_on]));
  base.bal.filter(b => due[b.charge_id] !== undefined && !b.waived && +b.owed > 0).forEach(b => {
    const late = due[b.charge_id] ? Math.floor((new Date(today) - new Date(due[b.charge_id])) / dayMs) : 0, i = late <= 0 ? 0 : late <= 7 ? 1 : late <= 30 ? 2 : 3;
    B[i][1] += +b.owed; seen[i].add(b.member_id);
  });
  B.forEach((b, i) => { b[2] = seen[i].size; });
  const bMax = Math.max(1, ...B.map(b => b[1]));

  /* eight weeks of collecting and spending */
  const W = Array.from({ length: 8 }, (_, i) => { const s = new Date(wk - (7 - i) * 7 * dayMs), e = s.getTime() + 7 * dayMs;
    const inn = sum(ok.filter(x => x.kind === 'collection' && new Date(x.occurred_at).getTime() >= s.getTime() && new Date(x.occurred_at).getTime() < e)), out = sum(ok.filter(x => x.kind === 'expense' && new Date(x.occurred_at).getTime() >= s.getTime() && new Date(x.occurred_at).getTime() < e));
    return { label: short(s), inn, out }; });
  const wMax = Math.max(1, ...W.flatMap(w => [w.inn, w.out]));

  host.innerHTML = `<div class="grid"><div class="stat gold"><small>Money on hand</small><b>${peso(total)}</b></div><div class="stat"><small>Collected this week</small><b>${peso(weekIn)}</b></div><div class="stat"><small>Spent this month</small><b>${peso(monthOut)}</b></div></div>
    ${goal ? `<div class="card pad" style="margin:12px 0"><div style="display:flex;justify-content:space-between"><b>Weekly goal</b><small class="muted">${peso(weekIn)} of ${peso(goal)}</small></div><div class="prog" style="margin-top:8px"><i style="width:${Math.min(100, weekIn / goal * 100)}%"></i></div></div>` : ''}
    ${readonly ? '<p class="muted" style="margin:12px 2px 0;font-size:.85rem">This is the Treasurer’s desk, shown to you as an overview only. Approving entries is under Treasury.</p>' : ''}
    <h3 style="margin:16px 2px 8px">${readonly ? 'At the Treasurer\'s desk' : 'Needs you'}</h3>
    <div class="card">${needs.length ? needs.map((n, i) => `<div class="row" ${readonly && n.act ? '' : `data-n="${i}" style="cursor:pointer"`}><div class="m"><b>${esc(n.text)}</b></div>${readonly && n.act ? '' : '<span class="muted">›</span>'}</div>`).join('') : '<p class="empty">Nothing is waiting. Everything is up to date.</p>'}</div>
    <h3 style="margin:16px 2px 8px">The Purser’s duties <small class="muted" style="font-weight:400">· CBL Section 5</small></h3>
    <div class="card">${duties.map(([t, st, txt, h, act], i) => `<div class="row" ${h || act ? `data-d="${i}" style="cursor:pointer"` : ''}><div class="m"><b>${esc(t)}</b><small>${esc(txt)}</small></div><span class="tag ${st}">${st === 'ok' ? 'OK' : st === 'bad' ? 'Gap' : st === 'warn' ? 'To do' : '—'}</span></div>`).join('')}</div>
    <h3 style="margin:16px 2px 8px">Money by fund</h3>
    <div class="card pad">${funds.map(f => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line,#d6e6ee)"><span>${esc(f.label)}</span><b style="${f.v < 0 ? 'color:#c0392b' : ''}">${peso(f.v)}</b></div>`).join('')}
      <small class="muted" style="display:block;margin-top:6px">From approved entries. This month: ${peso(monthIn)} collected, ${peso(monthOut)} spent.</small></div>
    <h3 style="margin:16px 2px 8px">Who owes, and for how long</h3>
    <div class="card pad">${B.map(b => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:.9rem"><span>${b[0]}</span><b>${peso(b[1])} <small class="muted">· ${b[2]} student${b[2] === 1 ? '' : 's'}</small></b></div>
        <div class="prog"><i style="width:${b[1] / bMax * 100}%${b === B[3] || b === B[2] ? ';background:#c0392b' : ''}"></i></div></div>`).join('')}
      ${fineRows.length ? `<div style="margin-top:8px;font-size:.9rem;display:flex;justify-content:space-between"><span>Unpaid fines</span><b>${peso(fineRows.reduce((t, i) => t + i.owed, 0))} <small class="muted">· ${fineRows.length}</small></b></div>` : ''}</div>
    <h3 style="margin:16px 2px 8px">Last 8 weeks</h3>
    <div class="card pad"><div style="display:flex;gap:6px;align-items:flex-end;height:110px">${W.map(w => `<div style="flex:1;display:flex;gap:2px;align-items:flex-end;height:100%" title="${w.label}: collected ${peso(w.inn)}, spent ${peso(w.out)}"><i style="flex:1;background:#2a9d6f;height:${Math.max(2, w.inn / wMax * 100)}%;border-radius:3px 3px 0 0"></i><i style="flex:1;background:#d9a63c;height:${Math.max(2, w.out / wMax * 100)}%;border-radius:3px 3px 0 0"></i></div>`).join('')}</div>
      <div style="display:flex;gap:6px;margin-top:4px">${W.map(w => `<small class="muted" style="flex:1;text-align:center;font-size:.62rem">${w.label}</small>`).join('')}</div>
      <small class="muted" style="display:block;margin-top:8px"><span style="color:#2a9d6f">■</span> Collected &nbsp; <span style="color:#d9a63c">■</span> Spent</small></div>`;
  host.querySelectorAll('[data-d]').forEach(r => r.onclick = () => { const d = duties[+r.dataset.d]; if (readonly && d[4]) return; if (d[4] === 'ack') ackList(unack, mem); else if (d[3]) location.hash = d[3]; });
  host.querySelectorAll('[data-n]').forEach(r => r.onclick = () => { const n = needs[+r.dataset.n]; if (n.act) n.act(); else if (n.hash) location.hash = n.hash; });
}

/* payments that still have no acknowledgment: opening the receipt records that it was issued */
function ackList(list, mem) {
  modal(`<h3>Acknowledgments to issue</h3><p class="muted" style="margin:0 0 8px">Open each receipt and give it to the payer. Opening it records the acknowledgment as issued.</p>
    <div id="al">${list.slice(0, 20).map(e => `<div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="m"><b>${esc(mem[e.member_id] || e.payer_name || '—')}</b><small>${peso(e.amount)} · ${esc(e.receipt_no || '')} · ${fmtDate(e.occurred_at)}</small></div><button class="btn gold sm" data-rc="${e.id}">Receipt</button></div>`).join('')}</div>
    ${list.length > 20 ? `<small class="muted">Showing 20 of ${list.length}.</small>` : ''}<button class="btn ghost" id="cx" style="margin-top:10px;width:100%">Close</button>`, (m, close) => {
    m.querySelector('#cx').onclick = close;
    m.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => { showReceipt(b.dataset.rc).catch(x => toast(x.message, true)); sb.rpc('v2_entry_ack', { p_ids: [b.dataset.rc] }).then(() => { b.textContent = 'Issued ✓'; b.disabled = true; }, () => {}); });
  });
}
