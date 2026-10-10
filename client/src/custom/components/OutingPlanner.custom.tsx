import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Baby,
    Binoculars,
    BookOpen,
    Fish,
    Landmark,
    Loader2,
    MapPin,
    PawPrint,
    Sparkles,
    Star,
    Trees,
    Waves,
    FerrisWheel,
    Car,
    CalendarPlus,
    Check,
    ExternalLink,
    Home,
    Sun,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select, useToast } from '../../components/ui';
import { useSavedLocation, type GeoOverride } from '../hooks/useWeather.custom';
import {
    outingsQueryKey,
    useOutings,
    type OutingDuration,
    type OutingParty,
    type OutingPlaceDTO,
    type PlaceCategory,
} from '../hooks/useOutings.custom';

// =============================================================================
// OutingPlanner — the AI-assisted outing planner on the Planning page.
//
// Reads as one form: who is coming, which day, how long — then "Suggest
// outings". The server grounds the answer in OpenStreetMap (real places around
// the family) and asks the configured model to rank them for that day, those
// people and those constraints; the panel adds the one that is picked to the
// planning through upstream's own /api/planning entry, so the week stays in one
// place.
//
// No AI model configured is a working mode, not an error: the nearest places
// still come back, unranked (the server says so through `ai`, and the panel
// repeats it above the list).
// =============================================================================

const CATEGORY_ICON: Record<PlaceCategory, React.ComponentType<{ className?: string }>> = {
    playground: Baby,
    park: Trees,
    zoo: PawPrint,
    aquarium: Fish,
    museum: Landmark,
    theme_park: FerrisWheel,
    attraction: Star,
    swimming: Waves,
    library: BookOpen,
    viewpoint: Binoculars,
};

const PARTIES: OutingParty[] = ['family', 'kids', 'parents'];
const DURATIONS: OutingDuration[] = ['short', 'half_day', 'full_day'];

const dateKey = (date: Date): string => {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
};

/** schedule_entries.day_of_week is ISO: 1 = Monday … 7 = Sunday. */
const isoDayOfWeek = (key: string): number => new Date(`${key}T00:00:00`).getDay() || 7;

interface FamilyMemberLite {
    id: string;
    name: string;
    role: string;
}

/** The members an outing is recorded for: everyone, or the adults alone. */
const membersForParty = (members: FamilyMemberLite[], party: OutingParty): string[] => {
    const chosen = party === 'parents' ? members.filter((m) => m.role !== 'Enfant') : members;
    return chosen.map((m) => m.id);
};

