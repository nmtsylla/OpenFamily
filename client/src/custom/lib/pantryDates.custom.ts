/**
 * Calendar-day math for the pantry UI, shared by the page and the dashboard card
 * so "expires today" cannot drift between the two.
 */

/** Whole days from today to `iso` (negative = in the past), on the LOCAL calendar. */
export const daysUntil = (iso: string): number => {
    const [year, month, day] = iso.split('-').map(Number);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((Date.UTC(year, (month ?? 1) - 1, day ?? 1) - today) / 86_400_000);
};
