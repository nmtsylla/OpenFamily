import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../../middleware/auth';
import logger from '../../lib/logger';
import { loadEnabledAiSettings, handleAiError } from '../lib/aiSettings.custom';
import { resolvePromptLanguage, type PromptLanguage } from '../lib/promptLanguage.custom';
import { resolveCoordinates } from '../lib/location.custom';
import { isCalendarDate } from '../lib/validation.custom';
import { loadOutingParticipants } from '../lib/kids.custom';
import { findNearbyPlaces, rankPlaces, preserveNearestHalalRestaurant, type NearbyPlace } from '../lib/places.custom';

import {
    generateOutingPlan,
    outingWindow,
    OUTING_DURATIONS,
    OUTING_PARTIES,
    type OutingDuration,
    type OutingParty,
} from '../ai/outings.custom';
import { getWeeklyForecast, geocodeCity, type DailyForecast } from '../weather/WeatherService.custom';
import { WeatherError } from '../weather/errors.custom';



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

router.post('/area', async (req: AuthRequest, res) => {
    const city = typeof req.body?.city === 'string' ? req.body.city.trim().slice(0, 100) : '';
    if (!city) return res.status(400).json({ success: false, error: 'INVALID_CITY' });
    try {
        const result = await geocodeCity(city);
        if (
            !result.city.trim() ||
            !Number.isFinite(result.latitude) || result.latitude < -90 || result.latitude > 90 ||
            !Number.isFinite(result.longitude) || result.longitude < -180 || result.longitude > 180
        ) {
            return res.status(502).json({ success: false, error: 'AREA_LOOKUP_FAILED' });
        }
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof WeatherError && error.code === 'CITY_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'CITY_NOT_FOUND' });
        }
        logger.warn('outings.area_lookup_failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(502).json({ success: false, error: 'AREA_LOOKUP_FAILED' });
    }
});
/**
 * POST /api/outings/suggest
 * Body: { date?, party?, duration?, lang?, location, latitude?, longitude?, city?, instant? }
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
        const instant = (req.body ?? {}).instant === true;

        const requestedLocation = req.body?.location;
        if (requestedLocation !== 'saved' && requestedLocation !== 'current' && requestedLocation !== 'area') {
            return res.status(400).json({ success: false, error: 'INVALID_LOCATION' });
        }
        const hasLatitude = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'latitude');
        const hasLongitude = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'longitude');
        const areaLabel = requestedLocation === 'area' && typeof req.body?.city === 'string' ? req.body.city.trim().slice(0, 100) : null;
        if (requestedLocation === 'saved' && (hasLatitude || hasLongitude)) {
            return res.status(400).json({ success: false, error: 'INVALID_LOCATION' });
        }
        if (requestedLocation === 'area' && !areaLabel) {
            return res.status(400).json({ success: false, error: 'INVALID_CITY' });
        }

        const latitude = req.body?.latitude;
        const longitude = req.body?.longitude;
        if (
            requestedLocation !== 'saved' &&
            (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
                typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
        ) {
            return res.status(400).json({ success: false, error: 'INVALID_LOCATION' });
        }
        const coords = requestedLocation === 'saved'
            ? await resolveCoordinates(req)
            : { latitude, longitude, city: requestedLocation === 'area' ? areaLabel : null };
        if (!coords) return res.status(400).json({ success: false, error: 'NO_LOCATION' });

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
                const participants = await loadOutingParticipants(req.userId!, body.party);
                const candidates = preserveNearestHalalRestaurant(places ?? [], MAX_PLACES_TO_MODEL);
                const { plan } = await generateOutingPlan(
                    settings,
                    {
                        party: body.party,
                        duration: body.duration,
                        date: body.date,
                        city: areaLabel ?? coords.city,
                        weather,
                        participants,
                        places: candidates,
                    },
                    body.lang,
                );
                picks = plan.picks.flatMap((pick) => {
                    const place = candidates[pick.ref - 1];
                    return place ? [{ place, why: pick.why, ...outingWindow(pick, body.duration) }] : [];
                });
                ideas = plan.ideas;
            } catch (error) {
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
            picks = preserveNearestHalalRestaurant(rankPlaces(places, rainLikely), MAX_PLACES_NO_AI)
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
                city: areaLabel ?? coords.city,
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
