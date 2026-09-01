/* Alpha Watch — treasury-embed.js
   The Treasury tab inside Alpha Watch, ported natively (not an <iframe>) so
   it can share the page's own auth/session chrome. This is a near-complete
   parallel implementation of the standalone Treasury app (scripts/alpha-treasury/*)
   rather than a re-use of those modules — that mirrors how the original
   single-file index__1_.html already had this as a self-contained IIFE with
   its own tr-prefixed state, so behavior here is unchanged, just moved into
   an ES module. Unifying this with scripts/alpha-treasury/* into one shared
   implementation is a reasonable follow-up, but is a behavior-risk change
   this refactor intentionally avoids.

   Exports a single `Treasury` object — `{ mount(container), applyRemoteUpdate(key,value), syncKeys }` —
   consumed by screens.js (to mount into the #treasuryRoot div when the
   Treasury tab is active) and sync.js (to forward treasury_* key updates). */
import { ICONS as ICON } from '../shared/icons.js';
import { state } from './state.js';
import { loadShared, saveShared, loadPersonal, savePersonal, makeMutateShared } from './sync.js';
import { showToast } from './router.js';
/* ============== Password hashing — Treasury's own salt. Existing Treasury
   accounts (created via the standalone alpha-treasury.html) have their
   passwordHash computed with THIS exact salt, distinct from Watch's own
   hashPassword ('alpha-watch::...'). Must stay local or every existing
   Treasury login breaks. ============== */
