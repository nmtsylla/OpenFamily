import { Router, Response } from 'express';
import { query } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import {
    getForecastForDate,
    summarize,
    type TomorrowForecast,
    type WeatherSummary,
} from '../weather/WeatherService.custom';
import { WeatherError } from '../weather/errors.custom';
import { resolveTargetDay, type TargetDay } from '../lib/dayContext.custom';
import { resolveCoordinates, type ResolvedCoords } from '../lib/location.custom';
import { loadFamilyKids, type FamilyKid } from '../lib/kids.custom';
import { handleAiError, loadEnabledAiSettings } from '../lib/aiSettings.custom';
import { resolvePromptLanguage } from '../lib/promptLanguage.custom';
import { AiError } from '../../services/ai';
import {
    suggestActivitiesForKids,
    suggestClothingForKids,
    type ActivityKidInput,
    type ClothingDayMode,
    type ClothingKidInput,
    type FamilyDayContext,
} from '../ai/widgets.custom';
import { pickFallbackActivities } from '../ai/activityBank.custom';
import logger from '../../lib/logger';

// =============================================================================
// /api/ai/dashboard/* — the two widget routes that read the weather.
//
// Both answer the same two questions first: WHICH day are we talking about
// (`resolveTargetDay`), and what's the weather then? Hence the shared helpers.
//
// Failure policy differs between the two on purpose:
//   - clothing: an AI outage is a hard error; the card shows the weather.
//   - activities: any AI failure degrades to the static bank, because an empty
//     "what shall we do today?" card is the one outcome that feature exists to
//     prevent.
// =============================================================================

const router = Router();
router.use(authMiddleware);

const MAX_EXCLUDE = 20;

type DashboardKid = FamilyKid;

/**
 * What the app already knows about `dateKey`, to feed the activity prompt. This
 * is the difference between "give me ideas for a 7 and a 10 year old" (which any
 * chatbot answers) and a suggestion that knows there is a dessert on tonight's
 * plan and swimming at 14:00. Every list is capped: each line spends tokens the
 * model needs to hold on to while emitting strict JSON.
 */
const loadFamilyDayContext = async (userId: string, dateKey: string): Promise<FamilyDayContext> => {
    const [slots, appts, meals, chores] = await Promise.all([
        query(
            `SELECT title, start_time
             FROM schedule_entries
             WHERE user_id = $1
               AND schedule_type = 'activity'
               AND (specific_date = $2 OR (specific_date IS NULL AND day_of_week = $3))
             ORDER BY start_time ASC
             LIMIT 3`,
            // schedule_entries.day_of_week is ISO: 1 = Monday … 7 = Sunday.
            [userId, dateKey, new Date(`${dateKey}T00:00:00`).getDay() || 7],
        ),
        query(
            `SELECT title, start_time
             FROM appointments
             WHERE user_id = $1 AND start_time::date = $2
             ORDER BY start_time ASC
             LIMIT 3`,
            [userId, dateKey],
        ),
        query(
            // A meal plan points either at a recipe or at a free-text dish.
            `SELECT mp.meal_type, COALESCE(r.name, mp.custom_meal) AS dish
             FROM meal_plans mp
             LEFT JOIN recipes r ON r.id = mp.recipe_id
             WHERE mp.user_id = $1
               AND mp.date = $2
               AND COALESCE(r.name, mp.custom_meal) IS NOT NULL
             ORDER BY mp.meal_type ASC
             LIMIT 3`,
            [userId, dateKey],
        ),
        query(
            // due_date is a TIMESTAMP — cast before comparing to a date key.
            `SELECT title FROM tasks
             WHERE user_id = $1 AND due_date::date = $2 AND is_completed = false
             ORDER BY priority DESC
             LIMIT 3`,
            [userId, dateKey],
        ),
    ]);

    const busySlots: string[] = [];
    for (const r of slots.rows as Array<Record<string, unknown>>) {
        busySlots.push(`${String(r.title)} ${String(r.start_time).slice(0, 5)}`);
    }
    for (const r of appts.rows as Array<Record<string, unknown>>) {
        busySlots.push(String(r.title));
    }

    return {
        busySlots: busySlots.slice(0, 4),
        meals: (meals.rows as Array<Record<string, unknown>>).map(
            (r) => `${String(r.meal_type)} : ${String(r.dish)}`,
        ),
        chores: (chores.rows as Array<Record<string, unknown>>).map((r) => String(r.title)),
    };
};

