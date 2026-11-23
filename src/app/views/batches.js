import { sb, db, watch, esc, peso, toast, modal, skeleton, fmtDate, fmtDateTime } from '../core.js';

/* Cash batches. The Class Treasurer counts the cash of the section and submits a batch,
   the SAILS Treasurer recounts and verifies it, the SAILS VP Internal countersigns it (then it counts as deposited).
   Cash only. Run supabase/v73_categories_batches.sql once. */
const LABEL = { submitted: ['Waiting for the SAILS Treasurer', 'warn'], verified: ['Waiting for the SAILS VP Internal', 'warn'], deposited: ['Deposited', 'ok'], returned: ['Sent back', 'bad'] };

export async function mountBatches(el, ctx) {
  const role = ctx.profile.role, isCT = role === 'class_treasurer', isTr = role === 'treasurer', isVp = role === 'vp_internal';
  let batches = [], free = [], units = new Map(), members = new Map(), setup = false;
  el.innerHTML = skeleton(3);

  async function load() {
    const b = await sb.from('v2_batches').select('*').order('created_at', { ascending: false }).limit(150);
    if (b.error) { setup = true; draw(); return; }
    setup = false; batches = b.data || [];
    const u = await sb.from('v2_units').select('id,name').then(x => x.data || [], () => []); units = new Map(u.map(x => [x.id, x.name]));
    if (isCT) {
      free = await sb.from('v2_entries').select('id,amount,category,occurred_at,member_id,payer_name,purpose').eq('kind', 'collection').eq('status', 'approved').eq('method', 'cash').is('batch_id', null).eq('batch_exempt', false).order('occurred_at').limit(300).then(x => x.error ? [] : x.data || [], () => []);
      const m = await sb.from('v2_members').select('id,full_name').limit(500).then(x => x.data || [], () => []); members = new Map(m.map(x => [x.id, x.full_name]));
    }
    draw();
  }

  const who = e => members.get(e.member_id) || e.payer_name || '—';
  const unitName = b => units.get(b.unit_id) || '';

  function batchCard(b) {
    const [lbl, cls] = LABEL[b.status] || [b.status, ''];
    const off = b.verified_cash != null && Math.abs(+b.verified_cash - +b.entries_total) > 0.004, subOff = Math.abs(+b.submitted_cash - +b.entries_total) > 0.004;
    const acts = [
      isTr && b.status === 'submitted' ? `<button class="btn gold sm" data-verify="${b.id}">Recount and verify</button>` : '',
      isVp && b.status === 'verified' ? `<button class="btn gold sm" data-sign="${b.id}">Countersign</button>` : '',
      (isTr && ['submitted', 'verified'].includes(b.status)) || (isVp && ['submitted', 'verified'].includes(b.status)) ? `<button class="btn ghost sm" data-back="${b.id}">Send back</button>` : '',
      `<button class="btn ghost sm" data-view="${b.id}">Collections</button>`].filter(Boolean).join('');
    return `<div class="card" style="margin-bottom:10px"><div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="m"><b>${esc(b.batch_no)}${unitName(b) ? ' · ' + esc(unitName(b)) : ''}</b><small>${b.entries_count} collection${b.entries_count === 1 ? '' : 's'} · records say ${peso(b.entries_total)}</small></div><span class="tag ${cls}">${lbl}</span></div>
      <small class="muted" style="display:block;margin-top:6px">Counted by the Class Treasurer: ${peso(b.submitted_cash)}${subOff ? ' (differs)' : ''} · ${esc(b.submitted_by_name || '')} · ${fmtDateTime(b.submitted_at)}${b.submit_note ? `<br>“${esc(b.submit_note)}”` : ''}</small>
      ${b.verified_at ? `<small class="muted" style="display:block">Recounted by the SAILS Treasurer: ${peso(b.verified_cash)}${off ? ' (differs)' : ''} · ${esc(b.verified_by_name || '')} · ${fmtDateTime(b.verified_at)}${b.verify_note ? `<br>“${esc(b.verify_note)}”` : ''}</small>` : ''}
      ${b.signed_at ? `<small class="muted" style="display:block">Countersigned by the SAILS VP Internal · ${esc(b.signed_by_name || '')} · ${fmtDateTime(b.signed_at)}${b.sign_note ? `<br>“${esc(b.sign_note)}”` : ''}</small>` : ''}
      ${b.status === 'returned' ? `<small class="muted" style="display:block">Sent back by ${esc(b.returned_by_name || '')}: ${esc(b.return_reason || '')}</small>` : ''}
      <div class="acts" style="margin-top:8px">${acts}</div></div></div>`;
  }

  function draw() {
    if (setup) { el.innerHTML = '<div class="card"><p class="empty">Run the v73 SQL in Supabase to turn this on.</p></div>'; return; }
    const waiting = batches.filter(b => (isTr && b.status === 'submitted') || (isVp && b.status === 'verified'));
    const rest = batches.filter(b => !waiting.includes(b));
    const intro = isCT ? 'Count the cash you collected and put it in a batch. The SAILS Treasurer recounts it and the SAILS VP Internal countersigns it. Only then is it counted as deposited.'
      : isTr ? 'Recount the cash a Class Treasurer hands in, then verify the batch. The SAILS VP Internal countersigns after you.'
      : isVp ? 'Countersign the batches the SAILS Treasurer has verified. A difference in the count needs your note.' : 'Cash batches of the sections: counted by the Class Treasurer, verified by the SAILS Treasurer and countersigned by the SAILS VP Internal.';
    el.innerHTML = `<p class="muted" style="margin:0 2px 10px">${intro}</p>
      ${isCT ? `<div class="card pad" style="margin-bottom:12px"><b>Cash ready for a batch</b>${free.length ? `
        <div style="max-height:40vh;overflow:auto;margin-top:6px">${free.map(e => `<label class="ck"><input type="checkbox" name="c" value="${e.id}" data-a="${e.amount}" checked><span>${esc(who(e))} · ${esc(e.category)} · ${fmtDate(e.occurred_at)}</span><b style="margin-left:auto">${peso(e.amount)}</b></label>`).join('')}</div>
        <p style="margin:8px 0 0">Records say <b id="tot">${peso(free.reduce((s, e) => s + +e.amount, 0))}</b></p>
        <label>Cash you counted (₱)</label><input id="cnt" type="number" step="0.01" min="0" inputmode="decimal"><label>Note (needed if it does not match)</label><input id="nt" maxlength="200">
        <button class="btn gold" id="mk" style="margin-top:10px">Submit batch</button><div class="err" id="er"></div>` : '<p class="muted" style="margin:6px 0 0">No cash is waiting. New cash collections show here.</p>'}</div>` : ''}
      ${waiting.length ? `<h3 style="margin:14px 2px 8px">Needs you</h3>${waiting.map(batchCard).join('')}` : ''}
      <h3 style="margin:14px 2px 8px">${waiting.length ? 'All batches' : 'Batches'}</h3>
      ${rest.length ? rest.map(batchCard).join('') : '<div class="empty"><b>No batches yet</b>When a Class Treasurer submits cash, it shows here.</div>'}`;
    wire();
  }

  function wire() {
    const boxes = () => [...el.querySelectorAll('input[name=c]')];
    const upd = () => { const t = boxes().filter(b => b.checked).reduce((s, b) => s + +b.dataset.a, 0), o = el.querySelector('#tot'); if (o) o.textContent = peso(t); };
    boxes().forEach(b => b.onchange = upd);
    const mk = el.querySelector('#mk');
    if (mk) mk.onclick = async () => {
      const ids = boxes().filter(b => b.checked).map(b => b.value), er = el.querySelector('#er'), cash = el.querySelector('#cnt').value;
      if (!ids.length) { er.textContent = 'Tick the collections to put in the batch.'; return; }
      if (cash === '') { er.textContent = 'Enter the cash you counted.'; return; }
      mk.disabled = true; er.textContent = '';
      try { await db(sb.rpc('v2_batch_create', { p_ids: ids, p_cash: +cash, p_note: el.querySelector('#nt').value.trim() || null })); toast('Batch submitted'); load().catch(() => {}); }
      catch (e) { er.textContent = e.message; mk.disabled = false; }
    };
    el.querySelectorAll('[data-verify]').forEach(b => b.onclick = () => countForm(b.dataset.verify, 'Recount and verify', 'v2_batch_verify', true));
    el.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => countForm(b.dataset.sign, 'Countersign this batch', 'v2_batch_sign', false));
    el.querySelectorAll('[data-back]').forEach(b => b.onclick = () => backForm(b.dataset.back));
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => viewEntries(b.dataset.view));
  }

  function countForm(id, title, fn, withCash) {
    const b = batches.find(x => x.id === id); if (!b) return;
    modal(`<h3>${title}</h3><p class="muted" style="margin:0 0 8px">${esc(b.batch_no)} · the records say <b>${peso(b.entries_total)}</b>${withCash ? '' : ` · the SAILS Treasurer counted <b>${peso(b.verified_cash)}</b>`}.</p>
      <form id="f">${withCash ? '<label>Cash you counted (₱)</label><input name="c" type="number" step="0.01" min="0" required inputmode="decimal">' : ''}<label>Note ${withCash ? '(needed if it does not match)' : '(needed if the count differs from the records)'}</label><input name="n" maxlength="300">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">${withCash ? 'Verify' : 'Countersign'}</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), btn = m.querySelector('.btn.gold'); btn.disabled = true;
        try { await db(sb.rpc(fn, withCash ? { p_id: id, p_cash: +f.get('c'), p_note: f.get('n').trim() || null } : { p_id: id, p_note: f.get('n').trim() || null })); toast(withCash ? 'Batch verified' : 'Batch deposited'); close(); load().catch(() => {}); }
        catch (x) { m.querySelector('#er').textContent = x.message; btn.disabled = false; } };
    });
  }

  function backForm(id) {
    modal(`<h3>Send this batch back?</h3><p class="muted" style="margin:0 0 8px">The collections go back to the Class Treasurer to batch again.</p><form id="f"><label>Why</label><input name="r" required maxlength="300">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send back</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const btn = m.querySelector('.btn.gold'); btn.disabled = true;
        try { await db(sb.rpc('v2_batch_return', { p_id: id, p_reason: new FormData(e.target).get('r').trim() })); toast('Batch sent back'); close(); load().catch(() => {}); }
        catch (x) { m.querySelector('#er').textContent = x.message; btn.disabled = false; } };
    });
  }

  async function viewEntries(id) {
    const b = batches.find(x => x.id === id);
    const rows = await db(sb.from('v2_entries').select('amount,category,occurred_at,payer_name,member_id,purpose').eq('batch_id', id).order('occurred_at')).catch(() => []);
    const m = rows.some(r => r.member_id) ? await sb.from('v2_members').select('id,full_name').in('id', [...new Set(rows.map(r => r.member_id).filter(Boolean))]).then(x => x.data || [], () => []) : [];
    const nm = new Map(m.map(x => [x.id, x.full_name]));
    modal(`<h3>${esc(b?.batch_no || 'Batch')} · collections</h3><div class="card" style="max-height:50vh;overflow:auto">${rows.length ? rows.map(r => `<div class="row"><div class="m"><b>${esc(nm.get(r.member_id) || r.payer_name || '—')}</b><small>${esc(r.category)} · ${fmtDate(r.occurred_at)}</small></div><div class="amt in">${peso(r.amount)}</div></div>`).join('') : '<p class="empty">Nothing to show</p>'}</div>
      <div style="margin-top:12px"><button class="btn ghost" id="cx">Close</button></div>`, (mm, close) => { mm.querySelector('#cx').onclick = close; });
  }

  await load();
  return watch(['v2_batches', 'v2_entries'], () => { if (el.isConnected && !document.querySelector('.modal')) load().catch(() => {}); });
}
