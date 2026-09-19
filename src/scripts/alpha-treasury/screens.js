/* Alpha Treasury — screens.js
   All render*HTML() and attach*Events() functions: setup/gate, public dashboard,
   nav shell, role dashboards, log, ledger, liquidation report, accounts, modal.
   Mechanically split out of the original single-file alpha-treasury.html — logic
   is unchanged, only wrapped in ES module imports/exports. */
import { ICONS as ICON } from '../shared/icons.js?v=1';
import {
  state, loginLockout,
  approvedOf, totalCollections, totalExpenses, currentBalance, pendingCount, unverifiedApprovedCount,
  getStudentDuesPaid, getStudentOtherContributions, getStudentDuesStatus, getStudentPeriodHistory,
  getExpenseGroups, groupExpensesByPurpose, groupCollectionsByCategory, GENERAL_PURPOSE_LABEL, purposeLabelOf,
  buildPeriodPreview, buildClosedPeriodRecord, allTransactionsForDisplay, allCollectionsForDisplay,
} from './state.js?v=4';
import {
  COLLECTION_CATEGORIES, EXPENSE_CATEGORIES, ROLES, roleLabel,
  escapeHtml, todayISO, nowTimeHHMM, formatDate, formatTime, formatDateTime, formatPeso,
  initials, avatarHTML, resizeImageFile,
} from './constants.js?v=3';
import { saveShared, mutateShared, IS_EMBEDDED, deleteQrCollection, fetchQrCollections, retrySync, fetchOfficerRoles, officerSignIn, officerSignUp, officerSignOut, sb } from './sync.js?v=9';
import { render, showToast } from './router.js?v=4';

/* ===================== auth (Supabase Auth + officer_roles) ===================== */
export function gateHTML(){
  return `
  <div class="gate">
    <div class="gate-card">
      <div class="logo-chip" style="margin:0 auto 14px;">${ICON.chest}</div>
      <h1>ALPHA TREASURY</h1>
      <p class="tag">BSMT 1-Alpha &middot; Batch 28</p>

      <div id="signInPane">
        <h2>Officer Sign In</h2>
        ${state._loginError ? `<p style="color:var(--danger);font-size:12px;margin:0 0 12px;font-weight:700;">${escapeHtml(state._loginError)}</p>` : ''}
        <div class="field"><label>Email</label><input id="si_email" type="email" autocomplete="username"/></div>
        <div class="field"><label>Password</label><input id="si_password" type="password" autocomplete="current-password"/></div>
        <button class="btn-primary" id="loginBtn" style="width:100%;justify-content:center;">Sign In</button>
        <p class="gate-note" style="text-align:center;margin-top:14px;">First time? <a href="#" id="showSignup">Create your officer account</a></p>
      </div>

      <div id="signUpPane" style="display:none;">
        <h2>Create Your Account</h2>
        <p class="gate-note">This does not grant access by itself — the Mayor still assigns your officer role afterward. Tell them once you've signed up.</p>
        ${state._setupError ? `<p style="color:var(--danger);font-size:12px;margin:0 0 12px;font-weight:700;">${escapeHtml(state._setupError)}</p>` : ''}
        <div class="field"><label>Full Name</label><input id="su_name" type="text" placeholder="As registered with the class"/></div>
        <div class="field"><label>Email</label><input id="su_email" type="email" autocomplete="username"/></div>
        <div class="field"><label>Create Password</label><input id="su_password" type="password" placeholder="At least 8 characters"/></div>
        <button class="btn-primary" id="signupBtn" style="width:100%;justify-content:center;">Create Account</button>
        <p class="gate-note" style="text-align:center;margin-top:14px;"><a href="#" id="showSignin">Back to sign in</a></p>
      </div>

      <button class="btn-sm ghost" id="publicLinkBtn" style="width:100%;justify-content:center;margin-top:10px;">${ICON.users}View Public Dashboard</button>
    </div>
  </div>`;
}
export function pendingHTML(){
  return `
  <div class="gate">
    <div class="gate-card" style="text-align:center;">
      <div class="logo-chip" style="margin:0 auto 14px;">${ICON.clock}</div>
      <h1>ALPHA TREASURY</h1>
      <h2>Waiting for Access</h2>
      <p class="gate-note">Your account is created, but the Mayor hasn't assigned you an officer role yet. Let them know you've signed up — once they grant access from the Accounts tab, just reload this page.</p>
      <button class="btn-sm ghost" id="pendingSignOutBtn" style="width:100%;justify-content:center;margin-top:14px;">Sign Out</button>
    </div>
  </div>`;
}
export function attachGateEvents(){
  const publicBtn = document.getElementById('publicLinkBtn');
  if(publicBtn) publicBtn.onclick = ()=>{ location.hash='public'; state.screen='public'; render(); };

  const signInPane = document.getElementById('signInPane');
  const signUpPane = document.getElementById('signUpPane');
  const showSignup = document.getElementById('showSignup');
  const showSignin = document.getElementById('showSignin');
  if(showSignup) showSignup.onclick = (e)=>{ e.preventDefault(); signInPane.style.display='none'; signUpPane.style.display='block'; };
  if(showSignin) showSignin.onclick = (e)=>{ e.preventDefault(); signUpPane.style.display='none'; signInPane.style.display='block'; };

  const loginBtn = document.getElementById('loginBtn');
  const submit = async ()=>{
    if(loginBtn.disabled) return;
    if(Date.now() < loginLockout.until){
      state._loginError = 'Too many attempts. Please wait a moment and try again.'; render(); return;
    }
    const email = document.getElementById('si_email').value.trim();
    const password = document.getElementById('si_password').value;
    if(!email || !password){ state._loginError='Enter your email and password.'; render(); return; }
    loginBtn.disabled = true;
    try{
      const user = await officerSignIn(email, password);
      state.officerRoles = await fetchOfficerRoles();
      const mine = state.officerRoles.find(r=>r.user_id===user.id);
      if(mine && mine.role && mine.role!=='pending'){
        const role = mine.role==='admin' ? 'mayor' : mine.role;
        state.session = { name: mine.full_name || user.email, role, username: mine.email || user.email, accountId: user.id, email: user.email };
        state._loginError = null;
        state.screen = 'app';
      } else {
        state.screen = 'pending';
      }
      loginLockout.attempts = 0;
    }catch(e){
      loginLockout.attempts++;
      if(loginLockout.attempts>=5){ loginLockout.until = Date.now()+30000; loginLockout.attempts=0; }
      state._loginError = e.message;
      loginBtn.disabled = false;
    }
    render();
  };
  if(loginBtn) loginBtn.onclick = submit;
  const siPassword = document.getElementById('si_password');
  if(siPassword) siPassword.onkeydown = (e)=>{ if(e.key==='Enter') submit(); };

  const signupBtn = document.getElementById('signupBtn');
  if(signupBtn) signupBtn.onclick = async ()=>{
    if(signupBtn.disabled) return;
    const fullName = document.getElementById('su_name').value.trim();
    const email = document.getElementById('su_email').value.trim();
    const password = document.getElementById('su_password').value;
    if(!fullName || !email || !password){ state._setupError='Fill in every field.'; render(); return; }
    if(password.length<8){ state._setupError='Password must be at least 8 characters.'; render(); return; }
    signupBtn.disabled = true;
    try{
      const { role } = await officerSignUp({ email, password, fullName });
      state.officerRoles = await fetchOfficerRoles();
      if(role==='mayor'){
        showToast('Account created — you are the first officer, so you are the Mayor.');
      } else {
        showToast('Account created — ask the Mayor to grant your role.');
      }
      state._setupError = null;
      document.getElementById('signUpPane').style.display='none';
      document.getElementById('signInPane').style.display='block';
    }catch(e){
      state._setupError = e.message;
      signupBtn.disabled = false;
    }
    render();
  };
}
export function attachPendingEvents(){
  const btn = document.getElementById('pendingSignOutBtn');
  if(btn) btn.onclick = doLogout;
}

/* ============== PUBLIC STUDENT DASHBOARD (no login required) ==============
   Three tabs: Overview (fund totals), Liquidation Report (expenses grouped by
   purpose with receipts + narrative), and Contributions (per-student dues
   status). Only APPROVED transactions are counted/shown — a submission still
   awaiting Mayor/VP approval isn't official yet. */

