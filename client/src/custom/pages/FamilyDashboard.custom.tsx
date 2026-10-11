import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle, Blinds, Calendar, Check, Coffee, DoorOpen, Home, Lamp, Lock,
    MonitorOff, Moon, Package, Power, PowerOff, RefreshCw, ShoppingCart, Sparkles,
    Sun, Sunrise, Sunset, Tag, Thermometer, Tv, Undo2, UtensilsCrossed, Wind, WifiOff,
} from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { CONDITION_ICON, weatherCondition } from '../lib/weatherCode.custom';
import {
    useDashboardWeather, useKidsActivities, useSavedLocation, useWeeklyForecast,
    type DailyForecastDTO, type DashboardWeatherDTO, type KidsActivitiesDTO, type KidActivityDTO,
    type WidgetResult,
} from '../hooks/useWeather.custom';
import { daysUntil } from '../lib/pantryDates.custom';
import type { PromoPage } from '../lib/product.custom';
import { findByName, isOn, useHomeAssistant, type HaDevice, type HaDeviceState } from '../hooks/useHomeAssistant.custom';
import {
    formatCountdown, minutesUntil, overrideExpiry, resolvePhase, shiftPhase,
    type FamilyPhase, type PhaseOverride,
} from '../lib/familyPhase.custom';

// =============================================================================
// The family dashboard: one full-screen, phase-aware page for a wall tablet.
//
// Chrome-less without touching App.tsx's route list: the root is a `fixed
// inset-0 z-[60]` layer, above every piece of Layout's fixed chrome (its own
// highest is z-50). Upstream's Kiosk solves the same problem by rendering
// outside <Layout>, which would cost an upstream edit; this covers the chrome
// instead.
//
// Layout rules that the whole file respects, because the target is a 9.7"
// portrait tablet at arm's length:
//   - a phase is a fixed stack of panels that FILLS the viewport: the page never
//     scrolls. Every list is capped and every row truncates, so what does not fit
//     the panel is left out rather than pushed off screen — a wall display nobody
//     touches is unreadable if its content moves on its own;
//   - the panels carry today's household state (agenda, kids' ideas, meals,
//     promos, pantry, tasks, shopping) like upstream's Kiosk does, and the
//     lighting/device surfaces that need a lot of room live in the House sheet;
//   - every tappable element is at least 56 px in both directions;
//   - motion is limited to transitions and `active:scale`, no filters, no blur
//     except the two bars, and all tiles are memoised so a wall display's 5 s
//     clock tick does not repaint the lists.
// =============================================================================

const pad2 = (value: number) => String(value).padStart(2, '0');
const ymd = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const isoDay = (date: Date) => ((date.getDay() + 6) % 7) + 1; // Mon = 1 … Sun = 7
const hhmmOf = (value: string | null | undefined): string => /^(\d{2}):(\d{2})/.exec(value ?? '')?.[0] ?? '';

const addDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

const weekStartOf = (date: Date) => addDays(date, -(isoDay(date) - 1));

/**
 * One calendar day of appointments. The route compares `start_time <= end_date` as
 * a STRING, so a bare `YYYY-MM-DD` end date silently drops every appointment after
 * midnight — the window has to name both ends of the day, as Kiosk.tsx does.
 */
const dayAppointments = (dateKey: string) =>
    `/api/appointments?start_date=${dateKey}T00:00:00&end_date=${dateKey}T23:59:59`;

/** "lundi 12" — long enough for a wall display, short enough for the top bar. */
const useDateLabel = () => {
    const { i18n } = useTranslation();
    return useCallback(
        (date: Date) =>
            new Intl.DateTimeFormat(i18n.language || 'fr', { weekday: 'long', day: 'numeric', month: 'long' }).format(date),
        [i18n.language],
    );
};

/**
 * Minimal read-through fetch for the upstream lists the phases show. No cache:
 * these are per-phase and the Refresh button already re-runs them.
 */
interface ApiResult<T> { data: T | null; loading: boolean }

function useApi<T>(url: string | null, reloadKey: number): ApiResult<T> {
    const [state, setState] = useState<{ data: T | null; loading: boolean }>({ data: null, loading: !!url });
    useEffect(() => {
        if (!url) {
            setState({ data: null, loading: false });
            return;
        }
        let active = true;
        setState((prev) => ({ data: prev.data, loading: true }));
        api.get<{ success: boolean; data: T }>(url)
            .then((response) => {
                if (active) setState({ data: response.data, loading: false });
            })
            .catch(() => {
                if (active) setState({ data: null, loading: false });
            });
        return () => {
            active = false;
        };
    }, [url, reloadKey]);
    return state;
}

// ── Domain data shapes (the same rows Kiosk.tsx reads) ───────────────────────

interface Member { id: string; name: string; color: string }
interface Appointment {
    id: string;
    title: string;
    start_time: string;
    end_time?: string;
    location?: string;
    family_members_data?: Member[];
}
interface Task {
    id: string;
    title: string;
    is_completed: boolean;
    priority?: string;
    due_date?: string;
    assigned_to_members?: Member[];
}
interface MealPlan {
    id: string;
    date: string;
    meal_type: string;
    custom_meal?: string;
    recipe?: { id: string; name: string };
}
interface PlanningEntry {
    id: string;
    family_member_name: string;
    family_member_color: string;
    schedule_type: string;
    title: string;
    day_of_week: number;
    specific_date?: string | null;
    start_time: string;
    end_time: string;
}
interface ShoppingItem { id: string; name: string; is_checked: boolean; quantity?: number; unit?: string | null }
interface PantryItem { id: string; name: string; expires_on: string | null }

const MEAL_ORDER = ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Snack'];

/** How many rows a panel is allowed to take. The screen is fixed; the data is not. */
const CAP = { agenda: 5, activities: 3, meals: 4, promos: 4, pantry: 4, tasks: 4, shopping: 4 } as const;

// ── Shared building blocks ───────────────────────────────────────────────────

const MemberDots: React.FC<{ members?: Member[] }> = memo(({ members }) => {
    if (!members || members.length === 0) return null;
    return (
        <span className="flex shrink-0 items-center gap-1">
            {members.map((member) => (
                <span
                    key={member.id}
                    title={member.name}
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: member.color }}
                />
            ))}
        </span>
    );
});

/**
 * A panel in the phase stack: fixed header, body that clips what the capped list
 * did not already leave out. `min-h-0` on both is what lets the stack share the
 * viewport instead of growing past it.
 */
