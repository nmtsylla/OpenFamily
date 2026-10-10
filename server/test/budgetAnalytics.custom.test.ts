import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBudgetAnalytics, toAnalyticsEntries, type AnalyticsEntry } from '../src/custom/lib/budgetAnalytics.custom';

// =============================================================================
// Fine-grained budget analytics: the buckets the shipped budget routes do not
// compute (weekday, per-day burn rate, merchant, planned vs actual) and the two
// rules that are easy to get wrong — a recurring series is never attributed to a
// member, and an entry outside the window must not distort the series.
// =============================================================================

const entry = (over: Partial<AnalyticsEntry>): AnalyticsEntry => ({
    date: '2026-10-05',
    amount: 10,
    isExpense: true,
    category: 'Alimentation',
    assignedTo: null,
    merchant: null,
    source: 'actual',
    ...over,
});

const members = [
    { id: 'm1', name: 'Diarra', color: '#111111' },
    { id: 'm2', name: 'Ahmadou', color: '#222222' },
];

test('totals, category share and actual-vs-recurring split', () => {
    const result = buildBudgetAnalytics({
        entries: [
            entry({ amount: 100, category: 'Logement' }),
            entry({ amount: 50, category: 'Logement', source: 'recurring', date: '2026-10-01' }),
            entry({ amount: 50, category: 'Alimentation' }),
            entry({ amount: 400, isExpense: false, category: 'Salaire', date: '2026-10-02' }),
        ],
        members,
        start: '2026-10-01',
        end: '2026-10-31',
    });

    assert.equal(result.totals.expenses, 200);
    assert.equal(result.totals.income, 400);
    assert.equal(result.totals.balance, 200);
    assert.equal(result.totals.count, 4);

    // A recurring rent is "planned" spending, a one-off receipt is "actual":
    // they must stay separable, which is the whole point of the split.
    assert.deepEqual(result.split.actual, { income: 400, expenses: 150 });
    assert.deepEqual(result.split.recurring, { income: 0, expenses: 50 });

    assert.deepEqual(result.byCategory[0], {
        category: 'Logement',
        expenses: 150,
        income: 0,
        count: 2,
        share: 0.75,
    });
    assert.equal(result.byCategory[1].share, 0.25);
});

test('byMember covers assigned entries only: recurring and unassigned are absent', () => {
    const result = buildBudgetAnalytics({
        entries: [
            entry({ amount: 30, assignedTo: 'm1' }),
            entry({ amount: 20, assignedTo: 'm2', date: '2026-10-06' }),
            entry({ amount: 15, assignedTo: 'm1', isExpense: false, date: '2026-10-07' }),
            entry({ amount: 500, assignedTo: null }), // unassigned: totals only
            entry({ amount: 40, assignedTo: null, source: 'recurring' }), // series carry no member
            entry({ amount: 7, assignedTo: 'someone-elses-member-id' }), // not a member of this family
        ],
        members,
        start: '2026-10-01',
        end: '2026-10-31',
    });

    assert.equal(result.totals.expenses, 597);
    // Sum of the member rows is deliberately NOT the total: the breakdown answers
    // "who spent what", not "where did every euro go".
    assert.deepEqual(
        result.byMember.map((m) => [m.id, m.expenses, m.income, m.count]),
        [['m1', 30, 15, 2], ['m2', 20, 0, 1]],
    );
});

test('byDay is one bucket per calendar day, empty days included, and cumulates', () => {
    const result = buildBudgetAnalytics({
        entries: [
            entry({ date: '2026-10-02', amount: 10 }),
            entry({ date: '2026-10-02', amount: 5 }),
            entry({ date: '2026-10-04', amount: 20, isExpense: false }),
            entry({ date: '2026-09-30', amount: 999 }), // before the range: ignored
            entry({ date: '2026-11-01', amount: 999 }), // after the range: ignored
        ],
        members,
        start: '2026-10-01',
        end: '2026-10-04',
    });

    assert.deepEqual(result.byDay.map((d) => [d.date, d.expenses, d.income, d.count]), [
        ['2026-10-01', 0, 0, 0],
        ['2026-10-02', 15, 0, 2],
        ['2026-10-03', 0, 0, 0],
        ['2026-10-04', 0, 20, 1],
    ]);
    assert.deepEqual(result.byDay.map((d) => [d.cumulativeExpenses, d.cumulativeBalance]), [
        [0, 0], [15, -15], [15, -15], [15, 5],
    ]);
});