/* ===================== public ===================== */
export function publicHTML(){
  const tab = state.publicTab || 'overview';
  let body;
  if(tab==='liquidation') body = liquidationReportHTML(false);
  else if(tab==='contributions') body = publicContributionsHTML();
  else if(tab==='periods') body = periodsHTML(false);
  else body = publicOverviewHTML();

  return `
  <div class="public-wrap">
    <div class="public-header">
      <div class="logo-chip">${ICON.chest}</div>
      <h1>ALPHA TREASURY</h1>
      <div class="tag">Public Student Dashboard</div>
      <p class="subtext" style="text-align:center;margin-top:6px;">BSMT 1-Alpha · Batch 28 — class fund status, in the open.</p>
    </div>

    <div class="public-tabs">
      <button type="button" data-public-tab="overview" class="${tab==='overview'?'sel':''}">${ICON.chest}Overview</button>
      <button type="button" data-public-tab="liquidation" class="${tab==='liquidation'?'sel':''}">${ICON.checklist}Liquidation Report</button>
      <button type="button" data-public-tab="contributions" class="${tab==='contributions'?'sel':''}">${ICON.users}Contributions</button>
      <button type="button" data-public-tab="periods" class="${tab==='periods'?'sel':''}">${ICON.clipboard}Past Periods</button>
    </div>

    <div style="max-width:680px;margin:0 auto;">${body}</div>

    <div style="text-align:center;margin-top:20px;">
      <button class="btn-sm ghost" id="publicBackBtn">${ICON.key}Officer Sign In</button>
    </div>
  </div>`;
}
export function publicOverviewHTML(){
  const paidCount = state.roster.filter(s=>getStudentDuesStatus(s.id)==='paid').length;
  const recent = allTransactionsForDisplay().filter(t=>t.status==='approved').sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).slice(0,6);
  return `
    <div class="grid-stats" style="margin-bottom:12px;">
      <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalCollections())}</b><span>Collections</span></div>
      <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalExpenses())}</b><span>Expenses</span></div>
      <div class="stat"><div class="stat-icon">${ICON.chest}</div><b>${formatPeso(currentBalance())}</b><span>Balance</span></div>
      <div class="stat res"><div class="stat-icon">${ICON.check}</div><b>${paidCount}/${state.roster.length}</b><span>Dues Paid</span></div>
    </div>
    <p class="subtext" style="text-align:center;color:rgba(255,255,255,0.7);margin:0 auto 14px;">Class Dues target: <b style="color:var(--gold-light);">${formatPeso(state.duesAmount)}</b> per student. See exactly where every peso went in the <b style="color:var(--gold-light);">Liquidation Report</b> tab, or check your own dues under <b style="color:var(--gold-light);">Contributions</b>.</p>
    <h2 class="section-title" style="font-size:15px;color:#fff;">${ICON.list}Recent Activity</h2>
    <div class="card">
      ${recent.length===0? emptyState('No activity yet','Logged transactions will appear here.', ICON.list) : recent.map(txRowHTML).join('')}
    </div>
  `;
}
export function publicContributionsHTML(){
  const q = (state.search||'').toLowerCase();
  const rows = state.roster
    .filter(s=> !q || s.name.toLowerCase().includes(q) || (s.section||'').toLowerCase().includes(q))
    .map(s=>({
      ...s,
      paid: getStudentDuesPaid(s.id),
      other: getStudentOtherContributions(s.id),
      status: getStudentDuesStatus(s.id),
      entries: allCollectionsForDisplay().filter(t=>t.studentId===s.id),
    }))
    .sort((a,b)=> (a.status==='paid')-(b.status==='paid') || a.name.localeCompare(b.name));

  return `
    <h2 class="section-title" style="color:#fff;">${ICON.users}Student Contributions</h2>
    <p class="subtext" style="color:rgba(255,255,255,0.7);">Every student's dues status and contribution history, from approved entries only.</p>
    <div class="search" style="margin-bottom:14px;">
      ${ICON.search}<input id="publicSearch" placeholder="Search name or section…" value="${escapeHtml(state.search||'')}"/>
    </div>
    <div class="card">
      ${rows.length===0? emptyState('No students found','Try a different search.', ICON.users) :
        rows.map(s=>{
          const chipClass = s.status==='paid' ? 'resolved' : s.status==='partial' ? 'partial' : 'pending';
          const chipIcon = s.status==='paid' ? ICON.check : ICON.clock;
          const chipLabel = s.status==='paid' ? 'Dues Paid' : s.status==='partial' ? `${formatPeso(s.paid)} of ${formatPeso(state.duesAmount)}` : 'Dues Owing';
          return `
          <details class="public-row">
            <summary>
              <div class="list-item" style="pointer-events:none;">
                ${avatarHTML(s)}
                <div class="li-main">
                  <b>${escapeHtml(s.name)}</b>
                  <span>${escapeHtml(s.section||'—')}${s.other>0?` · ${formatPeso(s.other)} other contributions`:''}</span>
                </div>
                <span class="status-chip ${chipClass}">${chipIcon}${chipLabel}</span>
              </div>
            </summary>
            ${s.entries.length? `
              <div class="public-detail">
                ${s.entries.map(t=>`<div class="public-detail-row">
                    <div class="pd-top">
                      <span class="pd-check">${escapeHtml(t.category)}</span>
                      <span class="pd-date">${formatDateTime(t.date, t.time)}</span>
                    </div>
                    <span class="pd-sanction">${formatPeso(t.amount)}${t.note?` — ${escapeHtml(t.note)}`:''}</span>
                  </div>`).join('')}
                <button type="button" class="btn-sm ghost" data-student-history="${s.id}" style="margin-top:8px;">${ICON.clipboard}View Full History</button>
              </div>` : `
              <div class="public-detail">
                <button type="button" class="btn-sm ghost" data-student-history="${s.id}">${ICON.clipboard}View Full History</button>
              </div>`
            }
          </details>`;
        }).join('')
      }
    </div>
  `;
}
export function attachStudentHistoryButtons(){
  document.querySelectorAll('[data-student-history]').forEach(b=>{
    b.onclick = (e)=>{ e.preventDefault(); state.modal={type:'studenthistory', data:{studentId:b.dataset.studentHistory}}; render(); };
  });
}
export function attachPublicEvents(){
  document.querySelectorAll('[data-public-tab]').forEach(b=>{
    b.onclick = ()=>{ state.publicTab = b.dataset.publicTab; state.search=''; render(); };
  });
  const search = document.getElementById('publicSearch');
  if(search) search.oninput = ()=>{
    state.search = search.value; render();
    const el=document.getElementById('publicSearch');
    if(el){ el.focus(); el.selectionStart=el.value.length; }
  };
  if(state.publicTab==='liquidation') attachLiquidationEvents(false);
  if(state.publicTab==='periods') attachPeriodsEvents();
  if(state.publicTab==='contributions') attachStudentHistoryButtons();
  const back = document.getElementById('publicBackBtn');
  if(back) back.onclick = ()=>{
    state.search='';
    state.publicTab='overview';
    if(location.hash) history.replaceState(null,'',location.pathname+location.search);
    state.screen = state.session ? 'app' : 'gate';
    render();
  };
}

/* ============== APP SHELL ============== */

/* ===================== nav_app ===================== */
/* Visible sync status. Silent write failures cost hours of confusion once —
   this makes the app's own connection health legible at a glance, and gives
   a one-tap retry instead of guessing whether a save actually landed. */
