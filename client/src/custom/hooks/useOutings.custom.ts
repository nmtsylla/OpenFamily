import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api';
import i18n from '../../i18n';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import type { GeoOverride } from './useWeather.custom';


export type OutingParty = 'family' | 'kids' | 'parents';
export type OutingDuration = 'short' | 'half_day' | 'full_day';
export type OutingLocation =
    | { kind: 'saved' }
    | { kind: 'current'; coordinates: GeoOverride }
    | { kind: 'area'; coordinates: GeoOverride; label: string };


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
    | 'viewpoint'
    | 'halal_restaurant';


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
    date: string;
    location: OutingLocation;
    force?: boolean;
}

const CACHE_LIMIT = 12;
const language = (): string => String(i18n.language || 'en').split('-')[0];
const remember = (cache: Map<string, OutingsDTO>, key: string, value: OutingsDTO): void => {
    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
};

const locationKey = (location: OutingLocation): string =>
    location.kind === 'saved'
        ? 'saved'
        : `${location.kind}:${location.coordinates.latitude.toFixed(4)},${location.coordinates.longitude.toFixed(4)}${location.kind === 'area' ? `:${location.label}` : ''}`;

export const outingsQueryKey = (params: {
    party: OutingParty;
    duration: OutingDuration;
    date: string;
    location: OutingLocation;
}): string =>
    `outings:${language()}:${params.party}:${params.duration}:${params.date}:${locationKey(params.location)}`;


/** Demo unknown endpoints return `[]`; proxies may answer with an HTML error page. */
const isOutings = (value: unknown): value is OutingsDTO =>
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as OutingsDTO).places) &&
    Array.isArray((value as OutingsDTO).ideas);

type OutingsResult = { key: string; data: OutingsDTO };

export interface UseOutings {
    result: OutingsResult | null;
    /** The instant phase is in flight (a second or two, or a cold Overpass query). */
    loading: boolean;
    error: string | null;
    suggest: (params: SuggestParams) => Promise<void>;
}

export function useOutings(): UseOutings {
    const [result, setResult] = useState<OutingsResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestId = useRef(0);
    const cacheRef = useRef<Map<string, OutingsDTO> | null>(null);
    const cache = cacheRef.current ?? (cacheRef.current = new Map<string, OutingsDTO>());
    useWebSocketUpdates('family', () => {
        requestId.current += 1;
        cache.clear();
        setResult(null);
        setLoading(false);
        setError(null);
    });

    const post = async (body: Record<string, unknown>): Promise<OutingsDTO> => {
        const response = await api.post<{ success: boolean; data: unknown }>('/api/outings/suggest', body);
        if (!isOutings(response.data)) throw new Error('unexpected');
        return response.data;
    };

    const suggest = useCallback(async ({ party, duration, date, location, force }: SuggestParams) => {
        const key = outingsQueryKey({ party, duration, date, location });
        if (!force) {
            const hit = cache.get(key);
            if (hit) {
                requestId.current += 1;
                setResult({ key, data: hit });
                setError(null);
                setLoading(false);
                return;
            }
        }
        const id = ++requestId.current;
        const body = {
            party,
            duration,
            date,
            lang: language(),
            location: location.kind,
            ...(location.kind === 'saved' ? {} : location.coordinates),
            ...(location.kind === 'area' ? { city: location.label } : {}),
        };
        setLoading(true);
        setError(null);
        let haveFast = false;
        try {
            const fast = await post({ ...body, instant: true });
            if (id !== requestId.current) return;
            setResult({ key, data: fast });
            haveFast = true;
            if (fast.ai !== 'pending') {
                remember(cache, key, fast);
                return;
            }
            setLoading(false);
            const ranked = await post(body);
            if (id !== requestId.current) return;
            remember(cache, key, ranked);
            setResult({ key, data: ranked });
        } catch (err) {
            if (id !== requestId.current) return;
            if (haveFast) {
                setResult((prev) => prev ? { ...prev, data: { ...prev.data, ai: 'failed' } } : prev);
                return;
            }
            setError(err instanceof Error && err.message === 'NO_LOCATION' ? 'NO_LOCATION' : 'error');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, []);

    return { result, loading, error, suggest };
}
