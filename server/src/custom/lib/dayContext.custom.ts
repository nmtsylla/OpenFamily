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

/** Hour of the local day after which the dashboard talks about tomorrow. */
export const EVENING_CUTOFF_HOUR = 18;

/**
 * The day the dashboard talks about, plus how it was picked: the offset from
 * today and the instant it flips. The client schedules against `flipsAt` rather
 * than re-deriving the cutoff from its own clock.
 */
export interface TargetDay extends DayContext {
    dayOffset: 0 | 1;
    /** ISO instant of the next local 18:00. */
    flipsAt: string;
}

/**
 * Which day should the dashboard talk about?
 *
 * The hour alone decides: before 18:00 it is today, from 18:00 on tomorrow (lay
 * out the outfit the night before). The school/home rule no longer selects the
 * day — it only labels it, through `resolveDayContext`.
 */
export const resolveTargetDay = (now: Date = new Date()): TargetDay => {
    const dayOffset: 0 | 1 = now.getHours() >= EVENING_CUTOFF_HOUR ? 1 : 0;

    const target = new Date(now);
    target.setDate(target.getDate() + dayOffset);
    const context = resolveDayContext(toDateKey(target));

    // The next local 18:00: today's when it is still ahead, tomorrow's otherwise.
    const flip = new Date(now);
    flip.setHours(EVENING_CUTOFF_HOUR, 0, 0, 0);
    if (dayOffset === 1) {
        flip.setDate(flip.getDate() + 1);
    }

    return { ...context, dayOffset, flipsAt: flip.toISOString() };
};
