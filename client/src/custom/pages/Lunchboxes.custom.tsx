import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Plus,
    ChevronLeft,
    ChevronRight,
    Edit2,
    Trash2,
    Sandwich,
    ShoppingBasket,
    Sparkles,
    Loader2,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, subDays } from 'date-fns';
import { api } from '../../lib/api';
import { dateLocale, weekStartsOn } from '../../i18n/format';
import { useAuth } from '../../contexts/AuthContext';
import { useAiEnabled } from '../../lib/aiStatus';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { Button, Card, CardContent, Dialog, Input, Select, Tabs, Textarea, useToast } from '../../components/ui';
import { LunchboxAiDialog, type LunchboxIdea } from '../components/LunchboxAiDialog.custom';
import { NutritionAnalysisDialog } from '../components/NutritionAnalysisDialog.custom';

// Lunchboxes — the KeurTonux feature this fork borrowed: one child, one day,
// four components (main / fruit / snack / drink) plus notes.
//
// It is a custom page rather than a tab inside the upstream meal planner on
// purpose: the planner is an upstream file, and this fork's rule is one marked
// hook per upstream file at most. The two features share the calendar idea and
// nothing else — meals belong to the household, a lunchbox belongs to a child.
//
// Monitoring and the shopping list read the same table; the nutrition analysis
// sends the week's meals *and* these lunchboxes to the model.

interface FamilyMember {
    id: string;
    name: string;
    color: string | null;
}

interface LunchboxItems {
    main?: string;
    fruit?: string;
    snack?: string;
    drink?: string;
}

interface Lunchbox {
    id: string;
    date: string;
    family_member_id: string;
    family_member: { id: string; name: string; color: string | null };
    items: LunchboxItems;
    notes: string | null;
}

interface LunchboxStats {
    totalLunchboxes: number;
    byField: Record<'main' | 'fruit' | 'snack' | 'drink', Array<{ label: string; count: number }>>;
}

const FIELDS = ['main', 'fruit', 'snack', 'drink'] as const;

const emptyForm = { family_member_id: '', main: '', fruit: '', snack: '', drink: '', notes: '' };

/** The API type is a promise, not a guarantee: a demo fallback or a proxy error must not crash the page. */
const isLunchboxList = (value: unknown): value is Lunchbox[] => Array.isArray(value);

