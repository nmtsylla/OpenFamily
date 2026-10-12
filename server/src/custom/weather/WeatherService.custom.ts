// =============================================================================
// WeatherService — thin client over Open-Meteo
//
// Two responsibilities:
//   1. Geocoding: turn a free-text city name into { city, country, lat, lon }.
//   2. Forecast: fetch tomorrow's daily summary for a (lat, lon) pair.
//
// Both calls are server-side so we can:
//   - hide the third-party from the browser (avoids CORS, simplifies CSP),
//   - share an in-memory cache across users hitting the same coordinates,
//   - wrap errors into a typed taxonomy the routes can map cleanly.
// =============================================================================
import logger from '../../lib/logger';
import { getWeatherConfig } from './config.custom';
import { WeatherError } from './errors.custom';

export interface GeocodedCity {
    city: string;
    country_code: string | null;
    latitude: number;
    longitude: number;
}

export interface TomorrowForecast {
    date: string; // YYYY-MM-DD
    tempMin: number;
    tempMax: number;
    precipitationMm: number;
    precipitationProbability: number;
    windSpeedMax: number;
    weatherCode: number;
    label: string;
    timezone: string;
}

export type TempBucket = 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
export type PrecipBucket = 'none' | 'light' | 'heavy';
export type WindBucket = 'calm' | 'breezy' | 'windy';

export interface WeatherSummary {
    tempMin: number;
    tempMax: number;
    label: string;
    weatherCode: number;
    tempMinBucket: TempBucket;
    precipBucket: PrecipBucket;
    windyBucket: WindBucket;
}

// ---------------------------------------------------------------------------
// Open-Meteo WMO weather code labels (subset, French).
// Full list: https://open-meteo.com/en/docs (search "weathercode")
// ---------------------------------------------------------------------------
const WEATHER_CODE_LABELS: Record<number, string> = {
    0: 'Ciel dégagé',
    1: 'Ciel principalement clair',
    2: 'Partiellement nuageux',
    3: 'Couvert',
    45: 'Brouillard',
    48: 'Brouillard givrant',
    51: 'Bruine légère',
    53: 'Bruine modérée',
    55: 'Bruine dense',
    56: 'Bruine verglaçante légère',
    57: 'Bruine verglaçante dense',
    61: 'Pluie faible',
    63: 'Pluie modérée',
    65: 'Pluie forte',
    66: 'Pluie verglaçante légère',
    67: 'Pluie verglaçante forte',
    71: 'Neige faible',
    73: 'Neige modérée',
    75: 'Neige forte',
    77: 'Grains de neige',
    80: 'Averses faibles',
    81: 'Averses modérées',
    82: 'Averses violentes',
    85: 'Averses de neige faibles',
    86: 'Averses de neige fortes',
    95: 'Orage',
    96: 'Orage avec grêle légère',
    99: 'Orage avec grêle forte',
};

// ---------------------------------------------------------------------------
// In-memory forecast cache. Keyed by rounded coordinates so a small drift
// between two users in the same area still hits the same entry. The TTL is
// short (default 10 min) — Open-Meteo data updates hourly anyway.
// ---------------------------------------------------------------------------
interface CacheEntry {
    value: TomorrowForecast;
    expiresAt: number;
}
const forecastCache = new Map<string, CacheEntry>();