export function syncChipHTML(){
  const h = state.syncHealth || {};
  let label, bg, border, color, title;
  if(h.saving){
    label = 'Saving…'; bg='rgba(240,180,41,0.18)'; border='rgba(240,180,41,0.5)'; color='#ffd868';
    title = 'Saving to the server…';
  } else if(h.lastErrorAt){
    label = 'Offline'; bg='rgba(194,59,59,0.22)'; border='rgba(194,59,59,0.6)'; color='#ffb3b3';
    title = `Last error: ${h.lastErrorMsg || 'unknown'}\nTap to retry.`;
  } else if(h.lastOkAt){
    label = 'Synced'; bg='rgba(35,122,79,0.2)'; border='rgba(35,122,79,0.55)'; color='#9fe3bd';
    title = `Last synced ${timeAgo(h.lastOkAt)}.\nTap to check now.`;
  } else {
    label = 'Idle'; bg='rgba(255,255,255,0.08)'; border='rgba(255,255,255,0.25)'; color='#d8d8ea';
    title = 'No save attempted yet this session.\nTap to check the connection.';
  }
  return `<button id="syncChip" title="${escapeHtml(title)}" style="background:${bg};border:1px solid ${border};color:${color};font-size:11px;font-weight:700;padding:5px 10px;border-radius:20px;cursor:pointer;white-space:nowrap;">${escapeHtml(label)}</button>`;
}
export function timeAgo(ts){
  const s = Math.max(0, Math.round((Date.now()-ts)/1000));
  if(s < 10) return 'just now';
  if(s < 60) return `${s}s ago`;
  const m = Math.round(s/60);
  if(m < 60) return `${m}m ago`;
  return `${Math.round(m/60)}h ago`;
}
export function attachSyncChip(){
  const chip = document.getElementById('syncChip');
  if(!chip) return;
  chip.onclick = async ()=>{
    if(chip.disabled) return;
    chip.disabled = true;
    const ok = await retrySync();
    showToast(ok ? 'Connection is working' : 'Still cannot reach the server');
    render();
  };
}
export function navBtn(id,label,icon){ return `<button data-tab="${id}" class="${state.tab===id?'active':''}">${icon}<span>${label}</span></button>`; }
export function navLinkExternal(href,label,icon){ return `<a href="${href}" target="_blank" rel="noopener">${icon}<span>${label}</span></a>`; }
export function navForRole(role){
  const tabs = [ navBtn('dashboard','Dashboard',ICON.home) ];
  if(role==='mayor' || role==='treasurer') tabs.push(navBtn('log','Log Entry',ICON.plus));
  tabs.push(navBtn('ledger','Ledger',ICON.list));
  tabs.push(navBtn('liquidation','Liquidation',ICON.checklist));
  tabs.push(navBtn('periods','Past Periods',ICON.clipboard));
  if(role==='mayor' || role==='treasurer') tabs.push(navLinkExternal('_qr-source/pages/officer-login.html','Treasury Office',ICON.checklist));
  if(role==='mayor') tabs.push(navBtn('accounts','Accounts',ICON.key));
  return tabs.join('');
}
export function appHTML(){
  const role = state.session.role;
  let body;
  if(state.tab==='dashboard') body = currentDashboardHTML();
  else if(state.tab==='log' && (role==='mayor'||role==='treasurer')) body = logHTML();
  else if(state.tab==='ledger') body = ledgerHTML();
  else if(state.tab==='liquidation') body = liquidationReportHTML(true);
  else if(state.tab==='periods') body = periodsHTML(true);
  else if(state.tab==='accounts' && role==='mayor') body = accountsHTML();
  else body = currentDashboardHTML();

  const topbar = `
    <div class="topbar">
      <div class="brand">
        <div class="logo-chip">${ICON.chest}</div>
        <div class="name"><b>ALPHA TREASURY</b><span>BSMT 1-Alpha</span></div>
      </div>
      <div class="who">
        <span class="chip">${escapeHtml(roleLabel(role))}</span>
        ${syncChipHTML()}
        ${IS_EMBEDDED ? '' : `<a href="alpha-watch.html" target="_blank" rel="noopener" title="Open Alpha Watch" style="background:none;border:1px solid rgba(255,255,255,0.25);color:#d8d8ea;font-size:11px;padding:5px 10px;border-radius:20px;text-decoration:none;">Watch</a>`}
        <button id="changePassBtn" title="Change password">${ICON.key}</button>
        <button id="logoutBtn">Sign Out</button>
      </div>
    </div>`;
  const topDesktop = `
    <div class="top-desktop">
      <div><h2 class="section-title" style="padding-bottom:2px;">${escapeHtml(roleLabel(role))} View</h2><span class="subtext" style="margin:0;">Signed in as ${escapeHtml(state.session.name)}</span></div>
      <div class="who">
        ${syncChipHTML()}
        ${IS_EMBEDDED ? '' : `<a href="alpha-watch.html" target="_blank" rel="noopener" class="btn-sm ghost" style="text-decoration:none;">${ICON.checklist}Alpha Watch</a>`}
        <button id="changePassBtnD" class="btn-sm ghost">${ICON.key}Change Password</button>
        <button id="logoutBtnD" class="btn-sm ghost">Sign Out</button>
      </div>
    </div>`;
  const navHTML = `
    <nav class="navbar">
      <div class="navbar-logo"><div class="logo-chip">${ICON.chest}</div><b>ALPHA<br/>TREASURY</b></div>
      ${navForRole(role)}
    </nav>`;

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
  document.querySelectorAll('.navbar button').forEach(b=>{ b.onclick = ()=>{ state.tab=b.dataset.tab; state.modal=null; render(); }; });
  const lo = document.getElementById('logoutBtn'); if(lo) lo.onclick = doLogout;
  const lod = document.getElementById('logoutBtnD'); if(lod) lod.onclick = doLogout;
  const cp = document.getElementById('changePassBtn'); if(cp) cp.onclick = ()=>{ state.modal={type:'selfpass', data:{}}; render(); };
  const cpd = document.getElementById('changePassBtnD'); if(cpd) cpd.onclick = ()=>{ state.modal={type:'selfpass', data:{}}; render(); };
  attachSyncChip();

  if(state.tab==='log') attachLogEvents();
  if(state.tab==='ledger') attachLedgerEvents();
  if(state.tab==='liquidation') attachLiquidationEvents(true);
  if(state.tab==='periods') attachPeriodsEvents();
  if(state.tab==='accounts' && state.session.role==='mayor') attachAccountsEvents();
  if(state.tab==='dashboard') attachDashboardEvents();
}
async function doLogout(){
  await officerSignOut();
  state.session=null; state.screen='gate'; state._loginError=null;
  render();
}

/* ============== SHARED: transaction row + approval queue card ============== */

/* ===================== dash ===================== */
export function txIconHTML(t){
  return `<div class="tx-icon ${t.type}">${t.type==='collection'?ICON.up:ICON.down}</div>`;
}
export function statusChipHTML(t){
  if(t.status==='pending') return `<span class="status-chip pending">${ICON.clock}Pending</span>`;
  if(t.status==='rejected') return `<span class="status-chip forwarded">${ICON.x}Rejected</span>`;
  return `<span class="status-chip resolved">${ICON.check}Approved</span>`;
}
export function txRowHTML(t){
  const sign = t.type==='collection' ? '+' : '−';
  const cls = t.type==='collection' ? 'pos' : 'neg';
  const who = t.payer ? ` · ${escapeHtml(t.payer)}` : '';
  const receiptLink = t.receipt ? ` · <a class="receipt-thumb-link" href="${t.receipt}" target="_blank" rel="noopener">${ICON.paperclip}Receipt</a>` : '';
  const qrBadge = t.source==='qr' ? ` <span class="status-chip resolved" style="font-size:9.5px;padding:2px 6px;">QR</span>` : '';
  return `<div class="list-item">
    ${txIconHTML(t)}
    <div class="li-main"><b>${escapeHtml(t.category)}${t.verified?' ✓':''}${qrBadge}</b><span>${formatDateTime(t.date,t.time)}${who} · by ${escapeHtml(t.recordedBy)}${receiptLink}</span></div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
      <span class="amt ${cls}">${sign}${formatPeso(t.amount)}</span>
      ${statusChipHTML(t)}
    </div>
  </div>`;
}
export function queueCardHTML(t, actionsHTML){
  const sign = t.type==='collection' ? '+' : '−';
  const cls = t.type==='collection' ? 'pos' : 'neg';
  return `
    <div class="queue-card">
      <div class="queue-top">
        ${txIconHTML(t)}
        <div style="flex:1;">
          <b style="font-size:13.5px;display:block;">${escapeHtml(t.category)}</b>
          <span style="font-size:11.5px;color:var(--ink-soft);">${formatDateTime(t.date,t.time)} · by ${escapeHtml(t.recordedBy)}${t.payer?` · ${escapeHtml(t.payer)}`:''}</span>
        </div>
        <span class="amt ${cls}" style="font-size:15px;">${sign}${formatPeso(t.amount)}</span>
      </div>
      ${t.note?`<p class="subtext" style="margin:0 0 6px;font-style:italic;">${escapeHtml(t.note)}</p>`:''}
      ${t.receipt?`<a class="receipt-thumb-link" href="${t.receipt}" target="_blank" rel="noopener" style="margin-bottom:8px;">${ICON.paperclip}View Attached Receipt</a>`:t.type==='expense'?`<p class="subtext" style="margin:0 0 8px;color:var(--danger);">No receipt attached</p>`:''}
      <div class="queue-actions">${actionsHTML}</div>
    </div>`;
}
export function attachApprovalQueueEvents(){
  document.querySelectorAll('[data-approve-tx]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.approveTx;
      let found = true;
      await mutateShared('treasury_transactions', latest=>{
        const rec = latest.find(t=>t.id===id);
        if(!rec){ found=false; return latest; }
        rec.status='approved'; rec.approvedBy=state.session.name;
        return latest;
      });
      showToast(found ? 'Transaction approved' : 'That record was already handled elsewhere');
      render();
    };
  });
  document.querySelectorAll('[data-reject-tx]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Reject this transaction? It will not count toward the fund balance.')) return;
      let found = true;
      await mutateShared('treasury_transactions', latest=>{
        const rec = latest.find(t=>t.id===id_(b));
        if(!rec){ found=false; return latest; }
        rec.status='rejected'; rec.approvedBy=state.session.name;
        return latest;
      });
      showToast(found ? 'Transaction rejected' : 'That record was already handled elsewhere');
      render();
    };
  });
  function id_(b){ return b.dataset.rejectTx; }
  document.querySelectorAll('[data-verify-tx]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.verifyTx;
      let found = true;
      await mutateShared('treasury_transactions', latest=>{
        const rec = latest.find(t=>t.id===id);
        if(!rec){ found=false; return latest; }
        rec.verified = !rec.verified;
        rec.verifiedBy = rec.verified ? state.session.name : null;
        return latest;
      });
      showToast(found ? 'Verification updated' : 'That record was removed elsewhere');
      render();
    };
  });
}
export function attachDashboardEvents(){
  attachApprovalQueueEvents();
  const closeBtn = document.getElementById('closePeriodBtn');
  if(closeBtn) closeBtn.onclick = ()=>{ state.modal={type:'closeperiod', data:{name:'', confirmText:''}}; render(); };
}

