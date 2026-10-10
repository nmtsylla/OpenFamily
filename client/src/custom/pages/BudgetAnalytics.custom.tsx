import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../lib/utils';
import { dateLocale } from '../../i18n/format';
import { format } from 'date-fns';
import ChartCard from '../../components/app/ChartCard';
import { Card, CardContent, DatePicker } from '../../components/ui';

// Fine-grained budget analysis, on its own page and its own endpoint
// (/api/budget-analytics/overview) so the shipped Budget page and its routes are
// left untouched — upstream can move them without touching this file.
//
// One request answers the whole screen: any date range, down to the day, the
// weekday and the shop, plus a projection for the elapsed part of the range.

interface DayBucket {
    date: string;
    expenses: number;
    income: number;
    count: number;
    cumulativeExpenses: number;
    cumulativeBalance: number;
}

interface BudgetAnalytics {
    range: { start: string; end: string };
    totals: { income: number; expenses: number; balance: number; count: number };
    split: { actual: { income: number; expenses: number }; recurring: { income: number; expenses: number } };
    byCategory: Array<{ category: string; expenses: number; income: number; count: number; share: number }>;
    byMonth: Array<{ month: string; expenses: number; income: number }>;
    byDay: DayBucket[];
    byWeekday: Array<{ weekday: number; expenses: number; count: number }>;
    byMember: Array<{ id: string; name: string; color: string | null; expenses: number; income: number; count: number }>;
    byMerchant: Array<{ merchant: string; expenses: number; count: number }>;
    pace: { daysTotal: number; daysElapsed: number; dailyAverage: number; projectedExpenses: number } | null;
}

// The API type is a promise, not a guarantee: a 200 carrying anything else (a
// demo fallback, a proxy error page) must show the error state, not crash on
// `data.totals`. Type predicate so the narrowing survives into setData.
const isAnalytics = (value: unknown): value is BudgetAnalytics =>
    !!value && typeof value === 'object' && !Array.isArray(value) && 'totals' in value;

const pad = (value: number) => String(value).padStart(2, '0');
const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const monthStart = () => `${today().slice(0, 7)}-01`;
const daysAgo = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const yearStart = () => `${today().slice(0, 4)}-01-01`;

// A weekday label per language without shipping one key per day: 2024-01-01 was
// a Monday, so index 0..6 walks the week.
const weekdayLabel = (isoWeekday: number) =>
    format(new Date(2024, 0, isoWeekday), 'EEE', { locale: dateLocale() });

