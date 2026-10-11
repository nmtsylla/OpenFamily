// =============================================================================
// /api/outings/suggest — the AI-assisted family outing planner behind the
// Planning page.
//
// Division of labour, and why:
//   - lib/places.custom.ts asks OpenStreetMap what actually exists around the
//     family (a model asked for local parks invents them);
//   - ai/outings.custom.ts asks the model which of those places fits THIS day —
//     weather, who is coming, the ages and the constraints on the children's
//     cards — plus a few ideas that need no place at all.
//
// Nothing is persisted here: the family reads the proposals and adds the one it
// likes to the planning through upstream's own POST /api/planning, so this route
// owns no table and no migration.
//
// Degradation is deliberate and total: with no model configured (or a model
// outage) the answer is still the real places, ranked by distance — indoor first
// on a wet day. With OpenStreetMap unreachable, the model's place-less ideas are
// still useful. Only both failing together produces an empty answer.
// =============================================================================

import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../../middleware/auth';
import logger from '../../lib/logger';
import { loadEnabledAiSettings, handleAiError } from '../lib/aiSettings.custom';
import { resolvePromptLanguage, type PromptLanguage } from '../lib/promptLanguage.custom';
import { resolveCoordinates } from '../lib/location.custom';
import { isCalendarDate } from '../lib/validation.custom';
import { loadFamilyKids } from '../lib/kids.custom';
import { findNearbyPlaces, rankPlaces, type NearbyPlace } from '../lib/places.custom';
import {
    generateOutingPlan,
    outingWindow,
    OUTING_DURATIONS,
    OUTING_PARTIES,
    type OutingDuration,
    type OutingParty,
} from '../ai/outings.custom';
import { getWeeklyForecast, type DailyForecast } from '../weather/WeatherService.custom';

const router = Router();
router.use(authMiddleware);

/** Places handed to the model. Every line spends tokens it must hold while emitting JSON. */
const MAX_PLACES_TO_MODEL = 18;
/** Places shown when the model is off or failed — the honest "nearest first" list. */
const MAX_PLACES_NO_AI = 6;
/** Beyond Open-Meteo's 16-day horizon there is no forecast to plan against. */
const FORECAST_HORIZON_DAYS = 16;
/** Rain probability from which "indoor first" is the better default ranking. */
const RAIN_LIKELY_PCT = 50;

const toDateKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

interface OutingsBody {
    date: string;
    party: OutingParty;
    duration: OutingDuration;
    lang: PromptLanguage;
}

/** Null when the body cannot be used; each field falls back rather than failing. */
const parseBody = (body: unknown, today: string): OutingsBody | null => {
    const b = (body ?? {}) as Record<string, unknown>;
    const date = typeof b.date === 'string' && isCalendarDate(b.date.trim()) ? b.date.trim() : today;

    const party = OUTING_PARTIES.includes(b.party as OutingParty) ? (b.party as OutingParty) : 'family';
    const duration = OUTING_DURATIONS.includes(b.duration as OutingDuration)
        ? (b.duration as OutingDuration)
        : 'half_day';

    return { date, party, duration, lang: resolvePromptLanguage(b.lang) };
};

const daysUntil = (dateKey: string, todayKey: string): number =>
    Math.round(
        (new Date(`${dateKey}T00:00:00`).getTime() - new Date(`${todayKey}T00:00:00`).getTime()) /
            (24 * 60 * 60 * 1000),
    );

