import { sb, esc, peso, ROLE_LABEL, skeleton, watch, todayISO } from '../core.js';
import { ymManila } from '../money.js';

/* Today: the first screen after sign-in. It shows what needs this officer, by role, and a quick view of the class. */
const quiet = p => Promise.resolve(p).then(r => (r && r.error ? null : r), () => null);
const count = q => quiet(q).then(r => (r ? r.count || 0 : null));
const go = h => { location.hash = '#/staff/' + h; };

export async function mountHome(el, ctx) {
  const role = ctx.profile.role, can = ctx.can;
  el.innerHTML = skeleton(5);

  async function draw() {
    const today = todayISO(), week = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const prevMonth = ymManila(new Date(Date.now() - 31 * 864e5));
    const [pending, vioWait, dueSoon, requests, closes, apprMonth, signup, sec, tre, vioOpen] = await Promise.all([
      can('mayor', 'vice_mayor', 'auditor', 'treasurer') ? count(sb.from('v2_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : null,
      can('mayor', 'vice_mayor', 'secretary') ? count(sb.from('v2_violations').select('id', { count: 'exact', head: true }).in('status', ['awaiting_approval', 'resolve_requested', 'resolve_forwarded'])) : null,
      can('mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary') ? quiet(sb.from('v2_charges').select('id,title,due_on').eq('closed', false).not('due_on', 'is', null).lte('due_on', week)).then(r => r ? r.data || [] : null) : null,
      can('mayor') ? count(sb.from('v2_profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'pending')) : null,
      can('mayor', 'treasurer') ? quiet(sb.from('v2_month_close').select('month,status')).then(r => r ? r.data || [] : null) : null,
      can('mayor', 'treasurer') ? quiet(sb.from('v2_entries').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('occurred_at', prevMonth + '-01T00:00:00+08:00').lt('occurred_at', prevMonth + '-31T23:59:59+08:00')).then(r => r ? r.count || 0 : null) : null,
      can('mayor', 'vice_mayor', 'secretary', 'treasurer') ? quiet(sb.rpc('v2_signup_status')).then(r => r ? r.data || null : null) : null,
      can('mayor', 'vice_mayor') ? quiet(sb.rpc('v2_security_overview')).then(r => r ? r.data || null : null) : null,
      quiet(sb.rpc('v2_public_treasury')).then(r => r ? r.data || null : null),
      quiet(sb.rpc('v2_public_standing')).then(r => r ? r.data || null : null),
    ]);
    const items = [];
    if (pending) items.push(['💰', `${pending} entr${pending === 1 ? 'y' : 'ies'} waiting for approval`, can('mayor') ? 'Review and approve them' : 'Waiting for the Mayor', 'treasury']);
    if (vioWait) items.push(['🛡️', `${vioWait} violation item${vioWait === 1 ? '' : 's'} need a decision`, 'Approvals and resolutions', 'watch']);
    if (dueSoon && dueSoon.length) items.push(['📅', `${dueSoon.length} charge${dueSoon.length === 1 ? '' : 's'} due within a week or late`, dueSoon.slice(0, 2).map(c => c.title).join(', '), 'balances']);
    if (requests) items.push(['👤', `${requests} officer access request${requests === 1 ? '' : 's'}`, 'Assign a role or reject', 'accounts']);
    if (closes && apprMonth && !closes.some(c => c.month === prevMonth && c.status === 'closed')) items.push(['🔒', 'Last month is not closed yet', 'Count the money, then close the month', 'treasury']);
    if (sec && sec.locked_now.length) items.push(['🚨', `${sec.locked_now.length} student${sec.locked_now.length === 1 ? ' is' : 's are'} locked out`, sec.locked_now.slice(0, 3).map(l => l.name).join(', '), 'system']);
    const nopin = signup ? signup.filter(m => !m.has_pin).length : 0;
    if (signup && nopin) items.push(['📲', `${nopin} of ${signup.length} students have no PIN yet`, 'Send a reminder or print the sign-up sheet', 'system']);

    const stat = (l, v, cls = '') => `<div class="stat ${cls}"><small>${l}</small><b>${v}</b></div>`;
    el.innerHTML = `<div class="card pad"><small class="muted">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' })}</small>
      <h2 style="margin:2px 0 0;border:0;padding:0">Hello, ${esc(ctx.profile.full_name.split(' ')[0])}</h2><small class="muted">${ROLE_LABEL[role]}</small></div>
      <h3 class="sec">${items.length ? 'Needs you' : 'All clear'}</h3>
      <div class="card">${items.length ? items.map(([ic, t, s, h]) => `<button class="row todo-row" data-go="${h}" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;cursor:pointer"><span style="font-size:1.3rem;margin-right:10px">${ic}</span><div class="m"><b>${esc(t)}</b><small>${esc(s)}</small></div><span aria-hidden="true">›</span></button>`).join('')
        : '<p class="empty"><b>Nothing is waiting for you</b>New approvals, due dates and sign-in problems will show up here.</p>'}</div>
      <h3 class="sec">The class right now</h3>
      <div class="grid">${tre ? stat('Fund balance', peso(tre.balance), 'gold') : ''}${vioOpen ? stat('Students with open violations', vioOpen.length) : ''}${signup ? stat('Have a PIN', `${signup.length - nopin} / ${signup.length}`) : ''}</div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  }
  await draw();
  return watch(['v2_entries', 'v2_charges', 'v2_violations', 'v2_profiles'], () => draw().catch(() => {}));
}
