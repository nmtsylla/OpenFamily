import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Edit2, Package, Plus, Receipt, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { dateLocale } from '../../i18n/format';
import { useAuth } from '../../contexts/AuthContext';
import { useCategories } from '../../hooks/useCategories';
import { useAiEnabled } from '../../lib/aiStatus';
import { Button, Dialog, Input, Select, useToast } from '../../components/ui';
import { ReceiptImportDialog } from './ReceiptImport.custom';

// Imported receipts on the Budget page — a sidecar to the upstream page.
//
// The button and the list are two separate mount points in `Budget.tsx`, so they
// talk through this window event instead of shared React state: the dialog fires
// it after an import, the list reloads on it. The parent still refreshes its own
// entries through the `onImported` / `onChanged` callbacks.

const RECEIPTS_CHANGED = 'custom:budget-receipts-changed';

interface ReceiptItem {
    id: string;
    label: string;
    quantity: number;
    unit_price: number;
    amount: number;
    category: string;
}

/** An imported receipt: the ticket as the family sees it, plus its lines. */
interface BudgetReceipt {
    id: string;
    merchant: string;
    date: string;
    total: number;
    currency: string;
    document_type: 'receipt' | 'invoice';
    category: string;
    import_mode: 'itemized' | 'single';
    source_name?: string | null;
    entry_count: number;
    /** The import already put this receipt's products in the pantry. */
    pantry_imported?: boolean;
    items: ReceiptItem[];
}

const toNumber = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

/**
 * One imported receipt: the ticket's total on the Budget page, opened to show
 * what was in it. The lines are kept whatever the import mode, so the detail is
 * there when someone wants to look — or to build on it later.
 */
