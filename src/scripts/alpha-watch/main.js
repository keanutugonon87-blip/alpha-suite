/* Alpha Watch — main.js
   Boot sequence: hydrate state from Supabase + localStorage, start live
   sync, decide which screen to land on, then do the first render. This is
   the entry point loaded by <script type="module"> in alpha-watch.html. */
import { state } from './state.js?v=1';
import { DEFAULT_STANDARD } from './constants.js?v=2';
import { render } from './router.js?v=1';
import { loadShared, loadSharedStrict, saveShared, loadPersonal, subscribeRealtime, startSyncPolling, setLastSyncedRaw, checkConnectivity } from './sync.js?v=5';

let liveSyncStarted = false;

// The "no accounts yet" setup screen is destructive if shown by mistake —
// submitting it overwrites whatever's actually in the accounts table. A
// single failed read shouldn't be enough to trigger it, so retry a few
// times (short backoff) before concluding the table is genuinely empty
// rather than just temporarily unreachable.
async function loadAccountsReliably(){
  const maxAttempts = 3;
  for(let attempt = 1; attempt <= maxAttempts; attempt++){
    const result = await loadSharedStrict('accounts', []);
    if(result.ok) return result;
    if(attempt < maxAttempts) await new Promise(r => setTimeout(r, 600 * attempt));
  }
  return { value: [], ok: false };
}

async function init(){
  state.screen = 'loading';
  render();

  const online = await checkConnectivity();
  if(!online){
    state.screen = 'load-error';
    state.onRetryLoad = init;
    render();
    return;
  }

  const [roster, standard, ledger, accountsResult, session] = await Promise.all([
    loadShared('roster', []),
    loadShared('standard', DEFAULT_STANDARD),
    loadShared('ledger', []),
    loadAccountsReliably(),
    loadPersonal('session', null),
  ]);
  if(!accountsResult.ok){
    // Every attempt failed — this is a real connectivity/read problem, not
    // an empty table. Show the same retry screen as the checkConnectivity
    // failure above rather than risking the setup screen overwriting a
    // real account.
    state.screen = 'load-error';
    state.onRetryLoad = init;
    render();
    return;
  }
  const accounts = accountsResult.value;
  state.roster = roster;
  state.standard = standard && standard.length ? standard : DEFAULT_STANDARD;
  state.ledger = ledger;
  state.accounts = accounts;
  setLastSyncedRaw({
    roster: JSON.stringify(state.roster),
    standard: JSON.stringify(state.standard),
    ledger: JSON.stringify(state.ledger),
    accounts: JSON.stringify(state.accounts),
  });
  if(!standard || !standard.length) await saveShared('standard', DEFAULT_STANDARD);
  if(!liveSyncStarted){
    liveSyncStarted = true;
    subscribeRealtime();
    startSyncPolling();
  }

  if(!accounts || accounts.length===0){
    state.screen = 'setup';
  } else {
    const acc = session && session.accountId ? accounts.find(a=>a.id===session.accountId) : null;
    if(acc){
      // re-hydrate from the account record in case the Mayor changed name/role since last visit
      state.session = {name:acc.name, role:acc.role, username:acc.username, accountId:acc.id};
      state.screen = 'app';
    } else {
      state.screen = 'gate';
    }
  }
  // A direct #public link works regardless of login state, so it can be shared with the whole class.
  if(location.hash.replace('#','').toLowerCase()==='public'){
    state.screen = 'public';
  }
  render();
}

// Close any open searchable-combo dropdown when clicking elsewhere
document.addEventListener('click', (e)=>{
  document.querySelectorAll('.combo-list').forEach(list=>{
    const combo = list.closest('.combo');
    if(combo && !combo.contains(e.target)) list.style.display='none';
  });
});

init();
