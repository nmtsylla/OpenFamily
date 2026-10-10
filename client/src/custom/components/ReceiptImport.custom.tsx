import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { FileText, Loader2, Plus, Receipt as ReceiptIcon, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useCategories } from '../../hooks/useCategories';
import { aiErrorKey } from '../../components/app/MagicInput';
import { Button, Dialog, useToast } from '../../components/ui';

// ─── Types (mirror server/src/services/ai/receipt.ts) ─────────────────────────

interface ReceiptLine {
    label: string;
    quantity: number;
    unit_price: number;
    amount: number;
    category: string;
}

interface ReceiptDraft {
    document_type: 'receipt' | 'invoice';
    merchant: string;
    date: string;
    currency: string;
    total: number;
    category: string;
    items: ReceiptLine[];
}

interface Attachment {
    name: string;
    mime_type: string;
    data: string;
}

interface ReviewLine {
    id: number;
    label: string;
    category: string;
    amount: string;
    include: boolean;
    /** Read from the ticket, kept as-is for the archived detail (not edited here). */
    quantity: number;
    unit_price: number;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Family currency, for the amounts shown while reviewing. */
    currency: string;
    /** Called once at least one entry was created, so the page can reload. */
    onImported: () => void;
}

// Mirrors the server limits: 5 documents, JPEG/PNG/WebP/PDF, 8 MB each. The
// total is capped at 8 MB too, because base64 inflates by 4/3 (→ ~10.7 MB) and
// the route's JSON body limit is 12 MB.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
// HEIC/HEIF come from iOS cameras: accepted here and re-encoded to JPEG by the
// canvas below (Safari decodes them; a browser that cannot is reported locally).
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/heic', 'image/heif'];
// Phone photos are 3–10 MB and carry far more pixels than a model needs: the
// canvas below caps the long side at 1600px (~200–500 KB), which keeps five
// scans well under the 12 MB body limit.
const MAX_DIMENSION = 1600;

/** btoa() takes a binary string; 32 KB per chunk keeps String.fromCharCode happy. */
const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
};

/**
 * Encodes one picked document. Throws when the browser cannot decode the image:
 * sending undecodable bytes to the model only wastes an upload, so the caller
 * reports the file instead.
 */
const toAttachment = async (file: File): Promise<Attachment> => {
    if (file.type === 'application/pdf') {
        return {
            name: file.name,
            mime_type: 'application/pdf',
            data: toBase64(new Uint8Array(await file.arrayBuffer())),
        };
    }
    // createImageBitmap decodes off the main thread and applies the EXIF
    // orientation, which a plain <img> would not.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return { name: file.name, mime_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
};