test('byWeekday is ISO-numbered and covers all seven days', () => {
    const result = buildBudgetAnalytics({
        entries: [
            entry({ date: '2026-10-05', amount: 12 }), // Monday
            entry({ date: '2026-10-11', amount: 8 }), // Sunday
        ],
        members,
        start: '2026-10-05',
        end: '2026-10-11',
    });

    assert.equal(result.byWeekday.length, 7);
    assert.deepEqual(result.byWeekday.map((d) => d.weekday), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(result.byWeekday[0], { weekday: 1, expenses: 12, count: 1 });
    assert.deepEqual(result.byWeekday[6], { weekday: 7, expenses: 8, count: 1 });
    assert.deepEqual(result.byWeekday[3], { weekday: 4, expenses: 0, count: 0 });
});

test('byMerchant ranks receipt spending only, biggest first', () => {
    const result = buildBudgetAnalytics({
        entries: [
            entry({ merchant: 'Delhaize', amount: 60 }),
            entry({ merchant: 'Delhaize', amount: 40, date: '2026-10-06' }),
            entry({ merchant: 'Colruyt', amount: 25 }),
            entry({ merchant: '', amount: 100 }), // hand-typed entry: no merchant
            entry({ merchant: 'Refund Shop', amount: 30, isExpense: false }), // income: not spend
        ],
        members,
        start: '2026-10-01',
        end: '2026-10-31',
    });

    assert.deepEqual(result.byMerchant, [
        { merchant: 'Delhaize', expenses: 100, count: 2 },
        { merchant: 'Colruyt', expenses: 25, count: 1 },
    ]);
});

test('pace projects the range total from the elapsed days', () => {
    const result = buildBudgetAnalytics({
        entries: [entry({ date: '2026-10-01', amount: 100 })],
        members,
        start: '2026-10-01',
        end: '2026-10-10',
        today: '2026-10-05',
    });

    assert.deepEqual(result.pace, {
        daysTotal: 10,
        daysElapsed: 5,
        dailyAverage: 20,
        projectedExpenses: 200,
    });

    // Range not started yet: nothing to extrapolate from.
    const future = buildBudgetAnalytics({
        entries: [],
        members,
        start: '2026-10-01',
        end: '2026-10-10',
        today: '2026-09-20',
    });
    assert.equal(future.pace, null);

    // Range already over: the projection is the actual, not a guess.
    const past = buildBudgetAnalytics({
        entries: [entry({ date: '2026-10-01', amount: 100 })],
        members,
        start: '2026-10-01',
        end: '2026-10-10',
        today: '2026-10-20',
    });
    assert.deepEqual(past.pace, {
        daysTotal: 10,
        daysElapsed: 10,
        dailyAverage: 10,
        projectedExpenses: 100,
    });
});

test('toAnalyticsEntries includes the end day on both sides', () => {
    // A monthly series due on the 1st, active over the range: the occurrence on
    // the range's last day must be counted, exactly like the one-off entry the
    // route's `date < end + 1 day` predicate returns for that same day.
    const rows = toAnalyticsEntries(
        [{ date: '2026-10-10', amount: 5, is_expense: true, category: 'Maison', assigned_to: null, merchant: null }],
        [{
            id: 'series-1',
            label: 'Rent',
            amount: 100,
            category: 'Logement',
            is_expense: true,
            start_date: '2026-10-01',
            recurrence_frequency: 'monthly',
            recurrence_interval: 1,
            recurrence_until: null,
            debit_day: 1,
        }],
        '2026-10-01',
        '2026-10-10'
    );

    assert.deepEqual(
        rows.map((entry) => [entry.date, entry.amount, entry.source]),
        [['2026-10-10', 5, 'actual'], ['2026-10-01', 100, 'recurring']]
    );

    // The same rows through the buckets: nothing on the end day is lost.
    const result = buildBudgetAnalytics({ entries: rows, members, start: '2026-10-01', end: '2026-10-10' });
    assert.equal(result.totals.expenses, 105);
    assert.equal(result.byDay.at(-1)?.date, '2026-10-10');
    assert.equal(result.byDay.at(-1)?.expenses, 5);
});

test('an empty range is still a valid answer', () => {
    const result = buildBudgetAnalytics({
        entries: [],
        members,
        start: '2026-10-01',
        end: '2026-10-03',
    });

    assert.deepEqual(result.totals, { income: 0, expenses: 0, balance: 0, count: 0 });
    assert.equal(result.byDay.length, 3);
    assert.deepEqual(result.byCategory, []);
    assert.deepEqual(result.byMerchant, []);
    assert.deepEqual(result.byMonth, []);
    assert.equal(result.pace, null);
});
