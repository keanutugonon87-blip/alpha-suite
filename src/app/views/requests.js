import { sb, db, watch, esc, peso, fmtDate, fmtDateTime, toast, modal, skeleton, confirmDialog, printHTML, letterhead, FUNDS, fundLabel, ROLE_LABEL } from '../core.js';

/* Fund Budget Requests.
   Treasurer fills in the form and signs, then sends it to the President (Mayor).
   The President approves (and signs) or returns it with a comment.
   The Secretary files the approved request, and a copy goes into Documents.
   Expenses can then be linked to an approved request in Treasury. Everyone on staff can read; each step is limited to its own officer. */
const CATS = ['Event Expenses', 'Supplies', 'Printing', 'Transportation', 'Snacks / Food', 'Other'];
const STATUS = { draft: ['Draft', ''], submitted: ['Waiting for the President', 'warn'], returned: ['Returned', 'bad'], approved: ['Approved · to be filed', 'ok'], filed: ['Filed', 'ok'] };
const needV24 = e => /relation|schema cache|does not exist|could not find|function/i.test(e.message || '') ? 'Run the v24 SQL in Supabase first (supabase/v24_budget_requests.sql).' : e.message;

/* a small box to draw a signature with a finger or mouse; returns a function that gives the picture ('' if empty) */
function sigPad(box) {
  box.innerHTML = '<canvas width="300" height="110" style="width:100%;max-width:320px;height:110px;border:1.5px dashed #9fb3c8;border-radius:10px;background:#fff;touch-action:none"></canvas><button type="button" class="btn ghost sm" data-clr style="margin-top:4px">Clear</button>';
  const c = box.querySelector('canvas'), x = c.getContext('2d'); let down = false, drew = false;
  x.lineWidth = 2.2; x.lineCap = 'round'; x.strokeStyle = '#0c1f5c';
  const pos = e => { const r = c.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return [(p.clientX - r.left) * c.width / r.width, (p.clientY - r.top) * c.height / r.height]; };
  const start = e => { e.preventDefault(); down = true; const [a, b] = pos(e); x.beginPath(); x.moveTo(a, b); };
  const move = e => { if (!down) return; e.preventDefault(); const [a, b] = pos(e); x.lineTo(a, b); x.stroke(); drew = true; };
  const end = () => { down = false; };
  c.addEventListener('pointerdown', start); c.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
  box.querySelector('[data-clr]').onclick = () => { x.clearRect(0, 0, c.width, c.height); drew = false; };
  return () => drew ? c.toDataURL('image/png') : '';
}

