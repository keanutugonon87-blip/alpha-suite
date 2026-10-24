import { sb, esc, ROLE_LABEL, getProfile, onSync, queueSize, flushQueue, setSync, modal, watch } from '../core.js';
/* Each screen is loaded only when it is opened, so students (who never sign in) do not download the officer screens. */

const ICON = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  treasury: '<path d="M4 7h16v11H4z"/><path d="M4 11h16"/><path d="M8 15h3"/>',
  balances: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  watch: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  students: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 010 5.5M18 14.5c1.8.7 3 2.4 3 5.5"/>',
  officers: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  notices: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16 9a4 4 0 010 6"/>',
  accounts: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  duties: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.3 1.3L7 5M3.5 12l1.3 1.3L7 11M3.5 18l1.3 1.3L7 17"/>',
  roles: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
};
const TABS = [
  { id: 'home', label: 'Today', load: () => import('./home.js').then(m => m.mountHome), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary', 'marshall', 'sails', 'pio'] },
  { id: 'treasury', label: 'Treasury', load: () => import('./treasury.js').then(m => m.mountTreasury), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary'] },
  { id: 'balances', label: 'Balances', load: () => import('./balances.js').then(m => m.mountBalances), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary'] },
  { id: 'watch', label: 'Watch', load: () => import('./watch.js').then(m => m.mountWatch), roles: ['mayor', 'vice_mayor', 'secretary', 'marshall', 'sails', 'treasurer', 'auditor', 'pio'] },
  { id: 'students', label: 'Students', load: () => import('./students.js').then(m => m.mountStudents), roles: ['mayor', 'vice_mayor', 'secretary', 'treasurer', 'auditor'] },
  { id: 'officers', label: 'Officers', load: () => import('./officers.js').then(m => m.mountOfficers), roles: ['mayor', 'vice_mayor', 'secretary', 'pio', 'treasurer', 'auditor', 'marshall', 'sails'] },
  { id: 'notices', label: 'Notices', load: () => import('./notices.js').then(m => m.mountNotices), roles: ['mayor', 'vice_mayor', 'secretary', 'pio'] },
  { id: 'accounts', label: 'Accounts', load: () => import('./accounts.js').then(m => m.mountAccounts), roles: ['mayor', 'vice_mayor', 'auditor'] },
  { id: 'duties', label: 'Duties', load: () => import('./duties.js').then(m => m.mountDuties), roles: ['mayor', 'vice_mayor'] },
  { id: 'roles', label: 'Roles', load: () => import('./roles.js').then(m => m.mountRoles), roles: ['mayor', 'vice_mayor'] },
  { id: 'system', label: 'System', load: () => import('./system.js').then(m => m.mountSystem), roles: ['mayor', 'vice_mayor', 'treasurer'] },
];

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

  const ctx = { profile: p, can: (...r) => r.includes(p.role) };
  const tabs = TABS.filter(t => t.roles.includes(p.role));
  const cur = tabs.find(t => t.id === tabId) || tabs[0];
  // On a phone the bar holds 4 sections and a "More" button; on a wide screen the side menu lists them all.
  const PRIMARY = 4, extra = tabs.length > PRIMARY + 1 ? tabs.slice(PRIMARY) : [], inMore = extra.some(t => t.id === cur.id);
  const icon = id => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[id]}</svg>`;
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>Alpha ’28</b><small>${esc(p.full_name)} · ${ROLE_LABEL[p.role]}</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><button class="btn ghost sm" id="out">Sign out</button></div>
    <div class="banner" id="bn" hidden></div>
    <div class="shell"><nav class="tabs" aria-label="Sections">${tabs.map(t => `<button data-t="${t.id}" class="${t.id === cur.id ? 'on' : ''}${extra.includes(t) ? ' xtra' : ''}" ${t.id === cur.id ? 'aria-current="page"' : ''}>${icon(t.id)}<span>${t.label}</span>${t.id === 'treasury' ? '<i class="badge" id="bdg" hidden></i>' : ''}</button>`).join('')}${extra.length ? `<button class="more${inMore ? ' on' : ''}" id="more" aria-haspopup="dialog" aria-label="More sections"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg><span>${inMore ? cur.label : 'More'}</span></button>` : ''}</nav><main id="view"></main></div>`;
  const off = onSync((s, d, q) => {
    const c = root.querySelector('#sync'), bn = root.querySelector('#bn'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = (q ? `${q} waiting · ` : '') + { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || '';
    bn.hidden = !q; bn.textContent = q ? `${q} entr${q > 1 ? 'ies are' : 'y is'} saved on this device and will be sent when you're back online.` : '';
  });
  root.querySelector('#out').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; location.reload(); };
  root.querySelectorAll('.tabs button[data-t]').forEach(b => b.onclick = () => { location.hash = '#/staff/' + b.dataset.t; });
  root.querySelector('#more')?.addEventListener('click', () => modal(`<h3>More</h3><div class="moregrid">${extra.map(t => `<button class="btn ghost${t.id === cur.id ? ' on' : ''}" data-go="${t.id}">${icon(t.id)}<span>${t.label}</span></button>`).join('')}</div>`,
    (m, close) => m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { close(); location.hash = '#/staff/' + b.dataset.go; })));
  // A small number on Treasury shows how many entries are waiting for approval (only for officers who can approve them)
  let stopBadge = () => {};
  if (['mayor', 'vice_mayor', 'auditor', 'treasurer'].includes(p.role)) {
    const bdg = root.querySelector('#bdg'), count = () => sb.from('v2_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(r => { const n = r.count || 0; if (bdg) { bdg.hidden = !n; bdg.textContent = n > 9 ? '9+' : n; bdg.closest('button').setAttribute('aria-label', n ? `Treasury, ${n} waiting for approval` : 'Treasury'); } }, () => {});
    count(); try { stopBadge = watch(['v2_entries'], () => count()) || stopBadge; } catch { /* realtime unavailable: the number refreshes on the next visit */ }
  }
  const view = root.querySelector('#view');
  let stop = null;
  try { stop = await (await cur.load())(view, ctx); }
  catch (e) { console.error(e); view.innerHTML = `<div class="card"><b>Couldn't load ${cur.label}.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
  flushQueue();
  setTimeout(() => tabs.forEach(t => t.load().catch(() => {})), 2000);   // fetch the other screens in the background so they also open offline
  return () => { off(); stop && stop(); typeof stopBadge === 'function' && stopBadge(); };
}
