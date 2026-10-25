import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../lib/utils';
import { intlLocale } from '../../i18n/format';
import { Button, Card, CardContent, Dialog, Input, useToast } from '../../components/ui';
import { joinAliases, splitAliases } from '../lib/productNames.custom';

// Every product the family can name: the pantry's own rows and every receipt
// group no pantry row declares. The analytics card is a screenful about one date
// range; this page is the catalog, and its edit dialog is where a product gets its
// other names, the same "Also called" list the pantry form edits.
//
// No schema of its own: a group lives in the pantry row's name
// ('Rijst - AH Basmati - Basmati rijst'), which the receipt merge already resolves.

interface CatalogUnit {
    unit: string | null;
    content: number;
    unsized: number;
    packs: number;
}

interface CatalogProduct {
    key: string;
    /** The pantry head, or the printed spelling of an untracked product. */
    name: string;
    /** The full stored pantry name, aliases included; null when no row declares it. */
    pantryName: string | null;
    pantryItemId: string | null;
    /** Every printed spelling the receipts used. */
    names: string[];
    units: CatalogUnit[];
    amount: number;
    lines: number;
    stock: { quantity: number; unit: string | null } | null;
}

interface Questions {
    name: string;
    alsoCalled: string;
}

/** Quantities are small and may be fractional (0.5 kg): up to three decimals. */
const quantityText = (value: number) =>
    new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 3 }).format(value);

const unitsText = (units: CatalogUnit[], packsLabel: (count: string) => string): string =>
    units
        .map((bucket) =>
            bucket.unit && bucket.content > 0
                ? `${quantityText(bucket.content)} ${bucket.unit}`
                : packsLabel(quantityText(bucket.packs)))
        .join(' · ');