/** That day's forecast, or null when it is beyond the horizon or Open-Meteo is down. */
const forecastFor = async (
    latitude: number,
    longitude: number,
    dateKey: string,
    todayKey: string,
): Promise<DailyForecast | null> => {
    const offset = daysUntil(dateKey, todayKey);
    if (offset < 0 || offset >= FORECAST_HORIZON_DAYS) return null;
    try {
        const weekly = await getWeeklyForecast(latitude, longitude, offset + 1);
        return weekly.days.find((day) => day.date === dateKey) ?? null;
    } catch (err) {
        logger.warn('outings.forecast_failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
};

/**
 * POST /api/outings/suggest
 * Body: { date?, party?, duration?, lang?, latitude?, longitude? }
 *
 * `party` is who is coming (`family` | `kids` | `parents`) — the difference
 * between "the playground two streets away" and "the museum the two of us never
 * get to see". Parents-only answers carry no child constraints at all.
 */
router.post('/suggest', async (req: AuthRequest, res) => {
    try {
        const today = toDateKey(new Date());
        const body = parseBody(req.body, today);
        if (!body) {
            return res.status(400).json({ success: false, error: 'INVALID_DATE' });
        }
        // The dashboard widgets' two-phase pattern, for the same reason: the
        // model takes the best part of a minute on a self-hosted gateway, and the
        // places need no model at all. `instant: true` answers with those alone;
        // the client then asks again for the ranked answer.
        const instant = (req.body ?? {}).instant === true;

        const coords = await resolveCoordinates(req);
        if (!coords) {
            return res.status(400).json({ success: false, error: 'NO_LOCATION' });
        }

        const kids = body.party === 'parents' ? [] : await loadFamilyKids(req.userId!);
        const forecast = await forecastFor(coords.latitude, coords.longitude, body.date, today);

        let places: NearbyPlace[] | null = null;
        try {
            places = await findNearbyPlaces(coords.latitude, coords.longitude);
        } catch (err) {
            logger.warn('outings.places_unavailable', {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        const weather = forecast
            ? {
                  label: forecast.label,
                  tempMin: forecast.tempMin,
                  tempMax: forecast.tempMax,
                  weatherCode: forecast.weatherCode,
                  precipitationProbability: forecast.precipitationProbability,
              }
            : null;

        const settings = await loadEnabledAiSettings(req.userId!);
        let picks: {
            place: NearbyPlace;
            why: string;
            startTime: string;
            endTime: string;
        }[] = [];
        let ideas: { title: string; description: string; indoor: boolean }[] = [];

        if (settings && !instant) {
            try {
                const candidates = (places ?? []).slice(0, MAX_PLACES_TO_MODEL);
                const { plan } = await generateOutingPlan(
                    settings,
                    {
                        party: body.party,
                        duration: body.duration,
                        date: body.date,
                        city: coords.city,
                        weather,
                        kids,
                        places: candidates,
                    },
                    body.lang,
                );

                picks = plan.picks.flatMap((pick) => {
                    const place = candidates[pick.ref - 1];
                    if (!place) return [];
                    return [{ place, why: pick.why, ...outingWindow(pick, body.duration) }];
                });
                ideas = plan.ideas;
            } catch (error) {
                // Timeout, bad JSON, provider outage: the places are still real.
                logger.warn('outings.plan_failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // `ai` describes the ranking, not the ideas: a model that wrote ideas but
        // ranked nothing leaves the nearest-first fallback in place below. On the
        // instant phase the ranking is still to come — `pending`.
        const ai: 'ok' | 'disabled' | 'failed' | 'pending' =
            picks.length > 0 ? 'ok' : instant && settings ? 'pending' : settings ? 'failed' : 'disabled';

        if (picks.length === 0 && places && places.length > 0) {
            const rainLikely = (forecast?.precipitationProbability ?? 0) >= RAIN_LIKELY_PCT;
            picks = rankPlaces(places, rainLikely)
                .slice(0, MAX_PLACES_NO_AI)
                .map((place) => ({
                    place,
                    why: '',
                    ...outingWindow({ startTime: null, durationMinutes: null }, body.duration),
                }));
        }

        res.json({
            success: true,
            data: {
                date: body.date,
                party: body.party,
                duration: body.duration,
                city: coords.city,
                weather,
                ai,
                placesSource: places === null ? 'unavailable' : 'osm',
                places: picks.map(({ place, why, startTime, endTime }) => ({
                    id: place.id,
                    name: place.name,
                    category: place.category,
                    latitude: place.latitude,
                    longitude: place.longitude,
                    distanceKm: Math.round(place.distanceKm * 10) / 10,
                    openingHours: place.openingHours,
                    website: place.website,
                    fee: place.fee,
                    why,
                    startTime,
                    endTime,
                })),
                ideas,
            },
        });
    } catch (error) {
        handleAiError(res, error, 'outings_suggest');
    }
});

export default router;
