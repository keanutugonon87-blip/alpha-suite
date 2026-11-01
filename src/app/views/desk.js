import { sb, db, watch, esc, peso, fmtDate, toast, modal, skeleton, safeWrite, uuid, confirmDialog, initials } from '../core.js';
import { findDuplicate } from '../money.js';
import { scanMember, showReceipt } from '../qr.js';

/* Collection Desk (Treasurer and Mayor).
   One list of everything each student still owes: charges (dues, contributions) and fines.
   Tap a student, tick what they are paying now, and every ticked item is recorded in one go.
   Scan a student's QR card to open their line directly. A weekly goal shows how the collecting is going. */
const GK = 'alpha-desk-goal';
const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };   // Monday
const readGoal = () => { try { return +localStorage.getItem(GK) || 0; } catch { return 0; } };

export async function mountDesk(el, ctx) {
  const isMayor = ctx.can('mayor');
  let q = '', only = 'owing', data = null;
  el.innerHTML = skeleton(4);
  const off = watch(['v2_entries', 'v2_charges', 'v2_violations'], () => { if (document.contains(el) && !document.querySelector('.modal')) load().catch(() => {}); });
  await load();
  return off;

  async function load() {
    const [members, charges, bal, periods, entries] = await Promise.all([
      db(sb.from('v2_members').select('id,full_name,section,status').order('full_name')),
      db(sb.from('v2_charges').select('id,title,amount,fund,closed')),
      db(sb.rpc('v2_balances')),
      db(sb.from('v2_periods').select('id,status').eq('status', 'open')),
      db(sb.from('v2_entries').select('id,member_id,kind,amount,charge_id,status,occurred_at,payer_name,violation_id').neq('status', 'voided').order('occurred_at', { ascending: false }).limit(600)),
    ]);
    let viol = [], stds = [];
    try { [viol, stds] = await Promise.all([db(sb.from('v2_violations').select('id,member_id,standard_id,status,excuse_status,occurred_on')), db(sb.from('v2_standards').select('id,title,fine'))]); } catch { /* fines need the v19 SQL */ }
    data = { members, charges, bal, cur: periods[0], entries, viol, stds };
    draw();
  }

  /* what each student still owes */
  function owedBy() {
    const { members, charges, bal, entries, viol, stds } = data, open = new Set(charges.filter(c => !c.closed).map(c => c.id)), by = {};
    const add = (mid, it) => { (by[mid] ||= []).push(it); };
    bal.filter(b => open.has(b.charge_id) && !b.waived && +b.owed > 0).forEach(b => add(b.member_id, { kind: 'charge', id: b.charge_id, label: charges.find(c => c.id === b.charge_id)?.title || 'Charge', owed: +b.owed, charge: b.charge_id }));
    const paid = new Set(entries.filter(e => e.violation_id && e.status !== 'rejected').map(e => e.violation_id));
    viol.filter(v => !['awaiting_approval', 'rejected'].includes(v.status) && v.excuse_status !== 'accepted' && !paid.has(v.id)).forEach(v => {
      const s = stds.find(x => x.id === v.standard_id); if (s?.fine) add(v.member_id, { kind: 'fine', id: v.id, label: `Fine: ${s.title}`, owed: +s.fine, violation: v.id, when: v.occurred_on });
    });
    return members.filter(m => m.status === 'active').map(m => { const items = by[m.id] || []; return { m, items, total: items.reduce((t, i) => t + i.owed, 0) }; });
  }

  function draw() {
    const rows = owedBy(), { entries } = data, wk = weekStart().getTime(), goal = readGoal();
    const got = entries.filter(e => e.kind === 'collection' && e.status !== 'rejected' && new Date(e.occurred_at).getTime() >= wk).reduce((t, e) => t + +e.amount, 0);
    const outstanding = rows.reduce((t, r) => t + r.total, 0), owing = rows.filter(r => r.total > 0);
    const shown = rows.filter(r => (only === 'all' || r.total > 0) && (!q || r.m.full_name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.total - a.total || a.m.full_name.localeCompare(b.m.full_name));
    el.innerHTML = `<div class="grid"><div class="stat gold"><small>Still to collect</small><b>${peso(outstanding)}</b></div><div class="stat"><small>Students owing</small><b>${owing.length}</b></div><div class="stat"><small>Collected this week</small><b>${peso(got)}</b></div></div>
      <div class="card pad" style="margin:12px 0"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Weekly goal</b><button class="btn ghost sm" id="gl">${goal ? 'Change' : 'Set a goal'}</button></div>
        ${goal ? `<div class="prog" style="margin-top:8px"><i style="width:${Math.min(100, got / goal * 100)}%"></i></div><small class="muted">${peso(got)} of ${peso(goal)}${got >= goal ? ' · goal reached' : ` · ${peso(goal - got)} to go`}</small>` : '<small class="muted">Pick an amount to collect each week. The bar fills as payments come in.</small>'}</div>
      <div class="bar"><input id="q" type="search" placeholder="Search student" value="${esc(q)}" style="flex:1 1 150px;min-width:0"><button class="btn gold" id="sc">📷 Scan card</button>
        <select id="fo" style="width:auto"><option value="owing">Owing</option><option value="all">Everyone</option></select></div>
      <div class="card">${shown.map(r => `<div class="row" data-m="${r.m.id}" style="cursor:pointer"><div class="lead"><span class="ini">${esc(initials(r.m.full_name))}</span><div class="m"><b>${esc(r.m.full_name)}</b>
        <small>${r.items.length ? r.items.map(i => esc(i.label)).slice(0, 3).join(', ') + (r.items.length > 3 ? ` +${r.items.length - 3} more` : '') : 'All paid'}</small></div></div>
        <span class="tag ${r.total ? 'bad' : 'ok'}">${r.total ? peso(r.total) : 'clear'}</span></div>`).join('') || '<p class="empty">Nobody here. Everyone is paid up.</p>'}</div>`;
    el.querySelector('#fo').value = only; el.querySelector('#fo').onchange = e => { only = e.target.value; draw(); };
    const qi = el.querySelector('#q'); qi.oninput = () => { q = qi.value; const p = qi.selectionStart; draw(); const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(p, p); };
    el.querySelector('#gl').onclick = () => modal(`<h3>Weekly goal</h3><form id="gf"><label>Amount to collect each week (₱)</label><input name="g" type="number" min="0" step="50" inputmode="numeric" value="${goal || ''}" required>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button><button type="button" class="btn ghost" id="cx">Cancel</button></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close; m.querySelector('#gf').onsubmit = e => { e.preventDefault(); try { localStorage.setItem(GK, String(+new FormData(e.target).get('g') || 0)); } catch { /* ignore */ } close(); draw(); }; });
    el.querySelector('#sc').onclick = async () => { const r = await scanMember(); if (!r) return; const row = rows.find(x => x.m.id === r.id); if (!row) return toast('That student is not on the active list.', true); toast('Scanned: ' + r.name); collect(row); };
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => collect(rows.find(x => x.m.id === b.dataset.m)));
  }

  /* tick what the student is paying now; each ticked item becomes its own entry (and its own receipt) */
  function collect(row) {
    const { cur, entries } = data;
    if (!cur) return toast('No open period. Open one in Treasury first.', true);
    if (!row.items.length) return toast(`${row.m.full_name} owes nothing right now.`);
    modal(`<h3>${esc(row.m.full_name)}</h3><p class="muted" style="margin:0 0 8px">Tick what is being paid now. Dues can be paid in part by lowering the amount. A fine is paid in full.</p>
      <div id="it">${row.items.map((i, n) => `<div style="display:flex;align-items:center;gap:8px;margin:6px 0"><label class="ck" style="flex:1;margin:0"><input type="checkbox" data-n="${n}" checked><span>${esc(i.label)}${i.when ? `<small>${fmtDate(i.when)}</small>` : ''}</span></label>
        <input data-a="${n}" type="number" min="0.01" max="${i.owed}" step="0.01" value="${i.owed}" inputmode="decimal" style="width:90px"${i.kind === 'fine' ? ' readonly' : ''}></div>`).join('')}</div>
      <div style="display:flex;justify-content:space-between;margin:10px 0;font-size:1.05rem"><span>Total now</span><b id="tt"></b></div>
      <label>Payment method</label><div class="segpay" role="radiogroup"><label><input type="radio" name="method" value="cash" checked><span>💵 Cash</span></label><label><input type="radio" name="method" value="gcash"><span>📱 GCash</span></label></div>
      <div id="gc" style="display:none"><label>GCash reference no.</label><input id="gr" maxlength="40"></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" id="go" style="flex:2"></button><button class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div>`, (m, close) => {
      const pick = () => row.items.map((i, n) => ({ i, on: m.querySelector(`[data-n="${n}"]`).checked, amt: Math.min(i.owed, Math.max(0, +m.querySelector(`[data-a="${n}"]`).value || 0)) })).filter(x => x.on && x.amt > 0);
      const upd = () => { const s = pick().reduce((t, x) => t + x.amt, 0); m.querySelector('#tt').textContent = peso(s); const b = m.querySelector('#go'); b.textContent = s ? `Collect ${peso(s)}` : 'Nothing ticked'; b.disabled = !s; };
      m.querySelectorAll('[data-n],[data-a]').forEach(x => x.oninput = x.onchange = upd); upd();
      m.querySelectorAll('[name=method]').forEach(r => r.onchange = () => { m.querySelector('#gc').style.display = m.querySelector('[name=method]:checked').value === 'gcash' ? 'block' : 'none'; });
      m.querySelector('#cx').onclick = close;
      m.querySelector('#go').onclick = async () => {
        const items = pick(), method = m.querySelector('[name=method]:checked').value, gref = method === 'gcash' ? m.querySelector('#gr').value.trim() : '';
        m.querySelector('#go').disabled = true; let done = 0; const ids = [];
        try {
          const dup = items.map(x => findDuplicate(entries, { kind: 'collection', amount: x.amt, member_id: row.m.id, charge_id: x.i.charge || null })).find(Boolean);
          if (dup && !(await confirmDialog(`${peso(dup.amount)} for ${row.m.full_name} was already recorded a few minutes ago. Record again?`, { ok: 'Record anyway', title: 'Possible duplicate' }))) { m.querySelector('#go').disabled = false; return; }
          for (const { i, amt } of items) {
            const id = uuid(); ids.push(id);
            await safeWrite('v2_entries', { id, period_id: cur.id, kind: 'collection', category: i.kind === 'fine' ? 'Fines' : 'Class Dues', member_id: row.m.id, charge_id: i.charge || null,
              ...(i.violation ? { violation_id: i.violation, fund: 'sails' } : { fund: data.charges.find(c => c.id === i.charge)?.fund || null }), amount: amt, method, gcash_ref: gref || null,
              purpose: i.label, recorded_by_name: ctx.profile.full_name, status: isMayor ? 'approved' : 'pending', approved_by_name: isMayor ? ctx.profile.full_name : null, source: 'manual' });
            done++;
          }
          close(); toast(`${done} payment${done === 1 ? '' : 's'} recorded${isMayor ? '' : '. Waiting for Mayor approval'}`);
          if (isMayor && ids.length === 1) showReceipt(ids[0]).catch(() => {});
          load().catch(() => {});
        } catch (x) { m.querySelector('#er').textContent = done ? `${done} saved before the error: ${x.message}` : x.message; m.querySelector('#go').disabled = false; if (done) load().catch(() => {}); }
      };
    });
  }
}
