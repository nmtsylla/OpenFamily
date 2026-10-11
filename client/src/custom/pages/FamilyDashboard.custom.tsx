import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle, Blinds, Check, Coffee, DoorOpen, Home, Lamp, Lock,
    Moon, Power, PowerOff, RefreshCw, ShoppingCart, Sparkles, Sun, Thermometer,
    Tv, Undo2, UtensilsCrossed, Wind, WifiOff,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { CONDITION_ICON, weatherCondition } from '../lib/weatherCode.custom';
import { useDashboardWeather, useWeeklyForecast, type DailyForecastDTO } from '../hooks/useWeather.custom';
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
//   - everything is one vertical column, nothing scrolls sideways;
//   - every tappable element is at least 56 px in both directions;
//   - motion is limited to transitions and `active:scale`, no filters, no blur
//     except the two bars, and all tiles are memoised so a 5 s clock tick does
//     not repaint the device list.
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
function useApi<T>(url: string | null, reloadKey: number): { data: T | null; loading: boolean } {
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
interface ShoppingItem { id: string; name: string; is_checked: boolean }

const MEAL_ORDER = ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Snack'];

// ── Shared building blocks ───────────────────────────────────────────────────

const Card: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ className = '', children }) => (
    <section className={`rounded-2xl bg-card p-4 shadow-surface ${className}`}>{children}</section>
);

const CardTitle: React.FC<React.PropsWithChildren<{ icon?: React.ReactNode }>> = ({ icon, children }) => (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
        {icon}
        {children}
    </h2>
);

const MemberDots: React.FC<{ members?: Member[] }> = memo(({ members }) => {
    if (!members || members.length === 0) return null;
    return (
        <span className="flex items-center gap-1">
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
        <header className="flex h-20 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                {weatherEnabled && ConditionIcon && forecast ? (
                    <>
                        <ConditionIcon className="h-9 w-9 shrink-0 text-primary" />
                        <div className="min-w-0">
                            <p className="text-xl font-semibold leading-tight text-foreground">
                                {Math.round(forecast.tempMax)}°
                                <span className="ml-1 text-base text-muted-foreground">{Math.round(forecast.tempMin)}°</span>
                            </p>
                            <p className="truncate text-sm text-muted-foreground">
                                {t(`weather.custom:${condition}` as never)}
                            </p>
                        </div>
                    </>
                ) : (
                    <span className="text-sm text-muted-foreground">{t('dashboard.custom:widgets.noWeather')}</span>
                )}
            </div>

            <p className="shrink-0 text-3xl font-bold tabular-nums text-foreground">
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
    onScenes: () => void;
    refreshing: boolean;
    dimmed: boolean;
    haDown: boolean;
    sceneCount: number;
}

