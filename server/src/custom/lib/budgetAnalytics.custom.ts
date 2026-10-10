// Fine-grained budget analytics.
//
// Kept out of routes/budget.ts on purpose: upstream owns that file and edits it
// often, so this analysis lives BESIDE the shipped budget feature instead of
// inside it. The module only consumes shapes the existing schema already
// produces — budget_entries rows and the occurrences expandRecurringTransactions()
// returns — and never writes to those tables.
//
// It is pure (no database, no clock of its own), so it is testable on its own:
// see test/budgetAnalytics.custom.test.ts.

import { expandRecurringTransactions, formatDateOnly } from '../../lib/budgetRecurrence';

export interface AnalyticsEntry {
    /** YYYY-MM-DD */
    date: string;
    amount: number;
    isExpense: boolean;
    category: string;
    /** null when the entry is not assigned to a member — recurring series never are. */
    assignedTo: string | null;
    /** Merchant of the receipt the entry was imported from, when there was one. */
    merchant: string | null;
    source: 'actual' | 'recurring';
}

export interface AnalyticsMember {
    id: string;
    name: string;
    color: string | null;
}

export interface AnalyticsInput {
    entries: AnalyticsEntry[];
    members: AnalyticsMember[];
    /** Inclusive boundaries, both YYYY-MM-DD. */
    start: string;
    end: string;
    /** "now" (YYYY-MM-DD) used for the pace projection; omit to skip it. */
    today?: string;
}

export interface AnalyticsDay {
    date: string;
    expenses: number;
    income: number;
    count: number;
    /** Expenses since `start`, this day included. */
    cumulativeExpenses: number;
    /** Income minus expenses since `start`, this day included. */
    cumulativeBalance: number;
}

export interface BudgetAnalytics {
    totals: { income: number; expenses: number; balance: number; count: number };
    /** One-off entries vs recurring occurrences, so "planned" and "actual" stay separable. */
    split: {
        actual: { income: number; expenses: number };
        recurring: { income: number; expenses: number };
    };
    byCategory: Array<{ category: string; expenses: number; income: number; count: number; share: number }>;
    byMonth: Array<{ month: string; expenses: number; income: number }>;
    /** Every calendar day of the range, empty ones included: the burn-rate series. */
    byDay: AnalyticsDay[];
    /** 1 = Monday … 7 = Sunday, always all seven, so a chart never shifts. */
    byWeekday: Array<{ weekday: number; expenses: number; count: number }>;
    /** Assigned entries only — an entry (or a recurring occurrence) with no member is not here. */
    byMember: Array<{ id: string; name: string; color: string | null; expenses: number; income: number; count: number }>;
    byMerchant: Array<{ merchant: string; expenses: number; count: number }>;
    /** null when `today` is before the range: nothing has happened yet to extrapolate from. */
    pace: { daysTotal: number; daysElapsed: number; dailyAverage: number; projectedExpenses: number } | null;
}

// Enough merchants to be useful in a list, few enough to bound the payload.
const MAX_MERCHANTS = 20;

const DAY_MS = 86400000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (value: number) => Math.round(value * 100) / 100;

const dayAfter = (date: string) => formatDateOnly(new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS));

const daysBetween = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Weekday the way a European calendar reads it: 1 = Monday … 7 = Sunday. */
const isoWeekday = (date: string) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    return day === 0 ? 7 : day;
};

const byAmountDesc = <T extends { expenses: number; income: number }>(a: T, b: T) =>
    b.expenses - a.expenses || b.income - a.income;

const toNumber = (value: unknown): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

/**
 * Flatten the two row sets the route fetches into the list the buckets are built
 * from: one-off entries as-is, plus every occurrence of every recurring series.
 *
 * `end` is INCLUSIVE, on purpose. expandRecurringTransactions() only stops once
 * an occurrence is past the range end, and the route's entries query uses
 * `date < end + 1 day`, so both sides include the end day. Keep them in step: an
 * exclusive bound here would count an occurrence on the end day while dropping
 * the entry booked on it.
 */
export const toAnalyticsEntries = (
    entryRows: Array<Record<string, any>>,
    recurringRows: Array<Record<string, any>>,
    start: string,
    end: string
): AnalyticsEntry[] => {
    const entries: AnalyticsEntry[] = entryRows.map((row) => ({
        date: String(row.date).slice(0, 10),
        amount: toNumber(row.amount),
        isExpense: Boolean(row.is_expense),
        category: row.category || 'Autre',
        assignedTo: row.assigned_to || null,
        merchant: row.merchant || null,
        source: 'actual',
    }));

    for (const occurrence of expandRecurringTransactions(recurringRows, start, end)) {
        entries.push({
            date: String(occurrence.occurrence_date).slice(0, 10),
            amount: toNumber(occurrence.amount),
            isExpense: Boolean(occurrence.is_expense),
            category: occurrence.category || 'Autre',
            // recurring_expenses has no assigned_to column: a series is never
            // attributed to a member, and the member breakdown says so.
            assignedTo: null,
            merchant: null,
            source: 'recurring',
        });
    }

    return entries;
};

