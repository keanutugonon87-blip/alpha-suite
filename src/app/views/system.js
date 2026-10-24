import { sb, db, esc, toast, fmtDateTime, confirmDialog, peso, modal, printHTML, letterhead } from '../core.js';

const ago = d => { const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const EV = { login: 'signed in', setup: 'made a PIN', fail: 'wrong PIN', locked: 'locked out (too many tries)', reset: 'PIN reset by an officer' };
const SITE = () => location.origin + location.pathname;
const REMIND = names => `Alpha ’28 sign-in reminder: please set up your PIN now. Open ${SITE()} > Check my status > "First time or forgot your PIN? Set it up". Have your Student ID and QR card ready.\n\nStill needed (${names.length}): ${names.join(', ')}`;
async function signupSheet() {
  const { qrDataUrl } = await import('../qr.js'); const qr = await qrDataUrl(SITE(), 260);
  printHTML('Alpha 28 sign-up sheet', `${letterhead('How to sign in to Alpha ’28', 'BSMT 1-Alpha · Batch 28')}
    <div style="display:flex;gap:24px;align-items:center;margin:14px 0"><img src="${qr}" style="width:200px;height:200px" alt="QR code to the site"><div style="font-size:15px;line-height:1.6"><b>${esc(SITE())}</b><br>Scan the code or type the link.</div></div>
    <h2>Create your account (one time)</h2><ol style="font-size:15px;line-height:1.8"><li>Open the site and tap <b>Check my status</b>.</li><li>Tap <b>First time or forgot your PIN? Set it up</b>.</li><li>Scan or paste your <b>QR card</b>. This proves the account is yours.</li><li>Type your <b>Student ID</b>, then choose a <b>6-digit PIN</b> twice. Do not use 123456 or 000000.</li></ol>
    <h2>After that</h2><p style="font-size:15px">Sign in with your <b>Student ID</b> and <b>PIN</b>. You stay signed in for 30 days. Never share your PIN. Lost your PIN? Use your QR card to set a new one.</p>
    <h2>Paano mag-sign in (Bisaya)</h2><ol style="font-size:15px;line-height:1.8"><li>Ablihi ang site ug i-tap ang <b>Check my status</b>.</li><li>I-tap ang <b>First time or forgot your PIN? Set it up</b>.</li><li>I-scan o i-paste ang imong <b>QR card</b>.</li><li>Ibutang ang imong <b>Student ID</b>, dayon pagpili og <b>6-ka-numerong PIN</b> kaduha.</li></ol>
    <p style="font-size:13px;color:#58708a">Wala pay QR card o nalimtan ang PIN? Pangayo sa Treasurer o Mayor.</p>`, { plain: true });
}
const NEED_SQL = e => /function|schema cache|does not exist/i.test(e.message);
const JOBS = { 'alpha28-weekly-backup': 'Weekly backup (Monday 3 AM)', 'alpha28-auto-nudge': 'Due-date reminders (daily 9 AM)', 'alpha28-duty-alerts': 'Officer duty alerts (every 15 minutes)', 'alpha28-watchdog': 'Daily system check (7 AM)' };

const HANDOVER = [
  ['mo', 'Close the last month: count the money, then close it (Treasury > Month close).'],
  ['rep', 'Print the final monthly report and post it in the class group chat.'],
  ['bk', 'Download a fresh backup (Accounts > Backups) and save it somewhere outside Supabase.'],
  ['acc', 'Give each new officer their own account and role (Accounts). Never share one login.'],
  ['old', 'Remove or downgrade the accounts of officers who are leaving.'],
  ['key', 'Change the alert key (Security, below) because outgoing officers knew it.'],
  ['pay', 'Update the payment note with the new Treasurer\'s GCash details.'],
  ['chg', 'Open the Balances tab and close charges that are finished.'],
  ['own', 'Make sure two different officers can approve big expenses (a Vice Mayor or Auditor account exists).'],
];

const SQL_FILES = ['v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11', 'v12', 'v14'];   // v13 is optional, so it is never reported as missing
/* System tab: is everything running, and the few settings the Mayor and Treasurer own. */
export async function mountSystem(el, ctx) {
  const isMayor = ctx.can('mayor'), canSee = ctx.can('mayor', 'vice_mayor'), canNote = ctx.can('mayor', 'treasurer');

  let ticks = {}; try { ticks = JSON.parse(localStorage.getItem('alpha-handover') || '{}'); } catch { /* ignore */ }
  async function draw() {
    let h = null, miss = false, note = '';
    if (canSee) { try { h = await db(sb.rpc('v2_health')); } catch (e) { if (NEED_SQL(e)) miss = true; else throw e; } }
    let su = null, sec = null;
    if (ctx.can('mayor', 'vice_mayor', 'secretary', 'treasurer')) su = await sb.rpc('v2_signup_status').then(r => r.data || null, () => null);
    if (canSee) sec = await sb.rpc('v2_security_overview').then(r => r.data || null, () => null);
    const nopin = (su || []).filter(m => !m.has_pin), havePin = (su || []).length - nopin.length;
    const pct = su && su.length ? Math.round(havePin / su.length * 100) : 0;
    const verdict = !su ? '' : !nopin.length ? ['ok', 'Ready: everyone has a PIN.'] : pct >= 80 ? ['warn', `Almost: ${nopin.length} student${nopin.length === 1 ? '' : 's'} would be locked out.`] : ['bad', `Not yet: ${nopin.length} of ${su.length} would be locked out.`];
    let ls = null, guests = [];
    if (canSee) { ls = await sb.rpc('v2_login_stats').then(r => r.data || null, () => null); if (ls) guests = await sb.rpc('v2_guest_list').then(r => r.data || [], () => []); }
    if (h) note = h.pay_note || '';
    else if (canNote) note = await sb.from('v2_settings').select('value').eq('key', 'pay_note').maybeSingle().then(r => r.data?.value || '', () => '');

    const okDays = h?.last_ok_backup ? (Date.now() - new Date(h.last_ok_backup)) / 864e5 : Infinity;
    const lines = h ? [
      ['Database', 'Reachable', true],
      ['Backups', h.last_ok_backup ? `Last good backup ${ago(h.last_ok_backup)}` : 'No backup recorded yet', okDays <= 8],
      ...(h.last_backup ? [['Backup check', h.last_backup.verified === true ? (h.last_backup.verify_note || 'The backup file matches the database.') : h.last_backup.verified === false ? `Does not match: ${h.last_backup.verify_note || 'unknown reason'}` : 'Not checked yet. The weekly-backup function needs the update to check itself.', h.last_backup.verified !== false]] : []),
      ...(h.problems ? [['Problems found', h.problems.length ? h.problems.join('. ') : 'No problems found. Runs every morning at 7:00 and alerts you if one appears.', !h.problems.length]] : []),
      ...(h.applied ? [['SQL files run', (() => { const miss = SQL_FILES.filter(f => !h.applied.includes(f)); return miss.length ? `Missing: ${miss.join(', ')}. Run those files in the Supabase SQL Editor.` : `All up to date (${h.applied.slice().sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))).join(', ')})`; })(), SQL_FILES.every(f => h.applied.includes(f))]] : []),
      ['Reminders', `${h.linked} of ${h.members} students have reminders on${h.last_reminder ? ` · last sent ${ago(h.last_reminder)}` : ''}`, h.linked > 0],
      ['Officer alerts', `${h.staff_devices} device${h.staff_devices === 1 ? '' : 's'} get sign-up alerts`, true],
      ['Open work', `${h.open_charges} open charge${h.open_charges === 1 ? '' : 's'} · ${h.pending_entries} entr${h.pending_entries === 1 ? 'y' : 'ies'} waiting for approval`, true],
      ...(h.jobs || []).map(j => [JOBS[j.name] || j.name, `${j.active ? 'Scheduled' : 'Switched off'}${j.last_run ? ` · last ran ${ago(j.last_run)}${j.last_status && j.last_status !== 'succeeded' ? ` (${j.last_status})` : ''}` : ' · has not run yet'}`, j.active && (!j.last_status || j.last_status === 'succeeded')]),
    ] : [];

    el.innerHTML = `${miss ? '<div class="alertbar bad"><span>⚠️ The system page is not switched on in the database yet. Run the v4 SQL in Supabase.</span></div>' : ''}
      ${h && h.problems && h.problems.length ? `<div class="alertbar bad"><span>⚠️ ${h.problems.map(esc).join('. ')}.</span></div>` : ''}
      ${h ? `<h3 class="sec">Health</h3><div class="card">${lines.map(([k, v, ok]) => `<div class="row"><div class="m"><b>${esc(k)}</b><small>${esc(v)}</small></div><span class="tag ${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'Check'}</span></div>`).join('')}</div>
        <p class="muted" style="font-size:.85rem">Checked ${fmtDateTime(h.now)}. The list refreshes when you open this tab.</p>` : ''}
      ${canNote ? `<h3 class="sec">Payment note for students</h3><form class="card pad" id="pn"><p class="muted" style="margin:0 0 8px">Shown on every student's My Status page while they still owe something. For example your GCash number and who to pay.</p>
        <textarea name="v" rows="3" maxlength="300" placeholder="e.g. GCash 09xx xxx xxxx (Treasurer name). Send the screenshot after paying.">${esc(note)}</textarea><button class="btn gold sm" style="margin-top:8px">Save note</button></form>` : ''}
      ${sec && (sec.locked_now.length || sec.fails_24h >= 10) ? `<div class="alertbar bad"><span>🔒 ${sec.locked_now.length ? `${sec.locked_now.length} student${sec.locked_now.length === 1 ? ' is' : 's are'} locked out right now. ` : ''}${sec.fails_24h} wrong PIN tr${sec.fails_24h === 1 ? 'y' : 'ies'} in the last 24 hours. See Sign-in security below.</span></div>` : ''}
      ${su ? `<h3 class="sec">Class sign-up</h3><div class="card pad"><div style="display:flex;justify-content:space-between;gap:8px"><b>${havePin} of ${su.length} have a PIN</b><span class="muted">${pct}%</span></div><div class="prog" role="img" aria-label="${pct} percent have a PIN"><i style="width:${pct}%"></i></div>
        ${canSee && verdict ? `<p style="margin:10px 0 0"><span class="tag ${verdict[0]}">${esc(verdict[1])}</span> <small class="muted">This is who would be locked out if you turned sign-in on today.</small></p>` : ''}
        ${nopin.length ? `<details style="margin-top:10px"><summary>${nopin.length} still need a PIN</summary><div style="margin-top:6px">${nopin.map(m => `<div class="row"><div class="m"><b>${esc(m.name)}</b><small>${m.student_no && !/^pending/i.test(m.student_no) ? esc(m.student_no) : 'No Student ID yet'}</small></div></div>`).join('')}</div></details>` : '<p class="muted" style="margin:10px 0 0">Everyone is set up.</p>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${nopin.length ? '<button class="btn gold sm" id="cr">Copy reminder for the group chat</button>' : ''}<button class="btn ghost sm" id="ps">Print sign-up sheet</button></div></div>` : ''}
      ${canSee && ls ? `<h3 class="sec">Sign-in</h3><div class="card pad">
        <div class="row" style="border:0;padding-top:0"><div class="m"><b>Require sign-in</b><small>${ls.require ? 'ON: only signed-in students, officers and guests can see the class page.' : 'OFF: the class page is open to anyone with the link.'}</small></div>
          ${isMayor ? `<select id="rl" style="width:auto"><option value="off"${ls.require ? '' : ' selected'}>Off</option><option value="on"${ls.require ? ' selected' : ''}>On</option></select>` : `<span class="tag ${ls.require ? 'ok' : 'warn'}">${ls.require ? 'On' : 'Off'}</span>`}</div>
        <p class="muted" style="margin:8px 0 0">${ls.with_pin} of ${ls.active} active students have a PIN · ${ls.signed_in_30d} signed in during the last 30 days${ls.no_id ? ` · <b>${ls.no_id}</b> still have no Student ID on the list (they cannot create an account)` : ''}.</p>
        <p class="muted" style="margin:6px 0 0;font-size:.85rem">Leave it off until most of the class has a PIN. You can turn it off again at any time. Officers can always use the email sign-in at the top right.</p></div>
        <h3 class="sec">Guest codes</h3><div class="card pad"><p class="muted" style="margin:0 0 8px">For parents or visitors. A guest sees the fund totals, officers and announcements only. No names, balances or violations.</p>
          ${guests.length ? guests.map(g => `<div class="row"><div class="m"><b>${esc(g.label)}</b><small>${g.active ? 'Valid until ' + fmtDateTime(g.expires_at) : g.revoked ? 'Cancelled' : 'Expired'}${g.last_used_at ? ' · last used ' + ago(g.last_used_at) : ' · not used yet'}</small></div>${isMayor && g.active ? `<button class="btn ghost sm" data-gr="${g.id}">Cancel</button>` : `<span class="tag ${g.active ? 'ok' : 'warn'}">${g.active ? 'Active' : 'Closed'}</span>`}</div>`).join('') : '<p class="muted" style="margin:0">No guest codes yet.</p>'}
          ${isMayor ? `<form id="gn" style="margin-top:10px;display:grid;gap:6px"><label>Who is it for?</label><input name="l" maxlength="60" placeholder="e.g. Parent of Juan Dela Cruz" required>
            <label>Valid for</label><select name="d"><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option><option value="30">30 days</option></select><button class="btn gold sm">Make a guest code</button></form>` : ''}</div>` : ''}
      ${sec ? `<h3 class="sec">Sign-in security</h3><div class="card pad"><div class="grid"><div class="stat ${sec.locked_now.length ? '' : 'gold'}"><small>Locked now</small><b>${sec.locked_now.length}</b></div><div class="stat"><small>Wrong tries (24 h)</small><b>${sec.fails_24h}</b></div><div class="stat"><small>PIN resets (7 d)</small><b>${sec.resets_7d}</b></div></div>
        ${sec.locked_now.length ? `<div style="margin-top:10px">${sec.locked_now.map(l => `<div class="row"><div class="m"><b>${esc(l.name)}</b><small>Locked until ${fmtDateTime(l.until)} · ${l.fails} wrong tries</small></div><span class="tag bad">Locked</span></div>`).join('')}<p class="muted" style="font-size:.85rem">A locked student can wait, or the Treasurer or Mayor can reset their PIN in the Students tab. If it was not them, reset the PIN and tell them.</p></div>` : ''}
        <details style="margin-top:10px"><summary>Recent sign-in activity</summary>${sec.recent.length ? sec.recent.map(r => `<div class="row"><div class="m"><b>${esc(r.name)}</b><small>${esc(EV[r.event] || r.event)} · ${ago(r.at)}</small></div></div>`).join('') : '<p class="muted">Nothing yet.</p>'}</details></div>` : ''}
      ${isMayor && h ? `<h3 class="sec">Rules</h3><div class="card pad">
        <div class="row" style="border:0;padding-top:0"><div class="m"><b>Automatic due-date reminders</b><small>Sends the reminder to students who owe, 2 days before a charge is due and on the day. Daily at 9 AM.</small></div>
          <select id="an" style="width:auto"><option value="off"${h.auto_nudge === 'on' ? '' : ' selected'}>Off</option><option value="on"${h.auto_nudge === 'on' ? ' selected' : ''}>On</option></select></div>
        <form id="th" style="margin-top:10px"><label>Expenses of this amount or more need a second officer (₱, 0 turns it off)</label>
          <div style="display:flex;gap:8px"><input name="t" type="number" min="0" step="1" value="${esc(h.threshold)}" inputmode="numeric" style="max-width:160px"><button class="btn gold sm">Save</button></div>
          <small class="muted">Currently ${+h.threshold > 0 ? peso(h.threshold) : 'off'}. The person who recorded the expense cannot approve it.</small></form></div>
        <h3 class="sec">Security</h3><div class="card pad"><p style="margin:0 0 8px"><b>Alert key</b></p>
          <p class="muted" style="margin:0 0 8px">The database and the alert and backup functions prove who they are with a shared secret key. Change it now and then, or at once if an officer who knew it leaves. Nothing else needs updating.</p>
          <button class="btn ghost sm" id="rot">Change the key now</button>
          <p class="muted" style="margin:12px 0 0;font-size:.85rem">The QR card key is not changed here, because that would make every printed card stop working. If it ever leaks, ask for a fresh set of cards to be issued.</p></div>
        <h3 class="sec">Officer handover</h3><div class="card pad"><p class="muted" style="margin:0 0 8px">Work through this when a new set of officers takes over. Your ticks are saved on this phone only.</p>
          ${HANDOVER.map(([k, txt]) => `<label class="row" style="border:0;cursor:pointer;align-items:flex-start;gap:10px"><input type="checkbox" data-h="${k}"${ticks[k] ? ' checked' : ''} style="width:auto;margin-top:4px"><span>${esc(txt)}</span></label>`).join('')}</div>` : ''}`;
    el.querySelectorAll('[data-h]').forEach(c => c.onchange = () => { ticks[c.dataset.h] = c.checked; try { localStorage.setItem('alpha-handover', JSON.stringify(ticks)); } catch { /* ignore */ } });

    el.querySelector('#pn')?.addEventListener('submit', async e => { e.preventDefault();
      try { await db(sb.rpc('v2_set_setting', { p_key: 'pay_note', p_value: new FormData(e.target).get('v') || '' })); toast('Saved. Students will see it on My Status.'); }
      catch (x) { toast(NEED_SQL(x) ? 'Not switched on in the database yet. Run the v4 SQL.' : x.message, true); } });
    el.querySelector('#cr')?.addEventListener('click', async () => { const txt = REMIND(nopin.map(m => m.name)); try { await navigator.clipboard.writeText(txt); toast('Reminder copied. Paste it in the group chat.'); } catch { modal(`<h3>Reminder</h3><textarea rows="8" readonly>${esc(txt)}</textarea><button class="btn ghost" id="x" style="width:100%;margin-top:10px">Close</button>`, (m, c) => { m.querySelector('#x').onclick = c; }); } });
    el.querySelector('#ps')?.addEventListener('click', () => signupSheet().catch(x => toast(x.message, true)));
    el.querySelector('#rl')?.addEventListener('change', async e => {
      const on = e.target.value === 'on';
      if (on && !await confirmDialog(`${nopin.length ? `${nopin.length} of ${su ? su.length : ls.active} students do not have a PIN yet (${nopin.slice(0, 6).map(m => m.name.split(' ')[0]).join(', ')}${nopin.length > 6 ? ', …' : ''}). They will be locked out of the class page until they create an account.` : 'Everyone has a PIN.'} Turn sign-in on?`, { ok: 'Turn on', title: 'Require sign-in?' })) return draw();
      try { await db(sb.rpc('v2_set_setting', { p_key: 'require_login', p_value: e.target.value })); toast(on ? 'Sign-in is now required' : 'The class page is open again'); draw(); } catch (x) { toast(x.message, true); draw(); } });
    el.querySelectorAll('[data-gr]').forEach(b => b.onclick = async () => { if (!await confirmDialog('This code stops working at once.', { ok: 'Cancel the code', title: 'Cancel this guest code?', danger: true })) return;
      try { await db(sb.rpc('v2_guest_revoke', { p_id: b.dataset.gr })); toast('Code cancelled'); draw(); } catch (x) { toast(x.message, true); } });
    el.querySelector('#gn')?.addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target);
      try { const r = await db(sb.rpc('v2_guest_create', { p_label: f.get('l'), p_days: +f.get('d') }));
        modal(`<h3>Guest code</h3><p class="muted">Copy it now. For safety it is shown only once.</p><div class="card pad" style="text-align:center;font:700 1.8rem/1.2 ui-monospace,monospace;letter-spacing:.08em">${esc(r.code)}</div>
          <p class="muted">Valid until ${fmtDateTime(r.expires_at)}. The guest types it on the sign-in screen under "Guest code".</p><div style="display:flex;gap:8px"><button class="btn gold" id="cc" style="flex:1">Copy</button><button class="btn ghost" id="cd">Done</button></div>`,
          (m, close) => { m.querySelector('#cc').onclick = async () => { try { await navigator.clipboard.writeText(r.code); toast('Copied'); } catch { toast(r.code); } }; m.querySelector('#cd').onclick = () => { close(); draw(); }; }); }
      catch (x) { toast(x.message, true); } });
    el.querySelector('#an')?.addEventListener('change', async e => { try { await db(sb.rpc('v2_set_setting', { p_key: 'auto_nudge', p_value: e.target.value })); toast(e.target.value === 'on' ? 'Automatic reminders are on' : 'Automatic reminders are off'); } catch (x) { toast(x.message, true); draw(); } });
    el.querySelector('#th')?.addEventListener('submit', async e => { e.preventDefault();
      try { await db(sb.rpc('v2_set_setting', { p_key: 'expense_second_approval', p_value: String(new FormData(e.target).get('t') || '0') })); toast('Saved'); draw().catch(() => {}); } catch (x) { toast(x.message, true); } });
    el.querySelector('#rot')?.addEventListener('click', async () => {
      if (!await confirmDialog('A new random key replaces the old one. The alert and backup functions pick it up by themselves, so nothing else changes.', { ok: 'Change the key', title: 'Change the alert key?' })) return;
      try { await db(sb.rpc('v2_rotate_hook_secret')); toast('Key changed'); } catch (x) { toast(NEED_SQL(x) ? 'Not switched on in the database yet. Run the v4 SQL.' : x.message, true); } });
  }
  await draw();
}
