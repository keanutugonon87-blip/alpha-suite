import { sb, db, watch, esc, peso, fmtDate, fmtDateTime, toast, modal, resizeImage } from './lib.js?v=1';

const CATS_IN = ['Class Dues','Contribution','Fundraising','Donation','Other'];
const CATS_OUT = ['Supplies','Printing','Event Expenses','Transportation','Snacks / Food','Other'];

export async function mount(el, ctx) {
  const canWrite = ctx.can('mayor','treasurer'), isMayor = ctx.can('mayor');
  let view = 'current', filter = 'all', openPast = null;
  let members = [];

  // list queries skip the heavy receipt column; fetch just which entries have one
  async function loadFlags() {
    const rows = await db(sb.from('v2_entries').select('id').not('receipt_image', 'is', null));
    return new Set(rows.map(r => r.id));
  }

  async function draw() {
    if (!members.length) members = await db(sb.from('v2_members').select('id,full_name').order('full_name'));
    const [periods, entriesRaw, flags] = await Promise.all([
      db(sb.from('v2_periods').select('*').order('opened_at', { ascending: false })),
      db(sb.from('v2_entries').select('id,period_id,kind,category,member_id,payer_name,amount,method,gcash_ref,receipt_no,purpose,note,occurred_at,status,source,recorded_by_name,approved_by_name,void_reason').order('occurred_at', { ascending: false })),
      loadFlags(),
    ]);
    const nameOf = id => members.find(m => m.id === id)?.full_name;
    const entries = entriesRaw.map(e => ({ ...e, who: nameOf(e.member_id) || e.payer_name || '—', hasReceipt: flags.has(e.id) }));
    const cur = periods.find(p => p.status === 'open'), past = periods.filter(p => p.status === 'closed');
    const curEntries = entries.filter(e => e.period_id === cur?.id);
    const ok = curEntries.filter(e => e.status === 'approved');
    const coll = ok.filter(e => e.kind === 'collection').reduce((s, e) => s + +e.amount, 0);
    const exp = ok.filter(e => e.kind === 'expense').reduce((s, e) => s + +e.amount, 0);
    const bal = +cur.opening_balance + coll - exp;
    const pendingN = curEntries.filter(e => e.status === 'pending').length;

    const list = (arr, showActions) => arr.length ? arr.map(e => `<div class="row"><div class="m"><b>${esc(e.who)} <span class="tag ${e.status==='approved'?'ok':e.status==='pending'?'warn':'bad'}">${e.status}</span></b>
        <small>${esc(e.category)}${e.purpose?` · ${esc(e.purpose)}`:''} · ${fmtDateTime(e.occurred_at)}${e.receipt_no?` · ${esc(e.receipt_no)}`:''}${e.method==='gcash'?' · GCash':''}${e.void_reason?` · voided: ${esc(e.void_reason)}`:''}</small></div>
        <div style="text-align:right"><div class="amt ${e.kind==='expense'?'out':'in'}">${e.kind==='expense'?'−':'+'}${peso(e.amount)}</div>
        <div style="display:flex;gap:4px;justify-content:flex-end;margin-top:4px">
          ${e.hasReceipt?`<button class="btn ghost sm" data-rcpt="${e.id}">Photo</button>`:''}
          ${showActions&&isMayor&&e.status==='pending'?`<button class="btn gold sm" data-ok="${e.id}">Approve</button>`:''}
          ${showActions&&canWrite&&e.status!=='voided'?`<button class="btn ghost sm" data-void="${e.id}">Void</button>`:''}</div></div></div>`).join('')
      : '<p class="empty">No entries.</p>';

    let body;
    if (view === 'current') {
      const shown = curEntries.filter(e => filter === 'all' ? true : filter === 'pending' ? e.status === 'pending' : e.kind === filter);
      body = `<div class="grid"><div class="stat gold"><small>Balance</small><b>${peso(bal)}</b></div><div class="stat"><small>Opening</small><b>${peso(cur.opening_balance)}</b></div>
        <div class="stat"><small>Collected</small><b>${peso(coll)}</b></div><div class="stat"><small>Spent</small><b>${peso(exp)}</b></div></div>
        <div class="bar" style="margin-top:14px">${canWrite?`<button class="btn gold" id="addIn">+ Collection</button><button class="btn" id="addOut">+ Expense</button>`:''}
          <select id="flt" style="width:auto;margin-left:auto"><option value="all">All</option><option value="collection">Collections</option><option value="expense">Expenses</option><option value="pending">Pending${pendingN?` (${pendingN})`:''}</option></select></div>
        <div class="card"><h3 style="font-size:1rem;margin-bottom:6px">${esc(cur.name)}</h3>${list(shown, true)}</div>
        ${isMayor?`<button class="btn danger" id="close">Close collection period…</button>`:''}`;
    } else {
      body = past.length ? past.map(p => { const pe = entries.filter(e => e.period_id === p.id && e.status === 'approved'); const open = openPast === p.id;
        return `<div class="card"><div class="row" style="border:0;cursor:pointer" data-past="${p.id}"><div class="m"><b>${esc(p.name)}</b><small>Closed ${fmtDate(p.closed_at)} by ${esc(p.closed_by_name||'—')}</small></div>
          <div style="text-align:right"><div class="amt">${peso(p.closing_balance)}</div><small class="muted">in ${peso(p.collections_total)} · out ${peso(p.expenses_total)}</small></div></div>
          ${open?`<div style="margin-top:8px">${list(pe, false)}${Object.keys(p.liquidation_notes||{}).length?`<h4 style="margin:12px 0 4px">Liquidation notes</h4>${Object.entries(p.liquidation_notes).map(([k,v])=>`<p class="muted" style="margin:2px 0"><b>${esc(k)}</b>: ${esc(v)}</p>`).join('')}`:''}</div>`:''}</div>`; }).join('')
        : '<p class="empty">No past periods yet.</p>';
    }
    el.innerHTML = `<div class="bar"><button class="btn ${view==='current'?'':'ghost'}" data-v="current">Current</button><button class="btn ${view==='past'?'':'ghost'}" data-v="past">Past periods (${past.length})</button></div>${body}`;
    const flt = el.querySelector('#flt'); if (flt) { flt.value = filter; flt.onchange = () => { filter = flt.value; draw(); }; }
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { view = b.dataset.v; draw(); });
    el.querySelectorAll('[data-past]').forEach(b => b.onclick = () => { openPast = openPast === b.dataset.past ? null : b.dataset.past; draw(); });
    el.querySelector('#addIn')?.addEventListener('click', () => entryForm('collection', cur));
    el.querySelector('#addOut')?.addEventListener('click', () => entryForm('expense', cur));
    el.querySelector('#close')?.addEventListener('click', () => closeForm(cur, bal, pendingN));
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { try { await db(sb.from('v2_entries').update({ status: 'approved', approved_by_name: ctx.profile.full_name }).eq('id', b.dataset.ok)); toast('Approved'); } catch (e) { toast(e.message, true); } });
    el.querySelectorAll('[data-void]').forEach(b => b.onclick = () => { const r = prompt('Reason for voiding this entry?'); if (!r) return;
      db(sb.from('v2_entries').update({ status: 'voided', void_reason: r }).eq('id', b.dataset.void)).then(() => toast('Voided')).catch(e => toast(e.message, true)); });
    el.querySelectorAll('[data-rcpt]').forEach(b => b.onclick = () => showReceipt(b.dataset.rcpt));
  }

  async function showReceipt(id) {
    try {
      const row = (await db(sb.from('v2_entries').select('receipt_image').eq('id', id).single()));
      let src = row.receipt_image;
      if (src && !src.startsWith('data:')) { const { data, error } = await sb.storage.from('v2-receipts').createSignedUrl(src, 300); if (error) throw error; src = data.signedUrl; }
      modal(`<img src="${src}" style="width:100%;border-radius:10px" alt="Receipt">`);
    } catch (e) { toast(e.message, true); }
  }

  function entryForm(kind, cur) {
    const cats = kind === 'collection' ? CATS_IN : CATS_OUT;
    modal(`<h3>${kind === 'collection' ? 'Record collection' : 'Record expense'}</h3><form id="ef">
      ${kind === 'collection' ? `<label>Student</label><select name="member" required><option value="">Select…</option>${members.map(m => `<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}</select>`
        : `<label>Paid to / vendor</label><input name="payer" required>`}
      <label>Category</label><select name="cat">${cats.map(c => `<option>${c}</option>`).join('')}</select>
      <label>Amount (₱)</label><input name="amt" type="number" step="0.01" min="0.01" required inputmode="decimal">
      <label>Purpose / note</label><input name="purpose">
      ${kind === 'collection' ? `<label>Payment method</label><select name="method"><option value="cash">Cash</option><option value="gcash">GCash</option></select><div id="gc" style="display:none"><label>GCash reference no.</label><input name="gref"></div>` : ''}
      <label>Receipt photo (optional)</label><input name="img" type="file" accept="image/*">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`,
      (m, close) => {
        m.querySelector('#cx').onclick = close;
        const sel = m.querySelector('[name=method]'); if (sel) sel.onchange = () => m.querySelector('#gc').style.display = sel.value === 'gcash' ? 'block' : 'none';
        m.querySelector('#ef').onsubmit = async ev => {
          ev.preventDefault(); const f = new FormData(ev.target), btn = ev.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Saving…';
          try {
            const id = crypto.randomUUID(); let path = null; const file = f.get('img');
            if (file && file.size) { const blob = await resizeImage(file); path = `${id}.jpg`; const { error } = await sb.storage.from('v2-receipts').upload(path, blob, { contentType: 'image/jpeg' }); if (error) throw error; }
            const mem = f.get('member');
            await db(sb.from('v2_entries').insert({ id, period_id: cur.id, kind, category: f.get('cat'), member_id: mem || null, payer_name: f.get('payer') || null,
              amount: +f.get('amt'), method: f.get('method') || 'cash', gcash_ref: f.get('gref') || null, purpose: f.get('purpose') || '', receipt_image: path,
              recorded_by_name: ctx.profile.full_name, status: isMayor ? 'approved' : 'pending', approved_by_name: isMayor ? ctx.profile.full_name : null, source: 'manual' }));
            toast(isMayor ? 'Saved' : 'Saved — waiting for Mayor approval'); close();
          } catch (e) { m.querySelector('#er').textContent = e.message; btn.disabled = false; btn.textContent = 'Save'; }
        };
      });
  }

  function closeForm(cur, bal, pendingN) {
    modal(`<h3>Close "${esc(cur.name)}"</h3><p class="muted">Balance of <b>${peso(bal)}</b> carries forward. ${pendingN ? `${pendingN} pending entr${pendingN>1?'ies':'y'} will move to the new period.` : ''} This cannot be undone.</p>
      <label>Name of the next period</label><input id="nn" placeholder="e.g. Foundation Week Collection">
      <label>Type your full name (${esc(ctx.profile.full_name)}) to confirm</label><input id="cn">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn danger" id="go" style="flex:1">Close period</button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`,
      (m, close) => { m.querySelector('#cx').onclick = close;
        m.querySelector('#go').onclick = async () => {
          const nn = m.querySelector('#nn').value.trim();
          if (!nn) return m.querySelector('#er').textContent = 'Name the next period.';
          if (m.querySelector('#cn').value.trim().toLowerCase() !== ctx.profile.full_name.toLowerCase()) return m.querySelector('#er').textContent = 'Name does not match.';
          try { await db(sb.rpc('v2_close_period', { p_next_name: nn })); toast('Period closed'); close(); view = 'past'; } catch (e) { m.querySelector('#er').textContent = e.message; } }; });
  }

  await draw();
  return watch(['v2_entries', 'v2_periods'], () => draw().catch(() => {}));
}