const toKidInputs = (kids: DashboardKid[]): (ActivityKidInput & ClothingKidInput)[] =>
    kids.map((k) => ({
        id: k.id,
        firstName: k.name.split(' ')[0] ?? k.name,
        ageYears: k.ageYears,
        // Read by the activity prompt only; the outfit prompt ignores both.
        notes: k.notes,
        allergies: k.allergies,
    }));

/** A child as the browser sees it: never the notes or the allergies column. */
type PublicKid = Pick<DashboardKid, 'id' | 'name' | 'color' | 'birth_date' | 'ageYears'>;

interface WidgetContext {
    coords: ResolvedCoords;
    dayContext: TargetDay;
    summary: WeatherSummary;
    weather: TomorrowForecast;
    kids: PublicKid[];
    /** What the model is told about each child, the card notes included. */
    kidInputs: (ActivityKidInput & ClothingKidInput)[];
}

/**
 * Shared prologue: coordinates, the target day, its forecast and the children.
 * Sends the response itself (and returns null) when the caller cannot proceed.
 */
const loadWidgetContext = async (req: AuthRequest, res: Response): Promise<WidgetContext | null> => {
    const coords = await resolveCoordinates(req);
    if (!coords) {
        res.status(400).json({
            success: false,
            error: 'NO_LOCATION',
            message: 'No saved location',
        });
        return null;
    }

    const dayContext = resolveTargetDay();

    let weather;
    try {
        weather = await getForecastForDate(coords.latitude, coords.longitude, dayContext.date);
    } catch (err) {
        if (err instanceof WeatherError) {
            logger.warn('ai.dashboard.weather_failed', { code: err.code, message: err.message });
            res.status(err.status).json({
                success: false,
                error: err.code,
                message: err.message,
            });
            return null;
        }
        throw err;
    }

    const allKids = await loadFamilyKids(req.userId!);

    return {
        coords,
        dayContext,
        weather,
        summary: summarize(weather),
        // Two shapes on purpose: the response carries the display fields, the
        // prompt carries what the family wrote on each child's card.
        kids: allKids.map(({ id, name, color, birth_date, ageYears }) => ({
            id,
            name,
            color,
            birth_date,
            ageYears,
        })),
        kidInputs: toKidInputs(allKids),
    };
};

/**
 * POST /api/ai/dashboard/clothing-suggestions
 * Body: { latitude?: number, longitude?: number }   (override coords)
 *
 * The target day's forecast, the children, and one outfit per child. The
 * response carries `dayContext` so the card can title itself honestly ("Demain —
 * école" vs "Aujourd'hui — week-end") instead of assuming a school day.
 *
 * Degraded paths return 200 with a typed `code`, so the card renders a partial
 * state rather than an error banner: DISABLED (no model configured) and BAD_JSON
 * (model returned garbage) still carry the weather and the kids.
 */
router.post('/clothing-suggestions', async (req: AuthRequest, res) => {
    try {
        const ctx = await loadWidgetContext(req, res);
        if (!ctx) return;

        const base = {
            weather: ctx.weather,
            city: ctx.coords.city,
            kids: ctx.kids,
            dayContext: ctx.dayContext,
        };

        if (ctx.kids.length === 0) {
            return res.json({
                success: true,
                data: { ...base, suggestions: [], cached: false, model: '' },
            });
        }

        // First phase of the card, asked for with `instant: true`. It carries
        // the context and the weather and makes no model call, so a slow model
        // never holds the whole card blank.
        if (req.body?.instant === true) {
            return res.json({
                success: true,
                data: { ...base, suggestions: [], cached: false, model: '' },
            });
        }

        const settings = await loadEnabledAiSettings(req.userId!);
        if (!settings) {
            return res.json({
                success: true,
                data: {
                    ...base,
                    suggestions: [],
                    cached: false,
                    model: '',
                    aiUnavailable: true,
                    code: 'DISABLED',
                },
            });
        }

        // The client sends the language it is displaying; anything unknown is
        // English. The outfit copy is written by the model, so it cannot come
        // from the client's own translations.
        const lang = resolvePromptLanguage(req.body?.lang);

        try {
            const result = await suggestClothingForKids(ctx.summary, ctx.kidInputs, {
                settings,
                mode: ctx.dayContext.mode as ClothingDayMode,
                dateKey: ctx.dayContext.date,
                lang,
            });
            return res.json({
                success: true,
                data: {
                    ...base,
                    suggestions: result.suggestions,
                    cached: result.cached,
                    model: settings.model,
                },
            });
        } catch (err) {
            // The model answering garbage is worth degrading for: the weather and
            // the kids are still useful without the outfit pills.
            if (err instanceof AiError && err.code === 'AI_INVALID_RESPONSE') {
                logger.info('ai.clothing.degraded', { code: err.code, message: err.message });
                return res.json({
                    success: true,
                    data: {
                        ...base,
                        suggestions: [],
                        cached: false,
                        model: '',
                        aiUnavailable: true,
                        code: 'BAD_JSON',
                    },
                });
            }
            throw err;
        }
    } catch (error) {
        handleAiError(res, error, 'dashboard_clothing');
    }
});

