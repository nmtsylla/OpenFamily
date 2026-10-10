import type { ComponentType } from 'react';
import {
    Cloud,
    CloudDrizzle,
    CloudFog,
    CloudLightning,
    CloudRain,
    CloudSnow,
    CloudSun,
    Sun,
} from 'lucide-react';

// =============================================================================
// WMO weather codes (as returned by Open-Meteo) → the handful of conditions the
// UI actually names and draws.
//
// The server's own `label` is French and feeds the AI prompts; the dashboard is
// translated, so it derives its wording and its icon from the code. Eight groups
// is the resolution the UI can use — the numeric precision the API offers beyond
// that (light vs heavy rain) is already carried by the precipitation %/mm fields.
// =============================================================================

export type WeatherCondition =
    | 'clear'
    | 'mostlyClear'
    | 'overcast'
    | 'fog'
    | 'drizzle'
    | 'rain'
    | 'snow'
    | 'storm';

export const weatherCondition = (code: number): WeatherCondition => {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'mostlyClear';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'overcast';
};

interface IconProps {
    className?: string;
}

export const CONDITION_ICON: Record<WeatherCondition, ComponentType<IconProps>> = {
    clear: Sun,
    mostlyClear: CloudSun,
    overcast: Cloud,
    fog: CloudFog,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    snow: CloudSnow,
    storm: CloudLightning,
};

/** i18n key for a condition inside the `weather` namespace, e.g. `conditions.rain`. */
export const conditionKey = (code: number): string => `conditions.${weatherCondition(code)}`;