/* ============== DASHBOARDS ============== */
export function currentDashboardHTML(){
  const role = state.session.role;
  if(role==='mayor') return mayorDashboardHTML();
  if(role==='vice_mayor') return viceMayorDashboardHTML();
  if(role==='treasurer') return treasurerDashboardHTML();
  if(role==='auditor') return auditorDashboardHTML();
  // Any other officer_roles role (secretary, marshal, sails_officer) is a
  // real role in the wider Alpha Suite, just not one this app has a
  // dashboard for — showing Mayor's view here would be a real privilege
  // leak, so this is deliberately not a fallback-to-Mayor default.
  return `
    <h2 class="section-title">${ICON.chest}No Dashboard For Your Role</h2>
    <div class="card"><p class="subtext">Alpha Treasury doesn't have a dashboard for the <b>${escapeHtml(roleLabel(role))}</b> role. You can still browse the Ledger, Liquidation Report, and Past Periods from the tabs above.</p></div>
  `;
}
export function balanceHeroHTML(){
  const bal = currentBalance();
  const bb = state.beginningBalance;
  return `
    <div class="balance-hero">
      <div class="bh-label">Current Fund Balance</div>
      <div class="bh-amount">${formatPeso(bal)}</div>
      <div class="bh-row">
        <div>Collections<br/><b>${formatPeso(totalCollections())}</b></div>
        <div>Expenses<br/><b>${formatPeso(totalExpenses())}</b></div>
      </div>
      ${bb && bb.amount ? `<p class="subtext" style="margin:10px 0 0;text-align:center;opacity:0.85;">Includes ${formatPeso(bb.amount)} beginning balance carried from <b>${escapeHtml(bb.fromPeriodName||'the previous period')}</b></p>` : ''}
    </div>`;
}
export function recentActivityHTML(limit){
  const recent = allTransactionsForDisplay().slice().sort((a,b)=> (b.date+b.time).localeCompare(a.date+a.time)).slice(0, limit||6);
  return `
    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.list}Recent Activity</h2>
    <div class="card">
      ${recent.length===0? emptyState('No activity yet','Logged transactions will appear here.', ICON.list) :
        recent.map(txRowHTML).join('')
      }
    </div>`;
}
export function emptyState(title, sub, icon){
  return `<div class="empty"><div class="empty-icon-wrap">${icon}</div><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)}</span></div>`;
}
export function mayorDashboardHTML(){
  const pending = state.transactions.filter(t=>t.status==='pending').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return `
    <h2 class="section-title">${ICON.crown}Treasury Overview</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Here's how the class fund stands.</p>
    ${balanceHeroHTML()}
    <div class="grid-stats">
      <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalCollections())}</b><span>Total Collections</span></div>
      <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalExpenses())}</b><span>Total Expenses</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b>${pending.length}</b><span>Pending Approvals</span></div>
      <div class="stat"><div class="stat-icon">${ICON.list}</div><b>${allTransactionsForDisplay().length}</b><span>Total Entries</span></div>
    </div>
    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.clock}Awaiting Your Approval</h2>
    ${pending.length===0? emptyState('All caught up','No transactions are waiting on approval.', ICON.check) :
      pending.map(t=> queueCardHTML(t, `
        <button class="btn-sm gold" data-approve-tx="${t.id}">${ICON.check}Approve</button>
        <button class="btn-sm danger" data-reject-tx="${t.id}">${ICON.x}Reject</button>
      `)).join('')
    }
    <div class="card" style="margin:16px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="icon-box" style="width:40px;height:40px;flex-shrink:0;color:var(--gold);">${ICON.checklist}</div>
      <div style="flex:1;min-width:200px;">
        <b style="font-size:14px;display:block;">Close this collection period</b>
        <span style="font-size:12px;color:var(--ink-soft);">Archive all approved collections and expenses, record each student's totals, and start the next period fresh. Pending items carry forward untouched.</span>
      </div>
      <button class="btn-sm danger" id="closePeriodBtn">${ICON.checklist}Close Period</button>
    </div>
    ${recentActivityHTML()}
  `;
}
export function viceMayorDashboardHTML(){
  const pending = state.transactions.filter(t=>t.status==='pending').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return `
    <h2 class="section-title">${ICON.shield}Approval Desk</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Review what the Treasurer submits before it hits the ledger.</p>
    ${balanceHeroHTML()}
    <div class="grid-stats">
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b>${pending.length}</b><span>Pending Approvals</span></div>
      <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalCollections())}</b><span>Total Collections</span></div>
      <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalExpenses())}</b><span>Total Expenses</span></div>
    </div>
    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.clock}Transactions Awaiting Approval</h2>
    ${pending.length===0? emptyState('Nothing to review','No transactions are waiting on you.', ICON.check) :
      pending.map(t=> queueCardHTML(t, `
        <button class="btn-sm gold" data-approve-tx="${t.id}">${ICON.check}Approve</button>
        <button class="btn-sm danger" data-reject-tx="${t.id}">${ICON.x}Reject</button>
      `)).join('')
    }
    ${recentActivityHTML()}
  `;
}
export function treasurerDashboardHTML(){
  const mine = state.transactions.filter(t=>t.recordedBy===state.session.name);
  const myPending = mine.filter(t=>t.status==='pending').length;
  return `
    <h2 class="section-title">${ICON.cash}Treasurer's Desk</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Log every collection and expense the moment it happens.</p>
    ${balanceHeroHTML()}
    <div class="grid-stats">
      <div class="stat"><div class="stat-icon">${ICON.list}</div><b>${mine.length}</b><span>Your Entries</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b>${myPending}</b><span>Awaiting Approval</span></div>
    </div>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;">
      <div class="icon-box" style="width:40px;height:40px;flex-shrink:0;color:var(--gold);">${ICON.plus}</div>
      <div style="flex:1;">
        <b style="font-size:14px;display:block;">Log a collection or expense</b>
        <span style="font-size:12px;color:var(--ink-soft);">Dues, contributions, fundraising, supplies, event costs — whatever it is, log it here.</span>
      </div>
      <button class="btn-sm gold" data-goto-log>${ICON.plus}Log Entry</button>
    </div>
    ${recentActivityHTML()}
  `;
}
export function auditorDashboardHTML(){
  const unverified = state.transactions.filter(t=>t.status==='approved' && !t.verified).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return `
    <h2 class="section-title">${ICON.checklist}Audit View</h2>
    <p class="subtext">Welcome back, ${escapeHtml(state.session.name)}. Verify approved entries against receipts and collection sheets.</p>
    ${balanceHeroHTML()}
    <div class="grid-stats">
      <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalCollections())}</b><span>Total Collections</span></div>
      <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalExpenses())}</b><span>Total Expenses</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b>${unverified.length}</b><span>Unverified</span></div>
    </div>
    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.checklist}Approved Entries Awaiting Verification</h2>
    ${unverified.length===0? emptyState('All verified','Every approved entry has been checked off.', ICON.check) :
      unverified.map(t=> queueCardHTML(t, `
        <button class="btn-sm gold" data-verify-tx="${t.id}">${ICON.check}Mark Verified</button>
      `)).join('')
    }
    ${recentActivityHTML()}
  `;
}

/* ============== LOG ENTRY (Treasurer + Mayor) ============== */

