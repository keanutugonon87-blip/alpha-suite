import { sb, db, watch, esc, peso, fmtDate, toast, modal, skeleton, uuid, fundOptions, fundLabel } from '../core.js';
import { exportXLSX } from '../xlsx.js';

export async function mountBalances(el, ctx) {
  const canWrite = ctx.can('mayor', 'treasurer');
  let sel = null, only = 'owing';
  el.innerHTML = skeleton(5);

  async function draw() {
    const [charges, bal] = await Promise.all([db(sb.from('v2_charges').select('*').order('created_at', { ascending: false })), db(sb.rpc('v2_balances'))]);
    const open = charges.filter(c => !c.closed);
    if (!sel || !charges.find(c => c.id === sel)) sel = (open[0] || charges[0])?.id;
    const c = charges.find(x => x.id === sel), rows = bal.filter(b => b.charge_id === sel);
    const paid = rows.filter(r => r.owed <= 0), owing = rows.filter(r => r.owed > 0);
    const totalDue = rows.length * (c?.amount || 0), totalPaid = rows.reduce((s, r) => s + Math.min(r.paid, r.due), 0);
    const shown = only === 'owing' ? owing : only === 'paid' ? paid : rows;
    el.innerHTML = `<div class="bar"><select id="ch" class="grow">${charges.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.title)} — ${peso(x.amount)}${x.closed ? ' (closed)' : ''}</option>`).join('') || '<option>No charges yet</option>'}</select>
      ${canWrite ? '<button class="btn gold" id="new">+ New charge</button>' : ''}</div>
      ${c ? `<div class="grid"><div class="stat gold"><small>Collected</small><b>${peso(totalPaid)}</b></div><div class="stat"><small>Still owed</small><b>${peso(totalDue - totalPaid)}</b></div><div class="stat"><small>Paid / owing</small><b>${paid.length} / ${owing.length}</b></div></div>
      <div class="prog"><i style="width:${totalDue ? Math.min(100, totalPaid / totalDue * 100) : 0}%"></i></div>
      <div class="bar" style="margin-top:12px"><select id="f" style="width:auto"><option value="owing">Owing</option><option value="paid">Paid</option><option value="all">Everyone</option></select>
        <button class="btn ghost" id="csv">Export (Excel)</button>${canWrite ? `<button class="btn ghost" id="fnd" style="margin-left:auto">Fund: ${esc(fundLabel(c.fund))}</button><button class="btn ghost" id="cls" >${c.closed ? 'Reopen charge' : 'Close charge'}</button>` : ''}</div>
      <div class="card">${shown.map(r => `<div class="row"><div class="m"><b>${esc(r.name)}</b><small>Paid ${peso(r.paid)} of ${peso(r.due)}</small></div>
        <div style="display:flex;align-items:center;gap:8px"><span class="tag ${r.owed <= 0 ? 'ok' : r.paid > 0 ? 'warn' : 'bad'}">${r.owed <= 0 ? 'paid' : r.paid > 0 ? 'owes ' + peso(r.owed) : 'unpaid'}</span>
        ${canWrite && r.owed > 0 && !c.closed ? `<button class="btn gold sm" data-c="${r.member_id}" data-a="${r.owed}">Collect</button>` : ''}</div></div>`).join('') || '<p class="empty">Nobody here.</p>'}</div>`
      : '<p class="empty">No charges yet. A charge is something every student owes, like dues or a contribution.</p>'}`;
    el.querySelector('#ch').onchange = e => { sel = e.target.value; draw(); };
    const f = el.querySelector('#f'); if (f) { f.value = only; f.onchange = () => { only = f.value; draw(); }; }
    el.querySelector('#new')?.addEventListener('click', newCharge);
    el.querySelector('#csv')?.addEventListener('click', async () => {
      try { toast('Preparing Excel…'); await exportXLSX({ filename: `Alpha-Balances-${c.title.replace(/[^\w]+/g, '-')}.xlsx`, by: ctx.profile.full_name, sheets: [
        { name: 'Balances', title: c.title, subtitle: `${fundLabel(c.fund)} · ₱${c.amount} each${c.closed ? ' · closed' : ''}`, summary: [['Collected', totalPaid, 'money'], ['Still owed', totalDue - totalPaid, 'money'], ['Paid up', paid.length], ['Still owing', owing.length]],
          columns: [{ label: 'Student', key: 'name', width: 32 }, { label: 'Due', key: 'due', type: 'money', total: true }, { label: 'Paid', key: 'paid', type: 'money', total: true }, { label: 'Owed', key: 'owed', type: 'money', total: true }, { label: 'Status', get: r => r.owed <= 0 ? 'Paid' : r.paid > 0 ? 'Owed' : 'Outstanding', type: 'status' }],
          rows: rows.slice().sort((a, b) => (b.owed > 0) - (a.owed > 0) || a.name.localeCompare(b.name)) }] }); toast('Excel ready'); } catch (e) { toast(e.message, true); } });
    el.querySelector('#fnd')?.addEventListener('click', () => modal(`<h3>Fund for ${esc(c.title)}</h3><p class="muted">Every collection under this charge follows it.</p><form id="ff"><select name="fu">${fundOptions(c.fund)}</select><div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => { m.querySelector('#cx').onclick = close; m.querySelector('#ff').onsubmit = async e => { e.preventDefault(); try { await db(sb.from('v2_charges').update({ fund: new FormData(e.target).get('fu') || null }).eq('id', c.id)); toast('Fund updated'); close(); } catch (x) { m.querySelector('#er').textContent = x.message; } }; }));
    el.querySelector('#cls')?.addEventListener('click', async () => { try { await db(sb.from('v2_charges').update({ closed: !c.closed }).eq('id', c.id)); toast(c.closed ? 'Reopened' : 'Closed'); } catch (e) { toast(e.message, true); } });
    el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { sessionStorage.setItem('alpha-prefill', JSON.stringify({ member: b.dataset.c, charge: sel, amount: b.dataset.a })); location.hash = '#/staff/treasury'; });
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
  return watch(['v2_charges', 'v2_entries', 'v2_members'], () => draw().catch(() => {}));
}
