/* Alpha Watch — screens.js
   All render*HTML() and attach*Events() functions: setup/gate/public,
   nav shell, role dashboards, roster, standard, log, ledger, accounts,
   modal, plus the Treasury tab's mount point. Mechanically split out of
   the original single-file index__1_.html — logic is unchanged, only
   wrapped in ES module imports/exports. */
import { ICONS as ICON } from '../shared/icons.js';
import {
  state, loginLockout, getStudentOffenseTimeline, getViolationSanction,
  getStudentTotalFines, getClassTotalFines,
} from './state.js';
import {
  LOGO_PATH,
  PUBLIC_OUTSTANDING_STATUSES, REPEAT_OFFENSE_FINE, offenseSanctionLabel, hashPassword,
  roleLabel, statusChipHTML, formatPeso, initials, avatarHTML, resizeImageFile,
  escapeHtml, todayISO, nowTimeHHMM, formatDateTime, emptyState,
} from './constants.js';
import { saveShared, mutateShared, savePersonal } from './sync.js';
import { render, showToast } from './router.js';
import { exportLedgerCSV, printLedgerReport } from './reports.js';
import { Treasury } from './treasury-embed.js';

/* ===================== current_dash ===================== */
export function currentDashboardHTML(){
  const role = state.session.role;
  if(role==='sails') return sailsDashboardHTML();
  if(role==='marshall') return marshallDashboardHTML();
  if(role==='secretary') return secretaryDashboardHTML();
  if(role==='vice_mayor') return viceMayorDashboardHTML();
  return dashboardHTML();
}
/* ============== TREASURY (embedded, native — not an iframe) ==============
   Alpha Treasury keeps its own separate accounts/login on purpose (Watch
   and Treasury officers aren't the same account), but its actual UI is
   ported in natively here as the `Treasury` module below, so it renders as
   a normal tab inside Alpha Watch instead of a boxed-in iframe. It talks to
   the same Supabase `shared_data` table (treasury_* keys) as the standalone
   alpha-treasury.html, and reads the class roster live from Watch's own
   `state.roster` rather than fetching it a second time. Everything is
   wrapped in an IIFE so its internals (which reuse familiar names like
   `state`, `render`, `ICON`, `escapeHtml`...) can never collide with Watch's
   own identically-patterned code above. */

