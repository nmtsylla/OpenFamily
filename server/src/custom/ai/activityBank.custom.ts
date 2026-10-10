// =============================================================================
// Static activity bank — the safety net behind the AI suggestions.
//
// When the AI is off, unreachable, or returns garbage, the widget must still show
// something: an empty "what shall we do today?" card loses the argument against the
// screen by default. So we degrade to this curated bank rather than to nothing.
//
// Entries carry slugs, not copy: `id` and material slugs are resolved to text by
// the client through i18n, in the reader's own language. Same DATA-vs-UI split as
// the activity `category` and `timeOfDay`. Ideas are tagged by age range and by
// whether they need decent weather; the picker mirrors the AI's contract (same
// fields, same slugs), so one component renders both paths.
// =============================================================================

import type { ActivityCategory, ActivityTimeOfDay, KidActivity } from './widgets.custom';

interface BankActivity {
    id: string;
    category: ActivityCategory;
    timeOfDay: ActivityTimeOfDay;
    durationMinutes: number;
    /** Material slugs, e.g. 'paper', resolved through i18n by the client. */
    materials: string[];
    ageMin: number;
    ageMax: number;
    /** true → needs dry, not-freezing weather. */
    outdoor: boolean;
}

const BANK: BankActivity[] = [
    {
        id: 'treasure-hunt-garden',
        category: 'outdoor',
        timeOfDay: 'morning',
        durationMinutes: 45,
        materials: ['paper', 'pencil'],
        ageMin: 3,
        ageMax: 10,
        outdoor: true,
    },
    {
        id: 'obstacle-course',
        category: 'sport',
        timeOfDay: 'afternoon',
        durationMinutes: 40,
        materials: ['cushions', 'chairs', 'rope'],
        ageMin: 4,
        ageMax: 12,
        outdoor: true,
    },
    {
        id: 'herbarium',
        category: 'learning',
        timeOfDay: 'morning',
        durationMinutes: 60,
        materials: ['notebook', 'glue'],
        ageMin: 6,
        ageMax: 13,
        outdoor: true,
    },
    {
        id: 'picnic',
        category: 'cooking',
        timeOfDay: 'morning',
        durationMinutes: 90,
        materials: ['bread', 'blanket'],
        ageMin: 5,
        ageMax: 14,
        outdoor: true,
    },
    {
        id: 'paper-boats',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 30,
        materials: ['paper', 'basin'],
        ageMin: 4,
        ageMax: 9,
        outdoor: true,
    },
    {
        id: 'watering-weeding',
        category: 'chores',
        timeOfDay: 'evening',
        durationMinutes: 30,
        materials: ['watering-can'],
        ageMin: 4,
        ageMax: 14,
        outdoor: true,
    },
    {
        id: 'land-art',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 45,
        materials: ['pebbles', 'leaves'],
        ageMin: 5,
        ageMax: 12,
        outdoor: true,
    },
    {
        id: 'neighbourhood-olympics',
        category: 'sport',
        timeOfDay: 'afternoon',
        durationMinutes: 90,
        materials: ['chalk', 'stopwatch'],
        ageMin: 6,
        ageMax: 14,
        outdoor: true,
    },
    {
        id: 'blanket-fort',
        category: 'outdoor',
        timeOfDay: 'morning',
        durationMinutes: 75,
        materials: ['sheets', 'pegs'],
        ageMin: 3,
        ageMax: 11,
        outdoor: true,
    },
    {
        id: 'cookies',
        category: 'cooking',
        timeOfDay: 'afternoon',
        durationMinutes: 75,
        materials: ['flour', 'butter', 'sugar'],
        ageMin: 4,
        ageMax: 14,
        outdoor: false,
    },
    {
        id: 'board-game',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 90,
        materials: ['cardboard', 'felt-pens', 'dice'],
        ageMin: 6,
        ageMax: 14,
        outdoor: false,
    },
    {
        id: 'shadow-theatre',
        category: 'creative',
        timeOfDay: 'evening',
        durationMinutes: 60,
        materials: ['lamp', 'sheet', 'cardboard'],
        ageMin: 4,
        ageMax: 11,
        outdoor: false,
    },
    {
        id: 'construction-challenge',
        category: 'learning',
        timeOfDay: 'morning',
        durationMinutes: 30,
        materials: ['bricks', 'cardboard', 'tape'],
        ageMin: 4,
        ageMax: 12,
        outdoor: false,
    },
    {
        id: 'story-writing',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 60,
        materials: ['paper', 'coloured-pencils'],
        ageMin: 6,
        ageMax: 13,
        outdoor: false,
    },
    {
        id: 'timed-tidy-up',
        category: 'chores',
        timeOfDay: 'morning',
        durationMinutes: 20,
        materials: [],
        ageMin: 3,
        ageMax: 14,
        outdoor: false,
    },
    {
        id: 'kitchen-science',
        category: 'learning',
        timeOfDay: 'afternoon',
        durationMinutes: 45,
        materials: ['vinegar', 'baking-soda', 'food-colouring'],
        ageMin: 6,
        ageMax: 13,
        outdoor: false,
    },
    {
        id: 'yoga-balance',
        category: 'sport',
        timeOfDay: 'morning',
        durationMinutes: 30,
        materials: ['mat', 'tape'],
        ageMin: 4,
        ageMax: 12,
        outdoor: false,
    },
    {
        id: 'grandparents-interview',
        category: 'social',
        timeOfDay: 'evening',
        durationMinutes: 30,
        materials: ['notebook'],
        ageMin: 5,
        ageMax: 14,
        outdoor: false,
    },
    {
        id: 'postcards',
        category: 'creative',
        timeOfDay: 'afternoon',
        durationMinutes: 45,
        materials: ['cardboard', 'felt-pens', 'stamps'],
        ageMin: 5,
        ageMax: 12,
        outdoor: false,
    },
    {
        id: 'toy-sort',
        category: 'chores',
        timeOfDay: 'morning',
        durationMinutes: 45,
        materials: ['boxes'],
        ageMin: 5,
        ageMax: 14,
        outdoor: false,
    },
];

