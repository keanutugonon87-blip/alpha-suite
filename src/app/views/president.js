import { esc, sb } from '../core.js';

/* The President's one desk. Four groups on one row: Today, Approvals, People, More. Each group may have a few small tabs.
   The desk reuses the existing screens; the office screens run bare (no title, no second tab bar of their own). */
const SK = 'alpha-president-section', PK = 'alpha-president-part';
const office = id => () => import('./office.js').then(m => (e, c) => m.mountOffice(e, { ...c, pane: id, only: [id], bare: true }));
const GROUPS = [
  ['today', 'Today', [['over', 'Needs you', office('over')], ['council', 'Council', () => import('./council.js').then(m => m.mountCouncil)], ['memos', 'Memos', () => import('./memos.js').then(m => m.mountMemos)]]],
  ['approvals', 'Approvals', [['vpa', 'VP and records', office('vpa')], ['coa', 'Calendar', office('coa')], ['marsh', 'Incident referrals', office('marsh')], ['hist', 'Decided', office('hist')]]],
  ['people', 'People', [['secs', 'Sections', office('secs')], ['score', 'Scorecards', office('score')], ['directives', 'Directives', () => import('./directives.js').then(m => m.mountDirectives)], ['classup', 'Class Mayors', () => import('./classup.js').then(m => m.mountClassUp)]]],
  ['more', 'More', [['funds', 'Funds', office('funds')], ['rec', 'Records', office('rec')], ['announce', 'Announcements', office('announce')], ['faq', 'FAQ', office('faq')], ['trash', 'Trash', office('trash')]]],
];
const groupOf = part => (GROUPS.find(g => g[2].some(p => p[0] === part)) || [])[0];
const rd = k => { try { return localStorage.getItem(k); } catch { return null; } }, wr = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export async function mountPresident(el, ctx) {
  // old links: #/staff/directives, #/staff/vp, #/staff/classup, or a pane asked for by another screen
  const asked = ctx.section === 'vp' ? 'vpa' : ctx.section === 'office' ? null : ctx.section === 'directives' || ctx.section === 'classup' ? ctx.section : ctx.pane || null;
  let grp = (asked && groupOf(asked)) || (GROUPS.some(g => g[0] === rd(SK)) ? rd(SK) : 'today'), part = asked && groupOf(asked) ? asked : null;
  if (!asked) grp = 'today';   // a fresh open starts on what needs the President
  let stop = null, token = 0, badge = 0;
  el.innerHTML = `<div class="bar" id="pg" role="tablist" aria-label="President Desk" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"></div><div class="bar" id="pp" role="tablist" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div><div id="pb"></div>`;
  const gbar = el.querySelector('#pg'), pbar = el.querySelector('#pp'), body = el.querySelector('#pb');

  // a small count on Approvals: proposals, calendar items and referrals waiting for the President
  const cnt = (t, f) => f(sb.from(t).select('id', { count: 'exact', head: true })).then(r => (r.error ? 0 : r.count || 0), () => 0);
  Promise.all([cnt('v2_vp_meetings', q => q.eq('status', 'proposed')), cnt('v2_vp_partners', q => q.eq('status', 'proposed')), cnt('v2_vp_activities', q => q.eq('status', 'proposed')),
    cnt('v2_office_records', q => q.eq('flow', 'reviewed')), cnt('v2_coa', q => q.eq('status', 'proposed')), cnt('v2_marshal_incidents', q => q.eq('status', 'referred').eq('referred_to', 'president').is('president_action', null))])
    .then(a => { badge = a.reduce((s, n) => s + n, 0); paintGroups(); });

  function paintGroups() {
    gbar.innerHTML = GROUPS.map(([k, l]) => `<button class="btn ${k === grp ? 'gold' : 'ghost'} sm" role="tab" aria-selected="${k === grp}" data-g="${k}">${esc(l)}${k === 'approvals' && badge ? ` <span class="badge">${badge}</span>` : ''}</button>`).join('');
    gbar.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { if (b.dataset.g !== grp || part) show(b.dataset.g, null); });
  }
  async function show(g, p) {
    grp = g; const parts = GROUPS.find(x => x[0] === g)[2];
    part = p && parts.some(x => x[0] === p) ? p : (parts.some(x => x[0] === rd(PK + g)) ? rd(PK + g) : parts[0][0]);
    const my = ++token; wr(SK, g); wr(PK + g, part);
    paintGroups();
    pbar.style.display = parts.length > 1 ? 'flex' : 'none';
    pbar.innerHTML = parts.map(([k, l]) => `<button class="btn ${k === part ? 'gold' : 'ghost'} sm" style="${k === part ? '' : 'opacity:.85'}" role="tab" aria-selected="${k === part}" data-p="${k}">${esc(l)}</button>`).join('');
    pbar.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { if (b.dataset.p !== part) show(grp, b.dataset.p); });
    if (typeof stop === 'function') { try { stop(); } catch { /* ignore */ } } stop = null;
    body.innerHTML = '';
    const mount = await parts.find(x => x[0] === part)[2]();
    if (my !== token) return;
    const sub = document.createElement('div'); body.appendChild(sub);
    const off = await mount(sub, { ...ctx, go: id => { const gg = groupOf(id); if (!gg) return false; show(gg, id); return true; } });
    if (my !== token) { if (typeof off === 'function') off(); return; }
    stop = off;
  }
  await show(grp, part);
  return () => { token++; if (typeof stop === 'function') { try { stop(); } catch { /* ignore */ } } };
}