/* ===================== runcountups ===================== */
export function runCountUps(){
  document.querySelectorAll('[data-count]').forEach(el=>{
    const target = parseInt(el.dataset.count, 10) || 0;
    const prefix = el.dataset.prefix || '';
    if(target===0){ el.textContent=prefix+'0'; return; }
    const duration = 550;
    const start = performance.now();
    function tick(now){
      const p = Math.min(1, (now-start)/duration);
      const eased = 1 - Math.pow(1-p, 3);
      el.textContent = prefix+Math.round(eased*target).toLocaleString('en-PH');
      if(p<1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/* ============== SETUP (first run — create the Mayor account) ============== */

/* ===================== navBtn ===================== */
export function navBtn(id,label,icon){
  return `<button data-tab="${id}" class="${state.tab===id?'active':''}">${icon}<span>${label}</span></button>`;
}

/* ===================== treasuryTabHTML ===================== */
export function treasuryTabHTML(){ return '<div id="treasuryRoot"></div>'; }

/* ===================== setup_gate ===================== */
export function setupHTML(){
  return `
  <div class="gate">
    <div class="gate-card">
      <div class="logo-chip"><img src="${LOGO_PATH}" alt="Alpha logo"/></div>
      <h1>ALPHA WATCH</h1>
      <div class="tag">Uphold The Standard</div>
      <p class="gate-note" style="margin-top:2px;">No accounts yet. Set up the Class Mayor account first — the Mayor can then create Secretary accounts from inside the app.</p>
      <div class="field"><label>Mayor's Name</label><input type="text" id="su_name" placeholder="e.g. Juan Dela Cruz"/></div>
      <div class="field"><label>Username</label><input type="text" id="su_username" placeholder="e.g. juan.mayor" autocapitalize="off"/></div>
      <div class="field"><label>Password</label><input type="password" id="su_password" placeholder="At least 4 characters"/></div>
      <div class="field"><label>Confirm Password</label><input type="password" id="su_confirm" placeholder="Re-enter password"/></div>
      ${state._setupError?`<p style="color:var(--danger);font-size:12px;margin:0 0 12px;font-weight:700;">${escapeHtml(state._setupError)}</p>`:''}
      <button class="btn-primary" id="setupBtn">Create Mayor Account</button>
      <p class="gate-note">Passwords are hashed before they're stored. This is built for lightweight class use, not high-security accounts — don't reuse a sensitive password here.</p>
      <button class="btn-sm ghost" id="publicLinkBtn" style="width:100%;justify-content:center;margin-top:6px;">${ICON.users}View Public Standing Board</button>
      <a class="btn-sm ghost" href="alpha-treasury.html" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin-top:8px;text-decoration:none;">${ICON.cash}Open Alpha Treasury</a>
    </div>
  </div>`;
}
export function attachSetupEvents(){
  const publicBtn = document.getElementById('publicLinkBtn');
  if(publicBtn) publicBtn.onclick = ()=>{ location.hash='public'; state.screen='public'; render(); };
  document.getElementById('setupBtn').onclick = async ()=>{
    const name = document.getElementById('su_name').value.trim();
    const username = document.getElementById('su_username').value.trim();
    const password = document.getElementById('su_password').value;
    const confirm = document.getElementById('su_confirm').value;
    if(!name || !username || !password){ state._setupError='Please fill in every field.'; render(); return; }
    if(password.length<4){ state._setupError='Password must be at least 4 characters.'; render(); return; }
    if(password!==confirm){ state._setupError='Passwords do not match.'; render(); return; }
    const passwordHash = await hashPassword(username, password);
    const account = {id:'acc_'+Date.now(), name, username, role:'mayor', passwordHash};
    state.accounts = [account];
    await saveShared('accounts', state.accounts);
    state.session = {name, role:'mayor', username, accountId:account.id};
    await savePersonal('session', state.session);
    state._setupError=null;
    state.screen='app';
    render();
  };
}

/* ============== GATE (sign in) ============== */
export function gateHTML(){
  return `
  <div class="gate">
    <div class="gate-card">
      <div class="logo-chip"><img src="${LOGO_PATH}" alt="Alpha logo"/></div>
      <h1>ALPHA WATCH</h1>
      <div class="tag">Uphold The Standard</div>
      <div class="field"><label>Username</label><input type="text" id="lg_username" placeholder="Your username" autocapitalize="off"/></div>
      <div class="field"><label>Password</label><input type="password" id="lg_password" placeholder="Your password"/></div>
      ${state._loginError?`<p style="color:var(--danger);font-size:12px;margin:0 0 12px;font-weight:700;">${escapeHtml(state._loginError)}</p>`:''}
      <button class="btn-primary" id="loginBtn">Sign In</button>
      <p class="gate-note">Forgot your password? Ask your Class Mayor to reset it from the Accounts tab.</p>
      <button class="btn-sm ghost" id="publicLinkBtn" style="width:100%;justify-content:center;margin-top:6px;">${ICON.users}View Public Standing Board</button>
      <a class="btn-sm ghost" href="alpha-treasury.html" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin-top:8px;text-decoration:none;">${ICON.cash}Open Alpha Treasury</a>
    </div>
  </div>`;
}
export function attachGateEvents(){
  const publicBtn = document.getElementById('publicLinkBtn');
  if(publicBtn) publicBtn.onclick = ()=>{ location.hash='public'; state.screen='public'; render(); };
  const uInput = document.getElementById('lg_username');
  const pInput = document.getElementById('lg_password');
  uInput.focus();
  const submit = async ()=>{
    const now = Date.now();
    if(now < loginLockout.until){
      const wait = Math.ceil((loginLockout.until-now)/1000);
      state._loginError = `Too many attempts — try again in ${wait}s.`;
      render();
      return;
    }
    const username = uInput.value.trim();
    const password = pInput.value;
    if(!username || !password){ state._loginError='Enter your username and password.'; render(); return; }
    const passwordHash = await hashPassword(username, password);
    const account = state.accounts.find(a=> a.username.toLowerCase()===username.toLowerCase() && a.passwordHash===passwordHash);
    if(!account){
      loginLockout.attempts++;
      if(loginLockout.attempts>=5){
        loginLockout.until = Date.now()+15000;
        loginLockout.attempts = 0;
        state._loginError = 'Too many attempts — try again in 15s.';
      } else {
        state._loginError='Incorrect username or password.';
      }
      render();
      return;
    }
    loginLockout = {attempts:0, until:0};
    state.session = {name:account.name, role:account.role, username:account.username, accountId:account.id};
    await savePersonal('session', state.session);
    state._loginError=null;
    state.screen='app';
    render();
  };
  document.getElementById('loginBtn').onclick = submit;
  pInput.onkeydown = (e)=>{ if(e.key==='Enter') submit(); };
}

/* ============== PUBLIC STANDING BOARD (no login required) ==============
   A read-only, class-wide view so any student can check everyone's current
   standing without an account. "Outstanding" here means an approved
   violation that hasn't reached Resolved yet (pending, resolve requested,
   or awaiting VP approval) — a Marshall's submission that the Secretary
   hasn't approved yet is deliberately left out, since it isn't an official
   violation until then. */

/* ===================== public ===================== */
export const PUBLIC_OUTSTANDING_STATUSES = ['pending','resolve_requested','resolve_forwarded'];
export function publicHTML(){
  const q = (state.search||'').toLowerCase();
  const totalStudents = state.roster.length;
  const withItems = state.roster
    .map(s=>({ ...s, items: state.ledger.filter(v=>v.studentId===s.id && PUBLIC_OUTSTANDING_STATUSES.includes(v.status)) }));
  const withOutstanding = withItems.filter(s=>s.items.length>0).length;
  const clear = totalStudents - withOutstanding;
  const rows = withItems
    .filter(s=> !q || s.name.toLowerCase().includes(q) || (s.section||'').toLowerCase().includes(q))
    .sort((a,b)=> (b.items.length - a.items.length) || a.name.localeCompare(b.name));

  return `
  <div class="public-wrap">
    <div class="public-header">
      <div class="logo-chip"><img src="${LOGO_PATH}" alt="Alpha logo"/></div>
      <h1>ALPHA WATCH</h1>
      <div class="tag">Public Standing Board</div>
      <p class="subtext" style="text-align:center;margin-top:6px;">BSMT 1-Alpha · Batch 28 — everyone's current standing under The Standard.</p>
    </div>

    <div class="grid-stats" style="max-width:520px;margin:0 auto 16px;">
      <div class="stat"><div class="stat-icon">${ICON.users}</div><b class="mono" data-count="${totalStudents}">0</b><span>Students</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b class="mono" data-count="${clear}">0</b><span>Clear</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${withOutstanding}">0</b><span>With Pending</span></div>
    </div>

    <div class="search" style="max-width:520px;margin:0 auto 14px;">
      ${ICON.search}<input id="publicSearch" placeholder="Search name or section…" value="${escapeHtml(state.search||'')}"/>
    </div>

    <div class="card" style="max-width:680px;margin:0 auto;">
      ${rows.length===0? emptyState('No students found','Try a different search.', ICON.users) :
        rows.map(s=>{
          const hasItems = s.items.length>0;
          const fine = getStudentTotalFines(s.id);
          return `
          <details class="public-row">
            <summary>
              <div class="list-item" style="pointer-events:none;">
                ${avatarHTML(s)}
                <div class="li-main">
                  <b>${escapeHtml(s.name)}</b>
                  <span>${escapeHtml(s.section||'—')}${fine>0?` · ${formatPeso(fine)} total fines`:''}</span>
                </div>
                <span class="status-chip ${hasItems?'pending':'resolved'}">${hasItems?ICON.clock:ICON.check}${hasItems? s.items.length+' pending' : 'clear'}</span>
              </div>
            </summary>
            ${hasItems? `
              <div class="public-detail">
                ${s.items.map(v=>{
                  const cat = state.standard.find(c=>c.id===v.categoryId);
                  return `<div class="public-detail-row">
                    <div class="pd-top">
                      <span class="pd-check">${escapeHtml(cat?cat.title:'Unknown checkpoint')}</span>
                      <span class="pd-date">${formatDateTime(v.date, v.time)}</span>
                    </div>
                    <span class="pd-sanction">${escapeHtml(getViolationSanction(v))}</span>
                  </div>`;
                }).join('')}
              </div>` : ''
            }
          </details>`;
        }).join('')
      }
    </div>

    <div style="text-align:center;margin-top:20px;">
      <button class="btn-sm ghost" id="publicBackBtn">${ICON.key}Officer Sign In</button>
    </div>
  </div>`;
}
export function attachPublicEvents(){
  const search = document.getElementById('publicSearch');
  if(search) search.oninput = ()=>{
    state.search = search.value; render();
    const el=document.getElementById('publicSearch');
    if(el){ el.focus(); el.selectionStart=el.value.length; }
  };
  const back = document.getElementById('publicBackBtn');
  if(back) back.onclick = ()=>{
    state.search='';
    if(location.hash) history.replaceState(null,'',location.pathname+location.search);
    state.screen = state.session ? 'app' : (state.accounts.length ? 'gate' : 'setup');
    render();
  };
  runCountUps();
}

/* ============== APP SHELL ============== */

/* ===================== app_shell ===================== */
export function appHTML(){
  const isMayor = state.session.role==='mayor';
  const isMarshall = state.session.role==='marshall';
  const isSails = state.session.role==='sails';
  const isViceMayor = state.session.role==='vice_mayor';
  if(isSails) state.tab = 'dashboard'; // SAILS Officer only ever has the one view
  const navHTML = `
    <nav class="navbar">
      <div class="navbar-logo"><div class="logo-chip"><img src="${LOGO_PATH}" alt="Alpha logo"/></div><b>ALPHA<br/>WATCH</b></div>
      ${navBtn('dashboard','Dashboard',ICON.home)}
      ${!isSails?navBtn('roster',isMarshall?'Students':'Pack Roster',ICON.users):''}
      ${!isSails?navBtn('standard','The Standard',ICON.clipboard):''}
      ${(!isSails && !isMarshall && !isViceMayor)?navBtn('log','Log',ICON.plus):''}
      ${!isSails?navBtn('ledger','Ledger',ICON.list):''}
      ${!isSails?navBtn('treasury','Treasury',ICON.cash):''}
      ${isMayor?navBtn('accounts','Accounts',ICON.key):''}
    </nav>`;
  const topbar = `
    <div class="topbar">
      <div class="brand"><div class="logo-chip"><img src="${LOGO_PATH}" alt="Alpha logo"/></div><div class="name"><b>ALPHA WATCH</b><span>Uphold the Standard</span></div></div>
      <div class="who"><span class="chip">${roleLabel(state.session.role)}</span><button id="treasuryBtn" style="background:none;border:1px solid rgba(255,255,255,0.25);color:#d8d8ea;font-size:11px;padding:5px 10px;border-radius:20px;cursor:pointer;font-family:'Manrope',sans-serif;">Treasury</button><button id="changePassBtn">Password</button><button id="logoutBtn">Sign out</button></div>
    </div>`;
  const topDesktop = `
    <div class="top-desktop">
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="logo-chip" style="width:42px;height:42px;"><img src="${LOGO_PATH}" alt="Alpha logo"/></div>
        <div><div style="font-family:'Cinzel',serif;font-size:13px;color:var(--ink-soft);">Signed in as</div><b style="font-size:16px;">${escapeHtml(state.session.name)}</b></div>
      </div>
      <div class="who"><span class="chip">${roleLabel(state.session.role)}</span><button id="treasuryBtnD" style="background:none;border:1px solid var(--line);color:var(--ink-soft);font-size:11px;padding:6px 12px;border-radius:20px;cursor:pointer;font-family:'Manrope',sans-serif;">Treasury</button><button id="changePassBtnD" style="background:none;border:1px solid var(--line);color:var(--ink-soft);font-size:11px;padding:6px 12px;border-radius:20px;cursor:pointer;">Password</button><button id="logoutBtnD" style="background:none;border:1px solid var(--line);color:var(--ink-soft);font-size:11px;padding:6px 12px;border-radius:20px;cursor:pointer;">Sign out</button></div>
    </div>`;
  let body='';
  if(state.tab==='dashboard') body = currentDashboardHTML();
  else if(state.tab==='roster') body = rosterHTML();
  else if(state.tab==='standard') body = standardHTML();
  else if(state.tab==='log') body = (isMarshall || isViceMayor) ? currentDashboardHTML() : logHTML();
  else if(state.tab==='ledger') body = ledgerHTML();
  else if(state.tab==='treasury') body = treasuryTabHTML();
  else if(state.tab==='accounts') body = isMayor ? accountsHTML() : currentDashboardHTML();

  return `
    <div id="app">
      ${topbar}
      ${navHTML}
      <main>${topDesktop}<div class="view-enter">${body}</div></main>
    </div>
    ${state.toast?`<div class="toast"><span class="toast-icon">${ICON.check}</span>${escapeHtml(state.toast)}</div>`:''}
  `;
}

export function attachAppEvents(){
  document.querySelectorAll('.navbar button').forEach(b=>{
    b.onclick = ()=>{ state.tab=b.dataset.tab; state.modal=null; render(); };
  });
  const lo = document.getElementById('logoutBtn'); if(lo) lo.onclick = doLogout;
  const lod = document.getElementById('logoutBtnD'); if(lod) lod.onclick = doLogout;
  const cp = document.getElementById('changePassBtn'); if(cp) cp.onclick = ()=>{ state.modal={type:'selfpass', data:{}}; render(); };
  const cpd = document.getElementById('changePassBtnD'); if(cpd) cpd.onclick = ()=>{ state.modal={type:'selfpass', data:{}}; render(); };
  const tb = document.getElementById('treasuryBtn'); if(tb) tb.onclick = ()=>{ state.tab='treasury'; state.modal=null; render(); };
  const tbd = document.getElementById('treasuryBtnD'); if(tbd) tbd.onclick = ()=>{ state.tab='treasury'; state.modal=null; render(); };

  if(state.tab==='roster') attachRosterEvents();
  if(state.tab==='standard') attachStandardEvents();
  if(state.tab==='log') attachLogEvents();
  if(state.tab==='ledger') attachLedgerEvents();
  if(state.tab==='accounts' && state.session.role==='mayor') attachAccountsEvents();
  if(state.tab==='treasury') Treasury.mount(document.getElementById('treasuryRoot'));
  if(state.tab==='dashboard' && state.session.role==='sails') attachSailsDashboardEvents();
  if(state.tab==='dashboard' && state.session.role==='secretary') attachSecretaryDashboardEvents();
  if(state.tab==='dashboard' && state.session.role==='vice_mayor') attachViceMayorDashboardEvents();
  const gotoRoster = document.querySelector('[data-goto-roster]');
  if(gotoRoster) gotoRoster.onclick = ()=>{ state.tab='roster'; render(); };
  document.querySelectorAll('[data-open-fines]').forEach(el=>{
    el.onclick = ()=>{ state.modal = {type:'finesBreakdown', data:{}}; render(); };
  });
}
export async function doLogout(){
  state.session=null; state.screen='gate'; state._loginError=null;
  await savePersonal('session', null);
  render();
}

/* ============== DASHBOARD ============== */

/* ===================== dashboards ===================== */
export function dashboardHTML(){
  const total = state.ledger.length;
  const pending = state.ledger.filter(v=>v.status==='pending').length;
  const resolved = state.ledger.filter(v=>v.status==='resolved').length;
  const awaitingApproval = state.ledger.filter(v=>v.status==='awaiting_approval').length;
  const inResolveReview = state.ledger.filter(v=>v.status==='resolve_requested' || v.status==='resolve_forwarded').length;
  const pct = total? Math.min(100, Math.round((pending/Math.max(state.roster.length,1))*100)) : 0;
  let level='CALM', levelColor='var(--resolved)';
  if(pct>66){level='HOWLING';levelColor='var(--danger)';}
  else if(pct>33){level='ALERT';levelColor='var(--pending)';}

  // top violator
  const counts={};
  state.ledger.forEach(v=>{counts[v.studentId]=(counts[v.studentId]||0)+1;});
  let topId=null, topCount=0;
  Object.entries(counts).forEach(([id,c])=>{ if(c>topCount){topCount=c;topId=id;} });
  const topStudent = topId ? state.roster.find(s=>s.id===topId) : null;

  const recent = [...state.ledger].sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0,6);
  const classFines = getClassTotalFines();

  return `
    <h2 class="section-title">${ICON.home}Command Deck</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Here's how the pack is doing.</p>

    <div class="grid-stats">
      <div class="stat"><div class="stat-icon">${ICON.list}</div><b class="mono" data-count="${total}">0</b><span>Total Logged</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${pending}">0</b><span>Pending</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b class="mono" data-count="${resolved}">0</b><span>Resolved</span></div>
      <div class="stat gold"><div class="stat-icon">${ICON.users}</div><b class="mono" data-count="${state.roster.length}">0</b><span>Students Tracked</span></div>
      <div class="stat"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${awaitingApproval}">0</b><span>Awaiting Secretary Approval</span></div>
      <div class="stat"><div class="stat-icon">${ICON.send}</div><b class="mono" data-count="${inResolveReview}">0</b><span>In Resolve Review</span></div>
      <div class="stat gold" data-open-fines style="cursor:pointer;"><div class="stat-icon">${ICON.cash}</div><b class="mono" data-count="${classFines}" data-prefix="₱">0</b><span>Total Violation Fines</span></div>
    </div>

    <div class="howl-meter">
      <div class="row"><b style="display:flex;align-items:center;gap:7px;">${level!=='CALM'?`<span class="howl-flame" style="color:${levelColor};width:16px;height:16px;display:inline-flex;">${ICON.flame}</span>`:''}Howl Level</b><span class="level" style="background:${levelColor}22;color:${levelColor};">${level}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <p class="subtext" style="margin:8px 0 0;">Ratio of unresolved violations to tracked students.</p>
    </div>

    ${topStudent?`
    <div class="card top-violator" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;">
      <div style="position:relative;">${avatarHTML(topStudent, 'width:44px;height:44px;font-size:16px;')}<span class="medal-badge">${ICON.medal}</span></div>
      <div style="flex:1;">
        <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;color:var(--ink-soft);font-weight:700;">Most Flagged</div>
        <b style="font-size:14.5px;">${escapeHtml(topStudent.name)}</b>
      </div>
      <div class="stat" style="border:none;padding:0;text-align:right;"><b class="mono" style="font-size:20px;" data-count="${topCount}">0</b><span>flags</span></div>
    </div>`:''}

    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.list}Recent Activity</h2>
    <div class="card">
      ${recent.length===0? emptyState('No activity yet','Logged violations will appear here.', ICON.list) :
        recent.map(v=>{
          const st = state.roster.find(s=>s.id===v.studentId);
          const cat = state.standard.find(c=>c.id===v.categoryId);
          return `<div class="list-item">
            ${avatarHTML(st)}
            <div class="li-main"><b>${st?escapeHtml(st.name):'Unknown student'}</b><span>${cat?escapeHtml(cat.title):'—'} · ${formatDateTime(v.date, v.time)} · by ${escapeHtml(v.reportedBy)}</span></div>
            ${statusChipHTML(v)}
          </div>`;
        }).join('')
      }
    </div>
  `;
}

export function marshallDashboardHTML(){
  const total = state.ledger.length;
  const pending = state.ledger.filter(v=>v.status==='pending').length;
  const resolved = state.ledger.filter(v=>v.status==='resolved').length;
  const myReports = state.ledger.filter(v=>v.source==='inspection' && v.reportedBy===state.session.name).length;
  const recent = [...state.ledger].sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0,6);

  return `
    <h2 class="section-title">${ICON.checklist}Marshall Deck</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Inspect students and report what you find.</p>

    <div class="grid-stats">
      <div class="stat gold"><div class="stat-icon">${ICON.users}</div><b class="mono" data-count="${state.roster.length}">0</b><span>Students Tracked</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${pending}">0</b><span>Pending</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b class="mono" data-count="${resolved}">0</b><span>Resolved</span></div>
      <div class="stat"><div class="stat-icon">${ICON.send}</div><b class="mono" data-count="${myReports}">0</b><span>Your Reports Sent</span></div>
    </div>

    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;">
      <div style="width:40px;height:40px;flex-shrink:0;color:var(--gold);">${ICON.checklist}</div>
      <div style="flex:1;">
        <b style="font-size:14px;display:block;">Ready to inspect?</b>
        <span style="font-size:12px;color:var(--ink-soft);">Head to Students, pick someone, and run the checklist.</span>
      </div>
      <button class="btn-sm gold" data-goto-roster>${ICON.users}Students</button>
    </div>

    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.list}Recent Activity</h2>
    <div class="card">
      ${recent.length===0? emptyState('No activity yet','Logged violations will appear here.', ICON.list) :
        recent.map(v=>{
          const st = state.roster.find(s=>s.id===v.studentId);
          const cat = state.standard.find(c=>c.id===v.categoryId);
          return `<div class="list-item">
            ${avatarHTML(st)}
            <div class="li-main"><b>${st?escapeHtml(st.name):'Unknown student'}</b><span>${cat?escapeHtml(cat.title):'—'} · ${formatDateTime(v.date, v.time)} · by ${escapeHtml(v.reportedBy)}</span></div>
            ${statusChipHTML(v)}
          </div>`;
        }).join('')
      }
    </div>
  `;
}
/* ============== SAILS OFFICER DASHBOARD (read-only) ============== */
export function sailsDashboardHTML(){
  const q = state.search.toLowerCase();
  const total = state.roster.length;
  const withPending = state.roster.filter(s=> state.ledger.some(v=>v.studentId===s.id && v.status==='pending')).length;
  const clear = total - withPending;

  const rows = state.roster
    .map(s=>{
      const pending = state.ledger.filter(v=>v.studentId===s.id && v.status==='pending').length;
      const resolved = state.ledger.filter(v=>v.studentId===s.id && v.status==='resolved').length;
      return {student:s, pending, resolved};
    })
    .filter(r=> r.student.name.toLowerCase().includes(q) || (r.student.section||'').toLowerCase().includes(q))
    .sort((a,b)=> b.pending-a.pending || a.student.name.localeCompare(b.student.name));

  return `
    <h2 class="section-title">${ICON.clipboard}Student Status Overview</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. View-only — every student and their current standing.</p>

    <div class="grid-stats">
      <div class="stat gold"><div class="stat-icon">${ICON.users}</div><b class="mono" data-count="${total}">0</b><span>Students Tracked</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${withPending}">0</b><span>With Pending Items</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b class="mono" data-count="${clear}">0</b><span>Clear</span></div>
    </div>

    <div class="fab-row">
      <div class="search" style="flex:1;margin-bottom:0;">${ICON.search}<input id="sailsSearch" placeholder="Search name or section…" value="${escapeHtml(state.search)}"/></div>
      <button class="btn-sm gold" id="sailsExportBtn">${ICON.download}Excel</button>
      <button class="btn-sm ghost" id="sailsPrintBtn">${ICON.list}Print / PDF</button>
    </div>

    <div class="card">
      ${rows.length===0? emptyState('No students found', 'Try a different search, or ask the Mayor to add students.', ICON.users) :
        rows.map(r=>{
          const statusLabel = r.pending>0 ? `${r.pending} pending` : 'Clear';
          const statusClass = r.pending>0 ? 'pending' : 'resolved';
          return `<div class="list-item">
            ${avatarHTML(r.student)}
            <div class="li-main"><b>${escapeHtml(r.student.name)}</b><span>${escapeHtml(r.student.section||'—')}${r.resolved?` · ${r.resolved} resolved`:''}</span></div>
            <span class="status-chip ${statusClass}">${r.pending>0?ICON.clock:ICON.check}${statusLabel}</span>
          </div>`;
        }).join('')
      }
    </div>
  `;
}
export function attachSailsDashboardEvents(){
  const search = document.getElementById('sailsSearch');
  if(search) search.oninput = ()=>{ state.search = search.value; render(); const el=document.getElementById('sailsSearch'); if(el){ el.focus(); el.selectionStart=el.value.length; } };
  const exportBtn = document.getElementById('sailsExportBtn');
  if(exportBtn) exportBtn.onclick = exportLedgerCSV;
  const printBtn = document.getElementById('sailsPrintBtn');
  if(printBtn) printBtn.onclick = printLedgerReport;
}

/* ============== SECRETARY DASHBOARD (approves Marshall submissions & resolve requests) ============== */
export function queueItemHTML(v, actionsHTML){
  const st = state.roster.find(s=>s.id===v.studentId);
  const cat = state.standard.find(c=>c.id===v.categoryId);
  return `
    <div class="queue-card">
      <div class="queue-top">
        ${avatarHTML(st, 'width:34px;height:34px;font-size:13px;')}
        <div style="flex:1;">
          <b style="font-size:13.5px;display:block;">${st?escapeHtml(st.name):'Unknown student'}</b>
          <span style="font-size:11.5px;color:var(--ink-soft);">${cat?escapeHtml(cat.title):'—'} · ${formatDateTime(v.date, v.time)} · by ${escapeHtml(v.reportedBy)}</span>
        </div>
        ${statusChipHTML(v)}
      </div>
      <div class="queue-actions">${actionsHTML}</div>
    </div>`;
}
export function secretaryDashboardHTML(){
  const awaiting = state.ledger.filter(v=>v.status==='awaiting_approval').sort((a,b)=> a.date.localeCompare(b.date));
  const resolveReqs = state.ledger.filter(v=>v.status==='resolve_requested').sort((a,b)=> a.date.localeCompare(b.date));
  const pending = state.ledger.filter(v=>v.status==='pending').length;
  const resolved = state.ledger.filter(v=>v.status==='resolved').length;
  const classFines = getClassTotalFines();

  return `
    <h2 class="section-title">${ICON.key}Secretary Desk</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Approve what the Marshalls send in, and review resolve requests before they reach the Vice Mayor.</p>

    <div class="grid-stats">
      <div class="stat"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${awaiting.length}">0</b><span>Awaiting Approval</span></div>
      <div class="stat"><div class="stat-icon">${ICON.send}</div><b class="mono" data-count="${resolveReqs.length}">0</b><span>Resolve Requests</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${pending}">0</b><span>Active Pending</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b class="mono" data-count="${resolved}">0</b><span>Resolved</span></div>
      <div class="stat gold" data-open-fines style="cursor:pointer;"><div class="stat-icon">${ICON.cash}</div><b class="mono" data-count="${classFines}" data-prefix="₱">0</b><span>Total Violation Fines</span></div>
    </div>

    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.clock}Violations Awaiting Your Approval</h2>
    ${awaiting.length===0? emptyState('All caught up','No Marshall submissions are waiting on you.', ICON.check) :
      awaiting.map(v=> queueItemHTML(v, `
        <button class="btn-sm gold" data-approve-violation="${v.id}">${ICON.check}Approve</button>
        <button class="btn-sm danger" data-decline-violation="${v.id}">${ICON.trash}Decline</button>
      `)).join('')
    }

    <h2 class="section-title" style="font-size:15px;margin-top:16px;">${ICON.send}Resolve Requests Awaiting Your Review</h2>
    ${resolveReqs.length===0? emptyState('Nothing to review','No resolve requests from the Marshalls right now.', ICON.check) :
      resolveReqs.map(v=> queueItemHTML(v, `
        <button class="btn-sm gold" data-forward-resolve="${v.id}">${ICON.send}Forward to VP</button>
        <button class="btn-sm danger" data-decline-resolve="${v.id}">Decline</button>
      `)).join('')
    }
  `;
}
export function attachSecretaryDashboardEvents(){
  attachViolationWorkflowEvents();
}

/* ============== VICE MAYOR DASHBOARD (final approval on resolve requests; supervises progress) ============== */
export function viceMayorDashboardHTML(){
  const forwarded = state.ledger.filter(v=>v.status==='resolve_forwarded').sort((a,b)=> a.date.localeCompare(b.date));
  const total = state.ledger.length;
  const awaitingApproval = state.ledger.filter(v=>v.status==='awaiting_approval').length;
  const pending = state.ledger.filter(v=>v.status==='pending').length;
  const resolveReqs = state.ledger.filter(v=>v.status==='resolve_requested').length;
  const resolved = state.ledger.filter(v=>v.status==='resolved').length;
  const classFines = getClassTotalFines();

  return `
    <h2 class="section-title">${ICON.checklist}Vice Mayor's Watch</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Give final approval on resolve requests forwarded by the Secretary, and keep an eye on the pack's overall progress.</p>

    <div class="grid-stats">
      <div class="stat"><div class="stat-icon">${ICON.send}</div><b class="mono" data-count="${forwarded.length}">0</b><span>Awaiting Your Approval</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b class="mono" data-count="${pending}">0</b><span>Active Pending</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b class="mono" data-count="${resolved}">0</b><span>Resolved</span></div>
      <div class="stat gold"><div class="stat-icon">${ICON.list}</div><b class="mono" data-count="${total}">0</b><span>Total Logged</span></div>
      <div class="stat gold" data-open-fines style="cursor:pointer;"><div class="stat-icon">${ICON.cash}</div><b class="mono" data-count="${classFines}" data-prefix="₱">0</b><span>Total Violation Fines</span></div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <p class="subtext" style="margin:0;">In the pipeline right now: <b>${awaitingApproval}</b> awaiting Secretary approval, <b>${resolveReqs}</b> resolve request${resolveReqs===1?'':'s'} with the Secretary, <b>${forwarded.length}</b> waiting on you.</p>
    </div>

    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.send}Resolve Requests Awaiting Your Approval</h2>
    ${forwarded.length===0? emptyState('Nothing pending','No resolve requests have reached you yet.', ICON.check) :
      forwarded.map(v=> queueItemHTML(v, `
        <button class="btn-sm gold" data-approve-resolve="${v.id}">${ICON.check}Approve Resolution</button>
        <button class="btn-sm danger" data-decline-resolve-vp="${v.id}">Decline</button>
      `)).join('')
    }
  `;
}
export function attachViceMayorDashboardEvents(){
  attachViolationWorkflowEvents();
}



/* ===================== roster ===================== */
export function rosterHTML(){
  const isMayor = state.session.role==='mayor';
  const isMarshall = state.session.role==='marshall';
  const isViceMayor = state.session.role==='vice_mayor';
  const canAdd = !isMarshall && !isViceMayor;
  const q = state.search.toLowerCase();
  const filtered = state.roster.filter(s=> s.name.toLowerCase().includes(q) || (s.section||'').toLowerCase().includes(q));
  return `
    <h2 class="section-title">${ICON.users}${isMarshall?'Students':'Pack Roster'}</h2>
    <p class="subtext">${isMarshall?'View students and run inspection checklists.':`Every student under watch. ${isMayor?'Add, edit, or remove profiles.':'You can add new profiles here.'}`}</p>
    <div class="fab-row">
      <div class="search" style="flex:1;margin-bottom:0;">${ICON.search}<input id="rosterSearch" placeholder="Search name…" value="${escapeHtml(state.search)}"/></div>
      ${canAdd?`<button class="btn-sm gold" id="addStudentBtn">${ICON.plus}Add</button>`:''}
    </div>
    <div class="card">
      ${filtered.length===0? emptyState('No students found', isMarshall?'Ask the Mayor or Secretary to add students.':'Add your first student to start tracking.', ICON.users) :
        filtered.map(s=>{
          const count = state.ledger.filter(v=>v.studentId===s.id && v.status==='pending').length;
          return `<div class="list-item">
            <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer;" data-view-history="${s.id}">
              ${avatarHTML(s)}
              <div class="li-main"><b>${escapeHtml(s.name)}</b>${(s.section||count)?`<span>${escapeHtml(s.section||'')}${s.section&&count?' · ':''}${count?`${count} pending`:''}</span>`:''}</div>
            </div>
            ${isMarshall?`<button class="btn-sm gold" data-inspect-student="${s.id}" style="padding:6px 10px;">${ICON.checklist}Inspect</button>`:''}
            ${isMayor?`<button class="btn-sm ghost" data-edit-student="${s.id}" style="padding:6px 8px;">${ICON.edit}</button>
            <button class="btn-sm danger" data-del-student="${s.id}" style="padding:6px 8px;">${ICON.trash}</button>`:''}
          </div>`;
        }).join('')
      }
    </div>
  `;
}
export function attachRosterEvents(){
  const search = document.getElementById('rosterSearch');
  if(search) search.oninput = ()=>{ state.search = search.value; render(); document.getElementById('rosterSearch').focus(); document.getElementById('rosterSearch').selectionStart = document.getElementById('rosterSearch').value.length; };
  const addBtn = document.getElementById('addStudentBtn');
  if(addBtn) addBtn.onclick = ()=>{ state.modal={type:'student', data:{name:''}}; render(); };
  document.querySelectorAll('[data-view-history]').forEach(el=>{
    el.onclick = ()=>{ state.modal={type:'studentHistory', data:{studentId:el.dataset.viewHistory}}; render(); };
  });
  document.querySelectorAll('[data-edit-student]').forEach(b=>{
    b.onclick = ()=>{ const s = state.roster.find(x=>x.id===b.dataset.editStudent); state.modal={type:'student', data:{...s}}; render(); };
  });
  document.querySelectorAll('[data-del-student]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Remove this student and all their violation records?')) return;
      const id = b.dataset.delStudent;
      await mutateShared('roster', latest=>latest.filter(s=>s.id!==id));
      await mutateShared('ledger', latest=>latest.filter(v=>v.studentId!==id));
      showToast('Student removed');
      render();
    };
  });
  document.querySelectorAll('[data-inspect-student]').forEach(b=>{
    b.onclick = ()=>{
      const s = state.roster.find(x=>x.id===b.dataset.inspectStudent);
      if(!s) return;
      state.modal = {
        type:'inspect',
        data:{
          studentId: s.id,
          studentName: s.name,
          checklist: state.standard.map(c=>({checkpointId:c.id, title:c.title, local:c.local, rule:c.rule, status:'pass', note:''}))
        }
      };
      render();
    };
  });
}