export async function mountRequests(el, ctx) {
  const isTre = ctx.can('treasurer'), isMayor = ctx.can('mayor') || ctx.profile.role === 'vp_internal', canFile = ctx.can('secretary', 'mayor');
  let reqs = [], liqs = [], balances = {}, only = 'all';

  async function load() {
    try { reqs = await db(sb.from('v2_budget_requests').select('*').order('created_at', { ascending: false })); }
    catch (e) { el.innerHTML = `<div class="card pad"><p class="empty">${esc(needV24(e))}</p></div>`; return; }
    liqs = await db(sb.from('v2_liquidations').select('*')).catch(() => []);   // empty until the v25 SQL is run
    const ent = await db(sb.from('v2_entries').select('kind,amount,fund,status').eq('status', 'approved')).catch(() => []);
    balances = {}; ent.forEach(e => { const k = e.fund || ''; balances[k] = (balances[k] || 0) + (e.kind === 'collection' ? +e.amount : -e.amount); });
    draw();
  }
  const liqOf = r => liqs.find(l => l.request_id === r.id);
  const LIQ = { draft: ['Liquidation in progress', ''], submitted: ['Liquidation: waiting for the President', 'warn'], returned: ['Liquidation returned', 'bad'], approved: ['Liquidation: waiting for the Auditor', 'warn'], audited: ['Liquidation: audited, to be filed', 'ok'], filed: ['Liquidation filed', 'ok'] };
  const mine = r => (isTre && ['draft', 'returned'].includes(r.status)) || (isMayor && r.status === 'submitted') || (canFile && r.status === 'approved')
    || (['approved', 'filed'].includes(r.status) && (() => { const l = liqOf(r); return (isTre && (!l || ['draft', 'returned'].includes(l.status))) || (isMayor && l?.status === 'submitted') || (ctx.can('auditor') && l?.status === 'approved') || (canFile && l?.status === 'audited'); })());

  function draw() {
    const todo = reqs.filter(mine), shown = reqs.filter(r => only === 'all' || (only === 'todo' ? mine(r) : r.status === only));
    el.innerHTML = `<div class="bar">${isTre ? '<button class="btn gold" id="nr">+ New budget request</button>' : ''}
      <select id="fl" style="width:auto"><option value="all">All requests</option><option value="todo">Needs me (${todo.length})</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <p class="muted" style="margin:0 0 10px">The Treasurer fills in the request and signs. The President approves. The Secretary files it. Approved requests can be linked to expenses in Treasury.</p>
      <div class="card">${shown.map(r => { const [l, c] = STATUS[r.status];
        const lq = liqOf(r), ls = ['approved', 'filed'].includes(r.status) ? (LIQ[lq?.status] || ['Needs a liquidation report', 'bad']) : null;
        return `<div class="row" data-r="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(r.title)} <span class="tag ${c}">${l}</span>${ls ? ` <span class="tag ${ls[1]}">${ls[0]}</span>` : ''}</b><small>${esc(r.req_no)} · ${esc(fundLabel(r.fund))} · ${esc(r.category)}${r.activity_date ? ' · ' + fmtDate(r.activity_date) : ''}</small></div>
          <div style="text-align:right"><b>${peso(r.total)}</b>${mine(r) ? '<small class="muted" style="display:block">your turn</small>' : ''}</div></div>`; }).join('') || '<p class="empty">No requests here.</p>'}</div>`;
    el.querySelector('#fl').value = only; el.querySelector('#fl').onchange = e => { only = e.target.value; draw(); };
    el.querySelector('#nr')?.addEventListener('click', () => form(null));
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => view(reqs.find(r => r.id === b.dataset.r)));
  }

  /* ---- the form (Treasurer) ---- */
  function form(r) {
    const items = (r?.items?.length ? r.items : [{ item: '', qty: 1, unit: '' }]).map(i => ({ ...i }));
    modal(`<h3>${r ? 'Edit ' + esc(r.req_no) : 'New fund budget request'}</h3>${r?.decision_note && r.status === 'returned' ? `<div class="sb warn" style="margin:0 0 8px">Returned: ${esc(r.decision_note)}</div>` : ''}
      <form id="fm"><label>Activity or project</label><input name="t" required maxlength="120" value="${esc(r?.title || '')}" placeholder="Sports Fest trophies">
      <label>Category</label><select name="c">${CATS.map(c => `<option${r?.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <label>Fund to charge</label><select name="f">${FUNDS.map(f => `<option value="${f.k}"${r?.fund === f.k ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
      <p class="muted" id="bal" style="margin:4px 0"></p>
      <label>Date of the activity</label><input name="d" type="date" value="${r?.activity_date || ''}">
      <label>Purpose and why it is needed</label><textarea name="p" rows="3" maxlength="1000">${esc(r?.purpose || '')}</textarea>
      <label>Items</label><div id="it"></div><button type="button" class="btn ghost sm" id="ai" style="margin-top:6px">+ Add item</button>
      <div style="display:flex;justify-content:space-between;margin:10px 0;font-size:1.05rem"><span>Total requested</span><b id="tt"></b></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost" id="sv" type="submit" style="flex:1">Save draft</button><button class="btn gold" type="button" id="sd" style="flex:1">Save and send</button></div>
      <button type="button" class="btn ghost" id="cx" style="width:100%;margin-top:8px">Cancel</button><div class="err" id="er"></div></form>`, (m, close) => {
      const f = m.querySelector('#fm'), total = () => items.reduce((t, i) => t + Math.round((+i.qty || 0) * (+i.unit || 0) * 100) / 100, 0);
      const bal = () => { const k = f.elements.f.value, b = balances[k] || 0, t = total(); m.querySelector('#bal').innerHTML = `Fund balance from recorded entries: <b>${peso(b)}</b>${t > b ? ` <span style="color:#c0392b">· this request is ${peso(t - b)} more than the fund holds</span>` : ` · ${peso(b - t)} left after`}`; };
      const paint = () => { m.querySelector('#tt').textContent = peso(total()); bal(); };
      const rows = () => { m.querySelector('#it').innerHTML = items.map((i, n) => `<div style="display:grid;grid-template-columns:1fr 54px 78px 28px;gap:6px;margin:4px 0;align-items:center"><input data-k="item" data-n="${n}" placeholder="Item" maxlength="100" value="${esc(i.item)}">
        <input data-k="qty" data-n="${n}" type="number" min="0" step="1" inputmode="numeric" placeholder="Qty" value="${i.qty}"><input data-k="unit" data-n="${n}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Cost" value="${i.unit}">
        <button type="button" class="btn ghost sm" data-x="${n}" aria-label="Remove item">✕</button></div>`).join('');
        m.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { items[+inp.dataset.n][inp.dataset.k] = inp.value; paint(); });
        m.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { if (items.length > 1) { items.splice(+b.dataset.x, 1); rows(); paint(); } }); };
      rows(); paint(); f.elements.f.onchange = bal; m.querySelector('#ai').onclick = () => { items.push({ item: '', qty: 1, unit: '' }); rows(); m.querySelector(`[data-k=item][data-n="${items.length - 1}"]`).focus(); };
      m.querySelector('#cx').onclick = close;
      const save = async () => { const x = f.elements, row = { title: x.t.value.trim(), category: x.c.value, fund: x.f.value, activity_date: x.d.value || null, purpose: x.p.value.trim() || null, fund_balance: balances[x.f.value] || 0,
          items: items.filter(i => String(i.item).trim()).map(i => ({ item: String(i.item).trim(), qty: +i.qty || 0, unit: +i.unit || 0 })) };
        if (!row.title) throw new Error('Give the request a title'); if (!row.items.length) throw new Error('Add at least one item');
        if (r) { await db(sb.from('v2_budget_requests').update(row).eq('id', r.id)); return r.id; }
        return (await db(sb.from('v2_budget_requests').insert({ ...row, status: 'draft' }).select('id').single())).id; };
      f.onsubmit = async e => { e.preventDefault(); try { await save(); toast('Draft saved'); close(); load(); } catch (x) { m.querySelector('#er').textContent = needV24(x); } };
      m.querySelector('#sd').onclick = async () => { try { const id = await save(); close(); const fresh = await db(sb.from('v2_budget_requests').select('*').eq('id', id).single()); sign(fresh, 'submit'); load(); } catch (x) { m.querySelector('#er').textContent = needV24(x); } };
    });
  }

  /* ---- the signing step: a typed stamp for sure, and an optional drawn signature ---- */
  function sign(r, act) {
    const T = { submit: ['Send to the President', 'Send for approval', 'You are signing as the one who prepared this request.'], approve: ['Approve this request', 'Approve and sign', 'You are approving this request as the President.'], file: ['File this request', 'File and sign', 'You are receiving this approved request for the records.'], return: ['Return to the Treasurer', 'Return it', 'Say what needs to change. No signature is needed.'] }[act];
    modal(`<h3>${T[0]}</h3><p class="muted" style="margin:0 0 6px">${esc(r.req_no)} · ${esc(r.title)} · ${peso(r.total)}</p><p class="muted" style="margin:0 0 8px">${T[2]}</p>
      ${act === 'return' ? '<label>What needs to change</label><textarea id="nt" rows="3" maxlength="500" required></textarea>' : `<div class="card pad" style="margin-bottom:8px"><b>${esc(ctx.profile.full_name)}</b><br><small class="muted">${ROLE_LABEL[ctx.profile.role]} · stamped ${fmtDateTime(new Date())}</small></div>
        <label>Signature (optional, draw with your finger)</label><div id="sp"></div>${act === 'approve' ? '<label>Note (optional)</label><input id="nt" maxlength="500">' : ''}`}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn ${act === 'return' ? 'danger' : 'gold'}" id="go" style="flex:2">${T[1]}</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      const sig = act === 'return' ? () => '' : sigPad(m.querySelector('#sp')); m.querySelector('#cx').onclick = close;
      m.querySelector('#go').onclick = async () => { const note = m.querySelector('#nt')?.value || ''; m.querySelector('#go').disabled = true;
        try { if (act === 'submit') await db(sb.rpc('v2_fbr_submit', { p_id: r.id, p_sig: sig() }));
          else if (act === 'file') await db(sb.rpc('v2_fbr_file', { p_id: r.id, p_sig: sig() }));
          else await db(sb.rpc('v2_fbr_decide', { p_id: r.id, p_approve: act === 'approve', p_note: note, p_sig: sig() }));
          toast({ submit: 'Sent to the President', approve: 'Approved', return: 'Returned to the Treasurer', file: 'Filed. A copy is in Documents.' }[act]); close(); load(); }
        catch (x) { m.querySelector('#er').textContent = needV24(x); m.querySelector('#go').disabled = false; } };
    });
  }


  /* ---- liquidation and audit report ---- */
  const needV25 = e => /relation|schema cache|does not exist|could not find|function/i.test(e.message || '') ? 'Run the v25 SQL in Supabase first (supabase/v25_liquidation_audit.sql).' : e.message;
  const CHECKS = [['receipts', 'Every expense has a receipt'], ['amounts', 'Amounts match the receipts and the records'], ['duplicates', 'No expense is counted twice'], ['approvals', 'The request and the expenses are approved']];
  async function liquidation(r) {
    let l = liqOf(r), lines, live = false;
    if (l && l.status !== 'draft') lines = l.lines;
    else {   // not sent yet: show what the records say right now
      live = true;
      const [ex, img] = await Promise.all([db(sb.from('v2_entries').select('id,occurred_at,payer_name,category,purpose,amount,status').eq('request_id', r.id).eq('kind', 'expense').in('status', ['approved', 'pending']).order('occurred_at')).catch(() => []), db(sb.from('v2_entries').select('id').not('receipt_image', 'is', null)).catch(() => [])]);
      const has = new Set(img.map(x => x.id)); lines = ex.map(e => ({ id: e.id, date: String(e.occurred_at).slice(0, 10), payee: e.payer_name || '', category: e.category, purpose: e.purpose || '', amount: +e.amount, receipt: has.has(e.id), pending: e.status === 'pending' }));
    }
    const actual = live ? lines.reduce((t, x) => t + x.amount, 0) : +l.actual, left = r.total - actual, st = l?.status || 'draft';
    const missing = lines.filter(x => !x.receipt).length, pend = lines.filter(x => x.pending).length, over = actual > r.total;
    const sigb = (t, n, role, at, img) => sigBlock(t, n, role, at, img);
    const body = `<div class="sum"><div>Approved<b>${peso(r.total)}</b></div><div>Spent<b>${peso(actual)}</b></div><div>${over ? 'Over by' : 'Unspent'}<b>${peso(Math.abs(left))}</b></div>${l ? `<div>Cash returned<b>${peso(l.cash_returned)}</b></div>` : ''}</div>
      <h2>Expenses charged to ${esc(r.req_no)}</h2>${lines.length ? `<table><thead><tr><th>Date</th><th>Paid to</th><th>What for</th><th class="r">Amount</th><th>Receipt</th></tr></thead><tbody>${lines.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.payee)}</td><td>${esc(x.category)}${x.purpose ? ' · ' + esc(x.purpose) : ''}</td><td class="r">${peso(x.amount)}</td><td>${x.receipt ? 'yes' : 'no'}</td></tr>`).join('')}<tr><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${peso(actual)}</b></td><td></td></tr></tbody></table>` : '<p>No expense is linked to this request yet. Pick this request in the expense form in Treasury.</p>'}
      ${l?.remarks ? `<h2>Treasurer’s remarks</h2><p>${esc(l.remarks)}</p>` : ''}
      ${l?.audit_opinion ? `<h2>Audit report</h2><p><b>Opinion: ${l.audit_opinion === 'clear' ? 'Clear' : 'With findings'}</b></p>${CHECKS.map(([k, t]) => `<div class="row"><span>${t}</span><b>${l.audit_checks?.[k] ? 'yes' : 'no'}</b></div>`).join('')}${l.audit_remarks ? `<p style="margin-top:8px">${esc(l.audit_remarks)}</p>` : ''}` : ''}
      <div style="display:flex;gap:60px 14px;flex-wrap:wrap;margin-top:54px">${sigb('Prepared by', l?.prepared_at ? l.prepared_by_name : '', 'Treasurer', l?.prepared_at, l?.prepared_sig)}${sigb('Approved by', ['approved', 'audited', 'filed'].includes(st) || (st === 'returned' && l?.audit_opinion) ? l.decided_by_name : '', 'President (Mayor)', l?.decided_at, l?.approved_sig)}
        ${sigb('Audited by', l?.audited_at ? l.audited_by_name : '', 'Auditor', l?.audited_at, l?.audit_sig)}${sigb('Filed by', l?.filed_at ? l.filed_by_name : '', 'Secretary', l?.filed_at, l?.filed_sig)}</div>`;
    const flags = [live || l ? (over ? `Spending is ${peso(actual - r.total)} over the approved amount.` : '') : '', missing ? `${missing} expense${missing > 1 ? 's have' : ' has'} no receipt photo.` : '', pend ? `${pend} linked expense${pend > 1 ? 's wait' : ' waits'} for approval.` : '', l?.auto?.possible_duplicates ? `${l.auto.possible_duplicates} possible duplicate${l.auto.possible_duplicates > 1 ? 's' : ''}.` : ''].filter(Boolean);
    const [ll, lc] = LIQ[st] || LIQ.draft;
    modal(`<h3>Liquidation · ${esc(r.req_no)} <span class="tag ${lc}">${ll}</span></h3>${flags.length ? `<div class="sb warn" style="margin:0 0 8px;text-align:left">${flags.map(esc).join('<br>')}</div>` : ''}${l?.decision_note && st === 'returned' ? `<div class="sb bad" style="margin:0 0 8px;text-align:left">Returned: ${esc(l.decision_note)}</div>` : ''}
      <div id="pp" style="max-height:56vh;overflow:auto;font-size:.92rem">${body.replace(/<h2>/g, '<h4 style="margin:12px 0 4px">').replace(/<\/h2>/g, '</h4>').replace(/class="row"/g, 'style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid #d6e6ee"').replace(/<table>/g, '<table style="width:100%;border-collapse:collapse">').replace(/<th/g, '<th style="text-align:left;font-size:.78rem;padding:4px"').replace(/<td/g, '<td style="padding:4px;border-bottom:1px solid #d6e6ee;font-size:.85rem"').replace(/<div class="sum">/, '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">').replace(/<div>(Approved|Spent|Unspent|Over by|Cash returned)<b>/g, '<div style="flex:1;min-width:90px;background:#f2f9fb;border:1px solid #cfe3ec;border-radius:10px;padding:6px 10px;font-size:.75rem">$1<b style="display:block;font-size:1.05rem">')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${isTre && (!l || ['draft', 'returned'].includes(st)) ? '<button class="btn gold" id="ls">Sign and send to the President</button>' : ''}
        ${isMayor && st === 'submitted' ? '<button class="btn gold" id="la">Approve</button><button class="btn ghost" id="lr">Return</button>' : ''}
        ${ctx.can('auditor') && st === 'approved' ? '<button class="btn gold" id="lu">Audit this report</button>' : ''}
        ${canFile && st === 'audited' ? '<button class="btn gold" id="lf">File it</button>' : ''}
        ${isMayor && l ? '<button class="btn ghost" id="ld">Delete report</button>' : ''}
        <button class="btn ghost" id="pr">Print / save PDF</button><button class="btn ghost" id="cx">Close</button></div>`, (m, close) => {
      const go = fn => () => { close(); fn(); };
      m.querySelector('#cx').onclick = close;
      m.querySelector('#pr').onclick = () => printHTML('Liquidation ' + r.req_no, `${letterhead('Liquidation and Audit Report', `${r.req_no} · ${r.title}`)}${body}`);
      m.querySelector('#ls')?.addEventListener('click', go(() => liqSign(r, l, 'submit', { actual, left })));
      m.querySelector('#ld')?.addEventListener('click', async () => {
        if (!(await confirmDialog('The liquidation report and its signatures will be deleted, so the Treasurer can prepare it again. The expenses stay. This cannot be undone.', { ok: 'Delete report', danger: true, title: 'Delete this report?' }))) return;
        try { await db(sb.rpc('v2_liq_delete', { p_id: l.id })); close(); toast('Report deleted'); load(); } catch (x) { toast(/function|schema cache|could not find/i.test(x.message) ? 'Run the v26 SQL in Supabase first (supabase/v26_delete_requests.sql).' : x.message, true); } });
      m.querySelector('#la')?.addEventListener('click', go(() => liqSign(r, l, 'approve')));
      m.querySelector('#lr')?.addEventListener('click', go(() => liqSign(r, l, 'return')));
      m.querySelector('#lu')?.addEventListener('click', go(() => liqSign(r, l, 'audit')));
      m.querySelector('#lf')?.addEventListener('click', go(() => liqSign(r, l, 'file')));
    });
  }
  function liqSign(r, l, act, x = {}) {
    const T = { submit: ['Send the liquidation report', 'Send for approval', 'You are signing as the one who prepared this report.'], approve: ['Approve the liquidation report', 'Approve and sign', 'You are approving this report as the President.'],
      return: ['Return the liquidation report', 'Return it', 'Say what needs to change. No signature is needed.'], audit: ['Audit report', 'Sign the audit report', 'Tick what you checked, give your opinion and sign as the Auditor.'], file: ['File the liquidation report', 'File and sign', 'You are receiving the audited report for the records.'] }[act];
    modal(`<h3>${T[0]}</h3><p class="muted" style="margin:0 0 6px">${esc(r.req_no)} · ${esc(r.title)}</p><p class="muted" style="margin:0 0 8px">${T[2]}</p>
      ${act === 'submit' ? `<label>Cash returned to the fund (₱)</label><input id="cr" type="number" min="0" step="0.01" inputmode="decimal" value="${Math.max(0, x.left || 0)}"><small class="muted">The unspent amount is ${peso(Math.max(0, x.left || 0))}.</small><label>Remarks (optional)</label><textarea id="nt" rows="2" maxlength="1000"></textarea>` : ''}
      ${act === 'return' ? '<label>What needs to change</label><textarea id="nt" rows="3" maxlength="500"></textarea>' : ''}
      ${act === 'audit' ? `${CHECKS.map(([k, t]) => `<label class="ck"><input type="checkbox" data-ck="${k}"><span>${t}</span></label>`).join('')}<label>Opinion</label><div class="seg" id="op"><button type="button" data-op="clear" class="on">Clear</button><button type="button" data-op="findings">With findings</button></div><label>Remarks (required for findings)</label><textarea id="nt" rows="3" maxlength="1000"></textarea>` : ''}
      ${act === 'approve' ? '<label>Note (optional)</label><input id="nt" maxlength="500">' : ''}
      ${act === 'return' ? '' : `<div class="card pad" style="margin:8px 0"><b>${esc(ctx.profile.full_name)}</b><br><small class="muted">${ROLE_LABEL[ctx.profile.role]} · stamped ${fmtDateTime(new Date())}</small></div><label>Signature (optional, draw with your finger)</label><div id="sp"></div>`}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn ${act === 'return' ? 'danger' : 'gold'}" id="go" style="flex:2">${T[1]}</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      const sig = act === 'return' ? () => '' : sigPad(m.querySelector('#sp')); let opinion = 'clear'; m.querySelector('#cx').onclick = close;
      m.querySelectorAll('[data-op]').forEach(b => b.onclick = () => { opinion = b.dataset.op; m.querySelectorAll('[data-op]').forEach(y => y.classList.toggle('on', y === b)); });
      m.querySelector('#go').onclick = async () => { const note = m.querySelector('#nt')?.value || ''; m.querySelector('#go').disabled = true;
        try { if (act === 'submit') await db(sb.rpc('v2_liq_submit', { p_request: r.id, p_cash_returned: +m.querySelector('#cr').value || 0, p_remarks: note, p_sig: sig() }));
          else if (act === 'file') await db(sb.rpc('v2_liq_file', { p_id: l.id, p_sig: sig() }));
          else if (act === 'audit') await db(sb.rpc('v2_liq_audit', { p_id: l.id, p_checks: Object.fromEntries([...m.querySelectorAll('[data-ck]')].map(c => [c.dataset.ck, c.checked])), p_opinion: opinion, p_remarks: note, p_sig: sig() }));
          else await db(sb.rpc('v2_liq_decide', { p_id: l.id, p_approve: act === 'approve', p_note: note, p_sig: sig() }));
          toast({ submit: 'Sent to the President', approve: 'Approved. It goes to the Auditor.', return: 'Returned to the Treasurer', audit: opinion === 'clear' ? 'Audit signed. The Secretary can file it.' : 'Findings sent back to the Treasurer', file: 'Filed. A copy is in Documents.' }[act]); close(); load();
        } catch (e) { m.querySelector('#er').textContent = needV25(e); m.querySelector('#go').disabled = false; } };
    });
  }

  /* ---- read-only view with the actions for whoever's turn it is ---- */
  const sigBlock = (title, name, role, at, img) => `<div style="flex:1;min-width:150px;border-top:1.5px solid #14233f;padding-top:4px;text-align:center">${img ? `<img src="${img}" alt="" style="height:44px;display:block;margin:-46px auto 2px">` : '<div style="height:0"></div>'}<b>${name ? esc(name) : '&nbsp;'}</b><br><small>${esc(title)}${name ? ` · ${esc(role)}<br>${fmtDateTime(at)}` : ''}</small></div>`;
  const paper = r => `<h2>Request details</h2><div class="row"><span>Request no.</span><b>${esc(r.req_no)}</b></div><div class="row"><span>Activity or project</span><b>${esc(r.title)}</b></div><div class="row"><span>Category</span><b>${esc(r.category)}</b></div>
    <div class="row"><span>Fund</span><b>${esc(fundLabel(r.fund))}</b></div>${r.activity_date ? `<div class="row"><span>Activity date</span><b>${fmtDate(r.activity_date)}</b></div>` : ''}${r.fund_balance != null ? `<div class="row"><span>Fund balance when prepared</span><b>${peso(r.fund_balance)}</b></div>` : ''}
    ${r.purpose ? `<h2>Purpose</h2><p>${esc(r.purpose)}</p>` : ''}<h2>Items</h2><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Amount</th></tr></thead><tbody>${r.items.map(i => `<tr><td>${esc(i.item)}</td><td class="r">${i.qty}</td><td class="r">${peso(i.unit)}</td><td class="r">${peso(i.amount)}</td></tr>`).join('')}
    <tr><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${peso(r.total)}</b></td></tr></tbody></table>
    <div style="display:flex;gap:60px 18px;flex-wrap:wrap;margin-top:54px">${sigBlock('Prepared by', r.prepared_at ? r.prepared_by_name : '', 'Treasurer', r.prepared_at, r.prepared_sig)}${sigBlock('Approved by', r.status === 'approved' || r.status === 'filed' ? r.decided_by_name : '', 'President (Mayor)', r.decided_at, r.approved_sig)}${sigBlock('Filed by', r.filed_at ? r.filed_by_name : '', 'Secretary', r.filed_at, r.filed_sig)}</div>
    ${r.status === 'returned' && r.decision_note ? `<p style="margin-top:14px"><b>Returned:</b> ${esc(r.decision_note)}</p>` : ''}`;
  function view(r) {
    const [l, c] = STATUS[r.status];
    modal(`<h3>${esc(r.req_no)} <span class="tag ${c}">${l}</span></h3><div id="pp" style="max-height:58vh;overflow:auto;font-size:.92rem">${paper(r).replace(/<h2>/g, '<h4 style="margin:12px 0 4px">').replace(/<\/h2>/g, '</h4>').replace(/class="row"/g, 'style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid #d6e6ee"')
        .replace(/<table>/g, '<table style="width:100%;border-collapse:collapse">').replace(/<th/g, '<th style="text-align:left;font-size:.8rem;padding:4px"').replace(/<td/g, '<td style="padding:4px;border-bottom:1px solid #d6e6ee"')}</div>
      ${r.decision_note && r.status !== 'returned' ? `<p class="muted" style="margin:6px 0 0">President’s note: ${esc(r.decision_note)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${isTre && ['draft', 'returned'].includes(r.status) ? '<button class="btn gold" id="ed">Edit</button><button class="btn gold" id="sn">Send to the President</button><button class="btn ghost" id="dl">Delete</button>' : ''}
        ${isMayor && r.status === 'submitted' ? '<button class="btn gold" id="ap">Approve</button><button class="btn ghost" id="rt">Return</button>' : ''}
        ${canFile && r.status === 'approved' ? '<button class="btn gold" id="fi">File it</button>' : ''}
        ${['approved', 'filed'].includes(r.status) ? '<button class="btn gold" id="lq">Liquidation and audit report</button>' : ''}
        ${isMayor ? '<button class="btn ghost" id="dx">Delete</button>' : ''}
        <button class="btn ghost" id="pr">Print / save PDF</button><button class="btn ghost" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      const go = (fn) => () => { close(); fn(); };
      m.querySelector('#lq')?.addEventListener('click', go(() => liquidation(r)));
      m.querySelector('#dx')?.addEventListener('click', async () => { const lq = liqOf(r);
        if (!(await confirmDialog(`${r.req_no} “${r.title}” will be deleted${lq ? ', together with its liquidation report' : ''}${r.status === 'filed' || lq?.status === 'filed' ? ' and the copy kept in Documents' : ''}. Expenses linked to it stay, they are only unlinked. This cannot be undone.`, { ok: 'Delete', danger: true, title: 'Delete this request?' }))) return;
        try { await db(sb.rpc('v2_fbr_delete', { p_id: r.id })); close(); toast('Deleted'); load(); } catch (x) { m.querySelector('#er').textContent = /function|schema cache|could not find/i.test(x.message) ? 'Run the v26 SQL in Supabase first (supabase/v26_delete_requests.sql).' : x.message; } });
      m.querySelector('#cx').onclick = close;
      m.querySelector('#pr').onclick = () => printHTML(r.req_no, `${letterhead('Fund Budget Request', 'BSMT 1-Alpha · Batch 28 · PIT-COMED')}${paper(r)}`);
      m.querySelector('#ed')?.addEventListener('click', go(() => form(r)));
      m.querySelector('#sn')?.addEventListener('click', go(() => sign(r, 'submit')));
      m.querySelector('#ap')?.addEventListener('click', go(() => sign(r, 'approve')));
      m.querySelector('#rt')?.addEventListener('click', go(() => sign(r, 'return')));
      m.querySelector('#fi')?.addEventListener('click', go(() => sign(r, 'file')));
      m.querySelector('#dl')?.addEventListener('click', async () => { if (!(await confirmDialog('This draft will be removed.', { ok: 'Delete', danger: true }))) return; try { await db(sb.from('v2_budget_requests').delete().eq('id', r.id)); close(); toast('Deleted'); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } });
    });
  }

  el.innerHTML = skeleton(3);
  const off = watch(['v2_budget_requests', 'v2_liquidations'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  await load();
  return off;
}