const fetchJsonWithTimeout = async (url: string, timeoutMs: number): Promise<unknown> => {
    let res: Response;
    try {
        res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') {
            throw new WeatherError('TIMEOUT', `Open-Meteo timed out after ${timeoutMs}ms`, err);
        }
        throw new WeatherError(
            'PROVIDER_ERROR',
            `Open-Meteo request failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
        );
    }

    if (!res.ok) {
        // Surface the body when small to ease debugging in dev — Open-Meteo
        // returns a `reason` field on error.
        let detail = '';
        try {
            const text = await res.text();
            detail = text.length > 200 ? text.slice(0, 200) + '…' : text;
        } catch {
            // ignore
        }
        throw new WeatherError(
            'PROVIDER_ERROR',
            `Open-Meteo HTTP ${res.status}: ${detail || res.statusText}`,
        );
    }

    try {
        return await res.json();
    } catch (err) {
        throw new WeatherError('PROVIDER_ERROR', 'Open-Meteo returned non-JSON body', err);
    }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a city name to coordinates via Open-Meteo's geocoding endpoint.
 * Returns the first match. Throws `CITY_NOT_FOUND` if zero results.
 */
export const geocodeCity = async (rawName: string): Promise<GeocodedCity> => {
    const name = rawName.trim();
    if (!name) {
        throw new WeatherError('BAD_REQUEST', 'city name is required');
    }

    const cfg = getWeatherConfig();
    const url = new URL(cfg.geocodingBaseUrl);
    url.searchParams.set('name', name);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', cfg.defaultLanguage);
    url.searchParams.set('format', 'json');

    const data = (await fetchJsonWithTimeout(url.toString(), cfg.requestTimeoutMs)) as {
        results?: Array<{
            name?: unknown;
            country_code?: unknown;
            latitude?: unknown;
            longitude?: unknown;
        }>;
    } | null;

    const first = data?.results?.[0];
    if (
        !first ||
        typeof first.latitude !== 'number' ||
        typeof first.longitude !== 'number' ||
        typeof first.name !== 'string'
    ) {
        throw new WeatherError('CITY_NOT_FOUND', `No match for city "${name}"`);
    }

    return {
        city: first.name,
        country_code:
            typeof first.country_code === 'string' && first.country_code.length === 2
                ? first.country_code.toUpperCase()
                : null,
        latitude: first.latitude,
        longitude: first.longitude,
    };
};

/**
 * Fetch the daily forecast for one absolute day (`dateKey`, YYYY-MM-DD) at the
 * given coordinates. Cached briefly in-process to spare Open-Meteo from a
 * thundering herd at dashboard load.
 *
 * Both the requested day and the next come back in a single Open-Meteo response
 * (`forecast_days=2`), so the date only selects which row we read — no extra
 * round-trip. The cache is keyed by the day it describes, not by an offset from
 * today, so an entry cannot outlive the midnight that made the offset stale.
 * See `resolveTargetDay` in ../lib/dayContext for which day the dashboard wants.
 */
export const getForecastForDate = async (
    latitude: number,
    longitude: number,
    dateKey: string,
): Promise<TomorrowForecast> => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new WeatherError('BAD_REQUEST', 'latitude and longitude must be finite numbers');
    }

    const cfg = getWeatherConfig();
    // Rounded so two users in the same area share the entry.
    const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}:${dateKey}`;
    const now = Date.now();
    const hit = forecastCache.get(key);
    if (hit && hit.expiresAt > now) {
        return hit.value;
    }

    const url = new URL(cfg.forecastBaseUrl);
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set(
        'daily',
        [
            'temperature_2m_max',
            'temperature_2m_min',
            'precipitation_sum',
            'precipitation_probability_max',
            'weathercode',
            'windspeed_10m_max',
        ].join(','),
    );
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '2');

    interface DailyRow {
        time?: unknown;
        temperature_2m_min?: unknown;
        temperature_2m_max?: unknown;
        precipitation_sum?: unknown;
        precipitation_probability_max?: unknown;
        weathercode?: unknown;
        windspeed_10m_max?: unknown;
    }
    const data = (await fetchJsonWithTimeout(url.toString(), cfg.requestTimeoutMs)) as {
        daily?: DailyRow;
        timezone?: unknown;
    } | null;

    const daily = data?.daily;
    const times = daily && Array.isArray(daily.time) ? (daily.time as unknown[]) : null;
    const idx = times ? times.findIndex((t) => String(t) === dateKey) : -1;
    if (
        !daily ||
        !times ||
        idx < 0 ||
        !Array.isArray(daily.temperature_2m_min) ||
        !Array.isArray(daily.temperature_2m_max)
    ) {
        throw new WeatherError('PROVIDER_ERROR', 'Open-Meteo response missing daily fields');
    }

    const pick = <T>(arr: unknown, fallback: T): T => {
        if (Array.isArray(arr) && arr.length > idx) {
            const v = arr[idx];
            if (typeof v === typeof fallback) return v as T;
        }
        return fallback;
    };

    const weatherCode = pick<number>(daily.weathercode, 0);
    const forecast: TomorrowForecast = {
        date: String(times[idx]),
        tempMin: pick<number>(daily.temperature_2m_min, 0),
        tempMax: pick<number>(daily.temperature_2m_max, 0),
        precipitationMm: pick<number>(daily.precipitation_sum, 0),
        precipitationProbability: pick<number>(daily.precipitation_probability_max, 0),
        windSpeedMax: pick<number>(daily.windspeed_10m_max, 0),
        weatherCode,
        // WMO code → French wording; the AI prompts use it as-is.
        label: WEATHER_CODE_LABELS[weatherCode] ?? `Conditions inconnues (${weatherCode})`,
        timezone: typeof data?.timezone === 'string' ? data.timezone : 'UTC',
    };

    forecastCache.set(key, { value: forecast, expiresAt: now + cfg.cacheTtlMs });
    logger.debug('weather.forecast_fetched', {
        key,
        tempMin: forecast.tempMin,
        tempMax: forecast.tempMax,
        weatherCode: forecast.weatherCode,
    });

    return forecast;
};