/* ===================== log ===================== */
export function logHTML(){
  return `
    <h2 class="section-title">${ICON.plus}Log a Transaction</h2>
    <p class="subtext">Fill this out the moment money comes in or goes out.</p>
    <form class="card" id="logForm">
      <div class="type-pick">
        <button type="button" data-type="collection" class="sel" id="lf_type_collection">${ICON.up}Collection</button>
        <button type="button" data-type="expense" id="lf_type_expense">${ICON.down}Expense</button>
      </div>
      <input type="hidden" id="lf_type" value="collection"/>

      <div id="lf_qr_callout">
        <div class="card" style="background:var(--cream);border-style:dashed;">
          <b style="display:block;margin-bottom:6px;">Collections are now logged by scanning a student's QR code.</b>
          <p class="subtext" style="margin:0 0 12px;">Open Scan &amp; Collect, point the camera at the student's code, and confirm the amount there — it's verified and recorded automatically, no manual entry needed.</p>
          <a class="btn-primary" href="_qr-source/pages/treasurer-collect.html" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;">${ICON.checklist}Open Scan &amp; Collect</a>
          <p class="subtext" style="margin:12px 0 0;font-size:11px;">Needs a separate one-time sign-in the first time you use it. Scanned collections currently appear in their own log — they aren't merged into this Dashboard/Ledger yet.</p>
        </div>
      </div>

      <div id="lf_manual_fields" style="display:none;">
        <div class="field">
          <label>Category</label>
          <select id="lf_category" required></select>
        </div>
        <div class="field"><label>Amount (₱)</label><input type="number" id="lf_amount" min="0" step="0.01" placeholder="e.g. 50"/></div>
        <div class="field combo" id="lf_student_field">
          <label>Student (optional)</label>
          <input type="text" id="lf_student_search" placeholder="Type a name to link this to a student…" autocomplete="off"/>
          <input type="hidden" id="lf_student_id" value=""/>
          <div class="combo-list" id="lf_student_list" style="display:none;"></div>
          <p class="subtext" style="margin:4px 0 0;font-size:11px;">Leave blank for a collection not tied to one student (e.g. bulk fundraising proceeds).</p>
        </div>
        <div class="field" id="lf_payee_field" style="display:none;"><label>Paid To (optional)</label><input type="text" id="lf_payee" placeholder="e.g. Vendor or supplier name"/></div>
        <div class="field" id="lf_purpose_field" style="display:none;">
          <label>Purpose / Event (optional)</label>
          <input type="text" id="lf_purpose" list="lf_purpose_list" placeholder="e.g. Acquaintance Party, Sports Fest…" autocomplete="off"/>
          <datalist id="lf_purpose_list">${getExpenseGroups().filter(g=>g.label!==GENERAL_PURPOSE_LABEL).map(g=>`<option value="${escapeHtml(g.label)}"></option>`).join('')}</datalist>
          <p class="subtext" style="margin:4px 0 0;font-size:11px;">Groups this expense under an event/purpose in the Liquidation Report. Leave blank for general expenses.</p>
        </div>
        <div class="field" id="lf_receipt_field" style="display:none;">
          <label>Official Receipt / Proof of Purchase</label>
          <div class="receipt-picker">
            <div class="receipt-preview" id="lf_receipt_preview">${ICON.image}</div>
            <div class="receipt-actions">
              <input type="file" id="lf_receipt_input" accept="image/*" style="display:none;"/>
              <button type="button" class="btn-sm ghost" id="lf_receipt_btn">${ICON.paperclip}Attach Receipt</button>
              <button type="button" class="btn-sm danger" id="lf_receipt_remove" style="display:none;">${ICON.trash}Remove</button>
            </div>
          </div>
          <p class="receipt-hint">Optional, but strongly recommended for every expense — a photo of the OR or proof of purchase.</p>
        </div>
        <div class="field"><label>Date</label><input type="date" id="lf_date" value="${todayISO()}"/></div>
        <div class="field"><label>Time</label><input type="time" id="lf_time" value="${nowTimeHHMM()}"/></div>
        <div class="field"><label>Note (optional)</label><textarea id="lf_note" placeholder="Any details worth remembering"></textarea></div>
        <p class="subtext" style="margin:-4px 0 4px;">This entry goes in as <b>Pending</b> until the Mayor or Vice Mayor approves it — approved entries are what count toward the fund balance.</p>
        <div class="field"><label>Recorded By</label><input type="text" id="lf_reporter" value="${escapeHtml(state.session.name)}"/></div>
        <button type="submit" class="btn-primary">Submit Entry</button>
      </div>
    </form>
  `;
}
export function populateLogCategories(type){
  const sel = document.getElementById('lf_category');
  if(!sel) return;
  const cats = type==='expense' ? EXPENSE_CATEGORIES : COLLECTION_CATEGORIES;
  sel.innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const studentField = document.getElementById('lf_student_field');
  const payeeField = document.getElementById('lf_payee_field');
  const purposeField = document.getElementById('lf_purpose_field');
  const receiptField = document.getElementById('lf_receipt_field');
  if(studentField) studentField.style.display = type==='expense' ? 'none' : '';
  if(payeeField) payeeField.style.display = type==='expense' ? '' : 'none';
  if(purposeField) purposeField.style.display = type==='expense' ? '' : 'none';
  if(receiptField) receiptField.style.display = type==='expense' ? '' : 'none';
}
export function renderLogStudentCombo(filterText){
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
  populateLogCategories('collection');
  const typeInput = document.getElementById('lf_type');
  const collBtn = document.getElementById('lf_type_collection');
  const expBtn = document.getElementById('lf_type_expense');
  const qrCallout = document.getElementById('lf_qr_callout');
  const manualFields = document.getElementById('lf_manual_fields');
  collBtn.onclick = ()=>{ typeInput.value='collection'; collBtn.classList.add('sel'); expBtn.classList.remove('sel'); qrCallout.style.display=''; manualFields.style.display='none'; };
  expBtn.onclick = ()=>{ typeInput.value='expense'; expBtn.classList.add('sel'); collBtn.classList.remove('sel'); populateLogCategories('expense'); qrCallout.style.display='none'; manualFields.style.display=''; };

  const studentSearch = document.getElementById('lf_student_search');
  const studentIdInput = document.getElementById('lf_student_id');
  if(studentSearch){
    studentSearch.onfocus = ()=> renderLogStudentCombo(studentSearch.value);
    studentSearch.oninput = ()=>{ studentIdInput.value=''; renderLogStudentCombo(studentSearch.value); };
  }

  let receiptData = null;
  const receiptInput = document.getElementById('lf_receipt_input');
  const receiptBtn = document.getElementById('lf_receipt_btn');
  const receiptRemove = document.getElementById('lf_receipt_remove');
  const receiptPreview = document.getElementById('lf_receipt_preview');
  if(receiptBtn) receiptBtn.onclick = ()=> receiptInput.click();
  if(receiptInput) receiptInput.onchange = async ()=>{
    const file = receiptInput.files[0];
    if(!file) return;
    try{
      const dataUrl = await resizeImageFile(file, 800, 0.5);
      receiptData = dataUrl;
      receiptPreview.innerHTML = `<img src="${dataUrl}" alt=""/>`;
      receiptRemove.style.display = '';
    }catch(err){ showToast('Could not read that image'); }
    receiptInput.value = '';
  };
  if(receiptRemove) receiptRemove.onclick = ()=>{
    receiptData = null;
    receiptPreview.innerHTML = ICON.image;
    receiptRemove.style.display = 'none';
  };

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const amount = parseFloat(document.getElementById('lf_amount').value);
    if(!amount || amount<=0){ showToast('Enter a valid amount'); return; }
    const type = typeInput.value;
    let studentId = '';
    let payer = '';
    if(type==='collection'){
      studentId = studentIdInput.value;
      const typed = studentSearch.value.trim();
      if(!studentId && typed){
        const exact = state.roster.find(s=>s.name.trim().toLowerCase()===typed.toLowerCase());
        if(exact) studentId = exact.id;
      }
      const matchedStudent = studentId ? state.roster.find(s=>s.id===studentId) : null;
      payer = matchedStudent ? matchedStudent.name : typed;
    } else {
      payer = document.getElementById('lf_payee').value.trim();
    }
    const rec = {
      id: 'tx_'+Date.now(),
      type,
      category: document.getElementById('lf_category').value,
      amount,
      studentId: studentId || null,
      payer,
      purpose: type==='expense' ? document.getElementById('lf_purpose').value.trim() : '',
      date: document.getElementById('lf_date').value,
      time: document.getElementById('lf_time').value || nowTimeHHMM(),
      note: document.getElementById('lf_note').value.trim(),
      receipt: type==='expense' ? receiptData : null,
      recordedBy: document.getElementById('lf_reporter').value.trim() || state.session.name,
      status: state.session.role==='mayor' ? 'approved' : 'pending',
      approvedBy: state.session.role==='mayor' ? state.session.name : null,
      verified: false,
      verifiedBy: null,
    };
    await mutateShared('treasury_transactions', latest=>{ latest.push(rec); return latest; });
    showToast(rec.status==='approved' ? 'Entry logged and approved' : 'Entry submitted for approval');
    state.tab='ledger';
    render();
  };
}

/* ============== LEDGER ============== */

