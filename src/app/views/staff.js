import { t, getLang, setLang } from '../i18n.js';
import { sb, esc, ROLE_LABEL, getProfile, onSync, queueSize, flushQueue, setSync, modal, watch } from '../core.js';
/* Each screen is loaded only when it is opened, so students (who never sign in) do not download the officer screens. */

const ICON = {
  vp: '<path d="M12 3l8 4v5c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
  office: '<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5"/><path d="M8 13l2 2 4-4"/>',
  desk: '<path d="M4 9h16v10H4z"/><path d="M8 9V6h8v3"/><path d="M9 14h6"/>',
  requests: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  attendance: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  treasury: '<path d="M4 7h16v11H4z"/><path d="M4 11h16"/><path d="M8 15h3"/>',
  balances: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  directives: '<path d="M4 12l16-8-6 16-3-7z"/><path d="M11 13l9-9"/>',
  pack: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  watch: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  students: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 010 5.5M18 14.5c1.8.7 3 2.4 3 5.5"/>',
  officers: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  notices: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16 9a4 4 0 010 6"/>',
  accounts: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  duties: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.3 1.3L7 5M3.5 12l1.3 1.3L7 11M3.5 18l1.3 1.3L7 17"/>',
  docs: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  roles: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
};
ICON['pd-today'] = ICON.home; ICON['pd-approvals'] = ICON.office || ICON.home; ICON['pd-people'] = ICON.officers || ICON.home; ICON['pd-more'] = ICON.roles || ICON.home; ICON.report = ICON.docs || ICON.notices || ICON.home; ICON.classup = ICON.officers || ICON.home; ICON.money = ICON.treasury; ICON.class = ICON.watch; ICON.admin = ICON.roles;   // icons for the grouped entries
const TABS = [
  { id: 'home', label: 'Today', load: () => import('./home.js').then(m => m.mountHome), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary', 'marshall', 'sails', 'pio'] },
  { id: 'marshal', label: 'Marshal Desk', load: () => import('./marshal.js').then(m => m.mountMarshal), roles: ['general_marshal', 'dept_marshal'] },
  { id: 'directives', label: 'Directives', load: () => import('./directives.js').then(m => m.mountDirectives), roles: ['mayor', 'vice_mayor', 'vp_internal', 'vp_external', 'treasurer', 'auditor', 'secretary', 'marshall', 'sails', 'pio', 'general_marshal', 'dept_marshal'] },
  { id: 'report', label: 'Report up', load: () => import('./classreport.js').then(m => m.mountClassReport), roles: ['mayor'] },
  { id: 'classup', label: 'Class Mayors', load: () => import('./classup.js').then(m => m.mountClassUp), roles: ['vp_internal'] },
  { id: 'vp', label: 'VP Desk', load: () => import('./vp.js').then(m => m.mountVp), roles: ['vp_internal', 'vp_external', 'vice_mayor'] },
  { id: 'office', label: 'Desk', load: () => import('./office.js').then(m => m.mountOffice), roles: ['secretary', 'auditor', 'pio', 'marshall', 'mayor'] },
  { id: 'treasury', label: 'Treasury', load: () => import('./treasury.js').then(m => m.mountTreasury), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary'] },
  { id: 'desk', label: 'Desk', load: () => import('./desk.js').then(m => m.mountDesk), roles: ['mayor', 'treasurer'] },
  { id: 'balances', label: 'Balances', load: () => import('./balances.js').then(m => m.mountBalances), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary'] },
  { id: 'watch', label: 'Watch', load: () => import('./watch.js').then(m => m.mountWatch), roles: ['mayor', 'vice_mayor', 'secretary', 'marshall', 'sails', 'treasurer', 'auditor', 'pio', 'general_marshal', 'dept_marshal'] },
  { id: 'attendance', label: 'Attendance', load: () => import('./attendance.js').then(m => m.mountAttendance), roles: ['mayor', 'vice_mayor', 'secretary', 'marshall', 'sails', 'treasurer', 'auditor', 'pio'] },
  { id: 'requests', label: 'Budget', load: () => import('./requests.js').then(m => m.mountRequests), roles: ['mayor', 'vp_internal', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'marshall', 'sails', 'pio'] },
  { id: 'students', label: 'Students', load: () => import('./students.js').then(m => m.mountStudents), roles: ['mayor', 'vice_mayor', 'secretary', 'treasurer', 'auditor'] },
  { id: 'officers', label: 'Officers', load: () => import('./officers.js').then(m => m.mountOfficers), roles: ['mayor', 'vice_mayor', 'secretary', 'pio', 'treasurer', 'auditor', 'marshall', 'sails'] },
  { id: 'notices', label: 'Notices', load: () => import('./notices.js').then(m => m.mountNotices), roles: ['mayor', 'vice_mayor', 'secretary', 'pio'] },
  { id: 'accounts', label: 'Accounts', load: () => import('./accounts.js').then(m => m.mountAccounts), roles: ['mayor', 'vice_mayor', 'auditor'] },
  { id: 'docs', label: 'Documents', load: () => import('./docs.js').then(m => m.mountDocs), roles: ['mayor', 'vice_mayor', 'secretary'] },
  { id: 'pack', label: 'Monthly pack', load: () => import('./pack.js').then(m => m.mountPack), roles: ['mayor', 'vice_mayor', 'secretary', 'treasurer', 'auditor', 'pio'] },
  { id: 'duties', label: 'Duties', load: () => import('./duties.js').then(m => m.mountDuties), roles: ['mayor', 'vice_mayor'] },
  { id: 'roles', label: 'Roles', load: () => import('./roles.js').then(m => m.mountRoles), roles: ['mayor', 'vice_mayor'] },
  { id: 'system', label: 'System', load: () => import('./system.js').then(m => m.mountSystem), roles: ['mayor', 'vice_mayor', 'treasurer'] },
];

const TABKEY = {'home': 'tabHome', 'treasury': 'tabTreasury', 'balances': 'tabBalances', 'watch': 'tabWatch', 'attendance': 'tabAttend', 'desk': 'tabDesk', 'vp': 'tabVp', 'requests': 'tabBudget', 'students': 'tabStudents', 'officers': 'tabOfficers', 'notices': 'tabNotices', 'accounts': 'tabAccounts', 'docs': 'tabDocs', 'duties': 'tabDuties', 'roles': 'tabRoles', 'system': 'tabSystem'};
const tabLabel = t0 => TABKEY[t0.id] ? t(TABKEY[t0.id]) : t0.label;
function authScreen(root, mode = 'in', msg = '', ok = false) {
  root.innerHTML = `<div class="auth"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span>
    <h1 style="margin:10px 0 4px">Alpha ’28</h1><p class="muted" style="margin:0 0 14px">Officer sign in</p>
    <form class="card" id="f">
      ${mode === 'up' ? '<label>Full name</label><input name="name" required autocomplete="name">' : ''}
      <label>Email</label><input name="email" type="email" required autocomplete="email">
      ${mode === 'forgot' ? '' : `<label>Password</label><input name="pw" type="password" minlength="6" required autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}">`}
      <button class="btn gold" style="width:100%;margin-top:14px">${{ in: 'Sign in', up: 'Create account', forgot: 'Send reset link' }[mode]}</button>
      <div class="${ok ? 'muted' : 'err'}" id="msg" style="margin-top:8px">${esc(msg)}</div>
      <p class="muted" style="text-align:center;margin:12px 0 0">
        ${mode === 'in' ? '<a href="#" data-m="up">New officer? Create an account</a><br><a href="#" data-m="forgot">Forgot password?</a>' : '<a href="#" data-m="in">Back to sign in</a>'}</p>
    </form><p><a href="#/">← Public page</a></p></div>`;
  root.querySelectorAll('[data-m]').forEach(a => a.onclick = e => { e.preventDefault(); authScreen(root, a.dataset.m); });
  root.querySelector('#f').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector('button'), msgEl = root.querySelector('#msg'); btn.disabled = true; msgEl.textContent = '';
    try {
      const email = f.get('email').trim();
      if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error; return authScreen(root, 'in', 'If that email has an account, a reset link is on its way.', true);
      }
      if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({ email, password: f.get('pw'), options: { data: { full_name: f.get('name').trim() } } });
        if (error) throw error;
        if (!data.session) return authScreen(root, 'in', 'Account created. Confirm your email if asked, then sign in. The Mayor will assign your role.', true);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: f.get('pw') });
        if (error) throw error;
      }
      location.hash = '#/staff'; location.reload();
    } catch (x) { msgEl.className = 'err'; msgEl.textContent = /fetch/i.test(x.message) ? 'No connection. Check your network and try again.' : x.message; btn.disabled = false; }
  };
}

export function showRecovery(root) {
  root.innerHTML = `<div class="auth"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><h2 style="margin:10px 0">Set a new password</h2>
    <form class="card" id="f"><label>New password</label><input name="pw" type="password" minlength="6" required autocomplete="new-password">
    <button class="btn gold" style="width:100%;margin-top:14px">Save password</button><div class="err" id="msg"></div></form></div>`;
  root.querySelector('#f').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('pw') });
    if (error) root.querySelector('#msg').textContent = error.message; else { location.hash = '#/staff'; location.reload(); }
  };
}

function pendingScreen(root, p) {
  root.innerHTML = `<div class="auth"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><h2 style="margin:10px 0">Waiting for approval</h2>
    <div class="card"><p>Signed in as <b>${esc(p.email)}</b>.</p><p class="muted">The Mayor needs to assign your officer role. This page updates by itself.</p><button class="btn ghost" id="out">Sign out</button></div></div>`;
  root.querySelector('#out').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; location.reload(); };
  const iv = setInterval(async () => { try { const n = await getProfile(); if (n && n.role !== 'pending') location.reload(); } catch { /* keep waiting */ } }, 8000);
  return () => clearInterval(iv);
}

export async function renderStaff(root, tabId) {
  let p;
  try { p = await getProfile(); }
  catch (e) { root.innerHTML = `<div class="auth"><div class="card"><b>Couldn't reach the database.</b><p class="muted">${esc(e.message)}</p><button class="btn" id="r">Retry</button></div></div>`; root.querySelector('#r').onclick = () => location.reload(); return; }
  if (!p) return void authScreen(root);
  if (p.role === 'pending') return pendingScreen(root, p);
  // The SAILS President account runs the President Desk. The server knows the real role; the screens reuse the Mayor's President Desk.
  const realPres = p.role === 'sails_president';
  if (realPres) p = { ...p, role: 'mayor', real: 'sails_president' };
  // Mode: 'pres' (President account), 'class' (Class Mayor while a President account exists), 'acting' (Mayor acting as President until one exists)
  const mode = realPres ? 'pres' : p.role === 'mayor' ? 'class' : null;

  // A Vice President or the SAILS General Marshal named as the President's deputy gets the President Desk while the deputy period is active.
  const deputy = ['vp_internal', 'vp_external', 'general_marshal'].includes(p.role) ? await sb.rpc('v2_deputy_status').then(r => !!(r.data && r.data.me && r.data.active_now), () => false) : false;
  const isVp = ['vp_internal', 'vp_external'].includes(p.role), has = r => r.includes(p.role) || (isVp && r.includes('vice_mayor'));
  const ctx = { profile: p, mode, can: (...r) => has(r) || (p.role === 'mayor' && mode !== 'pres' && r.some(x => ['treasurer', 'secretary', 'pio'].includes(x))), section: null };
  const OFFICE = { secretary: 'SAILS Secretary Desk', auditor: 'SAILS Audit Desk', pio: 'SAILS PIO Desk', marshall: 'Marshal Desk', mayor: 'President Desk' };
  let tabs = TABS.filter(t => has(t.roles)).map(t => t.id === 'office' ? { ...t, label: OFFICE[p.role] } : t);
  if (mode === 'class') tabs = tabs.filter(t => t.id !== 'vp').map(t => t.id === 'office' ? { ...t, label: 'Mayor Desk', load: () => import('./mayordesk.js').then(m => m.mountMayorDesk) } : t);
  if (mode === 'pres') tabs = tabs.filter(t => t.id === 'office' || t.id === 'directives' || t.id === 'vp' || t.id === 'accounts');
  if (mode !== 'pres' && mode !== 'acting') tabs = tabs.filter(t => t.id !== 'report' || mode === 'class');
  // The President has one desk: Directives, VP Desk and Approvals sit inside it. Old links to #/staff/directives or #/staff/vp still land there.
  if (p.role === 'mayor' && mode !== 'class') { tabs = tabs.filter(t => t.id !== 'directives' && t.id !== 'vp').map(t => t.id === 'office' ? { ...t, load: () => import('./president.js').then(m => m.mountPresident) } : t); if (tabId === 'directives' || tabId === 'vp' || tabId === 'classup') { ctx.section = tabId; tabId = 'office'; } }
  if (p.role === 'mayor' && mode !== 'class') { const o = tabs.find(t => t.id === 'office'), rest = tabs.filter(t => t.id !== 'office'); tabs = [...rest.slice(0, 1), o, ...rest.slice(1)]; }   // Today, then the President Desk
  // The SAILS President's four groups sit in the side menu: Today, Approvals, People, More. Old links land in the right group.
  if (mode === 'pres') {
    const pg = (id, label, g) => ({ id, label, roles: [], load: () => import('./president.js').then(m => (e2, c2) => m.mountPresident(e2, { ...c2, group: g })) });
    const at = tabs.findIndex(t => t.id === 'office');
    if (at >= 0) tabs.splice(at, 1, pg('pd-today', 'Today', 'today'), pg('pd-approvals', 'Approvals', 'approvals'), pg('pd-people', 'People', 'people'), pg('pd-more', 'More', 'more'));
    tabs = [...tabs.filter(t => t.id !== 'accounts'), ...tabs.filter(t => t.id === 'accounts')];
    if (tabId === 'office' || tabId === 'home') tabId = ctx.section === 'vp' ? 'pd-approvals' : ctx.section === 'directives' || ctx.section === 'classup' ? 'pd-people' : 'pd-today';
  }
  // Related screens share one menu entry (Money, Class, Admin) with buttons to switch between them. Old links to a single screen still land in the right place.
  if (mode === 'class') tabs = tabs.filter(t => !['docs', 'duties', 'accounts', 'roles', 'system'].includes(t.id));   // Admin belongs to the SAILS President
  const HUBS = [['money', 'Money', ['treasury', 'desk', 'balances', 'requests', 'pack']], ['class', 'Class', ['watch', 'attendance', 'students', 'officers', 'notices']], ['admin', 'Admin', ['docs', 'duties', 'accounts', 'roles', 'system']]];
  for (const [hid, hlabel, ids] of HUBS) {
    const members = tabs.filter(t => ids.includes(t.id)); if (members.length < 2) continue;
    if (members.some(m => m.id === tabId)) { ctx.section = tabId; tabId = hid; }
    const at = tabs.indexOf(members[0]);
    tabs = tabs.filter(t => !members.includes(t)); tabs.splice(Math.min(at, tabs.length), 0, { id: hid, label: hlabel, roles: [], load: () => { members.forEach(t => t.load().catch(() => {})); return import('./hub.js').then(m => (e2, c2) => m.mountHub(e2, c2, hid, members.map(t => [t.id, tabLabel(t), t.load]))); } });
  }
  if (deputy) tabs.splice(1, 0, { id: 'office', label: 'President Desk', roles: [], load: () => import('./president.js').then(m => (e2, c2) => m.mountPresident(e2, { ...c2, mode: 'pres', profile: { ...c2.profile, role: 'mayor' } })) });
  const cur = tabs.find(t => t.id === tabId) || tabs[0];
  // On a phone the bar holds 4 sections and a "More" button; on a wide screen the side menu lists them all.
  const PRIMARY = 4, extra = tabs.length > PRIMARY + 1 ? tabs.slice(PRIMARY) : [], inMore = extra.some(t => t.id === cur.id);
  const icon = id => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[id]}</svg>`;
  // The side menu (wide screens) is grouped, each group folds away, and the whole menu can shrink to icons. Both choices are remembered.
  const GROUPS = [['Overview', ['home', 'pd-today', 'pd-approvals', 'pd-people', 'pd-more', 'marshal', 'directives', 'report', 'classup', 'vp', 'office', 'money', 'class', 'admin']], ['Money', ['treasury', 'desk', 'balances', 'requests', 'pack']], ['Class', ['watch', 'attendance', 'students', 'officers', 'notices']], ['Admin', ['docs', 'duties', 'accounts', 'roles', 'system']]];
  const NK = 'alpha-nav-collapsed', GK = 'alpha-nav-groups', rd = k => { try { return localStorage.getItem(k); } catch { return null; } }, wr = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  let navCollapsed = rd(NK) === '1', shut = new Set((() => { try { return JSON.parse(rd(GK) || '[]'); } catch { return []; } })());
  const btn = t0 => `<button data-t="${t0.id}" title="${esc(tabLabel(t0))}" class="${t0.id === cur.id ? 'on' : ''}${extra.includes(t0) ? ' xtra' : ''}" ${t0.id === cur.id ? 'aria-current="page"' : ''}>${icon(t0.id)}<span>${tabLabel(t0)}</span>${t0.id === 'treasury' || t0.id === 'money' ? '<i class="badge" id="bdg" hidden></i>' : t0.id === 'home' ? '<i class="badge" id="bdh" hidden></i>' : ''}</button>`;
  const grouped = new Set(GROUPS.flatMap(g => g[1])), rest = tabs.filter(t0 => !grouped.has(t0.id));
  const navHtml = GROUPS.concat(rest.length ? [['More', rest.map(t0 => t0.id)]] : []).map(([name, ids]) => { const items = tabs.filter(t0 => ids.includes(t0.id)); if (!items.length) return '';
    const open = !shut.has(name) || items.some(t0 => t0.id === cur.id);
    return `<div class="grp${open ? '' : ' shut'}" data-g="${name}"><button class="gh" type="button" aria-expanded="${open}"><span>${name}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="gb">${items.map(btn).join('')}</div></div>`; }).join('');
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>Alpha ’28</b><small>${esc(p.full_name)} · ${p.real ? ROLE_LABEL[p.real] : p.role === 'mayor' && mode === 'class' ? 'Class Mayor' : ROLE_LABEL[p.role]}</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><button class="btn ghost sm" id="lg" aria-label="Language">${getLang() === 'ceb' ? 'EN' : 'CEB'}</button><button class="btn ghost sm" id="out">${t('signout')}</button></div>
    <div class="banner" id="bn" hidden></div>
    <div class="shell${navCollapsed ? ' nav-c' : ''}"><nav class="tabs" aria-label="Sections"><button class="navtoggle" id="nt" type="button" aria-expanded="${navCollapsed ? 'false' : 'true'}" aria-label="Collapse or expand the menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span>Hide menu</span></button>${navHtml}${extra.length ? `<button class="more${inMore ? ' on' : ''}" id="more" aria-haspopup="dialog" aria-label="More sections"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg><span>${inMore ? tabLabel(cur) : t('more')}</span></button>` : ''}</nav><main id="view"></main></div>`;
  const off = onSync((s, d, q) => {
    const c = root.querySelector('#sync'), bn = root.querySelector('#bn'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = (q ? `${q} waiting · ` : '') + { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || '';
    bn.hidden = !q; bn.textContent = q ? `${q} entr${q > 1 ? 'ies are' : 'y is'} saved on this device and will be sent when you're back online.` : '';
  });
  root.querySelector('#lg').onclick = () => { setLang(getLang() === 'ceb' ? 'en' : 'ceb'); location.reload(); };
  root.querySelector('#out').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; location.reload(); };
  root.querySelector('#nt').onclick = () => { navCollapsed = !navCollapsed; root.querySelector('.shell').classList.toggle('nav-c', navCollapsed); root.querySelector('#nt').setAttribute('aria-expanded', String(!navCollapsed)); wr(NK, navCollapsed ? '1' : '0'); };
  root.querySelectorAll('.tabs .gh').forEach(g => g.onclick = () => { const box = g.parentElement, name = box.dataset.g, closing = !box.classList.contains('shut'); box.classList.toggle('shut', closing); g.setAttribute('aria-expanded', String(!closing)); closing ? shut.add(name) : shut.delete(name); wr(GK, JSON.stringify([...shut])); });
  root.querySelectorAll('.tabs button[data-t]').forEach(b => b.onclick = () => { location.hash = '#/staff/' + b.dataset.t; });
  root.querySelector('#more')?.addEventListener('click', () => modal(`<h3>More</h3><div class="moregrid">${extra.map(t => `<button class="btn ghost${t.id === cur.id ? ' on' : ''}" data-go="${t.id}">${icon(t.id)}<span>${t.label}</span></button>`).join('')}</div>`,
    (m, close) => m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { close(); location.hash = '#/staff/' + b.dataset.go; })));
  // A small number on Treasury shows how many entries are waiting for approval (only for officers who can approve them)
  let stopBadge = () => {};
  if (has(['mayor', 'vice_mayor', 'auditor', 'treasurer'])) {
    const bdg = root.querySelector('#bdg'), count = () => sb.from('v2_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(r => { const n = r.count || 0; if (bdg) { bdg.hidden = !n; bdg.textContent = n > 9 ? '9+' : n; bdg.closest('button').setAttribute('aria-label', n ? `Treasury, ${n} waiting for approval` : 'Treasury'); } }, () => {});
    count(); try { stopBadge = watch(['v2_entries'], () => count()) || stopBadge; } catch { /* realtime unavailable: the number refreshes on the next visit */ }
  }
  // a number on Today shows how much is waiting on the desks (budget, VP, records)
  const homeBadge = () => import('./inbox.js').then(m => m.deskItems(ctx)).then(l => { const b = root.querySelector('#bdh'); if (b) { b.hidden = !l.length; b.textContent = l.length > 9 ? '9+' : l.length; } }).catch(() => {});
  homeBadge(); let stopHome = () => {}; try { stopHome = watch(['v2_budget_requests', 'v2_liquidations', 'v2_office_records', 'v2_vp_meetings', 'v2_vp_partners', 'v2_vp_activities', 'v2_vp_delegations'], homeBadge) || stopHome; } catch { /* refreshes on the next visit */ }
  const view = root.querySelector('#view');
  let stop = null;
  try { stop = await (await cur.load())(view, ctx); }
  catch (e) { console.error(e); view.innerHTML = `<div class="card"><b>Couldn't load ${cur.label}.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
  flushQueue();
  setTimeout(() => tabs.forEach(t => t.load().catch(() => {})), 2000);   // fetch the other screens in the background so they also open offline
  return () => { off(); stop && stop(); typeof stopBadge === 'function' && stopBadge(); typeof stopHome === 'function' && stopHome(); };
}
