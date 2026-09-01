/* Alpha Watch — main.js
   Boot sequence: hydrate state from Supabase + localStorage, start live
   sync, decide which screen to land on, then do the first render. This is
   the entry point loaded by <script type="module"> in alpha-watch.html. */
import { state } from './state.js';
import { DEFAULT_STANDARD } from './constants.js';
import { render } from './router.js';
import { loadShared, saveShared, loadPersonal, subscribeRealtime, startSyncPolling, setLastSyncedRaw } from './sync.js';

async function init(){
  const [roster, standard, ledger, accounts, session] = await Promise.all([
    loadShared('roster', []),
    loadShared('standard', DEFAULT_STANDARD),
    loadShared('ledger', []),
    loadShared('accounts', []),
    loadPersonal('session', null),
  ]);
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
  subscribeRealtime();
  startSyncPolling();

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
