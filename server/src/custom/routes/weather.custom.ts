import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { query } from '../../db';
import { geocodeCity, getWeeklyForecast } from '../weather/WeatherService.custom';
import { WeatherError } from '../weather/errors.custom';
import { notifyFamily } from '../lib/familyNotify.custom';
import logger from '../../lib/logger';

// =============================================================================
// /api/weather routes
//
// Today this surface is just the multi-day forecast used by the dashboard
// "weather details" modal. Auth-gated and namespaced separately from /api/ai
// because no AI tokens are spent here — it's a pure weather lookup.
// =============================================================================

const router = Router();
router.use(authMiddleware);

interface ForecastBody {
    latitude?: number;
    longitude?: number;
    days: number;
}

/**
 * Body: { latitude?, longitude?, days? }. Coordinates must come as a pair —
 * they are all-or-nothing, since a lone latitude would silently fall back to
 * the saved city's longitude. Returns null when the body is unusable.
 */
const parseBody = (body: unknown): ForecastBody | null => {
    const b = (body ?? {}) as Record<string, unknown>;
    const hasLat = b.latitude !== undefined && b.latitude !== null;
    const hasLon = b.longitude !== undefined && b.longitude !== null;

    let latitude: number | undefined;
    let longitude: number | undefined;
    if (hasLat || hasLon) {
        if (
            typeof b.latitude !== 'number' ||
            typeof b.longitude !== 'number' ||
            !Number.isFinite(b.latitude) ||
            !Number.isFinite(b.longitude) ||
            b.latitude < -90 ||
            b.latitude > 90 ||
            b.longitude < -180 ||
            b.longitude > 180
        ) {
            return null;
        }
        latitude = b.latitude;
        longitude = b.longitude;
    }

    const rawDays = b.days;
    const days =
        typeof rawDays === 'number' && Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 14
            ? rawDays
            : 7;

    return { latitude, longitude, days };
};

/**
 * POST /api/weather/forecast
 * Body: { latitude?, longitude?, days? }
 *
 * Resolves coordinates from the override body or the user's saved city, then
 * returns up to `days` days of daily forecast (default 7). 400 if no
 * location is available.
 */
router.post('/forecast', async (req: AuthRequest, res) => {
    try {
        const body = parseBody(req.body);
        if (!body) {
            return res.status(400).json({
                success: false,
                error: 'BAD_REQUEST',
                message: 'Invalid latitude/longitude/days',
            });
        }

        let latitude = body.latitude ?? null;
        let longitude = body.longitude ?? null;
        let cityLabel: string | null = null;

        if (latitude === null || longitude === null) {
            const userRow = await query(
                'SELECT city, latitude, longitude FROM users WHERE id = $1',
                [req.userId],
            );
            const u = userRow.rows[0] as
                | {
                      city: string | null;
                      latitude: string | number | null;
                      longitude: string | number | null;
                  }
                | undefined;
            if (u && u.latitude !== null && u.longitude !== null) {
                latitude = Number(u.latitude);
                longitude = Number(u.longitude);
                cityLabel = u.city ?? null;
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'NO_LOCATION',
                    message: 'No saved location',
                });
            }
        }

        const forecast = await getWeeklyForecast(latitude, longitude, body.days);

        res.json({ success: true, data: { ...forecast, city: cityLabel } });
    } catch (error) {
        if (error instanceof WeatherError) {
            logger.warn('weather.forecast_failed', {
                code: error.code,
                message: error.message,
            });
            // House error shape (see routes/ai.ts handleAiError): the code
            // travels in `error`, the human detail in `message`.
            return res.status(error.status).json({
                success: false,
                error: error.code,
                message: error.message,
            });
        }
        logger.error('weather.forecast_unexpected', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// =============================================================================
// /api/weather/location — the family's shared city.
//
// The fork hung this off /api/auth (PUT /api/auth/location) and kept the result
// in the client's auth context. In the port it lives on the weather surface:
// same behaviour (geocode through Open-Meteo, store the resolved coordinates on
// the user row), but no upstream route is edited and the widgets read the saved
// location back from here.
//
// Read and write both use `req.userId` (the family owner's row), so every
// member shares one city; a save fans a `family` WebSocket update out to the
// whole family (`notifyFamily`) so the other dashboards refresh.
// =============================================================================

interface SavedLocation {
    city: string | null;
    country_code: string | null;
    latitude: number | null;
    longitude: number | null;
}

const asNumber = (value: string | number | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value);

/** GET /api/weather/location → the saved city, or null fields when none is set. */
router.get('/location', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'SELECT city, country_code, latitude, longitude FROM users WHERE id = $1',
            [req.userId],
        );
        const row = result.rows[0] as
            | {
                  city: string | null;
                  country_code: string | null;
                  latitude: string | number | null;
                  longitude: string | number | null;
              }
            | undefined;
        if (!row) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const data: SavedLocation = {
            city: row.city ?? null,
            country_code: row.country_code ?? null,
            latitude: asNumber(row.latitude),
            longitude: asNumber(row.longitude),
        };
        res.json({ success: true, data });
    } catch (error) {
        logger.error('weather.location_read_unexpected', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PUT /api/weather/location — body: { city }.
 *
 * Geocodes the free-text city and stores the coordinates the dashboard widgets
 * read. A city that cannot be resolved is a 422 rather than a silent no-op.
 */
router.put('/location', async (req: AuthRequest, res) => {
    try {
        const raw = (req.body ?? {}).city;
        const city = typeof raw === 'string' ? raw.trim().slice(0, 120) : '';
        if (!city) {
            return res.status(400).json({ success: false, error: 'BAD_REQUEST', message: 'city is required' });
        }

        let geocoded;
        try {
            geocoded = await geocodeCity(city);
        } catch (error) {
            if (error instanceof WeatherError) {
                logger.warn('weather.update_location_failed', {
                    code: error.code,
                    message: error.message,
                });
                return res.status(error.status).json({
                    success: false,
                    error: error.code,
                    message: error.message,
                });
            }
            throw error;
        }

        // userId: the city is the family's shared location, so it is stored on
        // the owner's row every member reads.
        const result = await query(
            `UPDATE users
             SET city = $1, country_code = $2, latitude = $3, longitude = $4
             WHERE id = $5
             RETURNING city, country_code, latitude, longitude`,
            [
                geocoded.city,
                geocoded.country_code,
                geocoded.latitude,
                geocoded.longitude,
                req.userId,
            ],
        );
        const row = result.rows[0] as
            | {
                  city: string | null;
                  country_code: string | null;
                  latitude: string | number | null;
                  longitude: string | number | null;
              }
            | undefined;
        if (!row) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const data: SavedLocation = {
            city: row.city ?? null,
            country_code: row.country_code ?? null,
            latitude: asNumber(row.latitude),
            longitude: asNumber(row.longitude),
        };
        res.json({ success: true, data });

        // Every member's dashboard reads this city: push the family event so
        // their open clients drop their cached location and widgets.
        notifyFamily(req.userId!, { type: 'update', entity: 'family', action: 'updated' }).catch(
            (error: unknown) => {
                logger.warn('weather.family_notify_failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            },
        );
    } catch (error) {
        logger.error('weather.update_location_unexpected', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