/* ===================== ledger ===================== */
export function ledgerHTML(){
  const role = state.session.role;
  const q = state.search.toLowerCase();
  let rows = allTransactionsForDisplay();
  if(state.typeFilter!=='all') rows = rows.filter(t=>t.type===state.typeFilter);
  if(state.statusFilter!=='all') rows = rows.filter(t=>t.status===state.statusFilter);
  if(q) rows = rows.filter(t=> t.category.toLowerCase().includes(q) || (t.note||'').toLowerCase().includes(q) || (t.payer||'').toLowerCase().includes(q) || (t.recordedBy||'').toLowerCase().includes(q));
  rows.sort((a,b)=> (b.date+b.time).localeCompare(a.date+a.time));

  return `
    <h2 class="section-title">${ICON.list}Transaction Ledger</h2>
    <p class="subtext">Every collection and expense, in one place — including QR-scanned collections.</p>
    <div class="fab-row">
      <div class="search" style="flex:1;margin-bottom:0;">${ICON.search}<input id="ledgerSearch" placeholder="Search category, note, name…" value="${escapeHtml(state.search)}"/></div>
      <select id="ledgerTypeFilter" class="btn-sm ghost" style="cursor:pointer;">
        <option value="all" ${state.typeFilter==='all'?'selected':''}>All Types</option>
        <option value="collection" ${state.typeFilter==='collection'?'selected':''}>Collections</option>
        <option value="expense" ${state.typeFilter==='expense'?'selected':''}>Expenses</option>
      </select>
      <select id="ledgerStatusFilter" class="btn-sm ghost" style="cursor:pointer;">
        <option value="all" ${state.statusFilter==='all'?'selected':''}>All Statuses</option>
        <option value="pending" ${state.statusFilter==='pending'?'selected':''}>Pending</option>
        <option value="approved" ${state.statusFilter==='approved'?'selected':''}>Approved</option>
        <option value="rejected" ${state.statusFilter==='rejected'?'selected':''}>Rejected</option>
      </select>
    </div>
    <div class="card">
      ${rows.length===0? emptyState('No transactions found','Try a different search or filter.', ICON.list) :
        rows.map(t=>{
          const isQr = t.source==='qr';
          const canApprove = !isQr && (role==='mayor'||role==='vice_mayor') && t.status==='pending';
          const canVerify = !isQr && role==='auditor' && t.status==='approved';
          const canDelete = !isQr && role==='mayor';
          const canDeleteQr = isQr && role==='mayor';
          const extra = [];
          if(canApprove) extra.push(`<button class="btn-sm gold" data-approve-tx="${t.id}" style="padding:6px 8px;">${ICON.check}</button>`, `<button class="btn-sm danger" data-reject-tx="${t.id}" style="padding:6px 8px;">${ICON.x}</button>`);
          if(canVerify) extra.push(`<button class="btn-sm ${t.verified?'ghost':'gold'}" data-verify-tx="${t.id}" style="padding:6px 8px;">${ICON.check}</button>`);
          if(canDelete) extra.push(`<button class="btn-sm danger" data-del-tx="${t.id}" style="padding:6px 8px;">${ICON.trash}</button>`);
          if(canDeleteQr) extra.push(`<button class="btn-sm danger" data-del-qr-tx="${t.id}" style="padding:6px 8px;">${ICON.trash}</button>`);
          return `<div style="display:flex;align-items:center;gap:6px;">${txRowHTML(t)}${extra.length?`<div style="display:flex;gap:4px;flex-shrink:0;">${extra.join('')}</div>`:''}</div>`;
        }).join('')
      }
    </div>
  `;
}
export function attachLedgerEvents(){
  const search = document.getElementById('ledgerSearch');
  if(search) search.oninput = ()=>{ state.search = search.value; render(); const el=document.getElementById('ledgerSearch'); if(el){ el.focus(); el.selectionStart=el.value.length; } };
  const typeF = document.getElementById('ledgerTypeFilter');
  if(typeF) typeF.onchange = ()=>{ state.typeFilter = typeF.value; render(); };
  const statusF = document.getElementById('ledgerStatusFilter');
  if(statusF) statusF.onchange = ()=>{ state.statusFilter = statusF.value; render(); };
  attachApprovalQueueEvents();
  document.querySelectorAll('[data-del-tx]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Delete this transaction record? This cannot be undone.')) return;
      await mutateShared('treasury_transactions', latest=>latest.filter(t=>t.id!==b.dataset.delTx));
      showToast('Record deleted');
      render();
    };
  });
  document.querySelectorAll('[data-del-qr-tx]').forEach(b=>{
    b.onclick = async ()=>{
      if(b.disabled) return;
      if(!confirm('Remove this scanned payment? This cannot be undone, and it will also reverse the amount from that student\'s dues if one was linked.')) return;
      b.disabled = true;
      try{
        await deleteQrCollection(b.dataset.delQrTx);
        state.qrCollections = await fetchQrCollections();
        showToast('Scanned payment removed');
        render();
      }catch(e){
        showToast(e.message || 'Could not remove this payment');
        b.disabled = false;
      }
    };
  });
}

/* ============== LIQUIDATION REPORT (transparency: use-of-funds report) ==============
   Shown both inside the officer app (editable narrative for Mayor/Treasurer) and on the
   public student dashboard (read-only). `editable` controls whether narrative textareas
   and save buttons render — attachLiquidationEvents(editable) mirrors that flag. */

/* ===================== liquidation ===================== */
export function liquidationReportHTML(editable){
  const groups = getExpenseGroups();
  const allExpenses = approvedOf('expense').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  const view = state.liqView || 'grouped';
  const headingStyle = editable ? '' : ' style="color:#fff;"';
  const subStyle = editable ? '' : ' style="color:rgba(255,255,255,0.75);"';
  return `
    <h2 class="section-title"${headingStyle}>${ICON.checklist}Liquidation Report</h2>
    <p class="subtext"${subStyle}>Every approved expense, grouped by purpose, with receipts and a report of how the funds were used.</p>
    <div class="grid-stats">
      <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalCollections())}</b><span>Total Collections</span></div>
      <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalExpenses())}</b><span>Total Liquidated</span></div>
      <div class="stat"><div class="stat-icon">${ICON.chest}</div><b>${formatPeso(currentBalance())}</b><span>Fund Balance</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.list}</div><b>${groups.length}</b><span>Reported Purposes</span></div>
    </div>
    <div class="type-pick" id="liqViewToggle">
      <button type="button" data-view="grouped" class="${view==='grouped'?'sel':''}">${ICON.checklist}By Purpose</button>
      <button type="button" data-view="full" class="${view==='full'?'sel':''}">${ICON.list}Full List</button>
    </div>
    ${view==='grouped' ?
      (groups.length===0 ? `<div class="card">${emptyState('Nothing liquidated yet','Approved expenses will be grouped here by purpose or event.', ICON.checklist)}</div>` :
        groups.map(g=>liqGroupHTML(g, editable)).join(''))
      : `<div class="card">
          ${allExpenses.length===0 ? emptyState('No expenses yet','Approved expenses will show up here as a chronological list.', ICON.checklist) :
            allExpenses.map(txRowHTML).join('')}
        </div>`
    }
  `;
}
export function liqGroupHTML(g, editable){
  const narrative = (state.liquidationNotes && state.liquidationNotes[g.key]) || '';
  const canEdit = editable && state.session && (state.session.role==='mayor' || state.session.role==='treasurer');
  return `
  <div class="card" style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:2px;">
      <h3 style="margin:0;font-size:14.5px;color:var(--navy-950);">${escapeHtml(g.label)}</h3>
      <span class="mono" style="font-weight:800;color:var(--danger);font-size:14px;">${formatPeso(g.total)}</span>
    </div>
    <p class="subtext" style="margin:0 0 10px;">${g.entries.length} expense${g.entries.length===1?'':'s'} recorded</p>
    ${canEdit ? `
      <div class="field" style="margin-bottom:12px;">
        <label>Report on the Use of Funds</label>
        <textarea class="liq-narrative-input" data-purpose-key="${escapeHtml(g.key)}" placeholder="Explain what this was for and how the money was used…">${escapeHtml(narrative)}</textarea>
        <button type="button" class="btn-sm gold" data-save-narrative="${escapeHtml(g.key)}" style="margin-top:8px;">${ICON.check}Save Report</button>
      </div>
    ` : (narrative ? `<p class="liq-narrative-text">${escapeHtml(narrative)}</p>` : `<p class="subtext" style="font-style:italic;margin:0 0 10px;">No written report yet.</p>`)}
    <div class="liq-entries">
      ${g.entries.map(t=>`
        <div class="public-detail-row">
          <div class="pd-top">
            <span class="pd-check">${escapeHtml(t.category)}${t.verified?' ✓':''}</span>
            <span class="pd-date">${formatDateTime(t.date,t.time)}</span>
          </div>
          <span class="pd-sanction">${formatPeso(t.amount)}${t.payer?` — Paid to ${escapeHtml(t.payer)}`:''}${t.note?` · ${escapeHtml(t.note)}`:''}</span>
          <div style="margin-top:4px;">
            ${t.receipt ? `<a class="receipt-thumb-link" href="${t.receipt}" target="_blank" rel="noopener">${ICON.paperclip}View Receipt</a>` : `<span style="font-size:11px;color:var(--danger);font-weight:700;">No receipt attached</span>`}
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}
export function attachLiquidationEvents(editable){
  document.querySelectorAll('#liqViewToggle button').forEach(b=>{
    b.onclick = ()=>{ state.liqView = b.dataset.view; render(); };
  });
  if(!editable) return;
  document.querySelectorAll('[data-save-narrative]').forEach(b=>{
    b.onclick = async ()=>{
      const key = b.dataset.saveNarrative;
      const ta = document.querySelector(`textarea[data-purpose-key="${window.CSS && CSS.escape ? CSS.escape(key) : key}"]`);
      const text = ta ? ta.value.trim() : '';
      await mutateShared('treasury_liquidation_notes', latest=>{
        const next = {...(latest||{})};
        if(text) next[key] = text; else delete next[key];
        return next;
      });
      showToast('Report saved');
      render();
    };
  });
}

