import { sb, db, watch, esc, fmtDate, skeleton, toast } from '../core.js';

/* Inspection monitor for the SAILS President and the Class Mayor (also shown as a sub-tab of Watch).
   Notifications: every time the SAILS General Marshal opens or closes inspection.
   Current violators, history, and total fines by classroom and by individual.
   Needs v58 (inspections). Everything else comes from the Watch ledger. */
const FINE = 25;   // fine for the 2nd and later offence of a standard that has no fine of its own (as in Watch)
const ATT = /flag|log\s*in|log\s*out|event log/i;
const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH');
const OPEN = ['pending', 'resolve_requested', 'resolve_forwarded'];
const STATUS = { awaiting_approval: 'awaiting approval', pending: 'pending', resolve_requested: 'resolve requested', resolve_forwarded: 'awaiting VP approval', resolved: 'resolved', rejected: 'rejected' };
const SEEN = uid => 'alpha-insp-seen-' + (uid || 'x');
const readSeen = uid => { try { return localStorage.getItem(SEEN(uid)) || ''; } catch { return ''; } };
const writeSeen = (uid, v) => { try { localStorage.setItem(SEEN(uid), v); } catch { /* ignore */ } };

/* Opened and closed events, newest first. */
export const inspEvents = rows => rows.flatMap(i => [
  { at: i.opened_at, kind: 'opened', by: i.opened_by_name, note: i.note },
  ...(i.closed_at ? [{ at: i.closed_at, kind: 'closed', by: i.closed_by_name, note: i.note }] : []),
]).sort((a, b) => String(b.at).localeCompare(String(a.at)));

/* For the dashboards: is an inspection open, and how many events has this person not seen yet? */
export async function inspectionAlerts(uid) {
  const rows = await sb.from('v2_inspections').select('*').order('opened_at', { ascending: false }).limit(20).then(r => r.data || [], () => []);
  const seen = readSeen(uid), ev = inspEvents(rows);
  return { open: rows.find(r => r.status === 'open') || null, unread: ev.filter(e => String(e.at) > seen).length, latest: ev[0] || null };
}

