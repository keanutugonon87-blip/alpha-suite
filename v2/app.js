import { sb, getProfile, ROLE_LABEL, esc, toast, onSync, setSync } from './lib.js?v=1';

const root = document.getElementById('root');
let cleanup = null, ctx = null;

const TABS = [
  { id:'treasury', label:'Treasury', roles:['mayor','vice_mayor','treasurer','auditor','secretary'] },
  { id:'watch', label:'Watch', roles:['mayor','vice_mayor','secretary','marshall','sails','treasurer','auditor','pio'] },
  { id:'officers', label:'Officers', roles:['mayor','vice_mayor','secretary','pio','treasurer','auditor','marshall','sails'] },
  { id:'accounts', label:'Accounts', roles:['mayor','vice_mayor','auditor'] },
];

function authScreen(mode = 'in', msg = '') {
  root.innerHTML = `<div class="auth"><img src="../assets/wolf-crest.png" alt="">
    <h1 style="margin:10px 0 4px">ALPHA SUITE</h1><p class="muted" style="margin:0 0 14px">Officers sign in with one account for every app.</p>
    <form class="card" id="f">
      ${mode === 'up' ? '<label>Full name</label><input name="name" required autocomplete="name">' : ''}
      <label>Email</label><input name="email" type="email" required autocomplete="email">
      <label>Password</label><input name="pw" type="password" minlength="6" required autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}">
      <button class="btn gold" style="width:100%;margin-top:14px">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
      <div class="err" id="err">${esc(msg)}</div>
      <p class="muted" style="text-align:center;margin:12px 0 0"><a href="#" id="sw">${mode === 'up' ? 'I already have an account' : 'New officer? Create an account'}</a></p>
    </form><p><a href="index.html">← Public page</a></p></div>`;
  document.getElementById('sw').onclick = e => { e.preventDefault(); authScreen(mode === 'up' ? 'in' : 'up'); };
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector('button'); btn.disabled = true;
    const err = document.getElementById('err'); err.textContent = '';
    try {
      if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({ email: f.get('email').trim(), password: f.get('pw'), options: { data: { full_name: f.get('name').trim() } } });
        if (error) throw error;
        if (!data.session) { authScreen('in', 'Account created. If email confirmation is on, confirm your email, then sign in. The Mayor will then approve your role.'); return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('pw') });
        if (error) throw error;
      }
      boot();
    } catch (x) { err.textContent = /fetch/i.test(x.message) ? 'No connection. Check your network and try again.' : x.message; btn.disabled = false; }
  };
}

function pendingScreen(p) {
  root.innerHTML = `<div class="auth"><img src="../assets/wolf-crest.png" alt=""><h2 style="margin:10px 0">Waiting for approval</h2>
   <div class="card"><p>Signed in as <b>${esc(p.email)}</b>.</p><p class="muted">The Mayor needs to assign your officer role. This page updates by itself once that happens.</p>
   <button class="btn ghost" id="out">Sign out</button></div></div>`;
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); boot(); };
  const iv = setInterval(async () => { try { const n = await getProfile(); if (n && n.role !== 'pending') { clearInterval(iv); boot(); } } catch {} }, 8000);
}

async function shell(p) {
  const tabs = TABS.filter(t => t.roles.includes(p.role));
  const want = (location.hash || '').slice(1);
  let cur = tabs.find(t => t.id === want)?.id || tabs[0].id;
  root.innerHTML = `<div class="top"><img src="../assets/wolf-crest.png" alt=""><div class="t"><b>ALPHA SUITE</b><small>${esc(p.full_name)} · ${ROLE_LABEL[p.role]}</small></div>
    <span class="chip syncing" id="sync"><i></i><span>Connecting</span></span><button class="btn ghost sm" id="out" style="color:#fff;border-color:rgba(255,255,255,.3)">Sign out</button></div>
    <div class="tabs">${tabs.map(t => `<button data-t="${t.id}">${t.label}</button>`).join('')}</div><main id="view"></main>`;
  onSync((s, d) => { const c = document.getElementById('sync'); if (!c) return; c.className = 'chip ' + s;
    c.querySelector('span').textContent = { live:'Live', syncing:'Syncing…', offline:'Offline', error:'Sync error' }[s]; c.title = d || ''; });
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); boot(); };
  const go = async id => {
    cur = id; location.hash = id; cleanup && cleanup(); cleanup = null;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === id));
    const view = document.getElementById('view'); view.innerHTML = '<p class="empty">Loading…</p>';
    try { const mod = await import(`./${id}.js?v=2`); cleanup = await mod.mount(view, ctx); }
    catch (e) { console.error(e); view.innerHTML = `<div class="card"><b>Couldn't load this section.</b><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
  };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => go(b.dataset.t));
  go(cur);
}

async function boot() {
  cleanup && cleanup(); cleanup = null;
  try {
    const p = await getProfile();
    if (!p) return authScreen();
    ctx = { profile: p, can: (...r) => r.includes(p.role) };
    setSync('live');
    if (p.role === 'pending') return pendingScreen(p);
    shell(p);
  } catch (e) {
    root.innerHTML = `<div class="auth"><div class="card"><b>Couldn't reach the database.</b><p class="muted">${esc(e.message)}</p><button class="btn" id="r">Retry</button></div></div>`;
    document.getElementById('r').onclick = boot;
  }
}
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') authScreen(); });
boot();