const TIME_ORDER: Record<ActivityTimeOfDay, number> = { morning: 0, afternoon: 1, evening: 2 };

/**
 * Pick 3-4 age-appropriate, weather-appropriate ideas, spread across the day.
 *
 * Deterministic for a given (date, kids, weather) so a dashboard refresh does not
 * reshuffle the card under the user's eyes — but the date seed means a new day
 * brings different ideas. `exclude` lets the "other ideas" button move past what has
 * already been shown (bank ids or translated titles, whichever the caller has).
 */
export const pickFallbackActivities = (opts: {
    kids: Array<{ id: string; ageYears: number }>;
    /** false when it rains, blows hard, or freezes. */
    outdoorOk: boolean;
    /** YYYY-MM-DD — seeds the rotation. */
    dateKey: string;
    /** Bank ids to skip, plus any literal title already shown. */
    exclude?: string[];
}): KidActivity[] => {
    const { kids, outdoorOk, dateKey, exclude = [] } = opts;
    if (kids.length === 0) return [];

    const excluded = new Set(exclude.map((t) => t.trim().toLowerCase()));
    const ages = kids.map((k) => k.ageYears);
    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);

    const eligible = BANK.filter((a) => {
        if (excluded.has(a.id)) return false;
        if (a.outdoor && !outdoorOk) return false;
        // Keep an idea if it suits at least one of the kids.
        return a.ageMin <= maxAge && a.ageMax >= minAge;
    });
    if (eligible.length === 0) return [];

    // Rotate the bank by a seed derived from the date, so the selection changes
    // day to day without any randomness (which would break caching and make the
    // card flicker between renders).
    const seed = [...dateKey].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 100_000, 7);
    const rotated = eligible.map((_, i) => eligible[(i + seed) % eligible.length]);

    // Spread across the day: take the best match per time slot first, then fill.
    const picked: BankActivity[] = [];
    for (const slot of ['morning', 'afternoon', 'evening'] as ActivityTimeOfDay[]) {
        const found = rotated.find((a) => a.timeOfDay === slot && !picked.includes(a));
        if (found) picked.push(found);
    }
    for (const a of rotated) {
        if (picked.length >= 4) break;
        if (!picked.includes(a)) picked.push(a);
    }

    return (
        picked
            .sort((a, b) => TIME_ORDER[a.timeOfDay] - TIME_ORDER[b.timeOfDay])
            .map((a) => ({
                id: a.id,
                kidIds: kids
                    .filter((k) => a.ageMin <= k.ageYears && k.ageYears <= a.ageMax)
                    .map((k) => k.id),
                category: a.category,
                timeOfDay: a.timeOfDay,
                durationMinutes: a.durationMinutes,
                materials: a.materials,
            }))
            // An idea nobody in the family fits is noise — drop it.
            .filter((a) => a.kidIds.length > 0)
    );
};