const ProductsPage: React.FC = () => {
    const { t } = useTranslation(['analytics.custom', 'pantry.custom', 'common']);
    const { user, isModuleEnabled } = useAuth();
    const currency = user?.currency || 'EUR';
    const { showToast } = useToast();

    const [products, setProducts] = useState<CatalogProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState<CatalogProduct | null>(null);
    const [form, setForm] = useState<Questions>({ name: '', alsoCalled: '' });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    // Multi-select for the merge: keys of the products ticked in the list.
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergeName, setMergeName] = useState('');
    const [merging, setMerging] = useState(false);

    const cur = useCallback((value: number) => formatCurrency(value, currency), [currency]);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await api.get<{ success: boolean; data: { products: CatalogProduct[]; total: number } }>(
                '/api/budget-analytics/products'
            );
            if (res.success) {
                setProducts(res.data?.products ?? []);
            } else {
                setFailed(true);
            }
        } catch (err) {
            console.error('Failed to load the product catalog:', err);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // The search covers every name a product answers to, not only the one shown:
    // "basmati" must find the product that lists it as another name.
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (needle === '') return products;
        return products.filter((product) =>
            [product.name, product.pantryName ?? '', ...product.names]
                .some((text) => text.toLowerCase().includes(needle))
        );
    }, [products, search]);

    const openEdit = (product: CatalogProduct) => {
        const split = product.pantryName
            ? splitAliases(product.pantryName)
            : {
                name: product.name,
                aliases: product.names.filter((name) => name !== product.name).join(', '),
            };
        setForm({ name: split.name, alsoCalled: split.aliases });
        setSaveError(false);
        setEditing(product);
    };

    const save = async () => {
        // Renaming keeps the name the product answered to as an alias, so the
        // receipt lines it already has stay attached to it.
        const previous = editing?.name.trim() ?? '';
        const nextName = form.name.trim();
        const kept = previous !== '' && previous !== nextName ? previous : '';
        const composed = joinAliases(nextName, [form.alsoCalled, kept].filter(Boolean).join(', '));
        if (composed === '') return;

        setSaving(true);
        setSaveError(false);
        try {
            if (editing?.pantryItemId) {
                // Name only: a full PUT would reset category, location and expiry.
                await api.put(`/api/pantry/${editing.pantryItemId}/name`, { name: composed });
                showToast({ title: t('pantry.custom:toasts.updated') });
            } else {
                // A product the pantry does not know yet becomes a row with no stock:
                // the catalog names a product, it does not claim the family has it.
                await api.post('/api/pantry', { name: composed, quantity: 0, unit: '' });
                showToast({ title: t('pantry.custom:toasts.created') });
            }
            setEditing(null);
            await load();
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            if (message.includes('DUPLICATE_NAME')) {
                showToast({ title: t('pantry.custom:errors.duplicateName') });
            }
            setSaveError(true);
        } finally {
            setSaving(false);
        }
    };

    const toggleSelected = (key: string) => {
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const chosen = products.filter((product) => selected.has(product.key));

    const openMerge = () => {
        // The target is the tracked product that spends the most, so its stock and
        // its row survive; the rest become names on it.
        const tracked = chosen
            .filter((product) => product.pantryItemId !== null)
            .sort((a, b) => b.amount - a.amount);
        const lead = tracked[0] ?? [...chosen].sort((a, b) => b.amount - a.amount)[0];
        setMergeName(lead?.name ?? '');
        setMergeOpen(true);
    };

    const merge = async () => {
        const name = mergeName.trim();
        if (name === '' || chosen.length < 2) return;

        const target = chosen
            .filter((product) => product.pantryItemId !== null)
            .sort((a, b) => b.amount - a.amount)[0] ?? null;
        const aliases: string[] = [];
        for (const product of chosen) {
            const split = product.pantryName
                ? splitAliases(product.pantryName)
                : { name: product.name, aliases: '' };
            aliases.push(
                split.name,
                ...split.aliases.split(',').map((part) => part.trim()).filter(Boolean),
                ...product.names,
                product.name,
            );
        }
        const folded = name.toLowerCase();
        const unique = aliases.filter((alias, index) =>
            alias.trim() !== ''
            && alias.trim().toLowerCase() !== folded
            && aliases.findIndex((other) => other.trim().toLowerCase() === alias.trim().toLowerCase()) === index
        );
        const sources = chosen
            .map((product) => product.pantryItemId)
            .filter((id): id is string => id !== null && id !== target?.pantryItemId);

        setMerging(true);
        try {
            const response = await api.post<{ success: boolean; data: { merged: number; skipped: number } }>(
                '/api/pantry/merge',
                { name, aliases: unique, target_id: target?.pantryItemId ?? null, source_ids: sources },
            );
            showToast({ title: t('analytics.custom:page.merged', { name }) });
            if ((response.data?.skipped ?? 0) > 0) {
                showToast({
                    title: t('analytics.custom:page.mergeSkipped', { count: response.data.skipped }),
                });
            }
            setMergeOpen(false);
            setSelected(new Set());
            await load();
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            showToast({
                title: message.includes('DUPLICATE_NAME')
                    ? t('pantry.custom:errors.duplicateName')
                    : t('analytics.custom:page.mergeError'),
            });
        } finally {
            setMerging(false);
        }
    };

    if (!isModuleEnabled('budgetAnalytics')) return null;

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <Link
                        to="/budget-analytics"
                        className="mb-1 inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        {t('analytics.custom:page.back')}
                    </Link>
                    <h1 className="text-h1">{t('analytics.custom:page.title')}</h1>
                    <p className="text-muted-foreground text-body">{t('analytics.custom:page.subtitle')}</p>
                </div>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void load()}
                    disabled={loading}
                    className="mt-6 shrink-0"
                >
                    <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    {t('analytics.custom:page.refresh')}
                </Button>
            </div>

            <Card>
                <CardContent className="space-y-3 p-4">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('analytics.custom:page.search')}
                            aria-label={t('analytics.custom:page.search')}
                            className="input-nexus w-full py-2 pl-9 text-caption"
                        />
                    </div>
                    <p className="text-caption text-muted-foreground">
                        {t('analytics.custom:page.count', { count: visible.length })}
                    </p>
                    {selected.size > 0 && (
                        <div className="flex items-center justify-between gap-2 rounded-input bg-surface-2 px-3 py-2">
                            <span className="text-caption font-medium">
                                {t('analytics.custom:page.selected', { count: selected.size })}
                            </span>
                            <div className="flex gap-2">
                                <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                                    {t('analytics.custom:page.clear')}
                                </Button>
                                <Button type="button" size="sm" onClick={openMerge} disabled={selected.size < 2}>
                                    {t('analytics.custom:page.merge')}
                                </Button>
                            </div>
                        </div>
                    )}

                    {loading && products.length === 0 ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="spinner-brand" />
                        </div>
                    ) : failed ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">{t('analytics.custom:states.error')}</p>
                    ) : visible.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">{t('analytics.custom:page.empty')}</p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {visible.map((product) => (
                                <li key={product.key} className="flex items-start justify-between gap-3 py-2.5">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(product.key)}
                                        onChange={() => toggleSelected(product.key)}
                                        aria-label={t('analytics.custom:page.select', { name: product.name })}
                                        className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{product.name}</p>
                                        <p className="text-caption text-muted-foreground">
                                            {product.lines > 0
                                                ? t('analytics.custom:page.lines', { count: product.lines, amount: cur(product.amount) })
                                                : t('analytics.custom:page.noPurchases')}
                                            {product.stock && product.stock.quantity > 0 && (
                                                <>
                                                    {' · '}
                                                    {t('analytics.custom:page.stock', {
                                                        quantity: quantityText(product.stock.quantity),
                                                        unit: product.stock.unit ?? '',
                                                    })}
                                                </>
                                            )}
                                            {!product.pantryItemId && (
                                                <>
                                                    {' · '}
                                                    {t('analytics.custom:page.untracked')}
                                                </>
                                            )}
                                        </p>
                                        {product.names.length > 1 && (
                                            <p className="truncate text-micro text-muted-foreground">
                                                {product.names.join(' · ')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="text-caption text-muted-foreground">
                                            {unitsText(product.units, (count) => t('analytics.custom:products.noUnit', { value: count }))}
                                        </span>
                                        <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(product)}>
                                            {t('analytics.custom:page.edit')}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={mergeOpen}
                onOpenChange={setMergeOpen}
                title={t('analytics.custom:page.mergeTitle')}
                description={t('analytics.custom:page.mergeHint')}
            >
                <div className="space-y-3">
                    <Input
                        label={t('pantry.custom:form.name')}
                        value={mergeName}
                        onChange={(event) => setMergeName(event.target.value)}
                    />
                    <p className="text-caption text-muted-foreground">
                        {t('analytics.custom:page.mergeNames', {
                            names: chosen.map((product) => product.name).join(' · '),
                        })}
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setMergeOpen(false)}>
                            {t('common:actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void merge()}
                            disabled={merging || mergeName.trim() === '' || chosen.length < 2}
                        >
                            {merging ? t('pantry.custom:form.saving') : t('analytics.custom:page.merge')}
                        </Button>
                    </div>
                </div>
            </Dialog>

            <Dialog
                open={editing !== null}
                onOpenChange={(next) => { if (!next) setEditing(null); }}
                title={t('analytics.custom:page.dialogTitle')}
                description={t('analytics.custom:page.dialogHint')}
            >
                <div className="space-y-3">
                    <Input
                        label={t('pantry.custom:form.name')}
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
                    {saveError && <p className="text-caption text-danger">{t('analytics.custom:page.saveError')}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                            {t('common:actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving || form.name.trim() === ''}
                        >
                            {saving ? t('pantry.custom:form.saving') : t('pantry.custom:form.save')}
                        </Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
};

export default ProductsPage;
