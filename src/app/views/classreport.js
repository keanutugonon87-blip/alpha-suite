import { sb, db, watch, esc, toast, modal, skeleton, fmtDate, fmtDateTime } from '../core.js';
import { ITEMS, STAGES, KIND, isProgress, progressBlock } from './progress.js';

/* The Class Mayor reports up to the SAILS VP Internal: a weekly report built from his directives, and requests for approval (funds, activities, other). */
const ASK = { open: ['Waiting for the SAILS VP Internal', 'warn'], approved: ['Approved', 'ok'], declined: ['Declined', 'bad'] };
const PROG = { open: ['Waiting for the SAILS VP Internal', 'warn'], approved: ['Received', 'ok'], declined: ['Sent back', 'bad'] };

export async function mountClassReport(el, ctx) {
  let S = null, reps = [], asks = [], setup = false;
  el.innerHTML = skeleton(4);
  async function load() {
    const [b, r, a] = await Promise.all([
      sb.rpc('v2_class_report_build').then(x => x.error ? (setup = true, null) : x.data, () => null),
      sb.from('v2_class_reports').select('*').order('week_start', { ascending: false }).limit(12).then(x => x.error ? [] : x.data || [], () => []),
      sb.from('v2_class_asks').select('*').order('created_at', { ascending: false }).limit(50).then(x => x.error ? [] : x.data || [], () => []),
    ]);
    S = b; reps = r; asks = a; draw();
  }
  const wk = d => fmtDate(d + 'T00:00:00+08:00');
  function draw() {
    if (setup || !S) { el.innerHTML = '<div class="card"><p class="empty">Run the v46 SQL in Supabase to turn this on.</p></div>'; return; }
    const sent = reps.find(r => r.week_start === S.week_start);
    el.innerHTML = `<p class="muted" style="margin:0 2px 8px">You delegate to your class officers and report to the SAILS VP Internal. Every Friday this report builds itself from your directives.</p>
      <div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px">This week (from ${wk(S.week_start)})</h3>
        <div class="grid" style="margin-bottom:10px"><div class="stat"><small>Sent out</small><b>${S.issued}</b></div><div class="stat gold"><small>Finished</small><b>${S.confirmed}</b></div><div class="stat"><small>Still open</small><b>${S.open}</b></div><div class="stat"><small>Late</small><b>${S.late.length}</b></div></div>
        ${S.late.length ? S.late.map(l => `<div class="row"><div class="m"><b>${esc(l.title)}</b><small>${esc(l.who)} · due ${wk(l.due)}</small></div><span class="tag bad">late</span></div>`).join('') : '<p class="muted" style="margin:0 0 8px">Nothing is late.</p>'}
        <div class="acts" style="margin-top:8px"><button class="btn gold" id="send">${sent ? 'Update and resend' : 'Send to the SAILS VP Internal'}</button>${sent ? `<span class="tag ${sent.reviewed_at ? 'ok' : 'warn'}">${sent.reviewed_at ? 'Reviewed' : 'Sent, not yet read'}</span>` : ''}</div></div>
      <div class="bar"><b>Progress reports to the SAILS VP Internal</b><span class="grow"></span><button class="btn gold sm" id="ask">+ New progress report</button></div>
      <div class="grid" style="margin-bottom:10px">${Object.entries(ITEMS).map(([k, n]) => { const l = asks.find(a => a.kind === k); return `<div class="stat ${l ? '' : ''}"><small>${n}</small><b style="font-size:1rem">${l ? esc(STAGES.find(s => s[0] === l.stage)?.[1] || '') : 'Not reported yet'}</b>${l && l.qty_total ? `<small>${l.qty_paid || 0} of ${l.qty_total} paid</small>` : ''}</div>`; }).join('')}</div>
      ${asks.length ? `<div class="card">${asks.map(a => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="m"><b>${esc(a.title)}</b><small>${KIND[a.kind] || a.kind}${!isProgress(a) && a.amount != null ? ' · ₱' + Number(a.amount).toLocaleString('en-PH') : ''} · ${fmtDateTime(a.created_at)}</small></div><span class="tag ${(isProgress(a) ? PROG : ASK)[a.status][1]}">${(isProgress(a) ? PROG : ASK)[a.status][0]}</span></div>${isProgress(a) ? progressBlock(a) : ''}${a.details ? `<p style="margin:6px 0 0">${esc(a.details)}</p>` : ''}${a.decision_note ? `<p class="muted" style="margin:6px 0 0">${esc(a.decided_by_name || 'SAILS VP Internal')}: ${esc(a.decision_note)}</p>` : ''}</div>`).join('')}</div>` : '<p class="empty">No progress reports yet. Send the first one for the Nameplate or the Siglakas shirt.</p>'}
      ${reps.length ? `<h4 style="margin:14px 2px 6px">Past reports</h4><div class="card">${reps.map(r => `<div class="row"><div class="m"><b>Week of ${wk(r.week_start)}</b><small>${r.summary.confirmed || 0} finished · ${r.summary.open || 0} open · ${(r.summary.late || []).length} late${r.review_note ? ' · “' + esc(r.review_note) + '”' : ''}</small></div><span class="tag ${r.reviewed_at ? 'ok' : ''}">${r.reviewed_at ? 'Reviewed' : 'Sent'}</span></div>`).join('')}</div>` : ''}`;
    el.querySelector('#send').onclick = () => modal(`<h3>Send the weekly report</h3><form id="f"><label>Your note to the SAILS VP Internal (optional)</label><textarea name="n" rows="4" maxlength="1000" placeholder="What went well, what is stuck, what you need"></textarea><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); try { await db(sb.rpc('v2_class_report_submit', { p_note: new FormData(e.target).get('n') })); toast('Report sent'); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
    el.querySelector('#ask').onclick = () => modal(`<h3>Progress report to the SAILS VP Internal</h3><form id="f"><label>Type</label><select name="k">${Object.entries(ITEMS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
      <label>Where is it now?</label><select name="s">${STAGES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
      <div class="twocol"><div><label>Total ordered</label><input name="t" type="number" min="0" step="1" inputmode="numeric" required></div><div><label>Paid so far</label><input name="p" type="number" min="0" step="1" inputmode="numeric" required></div></div>
      <div class="twocol"><div><label>Collected ₱</label><input name="c" type="number" min="0" step="0.01" inputmode="decimal"></div><div><label>Target ₱</label><input name="g" type="number" min="0" step="0.01" inputmode="decimal"></div></div>
      <label>Expected date (optional)</label><input name="e" type="date"><label>Note (optional)</label><textarea name="d" rows="3" maxlength="800" placeholder="Supplier, sizes still missing, who has not paid, problems"></textarea>
      <p class="muted" id="hint" style="margin:6px 0 0"></p>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      const f = m.querySelector('#f'), put = (n, v) => { if (v != null) f.elements[n].value = v; };
      // start from the last report of the same item, so only what changed is typed
      const prefill = () => { const l = asks.find(a => a.kind === f.elements.k.value); m.querySelector('#hint').textContent = l ? 'Started from your last report. Change what is new.' : ''; if (l) { put('s', l.stage); put('t', l.qty_total); put('p', l.qty_paid); put('c', l.amount); put('g', l.target); } };
      f.elements.k.onchange = prefill; prefill();
      f.onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target), num = n => d.get(n) === '' ? null : Number(d.get(n));
        if (num('p') > num('t')) { m.querySelector('#er').textContent = 'Paid cannot be more than the total ordered.'; return; }
        try { await db(sb.rpc('v2_class_progress', { p_item: d.get('k'), p_stage: d.get('s'), p_total: num('t'), p_paid: num('p'), p_collected: num('c'), p_target: num('g'), p_eta: d.get('e') || null, p_note: d.get('d') })); toast('Progress report sent'); close(); load(); } catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  await load();
  return watch(['v2_class_reports', 'v2_class_asks', 'v2_directives'], () => load().catch(() => {}));
}

/* The Class Mayor's SAILS Report tab: the weekly report and progress reports, and the monthly report pack. */
export async function mountSailsReport(el, ctx) {
  const K = 'alpha-sails-report-tab', rd = () => { try { return localStorage.getItem(K) === 'pack' ? 'pack' : 'wk'; } catch { return 'wk'; } };
  let tab = rd(), stop = null;
  el.innerHTML = '<div class="subtabs" role="tablist"><button type="button" role="tab" data-t="wk">Weekly and progress</button><button type="button" role="tab" data-t="pack">Monthly pack</button></div><div id="sr"></div>';
  const box = el.querySelector('#sr');
  async function show() {
    el.querySelectorAll('[data-t]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === tab)));
    try { stop && stop(); } catch { /* ignore */ } stop = null;
    box.innerHTML = '';
    try { stop = tab === 'pack' ? await (await import('./pack.js')).mountPack(box, ctx) : await mountClassReport(box, ctx); }
    catch (e) { box.innerHTML = `<div class="card"><b>Couldn't load this.</b><p class="muted">${esc(e.message)}</p></div>`; }
  }
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; try { localStorage.setItem(K, tab); } catch { /* ignore */ } show(); });
  await show();
  return () => { try { stop && stop(); } catch { /* ignore */ } };
}