const BudgetAnalyticsPage: React.FC = () => {
    const { t } = useTranslation(['analytics.custom', 'budget', 'common']);
    const { user, isModuleEnabled } = useAuth();
    const currency = user?.currency || 'EUR';
    const categoryLabel = (value: string) => t(`budget:categories.${value}`, { defaultValue: value });

    const [start, setStart] = useState(monthStart);
    const [end, setEnd] = useState(today);
    const [data, setData] = useState<BudgetAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const cur = useCallback((value: number) => formatCurrency(value, currency), [currency]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(false);
        try {
            const res = await api.get<{ success: boolean; data: BudgetAnalytics }>(
                `/api/budget-analytics/overview?start=${start}&end=${end}`
            );
            if (res.success && isAnalytics(res.data)) {
                setData(res.data);
            } else {
                setError(true);
            }
        } catch (err) {
            console.error('Failed to load budget analytics:', err);
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [start, end]);

    useEffect(() => { void load(); }, [load]);

    const rangeValid = useMemo(
        () => /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end,
        [start, end]
    );

    const preset = (from: string, to: string) => {
        setStart(from);
        setEnd(to);
    };

    const monthChart = (data?.byMonth ?? []).map((m) => ({
        label: format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)) - 1), 'MMM yy', { locale: dateLocale() }),
        income: m.income,
        expenses: m.expenses,
    }));

    const weekdayChart = (data?.byWeekday ?? []).map((d) => ({
        label: weekdayLabel(d.weekday),
        expenses: d.expenses,
    }));

    if (!isModuleEnabled('budgetAnalytics')) return null;

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <Link to="/budget" className="mb-1 inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" />
                        {t('analytics.custom:back')}
                    </Link>
                    <h1 className="text-h1">{t('analytics.custom:title')}</h1>
                    <p className="text-muted-foreground text-body">{t('analytics.custom:subtitle')}</p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-6 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-input border border-border bg-surface-1 px-3 py-2 text-sm font-medium active:scale-95 transition-transform"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    {t('common:actions.refresh', { defaultValue: 'Refresh' })}
                </button>
            </div>

            <Card>
                <CardContent className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <DatePicker label={t('analytics.custom:range.from')} value={start} onChange={setStart} max={end} />
                        <DatePicker label={t('analytics.custom:range.to')} value={end} onChange={setEnd} min={start} max={today()} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption text-muted-foreground">{t('analytics.custom:range.presets')}</span>
                        <button type="button" onClick={() => preset(monthStart(), today())} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-caption font-medium active:scale-95 transition-transform">
                            {t('analytics.custom:range.month')}
                        </button>
                        <button type="button" onClick={() => preset(daysAgo(29), today())} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-caption font-medium active:scale-95 transition-transform">
                            {t('analytics.custom:range.last30')}
                        </button>
                        <button type="button" onClick={() => preset(yearStart(), today())} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-caption font-medium active:scale-95 transition-transform">
                            {t('analytics.custom:range.year')}
                        </button>
                    </div>
                    {!rangeValid && (
                        <p className="text-caption text-danger">{t('analytics.custom:range.invalid')}</p>
                    )}
                </CardContent>
            </Card>

            {loading && !data ? (
                <div className="flex items-center justify-center py-16">
                    <div className="spinner-brand" />
                </div>
            ) : error || !data ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">{t('analytics.custom:states.error')}</CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                            { label: t('analytics.custom:totals.income'), value: cur(data.totals.income), tone: 'text-success' },
                            { label: t('analytics.custom:totals.expenses'), value: cur(data.totals.expenses), tone: 'text-danger' },
                            { label: t('analytics.custom:totals.balance'), value: cur(data.totals.balance), tone: data.totals.balance >= 0 ? 'text-success' : 'text-danger' },
                            { label: t('analytics.custom:totals.count'), value: String(data.totals.count), tone: 'text-foreground' },
                        ].map((card) => (
                            <Card key={card.label}>
                                <CardContent className="p-4">
                                    <p className="text-caption text-muted-foreground">{card.label}</p>
                                    <p className={`mt-1 text-2xl font-bold tracking-tight ${card.tone}`}>{card.value}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Card>
                        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
                            <div>
                                <p className="text-caption text-muted-foreground">{t('analytics.custom:split.title')}</p>
                                <div className="mt-1 flex items-baseline gap-4">
                                    <span className="text-sm">
                                        {t('analytics.custom:split.actual')} <strong>{cur(data.split.actual.expenses)}</strong>
                                    </span>
                                    <span className="text-sm">
                                        {t('analytics.custom:split.recurring')} <strong>{cur(data.split.recurring.expenses)}</strong>
                                    </span>
                                </div>
                            </div>
                            {data.pace && (
                                <div>
                                    <p className="text-caption text-muted-foreground">{t('analytics.custom:pace.title')}</p>
                                    <p className="mt-1 text-sm">
                                        {t('analytics.custom:pace.subtitle', { elapsed: data.pace.daysElapsed, total: data.pace.daysTotal })}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {t('analytics.custom:pace.daily')}: <strong className="text-foreground">{cur(data.pace.dailyAverage)}</strong>
                                        {' · '}
                                        {t('analytics.custom:pace.projected')}: <strong className="text-foreground">{cur(data.pace.projectedExpenses)}</strong>
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {data.byDay.length > 1 && (
                        <ChartCard title={t('analytics.custom:charts.cumulative')} subtitle={`${start} → ${end}`}>
                            <ResponsiveContainer width="100%" height={240}>
                                <LineChart data={data.byDay.map((d) => ({ date: d.date, balance: d.cumulativeBalance, expenses: d.cumulativeExpenses }))}>
                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
                                    <YAxis tick={{ fontSize: 11 }} width={50} />
                                    <Tooltip formatter={(v: number) => cur(v)} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Line type="monotone" dataKey="balance" name={t('analytics.custom:charts.balance')} stroke="#3b82f6" dot={false} />
                                    <Line type="monotone" dataKey="expenses" name={t('analytics.custom:charts.expenses')} stroke="#ef4444" dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    )}

                    {monthChart.length > 0 && (
                        <ChartCard title={t('analytics.custom:charts.monthly')}>
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={monthChart}>
                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} width={50} />
                                    <Tooltip formatter={(v: number) => cur(v)} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="income" name={t('analytics.custom:charts.income')} fill="#10b981" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="expenses" name={t('analytics.custom:charts.expenses')} fill="#ef4444" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    )}

                    <ChartCard title={t('analytics.custom:charts.weekday')}>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={weekdayChart}>
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} width={50} />
                                <Tooltip formatter={(v: number) => cur(v)} />
                                <Bar dataKey="expenses" name={t('analytics.custom:charts.expenses')} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartCard>

                    <ChartCard title={t('analytics.custom:categories.title')}>
                        {data.byCategory.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.custom:states.empty')}</p>
                        ) : (
                            <div className="space-y-3">
                                {data.byCategory.map((row) => (
                                    <div key={row.category}>
                                        <div className="mb-1 flex items-center justify-between text-sm">
                                            <span className="font-medium">{categoryLabel(row.category)}</span>
                                            <span className="text-muted-foreground">
                                                {cur(row.expenses)} · {Math.round(row.share * 100)}% · {t('analytics.custom:categories.count', { count: row.count })}
                                            </span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                                            <div className="h-full rounded-full bg-primary/100" style={{ width: `${Math.min(row.share * 100, 100)}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ChartCard>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <ChartCard title={t('analytics.custom:members.title')} subtitle={t('analytics.custom:members.note')}>
                            {data.byMember.length === 0 ? (
                                <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.custom:states.empty')}</p>
                            ) : (
                                <div className="space-y-2">
                                    {data.byMember.map((member) => (
                                        <div key={member.id} className="flex items-center justify-between text-sm">
                                            <span className="flex items-center gap-2">
                                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: member.color || '#94a3b8' }} />
                                                {member.name}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {cur(member.expenses)} · {t('analytics.custom:categories.count', { count: member.count })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ChartCard>

                        <ChartCard title={t('analytics.custom:merchants.title')}>
                            {data.byMerchant.length === 0 ? (
                                <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.custom:merchants.empty')}</p>
                            ) : (
                                <div className="space-y-2">
                                    {data.byMerchant.map((merchant) => (
                                        <div key={merchant.merchant} className="flex items-center justify-between text-sm">
                                            <span className="truncate font-medium">{merchant.merchant}</span>
                                            <span className="flex-shrink-0 text-muted-foreground">
                                                {cur(merchant.expenses)} · {t('analytics.custom:categories.count', { count: merchant.count })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ChartCard>
                    </div>
                </>
            )}
        </div>
    );
};

export default BudgetAnalyticsPage;