async function hashPassword(username, password){
  const enc = new TextEncoder();
  const data = enc.encode('alpha-treasury::'+String(username).trim().toLowerCase()+'::'+password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ============== Icons (Treasury's own set — some keys, like chest/x/
   paperclip/image, don't exist in Watch's own ICON object) ============== */
/* ============== Constants ============== */
const COLLECTION_CATEGORIES = ['Class Dues','Contribution','Fundraising','Donation','Other'];
const EXPENSE_CATEGORIES = ['Supplies','Printing','Event Expenses','Transportation','Snacks / Food','Other'];
const ROLES = ['mayor','vice_mayor','treasurer','auditor'];
function roleLabel(role){
  return role==='mayor'?'Mayor':role==='vice_mayor'?'Vice Mayor':role==='treasurer'?'Treasurer':'Auditor';
}

/* ============== App state ============== */
let trState = {
  screen:'loading', // loading | setup | gate | app | public
  tab:'dashboard',
  session:null, // {name, role, username, accountId}
  accounts:[],
  transactions:[],
  roster:[], // read-only here — owned by Alpha Watch
  duesAmount:100,
  liquidationNotes:{}, // {purposeKey: narrative text} — written reports of fund use, per expense purpose
  toast:null,
  modal:null, // {type:'account'|'resetpass'|'selfpass', data:{...}}
  search:'',
  typeFilter:'all',
  statusFilter:'all',
  publicTab:'overview', // overview | liquidation | contributions
  liqView:'grouped', // grouped | full
  _setupError:null,
  _loginError:null,
};
let trLoginLockout = {attempts:0, until:0};

function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function todayISO(){ const d=new Date(); return d.toISOString().slice(0,10); }
function nowTimeHHMM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function formatDate(iso){ if(!iso) return '—'; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function formatTime(t){
  if(!t) return '';
  const [hStr,mStr] = t.split(':');
  const h = parseInt(hStr,10), m = parseInt(mStr,10);
  if(isNaN(h)||isNaN(m)) return '';
  const period = h>=12 ? 'PM' : 'AM';
  const h12 = ((h+11)%12)+1;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}
function formatDateTime(iso,t){ const time=formatTime(t); return time?`${formatDate(iso)} · ${time}`:formatDate(iso); }
function formatPeso(n){ const v = Math.round((n||0)*100)/100; return '₱'+v.toLocaleString('en-PH',{minimumFractionDigits: v%1?2:0, maximumFractionDigits:2}); }
function initials(name){ return (name||'').split(' ').filter(Boolean).slice(0,2).map(n=>n[0].toUpperCase()).join(''); }
function avatarHTML(person, extraStyle){
  const style = extraStyle ? ` style="${extraStyle}"` : '';
  if(person && person.photo){
    return `<div class="avatar"${style}><img src="${person.photo}" alt=""/></div>`;
  }
  return `<div class="avatar"${style}>${escapeHtml(initials(person?person.name:'?'))}</div>`;
}
/* Resizes/compresses an uploaded image client-side before it's stored as a
   base64 data URL — keeps receipt photos from bloating the shared_data row.
   maxSize is the longest side in pixels. */
function resizeImageFile(file, maxSize){
  return new Promise((resolve, reject)=>{
    if(!file.type || !file.type.startsWith('image/')){ reject(new Error('Not an image')); return; }
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('Could not read file'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('Could not load image'));
      img.onload = ()=>{
        let {width, height} = img;
        const scale = Math.min(1, maxSize/Math.max(width, height));
        width = Math.max(1, Math.round(width*scale));
        height = Math.max(1, Math.round(height*scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function approvedOf(type){ return trState.transactions.filter(t=>t.status==='approved' && t.type===type); }
function totalCollections(){ return approvedOf('collection').reduce((s,t)=>s+t.amount,0); }
function totalExpenses(){ return approvedOf('expense').reduce((s,t)=>s+t.amount,0); }
function currentBalance(){ return totalCollections()-totalExpenses(); }
function pendingCount(){ return trState.transactions.filter(t=>t.status==='pending').length; }
function unverifiedApprovedCount(){ return trState.transactions.filter(t=>t.status==='approved' && !t.verified).length; }

/* ---- Per-student dues (Class Dues category only, approved entries only) ---- */
function getStudentDuesPaid(studentId){
  return trState.transactions
    .filter(t=>t.status==='approved' && t.type==='collection' && t.category==='Class Dues' && t.studentId===studentId)
    .reduce((s,t)=>s+t.amount,0);
}
function getStudentOtherContributions(studentId){
  return trState.transactions
    .filter(t=>t.status==='approved' && t.type==='collection' && t.category!=='Class Dues' && t.studentId===studentId)
    .reduce((s,t)=>s+t.amount,0);
}
function getStudentDuesStatus(studentId){
  const paid = getStudentDuesPaid(studentId);
  if(paid<=0) return 'unpaid';
  if(paid>=trState.duesAmount) return 'paid';
  return 'partial';
}

/* ---- Liquidation report: group approved expenses by purpose/event ---- */
const GENERAL_PURPOSE_LABEL = 'General / Unspecified Expenses';
function purposeLabelOf(t){ const p = (t.purpose||'').trim(); return p || GENERAL_PURPOSE_LABEL; }
function getExpenseGroups(){
  const map = new Map();
  approvedOf('expense').forEach(t=>{
    const label = purposeLabelOf(t);
    const key = label.toLowerCase();
    if(!map.has(key)) map.set(key, {key, label, entries:[], total:0});
    const g = map.get(key);
    g.entries.push(t);
    g.total += t.amount;
  });
  return Array.from(map.values())
    .map(g=>({...g, entries: g.entries.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))}))
    .sort((a,b)=> (a.label===GENERAL_PURPOSE_LABEL) - (b.label===GENERAL_PURPOSE_LABEL) || b.total-a.total);
}


function setupHTML(){
  return `
  <div class="gate">
    <div class="gate-card">
      <div class="logo-chip">${ICON.chest}</div>
      <h1>ALPHA TREASURY</h1>
      <div class="tag">Class Fund & Ledger</div>
      <p class="gate-note" style="margin-top:2px;">No accounts yet. Set up the Class Mayor account first — the Mayor can then create Vice Mayor, Treasurer, and Auditor accounts from inside the app.</p>
      <div class="field"><label>Mayor's Name</label><input type="text" id="tr_su_name" placeholder="e.g. Juan Dela Cruz"/></div>
      <div class="field"><label>Username</label><input type="text" id="tr_su_username" placeholder="e.g. juan.mayor" autocapitalize="off"/></div>
      <div class="field"><label>Password</label><input type="password" id="tr_su_password" placeholder="At least 4 characters"/></div>
      <div class="field"><label>Confirm Password</label><input type="password" id="tr_su_confirm" placeholder="Re-enter password"/></div>
      ${trState._setupError?`<p style="color:var(--danger);font-size:12px;margin:0 0 12px;font-weight:700;">${escapeHtml(trState._setupError)}</p>`:''}
      <button class="btn-primary" id="tr_setupBtn">Create Mayor Account</button>
      <p class="gate-note">Passwords are hashed before they're stored. This connects to the same shared class database as Alpha Watch, so it's synced across every officer's device.</p>
      <a class="btn-sm ghost" href="alpha-treasury.html#public" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin-top:6px;text-decoration:none;">${ICON.users}View Public Student Dashboard ↗</a>
    </div>
  </div>`;
}
function attachSetupEvents(){
  document.getElementById('tr_setupBtn').onclick = async ()=>{
    const name = document.getElementById('tr_su_name').value.trim();
    const username = document.getElementById('tr_su_username').value.trim();
    const password = document.getElementById('tr_su_password').value;
    const confirm = document.getElementById('tr_su_confirm').value;
    if(!name || !username || !password){ trState._setupError='Please fill in every field.'; trRenderCurrent(); return; }
    if(password.length<4){ trState._setupError='Password must be at least 4 characters.'; trRenderCurrent(); return; }
    if(password!==confirm){ trState._setupError='Passwords do not match.'; trRenderCurrent(); return; }
    const passwordHash = await hashPassword(username, password);
    const account = {id:'acc_'+Date.now(), name, username, role:'mayor', passwordHash};
    trState.accounts = [account];
    await saveShared('treasury_accounts', trState.accounts);
    trState.session = {name, role:'mayor', username, accountId:account.id};
    await savePersonal('treasury_session', trState.session);
    trState._setupError=null;
    trState.screen='app';
    trRenderCurrent();
  };
}

/* ============== GATE (sign in) ============== */
function gateHTML(){
  return `
  <div class="gate">
    <div class="gate-card">
      <div class="logo-chip">${ICON.chest}</div>
      <h1>ALPHA TREASURY</h1>
      <div class="tag">Class Fund & Ledger</div>
      <div class="field"><label>Username</label><input type="text" id="tr_lg_username" placeholder="Your username" autocapitalize="off"/></div>
      <div class="field"><label>Password</label><input type="password" id="tr_lg_password" placeholder="Your password"/></div>
      ${trState._loginError?`<p style="color:var(--danger);font-size:12px;margin:0 0 12px;font-weight:700;">${escapeHtml(trState._loginError)}</p>`:''}
      <button class="btn-primary" id="tr_loginBtn">Sign In</button>
      <p class="gate-note">Forgot your password? Ask your Class Mayor to reset it from the Accounts tab.</p>
      <a class="btn-sm ghost" href="alpha-treasury.html#public" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin-top:6px;text-decoration:none;">${ICON.users}View Public Student Dashboard ↗</a>
    </div>
  </div>`;
}
function attachGateEvents(){
  const uInput = document.getElementById('tr_lg_username');
  const pInput = document.getElementById('tr_lg_password');
  uInput.focus();
  const submit = async ()=>{
    const now = Date.now();
    if(now < trLoginLockout.until){
      const wait = Math.ceil((trLoginLockout.until-now)/1000);
      trState._loginError = `Too many attempts — try again in ${wait}s.`;
      trRenderCurrent();
      return;
    }
    const username = uInput.value.trim();
    const password = pInput.value;
    if(!username || !password){ trState._loginError='Enter your username and password.'; trRenderCurrent(); return; }
    const passwordHash = await hashPassword(username, password);
    const account = trState.accounts.find(a=> a.username.toLowerCase()===username.toLowerCase() && a.passwordHash===passwordHash);
    if(!account){
      trLoginLockout.attempts++;
      if(trLoginLockout.attempts>=5){
        trLoginLockout.until = Date.now()+15000;
        trLoginLockout.attempts = 0;
        trState._loginError = 'Too many attempts — try again in 15s.';
      } else {
        trState._loginError='Incorrect username or password.';
      }
      trRenderCurrent();
      return;
    }
    trLoginLockout = {attempts:0, until:0};
    trState.session = {name:account.name, role:account.role, username:account.username, accountId:account.id};
    await savePersonal('treasury_session', trState.session);
    trState._loginError=null;
    trState.screen='app';
    trRenderCurrent();
  };
  document.getElementById('tr_loginBtn').onclick = submit;
  pInput.onkeydown = (e)=>{ if(e.key==='Enter') submit(); };
}/* ============== SHARED: transaction row + approval queue card ============== */
function txIconHTML(t){
  return `<div class="tx-icon ${t.type}">${t.type==='collection'?ICON.up:ICON.down}</div>`;
}
function statusChipHTML(t){
  if(t.status==='pending') return `<span class="status-chip pending">${ICON.clock}Pending</span>`;
  if(t.status==='rejected') return `<span class="status-chip forwarded">${ICON.x}Rejected</span>`;
  return `<span class="status-chip resolved">${ICON.check}Approved</span>`;
}
function txRowHTML(t){
  const sign = t.type==='collection' ? '+' : '−';
  const cls = t.type==='collection' ? 'pos' : 'neg';
  const who = t.payer ? ` · ${escapeHtml(t.payer)}` : '';
  const receiptLink = t.receipt ? ` · <a class="receipt-thumb-link" href="${t.receipt}" target="_blank" rel="noopener">${ICON.paperclip}Receipt</a>` : '';
  return `<div class="list-item">
    ${txIconHTML(t)}
    <div class="li-main"><b>${escapeHtml(t.category)}${t.verified?' ✓':''}</b><span>${formatDateTime(t.date,t.time)}${who} · by ${escapeHtml(t.recordedBy)}${receiptLink}</span></div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
      <span class="amt ${cls}">${sign}${formatPeso(t.amount)}</span>
      ${statusChipHTML(t)}
    </div>
  </div>`;
}
function queueCardHTML(t, actionsHTML){
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
function attachApprovalQueueEvents(){
  document.querySelectorAll('[data-approve-tx]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.approveTx;
      let found = true;
      await mutateShared('treasury_transactions', latest=>{
        const rec = latest.find(t=>t.id===id);
        if(!rec){ found=false; return latest; }
        rec.status='approved'; rec.approvedBy=trState.session.name;
        return latest;
      });
      showToast(found ? 'Transaction approved' : 'That record was already handled elsewhere');
      trRenderCurrent();
    };
  });
  document.querySelectorAll('[data-reject-tx]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Reject this transaction? It will not count toward the fund balance.')) return;
      let found = true;
      await mutateShared('treasury_transactions', latest=>{
        const rec = latest.find(t=>t.id===id_(b));
        if(!rec){ found=false; return latest; }
        rec.status='rejected'; rec.approvedBy=trState.session.name;
        return latest;
      });
      showToast(found ? 'Transaction rejected' : 'That record was already handled elsewhere');
      trRenderCurrent();
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
        rec.verifiedBy = rec.verified ? trState.session.name : null;
        return latest;
      });
      showToast(found ? 'Verification updated' : 'That record was removed elsewhere');
      trRenderCurrent();
    };
  });
}
function attachDashboardEvents(){ attachApprovalQueueEvents(); }

