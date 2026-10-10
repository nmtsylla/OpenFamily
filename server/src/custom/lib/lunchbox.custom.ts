// Shared shape of a lunchbox row (custom_lunchboxes).
//
// A lunchbox is a per-child, per-day set of four free-text components — the
// child eats it at school, so it is not a household meal and has no recipe. The
// values are user data: they are never translated, only trimmed and capped
// before they reach the database or a prompt.

/** The four components of a lunchbox, in the order the UI shows them. */
export const LUNCHBOX_FIELDS = ['main', 'fruit', 'snack', 'drink'] as const;

export type LunchboxField = (typeof LUNCHBOX_FIELDS)[number];

/** Every component is a short label, not a paragraph. */
export const MAX_LUNCHBOX_ITEM_LENGTH = 200;

export type LunchboxItems = Partial<Record<LunchboxField, string>>;

/**
 * Keep only the four supported keys, drop empty strings, cap the length and
 * refuse anything that isn't a string. Returns null when every component is
 * empty, so we never store `{}` rows.
 */
export const sanitizeLunchboxItems = (raw: unknown): Record<string, string> | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const cleaned: Record<string, string> = {};
    for (const key of LUNCHBOX_FIELDS) {
        const value = (raw as Record<string, unknown>)[key];
        if (typeof value !== 'string') continue;
        const trimmed = value.trim().slice(0, MAX_LUNCHBOX_ITEM_LENGTH);
        if (trimmed.length > 0) cleaned[key] = trimmed;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : null;
};

/** Same cleaning, one component at a time (used when reading a row back). */
export const lunchboxItemsFromRow = (row: Record<string, unknown>): LunchboxItems =>
    (sanitizeLunchboxItems({
        main: row.main,
        fruit: row.fruit,
        snack: row.snack,
        drink: row.drink,
    }) ?? {}) as LunchboxItems;

/**
 * Count how often each component value appears, case-insensitively, keeping the
 * spelling of the most recent occurrence for display. `rows` are the raw
 * lunchbox rows, most recent first.
 */
export const tallyLunchboxItems = (
    rows: Array<Record<string, unknown>>,
): { totalLunchboxes: number; byField: Record<LunchboxField, Array<{ label: string; count: number }>> } => {
    const byField = {
        main: new Map<string, { label: string; count: number }>(),
        fruit: new Map<string, { label: string; count: number }>(),
        snack: new Map<string, { label: string; count: number }>(),
        drink: new Map<string, { label: string; count: number }>(),
    };

    for (const row of rows) {
        const items = lunchboxItemsFromRow(row);
        for (const field of LUNCHBOX_FIELDS) {
            const value = items[field];
            if (!value) continue;
            // Case-insensitive grouping so "Pomme" and "pomme" merge; the most
            // recent spelling (rows come newest-first) wins for display.
            const key = value.toLowerCase();
            const current = byField[field].get(key);
            if (current) current.count += 1;
            else byField[field].set(key, { label: value, count: 1 });
        }
    }

    const ranked = (field: LunchboxField) =>
        Array.from(byField[field].values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
        totalLunchboxes: rows.length,
        byField: {
            main: ranked('main'),
            fruit: ranked('fruit'),
            snack: ranked('snack'),
            drink: ranked('drink'),
        },
    };
};

/**
 * Aggregate the components of a week's lunchboxes into shopping items, deduped
 * by name (case-insensitive), counting how many of them came from each
 * component (only used to report back).
 */
export const tallyForShopping = (
    rows: Array<Record<string, unknown>>,
): Map<string, { label: string; count: number }> => {
    const tally = new Map<string, { label: string; count: number }>();
    for (const row of rows) {
        const items = lunchboxItemsFromRow(row);
        for (const field of LUNCHBOX_FIELDS) {
            const value = items[field];
            if (!value) continue;
            const key = value.toLowerCase();
            const existing = tally.get(key);
            if (existing) existing.count += 1;
            else tally.set(key, { label: value, count: 1 });
        }
    }
    return tally;
};
