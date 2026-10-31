// Which payments the budget already accounts for.
//
// A payment is accounted for when a budget expense of the same amount sits
// within a few days of it: the family pays on the 27th and enters the expense
// that evening, or enters it a week later while filing receipts, and the shop's
// own posting lands in between. Amounts must agree to the cent — a near miss is
// a different purchase, and offering to add it again is exactly the mistake this
// page exists to prevent.
//
// One budget entry accounts for ONE payment: two trips to the same shop for the
// same amount on the same day are two payments, and the shortest date gap wins
// so the pairing stays stable between two loads of the page.

/** How far a budget entry may sit from the payment it accounts for. */
export const MATCH_WINDOW_DAYS = 4;

/** Amounts may differ by a cent (rounding across a currency conversion). */
export const MATCH_AMOUNT_TOLERANCE = 0.01;

export interface PaymentToCheck {
    id: string;
    /** YYYY-MM-DD */
    date: string;
    /** Positive amount paid. */
    amount: number;
}

export interface EntryToMatch extends PaymentToCheck {
    description: string | null;
}

/** Whole days between two YYYY-MM-DD dates, NaN when either is not one. */
export const daysBetween = (from: string, to: string): number => {
    const stamp = (value: string): number => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) return NaN;
        return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
    };
    return Math.abs(stamp(to) - stamp(from));
};

/**
 * Payment id → budget entry id. `claimedEntryIds` are the entries another
 * payment is already linked to (a row added from this page), so two payments
 * never point at the same entry.
 */
export function matchPayments(
    payments: readonly PaymentToCheck[],
    entries: readonly EntryToMatch[],
    claimedEntryIds: readonly string[] = [],
): Map<string, string> {
    const used = new Set(claimedEntryIds);
    const matched = new Map<string, string>();

    // Best pair first, over the whole list: the closest day, then the smallest
    // amount drift. Deciding pair by pair in date order let a payment three days
    // out take the entry that sat on another payment's own day.
    const pairs: Array<{ payment: string; entry: string; gap: number; drift: number; day: string }> = [];
    for (const payment of payments) {
        for (const entry of entries) {
            const drift = Math.abs(entry.amount - payment.amount);
            if (drift > MATCH_AMOUNT_TOLERANCE) continue;
            const gap = daysBetween(payment.date, entry.date);
            if (!Number.isFinite(gap) || gap > MATCH_WINDOW_DAYS) continue;
            pairs.push({ payment: payment.id, entry: entry.id, gap, drift, day: payment.date });
        }
    }
    pairs.sort((a, b) =>
        a.gap - b.gap
        || a.drift - b.drift
        || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)
        || (a.payment < b.payment ? -1 : a.payment > b.payment ? 1 : 0)
        || (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));

    for (const pair of pairs) {
        if (matched.has(pair.payment) || used.has(pair.entry)) continue;
        matched.set(pair.payment, pair.entry);
        used.add(pair.entry);
    }

    return matched;
}