export const buildBudgetAnalytics = (input: AnalyticsInput): BudgetAnalytics => {
    const { entries, members, start, end, today } = input;

    // One bucket per calendar day of the range, in order, so the cumulative
    // series has no gap on a day with no transaction.
    const byDay: AnalyticsDay[] = [];
    const dayIndex = new Map<string, AnalyticsDay>();
    for (let date = start; date <= end; date = dayAfter(date)) {
        const bucket: AnalyticsDay = {
            date,
            expenses: 0,
            income: 0,
            count: 0,
            cumulativeExpenses: 0,
            cumulativeBalance: 0,
        };
        byDay.push(bucket);
        dayIndex.set(date, bucket);
    }

    const byWeekday = Array.from({ length: 7 }, (_, index) => ({
        weekday: index + 1,
        expenses: 0,
        count: 0,
    }));
    const categories = new Map<string, { expenses: number; income: number; count: number }>();
    const months = new Map<string, { expenses: number; income: number }>();
    const merchants = new Map<string, { expenses: number; count: number }>();
    const memberTotals = new Map<string, { expenses: number; income: number; count: number }>();
    const totals = { income: 0, expenses: 0, balance: 0, count: 0 };
    const split = {
        actual: { income: 0, expenses: 0 },
        recurring: { income: 0, expenses: 0 },
    };

    for (const entry of entries) {
        const bucket = dayIndex.get(entry.date);
        // An entry outside the window is dropped rather than distorting the series.
        if (!bucket) continue;

        const amount = Number.isFinite(entry.amount) ? entry.amount : 0;
        const side = entry.isExpense ? 'expenses' : 'income';

        bucket[side] = round2(bucket[side] + amount);
        bucket.count += 1;

        totals[side] = round2(totals[side] + amount);
        totals.count += 1;

        split[entry.source === 'recurring' ? 'recurring' : 'actual'][side] =
            round2(split[entry.source === 'recurring' ? 'recurring' : 'actual'][side] + amount);

        const category = entry.category || 'Autre';
        const categoryBucket = categories.get(category) ?? { expenses: 0, income: 0, count: 0 };
        categoryBucket[side] = round2(categoryBucket[side] + amount);
        categoryBucket.count += 1;
        categories.set(category, categoryBucket);

        const monthKey = entry.date.slice(0, 7);
        const monthBucket = months.get(monthKey) ?? { expenses: 0, income: 0 };
        monthBucket[side] = round2(monthBucket[side] + amount);
        months.set(monthKey, monthBucket);

        if (entry.assignedTo) {
            const memberBucket = memberTotals.get(entry.assignedTo) ?? { expenses: 0, income: 0, count: 0 };
            memberBucket[side] = round2(memberBucket[side] + amount);
            memberBucket.count += 1;
            memberTotals.set(entry.assignedTo, memberBucket);
        }

        if (entry.isExpense) {
            const weekday = byWeekday[isoWeekday(entry.date) - 1];
            weekday.expenses = round2(weekday.expenses + amount);
            weekday.count += 1;

            const merchant = (entry.merchant ?? '').trim();
            if (merchant) {
                const merchantBucket = merchants.get(merchant) ?? { expenses: 0, count: 0 };
                merchantBucket.expenses = round2(merchantBucket.expenses + amount);
                merchantBucket.count += 1;
                merchants.set(merchant, merchantBucket);
            }
        }
    }

    totals.balance = round2(totals.income - totals.expenses);

    let runningExpenses = 0;
    let runningBalance = 0;
    for (const day of byDay) {
        runningExpenses = round2(runningExpenses + day.expenses);
        runningBalance = round2(runningBalance + day.income - day.expenses);
        day.cumulativeExpenses = runningExpenses;
        day.cumulativeBalance = runningBalance;
    }

    const byCategory = Array.from(categories, ([category, bucket]) => ({
        category,
        ...bucket,
        share: totals.expenses > 0 ? Math.round((bucket.expenses / totals.expenses) * 10000) / 10000 : 0,
    })).sort(byAmountDesc);

    const byMonth = Array.from(months, ([month, bucket]) => ({ month, ...bucket }))
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    const byMember = members
        .map((member) => ({
            id: member.id,
            name: member.name,
            color: member.color,
            ...(memberTotals.get(member.id) ?? { expenses: 0, income: 0, count: 0 }),
        }))
        .sort(byAmountDesc);

    const byMerchant = Array.from(merchants, ([merchant, bucket]) => ({ merchant, ...bucket }))
        .sort((a, b) => b.expenses - a.expenses || b.count - a.count)
        .slice(0, MAX_MERCHANTS);

    let pace: BudgetAnalytics['pace'] = null;
    if (today && DATE_ONLY.test(today) && today >= start) {
        const elapsedEnd = today < end ? today : end;
        const daysTotal = byDay.length;
        const daysElapsed = daysBetween(start, elapsedEnd) + 1;
        const elapsedExpenses = byDay
            .filter((day) => day.date <= elapsedEnd)
            .reduce((sum, day) => sum + day.expenses, 0);
        const dailyAverage = round2(elapsedExpenses / daysElapsed);
        pace = {
            daysTotal,
            daysElapsed,
            dailyAverage,
            projectedExpenses: round2(dailyAverage * daysTotal),
        };
    }

    return { totals, split, byCategory, byMonth, byDay, byWeekday, byMember, byMerchant, pace };
};