const Panel: React.FC<React.PropsWithChildren<{
    title: string;
    icon: React.ReactNode;
    action?: { label: string; to: string };
    className?: string;
}>> = ({ title, icon, action, className = '', children }) => (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card p-3 shadow-surface ${className}`}>
        <h2 className="mb-2 flex shrink-0 items-center gap-2 text-base font-semibold text-foreground">
            <span className="text-primary">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {action && (
                <Link to={action.to} className="flex min-h-[56px] shrink-0 items-center text-caption font-medium text-primary">
                    {action.label}
                </Link>
            )}
        </h2>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
);

const Empty: React.FC<React.PropsWithChildren> = ({ children }) => (
    <p className="py-2 text-sm text-muted-foreground">{children}</p>
);

/** The phase stack: fills the viewport, never scrolls. */
const PhaseBody: React.FC<React.PropsWithChildren> = ({ children }) => (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">{children}</div>
);

/** The two-column band several phases use for their compact lists. */
const Band: React.FC<React.PropsWithChildren<{ weight: string }>> = ({ weight, children }) => (
    <div className={`flex min-h-0 ${weight} gap-3`} style={{ minHeight: 0 }}>{children}</div>
);

// ── Undo queue ───────────────────────────────────────────────────────────────
//
// Kiosk.tsx's pattern, kept as-is: the tap flips the row and fires the PUT right
// away, and "Annuler" is the reverse PUT. The timeout only takes the toast away.
// One queue for the whole page, so a task and a shopping item tapped in the same
// breath do not fight over the bottom of the screen.

interface UndoEntry { key: string; label: string; undo: () => void }

interface UndoQueue {
    entries: UndoEntry[];
    push: (entry: UndoEntry) => void;
    drop: (key: string) => void;
}

function useUndoQueue(): UndoQueue {
    const [entries, setEntries] = useState<UndoEntry[]>([]);
    const push = useCallback((entry: UndoEntry) => {
        setEntries((prev) => [...prev.filter((existing) => existing.key !== entry.key), entry]);
        window.setTimeout(() => setEntries((prev) => prev.filter((existing) => existing.key !== entry.key)), 5_000);
    }, []);
    const drop = useCallback((key: string) => setEntries((prev) => prev.filter((entry) => entry.key !== key)), []);
    return useMemo(() => ({ entries, push, drop }), [entries, push, drop]);
}

/**
 * The reverse of a tap: the row is hidden at once and the PUT fires, the undo
 * restores both. Both lists the tablet ticks off take the same shape, only the
 * route and the boolean field differ.
 */
function useTapToComplete(
    undo: UndoQueue,
    hide: React.Dispatch<React.SetStateAction<Record<string, true>>>,
    path: string,
    flag: 'is_completed' | 'is_checked',
): (row: TapRow) => void {
    return useCallback(
        (row: TapRow) => {
            hide((prev) => ({ ...prev, [row.id]: true }));
            undo.push({
                key: row.id,
                label: row.label,
                undo: () => {
                    hide((prev) => {
                        const next = { ...prev };
                        delete next[row.id];
                        return next;
                    });
                    void api.put(`${path}/${row.id}`, { [flag]: false }).catch(() => undefined);
                },
            });
            void api.put(`${path}/${row.id}`, { [flag]: true }).catch(() => undefined);
        },
        [undo, hide, path, flag],
    );
}

const UndoToast: React.FC<{ queue: UndoQueue; label: string }> = memo(({ queue, label }) => {
    if (queue.entries.length === 0) return null;
    return (
        <div className="pointer-events-none absolute inset-x-4 bottom-3 z-[65] flex items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-surface-hover">
            <span className="flex-1 truncate text-sm">{label}</span>
            {queue.entries.slice(0, 2).map((entry) => (
                <button
                    key={entry.key}
                    type="button"
                    onClick={() => {
                        entry.undo();
                        queue.drop(entry.key);
                    }}
                    className="pointer-events-auto flex min-h-[56px] max-w-[45%] items-center gap-1 rounded-lg bg-background/20 px-3 text-sm font-semibold"
                >
                    <Undo2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{entry.label}</span>
                </button>
            ))}
        </div>
    );
});

// ── Tappable list (tasks and shopping share it) ──────────────────────────────

interface TapRow { id: string; label: string; meta?: React.ReactNode }

const TappableList: React.FC<{
    rows: TapRow[];
    empty: string;
    loadingLabel?: string;
    shape: 'round' | 'square';
    onTap: (row: TapRow) => void;
}> = memo(({ rows, empty, loadingLabel, shape, onTap }) => {
    if (loadingLabel) return <Empty>{loadingLabel}</Empty>;
    if (rows.length === 0) return <Empty>{empty}</Empty>;
    return (
        <ul className="space-y-1">
            {rows.map((row) => (
                <li key={row.id}>
                    <button
                        type="button"
                        onClick={() => onTap(row)}
                        className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-surface-2"
                    >
                        <span
                            className={`h-7 w-7 shrink-0 border-2 border-muted-foreground/60 ${shape === 'round' ? 'rounded-full' : 'rounded-[7px]'}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-base text-foreground">{row.label}</span>
                        {row.meta}
                    </button>
                </li>
            ))}
        </ul>
    );
});

// ── Top bar ──────────────────────────────────────────────────────────────────

interface TopBarProps {
    now: Date;
    phase: FamilyPhase;
    forecast: DailyForecastDTO | null;
    weatherEnabled: boolean;
    onCycle: () => void;
}

const TopBar: React.FC<TopBarProps> = memo(({ now, phase, forecast, weatherEnabled, onCycle }) => {
    const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
    const dateLabel = useDateLabel();
    const condition = forecast ? weatherCondition(forecast.weatherCode) : null;
    const ConditionIcon = condition ? CONDITION_ICON[condition] : null;

    return (
        <header className="flex h-24 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                {weatherEnabled && ConditionIcon && forecast ? (
                    <>
                        <ConditionIcon className="h-10 w-10 shrink-0 text-primary" />
                        <div className="min-w-0">
                            <p className="text-2xl font-semibold leading-tight text-foreground">
                                {Math.round(forecast.tempMax)}°
                                <span className="ml-1 text-lg text-muted-foreground">{Math.round(forecast.tempMin)}°</span>
                            </p>
                            <p className="truncate text-sm text-muted-foreground">{t(`weather.custom:conditions.${condition}` as never)}</p>
                        </div>
                    </>
                ) : (
                    <span className="text-sm text-muted-foreground">{t('dashboard.custom:widgets.noWeather')}</span>
                )}
            </div>

            <p className="shrink-0 font-serif text-5xl font-semibold tabular-nums text-foreground">
                {pad2(now.getHours())}:{pad2(now.getMinutes())}
            </p>

            <div className="flex min-w-0 flex-1 flex-col items-end">
                <button
                    type="button"
                    onClick={onCycle}
                    className="min-h-[56px] rounded-full bg-primary/10 px-4 text-base font-semibold text-primary transition-colors active:scale-95"
                >
                    {t(`dashboard.custom:phases.${phase}` as never)}
                </button>
                <p className="mt-1 truncate text-xs capitalize text-muted-foreground">{dateLabel(now)}</p>
            </div>
        </header>
    );
});

// ── Bottom bar ───────────────────────────────────────────────────────────────

interface ActionButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    spinning?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, onClick, disabled, spinning }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-sm font-medium text-foreground transition-colors active:scale-95 disabled:opacity-40"
    >
        <span className={spinning ? 'animate-spin' : undefined}>{icon}</span>
        <span className="text-sm">{label}</span>
    </button>
);

interface BottomBarProps {
    onRefresh: () => void;
    onAllOff: () => void;
    onHouse: () => void;
    refreshing: boolean;
    dimmed: boolean;
    haDown: boolean;
}

