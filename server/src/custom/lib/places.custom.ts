// =============================================================================
// Nearby places — the OpenStreetMap ground truth behind the outing planner.
//
// A model is good at judging ("in this rain, the museum beats the playground")
// and unreliable at knowing what exists around a family's home: asked for parks
// near a village it invents names and addresses. So the places come from
// OpenStreetMap (Overpass API, key-less) and the model only ranks them.
//
// Consequences worth keeping:
//   - the query is built from a fixed tag list, never from user input (the only
//     variables are coordinates and a radius, both validated numbers);
//   - Overpass is a shared, donation-funded service: results are cached for
//     half a day, one query per coordinate cell, and a request carries a
//     timeout of its own. Its usage policy asks for exactly that.
// =============================================================================

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

/**
 * OSM tag → the category the client translates. Order matters: the first match
 * wins, so `tourism=zoo` is a zoo before it is an attraction.
 */
const CLAUSES: { key: string; value: string; category: PlaceCategory }[] = [
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
];

/** Categories that do not care about the weather — used to re-rank without AI. */
const INDOOR: Record<string, true> = {
    museum: true,
    aquarium: true,
    library: true,
    swimming: true,
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
        // How far the planner looks. 10 km covers a rural household's nearest
        // town; a city dweller gets the same list with denser results.
        radiusKm: Math.min(30, Math.max(1, parseIntEnv(process.env.CUSTOM_OUTINGS_RADIUS_KM, 10))),
        cacheTtlMs: parseIntEnv(process.env.CUSTOM_OUTINGS_CACHE_TTL_MS, 12 * 60 * 60_000),
    };
    return cachedConfig;
};

export const resetPlacesConfigCache = (): void => {
    cachedConfig = null;
};

/**
 * Elements Overpass is asked to return. It applies this cap BEFORE we sort by
 * distance, so a radius whose raw result exceeds it can drop the closest place:
 * measured, this household's 10 km already returns 400 raw elements of which ~53
 * are named. Raising it is cheap (only centres and tags are printed; the search
 * itself is what costs the instance), so there is headroom — a dense inner city
 * is where the ceiling can still be felt, and `CUSTOM_OUTINGS_RADIUS_KM` is the
 * knob for that.
 *
 * NOT filtered by `["name"]`: it looks like the obvious saving, but Overpass
 * cannot use an index for it and answers the same query with a 200 and a
 * `remark: runtime error: Query timed out`. The unnamed elements are dropped
 * here, in parseOverpassResponse.
 */
const MAX_OVERPASS_ELEMENTS = 400;

/**
 * Test seam: the whole response parse is a pure function of the payload.
 *
 * One `nwr` clause per OSM key, values grouped into a regex. The naive version —
 * one clause per tag, on nodes and ways separately — is 22 sub-queries here and
 * Overpass answers it with a 504: the public instance times the request out. Three
 * regex clauses are the same search for a fraction of the work, and deriving them
 * from CLAUSES is what keeps the search and the category mapping in step.
 */
export const buildOverpassQuery = (lat: number, lon: number, radiusM: number): string => {
    const around = `(around:${Math.round(radiusM)},${lat},${lon})`;
    const byKey = new Map<string, string[]>();
    for (const clause of CLAUSES) {
        byKey.set(clause.key, [...(byKey.get(clause.key) ?? []), clause.value]);
    }
    const body = [...byKey.entries()]
        .map(([key, values]) =>
            values.length === 1
                ? `  nwr["${key}"="${values[0]}"]${around};`
                : `  nwr["${key}"~"^(${values.join('|')})$"]${around};`,
        )
        .join('\n');
    // `out center` gives a way's or a relation's centre point; the tags carry the
    // name and the handful of fields worth showing.
    return `[out:json][timeout:${Math.floor(getConfig().timeoutMs / 1000) - 2}];\n(\n${body}\n);\nout center ${MAX_OVERPASS_ELEMENTS};`;
};

/**
 * Overpass reports some failures as an HTTP 200 whose `elements` are empty and
 * whose `remark` explains why ("runtime error: Query timed out"). Taken at face
 * value that reads as "no place here" — and would be cached for half a day. So a
 * remark means failure, not emptiness.
 */
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
        if (tags[clause.key] === clause.value) return clause.category;
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

/**
 * Overpass payload → places, nearest first, one entry per (category, name).
 * Unnamed elements are dropped: "a playground 900 m away" with no name is not a
 * proposal a family can act on. Nothing here trusts the payload shape.
 */
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

    const seen = new Set<string>();
    const unique: NearbyPlace[] = [];
    for (const place of places) {
        // The same park often exists as a node and as a way; the nearest one wins.
        const key = `${place.category}|${place.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(place);
    }
    return unique;
};

/**
 * Without a model to judge, distance is the only honest ranking — except on a
 * wet day, when an indoor place 4 km away beats a playground next door.
 */
export const rankPlaces = (places: NearbyPlace[], rainLikely: boolean): NearbyPlace[] => {
    const sorted = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
    if (!rainLikely) return sorted;
    const indoor = sorted.filter((p) => isIndoorCategory(p.category));
    return indoor.length > 0 ? [...indoor, ...sorted.filter((p) => !isIndoorCategory(p.category))] : sorted;
};

// ---------------------------------------------------------------------------
// Cache. One entry per coordinate cell + radius, shared by every family: the
// shop signs and the playgrounds do not change between two requests.
// ---------------------------------------------------------------------------

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

/** How long to wait before the single retry: long enough for a busy instance to breathe. */
const RETRY_DELAY_MS = 1_500;

interface Attempt {
    ok: boolean;
    /** Worth retrying with a smaller area: the instance said "not now". */
    retryable: boolean;
    status: number;
    /** What Overpass said, when it said anything useful. */
    detail: string;
    payload: unknown;
}

/** One request. Never throws for a provider answer — the caller decides. */
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
        // Keep Overpass's own words: "runtime error", a rate-limit notice, an
        // HTML gateway error page — without them a 504 is indistinguishable from
        // a broken query in the log.
        let detail = '';
        try {
            detail = (await res.text())
                // A gateway 504 answers with an HTML page: keep its words, drop its tags.
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 200);
        } catch {
            // A body we cannot read is not worth failing over.
        }
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

    // A 200 carrying a `remark` is a timed-out query, not an empty neighbourhood.
    const remark = overpassFailure(payload);
    if (remark) {
        return { ok: false, retryable: true, status: res.status, detail: remark, payload: null };
    }

    return { ok: true, retryable: false, status: res.status, detail: '', payload };
};

/**
 * Real places around a point, nearest first. Throws on any provider problem —
 * the route degrades to model-only ideas rather than answering 500.
 */
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
        // 429/504 and a timed-out query are how a busy public instance says "not
        // now" (measured: one query in three on a loaded evening). The retry asks
        // for a SMALLER area rather than asking again: a query covering a quarter
        // of the ground is what the overloaded instance can actually answer.
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
        // Insertion-ordered Map: drop the oldest cell.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { value: places, expiresAt: Date.now() + cfg.cacheTtlMs });

    logger.info('outings.places_found', { count: places.length, radiusKm });
    return places;
};
