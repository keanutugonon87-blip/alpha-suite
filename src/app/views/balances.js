import { sb, db, watch, esc, peso, fmtDate, fmtDateTime, toast, modal, skeleton, uuid, fundOptions, fundLabel, askText, confirmDialog } from '../core.js';
import { exportXLSX } from '../xlsx.js';
import { percentPaid } from '../money.js';

export async function mountBalances(el, ctx) {
  const canWrite = ctx.can('mayor', 'treasurer'), canRemind = ctx.can('mayor', 'vice_mayor', 'treasurer', 'auditor'), canWaive = ctx.can('mayor', 'vice_mayor'), isMayor = ctx.can('mayor');
  let sel = null, only = 'owing';
  el.innerHTML = skeleton(5);

  async function draw() {
    const [charges, bal] = await Promise.all([db(sb.from('v2_charges').select('*').order('created_at', { ascending: false })), db(sb.rpc('v2_balances'))]);
    const open = charges.filter(c => !c.closed);
    if (!sel || !charges.find(c => c.id === sel)) sel = (open[0] || charges[0])?.id;
    const c = charges.find(x => x.id === sel), rows = bal.filter(b => b.charge_id === sel);
    const paid = rows.filter(r => r.owed <= 0), owing = rows.filter(r => r.owed > 0);
    const totalDue = rows.reduce((s, r) => s + +r.due, 0), totalPaid = rows.reduce((s, r) => s + Math.min(r.paid, r.due), 0);
    const shown = only === 'owing' ? owing : only === 'paid' ? paid : rows;
    el.innerHTML = `<div class="bar"><select id="ch" class="grow">${charges.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.title)} — ${peso(x.amount)}${x.closed ? ' (closed)' : ''}</option>`).join('') || '<option>No charges yet</option>'}</select>
      ${canWrite ? '<button class="btn gold" id="new">+ New charge</button>' : ''}</div>
      ${c ? `<div class="grid"><div class="stat gold"><small>Collected</small><b>${peso(totalPaid)}</b></div><div class="stat"><small>Still owed</small><b>${peso(totalDue - totalPaid)}</b></div><div class="stat"><small>Paid / owing</small><b>${paid.length} / ${owing.length}</b></div></div>
      <div class="prog"><i style="width:${totalDue ? Math.min(100, totalPaid / totalDue * 100) : 0}%"></i></div>
      <div class="bar" style="margin-top:12px"><select id="f" style="width:auto"><option value="owing">Owing</option><option value="paid">Paid</option><option value="all">Everyone</option></select>
        <button class="btn ghost" id="csv">Export (Excel)</button>${canRemind && !c.closed && owing.length ? '<button class="btn" id="rem">🔔 Remind those who owe</button>' : ''}${canWrite ? `<button class="btn ghost" id="fnd" style="margin-left:auto">Fund: ${esc(fundLabel(c.fund))}</button><button class="btn ghost" id="cls" >${c.closed ? 'Reopen charge' : 'Close charge'}</button>` : ''}</div>
      <div class="card">${shown.map(r => `<div class="row"><div class="m"><b>${esc(r.name)}</b><small>${r.waived ? `Excused: ${esc(r.waive_reason || '')}` : `Paid ${peso(r.paid)} of ${peso(r.due)}`}</small>${r.paid > 0 && !r.waived && r.owed > 0 ? `<div class="prog mini" role="img" aria-label="${percentPaid(r.paid, r.due)}% paid"><i style="width:${percentPaid(r.paid, r.due)}%"></i></div>` : ''}</div>
        <div style="display:flex;align-items:center;gap:8px"><span class="tag ${r.owed <= 0 ? 'ok' : r.paid > 0 ? 'warn' : 'bad'}">${r.waived ? 'excused' : r.owed <= 0 ? 'paid' : r.paid > 0 ? 'owes ' + peso(r.owed) : 'unpaid'}</span>
        ${canWrite && r.owed > 0 && !c.closed ? `<button class="btn gold sm" data-c="${r.member_id}" data-a="${r.owed}">Collect</button>` : ''}${canWaive && r.owed > 0 && !r.waived ? `<button class="btn ghost sm" data-w="${r.member_id}" title="Excuse this student from the charge">Excuse</button>` : ''}${isMayor && r.waived ? `<button class="btn ghost sm" data-uw="${r.member_id}">Undo</button>` : ''}</div></div>`).join('') || '<p class="empty">Nobody here.</p>'}</div>`
      : '<p class="empty">No charges yet. A charge is something every student owes, like dues or a contribution.</p>'}`;
    el.querySelector('#ch').onchange = e => { sel = e.target.value; draw(); };
    const f = el.querySelector('#f'); if (f) { f.value = only; f.onchange = () => { only = f.value; draw(); }; }
    el.querySelector('#new')?.addEventListener('click', newCharge);
    el.querySelector('#rem')?.addEventListener('click', () => remind(c));
    el.querySelector('#csv')?.addEventListener('click', async () => {
      try { toast('Preparing Excel…'); await exportXLSX({ filename: `Alpha-Balances-${c.title.replace(/[^\w]+/g, '-')}.xlsx`, by: ctx.profile.full_name, sheets: [
        { name: 'Balances', title: c.title, subtitle: `${fundLabel(c.fund)} · ₱${c.amount} each${c.closed ? ' · closed' : ''}`, summary: [['Collected', totalPaid, 'money'], ['Still owed', totalDue - totalPaid, 'money'], ['Paid up', paid.length], ['Still owing', owing.length]],
          columns: [{ label: 'Student', key: 'name', width: 32 }, { label: 'Due', key: 'due', type: 'money', total: true }, { label: 'Paid', key: 'paid', type: 'money', total: true }, { label: 'Owed', key: 'owed', type: 'money', total: true }, { label: 'Status', get: r => r.owed <= 0 ? 'Paid' : r.paid > 0 ? 'Owed' : 'Outstanding', type: 'status' }],
          rows: rows.slice().sort((a, b) => (b.owed > 0) - (a.owed > 0) || a.name.localeCompare(b.name)) }] }); toast('Excel ready'); } catch (e) { toast(e.message, true); } });
    el.querySelector('#fnd')?.addEventListener('click', () => modal(`<h3>Fund for ${esc(c.title)}</h3><p class="muted">Every collection under this charge follows it.</p><form id="ff"><select name="fu">${fundOptions(c.fund)}</select><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => { m.querySelector('#cx').onclick = close; m.querySelector('#ff').onsubmit = async e => { e.preventDefault(); try { await db(sb.from('v2_charges').update({ fund: new FormData(e.target).get('fu') || null }).eq('id', c.id)); toast('Fund updated'); close(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; }));
    el.querySelector('#cls')?.addEventListener('click', async () => { try { await db(sb.from('v2_charges').update({ closed: !c.closed }).eq('id', c.id)); toast(c.closed ? 'Reopened' : 'Closed'); } catch (e) { toast(e.message, true); } });
    const NEED = e => /function|schema cache|does not exist/i.test(e.message) ? 'Excusing students is not switched on in the database yet. Run the v5 SQL.' : e.message;
    el.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => {
      const who = rows.find(r => r.member_id === b.dataset.w)?.name || 'this student';
      const why = await askText(`Excuse ${who}`, `Reason (they will owe nothing for "${c.title}")`, { ok: 'Excuse' }); if (!why) return;
      try { await db(sb.rpc('v2_waive_charge', { p_charge: sel, p_member: b.dataset.w, p_reason: why })); toast('Excused'); draw(); } catch (e) { toast(NEED(e), true); } });
    el.querySelectorAll('[data-uw]').forEach(b => b.onclick = async () => {
      if (!await confirmDialog('The student will owe this charge again.', { ok: 'Undo excuse', title: 'Undo the excuse?' })) return;
      try { await db(sb.rpc('v2_unwaive_charge', { p_charge: sel, p_member: b.dataset.uw })); toast('Excuse removed'); draw(); } catch (e) { toast(NEED(e), true); } });
    el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { sessionStorage.setItem('alpha-prefill', JSON.stringify({ member: b.dataset.c, charge: sel, amount: b.dataset.a })); location.hash = '#/staff/treasury'; });
  }


  /* Payment reminder: a phone alert with each student's own amount, only to students who linked their phone in My Status. */
  async function remind(c) {
    let st, roster = [];
    try { st = await db(sb.rpc('v2_reminder_status', { p_charge: c.id })); }
    catch (e) { return toast(/function|schema cache/i.test(e.message) ? 'Reminders are not switched on in the database yet.' : e.message, true); }
    try { roster = await db(sb.rpc('v2_reminder_roster', { p_charge: c.id })); } catch { /* older database: no roster yet */ }
    const recent = st.last && Date.now() - new Date(st.last) < 6 * 3600e3, unreach = roster.filter(r => !r.linked), reach = roster.filter(r => r.linked);
    const text = `Reminder from the BSMT 1-Alpha Treasurer: ${c.title} (${peso(c.amount)} each${c.due_on ? ', due ' + fmtDate(c.due_on) : ''}). Still owing:\n${unreach.map(r => `• ${r.name} — ${peso(r.owed)}`).join('\n')}\nPlease settle with the Treasurer. Salamat!`;
    modal(`<h3>Remind those who owe</h3><p class="muted" style="margin:0 0 10px">${esc(c.title)} · ${peso(c.amount)} each</p>
      <div class="grid"><div class="stat"><small>Still owe</small><b>${st.owing}</b></div><div class="stat gold"><small>Phone alert works</small><b>${st.reachable}</b></div></div>
      <p class="muted" style="margin:10px 0 0">Each student gets a phone alert with their own amount. Only students who turned on reminders in <b>My Status</b> can be reached.</p>
      ${st.last ? `<p class="muted" style="margin:6px 0 0">Last reminder: ${fmtDateTime(st.last)}${recent ? ' (wait a few hours before sending another)' : ''}</p>` : ''}
      ${roster.length ? `<details style="margin-top:10px"><summary><b>${reach.length}</b> will get the alert · <b>${unreach.length}</b> will not</summary>
        <div class="card" style="max-height:30vh;overflow:auto;margin-top:6px">${roster.map(r => `<div class="row"><div class="m"><b>${esc(r.name)}</b><small>${peso(r.owed)}</small></div><span class="tag ${r.linked ? 'ok' : 'warn'}">${r.linked ? 'alert on' : 'no alert'}</span></div>`).join('')}</div></details>` : ''}
      ${unreach.length ? `<p class="muted" style="margin:10px 0 4px">For those without alerts, copy this and post it in the class group chat:</p><textarea id="tx" rows="5" readonly style="width:100%">${esc(text)}</textarea><button class="btn ghost sm" id="cp" style="margin-top:6px">Copy message</button>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="rs" style="flex:1" ${st.reachable && !recent ? '' : 'disabled'}>Send to ${st.reachable} ${st.reachable === 1 ? 'student' : 'students'}</button><button class="btn ghost" id="rc">Cancel</button></div><div class="err" id="er"></div>`,
      (m, close) => {
        m.querySelector('#rc').onclick = close;
        m.querySelector('#cp')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Message copied'); } catch { const t = m.querySelector('#tx'); t.select(); toast('Select the text and copy it'); } });
        m.querySelector('#rs').onclick = async e => { e.target.disabled = true;
          try { const r = await db(sb.rpc('v2_send_reminder', { p_charge: c.id })); toast(`Reminder sent to ${r.reached} ${r.reached === 1 ? 'student' : 'students'}`); close(); }
          catch (x) { m.querySelector('#er').textContent = x.message; e.target.disabled = false; } };
      });
  }

  function newCharge() {
    modal(`<h3>New charge</h3><p class="muted">Applies to every active student.</p><form id="cf"><label>Title</label><input name="t" required placeholder="e.g. Foundation Week shirt">
      <label>Amount per student (₱)</label><input name="a" type="number" min="1" step="0.01" required inputmode="decimal"><label>Fund</label><select name="fu">${fundOptions('')}</select><label>Due date (optional)</label><input name="d" type="date">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Create</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#cf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
        try { await db(sb.from('v2_charges').insert({ id: uuid(), title: f.get('t').trim(), amount: +f.get('a'), due_on: f.get('d') || null, fund: f.get('fu') || null, created_by_name: ctx.profile.full_name })); toast('Charge created'); close(); }
        catch (x) { m.querySelector('#er').textContent = x.message; } };
    });
  }
  await draw();
  return watch(['v2_charges', 'v2_entries', 'v2_members', 'v2_waivers'], () => draw().catch(() => {}));
}