/* ============== DASHBOARDS ============== */
function currentDashboardHTML(){
  const role = trState.session.role;
  if(role==='vice_mayor') return viceMayorDashboardHTML();
  if(role==='treasurer') return treasurerDashboardHTML();
  if(role==='auditor') return auditorDashboardHTML();
  return mayorDashboardHTML();
}
function balanceHeroHTML(){
  const bal = currentBalance();
  return `
    <div class="balance-hero">
      <div class="bh-label">Current Fund Balance</div>
      <div class="bh-amount">${formatPeso(bal)}</div>
      <div class="bh-row">
        <div>Collections<br/><b>${formatPeso(totalCollections())}</b></div>
        <div>Expenses<br/><b>${formatPeso(totalExpenses())}</b></div>
      </div>
    </div>`;
}
function recentActivityHTML(limit){
  const recent = [...trState.transactions].sort((a,b)=> (b.date+b.time).localeCompare(a.date+a.time)).slice(0, limit||6);
  return `
    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.list}Recent Activity</h2>
    <div class="card">
      ${recent.length===0? emptyState('No activity yet','Logged transactions will appear here.', ICON.list) :
        recent.map(txRowHTML).join('')
      }
    </div>`;
}
function emptyState(title, sub, icon){
  return `<div class="empty"><div class="empty-icon-wrap">${icon}</div><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)}</span></div>`;
}
function mayorDashboardHTML(){
  const pending = trState.transactions.filter(t=>t.status==='pending').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return `
    <h2 class="section-title">${ICON.crown}Treasury Overview</h2>
    <p class="subtext">Welcome back, ${escapeHtml(trState.session.name)}. Here's how the class fund stands.</p>
    ${balanceHeroHTML()}
    <div class="grid-stats">
      <div class="stat gold"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalCollections())}</b><span>Total Collections</span></div>
      <div class="stat danger"><div class="stat-icon">${ICON.cash}</div><b>${formatPeso(totalExpenses())}</b><span>Total Expenses</span></div>
      <div class="stat pend"><div class="stat-icon">${ICON.clock}</div><b>${pending.length}</b><span>Pending Approvals</span></div>
      <div class="stat"><div class="stat-icon">${ICON.list}</div><b>${trState.transactions.length}</b><span>Total Entries</span></div>
    </div>
    <h2 class="section-title" style="font-size:15px;margin-top:6px;">${ICON.clock}Awaiting Your Approval</h2>
    ${pending.length===0? emptyState('All caught up','No transactions are waiting on approval.', ICON.check) :
      pending.map(t=> queueCardHTML(t, `
        <button class="btn-sm gold" data-approve-tx="${t.id}">${ICON.check}Approve</button>
        <button class="btn-sm danger" data-reject-tx="${t.id}">${ICON.x}Reject</button>
      `)).join('')
    }
    ${recentActivityHTML()}
  `;
}
function viceMayorDashboardHTML(){
  const pending = trState.transactions.filter(t=>t.status==='pending').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return `
    <h2 class="section-title">${ICON.shield}Approval Desk</h2>
    <p class="subtext">Welcome back, ${escapeHtml(trState.session.name)}. Review what the Treasurer submits before it hits the ledger.</p>
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
function treasurerDashboardHTML(){
  const mine = trState.transactions.filter(t=>t.recordedBy===trState.session.name);
  const myPending = mine.filter(t=>t.status==='pending').length;
  return `
    <h2 class="section-title">${ICON.cash}Treasurer's Desk</h2>
    <p class="subtext">Welcome back, ${escapeHtml(trState.session.name)}. Log every collection and expense the moment it happens.</p>
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
function auditorDashboardHTML(){
  const unverified = trState.transactions.filter(t=>t.status==='approved' && !t.verified).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return `
    <h2 class="section-title">${ICON.checklist}Audit View</h2>
    <p class="subtext">Welcome back, ${escapeHtml(trState.session.name)}. Verify approved entries against receipts and collection sheets.</p>
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
function logHTML(){
  return `
    <h2 class="section-title">${ICON.plus}Log a Transaction</h2>
    <p class="subtext">Fill this out the moment money comes in or goes out.</p>
    <form class="card" id="tr_logForm">
      <div class="type-pick">
        <button type="button" data-type="collection" class="sel" id="tr_lf_type_collection">${ICON.up}Collection</button>
        <button type="button" data-type="expense" id="tr_lf_type_expense">${ICON.down}Expense</button>
      </div>
      <input type="hidden" id="tr_lf_type" value="collection"/>
      <div class="field">
        <label>Category</label>
        <select id="tr_lf_category" required></select>
      </div>
      <div class="field"><label>Amount (₱)</label><input type="number" id="tr_lf_amount" min="0" step="0.01" placeholder="e.g. 50" required/></div>
      <div class="field combo" id="tr_lf_student_field">
        <label>Student (optional)</label>
        <input type="text" id="tr_lf_student_search" placeholder="Type a name to link this to a student…" autocomplete="off"/>
        <input type="hidden" id="tr_lf_student_id" value=""/>
        <div class="combo-list" id="tr_lf_student_list" style="display:none;"></div>
        <p class="subtext" style="margin:4px 0 0;font-size:11px;">Leave blank for a collection not tied to one student (e.g. bulk fundraising proceeds).</p>
      </div>
      <div class="field" id="tr_lf_payee_field" style="display:none;"><label>Paid To (optional)</label><input type="text" id="tr_lf_payee" placeholder="e.g. Vendor or supplier name"/></div>
      <div class="field" id="tr_lf_purpose_field" style="display:none;">
        <label>Purpose / Event (optional)</label>
        <input type="text" id="tr_lf_purpose" list="lf_purpose_list" placeholder="e.g. Acquaintance Party, Sports Fest…" autocomplete="off"/>
        <datalist id="tr_lf_purpose_list">${getExpenseGroups().filter(g=>g.label!==GENERAL_PURPOSE_LABEL).map(g=>`<option value="${escapeHtml(g.label)}"></option>`).join('')}</datalist>
        <p class="subtext" style="margin:4px 0 0;font-size:11px;">Groups this expense under an event/purpose in the Liquidation Report. Leave blank for general expenses.</p>
      </div>
      <div class="field" id="tr_lf_receipt_field" style="display:none;">
        <label>Official Receipt / Proof of Purchase</label>
        <div class="receipt-picker">
          <div class="receipt-preview" id="tr_lf_receipt_preview">${ICON.image}</div>
          <div class="receipt-actions">
            <input type="file" id="tr_lf_receipt_input" accept="image/*" style="display:none;"/>
            <button type="button" class="btn-sm ghost" id="tr_lf_receipt_btn">${ICON.paperclip}Attach Receipt</button>
            <button type="button" class="btn-sm danger" id="tr_lf_receipt_remove" style="display:none;">${ICON.trash}Remove</button>
          </div>
        </div>
        <p class="receipt-hint">Optional, but strongly recommended for every expense — a photo of the OR or proof of purchase.</p>
      </div>
      <div class="field"><label>Date</label><input type="date" id="tr_lf_date" value="${todayISO()}" required/></div>
      <div class="field"><label>Time</label><input type="time" id="tr_lf_time" value="${nowTimeHHMM()}" required/></div>
      <div class="field"><label>Note (optional)</label><textarea id="tr_lf_note" placeholder="Any details worth remembering"></textarea></div>
      <p class="subtext" style="margin:-4px 0 4px;">This entry goes in as <b>Pending</b> until the Mayor or Vice Mayor approves it — approved entries are what count toward the fund balance.</p>
      <div class="field"><label>Recorded By</label><input type="text" id="tr_lf_reporter" value="${escapeHtml(trState.session.name)}" required/></div>
      <button type="submit" class="btn-primary">Submit Entry</button>
    </form>
  `;
}
function populateLogCategories(type){
  const sel = document.getElementById('tr_lf_category');
  if(!sel) return;
  const cats = type==='expense' ? EXPENSE_CATEGORIES : COLLECTION_CATEGORIES;
  sel.innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const studentField = document.getElementById('tr_lf_student_field');
  const payeeField = document.getElementById('tr_lf_payee_field');
  const purposeField = document.getElementById('tr_lf_purpose_field');
  const receiptField = document.getElementById('tr_lf_receipt_field');
  if(studentField) studentField.style.display = type==='expense' ? 'none' : '';
  if(payeeField) payeeField.style.display = type==='expense' ? '' : 'none';
  if(purposeField) purposeField.style.display = type==='expense' ? '' : 'none';
  if(receiptField) receiptField.style.display = type==='expense' ? '' : 'none';
}
function renderLogStudentCombo(filterText){
  const list = document.getElementById('tr_lf_student_list');
  if(!list) return;
  const q = (filterText||'').trim().toLowerCase();
  const matches = trState.roster.filter(s=> !q || s.name.toLowerCase().includes(q) || (s.section||'').toLowerCase().includes(q));
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
      const s = trState.roster.find(x=>x.id===item.dataset.id);
      if(!s) return;
      document.getElementById('tr_lf_student_search').value = s.name;
      document.getElementById('tr_lf_student_id').value = s.id;
      list.style.display = 'none';
    };
  });
}
function attachLogEvents(){
  const form = document.getElementById('tr_logForm');
  if(!form) return;
  populateLogCategories('collection');
  const typeInput = document.getElementById('tr_lf_type');
  const collBtn = document.getElementById('tr_lf_type_collection');
  const expBtn = document.getElementById('tr_lf_type_expense');
  collBtn.onclick = ()=>{ typeInput.value='collection'; collBtn.classList.add('sel'); expBtn.classList.remove('sel'); populateLogCategories('collection'); };
  expBtn.onclick = ()=>{ typeInput.value='expense'; expBtn.classList.add('sel'); collBtn.classList.remove('sel'); populateLogCategories('expense'); };

  const studentSearch = document.getElementById('tr_lf_student_search');
  const studentIdInput = document.getElementById('tr_lf_student_id');
  if(studentSearch){
    studentSearch.onfocus = ()=> renderLogStudentCombo(studentSearch.value);
    studentSearch.oninput = ()=>{ studentIdInput.value=''; renderLogStudentCombo(studentSearch.value); };
  }

  let receiptData = null;
  const receiptInput = document.getElementById('tr_lf_receipt_input');
  const receiptBtn = document.getElementById('tr_lf_receipt_btn');
  const receiptRemove = document.getElementById('tr_lf_receipt_remove');
  const receiptPreview = document.getElementById('tr_lf_receipt_preview');
  if(receiptBtn) receiptBtn.onclick = ()=> receiptInput.click();
  if(receiptInput) receiptInput.onchange = async ()=>{
    const file = receiptInput.files[0];
    if(!file) return;
    try{
      const dataUrl = await resizeImageFile(file, 1000);
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
    const amount = parseFloat(document.getElementById('tr_lf_amount').value);
    if(!amount || amount<=0){ showToast('Enter a valid amount'); return; }
    const type = typeInput.value;
    let studentId = '';
    let payer = '';
    if(type==='collection'){
      studentId = studentIdInput.value;
      const typed = studentSearch.value.trim();
      if(!studentId && typed){
        const exact = trState.roster.find(s=>s.name.trim().toLowerCase()===typed.toLowerCase());
        if(exact) studentId = exact.id;
      }
      const matchedStudent = studentId ? trState.roster.find(s=>s.id===studentId) : null;
      payer = matchedStudent ? matchedStudent.name : typed;
    } else {
      payer = document.getElementById('tr_lf_payee').value.trim();
    }
    const rec = {
      id: 'tx_'+Date.now(),
      type,
      category: document.getElementById('tr_lf_category').value,
      amount,
      studentId: studentId || null,
      payer,
      purpose: type==='expense' ? document.getElementById('tr_lf_purpose').value.trim() : '',
      date: document.getElementById('tr_lf_date').value,
      time: document.getElementById('tr_lf_time').value || nowTimeHHMM(),
      note: document.getElementById('tr_lf_note').value.trim(),
      receipt: type==='expense' ? receiptData : null,
      recordedBy: document.getElementById('tr_lf_reporter').value.trim() || trState.session.name,
      status: trState.session.role==='mayor' ? 'approved' : 'pending',
      approvedBy: trState.session.role==='mayor' ? trState.session.name : null,
      verified: false,
      verifiedBy: null,
    };
    await mutateShared('treasury_transactions', latest=>{ latest.push(rec); return latest; });
    showToast(rec.status==='approved' ? 'Entry logged and approved' : 'Entry submitted for approval');
    trState.tab='ledger';
    trRenderCurrent();
  };
}


/* ============== LEDGER ============== */
function ledgerHTML(){
  const role = trState.session.role;
  const q = trState.search.toLowerCase();
  let rows = trState.transactions.slice();
  if(trState.typeFilter!=='all') rows = rows.filter(t=>t.type===trState.typeFilter);
  if(trState.statusFilter!=='all') rows = rows.filter(t=>t.status===trState.statusFilter);
  if(q) rows = rows.filter(t=> t.category.toLowerCase().includes(q) || (t.note||'').toLowerCase().includes(q) || (t.payer||'').toLowerCase().includes(q) || (t.recordedBy||'').toLowerCase().includes(q));
  rows.sort((a,b)=> (b.date+b.time).localeCompare(a.date+a.time));

  return `
    <h2 class="section-title">${ICON.list}Transaction Ledger</h2>
    <p class="subtext">Every collection and expense, in one place.</p>
    <div class="fab-row">
      <div class="search" style="flex:1;margin-bottom:0;">${ICON.search}<input id="tr_ledgerSearch" placeholder="Search category, note, name…" value="${escapeHtml(trState.search)}"/></div>
      <select id="tr_ledgerTypeFilter" class="btn-sm ghost" style="cursor:pointer;">
        <option value="all" ${trState.typeFilter==='all'?'selected':''}>All Types</option>
        <option value="collection" ${trState.typeFilter==='collection'?'selected':''}>Collections</option>
        <option value="expense" ${trState.typeFilter==='expense'?'selected':''}>Expenses</option>
      </select>
      <select id="tr_ledgerStatusFilter" class="btn-sm ghost" style="cursor:pointer;">
        <option value="all" ${trState.statusFilter==='all'?'selected':''}>All Statuses</option>
        <option value="pending" ${trState.statusFilter==='pending'?'selected':''}>Pending</option>
        <option value="approved" ${trState.statusFilter==='approved'?'selected':''}>Approved</option>
        <option value="rejected" ${trState.statusFilter==='rejected'?'selected':''}>Rejected</option>
      </select>
    </div>
    <div class="card">
      ${rows.length===0? emptyState('No transactions found','Try a different search or filter.', ICON.list) :
        rows.map(t=>{
          const canApprove = (role==='mayor'||role==='vice_mayor') && t.status==='pending';
          const canVerify = role==='auditor' && t.status==='approved';
          const canDelete = role==='mayor';
          const extra = [];
          if(canApprove) extra.push(`<button class="btn-sm gold" data-approve-tx="${t.id}" style="padding:6px 8px;">${ICON.check}</button>`, `<button class="btn-sm danger" data-reject-tx="${t.id}" style="padding:6px 8px;">${ICON.x}</button>`);
          if(canVerify) extra.push(`<button class="btn-sm ${t.verified?'ghost':'gold'}" data-verify-tx="${t.id}" style="padding:6px 8px;">${ICON.check}</button>`);
          if(canDelete) extra.push(`<button class="btn-sm danger" data-del-tx="${t.id}" style="padding:6px 8px;">${ICON.trash}</button>`);
          return `<div style="display:flex;align-items:center;gap:6px;">${txRowHTML(t)}${extra.length?`<div style="display:flex;gap:4px;flex-shrink:0;">${extra.join('')}</div>`:''}</div>`;
        }).join('')
      }
    </div>
  `;
}
function attachLedgerEvents(){
  const search = document.getElementById('tr_ledgerSearch');
  if(search) search.oninput = ()=>{ trState.search = search.value; trRenderCurrent(); const el=document.getElementById('tr_ledgerSearch'); if(el){ el.focus(); el.selectionStart=el.value.length; } };
  const typeF = document.getElementById('tr_ledgerTypeFilter');
  if(typeF) typeF.onchange = ()=>{ trState.typeFilter = typeF.value; trRenderCurrent(); };
  const statusF = document.getElementById('tr_ledgerStatusFilter');
  if(statusF) statusF.onchange = ()=>{ trState.statusFilter = statusF.value; trRenderCurrent(); };
  attachApprovalQueueEvents();
  document.querySelectorAll('[data-del-tx]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Delete this transaction record? This cannot be undone.')) return;
      await mutateShared('treasury_transactions', latest=>latest.filter(t=>t.id!==b.dataset.delTx));
      showToast('Record deleted');
      trRenderCurrent();
    };
  });
}


/* ============== LIQUIDATION REPORT (transparency: use-of-funds report) ==============
   Shown both inside the officer app (editable narrative for Mayor/Treasurer) and on the
   public student dashboard (read-only). `editable` controls whether narrative textareas
   and save buttons render — attachLiquidationEvents(editable) mirrors that flag. */
function liquidationReportHTML(editable){
  const groups = getExpenseGroups();
  const allExpenses = approvedOf('expense').slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  const view = trState.liqView || 'grouped';
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
    <div class="type-pick" id="tr_liqViewToggle">
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
function liqGroupHTML(g, editable){
  const narrative = (trState.liquidationNotes && trState.liquidationNotes[g.key]) || '';
  const canEdit = editable && trState.session && (trState.session.role==='mayor' || trState.session.role==='treasurer');
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
function attachLiquidationEvents(editable){
  document.querySelectorAll('#liqViewToggle button').forEach(b=>{
    b.onclick = ()=>{ trState.liqView = b.dataset.view; trRenderCurrent(); };
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
      trRenderCurrent();
    };
  });
}


/* ============== ACCOUNTS (Mayor only) ============== */
function accountsHTML(){
  return `
    <h2 class="section-title">${ICON.checklist}Dues Settings</h2>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
      <div class="field" style="margin-bottom:0;flex:1;min-width:160px;"><label>Class Dues Amount (₱ per student)</label><input type="number" id="tr_duesAmountInput" min="0" step="0.01" value="${trState.duesAmount}"/></div>
      <button class="btn-sm gold" id="tr_saveDuesBtn">${ICON.check}Save</button>
    </div>
    <h2 class="section-title">${ICON.key}Officer Accounts</h2>
    <p class="subtext">Create and manage sign-ins for Vice Mayor, Treasurer, and Auditor.</p>
    <div class="fab-row"><div></div><button class="btn-sm gold" id="tr_addAccountBtn">${ICON.plus}Add Account</button></div>
    <div class="card">
      ${trState.accounts.map(a=>`
        <div class="list-item">
          <div class="tx-icon">${a.role==='mayor'?ICON.crown:a.role==='vice_mayor'?ICON.shield:a.role==='treasurer'?ICON.cash:ICON.checklist}</div>
          <div class="li-main"><b>${escapeHtml(a.name)}</b><span>@${escapeHtml(a.username)} · ${escapeHtml(roleLabel(a.role))}</span></div>
          <div style="display:flex;gap:6px;">
            <button class="btn-sm ghost" data-reset-pass="${a.id}" style="padding:6px 8px;">${ICON.key}</button>
            ${a.id!==trState.session.accountId?`<button class="btn-sm danger" data-del-account="${a.id}" style="padding:6px 8px;">${ICON.trash}</button>`:''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
function attachAccountsEvents(){
  const saveDuesBtn = document.getElementById('tr_saveDuesBtn');
  if(saveDuesBtn) saveDuesBtn.onclick = async ()=>{
    const val = parseFloat(document.getElementById('tr_duesAmountInput').value);
    if(isNaN(val) || val<0){ showToast('Enter a valid amount'); return; }
    trState.duesAmount = val;
    lastSyncedRaw['treasury_dues_amount'] = JSON.stringify(val);
    await saveShared('treasury_dues_amount', val);
    showToast('Dues amount updated');
    trRenderCurrent();
  };
  const addBtn = document.getElementById('tr_addAccountBtn');
  if(addBtn) addBtn.onclick = ()=>{ trState.modal={type:'account', data:{name:'',username:'',role:'treasurer'}}; trRenderCurrent(); };
  document.querySelectorAll('[data-reset-pass]').forEach(b=>{
    b.onclick = ()=>{
      const a = trState.accounts.find(x=>x.id===b.dataset.resetPass);
      trState.modal={type:'resetpass', data:{id:a.id, name:a.name, username:a.username}};
      trRenderCurrent();
    };
  });
  document.querySelectorAll('[data-del-account]').forEach(b=>{
    b.onclick = async ()=>{
      const target = trState.accounts.find(a=>a.id===b.dataset.delAccount);
      if(!confirm(`Remove the account for "${target.name}"?`)) return;
      let blocked = false;
      await mutateShared('treasury_accounts', latest=>{
        const mayorCount = latest.filter(a=>a.role==='mayor').length;
        if(target.role==='mayor' && mayorCount<=1){ blocked=true; return latest; }
        return latest.filter(a=>a.id!==target.id);
      });
      if(blocked){ showToast("Can't remove the only Mayor account"); return; }
      showToast('Account removed');
      trRenderCurrent();
    };
  });
}


/* ============== MODALS ============== */
function renderModal(){
  const back = document.createElement('div');
  back.className='modal-back';
  back.id='modalBack';
  let inner='';
  if(trState.modal.type==='account'){
    const d = trState.modal.data;
    inner = `
      <button class="close-x" id="tr_modalClose">${ICON.x}</button>
      <h2 class="section-title">Add Account</h2>
      <div class="field"><label>Full Name</label><input id="tr_m_acc_name" value="${escapeHtml(d.name||'')}" placeholder="e.g. Maria Santos"/></div>
      <div class="field"><label>Username</label><input id="tr_m_acc_username" value="${escapeHtml(d.username||'')}" placeholder="e.g. maria.santos" autocapitalize="off"/></div>
      <div class="field"><label>Starting Password</label><input type="password" id="tr_m_acc_password" placeholder="At least 4 characters"/></div>
      <div class="field">
        <label>Role</label>
        <select id="tr_m_acc_role">
          <option value="treasurer" ${d.role==='treasurer'?'selected':''}>Treasurer</option>
          <option value="vice_mayor" ${d.role==='vice_mayor'?'selected':''}>Vice Mayor</option>
          <option value="auditor" ${d.role==='auditor'?'selected':''}>Auditor</option>
          <option value="mayor" ${d.role==='mayor'?'selected':''}>Mayor</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="tr_modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="tr_modalSave">Create Account</button>
      </div>`;
  } else if(trState.modal.type==='resetpass'){
    const d = trState.modal.data;
    inner = `
      <button class="close-x" id="tr_modalClose">${ICON.x}</button>
      <h2 class="section-title">Reset Password</h2>
      <p class="subtext">Set a new password for ${escapeHtml(d.name)} (@${escapeHtml(d.username)}).</p>
      <div class="field"><label>New Password</label><input type="password" id="tr_m_reset_password" placeholder="At least 4 characters"/></div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="tr_modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="tr_modalSave">Save New Password</button>
      </div>`;
  } else if(trState.modal.type==='selfpass'){
    inner = `
      <button class="close-x" id="tr_modalClose">${ICON.x}</button>
      <h2 class="section-title">Change Password</h2>
      <div class="field"><label>Current Password</label><input type="password" id="tr_m_cur_password"/></div>
      <div class="field"><label>New Password</label><input type="password" id="tr_m_new_password" placeholder="At least 4 characters"/></div>
      <div class="modal-actions">
        <button class="btn-sm ghost" id="tr_modalCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="btn-primary" id="tr_modalSave">Update Password</button>
      </div>`;
  }
  back.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(back);
  document.getElementById('tr_modalClose').onclick = closeModal;
  const modalCancelBtn = document.getElementById('tr_modalCancel');
  if(modalCancelBtn) modalCancelBtn.onclick = closeModal;
  back.onclick = (e)=>{ if(e.target===back) closeModal(); };
  document.getElementById('tr_modalSave').onclick = saveModal;
}
function closeModal(){ trState.modal=null; trRenderCurrent(); }
async function saveModal(){
  const type = trState.modal.type;
  const d = trState.modal.data;
  if(type==='account'){
    const name = document.getElementById('tr_m_acc_name').value.trim();
    const username = document.getElementById('tr_m_acc_username').value.trim();
    const password = document.getElementById('tr_m_acc_password').value;
    const role = document.getElementById('tr_m_acc_role').value;
    if(!name || !username || !password){ showToast('Please fill in every field'); return; }
    if(password.length<4){ showToast('Password must be at least 4 characters'); return; }
    const passwordHash = await hashPassword(username, password);
    let taken = false;
    await mutateShared('treasury_accounts', latest=>{
      if(latest.some(a=>a.username.toLowerCase()===username.toLowerCase())){ taken=true; return latest; }
      latest.push({id:'acc_'+Date.now(), name, username, role, passwordHash});
      return latest;
    });
    if(taken){ showToast('That username is already taken'); return; }
    showToast('Account created');
    trState.modal=null;
    trRenderCurrent();
  } else if(type==='resetpass'){
    const password = document.getElementById('tr_m_reset_password').value;
    if(!password || password.length<4){ showToast('Password must be at least 4 characters'); return; }
    const passwordHash = await hashPassword(d.username, password);
    let found = true;
    await mutateShared('treasury_accounts', latest=>{
      const acc = latest.find(a=>a.id===d.id);
      if(!acc){ found=false; return latest; }
      acc.passwordHash = passwordHash;
      return latest;
    });
    showToast(found ? 'Password updated' : 'That account was removed elsewhere');
    trState.modal=null;
    trRenderCurrent();
  } else if(type==='selfpass'){
    const cur = document.getElementById('tr_m_cur_password').value;
    const next = document.getElementById('tr_m_new_password').value;
    if(!next || next.length<4){ showToast('New password must be at least 4 characters'); return; }
    const curHash = await hashPassword(trState.session.username, cur);
    const acc = trState.accounts.find(a=>a.id===trState.session.accountId);
    if(!acc || acc.passwordHash!==curHash){ showToast('Current password is incorrect'); return; }
    const nextHash = await hashPassword(trState.session.username, next);
    await mutateShared('treasury_accounts', latest=>{
      const a = latest.find(x=>x.id===trState.session.accountId);
      if(a) a.passwordHash = nextHash;
      return latest;
    });
    showToast('Password updated');
    trState.modal=null;
    trRenderCurrent();
  }
}


/* ============== Embedded shell (replaces the standalone topbar/navbar —
   Alpha Watch already provides the surrounding chrome) ============== */
function trNavBtn(id,label,icon){ return `<button type="button" data-tr-tab="${id}" class="${trState.tab===id?'sel':''}">${icon}${label}</button>`; }
function trNavForRole(role){
  const tabs = [ trNavBtn('dashboard','Dashboard',ICON.home) ];
  if(role==='mayor' || role==='treasurer') tabs.push(trNavBtn('log','Log Entry',ICON.plus));
  tabs.push(trNavBtn('ledger','Ledger',ICON.list));
  tabs.push(trNavBtn('liquidation','Liquidation',ICON.checklist));
  if(role==='mayor') tabs.push(trNavBtn('accounts','Accounts',ICON.key));
  return tabs.join('');
}
function trAppHTML(){
  const role = trState.session.role;
  let body;
  if(trState.tab==='dashboard') body = currentDashboardHTML();
  else if(trState.tab==='log' && (role==='mayor'||role==='treasurer')) body = logHTML();
  else if(trState.tab==='ledger') body = ledgerHTML();
  else if(trState.tab==='liquidation') body = liquidationReportHTML(true);
  else if(trState.tab==='accounts' && role==='mayor') body = accountsHTML();
  else body = currentDashboardHTML();
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="logo-chip" style="width:38px;height:38px;">${ICON.chest}</div>
        <div>
          <div style="font-family:'Cinzel',serif;font-size:12px;letter-spacing:1px;color:var(--ink-soft);">ALPHA TREASURY</div>
          <b style="font-size:14px;">${escapeHtml(roleLabel(role))} · ${escapeHtml(trState.session.name)}</b>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="tr_changePassBtn" class="btn-sm ghost">${ICON.key}Password</button>
        <button id="tr_logoutBtn" class="btn-sm ghost">Sign Out</button>
      </div>
    </div>
    <div class="tr-nav-tabs" id="tr_navTabs">${trNavForRole(role)}</div>
    <div class="view-enter">${body}</div>
  `;
}
function trAttachAppEvents(){
  document.querySelectorAll('#tr_navTabs button').forEach(b=>{ b.onclick = ()=>{ trState.tab=b.dataset.trTab; trState.modal=null; trRenderCurrent(); }; });
  const cp = document.getElementById('tr_changePassBtn'); if(cp) cp.onclick = ()=>{ trState.modal={type:'selfpass', data:{}}; trRenderCurrent(); };
  const lo = document.getElementById('tr_logoutBtn'); if(lo) lo.onclick = trDoLogout;
  if(trState.tab==='log') attachLogEvents();
  if(trState.tab==='ledger') attachLedgerEvents();
  if(trState.tab==='liquidation') attachLiquidationEvents(true);
  if(trState.tab==='accounts' && trState.session.role==='mayor') attachAccountsEvents();
  if(trState.tab==='dashboard') attachDashboardEvents();
}
async function trDoLogout(){
  trState.session=null; trState.screen='gate'; trState._loginError=null;
  await savePersonal('treasury_session', null);
  trRenderCurrent();
}

/* ============== Render / boot / mount ============== */
let trContainer = null;
let trInited = false;
let trLastSyncedRaw = {};
const TR_STATE_KEY_FOR = { treasury_accounts:'accounts', treasury_transactions:'transactions', treasury_dues_amount:'duesAmount', treasury_liquidation_notes:'liquidationNotes' };
// NOTE: this is deliberately NOT called immediately here. treasury-embed.js
// and sync.js import from each other (a circular dependency), so at the
// moment this module first loads, sync.js hasn't necessarily finished
// initializing makeMutateShared yet — calling it right away throws
// "Cannot access 'makeMutateShared' before initialization" and crashes the
// entire app's module graph (this was the "Alpha Watch not loading" bug).
// Deferring the call to first use (well after all modules have loaded)
// avoids that entirely.
let _mutateShared = null;
function mutateShared(key, mutator){
  if(!_mutateShared) _mutateShared = makeMutateShared(trState, TR_STATE_KEY_FOR);
  return _mutateShared(key, mutator);
}

function trRenderCurrent(){
  if(!trContainer) return;
  if(trState.screen==='loading'){
    trContainer.innerHTML = `<div style="text-align:center;padding:50px 16px;color:var(--ink-soft);">
      <div style="width:44px;height:44px;margin:0 auto 14px;color:var(--gold-dim);">${ICON.chest}</div>
      Loading Alpha Treasury…
    </div>`;
    return;
  }
  if(trState.screen==='setup'){ trContainer.innerHTML = setupHTML(); attachSetupEvents(); return; }
  if(trState.screen==='gate'){ trContainer.innerHTML = gateHTML(); attachGateEvents(); return; }
  trState.roster = state.roster || []; // always read the latest roster from Watch — Treasury doesn't own this data
  trContainer.innerHTML = trAppHTML();
  trAttachAppEvents();
  if(trState.modal) renderModal();
}

async function trBoot(){
  const [accounts, transactions, duesAmount, liquidationNotes, session] = await Promise.all([
    loadShared('treasury_accounts', []),
    loadShared('treasury_transactions', []),
    loadShared('treasury_dues_amount', 100),
    loadShared('treasury_liquidation_notes', {}),
    loadPersonal('treasury_session', null),
  ]);
  trState.accounts = accounts || [];
  trState.transactions = transactions || [];
  trState.duesAmount = (typeof duesAmount==='number') ? duesAmount : 100;
  trState.liquidationNotes = liquidationNotes || {};
  trLastSyncedRaw = {
    treasury_accounts: JSON.stringify(trState.accounts),
    treasury_transactions: JSON.stringify(trState.transactions),
    treasury_dues_amount: JSON.stringify(trState.duesAmount),
    treasury_liquidation_notes: JSON.stringify(trState.liquidationNotes),
  };
  if(trState.accounts.length===0){
    trState.screen = 'setup';
  } else {
    const acc = session && session.accountId ? trState.accounts.find(a=>a.id===session.accountId) : null;
    if(acc){
      trState.session = {name:acc.name, role:acc.role, username:acc.username, accountId:acc.id};
      trState.screen = 'app';
    } else {
      trState.screen = 'gate';
    }
  }
  trRenderCurrent();
}

// Treasurer dashboard's "Log an entry" CTA (data-goto-log) — scoped to clicks
// that originate inside the mounted Treasury container.
document.addEventListener('click', (e)=>{
  const goto = e.target.closest && e.target.closest('[data-goto-log]');
  if(goto && trContainer && trContainer.contains(goto)){ trState.tab='log'; trRenderCurrent(); }
});

function mount(container){
  trContainer = container;
  if(!trInited){
    trInited = true;
    trRenderCurrent(); // show the loading placeholder immediately
    trBoot();
    return;
  }
  trRenderCurrent();
}

// Routes shared_data changes for treasury_* keys (realtime + polling) from
// Watch's existing sync machinery into this module's own state.
function applyRemoteUpdate(key, value){
  const stateKey = TR_STATE_KEY_FOR[key];
  if(!stateKey) return;
  trLastSyncedRaw[key] = JSON.stringify(value);
  trState[stateKey] = value;
  if(trState.modal) return; // don't yank the rug out from under an open modal
  trRenderCurrent();
}

export const Treasury = {
  mount,
  applyRemoteUpdate,
  syncKeys: Object.keys(TR_STATE_KEY_FOR),
};
