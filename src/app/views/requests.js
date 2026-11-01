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
  const isTre = ctx.can('treasurer'), isMayor = ctx.can('mayor'), canFile = ctx.can('secretary', 'mayor');
  let reqs = [], balances = {}, only = 'all';

  async function load() {
    try { reqs = await db(sb.from('v2_budget_requests').select('*').order('created_at', { ascending: false })); }
    catch (e) { el.innerHTML = `<div class="card pad"><p class="empty">${esc(needV24(e))}</p></div>`; return; }
    const ent = await db(sb.from('v2_entries').select('kind,amount,fund,status').eq('status', 'approved')).catch(() => []);
    balances = {}; ent.forEach(e => { const k = e.fund || ''; balances[k] = (balances[k] || 0) + (e.kind === 'collection' ? +e.amount : -e.amount); });
    draw();
  }
  const mine = r => (isTre && ['draft', 'returned'].includes(r.status)) || (isMayor && r.status === 'submitted') || (canFile && r.status === 'approved');

  function draw() {
    const todo = reqs.filter(mine), shown = reqs.filter(r => only === 'all' || (only === 'todo' ? mine(r) : r.status === only));
    el.innerHTML = `<div class="bar">${isTre ? '<button class="btn gold" id="nr">+ New budget request</button>' : ''}
      <select id="fl" style="width:auto"><option value="all">All requests</option><option value="todo">Needs me (${todo.length})</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <p class="muted" style="margin:0 0 10px">The Treasurer fills in the request and signs. The President approves. The Secretary files it. Approved requests can be linked to expenses in Treasury.</p>
      <div class="card">${shown.map(r => { const [l, c] = STATUS[r.status];
        return `<div class="row" data-r="${r.id}" style="cursor:pointer"><div class="m"><b>${esc(r.title)} <span class="tag ${c}">${l}</span></b><small>${esc(r.req_no)} · ${esc(fundLabel(r.fund))} · ${esc(r.category)}${r.activity_date ? ' · ' + fmtDate(r.activity_date) : ''}</small></div>
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

  /* ---- read-only view with the actions for whoever's turn it is ---- */
  const sigBlock = (title, name, role, at, img) => `<div style="flex:1;min-width:150px;border-top:1.5px solid #14233f;padding-top:4px;text-align:center">${img ? `<img src="${img}" alt="" style="height:44px;display:block;margin:-46px auto 2px">` : '<div style="height:0"></div>'}<b>${name ? esc(name) : '&nbsp;'}</b><br><small>${esc(title)}${name ? ` · ${esc(role)}<br>${fmtDateTime(at)}` : ''}</small></div>`;
  const paper = r => `<h2>Request details</h2><div class="row"><span>Request no.</span><b>${esc(r.req_no)}</b></div><div class="row"><span>Activity or project</span><b>${esc(r.title)}</b></div><div class="row"><span>Category</span><b>${esc(r.category)}</b></div>
    <div class="row"><span>Fund</span><b>${esc(fundLabel(r.fund))}</b></div>${r.activity_date ? `<div class="row"><span>Activity date</span><b>${fmtDate(r.activity_date)}</b></div>` : ''}${r.fund_balance != null ? `<div class="row"><span>Fund balance when prepared</span><b>${peso(r.fund_balance)}</b></div>` : ''}
    ${r.purpose ? `<h2>Purpose</h2><p>${esc(r.purpose)}</p>` : ''}<h2>Items</h2><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Amount</th></tr></thead><tbody>${r.items.map(i => `<tr><td>${esc(i.item)}</td><td class="r">${i.qty}</td><td class="r">${peso(i.unit)}</td><td class="r">${peso(i.amount)}</td></tr>`).join('')}
    <tr><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${peso(r.total)}</b></td></tr></tbody></table>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:54px">${sigBlock('Prepared by', r.prepared_at ? r.prepared_by_name : '', 'Treasurer', r.prepared_at, r.prepared_sig)}${sigBlock('Approved by', r.status === 'approved' || r.status === 'filed' ? r.decided_by_name : '', 'President (Mayor)', r.decided_at, r.approved_sig)}${sigBlock('Filed by', r.filed_at ? r.filed_by_name : '', 'Secretary', r.filed_at, r.filed_sig)}</div>
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
        <button class="btn ghost" id="pr">Print / save PDF</button><button class="btn ghost" id="cx">Close</button></div><div class="err" id="er"></div>`, (m, close) => {
      const go = (fn) => () => { close(); fn(); };
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
  const off = watch(['v2_budget_requests'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  await load();
  return off;
}
