
import { setTimeout as delay } from 'node:timers/promises';
import logger from '../../lib/logger';
import { OPENFAMILY_VERSION } from '../../version';

export const PLACE_CATEGORIES = [
    'playground',
    'park',
    'zoo',
    'aquarium',
    'museum',
    'theme_park',
    'attraction',
    'swimming',
    'library',
    'viewpoint',
    'halal_restaurant',
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export interface NearbyPlace {
    /** Stable id, e.g. `osm:node/12345` — used as the model's reference too. */
    id: string;
    name: string;
    category: PlaceCategory;
    latitude: number;
    longitude: number;
    distanceKm: number;
    openingHours: string | null;
    website: string | null;
    fee: string | null;
}

const CLAUSES: { key: string; value: string; category: PlaceCategory; requiredTags?: Record<string, string> }[] = [
    { key: 'leisure', value: 'playground', category: 'playground' },
    { key: 'leisure', value: 'park', category: 'park' },
    { key: 'tourism', value: 'zoo', category: 'zoo' },
    { key: 'tourism', value: 'aquarium', category: 'aquarium' },
    { key: 'tourism', value: 'museum', category: 'museum' },
    { key: 'tourism', value: 'theme_park', category: 'theme_park' },
    { key: 'tourism', value: 'attraction', category: 'attraction' },
    { key: 'leisure', value: 'water_park', category: 'swimming' },
    { key: 'leisure', value: 'swimming_pool', category: 'swimming' },
    { key: 'amenity', value: 'library', category: 'library' },
    { key: 'tourism', value: 'viewpoint', category: 'viewpoint' },
    { key: 'amenity', value: 'restaurant', category: 'halal_restaurant', requiredTags: { 'diet:halal': 'only' } },
];


const INDOOR: Record<string, true> = {
    museum: true,
    aquarium: true,
    library: true,
    swimming: true,
    halal_restaurant: true,

};

export const isIndoorCategory = (category: string): boolean => INDOOR[category] === true;

const OVERPASS_FALLBACK = 'https://overpass-api.de/api/interpreter';

const parseIntEnv = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

interface PlacesConfig {
    baseUrl: string;
    timeoutMs: number;
    radiusKm: number;
    cacheTtlMs: number;
}

let cachedConfig: PlacesConfig | null = null;

const getConfig = (): PlacesConfig => {
    if (cachedConfig) return cachedConfig;
    cachedConfig = {
        baseUrl: process.env.CUSTOM_OVERPASS_URL?.trim() || OVERPASS_FALLBACK,
        timeoutMs: parseIntEnv(process.env.CUSTOM_OVERPASS_TIMEOUT_MS, 20_000),
        radiusKm: Math.min(30, Math.max(1, parseIntEnv(process.env.CUSTOM_OUTINGS_RADIUS_KM, 10))),
        cacheTtlMs: parseIntEnv(process.env.CUSTOM_OUTINGS_CACHE_TTL_MS, 12 * 60 * 60_000),
    };
    return cachedConfig;
};

export const resetPlacesConfigCache = (): void => {
    cachedConfig = null;
};

const MAX_RAW_OVERPASS_ELEMENTS = 400;

export const buildOverpassQuery = (lat: number, lon: number, radiusM: number): string => {
    const around = `(around:${Math.round(radiusM)},${lat},${lon})`;
    const byKey = new Map<string, string[]>();
    for (const clause of CLAUSES) {
        if (clause.requiredTags) continue;
        byKey.set(clause.key, [...(byKey.get(clause.key) ?? []), clause.value]);
    }
    const grouped = [...byKey.entries()].map(([key, values]) =>
        values.length === 1
            ? `  nwr["${key}"="${values[0]}"]${around};`
            : `  nwr["${key}"~"^(${values.join('|')})$"]${around};`,
    );
    const constrained = CLAUSES.filter((clause) => clause.requiredTags).map((clause) =>
        `  nwr["${clause.key}"="${clause.value}"]${Object.entries(clause.requiredTags ?? {}).map(([key, value]) => `["${key}"="${value}"]`).join('')}${around};`,
    );
    const body = [...grouped, ...constrained].join('\n');
    return `[out:json][timeout:${Math.floor(getConfig().timeoutMs / 1000) - 2}];\n(\n${body}\n);\nout center ${MAX_RAW_OVERPASS_ELEMENTS};`;
};



export const overpassFailure = (payload: unknown): string | null => {
    if (!payload || typeof payload !== 'object') return null;
    const remark = (payload as { remark?: unknown }).remark;
    return typeof remark === 'string' && remark.trim().length > 0
        ? remark.trim().replace(/\s+/g, ' ').slice(0, 200)
        : null;
};

const EARTH_RADIUS_KM = 6371;

export const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const clean = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, max);
};

/** Only http(s) URLs reach the client: `website` is free text in OSM. */
const cleanUrl = (value: unknown): string | null => {
    const raw = clean(value, 300);
    if (!raw) return null;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const url = new URL(withScheme);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.toString();
    } catch {
        return null;
    }
};

const categoryOf = (tags: Record<string, unknown>): PlaceCategory | null => {
    for (const clause of CLAUSES) {
        if (tags[clause.key] !== clause.value) continue;
        if (clause.requiredTags && Object.entries(clause.requiredTags).some(([key, value]) => tags[key] !== value)) continue;
        return clause.category;
    }
    return null;
};


interface OverpassElement {
    type?: unknown;
    id?: unknown;
    lat?: unknown;
    lon?: unknown;
    center?: { lat?: unknown; lon?: unknown };
    tags?: unknown;
}

