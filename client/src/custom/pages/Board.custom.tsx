// The board: a fixed-layout kiosk display for a wall tablet.
//
// It reproduces the glanceable card grid of the reference mock — clock over
// today's agenda, weather with hourly rain bars and the air-quality line, meals,
// shopping, Belgian news, and a full-width chores strip whose chips are tapped,
// not read:
//
//   - appointments / tasks / meals / shopping: the upstream lists, fetched on
//     Kiosk.tsx's cadence (first load + 60 s + websockets);
//   - weather and air quality: Open-Meteo directly (no API key, public CORS),
//     for the family's saved city;
//   - news: GET /api/news, the one route this page reads (VRT NWS headlines,
//     already scored and capped to 3 server-side);
//   - the clock, its greeting and the date: local.
//
// The agenda tile is a clock view: the event occupying the current time is the
// tile's anchor, earlier events are faded and compressed, later ones full
// weight.
//
// Chrome-less without touching App.tsx's route list: the root is a
// `fixed inset-0 z-[60]` layer above Layout's own fixed chrome (its highest is
// z-50).
//
// Layout rules that the whole file respects: the page never scrolls on desktop
// (each list is capped, what does not fit is left out), every tappable element
// is large enough for a child's finger, and taps are optimistic with an inline
// undo — Kiosk.tsx's pattern, kept as-is.
//
// The city is the family's, not the device's: it is read from
// GET /api/weather/location — the coordinates a parent saves in Settings, stored
// on the family owner's row — so every board and every account shows the same
// city, and a change reaches the open boards over the family WebSocket.
// Upstream's /kiosk keeps its own per-device city; the board never reads it.

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Calendar, Check, Leaf, Maximize2, Minimize2, Newspaper, ShoppingCart,
    Undo2, UtensilsCrossed, X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { useSavedLocation } from '../hooks/useWeather.custom';
import { intlLocale } from '../../i18n/format';
import { cn } from '../../lib/utils';
import { CONDITION_ICON, weatherCondition } from '../lib/weatherCode.custom';
import '../lib/board.custom.css';

interface Member { id: string; name: string; color: string }
interface Appointment { id: string; occurrence_id?: string; title: string; start_time: string; location?: string; family_members_data?: Member[] }
interface Task { id: string; title: string; is_completed: boolean; due_date?: string }
interface MealPlan { id: string; meal_type: string; custom_meal?: string; recipe?: { name: string } }
interface ShoppingItem { id: string; name: string; quantity?: number; unit?: string; is_checked: boolean }

const MEAL_ORDER = ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Snack'];

const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── The family's city (one city for every account and every device) ─────────

interface BoardLocation { name: string; lat: number; lon: number }

// ── Weather + air quality (Open-Meteo, no API key, public CORS) ─────────────

interface WeatherHour { time: string; precip: number; peak: boolean }
interface BoardWeather { temp: number; code: number; rainNow: boolean; hours: WeatherHour[] }

const RAIN_PROBABILITY = 40; // % — the point where the tile names an hour

const fetchBoardWeather = async (loc: BoardLocation): Promise<BoardWeather> => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
        + '&current=temperature_2m,weather_code,precipitation'
        + '&hourly=precipitation_probability'
        + '&forecast_days=2&timezone=auto';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json() as {
        current: { temperature_2m: number; weather_code: number; precipitation: number };
        hourly: { time: string[]; precipitation_probability: (number | null)[] };
    };
    // hourly.time is local to the location (timezone=auto) — a wall display
    // lives in the same timezone as its city, so comparing with the device
    // clock is fine. The bars start at the next full hour; the current hour is
    // represented by the "rain now" line instead.
    const now = Date.now();
    const hours: WeatherHour[] = [];
    for (let i = 0; i < d.hourly.time.length && hours.length < 5; i++) {
        if (new Date(d.hourly.time[i]).getTime() > now) {
            hours.push({ time: d.hourly.time[i], precip: Math.round(d.hourly.precipitation_probability[i] ?? 0), peak: false });
        }
    }
    const max = Math.max(0, ...hours.map((h) => h.precip));
    for (const hour of hours) hour.peak = max > 0 && hour.precip === max;
    const condition = weatherCondition(d.current.weather_code);
    return {
        temp: d.current.temperature_2m,
        code: d.current.weather_code,
        rainNow: d.current.precipitation > 0 || condition === 'drizzle' || condition === 'rain' || condition === 'storm',
        hours,
    };
};