const BottomBar: React.FC<BottomBarProps> = memo(({ onRefresh, onAllOff, onHouse, refreshing, dimmed, haDown }) => {
    const { t } = useTranslation('dashboard.custom');
    return (
        <nav
            className={`flex h-16 shrink-0 items-center justify-around border-t border-border bg-card/90 px-4 backdrop-blur-sm transition-opacity ${dimmed ? 'opacity-50' : ''}`}
        >
            <ActionButton
                icon={<RefreshCw className="h-5 w-5" />}
                label={t('actions.refresh')}
                onClick={onRefresh}
                spinning={refreshing}
            />
            <ActionButton
                icon={<PowerOff className="h-5 w-5" />}
                label={t('actions.all_off')}
                onClick={onAllOff}
                disabled={haDown}
            />
            <ActionButton
                icon={<Power className="h-5 w-5" />}
                label={t('actions.house')}
                onClick={onHouse}
                disabled={haDown}
            />
            <Link
                to="/"
                className="flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-foreground transition-colors active:scale-95"
            >
                <Home className="h-5 w-5" />
                <span className="text-sm">{t('actions.home')}</span>
            </Link>
        </nav>
    );
});

// ── Device tiles ─────────────────────────────────────────────────────────────

const deviceIcon = (device: HaDevice) => {
    const deviceClass = String(device.attributes.device_class ?? '');
    if (device.domain === 'light') return Lamp;
    if (device.domain === 'media_player') return Tv;
    if (device.domain === 'climate') return Thermometer;
    if (device.domain === 'fan') return Wind;
    if (device.domain === 'cover' || deviceClass === 'blind' || deviceClass === 'curtain') return Blinds;
    if (device.domain === 'lock') return Lock;
    if (deviceClass === 'door' || deviceClass === 'window' || deviceClass === 'garage_door') return DoorOpen;
    return Power;
};

// Domains whose quick toggle really is `turn_on`/`turn_off`. `lock` and `cover`
// look like devices but have no such service — they take lock/unlock and
// open_cover/close_cover — so a tile for them would be a control that never
// works. The lock is shown in the House sheet's Security row instead; a cover has
// no place in a v1 quick-toggle grid.
const TOGGLEABLE_DOMAINS: Record<string, true> = {
    light: true,
    switch: true,
    input_boolean: true,
    fan: true,
    media_player: true,
    climate: true,
};

