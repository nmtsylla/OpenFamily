import type { TFunction } from 'i18next';
import type { DayContextDTO } from '../hooks/useWeather.custom';

// =============================================================================
// Turn a day context into the heading the dashboard shows.
//
// One place decides what that heading says, so the two cards can never drift
// apart. The day is the server's call: `dayOffset` (0 = today, 1 = tomorrow) is
// what its 18:00 cutoff picked, so the heading reads it rather than judging the
// date against the device clock.
// =============================================================================

/** e.g. "Tomorrow — school", "Today — weekend", "Today — summer holidays". */
export const dayContextHeading = (ctx: DayContextDTO, t: TFunction): string => {
    const today = ctx.dayOffset === 0;

    if (ctx.mode === 'school') {
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
