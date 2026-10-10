import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api';
import i18n from '../../i18n';
import type { GeoOverride } from './useWeather.custom';

// =============================================================================
// Outing proposals (POST /api/outings/suggest).
//
// Unlike the dashboard widgets this is a user-driven query: nothing is fetched
// until someone presses "Suggest outings", and the parameters (party, day,
// length, position) are the form itself. What IS shared is the house cache
// pattern: one entry per parameter set, so going back to a combination already
// asked for costs nothing. "Other suggestions" passes `force` and spends tokens.
// =============================================================================

export type OutingParty = 'family' | 'kids' | 'parents';
export type OutingDuration = 'short' | 'half_day' | 'full_day';

export type PlaceCategory =
    | 'playground'
    | 'park'
    | 'zoo'
    | 'aquarium'
    | 'museum'
    | 'theme_park'
    | 'attraction'
    | 'swimming'
    | 'library'
    | 'viewpoint';

export interface OutingPlaceDTO {
    id: string;
    name: string;
    category: PlaceCategory;
    latitude: number;
    longitude: number;
    distanceKm: number;
    openingHours: string | null;
    website: string | null;
    fee: string | null;
    /** One sentence from the model; empty when it did not rank (AI off or failed). */
    why: string;
    startTime: string;
    endTime: string;
}

export interface OutingIdeaDTO {
    title: string;
    description: string;
    indoor: boolean;
}

/** Why the ranking is missing: DISABLED is "no model configured", failed is an outage, pending is the instant phase (the model is still working). */
export type OutingAiStatus = 'ok' | 'disabled' | 'failed' | 'pending';

export interface OutingsDTO {
    date: string;
    party: OutingParty;
    duration: OutingDuration;
    city: string | null;
    weather: {
        label: string;
        tempMin: number;
        tempMax: number;
        weatherCode: number;
        precipitationProbability: number;
    } | null;
    ai: OutingAiStatus;
    placesSource: 'osm' | 'unavailable';
    places: OutingPlaceDTO[];
    ideas: OutingIdeaDTO[];
}

export interface SuggestParams {
    party: OutingParty;
    duration: OutingDuration;
    /** YYYY-MM-DD */
    date: string;
    override: GeoOverride | null;
    /** Bypass the cache — what the "other suggestions" button does. */
    force?: boolean;
}

const CACHE_LIMIT = 12;
const cache = new Map<string, OutingsDTO>();

const remember = (key: string, value: OutingsDTO): void => {
    if (cache.size >= CACHE_LIMIT) {
        // Insertion-ordered Map: drop the oldest parameter set.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
};

const language = (): string => String(i18n.language || 'en').split('-')[0];

const geoKey = (override: GeoOverride | null): string =>
    override ? `${override.latitude.toFixed(2)},${override.longitude.toFixed(2)}` : 'saved';

/**
 * Identity of one question: these four values (plus the language, since the copy
 * is written by the model) decide the answer. The panel builds it from its own
 * form to tell "the answer on screen" from "the answer to what I am asking now",
 * so the format lives here and nowhere else.
 */
export const outingsQueryKey = (params: {
    party: OutingParty;
    duration: OutingDuration;
    date: string;
    override: GeoOverride | null;
}): string =>
    `outings:${language()}:${params.party}:${params.duration}:${params.date}:${geoKey(params.override)}`;

/**
 * The demo build answers unknown endpoints with `[]`; a proxy can answer with an
 * HTML error page. Neither must reach the renderer as a half-built plan.
 */
const isOutings = (value: unknown): value is OutingsDTO =>
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as OutingsDTO).places) &&
    Array.isArray((value as OutingsDTO).ideas);

export interface UseOutings {
    data: OutingsDTO | null;
    /**
     * The parameter set (`party|duration|date|position`) `data` was fetched for.
     * The panel compares it with its current form: changing a control before the
     * next answer lands must show an empty state, never the previous answer under
     * the new controls.
     */
    dataKey: string | null;
    /** The instant phase is in flight (a second or two, or a cold Overpass query). */
    loading: boolean;
    error: string | null;
    suggest: (params: SuggestParams) => Promise<void>;
}

export function useOutings(): UseOutings {
    const [data, setData] = useState<OutingsDTO | null>(null);
    const [dataKey, setDataKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The last request wins: a slow answer for an abandoned form must not
    // overwrite the one the family is looking at.
    const requestId = useRef(0);

    const post = async (body: Record<string, unknown>): Promise<OutingsDTO> => {
        const response = await api.post<{ success: boolean; data: unknown }>('/api/outings/suggest', body);
        if (!isOutings(response.data)) throw new Error('unexpected');
        return response.data;
    };

    const suggest = useCallback(async ({ party, duration, date, override, force }: SuggestParams) => {
        const key = outingsQueryKey({ party, duration, date, override });
        if (!force) {
            const hit = cache.get(key);
            if (hit) {
                setData(hit);
                setDataKey(key);
                setError(null);
                return;
            }
        }

        const id = ++requestId.current;
        const body = {
            party,
            duration,
            date,
            lang: language(),
            ...(override ?? {}),
        };

        setLoading(true);
        setError(null);
        let haveFast = false;
        try {
            // Phase 1 — the places, which need no model. On screen in a second or
            // two (a cold Overpass query costs several), and the reason the panel
            // is never a blank spinner for the best part of a minute.
            const fast = await post({ ...body, instant: true });
            if (id !== requestId.current) return;
            setData(fast);
            setDataKey(key);
            haveFast = true;

            // Nothing to wait for when no model is configured: the nearest-first
            // list IS the answer.
            if (fast.ai !== 'pending') {
                remember(key, fast);
                return;
            }

            // The places are on screen: the model's answer replaces them when it
            // lands, and the panel shows the `pending` note until then.
            setLoading(false);
            const ranked = await post(body);
            if (id !== requestId.current) return;
            remember(key, ranked);
            setData(ranked);
            setDataKey(key);
        } catch (err) {
            if (id !== requestId.current) return;
            // NO_LOCATION is its own screen (save a city or share the position),
            // anything else is the generic failure line. A failure after the
            // instant answer keeps it: those places are still real.
            if (haveFast) {
                // The ranking is what failed, not the places: say so instead of
                // leaving the panel stuck on its "ranking…" note.
                setData((prev) => (prev ? { ...prev, ai: 'failed' } : prev));
                return;
            }
            setError(err instanceof Error && err.message === 'NO_LOCATION' ? 'NO_LOCATION' : 'error');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, []);

    return { data, dataKey, loading, error, suggest };
}
