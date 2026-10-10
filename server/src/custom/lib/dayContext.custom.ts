// =============================================================================
// Day context — is a given day a school day, or are the kids home?
//
// Drives two things for the dashboard widgets:
//   1. which day they talk about (`resolveTargetDay`),
//   2. whether the outfit brief is a school one or a day-at-home one.
//
// Pure functions of a date, so they are testable without a database.
// =============================================================================

export type DayMode = 'school' | 'home';
export type DayReason = 'school_day' | 'weekend' | 'default_summer';

export interface DayContext {
    /** YYYY-MM-DD */
    date: string;
    mode: DayMode;
    reason: DayReason;
}

/**
 * Built-in summer window, July 1st to August 31st. It is what makes the feature
 * work out of the box for a family that declared nothing: without it, the
 * dashboard would cheerfully suggest a school outfit every morning of August.
 */
const SUMMER_START = '07-01';
const SUMMER_END = '08-31';

/** Local-calendar YYYY-MM-DD. Avoids toISOString(), which shifts to UTC. */
export const toDateKey = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/**
 * Weekend → home, July–August → home, otherwise school. The date key's own
 * lexicographic order is chronological, so the summer test is a string compare.
 */
export const resolveDayContext = (dateKey: string): DayContext => {
    // 0 = Sunday, 6 = Saturday.
    const weekday = new Date(`${dateKey}T00:00:00`).getDay();
    if (weekday === 0 || weekday === 6) {
        return { date: dateKey, mode: 'home', reason: 'weekend' };
    }

    const year = dateKey.slice(0, 4);
    if (dateKey >= `${year}-${SUMMER_START}` && dateKey <= `${year}-${SUMMER_END}`) {
        return { date: dateKey, mode: 'home', reason: 'default_summer' };
    }

    return { date: dateKey, mode: 'school', reason: 'school_day' };
};

/**
 * Which day should the dashboard talk about?
 *
 *   - School term: tomorrow. The question that matters is asked in the evening
 *     — pack the bag, lay out the outfit for the morning.
 *   - Holidays and weekends: today. The question is asked at breakfast — what
 *     do we DO today?
 *
 * Nice side effect: on a Friday (a school day) the target is Saturday, so the
 * activity suggestions land the evening before the weekend, when they help.
 */
export const resolveTargetDay = (now: Date = new Date()): { context: DayContext; dayOffset: 0 | 1 } => {
    const today = resolveDayContext(toDateKey(now));
    if (today.mode === 'home') {
        return { context: today, dayOffset: 0 };
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { context: resolveDayContext(toDateKey(tomorrow)), dayOffset: 1 };
};
