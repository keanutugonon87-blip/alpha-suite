import { sb, db, watch, esc, toast, modal, skeleton, fmtDateTime, printHTML, letterhead } from '../core.js';

/* Requests to the office of the SAILS Treasurer.
   A Class Treasurer asks for permission to scan student QR cards when collecting, or for the masterlist of the section.
   The SAILS Treasurer grants or denies. Run supabase/v75_treasurer_requests.sql once. */
const KIND = { scan: 'QR scanning for collections', masterlist: 'Masterlist of the section' };
const ST = { open: ['Waiting for the SAILS Treasurer', 'warn'], granted: ['Granted', 'ok'], denied: ['Denied', 'bad'], revoked: ['Taken back', 'bad'] };

export async function mountTreqs(el, ctx) {
  const role = ctx.profile.role, isCT = role === 'class_treasurer', isTr = role === 'treasurer';
  let rows = [], units = new Map(), setup = false;
  el.innerHTML = skeleton(3);

  async function load() {
    const r = await sb.from('v2_treasury_requests').select('*').order('requested_at', { ascending: false }).limit(100);
    if (r.error) { setup = true; draw(); return; }
    setup = false; rows = r.data || [];
    units = new Map((await sb.from('v2_units').select('id,name').then(x => x.data || [], () => [])).map(u => [u.id, u.name]));
    draw();
  }

  const live = r => r.kind === 'scan' && r.status === 'granted' && r.expires_at && new Date(r.expires_at) > new Date();
  const when = d => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  function card(r) {
    const expired = r.kind === 'scan' && r.status === 'granted' && !live(r);
    const [lbl, cls] = expired ? ['Expired', ''] : ST[r.status] || [r.status, ''];
    const acts = [
      isTr && r.status === 'open' ? `<button class="btn gold sm" data-grant="${r.id}">Grant</button><button class="btn ghost sm" data-deny="${r.id}">Deny</button>` : '',
      isTr && live(r) ? `<button class="btn ghost sm" data-revoke="${r.id}">Take back</button>` : '',
      r.kind === 'masterlist' && r.status === 'granted' && r.snapshot ? `<button class="btn gold sm" data-open="${r.id}">Open masterlist</button>` : ''].filter(Boolean).join('');
    return `<div class="card" style="margin-bottom:10px"><div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="m"><b>${KIND[r.kind]}</b><small>${esc(units.get(r.unit_id) || '')}${r.requested_by_name ? ' · ' + esc(r.requested_by_name) : ''} · ${fmtDateTime(r.requested_at)}</small></div><span class="tag ${cls}">${lbl}</span></div>
      ${r.reason ? `<p style="margin:6px 0 0">“${esc(r.reason)}”</p>` : ''}
      ${r.decided_at ? `<small class="muted" style="display:block;margin-top:4px">${esc(r.decided_by_name || '')} · ${fmtDateTime(r.decided_at)}${r.decision_note ? ' · ' + esc(r.decision_note) : ''}</small>` : ''}
      ${r.kind === 'scan' && r.status === 'granted' ? `<small class="muted" style="display:block;margin-top:4px">${live(r) ? 'Scanning is on until ' + when(r.expires_at) : 'The permission ended ' + when(r.expires_at)}</small>` : ''}
      ${acts ? `<div class="acts" style="margin-top:8px">${acts}</div>` : ''}</div></div>`;
  }

  function draw() {
    if (setup) { el.innerHTML = '<div class="card"><p class="empty">Run the v75 SQL in Supabase to turn this on.</p></div>'; return; }
    const scanOn = rows.some(live), scanOpen = rows.some(r => r.kind === 'scan' && r.status === 'open'), mlOpen = rows.some(r => r.kind === 'masterlist' && r.status === 'open');
    const waiting = rows.filter(r => r.status === 'open'), rest = rows.filter(r => r.status !== 'open');
    const intro = isCT ? 'Ask the office of the SAILS Treasurer for permission to scan student QR cards when you collect, or for the masterlist of your section. You can still record payments by hand without scanning.'
      : isTr ? 'Class Treasurers ask you for QR scanning or for their masterlist. A scan permission lasts the days you choose and you can take it back.' : 'Requests from the Class Treasurers to the SAILS Treasurer.';
    el.innerHTML = `<p class="muted" style="margin:0 2px 10px">${intro}</p>
      ${isCT ? `<div class="card pad" style="margin-bottom:12px"><div class="bar" style="flex-wrap:wrap;gap:8px"><button class="btn gold" id="rq-scan"${scanOn || scanOpen ? ' disabled' : ''}>${scanOn ? 'QR scanning is on' : scanOpen ? 'Scan request waiting' : 'Request QR scanning'}</button><button class="btn" id="rq-ml"${mlOpen ? ' disabled' : ''}>${mlOpen ? 'Masterlist request waiting' : 'Request the masterlist'}</button></div></div>` : ''}
      ${waiting.length ? `<h3 style="margin:14px 2px 8px">${isTr ? 'Needs you' : 'Waiting'}</h3>${waiting.map(card).join('')}` : ''}
      <h3 style="margin:14px 2px 8px">${waiting.length ? 'Earlier' : 'Requests'}</h3>
      ${rest.length ? rest.map(card).join('') : '<div class="empty"><b>No requests yet</b>They show here once a Class Treasurer sends one.</div>'}`;
    wire();
  }

  function wire() {
    const g = s => el.querySelector(s);
    g('#rq-scan')?.addEventListener('click', () => askForm('scan'));
    g('#rq-ml')?.addEventListener('click', () => askForm('masterlist'));
    el.querySelectorAll('[data-grant]').forEach(b => b.onclick = () => decide(b.dataset.grant, true));
    el.querySelectorAll('[data-deny]').forEach(b => b.onclick = () => decide(b.dataset.deny, false));
    el.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => revoke(b.dataset.revoke));
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openList(b.dataset.open));
  }

  function askForm(kind) {
    modal(`<h3>${KIND[kind]}</h3><form id="f"><label>Why do you need it?</label><textarea name="r" rows="3" maxlength="300" placeholder="${kind === 'scan' ? 'e.g. Collecting the Siglakas shirt payments this week' : 'e.g. To check who has not paid'}"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Send request</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const b = m.querySelector('.btn.gold'); b.disabled = true;
        try { await db(sb.rpc('v2_treq_ask', { p_kind: kind, p_reason: new FormData(e.target).get('r').trim() || null })); toast('Request sent'); close(); load().catch(() => {}); }
        catch (x) { m.querySelector('#er').textContent = x.message; b.disabled = false; } };
    });
  }

  function decide(id, grant) {
    const r = rows.find(x => x.id === id); if (!r) return;
    modal(`<h3>${grant ? 'Grant' : 'Deny'} · ${KIND[r.kind]}</h3><p class="muted" style="margin:0 0 8px">${esc(units.get(r.unit_id) || '')} · ${esc(r.requested_by_name || '')}</p>
      <form id="f">${grant && r.kind === 'scan' ? '<label>Scanning stays on for (days)</label><input name="d" type="number" min="1" max="30" value="7" required>' : ''}${grant && r.kind === 'masterlist' ? '<p class="muted">A copy of the section’s active students is issued to the Class Treasurer.</p>' : ''}
      <label>Note ${grant ? '(optional)' : '(needed)'}</label><input name="n" maxlength="300" ${grant ? '' : 'required'}>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">${grant ? 'Grant' : 'Deny'}</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), b = m.querySelector('.btn.gold'); b.disabled = true;
        try { await db(sb.rpc('v2_treq_decide', { p_id: id, p_grant: grant, p_note: (f.get('n') || '').trim() || null, p_days: +(f.get('d') || 7) })); toast(grant ? 'Granted' : 'Denied'); close(); load().catch(() => {}); }
        catch (x) { m.querySelector('#er').textContent = x.message; b.disabled = false; } };
    });
  }

  function revoke(id) {
    modal(`<h3>Take scanning back?</h3><form id="f"><label>Note (optional)</label><input name="n" maxlength="300">
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Take back</button><button type="button" class="btn ghost" id="cx">Cancel</button></div><div class="err" id="er"></div></form>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#f').onsubmit = async e => { e.preventDefault(); const b = m.querySelector('.btn.gold'); b.disabled = true;
        try { await db(sb.rpc('v2_treq_revoke', { p_id: id, p_note: new FormData(e.target).get('n').trim() || null })); toast('Scanning switched off'); close(); load().catch(() => {}); }
        catch (x) { m.querySelector('#er').textContent = x.message; b.disabled = false; } };
    });
  }

  function openList(id) {
    const r = rows.find(x => x.id === id), s = r?.snapshot; if (!s) return;
    modal(`<h3>Masterlist · ${esc(s.section || '')}</h3><p class="muted" style="margin:0 0 8px">${s.count} active students · issued ${fmtDateTime(s.issued_at)} by ${esc(r.decided_by_name || 'the SAILS Treasurer')}</p>
      <div class="card" style="max-height:50vh;overflow:auto">${(s.students || []).map((x, i) => `<div class="row"><div class="m"><b>${i + 1}. ${esc(x.name)}</b><small>${esc(x.student_no || '')}</small></div></div>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn gold" id="pr" style="flex:1">Print / PDF</button><button class="btn ghost" id="cx">Close</button></div>`, (m, close) => {
      m.querySelector('#cx').onclick = close;
      m.querySelector('#pr').onclick = () => {
        const sg = (title, name, role, at) => `<div style="flex:1;min-width:150px;border-top:1.5px solid #14233f;padding-top:4px;text-align:center"><div style="height:0"></div><b>${name ? esc(name) : '&nbsp;'}</b><br><small style="color:#58708a;font-size:11px">${esc(title)} · ${esc(role)}${at ? '<br>' + fmtDateTime(at) : ''}</small></div>`;
        printHTML('Masterlist - ' + (s.section || ''), `${letterhead('Masterlist', (s.section || '') + ' · issued by the SAILS Treasurer · ' + new Date(s.issued_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }))}
          <div class="sum"><div>Section<b>${esc(s.section || '')}</b></div><div>Active students<b>${s.count}</b></div><div>Issued on<b>${new Date(s.issued_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</b></div></div>
          <h2>Students</h2><table><thead><tr><th style="width:36px">#</th><th>Name</th><th>Student ID</th><th style="width:170px">Signature</th></tr></thead><tbody>${(s.students || []).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.student_no || '')}</td><td style="height:30px;border-bottom:1px solid #9fb7c4"></td></tr>`).join('')}</tbody></table>
          <div style="display:flex;gap:60px 18px;flex-wrap:wrap;margin-top:54px">${sg('Requested by', r.requested_by_name, 'Class Treasurer', r.requested_at)}${sg('Issued by', r.decided_by_name, 'SAILS Treasurer', r.decided_at)}</div>`);
      };
    });
  }

  await load();
  return watch(['v2_treasury_requests'], () => { if (el.isConnected && !document.querySelector('.modal')) load().catch(() => {}); });
}
