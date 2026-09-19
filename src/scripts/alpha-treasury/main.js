/* Alpha Treasury — main.js
   Boot sequence: hydrate state from Supabase + localStorage, start live
   sync, decide which screen to land on, then do the first render. This is
   the entry point loaded by <script type="module"> in alpha-treasury.html.

   Officer accounts run on Supabase Auth + the officer_roles table now,
   not the old treasury_accounts blob — see fetchOfficerRoles/getCurrentAuthUser
   in sync.js. That old key is intentionally never read here anymore. */
import { state } from './state.js?v=4';
import { render } from './router.js?v=4';
import { loadShared, subscribeRealtime, startSyncPolling, setLastSyncedRaw, fetchQrCollections, fetchOfficerRoles, getCurrentAuthUser } from './sync.js?v=9';

/* Extra wiring for the treasurer dashboard CTA */
document.addEventListener('click', (e) => {
  const goto = e.target.closest && e.target.closest('[data-goto-log]');
  if (goto) { state.tab = 'log'; render(); }
});

async function init() {
  const [transactions, roster, duesAmount, liquidationNotes, periods, beginningBalance, officerRoles, authUser] = await Promise.all([
    loadShared('treasury_transactions', []),
    loadShared('roster', []),
    loadShared('treasury_dues_amount', 100),
    loadShared('treasury_liquidation_notes', {}),
    loadShared('treasury_periods', []),
    loadShared('treasury_beginning_balance', { amount: 0, fromPeriodName: null }),
    fetchOfficerRoles(),
    getCurrentAuthUser(),
  ]);
  state.transactions = transactions;
  state.roster = roster || [];
  state.duesAmount = (typeof duesAmount === 'number') ? duesAmount : 100;
  state.liquidationNotes = liquidationNotes || {};
  state.periods = periods || [];
  state.beginningBalance = beginningBalance && typeof beginningBalance === 'object' ? beginningBalance : { amount: 0, fromPeriodName: null };
  state.officerRoles = officerRoles || [];
  setLastSyncedRaw({
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

  if (authUser) {
    const mine = state.officerRoles.find(r => r.user_id === authUser.id);
    if (mine && mine.role && mine.role !== 'pending') {
      const role = mine.role === 'admin' ? 'mayor' : mine.role;
      state.session = { name: mine.full_name || authUser.email, role, username: mine.email || authUser.email, accountId: authUser.id, email: authUser.email };
      state.screen = 'app';
    } else {
      state.screen = 'pending';
    }
  } else {
    state.screen = 'gate';
  }
  if (location.hash.replace('#', '').toLowerCase() === 'public') {
    state.screen = 'public';
  }
  render();
}

init();
