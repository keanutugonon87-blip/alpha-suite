/* Alpha Treasury — main.js
   Boot sequence: hydrate state from Supabase + localStorage, start live
   sync, decide which screen to land on, then do the first render. This is
   the entry point loaded by <script type="module"> in alpha-treasury.html. */
import { state } from './state.js';
import { render } from './router.js';
import { loadShared, loadPersonal, subscribeRealtime, startSyncPolling, setLastSyncedRaw } from './sync.js';

/* Extra wiring for the treasurer dashboard CTA */
document.addEventListener('click', (e) => {
  const goto = e.target.closest && e.target.closest('[data-goto-log]');
  if (goto) { state.tab = 'log'; render(); }
});

async function init() {
  const [accounts, transactions, roster, duesAmount, liquidationNotes, session] = await Promise.all([
    loadShared('treasury_accounts', []),
    loadShared('treasury_transactions', []),
    loadShared('roster', []),
    loadShared('treasury_dues_amount', 100),
    loadShared('treasury_liquidation_notes', {}),
    loadPersonal('session', null),
  ]);
  state.accounts = accounts;
  state.transactions = transactions;
  state.roster = roster || [];
  state.duesAmount = (typeof duesAmount === 'number') ? duesAmount : 100;
  state.liquidationNotes = liquidationNotes || {};
  setLastSyncedRaw({
    treasury_accounts: JSON.stringify(state.accounts),
    treasury_transactions: JSON.stringify(state.transactions),
    roster: JSON.stringify(state.roster),
    treasury_dues_amount: JSON.stringify(state.duesAmount),
    treasury_liquidation_notes: JSON.stringify(state.liquidationNotes),
  });
  subscribeRealtime();
  startSyncPolling();

  if (!accounts || accounts.length === 0) {
    state.screen = 'setup';
  } else {
    const acc = session && session.accountId ? accounts.find(a => a.id === session.accountId) : null;
    if (acc) {
      state.session = { name: acc.name, role: acc.role, username: acc.username, accountId: acc.id };
      state.screen = 'app';
    } else {
      state.screen = 'gate';
    }
  }
  if (location.hash.replace('#', '').toLowerCase() === 'public') {
    state.screen = 'public';
  }
  render();
}

init();