/**
 * POST /api/ai/dashboard/kids-activities
 * Body: { latitude?, longitude?, exclude?: string[] }
 *
 * Screen-free ideas for a day the kids spend at home. The card only mounts on a
 * home day, but the route stays honest and returns the context either way.
 *
 * `exclude` carries the titles already shown, so "other ideas" asks for
 * something new instead of rotating the same four all summer.
 */
router.post('/kids-activities', async (req: AuthRequest, res) => {
    try {
        const ctx = await loadWidgetContext(req, res);
        if (!ctx) return;

        const rawExclude = req.body?.exclude;
        const exclude = Array.isArray(rawExclude)
            ? rawExclude.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, MAX_EXCLUDE)
            : [];

        const base = {
            weather: ctx.weather,
            city: ctx.coords.city,
            kids: ctx.kids,
            dayContext: ctx.dayContext,
        };

        const kidInputs = ctx.kidInputs;
        // Rain, strong wind or cold → keep the ideas indoors.
        const outdoorOk =
            ctx.summary.precipBucket === 'none' &&
            ctx.summary.windyBucket !== 'windy' &&
            ctx.summary.tempMax >= 12;
        // Bank ideas come back as ids + material slugs: the client renders them
        // through i18n, so the offline card is in the reader's language too (no
        // per-language copy of the bank on the server). The degraded path and
        // the instant phase serve this exact list.
        const bankActivities =
            ctx.kids.length === 0
                ? []
                : pickFallbackActivities({
                      kids: ctx.kids.map((k) => ({ id: k.id, ageYears: k.ageYears })),
                      outdoorOk,
                      dateKey: ctx.dayContext.date,
                      exclude,
                  });
        const fallback = () => ({
            ...base,
            activities: bankActivities,
            cached: false,
            model: '',
            aiUnavailable: true,
        });

        if (ctx.kids.length === 0) {
            return res.json({
                success: true,
                data: { ...base, activities: [], cached: false, model: '' },
            });
        }

        // First phase of the card, asked for with `instant: true`. It carries
        // the context and the offline bank and makes no model call, so the
        // reader sees real ideas instead of a skeleton for the 15-60 s a model
        // answer takes. Not `aiUnavailable`: the model has not been asked yet,
        // and the client shows its own "more ideas coming" state from the second
        // request being in flight.
        if (req.body?.instant === true) {
            return res.json({
                success: true,
                data: { ...base, activities: bankActivities, cached: false, model: '' },
            });
        }

        const settings = await loadEnabledAiSettings(req.userId!);
        if (!settings) {
            return res.json({ success: true, data: { ...fallback(), code: 'DISABLED' } });
        }

        const lang = resolvePromptLanguage(req.body?.lang);

        try {
            const familyContext = await loadFamilyDayContext(req.userId!, ctx.dayContext.date);
            const result = await suggestActivitiesForKids(ctx.summary, kidInputs, familyContext, {
                settings,
                dateKey: ctx.dayContext.date,
                exclude,
                lang,
            });
            return res.json({
                success: true,
                data: {
                    ...base,
                    activities: result.activities,
                    cached: result.cached,
                    model: settings.model,
                },
            });
        } catch (err) {
            // Any AI failure degrades here, not just the soft ones: a provider
            // outage or a timeout is the likeliest failure in production, and
            // "nothing to do today" hands the day to the tablet.
            if (err instanceof AiError) {
                logger.info('ai.activities.degraded', { code: err.code, message: err.message });
                return res.json({
                    success: true,
                    data: {
                        ...fallback(),
                        code: err.code === 'AI_INVALID_RESPONSE' ? 'BAD_JSON' : err.code,
                    },
                });
            }
            throw err;
        }
    } catch (error) {
        handleAiError(res, error, 'dashboard_kids_activities');
    }
});

export default router;