/* ============== THE STANDARD ============== */

/* ===================== standard ===================== */
export function standardHTML(){
  const isMayor = state.session.role==='mayor';
  return `
    <h2 class="section-title">${ICON.clipboard}The Standard</h2>
    <p class="subtext">The seven checkpoints every member of the pack is held to.</p>
    ${isMayor?`<div class="fab-row" style="justify-content:flex-end;"><button class="btn-sm gold" id="addStdBtn">${ICON.plus}Add Checkpoint</button></div>`:''}
    ${state.standard.map((c,i)=>`
      <div class="std-item">
        <div class="top">
          <div class="num">${String(i+1).padStart(2,'0')}</div>
          <div style="flex:1;">
            <h3>${escapeHtml(c.title)}${c.local && c.local!==c.title?` <span style="color:var(--ink-soft);font-weight:500;font-size:11.5px;">(${escapeHtml(c.local)})</span>`:''}</h3>
            <p>${escapeHtml(c.rule)}</p>
          </div>
          ${isMayor?`<div style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn-sm ghost" data-edit-std="${c.id}" style="padding:6px 8px;">${ICON.edit}</button>
            <button class="btn-sm danger" data-del-std="${c.id}" style="padding:6px 8px;">${ICON.trash}</button>
          </div>`:''}
        </div>
      </div>
    `).join('')}
  `;
}
export function attachStandardEvents(){
  const addBtn = document.getElementById('addStdBtn');
  if(addBtn) addBtn.onclick = ()=>{ state.modal={type:'standard', data:{title:'',local:'',rule:''}}; render(); };
  document.querySelectorAll('[data-edit-std]').forEach(b=>{
    b.onclick = ()=>{ const c = state.standard.find(x=>x.id===b.dataset.editStd); state.modal={type:'standard', data:{...c}}; render(); };
  });
  document.querySelectorAll('[data-del-std]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Remove this checkpoint from The Standard?')) return;
      await mutateShared('standard', latest=>latest.filter(c=>c.id!==b.dataset.delStd));
      showToast('Checkpoint removed');
      render();
    };
  });
}