const Lunchboxes: React.FC = () => {
    const { t } = useTranslation(['lunchbox.custom', 'common', 'ai']);
    const { showToast } = useToast();
    const { isModuleEnabled } = useAuth();
    const aiEnabled = useAiEnabled();
    const aiAvailable = aiEnabled && isModuleEnabled('ai');

    const [week, setWeek] = useState(new Date());
    const [lunchboxes, setLunchboxes] = useState<Lunchbox[]>([]);
    const [members, setMembers] = useState<FamilyMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [generatingList, setGeneratingList] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Lunchbox | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    const [nutritionOpen, setNutritionOpen] = useState(false);

    const weekStart = useMemo(() => startOfWeek(week, { weekStartsOn: weekStartsOn() }), [week]);
    const weekEnd = useMemo(() => endOfWeek(week, { weekStartsOn: weekStartsOn() }), [week]);
    const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);
    const startIso = format(weekStart, 'yyyy-MM-dd');
    const endIso = format(weekEnd, 'yyyy-MM-dd');

    const loadLunchboxes = useCallback(async () => {
        try {
            const response = await api.get<{ success: boolean; data: Lunchbox[] }>(
                `/api/lunchbox?start_date=${startIso}&end_date=${endIso}`,
            );
            if (response.success && isLunchboxList(response.data)) {
                setLunchboxes(response.data);
                setError('');
            } else {
                setError(t('lunchbox.custom:errors.load'));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('lunchbox.custom:errors.load'));
        } finally {
            setLoading(false);
        }
    }, [startIso, endIso, t]);

    useEffect(() => {
        void loadLunchboxes();
    }, [loadLunchboxes]);

    useEffect(() => {
        api.get<{ success: boolean; data: FamilyMember[] }>('/api/family')
            .then((response) => {
                if (response.success && Array.isArray(response.data)) setMembers(response.data);
            })
            .catch((err) => console.warn('Failed to load family members', err));
    }, []);

    useWebSocketUpdates('meal-plans', () => void loadLunchboxes());

    const byDay = useMemo(() => {
        const map = new Map<string, Lunchbox[]>();
        for (const lunchbox of lunchboxes) {
            const key = lunchbox.date.slice(0, 10);
            const list = map.get(key);
            if (list) list.push(lunchbox);
            else map.set(key, [lunchbox]);
        }
        return map;
    }, [lunchboxes]);

    const openNew = (date: Date, presetMemberId?: string) => {
        setEditing(null);
        setSelectedDate(date);
        setForm({ ...emptyForm, family_member_id: presetMemberId ?? members[0]?.id ?? '' });
        setError('');
        setFormOpen(true);
    };

    const openEdit = (lunchbox: Lunchbox, date: Date) => {
        setEditing(lunchbox);
        setSelectedDate(date);
        setForm({
            family_member_id: lunchbox.family_member_id,
            main: lunchbox.items.main ?? '',
            fruit: lunchbox.items.fruit ?? '',
            snack: lunchbox.items.snack ?? '',
            drink: lunchbox.items.drink ?? '',
            notes: lunchbox.notes ?? '',
        });
        setError('');
        setFormOpen(true);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedDate) return;
        if (!form.family_member_id) {
            setError(t('lunchbox.custom:errors.selectChild'));
            return;
        }
        const items = { main: form.main, fruit: form.fruit, snack: form.snack, drink: form.drink };
        if (!Object.values(items).some((value) => value.trim())) {
            setError(t('lunchbox.custom:errors.emptyBox'));
            return;
        }

        setSaving(true);
        setError('');
        try {
            const payload = {
                date: format(selectedDate, 'yyyy-MM-dd'),
                family_member_id: form.family_member_id,
                items,
                notes: form.notes.trim() || null,
            };
            if (editing) await api.put(`/api/lunchbox/${editing.id}`, payload);
            else await api.post('/api/lunchbox', payload);
            setFormOpen(false);
            await loadLunchboxes();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('lunchbox.custom:errors.save'));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (lunchbox: Lunchbox) => {
        if (!window.confirm(t('lunchbox.custom:confirmDelete'))) return;
        try {
            await api.delete(`/api/lunchbox/${lunchbox.id}`);
            await loadLunchboxes();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('lunchbox.custom:errors.delete'));
        }
    };

    // Pre-fills the form with an AI idea; the reasoning stays with the box as a
    // note so the parent still has it in the morning.
    const applyIdea = (idea: LunchboxIdea) => {
        const notes = [form.notes.trim(), idea.reasoning].filter(Boolean).join('\n');
        setForm((previous) => ({
            ...previous,
            main: idea.main || previous.main,
            fruit: idea.fruit || previous.fruit,
            snack: idea.snack || previous.snack,
            drink: idea.drink || previous.drink,
            notes,
        }));
        setAiOpen(false);
    };

    const addToShoppingList = async () => {
        setGeneratingList(true);
        setError('');
        try {
            const response = await api.post<{
                success: boolean;
                data: { created: number; skipped: number; total_lunchboxes: number };
            }>('/api/lunchbox/shopping-list', { start_date: startIso, end_date: endIso });

            if (response.data.total_lunchboxes === 0) {
                showToast({ title: t('lunchbox.custom:shopping.empty') });
            } else if (response.data.created === 0) {
                showToast({
                    title: t('lunchbox.custom:shopping.alreadyThere'),
                    description: t('lunchbox.custom:shopping.skipped', {
                        count: response.data.skipped,
                    }),
                });
            } else {
                showToast({
                    title: t('lunchbox.custom:shopping.added', { count: response.data.created }),
                    description:
                        response.data.skipped > 0
                            ? t('lunchbox.custom:shopping.skipped', { count: response.data.skipped })
                            : undefined,
                });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('lunchbox.custom:errors.shopping'));
        } finally {
            setGeneratingList(false);
        }
    };

    const planningTab = (
        <div className="space-y-4">
            <Card>
                <CardContent className="p-4 md:p-6">
                    <div className="overflow-x-auto">
                        <div className="min-w-[720px]">
                            <div className="mb-2 grid grid-cols-8 gap-2">
                                <div />
                                {days.map((day) => (
                                    <div key={day.toISOString()} className="text-center">
                                        <div className="text-body-sm font-semibold">
                                            {format(day, 'EEE', { locale: dateLocale() })}
                                        </div>
                                        <div className="text-label text-muted-foreground">
                                            {format(day, 'dd MMM', { locale: dateLocale() })}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-8 gap-2">
                                <div className="flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground">
                                    <Sandwich className="h-4 w-4" />
                                    {t('lunchbox.custom:grid.label')}
                                </div>
                                {days.map((day) => {
                                    const boxes = byDay.get(format(day, 'yyyy-MM-dd')) ?? [];
                                    const freeMember =
                                        members.find((member) => !boxes.some((box) => box.family_member_id === member.id)) ??
                                        members[0];
                                    return (
                                        <div
                                            key={day.toISOString()}
                                            className="min-h-[96px] space-y-1 rounded-lg border border-border bg-surface p-2"
                                        >
                                            {boxes.map((box) => (
                                                <div
                                                    key={box.id}
                                                    className="group rounded-md bg-card/70 px-1.5 py-1"
                                                >
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                                                            style={{ background: box.family_member.color ?? '#999' }}
                                                        />
                                                        <span className="truncate text-[11px] font-medium">
                                                            {box.family_member.name}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => openEdit(box, day)}
                                                            className="ml-auto p-0.5 opacity-60 transition-opacity hover:opacity-100"
                                                            aria-label={t('common:actions.edit')}
                                                        >
                                                            <Edit2 className="h-3 w-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void remove(box)}
                                                            className="p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                                                            aria-label={t('common:actions.delete')}
                                                        >
                                                            <Trash2 className="h-3 w-3 text-destructive" />
                                                        </button>
                                                    </div>
                                                    <div className="line-clamp-2 text-[10px] text-muted-foreground">
                                                        {FIELDS.map((field) => box.items[field])
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => openNew(day, freeMember?.id)}
                                                disabled={members.length === 0}
                                                className="flex w-full items-center justify-center py-1 opacity-50 transition-opacity hover:opacity-100 disabled:opacity-20"
                                                aria-label={t('lunchbox.custom:grid.add')}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {members.length === 0 ? (
                        <p className="mt-3 text-micro text-muted-foreground">
                            {t('lunchbox.custom:grid.noMembers')}
                        </p>
                    ) : (
                        <div className="mt-4 flex justify-end">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => void addToShoppingList()}
                                disabled={generatingList}
                            >
                                {generatingList ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <ShoppingBasket className="mr-2 h-4 w-4" />
                                )}
                                {t('lunchbox.custom:shopping.button')}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-h1 mb-1">{t('lunchbox.custom:title')}</h1>
                    <p className="text-body text-muted-foreground">{t('lunchbox.custom:subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setWeek(subWeeks(week, 1))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setWeek(new Date())}>
                        {t('lunchbox.custom:thisWeek')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setWeek(addWeeks(week, 1))}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    {aiAvailable && (
                        <Button size="sm" onClick={() => setNutritionOpen(true)}>
                            <Sparkles className="mr-1.5 h-4 w-4" />
                            {t('lunchbox.custom:nutrition.button')}
                        </Button>
                    )}
                </div>
            </div>

            <p className="text-caption text-muted-foreground">
                {t('lunchbox.custom:weekOf', {
                    start: format(weekStart, 'dd MMM', { locale: dateLocale() }),
                    end: format(weekEnd, 'dd MMM yyyy', { locale: dateLocale() }),
                })}
            </p>

            {error && (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex min-h-[40vh] items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="spinner-brand" />
                        <p className="font-medium text-muted-foreground">{t('common:states.loading')}</p>
                    </div>
                </div>
            ) : (
                <Tabs
                    tabs={[
                        { value: 'planning', label: t('lunchbox.custom:tabs.planning'), content: planningTab },
                        {
                            value: 'tracking',
                            label: t('lunchbox.custom:tabs.tracking'),
                            content: <LunchboxTracking members={members} />,
                        },
                    ]}
                />
            )}

            <Dialog
                open={formOpen}
                onOpenChange={setFormOpen}
                title={t(editing ? 'lunchbox.custom:form.editTitle' : 'lunchbox.custom:form.newTitle')}
                description={
                    selectedDate
                        ? t('lunchbox.custom:form.description', {
                              date: format(selectedDate, 'EEEE dd MMMM yyyy', { locale: dateLocale() }),
                          })
                        : ''
                }
            >
                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-label font-medium text-foreground">
                            {t('lunchbox.custom:form.child')}
                        </label>
                        <Select
                            value={form.family_member_id}
                            onValueChange={(value) => setForm({ ...form, family_member_id: value })}
                            options={members.map((member) => ({ value: member.id, label: member.name }))}
                        />
                    </div>

                    {aiAvailable && (
                        <div className="flex items-center justify-between gap-3 rounded-input border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
                            <p className="text-label-sm text-muted-foreground">
                                {t('lunchbox.custom:form.aiPrompt')}
                            </p>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => setAiOpen(true)}
                                disabled={!form.family_member_id}
                            >
                                <Sparkles className="mr-1.5 h-4 w-4" />
                                {t('lunchbox.custom:form.suggest')}
                            </Button>
                        </div>
                    )}

                    {FIELDS.map((field) => (
                        <Input
                            key={field}
                            label={t(`lunchbox.custom:form.${field}`)}
                            value={form[field]}
                            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                            placeholder={t(`lunchbox.custom:form.${field}Placeholder`)}
                        />
                    ))}

                    <Textarea
                        label={t('lunchbox.custom:form.notes')}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder={t('lunchbox.custom:form.notesPlaceholder')}
                        rows={2}
                    />

                    <div className="flex justify-end gap-3 pt-4">
                        <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                            {t('common:actions.cancel')}
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving
                                ? t('common:states.saving')
                                : t(editing ? 'common:actions.save' : 'lunchbox.custom:form.prepare')}
                        </Button>
                    </div>
                </form>
            </Dialog>

            <LunchboxAiDialog
                open={aiOpen}
                onOpenChange={setAiOpen}
                familyMember={members.find((member) => member.id === form.family_member_id) ?? null}
                onIdeaApplied={applyIdea}
            />

            <NutritionAnalysisDialog
                open={nutritionOpen}
                onOpenChange={setNutritionOpen}
                weekStart={startIso}
                weekEnd={endIso}
            />
        </div>
    );
};

// -------- Tracking: what one child actually eats --------

const LunchboxTracking: React.FC<{ members: FamilyMember[] }> = ({ members }) => {
    const { t } = useTranslation(['lunchbox.custom', 'common']);
    const [memberId, setMemberId] = useState('');
    const [history, setHistory] = useState<Lunchbox[]>([]);
    const [stats, setStats] = useState<LunchboxStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (members.length > 0 && !memberId) setMemberId(members[0].id);
    }, [members, memberId]);

    useEffect(() => {
        if (!memberId) return;
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            // Both bounds pinned so "last 60 days" cannot drift around midnight.
            const end = new Date();
            try {
                const [historyResponse, statsResponse] = await Promise.all([
                    api.get<{ success: boolean; data: Lunchbox[] }>(`/api/lunchbox/history/${memberId}?limit=30`),
                    api.get<{ success: boolean; data: LunchboxStats }>(
                        `/api/lunchbox/stats/${memberId}?start_date=${format(subDays(end, 60), 'yyyy-MM-dd')}&end_date=${format(end, 'yyyy-MM-dd')}`,
                    ),
                ]);
                if (cancelled) return;
                if (historyResponse.success) setHistory(historyResponse.data);
                if (statsResponse.success) setStats(statsResponse.data);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : t('lunchbox.custom:tracking.loadError'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [memberId, t]);

    const selected = members.find((member) => member.id === memberId);

    if (members.length === 0) {
        return (
            <Card>
                <CardContent className="p-6 text-center text-caption text-muted-foreground">
                    {t('lunchbox.custom:tracking.noMembers')}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
                {members.map((member) => (
                    <button
                        key={member.id}
                        type="button"
                        onClick={() => setMemberId(member.id)}
                        className={`flex items-center gap-2 rounded-pill border px-3 py-1.5 text-caption font-medium transition-colors ${
                            memberId === member.id
                                ? 'border-primary bg-primary text-white'
                                : 'border-border bg-card text-foreground hover:bg-surface-2'
                        }`}
                    >
                        <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: member.color ?? '#999' }}
                        />
                        {member.name}
                    </button>
                ))}
            </div>

            {error && (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {error}
                </div>
            )}

            {loading && (
                <div className="flex items-center justify-center gap-3 py-6 text-caption text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common:states.loading')}
                </div>
            )}

            {!loading && selected && (
                <>
                    <Card>
                        <CardContent className="p-6">
                            <h3 className="mb-4 text-h2 font-semibold">{t('lunchbox.custom:tracking.frequent')}</h3>
                            {stats && stats.totalLunchboxes > 0 ? (
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    {FIELDS.map((field) => (
                                        <div key={field} className="space-y-2">
                                            <p className="text-caption font-semibold">
                                                {t(`lunchbox.custom:form.${field}`)}
                                            </p>
                                            {stats.byField[field].length === 0 ? (
                                                <p className="text-micro text-muted-foreground">
                                                    {t('lunchbox.custom:tracking.nothingYet')}
                                                </p>
                                            ) : (
                                                <ul className="space-y-1">
                                                    {stats.byField[field].slice(0, 5).map((row) => (
                                                        <li
                                                            key={row.label}
                                                            className="flex items-center justify-between rounded-input bg-surface-2 px-3 py-1.5 text-caption"
                                                        >
                                                            <span>{row.label}</span>
                                                            <span className="text-micro text-muted-foreground">
                                                                × {row.count}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-caption text-muted-foreground">
                                    {t('lunchbox.custom:tracking.none')}
                                </p>
                            )}
                            {stats && (
                                <p className="mt-4 text-micro text-muted-foreground">
                                    {t('lunchbox.custom:tracking.total', { count: stats.totalLunchboxes })}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-6">
                            <h3 className="mb-4 text-h2 font-semibold">{t('lunchbox.custom:tracking.history')}</h3>
                            {history.length === 0 ? (
                                <p className="text-caption text-muted-foreground">
                                    {t('lunchbox.custom:tracking.noHistory', { name: selected.name })}
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {history.map((box) => (
                                        <li key={box.id} className="rounded-card border border-border bg-card p-3">
                                            <span className="text-caption font-semibold">
                                                {format(new Date(`${box.date}T12:00:00`), 'EEEE dd MMM yyyy', {
                                                    locale: dateLocale(),
                                                })}
                                            </span>
                                            <div className="mt-1 text-micro text-muted-foreground">
                                                {FIELDS.map((field) => box.items[field]).filter(Boolean).join(' · ') || '—'}
                                            </div>
                                            {box.notes && (
                                                <div className="mt-1 text-micro italic text-muted-foreground">
                                                    {box.notes}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
};

export default Lunchboxes;