/* ============== PAST PERIODS (closed collection-period archive) ==============
   A closed period is a frozen snapshot: its own transaction list, its own
   liquidation narratives, its own per-student totals — exactly as they
   stood the moment the Mayor closed it. Shown to officers and, read-only,
   on the Public Dashboard. */

/* ===================== periods ===================== */
export function periodsHTML(forApp){
  const periods = state.periods.slice().sort((a,b)=> b.closedAt.localeCompare(a.closedAt));
  return `
    <div class="periods-view">
      <h2 class="section-title">Past Collection Periods</h2>
      <p class="subtext">Every closed period, frozen exactly as it stood when the Mayor closed it.</p>
      ${periods.length===0 ? `<div class="card">${emptyState('No periods closed yet','When the Mayor closes a collection period, it will be archived here.', ICON.clipboard)}</div>` :
        periods.map(p=>periodCardHTML(p)).join('')
      }
    </div>
  `;
}
export function periodCardHTML(p){
  const groups = groupExpensesByPurpose(p.transactions.filter(t=>t.status==='approved' && t.type==='expense'));
  const collectionGroups = groupCollectionsByCategory(p.transactions.filter(t=>t.status==='approved' && t.type==='collection'));
  return `
  <details class="public-row" style="margin-bottom:12px;">
    <summary>
      <div class="list-item" style="pointer-events:none;">
        <div class="tx-icon">${ICON.clipboard}</div>
        <div class="li-main">
          <b>${escapeHtml(p.name)}</b>
          <span>Closed ${formatDate(p.closedAt.slice(0,10))} by ${escapeHtml(p.closedBy)}</span>
        </div>
        <span class="amt pos" style="font-size:14px;">${formatPeso(p.endingBalance)}</span>
      </div>
    </summary>
    <div class="public-detail">
      <div class="grid-stats" style="margin:10px 0;">
        <div class="stat"><div class="stat-icon">${ICON.chest}</div><b>${formatPeso(p.beginningBalance)}</b><span>Beginning Balance</span></div>
        <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(p.collectionsTotal)}</b><span>Collections</span></div>
        <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(p.expensesTotal)}</b><span>Expenses</span></div>
        <div class="stat res"><div class="stat-icon">${ICON.check}</div><b>${formatPeso(p.endingBalance)}</b><span>Ending Balance</span></div>
      </div>
      <h3 style="font-size:13.5px;margin:12px 0 6px;">Liquidation — by purpose</h3>
      ${groups.length===0 ? `<p class="subtext" style="font-style:italic;">No expenses recorded this period.</p>` :
        groups.map(g=>`
          <details class="public-row" style="margin-bottom:8px;">
            <summary>
              <div style="display:flex;justify-content:space-between;align-items:center;pointer-events:none;padding:2px 0;">
                <span style="font-size:13px;font-weight:700;">${escapeHtml(g.label)}<span style="font-weight:500;color:var(--ink-soft);"> · ${g.entries.length} item${g.entries.length===1?'':'s'}</span></span>
                <span style="font-size:13px;font-weight:700;">${formatPeso(g.total)}</span>
              </div>
            </summary>
            <div class="public-detail">
              ${p.liquidationNotes && p.liquidationNotes[g.key] ? `<p class="liq-narrative-text" style="margin:2px 0 8px;">${escapeHtml(p.liquidationNotes[g.key])}</p>` : ''}
              <div class="liq-entries">${g.entries.map(t=>`
                <div class="public-detail-row">
                  <div class="pd-top"><span class="pd-check">${escapeHtml(t.category)}</span><span class="pd-date">${formatDateTime(t.date,t.time)}</span></div>
                  <span class="pd-sanction">${formatPeso(t.amount)}${t.payer?` — Paid to ${escapeHtml(t.payer)}`:''}${t.note?` · ${escapeHtml(t.note)}`:''}</span>
                </div>`).join('')}</div>
            </div>
          </details>
        `).join('')
      }
      <h3 style="font-size:13.5px;margin:16px 0 6px;">Collections — by category</h3>
      ${collectionGroups.length===0 ? `<p class="subtext" style="font-style:italic;">No collections recorded this period.</p>` :
        collectionGroups.map(g=>`
          <details class="public-row" style="margin-bottom:8px;">
            <summary>
              <div style="display:flex;justify-content:space-between;align-items:center;pointer-events:none;padding:2px 0;">
                <span style="font-size:13px;font-weight:700;">${escapeHtml(g.label)}<span style="font-weight:500;color:var(--ink-soft);"> · ${g.entries.length} item${g.entries.length===1?'':'s'}</span></span>
                <span style="font-size:13px;font-weight:700;">${formatPeso(g.total)}</span>
              </div>
            </summary>
            <div class="public-detail">
              <div class="liq-entries">${g.entries.map(t=>`
                <div class="public-detail-row">
                  <div class="pd-top"><span class="pd-check">${escapeHtml(t.payer||'—')}</span><span class="pd-date">${formatDateTime(t.date,t.time)}</span></div>
                  <span class="pd-sanction">${formatPeso(t.amount)}${t.note?` · ${escapeHtml(t.note)}`:''}</span>
                </div>`).join('')}</div>
            </div>
          </details>
        `).join('')
      }
    </div>
  </details>`;
}
export function attachPeriodsEvents(){ /* plain expand/collapse via native <details> — nothing dynamic to wire yet */ }

/* ============== ACCOUNTS (Mayor only) ============== */

