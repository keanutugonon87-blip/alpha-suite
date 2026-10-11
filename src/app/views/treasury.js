import { fundLabel, fundOptions, FUNDS, sb, db, watch, esc, peso, fmtDate, fmtDateTime, toast, modal, skeleton, resizeImage, safeWrite, uuid, printHTML, letterhead, askText, initials, dayLabel } from '../core.js';
import { exportXLSX } from '../xlsx.js';
import { scanMember, showMemberCards, showReceipt } from '../qr.js';

const CATS_IN = ['Class Dues', 'Contribution', 'Fundraising', 'Donation', 'Other'];
const CATS_OUT = ['Supplies', 'Printing', 'Event Expenses', 'Transportation', 'Snacks / Food', 'Other'];

export async function mountTreasury(el, ctx) {
  const canWrite = ctx.can('mayor', 'treasurer'), isMayor = ctx.can('mayor');
  let curPeriod = null, view = 'current', filter = 'all', openPast = null, members = [], charges = [];
  el.innerHTML = skeleton(5);

  async function draw() {
    const [mem, chg, periods, raw, flags] = await Promise.all([
      db(sb.from('v2_members').select('id,full_name').order('full_name')),
      db(sb.from('v2_charges').select('*').order('created_at')),
      db(sb.from('v2_periods').select('*').order('opened_at', { ascending: false })),
      db(sb.from('v2_entries').select('id,period_id,kind,category,member_id,payer_name,amount,method,gcash_ref,receipt_no,purpose,note,occurred_at,status,source,charge_id,fund,recorded_by_name,approved_by_name,void_reason').order('occurred_at', { ascending: false })),
      db(sb.from('v2_entries').select('id').not('receipt_image', 'is', null)),
    ]);
    members = mem; charges = chg; const hasImg = new Set(flags.map(r => r.id));
    const nameOf = id => members.find(m => m.id === id)?.full_name;
    const entries = raw.map(e => ({ ...e, who: nameOf(e.member_id) || e.payer_name || '—', hasImg: hasImg.has(e.id), charge: charges.find(c => c.id === e.charge_id)?.title, fundK: e.fund || charges.find(c => c.id === e.charge_id)?.fund || '' }));
    const cur = periods.find(p => p.status === 'open'); curPeriod = cur; const past = periods.filter(p => p.status === 'closed');
    const curE = entries.filter(e => e.period_id === cur.id), ok = curE.filter(e => e.status === 'approved');
    const coll = ok.filter(e => e.kind === 'collection').reduce((s, e) => s + +e.amount, 0), exp = ok.filter(e => e.kind === 'expense').reduce((s, e) => s + +e.amount, 0);
    const bal = +cur.opening_balance + coll - exp, pendingN = curE.filter(e => e.status === 'pending').length;

    const rowHTML = (e, actions) => `<div class="row"><div class="lead"><span class="ini ${e.kind === 'expense' ? 'out' : ''}">${esc(initials(e.who))}</span><div class="m"><b>${esc(e.who)} <span class="tag ${e.status === 'approved' ? 'ok' : e.status === 'pending' ? 'warn' : 'bad'}">${e.status}</span></b>
      <small>${esc(e.charge || e.category)} · ${esc(fundLabel(e.fundK))}${e.purpose && e.purpose !== e.charge ? ` · ${esc(e.purpose)}` : ''}${e.receipt_no ? ` · ${esc(e.receipt_no)}` : ''}${e.method === 'gcash' ? ' · GCash' : ''}${e.void_reason ? ` · voided: ${esc(e.void_reason)}` : ''}</small>
      <div class="acts">${e.hasImg ? `<button class="btn ghost sm" data-img="${e.id}">Photo</button>` : ''}${e.kind === 'collection' && e.status === 'approved' ? `<button class="btn ghost sm" data-rc="${e.id}">Receipt</button>` : ''}${actions && isMayor && e.status === 'pending' ? `<button class="btn gold sm" data-ok="${e.id}">Approve</button>` : ''}${actions && canWrite && e.status !== 'voided' ? `<button class="btn ghost sm" data-void="${e.id}">Void</button>` : ''}</div></div></div>
      <div class="amt ${e.kind === 'expense' ? 'out' : 'in'}">${e.kind === 'expense' ? '−' : '+'}${peso(e.amount)}</div></div>`;
    const rows = (arr, actions) => {
      if (!arr.length) return '<div class="empty"><b>Nothing here yet</b>Entries you record will show up in this list.</div>';
      const g = new Map(); arr.forEach(e => { const k = dayLabel(e.occurred_at); g.set(k, [...(g.get(k) || []), e]); });
      return [...g].map(([d, es]) => `<div class="dayhead">${esc(d)}</div>${es.map(e => rowHTML(e, actions)).join('')}`).join('');
    };

    let body;
    if (view === 'current') {
      const shown = curE.filter(e => filter === 'all' || (filter === 'pending' ? e.status === 'pending' : e.kind === filter));
      body = `<div class="grid"><div class="stat gold"><small>Balance</small><b>${peso(bal)}</b></div><div class="stat"><small>Opening</small><b>${peso(cur.opening_balance)}</b></div>
        <div class="stat"><small>Collected</small><b>${peso(coll)}</b></div><div class="stat"><small>Spent</small><b>${peso(exp)}</b></div></div>
        <div class="bar" style="margin-top:14px">${canWrite ? `<button class="btn gold" id="addIn">+ Collection</button><button class="btn" id="scan">Scan QR</button><button class="btn" id="addOut">+ Expense</button><button class="btn ghost" id="cards">QR cards</button>` : ''}
          <select id="flt" style="width:auto;margin-left:auto"><option value="all">All</option><option value="collection">Collections</option><option value="expense">Expenses</option><option value="pending">Pending${pendingN ? ` (${pendingN})` : ''}</option></select></div>
        <div class="card"><h3 style="font-size:1rem;margin-bottom:6px">${esc(cur.name)}</h3>${rows(shown, true)}</div>
        <div class="bar"><button class="btn ghost" id="csv">Export ledger (Excel)</button><button class="btn ghost" id="rep">Period report</button>${isMayor ? '<button class="btn danger" id="close" style="margin-left:auto">Close period…</button>' : ''}</div>`;
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
    el.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { const p = periods.find(x => x.id === b.dataset.rep); report(p, entries.filter(e => e.period_id === p.id && e.status === 'approved'), p.closing_balance); });
    el.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => showReceipt(b.dataset.rc).catch(e => toast(e.message, true)));
    el.querySelectorAll('[data-img]').forEach(b => b.onclick = () => showPhoto(b.dataset.img));
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { try { await db(sb.from('v2_entries').update({ status: 'approved', approved_by_name: ctx.profile.full_name }).eq('id', b.dataset.ok)); toast('Approved'); } catch (e) { toast(e.message, true); } });
    el.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => { const r = await askText('Void this entry', 'Reason', { ok: 'Void entry' }); if (!r) return;
      db(sb.from('v2_entries').update({ status: 'voided', void_reason: r }).eq('id', b.dataset.void)).then(() => toast('Voided')).catch(e => toast(e.message, true)); });
  }

  function report(p, list, endBal) {
    const inn = list.filter(e => e.kind === 'collection'), out = list.filter(e => e.kind === 'expense');
    const sum = a => a.reduce((s, e) => s + +e.amount, 0);
    const tbl = a => `<table><thead><tr><th>Date</th><th>Name / payee</th><th>For</th><th>Fund</th><th class="r">Amount</th></tr></thead><tbody>${a.map(e => `<tr><td>${fmtDate(e.occurred_at)}</td><td>${esc(e.who)}</td><td>${esc(e.charge || e.purpose || e.category)}</td><td>${esc(fundLabel(e.fundK))}</td><td class="r">${peso(e.amount)}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}</tbody></table>`;
    const byFund = [...FUNDS.map(f => f.k), ''].map(k => ({ name: fundLabel(k), collected: sum(inn.filter(e => (e.fundK || '') === k)), spent: sum(out.filter(e => (e.fundK || '') === k)) })).filter(r => r.collected || r.spent || r.name !== 'Unassigned').map(r => ({ ...r, net: r.collected - r.spent }));
    const fundTbl = `<h2>By fund</h2><table><thead><tr><th>Fund</th><th class="r">Collected</th><th class="r">Spent</th><th class="r">Net</th></tr></thead><tbody>${byFund.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${peso(r.collected)}</td><td class="r">${peso(r.spent)}</td><td class="r">${peso(r.net)}</td></tr>`).join('')}</tbody></table>`;
    const doPrint = () => printHTML(p.name, `${letterhead(p.name, 'Class Fund report · BSMT 1-Alpha')}<div class="sum"><div>Opening<b>${peso(p.opening_balance)}</b></div><div>Collected<b>${peso(sum(inn))}</b></div><div>Spent<b>${peso(sum(out))}</b></div><div>Balance<b>${peso(endBal)}</b></div></div>
      ${fundTbl}<h2>Collections (${inn.length})</h2>${tbl(inn)}<h2>Expenses (${out.length})</h2>${tbl(out)}
      ${Object.keys(p.liquidation_notes || {}).length ? `<h2>Liquidation notes</h2>${Object.entries(p.liquidation_notes).map(([k, v]) => `<p><b>${esc(k)}</b>: ${esc(v)}</p>`).join('')}` : ''}<p style="margin-top:34px">Prepared by: <b>${esc(ctx.profile.full_name)}</b></p>`);
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
      ${kind === 'collection' ? `<label>Payment method</label><select name="method"><option value="cash">Cash</option><option value="gcash">GCash</option></select><div id="gc" style="display:none"><label>GCash reference no.</label><input name="gref"></div>` : ''}
      <label>Receipt photo (optional)</label><input name="img" type="file" accept="image/*">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const sel = m.querySelector('[name=method]'); if (sel) sel.onchange = () => m.querySelector('#gc').style.display = sel.value === 'gcash' ? 'block' : 'none';
      const chSel = m.querySelector('[name=charge]'), amt = m.querySelector('[name=amt]');
      const fw = m.querySelector('#fw');
      const syncFund = () => { if (chSel && chSel.value) { fw.style.display = 'none'; } else fw.style.display = ''; };
      if (chSel) { chSel.addEventListener('change', syncFund); syncFund(); }
      if (chSel) chSel.onchange = () => { const o = chSel.selectedOptions[0]; if (o?.dataset.amt && !amt.value) amt.value = o.dataset.amt; if (o?.value) m.querySelector('[name=purpose]').value ||= o.textContent.replace(/ \(.*\)$/, ''); };
      m.querySelector('#ef').onsubmit = async ev => {
        ev.preventDefault(); const f = new FormData(ev.target), btn = ev.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
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