const toAmount = (value: string): number => {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

/**
 * Receipt / invoice import: pick scans, let the AI draft the lines, review them
 * (each line carries its own budget category), then create ONE BUDGET ENTRY PER
 * LINE through the ordinary endpoint — the totals and the per-category charts
 * stay consistent, and a receipt is never double-counted.
 */
export const ReceiptImportDialog: React.FC<Props> = ({ open, onOpenChange, currency, onImported }) => {
    const { t } = useTranslation(['budget', 'common']);
    const { showToast } = useToast();
    const { categories } = useCategories();
    const fileInput = useRef<HTMLInputElement>(null);
    // Bumped on every reset: a document still being read/analysed when the user
    // closes the dialog must not repopulate the review screen afterwards.
    const analysisId = useRef(0);

    const [files, setFiles] = useState<File[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [merchant, setMerchant] = useState('');
    const [date, setDate] = useState('');
    const [total, setTotal] = useState('');
    const [category, setCategory] = useState('');
    const [lines, setLines] = useState<ReviewLine[] | null>(null);
    const [nextLineId, setNextLineId] = useState(1);
    const [documentType, setDocumentType] = useState<'receipt' | 'invoice'>('receipt');
    const [fileName, setFileName] = useState('');
    // 'itemized' = one budget entry per line, 'single' = one entry for the total.
    const [mode, setMode] = useState<'itemized' | 'single'>('itemized');
    // Set when this family already imported the same merchant/date/amount.
    const [duplicate, setDuplicate] = useState<{ merchant: string; date: string } | null>(null);

    const hasDraft = lines !== null;
    const categoryOptions = categories.budget;
    const label = (value: string) => t(`budget:categories.${value}`, { defaultValue: value });

    const reset = () => {
        analysisId.current += 1;
        setFiles([]);
        setLines(null);
        setMerchant('');
        setDate('');
        setTotal('');
        setCategory('');
        setNextLineId(1);
        setMode('itemized');
        setDocumentType('receipt');
        setFileName('');
        setDuplicate(null);
        setError('');
        setAnalyzing(false);
        setSaving(false);
    };

    const close = () => {
        onOpenChange(false);
        reset();
    };

    const errorText = (err: unknown) => {
        const message = err instanceof Error ? err.message : '';
        // The commit endpoint refuses a receipt this family already imported.
        if (message === 'RECEIPT_DUPLICATE') return t('budget.custom:receipt.errors.duplicate');
        const key = aiErrorKey(err);
        if (key) return t(`ai.custom:errors.${key}`);
        return message || t('budget.custom:receipt.errors.analyze');
    };

    const addFiles = (picked: FileList | null) => {
        if (!picked) return;
        const chosen = Array.from(picked);
        let rejected: File | undefined;
        const accepted: File[] = [];
        let total = files.reduce((sum, file) => sum + file.size, 0);
        for (const file of chosen) {
            const usable = SUPPORTED_TYPES.includes(file.type)
                && file.size <= MAX_FILE_BYTES
                && total + file.size <= MAX_TOTAL_BYTES
                && files.length + accepted.length < MAX_FILES;
            if (usable) {
                accepted.push(file);
                total += file.size;
            } else {
                rejected ??= file;
            }
        }
        setError(rejected ? t('budget.custom:receipt.errors.unsupported', { name: rejected.name }) : '');
        setFiles((previous) => [...previous, ...accepted]);
    };

    const analyze = async () => {
        if (files.length === 0) return;
        const run = analysisId.current;
        setAnalyzing(true);
        setError('');
        try {
            const attachments: Attachment[] = [];
            for (const file of files) {
                try {
                    attachments.push(await toAttachment(file));
                } catch {
                    // Undecodable image (HEIC in a browser without its codec…):
                    // report it instead of uploading bytes the model cannot read.
                    if (analysisId.current === run) {
                        setError(t('budget.custom:receipt.errors.unsupported', { name: file.name }));
                        setAnalyzing(false);
                    }
                    return;
                }
            }
            const response = await api.post<{
                success: boolean;
                data: { receipt: ReceiptDraft; duplicate: { merchant: string; date: string } | null };
            }>('/api/ai/extract-receipt', { files: attachments });
            // Closed or reset while the model was working: the draft belongs to
            // a run the user abandoned.
            if (analysisId.current !== run) return;
            const draft = response.data.receipt;
            setMerchant(draft.merchant || files[0].name.replace(/\.[^.]+$/, ''));
            setDate(draft.date || format(new Date(), 'yyyy-MM-dd'));
            setTotal(draft.total ? String(draft.total) : '');
            setCategory(draft.category || categoryOptions[categoryOptions.length - 1] || '');
            setDocumentType(draft.document_type === 'invoice' ? 'invoice' : 'receipt');
            setFileName(files[0]?.name ?? '');
            setDuplicate(response.data.duplicate ?? null);
            setLines(
                draft.items.map((item, index) => ({
                    id: index + 1,
                    label: item.label,
                    category: item.category,
                    amount: String(item.amount),
                    include: true,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                }))
            );
            setNextLineId(draft.items.length + 1);
        } catch (err) {
            if (analysisId.current === run) setError(errorText(err));
        } finally {
            // Never cleared by an abandoned run: the user may have started a new
            // analysis after closing the dialog.
            if (analysisId.current === run) setAnalyzing(false);
        }
    };

    const patchLine = (id: number, patch: Partial<ReviewLine>) =>
        setLines((previous) => previous?.map((line) => (line.id === id ? { ...line, ...patch } : line)) ?? previous);

    const removeLine = (id: number) =>
        setLines((previous) => previous?.filter((line) => line.id !== id) ?? previous);

    const addLine = () => {
        setLines((previous) => [
            ...(previous ?? []),
            {
                id: nextLineId,
                label: '',
                category: categoryOptions[categoryOptions.length - 1] ?? '',
                amount: '',
                include: true,
                quantity: 1,
                unit_price: 0,
            },
        ]);
        setNextLineId((id) => id + 1);
    };

    const includedLines = (lines ?? []).filter((line) => line.include);
    const includedTotal = Math.round(includedLines.reduce((sum, line) => sum + toAmount(line.amount), 0) * 100) / 100;
    const draftTotal = toAmount(total);
    const showMismatch =
        includedLines.length > 0 &&
        includedLines.length === (lines ?? []).length &&
        draftTotal > 0 &&
        Math.abs(includedTotal - draftTotal) > 0.05;

    const itemised = (lines?.length ?? 0) > 0;
    // "One line with just the total" is for bills whose breakdown is useless; the
    // scanned lines are archived either way.
    const singleLine = mode === 'single' || !itemised;

    const save = async () => {
        const descriptionBase = merchant.trim();
        const entryDate = date || format(new Date(), 'yyyy-MM-dd');

        const entries = singleLine
            ? [{ category, amount: draftTotal, description: descriptionBase }]
            : includedLines.map((line) => ({
                  category: line.category,
                  amount: toAmount(line.amount),
                  description: [descriptionBase, line.label.trim()].filter(Boolean).join(' — '),
              }));

        if (entries.length === 0) {
            setError(t('budget.custom:receipt.errors.nothingSelected'));
            return;
        }
        if (entries.some((entry) => entry.amount <= 0 || !entry.category)) {
            setError(t('budget:errors.amountInvalid'));
            return;
        }

        setSaving(true);
        setError('');
        try {
            await api.post('/api/budget/receipts', {
                merchant: descriptionBase,
                date: entryDate,
                total: singleLine ? draftTotal : includedTotal,
                currency: currency.trim().toUpperCase().slice(0, 3),
                document_type: documentType,
                category,
                mode: singleLine ? 'single' : 'itemized',
                source_name: fileName,
                // The archived lines are the ones the user kept, whatever the
                // mode: in 'single' the total is what enters the budget, but the
                // detail stays the scanned-and-reviewed list.
                items: includedLines.map((line) => ({
                    label: line.label.trim() || t('budget.custom:receipt.lineLabel'),
                    quantity: line.quantity,
                    unit_price: line.unit_price,
                    amount: toAmount(line.amount),
                    category: line.category,
                })).filter((item) => item.amount > 0),
                entries,
            });
        } catch (err) {
            setSaving(false);
            setError(errorText(err));
            return;
        }
        setSaving(false);

        onImported();
        showToast({
            title: t('budget.custom:receipt.successTitle'),
            description: t('budget.custom:receipt.successDescription', { count: entries.length }),
        });
        close();
    };

    const lineCategorySelect = (value: string, onChange: (next: string) => void, id: string) => (
        <select
            aria-label={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-input border border-border bg-surface-1 px-2 py-1.5 text-caption text-foreground
                       focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
            {value && !categoryOptions.includes(value) && <option value={value}>{label(value)}</option>}
            {categoryOptions.map((option) => (
                <option key={option} value={option}>{label(option)}</option>
            ))}
        </select>
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
            title={t('budget.custom:receipt.title')}
            description={itemised ? t('budget.custom:receipt.reviewHint') : t('budget.custom:receipt.pickHint')}
        >
            <div className="space-y-4">
                {!hasDraft && (
                    <>
                        <input
                            ref={fileInput}
                            type="file"
                            accept="image/*,application/pdf"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                addFiles(event.target.files);
                                event.target.value = '';
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            className="flex w-full flex-col items-center gap-2 rounded-input border border-dashed border-border bg-surface-1 px-4 py-8 text-center transition-colors hover:bg-surface-2"
                        >
                            <Upload className="h-6 w-6 text-muted-foreground" />
                            <span className="text-caption font-medium text-foreground">{t('budget.custom:receipt.pick')}</span>
                            <span className="text-micro text-muted-foreground">{t('budget.custom:receipt.filesHint')}</span>
                        </button>

                        {files.length > 0 && (
                            <ul className="space-y-2">
                                {files.map((file, index) => (
                                    <li
                                        key={`${file.name}-${index}`}
                                        className="flex items-center gap-2 rounded-input border border-border px-3 py-2"
                                    >
                                        {file.type === 'application/pdf'
                                            ? <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            : <ReceiptIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                        <span className="min-w-0 flex-1 truncate text-caption">{file.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => setFiles((previous) => previous.filter((_, i) => i !== index))}
                                            className="rounded-input p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                                            aria-label={t('common:actions.delete')}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <Button type="button" onClick={analyze} disabled={files.length === 0 || analyzing} className="w-full">
                            {analyzing
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('budget.custom:receipt.analyzing')}</>
                                : t('budget.custom:receipt.analyze')}
                        </Button>
                    </>
                )}

                {hasDraft && (
                    <>
                        {duplicate && (
                            <div className="rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground">
                                {t('budget.custom:receipt.duplicate', {
                                    merchant: duplicate.merchant || t('budget.custom:receipt.merchantUnknown'),
                                    date: duplicate.date,
                                })}
                            </div>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <label className="mb-1 block text-caption font-medium text-foreground">
                                    {t('budget.custom:receipt.merchant')}
                                </label>
                                <input
                                    value={merchant}
                                    onChange={(event) => { setMerchant(event.target.value); setDuplicate(null); }}
                                    className="input-nexus py-0 text-caption"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-caption font-medium text-foreground">
                                    {t('budget.custom:receipt.date')}
                                </label>
                                <input
                                    type="date"
                                    value={date}
                                    onChange={(event) => { setDate(event.target.value); setDuplicate(null); }}
                                    className="input-nexus py-0 text-caption"
                                />
                            </div>
                        </div>

                        {/* Bills rarely need a line per line: one entry with the total
                            is what the family wants to see in its budget. */}
                        {itemised && (
                            <label className="flex cursor-pointer items-start gap-2 rounded-input border border-border px-3 py-2">
                                <input
                                    type="checkbox"
                                    checked={mode === 'single'}
                                    onChange={(event) => setMode(event.target.checked ? 'single' : 'itemized')}
                                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                />
                                <span className="text-caption">
                                    <span className="font-medium text-foreground">{t('budget.custom:receipt.singleMode')}</span>
                                    <span className="mt-0.5 block text-micro text-muted-foreground">
                                        {t('budget.custom:receipt.singleModeHint', { count: includedLines.length })}
                                    </span>
                                </span>
                            </label>
                        )}

                        {singleLine && (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-caption font-medium text-foreground">
                                        {t('budget.custom:receipt.total')}
                                    </label>
                                    <input
                                        value={total}
                                        inputMode="decimal"
                                        onChange={(event) => { setTotal(event.target.value); setDuplicate(null); }}
                                        className="input-nexus py-0 text-caption"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-caption font-medium text-foreground">
                                        {t('budget:fields.category')}
                                    </label>
                                    {lineCategorySelect(category, setCategory, t('budget:fields.category'))}
                                </div>
                            </div>
                        )}

                        {itemised && !singleLine && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-caption font-medium text-foreground">
                                        {t('budget.custom:receipt.lines', { count: includedLines.length })}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={addLine}
                                        className="flex items-center gap-1 text-caption font-medium text-primary"
                                    >
                                        <Plus className="h-4 w-4" /> {t('budget.custom:receipt.addLine')}
                                    </button>
                                </div>

                                <ul className="space-y-2">
                                    {(lines ?? []).map((line) => (
                                        <li key={line.id} className="rounded-input border border-border p-2">
                                            <div className="flex items-start gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={line.include}
                                                    onChange={() => patchLine(line.id, { include: !line.include })}
                                                    className="mt-2 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                                    aria-label={line.label || t('budget.custom:receipt.addLine')}
                                                />
                                                <div className="min-w-0 flex-1 space-y-2">
                                                    <input
                                                        value={line.label}
                                                        onChange={(event) => patchLine(line.id, { label: event.target.value })}
                                                        placeholder={t('budget.custom:receipt.lineLabel')}
                                                        className="input-nexus py-0 text-caption"
                                                    />
                                                    <div className="flex gap-2">
                                                        <div className="flex-1">
                                                            {lineCategorySelect(
                                                                line.category,
                                                                (next) => patchLine(line.id, { category: next }),
                                                                t('budget:fields.category')
                                                            )}
                                                        </div>
                                                        <input
                                                            value={line.amount}
                                                            inputMode="decimal"
                                                            onChange={(event) => patchLine(line.id, { amount: event.target.value })}
                                                            className="input-nexus w-24 shrink-0 py-0 text-right text-caption"
                                                            aria-label={t('budget.custom:receipt.total')}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeLine(line.id)}
                                                            className="shrink-0 rounded-input p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                                                            aria-label={t('common:actions.delete')}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>

                                <div className="flex items-center justify-between rounded-input bg-surface-2 px-3 py-2 text-caption">
                                    <span className="text-muted-foreground">{t('budget.custom:receipt.linesTotal')}</span>
                                    <span className="font-medium text-foreground">
                                        {formatCurrency(includedTotal, currency)}
                                    </span>
                                </div>
                                {showMismatch && (
                                    <p className="text-micro text-warning">
                                        {t('budget.custom:receipt.mismatch', {
                                            lines: formatCurrency(includedTotal, currency),
                                            total: formatCurrency(draftTotal, currency),
                                        })}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <Button type="button" variant="secondary" onClick={reset} disabled={saving} className="flex-1">
                                {t('common:actions.back')}
                            </Button>
                            <Button type="button" onClick={save} disabled={saving || duplicate !== null} className="flex-1">
                                {saving
                                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('budget.custom:receipt.saving')}</>
                                    : t('budget.custom:receipt.confirm', { count: singleLine ? 1 : includedLines.length })}
                            </Button>
                        </div>
                    </>
                )}

                {error && <p className="text-caption text-danger">{error}</p>}
            </div>
        </Dialog>
    );
};
