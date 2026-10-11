// Time-of-day phase for the family dashboard.
//
// Pure and framework-free on purpose: the page re-renders on a 60 s timer and a
// swipe both read this, and the manual-override rules are the only logic in the
// dashboard worth a unit test.

export type FamilyPhase = 'morning' | 'day' | 'evening' | 'night';

/** Clock order, which is also the swipe order (left = next). */
export const PHASE_ORDER: readonly FamilyPhase[] = ['morning', 'day', 'evening', 'night'];

/** 06:00–08:59 morning, 09:00–16:59 day, 17:00–21:59 evening, 22:00–05:59 night. */
export const phaseForHour = (hour: number): FamilyPhase => {
    if (hour >= 6 && hour < 9) return 'morning';
    if (hour >= 9 && hour < 17) return 'day';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
};

/**
 * The phase `delta` steps away in the cycle: +1 = next, -1 = previous. Used by
 * the swipe gesture and the phase badge, both of which work from the *shown*
 * phase rather than from the clock.
 */
export const shiftPhase = (phase: FamilyPhase, delta: number): FamilyPhase => {
    const index = PHASE_ORDER.indexOf(phase);
    const next = (index + delta + PHASE_ORDER.length) % PHASE_ORDER.length;
    return PHASE_ORDER[next];
};

export interface PhaseOverride {
    phase: FamilyPhase;
    /** Epoch ms after which the clock takes over again. */
    until: number;
}

/**
 * A manual phase outlives its tap only until the next hour boundary, and never
 * longer than ten minutes — long enough to finish reading a card, short enough
 * that a forgotten tap does not leave a tablet showing the morning layout at
 * midnight.
 */
export const overrideExpiry = (now: Date): number => {
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return Math.min(nextHour.getTime(), now.getTime() + 10 * 60_000);
};

/** The phase to render: the manual one while it lasts, the clock's otherwise. */
export const resolvePhase = (now: Date, override: PhaseOverride | null): FamilyPhase =>
    override && now.getTime() < override.until ? override.phase : phaseForHour(now.getHours());

/** Minutes until the given `HH:MM` today (null when that time already passed). */
export const minutesUntil = (now: Date, target: string | null | undefined): number | null => {
    if (!target) return null;
    const match = /^(\d{2}):(\d{2})/.exec(target);
    if (!match) return null;
    const targetMinutes = Number(match[1]) * 60 + Number(match[2]);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return targetMinutes > nowMinutes ? targetMinutes - nowMinutes : null;
};

/** "1 h 05" / "45 min" for a countdown, or null when there is nothing to wait for. */
export const formatCountdown = (minutes: number | null): string | null => {
    if (minutes === null) return null;
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};
