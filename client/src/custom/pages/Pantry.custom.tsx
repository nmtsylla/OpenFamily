import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, Plus, Edit2, Trash2, ShoppingBasket, Download, Loader2, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { joinAliases, splitAliases } from '../lib/productNames.custom';
import { useAuth } from '../../contexts/AuthContext';
import { useCategories } from '../../hooks/useCategories';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { Badge, Button, Card, CardContent, Dialog, Input, Select, Tabs, Textarea, useToast } from '../../components/ui';
import { recipeCoverage } from '../lib/pantryMatch.custom';
import { daysUntil } from '../lib/pantryDates.custom';

// The pantry — what the household actually has at home.
//
// Four tabs over one table: everything, what is low, what expires within the
// window, and what can be cooked with it. The page is also the meeting point of
// the three bridges: the upstream shopping list (both ways), an imported
// receipt's lines, and the family's Grocy stock (read only).
//
// The upstream Tabs component is UNCONTROLLED (Radix, defaultValue only), so the
// page never reads the active tab: each tab's content is a child that fetches
// its own filtered slice on mount (Radix mounts only the active panel) and
// re-fetches when the page bumps `token` after a mutation.
//
// Location and bucket values are DATA (the server validates them); only their
// labels are translated, from this page's own namespace.

interface PantryItem {
    id: string;
    name: string;
    category: string;
    quantity: number;
    unit: string | null;
    location: string;
    expires_on: string | null;
    low_stock_threshold: number | null;
    lunchbox_bucket: string | null;
    notes: string | null;
    source: string;
}

interface ShoppingItem {
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    category: string;
    is_checked: boolean;
}

interface Recipe {
    id: string;
    name: string;
    ingredients: string[];
}

/**
 * A receipt line the import did NOT stock by itself: the family names it (or
 * ignores it) here. The printed label is shown as-is, the fields are the ones
 * the AI proposed, editable.
 */
interface PendingLine {
    id: string;
    label: string;
    item: string;
    quantity: string;
    unit: string;
    category: string;
    merchant: string | null;
    date: string | null;
    /**
     * The ticket did not say how much this line holds: the pack count the
     * import read is not an amount, so the field starts empty and the family
     * must give one (the server refuses the confirm without it).
     */
    needs_amount: boolean;
}

/**
 * A queued line whose amount the family has not given yet: nothing can be added
 * until it holds a positive number.
 */
const amountMissing = (line: PendingLine): boolean =>
    line.needs_amount === true && !(Number(line.quantity) > 0);

// Mirrors server/src/custom/lib/pantry.custom.ts: the client never imports server code.
const LOCATIONS = ['pantry', 'fridge', 'freezer', 'cellar', 'other'] as const;
const BUCKETS = ['main', 'fruit', 'snack', 'drink'] as const;
const EXPIRY_DAYS = 14;

const emptyForm = {
    name: '',
    alsoCalled: '',
    category: '',
    quantity: '1',
    unit: '',
    location: 'pantry',
    expires_on: '',
    low_stock_threshold: '',
    lunchbox_bucket: '',
    notes: '',
};

const Spinner: React.FC = () => (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
    </div>
);

