import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Camera, FileText, Loader2, Plus, Receipt as ReceiptIcon, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useCategories } from '../../hooks/useCategories';
import { aiErrorKey } from '../../components/app/MagicInput';
import { Button, Dialog, useToast } from '../../components/ui';
// Emitted as its own asset by Vite: importing the URL costs nothing, the ~1 MB
// worker is only fetched when pdf.js starts on the first PDF.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ─── Types (mirror server/src/services/ai/receipt.ts) ─────────────────────────

interface ReceiptLine {
    label: string;
    quantity: number;
    unit_price: number;
    amount: number;
    category: string;
    /** Brand-free name of the same purchase, for the pantry ('LAIT BIO 1L' → 'Lait'). */
    pantry_item: string;
    /** Unit the ticket showed ('L', 'kg', 'pièce'…), '' when it showed none. */
    pantry_unit: string;
    /** Total content of the line in `pantry_unit` ('RIJST BASMATI 5KG' → 5), 0 when the ticket does not say. */
    pantry_content?: number;
    /**
     * The model's verdict: true only for lines that are plainly household stock
     * with a clear generic name. Those are stocked by the import; the others are
     * queued on the pantry page for the family to name.
     */
    pantry_stock: boolean;
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
    /** What the pantry will store for this line (the label when the AI saw none). */
    pantry_item: string;
    pantry_unit: string;
    /**
     * Total content of the line in `pantry_unit`, edited as text (a comma is a
     * decimal separator here), '' or 0 when the ticket did not say.
     */
    pantry_content: string;
    /** Stocked by the import, or queued for the pantry page. */
    pantry_stock: boolean;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Family currency, for the amounts shown while reviewing. */
    currency: string;
    /** Called once at least one entry was created, so the page can reload. */
    onImported: () => void;
}

// Mirrors the server limits: 5 documents, JPEG/PNG/WebP/PDF.
const MAX_FILES = 5;
// A PDF is never uploaded as a PDF: every page is rendered to a JPEG here and
// sent like a photo. Providers that take a `file` part are unreliable — the
// OpenCode Zen gateway ingests about one document in five and answers the rest
// with `file must have a file_id or file_data` (or hangs until the route's 60 s
// timeout), a failed ingest is then cached for the whole session so later PDFs
// come back as an empty draft, and Ollama refuses anything but images. Rendered
// pages cost what a photo costs, so a PDF's own size only costs a local parse.
// Bounds are sanity limits on absurd files: the upload is checked after encoding.
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Sentinel error message so analyze() can tell "this PDF has too many pages"
// from "this file could not be decoded"; both are reported before the upload.
const PDF_TOO_MANY_PAGES = 'PDF_TOO_MANY_PAGES';
// The route's JSON parser takes 12 MB. The encoded attachments (base64, so 4/3
// of the uploaded bytes) are checked against that in analyze(), where their real
// size is known: the picked photos' own sizes say nothing about it.
const MAX_PAYLOAD_BYTES = 11 * 1024 * 1024;
// HEIC/HEIF come from iOS cameras: accepted here and re-encoded to JPEG by the
// canvas below (Safari decodes them; a browser that cannot is reported locally).
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/heic', 'image/heif'];
// Phone photos are 3–10 MB and carry far more pixels than a model needs: the
// canvas below caps the long side at 1600px (~200–500 KB), which keeps five
// scans well under the 12 MB body limit. PDF pages are rendered at the same cap.
const MAX_DIMENSION = 1600;

/**
 * pdf.js is a ~400 KB download, and the dialog is part of the budget screen's
 * initial bundle: only the first PDF pays for the parser. Its worker is emitted
 * as its own asset, so the main thread never blocks on a scan.
 */
const loadPdfJs = async () => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfjs;
};

/** Base64 JPEG bytes of a rendered canvas, the shape the API takes per file. */
const toJpeg = (canvas: HTMLCanvasElement): string => canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

/**
 * One attachment per PDF page. A page is scaled exactly like a photo (long side
 * ≤1600px) and the page count is bounded by what the route accepts, so a scan
 * never turns into the oversized body the dialog refuses to send.
 */
const renderPdf = async (file: File): Promise<Attachment[]> => {
    const pdfjs = await loadPdfJs();
    // The loading task owns the parsed document and its worker: destroying it
    // frees both, so a dialog reopened on the same file starts from scratch.
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
        const pdf = await task.promise;
        if (pdf.numPages > MAX_FILES) throw new Error(PDF_TOO_MANY_PAGES);
        const attachments: Attachment[] = [];
        for (let number = 1; number <= pdf.numPages; number += 1) {
            const page = await pdf.getPage(number);
            const natural = page.getViewport({ scale: 1 });
            const scale = Math.min(2, MAX_DIMENSION / Math.max(natural.width, natural.height));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(viewport.width));
            canvas.height = Math.max(1, Math.round(viewport.height));
            await page.render({ canvas, viewport }).promise;
            attachments.push({
                name: pdf.numPages > 1 ? `${file.name} — ${number}` : file.name,
                mime_type: 'image/jpeg',
                data: toJpeg(canvas),
            });
        }
        return attachments;
    } finally {
        void task.destroy();
    }
};

