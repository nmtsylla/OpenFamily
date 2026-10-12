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

export const EVENING_CUTOFF_HOUR = 18;

export interface TargetDay extends DayContext {
    dayOffset: 0 | 1;
    /** ISO instant the snapshot stops being true: the earlier of the next local 18:00 and midnight. */
    flipsAt: string;
}

export const resolveTargetDay = (now: Date = new Date()): TargetDay => {
    const dayOffset: 0 | 1 = now.getHours() >= EVENING_CUTOFF_HOUR ? 1 : 0;

    const target = new Date(now);
    target.setDate(target.getDate() + dayOffset);
    const context = resolveDayContext(toDateKey(target));

    const nextCutoff = new Date(now);
    nextCutoff.setHours(EVENING_CUTOFF_HOUR, 0, 0, 0);
    if (dayOffset === 1) {
        nextCutoff.setDate(nextCutoff.getDate() + 1);
    }
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);

    const flip = nextMidnight < nextCutoff ? nextMidnight : nextCutoff;

    return { ...context, dayOffset, flipsAt: flip.toISOString() };
};