/** One tab's slice of the pantry: GET /api/pantry with its own filter. */
const PantrySection: React.FC<{
    filter: string;
    emptyKey: string;
    token: number;
    withDayHint?: boolean;
    onEdit: (item: PantryItem) => void;
    onDelete: (item: PantryItem) => void;
}> = ({ filter, emptyKey, token, withDayHint, onEdit, onDelete }) => {
    const { t } = useTranslation('pantry.custom');
    const [items, setItems] = useState<PantryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Client-side search over the already-fetched slice: the API returns the
    // whole (filtered) list, so a round-trip per keystroke would buy nothing.
    const [query, setQuery] = useState('');

    const load = useCallback(async () => {
        try {
            const query = filter ? `?filter=${filter}&days=${EXPIRY_DAYS}` : '';
            const response = await api.get<{ success: boolean; data: { items: PantryItem[] } }>(`/api/pantry${query}`);
            if (response.success && Array.isArray(response.data?.items)) {
                setItems(response.data.items);
                setError('');
            } else {
                setError(t('errors.load'));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('errors.load'));
        } finally {
            setLoading(false);
        }
    }, [filter, t]);

    useEffect(() => {
        void load();
    }, [load, token]);

    useWebSocketUpdates('shopping', () => void load());

    // Search matches the name or the category, case-insensitively.
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle === '') return items;
        return items.filter(
            (item) =>
                item.name.toLowerCase().includes(needle) || item.category.toLowerCase().includes(needle),
        );
    }, [items, query]);

    const expiryLabel = (item: PantryItem): { text: string; variant: 'warning' | 'danger' } | null => {
        if (!item.expires_on) return null;
        const days = daysUntil(item.expires_on);
        if (days < 0) return { text: t('list.expired'), variant: 'danger' };
        if (days === 0) return { text: t('list.expiresToday'), variant: 'warning' };
        if (days <= EXPIRY_DAYS) return { text: t('list.expiresIn', { days }), variant: 'warning' };
        return null;
    };

    if (loading) return <Spinner />;

    return (
        <>
            {error && <p className="text-caption text-destructive">{error}</p>}
            {items.length > 0 && (
                <div className="mb-3">
                    <Input
                        type="search"
                        placeholder={t('filters.search')}
                        aria-label={t('filters.search')}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </div>
            )}
            {withDayHint && (
                <p className="mb-2 text-micro text-muted-foreground">{t('filters.days', { days: EXPIRY_DAYS })}</p>
            )}
            {items.length === 0 ? (
                // A failed load already says so above; it is not "empty".
                error ? null : (
                    <p className="py-8 text-center text-caption text-muted-foreground">{t(emptyKey)}</p>
                )
            ) : visible.length === 0 ? (
                <p className="py-8 text-center text-caption text-muted-foreground">{t('list.noMatch')}</p>
            ) : (
                <ul className="divide-y divide-border">
                    {visible.map((item) => {
                        const expiry = expiryLabel(item);
                        const low = item.low_stock_threshold !== null && item.quantity <= item.low_stock_threshold;
                        return (
                            <li key={item.id} className="flex items-center gap-3 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-foreground">{item.name}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                                        <span>
                                            {t('list.quantity')} {item.quantity}
                                            {item.unit ? ` ${item.unit}` : ''}
                                        </span>
                                        <span>·</span>
                                        <span>{t(`locations.${item.location}`, { defaultValue: item.location })}</span>
                                        <span>·</span>
                                        <span>{t(`list.source.${item.source}`, { defaultValue: item.source })}</span>
                                        {low && <Badge variant="warning">{t('list.lowStock')}</Badge>}
                                        {expiry && <Badge variant={expiry.variant}>{expiry.text}</Badge>}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onEdit(item)}
                                    aria-label={t('actions.edit')}
                                    className="rounded-input p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                                >
                                    <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onDelete(item)}
                                    aria-label={t('actions.delete')}
                                    className="rounded-input p-2 text-muted-foreground hover:bg-surface-2 hover:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
};

/** The Cook tab: every recipe, scored against the WHOLE pantry (not a filter). */
const CookSection: React.FC<{ token: number }> = ({ token }) => {
    const { t } = useTranslation('pantry.custom');
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [names, setNames] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            api.get<{ success: boolean; data: Recipe[] }>('/api/recipes'),
            api.get<{ success: boolean; data: { items: PantryItem[] } }>('/api/pantry'),
        ])
            .then(([recipeResponse, pantryResponse]) => {
                if (cancelled) return;
                if (recipeResponse.success && Array.isArray(recipeResponse.data)) setRecipes(recipeResponse.data);
                setNames((pantryResponse.data?.items ?? []).map((item) => item.name));
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const cookable = useMemo(
        () =>
            recipes
                .map((recipe) => ({ recipe, ...recipeCoverage(recipe.ingredients ?? [], names) }))
                .filter((entry) => entry.covered > 0)
                .sort(
                    (a, b) =>
                        Number(b.cookable) - Number(a.cookable) ||
                        b.covered - a.covered ||
                        a.recipe.name.localeCompare(b.recipe.name),
                ),
        [recipes, names],
    );

    if (loading) return <Spinner />;

    return (
        <>
            <h2 className="flex items-center gap-2 text-h2 font-semibold">
                <Sparkles className="h-5 w-5 text-primary" />
                {t('cook.title')}
            </h2>
            <p className="mt-1 text-micro text-muted-foreground">{t('cook.subtitle')}</p>
            {cookable.length === 0 ? (
                <p className="py-8 text-center text-caption text-muted-foreground">{t('cook.none')}</p>
            ) : (
                <ul className="mt-4 divide-y divide-border">
                    {cookable.map(({ recipe, covered, total }) => (
                        <li key={recipe.id} className="flex items-center gap-3 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-foreground">{recipe.name}</p>
                                <p className="text-micro text-muted-foreground">
                                    {t('cook.cover', { covered, total })}
                                </p>
                            </div>
                            <Link to="/recipes" className="text-caption text-primary underline">
                                {t('cook.openRecipe')}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
};

const Pantry: React.FC = () => {
    const { t } = useTranslation(['pantry.custom', 'common']);
    const { showToast } = useToast();
    const { isModuleEnabled, user } = useAuth();
    const { categories } = useCategories();
    // Same rule as the budget page: children are read-only for the actions the
    // server gates with requireParent.
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';

    // Bumped after every mutation: each panel re-fetches on it.
    const [token, setToken] = useState(0);
    const [busy, setBusy] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<PantryItem | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const [stockOpen, setStockOpen] = useState(false);
    const [stockLines, setStockLines] = useState<
        Array<{ id: string; name: string; quantity: string; unit: string | null; category: string }>
    >([]);

    // Receipt lines waiting for a name: the import stocks the obvious products
    // and queues the rest here, so nothing enters the pantry on a guess.
    const [pendingOpen, setPendingOpen] = useState(false);
    const [pending, setPending] = useState<PendingLine[]>([]);
    const [pendingBusy, setPendingBusy] = useState<string | null>(null);

    const reload = () => setToken((previous) => previous + 1);

    useEffect(() => {
        api.get<{ success: boolean; data: { items: PendingLine[] } }>('/api/pantry/pending')
            .then((response) => {
                setPending((response.data?.items ?? []).map((line) => ({
                    ...line,
                    // A line whose amount the ticket did not print starts empty:
                    // the pack count would be read as the amount.
                    quantity: line.needs_amount ? '' : String(line.quantity),
                    unit: line.unit ?? '',
                })));
            })
            // A queue nobody can read is not worth an error banner: the pantry
            // itself already reports its own failures.
            .catch(() => undefined);
    }, [token]);

    // A receipt imported in another tab (or on another device) feeds this pantry
    // and this queue on the same event the panels already listen to.
    useWebSocketUpdates('shopping', reload);

    const categoryOptions = useMemo(
        () => categories.shopping.map((name) => ({ value: name, label: name })),
        [categories.shopping],
    );

    const openNew = () => {
        setEditing(null);
        setForm({ ...emptyForm, category: categories.shopping[0] ?? '' });
        setFormOpen(true);
    };

    const openEdit = (item: PantryItem) => {
        setEditing(item);
        const split = splitAliases(item.name);
        setForm({
            name: split.name,
            alsoCalled: split.aliases,
            category: item.category,
            quantity: String(item.quantity),
            unit: item.unit ?? '',
            location: item.location,
            expires_on: item.expires_on ?? '',
            low_stock_threshold: item.low_stock_threshold === null ? '' : String(item.low_stock_threshold),
            lunchbox_bucket: item.lunchbox_bucket ?? '',
            notes: item.notes ?? '',
        });
        setFormOpen(true);
    };

    const save = async () => {
        if (form.name.trim() === '') return;
        setSaving(true);
        const body = {
            name: joinAliases(form.name, form.alsoCalled),
            category: form.category,
            quantity: form.quantity === '' ? 1 : Number(form.quantity),
            unit: form.unit,
            location: form.location,
            expires_on: form.expires_on,
            low_stock_threshold: form.low_stock_threshold === '' ? null : Number(form.low_stock_threshold),
            lunchbox_bucket: form.lunchbox_bucket === '' ? null : form.lunchbox_bucket,
            notes: form.notes,
        };
        try {
            if (editing) {
                await api.put(`/api/pantry/${editing.id}`, body);
                showToast({ title: t('pantry.custom:toasts.updated') });
            } else {
                await api.post('/api/pantry', body);
                showToast({ title: t('pantry.custom:toasts.created') });
            }
            setFormOpen(false);
            reload();
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            showToast({
                title: message.includes('DUPLICATE_NAME')
                    ? t('pantry.custom:errors.duplicateName')
                    : t('pantry.custom:errors.save'),
                description: message.includes('DUPLICATE_NAME') ? undefined : message || undefined,
            });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (item: PantryItem) => {
        if (!window.confirm(t('pantry.custom:actions.delete'))) return;
        try {
            await api.delete(`/api/pantry/${item.id}`);
            showToast({ title: t('pantry.custom:toasts.deleted') });
            reload();
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.delete'), description: err instanceof Error ? err.message : undefined });
        }
    };

    const sendLowStock = async () => {
        setBusy(true);
        try {
            const response = await api.post<{ success: boolean; data: { created: number; skipped: number } }>(
                '/api/pantry/shopping-list',
                {},
            );
            showToast({
                title: t('pantry.custom:toasts.sent', {
                    count: response.data?.created ?? 0,
                    skipped: response.data?.skipped ?? 0,
                }),
            });
            reload();
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.shopping'), description: err instanceof Error ? err.message : undefined });
        } finally {
            setBusy(false);
        }
    };

    const confirmPending = async (line: PendingLine) => {
        setPendingBusy(line.id);
        try {
            await api.post(`/api/pantry/pending/${line.id}/confirm`, {
                name: line.item.trim(),
                category: line.category,
                // An empty field must reach the server as no amount at all (it
                // answers AMOUNT_REQUIRED when the line needed one).
                quantity: line.quantity === '' ? '' : Number(line.quantity),
                unit: line.unit,
            });
            showToast({ title: t('pantry.custom:toasts.created') });
            setPending((previous) => previous.filter((entry) => entry.id !== line.id));
            reload();
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            showToast({
                title: t('pantry.custom:errors.pending'),
                description: message.includes('AMOUNT_REQUIRED')
                    ? t('pantry.custom:pending.amountRequired')
                    : message.includes('UNIT_CONFLICT')
                        ? t('pantry.custom:pending.unitConflict')
                        : message || undefined,
            });
        } finally {
            setPendingBusy(null);
        }
    };

    const dismissPending = async (line: PendingLine) => {
        setPendingBusy(line.id);
        try {
            await api.delete(`/api/pantry/pending/${line.id}`);
            showToast({ title: t('pantry.custom:toasts.pendingIgnored') });
            setPending((previous) => previous.filter((entry) => entry.id !== line.id));
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.pending'), description: err instanceof Error ? err.message : undefined });
        } finally {
            setPendingBusy(null);
        }
    };

    const openStock = async () => {
        try {
            const response = await api.get<{ success: boolean; data: ShoppingItem[] }>('/api/shopping');
            const checked = (response.data ?? []).filter((item) => item.is_checked);
            setStockLines(
                checked.map((item) => ({
                    id: item.id,
                    name: item.name,
                    quantity: String(item.quantity ?? 1),
                    unit: item.unit,
                    category: item.category,
                })),
            );
            setStockOpen(true);
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.load'), description: err instanceof Error ? err.message : undefined });
        }
    };

    const confirmStock = async () => {
        setBusy(true);
        try {
            const response = await api.post<{ success: boolean; data: { created: number; updated: number } }>(
                '/api/pantry/stock',
                {
                    items: stockLines.map((line) => ({
                        name: line.name,
                        quantity: Number(line.quantity) || 1,
                        unit: line.unit,
                        category: line.category,
                    })),
                },
            );
            showToast({
                title: t('pantry.custom:toasts.stocked', {
                    created: response.data?.created ?? 0,
                    updated: response.data?.updated ?? 0,
                }),
            });
            setStockOpen(false);
            reload();
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.stock'), description: err instanceof Error ? err.message : undefined });
        } finally {
            setBusy(false);
        }
    };

    const importGrocy = async () => {
        setBusy(true);
        try {
            const response = await api.post<{ success: boolean; data: { created: number; updated: number } }>(
                '/api/pantry/import/grocy',
                {},
            );
            showToast({
                title: t('pantry.custom:toasts.importedGrocy', {
                    count: (response.data?.created ?? 0) + (response.data?.updated ?? 0),
                }),
            });
            reload();
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            showToast({
                title: message.includes('NO_GROCY_INTEGRATION')
                    ? t('pantry.custom:errors.grocyMissing')
                    : t('pantry.custom:errors.importGrocy'),
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-h1 font-semibold">
                        <Package className="h-6 w-6 text-primary" />
                        {t('pantry.custom:title')}
                    </h1>
                    <p className="mt-1 text-caption text-muted-foreground">{t('pantry.custom:subtitle')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={openNew}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('pantry.custom:actions.add')}
                    </Button>
                    <Button variant="secondary" onClick={() => void sendLowStock()} disabled={busy}>
                        <ShoppingBasket className="mr-2 h-4 w-4" />
                        {t('pantry.custom:actions.sendLowStock')}
                    </Button>
                    {isModuleEnabled('shopping') && (
                        <Button variant="secondary" onClick={() => void openStock()} disabled={busy}>
                            {t('pantry.custom:actions.stockFromShopping')}
                        </Button>
                    )}
                    {/* Server-side the Grocy import is parents-only (it fetches a
                        user-supplied host with the family's API key), so the
                        button follows the same rule as the budget page's. */}
                    {canEdit && (
                        <Button variant="secondary" onClick={() => void importGrocy()} disabled={busy}>
                            <Download className="mr-2 h-4 w-4" />
                            {t('pantry.custom:actions.importGrocy')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Receipt lines the import refused to guess at. Shown before the
                tabs: it is a to-do, not a view of the stock. */}
            {pending.length > 0 && (
                <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                        <div className="flex items-start gap-2">
                            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div>
                                <p className="text-caption font-medium text-foreground">
                                    {t('pantry.custom:pending.title', { count: pending.length })}
                                </p>
                                <p className="text-micro text-muted-foreground">{t('pantry.custom:pending.subtitle')}</p>
                            </div>
                        </div>
                        <Button variant="secondary" onClick={() => setPendingOpen(true)}>
                            {t('pantry.custom:pending.review')}
                        </Button>
                    </CardContent>
                </Card>
            )}

            <Tabs
                defaultValue="all"
                tabs={[
                    {
                        value: 'all',
                        label: t('pantry.custom:tabs.all'),
                        content: (
                            <Card>
                                <CardContent className="pt-5">
                                    <PantrySection
                                        filter=""
                                        emptyKey="pantry.custom:list.empty"
                                        token={token}
                                        onEdit={openEdit}
                                        onDelete={(item) => void remove(item)}
                                    />
                                </CardContent>
                            </Card>
                        ),
                    },
                    {
                        value: 'low',
                        label: t('pantry.custom:tabs.lowStock'),
                        content: (
                            <Card>
                                <CardContent className="pt-5">
                                    <PantrySection
                                        filter="low_stock"
                                        emptyKey="pantry.custom:list.empty"
                                        token={token}
                                        onEdit={openEdit}
                                        onDelete={(item) => void remove(item)}
                                    />
                                </CardContent>
                            </Card>
                        ),
                    },
                    {
                        value: 'expiring',
                        label: t('pantry.custom:tabs.expiring'),
                        content: (
                            <Card>
                                <CardContent className="pt-5">
                                    <PantrySection
                                        filter="expiring"
                                        emptyKey="pantry.custom:list.empty"
                                        token={token}
                                        withDayHint
                                        onEdit={openEdit}
                                        onDelete={(item) => void remove(item)}
                                    />
                                </CardContent>
                            </Card>
                        ),
                    },
                    {
                        value: 'cook',
                        label: t('pantry.custom:tabs.cook'),
                        content: (
                            <Card>
                                <CardContent className="pt-5">
                                    <CookSection token={token} />
                                </CardContent>
                            </Card>
                        ),
                    },
                ]}
            />

            <Dialog
                open={formOpen}
                onOpenChange={setFormOpen}
                title={editing ? t('pantry.custom:form.editTitle') : t('pantry.custom:form.newTitle')}
            >
                <div className="space-y-3">
                    <Input
                        label={t('pantry.custom:form.name')}
                        placeholder={t('pantry.custom:form.namePlaceholder')}
                        value={form.name}
                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                    <div>
                        <Input
                            label={t('pantry.custom:form.alsoCalled')}
                            placeholder={t('pantry.custom:form.alsoCalledPlaceholder')}
                            value={form.alsoCalled}
                            onChange={(event) => setForm({ ...form, alsoCalled: event.target.value })}
                        />
                        <p className="mt-1 text-micro text-muted-foreground">{t('pantry.custom:form.alsoCalledHint')}</p>
                    </div>
                    <Select
                        value={form.category}
                        onValueChange={(value) => setForm({ ...form, category: value })}
                        placeholder={t('pantry.custom:form.category')}
                        options={categoryOptions}
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <Input
                            type="number"
                            step="0.001"
                            label={t('pantry.custom:form.quantity')}
                            value={form.quantity}
                            onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                        />
                        <Input
                            label={t('pantry.custom:form.unit')}
                            value={form.unit}
                            onChange={(event) => setForm({ ...form, unit: event.target.value })}
                        />
                    </div>
                    <Select
                        value={form.location}
                        onValueChange={(value) => setForm({ ...form, location: value })}
                        placeholder={t('pantry.custom:form.location')}
                        options={LOCATIONS.map((value) => ({ value, label: t(`pantry.custom:locations.${value}`) }))}
                    />
                    <Input
                        type="date"
                        label={t('pantry.custom:form.expiresOn')}
                        value={form.expires_on}
                        onChange={(event) => setForm({ ...form, expires_on: event.target.value })}
                    />
                    <Input
                        type="number"
                        step="0.001"
                        label={t('pantry.custom:form.lowStockThreshold')}
                        value={form.low_stock_threshold}
                        onChange={(event) => setForm({ ...form, low_stock_threshold: event.target.value })}
                    />
                    <Select
                        value={form.lunchbox_bucket}
                        onValueChange={(value) => setForm({ ...form, lunchbox_bucket: value })}
                        placeholder={t('pantry.custom:form.bucket')}
                        options={[
                            { value: '', label: t('pantry.custom:buckets.none') },
                            ...BUCKETS.map((value) => ({ value, label: t(`pantry.custom:buckets.${value}`) })),
                        ]}
                    />
                    <Textarea
                        label={t('pantry.custom:form.notes')}
                        value={form.notes}
                        onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="secondary" onClick={() => setFormOpen(false)}>
                            {t('common:actions.cancel')}
                        </Button>
                        <Button onClick={() => void save()} disabled={saving || form.name.trim() === ''}>
                            {saving ? t('pantry.custom:form.saving') : t('pantry.custom:form.save')}
                        </Button>
                    </div>
                </div>
            </Dialog>

            <Dialog
                open={stockOpen}
                onOpenChange={setStockOpen}
                title={t('pantry.custom:stockDialog.title')}
                description={t('pantry.custom:stockDialog.description')}
            >
                {stockLines.length === 0 ? (
                    <p className="py-6 text-center text-caption text-muted-foreground">
                        {t('pantry.custom:stockDialog.empty')}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {stockLines.map((line) => (
                            <div key={line.id} className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 truncate text-caption">{line.name}</span>
                                <div className="w-24">
                                    <Input
                                        type="number"
                                        step="0.001"
                                        value={line.quantity}
                                        onChange={(event) =>
                                            setStockLines((previous) =>
                                                previous.map((entry) =>
                                                    entry.id === line.id ? { ...entry, quantity: event.target.value } : entry,
                                                ),
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        ))}
                        <div className="flex justify-end pt-2">
                            <Button onClick={() => void confirmStock()} disabled={busy}>
                                {t('pantry.custom:stockDialog.confirm')}
                            </Button>
                        </div>
                    </div>
                )}
            </Dialog>
            <Dialog
                open={pendingOpen}
                onOpenChange={setPendingOpen}
                title={t('pantry.custom:pending.dialogTitle')}
                description={t('pantry.custom:pending.dialogHint')}
            >
                {pending.length === 0 ? (
                    <p className="py-6 text-center text-caption text-muted-foreground">
                        {t('pantry.custom:pending.empty')}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {pending.map((line) => (
                            <div key={line.id} className="space-y-2 rounded-input border border-border p-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="text-caption font-medium text-foreground">
                                        {t('pantry.custom:pending.label', { label: line.label })}
                                    </span>
                                    {line.merchant && (
                                        <span className="text-micro text-muted-foreground">
                                            {line.date ? `${line.merchant} · ${line.date}` : line.merchant}
                                        </span>
                                    )}
                                </div>
                                <Input
                                    label={t('pantry.custom:form.name')}
                                    placeholder={t('pantry.custom:form.namePlaceholder')}
                                    value={line.item}
                                    onChange={(event) =>
                                        setPending((previous) =>
                                            previous.map((entry) =>
                                                entry.id === line.id ? { ...entry, item: event.target.value } : entry,
                                            ),
                                        )
                                    }
                                />
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    <Select
                                        value={line.category}
                                        onValueChange={(value) =>
                                            setPending((previous) =>
                                                previous.map((entry) =>
                                                    entry.id === line.id ? { ...entry, category: value } : entry,
                                                ),
                                            )
                                        }
                                        placeholder={t('pantry.custom:form.category')}
                                        // The line's category comes from the BUDGET list (it
                                        // was read off the ticket): keep it selectable even when
                                        // the pantry's own list does not have it, instead of
                                        // showing an empty field.
                                        options={
                                            categoryOptions.some((option) => option.value === line.category)
                                                ? categoryOptions
                                                : [{ value: line.category, label: line.category }, ...categoryOptions]
                                        }
                                    />
                                    <Input
                                        type="number"
                                        step="0.001"
                                        label={t('pantry.custom:form.quantity')}
                                        value={line.quantity}
                                        onChange={(event) =>
                                            setPending((previous) =>
                                                previous.map((entry) =>
                                                    entry.id === line.id ? { ...entry, quantity: event.target.value } : entry,
                                                ),
                                            )
                                        }
                                    />
                                    <Input
                                        label={t('pantry.custom:form.unit')}
                                        value={line.unit}
                                        onChange={(event) =>
                                            setPending((previous) =>
                                                previous.map((entry) =>
                                                    entry.id === line.id ? { ...entry, unit: event.target.value } : entry,
                                                ),
                                            )
                                        }
                                    />
                                </div>
                                {amountMissing(line) && (
                                    <p className="text-micro text-muted-foreground">
                                        {t('pantry.custom:pending.amountHint')}
                                    </p>
                                )}
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => void dismissPending(line)}
                                        disabled={pendingBusy === line.id}
                                    >
                                        {t('pantry.custom:pending.ignore')}
                                    </Button>
                                    <Button
                                        onClick={() => void confirmPending(line)}
                                        disabled={pendingBusy === line.id || line.item.trim() === '' || amountMissing(line)}
                                    >
                                        {t('pantry.custom:pending.add')}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Dialog>
        </div>
    );
};

export default Pantry;
