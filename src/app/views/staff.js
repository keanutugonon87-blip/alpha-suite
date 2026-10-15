import { sb, esc, ROLE_LABEL, getProfile, onSync, queueSize, flushQueue, setSync } from '../core.js';
/* Each screen is loaded only when it is opened, so students (who never sign in) do not download the officer screens. */

const ICON = {
  treasury: '<path d="M4 7h16v11H4z"/><path d="M4 11h16"/><path d="M8 15h3"/>',
  balances: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  watch: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  students: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 010 5.5M18 14.5c1.8.7 3 2.4 3 5.5"/>',
  officers: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  notices: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16 9a4 4 0 010 6"/>',
  accounts: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
};
const TABS = [
  { id: 'treasury', label: 'Treasury', load: () => import('./treasury.js').then(m => m.mountTreasury), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary'] },
  { id: 'balances', label: 'Balances', load: () => import('./balances.js').then(m => m.mountBalances), roles: ['mayor', 'vice_mayor', 'treasurer', 'auditor', 'secretary'] },
  { id: 'watch', label: 'Watch', load: () => import('./watch.js').then(m => m.mountWatch), roles: ['mayor', 'vice_mayor', 'secretary', 'marshall', 'sails', 'treasurer', 'auditor', 'pio'] },
  { id: 'students', label: 'Students', load: () => import('./students.js').then(m => m.mountStudents), roles: ['mayor', 'vice_mayor', 'secretary', 'treasurer', 'auditor'] },
  { id: 'officers', label: 'Officers', load: () => import('./officers.js').then(m => m.mountOfficers), roles: ['mayor', 'vice_mayor', 'secretary', 'pio', 'treasurer', 'auditor', 'marshall', 'sails'] },
  { id: 'notices', label: 'Notices', load: () => import('./notices.js').then(m => m.mountNotices), roles: ['mayor', 'vice_mayor', 'secretary', 'pio'] },
  { id: 'accounts', label: 'Accounts', load: () => import('./accounts.js').then(m => m.mountAccounts), roles: ['mayor', 'vice_mayor', 'auditor'] },
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
  root.innerHTML = `<div class="top"><span class="crest-ring"><img src="assets/wolf-crest.png" alt=""></span><div class="t"><b>Alpha ’28</b><small>${esc(p.full_name)} · ${ROLE_LABEL[p.role]}</small></div>
    <span class="chip" id="sync"><i></i><span>Live</span></span><button class="btn ghost sm" id="out">Sign out</button></div>
    <div class="banner" id="bn" hidden></div>
    <div class="shell"><nav class="tabs" aria-label="Sections">${tabs.map(t => `<button data-t="${t.id}" class="${t.id === cur.id ? 'on' : ''}" ${t.id === cur.id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t.id]}</svg><span>${t.label}</span></button>`).join('')}</nav><main id="view"></main></div>`;
  const off = onSync((s, d, q) => {
    const c = root.querySelector('#sync'), bn = root.querySelector('#bn'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = (q ? `${q} waiting · ` : '') + { live: 'Live', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error' }[s]; c.title = d || '';
    bn.hidden = !q; bn.textContent = q ? `${q} entr${q > 1 ? 'ies are' : 'y is'} saved on this device and will be sent when you're back online.` : '';
  });
  root.querySelector('#out').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; location.reload(); };
  root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { location.hash = '#/staff/' + b.dataset.t; });
  const view = root.querySelector('#view');
  let stop = null;
  try { stop = await (await cur.load())(view, ctx); }
  catch (e) { console.error(e); view.innerHTML = `<div class="card"><b>Couldn't load ${cur.label}.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
  flushQueue();
  setTimeout(() => tabs.forEach(t => t.load().catch(() => {})), 2000);   // fetch the other screens in the background so they also open offline
  return () => { off(); stop && stop(); };
}