const ReceiptRow: React.FC<{
    receipt: BudgetReceipt;
    currency: string;
    canEdit: boolean;
    onDelete: (id: string) => void;
    /** Re-fetches the receipt list after a line was added, edited or deleted. */
    onChanged: () => void;
}> = ({ receipt, currency, canEdit, onDelete, onChanged }) => {
    const { t } = useTranslation(['budget.custom', 'pantry.custom']);
    const { showToast } = useToast();
    const { isModuleEnabled } = useAuth();
    const { categories } = useCategories();
    const [open, setOpen] = useState(false);
    const [lineEditing, setLineEditing] = useState<ReceiptItem | null>(null);
    const [lineOpen, setLineOpen] = useState(false);
    const [lineForm, setLineForm] = useState({ label: '', quantity: '1', unit_price: '', amount: '', category: '' });
    const [savingLine, setSavingLine] = useState(false);
    const [importing, setImporting] = useState(false);
    const dateStr = format(parseISO(receipt.date), 'dd MMM yyyy', { locale: dateLocale() });
    const Chevron = open ? ChevronDown : ChevronRight;

    // Extraction can miss a product or answer "single" for a bill whose detail
    // the family wants after all: these lines are editable one by one.
    const openAddLine = () => {
        setLineEditing(null);
        setLineForm({ label: '', quantity: '1', unit_price: '', amount: '', category: categories.budget[0] ?? '' });
        setLineOpen(true);
    };

    const openEditLine = (item: ReceiptItem) => {
        setLineEditing(item);
        setLineForm({
            label: item.label,
            quantity: String(item.quantity),
            unit_price: item.unit_price === 0 ? '' : String(item.unit_price),
            amount: String(item.amount),
            category: item.category,
        });
        setLineOpen(true);
    };

    const lineBody = {
        label: lineForm.label,
        quantity: Number(lineForm.quantity) || 1,
        unit_price: lineForm.unit_price === '' ? 0 : Number(lineForm.unit_price),
        amount: lineForm.amount === '' ? 0 : Number(lineForm.amount),
        category: lineForm.category,
    };

    const saveLine = async () => {
        if (lineForm.label.trim() === '') return;
        setSavingLine(true);
        try {
            if (lineEditing) {
                await api.put(`/api/budget/receipts/${receipt.id}/items/${lineEditing.id}`, lineBody);
            } else {
                await api.post(`/api/budget/receipts/${receipt.id}/items`, lineBody);
            }
            setLineOpen(false);
            onChanged();
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.save'), description: err instanceof Error ? err.message : undefined });
        } finally {
            setSavingLine(false);
        }
    };

    const removeLine = async (item: ReceiptItem) => {
        if (!confirm(t('pantry.custom:receipt.deleteLine'))) return;
        try {
            await api.delete(`/api/budget/receipts/${receipt.id}/items/${item.id}`);
            onChanged();
        } catch (err) {
            showToast({ title: t('pantry.custom:errors.delete'), description: err instanceof Error ? err.message : undefined });
        }
    };

    const addToPantry = async () => {
        setImporting(true);
        try {
            const response = await api.post<{
                success: boolean;
                data: { created: number; updated: number; skipped: number };
            }>('/api/pantry/import/receipt', { receiptId: receipt.id });
            showToast({ title: t('pantry.custom:toasts.importedReceipt') });
            // A receipt line whose amount is known but whose unit contradicts the
            // pantry row is reported, not merged into a wrong total.
            if ((response.data?.skipped ?? 0) > 0) {
                showToast({
                    title: t('pantry.custom:toasts.skippedUnits', { count: response.data.skipped }),
                });
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            showToast({
                title: message.includes('ALREADY_IMPORTED')
                    ? t('pantry.custom:errors.alreadyImported')
                    : t('pantry.custom:errors.importReceipt'),
            });
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="bg-surface-1 border border-border rounded-card shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 p-3.5 text-left"
            >
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-base truncate">
                        {receipt.merchant || t('receipt.merchantUnknown')}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{dateStr}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                            {t('receipt.itemCount', { count: receipt.items.length })}
                        </span>
                        {receipt.import_mode === 'single' ? (
                            <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className="text-xs text-muted-foreground">
                                    {t(`budget:categories.${receipt.category}`, { defaultValue: receipt.category })}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className="text-xs text-muted-foreground">
                                    {t('receipt.entryCount', { count: receipt.entry_count })}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <span className="text-base font-bold flex-shrink-0 text-danger">
                    -{formatCurrency(receipt.total, currency)}
                </span>
                <Chevron className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            </button>

            {open && (
                <div className="border-t border-border px-3.5 py-3 space-y-2">
                    {receipt.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('receipt.noItems')}</p>
                    ) : (
                        <ul className="space-y-1.5">
                            {receipt.items.map((item) => (
                                <li key={item.id} className="flex items-start gap-2 text-xs">
                                    <span className="flex-1 min-w-0 truncate">
                                        {item.quantity > 1 && (
                                            <span className="text-muted-foreground">{item.quantity} × </span>
                                        )}
                                        {item.label}
                                    </span>
                                    <span className="flex-shrink-0 text-muted-foreground">
                                        {t(`budget:categories.${item.category}`, { defaultValue: item.category })}
                                    </span>
                                    <span className="flex-shrink-0 font-medium">
                                        {formatCurrency(item.amount, currency)}
                                    </span>
                                    {canEdit && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => openEditLine(item)}
                                                aria-label={t('pantry.custom:receipt.editLine')}
                                                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeLine(item)}
                                                aria-label={t('pantry.custom:receipt.deleteLine')}
                                                className="flex-shrink-0 text-muted-foreground hover:text-danger"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {receipt.import_mode === 'single' && (
                        <p className="text-xs text-muted-foreground">{t('receipt.singleModeStored')}</p>
                    )}
                    {receipt.source_name && (
                        <p className="text-xs text-muted-foreground">{receipt.source_name}</p>
                    )}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={openAddLine}
                            className="flex items-center gap-1.5 text-xs font-medium text-primary"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {t('pantry.custom:receipt.addLine')}
                        </button>
                    )}
                    {/* The import already stocks the pantry, so this is the path
                        left for receipts imported before that (and the retry, if
                        the pantry write ever failed): hidden once the lines are
                        there. */}
                    {isModuleEnabled('pantry') && !receipt.pantry_imported && (
                        <button
                            type="button"
                            onClick={() => void addToPantry()}
                            disabled={importing}
                            className="flex items-center gap-1.5 text-xs font-medium text-primary disabled:opacity-50"
                        >
                            <Package className="w-3.5 h-3.5" />
                            {t('pantry.custom:receipt.addToPantry')}
                        </button>
                    )}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => onDelete(receipt.id)}
                            className="flex items-center gap-1.5 text-xs font-medium text-danger"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('receipt.delete')}
                        </button>
                    )}
                </div>
            )}

            <Dialog
                open={lineOpen}
                onOpenChange={setLineOpen}
                title={lineEditing ? t('pantry.custom:receipt.editLine') : t('pantry.custom:receipt.addLine')}
            >
                <div className="space-y-3">
                    <Input
                        label={t('pantry.custom:receipt.lineLabel')}
                        value={lineForm.label}
                        onChange={(event) => setLineForm({ ...lineForm, label: event.target.value })}
                    />
                    <div className="grid grid-cols-3 gap-3">
                        <Input
                            type="number"
                            step="0.001"
                            label={t('pantry.custom:receipt.lineQuantity')}
                            value={lineForm.quantity}
                            onChange={(event) => setLineForm({ ...lineForm, quantity: event.target.value })}
                        />
                        <Input
                            type="number"
                            step="0.01"
                            label={t('pantry.custom:receipt.lineUnitPrice')}
                            value={lineForm.unit_price}
                            onChange={(event) => setLineForm({ ...lineForm, unit_price: event.target.value })}
                        />
                        <Input
                            type="number"
                            step="0.01"
                            label={t('pantry.custom:receipt.lineAmount')}
                            value={lineForm.amount}
                            onChange={(event) => setLineForm({ ...lineForm, amount: event.target.value })}
                        />
                    </div>
                    <Select
                        value={lineForm.category}
                        onValueChange={(value) => setLineForm({ ...lineForm, category: value })}
                        options={categories.budget.map((name) => ({ value: name, label: name }))}
                    />
                    <p className="text-micro text-muted-foreground">{t('pantry.custom:receipt.totalUnchanged')}</p>
                    <div className="flex justify-end gap-2 pt-1">
                        <Button variant="secondary" onClick={() => setLineOpen(false)}>
                            {t('common:actions.cancel')}
                        </Button>
                        <Button onClick={() => void saveLine()} disabled={savingLine || lineForm.label.trim() === ''}>
                            {t('common:actions.save')}
                        </Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
};

/**
 * The "Import a receipt" button, mounted in the Budget page's classic toolbar.
 * Hidden unless the AI assistant is on, like the fork's button was.
 */
export const ReceiptImportButton: React.FC<{
    currency: string;
    onImported: () => void;
}> = ({ currency, onImported }) => {
    const { t } = useTranslation('budget.custom');
    const { isModuleEnabled } = useAuth();
    const aiEnabled = useAiEnabled();
    const [open, setOpen] = useState(false);

    if (!aiEnabled || !isModuleEnabled('ai') || !isModuleEnabled('budgetReceipts')) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-sm font-medium
                           text-foreground active:scale-95 transition-transform"
            >
                <Receipt className="w-4 h-4" />
                {t('receipt.import')}
            </button>
            <ReceiptImportDialog
                open={open}
                onOpenChange={setOpen}
                currency={currency}
                onImported={() => {
                    onImported();
                    window.dispatchEvent(new Event(RECEIPTS_CHANGED));
                }}
            />
        </>
    );
};

