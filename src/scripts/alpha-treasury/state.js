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
  periods: [], // closed collection periods — see closeCurrentPeriod() below
  beginningBalance: { amount: 0, fromPeriodName: null }, // carried forward from the most recently closed period
  qrCollections: [], // raw rows from qr_collections_public — the NEW QR/Supabase-Auth collection system's data, merged read-only into totals/ledger alongside the classic `transactions` list (see mappedQrCollections below). Never mutated by this app — that system owns it.
  toast: null,
  modal: null, // {type:'account'|'resetpass'|'selfpass'|'closeperiod'|'studenthistory', data:{...}}
  search: '',
  typeFilter: 'all',
  statusFilter: 'all',
  publicTab: 'overview', // overview | liquidation | contributions | periods
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
  treasury_periods: 'periods',
  treasury_beginning_balance: 'beginningBalance',
};

export const SYNC_KEYS = ['treasury_accounts', 'treasury_transactions', 'roster', 'treasury_dues_amount', 'treasury_liquidation_notes', 'treasury_periods', 'treasury_beginning_balance'];

/* ---- QR collections (new system) merged in as read-only entries -----
   Each row from qr_collections_public gets reshaped into the same
   {type, status, category, amount, studentId, ...} object the rest of
   this file already works with, so every existing total/filter "just
   works" without knowing two systems exist. studentId is resolved by
   matching the QR system's student name against the Alpha Watch roster
   (the two systems don't share IDs). A row that can't be matched still
   counts toward totals — it just won't attribute to one student. */
function matchRosterIdByName(name) {
  if (!name) return null;
  const norm = name.trim().toLowerCase();
  const hit = state.roster.find(s => (s.name || '').trim().toLowerCase() === norm);
  return hit ? hit.id : null;
}
export function mappedQrCollections() {
  return (state.qrCollections || []).map(row => ({
    id: 'qr_' + row.id,
    type: 'collection',
    status: 'approved',
    verified: true,
    source: 'qr',
    category: row.transaction_type === 'recurring' ? 'Class Dues' : (row.purpose || 'Contribution'),
    amount: Number(row.amount) || 0,
    studentId: matchRosterIdByName(row.student_name),
    payer: row.student_name || '',
    date: (row.collected_at || '').slice(0, 10),
    time: (row.collected_at || '').slice(11, 16),
    note: [row.remarks, row.payment_mode === 'gcash' ? 'Paid via GCash' : 'Paid via Cash'].filter(Boolean).join(' — '),
    recordedBy: 'QR Scan & Collect',
    receipt: null,
  }));
}
export function allCollectionsForDisplay() { return approvedOf('collection').concat(mappedQrCollections()); }
export function allTransactionsForDisplay() { return state.transactions.concat(mappedQrCollections()); }

/* ---- Derived totals ---- */
export function approvedOf(type) { return state.transactions.filter(t => t.status === 'approved' && t.type === type); }
export function totalCollections() { return allCollectionsForDisplay().reduce((s, t) => s + t.amount, 0); }
export function totalExpenses() { return approvedOf('expense').reduce((s, t) => s + t.amount, 0); }
export function currentBalance() { return (state.beginningBalance?.amount || 0) + totalCollections() - totalExpenses(); }
export function pendingCount() { return state.transactions.filter(t => t.status === 'pending').length; }
export function unverifiedApprovedCount() { return state.transactions.filter(t => t.status === 'approved' && !t.verified).length; }

/* ---- Per-student dues (Class Dues category only, approved entries only) ---- */
export function getStudentDuesPaid(studentId) {
  return allCollectionsForDisplay()
    .filter(t => t.category === 'Class Dues' && t.studentId === studentId)
    .reduce((s, t) => s + t.amount, 0);
}
export function getStudentOtherContributions(studentId) {
  return allCollectionsForDisplay()
    .filter(t => t.category !== 'Class Dues' && t.studentId === studentId)
    .reduce((s, t) => s + t.amount, 0);
}
export function getStudentDuesStatus(studentId) {
  const paid = getStudentDuesPaid(studentId);
  if (paid <= 0) return 'unpaid';
  if (paid >= state.duesAmount) return 'paid';
  return 'partial';
}