/* ============== LOG VIOLATION ============== */

/* ===================== log ===================== */
export function logHTML(){
  if(state.roster.length===0){
    return `<h2 class="section-title">${ICON.plus}Log a Violation</h2>
      ${emptyState('No students yet', 'Ask the Mayor to add students to the Pack Roster first.', ICON.users)}`;
  }
  return `
    <h2 class="section-title">${ICON.plus}Log a Violation</h2>
    <p class="subtext">Fill this out the moment a checkpoint is missed.</p>
    <form class="card" id="logForm">
      <div class="field combo" id="lf_student_combo">
        <label>Student</label>
        <input type="text" id="lf_student_search" placeholder="Type a name to search…" autocomplete="off" required/>
        <input type="hidden" id="lf_student_id" value=""/>
        <div class="combo-list" id="lf_student_list" style="display:none;"></div>
      </div>
      <div class="field">
        <label>Checkpoint Violated</label>
        <select id="lf_category" required>
          <option value="">Select checkpoint…</option>
          ${state.standard.map(c=>`<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" id="lf_date" value="${todayISO()}" required/>
      </div>
      <div class="field">
        <label>Time</label>
        <input type="time" id="lf_time" value="${nowTimeHHMM()}" required/>
      </div>
      <p class="subtext" style="margin:-4px 0 4px;">Sanction is assigned automatically based on this student's offense count — 1st offense is a verbal warning, every offense after that is a ₱${REPEAT_OFFENSE_FINE} fine.</p>
      <div class="field">
        <label>Reported By</label>
        <input type="text" id="lf_reporter" value="${escapeHtml(state.session.name)}" required/>
      </div>
      <button type="submit" class="btn-primary">Submit Violation</button>
    </form>
  `;
}
export function renderStudentCombo(filterText){
  const list = document.getElementById('lf_student_list');
  if(!list) return;
  const q = (filterText||'').trim().toLowerCase();
  const matches = state.roster.filter(s=> !q || s.name.toLowerCase().includes(q) || (s.section||'').toLowerCase().includes(q));
  if(matches.length===0){
    list.innerHTML = `<div class="combo-empty">No students found</div>`;
  } else {
    list.innerHTML = matches.slice(0,50).map(s=>`
      <div class="combo-item" data-id="${s.id}">
        ${avatarHTML(s, 'width:26px;height:26px;font-size:11px;')}
        <div><b>${escapeHtml(s.name)}</b>${s.section?`<span>${escapeHtml(s.section)}</span>`:''}</div>
      </div>`).join('');
  }
  list.style.display = 'block';
  list.querySelectorAll('.combo-item').forEach(item=>{
    item.onclick = ()=>{
      const s = state.roster.find(x=>x.id===item.dataset.id);
      if(!s) return;
      document.getElementById('lf_student_search').value = s.name;
      document.getElementById('lf_student_id').value = s.id;
      list.style.display = 'none';
    };
  });
}
export function attachLogEvents(){
  const form = document.getElementById('logForm');
  if(!form) return;
  const catSel = document.getElementById('lf_category');
  const studentSearch = document.getElementById('lf_student_search');
  const studentIdInput = document.getElementById('lf_student_id');
  if(studentSearch){
    studentSearch.onfocus = ()=> renderStudentCombo(studentSearch.value);
    studentSearch.oninput = ()=>{ studentIdInput.value=''; renderStudentCombo(studentSearch.value); };
  }
  form.onsubmit = async (e)=>{
    e.preventDefault();
    let studentId = studentIdInput.value;
    if(!studentId && studentSearch){
      const typed = studentSearch.value.trim().toLowerCase();
      const exact = state.roster.find(s=>s.name.trim().toLowerCase()===typed);
      if(exact) studentId = exact.id;
    }
    const rec = {
      id: 'v_'+Date.now(),
      studentId,
      categoryId: document.getElementById('lf_category').value,
      date: document.getElementById('lf_date').value,
      time: document.getElementById('lf_time').value || nowTimeHHMM(),
      reportedBy: document.getElementById('lf_reporter').value.trim() || state.session.name,
      status: 'pending',
    };
    if(!rec.studentId){ showToast('Please select a student from the list'); return; }
    if(!rec.categoryId){ showToast('Please select a checkpoint'); return; }
    await mutateShared('ledger', latest=>{ latest.push(rec); return latest; });
    showToast('Violation logged');
    state.tab='ledger';
    render();
  };
}

/* ============== LEDGER ============== */
/*
  Line of authority for a violation's lifecycle:
    awaiting_approval -> (Secretary approves)      -> pending
                       -> (Secretary declines)      -> deleted
    pending            -> (Marshall requests resolve) -> resolve_requested
    resolve_requested  -> (Secretary forwards)       -> resolve_forwarded
                       -> (Secretary declines)       -> pending
    resolve_forwarded  -> (Vice Mayor approves)      -> resolved
                       -> (Vice Mayor declines)       -> pending
  Adding and removing violation records outright stays Mayor-only.
*/

/* ===================== ledger ===================== */
export function violationActionsHTML(v){
  const role = state.session.role;
  const isMayor = role==='mayor';
  const isMarshall = role==='marshall';
  const isSecretary = role==='secretary';
  const isViceMayor = role==='vice_mayor';
  let actions = '';
  if(v.status==='awaiting_approval' && isSecretary){
    actions = `<button class="btn-sm gold" data-approve-violation="${v.id}" style="padding:5px 10px;">${ICON.check}Approve</button>
      <button class="btn-sm danger" data-decline-violation="${v.id}" style="padding:5px 10px;">${ICON.trash}Decline</button>`;
  } else if(v.status==='pending' && isMarshall){
    actions = `<button class="btn-sm gold" data-request-resolve="${v.id}" style="padding:5px 10px;">${ICON.send}Request Resolve</button>`;
  } else if(v.status==='resolve_requested' && isSecretary){
    actions = `<button class="btn-sm gold" data-forward-resolve="${v.id}" style="padding:5px 10px;">${ICON.send}Forward to VP</button>
      <button class="btn-sm danger" data-decline-resolve="${v.id}" style="padding:5px 10px;">Decline</button>`;
  } else if(v.status==='resolve_forwarded' && isViceMayor){
    actions = `<button class="btn-sm gold" data-approve-resolve="${v.id}" style="padding:5px 10px;">${ICON.check}Approve Resolution</button>
      <button class="btn-sm danger" data-decline-resolve-vp="${v.id}" style="padding:5px 10px;">Decline</button>`;
  }
  const delBtn = isMayor ? `<button class="btn-sm danger" data-del-violation="${v.id}" style="padding:4px 8px;">${ICON.trash}</button>` : '';
  return `${actions}${delBtn}`;
}
export function violationWorkflowNoteHTML(v){
  const bits = [];
  if(v.resolveRequestedBy) bits.push(`Resolve requested by ${escapeHtml(v.resolveRequestedBy)}`);
  if(v.forwardedBy) bits.push(`forwarded by ${escapeHtml(v.forwardedBy)}`);
  if(v.approvedBy) bits.push(`approved by ${escapeHtml(v.approvedBy)}`);
  if(v.status==='resolved' && v.resolvedBy) bits.push(`resolved by ${escapeHtml(v.resolvedBy)}`);
  return bits.length ? `<span class="workflow-note">${bits.join(' · ')}</span>` : '';
}
export function ledgerHTML(){
  const isMayor = state.session.role==='mayor';
  const q = state.search.toLowerCase();
  let rows = state.ledger.map(v=>{
    const st = state.roster.find(s=>s.id===v.studentId);
    const cat = state.standard.find(c=>c.id===v.categoryId);
    return {...v, studentName: st?st.name:'Unknown', studentPhoto: st?st.photo:null, catTitle: cat?cat.title:'Unknown'};
  }).filter(v=>{
    const matchQ = !q || v.studentName.toLowerCase().includes(q) || v.catTitle.toLowerCase().includes(q);
    const matchS = state.statusFilter==='all' || v.status===state.statusFilter;
    return matchQ && matchS;
  }).sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  return `
    <h2 class="section-title">${ICON.list}The Ledger</h2>
    <p class="subtext">Full record of every violation logged.</p>
    <div class="fab-row" style="justify-content:flex-end;">
      <button class="btn-sm gold" id="exportCsvBtn">${ICON.download}Excel</button>
      <button class="btn-sm ghost" id="printReportBtn">${ICON.list}Print / PDF</button>
    </div>
    <div class="search">
      ${ICON.search}<input id="ledgerSearch" placeholder="Search student or checkpoint…" value="${escapeHtml(state.search)}"/>
      <select id="ledgerFilter">
        <option value="all" ${state.statusFilter==='all'?'selected':''}>All</option>
        <option value="awaiting_approval" ${state.statusFilter==='awaiting_approval'?'selected':''}>Awaiting Approval</option>
        <option value="pending" ${state.statusFilter==='pending'?'selected':''}>Pending</option>
        <option value="resolve_requested" ${state.statusFilter==='resolve_requested'?'selected':''}>Resolve Requested</option>
        <option value="resolve_forwarded" ${state.statusFilter==='resolve_forwarded'?'selected':''}>Awaiting VP Approval</option>
        <option value="resolved" ${state.statusFilter==='resolved'?'selected':''}>Resolved</option>
      </select>
    </div>
    <div class="card">
      ${rows.length===0? emptyState('No records match','Try a different search or filter.', ICON.search) :
        rows.map(v=>`
          <div class="list-item">
            ${avatarHTML({name:v.studentName, photo:v.studentPhoto})}
            <div class="li-main">
              <b>${escapeHtml(v.studentName)}</b>
              <span>${escapeHtml(v.catTitle)} · ${formatDateTime(v.date, v.time)} · ${escapeHtml(getViolationSanction(v))}</span>
              <span style="display:block;color:var(--ink-soft);">Reported by ${escapeHtml(v.reportedBy)}${v.source==='inspection'?' · <span class="insp-tag">Inspection</span>':''}${v.note?` · <span style="font-style:italic;">${escapeHtml(v.note)}</span>`:''}</span>
              ${violationWorkflowNoteHTML(v)}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
              ${statusChipHTML(v)}
              <div style="display:flex;gap:6px;">${violationActionsHTML(v)}</div>
            </div>
          </div>
        `).join('')
      }
    </div>
  `;
}
export function attachLedgerEvents(){
  const exportBtn = document.getElementById('exportCsvBtn');
  if(exportBtn) exportBtn.onclick = exportLedgerCSV;
  const printBtn = document.getElementById('printReportBtn');
  if(printBtn) printBtn.onclick = printLedgerReport;
  const search = document.getElementById('ledgerSearch');
  if(search) search.oninput = ()=>{ state.search = search.value; render(); const el=document.getElementById('ledgerSearch'); el.focus(); el.selectionStart=el.value.length; };
  const filt = document.getElementById('ledgerFilter');
  if(filt) filt.onchange = ()=>{ state.statusFilter = filt.value; render(); };
  attachViolationWorkflowEvents();
  document.querySelectorAll('[data-del-violation]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Delete this violation record?')) return;
      await mutateShared('ledger', latest=>latest.filter(v=>v.id!==b.dataset.delViolation));
      showToast('Record deleted');
      render();
    };
  });
}
/* Shared by the Ledger tab and the Secretary/Vice Mayor dashboard queues */
export function attachViolationWorkflowEvents(){
  // Each handler re-fetches the ledger right before writing (via
  // mutateShared) and finds the record in THAT copy, not the possibly-stale
  // local `state.ledger` — otherwise two officers acting on the same or
  // different records within a few seconds of each other could stomp on
  // one another's changes. If the record's already gone (someone else
  // handled it first), we just no-op with a toast instead of erroring.
  document.querySelectorAll('[data-approve-violation]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.approveViolation;
      let found = true;
      await mutateShared('ledger', latest=>{
        const rec = latest.find(v=>v.id===id);
        if(!rec){ found=false; return latest; }
        rec.status = 'pending';
        rec.approvedBy = state.session.name;
        return latest;
      });
      showToast(found ? 'Violation approved' : 'That record was already handled elsewhere');
      render();
    };
  });
  document.querySelectorAll('[data-decline-violation]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Decline and remove this submitted violation?')) return;
      await mutateShared('ledger', latest=>latest.filter(v=>v.id!==b.dataset.declineViolation));
      showToast('Violation declined');
      render();
    };
  });
  document.querySelectorAll('[data-request-resolve]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.requestResolve;
      let found = true;
      await mutateShared('ledger', latest=>{
        const rec = latest.find(v=>v.id===id);
        if(!rec){ found=false; return latest; }
        rec.status = 'resolve_requested';
        rec.resolveRequestedBy = state.session.name;
        return latest;
      });
      showToast(found ? 'Resolve request sent to the Secretary' : 'That record was already handled elsewhere');
      render();
    };
  });
  document.querySelectorAll('[data-forward-resolve]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.forwardResolve;
      let found = true;
      await mutateShared('ledger', latest=>{
        const rec = latest.find(v=>v.id===id);
        if(!rec){ found=false; return latest; }
        rec.status = 'resolve_forwarded';
        rec.forwardedBy = state.session.name;
        return latest;
      });
      showToast(found ? 'Forwarded to the Vice Mayor' : 'That record was already handled elsewhere');
      render();
    };
  });
  document.querySelectorAll('[data-decline-resolve]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.declineResolve;
      let found = true;
      await mutateShared('ledger', latest=>{
        const rec = latest.find(v=>v.id===id);
        if(!rec){ found=false; return latest; }
        rec.status = 'pending';
        delete rec.resolveRequestedBy;
        return latest;
      });
      showToast(found ? 'Resolve request declined' : 'That record was already handled elsewhere');
      render();
    };
  });
  document.querySelectorAll('[data-approve-resolve]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.approveResolve;
      let found = true;
      await mutateShared('ledger', latest=>{
        const rec = latest.find(v=>v.id===id);
        if(!rec){ found=false; return latest; }
        rec.status = 'resolved';
        rec.resolvedBy = state.session.name;
        return latest;
      });
      showToast(found ? 'Resolution approved' : 'That record was already handled elsewhere');
      render();
    };
  });
  document.querySelectorAll('[data-decline-resolve-vp]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.declineResolveVp;
      let found = true;
      await mutateShared('ledger', latest=>{
        const rec = latest.find(v=>v.id===id);
        if(!rec){ found=false; return latest; }
        rec.status = 'pending';
        delete rec.resolveRequestedBy; delete rec.forwardedBy;
        return latest;
      });
      showToast(found ? 'Resolution declined — sent back to pending' : 'That record was already handled elsewhere');
      render();
    };
  });
}

/* ============== ACCOUNTS (Mayor only) ============== */

/* ===================== accounts ===================== */
export function accountsHTML(){
  return `
    <h2 class="section-title">${ICON.key}Accounts</h2>
    <p class="subtext">Everyone who can sign in to ALPHA WATCH.</p>
    <div class="fab-row" style="justify-content:flex-end;"><button class="btn-sm gold" id="addAccountBtn">${ICON.plus}Add Account</button></div>
    <div class="card">
      ${state.accounts.length===0? emptyState('No accounts', 'Something went wrong — add an account to continue.', ICON.key) :
        state.accounts.map(a=>`
          <div class="list-item">
            <div class="avatar">${initials(a.name)}</div>
            <div class="li-main"><b>${escapeHtml(a.name)}${a.id===state.session.accountId?' (you)':''}</b><span>@${escapeHtml(a.username)} · ${roleLabel(a.role)}</span></div>
            <button class="btn-sm ghost" data-reset-pass="${a.id}" style="padding:6px 8px;" title="Reset password">${ICON.key}</button>
            ${a.id!==state.session.accountId?`<button class="btn-sm danger" data-del-account="${a.id}" style="padding:6px 8px;">${ICON.trash}</button>`:''}
          </div>
        `).join('')
      }
    </div>
  `;
}
export function attachAccountsEvents(){
  const addBtn = document.getElementById('addAccountBtn');
  if(addBtn) addBtn.onclick = ()=>{ state.modal={type:'account', data:{name:'',username:'',role:'secretary'}}; render(); };
  document.querySelectorAll('[data-reset-pass]').forEach(b=>{
    b.onclick = ()=>{
      const a = state.accounts.find(x=>x.id===b.dataset.resetPass);
      state.modal={type:'resetpass', data:{id:a.id, name:a.name, username:a.username}};
      render();
    };
  });
  document.querySelectorAll('[data-del-account]').forEach(b=>{
    b.onclick = async ()=>{
      const target = state.accounts.find(a=>a.id===b.dataset.delAccount);
      if(!confirm(`Remove the account for "${target.name}"?`)) return;
      let blocked = false;
      await mutateShared('accounts', latest=>{
        const mayorCount = latest.filter(a=>a.role==='mayor').length;
        if(target.role==='mayor' && mayorCount<=1){ blocked=true; return latest; }
        return latest.filter(a=>a.id!==target.id);
      });
      if(blocked){ showToast("Can't remove the only Mayor account"); return; }
      showToast('Account removed');
      render();
    };
  });
}

/* ============== MODALS ============== */

/* ===================== modal ===================== */
export function renderModal(){
  const back = document.createElement('div');
  back.className='modal-back';
  back.id='modalBack';
  let inner='';
  if(state.modal.type==='student'){
    const d = state.modal.data;
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">${d.id?'Edit Student':'Add Student'}</h2>
      <div class="field">
        <label>Photo</label>
        <div class="photo-picker">
          <div class="photo-preview" id="m_photo_preview">${d.photo?`<img src="${d.photo}" alt=""/>`:escapeHtml(initials(d.name||''))}</div>
          <div class="photo-actions">
            <input type="file" id="m_photo_input" accept="image/*" style="display:none;"/>
            <button type="button" class="btn-sm ghost" id="m_photo_btn">${ICON.camera}Add Photo</button>
            ${d.photo?`<button type="button" class="btn-sm danger" id="m_photo_remove">${ICON.trash}Remove Photo</button>`:''}
          </div>
        </div>
        <p class="photo-hint">Optional — helps spot students quickly in the roster and ledger.</p>
      </div>
      <div class="field"><label>Full Name</label><input id="m_name" value="${escapeHtml(d.name||'')}" placeholder="e.g. Juan Dela Cruz"/></div>
      <div class="field"><label>Section (optional)</label><input id="m_section" value="${escapeHtml(d.section||'')}" placeholder="e.g. Mayor Stewardship"/></div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Save</button>
      </div>`;
  } else if(state.modal.type==='standard'){
    const d = state.modal.data;
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">${d.id?'Edit Checkpoint':'Add Checkpoint'}</h2>
      <div class="field"><label>Title</label><input id="m_title" value="${escapeHtml(d.title||'')}" placeholder="e.g. T-Shirt"/></div>
      <div class="field"><label>Local Name (optional)</label><input id="m_local" value="${escapeHtml(d.local||'')}" placeholder="e.g. Buhok"/></div>
      <div class="field"><label>Rule</label><textarea id="m_rule" placeholder="Describe the requirement">${escapeHtml(d.rule||'')}</textarea></div>
      <p class="subtext" style="margin-top:-4px;">Sanctions are handled automatically by the class's progressive discipline policy — 1st offense is a verbal warning, every offense after that is a ₱${REPEAT_OFFENSE_FINE} fine, counted across all checkpoints.</p>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Save</button>
      </div>`;
  } else if(state.modal.type==='studentHistory'){
    const d = state.modal.data;
    const student = state.roster.find(s=>s.id===d.studentId);
    const timeline = getStudentOffenseTimeline(d.studentId).slice().reverse();
    const approvedCount = timeline.filter(v=>v.offenseNumber).length;
    const nextLabel = offenseSanctionLabel(approvedCount+1);
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
        ${avatarHTML(student||{name:'?'}, 'width:48px;height:48px;font-size:17px;flex-shrink:0;')}
        <div style="min-width:0;">
          <h2 class="section-title" style="margin:0;font-size:18px;">${escapeHtml(student?student.name:'Unknown student')}</h2>
          <span class="subtext" style="margin:0;">${escapeHtml((student&&student.section)||'—')}</span>
        </div>
      </div>
      <div class="card" style="margin:14px 0;padding:12px 14px;background:var(--cream);">
        <p class="subtext" style="margin:0;">
          <b style="color:var(--ink);">${approvedCount}</b> approved offense${approvedCount===1?'':'s'} on record.
          Next offense would be: <b style="color:var(--gold-dim);">${escapeHtml(nextLabel)}</b>
        </p>
      </div>
      <h3 style="font-size:13px;color:var(--navy-950);margin:0 0 8px;">Violation History</h3>
      ${timeline.length===0? emptyState('No violations on record','This student has a clean record so far.', ICON.check) :
        `<div class="history-list">
        ${timeline.map(v=>{
          const cat = state.standard.find(c=>c.id===v.categoryId);
          const isFineable = v.offenseNumber && v.offenseNumber>=2;
          return `<div class="history-item">
            <div class="history-top">
              ${statusChipHTML(v)}
              <span class="history-date">${formatDateTime(v.date, v.time)}</span>
            </div>
            <b class="history-check">${escapeHtml(cat?cat.title:'Unknown checkpoint')}</b>
            <span class="history-sanction">${escapeHtml(offenseSanctionLabel(v.offenseNumber, v.waived))}</span>
            ${v.note?`<span class="history-note">Note: ${escapeHtml(v.note)}</span>`:''}
            <div class="history-chain">
              <span>Inspected by ${escapeHtml(v.reportedBy||'—')}</span>
              ${v.approvedBy?`<span>Approved by ${escapeHtml(v.approvedBy)}</span>`:''}
              ${v.forwardedBy?`<span>Forwarded by ${escapeHtml(v.forwardedBy)}</span>`:''}
              ${v.resolvedBy?`<span>Resolved by ${escapeHtml(v.resolvedBy)}</span>`:''}
            </div>
            ${isFineable && state.session.role==='mayor'?`
            <div style="margin-top:8px;">
              <button class="btn-sm ${v.waived?'ghost':'danger'}" data-toggle-waive="${v.id}">${v.waived?ICON.check+'Un-waive Fine':ICON.cash+'Waive Fine'}</button>
            </div>`:''}
          </div>`;
        }).join('')}
        </div>`
      }
      <div class="modal-actions">
        <button class="btn-primary" id="modalSave" style="flex:1;justify-content:center;">Close</button>
      </div>`;
  } else if(state.modal.type==='finesBreakdown'){
    const isMayorHere = state.session.role==='mayor';
    const withFines = state.roster
      .map(s=>({student:s, fine:getStudentTotalFines(s.id), timeline: getStudentOffenseTimeline(s.id).filter(v=>v.offenseNumber && v.offenseNumber>=2)}))
      .filter(r=>r.fine>0 || (isMayorHere && r.timeline.some(v=>v.waived)))
      .sort((a,b)=> b.fine-a.fine || a.student.name.localeCompare(b.student.name));
    const classFines = getClassTotalFines();
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">${ICON.cash}Total Violation Fines</h2>
      <p class="subtext" style="margin-top:-4px;">₱${REPEAT_OFFENSE_FINE} per approved offense from the 2nd onward, resolved or not.</p>
      <div class="card" style="margin:14px 0;padding:12px 14px;background:var(--cream);">
        <p class="subtext" style="margin:0;">Class total: <b style="color:var(--gold-dim);">${formatPeso(classFines)}</b> across <b style="color:var(--ink);">${withFines.filter(r=>r.fine>0).length}</b> student${withFines.filter(r=>r.fine>0).length===1?'':'s'}.</p>
      </div>
      ${withFines.length===0? emptyState('No fines yet','No student has an approved 2nd offense yet.', ICON.check) :
        `<div class="card">
        ${withFines.map(r=>`
          <details class="public-row">
            <summary>
              <div class="list-item" style="pointer-events:none;">
                ${avatarHTML(r.student)}
                <div class="li-main"><b>${escapeHtml(r.student.name)}</b><span>${escapeHtml(r.student.section||'—')}</span></div>
                <span class="status-chip" style="background:#fdf1de;color:#c98f16;">${ICON.cash}${formatPeso(r.fine)}</span>
              </div>
            </summary>
            <div class="public-detail">
              ${r.timeline.map(v=>{
                const cat = state.standard.find(c=>c.id===v.categoryId);
                return `<div class="public-detail-row">
                  <div class="pd-top">
                    <span class="pd-check">${escapeHtml(cat?cat.title:'Unknown checkpoint')}</span>
                    <span class="pd-date">${formatDateTime(v.date, v.time)}</span>
                  </div>
                  <span class="pd-sanction">${escapeHtml(offenseSanctionLabel(v.offenseNumber, v.waived))}</span>
                  ${isMayorHere?`<div style="margin-top:6px;"><button class="btn-sm ${v.waived?'ghost':'danger'}" data-toggle-waive="${v.id}">${v.waived?ICON.check+'Un-waive Fine':ICON.cash+'Waive Fine'}</button></div>`:''}
                </div>`;
              }).join('')}
            </div>
          </details>
        `).join('')}
        </div>`
      }
      <div class="modal-actions">
        <button class="btn-primary" id="modalSave" style="flex:1;justify-content:center;">Close</button>
      </div>`;
  } else if(state.modal.type==='account'){
    const d = state.modal.data;
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">Add Account</h2>
      <div class="field"><label>Full Name</label><input id="m_acc_name" value="${escapeHtml(d.name||'')}" placeholder="e.g. Maria Santos"/></div>
      <div class="field"><label>Username</label><input id="m_acc_username" value="${escapeHtml(d.username||'')}" placeholder="e.g. maria.santos" autocapitalize="off"/></div>
      <div class="field"><label>Starting Password</label><input type="password" id="m_acc_password" placeholder="At least 4 characters"/></div>
      <div class="field"><label>Role</label>
        <select id="m_acc_role">
          <option value="secretary" ${d.role==='secretary'?'selected':''}>Secretary</option>
          <option value="marshall" ${d.role==='marshall'?'selected':''}>Marshall</option>
          <option value="vice_mayor" ${d.role==='vice_mayor'?'selected':''}>Vice Mayor</option>
          <option value="sails" ${d.role==='sails'?'selected':''}>SAILS Officer</option>
          <option value="mayor" ${d.role==='mayor'?'selected':''}>Mayor</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Create Account</button>
      </div>`;
  } else if(state.modal.type==='inspect'){
    const d = state.modal.data;
    const failCount = d.checklist.filter(c=>c.status==='fail').length;
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">${ICON.checklist}Inspection</h2>
      <p class="subtext" style="margin-bottom:14px;">${escapeHtml(d.studentName)} — mark each checkpoint, then send your report to the Secretary.</p>
      ${d.checklist.length===0?
        `<div class="empty"><div class="empty-icon-wrap">${ICON.clipboard}</div><b>No checkpoints yet</b><span>Ask the Mayor to add checkpoints under The Standard.</span></div>`
        : `<div class="inspect-list">
        ${d.checklist.map((c,i)=>`
          <div class="inspect-item ${c.status}">
            <div class="inspect-item-top">
              <div class="inspect-num">${String(i+1).padStart(2,'0')}</div>
              <div style="flex:1;"><b>${escapeHtml(c.title)}</b></div>
              <div class="toggle-pair">
                <button type="button" class="toggle-btn pass ${c.status==='pass'?'on':''}" data-toggle-check="${i}" data-val="pass">${ICON.check}Pass</button>
                <button type="button" class="toggle-btn fail ${c.status==='fail'?'on':''}" data-toggle-check="${i}" data-val="fail">✕ Fail</button>
              </div>
            </div>
            ${c.status==='fail'?`<div class="field" style="margin:10px 0 0;"><label>Note (optional)</label><input type="text" data-note-check="${i}" value="${escapeHtml(c.note||'')}" placeholder="e.g. missing ID lace"/></div>`:''}
          </div>
        `).join('')}
        </div>`
      }
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">${ICON.send}${failCount>0?`Send Report (${failCount})`:'Send Report'}</button>
      </div>`;
  } else if(state.modal.type==='resetpass'){
    const d = state.modal.data;
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">Reset Password</h2>
      <p class="subtext">Set a new password for ${escapeHtml(d.name)} (@${escapeHtml(d.username)}).</p>
      <div class="field"><label>New Password</label><input type="password" id="m_reset_password" placeholder="At least 4 characters"/></div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Save New Password</button>
      </div>`;
  } else if(state.modal.type==='selfpass'){
    inner = `
      <button class="close-x" id="modalClose">✕</button>
      <h2 class="section-title">Change Password</h2>
      <div class="field"><label>Current Password</label><input type="password" id="m_cur_password"/></div>
      <div class="field"><label>New Password</label><input type="password" id="m_new_password" placeholder="At least 4 characters"/></div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Update Password</button>
      </div>`;
  }
  back.innerHTML = `<div class="modal">${inner}</div>`;
  document.getElementById('root').appendChild(back);
  document.getElementById('modalClose').onclick = closeModal;
  const modalCancelBtn = document.getElementById('modalCancel');
  if(modalCancelBtn) modalCancelBtn.onclick = closeModal;
  back.onclick = (e)=>{ if(e.target===back) closeModal(); };
  document.getElementById('modalSave').onclick = saveModal;

  if(state.modal.type==='student'){
    const photoInput = document.getElementById('m_photo_input');
    const photoBtn = document.getElementById('m_photo_btn');
    const photoRemove = document.getElementById('m_photo_remove');
    const nameInput = document.getElementById('m_name');
    if(photoBtn) photoBtn.onclick = ()=> photoInput.click();
    if(photoInput) photoInput.onchange = async ()=>{
      const file = photoInput.files[0];
      if(!file) return;
      try{
        const dataUrl = await resizeImageFile(file, 240);
        state.modal.data.photo = dataUrl;
        render();
      }catch(err){ showToast('Could not load that image'); }
    };
    if(photoRemove) photoRemove.onclick = ()=>{
      delete state.modal.data.photo;
      render();
    };
    if(nameInput) nameInput.oninput = ()=>{
      if(!state.modal.data.photo){
        const preview = document.getElementById('m_photo_preview');
        if(preview) preview.textContent = initials(nameInput.value);
      }
    };
  } else if(state.modal.type==='inspect'){
    document.querySelectorAll('[data-toggle-check]').forEach(btn=>{
      btn.onclick = ()=>{
        const i = parseInt(btn.dataset.toggleCheck, 10);
        state.modal.data.checklist[i].status = btn.dataset.val;
        render();
      };
    });
    document.querySelectorAll('[data-note-check]').forEach(inp=>{
      inp.oninput = ()=>{
        const i = parseInt(inp.dataset.noteCheck, 10);
        state.modal.data.checklist[i].note = inp.value;
      };
    });
  } else if(state.modal.type==='finesBreakdown' || state.modal.type==='studentHistory'){
    document.querySelectorAll('[data-toggle-waive]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.toggleWaive;
        let found = true;
        await mutateShared('ledger', latest=>{
          const rec = latest.find(v=>v.id===id);
          if(!rec){ found=false; return latest; }
          rec.waived = !rec.waived;
          return latest;
        });
        showToast(found ? 'Fine updated' : 'That violation was removed elsewhere');
        render();
      };
    });
  }
}
export function closeModal(){ state.modal=null; render(); }
export async function saveModal(){
  const type = state.modal.type;
  const d = state.modal.data;
  if(type==='studentHistory' || type==='finesBreakdown'){
    state.modal = null;
    render();
    return;
  }
  if(type==='inspect'){
    await sendInspectionReport(d);
    return;
  }
  if(type==='student'){
    const name = document.getElementById('m_name').value.trim();
    if(!name){ showToast('Name is required'); return; }
    const section = document.getElementById('m_section').value.trim();
    const photo = d.photo || null;
    let missing = false;
    await mutateShared('roster', latest=>{
      if(d.id){
        const s = latest.find(x=>x.id===d.id);
        if(!s){ missing=true; return latest; }
        s.name=name; s.photo=photo; s.section=section;
      } else {
        latest.push({id:'st_'+Date.now(), name, photo, section});
      }
      return latest;
    });
    if(missing){ showToast('That student was removed elsewhere — nothing saved'); state.modal=null; render(); return; }
    showToast('Student saved');
  } else if(type==='standard'){
    const title = document.getElementById('m_title').value.trim();
    const local = document.getElementById('m_local').value.trim();
    const rule = document.getElementById('m_rule').value.trim();
    if(!title){ showToast('Title is required'); return; }
    let missing = false;
    await mutateShared('standard', latest=>{
      if(d.id){
        const c = latest.find(x=>x.id===d.id);
        if(!c){ missing=true; return latest; }
        c.title=title; c.local=local; c.rule=rule;
      } else {
        latest.push({id:'std_'+Date.now(), title, local, rule});
      }
      return latest;
    });
    if(missing){ showToast('That checkpoint was removed elsewhere — nothing saved'); state.modal=null; render(); return; }
    showToast('Checkpoint saved');
  } else if(type==='account'){
    const name = document.getElementById('m_acc_name').value.trim();
    const username = document.getElementById('m_acc_username').value.trim();
    const password = document.getElementById('m_acc_password').value;
    const role = document.getElementById('m_acc_role').value;
    if(!name || !username || !password){ showToast('Please fill in every field'); return; }
    if(password.length<4){ showToast('Password must be at least 4 characters'); return; }
    const passwordHash = await hashPassword(username, password);
    let taken = false;
    // Re-fetch the latest accounts right before writing, so a concurrent
    // Add/Reset from another device isn't silently overwritten.
    await mutateShared('accounts', latest=>{
      if(latest.some(a=>a.username.toLowerCase()===username.toLowerCase())){ taken=true; return latest; }
      latest.push({id:'acc_'+Date.now(), name, username, role, passwordHash});
      return latest;
    });
    if(taken){ showToast('That username is already taken'); return; }
    showToast('Account created');
  } else if(type==='resetpass'){
    const password = document.getElementById('m_reset_password').value;
    if(!password || password.length<4){ showToast('Password must be at least 4 characters'); return; }
    let notFound = false;
    await mutateShared('accounts', async latest=>{
      const acc = latest.find(a=>a.id===d.id);
      if(!acc){ notFound=true; return latest; }
      acc.passwordHash = await hashPassword(acc.username, password);
      return latest;
    });
    if(notFound){ showToast('Account not found — it may have been removed elsewhere'); return; }
    showToast('Password reset');
  } else if(type==='selfpass'){
    const cur = document.getElementById('m_cur_password').value;
    const next = document.getElementById('m_new_password').value;
    let result = 'ok';
    await mutateShared('accounts', async latest=>{
      const acc = latest.find(a=>a.id===state.session.accountId);
      if(!acc){ result='notfound'; return latest; }
      const curHash = await hashPassword(acc.username, cur);
      if(curHash!==acc.passwordHash){ result='wrongpass'; return latest; }
      if(!next || next.length<4){ result='tooshort'; return latest; }
      acc.passwordHash = await hashPassword(acc.username, next);
      return latest;
    });
    if(result==='notfound'){ showToast('Account not found'); return; }
    if(result==='wrongpass'){ showToast('Current password is incorrect'); return; }
    if(result==='tooshort'){ showToast('New password must be at least 4 characters'); return; }
    showToast('Password updated');
  }
  state.modal=null;
  render();
}
export async function sendInspectionReport(d){
  const fails = d.checklist.filter(c=>c.status==='fail');
  if(fails.length===0){
    showToast('No violations found — nothing to report');
    state.modal=null;
    render();
    return;
  }
  const today = new Date().toISOString().slice(0,10);
  const nowTime = nowTimeHHMM();
  const newRecs = fails.map((c,i)=>({
    id: 'v_'+Date.now()+'_'+i,
    studentId: d.studentId,
    categoryId: c.checkpointId,
    date: today,
    time: nowTime,
    note: c.note || '',
    reportedBy: state.session.name,
    status: 'awaiting_approval',
    source: 'inspection',
  }));
  await mutateShared('ledger', latest=>{ latest.push(...newRecs); return latest; });
  showToast(`Report sent to the Secretary for approval — ${fails.length} violation${fails.length>1?'s':''} submitted`);
  state.modal=null;
  render();
}

/* ============== Utils ============== */
