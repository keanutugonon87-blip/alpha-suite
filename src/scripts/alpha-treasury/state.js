/* Alpha Treasury — state.js
   The single mutable state object (imported by reference everywhere — it's
   never reassigned wholesale, only mutated in place, so a live ES module
   binding works fine here) plus the derived/business-logic getters that
   read from it. */

export const state = {
  screen: 'loading', // loading | setup | gate | app | public
  tab: 'dashboard',
  session: null, // {name, role, username, accountId}
  accounts: [],
  transactions: [],
  roster: [], // read-only here — owned by Alpha Watch
  duesAmount: 100,
  liquidationNotes: {}, // {purposeKey: narrative text} — written reports of fund use, per expense purpose
  toast: null,
  modal: null, // {type:'account'|'resetpass'|'selfpass', data:{...}}
  search: '',
  typeFilter: 'all',
  statusFilter: 'all',
  publicTab: 'overview', // overview | liquidation | contributions
  liqView: 'grouped', // grouped | full
  _setupError: null,
  _loginError: null,
};

export const loginLockout = { attempts: 0, until: 0 };

// Maps a shared_data storage key to the state property it hydrates, since
// Treasury's storage keys (treasury_accounts, treasury_transactions) are
// prefixed to avoid colliding with Alpha Watch's keys in the same table,
// but the rest of this app just reads state.accounts / state.transactions.
export const STATE_KEY_FOR = {
  treasury_accounts: 'accounts',
  treasury_transactions: 'transactions',
  roster: 'roster',
  treasury_dues_amount: 'duesAmount',
  treasury_liquidation_notes: 'liquidationNotes',
};

export const SYNC_KEYS = ['treasury_accounts', 'treasury_transactions', 'roster', 'treasury_dues_amount', 'treasury_liquidation_notes'];

/* ---- Derived totals ---- */
export function approvedOf(type) { return state.transactions.filter(t => t.status === 'approved' && t.type === type); }
export function totalCollections() { return approvedOf('collection').reduce((s, t) => s + t.amount, 0); }
export function totalExpenses() { return approvedOf('expense').reduce((s, t) => s + t.amount, 0); }
export function currentBalance() { return totalCollections() - totalExpenses(); }
export function pendingCount() { return state.transactions.filter(t => t.status === 'pending').length; }
export function unverifiedApprovedCount() { return state.transactions.filter(t => t.status === 'approved' && !t.verified).length; }

/* ---- Per-student dues (Class Dues category only, approved entries only) ---- */
export function getStudentDuesPaid(studentId) {
  return state.transactions
    .filter(t => t.status === 'approved' && t.type === 'collection' && t.category === 'Class Dues' && t.studentId === studentId)
    .reduce((s, t) => s + t.amount, 0);
}
export function getStudentOtherContributions(studentId) {
  return state.transactions
    .filter(t => t.status === 'approved' && t.type === 'collection' && t.category !== 'Class Dues' && t.studentId === studentId)
    .reduce((s, t) => s + t.amount, 0);
}
export function getStudentDuesStatus(studentId) {
  const paid = getStudentDuesPaid(studentId);
  if (paid <= 0) return 'unpaid';
  if (paid >= state.duesAmount) return 'paid';
  return 'partial';
}

/* ---- Liquidation report: group approved expenses by purpose/event ---- */
export const GENERAL_PURPOSE_LABEL = 'General / Unspecified Expenses';
export function purposeLabelOf(t) { const p = (t.purpose || '').trim(); return p || GENERAL_PURPOSE_LABEL; }
export function getExpenseGroups() {
  const map = new Map();
  approvedOf('expense').forEach(t => {
    const label = purposeLabelOf(t);
    const key = label.toLowerCase();
    if (!map.has(key)) map.set(key, { key, label, entries: [], total: 0 });
    const g = map.get(key);
    g.entries.push(t);
    g.total += t.amount;
  });
  return Array.from(map.values())
    .map(g => ({ ...g, entries: g.entries.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)) }))
    .sort((a, b) => (a.label === GENERAL_PURPOSE_LABEL) - (b.label === GENERAL_PURPOSE_LABEL) || b.total - a.total);
}