/* ---- Liquidation report: group approved expenses by purpose/event ----
   groupExpensesByPurpose() takes an explicit transaction list so it can be
   reused for both the live ledger (getExpenseGroups) and an archived
   period's frozen transaction snapshot (see periodsHTML in screens.js). */
export const GENERAL_PURPOSE_LABEL = 'General / Unspecified Expenses';
export function purposeLabelOf(t) { const p = (t.purpose || '').trim(); return p || GENERAL_PURPOSE_LABEL; }
export function groupExpensesByPurpose(expenseList) {
  const map = new Map();
  expenseList.forEach(t => {
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
export function getExpenseGroups() { return groupExpensesByPurpose(approvedOf('expense')); }

/* ---- Collections, folder-grouped by category (Class Dues, Contribution, etc.) ----
   Used for a closed period's archived collections list so it reads as
   organized folders rather than one long flat chronological list. */
export function groupCollectionsByCategory(collectionList) {
  const map = new Map();
  collectionList.forEach(t => {
    const label = t.category || 'Other';
    const key = label.toLowerCase();
    if (!map.has(key)) map.set(key, { key, label, entries: [], total: 0 });
    const g = map.get(key);
    g.entries.push(t);
    g.total += t.amount;
  });
  return Array.from(map.values())
    .map(g => ({ ...g, entries: g.entries.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)) }))
    .sort((a, b) => b.total - a.total);
}

/* ---- Collection periods ----
   A "period" is a frozen snapshot of everything approved so far: the full
   transaction list, the totals, each student's dues/other contribution
   totals, and the liquidation narratives as they stood. Pending items are
   NOT included — they carry forward untouched into the new active period. */
export function buildPeriodPreview() {
  const collections = approvedOf('collection');
  const expenses = approvedOf('expense');
  const collectionsTotal = collections.reduce((s, t) => s + t.amount, 0);
  const expensesTotal = expenses.reduce((s, t) => s + t.amount, 0);
  const beginning = state.beginningBalance?.amount || 0;
  return {
    beginningBalance: beginning,
    collectionsTotal,
    expensesTotal,
    endingBalance: beginning + collectionsTotal - expensesTotal,
    approvedCount: collections.length + expenses.length,
    rejectedCount: state.transactions.filter(t => t.status === 'rejected').length,
    pendingCount: pendingCount(),
  };
}
export function getStudentPeriodHistory(studentId) {
  return state.periods
    .filter(p => p.perStudent && p.perStudent[studentId])
    .map(p => ({ periodId: p.id, name: p.name, closedAt: p.closedAt, ...p.perStudent[studentId] }));
}
export function buildClosedPeriodRecord(name, closedByName) {
  const collections = approvedOf('collection');
  const expenses = approvedOf('expense');
  const rejected = state.transactions.filter(t => t.status === 'rejected');
  const collectionsTotal = collections.reduce((s, t) => s + t.amount, 0);
  const expensesTotal = expenses.reduce((s, t) => s + t.amount, 0);
  const beginningBalance = state.beginningBalance?.amount || 0;
  // Deliberately NOT getStudentDuesPaid/getStudentOtherContributions here —
  // those now include merged QR collections, but this period only archives
  // (and clears) the classic `transactions` list. Using the merged getters
  // would record QR money as "archived" here while it stays live elsewhere.
  const perStudent = {};
  state.roster.forEach(s => {
    const dues = collections.filter(t => t.category === 'Class Dues' && t.studentId === s.id).reduce((sum, t) => sum + t.amount, 0);
    const other = collections.filter(t => t.category !== 'Class Dues' && t.studentId === s.id).reduce((sum, t) => sum + t.amount, 0);
    if (dues + other > 0) perStudent[s.id] = { dues, other, total: dues + other };
  });
  return {
    id: 'period_' + Date.now(),
    name,
    closedAt: new Date().toISOString(),
    closedBy: closedByName,
    beginningBalance,
    collectionsTotal,
    expensesTotal,
    endingBalance: beginningBalance + collectionsTotal - expensesTotal,
    transactions: collections.concat(expenses, rejected),
    perStudent,
    liquidationNotes: { ...(state.liquidationNotes || {}) },
  };
}
