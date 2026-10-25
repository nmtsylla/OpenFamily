import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import i18n from '../../i18n';

// =============================================================================
// Dashboard weather data: the forecast + per-kid outfit, the weekly forecast the
// details dialog shows, and the screen-free activity ideas.
//
// House data-fetching pattern (no query library): module-level cache shared by
// every mounted component, one in-flight request per key, and a `refetch` that
// drops the cache entry. The two dashboard cards therefore hit the same
// coordinates once, and a language switch or a re-render costs nothing.
// =============================================================================

export interface GeoOverride {
    latitude: number;
    longitude: number;
}

export interface ForecastDTO {
    date: string;
    tempMin: number;
    tempMax: number;
    precipitationMm: number;
    precipitationProbability: number;
    windSpeedMax: number;
    weatherCode: number;
    label: string;
    timezone: string;
}

export interface ClothingKidDTO {
    id: string;
    name: string;
    color: string;
    birth_date: string | null;
    ageYears: number;
}

export interface ClothingSuggestionDTO {
    kidId: string;
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
    advice: string;
}

/**
 * Why a widget shows partial content: DISABLED is "no AI model configured",
 * BAD_JSON is "the model answered something unusable", and any provider code
 * (AI_UNREACHABLE…) means the fallback is in play. Unknown codes are expected
 * and get generic wording.
 */
export type DegradedCode = 'DISABLED' | 'BAD_JSON' | (string & {});

export type DayMode = 'school' | 'home';
export type DayReason = 'school_day' | 'weekend' | 'default_summer';

export interface DayContextDTO {
    /** YYYY-MM-DD */
    date: string;
    mode: DayMode;
    reason: DayReason;
    dayOffset: 0 | 1;
    flipsAt: string;
}

export interface DashboardWeatherDTO {
    weather: ForecastDTO;
    city: string | null;
    kids: ClothingKidDTO[];
    dayContext: DayContextDTO;
    suggestions: ClothingSuggestionDTO[];
    cached: boolean;
    model: string;
    aiUnavailable?: boolean;
    code?: DegradedCode;
}