const OutingPlanner: React.FC = () => {
    const { t } = useTranslation('outings.custom');
    const { isModuleEnabled } = useAuth();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const savedLocation = useSavedLocation();
    const { data, dataKey, loading, error, suggest } = useOutings();

    const [override, setOverride] = useState<GeoOverride | null>(null);
    const [party, setParty] = useState<OutingParty>('family');
    const [duration, setDuration] = useState<OutingDuration>('half_day');
    const [date, setDate] = useState(() => dateKey(new Date()));
    const [adding, setAdding] = useState<string | null>(null);
    const [added, setAdded] = useState<Record<string, boolean>>({});
    const [addError, setAddError] = useState<string | null>(null);
    const members = useRef<FamilyMemberLite[] | null>(null);

    const hasLocation = override !== null || savedLocation.data?.latitude != null;
    const enabled = isModuleEnabled('outings');

    // An answer belongs to the form it was asked for: the hook carries the key it
    // stored `data` under, so a control changed since then already shows nothing
    // (rather than the previous outing under the new party or day).
    const formKey = outingsQueryKey({ party, duration, date, override });
    const visible = data && dataKey === formKey ? data : null;
    const isShownAnswer = visible !== null;

    const handleSuggest = async (force: boolean) => {
        setAddError(null);
        await suggest({ party, duration, date, override, force });
    };

    const loadMembers = async (): Promise<FamilyMemberLite[]> => {
        if (members.current) return members.current;
        const response = await api.get<{ success: boolean; data: FamilyMemberLite[] }>('/api/family');
        members.current = response.data ?? [];
        return members.current;
    };

    const addToPlanning = async (place: OutingPlaceDTO) => {
        setAdding(place.id);
        setAddError(null);
        try {
            const ids = membersForParty(await loadMembers(), party);
            if (ids.length === 0) {
                setAddError(t('places.error'));
                return;
            }
            await api.post('/api/planning', {
                family_member_ids: ids,
                // The older-android-server field: the primary participant.
                family_member_id: ids[0],
                schedule_type: 'activity',
                title: place.name,
                day_of_week: isoDayOfWeek(visible?.date ?? date),
                specific_date: visible?.date ?? date,
                start_time: place.startTime,
                end_time: place.endTime,
                location: place.name,
                notes: place.why || null,
            });
            setAdded((prev) => ({ ...prev, [place.id]: true }));
            showToast({ title: t('places.added') });
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            // 409 TIME_OVERLAP is an ordinary answer: that slot is taken.
            setAddError(/overlap/i.test(message) ? t('places.conflict') : t('places.error'));
        } finally {
            setAdding(null);
        }
    };

    const useMyPosition = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setOverride({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                });
            },
            () => undefined,
            { timeout: 10_000 },
        );
    };

    const weatherLine = useMemo(() => {
        if (!visible?.weather) return null;
        return t('weather', {
            label: visible.weather.label,
            min: Math.round(visible.weather.tempMin),
            max: Math.round(visible.weather.tempMax),
            rain: Math.round(visible.weather.precipitationProbability),
        });
    }, [visible, t]);

    if (!enabled) return null;

    return (
        <Card hover={false}>
            <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            {t('title')}
                        </CardTitle>
                        <p className="mt-1 text-caption text-muted-foreground">
                            {savedLocation.data?.city && !override
                                ? t('subtitle', { city: savedLocation.data.city })
                                : t('subtitleNoCity')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {override ? (
                            <Badge variant="primary">
                                <MapPin className="mr-1 h-3 w-3" />
                                {t('position.current')}
                            </Badge>
                        ) : savedLocation.data?.city ? (
                            <Badge variant="secondary">
                                <MapPin className="mr-1 h-3 w-3" />
                                {savedLocation.data.city}
                            </Badge>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={useMyPosition}>
                            {t('position.use')}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
                {!hasLocation ? (
                    <div className="rounded-input border border-dashed border-border px-4 py-6 text-center">
                        <p className="text-body font-medium">{t('noLocation.title')}</p>
                        <p className="mt-1 text-caption text-muted-foreground">{t('noLocation.subtitle')}</p>
                        <Button className="mt-4" onClick={() => navigate('/settings')}>
                            {t('noLocation.cta')}
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-2">
                                <span className="text-micro font-medium text-muted-foreground">
                                    {t('party.label')}
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {PARTIES.map((value) => (
                                        <Button
                                            key={value}
                                            size="sm"
                                            variant={party === value ? 'primary' : 'secondary'}
                                            onClick={() => setParty(value)}
                                        >
                                            {t(`party.${value}`)}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <Input
                                type="date"
                                label={t('date.label')}
                                value={date}
                                onChange={(event) => setDate(event.target.value || dateKey(new Date()))}
                            />
                            <div className="space-y-2">
                                <span className="text-micro font-medium text-muted-foreground">
                                    {t('duration.label')}
                                </span>
                                <Select
                                    value={duration}
                                    onValueChange={(value) => setDuration(value as OutingDuration)}
                                    options={DURATIONS.map((value) => ({
                                        value,
                                        label: t(`duration.${value}`),
                                    }))}
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                disabled={loading}
                                onClick={() => void handleSuggest(isShownAnswer)}
                            >
                                {loading ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Sparkles className="mr-2 h-4 w-4" />
                                )}
                                {loading ? t('generating') : isShownAnswer ? t('regenerate') : t('generate')}
                            </Button>
                            {weatherLine ? (
                                <span className="text-caption text-muted-foreground">{weatherLine}</span>
                            ) : null}
                        </div>

                        {error === 'NO_LOCATION' ? (
                            <p className="text-caption text-danger">{t('noLocation.subtitle')}</p>
                        ) : error ? (
                            <p className="text-caption text-danger">{t('error')}</p>
                        ) : null}

                        {visible ? (
                            <div className="space-y-4">
                                {visible.ai !== 'ok' ? (
                                    <p className="flex items-center gap-2 rounded-input border border-border bg-surface-2 px-3 py-2 text-micro text-muted-foreground">
                                        {visible.ai === 'pending' ? (
                                            <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
                                        ) : null}
                                        {visible.ai === 'pending'
                                            ? t('ai.pending')
                                            : visible.ai === 'disabled'
                                              ? t('ai.disabled')
                                              : t('ai.failed')}
                                    </p>
                                ) : null}
                                {visible.placesSource === 'unavailable' ? (
                                    <p className="text-micro text-muted-foreground">{t('source.unavailable')}</p>
                                ) : null}

                                {visible.places.length > 0 ? (
                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <h3 className="text-caption font-semibold">{t('places.title')}</h3>
                                            {visible.placesSource === 'osm' ? (
                                                <span className="text-micro text-muted-foreground">
                                                    {t('source.osm')}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                            {visible.places.map((place) => {
                                                const Icon = CATEGORY_ICON[place.category] ?? Star;
                                                return (
                                                    <div
                                                        key={place.id}
                                                        className="rounded-input border border-border p-3"
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-body font-medium">
                                                                    {place.name}
                                                                </p>
                                                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <Icon className="h-3 w-3" />
                                                                        {t(`categories.${place.category}`)}
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <Car className="h-3 w-3" />
                                                                        {t('places.distance', { km: place.distanceKm })}
                                                                    </span>
                                                                </p>
                                                            </div>
                                                            <Badge variant="secondary">
                                                                {place.startTime}–{place.endTime}
                                                            </Badge>
                                                        </div>

                                                        {place.why ? (
                                                            <p className="mt-2 text-caption">{place.why}</p>
                                                        ) : null}

                                                        <div className="mt-2 space-y-0.5 text-micro text-muted-foreground">
                                                            {place.openingHours ? (
                                                                <p>{t('places.hours', { hours: place.openingHours })}</p>
                                                            ) : null}
                                                            {place.fee ? (
                                                                <p>{t('places.fee', { fee: place.fee })}</p>
                                                            ) : null}
                                                        </div>

                                                        <div className="mt-3 flex items-center gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                disabled={adding === place.id || added[place.id] === true}
                                                                onClick={() => void addToPlanning(place)}
                                                            >
                                                                {added[place.id] ? (
                                                                    <Check className="mr-1.5 h-3.5 w-3.5" />
                                                                ) : adding === place.id ? (
                                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                                ) : (
                                                                    <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
                                                                )}
                                                                {added[place.id] ? t('places.added') : t('places.add')}
                                                            </Button>
                                                            {place.website ? (
                                                                <a
                                                                    href={place.website}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="inline-flex items-center gap-1 text-micro text-primary hover:underline"
                                                                >
                                                                    <ExternalLink className="h-3 w-3" />
                                                                    {t('places.website')}
                                                                </a>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {addError ? (
                                            <p className="mt-2 text-micro text-danger">{addError}</p>
                                        ) : null}
                                    </div>
                                ) : null}

                                {visible.ideas.length > 0 ? (
                                    <div>
                                        <h3 className="mb-2 text-caption font-semibold">{t('ideas.title')}</h3>
                                        <ul className="space-y-2">
                                            {visible.ideas.map((idea, index) => (
                                                <li
                                                    key={`${idea.title}-${index}`}
                                                    className="rounded-input border border-border p-3"
                                                >
                                                    <p className="flex items-center gap-2 text-body font-medium">
                                                        {idea.indoor ? (
                                                            <Home className="h-3.5 w-3.5 text-muted-foreground" />
                                                        ) : (
                                                            <Sun className="h-3.5 w-3.5 text-muted-foreground" />
                                                        )}
                                                        {idea.title}
                                                        <Badge variant="secondary">
                                                            {idea.indoor ? t('ideas.indoor') : t('ideas.outdoor')}
                                                        </Badge>
                                                    </p>
                                                    {idea.description ? (
                                                        <p className="mt-1 text-caption text-muted-foreground">
                                                            {idea.description}
                                                        </p>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}

                                {visible.places.length === 0 && visible.ideas.length === 0 ? (
                                    <p className="text-caption text-muted-foreground">{t('empty')}</p>
                                ) : null}
                            </div>
                        ) : null}
                    </>
                )}
            </CardContent>
        </Card>
    );
};

export default OutingPlanner;