interface ToggleTileProps {
    device: HaDevice;
    busy: boolean;
    disabled: boolean;
    onToggle: (device: HaDevice) => void;
}
const ToggleTile: React.FC<ToggleTileProps> = memo(({ device, busy, disabled, onToggle }) => {
    const on = isOn(device);
    const Icon = deviceIcon(device);
    return (
        <button
            type="button"
            onClick={() => onToggle(device)}
            disabled={disabled || busy}
            className={`flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-colors active:scale-95 disabled:opacity-50 ${
                on ? 'border-primary bg-primary/10' : 'border-border bg-card'
            }`}
        >
            <Icon className={`h-7 w-7 ${on ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="line-clamp-2 text-sm font-medium text-foreground">{device.friendly_name}</span>
            <span
                className={`rounded-full px-3 py-0.5 text-sm font-semibold ${
                    on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
            >
                {on ? 'ON' : 'OFF'}
            </span>
        </button>
    );
});

// ── Shared panels ────────────────────────────────────────────────────────────

interface PhaseProps {
    ha: HaDeviceState;
    now: Date;
    today: string;
    reloadKey: number;
    weatherEnabled: boolean;
}

const AgendaList: React.FC<{ appointments: Appointment[]; loading: boolean; empty: string; loadingLabel: string }> = memo(
    ({ appointments, loading, empty, loadingLabel }) => {
        if (loading) return <Empty>{loadingLabel}</Empty>;
        if (appointments.length === 0) return <Empty>{empty}</Empty>;
        return (
            <ol className="space-y-1">
                {appointments.map((appointment) => (
                    <li key={appointment.id} className="flex min-h-[48px] items-center gap-3">
                        <span className="w-[52px] shrink-0 font-mono text-base text-muted-foreground">
                            {hhmmOf(appointment.start_time)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-medium text-foreground">{appointment.title}</span>
                            {appointment.location && (
                                <span className="block truncate text-caption text-muted-foreground">{appointment.location}</span>
                            )}
                        </span>
                        <MemberDots members={appointment.family_members_data} />
                    </li>
                ))}
            </ol>
        );
    },
);

/** The meals of the day, one line each — the kiosk's Meals panel, compact. */
const MealsStrip: React.FC<{ meals: MealPlan[]; loading: boolean; label: (value: string) => string }> = memo(
    ({ meals, loading, label }) => {
        const { t } = useTranslation(['dashboard.custom', 'kiosk']);
        if (loading) return <Empty>{t('dashboard.custom:phases.loading')}</Empty>;
        if (meals.length === 0) return <Empty>{t('kiosk:empty.meals')}</Empty>;
        return (
            <ul className="grid grid-cols-3 gap-3">
                {meals.map((meal) => (
                    <li key={meal.id} className="min-w-0">
                        <p className="truncate text-caption uppercase tracking-wide text-muted-foreground">{label(meal.meal_type)}</p>
                        <p className="truncate text-base font-medium text-foreground">
                            {meal.recipe?.name || meal.custom_meal || '—'}
                        </p>
                    </li>
                ))}
            </ul>
        );
    },
);

const ACTIVITY_ICON: Record<KidActivityDTO['timeOfDay'], React.ComponentType<{ className?: string }>> = {
    morning: Sunrise,
    afternoon: Sun,
    evening: Sunset,
};

const ACTIVITY_ORDER: KidActivityDTO['timeOfDay'][] = ['morning', 'afternoon', 'evening'];

/**
 * The kids' screen-free ideas, read-only: the dashboard card is where anything is
 * changed. A school day has nothing to say here, so the phases do not render this
 * panel at all — the same rule the card follows.
 */
const ActivitiesBody: React.FC<{ data: KidsActivitiesDTO }> = memo(({ data }) => {
    const { t } = useTranslation('activities.custom');

    const rows = [...data.activities]
        .sort((a, b) => ACTIVITY_ORDER.indexOf(a.timeOfDay) - ACTIVITY_ORDER.indexOf(b.timeOfDay))
        .slice(0, CAP.activities);

    return (
        <ul className="space-y-1">
            {rows.map((activity) => {
                const Icon = ACTIVITY_ICON[activity.timeOfDay];
                const kids = data.kids.filter((kid) => activity.kidIds.includes(kid.id));
                const title = activity.id ? t(`bank.${activity.id}.title`) : (activity.title ?? '');
                return (
                    <li key={activity.id ?? title} className="flex min-h-[56px] items-center gap-3">
                        <Icon className="h-5 w-5 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-medium text-foreground">{title}</span>
                            <span className="block truncate text-caption text-muted-foreground">
                                {t(`categories.${activity.category}` as never)}
                                {' · '}
                                {t('durationMinutes', { count: activity.durationMinutes })}
                            </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                            {kids.map((kid) => (
                                <span key={kid.id} className="h-3 w-3 rounded-full" style={{ backgroundColor: kid.color }} title={kid.name} />
                            ))}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
});

/** Today's deals from the shops the family can reach — the promo list, four rows. */
const PromosBody: React.FC<{ page: PromoPage | null; loading: boolean; currency: string }> = memo(
    ({ page, loading, currency }) => {
        const { t } = useTranslation(['dashboard.custom', 'scan.custom']);
        if (loading) return <Empty>{t('dashboard.custom:phases.loading')}</Empty>;
        const offers = (page?.offers ?? []).slice(0, CAP.promos);
        if (offers.length === 0) return <Empty>{t('dashboard.custom:widgets.noPromos')}</Empty>;
        return (
            <ul className="space-y-1">
                {offers.map((offer, index) => (
                    <li key={`${offer.retailer}-${offer.name ?? index}`} className="flex min-h-[52px] items-center gap-3">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-medium text-foreground">
                                {offer.name ?? offer.brand ?? '—'}
                            </span>
                            <span className="block truncate text-caption text-muted-foreground">{offer.retailer_name}</span>
                        </span>
                        {offer.price !== null && (
                            <span className="shrink-0 text-base font-semibold tabular-nums text-foreground">
                                {formatCurrency(offer.price, currency)}
                            </span>
                        )}
                        {offer.savings_percentage !== null && offer.savings_percentage > 0 && (
                            <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-caption font-semibold text-destructive">
                                −{Math.round(offer.savings_percentage)}%
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        );
    },
);

/** What the pantry says to use up next — read only, the /pantry page is where it changes. */
const PantryBody: React.FC<{ items: PantryItem[]; loading: boolean }> = memo(({ items, loading }) => {
    const { t } = useTranslation(['dashboard.custom', 'pantry.custom']);
    if (loading) return <Empty>{t('dashboard.custom:phases.loading')}</Empty>;
    const rows = items.slice(0, CAP.pantry);
    if (rows.length === 0) return <Empty>{t('pantry.custom:dashboard.empty')}</Empty>;
    return (
        <ul className="space-y-1">
            {rows.map((item) => {
                const days = item.expires_on ? daysUntil(item.expires_on) : 0;
                return (
                    <li key={item.id} className="flex min-h-[52px] items-center gap-3 text-base">
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className={`shrink-0 text-caption ${days < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {days < 0
                                ? t('pantry.custom:list.expired')
                                : days === 0
                                  ? t('pantry.custom:list.expiresToday')
                                  : t('pantry.custom:list.expiresIn', { days })}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
});

// ── Morning ──────────────────────────────────────────────────────────────────

/**
 * "Diarra leaves in 12 min" — the one departure that matters right now. A parent
 * leaves before noon, a child is dropped off before noon: planning entries give
 * the habitual times, appointments the one-offs.
 */
const NextDeparture: React.FC<{ appointments: Appointment[]; now: Date }> = memo(({ appointments, now }) => {
    const { t } = useTranslation('dashboard.custom');
    const next = useMemo(() => {
        const byMember = new Map<string, { name: string; color: string; time: string }>();
        const consider = (name: string, color: string, start: string) => {
            const time = hhmmOf(start);
            if (!time || time >= '12:00') return;
            const current = byMember.get(name);
            if (!current || time < current.time) byMember.set(name, { name, color, time });
        };
        for (const appointment of appointments) {
            const members = appointment.family_members_data ?? [];
            if (members.length === 0) {
                consider(appointment.title, 'var(--color-muted-foreground)', appointment.start_time);
                continue;
            }
            for (const member of members) consider(member.name, member.color, appointment.start_time);
        }
        return [...byMember.values()].sort((a, b) => a.time.localeCompare(b.time))[0] ?? null;
    }, [appointments]);

    if (!next) return null;
    return (
        <div className="flex min-h-[56px] shrink-0 items-center gap-3 rounded-2xl bg-primary/10 px-4 text-primary">
            <UtensilsCrossed className="h-5 w-5 shrink-0" />
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: next.color }} />
            <span className="min-w-0 flex-1 truncate text-base font-semibold">{next.name}</span>
            <span className="shrink-0 font-mono text-lg">{next.time}</span>
            <span className="min-w-[72px] shrink-0 text-right text-sm">
                {formatCountdown(minutesUntil(now, next.time)) ?? t('widgets.gone')}
            </span>
        </div>
    );
});

/** What each child should wear, when the AI wrote something. One line per child. */
const ClothingStrip: React.FC<{ result: WidgetResult<DashboardWeatherDTO | null> }> = memo(({ result }) => {
    const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
    const data = result.data;
    if (!data || data.suggestions.length === 0) return null;
    return (
        <div className="flex shrink-0 items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-orange-100 to-yellow-100 px-4 py-2 text-slate-900">
            {React.createElement(CONDITION_ICON[weatherCondition(data.weather.weatherCode)], {
                className: 'h-8 w-8 shrink-0 text-orange-500',
            })}
            <div className="flex min-w-0 flex-1 gap-3">
                {data.suggestions.slice(0, 3).map((suggestion) => {
                    const kid = data.kids.find((k) => k.id === suggestion.kidId);
                    return (
                        <div key={suggestion.kidId} className="min-w-0 flex-1">
                            <p className="truncate text-caption font-semibold" style={{ color: kid?.color }}>
                                {kid?.name ?? ''}
                            </p>
                            <p className="truncate text-sm">
                                {[...suggestion.top, ...suggestion.bottom, suggestion.advice].filter(Boolean).join(', ')
                                    || t('dashboard.custom:widgets.checkWeather')}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

const MorningPhase: React.FC<PhaseProps> = memo(({ ha, now, today, reloadKey, weatherEnabled }) => {
    const { t } = useTranslation(['dashboard.custom', 'activities.custom']);
    const { isModuleEnabled } = useAuth();
    const clothing = useDashboardWeather(null, weatherEnabled);
    const tasks = useApi<Task[]>('/api/tasks', reloadKey);
    const appointments = useApi<Appointment[]>(dayAppointments(today), reloadKey);
    const [hidden, setHidden] = useState<Record<string, true>>({});
    const undo = useUndoQueue();
    const completeTask = useTapToComplete(undo, setHidden, '/api/tasks', 'is_completed');

    const activities = useActivitiesWidget();
    const activityData = homeDayIdeas(activities.data);

    const timeline = useMemo(
        () => [...(appointments.data ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, CAP.agenda),
        [appointments.data],
    );

    const openTasks = useMemo(() => taskRows(tasks, hidden, today), [tasks, today, hidden]);

    const coffee = useMemo(
        () => findByName([...(ha.byDomain.switch ?? []), ...(ha.byDomain.input_boolean ?? [])], ['café', 'cafe', 'coffee']),
        [ha.byDomain],
    );

    return (
        <PhaseBody>
            <NextDeparture appointments={appointments.data ?? []} now={now} />
            <ClothingStrip result={clothing} />

            <Band weight="flex-[6]">
                <Panel
                    title={t('dashboard.custom:widgets.agenda')}
                    icon={<Calendar className="h-5 w-5" />}
                    action={{ label: t('dashboard.custom:widgets.viewAll'), to: '/calendar' }}
                    className="flex-1"
                >
                    <AgendaList
                        appointments={timeline}
                        loading={appointments.loading}
                        empty={t('dashboard.custom:widgets.noAgenda')}
                        loadingLabel={t('dashboard.custom:phases.loading')}
                    />
                </Panel>

                {isModuleEnabled('activities') && activityData && (
                    <Panel title={t('activities.custom:titleToday')} icon={<MonitorOff className="h-5 w-5" />} className="flex-1">
                        <ActivitiesBody data={activityData} />
                    </Panel>
                )}
            </Band>

            <Band weight="flex-[4]">
                <Panel title={t('dashboard.custom:widgets.tasks')} icon={<Check className="h-5 w-5" />} className="flex-1">
                    <TappableList
                        rows={openTasks}
                        shape="round"
                        loadingLabel={tasks.loading ? t('dashboard.custom:phases.loading') : undefined}
                        empty={t('dashboard.custom:widgets.noTasks')}
                        onTap={completeTask}
                    />
                </Panel>

                {coffee && (
                    <Panel title={coffee.friendly_name} icon={<Coffee className="h-5 w-5" />} className="flex-1">
                        <button
                            type="button"
                            disabled={ha.failure !== null}
                            onClick={() =>
                                void ha
                                    .callService(coffee.domain, isOn(coffee) ? 'turn_off' : 'turn_on', { entity_id: coffee.entity_id })
                                    .catch(() => undefined)
                            }
                            className={`flex min-h-[104px] w-full items-center justify-center gap-3 rounded-xl text-lg font-semibold transition-colors active:scale-95 disabled:opacity-50 ${
                                isOn(coffee) ? 'bg-amber-600 text-white' : 'border border-border text-foreground'
                            }`}
                        >
                            <Coffee className="h-7 w-7" />
                            {isOn(coffee) ? 'ON' : 'OFF'}
                        </button>
                    </Panel>
                )}
            </Band>

            <UndoToast queue={undo} label={t('dashboard.custom:widgets.saved')} />
        </PhaseBody>
    );
});

// ── Day ──────────────────────────────────────────────────────────────────────

const DayPhase: React.FC<PhaseProps> = memo(({ today, reloadKey }) => {
    const { t } = useTranslation(['dashboard.custom', 'kiosk', 'meals', 'activities.custom', 'scan.custom', 'pantry.custom']);
    const { isModuleEnabled, user } = useAuth();
    const appointments = useApi<Appointment[]>(dayAppointments(today), reloadKey);
    const meals = useApi<MealPlan[]>(`/api/meal-plans?start_date=${today}&end_date=${today}`, reloadKey);
    const tasks = useApi<Task[]>('/api/tasks', reloadKey);
    const shopping = useApi<ShoppingItem[]>('/api/shopping', reloadKey);
    const pantry = useApi<{ items: PantryItem[] }>(
        isModuleEnabled('pantry') ? `/api/pantry?filter=expiring&days=14` : null,
        reloadKey,
    );
    const promos = useApi<PromoPage>(
        isModuleEnabled('productScan') ? '/api/products/promos?page_size=4&sort=savings' : null,
        reloadKey,
    );
    const activities = useActivitiesWidget();
    const activityData = homeDayIdeas(activities.data);

    // One hidden set and one undo queue for both lists: a task and a shopping item
    // tapped in the same breath share the single undo toast at the bottom.
    const [hidden, setHidden] = useState<Record<string, true>>({});
    const undo = useUndoQueue();
    const completeTask = useTapToComplete(undo, setHidden, '/api/tasks', 'is_completed');
    const checkItem = useTapToComplete(undo, setHidden, '/api/shopping', 'is_checked');

    const currency = user?.currency || 'EUR';

    const timeline = useMemo(
        () => [...(appointments.data ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, CAP.agenda),
        [appointments.data],
    );

    const todayMeals = useMemo(
        () =>
            [...(meals.data ?? [])]
                .sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type))
                .slice(0, CAP.meals),
        [meals.data],
    );

    const openTasks = useMemo(() => taskRows(tasks, hidden), [tasks, hidden]);

    const openItems = useMemo(
        () =>
            (shopping.data ?? [])
                .filter((item) => !item.is_checked && !hidden[item.id])
                .slice(0, CAP.shopping)
                .map((item) => ({
                    id: item.id,
                    label: item.name,
                    meta: item.quantity ? (
                        <span className="shrink-0 text-caption text-muted-foreground">
                            {item.quantity}
                            {item.unit ? ` ${item.unit}` : ''}
                        </span>
                    ) : null,
                })),
        [shopping.data, hidden],
    );

    const label = useCallback((value: string) => t(`meals:mealTypes.${value}`, { defaultValue: value }), [t]);

    return (
        <PhaseBody>
            <Panel title={t('kiosk:meals')} icon={<UtensilsCrossed className="h-5 w-5" />} className="shrink-0">
                <MealsStrip meals={todayMeals} loading={meals.loading} label={label} />
            </Panel>

            <Band weight="flex-[6]">
                <Panel
                    title={t('dashboard.custom:widgets.agenda')}
                    icon={<Calendar className="h-5 w-5" />}
                    action={{ label: t('dashboard.custom:widgets.viewAll'), to: '/calendar' }}
                    className="flex-1"
                >
                    <AgendaList
                        appointments={timeline}
                        loading={appointments.loading}
                        empty={t('dashboard.custom:widgets.noAgenda')}
                        loadingLabel={t('dashboard.custom:phases.loading')}
                    />
                </Panel>

                {isModuleEnabled('activities') && activityData && (
                    <Panel title={t('activities.custom:titleToday')} icon={<MonitorOff className="h-5 w-5" />} className="flex-1">
                        <ActivitiesBody data={activityData} />
                    </Panel>
                )}
            </Band>

            <Band weight="flex-[5]">
                {isModuleEnabled('productScan') && (
                    <Panel
                        title={t('scan.custom:dailyPromos.tab')}
                        icon={<Tag className="h-5 w-5" />}
                        action={{ label: t('dashboard.custom:widgets.viewAll'), to: '/product-scanner' }}
                        className="flex-1"
                    >
                        <PromosBody page={promos.data} loading={promos.loading} currency={currency} />
                    </Panel>
                )}

                {isModuleEnabled('pantry') && (
                    <Panel
                        title={t('pantry.custom:dashboard.title')}
                        icon={<Package className="h-5 w-5" />}
                        action={{ label: t('dashboard.custom:widgets.viewAll'), to: '/pantry' }}
                        className="flex-1"
                    >
                        <PantryBody items={pantry.data?.items ?? []} loading={pantry.loading} />
                    </Panel>
                )}
            </Band>

            <Band weight="flex-[4]">
                <Panel title={t('kiosk:tasks')} icon={<Check className="h-5 w-5" />} className="flex-1">
                    <TappableList
                        rows={openTasks}
                        shape="round"
                        loadingLabel={tasks.loading ? t('dashboard.custom:phases.loading') : undefined}
                        empty={t('dashboard.custom:widgets.noTasks')}
                        onTap={completeTask}
                    />
                </Panel>

                <Panel
                    title={t('dashboard.custom:widgets.shopping_preview')}
                    icon={<ShoppingCart className="h-5 w-5" />}
                    action={{ label: t('dashboard.custom:widgets.viewAll'), to: '/shopping' }}
                    className="flex-1"
                >
                    <TappableList
                        rows={openItems}
                        shape="square"
                        loadingLabel={shopping.loading ? t('dashboard.custom:phases.loading') : undefined}
                        empty={t('dashboard.custom:widgets.emptyShopping')}
                        onTap={checkItem}
                    />
                </Panel>
            </Band>

            <UndoToast queue={undo} label={t('dashboard.custom:widgets.saved')} />
        </PhaseBody>
    );
});

// ── Evening ──────────────────────────────────────────────────────────────────

const EveningPhase: React.FC<PhaseProps & { tomorrow: DailyForecastDTO | null }> = memo(
    ({ ha, today, reloadKey, weatherEnabled, tomorrow }) => {
        const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
        const meals = useApi<MealPlan[]>(`/api/meal-plans?start_date=${today}&end_date=${today}`, reloadKey);
        const planning = useApi<PlanningEntry[]>(
            `/api/planning?week_start=${ymd(weekStartOf(new Date(`${today}T12:00:00`)))}`,
            reloadKey,
        );

        const dinner = useMemo(() => {
            const plans = meals.data ?? [];
            const named = plans.find((plan) => /dîner|diner|dinner/i.test(plan.meal_type));
            if (named) return named;
            return plans.reduce<MealPlan | null>((best, plan) => {
                const index = MEAL_ORDER.indexOf(plan.meal_type);
                const bestIndex = best ? MEAL_ORDER.indexOf(best.meal_type) : -1;
                return index > bestIndex ? plan : best;
            }, null);
        }, [meals.data]);

        const todayEntries = useMemo(() => {
            const day = isoDay(new Date(`${today}T12:00:00`));
            return (planning.data ?? []).filter(
                (entry) => entry.day_of_week === day || entry.specific_date === today,
            );
        }, [planning.data, today]);

        const bedtimes = useMemo(() => {
            const bedtime = todayEntries.filter((entry) => /coucher|bedtime|dormir/i.test(entry.schedule_type));
            const entries = bedtime.length > 0 ? bedtime : todayEntries.slice(0, 3);
            return entries.slice(0, 4).map((entry) => ({
                name: entry.family_member_name,
                color: entry.family_member_color,
                // No planning entry: fall back to the household's usual 20:30, so
                // the card still answers the question instead of disappearing.
                time: bedtime.length > 0 ? hhmmOf(entry.start_time) : '20:30',
            }));
        }, [todayEntries]);

        const dinnerScene = useMemo(
            () => findByName(ha.byDomain.scene ?? [], ['dîner', 'diner', 'dinner']),
            [ha.byDomain],
        );
        const lights = ha.byDomain.light ?? [];
        const onLights = lights.filter(isOn);
        const haDown = ha.failure !== null;

        const dimAll = useCallback(
            (pct: number) => {
                if (lights.length === 0) return;
                void ha
                    .callService('light', 'turn_on', {
                        entity_id: lights.map((light) => light.entity_id),
                        brightness_pct: pct,
                    })
                    .catch(() => undefined);
            },
            [ha, lights],
        );

        const tomorrowCondition = tomorrow ? weatherCondition(tomorrow.weatherCode) : null;

        return (
            <PhaseBody>
                <section className="shrink-0 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 p-4 text-slate-900">
                    <div className="flex items-center gap-4">
                        <UtensilsCrossed className="h-10 w-10 shrink-0 text-amber-600" />
                        <div className="min-w-0 flex-1">
                            <p className="text-caption font-semibold uppercase tracking-wide">{t('dashboard.custom:widgets.dinner')}</p>
                            <p className="mt-1 line-clamp-2 text-2xl font-bold">
                                {dinner?.custom_meal || dinner?.recipe?.name || t('dashboard.custom:widgets.noDinner')}
                            </p>
                        </div>
                        {dinner?.recipe && (
                            <Link
                                to="/recipes"
                                className="flex min-h-[56px] shrink-0 items-center rounded-xl bg-white/70 px-4 text-base font-semibold text-slate-900"
                            >
                                {t('dashboard.custom:widgets.viewRecipe')}
                            </Link>
                        )}
                    </div>
                </section>

                {dinnerScene && (
                    <button
                        type="button"
                        disabled={haDown}
                        onClick={() =>
                            void ha.callService('scene', 'turn_on', { entity_id: dinnerScene.entity_id }).catch(() => undefined)
                        }
                        className="flex min-h-[72px] w-full shrink-0 items-center justify-center gap-3 rounded-2xl bg-amber-500 text-xl font-bold text-white transition-colors active:scale-95 disabled:opacity-50"
                    >
                        <Sparkles className="h-7 w-7" />
                        {t('widgets.dinner_scene')}
                    </button>
                )}

                <Panel title={t('dashboard.custom:widgets.lights')} icon={<Lamp className="h-5 w-5" />} className="shrink-0">
                    <div className="grid grid-cols-5 gap-2">
                        {[25, 50, 75, 100].map((pct) => (
                            <button
                                key={pct}
                                type="button"
                                disabled={haDown || lights.length === 0}
                                onClick={() => dimAll(pct)}
                                className="min-h-[56px] rounded-xl border border-border text-lg font-semibold text-foreground transition-colors active:scale-95 disabled:opacity-50"
                            >
                                {pct}%
                            </button>
                        ))}
                        <button
                            type="button"
                            disabled={haDown || lights.length === 0}
                            onClick={() =>
                                void ha
                                    .callService('light', 'turn_off', { entity_id: lights.map((light) => light.entity_id) })
                                    .catch(() => undefined)
                            }
                            className="min-h-[56px] rounded-xl border border-border text-lg font-semibold text-foreground transition-colors active:scale-95 disabled:opacity-50"
                            aria-label={t('dashboard.custom:actions.all_lights_off')}
                        >
                            <PowerOff className="mx-auto h-5 w-5" />
                        </button>
                    </div>
                    {!haDown && lights.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                            {onLights.length}/{lights.length} {t('dashboard.custom:widgets.lightsOn')}
                        </p>
                    )}
                </Panel>

                <Panel title={t('dashboard.custom:widgets.bedtime')} icon={<Moon className="h-5 w-5" />} className="flex-1">
                    {bedtimes.length === 0 ? (
                        <Empty>{t('dashboard.custom:widgets.noBedtime')}</Empty>
                    ) : (
                        <ul className="space-y-1">
                            {bedtimes.map((bedtime, index) => (
                                <li key={`${bedtime.name}-${index}`} className="flex min-h-[52px] items-center gap-3">
                                    <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: bedtime.color }} />
                                    <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">{bedtime.name}</span>
                                    <span className="shrink-0 font-mono text-lg text-foreground">{bedtime.time}</span>
                                    <span className="min-w-[72px] shrink-0 text-right text-sm text-muted-foreground">
                                        {formatCountdown(minutesUntil(new Date(), bedtime.time)) ?? t('dashboard.custom:widgets.gone')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>

                {weatherEnabled && tomorrowCondition && tomorrow && (
                    <Panel title={t('dashboard.custom:widgets.tomorrow')} icon={<Sun className="h-5 w-5" />} className="shrink-0">
                        <div className="flex items-center gap-3">
                            {React.createElement(CONDITION_ICON[tomorrowCondition], { className: 'h-8 w-8 text-primary' })}
                            <p className="text-lg font-semibold text-foreground">
                                {Math.round(tomorrow.tempMin)}° / {Math.round(tomorrow.tempMax)}°
                            </p>
                            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                                {t(`weather.custom:conditions.${tomorrowCondition}` as never)}
                            </p>
                        </div>
                    </Panel>
                )}
            </PhaseBody>
        );
    },
);

// ── Night ────────────────────────────────────────────────────────────────────

const NightPhase: React.FC<PhaseProps & { tomorrow: string; dimmed: boolean }> = memo(
    ({ ha, now, tomorrow, dimmed }) => {
        const { t } = useTranslation('dashboard.custom');
        const dateLabel = useDateLabel();
        const appointments = useApi<Appointment[]>(dayAppointments(tomorrow), 0);
        const nightlight = useMemo(
            () => findByName(ha.byDomain.light ?? [], ['nuit', 'nightlight', 'veilleuse']),
            [ha.byDomain],
        );
        const first = useMemo(() => {
            const list = [...(appointments.data ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
            return list[0] ?? null;
        }, [appointments.data]);

        return (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 bg-black px-6">
                <div className={`flex flex-col items-center transition-opacity duration-1000 ${dimmed ? 'opacity-30' : 'opacity-100'}`}>
                    <p className="text-8xl font-light tabular-nums text-white/80">
                        {pad2(now.getHours())}:{pad2(now.getMinutes())}
                    </p>
                    <p className="mt-2 text-xl capitalize text-white/50">{dateLabel(now)}</p>
                </div>

                {!dimmed && first && (
                    <p className="text-center text-lg text-white/40">
                        {t('night.firstAppointment', { time: hhmmOf(first.start_time), title: first.title })}
                    </p>
                )}
                {!dimmed && !first && (
                    <p className="text-center text-lg text-white/40">{t('night.noAppointment')}</p>
                )}

                {!dimmed && nightlight && (
                    <button
                        type="button"
                        disabled={ha.failure !== null}
                        onClick={() =>
                            void ha
                                .callService('light', isOn(nightlight) ? 'turn_off' : 'turn_on', {
                                    entity_id: nightlight.entity_id,
                                })
                                .catch(() => undefined)
                        }
                        className={`flex h-32 w-32 items-center justify-center rounded-full transition-colors active:scale-95 disabled:opacity-40 ${
                            isOn(nightlight) ? 'bg-amber-500 text-slate-900' : 'bg-white/10 text-white/70'
                        }`}
                        aria-label={t('widgets.nightlight')}
                    >
                        <Moon className="h-12 w-12" />
                    </button>
                )}
            </div>
        );
    },
);

// ── Page ─────────────────────────────────────────────────────────────────────

/**
 * The kids' ideas, for the phases that show them. A home day is the only day the
 * server has ideas for, and no saved city means no request at all — the panel says
 * so instead of asking for a city a second time. The ideas are the day's, cached
 * per language and location by the hook, so Refresh does not re-ask the model.
 */
function useActivitiesWidget(): WidgetResult<KidsActivitiesDTO | null> {
    const { user, isModuleEnabled } = useAuth();
    const location = useSavedLocation();
    const enabled = isModuleEnabled('activities') && !!user && location.data?.latitude != null;
    return useKidsActivities(null, [], enabled);
}

/**
 * The ideas a phase may show, or null: only a home day has any, and only once the
 * payload is there (the dashboard card's own contract — never an empty "what shall
 * we do today?" panel on the wall).
 */
function homeDayIdeas(data: KidsActivitiesDTO | null): KidsActivitiesDTO | null {
    if (!data || data.dayContext.mode !== 'home' || data.activities.length === 0) return null;
    return data;
}

/**
 * The open tasks a phase shows, capped and shaped like the shopping list's rows.
 * `today` is the morning's extra filter: a task with a due date other than today
 * is not something to wave at someone on their way out.
 */
function taskRows(tasks: ApiResult<Task[]>, hidden: Record<string, true>, today?: string): TapRow[] {
    const weight: Record<string, number> = { haute: 0, high: 0, moyenne: 1, medium: 1, basse: 2, low: 2 };
    return (tasks.data ?? [])
        .filter(
            (task) =>
                !task.is_completed &&
                !hidden[task.id] &&
                (!today || !task.due_date || task.due_date.slice(0, 10) === today),
        )
        .sort((a, b) => (weight[a.priority ?? ''] ?? 1) - (weight[b.priority ?? ''] ?? 1))
        .slice(0, CAP.tasks)
        .map((task) => ({ id: task.id, label: task.title, meta: <MemberDots members={task.assigned_to_members} /> }));
}

const FamilyDashboard: React.FC = () => {
    const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
    const { isModuleEnabled } = useAuth();
    const [now, setNow] = useState(() => new Date());
    const [override, setOverride] = useState<PhaseOverride | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [houseOpen, setHouseOpen] = useState(false);
    const [dimmed, setDimmed] = useState(false);
    const lastTouch = useRef(Date.now());

    const weatherEnabled = isModuleEnabled('weather');
    const ha = useHomeAssistant();
    const phase = resolvePhase(now, override);

    const today = ymd(now);
    const tomorrow = ymd(addDays(now, 1));

    // One forecast for the top bar and the evening preview; the hook's module
    // cache means asking for two days costs the same request as one.
    const week = useWeeklyForecast(null, weatherEnabled, 2);
    const todayForecast = week.data?.days?.[0] ?? null;
    const tomorrowForecast = week.data?.days?.[1] ?? null;

    // ── Device-level effects ────────────────────────────────────────────────

    // No double-tap zoom on a wall tablet: the dashboard is the only thing on
    // screen, and pinch-zoom landing mid-layout is worse than no zoom at all.
    useEffect(() => {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        document.head.appendChild(meta);
        return () => meta.remove();
    }, []);

    // Keep the screen on while the dashboard is the visible page. The release in
    // the cleanup is what makes this safe on navigation away.
    useEffect(() => {
        interface WakeLockSentinelLike { release: () => Promise<void> }
        interface WakeLockNavigator { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

        const navigatorWithWakeLock = navigator as Navigator & WakeLockNavigator;
        let lock: WakeLockSentinelLike | null = null;
        let disposed = false;

        const acquire = async () => {
            try {
                const next = await navigatorWithWakeLock.wakeLock?.request('screen');
                if (!next) return;
                // A lock the browser released on its own (tab hidden) must not be
                // released again in the cleanup.
                lock = disposed ? null : next;
                if (disposed) void next.release().catch(() => undefined);
            } catch {
                /* unsupported or denied — the tablet's own keep-awake setting covers it */
            }
        };

        void acquire();
        const onVisible = () => {
            if (document.visibilityState === 'visible') void acquire();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisible);
            void lock?.release().catch(() => undefined);
        };
    }, []);

    // The clock and every countdown are minute-precision, so the tick only
    // commits a new Date when the minute actually changes.
    useEffect(() => {
        const timer = window.setInterval(() => {
            const next = new Date();
            setNow((prev) =>
                prev.getMinutes() === next.getMinutes() &&
                prev.getHours() === next.getHours() &&
                prev.getDate() === next.getDate()
                    ? prev
                    : next,
            );
        }, 5000);
        return () => window.clearInterval(timer);
    }, []);

    // Night only: a tablet left on the kitchen counter should go quiet, not
    // black — 30 % of a dim clock is still an orientation cue.
    useEffect(() => {
        if (phase !== 'night') {
            setDimmed(false);
            return;
        }
        const timer = window.setInterval(
            () => setDimmed(Date.now() - lastTouch.current > 5 * 60_000),
            10_000,
        );
        return () => window.clearInterval(timer);
    }, [phase]);

    // ── Interaction ─────────────────────────────────────────────────────────

    const touchStart = useRef<{ x: number; y: number } | null>(null);

    const cycle = useCallback(
        (delta: number) => {
            setOverride({ phase: shiftPhase(phase, delta), until: overrideExpiry(new Date()) });
        },
        [phase],
    );

    const onTouchStart = useCallback((event: React.TouchEvent) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
        lastTouch.current = Date.now();
        setDimmed(false);
    }, []);

    const onTouchEnd = useCallback(
        (event: React.TouchEvent) => {
            const start = touchStart.current;
            touchStart.current = null;
            if (!start) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            // Horizontal and deliberate: 60 px of travel, and more across than
            // down so a vertical gesture is never mistaken for a phase change.
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
            cycle(dx < 0 ? 1 : -1);
        },
        [cycle],
    );

    const refresh = useCallback(async () => {
        setRefreshing(true);
        setReloadKey((key) => key + 1);
        await ha.refresh();
        window.setTimeout(() => setRefreshing(false), 600);
    }, [ha]);

    const allOff = useCallback(async () => {
        for (const domain of ['light', 'switch']) {
            const ids = (ha.byDomain[domain] ?? []).filter(isOn).map((device) => device.entity_id);
            if (ids.length > 0) {
                await ha.callService(domain, 'turn_off', { entity_id: ids }).catch(() => undefined);
            }
        }
    }, [ha]);

    const devices = useMemo(
        () =>
            ha.devices
                .filter((device) => TOGGLEABLE_DOMAINS[device.domain])
                .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name)),
        [ha.devices],
    );
    const scenes = ha.byDomain.scene ?? [];
    const security = useMemo(() => {
        const classes = ['door', 'window', 'garage_door', 'motion', 'smoke', 'lock'];
        return [
            ...(ha.byDomain.binary_sensor ?? []).filter((device) =>
                classes.includes(String(device.attributes.device_class ?? '')),
            ),
            ...(ha.byDomain.lock ?? []),
        ];
    }, [ha.byDomain]);
    const haDown = ha.failure !== null;

    const toggle = useCallback(
        (device: HaDevice) => {
            void ha
                .callService(device.domain, isOn(device) ? 'turn_off' : 'turn_on', { entity_id: device.entity_id })
                .catch(() => undefined);
        },
        [ha],
    );

    const phaseProps: PhaseProps = { ha, now, today, reloadKey, weatherEnabled };

    return (
        <div
            className="fixed inset-0 z-[60] flex flex-col bg-background"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
        >
            <TopBar
                now={now}
                phase={phase}
                forecast={todayForecast}
                weatherEnabled={weatherEnabled}
                onCycle={() => cycle(1)}
            />

            {ha.failure === 'offline' && (
                <div className="flex shrink-0 items-center gap-3 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    <WifiOff className="h-5 w-5" />
                    <span className="flex-1">{t('errors.ha_unreachable')}</span>
                    <button
                        type="button"
                        onClick={() => void ha.refresh()}
                        className="min-h-[56px] rounded-lg bg-destructive/20 px-4 font-semibold"
                    >
                        {t('errors.retry')}
                    </button>
                </div>
            )}

            {ha.failure === 'missing' ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                    <AlertTriangle className="h-12 w-12 text-amber-500" />
                    <p className="text-lg text-foreground">{t('errors.ha_not_found')}</p>
                    <Link
                        to="/integrations"
                        className="flex min-h-[56px] items-center rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground"
                    >
                        {t('actions.go_to_integrations')}
                    </Link>
                </div>
            ) : (
                <main className="relative min-h-0 flex-1">
                    {phase === 'morning' && <MorningPhase {...phaseProps} />}
                    {phase === 'day' && <DayPhase {...phaseProps} />}
                    {phase === 'evening' && <EveningPhase {...phaseProps} tomorrow={tomorrowForecast} />}
                    {phase === 'night' && <NightPhase {...phaseProps} tomorrow={tomorrow} dimmed={dimmed} />}
                </main>
            )}

            {/* House: everything Home Assistant needs more than a row of screen
                space for. The sheet scrolls, the kiosk behind it does not. */}
            {houseOpen && (
                <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={() => setHouseOpen(false)}>
                    <div
                        className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-card p-4"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {ha.failure === null && devices.length > 0 && (
                            <>
                                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                                    <Power className="h-5 w-5 text-primary" />
                                    {t('widgets.devices')}
                                </h2>
                                <div className="grid grid-cols-3 gap-3">
                                    {devices.map((device) => (
                                        <ToggleTile
                                            key={device.entity_id}
                                            device={device}
                                            busy={Boolean(ha.busy[device.entity_id])}
                                            disabled={haDown}
                                            onToggle={toggle}
                                        />
                                    ))}
                                </div>
                            </>
                        )}

                        {ha.failure === null && security.length > 0 && (
                            <>
                                <h2 className="mb-3 mt-6 flex items-center gap-2 text-lg font-semibold text-foreground">
                                    <Lock className="h-5 w-5 text-primary" />
                                    {t('widgets.security')}
                                </h2>
                                <div className="flex flex-wrap gap-2">
                                    {security.map((device) => {
                                        // A lock reads `locked`/`unlocked`, not
                                        // `on`/`off`, so the generic isOn() check
                                        // would keep every lock green while the door
                                        // stands open.
                                        const alert =
                                            device.domain === 'lock'
                                                ? device.state === 'unlocked'
                                                : isOn(device);
                                        return (
                                            <span
                                                key={device.entity_id}
                                                className="flex items-center gap-2 rounded-full border border-border px-4 py-2"
                                            >
                                                <span className={`h-3 w-3 rounded-full ${alert ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                                <span className="text-sm font-medium text-foreground">{device.friendly_name}</span>
                                            </span>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {ha.failure === null && scenes.length > 0 && (
                            <>
                                <h2 className="mb-3 mt-6 flex items-center gap-2 text-lg font-semibold text-foreground">
                                    <Sparkles className="h-5 w-5 text-primary" />
                                    {t('actions.scenes')}
                                </h2>
                                <div className="grid grid-cols-2 gap-3">
                                    {scenes.map((scene) => (
                                        <button
                                            key={scene.entity_id}
                                            type="button"
                                            disabled={haDown}
                                            onClick={() => {
                                                setHouseOpen(false);
                                                void ha
                                                    .callService('scene', 'turn_on', { entity_id: scene.entity_id })
                                                    .catch(() => undefined);
                                            }}
                                            className="min-h-[72px] rounded-xl border border-border px-3 text-base font-semibold text-foreground active:scale-95 disabled:opacity-50"
                                        >
                                            {scene.friendly_name}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {ha.failure !== null && (
                            <p className="py-6 text-center text-base text-muted-foreground">{t('errors.devicesUnavailable')}</p>
                        )}
                    </div>
                </div>
            )}

            <BottomBar
                onRefresh={() => void refresh()}
                onAllOff={() => void allOff()}
                onHouse={() => setHouseOpen(true)}
                refreshing={refreshing}
                dimmed={phase === 'night' && dimmed}
                haDown={haDown}
            />
        </div>
    );
};

export default FamilyDashboard;