export interface DailyForecastDTO {
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

export interface WeeklyForecastDTO {
    days: DailyForecastDTO[];
    timezone: string;
    city: string | null;
}

export type ActivityCategory =
    | 'outdoor'
    | 'creative'
    | 'cooking'
    | 'learning'
    | 'sport'
    | 'chores'
    | 'social';

export type ActivityTimeOfDay = 'morning' | 'afternoon' | 'evening';

/**
 * An idea from the model (text already in the reader's language) or from the
 * server's offline bank, which sends a stable `id` and material slugs instead of
 * copy — those are resolved through i18n here, so the offline card is translated
 * like the rest of the interface. `id` present ⇒ translate, otherwise use the text.
 */
export interface KidActivityDTO {
    kidIds: string[];
    category: ActivityCategory;
    timeOfDay: ActivityTimeOfDay;
    durationMinutes: number;
    materials: string[];
    id?: string;
    title?: string;
    instructions?: string;
}

/**
 * The language the widget copy must be written in: the interface language, since
 * the model writes the titles and instructions. Unknown → English, which is also
 * the server's default.
 */
const widgetLanguage = (): string => String(i18n.language || 'en').split('-')[0];

export interface KidsActivitiesDTO {
    weather: ForecastDTO;
    city: string | null;
    kids: ClothingKidDTO[];
    dayContext: DayContextDTO;
    activities: KidActivityDTO[];
    cached: boolean;
    model: string;
    /** True when the ideas come from the static bank rather than the model. */
    aiUnavailable?: boolean;
    code?: DegradedCode;
}

export interface AsyncResult<T> {
    data: T | null;
    error: Error | null;
    loading: boolean;
    refetch: () => void;
}

const CACHE_LIMIT = 24;
const cache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

const remember = (key: string, value: unknown): void => {
    if (cache.size >= CACHE_LIMIT) {
        // Oldest insertion first — this is a session cache, not a store.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
};

function useCachedQuery<T>(cacheKey: string, fetcher: () => Promise<T>, enabled: boolean): AsyncResult<T> {
    const [version, setVersion] = useState(0);
    const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>(
        () => ({ data: (cache.get(cacheKey) as T | undefined) ?? null, error: null, loading: enabled }),
    );
    // The fetcher closes over the request body; keeping it in a ref means the
    // effect only re-runs when the key (or an explicit refetch) changes.
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    useEffect(() => {
        if (!enabled) {
            setState({ data: null, error: null, loading: false });
            return;
        }

        const cached = cache.get(cacheKey) as T | undefined;
        if (cached !== undefined) {
            setState({ data: cached, error: null, loading: false });
            return;
        }

        let active = true;
        setState((prev) => ({ data: prev.data, error: null, loading: true }));

        // Same module-level map for every query hook: the value type is erased
        // per key, so the cast is the price of sharing one in-flight registry.
        const shared = inFlight.get(cacheKey) as Promise<T> | undefined;
        const pending = shared ?? fetcherRef.current();
        inFlight.set(cacheKey, pending);

        pending
            .then((data) => {
                remember(cacheKey, data);
                if (active) setState({ data, error: null, loading: false });
            })
            .catch((error: unknown) => {
                if (active) {
                    setState((prev) => ({
                        // A failed refetch does not invalidate what is on screen: the
                        // widgets keep the last payload, and so does a dialog opened
                        // from it. A phone loses a refetch often enough that blanking
                        // on one reads as the dialog closing itself.
                        data: prev.data,
                        error: error instanceof Error ? error : new Error(String(error)),
                        loading: false,
                    }));
                }
            })
            .finally(() => {
                if (inFlight.get(cacheKey) === pending) inFlight.delete(cacheKey);
            });

        return () => {
            active = false;
        };
    }, [cacheKey, enabled, version]);

    const refetch = useCallback(() => {
        cache.delete(cacheKey);
        setVersion((v) => v + 1);
    }, [cacheKey]);

    return { ...state, refetch };
}

/** Coordinates as the cache/body key: rounded, so a drifting fix reuses an entry. */
const geoKey = (override: GeoOverride | null): string =>
    override ? `${override.latitude.toFixed(2)},${override.longitude.toFixed(2)}` : 'saved';

function useTargetExpiry(flipsAt: string | undefined, refetch: () => void): void {
    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;

    useEffect(() => {
        if (!flipsAt) return;
        const check = () => {
            if (Date.now() >= new Date(flipsAt).getTime()) refetchRef.current();
        };
        const id = window.setInterval(check, 60_000);
        document.addEventListener('visibilitychange', check);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', check);
        };
    }, [flipsAt]);
}

/**
 * One widget, two phases. The fast phase carries what needs no model at all
 * (weather, kids, the offline activity bank) and lands in a couple of hundred
 * milliseconds; the slow one carries the model's answer and can take anywhere
 * from a few seconds to a minute at the gateway. Painting the fast phase first
 * is what keeps the card useful while the model thinks.
 *
 * A regenerate re-runs both phases for the new key, and while they run the
 * payload already on screen stays there, so the card never blanks under the
 * reader. `status` says what the model phase is doing, which is the only thing
 * the card cannot tell from the payload.
 */
export type WidgetPhaseStatus = 'thinking' | 'failed' | 'ready';

export interface WidgetResult<T> extends AsyncResult<T> {
    status: WidgetPhaseStatus;
}

const postWidget = async <T>(
    path: string,
    body: Record<string, unknown>,
    guard: (value: unknown) => value is T,
): Promise<T | null> => {
    const response = await api.post<{ success: boolean; data: unknown }>(path, body);
    return guard(response.data) ? response.data : null;
};

function useWidgetPhases<T>(
    key: string,
    fast: () => Promise<T | null>,
    slow: () => Promise<T | null>,
    enabled: boolean,
): WidgetResult<T | null> {
    const context = useCachedQuery(`${key}:context`, fast, enabled);
    const model = useCachedQuery(`${key}:model`, slow, enabled);

    // A phase counts for the current key only once it has stopped loading.
    // While it is in flight, its data still belongs to the previous key.
    const fresh = (model.loading ? null : model.data) ?? (context.loading ? null : context.data);
    const data = fresh ?? model.data ?? context.data;

    const refetch = useCallback(() => {
        context.refetch();
        model.refetch();
    }, [context.refetch, model.refetch]);

    return {
        data,
        // With something on screen there is no failure to report: stale ideas
        // beat an error card.
        error: data ? null : (model.error ?? context.error),
        loading: !data && (context.loading || model.loading),
        status: !enabled || (!model.loading && !model.error)
            ? 'ready'
            : model.loading
              ? 'thinking'
              : 'failed',
        refetch,
    };
}

/**
 * The target day's forecast plus one outfit per child.
 *
 * `enabled` false when the member has neither a saved city nor a session
 * geolocation fix — the card renders its empty state instead of asking.
 */
export function useDashboardWeather(override: GeoOverride | null, enabled: boolean): WidgetResult<DashboardWeatherDTO | null> {
    // The copy is generated server-side, so the language belongs in the key:
    // switching the interface must not serve the previous language.
    const key = `weather-clothing:${widgetLanguage()}:${geoKey(override)}`;
    const body = { ...(override ?? {}), lang: widgetLanguage() };
    const result = useWidgetPhases(
        key,
        () =>
            postWidget(
                '/api/ai/dashboard/clothing-suggestions',
                { ...body, instant: true },
                isDashboardWeather,
            ),
        () => postWidget('/api/ai/dashboard/clothing-suggestions', body, isDashboardWeather),
        enabled,
    );
    useWebSocketUpdates('family', result.refetch);
    useTargetExpiry(result.data?.dayContext.flipsAt, result.refetch);
    return result;
}

/** The multi-day forecast behind the "weather details" dialog. */
export function useWeeklyForecast(
    override: GeoOverride | null,
    enabled: boolean,
    days = 7,
): AsyncResult<WeeklyForecastDTO | null> {
    const result = useCachedQuery(
        `weather-weekly:${geoKey(override)}:${days}`,
        async () => {
            const response = await api.post<{ success: boolean; data: WeeklyForecastDTO }>(
                '/api/weather/forecast',
                { ...(override ?? {}), days },
            );
            return isWeeklyForecast(response.data) ? response.data : null;
        },
        enabled,
    );
    useWebSocketUpdates('family', result.refetch);
    return result;
}

/**
 * Screen-free ideas for the target day. `exclude` carries the titles already
 * shown, so "other ideas" asks the model for something new rather than rotating
 * the same four all summer.
 *
 * The fast phase answers with the server's offline bank, which needs no model
 * call, so the card has real ideas to show while the model writes its own.
 */
export function useKidsActivities(
    override: GeoOverride | null,
    exclude: string[],
    enabled: boolean,
): WidgetResult<KidsActivitiesDTO | null> {
    const key = `activities:${widgetLanguage()}:${geoKey(override)}:${[...exclude].sort().join('~')}`;
    const body = {
        ...(override ?? {}),
        lang: widgetLanguage(),
        ...(exclude.length > 0 ? { exclude } : {}),
    };
    const result = useWidgetPhases(
        key,
        () => postWidget('/api/ai/dashboard/kids-activities', { ...body, instant: true }, isKidsActivities),
        () => postWidget('/api/ai/dashboard/kids-activities', body, isKidsActivities),
        enabled,
    );
    useWebSocketUpdates('family', result.refetch);
    useTargetExpiry(result.data?.dayContext.flipsAt, result.refetch);
    return result;
}

/**
 * The coordinates stored on the account by PUT /api/weather/location. `null`
 * fields mean no city has been saved yet.
 */
export interface SavedLocationDTO {
    city: string | null;
    country_code: string | null;
    latitude: number | null;
    longitude: number | null;
}

/**
 * The API's shape is a promise, not a guarantee: the static demo answers every
 * endpoint it does not know with `[]`, and a proxy can answer with an error page.
 * A payload that is not the object the card expects becomes "no data", so the
 * widget shows its error card instead of dereferencing `undefined` and taking the
 * whole dashboard down with it.
 */
const isDashboardWeather = (value: unknown): value is DashboardWeatherDTO =>
    !!value && typeof value === 'object' && Array.isArray((value as DashboardWeatherDTO).kids);

const isWeeklyForecast = (value: unknown): value is WeeklyForecastDTO =>
    !!value && typeof value === 'object' && Array.isArray((value as WeeklyForecastDTO).days);

const isKidsActivities = (value: unknown): value is KidsActivitiesDTO =>
    !!value && typeof value === 'object' && Array.isArray((value as KidsActivitiesDTO).activities);

const isSavedLocation = (value: unknown): value is SavedLocationDTO =>
    !!value && typeof value === 'object' && 'city' in value;

/**
 * The member's saved weather location (GET /api/weather/location).
 *
 * The coordinates live on the user row but not in the auth payload, so the
 * widgets read them here: this is what tells a card whether a saved city exists
 * at all (no city → stay silent instead of asking twice) and what the Settings
 * card pre-fills.
 */
export function useSavedLocation(): AsyncResult<SavedLocationDTO | null> {
    const { data, error, loading, refetch } = useCachedQuery(
        'weather-location',
        async () => {
            const response = await api.get<{ success: boolean; data: SavedLocationDTO }>(
                '/api/weather/location',
            );
            return isSavedLocation(response.data) ? response.data : null;
        },
        true,
    );
    useWebSocketUpdates('family', refetch);
    // `loading` reports a first load, not a refetch: `useCachedQuery` is in flight
    // again on every saved-city change while it still holds the city, and a widget
    // that blanked on that took an open dialog down with it.
    return { data, error, loading: loading && data === null, refetch };
}
