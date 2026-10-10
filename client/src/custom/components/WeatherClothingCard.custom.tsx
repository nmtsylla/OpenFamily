import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, Droplets, LocateFixed, MapPin, RefreshCw, Sparkles, Wind } from 'lucide-react';
import { Card, CardContent, Button, useToast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { CONDITION_ICON, conditionKey, weatherCondition } from '../lib/weatherCode.custom';
import { dayContextHeading, isTodayContext } from '../lib/dayContextLabel.custom';
import {
    useDashboardWeather,
    useSavedLocation,
    type ClothingKidDTO,
    type ClothingSuggestionDTO,
    type ForecastDTO,
    type GeoOverride,
} from '../hooks/useWeather.custom';
import WeatherDetailsDialog from './WeatherDetailsDialog.custom';

// =============================================================================
// WeatherClothingCard
//
// The target day's forecast plus an AI-generated outfit per child. Many states
// are handled inline because the source data has several partial-success paths:
// no city, no kids, AI off, model answered garbage.
//
// The geolocation fix is session-only: it lives in the dashboard's state and is
// passed in here, never persisted server-side — the saved city changes in
// Settings.
// =============================================================================

interface Props {
    override: GeoOverride | null;
    onOverrideChange: (override: GeoOverride | null) => void;
}

const DEGRADED_LABEL_KEY: Record<string, string> = {
    DISABLED: 'degraded.disabled',
    BAD_JSON: 'degraded.badJson',
};

/**
 * Server error codes arrive as the Error message — the house convention shared
 * with the AI routes (see MagicInput's `aiErrorKey`): `error: <code>` in the
 * body, surfaced verbatim by the API client.
 */
const errorTextFor = (error: Error, t: TFunction): string => {
    if (error.message === 'NO_LOCATION') return t('errorNoLocation');
    if (error.message === 'CITY_NOT_FOUND') return t('errorCityNotFound');
    if (error.message === 'TIMEOUT') return t('errorTimeout');
    return t('errorGeneric');
};

const WeatherClothingCard: React.FC<Props> = ({ override, onOverrideChange }) => {
    const { t } = useTranslation('weather.custom');
    const { user, isModuleEnabled } = useAuth();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [locating, setLocating] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const location = useSavedLocation();

    // Don't fire the request when we know up-front there is no city saved and no
    // override — the empty-state CTA is enough. The saved city is read from the
    // weather surface, not from the auth payload (see useSavedLocation).
    const enabled = !!user && (override !== null || location.data?.latitude != null);
    const query = useDashboardWeather(override, enabled);

    // The dashboard renders this widget unconditionally; the module flag
    // (CUSTOM_FEATURE_WEATHER_ENABLED) hides it by making the card a no-op.
    if (!isModuleEnabled('weather')) return null;

    const requestGeolocation = () => {
        if (!('geolocation' in navigator)) {
            showToast({ title: t('geoUnavailable') });
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                onOverrideChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
                setLocating(false);
            },
            (err) => {
                setLocating(false);
                showToast({
                    title: t('geoDeniedTitle'),
                    description:
                        err.code === err.PERMISSION_DENIED
                            ? t('geoDeniedPermission')
                            : t('geoDeniedOther'),
                });
            },
            { timeout: 10_000, maximumAge: 5 * 60_000 },
        );
    };

    // ------------------------------------------------------------------------
    // Empty state: no saved city (and no fix yet). While the saved location is
    // still loading we fall through to the skeleton below, so the card does not
    // flash "no city" for a member who has one.
    // ------------------------------------------------------------------------
    if (!enabled && !location.loading) {
        return (
            <Card>
                <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-primary-soft">
                        <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-caption font-semibold text-foreground">
                            {t('emptyTitle')}
                        </h3>
                        <p className="mt-1 text-micro text-muted-foreground">
                            {t('emptyDescription')}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={requestGeolocation} disabled={locating}>
                            <LocateFixed className="h-4 w-4 mr-1.5" />
                            {locating ? t('locating') : t('myPosition')}
                        </Button>
                        <Button onClick={() => navigate('/settings')}>{t('configureCity')}</Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // ------------------------------------------------------------------------
    // Loading skeleton.
    // ------------------------------------------------------------------------
    if (location.loading || query.loading) {
        return (
            <Card>
                <CardContent className="p-6">
                    <div className="animate-pulse space-y-4">
                        <div className="h-6 w-48 rounded bg-surface-2" />
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="h-32 rounded-card bg-surface-2" />
                            <div className="h-32 rounded-card bg-surface-2 lg:col-span-2" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // ------------------------------------------------------------------------
    // Error state.
    // ------------------------------------------------------------------------
    if (query.error || !query.data) {
        const error = query.error ?? new Error('unknown');
        if (error.message === 'NO_LOCATION') {
            return (
                <Card>
                    <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-primary-soft">
                            <MapPin className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-caption font-semibold text-foreground">
                                {t('emptyTitle')}
                            </h3>
                            <p className="mt-1 text-micro text-muted-foreground">
                                {t('emptyDescription')}
                            </p>
                        </div>
                        <Button onClick={() => navigate('/settings')}>{t('configureCity')}</Button>
                    </CardContent>
                </Card>
            );
        }

        return (
            <Card>
                <CardContent className="p-6">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 text-destructive shrink-0" />
                        <div className="flex-1">
                            <p className="text-caption font-semibold">{t('unavailableTitle')}</p>
                            <p className="text-micro text-muted-foreground">{errorTextFor(error, t)}</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={query.refetch}>
                            <RefreshCw className="h-4 w-4 mr-1.5" />
                            {t('retry')}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // ------------------------------------------------------------------------
    // Success (kids may be empty, the AI may be off).
    // ------------------------------------------------------------------------
    const data = query.data;
    return (
        <Card>
            <CardContent className="p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                        <h2 className="text-h2 font-semibold flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                            {dayContextHeading(data.dayContext, t)}
                        </h2>
                        <p className="text-micro text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {override ? t('currentPosition') : (data.city ?? t('savedCity'))}
                            {data.aiUnavailable && data.code && (
                                <span className="ml-2 italic">
                                    · {t(DEGRADED_LABEL_KEY[data.code] ?? 'degraded.generic')}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {override && (
                            <Button variant="ghost" size="sm" onClick={() => onOverrideChange(null)}>
                                {t('reset')}
                            </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={requestGeolocation} disabled={locating}>
                            <LocateFixed className="h-4 w-4 mr-1.5" />
                            {locating ? t('locating') : t('myPosition')}
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <WeatherTile
                        forecast={data.weather}
                        isToday={isTodayContext(data.dayContext)}
                        onClick={() => setDetailsOpen(true)}
                    />

                    <div className="lg:col-span-2">
                        {data.kids.length === 0 ? (
                            <div className="flex h-full items-center justify-center rounded-card border border-dashed border-border bg-muted/20 p-4 text-center">
                                <div>
                                    <p className="text-caption font-medium text-foreground">
                                        {t('addKidTitle')}
                                    </p>
                                    <p className="mt-1 text-micro text-muted-foreground">
                                        {t('addKidDescription')}
                                    </p>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="mt-3"
                                        onClick={() => navigate('/family')}
                                    >
                                        {t('goToFamily')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <KidsSuggestions
                                kids={data.kids}
                                suggestions={data.suggestions}
                                aiUnavailable={!!data.aiUnavailable}
                            />
                        )}
                    </div>
                </div>
            </CardContent>

            <WeatherDetailsDialog
                open={detailsOpen}
                onOpenChange={setDetailsOpen}
                forecast={data.weather}
                cityLabel={override ? t('positionLabel') : data.city}
                override={override}
            />
        </Card>
    );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const WeatherTile: React.FC<{
    forecast: ForecastDTO;
    isToday: boolean;
    onClick?: () => void;
}> = ({ forecast, isToday, onClick }) => {
    const { t } = useTranslation('weather.custom');
    const Icon = CONDITION_ICON[weatherCondition(forecast.weatherCode)];
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            className="text-left rounded-card border border-border bg-surface-2 p-4 transition-all hover:shadow-surface hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
            aria-label={t('viewWeekDetail')}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-label text-muted-foreground flex items-center gap-1">
                        {isToday ? t('details.today') : t('details.tomorrow')}
                        {onClick && (
                            <span className="text-[10px] italic text-primary/70">
                                · {t('clickForWeek')}
                            </span>
                        )}
                    </p>
                    <p className="text-h2 font-semibold text-foreground">
                        {t(conditionKey(forecast.weatherCode))}
                    </p>
                </div>
                <Icon className="h-12 w-12 text-info" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-micro text-muted-foreground">
                <div>
                    <p className="text-foreground font-semibold">
                        {Math.round(forecast.tempMin)}° / {Math.round(forecast.tempMax)}°C
                    </p>
                    <p>{t('minMax')}</p>
                </div>
                <div className="flex items-start gap-1">
                    <Droplets className="h-3.5 w-3.5 mt-0.5" />
                    <div>
                        <p className="text-foreground font-semibold">
                            {Math.round(forecast.precipitationProbability)}%
                        </p>
                        <p>{t('rain')}</p>
                    </div>
                </div>
                <div className="flex items-start gap-1">
                    <Wind className="h-3.5 w-3.5 mt-0.5" />
                    <div>
                        <p className="text-foreground font-semibold">
                            {Math.round(forecast.windSpeedMax)} km/h
                        </p>
                        <p>{t('wind')}</p>
                    </div>
                </div>
            </div>
        </button>
    );
};

const KidsSuggestions: React.FC<{
    kids: ClothingKidDTO[];
    suggestions: ClothingSuggestionDTO[];
    aiUnavailable: boolean;
}> = ({ kids, suggestions, aiUnavailable }) => {
    const { t } = useTranslation('weather.custom');
    const byKidId = useMemo(() => {
        const m = new Map<string, ClothingSuggestionDTO>();
        for (const s of suggestions) m.set(s.kidId, s);
        return m;
    }, [suggestions]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {kids.map((kid) => {
                const suggestion = byKidId.get(kid.id);
                return (
                    <div key={kid.id} className="rounded-card border border-border bg-card p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <span
                                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ background: kid.color }}
                            />
                            <p className="text-caption font-semibold truncate">{kid.name}</p>
                            <span className="text-micro text-muted-foreground">
                                {t('ageYears', { count: kid.ageYears })}
                            </span>
                        </div>

                        {aiUnavailable || !suggestion ? (
                            <p className="text-micro italic text-muted-foreground">
                                {t('noSuggestion')}
                            </p>
                        ) : (
                            <SuggestionPills suggestion={suggestion} />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

const SuggestionPills: React.FC<{ suggestion: ClothingSuggestionDTO }> = ({ suggestion }) => {
    const { t } = useTranslation('weather.custom');
    const sections: Array<{ id: string; label: string; items: string[] }> = [
        { id: 'top', label: t('sectionTop'), items: suggestion.top },
        { id: 'bottom', label: t('sectionBottom'), items: suggestion.bottom },
        { id: 'footwear', label: t('sectionFootwear'), items: suggestion.footwear },
        { id: 'accessories', label: t('sectionAccessories'), items: suggestion.accessories },
    ];

    return (
        <div className="space-y-1.5">
            {sections.map(({ id, label, items }) =>
                items.length === 0 ? null : (
                    <div key={id} className="flex flex-wrap items-center gap-1">
                        <span className="text-micro font-medium text-muted-foreground w-20 shrink-0">
                            {label}
                        </span>
                        {items.map((item) => (
                            <span
                                key={item}
                                className="rounded-pill bg-primary-soft px-2 py-0.5 text-micro text-primary"
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                ),
            )}
            {suggestion.advice && (
                <p className="mt-2 text-micro italic text-muted-foreground border-l-2 border-primary/30 pl-2">
                    {suggestion.advice}
                </p>
            )}
        </div>
    );
};

export default WeatherClothingCard;
