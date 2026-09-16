/* Alpha Treasury — main.js
   Boot sequence: hydrate state from Supabase + localStorage, start live
   sync, decide which screen to land on, then do the first render. This is
   the entry point loaded by <script type="module"> in alpha-treasury.html. */
import { state } from './state.js?v=3';
import { render } from './router.js?v=3';
import { loadShared, loadPersonal, subscribeRealtime, startSyncPolling, setLastSyncedRaw, fetchQrCollections } from './sync.js?v=8';

/* Extra wiring for the treasurer dashboard CTA */
document.addEventListener('click', (e) => {
  const goto = e.target.closest && e.target.closest('[data-goto-log]');
  if (goto) { state.tab = 'log'; render(); }
});

// loadShared silently falls back to [] on any network hiccup — fine for
// most keys, but treasury_accounts coming back empty triggers the
// "create the Mayor account" Setup screen, which is destructive if
// completed when accounts already exist. A transient blip on this one
// specific load deserves a couple of quick retries before we trust an
// empty result enough to show Setup at all.
async function loadAccountsWithRetry() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const accounts = await loadShared('treasury_accounts', null);
    if (accounts && accounts.length > 0) return accounts;
    if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
  }
  // Genuinely empty (or still failing) after 3 tries — accept it, Setup's
  // own submit-time check is the final backstop against a bad overwrite.
  const last = await loadShared('treasury_accounts', []);
  return last || [];
}

async function init() {
  const [accounts, transactions, roster, duesAmount, liquidationNotes, periods, beginningBalance, session] = await Promise.all([
    loadAccountsWithRetry(),
    loadShared('treasury_transactions', []),
    loadShared('roster', []),
    loadShared('treasury_dues_amount', 100),
    loadShared('treasury_liquidation_notes', {}),
    loadShared('treasury_periods', []),
    loadShared('treasury_beginning_balance', { amount: 0, fromPeriodName: null }),
    loadPersonal('session', null),
  ]);
  state.accounts = accounts;
  state.transactions = transactions;
  state.roster = roster || [];
  state.duesAmount = (typeof duesAmount === 'number') ? duesAmount : 100;
  state.liquidationNotes = liquidationNotes || {};
  state.periods = periods || [];
  state.beginningBalance = beginningBalance && typeof beginningBalance === 'object' ? beginningBalance : { amount: 0, fromPeriodName: null };
  setLastSyncedRaw({
    treasury_accounts: JSON.stringify(state.accounts),
    treasury_transactions: JSON.stringify(state.transactions),
    roster: JSON.stringify(state.roster),
    treasury_dues_amount: JSON.stringify(state.duesAmount),
    treasury_liquidation_notes: JSON.stringify(state.liquidationNotes),
    treasury_periods: JSON.stringify(state.periods),
    treasury_beginning_balance: JSON.stringify(state.beginningBalance),
  });
  state.qrCollections = await fetchQrCollections();

  subscribeRealtime();
  startSyncPolling();
  setInterval(async () => {
    state.qrCollections = await fetchQrCollections();
    if (state.screen === 'app' || state.screen === 'public') render();
  }, 20000);

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
