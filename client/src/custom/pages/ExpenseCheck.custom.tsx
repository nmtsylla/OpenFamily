import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Check, Image as ImageIcon, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { dateLocale } from '../../i18n/format';
import { useAuth } from '../../contexts/AuthContext';
import { useAiEnabled } from '../../lib/aiStatus';
import { Button, Card, CardContent, useToast } from '../../components/ui';
import { toScreenshotAttachment } from '../lib/screenshotUpload.custom';

// Did every payment make it into the budget?
//
// The family's meal-voucher card and bank app list what really left the account.
// A screenshot of one of those screens is read by the configured model
// (POST /api/expense-check/scan), and the server pairs each payment with a budget
// expense of the same amount within a few days. This page is the answer: the
// payments nothing accounts for, each with "Add" (one expense, one line) and
// "Ignore". Matching lives on the server, so the page only renders a verdict it
// was given — deleting the expense from the Budget page brings the payment back
// here on the next load.

interface CheckedPayment {
    id: string;
    source: string;
    date: string;
    label: string;
    amount: number;
    currency: string | null;
    status: 'pending' | 'ignored';
    /** The budget expense that accounts for this payment, null when none does. */
    entry: { id: string; date: string; description: string | null; amount: number } | null;
}

interface Summary {
    missingCount: number;
    missingTotal: number;
    accountedCount: number;
    accountedTotal: number;
    ignoredCount: number;
}

type Filter = 'missing' | 'accounted' | 'ignored';

const MAX_FILES = 6;

