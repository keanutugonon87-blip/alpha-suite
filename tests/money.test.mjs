import test from 'node:test';
import assert from 'node:assert/strict';
import { ymManila, net, balanceAt, owedOn, percentPaid, needsSecond, findDuplicate } from '../src/app/money.js';

const e = (kind, amount, at, extra = {}) => ({ kind, amount, occurred_at: at, status: 'approved', ...extra });

test('month is read in Manila time, not UTC', () => {
  assert.equal(ymManila('2026-09-30T17:00:00Z'), '2026-10');   // 1 AM on Oct 1 in Manila
  assert.equal(ymManila('2026-09-30T15:59:00Z'), '2026-09');
});

test('net adds collections and subtracts expenses', () => {
  assert.equal(net([e('collection', 150, '2026-10-01'), e('expense', '40.5', '2026-10-02'), e('collection', '10', '2026-10-03')]), 119.5);
});

test('balanceAt counts only approved entries up to the month, plus the first opening balance', () => {
  const periods = [{ opened_at: '2026-09-02', opening_balance: 100 }, { opened_at: '2026-08-01', opening_balance: 50 }];
  const list = [e('collection', 200, '2026-08-20T04:00:00Z'), e('expense', 30, '2026-09-10T04:00:00Z'), e('collection', 999, '2026-10-02T04:00:00Z'),
    e('collection', 500, '2026-09-11T04:00:00Z', { status: 'pending' }), e('collection', 500, '2026-09-12T04:00:00Z', { status: 'voided' })];
  assert.equal(balanceAt(list, periods, '2026-09'), 50 + 200 - 30);
  assert.equal(balanceAt(list, periods, '2026-10'), 50 + 200 - 30 + 999);
  assert.equal(balanceAt([], [], '2026-10'), 0);
});

test('owed never goes below zero and progress stays between 0 and 100', () => {
  assert.equal(owedOn(150, 50), 100); assert.equal(owedOn(150, 200), 0); assert.equal(owedOn('150', '0'), 150);
  assert.equal(percentPaid(50, 150), 33); assert.equal(percentPaid(200, 150), 100); assert.equal(percentPaid(10, 0), 0);
});

test('second approval applies to big manual expenses only', () => {
  assert.ok(needsSecond({ kind: 'expense', amount: 500, source: 'manual' }, 500));
  assert.ok(!needsSecond({ kind: 'expense', amount: 499.99, source: 'manual' }, 500));
  assert.ok(!needsSecond({ kind: 'collection', amount: 900 }, 500));
  assert.ok(!needsSecond({ kind: 'expense', amount: 900, source: 'migrated' }, 500));
  assert.ok(!needsSecond({ kind: 'expense', amount: 900 }, 0));
});

test('duplicate payments are spotted within the window only', () => {
  const now = Date.parse('2026-10-14T08:00:00Z'), mins = m => new Date(now - m * 60000).toISOString();
  const old = [{ kind: 'collection', amount: 150, member_id: 'a', charge_id: 'c1', status: 'approved', occurred_at: mins(5) }];
  assert.ok(findDuplicate(old, { kind: 'collection', amount: '150', member_id: 'a', charge_id: 'c1' }, now));
  assert.equal(findDuplicate(old, { kind: 'collection', amount: 150, member_id: 'b', charge_id: 'c1' }, now), null);
  assert.equal(findDuplicate(old, { kind: 'collection', amount: 150, member_id: 'a', charge_id: 'c2' }, now), null);
  assert.equal(findDuplicate([{ ...old[0], occurred_at: mins(40) }], { kind: 'collection', amount: 150, member_id: 'a', charge_id: 'c1' }, now), null);
  assert.equal(findDuplicate([{ ...old[0], status: 'voided' }], { kind: 'collection', amount: 150, member_id: 'a', charge_id: 'c1' }, now), null);
  assert.ok(findDuplicate([{ kind: 'expense', amount: 80, payer_name: ' Printing Shop ', occurred_at: mins(2), status: 'pending' }], { kind: 'expense', amount: 80, payer_name: 'printing shop' }, now));
});