// European AQI bands, in the units the air-quality API returns (0–20 good …
// above 100 extremely poor). The client translates the band, never the number.
const aqiBand = (value: number): 'good' | 'fair' | 'moderate' | 'poor' | 'veryPoor' | 'extremelyPoor' => {
    if (value <= 20) return 'good';
    if (value <= 40) return 'fair';
    if (value <= 60) return 'moderate';
    if (value <= 80) return 'poor';
    if (value <= 100) return 'veryPoor';
    return 'extremelyPoor';
};

const fetchBoardAqi = async (loc: BoardLocation): Promise<number> => {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}`
        + '&current=european_aqi&timezone=auto';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json() as { current: { european_aqi: number } };
    return d.current.european_aqi;
};

// ── Belgian news (VRT, scored server-side) ───────────────────────────────────

interface NewsItem {
    title: string;
    summary: string;
    published: string;
    link: string;
    tags: string[];
    buckets: ('tech' | 'health' | 'family' | 'work')[];
}

// ── Time formatting ──────────────────────────────────────────────────────────

const fmtHourMinute = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtHour = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(), { hour: 'numeric' }).format(new Date(iso));

/** "10:42" + the locale's day period, pulled apart so the period can be small. */
const clockParts = (now: Date): { time: string; period: string } => {
    const parts = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).formatToParts(now);
    let time = '';
    let period = '';
    for (const part of parts) {
        if (part.type === 'hour' || part.type === 'minute') time += (time ? ':' : '') + part.value;
        else if (part.type === 'dayPeriod') period = part.value.toLowerCase();
    }
    return { time, period };
};

const greetingForHour = (hour: number): 'morning' | 'afternoon' | 'evening' | 'night' => {
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
};

// ── Page ─────────────────────────────────────────────────────────────────────

const Board: React.FC = () => {
    const { t } = useTranslation(['board.custom', 'meals']);
    const [now, setNow] = useState(() => new Date());
    const [loading, setLoading] = useState(true);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [meals, setMeals] = useState<MealPlan[]>([]);
    const [shopping, setShopping] = useState<ShoppingItem[]>([]);

    const savedLocation = useSavedLocation();
    const location = useMemo<BoardLocation | null>(() => {
        const { city, latitude, longitude } = savedLocation.data ?? {};
        if (latitude == null || longitude == null) return null;
        return { name: city ?? '', lat: latitude, lon: longitude };
    }, [savedLocation.data?.city, savedLocation.data?.latitude, savedLocation.data?.longitude]);

    const [weather, setWeather] = useState<BoardWeather | null>(null);
    const [weatherFailed, setWeatherFailed] = useState(false);
    const [aqi, setAqi] = useState<number | null>(null);
    const [news, setNews] = useState<NewsItem[] | null>(null);
    const [newsFailed, setNewsFailed] = useState(false);

    const [isFullscreen, setIsFullscreen] = useState(false);

    // Tap-to-complete confirmations ("✓ undone inside the chip", visible ~5 s) —
    // Kiosk.tsx's pattern, kept as-is.
    const [doneTasks, setDoneTasks] = useState<{ id: string; title: string }[]>([]);
    const [doneShopping, setDoneShopping] = useState<{ id: string; name: string }[]>([]);

    // Live clock — every 15 s, enough to flip the minute while the tab is idle.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 15_000);
        return () => clearInterval(id);
    }, []);

    const loadAll = async () => {
        const today = new Date();
        // Naive local bounds: appointment start_time is stored as a local
        // "YYYY-MM-DDTHH:mm:ss" string, so the window must not be UTC.
        const start = `${ymd(today)}T00:00:00`;
        const end = `${ymd(today)}T23:59:59`;
        try {
            const [apptRes, taskRes, mealRes, shopRes] = await Promise.all([
                api.get<{ success: boolean; data: Appointment[] }>(`/api/appointments?start_date=${start}&end_date=${end}`),
                api.get<{ success: boolean; data: Task[] }>('/api/tasks'),
                api.get<{ success: boolean; data: MealPlan[] }>(`/api/meal-plans?start_date=${ymd(today)}&end_date=${ymd(today)}`),
                api.get<{ success: boolean; data: ShoppingItem[] }>('/api/shopping'),
            ]);
            if (apptRes.success) setAppointments(apptRes.data);
            if (taskRes.success) setTasks(taskRes.data);
            if (mealRes.success) setMeals(mealRes.data);
            if (shopRes.success) setShopping(shopRes.data);
        } catch (e) {
            console.error('Board load error:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadAll();
        const id = setInterval(() => void loadAll(), 60_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useWebSocketUpdates('appointments', () => void loadAll());
    useWebSocketUpdates('tasks', () => void loadAll());
    useWebSocketUpdates('meal-plans', () => void loadAll());
    useWebSocketUpdates('shopping', () => void loadAll());

    // Weather + air quality — refreshed every 30 min; a failure shows the
    // tile's unavailable text and the next cycle retries. The memoized location
    // makes this re-run only when the family changes its city.
    useEffect(() => {
        if (!location) {
            setWeather(null);
            setAqi(null);
            return;
        }
        let cancelled = false;
        setWeather(null);
        setAqi(null);
        setWeatherFailed(false);
        const load = async () => {
            const [weatherResult, aqiResult] = await Promise.allSettled([
                fetchBoardWeather(location),
                fetchBoardAqi(location),
            ]);
            if (cancelled) return;
            if (weatherResult.status === 'fulfilled') setWeather(weatherResult.value);
            else setWeatherFailed(true);
            // A failed air-quality fetch leaves aqi null: the weather tile then
            // shows its muted "Air —" line rather than losing the row.
            if (aqiResult.status === 'fulfilled') setAqi(aqiResult.value);
        };
        void load();
        const id = setInterval(() => void load(), 30 * 60_000);
        return () => { cancelled = true; clearInterval(id); };
    }, [location]);

    // Belgian news — one server-cached feed, refreshed every 5 min; a failure
    // shows the tile's unavailable text and the next cycle retries.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const [result] = await Promise.allSettled([
                api.get<{ success: boolean; data: { items: NewsItem[] } }>('/api/news'),
            ]);
            if (cancelled) return;
            if (result.status === 'fulfilled' && result.value.success) {
                setNews(result.value.data.items);
                setNewsFailed(false);
            } else {
                setNewsFailed(true);
            }
        };
        void load();
        const id = setInterval(() => void load(), 5 * 60_000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    useEffect(() => {
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
    };

    // ── Touch interactions (optimistic, with a ~5 s inline undo) ─────────────

    const completeTask = (task: Task) => {
        setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, is_completed: true } : x)));
        setDoneTasks((prev) => [...prev.filter((d) => d.id !== task.id), { id: task.id, title: task.title }]);
        window.setTimeout(() => setDoneTasks((prev) => prev.filter((d) => d.id !== task.id)), 5_000);
        api.put(`/api/tasks/${task.id}`, { is_completed: true }).catch(() => void loadAll());
    };

    const undoTask = (id: string) => {
        setDoneTasks((prev) => prev.filter((d) => d.id !== id));
        setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, is_completed: false } : x)));
        api.put(`/api/tasks/${id}`, { is_completed: false }).catch(() => void loadAll());
    };

    const checkShoppingItem = (item: ShoppingItem) => {
        setShopping((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_checked: true } : x)));
        setDoneShopping((prev) => [...prev.filter((d) => d.id !== item.id), { id: item.id, name: item.name }]);
        window.setTimeout(() => setDoneShopping((prev) => prev.filter((d) => d.id !== item.id)), 5_000);
        api.put(`/api/shopping/${item.id}`, { is_checked: true }).catch(() => void loadAll());
    };

    const undoShoppingItem = (id: string) => {
        setDoneShopping((prev) => prev.filter((d) => d.id !== id));
        setShopping((prev) => prev.map((x) => (x.id === id ? { ...x, is_checked: false } : x)));
        api.put(`/api/shopping/${id}`, { is_checked: false }).catch(() => void loadAll());
    };

    // ── Derived data (each list capped: the page never scrolls on desktop) ───

    const { time, period } = useMemo(() => clockParts(now), [now]);
    const dateLabel = useMemo(() => {
        const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long' }).format(now);
        const dayMonth = new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long' }).format(now);
        return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${dayMonth}`;
    }, [now]);

    const todayAppointments = useMemo(
        () => [...appointments].sort((a, b) => a.start_time.localeCompare(b.start_time)),
        [appointments]
    );
    const sortedMeals = useMemo(
        () => [...meals].sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type)),
        [meals]
    );
    const dinner = sortedMeals.find((m) => m.meal_type === 'Dîner');
    const otherMeals = sortedMeals.filter((m) => m !== dinner);
    const pendingShopping = useMemo(() => shopping.filter((s) => !s.is_checked), [shopping]);
    // Undated chores first (they are for today), then by due date, then title:
    // overdue floats up with the rest of the dated ones, oldest first.
    const pendingChores = useMemo(
        () => tasks.filter((task) => !task.is_completed).sort((a, b) => {
            const da = a.due_date?.slice(0, 10) ?? '';
            const db = b.due_date?.slice(0, 10) ?? '';
            if (da !== db) return da < db ? -1 : 1;
            return a.title.localeCompare(b.title);
        }),
        [tasks]
    );

    // Clock agenda: the current event is the one that started at or before now
    // (favouring the latest such start); before anything starts today it is the
    // first one. Past events fade and compress, future ones stay full weight.
    const nowIdx = useMemo(() => {
        let idx = 0;
        for (let i = 0; i < todayAppointments.length; i++) {
            if (new Date(todayAppointments[i].start_time).getTime() <= now.getTime()) idx = i;
        }
        return todayAppointments.length === 0 ? -1 : idx;
    }, [todayAppointments, now]);
    const pastEvents = todayAppointments.slice(Math.max(0, nowIdx - 2), nowIdx);
    const nextEvents = nowIdx >= 0 ? todayAppointments.slice(nowIdx + 1, nowIdx + 3) : [];
    const shownCount = (nowIdx >= 0 ? 1 : 0) + pastEvents.length + nextEvents.length;

    const duePill = (task: Task): { label: string; className: string } | null => {
        if (!task.due_date) return null;
        const due = task.due_date.slice(0, 10);
        const today = ymd(now);
        if (due === today) return { label: t('chores.today'), className: 'bg-[#fdefcf] text-[#a3730f]' };
        if (due < today) return { label: t('chores.overdue'), className: 'bg-[#fbe0dc] text-[#b3362a]' };
        const days = (new Date(`${due}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000;
        if (days > 7) return null;
        const day = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(new Date(`${due}T00:00:00`));
        return { label: t('chores.dueOn', { day }), className: 'bg-[#fbe3ec] text-[#c2447a]' };
    };

    const rainLine = (data: BoardWeather): string => {
        if (data.rainNow) return t('weather.rainNow');
        const first = data.hours.find((h) => h.precip >= RAIN_PROBABILITY);
        if (first) return t('weather.rainFrom', { time: fmtHourMinute(first.time) });
        return t(`weather.custom:conditions.${weatherCondition(data.code)}` as never);
    };

    const ConditionIcon = weather ? CONDITION_ICON[weatherCondition(weather.code)] : null;

    const emptyClass = 'flex flex-1 items-center justify-center py-4 text-center text-sm text-[#8a8492]';

    return (
        <div className="board-surface fixed inset-0 z-[60] overflow-hidden">
            <div className="flex h-full flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:gap-5 lg:p-5">
                <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto sm:gap-4 lg:grid-cols-12 lg:grid-rows-2 lg:gap-5 lg:overflow-hidden">
                    {/* Clock + greeting */}
                    <section className="board-tile board-tile--clock lg:col-span-5">
                        <div className="flex items-center justify-between gap-3">
                            <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-sm font-medium text-[#4c4557]">
                                <Calendar className="h-4 w-4 text-[#6d5bd0]" />
                                {dateLabel}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={toggleFullscreen}
                                    aria-label={t(isFullscreen ? 'actions.exitFullscreen' : 'actions.fullscreen')}
                                    className="board-icon-btn"
                                >
                                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                                </button>
                                <Link to="/" aria-label={t('actions.exit')} className="board-icon-btn">
                                    <X className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col justify-center py-2">
                            <p className="font-serif text-[clamp(3.5rem,8vw,7rem)] font-semibold leading-none tracking-tight text-[#2e2a3a] tabular-nums">
                                {time}
                                {period && (
                                    <span className="ml-2 align-baseline text-[0.32em] font-medium text-[#6f6685]">{period}</span>
                                )}
                            </p>
                            <p className="mt-3 font-serif text-[clamp(1.3rem,2.4vw,2rem)] font-semibold leading-snug text-[#6d5bd0]">
                                {t(`greet.${greetingForHour(now.getHours())}`)}
                            </p>
                            <p className="font-serif text-[clamp(1.3rem,2.4vw,2rem)] leading-snug text-[#3a3446]">{t('greet.sub')}</p>
                        </div>
                    </section>

                    {/* Today's agenda */}
                    <section className="board-tile board-tile--agenda lg:col-span-4">
                        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-[#4285c8]">
                            <Calendar className="h-5 w-5 shrink-0" /> {t('agenda.title')}
                        </h2>
                        {loading && todayAppointments.length === 0 ? (
                            <p className={emptyClass}>{t('common.loading')}</p>
                        ) : todayAppointments.length === 0 ? (
                            <p className={emptyClass}>{t('agenda.empty')}</p>
                        ) : (
                            <div className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-2">
                                {/* The event occupying the current time, full weight. */}
                                <div className="rounded-2xl border-2 border-[#9db9dd] bg-white/80 px-3.5 py-2.5">
                                    <div className="flex items-baseline gap-3">
                                        <span className="shrink-0 font-serif text-2xl font-semibold tabular-nums text-[#35608f]">
                                            {fmtHourMinute(todayAppointments[nowIdx].start_time)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-xl font-semibold text-[#2c3440]">
                                            {todayAppointments[nowIdx].title}
                                        </span>
                                        <span className="shrink-0 rounded-full bg-[#4285c8] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                                            {t('agenda.now')}
                                        </span>
                                    </div>
                                    {(todayAppointments[nowIdx].location || (todayAppointments[nowIdx].family_members_data || []).length > 0) && (
                                        <div className="mt-1 flex items-center gap-3 text-xs text-[#66738a]">
                                            {todayAppointments[nowIdx].location && <span className="truncate">{todayAppointments[nowIdx].location}</span>}
                                            {(todayAppointments[nowIdx].family_members_data || []).slice(0, 2).map((m) => (
                                                <span key={m.id} className="inline-flex shrink-0 items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                                                    {m.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {/* Fake timeline: what was (faded, small) vs what comes next. */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1 opacity-45">
                                        {pastEvents.map((a) => (
                                            <div key={a.occurrence_id || a.id} className="flex items-baseline gap-2 text-xs text-[#556077]">
                                                <span className="shrink-0 tabular-nums">{fmtHourMinute(a.start_time)}</span>
                                                <span className="min-w-0 flex-1 truncate line-through">{a.title}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex flex-col gap-1 border-l-2 border-[#9db9dd] pl-3">
                                        {nextEvents.map((a) => (
                                            <div key={a.occurrence_id || a.id} className="flex items-baseline gap-2 text-sm font-medium text-[#2c3440]">
                                                <span className="shrink-0 tabular-nums text-[#35608f]">{fmtHourMinute(a.start_time)}</span>
                                                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                                                {(a.family_members_data || []).slice(0, 2).map((m) => (
                                                    <span key={m.id} className="inline-flex shrink-0 items-center gap-1 text-xs text-[#66738a]">
                                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                                                        {m.name}
                                                    </span>
                                                ))}
                                            </div>
                                        ))}
                                        {nextEvents.length === 0 && (
                                            <p className="text-xs text-[#66738a]">{t('agenda.nothingAfter')}</p>
                                        )}
                                    </div>
                                </div>
                                {todayAppointments.length > shownCount && (
                                    <p className="px-1 text-xs text-[#66738a]">{t('agenda.more', { count: todayAppointments.length - shownCount })}</p>
                                )}
                            </div>
                        )}
                    </section>

                    {/* Weather with hourly rain-probability bars */}
                    <section className="board-tile board-tile--weather lg:col-span-3">
                        <p className="truncate text-sm font-semibold text-[#6b6255]">{location?.name ?? ''}</p>
                        {!location ? (
                            savedLocation.loading ? (
                                <p className={emptyClass}>{t('common.loading')}</p>
                            ) : (
                                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
                                    <p className="font-serif text-2xl font-semibold text-[#8a7f6d]">{t('weather.noCity')}</p>
                                    <p className="text-xs text-[#a89e8e]">{t('weather.noCityHint')}</p>
                                </div>
                            )
                        ) : weather ? (
                            <>
                                <div className="mt-1 flex items-start justify-between gap-2">
                                    <p className="font-serif text-[clamp(3rem,5.5vw,4.5rem)] font-semibold leading-none tabular-nums text-[#3a352b]">
                                        {Math.round(weather.temp)}°
                                    </p>
                                    {ConditionIcon && <ConditionIcon className="mt-1.5 h-10 w-10 text-[#8a7f6d]" />}
                                </div>
                                {/* Air quality as a secondary line — weather stays dominant. */}
                                <p className="mt-1 flex items-center gap-1.5 text-xs text-[#8a8172]">
                                    <Leaf className="h-3.5 w-3.5 shrink-0" />
                                    {aqi !== null ? (
                                        <span>{t('weather.air')} {Math.round(aqi)} · {t(`aqi.bands.${aqiBand(aqi)}` as never)}</span>
                                    ) : (
                                        <span>{t('weather.air')} —</span>
                                    )}
                                </p>
                                <p className="mt-1.5 text-sm font-medium text-[#e2823c]">{rainLine(weather)}</p>
                                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                                    {weather.hours.map((h) => (
                                        <div key={h.time} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                                            <div className="flex h-16 w-full items-end justify-center">
                                                <span
                                                    className="w-3.5 rounded-full"
                                                    style={{
                                                        height: `${Math.max(12, Math.min(100, h.precip))}%`,
                                                        backgroundColor: h.peak ? '#ef8b3f' : '#f2b9cd',
                                                    }}
                                                />
                                            </div>
                                            <span className="text-[11px] tabular-nums text-[#8a8172]">{fmtHour(h.time)}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className={emptyClass}>{t(weatherFailed ? 'weather.unavailable' : 'common.loading')}</p>
                        )}
                    </section>

                    {/* Meals */}
                    <section className="board-tile board-tile--meals lg:col-span-5">
                        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-[#3f8f57]">
                            <UtensilsCrossed className="h-5 w-5 shrink-0" /> {t('meals.title')}
                        </h2>
                        {loading && sortedMeals.length === 0 ? (
                            <p className={emptyClass}>{t('common.loading')}</p>
                        ) : sortedMeals.length === 0 ? (
                            <p className={emptyClass}>{t('meals.empty')}</p>
                        ) : (
                            <div className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-2.5">
                                {dinner && (
                                    <div className="rounded-2xl bg-white/70 px-4 py-3">
                                        <p className="text-xs uppercase tracking-wide text-[#7fa389]">
                                            {t(`meals:mealTypes.${dinner.meal_type}`, { defaultValue: dinner.meal_type })}
                                        </p>
                                        <p className="truncate font-serif text-[clamp(1.5rem,2.4vw,2.1rem)] font-semibold text-[#2f5d3c]">
                                            {dinner.recipe?.name || dinner.custom_meal}
                                        </p>
                                    </div>
                                )}
                                {otherMeals.slice(0, 3).map((m) => (
                                    <div key={m.id} className="flex items-baseline gap-3 px-1">
                                        <span className="w-32 shrink-0 truncate text-xs uppercase tracking-wide text-[#7fa389]">
                                            {t(`meals:mealTypes.${m.meal_type}`, { defaultValue: m.meal_type })}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate font-medium text-[#39543f]">
                                            {m.recipe?.name || m.custom_meal}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Shopping — tap a row to check it off */}
                    <section className="board-tile board-tile--shopping lg:col-span-4">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="flex items-center gap-2.5 text-lg font-semibold text-[#c2447a]">
                                <ShoppingCart className="h-5 w-5 shrink-0" /> {t('shopping.title')}
                            </h2>
                            <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-[#c2447a]">
                                {t('shopping.left', { count: pendingShopping.length })}
                            </span>
                        </div>
                        {loading && pendingShopping.length === 0 && doneShopping.length === 0 ? (
                            <p className={emptyClass}>{t('common.loading')}</p>
                        ) : pendingShopping.length === 0 && doneShopping.length === 0 ? (
                            <p className={emptyClass}>{t('shopping.empty')}</p>
                        ) : (
                            <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-1">
                                {doneShopping.map((d) => (
                                    <li key={`done-${d.id}`} className="flex items-center gap-2.5 rounded-2xl bg-[#e9f5e6] px-3 py-2 text-[#3f6b48]">
                                        <Check className="h-4 w-4 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate text-sm line-through">{d.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => undoShoppingItem(d.id)}
                                            className="flex shrink-0 items-center gap-1 text-[11px] font-medium underline underline-offset-2"
                                        >
                                            <Undo2 className="h-3.5 w-3.5" /> {t('chores.undo')}
                                        </button>
                                    </li>
                                ))}
                                {pendingShopping.slice(0, 4).map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            aria-label={t('shopping.check', { name: item.name })}
                                            onClick={() => checkShoppingItem(item)}
                                            className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left transition-colors active:bg-white/70"
                                        >
                                            <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-[#d69ab9]" />
                                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#4a3640]">{item.name}</span>
                                            {item.quantity ? (
                                                <span className="shrink-0 text-xs tabular-nums text-[#9a7788]">
                                                    {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                ))}
                                {pendingShopping.length > 4 && (
                                    <li className="px-1 text-xs text-[#9a7788]">
                                        {t('shopping.more', { count: pendingShopping.length - 4 })}
                                    </li>
                                )}
                            </ul>
                        )}
                    </section>

                    {/* Belgian news (VRT NWS, scored server-side) */}
                    <section className="board-tile board-tile--news lg:col-span-3">
                        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-[#4f8f4f]">
                            <Newspaper className="h-5 w-5 shrink-0" /> {t('news.title')}
                        </h2>
                        {!news ? (
                            <p className={emptyClass}>{t(newsFailed ? 'news.unavailable' : 'common.loading')}</p>
                        ) : news.length === 0 ? (
                            // The feed can legitimately score nothing on a day
                            // with only foreign news; unavailable would read as
                            // a bug, so the tile says so plainly instead.
                            <p className={emptyClass}>{t('news.nothingRelevant')}</p>
                        ) : (
                            <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-2">
                                {news.map((item) => (
                                    <li key={item.link || item.title} className="rounded-2xl bg-white/70 px-3 py-2">
                                        <div className="flex items-baseline gap-2.5">
                                            <span className="w-[52px] shrink-0 text-xs tabular-nums text-[#7d8f79]">
                                                {fmtHourMinute(item.published)}
                                            </span>
                                            <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-[#2f4a30] line-clamp-2">
                                                {item.title}
                                            </span>
                                        </div>
                                        {item.buckets.length > 0 && (
                                            <div className="mt-1 flex flex-wrap gap-1 pl-[62px]">
                                                {item.buckets.map((bucket) => (
                                                    <span
                                                        key={bucket}
                                                        className="rounded-full bg-[#e3f0dc] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#4f8f4f]"
                                                    >
                                                        {t(`news.${bucket}`)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>

                {/* Chores strip — tap a chip to complete it */}
                <section className="board-strip flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 sm:py-3.5">
                    <div className="w-36 shrink-0">
                        <p className="text-sm font-medium text-[#c08a1e]">{t('chores.title')}</p>
                        <p className="font-serif text-xl font-semibold leading-tight text-[#8a6420]">
                            {pendingChores.length === 0
                                ? t('chores.allDone')
                                : t('chores.leftToday', { count: pendingChores.length })}
                        </p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {doneTasks.map((d) => (
                            <div key={`done-${d.id}`} className="flex items-center gap-2 rounded-full border border-[#cfe6c9] bg-[#e9f5e6] px-3.5 py-2 text-sm">
                                <Check className="h-4 w-4 shrink-0 text-[#3f8f57]" />
                                <span className="font-medium text-[#3f6b48]">{d.title}</span>
                                <button
                                    type="button"
                                    onClick={() => undoTask(d.id)}
                                    className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#3f6b48] underline underline-offset-2"
                                >
                                    <Undo2 className="h-3.5 w-3.5" /> {t('chores.undo')}
                                </button>
                            </div>
                        ))}
                        {pendingChores.slice(0, 5).map((task) => {
                            const pill = duePill(task);
                            return (
                                <button
                                    key={task.id}
                                    type="button"
                                    aria-label={t('chores.complete', { title: task.title })}
                                    onClick={() => completeTask(task)}
                                    className="flex items-center gap-2 rounded-full border border-[#ecd9a0] bg-white px-3.5 py-2 text-sm shadow-sm transition-colors active:bg-[#fdf9ec]"
                                >
                                    <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-[#d8b95c]" />
                                    <span className="font-medium text-[#4a4030]">{task.title}</span>
                                    {pill && (
                                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', pill.className)}>
                                            {pill.label}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                        {pendingChores.length > 5 && (
                            <span className="text-sm font-medium text-[#a5812a]">
                                {t('chores.more', { count: pendingChores.length - 5 })}
                            </span>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Board;