/* ===================== accounts ===================== */
export function accountsHTML(){
  const rows = state.officerRoles.slice().sort((a,b)=>{
    if(a.role==='pending' && b.role!=='pending') return -1;
    if(b.role==='pending' && a.role!=='pending') return 1;
    return (a.full_name||'').localeCompare(b.full_name||'');
  });
  return `
    <h2 class="section-title">${ICON.checklist}Dues Settings</h2>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
      <div class="field" style="margin-bottom:0;flex:1;min-width:160px;"><label>Class Dues Amount (₱ per student)</label><input type="number" id="duesAmountInput" min="0" step="0.01" value="${state.duesAmount}"/></div>
      <button class="btn-sm gold" id="saveDuesBtn">${ICON.check}Save</button>
    </div>
    <h2 class="section-title">${ICON.key}Officer Accounts</h2>
    <p class="subtext">Officers create their own account at the sign-in screen — there's nothing to add here. New sign-ups show up below as <b>Pending</b>; assign them a role to grant access.</p>
    <div class="card">
      ${rows.length===0 ? emptyState('No officers yet','Once someone signs up, they will appear here.', ICON.key) :
        rows.map(a=>{
          const isPending = a.role==='pending';
          const isSelf = a.user_id===state.session.accountId;
          return `
        <div class="list-item" style="align-items:flex-start;">
          <div class="tx-icon">${isPending?ICON.clock:a.role==='mayor'?ICON.crown:a.role==='vice_mayor'?ICON.shield:a.role==='treasurer'?ICON.cash:ICON.checklist}</div>
          <div class="li-main"><b>${escapeHtml(a.full_name||'(no name)')}${isSelf?' (you)':''}</b><span>${escapeHtml(a.email||'')}${isPending?' · Pending':''}</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <select class="btn-sm ghost" data-role-select="${a.user_id}" style="cursor:pointer;padding:6px 8px;">
              ${ROLES.map(r=>`<option value="${r}" ${a.role===r?'selected':''}>${escapeHtml(roleLabel(r))}</option>`).join('')}
              ${isPending?`<option value="pending" selected>Pending</option>`:''}
            </select>
            <button class="btn-sm gold" data-save-role="${a.user_id}" style="padding:6px 8px;">${ICON.check}</button>
            ${a.email?`<button class="btn-sm ghost" data-reset-pass="${escapeHtml(a.email)}" style="padding:6px 8px;" title="Send password reset email">${ICON.key}</button>`:''}
            ${!isSelf?`<button class="btn-sm danger" data-del-account="${a.user_id}" data-del-name="${escapeHtml(a.full_name||a.email||'this officer')}" style="padding:6px 8px;">${ICON.trash}</button>`:''}
          </div>
        </div>
      `;}).join('')
      }
    </div>
  `;
}
export function attachAccountsEvents(){
  const saveDuesBtn = document.getElementById('saveDuesBtn');
  if(saveDuesBtn) saveDuesBtn.onclick = async ()=>{
    const val = parseFloat(document.getElementById('duesAmountInput').value);
    if(isNaN(val) || val<0){ showToast('Enter a valid amount'); return; }
    state.duesAmount = val;
    await saveShared('treasury_dues_amount', val);
    showToast('Dues amount updated');
    render();
  };

  document.querySelectorAll('[data-save-role]').forEach(b=>{
    b.onclick = async ()=>{
      if(b.disabled) return;
      const userId = b.dataset.saveRole;
      const select = document.querySelector(`[data-role-select="${userId}"]`);
      const newRole = select.value;
      const target = state.officerRoles.find(a=>a.user_id===userId);
      if(target && target.role==='mayor' && newRole!=='mayor'){
        const mayorCount = state.officerRoles.filter(a=>a.role==='mayor').length;
        if(mayorCount<=1){ showToast("Can't demote the only Mayor — assign someone else as Mayor first"); return; }
      }
      b.disabled = true;
      try{
        const { error } = await sb.from('officer_roles').update({ role: newRole }).eq('user_id', userId);
        if(error) throw error;
        state.officerRoles = await fetchOfficerRoles();
        showToast('Role updated');
      }catch(e){
        showToast(e.message || 'Could not update role');
      }
      b.disabled = false;
      render();
    };
  });

  document.querySelectorAll('[data-reset-pass]').forEach(b=>{
    b.onclick = async ()=>{
      if(b.disabled) return;
      b.disabled = true;
      try{
        const { error } = await sb.auth.resetPasswordForEmail(b.dataset.resetPass);
        if(error) throw error;
        showToast('Password reset email sent');
      }catch(e){
        showToast(e.message || 'Could not send reset email');
      }
      b.disabled = false;
    };
  });

  document.querySelectorAll('[data-del-account]').forEach(b=>{
    b.onclick = async ()=>{
      if(b.disabled) return;
      const userId = b.dataset.delAccount;
      const target = state.officerRoles.find(a=>a.user_id===userId);
      if(!confirm(`Revoke access for "${b.dataset.delName}"? They can be re-added a role later if this was a mistake — this just removes their current role.`)) return;
      if(target && target.role==='mayor'){
        const mayorCount = state.officerRoles.filter(a=>a.role==='mayor').length;
        if(mayorCount<=1){ showToast("Can't remove the only Mayor"); return; }
      }
      b.disabled = true;
      try{
        const { error } = await sb.from('officer_roles').delete().eq('user_id', userId);
        if(error) throw error;
        state.officerRoles = await fetchOfficerRoles();
        showToast('Access revoked');
      }catch(e){
        showToast(e.message || 'Could not revoke access');
      }
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
  if(state.modal.type==='selfpass'){
    inner = `
      <button class="close-x" id="modalClose">${ICON.x}</button>
      <h2 class="section-title">Change Password</h2>
      <div class="field"><label>New Password</label><input type="password" id="m_new_password" placeholder="At least 8 characters"/></div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Update Password</button>
      </div>`;
  } else if(state.modal.type==='closeperiod'){
    const preview = buildPeriodPreview();
    inner = `
      <button class="close-x" id="modalClose">${ICON.x}</button>
      <h2 class="section-title">${ICON.checklist}Close Collection Period</h2>
      <p class="subtext">This archives every approved collection and expense, records each student's totals, and starts the next period fresh. Pending items (${preview.pendingCount}) carry forward untouched.</p>
      <div class="grid-stats" style="margin-bottom:14px;">
        <div class="stat"><div class="stat-icon">${ICON.chest}</div><b>${formatPeso(preview.beginningBalance)}</b><span>Beginning Balance</span></div>
        <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(preview.collectionsTotal)}</b><span>Collections</span></div>
        <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(preview.expensesTotal)}</b><span>Expenses</span></div>
        <div class="stat res"><div class="stat-icon">${ICON.check}</div><b>${formatPeso(preview.endingBalance)}</b><span>Ending Balance</span></div>
      </div>
      <p class="subtext" style="margin-top:-6px;">The ending balance above carries forward as the new period's beginning balance.</p>
      <div class="field"><label>Name this period</label><input id="m_period_name" placeholder="e.g. 1st Semester Dues"/></div>
      <div class="field"><label>Type the period name above to confirm</label><input id="m_period_confirm" placeholder="Retype the name exactly"/></div>
      <p style="color:var(--danger);font-size:12px;font-weight:700;margin:0 0 12px;">Approved records are archived, not deleted — you can still view them under Past Periods. This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="modalSave">Close Period</button>
      </div>`;
  } else if(state.modal.type==='studenthistory'){
    const d = state.modal.data;
    const student = state.roster.find(s=>s.id===d.studentId);
    const history = getStudentPeriodHistory(d.studentId);
    inner = `
      <button class="close-x" id="modalClose">${ICON.x}</button>
      <h2 class="section-title">${ICON.clipboard}Contribution History</h2>
      <p class="subtext">${escapeHtml(student ? student.name : 'Student')} — totals from every closed period.</p>
      ${history.length===0 ? `<p class="subtext" style="font-style:italic;">No closed periods include this student yet.</p>` :
        `<div class="card">${history.map(h=>`
          <div class="list-item">
            <div class="tx-icon">${ICON.clipboard}</div>
            <div class="li-main"><b>${escapeHtml(h.name)}</b><span>Closed ${formatDate(h.closedAt.slice(0,10))}${h.other>0?` · ${formatPeso(h.other)} other`:''}</span></div>
            <span class="amt pos">${formatPeso(h.total)}</span>
          </div>
        `).join('')}</div>`
      }
      <div class="modal-actions">
        <button class="btn-sm ghost" id="modalCancel" style="flex:1;justify-content:center;">Close</button>
      </div>`;
  }
  back.innerHTML = `<div class="modal">${inner}</div>`;
  document.getElementById('root').appendChild(back);
  document.getElementById('modalClose').onclick = closeModal;
  const modalCancelBtn = document.getElementById('modalCancel');
  if(modalCancelBtn) modalCancelBtn.onclick = closeModal;
  back.onclick = (e)=>{ if(e.target===back) closeModal(); };
  const modalSaveBtn = document.getElementById('modalSave');
  if(modalSaveBtn) modalSaveBtn.onclick = async ()=>{
    if(modalSaveBtn.disabled) return;
    modalSaveBtn.disabled = true;
    try{ await saveModal(); }
    finally{ if(modalSaveBtn) modalSaveBtn.disabled = false; }
  };
}
export function closeModal(){ state.modal=null; render(); }
async function saveModal(){
  const type = state.modal.type;
  const d = state.modal.data;
  if(type==='selfpass'){
    const next = document.getElementById('m_new_password').value;
    if(!next || next.length<8){ showToast('New password must be at least 8 characters'); return; }
    try{
      const { error } = await sb.auth.updateUser({ password: next });
      if(error) throw error;
      showToast('Password updated');
      state.modal=null;
      render();
    }catch(e){
      showToast(e.message || 'Could not update password');
    }
  } else if(type==='closeperiod'){
    const name = document.getElementById('m_period_name').value.trim();
    const confirmText = document.getElementById('m_period_confirm').value.trim();
    if(!name){ showToast('Enter a name for this period'); return; }
    if(confirmText !== name){ showToast('Type the period name exactly to confirm'); return; }
    const record = buildClosedPeriodRecord(name, state.session.name);
    await mutateShared('treasury_periods', latest=>{ latest.push(record); return latest; });
    await mutateShared('treasury_transactions', latest=> latest.filter(t=>t.status==='pending'));
    await mutateShared('treasury_beginning_balance', ()=> ({ amount: record.endingBalance, fromPeriodName: record.name }));
    await mutateShared('treasury_liquidation_notes', ()=> ({}));
    showToast(`"${name}" closed and archived`);
    state.modal=null;
    state.tab='dashboard';
    render();
  }
}

