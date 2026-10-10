import type { TFunction } from 'i18next';
import type { DayContextDTO } from '../hooks/useWeather.custom';

// =============================================================================
// Turn a DayContext into the heading the dashboard shows.
//
// One place decides what that heading says, so the two cards can never drift
// apart. `isToday` mirrors the server's target-day rule (lib/dayContext.ts): a
// home day puts the question at breakfast ("what do we do today?"), term time
// puts it the evening before ("what do they wear tomorrow?").
// =============================================================================

export const isTodayContext = (ctx: DayContextDTO, now: Date = new Date()): boolean => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return ctx.date === `${y}-${m}-${d}`;
};

/** e.g. "Tomorrow — school", "Today — weekend", "Today — summer holidays". */
export const dayContextHeading = (
    ctx: DayContextDTO,
    t: TFunction,
    now: Date = new Date(),
): string => {
    const today = isTodayContext(ctx, now);

    if (ctx.mode === 'school') {
        // A school day is never "today" under the current target-day rule, but
        // don't let the heading lie if that ever changes.
        return today ? t('weather.custom:heading.todaySchool') : t('weather.custom:heading.tomorrowSchool');
    }

    switch (ctx.reason) {
        case 'weekend':
            return today ? t('weather.custom:heading.todayWeekend') : t('weather.custom:heading.tomorrowWeekend');
        case 'default_summer':
            return today ? t('weather.custom:heading.todaySummer') : t('weather.custom:heading.tomorrowSummer');
        // 'school_day' cannot reach here (handled above) — kept so the switch
        // stays total over DayReason without inventing wording for it.
        case 'school_day':
        default:
            return today ? t('weather.custom:heading.todaySchool') : t('weather.custom:heading.tomorrowSchool');
    }
};
