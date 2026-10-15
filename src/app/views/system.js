import { sb, db, esc, toast, fmtDateTime, confirmDialog, peso } from '../core.js';

const ago = d => { const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const NEED_SQL = e => /function|schema cache|does not exist/i.test(e.message);
const JOBS = { 'alpha28-weekly-backup': 'Weekly backup (Monday 3 AM)', 'alpha28-auto-nudge': 'Due-date reminders (daily 9 AM)' };

/* System tab: is everything running, and the few settings the Mayor and Treasurer own. */
export async function mountSystem(el, ctx) {
  const isMayor = ctx.can('mayor'), canSee = ctx.can('mayor', 'vice_mayor'), canNote = ctx.can('mayor', 'treasurer');

  async function draw() {
    let h = null, miss = false, note = '';
    if (canSee) { try { h = await db(sb.rpc('v2_health')); } catch (e) { if (NEED_SQL(e)) miss = true; else throw e; } }
    if (h) note = h.pay_note || '';
    else if (canNote) note = await sb.from('v2_settings').select('value').eq('key', 'pay_note').maybeSingle().then(r => r.data?.value || '', () => '');

    const okDays = h?.last_ok_backup ? (Date.now() - new Date(h.last_ok_backup)) / 864e5 : Infinity;
    const lines = h ? [
      ['Database', 'Reachable', true],
      ['Backups', h.last_ok_backup ? `Last good backup ${ago(h.last_ok_backup)}` : 'No backup recorded yet', okDays <= 8],
      ['Reminders', `${h.linked} of ${h.members} students have reminders on${h.last_reminder ? ` · last sent ${ago(h.last_reminder)}` : ''}`, h.linked > 0],
      ['Officer alerts', `${h.staff_devices} device${h.staff_devices === 1 ? '' : 's'} get sign-up alerts`, true],
      ['Open work', `${h.open_charges} open charge${h.open_charges === 1 ? '' : 's'} · ${h.pending_entries} entr${h.pending_entries === 1 ? 'y' : 'ies'} waiting for approval`, true],
      ...(h.jobs || []).map(j => [JOBS[j.name] || j.name, `${j.active ? 'Scheduled' : 'Switched off'}${j.last_run ? ` · last ran ${ago(j.last_run)}${j.last_status && j.last_status !== 'succeeded' ? ` (${j.last_status})` : ''}` : ' · has not run yet'}`, j.active && (!j.last_status || j.last_status === 'succeeded')]),
    ] : [];

    el.innerHTML = `${miss ? '<div class="alertbar bad"><span>⚠️ The system page is not switched on in the database yet. Run the v4 SQL in Supabase.</span></div>' : ''}
      ${h ? `<h3 class="sec">Health</h3><div class="card">${lines.map(([k, v, ok]) => `<div class="row"><div class="m"><b>${esc(k)}</b><small>${esc(v)}</small></div><span class="tag ${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'Check'}</span></div>`).join('')}</div>
        <p class="muted" style="font-size:.85rem">Checked ${fmtDateTime(h.now)}. The list refreshes when you open this tab.</p>` : ''}
      ${canNote ? `<h3 class="sec">Payment note for students</h3><form class="card pad" id="pn"><p class="muted" style="margin:0 0 8px">Shown on every student's My Status page while they still owe something. For example your GCash number and who to pay.</p>
        <textarea name="v" rows="3" maxlength="300" placeholder="e.g. GCash 09xx xxx xxxx (Treasurer name). Send the screenshot after paying.">${esc(note)}</textarea><button class="btn gold sm" style="margin-top:8px">Save note</button></form>` : ''}
      ${isMayor && h ? `<h3 class="sec">Rules</h3><div class="card pad">
        <div class="row" style="border:0;padding-top:0"><div class="m"><b>Automatic due-date reminders</b><small>Sends the reminder to students who owe, 2 days before a charge is due and on the day. Daily at 9 AM.</small></div>
          <select id="an" style="width:auto"><option value="off"${h.auto_nudge === 'on' ? '' : ' selected'}>Off</option><option value="on"${h.auto_nudge === 'on' ? ' selected' : ''}>On</option></select></div>
        <form id="th" style="margin-top:10px"><label>Expenses of this amount or more need a second officer (₱, 0 turns it off)</label>
          <div style="display:flex;gap:8px"><input name="t" type="number" min="0" step="1" value="${esc(h.threshold)}" inputmode="numeric" style="max-width:160px"><button class="btn gold sm">Save</button></div>
          <small class="muted">Currently ${+h.threshold > 0 ? peso(h.threshold) : 'off'}. The person who recorded the expense cannot approve it.</small></form></div>
        <h3 class="sec">Security</h3><div class="card pad"><p style="margin:0 0 8px"><b>Alert key</b></p>
          <p class="muted" style="margin:0 0 8px">The database and the alert and backup functions prove who they are with a shared secret key. Change it now and then, or at once if an officer who knew it leaves. Nothing else needs updating.</p>
          <button class="btn ghost sm" id="rot">Change the key now</button>
          <p class="muted" style="margin:12px 0 0;font-size:.85rem">The QR card key is not changed here, because that would make every printed card stop working. If it ever leaks, ask for a fresh set of cards to be issued.</p></div>` : ''}`;

    el.querySelector('#pn')?.addEventListener('submit', async e => { e.preventDefault();
      try { await db(sb.rpc('v2_set_setting', { p_key: 'pay_note', p_value: new FormData(e.target).get('v') || '' })); toast('Saved. Students will see it on My Status.'); }
      catch (x) { toast(NEED_SQL(x) ? 'Not switched on in the database yet. Run the v4 SQL.' : x.message, true); } });
    el.querySelector('#an')?.addEventListener('change', async e => { try { await db(sb.rpc('v2_set_setting', { p_key: 'auto_nudge', p_value: e.target.value })); toast(e.target.value === 'on' ? 'Automatic reminders are on' : 'Automatic reminders are off'); } catch (x) { toast(x.message, true); draw(); } });
    el.querySelector('#th')?.addEventListener('submit', async e => { e.preventDefault();
      try { await db(sb.rpc('v2_set_setting', { p_key: 'expense_second_approval', p_value: String(new FormData(e.target).get('t') || '0') })); toast('Saved'); draw().catch(() => {}); } catch (x) { toast(x.message, true); } });
    el.querySelector('#rot')?.addEventListener('click', async () => {
      if (!await confirmDialog('A new random key replaces the old one. The alert and backup functions pick it up by themselves, so nothing else changes.', { ok: 'Change the key', title: 'Change the alert key?' })) return;
      try { await db(sb.rpc('v2_rotate_hook_secret')); toast('Key changed'); } catch (x) { toast(NEED_SQL(x) ? 'Not switched on in the database yet. Run the v4 SQL.' : x.message, true); } });
  }
  await draw();
}
