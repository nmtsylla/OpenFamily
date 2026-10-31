import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween, matchPayments } from '../src/custom/lib/expenseCheck.custom';
import { transactionFingerprint, validateTransactions } from '../src/custom/ai/transactions.custom';

// =============================================================================
// The payment check's two halves: which payments a budget already accounts for,
// and what survives the model's reading. The cases that matter are the pairing
// (same amount within the window, one entry per payment), the refusals (money in,
// an amount that is not the same to the cent) and the duplicate guard.
// =============================================================================

const payment = (id: string, date: string, amount: number) => ({ id, date, amount });
const entry = (id: string, date: string, amount: number) => ({ id, date, amount, description: null });

test('an expense of the same amount four days away accounts for the payment', () => {
    const matched = matchPayments([payment('p1', '2026-10-27', 17.63)], [entry('e1', '2026-10-31', 17.63)]);
    assert.equal(matched.get('p1'), 'e1');
});

test('five days away is a different purchase', () => {
    const matched = matchPayments([payment('p1', '2026-10-27', 17.63)], [entry('e1', '2026-11-01', 17.63)]);
    assert.equal(matched.has('p1'), false);
});

test('a different amount is not the same purchase', () => {
    const matched = matchPayments([payment('p1', '2026-10-27', 17.63)], [entry('e1', '2026-10-27', 17.65)]);
    assert.equal(matched.has('p1'), false);
});

test('one expense accounts for one payment, the closest day first', () => {
    const payments = [payment('near', '2026-10-27', 9.48), payment('far', '2026-10-25', 9.48)];
    const matched = matchPayments(payments, [entry('e1', '2026-10-28', 9.48)]);
    assert.equal(matched.get('near'), 'e1');
    assert.equal(matched.has('far'), false);
});

test('an entry already linked to another payment is not offered again', () => {
    const matched = matchPayments([payment('p1', '2026-10-27', 9.48)], [entry('e1', '2026-10-27', 9.48)], ['e1']);
    assert.equal(matched.has('p1'), false);
});

test('a malformed date pairs with nothing', () => {
    const matched = matchPayments([payment('p1', '', 9.48)], [entry('e1', '2026-10-27', 9.48)]);
    assert.equal(matched.has('p1'), false);
    assert.equal(Number.isNaN(daysBetween('', '2026-10-27')), true);
});

// ─── The model's reading ─────────────────────────────────────────────────────

const CATEGORIES = ['Alimentation', 'Transport', 'Autre'];

const read = (transactions: unknown[]) =>
    validateTransactions({ transactions }, CATEGORIES, '2026-10-30');

test('money out is kept as a positive expense with its own category', () => {
    const { transactions } = read([
        { source: 'Edenred Meal', date: '2026-10-27', label: 'ALDI 42 SINT-NIKLAAS', amount: -17.63, category: 'Alimentation' },
    ]);
    assert.deepEqual(transactions, [
        { source: 'Edenred Meal', date: '2026-10-27', label: 'ALDI 42 SINT-NIKLAAS', amount: 17.63, category: 'Alimentation' },
    ]);
});

test('money added to the account, and a zero line, are not expenses', () => {
    const { transactions, skipped } = read([
        { source: 'Bunq', date: '2026-10-29', label: 'Money added via Apple Pay', amount: 70, category: 'Autre' },
        { source: 'Bunq', date: '2026-10-29', label: 'Nothing', amount: 0, category: 'Autre' },
    ]);
    assert.deepEqual(transactions, []);
    assert.equal(skipped, 2);
});

test('an unreadable date falls back to today; an unknown category to the catch-all', () => {
    const { transactions } = read([
        { source: '', date: '29 oct', label: 'BAKKERIJ CHEF FARINI', amount: -1.5, category: 'Boulangerie' },
    ]);
    assert.deepEqual(transactions, [
        { source: 'other', date: '2026-10-30', label: 'BAKKERIJ CHEF FARINI', amount: 1.5, category: 'Autre' },
    ]);
});

test('the same line twice in one reading counts once', () => {
    const { transactions } = read([
        { source: 'Bunq', date: '2026-10-28', label: 'Jysk', amount: -11.5, category: 'Autre' },
        { source: 'Bunq', date: '2026-10-28', label: 'JYSK ', amount: -11.50, category: 'Autre' },
    ]);
    assert.equal(transactions.length, 1);
});

test('the fingerprint ignores case and punctuation but not the amount', () => {
    assert.equal(
        transactionFingerprint('Bunq', '2026-10-28', 11.5, 'JYSK'),
        transactionFingerprint('bunq', '2026-10-28', 11.5, 'Jysk'),
    );
    assert.notEqual(
        transactionFingerprint('Bunq', '2026-10-28', 11.5, 'Jysk'),
        transactionFingerprint('Bunq', '2026-10-28', 11.51, 'Jysk'),
    );
});