export const parseOverpassResponse = (raw: unknown, lat: number, lon: number): NearbyPlace[] => {
    if (!raw || typeof raw !== 'object' || !('elements' in raw)) return [];
    const elements = (raw as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) return [];

    const places: NearbyPlace[] = [];
    for (const element of elements as OverpassElement[]) {
        if (!element || typeof element !== 'object' || !element.tags || typeof element.tags !== 'object') {
            continue;
        }
        const tags = element.tags as Record<string, unknown>;
        const name = clean(tags.name, 120);
        const category = categoryOf(tags);
        if (!name || !category) continue;

        const center = element.center ?? {};
        const pLat = typeof element.lat === 'number' ? element.lat : center.lat;
        const pLon = typeof element.lon === 'number' ? element.lon : center.lon;
        if (typeof pLat !== 'number' || typeof pLon !== 'number') continue;
        if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;

        places.push({
            id: `osm:${String(element.type ?? 'node')}/${String(element.id ?? '')}`,
            name,
            category,
            latitude: pLat,
            longitude: pLon,
            distanceKm: haversineKm(lat, lon, pLat, pLon),
            openingHours: clean(tags.opening_hours, 180),
            website: cleanUrl(tags.website ?? tags['contact:website']),
            fee: clean(tags.fee, 40),
        });
    }

    places.sort((a, b) => a.distanceKm - b.distanceKm);

    const seenCategoryNames = new Set<string>();
    const nearestUnique: NearbyPlace[] = [];
    for (const place of places) {
        const key = `${place.category}|${place.name.toLowerCase()}`;
        if (seenCategoryNames.has(key)) continue;
        seenCategoryNames.add(key);
        nearestUnique.push(place);
    }
    return nearestUnique;
};

export const rankPlaces = (places: NearbyPlace[], rainLikely: boolean): NearbyPlace[] => {
    const sorted = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
    if (!rainLikely) return sorted;
    const indoor = sorted.filter((p) => isIndoorCategory(p.category));
    return indoor.length > 0 ? [...indoor, ...sorted.filter((p) => !isIndoorCategory(p.category))] : sorted;
};

export const preserveNearestHalalRestaurant = <T extends { category: string }>(places: T[], cap: number): T[] => {
    const retained = places.slice(0, cap);
    const nearest = places.find((place) => place.category === 'halal_restaurant');
    if (nearest && retained.length === cap && !retained.some((place) => place.category === 'halal_restaurant')) {
        retained[cap - 1] = nearest;
    }
    return retained;
};


interface CacheEntry {
    value: NearbyPlace[];
    expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = 64;

const cacheKey = (lat: number, lon: number, radiusKm: number): string =>
    `${lat.toFixed(2)},${lon.toFixed(2)}:${radiusKm}`;

export const clearPlacesCache = (): void => {
    cache.clear();
};

const RETRY_DELAY_MS = 1_500;

interface Attempt {
    ok: boolean;
    retryable: boolean;
    status: number;
    detail: string;
    payload: unknown;
}

const attemptOverpass = async (
    baseUrl: string,
    timeoutMs: number,
    query: string,
): Promise<Attempt> => {
    let res: Response;
    try {
        res = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                // The public instance answers 406 without a User-Agent, and its
                // usage policy expects an identifying one.
                'User-Agent': `OpenFamily/${OPENFAMILY_VERSION} (self-hosted family app)`,
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (err) {
        return {
            ok: false,
            retryable: true,
            status: 0,
            detail: err instanceof Error ? err.message : String(err),
            payload: null,
        };
    }

    if (!res.ok) {
        const detail = (await res.text().catch(() => ''))
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200);
        return {
            ok: false,
            retryable: res.status === 429 || res.status >= 500,
            status: res.status,
            detail,
            payload: null,
        };
    }

    let payload: unknown = null;
    try {
        payload = await res.json();
    } catch {
        return { ok: false, retryable: true, status: res.status, detail: 'unparsable JSON', payload: null };
    }

    const remark = overpassFailure(payload);
    if (remark) {
        return { ok: false, retryable: true, status: res.status, detail: remark, payload: null };
    }

    return { ok: true, retryable: false, status: res.status, detail: '', payload };
};

export const findNearbyPlaces = async (
    latitude: number,
    longitude: number,
    opts: { radiusKm?: number } = {},
): Promise<NearbyPlace[]> => {
    const cfg = getConfig();
    const radiusKm = Math.min(cfg.radiusKm, Math.max(0.5, opts.radiusKm ?? cfg.radiusKm));
    const key = cacheKey(latitude, longitude, radiusKm);

    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const radiusM = radiusKm * 1000;
    let result = await attemptOverpass(cfg.baseUrl, cfg.timeoutMs, buildOverpassQuery(latitude, longitude, radiusM));

    if (!result.ok && result.retryable) {
        await delay(RETRY_DELAY_MS);
        result = await attemptOverpass(
            cfg.baseUrl,
            cfg.timeoutMs,
            buildOverpassQuery(latitude, longitude, Math.max(1_000, radiusM / 2)),
        );
    }

    if (!result.ok) {
        throw new Error(
            `Overpass failed (${result.status || 'no response'}${result.detail ? `: ${result.detail}` : ''})`,
        );
    }

    const places = parseOverpassResponse(result.payload, latitude, longitude).filter(
        (p) => p.distanceKm <= radiusKm,
    );

    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { value: places, expiresAt: Date.now() + cfg.cacheTtlMs });

    logger.info('outings.places_found', { count: places.length, radiusKm });
    return places;
};
