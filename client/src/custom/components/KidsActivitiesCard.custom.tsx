import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    Bike,
    CalendarPlus,
    Check,
    ChefHat,
    Clock,
    Hand,
    Lightbulb,
    MapPin,
    MonitorOff,
    Package,
    Palette,
    RefreshCw,
    Shuffle,
    Sun,
    Sunrise,
    Sunset,
    Trees,
    Users,
} from 'lucide-react';
import { Card, CardContent, Button, useToast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { dayContextHeading } from '../lib/dayContextLabel.custom';
import {
    useKidsActivities,
    useSavedLocation,
    type ActivityCategory,
    type ActivityTimeOfDay,
    type ClothingKidDTO,
    type GeoOverride,
    type KidActivityDTO,
} from '../hooks/useWeather.custom';

// =============================================================================
// KidsActivitiesCard
//
// Screen-free things to do on a day the kids are home. Sits on the dashboard
// only when the server says the target day is a home day (holidays, weekend) —
// see `dayContext.mode` and server/src/lib/dayContext.ts.
//
// Design constraint worth keeping: this card must never render empty. An empty
// "what shall we do today?" card concedes the day to the tablet, which is the
// one outcome the feature exists to prevent — so when the AI is off or
// unreachable the server serves a static bank instead of nothing, and only the
// wording downgrades (`aiUnavailable`), never the content.
// =============================================================================

const CATEGORY_ICON: Record<ActivityCategory, React.ComponentType<{ className?: string }>> = {
    outdoor: Trees,
    creative: Palette,
    cooking: ChefHat,
    learning: Lightbulb,
    sport: Bike,
    chores: Hand,
    social: Users,
};

const TIME_ICON: Record<ActivityTimeOfDay, React.ComponentType<{ className?: string }>> = {
    morning: Sunrise,
    afternoon: Sun,
    evening: Sunset,
};

/**
 * Any AI failure degrades to the offline bank, so an unknown code is expected
 * (a provider outage, a timeout…) — it gets the generic wording rather than a
 * missing translation key.
 */
const DEGRADED_LABEL_KEY: Record<string, string> = {
    DISABLED: 'degradedDisabled',
    BAD_JSON: 'degradedBadJson',
};

/** Where each slot starts when the model gave no clock time. */
const SLOT_START: Record<ActivityTimeOfDay, string> = {
    morning: '10:00',
    afternoon: '15:00',
    evening: '17:30',
};

const addMinutes = (hhmm: string, minutes: number): string => {
    const [h, m] = hhmm.split(':').map(Number);
    const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** schedule_entries.day_of_week is ISO: 1 = Monday … 7 = Sunday. */
const isoDayOfWeek = (dateKey: string): number => {
    const js = new Date(`${dateKey}T00:00:00`).getDay(); // 0 = Sunday
    return js === 0 ? 7 : js;
};

interface Props {
    /** Session-only geolocation fix, shared with the weather card. */
    override: GeoOverride | null;
}

const KidsActivitiesCard: React.FC<Props> = ({ override }) => {
    const { t } = useTranslation('activities.custom');
    const { user, isModuleEnabled } = useAuth();
    const navigate = useNavigate();

    // Titles already shown. Sending them back lets the model propose something
    // else instead of rotating the same four ideas all summer.
    const [exclude, setExclude] = useState<string[]>([]);
    const location = useSavedLocation();

    const enabled = !!user && (override !== null || location.data?.latitude != null);
    const query = useKidsActivities(override, exclude, enabled);

    // The dashboard renders this widget unconditionally; the module flag
    // (CUSTOM_FEATURE_WEATHER_ENABLED) hides it by making the card a no-op.
    if (!isModuleEnabled('activities')) return null;

    // No saved city: stay silent rather than showing a second "configure your
    // city" CTA under the weather card's. It also keeps us honest — without the
    // request we don't know whether the day is even a home day, and prompting on
    // a school evening would be noise.
    if (!enabled) return null;

    if (query.loading) {
        return (
            <Card>
                <CardContent className="p-6">
                    <div className="animate-pulse space-y-4">
                        <div className="h-6 w-56 rounded bg-surface-2" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="h-28 rounded-card bg-surface-2" />
                            <div className="h-28 rounded-card bg-surface-2" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (query.error || !query.data) {
        return (
            <Card>
                <CardContent className="p-6 flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-destructive shrink-0" />
                    <p className="flex-1 text-caption font-semibold">{t('errorTitle')}</p>
                    <Button variant="ghost" size="sm" onClick={query.refetch}>
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        {t('retry')}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    const data = query.data;

    // The dashboard already gates on this, but the card owns its own contract:
    // it has nothing to say about a school day.
    if (data.dayContext.mode !== 'home') return null;

    if (data.kids.length === 0) {
        return (
            <EmptyShell
                title={t('addKidTitle')}
                description={t('addKidDescription')}
                actionLabel={t('goToFamily')}
                onAction={() => navigate('/family')}
            />
        );
    }

    const regenerate = () =>
        setExclude((prev) =>
            // Cap the list: the server caps it too, and a prompt stuffed with
            // exclusions crowds out the actual instructions. Bank ideas are
            // excluded by id (their titles are translated here, so the server
            // cannot match them), model ideas by the text they came with.
            [...prev, ...data.activities.map((a) => a.id ?? a.title ?? '')].filter(Boolean).slice(-12),
        );

    return (
        <Card>
            <CardContent className="p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                    <div>
                        <h2 className="text-h2 font-semibold flex items-center gap-2">
                            <MonitorOff className="h-5 w-5 text-primary" />
                            {dayContextHeading(data.dayContext, t)}
                        </h2>
                        <p className="text-micro text-muted-foreground flex flex-wrap items-center gap-1">
                            <span>{t('subtitle', { count: data.activities.length })}</span>
                            {/* The bank answers in ~200 ms while the model can take
                                a minute; the ideas are real either way, and this
                                says which ones the reader is looking at. */}
                            {query.status === 'thinking' && (
                                <span className="ml-1 italic">· {t('thinkingMore')}</span>
                            )}
                            {query.status === 'failed' && (
                                <span className="ml-1 italic">· {t('degradedOffline')}</span>
                            )}
                            {query.status === 'ready' && data.aiUnavailable && data.code && (
                                <span className="ml-1 italic">
                                    · {t(DEGRADED_LABEL_KEY[data.code] ?? 'degradedOffline')}
                                </span>
                            )}
                        </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={regenerate} disabled={query.loading}>
                        <Shuffle className="h-4 w-4 mr-1.5" />
                        {t('regenerate')}
                    </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {data.activities.map((activity) => (
                        <ActivityTile
                            key={activity.id ?? activity.title}
                            activity={activity}
                            kids={data.kids}
                            dateKey={data.dayContext.date}
                        />
                    ))}
                </div>

                {/* Where the personal part comes from. Hidden on the offline
                    path, where the static bank cannot use it either. */}
                {!data.aiUnavailable && (
                    <p className="text-micro text-muted-foreground">
                        {t('personalHint')}{' '}
                        <button
                            type="button"
                            onClick={() => navigate('/family')}
                            className="underline underline-offset-2 hover:text-foreground"
                        >
                            {t('personalHintAction')}
                        </button>
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const EmptyShell: React.FC<{
    title: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
    <Card>
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-primary-soft">
                <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
                <h3 className="text-caption font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-micro text-muted-foreground">{description}</p>
            </div>
            <Button onClick={onAction}>{actionLabel}</Button>
        </CardContent>
    </Card>
);

const ActivityTile: React.FC<{
    activity: KidActivityDTO;
    kids: ClothingKidDTO[];
    dateKey: string;
}> = ({ activity, kids, dateKey }) => {
    const { t } = useTranslation('activities.custom');
    const { showToast } = useToast();
    const [scheduled, setScheduled] = useState(false);
    const [scheduling, setScheduling] = useState(false);

    const CategoryIcon = CATEGORY_ICON[activity.category];
    const TimeIcon = TIME_ICON[activity.timeOfDay];

    // A bank idea arrives as slugs; a model idea arrives with its text already
    // written in the reader's language. Everything below reads the resolved
    // values, so both paths render — and get planned — identically.
    const title = activity.id ? t(`bank.${activity.id}.title`) : (activity.title ?? '');
    const instructions = activity.id
        ? t(`bank.${activity.id}.instructions`)
        : (activity.instructions ?? '');
    const materials = activity.id
        ? activity.materials.map((m) => t(`materialNames.${m}`))
        : activity.materials;

    const concerned = useMemo(
        () => kids.filter((k) => activity.kidIds.includes(k.id)),
        [kids, activity.kidIds],
    );

    /**
     * Reuses POST /api/planning rather than adding an endpoint: schedule entries
     * already carry everything an activity needs, and the route rejects an
     * overlapping entry with a 409 — so "plan the treasure hunt at 10:00" simply
     * cannot land on top of swimming.
     *
     * `family_member_id` is single-valued, so an activity shared by two kids
     * becomes two entries: each kid's planning shows it.
     */
    const handleSchedule = async () => {
        setScheduling(true);
        const startTime = SLOT_START[activity.timeOfDay];
        try {
            for (const kidId of activity.kidIds) {
                await api.post('/api/planning', {
                    family_member_id: kidId,
                    schedule_type: 'activity',
                    // The reader's own wording, so the planning entry matches what
                    // they clicked.
                    title,
                    day_of_week: isoDayOfWeek(dateKey),
                    start_time: startTime,
                    end_time: addMinutes(startTime, activity.durationMinutes),
                    // Without this the entry would recur EVERY week — a one-off
                    // holiday idea must stay a one-off.
                    specific_date: dateKey,
                    notes: instructions || null,
                });
            }
            setScheduled(true);
            showToast({
                title: t('scheduledTitle'),
                description: t('scheduledDescription', { title }),
            });
        } catch (err) {
            // POST /api/planning answers 409 with "Conflicting schedule …";
            // that message is what the API client throws.
            const conflict = err instanceof Error && /Conflicting/i.test(err.message);
            showToast({
                title: conflict ? t('conflictTitle') : t('scheduleFailedTitle'),
                description: conflict ? t('conflictDescription') : undefined,
            });
        } finally {
            setScheduling(false);
        }
    };

    return (
        <div className="rounded-card border border-border bg-card p-3 space-y-2">
            <div className="flex items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-primary-soft">
                    <CategoryIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-caption font-semibold leading-snug">{title}</p>
                    <p className="text-micro text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="inline-flex items-center gap-1">
                            <TimeIcon className="h-3.5 w-3.5" />
                            {t(`timesOfDay.${activity.timeOfDay}`)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {t('durationMinutes', { count: activity.durationMinutes })}
                        </span>
                        <span>{t(`categories.${activity.category}`)}</span>
                    </p>
                </div>
            </div>

            {instructions && (
                <p className="text-micro text-muted-foreground border-l-2 border-primary/30 pl-2">
                    {instructions}
                </p>
            )}

            {materials.length > 0 && (
                <p className="text-micro text-muted-foreground flex flex-wrap items-center gap-1">
                    <Package className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{t('materials')}</span>
                    {materials.map((item) => (
                        <span key={item} className="rounded-pill bg-surface-2 px-2 py-0.5 text-micro">
                            {item}
                        </span>
                    ))}
                </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    {concerned.map((kid) => (
                        <span
                            key={kid.id}
                            className="inline-flex items-center gap-1 rounded-pill bg-primary-soft px-2 py-0.5 text-micro text-primary"
                        >
                            <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: kid.color }}
                            />
                            {kid.name}
                        </span>
                    ))}
                </div>

                <Button variant="ghost" size="sm" onClick={handleSchedule} disabled={scheduled || scheduling}>
                    {scheduled ? (
                        <>
                            <Check className="mr-1.5 h-4 w-4 text-success" />
                            {t('scheduled')}
                        </>
                    ) : (
                        <>
                            <CalendarPlus className="mr-1.5 h-4 w-4" />
                            {scheduling ? t('scheduling') : t('schedule')}
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default KidsActivitiesCard;