/**
 * The imported receipts of the selected month: one row per ticket, expandable to
 * its lines. Nothing is rendered while there is none.
 */
export const BudgetReceiptsSection: React.FC<{
    currency: string;
    canEdit: boolean;
    startDate: string;
    endDate: string;
    onChanged: () => void;
}> = ({ currency, canEdit, startDate, endDate, onChanged }) => {
    const { t } = useTranslation('budget.custom');
    const { isModuleEnabled } = useAuth();
    const [receipts, setReceipts] = useState<BudgetReceipt[]>([]);

    const load = useCallback(async () => {
        try {
            const res = await api.get<{ success: boolean; data: BudgetReceipt[] }>(
                `/api/budget/receipts?start_date=${startDate}&end_date=${endDate}`
            );
            if (res.success) setReceipts(res.data.map((receipt) => ({
                ...receipt,
                total: toNumber(receipt.total),
                items: receipt.items.map((item) => ({ ...item, amount: toNumber(item.amount) })),
            })));
        } catch (err) {
            console.error('Budget receipts load error', err);
        }
    }, [startDate, endDate]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const handler = () => void load();
        window.addEventListener(RECEIPTS_CHANGED, handler);
        return () => window.removeEventListener(RECEIPTS_CHANGED, handler);
    }, [load]);

    // Deleting a receipt also deletes the entries it created (server-side cascade).
    const handleDelete = async (id: string) => {
        if (!confirm(t('confirm.deleteReceipt'))) return;
        try { await api.delete(`/api/budget/receipts/${id}`); void load(); onChanged(); } catch { /* ignore */ }
    };

    if (!isModuleEnabled('budgetReceipts')) return null;
    if (receipts.length === 0) return null;

    return (
        <section>
            <div className="flex items-center justify-between mb-2 mt-4">
                <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-primary" />
                    <h2 className="font-semibold text-base">{t('sections.receipts')}</h2>
                    <span className="text-xs bg-surface-2 text-foreground px-2 py-0.5 rounded-full font-medium">
                        {formatCurrency(receipts.reduce((sum, receipt) => sum + receipt.total, 0), currency)}
                    </span>
                </div>
            </div>
            <div className="space-y-2">
                {receipts.map((receipt) => (
                    <ReceiptRow
                        key={receipt.id}
                        receipt={receipt}
                        currency={currency}
                        canEdit={canEdit}
                        onDelete={handleDelete}
                        onChanged={() => void load()}
                    />
                ))}
            </div>
        </section>
    );
};
