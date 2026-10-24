import { sb, db, esc, toast, modal, confirmDialog, skeleton, ROLE_LABEL, ROLES, fmtDate } from '../core.js';

/* Duties (Mayor and Vice Mayor): who is on track, the duty list per post, and the reminder times. Only the Mayor can change things. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const rule = t => {
  if (t.repeat === 'daily') return 'Every day';
  if (t.repeat === 'monthly') return `Day ${t.month_day} of each month`;
  if (t.repeat === 'once') return `One-off, due ${fmtDate(t.due_on + 'T00:00:00+08:00')}`;
  const d = t.days || []; if (d.join() === '1,2,3,4,5') return 'Monday to Friday';
  return d.map(x => DAYS[x - 1]).join(', ');
};
const dot = (day, isToday) => {
  const label = new Date(day.d + 'T00:00:00+08:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  const cls = !day.total ? 'none' : day.done >= day.total ? 'ok' : (isToday ? 'part' : day.done ? 'part' : 'miss');
  const txt = !day.total ? 'no duties' : `${day.done} of ${day.total} done`;
  return `<span class="ddot ${cls}" title="${esc(label)}: ${txt}" role="img" aria-label="${esc(label)}: ${txt}"></span>`;
};
const streak = days => { let n = 0; for (let i = days.length - 1; i >= 0; i--) { const d = days[i]; if (!d.total) continue; if (d.done >= d.total) n++; else if (i === days.length - 1) continue; else break; } return n; };

export async function mountDuties(el, ctx) {
  const isMayor = ctx.can('mayor');
  el.innerHTML = skeleton(5);

  async function draw() {
    const [ov, tpl, set] = await Promise.all([db(sb.rpc('v2_duty_overview')), db(sb.rpc('v2_duty_templates_list')), db(sb.rpc('v2_duty_settings'))]);
    const officers = ov || [], list = tpl || [], st = set || { alerts: 'on', morning: '06:30', followup: '16:00' };
    const card = o => {
      const today = o.days[o.days.length - 1], past = o.days.slice(0, -1), missed = past.reduce((a, d) => a + Math.max(d.total - d.done, 0), 0), sk = streak(o.days);
      const pct = today.total ? Math.round(100 * today.done / today.total) : 0;
      return `<details class="card duty-off"><summary class="row" style="cursor:pointer;list-style:none"><div class="m"><b>${esc(o.name)}</b><small>${esc(ROLE_LABEL[o.role])} · ${today.total ? `today ${today.done} of ${today.total}` : 'nothing scheduled today'}</small>
          ${today.total ? `<div class="prog mini" role="img" aria-label="${pct} percent done today"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div style="text-align:right"><div class="ddots">${o.days.map((d, i) => dot(d, i === o.days.length - 1)).join('')}</div><small class="muted">${missed ? `${missed} missed this week` : sk >= 2 ? `${sk}-day streak` : 'on track'}</small></div></summary>
        <div class="pad" style="padding-top:0">${o.items.length ? o.items.map(i => `<div style="margin:6px 0"><span class="tag ${i.done ? 'ok' : 'warn'}">${i.done ? 'Done' : 'Not yet'}</span> ${esc(i.title)}${i.note ? `<br><small class="muted">📝 ${esc(i.note)}</small>` : ''}</div>`).join('') : '<small class="muted">No duties today.</small>'}</div></details>`;
    };
    const behind = officers.filter(o => { const t = o.days[o.days.length - 1]; return t.total && t.done < t.total; }).length;
    const roles = ROLES.filter(r => list.some(t => t.role === r));
    el.innerHTML = `<h3 class="sec" style="margin-top:0">Officer duties</h3>
      <div class="card pad"><b>${officers.length ? (behind ? `${behind} of ${officers.length} officers still have duties today` : 'Everyone is on track today') : 'No officers yet'}</b>
        <p class="muted" style="margin:4px 0 0">The dots are the last 7 days, today on the right. Green is all done, amber is partly done, red is missed.</p></div>
      <div>${officers.map(card).join('')}</div>
      <h3 class="sec">Duty list</h3>
      <div class="card">${roles.map(r => `<div class="pad" style="padding-bottom:0"><b>${esc(ROLE_LABEL[r])}</b></div>${list.filter(t => t.role === r).map(t => `<div class="row"><div class="m"><b>${esc(t.title)}</b><small>${esc(rule(t))}${t.detail ? ' · ' + esc(t.detail) : ''}</small></div>${t.active ? '' : '<span class="tag">Paused</span>'}${isMayor ? `<button class="btn ghost sm" data-edit="${t.id}">Edit</button>` : ''}</div>`).join('')}`).join('') || '<p class="empty"><b>No duties yet</b>Add the first one.</p>'}
        ${isMayor ? '<div class="pad"><button class="btn gold" id="add" style="width:100%">Add a duty</button></div>' : ''}</div>
      <h3 class="sec">Phone alerts</h3>
      <form class="card pad" id="al"><p class="muted" style="margin:0 0 8px">Each officer gets a morning reminder with today's duties. The follow-up goes only to officers who still have something undone, and you get a short summary of who.</p>
        <label>Alerts</label><select name="alerts" aria-label="Alerts" ${isMayor ? '' : 'disabled'}><option value="on"${st.alerts === 'on' ? ' selected' : ''}>On</option><option value="off"${st.alerts === 'off' ? ' selected' : ''}>Off</option></select>
        <label>Morning reminder</label><input type="time" name="morning" aria-label="Morning reminder time" value="${esc(st.morning)}" ${isMayor ? '' : 'disabled'}>
        <label>Follow-up for undone duties</label><input type="time" name="followup" aria-label="Follow-up reminder time" value="${esc(st.followup)}" ${isMayor ? '' : 'disabled'}>
        ${isMayor ? `<button class="btn gold" style="width:100%;margin-top:12px">Save alert settings</button>
        <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn ghost" id="t1" style="flex:1">Send morning reminder now</button><button type="button" class="btn ghost" id="t2" style="flex:1">Send follow-up now</button></div>` : ''}
        <small class="muted" style="display:block;margin-top:8px">Officers must turn on notifications on their own phone to receive these. Times are Philippine time.</small></form>`;

    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(list.find(t => t.id === b.dataset.edit)));
    el.querySelector('#add')?.addEventListener('click', () => form(null));
    el.querySelector('#al')?.addEventListener('submit', async e => {
      e.preventDefault(); if (!isMayor) return; const f = new FormData(e.target);
      try { await db(sb.rpc('v2_set_setting', { p_key: 'duty_alerts', p_value: f.get('alerts') })); await db(sb.rpc('v2_set_setting', { p_key: 'duty_morning', p_value: f.get('morning') })); await db(sb.rpc('v2_set_setting', { p_key: 'duty_followup', p_value: f.get('followup') })); toast('Saved'); }
      catch (x) { toast(x.message, true); } });
    [['#t1', 'morning', 'Send every officer their duties for today now?'], ['#t2', 'followup', 'Send the follow-up now to officers who still have duties undone?']].forEach(([sel, kind, msg]) => {
      el.querySelector(sel)?.addEventListener('click', async () => { if (!(await confirmDialog(msg, { ok: 'Send now', title: 'Send reminder' }))) return;
        try { const n = await db(sb.rpc('v2_duty_remind_now', { p_kind: kind })); toast(n ? `Sent ${n} message${n === 1 ? '' : 's'}` : 'Nothing to send right now'); } catch (x) { toast(x.message, true); } });
    });
  }

  function form(t) {
    const days = new Set(t && t.days || [1, 2, 3, 4, 5]);
    modal(`<h3>${t ? 'Edit duty' : 'Add a duty'}</h3><form id="df">
      <label>Officer post</label><select name="role">${ROLES.map(r => `<option value="${r}"${t && t.role === r ? ' selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('')}</select>
      <label>Duty</label><input name="title" required maxlength="80" value="${esc(t ? t.title : '')}" placeholder="For example: Do the daily inspection">
      <label>Details (optional)</label><input name="detail" maxlength="200" value="${esc(t && t.detail || '')}">
      <label>How often</label><select name="repeat"><option value="daily">Every day</option><option value="weekly">On certain weekdays</option><option value="monthly">Once a month</option><option value="once">One-off task with a deadline</option></select>
      <div id="r-weekly"><label>Days</label><div style="display:flex;flex-wrap:wrap;gap:6px">${DAYS.map((d, i) => `<label class="chip"><input type="checkbox" name="d" value="${i + 1}"${days.has(i + 1) ? ' checked' : ''}> ${d}</label>`).join('')}</div></div>
      <div id="r-monthly"><label>Day of the month</label><input type="number" name="md" min="1" max="31" value="${t && t.month_day || 28}"></div>
      <div id="r-once"><label>Deadline</label><input type="date" name="due" value="${t && t.due_on || ''}"></div>
      <label class="chip" style="margin-top:10px"><input type="checkbox" name="active" ${!t || t.active ? 'checked' : ''}> Active (untick to pause it)</label>
      <div class="err" id="er"></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn gold" style="flex:1">Save</button>${t ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}<button type="button" class="btn ghost" id="x">Cancel</button></div></form>`, (m, close) => {
      const rep = m.querySelector('[name=repeat]'); rep.value = t ? t.repeat : 'weekly';
      const sync = () => ['weekly', 'monthly', 'once'].forEach(k => m.querySelector('#r-' + k).style.display = rep.value === k ? '' : 'none'); rep.onchange = sync; sync();
      m.querySelector('#x').onclick = close;
      m.querySelector('#del')?.addEventListener('click', async () => { if (!(await confirmDialog('This removes the duty and its history.', { ok: 'Delete', danger: true, title: 'Delete this duty?' }))) return; try { await db(sb.rpc('v2_duty_delete', { p_id: t.id })); close(); toast('Deleted'); draw(); } catch (x) { toast(x.message, true); } });
      m.querySelector('#df').onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target), r = f.get('repeat');
        try {
          await db(sb.rpc('v2_duty_save', { p_id: t ? t.id : null, p_role: f.get('role'), p_title: f.get('title'), p_detail: f.get('detail') || null, p_repeat: r,
            p_days: r === 'weekly' ? f.getAll('d').map(Number) : null, p_month_day: r === 'monthly' ? Number(f.get('md')) : null, p_due_on: r === 'once' ? f.get('due') || null : null, p_active: f.get('active') === 'on' }));
          close(); toast('Saved'); draw();
        } catch (x) { m.querySelector('#er').textContent = x.message; }
      };
    });
  }
  await draw();
}