/**
 * Encodes one picked document into what the model reads. Throws when the browser
 * cannot decode the file: sending undecodable bytes to the model only wastes an
 * upload, so the caller reports the file instead.
 */
const toAttachments = async (file: File): Promise<Attachment[]> => {
    if (file.type === 'application/pdf') return renderPdf(file);
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
    return [{ name: file.name, mime_type: 'image/jpeg', data: toJpeg(canvas) }];
};

const toAmount = (value: string): number => {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

/**
 * Receipt / invoice import: pick scans, let the AI draft the lines, review them
 * (each line carries its own budget category), then store the reviewed receipt
 * and its budget entries in one call — the totals and the per-category charts
 * stay consistent, a receipt is never double-counted, and the same call stocks
 * the pantry with the lines' brand-free names.
 */
export const ReceiptImportDialog: React.FC<Props> = ({ open, onOpenChange, currency, onImported }) => {
    const { t } = useTranslation(['budget', 'common', 'pantry.custom']);
    const { showToast } = useToast();
    const { categories } = useCategories();
    const fileInput = useRef<HTMLInputElement>(null);
    const cameraInput = useRef<HTMLInputElement>(null);
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
        for (const file of chosen) {
            const usable = SUPPORTED_TYPES.includes(file.type)
                && file.size <= (file.type === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)
                && files.length + accepted.length < MAX_FILES;
            if (usable) accepted.push(file);
            else rejected ??= file;
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
                let encoded: Attachment[];
                try {
                    encoded = await toAttachments(file);
                } catch (err) {
                    // Undecodable image (HEIC in a browser without its codec…) or a
                    // corrupt PDF: report it instead of uploading bytes the model
                    // cannot read. A PDF whose pages alone overflow the route's
                    // file count is reported the same way, before the upload.
                    if (analysisId.current === run) {
                        const tooManyPages = err instanceof Error && err.message === PDF_TOO_MANY_PAGES;
                        setError(
                            tooManyPages
                                ? t('budget.custom:receipt.errors.tooManyPages', { max: MAX_FILES, name: file.name })
                                : t('budget.custom:receipt.errors.unsupported', { name: file.name })
                        );
                        setAnalyzing(false);
                    }
                    return;
                }
                // A PDF costs one attachment per page: two scans and a two-page
                // bill still fit, a five-page bill next to a photo does not.
                if (attachments.length + encoded.length > MAX_FILES) {
                    if (analysisId.current === run) {
                        setError(t('budget.custom:receipt.errors.tooManyPages', { max: MAX_FILES, name: file.name }));
                        setAnalyzing(false);
                    }
                    return;
                }
                attachments.push(...encoded);
            }
            // One body carries every document: five big invoices can pass the
            // per-file checks and still make the route refuse the request.
            const payload = attachments.reduce((sum, file) => sum + file.data.length, 0);
            if (payload > MAX_PAYLOAD_BYTES) {
                if (analysisId.current === run) {
                    setError(t('budget.custom:receipt.errors.payload'));
                    setAnalyzing(false);
                }
                return;
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
                    pantry_item: item.pantry_item ?? '',
                    pantry_unit: item.pantry_unit ?? '',
                    // Kept as text for the input; '' when the ticket said
                    // nothing, which is what asks the family for it. A 0 from an
                    // older draft is the same unknown, not a zero amount.
                    pantry_content: item.pantry_content && item.pantry_content > 0 ? String(item.pantry_content) : '',
                    pantry_stock: item.pantry_stock === true,
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
                // Nothing was read from a ticket: the line is queued on the
                // pantry page rather than stocked under a name nobody checked.
                pantry_item: '',
                pantry_unit: '',
                pantry_content: '',
                pantry_stock: false,
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
        // "5" with no unit cannot be stocked: the pantry would store 5 of
        // nothing. An empty amount is fine — the pantry queue asks for it.
        if (includedLines.some((line) => toAmount(line.pantry_content) > 0 && line.pantry_unit.trim() === '')) {
            setError(t('budget.custom:receipt.contentNeedsUnit'));
            return;
        }

        setSaving(true);
        setError('');
        let pantry: { created: number; updated: number; pending: number; skipped?: number } | null = null;
        try {
            const response = await api.post<{
                success: boolean;
                data: { pantry?: { created: number; updated: number; pending: number; skipped?: number } | null };
            }>('/api/budget/receipts', {
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
                    // What the pantry stores: the brand-free name the model read off
                    // the ticket (empty → the label above), and whether it is stock
                    // the import may add without asking.
                    pantry_item: line.pantry_item,
                    pantry_unit: line.pantry_unit,
                    // toAmount, not Number(): "1,5" is a decimal here.
                    pantry_content: toAmount(line.pantry_content),
                    pantry_stock: line.pantry_stock,
                })).filter((item) => item.amount > 0),
                entries,
            });
            pantry = response.data?.pantry ?? null;
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
        // The server feeds the pantry with the same call (same transaction, one
        // guard per ticket): say what was stocked, and what is waiting for a
        // name on the pantry page. Nothing when the pantry feature is off.
        if (pantry && pantry.created + pantry.updated > 0) {
            showToast({
                title: t('pantry.custom:toasts.importedReceipt'),
                description: t('pantry.custom:toasts.stocked', { created: pantry.created, updated: pantry.updated }),
            });
        }
        if (pantry && pantry.pending > 0) {
            showToast({
                title: t('pantry.custom:toasts.receiptPending', { count: pantry.pending }),
                description: t('pantry.custom:pending.subtitle'),
            });
        }
        // The pantry row of that product already counts another unit (kg vs
        // pièce): the line stays in the budget but is not stocked.
        if (pantry && (pantry.skipped ?? 0) > 0) {
            showToast({
                title: t('pantry.custom:toasts.skippedUnits', { count: pantry.skipped ?? 0 }),
            });
        }
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

    /**
     * How much product the line holds. A ticket often prints only the price, so
     * the amount is editable here: shown when known, asked for when not — a
     * blank amount is what makes the pantry queue ask again.
     */
    // Known only when both halves are there: an amount typed without its unit
    // keeps the two inputs open, so the family can finish what it started.
    const contentField = (line: ReviewLine) =>
        toAmount(line.pantry_content) > 0 && line.pantry_unit.trim() !== '' ? (
            <p className="truncate text-micro text-muted-foreground">
                {[line.pantry_content.trim(), line.pantry_unit.trim()].filter(Boolean).join(' ')}
            </p>
        ) : (
            <div className="space-y-1">
                <div className="flex gap-2">
                    <input
                        value={line.pantry_content}
                        inputMode="decimal"
                        placeholder={t('budget.custom:receipt.contentLabel')}
                        aria-label={`${t('budget.custom:receipt.contentLabel')} — ${line.label || t('budget.custom:receipt.lineLabel')}`}
                        onChange={(event) => patchLine(line.id, { pantry_content: event.target.value })}
                        className="input-nexus min-w-0 flex-1 py-0 text-caption"
                    />
                    <input
                        value={line.pantry_unit}
                        placeholder={t('budget.custom:receipt.unitLabel')}
                        aria-label={`${t('budget.custom:receipt.unitLabel')} — ${line.label || t('budget.custom:receipt.lineLabel')}`}
                        onChange={(event) => patchLine(line.id, { pantry_unit: event.target.value })}
                        className="input-nexus w-20 shrink-0 py-0 text-caption"
                    />
                </div>
                <p className="text-micro text-muted-foreground">{t('budget.custom:receipt.contentHint')}</p>
            </div>
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
                        {/* `capture` is what opens the camera: a plain file input
                            only lists the documents the shell lets the user pick. */}
                        <input
                            ref={cameraInput}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(event) => {
                                addFiles(event.target.files);
                                event.target.value = '';
                            }}
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => cameraInput.current?.click()}
                                className="flex flex-col items-center gap-2 rounded-input border border-dashed border-border bg-surface-1 px-4 py-6 text-center transition-colors hover:bg-surface-2"
                            >
                                <Camera className="h-6 w-6 text-muted-foreground" />
                                <span className="text-caption font-medium text-foreground">{t('budget.custom:receipt.takePhoto')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInput.current?.click()}
                                className="flex flex-col items-center gap-2 rounded-input border border-dashed border-border bg-surface-1 px-4 py-6 text-center transition-colors hover:bg-surface-2"
                            >
                                <Upload className="h-6 w-6 text-muted-foreground" />
                                <span className="text-caption font-medium text-foreground">{t('budget.custom:receipt.pick')}</span>
                                <span className="text-micro text-muted-foreground">{t('budget.custom:receipt.filesHint')}</span>
                            </button>
                        </div>

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
                                                        onChange={(event) => patchLine(line.id, {
                                                            label: event.target.value,
                                                            // The AI's pantry name described the label it read:
                                                            // a corrected label is what the pantry should store.
                                                            pantry_item: '',
                                                        })}
                                                        placeholder={t('budget.custom:receipt.lineLabel')}
                                                        className="input-nexus py-0 text-caption"
                                                    />
                                                    {contentField(line)}
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
