/* Money rules in one place, so they can be tested. No page code in here. */

/* Calendar month of a moment in Manila time, e.g. "2026-10". */
export const ymManila = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);

/* Collections add to the fund, expenses take away. */
export const signed = e => (e.kind === 'collection' ? +e.amount : -e.amount);
export const net = list => list.reduce((s, e) => s + signed(e), 0);

/* Fund balance at the end of a month: the first period's opening balance plus every approved entry up to and including that month.
   The database function v2__balance_at does the same sum, and a month can only be closed when the two agree. */
export function balanceAt(entries, periods, ym) {
  const first = periods.slice().sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at))[0];
  return (+first?.opening_balance || 0) + net(entries.filter(e => e.status === 'approved' && ymManila(e.occurred_at) <= ym));
}

/* What is still owed on a charge, and how far along the student is (0 to 100). */
export const owedOn = (due, paid) => Math.max(+due - +paid, 0);
export const percentPaid = (paid, due) => (+due > 0 ? Math.max(0, Math.min(100, Math.round((+paid / +due) * 100))) : 0);

/* Expenses at or above the limit need a second officer. A limit of 0 turns the rule off. */
export const needsSecond = (e, limit) => e.kind === 'expense' && +limit > 0 && +e.amount >= +limit && (e.source || 'manual') === 'manual';

/* A payment that looks like the one just recorded: same kind, person or payee, charge and amount, within a few minutes. */
export function findDuplicate(entries, cand, now = Date.now(), minutes = 15) {
  const who = e => e.member_id || (e.payer_name || '').trim().toLowerCase() || null;
  return entries.find(e => e.status !== 'voided' && e.kind === cand.kind && +e.amount === +cand.amount
    && who(e) && who(e) === who(cand) && (e.charge_id || null) === (cand.charge_id || null)
    && now - new Date(e.occurred_at) >= 0 && now - new Date(e.occurred_at) <= minutes * 60000) || null;
}