const ExpenseCheckPage: React.FC = () => {
    const { t } = useTranslation(['expenseCheck.custom', 'common']);
    const { user, isModuleEnabled } = useAuth();
    const { showToast } = useToast();
    const aiEnabled = useAiEnabled();
    const currency = user?.currency || 'EUR';
    const canEdit = Boolean(user?.is_owner) || (user?.role ?? '').toLowerCase() !== 'enfant';

    const [payments, setPayments] = useState<CheckedPayment[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [windowDays, setWindowDays] = useState(4);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [filter, setFilter] = useState<Filter>('missing');
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    // Bumped on every scan so a result of an abandoned run is dropped.
    const scanId = useRef(0);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const response = await api.get<{
                success: boolean;
                data: { transactions: CheckedPayment[]; summary: Summary; windowDays: number };
            }>('/api/expense-check');
            if (response.success) {
                setPayments(response.data?.transactions ?? []);
                setSummary(response.data?.summary ?? null);
                setWindowDays(response.data?.windowDays ?? 4);
            } else {
                setFailed(true);
            }
        } catch (error) {
            console.error('Failed to load the payment check:', error);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const missing = useMemo(
        () => payments.filter((payment) => payment.entry === null && payment.status === 'pending'),
        [payments],
    );
    const accounted = useMemo(() => payments.filter((payment) => payment.entry !== null), [payments]);
    const ignored = useMemo(
        () => payments.filter((payment) => payment.entry === null && payment.status === 'ignored'),
        [payments],
    );

    const visible = filter === 'missing' ? missing : filter === 'accounted' ? accounted : ignored;

    const scan = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const run = scanId.current + 1;
        scanId.current = run;
        setScanning(true);
        setScanError(null);
        try {
            const picked = Array.from(files).slice(0, MAX_FILES);
            const attachments = await Promise.all(picked.map(toScreenshotAttachment));
            const response = await api.post<{
                success: boolean;
                data: { added: number; duplicates: number; skipped: number };
            }>('/api/expense-check/scan', { files: attachments });
            if (scanId.current !== run) return;
            showToast({
                title: t('expenseCheck.custom:page.scanned', {
                    count: response.data?.added ?? 0,
                }),
            });
            if ((response.data?.duplicates ?? 0) > 0) {
                showToast({
                    title: t('expenseCheck.custom:page.duplicates', { count: response.data.duplicates }),
                });
            }
            setFilter('missing');
            await load();
        } catch (error) {
            if (scanId.current !== run) return;
            const message = error instanceof Error ? error.message : '';
            setScanError(
                message === 'AI_NOT_CONFIGURED'
                    ? t('expenseCheck.custom:errors.ai')
                    : message === 'UNSUPPORTED_MEDIA' || message === 'UNREADABLE_FILE'
                      ? t('expenseCheck.custom:errors.media')
                      : t('expenseCheck.custom:errors.scan'),
            );
        } finally {
            if (scanId.current === run) setScanning(false);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const act = async (payment: CheckedPayment, action: 'add' | 'ignore' | 'restore' | 'delete') => {
        setBusyId(payment.id);
        try {
            if (action === 'add') {
                await api.post(`/api/expense-check/${payment.id}/add`, {});
                showToast({ title: t('expenseCheck.custom:page.added') });
            } else if (action === 'delete') {
                await api.delete(`/api/expense-check/${payment.id}`);
                showToast({ title: t('expenseCheck.custom:page.deleted') });
            } else {
                await api.post(`/api/expense-check/${payment.id}/status`, {
                    status: action === 'ignore' ? 'ignored' : 'pending',
                });
                showToast({
                    title: action === 'ignore'
                        ? t('expenseCheck.custom:page.ignored')
                        : t('expenseCheck.custom:page.restored'),
                });
            }
            await load();
        } catch (error) {
            console.error('Payment check action failed:', error);
            showToast({ title: t('expenseCheck.custom:errors.generic') });
        } finally {
            setBusyId(null);
        }
    };

    if (!isModuleEnabled('expenseCheck')) return null;

    const cur = (value: number) => formatCurrency(value, currency);

    const chip = (key: Filter, label: string, count: number) => (
        <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 text-caption font-medium transition-colors ${
                filter === key
                    ? 'bg-primary text-white'
                    : 'bg-surface-2 text-muted-foreground hover:text-foreground'
            }`}
        >
            {label} ({count})
        </button>
    );

    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <Link
                        to="/budget"
                        className="mb-1 inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        {t('expenseCheck.custom:page.back')}
                    </Link>
                    <h1 className="text-h1">{t('expenseCheck.custom:page.title')}</h1>
                    <p className="text-body text-muted-foreground">{t('expenseCheck.custom:page.subtitle')}</p>
                </div>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void load()}
                    disabled={loading}
                    className="mt-6 shrink-0"
                    aria-label={t('expenseCheck.custom:page.refresh')}
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            {canEdit && (
                <Card>
                    <CardContent className="space-y-2 p-4">
                        <input
                            ref={fileInput}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            multiple
                            className="hidden"
                            onChange={(event) => void scan(event.target.files)}
                        />
                        <Button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            disabled={scanning || !aiEnabled}
                            className="w-full"
                        >
                            {scanning ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <ImageIcon className="mr-2 h-4 w-4" />
                            )}
                            {scanning
                                ? t('expenseCheck.custom:page.scanning')
                                : t('expenseCheck.custom:page.scan')}
                        </Button>
                        <p className="text-micro text-muted-foreground">
                            {aiEnabled
                                ? t('expenseCheck.custom:page.scanHint')
                                : t('expenseCheck.custom:errors.ai')}
                        </p>
                        {scanError && <p className="text-caption text-danger">{scanError}</p>}
                    </CardContent>
                </Card>
            )}

            {summary && summary.missingCount + summary.accountedCount + summary.ignoredCount > 0 && (
                <Card>
                    <CardContent className="grid grid-cols-2 gap-3 p-4">
                        <div>
                            <p className="text-h2">{summary.missingCount}</p>
                            <p className="text-caption text-muted-foreground">
                                {t('expenseCheck.custom:page.missingTitle')}
                            </p>
                            <p className="text-caption font-medium">{cur(summary.missingTotal)}</p>
                        </div>
                        <div>
                            <p className="text-h2">{summary.accountedCount}</p>
                            <p className="text-caption text-muted-foreground">
                                {t('expenseCheck.custom:page.accountedTitle')}
                            </p>
                            <p className="text-caption font-medium">{cur(summary.accountedTotal)}</p>
                        </div>
                        <p className="col-span-2 text-micro text-muted-foreground">
                            {t('expenseCheck.custom:page.window', { days: windowDays })}
                        </p>
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-wrap gap-2">
                {chip('missing', t('expenseCheck.custom:page.missingTab'), missing.length)}
                {chip('accounted', t('expenseCheck.custom:page.accountedTab'), accounted.length)}
                {chip('ignored', t('expenseCheck.custom:page.ignoredTab'), ignored.length)}
            </div>

            <Card>
                <CardContent className="p-0">
                    {loading && payments.length === 0 ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="spinner-brand" />
                        </div>
                    ) : failed ? (
                        <p className="py-12 text-center text-sm text-muted-foreground">
                            {t('expenseCheck.custom:errors.load')}
                        </p>
                    ) : visible.length === 0 ? (
                        <p className="py-12 text-center text-sm text-muted-foreground">
                            {filter === 'missing'
                                ? t('expenseCheck.custom:page.emptyMissing')
                                : filter === 'accounted'
                                  ? t('expenseCheck.custom:page.emptyAccounted')
                                  : t('expenseCheck.custom:page.emptyIgnored')}
                        </p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {visible.map((payment) => {
                                const day = payment.date
                                    ? format(parseISO(payment.date), 'dd MMM', { locale: dateLocale() })
                                    : '—';
                                const busy = busyId === payment.id;
                                return (
                                    <li key={payment.id} className="space-y-2 px-4 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <span className="shrink-0 rounded-input bg-surface-2 px-2 py-1 text-micro font-medium">
                                                    {day}
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">{payment.label}</p>
                                                    <p className="truncate text-micro text-muted-foreground">
                                                        {payment.source}
                                                        {payment.entry && (
                                                            <>
                                                                {' · '}
                                                                {t('expenseCheck.custom:page.matchedWith', {
                                                                    description: payment.entry.description
                                                                        ?? t('expenseCheck.custom:page.unnamedEntry'),
                                                                })}
                                                            </>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="shrink-0 text-sm font-semibold">
                                                {cur(payment.amount)}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap justify-end gap-2">
                                            {payment.entry === null && payment.status === 'pending' && canEdit && (
                                                <>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => void act(payment, 'add')}
                                                        disabled={busy}
                                                    >
                                                        <Check className="mr-1.5 h-3.5 w-3.5" />
                                                        {t('expenseCheck.custom:page.add')}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => void act(payment, 'ignore')}
                                                        disabled={busy}
                                                    >
                                                        <X className="mr-1.5 h-3.5 w-3.5" />
                                                        {t('expenseCheck.custom:page.ignore')}
                                                    </Button>
                                                </>
                                            )}
                                            {payment.entry === null && payment.status === 'ignored' && canEdit && (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => void act(payment, 'restore')}
                                                    disabled={busy}
                                                >
                                                    {t('expenseCheck.custom:page.restore')}
                                                </Button>
                                            )}
                                            {canEdit && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => void act(payment, 'delete')}
                                                    disabled={busy}
                                                    aria-label={t('expenseCheck.custom:page.delete')}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ExpenseCheckPage;