const BottomBar: React.FC<BottomBarProps> = memo(({ onRefresh, onAllOff, onScenes, refreshing, dimmed, haDown, sceneCount }) => {
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
                icon={<Sparkles className="h-5 w-5" />}
                label={t('actions.scenes')}
                onClick={onScenes}
                disabled={haDown || sceneCount === 0}
            />
            <Link
                to="/"
                className="flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-foreground transition-colors active:scale-95"
            >
                <Home className="h-5 w-5" />
                <span className="text-sm">{t("actions.home")}</span>
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
// works. The lock is shown in the Security card instead; a cover has no place in
// a v1 quick-toggle grid.
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
            className={`flex aspect-square min-h-[112px] flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-colors active:scale-95 disabled:opacity-50 ${
                on ? 'border-primary bg-primary/10' : 'border-border bg-card'
            }`}
        >
            <Icon className={`h-8 w-8 ${on ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="line-clamp-2 text-sm font-medium text-foreground">{device.friendly_name}</span>
            <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
            >
                {on ? 'ON' : 'OFF'}
            </span>
        </button>
    );
});

// ── Morning ──────────────────────────────────────────────────────────────────

interface PhaseProps {
    ha: HaDeviceState;
    now: Date;
    today: string;
    reloadKey: number;
    weatherEnabled: boolean;
}

const MorningPhase: React.FC<PhaseProps> = memo(({ ha, now, today, reloadKey, weatherEnabled }) => {
    const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
    const clothing = useDashboardWeather(null, weatherEnabled);
    const tasks = useApi<Task[]>('/api/tasks', reloadKey);
    const appointments = useApi<Appointment[]>(
        `/api/appointments?start_date=${today}&end_date=${today}`,
        reloadKey,
    );
    const [completed, setCompleted] = useState<Record<string, boolean>>({});
    const [doneTasks, setDoneTasks] = useState<Array<{ id: string; title: string }>>([]);

    // Departures: a parent leaves before noon, a child is dropped off before
    // noon. Planning entries give the habitual times, appointments the one-offs.
    const departures = useMemo(() => {
        const byMember = new Map<string, { name: string; color: string; time: string }>();
        const consider = (name: string, color: string, start: string) => {
            const time = hhmmOf(start);
            if (!time || time >= '12:00') return;
            const current = byMember.get(name);
            if (!current || time < current.time) byMember.set(name, { name, color, time });
        };
        for (const appointment of appointments.data ?? []) {
            const members = appointment.family_members_data ?? [];
            if (members.length === 0) {
                consider(appointment.title, 'var(--color-muted-foreground)', appointment.start_time);
                continue;
            }
            for (const member of members) consider(member.name, member.color, appointment.start_time);
        }
        return [...byMember.values()].sort((a, b) => a.time.localeCompare(b.time));
    }, [appointments.data]);

    const openTasks = useMemo(() => {
        const weight: Record<string, number> = { haute: 0, high: 0, moyenne: 1, medium: 1, basse: 2, low: 2 };
        return (tasks.data ?? [])
            .filter(
                (task) =>
                    !task.is_completed &&
                    !completed[task.id] &&
                    (!task.due_date || task.due_date.slice(0, 10) === today),
            )
            .sort((a, b) => (weight[a.priority ?? ''] ?? 1) - (weight[b.priority ?? ''] ?? 1))
            .slice(0, 6);
    }, [tasks.data, today, completed]);

    // Same optimistic 5 s undo as Kiosk.tsx: the tap flips the row and fires the
    // PUT right away, and "Annuler" is the reverse PUT. The timeout only takes
    // the toast away.
    const completeTask = useCallback((task: Task) => {
        setCompleted((prev) => ({ ...prev, [task.id]: true }));
        setDoneTasks((prev) => [...prev.filter((entry) => entry.id !== task.id), { id: task.id, title: task.title }]);
        window.setTimeout(() => setDoneTasks((prev) => prev.filter((entry) => entry.id !== task.id)), 5_000);
        void api.put(`/api/tasks/${task.id}`, { is_completed: true }).catch(() => undefined);
    }, []);

    const undoTask = useCallback((id: string) => {
        setCompleted((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        setDoneTasks((prev) => prev.filter((entry) => entry.id !== id));
        void api.put(`/api/tasks/${id}`, { is_completed: false }).catch(() => undefined);
    }, []);

    const coffee = useMemo(
        () => findByName([...(ha.byDomain.switch ?? []), ...(ha.byDomain.input_boolean ?? [])], ['café', 'cafe', 'coffee']),
        [ha.byDomain],
    );

    const suggestions = clothing.data?.suggestions ?? [];

    return (
        <div className="space-y-4 px-4 pb-24 pt-4">
            <section className="rounded-2xl bg-gradient-to-br from-orange-100 to-yellow-100 p-6 text-slate-900">
                <div className="flex items-center gap-4">
                    {clothing.data ? (
                        <>
                            {React.createElement(CONDITION_ICON[weatherCondition(clothing.data.weather.weatherCode)], {
                                className: 'h-16 w-16 text-orange-500',
                            })}
                            <div>
                                <p className="text-5xl font-bold leading-none">
                                    {Math.round(clothing.data.weather.tempMax)}°
                                </p>
                                <p className="mt-1 text-base">
                                    {Math.round(clothing.data.weather.tempMin)}° / {Math.round(clothing.data.weather.tempMax)}°
                                </p>
                            </div>
                        </>
                    ) : (
                        <p className="text-lg font-medium">
                            {clothing.error ? t('dashboard.custom:widgets.checkWeather') : t('dashboard.custom:phases.loading')}
                        </p>
                    )}
                </div>

                {suggestions.length > 0 && (
                    <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                        {suggestions.map((suggestion) => {
                            const kid = clothing.data?.kids.find((k) => k.id === suggestion.kidId);
                            return (
                                <div key={suggestion.kidId} className="min-w-[180px] shrink-0 rounded-xl bg-white/70 p-3">
                                    <p className="text-sm font-semibold" style={{ color: kid?.color }}>
                                        {kid?.name ?? ''}
                                    </p>
                                    <p className="mt-1 line-clamp-3 text-sm">
                                        {[...suggestion.top, ...suggestion.bottom, suggestion.advice].filter(Boolean).join(', ')}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}
                {clothing.data && suggestions.length === 0 && (
                    <p className="mt-4 text-sm">{t('dashboard.custom:widgets.checkWeather')}</p>
                )}
            </section>

            <Card>
                <CardTitle icon={<UtensilsCrossed className="h-5 w-5 text-primary" />}>
                    {t('widgets.departure')}
                </CardTitle>
                {departures.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('widgets.noDeparture')}</p>
                ) : (
                    <ul className="space-y-3">
                        {departures.map((departure) => (
                            <li key={departure.name} className="flex items-center gap-3">
                                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: departure.color }} />
                                <span className="flex-1 text-base font-medium text-foreground">{departure.name}</span>
                                <span className="text-lg font-mono text-foreground">{departure.time}</span>
                                <span className="min-w-[72px] text-right text-sm text-muted-foreground">
                                    {formatCountdown(minutesUntil(now, departure.time)) ?? t('widgets.gone')}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <Card>
                <CardTitle icon={<Check className="h-5 w-5 text-primary" />}>
                    {t('widgets.tasks')}
                </CardTitle>
                {tasks.loading ? (
                    <p className="text-sm text-muted-foreground">{t('phases.loading')}</p>
                ) : openTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('widgets.noTasks')}</p>
                ) : (
                    <ul className="space-y-2">
                        {openTasks.map((task) => (
                            <li key={task.id} className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => completeTask(task)}
                                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-border transition-colors active:scale-95"
                                    aria-label={task.title}
                                >
                                    <Check className="h-5 w-5 text-primary" />
                                </button>
                                <span className="flex-1 text-base text-foreground">{task.title}</span>
                                <MemberDots members={task.assigned_to_members} />
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {coffee && (
                <button
                    type="button"
                    disabled={ha.failure !== null}
                    onClick={() =>
                        void ha
                            .callService(coffee.domain, isOn(coffee) ? 'turn_off' : 'turn_on', { entity_id: coffee.entity_id })
                            .catch(() => undefined)
                    }
                    className={`flex h-20 w-full items-center gap-4 rounded-2xl px-6 transition-colors active:scale-95 disabled:opacity-50 ${
                        isOn(coffee) ? 'bg-amber-600 text-white' : 'bg-card text-foreground shadow-surface'
                    }`}
                >
                    <Coffee className="h-10 w-10" />
                    <span className="flex-1 text-left text-xl font-semibold">{coffee.friendly_name}</span>
                    <span className="text-lg font-bold">{isOn(coffee) ? 'ON' : 'OFF'}</span>
                </button>
            )}

            {doneTasks.length > 0 && (
                <div className="fixed inset-x-4 bottom-20 z-[65] flex items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-surface-hover">
                    <span className="flex-1 truncate text-sm">{t('widgets.taskScheduled')}</span>
                    {doneTasks.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => undoTask(entry.id)}
                            className="flex min-h-[56px] max-w-[50%] items-center gap-1 rounded-lg bg-background/20 px-3 text-sm font-semibold"
                        >
                            <Undo2 className="h-4 w-4 shrink-0" />
                            <span className="truncate">{entry.title}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});

// ── Day ──────────────────────────────────────────────────────────────────────

const DayPhase: React.FC<PhaseProps> = memo(({ ha, today, reloadKey }) => {
    const { t } = useTranslation('dashboard.custom');
    const appointments = useApi<Appointment[]>(
        `/api/appointments?start_date=${today}&end_date=${today}`,
        reloadKey,
    );
    const shopping = useApi<ShoppingItem[]>('/api/shopping', reloadKey);
    const [expanded, setExpanded] = useState(false);
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [doneItems, setDoneItems] = useState<Array<{ id: string; name: string }>>([]);

    const timeline = useMemo(
        () =>
            [...(appointments.data ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time)),
        [appointments.data],
    );

    const devices = useMemo(
        () =>
            ha.devices
                .filter((device) => TOGGLEABLE_DOMAINS[device.domain])
                .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name)),
        [ha.devices],
    );
    const visibleDevices = expanded ? devices : devices.slice(0, 8);

    const security = useMemo(() => {
        const classes = ['door', 'window', 'garage_door', 'motion', 'smoke', 'lock'];
        return [
            ...(ha.byDomain.binary_sensor ?? []).filter((device) =>
                classes.includes(String(device.attributes.device_class ?? '')),
            ),
            ...(ha.byDomain.lock ?? []),
        ];
    }, [ha.byDomain]);

    const openItems = useMemo(
        () => (shopping.data ?? []).filter((item) => !item.is_checked && !checked[item.id]).slice(0, 5),
        [shopping.data, checked],
    );

    const toggle = useCallback(
        (device: HaDevice) => {
            const service = isOn(device) ? 'turn_off' : 'turn_on';
            void ha.callService(device.domain, service, { entity_id: device.entity_id }).catch(() => undefined);
        },
        [ha],
    );

    // Kiosk.tsx's shopping pattern, kept as-is: check optimistically, fire the
    // PUT immediately, undo with the reverse PUT.
    const checkItem = useCallback((item: ShoppingItem) => {
        setChecked((prev) => ({ ...prev, [item.id]: true }));
        setDoneItems((prev) => [...prev.filter((entry) => entry.id !== item.id), { id: item.id, name: item.name }]);
        window.setTimeout(() => setDoneItems((prev) => prev.filter((entry) => entry.id !== item.id)), 5_000);
        void api.put(`/api/shopping/${item.id}`, { is_checked: true }).catch(() => undefined);
    }, []);

    const undoItem = useCallback((id: string) => {
        setChecked((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        setDoneItems((prev) => prev.filter((entry) => entry.id !== id));
        void api.put(`/api/shopping/${id}`, { is_checked: false }).catch(() => undefined);
    }, []);

    return (
        <div className="space-y-4 px-4 pb-24 pt-4">
            <Card>
                <CardTitle icon={<Sun className="h-5 w-5 text-primary" />}>{t('widgets.agenda')}</CardTitle>
                {timeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('widgets.noAgenda')}</p>
                ) : (
                    <ol className="relative space-y-4 pl-6">
                        <span className="absolute bottom-2 left-[7px] top-2 w-0.5 bg-border" aria-hidden />
                        {timeline.map((appointment) => (
                            <li key={appointment.id} className="relative">
                                <span className="absolute -left-[23px] top-2 h-3.5 w-3.5 rounded-full border-2 border-card bg-primary" />
                                <div className="flex items-center gap-3">
                                    <span className="text-lg font-mono text-foreground">{hhmmOf(appointment.start_time)}</span>
                                    <span className="flex-1 text-base font-medium text-foreground">{appointment.title}</span>
                                    <MemberDots members={appointment.family_members_data} />
                                </div>
                                {appointment.location && (
                                    <p className="mt-1 text-sm text-muted-foreground">{appointment.location}</p>
                                )}
                            </li>
                        ))}
                    </ol>
                )}
            </Card>

            <Card>
                <CardTitle icon={<Lamp className="h-5 w-5 text-primary" />}>{t('widgets.devices')}</CardTitle>
                {ha.failure ? (
                    <p className="text-sm text-muted-foreground">{t('errors.devicesUnavailable')}</p>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            {visibleDevices.map((device) => (
                                <ToggleTile
                                    key={device.entity_id}
                                    device={device}
                                    busy={Boolean(ha.busy[device.entity_id])}
                                    disabled={ha.failure !== null}
                                    onToggle={toggle}
                                />
                            ))}
                        </div>
                        {!expanded && devices.length > 8 && (
                            <button
                                type="button"
                                onClick={() => setExpanded(true)}
                                className="mt-3 min-h-[56px] w-full rounded-xl border border-border text-base font-semibold text-foreground active:scale-95"
                            >
                                {t('widgets.viewAll')}
                            </button>
                        )}
                    </>
                )}
            </Card>

            <Card>
                <CardTitle icon={<Lock className="h-5 w-5 text-primary" />}>{t('widgets.security')}</CardTitle>
                {ha.failure ? (
                    // A stale "door closed" is worse than no reading at all.
                    <p className="text-sm text-muted-foreground">{t('errors.devicesUnavailable')}</p>
                ) : security.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('widgets.noSecurity')}</p>
                ) : (
                    <div className="flex gap-3 overflow-x-auto pb-1">
                        {security.map((device) => {
                            // A lock reads `locked`/`unlocked`, not `on`/`off`, so
                            // the generic isOn() check would keep every lock green
                            // even while the door stands open.
                            const alert =
                                device.domain === 'lock'
                                    ? device.state === 'unlocked'
                                    : isOn(device);
                            return (
                                <div key={device.entity_id} className="flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2">
                                    <span className={`h-3 w-3 rounded-full ${alert ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                    <span className="text-sm font-medium text-foreground">{device.friendly_name}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            <Card>
                <CardTitle icon={<ShoppingCart className="h-5 w-5 text-primary" />}>
                    {t('widgets.shopping_preview')}
                </CardTitle>
                {openItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('widgets.emptyShopping')}</p>
                ) : (
                    <ul className="space-y-2">
                        {openItems.map((item) => (
                            <li key={item.id} className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => checkItem(item)}
                                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-border active:scale-95"
                                    aria-label={item.name}
                                >
                                    <Check className="h-5 w-5 text-primary" />
                                </button>
                                <span className="flex-1 text-base text-foreground">{item.name}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <Link to="/shopping" className="mt-3 flex min-h-[56px] items-center justify-center rounded-xl border border-border text-base font-semibold text-foreground active:scale-95">
                    {t('widgets.viewAll')}
                </Link>
            </Card>

            {doneItems.length > 0 && (
                <div className="fixed inset-x-4 bottom-20 z-[65] flex items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-surface-hover">
                    <span className="flex-1 truncate text-sm">{t('widgets.itemScheduled')}</span>
                    {doneItems.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => undoItem(entry.id)}
                            className="flex min-h-[56px] max-w-[50%] items-center gap-1 rounded-lg bg-background/20 px-3 text-sm font-semibold"
                        >
                            <Undo2 className="h-4 w-4 shrink-0" />
                            <span className="truncate">{entry.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});

// ── Evening ──────────────────────────────────────────────────────────────────

const EveningPhase: React.FC<PhaseProps & { tomorrow: DailyForecastDTO | null }> = memo(
    ({ ha, today, reloadKey, weatherEnabled, tomorrow }) => {
        const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
        const meals = useApi<MealPlan[]>(
            `/api/meal-plans?start_date=${today}&end_date=${today}`,
            reloadKey,
        );
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
            if (bedtime.length > 0) {
                return bedtime.map((entry) => ({
                    name: entry.family_member_name,
                    color: entry.family_member_color,
                    time: hhmmOf(entry.start_time),
                }));
            }
            // No planning entry: fall back to the household's usual 20:30, so the
            // card still answers the question instead of disappearing.
            return (meals.data ?? []).length >= 0
                ? todayEntries.slice(0, 3).map((entry) => ({
                      name: entry.family_member_name,
                      color: entry.family_member_color,
                      time: '20:30',
                  }))
                : [];
        }, [todayEntries, meals.data]);

        const dinnerScene = useMemo(
            () => findByName(ha.byDomain.scene ?? [], ['dîner', 'diner', 'dinner']),
            [ha.byDomain],
        );
        const lights = ha.byDomain.light ?? [];
        const onLights = lights.filter(isOn);
        const haDown = ha.failure !== null;

        const dimAll = useCallback(
            (pct: number) => {
                if (onLights.length === 0 && lights.length === 0) return;
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
            <div className="space-y-4 px-4 pb-24 pt-4">
                <section className="rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 p-6 text-slate-900">
                    <div className="flex items-center gap-4">
                        <UtensilsCrossed className="h-12 w-12 text-amber-600" />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold uppercase tracking-wide">{t('dashboard.custom:widgets.dinner')}</p>
                            <p className="mt-1 line-clamp-2 text-2xl font-bold">
                                {dinner?.custom_meal || dinner?.recipe?.name || t('dashboard.custom:widgets.noDinner')}
                            </p>
                        </div>
                    </div>
                    {dinner?.recipe && (
                        <Link to="/recipes" className="mt-3 inline-flex min-h-[56px] items-center gap-2 rounded-lg bg-white/70 px-4 text-base font-semibold text-slate-900">
                            {t('dashboard.custom:widgets.viewRecipe')}
                        </Link>
                    )}
                </section>

                {dinnerScene && (
                    <button
                        type="button"
                        disabled={haDown}
                        onClick={() =>
                            void ha.callService('scene', 'turn_on', { entity_id: dinnerScene.entity_id }).catch(() => undefined)
                        }
                        className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 text-xl font-bold text-white transition-colors active:scale-95 disabled:opacity-50"
                    >
                        <Sparkles className="h-8 w-8" />
                        {t('widgets.dinner_scene')}
                    </button>
                )}

                <Card>
                    <CardTitle icon={<Lamp className="h-5 w-5 text-primary" />}>{t('widgets.lights')}</CardTitle>
                    <div className="grid grid-cols-4 gap-3">
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
                    </div>
                    <button
                        type="button"
                        disabled={haDown || lights.length === 0}
                        onClick={() =>
                            void ha
                                .callService('light', 'turn_off', { entity_id: lights.map((light) => light.entity_id) })
                                .catch(() => undefined)
                        }
                        className="mt-3 min-h-[56px] w-full rounded-xl border border-border text-lg font-semibold text-foreground active:scale-95 disabled:opacity-50"
                    >
                        {t('actions.all_lights_off')}
                    </button>
                    {!haDown && (
                        <p className="mt-2 text-sm text-muted-foreground">
                            {onLights.length}/{lights.length} {t('widgets.lightsOn')}
                        </p>
                    )}
                </Card>

                <Card>
                    <CardTitle icon={<Moon className="h-5 w-5 text-primary" />}>{t('widgets.bedtime')}</CardTitle>
                    {bedtimes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('widgets.noBedtime')}</p>
                    ) : (
                        <ul className="space-y-3">
                            {bedtimes.map((bedtime, index) => (
                                <li key={`${bedtime.name}-${index}`} className="flex items-center gap-3">
                                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: bedtime.color }} />
                                    <span className="flex-1 text-base font-medium text-foreground">{bedtime.name}</span>
                                    <span className="text-lg font-mono text-foreground">{bedtime.time}</span>
                                    <span className="min-w-[72px] text-right text-sm text-muted-foreground">
                                        {formatCountdown(minutesUntil(new Date(), bedtime.time)) ?? t('widgets.gone')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                {weatherEnabled && tomorrowCondition && tomorrow && (
                    <Card className="flex items-center gap-4">
                        {React.createElement(CONDITION_ICON[tomorrowCondition], { className: 'h-10 w-10 text-primary' })}
                        <div className="flex-1">
                            <p className="text-sm text-muted-foreground">{t('widgets.tomorrow')}</p>
                            <p className="text-lg font-semibold text-foreground">
                                {Math.round(tomorrow.tempMin)}° / {Math.round(tomorrow.tempMax)}°
                            </p>
                        </div>
                        <p className="text-sm text-muted-foreground">{t(`weather.custom:conditions.${tomorrowCondition}` as never)}</p>
                    </Card>
                )}
            </div>
        );
    },
);

// ── Night ────────────────────────────────────────────────────────────────────

const NightPhase: React.FC<PhaseProps & { tomorrow: string; dimmed: boolean }> = memo(
    ({ ha, now, tomorrow, dimmed }) => {
        const { t } = useTranslation('dashboard.custom');
        const dateLabel = useDateLabel();
        const appointments = useApi<Appointment[]>(
            `/api/appointments?start_date=${tomorrow}&end_date=${tomorrow}`,
            0,
        );
        const nightlight = useMemo(
            () => findByName(ha.byDomain.light ?? [], ['nuit', 'nightlight', 'veilleuse']),
            [ha.byDomain],
        );
        const first = useMemo(() => {
            const list = [...(appointments.data ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
            return list[0] ?? null;
        }, [appointments.data]);

        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-black px-6">
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

const FamilyDashboard: React.FC = () => {
    const { t } = useTranslation(['dashboard.custom', 'weather.custom']);
    const { isModuleEnabled } = useAuth();
    const [now, setNow] = useState(() => new Date());
    const [override, setOverride] = useState<PhaseOverride | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [scenesOpen, setScenesOpen] = useState(false);
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
            // down so a vertical scroll is never mistaken for a phase change.
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

    const scenes = ha.byDomain.scene ?? [];
    const haDown = ha.failure !== null;

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
                <main className={`flex-1 ${phase === 'night' ? 'flex overflow-hidden' : 'overflow-y-auto'}`}>
                    {phase === 'morning' && <MorningPhase {...phaseProps} />}
                    {phase === 'day' && <DayPhase {...phaseProps} />}
                    {phase === 'evening' && <EveningPhase {...phaseProps} tomorrow={tomorrowForecast} />}
                    {phase === 'night' && <NightPhase {...phaseProps} tomorrow={tomorrow} dimmed={dimmed} />}
                </main>
            )}

            {scenesOpen && (
                <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={() => setScenesOpen(false)}>
                    <div
                        className="max-h-[70vh] overflow-y-auto rounded-t-2xl bg-card p-4"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <CardTitle icon={<Sparkles className="h-5 w-5 text-primary" />}>{t('actions.scenes')}</CardTitle>
                        <div className="grid grid-cols-2 gap-3">
                            {scenes.map((scene) => (
                                <button
                                    key={scene.entity_id}
                                    type="button"
                                    disabled={haDown}
                                    onClick={() => {
                                        setScenesOpen(false);
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
                    </div>
                </div>
            )}

            <BottomBar
                onRefresh={() => void refresh()}
                onAllOff={() => void allOff()}
                onScenes={() => setScenesOpen(true)}
                refreshing={refreshing}
                dimmed={phase === 'night' && dimmed}
                haDown={haDown}
                sceneCount={scenes.length}
            />
        </div>
    );
};

export default FamilyDashboard;