export async function mountInspection(el, ctx) {
  const uid = ctx.profile.user_id || ctx.user?.id;
  let tab = 'notes', q = '', D = null;
  el.innerHTML = skeleton(4);

  async function exp(which) {
    try {
      toast('Preparing Excel…');
      const { exportXLSX } = await import('../xlsx.js'), by = ctx.profile.full_name;
      const money = { type: 'money' };
      if (which === 'hist') {
        await exportXLSX({ filename: 'Alpha-Inspection-History.xlsx', by, sheets: [{ name: 'Violation history', title: 'Violation history', subtitle: 'Every approved violation, newest first',
          summary: [['Violations', D.rows.length], ['Fines', total(D.rows.filter(v => v.fine)), 'money'], ['Unpaid', owed(D.rows.filter(v => v.fine)), 'money']],
          columns: [{ label: 'Date', key: 'date', width: 14 }, { label: 'Student', key: 'name', width: 30 }, { label: 'Classroom', key: 'room', width: 18 }, { label: 'Violation', key: 'title', width: 32 }, { label: 'Status', key: 'status', width: 18 }, { label: 'Fine', key: 'fine', ...money, total: true }, { label: 'Paid', key: 'paidtxt', width: 10 }],
          rows: D.rows.slice().reverse().map(v => ({ date: v.occurred_on, name: v.name, room: v.room, title: v.title, status: STATUS[v.status] || v.status, fine: v.fine, paidtxt: v.fine ? (v.paid ? 'Paid' : 'Unpaid') : '' })) }] });
      } else {
        const byRoom = group(D.rows, v => v.room), byPerson = group(D.rows.filter(v => v.fine), v => v.member_id);
        await exportXLSX({ filename: 'Alpha-Fines.xlsx', by, sheets: [
          { name: 'By classroom', title: 'Fines by classroom', subtitle: 'Approved violations with a fine', columns: [{ label: 'Classroom', key: 'room', width: 24 }, { label: 'Students', key: 'n' }, { label: 'Violations', key: 'v' }, { label: 'Fines', key: 'tot', ...money, total: true }, { label: 'Unpaid', key: 'ow', ...money, total: true }],
            rows: Object.keys(byRoom).sort().map(r => ({ room: r, n: new Set(byRoom[r].map(v => v.member_id)).size, v: byRoom[r].length, tot: total(byRoom[r]), ow: owed(byRoom[r]) })) },
          { name: 'By individual', title: 'Fines by individual', subtitle: 'Largest unpaid first', columns: [{ label: 'Student', key: 'name', width: 32 }, { label: 'Classroom', key: 'room', width: 18 }, { label: 'Fines', key: 'n' }, { label: 'Total', key: 'tot', ...money, total: true }, { label: 'Unpaid', key: 'ow', ...money, total: true }],
            rows: Object.values(byPerson).sort((a, b) => owed(b) - owed(a) || total(b) - total(a)).map(l => ({ name: l[0].name, room: l[0].room, n: l.length, tot: total(l), ow: owed(l) })) }] });
      }
      toast('Excel ready');
    } catch (e) { toast(e.message || 'Could not make the file', true); }
  }
  async function load() {
    const [insp, members, units, standards, viol, ent] = await Promise.all([
      sb.from('v2_inspections').select('*').order('opened_at', { ascending: false }).limit(60).then(r => r.data || [], () => []),
      db(sb.from('v2_members').select('id,full_name,student_no,unit_id,status')).catch(() => []),
      sb.from('v2_units').select('id,name').then(r => r.data || [], () => []),
      db(sb.from('v2_standards').select('id,title,fine,kind')).catch(() => []),
      db(sb.from('v2_violations').select('id,member_id,standard_id,occurred_on,status,excuse_status,created_at').order('created_at')).catch(() => []),
      sb.from('v2_entries').select('violation_id').not('violation_id', 'is', null).neq('status', 'voided').then(r => r.data || [], () => []),
    ]);
    const mem = Object.fromEntries(members.map(m => [m.id, m])), std = Object.fromEntries(standards.map(s => [s.id, s]));
    const unitName = Object.fromEntries(units.map(u => [u.id, u.name]));
    const room = m => (m && unitName[m.unit_id]) || 'No classroom';
    const paid = new Set(ent.map(x => x.violation_id));
    const counted = viol.filter(v => !['awaiting_approval', 'rejected'].includes(v.status) && !(std[v.standard_id]?.kind) && !ATT.test(std[v.standard_id]?.title || ''));
    const seen = {}, num = {};
    counted.forEach(v => { const s = std[v.standard_id]; if (s && s.fine) return; seen[v.member_id] = (seen[v.member_id] || 0) + 1; num[v.id] = seen[v.member_id]; });
    const fineOf = v => { if (v.excuse_status === 'accepted') return 0; const s = std[v.standard_id]; if (s && s.fine) return Number(s.fine); return (num[v.id] || 0) >= 2 ? FINE : 0; };
    const rows = counted.map(v => { const m = mem[v.member_id]; return { ...v, name: m?.full_name || '?', no: m?.student_no || '', room: room(m), title: std[v.standard_id]?.title || 'Violation', fine: fineOf(v), paid: paid.has(v.id) }; });
    D = { insp, rows, ev: inspEvents(insp) };
    paint();
  }

  const group = (list, keyFn) => { const o = {}; list.forEach(x => { (o[keyFn(x)] = o[keyFn(x)] || []).push(x); }); return o; };
  const owed = l => l.filter(v => !v.paid).reduce((a, v) => a + v.fine, 0), total = l => l.reduce((a, v) => a + v.fine, 0);
  const ago = t => fmtDate(String(t).slice(0, 10) + 'T00:00:00+08:00') + ' ' + new Date(t).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

  function notes() {
    const seen = readSeen(uid), open = D.insp.find(i => i.status === 'open');
    return `${open ? `<div class="card pad" style="margin-bottom:14px"><b>Inspection is open</b><br><small class="muted">${esc(open.note)} · opened by ${esc(open.opened_by_name || '')} · ${ago(open.opened_at)}</small></div>` : '<div class="card pad" style="margin-bottom:14px"><b>Inspection is closed</b><br><small class="muted">The SAILS General Marshal opens it.</small></div>'}
      <div class="card">${D.ev.map(e => `<div class="row"><div class="m"><b>Inspection ${e.kind}</b><small>${esc(e.note)} · ${esc(e.by || '')} · ${ago(e.at)}</small></div>${String(e.at) > seen ? '<span class="tag warn">new</span>' : ''}</div>`).join('') || '<p class="empty">No inspection has been opened yet.</p>'}</div>`;
  }
  function now() {
    const open = D.rows.filter(v => OPEN.includes(v.status)), by = group(open, v => v.room);
    return Object.keys(by).sort().map(r => {
      const people = group(by[r], v => v.member_id);
      return `<h3 style="margin:14px 2px 8px">${esc(r)} <span class="muted" style="font-weight:400">· ${Object.keys(people).length} student${Object.keys(people).length === 1 ? '' : 's'}</span></h3><div class="card">${Object.values(people).map(l => `<div class="row"><div class="m"><b>${esc(l[0].name)}</b><small>${l.length} open · ${esc([...new Set(l.map(v => v.title))].join(', '))}</small></div><div style="text-align:right"><b>${owed(l) ? peso(owed(l)) : '–'}</b></div></div>`).join('')}</div>`;
    }).join('') || '<div class="card"><p class="caught">No student has an open violation.</p></div>';
  }
  function history() {
    const f = q.trim().toLowerCase(), list = D.rows.slice().reverse().filter(v => !f || (v.name + ' ' + v.no + ' ' + v.title + ' ' + v.room).toLowerCase().includes(f)).slice(0, 150);
    return `<div style="display:flex;gap:8px;margin-bottom:10px"><input id="hq" placeholder="Search a name, student ID or violation…" value="${esc(q)}" style="flex:1"><button type="button" class="btn ghost" id="xh">Excel</button></div><div class="card">${list.map(v => `<div class="row"><div class="m"><b>${esc(v.name)}</b><small>${esc(v.title)} · ${esc(v.room)} · ${fmtDate(v.occurred_on)} · ${STATUS[v.status] || v.status}${v.excuse_status === 'accepted' ? ' · excused' : ''}</small></div><div style="text-align:right">${v.fine ? `<b>${peso(v.fine)}</b><small class="muted" style="display:block">${v.paid ? 'paid' : 'unpaid'}</small>` : '<span class="muted">–</span>'}</div></div>`).join('') || '<p class="empty">No violations.</p>'}</div>`;
  }
  function fines() {
    const byRoom = group(D.rows, v => v.room), byPerson = group(D.rows.filter(v => v.fine), v => v.member_id);
    const tot = D.rows.filter(v => v.fine);
    return `<div style="text-align:right;margin-bottom:8px"><button type="button" class="btn ghost sm" id="xf">Excel</button></div><div class="card pad" style="margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap"><div><small class="muted">All fines</small><div style="font-size:1.3rem;font-weight:700">${peso(total(tot))}</div></div><div><small class="muted">Paid</small><div style="font-size:1.3rem;font-weight:700">${peso(total(tot) - owed(tot))}</div></div><div><small class="muted">Unpaid</small><div style="font-size:1.3rem;font-weight:700">${peso(owed(tot))}</div></div></div>
      <h3 style="margin:0 2px 8px">By classroom</h3><div class="card">${Object.keys(byRoom).sort().map(r => { const l = byRoom[r]; return `<div class="row"><div class="m"><b>${esc(r)}</b><small>${new Set(l.map(v => v.member_id)).size} students · ${l.length} violations</small></div><div style="text-align:right"><b>${peso(total(l))}</b><small class="muted" style="display:block">${peso(owed(l))} unpaid</small></div></div>`; }).join('') || '<p class="empty">No fines yet.</p>'}</div>
      <h3 style="margin:14px 2px 8px">By individual</h3><div class="card">${Object.values(byPerson).sort((a, b) => owed(b) - owed(a) || total(b) - total(a)).map(l => `<div class="row"><div class="m"><b>${esc(l[0].name)}</b><small>${esc(l[0].room)} · ${l.length} fine${l.length === 1 ? '' : 's'}</small></div><div style="text-align:right"><b>${peso(total(l))}</b><small class="muted" style="display:block">${owed(l) ? peso(owed(l)) + ' unpaid' : 'all paid'}</small></div></div>`).join('') || '<p class="empty">No fines yet.</p>'}</div>`;
  }

  function paint() {
    const unread = D.ev.filter(e => String(e.at) > readSeen(uid)).length;
    const T = [['notes', 'Notifications' + (unread ? ` (${unread})` : '')], ['now', 'Current violators'], ['hist', 'History'], ['fines', 'Fines']];
    el.innerHTML = `<div class="subtabs" role="tablist">${T.map(([id, l]) => `<button type="button" role="tab" aria-selected="${id === tab}" data-t="${id}">${esc(l)}</button>`).join('')}</div>
      ${tab === 'notes' && unread ? '<div style="text-align:right;margin:-4px 0 8px"><button type="button" class="btn ghost sm" id="mr">Mark all read</button></div>' : ''}
      ${{ notes, now, hist: history, fines }[tab]()}`;
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    el.querySelector('#mr')?.addEventListener('click', () => { writeSeen(uid, new Date().toISOString()); paint(); });
    el.querySelector('#xh')?.addEventListener('click', () => exp('hist'));
    el.querySelector('#xf')?.addEventListener('click', () => exp('fines'));
    const hq = el.querySelector('#hq'); if (hq) hq.oninput = () => { q = hq.value; const p = hq.selectionStart; paint(); const n = el.querySelector('#hq'); n.focus(); n.setSelectionRange(p, p); };
  }

  await load();
  watch(['v2_inspections', 'v2_violations', 'v2_entries'], () => { if (document.contains(el)) load().catch(() => {}); });
}
