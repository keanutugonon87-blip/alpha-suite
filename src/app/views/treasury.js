import { fundLabel, fundOptions, FUNDS, sb, db, watch, esc, peso, fmtDate, fmtDateTime, toast, toastUndo, modal, skeleton, resizeImage, safeWrite, uuid, printHTML, letterhead, askText, confirmDialog, initials, dayLabel } from '../core.js';
import { ymManila, net as netOf, balanceAt, needsSecond, findDuplicate } from '../money.js';
import { exportXLSX } from '../xlsx.js';
import { scanMember, showMemberCards, showReceipt } from '../qr.js';

const CATS_IN = ['Class Dues', 'Contribution', 'Fundraising', 'Donation', 'Other'];
const CATS_OUT = ['Supplies', 'Printing', 'Event Expenses', 'Transportation', 'Snacks / Food', 'Other'];

export async function mountTreasury(el, ctx) {
  const canWrite = ctx.can('mayor', 'treasurer'), isMayor = ctx.can('mayor');
  let curPeriod = null, qtext = '', view = 'current', filter = 'all', openPast = null, members = [], charges = [], allEntries = [], limit = 500;
  el.innerHTML = skeleton(5);

  async function draw() {
    const [mem, chg, periods, raw, flags, closes, lim] = await Promise.all([
      db(sb.from('v2_members').select('id,full_name').order('full_name')),
      db(sb.from('v2_charges').select('*').order('created_at')),
      db(sb.from('v2_periods').select('*').order('opened_at', { ascending: false })),
      db(sb.from('v2_entries').select('id,period_id,kind,category,member_id,payer_name,amount,method,gcash_ref,receipt_no,purpose,note,occurred_at,status,source,charge_id,fund,recorded_by,recorded_by_name,approved_by_name,void_reason').order('occurred_at', { ascending: false })),
      db(sb.from('v2_entries').select('id').not('receipt_image', 'is', null)),
      sb.from('v2_month_close').select('*').then(r => r.data || [], () => []),   // empty until the month-close SQL is run
      sb.from('v2_settings').select('value').eq('key', 'expense_second_approval').maybeSingle().then(r => r.data?.value, () => null),
    ]);
    limit = lim != null && lim !== '' && !isNaN(+lim) ? +lim : 500; const lockedMonths = new Set(closes.filter(c => c.status === 'closed').map(c => c.month));
    members = mem; charges = chg; const hasImg = new Set(flags.map(r => r.id));
    const nameOf = id => members.find(m => m.id === id)?.full_name;
    const entries = raw.map(e => ({ ...e, who: nameOf(e.member_id) || e.payer_name || '—', hasImg: hasImg.has(e.id), charge: charges.find(c => c.id === e.charge_id)?.title, fundK: e.fund || charges.find(c => c.id === e.charge_id)?.fund || '', locked: lockedMonths.has(ymManila(e.occurred_at)) }));
    allEntries = entries;
    const cur = periods.find(p => p.status === 'open'); curPeriod = cur; const past = periods.filter(p => p.status === 'closed');
    const curE = entries.filter(e => e.period_id === cur.id), ok = curE.filter(e => e.status === 'approved');
    const coll = ok.filter(e => e.kind === 'collection').reduce((s, e) => s + +e.amount, 0), exp = ok.filter(e => e.kind === 'expense').reduce((s, e) => s + +e.amount, 0);
    const bal = +cur.opening_balance + coll - exp, pendingN = curE.filter(e => e.status === 'pending').length;

    const canApprove = e => e.status === 'pending' && (needsSecond(e, limit) ? ctx.can('mayor', 'vice_mayor', 'auditor', 'treasurer') && e.recorded_by !== ctx.profile.user_id : isMayor);
    const rowHTML = (e, actions) => `<div class="row"><div class="lead"><span class="ini ${e.kind === 'expense' ? 'out' : ''}">${esc(initials(e.who))}</span><div class="m"><b>${esc(e.who)} <span class="tag ${e.status === 'approved' ? 'ok' : e.status === 'pending' ? 'warn' : 'bad'}">${e.status}</span>${e.locked ? ' <span class="tag" title="This month is closed">🔒</span>' : ''}${e.status === 'pending' && needsSecond(e, limit) ? ' <span class="tag warn" title="Big expense: another officer must approve it">needs a 2nd officer</span>' : ''}</b>
      <small>${esc(e.charge || e.category)} · ${esc(fundLabel(e.fundK))}${e.purpose && e.purpose !== e.charge ? ` · ${esc(e.purpose)}` : ''}${e.receipt_no ? ` · ${esc(e.receipt_no)}` : ''}${e.method === 'gcash' ? ' · GCash' : ''}${e.void_reason ? ` · voided: ${esc(e.void_reason)}` : ''}</small>
      <div class="acts">${e.hasImg ? `<button class="btn ghost sm" data-img="${e.id}">Photo</button>` : ''}${e.kind === 'collection' && e.status === 'approved' ? `<button class="btn ghost sm" data-rc="${e.id}">Receipt</button>` : ''}${actions && canApprove(e) ? (needsSecond(e, limit) && !e.hasImg ? '<span class="tag bad" title="Add a receipt photo first">no receipt photo</span>' : `<button class="btn gold sm" data-ok="${e.id}">Approve</button>`) : ''}${actions && canWrite && e.status !== 'voided' && !e.locked ? `<button class="btn ghost sm" data-void="${e.id}">Void</button>` : ''}</div></div></div>
      <div class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</div></div>`;
    const rows = (arr, actions) => {
      if (!arr.length) return '<div class="empty"><b>Nothing here yet</b>Entries you record will show up in this list.</div>';
      const g = new Map(); arr.forEach(e => { const k = dayLabel(e.occurred_at); g.set(k, [...(g.get(k) || []), e]); });
      return [...g].map(([d, es]) => `<div class="dayhead">${esc(d)}</div>${es.map(e => rowHTML(e, actions)).join('')}`).join('');
    };

    let body;
    if (view === 'current') {
      const shown = curE.filter(e => filter === 'all' || (filter === 'pending' ? e.status === 'pending' : e.kind === filter));
      const soon = charges.filter(c => !c.closed && c.due_on && (new Date(c.due_on) - Date.now()) / 864e5 <= 7).length;
      const pm = ymManila(new Date(Date.now() - 31 * 864e5)), prevOpen = entries.some(e => e.status === 'approved' && ymManila(e.occurred_at) === pm) && !lockedMonths.has(pm);
      const todo = [pendingN ? ['pending', `${pendingN} waiting for approval`] : null, soon ? ['due', `${soon} charge${soon > 1 ? 's' : ''} due within a week or late`] : null, prevOpen ? ['month', 'Last month is not closed yet'] : null].filter(Boolean);
      body = `${todo.length ? `<div class="todo" role="list" aria-label="To do">${todo.map(([k, t]) => `<button class="btn ghost sm" role="listitem" data-todo="${k}">${esc(t)}</button>`).join('')}</div>` : ''}<div class="grid"><div class="stat gold"><small>Balance</small><b>${peso(bal)}</b></div><div class="stat"><small>Opening</small><b>${peso(cur.opening_balance)}</b></div>
        <div class="stat"><small>Collected</small><b>${peso(coll)}</b></div><div class="stat"><small>Spent</small><b>${peso(exp)}</b></div></div>
        <div class="bar" style="margin-top:14px">${canWrite ? `<button class="btn gold" id="addIn">+ Collection</button><button class="btn" id="scan">Scan QR</button><button class="btn" id="addOut">+ Expense</button><button class="btn ghost" id="cards">QR cards</button>` : ''}
          <input id="q" type="search" placeholder="Search name, receipt, purpose" aria-label="Search entries" value="${esc(qtext)}" style="flex:1 1 150px;min-width:0"><select id="flt" style="width:auto"><option value="all">All</option><option value="collection">Collections</option><option value="expense">Expenses</option><option value="pending">Pending${pendingN ? ` (${pendingN})` : ''}</option></select></div>
        <div class="card"><h3 style="font-size:1rem;margin-bottom:6px">${esc(cur.name)}</h3>${rows(shown, true)}</div>
        <div class="bar"><button class="btn ghost" id="csv">Export ledger (Excel)</button><button class="btn ghost" id="rep">Period report</button><button class="btn ghost" id="mrep">Monthly report</button><button class="btn ghost" id="mclose">Month close${lockedMonths.size ? ` (${lockedMonths.size} 🔒)` : ''}</button>${isMayor ? '<button class="btn danger" id="close" style="margin-left:auto">Close period…</button>' : ''}</div>`;
    } else {
      body = past.length ? past.map(p => { const pe = entries.filter(e => e.period_id === p.id && e.status === 'approved');
        return `<div class="card"><div class="row" style="border:0;cursor:pointer" data-past="${p.id}"><div class="m"><b>${esc(p.name)}</b><small>Closed ${fmtDate(p.closed_at)} by ${esc(p.closed_by_name || '—')}</small></div>
          <div style="text-align:right"><div class="amt">${peso(p.closing_balance)}</div><small class="muted">in ${peso(p.collections_total)} · out ${peso(p.expenses_total)}</small></div></div>
          ${openPast === p.id ? `<div style="margin-top:8px">${rows(pe, false)}${Object.keys(p.liquidation_notes || {}).length ? `<h4 style="margin:12px 0 4px">Liquidation notes</h4>${Object.entries(p.liquidation_notes).map(([k, v]) => `<p class="muted" style="margin:2px 0"><b>${esc(k)}</b>: ${esc(v)}</p>`).join('')}` : ''}
          <div class="bar" style="margin-top:10px"><button class="btn ghost sm" data-rep="${p.id}">Print report</button></div></div>` : ''}</div>`; }).join('') : '<p class="empty">No past periods yet.</p>';
    }
    el.innerHTML = `<div class="seg"><button data-v="current" class="${view === 'current' ? 'on' : ''}">Current period</button><button data-v="past" class="${view === 'past' ? 'on' : ''}">Past periods (${past.length})</button></div>${body}
      ${canWrite && view === 'current' ? '<button class="btn gold fab" id="fab">+ Collection</button>' : ''}`;

    const $ = s => el.querySelector(s);
    const applyQ = () => { const q = qtext.trim().toLowerCase(), card = $('.card'); if (!card) return;
      let head = null, shownInDay = 0; const rowsEl = [...card.querySelectorAll('.dayhead, .row')];
      const flush = () => { if (head) head.hidden = !!q && !shownInDay; };
      rowsEl.forEach(n => { if (n.classList.contains('dayhead')) { flush(); head = n; shownInDay = 0; } else { const hit = !q || n.textContent.toLowerCase().includes(q); n.hidden = !hit; if (hit) shownInDay++; } }); flush(); };
    $('#q')?.addEventListener('input', e => { qtext = e.target.value; applyQ(); }); if (qtext) applyQ();
    el.querySelectorAll('[data-todo]').forEach(b => b.onclick = () => { const k = b.dataset.todo; if (k === 'pending') { filter = 'pending'; draw(); } else if (k === 'due') location.hash = '#/staff/balances'; else monthClose(entries, periods, closes); });
    const flt = $('#flt'); if (flt) { flt.value = filter; flt.onchange = () => { filter = flt.value; draw(); }; }
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { view = b.dataset.v; draw(); });
    el.querySelectorAll('[data-past]').forEach(b => b.onclick = () => { openPast = openPast === b.dataset.past ? null : b.dataset.past; draw(); });
    $('#addIn')?.addEventListener('click', () => entryForm('collection', cur));
    $('#fab')?.addEventListener('click', () => entryForm('collection', cur));
    $('#addOut')?.addEventListener('click', () => entryForm('expense', cur));
    $('#scan')?.addEventListener('click', async () => { const r = await scanMember(); if (r) { toast('Scanned: ' + r.name); entryForm('collection', cur, { member: r.id }); } });
    $('#cards')?.addEventListener('click', () => showMemberCards().catch(e => toast(e.message, true)));
    $('#close')?.addEventListener('click', () => closeForm(cur, bal, pendingN));
    $('#csv')?.addEventListener('click', async () => {
      const ok = entries.filter(e => e.status !== 'voided'), sum = k => ok.filter(e => e.kind === k && e.status === 'approved').reduce((a, e) => a + +e.amount, 0);
      const pname = e => periods.find(p => p.id === e.period_id)?.name || '';
      try { toast('Preparing Excel…'); await exportXLSX({ filename: `Alpha-Treasury-Ledger-${new Date().toISOString().slice(0, 10)}.xlsx`, by: ctx.profile.full_name, sheets: [
        { name: 'Ledger', title: 'Class Fund Ledger', subtitle: 'BSMT 1-Alpha · all periods', summary: [['Collected', sum('collection'), 'money'], ['Spent', sum('expense'), 'money'], ['Net', sum('collection') - sum('expense'), 'money'], ['Entries', entries.length]],
          columns: [{ label: 'Date', get: e => e.occurred_at, type: 'datetime' }, { label: 'Type', get: e => e.kind === 'expense' ? 'Expense' : 'Collection' }, { label: 'Student / payee', key: 'who', width: 28 }, { label: 'Category', key: 'category' }, { label: 'Charge', key: 'charge' }, { label: 'Fund', get: e => fundLabel(e.fundK), width: 24 },
            { label: 'Purpose', key: 'purpose', width: 30 }, { label: 'Amount', key: 'amount', type: 'money' }, { label: 'Method', key: 'method' }, { label: 'Receipt no.', key: 'receipt_no' }, { label: 'Status', key: 'status', type: 'status' }, { label: 'Period', get: pname, width: 24 }], rows: entries },
        { name: 'Periods', title: 'Collection Periods', subtitle: 'Opening, collections, expenses and closing balance', columns: [{ label: 'Period', key: 'name', width: 30 }, { label: 'Status', key: 'status', type: 'status' }, { label: 'Opening', key: 'opening_balance', type: 'money' }, { label: 'Collected', get: p => p.status === 'closed' ? p.collections_total : entries.filter(e => e.period_id === p.id && e.kind === 'collection' && e.status === 'approved').reduce((a, e) => a + +e.amount, 0), type: 'money', total: true },
          { label: 'Spent', get: p => p.status === 'closed' ? p.expenses_total : entries.filter(e => e.period_id === p.id && e.kind === 'expense' && e.status === 'approved').reduce((a, e) => a + +e.amount, 0), type: 'money', total: true }, { label: 'Closing balance', get: p => p.status === 'closed' ? p.closing_balance : bal, type: 'money' }], rows: periods }] }); toast('Excel ready'); }
      catch (e) { toast(e.message, true); } });
    $('#rep')?.addEventListener('click', () => report(cur, curE.filter(e => e.status === 'approved'), bal));
    $('#mrep')?.addEventListener('click', () => monthly(entries, periods, closes));
    $('#mclose')?.addEventListener('click', () => monthClose(entries, periods, closes));
    el.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { const p = periods.find(x => x.id === b.dataset.rep); report(p, entries.filter(e => e.period_id === p.id && e.status === 'approved'), p.closing_balance); });
    el.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => showReceipt(b.dataset.rc).catch(e => toast(e.message, true)));
    el.querySelectorAll('[data-img]').forEach(b => b.onclick = () => showPhoto(b.dataset.img));
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { try { await db(sb.rpc('v2_approve_entry', { p_id: b.dataset.ok })); toast('Approved'); draw().catch(() => {}); } catch (e) { toast(/function|schema cache/i.test(e.message) ? 'Approval is not switched on in the database yet. Run the v4 SQL.' : e.message, true); } });
    el.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => { const r = await askText('Void this entry', 'Reason', { ok: 'Void entry' }); if (!r) return;
      b.disabled = true;   // a void cannot be reversed once saved, so it waits a few seconds and can be cancelled
      toastUndo('Entry will be voided.', () => { b.disabled = false; toast('Cancelled. Nothing was voided.'); }, { ms: 6000,
        onExpire: () => db(sb.from('v2_entries').update({ status: 'voided', void_reason: r }).eq('id', b.dataset.void)).then(() => toast('Voided')).catch(e => { b.disabled = false; toast(e.message, true); }) }); });
  }


  /* Monthly report: every approved collection and expense in a calendar month, across periods, with fund totals. */
  function monthly(entries, periods, closes = []) {
    const ok = entries.filter(e => e.status === 'approved');
    const ym = ymManila;
    const label = k => new Date(k + '-15T12:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
    const months = [...new Set(ok.map(e => ym(e.occurred_at)))].sort().reverse(); const now = ym(new Date()); if (!months.includes(now)) months.unshift(now);
    const net = netOf;
    modal(`<h3>Monthly report</h3><p class="muted">Every approved collection and expense in the month, across periods, with totals per fund.</p>
      <label>Month</label><select id="mm">${months.map(k => `<option value="${k}">${label(k)}</option>`).join('')}</select>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="mgo" style="flex:1">Open report</button><button class="btn ghost" id="mcx">Cancel</button></div>`,
      (m, close) => {
        m.querySelector('#mcx').onclick = close;
        m.querySelector('#mgo').onclick = () => {
          const k = m.querySelector('#mm').value; close();
          const list = ok.filter(e => ym(e.occurred_at) === k), opening = balanceAt(entries, periods, k) - net(list);
          report({ name: 'Monthly report - ' + label(k), opening_balance: opening, liquidation_notes: {}, check: closes.find(c => c.month === k) }, list, opening + net(list));
        };
      });
  }

  /* Month close: someone counts the money, a different officer (the Mayor) closes the month, and its entries are locked. */
  function monthClose(entries, periods, closes) {
    const by = Object.fromEntries(closes.map(c => [c.month, c]));
    const cur = ymManila(new Date());
    const months = [...new Set([...entries.filter(e => e.status === 'approved').map(e => ymManila(e.occurred_at)), ...Object.keys(by), cur])].sort().reverse().slice(0, 12);
    const label = k => new Date(k + '-15T12:00:00+08:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
    const canCount = ctx.can('mayor', 'vice_mayor', 'treasurer', 'auditor');
    const rowFor = k => {
      const c = by[k], st = c ? c.status : 'open', bal = balanceAt(entries, periods, k);
      const tag = st === 'closed' ? '<span class="tag ok">closed 🔒</span>' : st === 'checked' ? '<span class="tag warn">counted</span>' : st === 'reopened' ? '<span class="tag bad">reopened</span>' : '<span class="tag">open</span>';
      const info = c && st !== 'open' ? `<small>${st === 'closed' ? `Closed ${fmtDate(c.closed_at)} by ${esc(c.closed_by_name || '—')} · ` : ''}Counted ${peso(c.cash_counted)} by ${esc(c.checked_by_name || '—')}${+c.diff ? ` · off by ${peso(c.diff)}` : ' · matches'}${c.note ? ` · ${esc(c.note)}` : ''}${st === 'reopened' && c.reopen_reason ? ` · reopened: ${esc(c.reopen_reason)}` : ''}</small>` : '';
      const inMonth = entries.filter(e => ymManila(e.occurred_at) === k && e.status !== 'voided');
      const nPend = inMonth.filter(e => e.status === 'pending').length, noRcpt = inMonth.filter(e => e.status === 'approved' && e.kind === 'expense' && !e.hasImg).length;
      const ticked = (() => { try { return localStorage.getItem('alpha-mc-' + k) === '1'; } catch { return false; } })();
      const steps = st === 'closed' ? [] : [
        [!nPend, nPend ? `${nPend} entr${nPend === 1 ? 'y is' : 'ies are'} still waiting for approval` : 'Every entry this month is decided', nPend ? 'bad' : 'ok'],
        [!noRcpt, noRcpt ? `${noRcpt} expense${noRcpt === 1 ? ' has' : 's have'} no receipt photo (add one if you have it)` : 'Every expense has a receipt photo', noRcpt ? 'warn' : 'ok'],
        [st === 'checked', st === 'checked' ? 'Money counted' : 'Count the cash and GCash', st === 'checked' ? 'ok' : 'bad'],
        [st === 'checked' && !+(c.diff || 0), st === 'checked' ? (+(c.diff || 0) ? `The count is off by ${peso(c.diff)}. Explain it in the note` : 'The count matches the records') : 'The count should match the records', st === 'checked' ? (+(c.diff || 0) ? 'warn' : 'ok') : 'bad'],
        [ticked, 'Monthly report reviewed (tick below)', ticked ? 'ok' : 'bad'],
      ];
      const chk = steps.length ? `<details class="chk" style="margin-top:6px"${steps.some(x => !x[0]) ? ' open' : ''}><summary><small>Checklist · ${steps.filter(x => x[0]).length} of ${steps.length} done</small></summary>${steps.map(x => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span class="tag ${x[2]}">${x[0] ? '✓' : x[2] === 'warn' ? '!' : '○'}</span><small>${esc(x[1])}</small></div>`).join('')}
        <label style="display:flex;gap:8px;align-items:center;margin-top:6px;cursor:pointer"><input type="checkbox" data-mc="${k}" style="width:auto"${ticked ? ' checked' : ''}><small>I reviewed the monthly report for ${label(k)}</small></label></details>` : '';
      return `<div class="row stk"><div class="m"><b>${label(k)} ${tag}</b><small>Fund balance at month end: ${peso(bal)}</small>${info}${chk}</div>
        <div class="acts">${canCount && st !== 'closed' ? `<button class="btn ghost sm" data-v="${k}">${st === 'checked' ? 'Count again' : 'Count the money'}</button>` : ''}${isMayor && st === 'checked' ? `<button class="btn gold sm" data-c="${k}">Close month</button>` : ''}${isMayor && st === 'closed' ? `<button class="btn ghost sm" data-r="${k}">Reopen</button>` : ''}</div></div>`;
    };
    modal(`<h3>Month close</h3><p class="muted" style="margin:0 0 8px">Count the cash and GCash on hand and compare it with the records. After a different officer closes the month, its entries are locked. Only the Mayor can reopen it.</p>
      <div class="card" style="max-height:52vh;overflow:auto">${months.map(rowFor).join('')}</div><button class="btn ghost" id="mx" style="width:100%;margin-top:12px">Close</button><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#mx').onclick = close;
      const run = async (fn, ok) => { try { await fn(); toast(ok); close(); draw().catch(() => {}); } catch (e) { m.querySelector('#er').textContent = /function|schema cache/i.test(e.message) ? 'Month close is not switched on in the database yet. Run the v4 SQL.' : e.message; } };
      m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { const k = b.dataset.v, expect = balanceAt(entries, periods, k); close();
        modal(`<h3>Count the money · ${label(k)}</h3><p class="muted">The records say the fund should hold <b>${peso(expect)}</b>. Count the cash and the GCash balance together and enter the total.</p>
          <form id="vf"><label>Money counted (₱)</label><input name="c" type="number" step="0.01" min="0" required inputmode="decimal"><label>Note (needed if it does not match)</label><input name="n" maxlength="200">
          <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save count</button><button type="button" class="btn ghost" id="vx">Cancel</button></div><div class="err" id="er2"></div></form>`, (m2, close2) => {
          m2.querySelector('#vx').onclick = close2;
          m2.querySelector('#vf').onsubmit = async ev => { ev.preventDefault(); const f = new FormData(ev.target);
            try { const r = await db(sb.rpc('v2_verify_month', { p_month: k, p_cash: +f.get('c'), p_note: f.get('n') || '' })); toast(+r.diff ? `Saved. Off by ${peso(r.diff)}` : 'Saved. It matches the records.'); close2(); draw().catch(() => {}); }
            catch (e) { m2.querySelector('#er2').textContent = /function|schema cache/i.test(e.message) ? 'Month close is not switched on in the database yet. Run the v4 SQL.' : e.message; } };
        }); });
      m.querySelectorAll('[data-mc]').forEach(c => c.onchange = () => { try { c.checked ? localStorage.setItem('alpha-mc-' + c.dataset.mc, '1') : localStorage.removeItem('alpha-mc-' + c.dataset.mc); } catch { /* ignore */ } });
      m.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => { const k = b.dataset.c, np = entries.filter(e => ymManila(e.occurred_at) === k && e.status === 'pending').length;
        if (np && !await confirmDialog(`${np} entr${np === 1 ? 'y is' : 'ies are'} still waiting for approval in this month. Closing locks the month, so decide them first or they cannot be approved later.`, { ok: 'Close anyway', danger: true, title: 'Close with entries waiting?' })) return;
        run(() => db(sb.rpc('v2_close_month', { p_month: k })), 'Month closed and locked'); });
      m.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { const why = await askText('Reopen this month', 'Reason', { ok: 'Reopen' }); if (!why) return; run(() => db(sb.rpc('v2_reopen_month', { p_month: b.dataset.r, p_reason: why })), 'Month reopened'); });
    });
  }

  function report(p, list, endBal) {
    const inn = list.filter(e => e.kind === 'collection'), out = list.filter(e => e.kind === 'expense');
    const sum = a => a.reduce((s, e) => s + +e.amount, 0);
    const tbl = a => `<table><thead><tr><th>Date</th><th>Name / payee</th><th>For</th><th>Fund</th><th class="r">Amount</th></tr></thead><tbody>${a.map(e => `<tr><td>${fmtDate(e.occurred_at)}</td><td>${esc(e.who)}</td><td>${esc(e.charge || e.purpose || e.category)}</td><td>${esc(fundLabel(e.fundK))}</td><td class="r">${peso(e.amount)}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}</tbody></table>`;
    const byFund = [...FUNDS.map(f => f.k), ''].map(k => ({ name: fundLabel(k), collected: sum(inn.filter(e => (e.fundK || '') === k)), spent: sum(out.filter(e => (e.fundK || '') === k)) })).filter(r => r.collected || r.spent || r.name !== 'Unassigned').map(r => ({ ...r, net: r.collected - r.spent }));
    const fundTbl = `<h2>By fund</h2><table><thead><tr><th>Fund</th><th class="r">Collected</th><th class="r">Spent</th><th class="r">Net</th></tr></thead><tbody>${byFund.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${peso(r.collected)}</td><td class="r">${peso(r.spent)}</td><td class="r">${peso(r.net)}</td></tr>`).join('')}</tbody></table>`;
    const doPrint = () => printHTML(p.name, `${letterhead(p.name, 'Class Fund report · BSMT 1-Alpha')}<div class="sum"><div>Opening<b>${peso(p.opening_balance)}</b></div><div>Collected<b>${peso(sum(inn))}</b></div><div>Spent<b>${peso(sum(out))}</b></div><div>Balance<b>${peso(endBal)}</b></div></div>
      ${fundTbl}<h2>Collections (${inn.length})</h2>${tbl(inn)}<h2>Expenses (${out.length})</h2>${tbl(out)}
      ${Object.keys(p.liquidation_notes || {}).length ? `<h2>Liquidation notes</h2>${Object.entries(p.liquidation_notes).map(([k, v]) => `<p><b>${esc(k)}</b>: ${esc(v)}</p>`).join('')}` : ''}${p.check && p.check.status !== 'open' ? `<h2>Month check</h2><p>${p.check.status === 'closed' ? `Month closed on <b>${fmtDate(p.check.closed_at)}</b> by <b>${esc(p.check.closed_by_name || '—')}</b>. ` : 'Money counted, month not yet closed. '}Counted <b>${peso(p.check.cash_counted)}</b> by <b>${esc(p.check.checked_by_name || '—')}</b>${+p.check.diff ? `, <b>${peso(Math.abs(p.check.diff))}</b> ${p.check.diff < 0 ? 'short' : 'over'} the records` : ', matching the records'}.${p.check.note ? ' Note: ' + esc(p.check.note) : ''}</p>` : ''}<p style="margin-top:34px">Prepared by: <b>${esc(ctx.profile.full_name)}</b></p>`);
    const doXlsx = async () => {
      const cols = [{ label: 'Date', get: e => e.occurred_at, type: 'datetime' }, { label: 'Name / payee', key: 'who', width: 28 }, { label: 'For', get: e => e.charge || e.purpose || e.category, width: 30 }, { label: 'Fund', get: e => fundLabel(e.fundK), width: 24 }, { label: 'Receipt no.', key: 'receipt_no' }, { label: 'Amount', key: 'amount', type: 'money', total: true }];
      const summary = [['Opening', +p.opening_balance || 0, 'money'], ['Collected', sum(inn), 'money'], ['Spent', sum(out), 'money'], ['Balance', +endBal || 0, 'money']];
      try { toast('Preparing Excel…'); await exportXLSX({ filename: `Alpha-Report-${p.name.replace(/[^\w]+/g, '-')}.xlsx`, by: ctx.profile.full_name, sheets: [
        { name: 'Collections', title: p.name, subtitle: 'Class Fund report · collections', summary, columns: cols, rows: inn }, { name: 'Expenses', title: p.name, subtitle: 'Class Fund report · expenses', summary, columns: cols, rows: out },
          { name: 'By fund', title: p.name, subtitle: 'Collected and spent per fund', summary, columns: [{ label: 'Fund', key: 'name', width: 30 }, { label: 'Collected', key: 'collected', type: 'money', total: true }, { label: 'Spent', key: 'spent', type: 'money', total: true }, { label: 'Net', key: 'net', type: 'money', total: true }], rows: byFund }] }); toast('Excel ready'); } catch (e) { toast(e.message, true); }
    };
    modal(`<h3>${esc(p.name)}</h3><p class="muted">Choose a format for this period's report.</p><div style="display:grid;gap:8px;margin-top:10px"><button class="btn gold" id="rp">Print / save as PDF</button><button class="btn" id="rx">Download Excel (.xlsx)</button><button class="btn ghost" id="rc">Cancel</button></div>`,
      (m, close) => { m.querySelector('#rp').onclick = () => { close(); doPrint(); }; m.querySelector('#rx').onclick = () => { close(); doXlsx(); }; m.querySelector('#rc').onclick = close; });
  }

  async function showPhoto(id) {
    try {
      const row = await db(sb.from('v2_entries').select('receipt_image').eq('id', id).single()); let src = row.receipt_image;
      if (src && !src.startsWith('data:')) { const { data, error } = await sb.storage.from('v2-receipts').createSignedUrl(src, 300); if (error) throw error; src = data.signedUrl; }
      modal(`<img src="${src}" style="width:100%;border-radius:10px" alt="Receipt photo">`);
    } catch (e) { toast(e.message, true); }
  }

  /* Exposed so the Balances tab can open the same form pre-filled. */
  function entryForm(kind, cur, pre = {}) {
    const cats = kind === 'collection' ? CATS_IN : CATS_OUT, openCharges = charges.filter(c => !c.closed);
    modal(`<h3>${kind === 'collection' ? 'Record collection' : 'Record expense'}</h3><form id="ef">
      ${kind === 'collection' ? `<label>Student</label><select name="member" required><option value="">Select…</option>${members.map(m => `<option value="${m.id}"${m.id === pre.member ? ' selected' : ''}>${esc(m.full_name)}</option>`).join('')}</select>
        <label>Charge (optional)</label><select name="charge"><option value="">— none —</option>${openCharges.map(c => `<option value="${c.id}" data-amt="${c.amount}"${c.id === pre.charge ? ' selected' : ''}>${esc(c.title)} (${peso(c.amount)})</option>`).join('')}</select>`
        : `<label>Paid to / vendor</label><input name="payer" required>`}
      <div id="fw"><label>Fund</label><select name="fund">${fundOptions('')}</select></div>
      <label>Category</label><select name="cat">${cats.map(c => `<option>${c}</option>`).join('')}</select>
      <label>Amount (₱)</label><input name="amt" type="number" step="0.01" min="0.01" required inputmode="decimal" value="${pre.amount || ''}">
      <label>Purpose / note</label><input name="purpose">
      ${kind === 'collection' ? `<label>Payment method</label><div class="segpay" role="radiogroup"><label><input type="radio" name="method" value="cash" checked><span>💵 Cash</span></label><label><input type="radio" name="method" value="gcash"><span>📱 GCash</span></label></div><div id="gc" style="display:none"><label>GCash reference no.</label><input name="gref"></div>` : ''}
      <label>Receipt photo${kind === 'expense' && limit > 0 ? ` (required for expenses of ${peso(limit)} or more)` : ' (optional)'}</label><input name="img" type="file" accept="image/*">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelectorAll('[name=method]').forEach(r => r.onchange = () => { m.querySelector('#gc').style.display = m.querySelector('[name=method]:checked')?.value === 'gcash' ? 'block' : 'none'; });
      const chSel = m.querySelector('[name=charge]'), amt = m.querySelector('[name=amt]');
      const fw = m.querySelector('#fw');
      const syncFund = () => { if (chSel && chSel.value) { fw.style.display = 'none'; } else fw.style.display = ''; };
      if (chSel) { chSel.addEventListener('change', syncFund); syncFund(); }
      if (chSel) chSel.onchange = () => { const o = chSel.selectedOptions[0]; if (o?.dataset.amt && !amt.value) amt.value = o.dataset.amt; if (o?.value) m.querySelector('[name=purpose]').value ||= o.textContent.replace(/ \(.*\)$/, ''); };
      m.querySelector('#ef').onsubmit = async ev => {
        ev.preventDefault(); const f = new FormData(ev.target), btn = ev.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const dup = findDuplicate(allEntries, { kind, amount: +f.get('amt'), member_id: f.get('member') || null, payer_name: f.get('payer') || null, charge_id: f.get('charge') || null });
          if (dup && !(await confirmDialog(`The same amount (${peso(dup.amount)}) for ${dup.who} was already recorded a few minutes ago${dup.receipt_no ? ` (${dup.receipt_no})` : ''}. Save it again?`, { ok: 'Save anyway', title: 'Possible duplicate' }))) { btn.disabled = false; btn.textContent = 'Save'; return; }
          const file0 = f.get('img');
          if (kind === 'expense' && limit > 0 && +f.get('amt') >= limit && !(file0 && file0.size)) throw new Error(`Add a receipt photo. Expenses of ${peso(limit)} or more need one.`);
          const id = uuid(), file = f.get('img'), photo = file && file.size ? await resizeImage(file) : null;
          const res = await safeWrite('v2_entries', { id, period_id: cur.id, kind, category: f.get('cat'), member_id: f.get('member') || null, charge_id: f.get('charge') || null, fund: f.get('charge') ? (charges.find(c => c.id === f.get('charge'))?.fund || null) : (f.get('fund') || null), payer_name: f.get('payer') || null,
            amount: +f.get('amt'), method: f.get('method') || 'cash', gcash_ref: f.get('gref') || null, purpose: f.get('purpose') || '', recorded_by_name: ctx.profile.full_name,
            status: isMayor ? 'approved' : 'pending', approved_by_name: isMayor ? ctx.profile.full_name : null, source: 'manual' }, photo);
          close();
          if (res.queued) toast('No signal — saved on this device, will send automatically');
          else { toast(isMayor ? 'Saved' : 'Saved — waiting for Mayor approval'); if (kind === 'collection' && isMayor) showReceipt(id).catch(() => {}); }
          draw().catch(() => {});
        } catch (e) { m.querySelector('#er').textContent = e.message; btn.disabled = false; btn.textContent = 'Save'; }
      };
    });
  }

  function closeForm(cur, bal, pendingN) {
    modal(`<h3>Close "${esc(cur.name)}"</h3><p class="muted">Balance of <b>${peso(bal)}</b> carries forward.${pendingN ? ` ${pendingN} pending entr${pendingN > 1 ? 'ies' : 'y'} will move to the new period.` : ''} This cannot be undone.</p>
      <label>Name of the next period</label><input id="nn" placeholder="e.g. Foundation Week Collection">
      <label>Type your full name (${esc(ctx.profile.full_name)}) to confirm</label><input id="cn">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn danger" id="go" style="flex:1">Close period</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#go').onclick = async () => {
        const nn = m.querySelector('#nn').value.trim();
        if (!nn) return void (m.querySelector('#er').textContent = 'Name the next period.');
        if (m.querySelector('#cn').value.trim().toLowerCase() !== ctx.profile.full_name.toLowerCase()) return void (m.querySelector('#er').textContent = 'Name does not match.');
        try { await db(sb.rpc('v2_close_period', { p_next_name: nn })); toast('Period closed'); close(); view = 'past'; draw(); } catch (e) { m.querySelector('#er').textContent = e.message; }
      };
    });
  }
  await draw();
  const stop = watch(['v2_entries', 'v2_periods', 'v2_charges'], () => draw().catch(() => {}));
  try { // "Collect" shortcut from the Balances tab
    const pre = JSON.parse(sessionStorage.getItem('alpha-prefill') || 'null'); sessionStorage.removeItem('alpha-prefill');
    if (pre && canWrite && curPeriod) entryForm('collection', curPeriod, pre);
  } catch { /* ignore */ }
  return stop;
}