// ---------------------------------------------------------------------------
// Weekly forecast — used by the dashboard "weather details" modal. Carries
// more fields than TomorrowForecast (sunrise/sunset, UV, humidity proxy via
// apparent_temperature) so the dialog can show a richer breakdown without
// triggering a second Open-Meteo round-trip.
// ---------------------------------------------------------------------------

export interface DailyForecast {
    date: string;
    tempMin: number;
    tempMax: number;
    apparentTempMin: number;
    apparentTempMax: number;
    precipitationMm: number;
    precipitationProbability: number;
    windSpeedMax: number;
    weatherCode: number;
    label: string;
    sunrise: string | null;
    sunset: string | null;
    uvIndexMax: number | null;
}

export interface WeeklyForecast {
    days: DailyForecast[];
    timezone: string;
}

interface WeeklyCacheEntry {
    value: WeeklyForecast;
    expiresAt: number;
}
const weeklyCache = new Map<string, WeeklyCacheEntry>();

/**
 * Fetch a `days`-day daily forecast for the given coordinates. Cached briefly
 * in-process. Independent from the `getTomorrowForecast` cache because the
 * shape and the requested day count differ.
 */
export const getWeeklyForecast = async (
    latitude: number,
    longitude: number,
    days = 7,
): Promise<WeeklyForecast> => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new WeatherError('BAD_REQUEST', 'latitude and longitude must be finite numbers');
    }
    const safeDays = Math.max(1, Math.min(16, Math.floor(days)));

    const cfg = getWeatherConfig();
    const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}:${safeDays}`;
    const now = Date.now();
    const hit = weeklyCache.get(key);
    if (hit && hit.expiresAt > now) {
        return hit.value;
    }

    const url = new URL(cfg.forecastBaseUrl);
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set(
        'daily',
        [
            'temperature_2m_max',
            'temperature_2m_min',
            'apparent_temperature_max',
            'apparent_temperature_min',
            'precipitation_sum',
            'precipitation_probability_max',
            'weathercode',
            'windspeed_10m_max',
            'sunrise',
            'sunset',
            'uv_index_max',
        ].join(','),
    );
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(safeDays));

    interface DailyBlock {
        time?: unknown;
        temperature_2m_min?: unknown;
        temperature_2m_max?: unknown;
        apparent_temperature_min?: unknown;
        apparent_temperature_max?: unknown;
        precipitation_sum?: unknown;
        precipitation_probability_max?: unknown;
        weathercode?: unknown;
        windspeed_10m_max?: unknown;
        sunrise?: unknown;
        sunset?: unknown;
        uv_index_max?: unknown;
    }
    const data = (await fetchJsonWithTimeout(url.toString(), cfg.requestTimeoutMs)) as {
        daily?: DailyBlock;
        timezone?: unknown;
    } | null;

    const daily = data?.daily;
    if (
        !daily ||
        !Array.isArray(daily.time) ||
        daily.time.length === 0 ||
        !Array.isArray(daily.temperature_2m_min) ||
        !Array.isArray(daily.temperature_2m_max)
    ) {
        throw new WeatherError('PROVIDER_ERROR', 'Open-Meteo response missing daily fields');
    }

    const at = <T>(arr: unknown, i: number, fallback: T): T => {
        if (Array.isArray(arr) && i < arr.length) {
            const v = arr[i];
            if (v !== null && v !== undefined && typeof v === typeof fallback) return v as T;
        }
        return fallback;
    };
    const atString = (arr: unknown, i: number): string | null => {
        if (Array.isArray(arr) && i < arr.length) {
            const v = arr[i];
            if (typeof v === 'string' && v.length > 0) return v;
        }
        return null;
    };
    const atNumberOrNull = (arr: unknown, i: number): number | null => {
        if (Array.isArray(arr) && i < arr.length) {
            const v = arr[i];
            if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
        return null;
    };

    const dayCount = Math.min(safeDays, daily.time.length);
    const out: DailyForecast[] = [];
    for (let i = 0; i < dayCount; i += 1) {
        const code = at<number>(daily.weathercode, i, 0);
        out.push({
            date: String(daily.time[i]),
            tempMin: at<number>(daily.temperature_2m_min, i, 0),
            tempMax: at<number>(daily.temperature_2m_max, i, 0),
            apparentTempMin: at<number>(daily.apparent_temperature_min, i, 0),
            apparentTempMax: at<number>(daily.apparent_temperature_max, i, 0),
            precipitationMm: at<number>(daily.precipitation_sum, i, 0),
            precipitationProbability: at<number>(daily.precipitation_probability_max, i, 0),
            windSpeedMax: at<number>(daily.windspeed_10m_max, i, 0),
            weatherCode: code,
            label: WEATHER_CODE_LABELS[code] ?? `Conditions inconnues (${code})`,
            sunrise: atString(daily.sunrise, i),
            sunset: atString(daily.sunset, i),
            uvIndexMax: atNumberOrNull(daily.uv_index_max, i),
        });
    }

    const result: WeeklyForecast = {
        days: out,
        timezone: typeof data?.timezone === 'string' ? data.timezone : 'UTC',
    };
    weeklyCache.set(key, { value: result, expiresAt: now + cfg.cacheTtlMs });
    logger.debug('weather.weekly_fetched', { key, days: out.length });
    return result;
};

/**
 * Bucket a TomorrowForecast into the qualitative dimensions the AI prompt
 * uses. Same shape powers the AI cache key, so similar weather across the
 * week reuses cached suggestions.
 */
export const summarize = (f: TomorrowForecast): WeatherSummary => {
    let tempMinBucket: TempBucket;
    if (f.tempMin < 0) tempMinBucket = 'cold';
    else if (f.tempMin < 8) tempMinBucket = 'cool';
    else if (f.tempMin < 16) tempMinBucket = 'mild';
    else if (f.tempMin < 24) tempMinBucket = 'warm';
    else tempMinBucket = 'hot';

    let precipBucket: PrecipBucket;
    if (f.precipitationProbability < 20 && f.precipitationMm < 0.5) precipBucket = 'none';
    else if (f.precipitationMm < 5) precipBucket = 'light';
    else precipBucket = 'heavy';

    let windyBucket: WindBucket;
    if (f.windSpeedMax < 15) windyBucket = 'calm';
    else if (f.windSpeedMax < 35) windyBucket = 'breezy';
    else windyBucket = 'windy';

    return {
        tempMin: f.tempMin,
        tempMax: f.tempMax,
        label: f.label,
        weatherCode: f.weatherCode,
        tempMinBucket,
        precipBucket,
        windyBucket,
    };
};
