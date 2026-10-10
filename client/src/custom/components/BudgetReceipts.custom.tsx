import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Receipt, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { dateLocale } from '../../i18n/format';
import { useAuth } from '../../contexts/AuthContext';
import { useAiEnabled } from '../../lib/aiStatus';
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
}> = ({ receipt, currency, canEdit, onDelete }) => {
    const { t } = useTranslation('budget.custom');
    const [open, setOpen] = useState(false);
    const dateStr = format(parseISO(receipt.date), 'dd MMM yyyy', { locale: dateLocale() });
    const Chevron = open ? ChevronDown : ChevronRight;

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
                            onClick={() => onDelete(receipt.id)}
                            className="flex items-center gap-1.5 text-xs font-medium text-danger"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('receipt.delete')}
                        </button>
                    )}
                </div>
            )}
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
                    />
                ))}
            </div>
        </section>
    );
};
