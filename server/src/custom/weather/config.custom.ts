// =============================================================================
// Weather configuration
//
// Open-Meteo is free and key-less, but we still externalise URLs and timeouts
// so the same image can target a private mirror in production or a local mock
// in tests.
// =============================================================================
import logger from '../../lib/logger';

export interface WeatherConfig {
    forecastBaseUrl: string;
    geocodingBaseUrl: string;
    cacheTtlMs: number;
    requestTimeoutMs: number;
    defaultLanguage: string;
}

const parseIntEnv = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

let cached: WeatherConfig | null = null;

export const getWeatherConfig = (): WeatherConfig => {
    if (cached) return cached;

    cached = {
        forecastBaseUrl:
            process.env.CUSTOM_OPEN_METEO_BASE_URL?.trim() || 'https://api.open-meteo.com/v1/forecast',
        geocodingBaseUrl:
            process.env.CUSTOM_OPEN_METEO_GEOCODING_URL?.trim() ||
            'https://geocoding-api.open-meteo.com/v1/search',
        cacheTtlMs: parseIntEnv(process.env.CUSTOM_WEATHER_CACHE_TTL_MS, 600_000),
        requestTimeoutMs: parseIntEnv(process.env.CUSTOM_WEATHER_REQUEST_TIMEOUT_MS, 8_000),
        defaultLanguage: process.env.CUSTOM_WEATHER_DEFAULT_LANG?.trim() || 'fr',
    };

    logger.info('weather.config_loaded', {
        forecastBaseUrl: cached.forecastBaseUrl,
        geocodingBaseUrl: cached.geocodingBaseUrl,
        cacheTtlMs: cached.cacheTtlMs,
        requestTimeoutMs: cached.requestTimeoutMs,
    });

    return cached;
};

export const resetWeatherConfigCache = (): void => {
    cached = null;
};
