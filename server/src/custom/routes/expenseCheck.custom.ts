// =============================================================================
// /api/expense-check — did every payment make it into the budget?
//
// The family pays with a meal-voucher card and a bank card; those apps list what
// really left the account. This screen reads such a screenshot (`POST /scan`),
// stores the payments it found, and pairs each of them with a budget expense of
// the same amount within a few days (`lib/expenseCheck.custom.ts`). What no
// expense accounts for is what the page offers to add — one line, one entry — or
// to ignore.
//
// The pairing is computed on every read, never stored: deleting the budget
// entry that accounted for a payment makes it show up again, which is exactly
// what the family wants to see. The only column that is stored is
// `budget_entry_id`, set when the payment was added from this page, so that
// entry is not offered to a second payment.
// =============================================================================

import express, { Router } from 'express';
import { query } from '../../db';
import { authMiddleware, AuthRequest, requireParent } from '../../middleware/auth';
import { broadcast } from '../../lib/broadcaster';
import { aiCompleteWithUsage, type AiAttachment } from '../../services/ai/index';
import { localToday } from '../../services/ai/assistant';
import { getFamilyCategories } from '../../routes/categories';
import { handleAiError, loadEnabledAiSettings } from '../lib/aiSettings.custom';
import { isUuid } from '../lib/validation.custom';
import { matchPayments, MATCH_WINDOW_DAYS, type EntryToMatch, type PaymentToCheck } from '../lib/expenseCheck.custom';
import {
    buildTransactionPrompt,
    MAX_TXN_FILES,
    MAX_TXN_FILE_BYTES,
    TXN_MEDIA_TYPES,
    TXN_SCHEMA,
    transactionFingerprint,
    validateTransactions,
} from '../ai/transactions.custom';

const router = Router();
router.use(authMiddleware);

// Screenshots as base64 are far larger than the 1 MB the rest of the API takes.
// This parser runs on the scan route only, after authMiddleware and
// requireParent; app.ts skips its own JSON parser for this path so an anonymous
// request never gets its body read at all (same arrangement as the receipt
// import in routes/ai.ts).
const scanBodyParser = express.json({ limit: '12mb' });

const toNumber = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
};

const dayOf = (value: unknown): string => String(value ?? '').slice(0, 10);

interface PaymentRow {
    id: string;
    source: string;
    entry_date: unknown;
    label: string;
    amount: unknown;
    currency: string | null;
    status: string;
    budget_entry_id: string | null;
    entry_description: string | null;
    /** The linked entry's own date (the payment's date when this page created it). */
    linked_entry_date: unknown;
}

// GET /api/expense-check — every stored payment with its verdict.
router.get('/', async (req: AuthRequest, res) => {
    try {
        const rows = (
            await query(
                `SELECT t.id, t.source, t.entry_date, t.label, t.amount, t.currency, t.status, t.budget_entry_id,
                        be.description AS entry_description, be.date AS linked_entry_date
                   FROM custom_payment_transactions t
                   LEFT JOIN budget_entries be ON be.id = t.budget_entry_id
                  WHERE t.user_id = $1
                  ORDER BY t.entry_date DESC, t.created_at DESC`,
                [req.userId],
            )
        ).rows as PaymentRow[];

        const linked = rows.filter((row) => row.budget_entry_id !== null);
        const pending = rows.filter((row) => row.status === 'pending' && row.budget_entry_id === null);

        // What the pending payments can pair with: the expenses of this family,
        // expense side, inside the window of the oldest and newest pending
        // payment — plus the IMPORTED RECEIPTS' totals. An itemised receipt
        // creates one entry per line, so a 17.63 card payment at the supermarket
        // matches none of its 5.00 / 12.63 lines while the ticket itself is
        // accounted for; without the receipt totals that payment would be offered
        // for adding a second time. Nothing is fetched when there is nothing to pair.
        let pool: EntryToMatch[] = [];
        if (pending.length > 0) {
            const dates = pending.map((row) => dayOf(row.entry_date)).sort();
            const range = [req.userId, dates[0], dates[dates.length - 1], MATCH_WINDOW_DAYS];
            const entries = await query(
                `SELECT id, date, amount, description
                   FROM budget_entries
                  WHERE user_id = $1
                    AND is_expense
                    AND date BETWEEN ($2::date - $4::int) AND ($3::date + $4::int)`,
                range,
            );
            pool = (entries.rows as Array<Record<string, unknown>>).map((row) => ({
                id: String(row.id),
                date: dayOf(row.date),
                amount: toNumber(row.amount),
                description: (row.description as string | null) ?? null,
            }));
            const receipts = await query(
                `SELECT id, date, total, merchant
                   FROM budget_receipts
                  WHERE user_id = $1
                    AND date BETWEEN ($2::date - $4::int) AND ($3::date + $4::int)`,
                range,
            );
            for (const row of receipts.rows as Array<Record<string, unknown>>) {
                pool.push({
                    // Prefixed: a receipt id and an entry id are different things
                    // to the matcher, which only ever compares ids for equality.
                    id: `receipt:${String(row.id)}`,
                    date: dayOf(row.date),
                    amount: toNumber(row.total),
                    description: (row.merchant as string | null) ?? null,
                });
            }
        }

        const claimed = linked
            .map((row) => row.budget_entry_id)
            .filter((id): id is string => id !== null);
        const matches = matchPayments(
            pending.map<PaymentToCheck>((row) => ({
                id: row.id,
                date: dayOf(row.entry_date),
                amount: toNumber(row.amount),
            })),
            pool,
            claimed,
        );
        const poolById = new Map(pool.map((entry) => [entry.id, entry]));

        const transactions = rows.map((row) => {
            const matchedId = matches.get(row.id) ?? null;
            const entry = matchedId ? poolById.get(matchedId) ?? null : null;
            const linkedEntry = row.budget_entry_id
                ? {
                      id: row.budget_entry_id,
                      date: dayOf(row.linked_entry_date),
                      description: row.entry_description,
                      amount: toNumber(row.amount),
                  }
                : null;
            return {
                id: row.id,
                source: row.source,
                date: dayOf(row.entry_date),
                label: row.label,
                amount: toNumber(row.amount),
                currency: row.currency,
                status: row.status,
                /** The budget expense that accounts for this payment, null when none does. */
                entry: entry ?? linkedEntry,
            };
        });

        const accounted = transactions.filter((t) => t.entry !== null);
        const missing = transactions.filter((t) => t.entry === null && t.status === 'pending');
        const total = (list: typeof transactions) => Math.round(list.reduce((sum, t) => sum + t.amount, 0) * 100) / 100;

        res.json({
            success: true,
            data: {
                transactions,
                windowDays: MATCH_WINDOW_DAYS,
                summary: {
                    missingCount: missing.length,
                    missingTotal: total(missing),
                    accountedCount: accounted.length,
                    accountedTotal: total(accounted),
                    ignoredCount: transactions.filter((t) => t.status === 'ignored' && t.entry === null).length,
                },
            },
        });
    } catch (error) {
        console.error('List payment check error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/expense-check/scan — screenshots in, payments stored, duplicates
// skipped. Nothing here creates a budget entry: the family decides line by line
// on the page (POST /:id/add).
router.post('/scan', requireParent, scanBodyParser, async (req: AuthRequest, res) => {
    try {
        const settings = await loadEnabledAiSettings(req.userId!);
        if (!settings) {
            return res.status(400).json({ success: false, error: 'AI_NOT_CONFIGURED' });
        }

        const rawFiles = Array.isArray(req.body?.files) ? (req.body.files as unknown[]) : [];
        if (rawFiles.length === 0 || rawFiles.length > MAX_TXN_FILES) {
            return res.status(400).json({ success: false, error: `files must hold 1 to ${MAX_TXN_FILES} screenshots` });
        }

        const attachments: AiAttachment[] = [];
        for (const entry of rawFiles) {
            const file = (entry ?? {}) as { mime_type?: unknown; data?: unknown; name?: unknown };
            const mediaType = typeof file.mime_type === 'string' ? file.mime_type.trim().toLowerCase() : '';
            const data = typeof file.data === 'string' ? file.data : '';
            if (!(TXN_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
                return res.status(400).json({ success: false, error: 'UNSUPPORTED_MEDIA' });
            }
            // Shape before size: base64-decoding arbitrary junk is wasted work.
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
                return res.status(400).json({ success: false, error: 'UNREADABLE_FILE' });
            }
            if (Buffer.byteLength(data, 'base64') > MAX_TXN_FILE_BYTES) {
                return res.status(413).json({ success: false, error: 'FILE_TOO_LARGE' });
            }
            attachments.push({
                mediaType,
                data,
                name: typeof file.name === 'string' ? file.name.slice(0, 100) : undefined,
            });
        }

        const categories = await getFamilyCategories(req.userId!);
        const currencyRow = await query('SELECT currency FROM users WHERE id = $1', [req.userId]);
        const currency = (currencyRow.rows[0] as { currency?: string } | undefined)?.currency || 'EUR';

        const { data: raw, usage } = await aiCompleteWithUsage(settings, {
            system: buildTransactionPrompt(categories.budget, localToday().iso, currency),
            user: 'Lis la capture ci-jointe et réponds uniquement avec le JSON demandé.',
            jsonSchema: TXN_SCHEMA,
            attachments,
        });
        const extraction = validateTransactions(raw, categories.budget, localToday().iso);

        // The fingerprint is the duplicate guard (UNIQUE (user_id, fingerprint)),
        // so re-scanning yesterday's screenshot adds nothing.
        let added = 0;
        for (const transaction of extraction.transactions) {
            const inserted = await query(
                `INSERT INTO custom_payment_transactions
                    (user_id, source, entry_date, label, amount, currency, category, fingerprint)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (user_id, fingerprint) DO NOTHING
                 RETURNING id`,
                [
                    req.userId,
                    transaction.source,
                    transaction.date,
                    transaction.label,
                    transaction.amount,
                    currency,
                    transaction.category,
                    transactionFingerprint(transaction.source, transaction.date, transaction.amount, transaction.label),
                ],
            );
            if (inserted.rows.length > 0) added += 1;
        }

        res.json({
            success: true,
            data: {
                added,
                duplicates: extraction.transactions.length - added,
                skipped: extraction.skipped,
                usage,
            },
        });
    } catch (error) {
        handleAiError(res, error, 'scan_payments');
    }
});

// POST /api/expense-check/:id/add — turn one payment into one budget expense.
// The category was mapped onto the family's list at scan time; the label and the
// date are the payment's own, so the budget shows what the shop's screen showed.
router.post('/:id/add', requireParent, async (req: AuthRequest, res) => {
    try {
        const id = req.params.id;
        if (!isUuid(id)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }
        const found = await query(
            'SELECT id, entry_date, label, amount, category, budget_entry_id FROM custom_payment_transactions WHERE id = $1 AND user_id = $2',
            [id, req.userId],
        );
        const row = found.rows[0] as
            | { id: string; entry_date: unknown; label: string; amount: unknown; category: string; budget_entry_id: string | null }
            | undefined;
        if (!row) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }
        if (row.budget_entry_id) {
            return res.status(409).json({ success: false, error: 'ALREADY_ADDED' });
        }

        const created = await query(
            `INSERT INTO budget_entries (user_id, category, amount, description, date, is_expense)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING id, category, amount, description, date`,
            [req.userId, row.category, toNumber(row.amount), row.label, dayOf(row.entry_date)],
        );
        const entry = created.rows[0] as { id: string };
        await query(
            'UPDATE custom_payment_transactions SET status = $3, budget_entry_id = $4 WHERE id = $1 AND user_id = $2',
            [id, req.userId, 'pending', entry.id],
        );

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'created' });
        res.status(201).json({ success: true, data: { entry } });
    } catch (error) {
        console.error('Add payment to budget error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/expense-check/:id/status — ignore a payment ("it is not missing, I
// know about it"), or put it back in the missing list.
router.post('/:id/status', requireParent, async (req: AuthRequest, res) => {
    try {
        const id = req.params.id;
        const status = (req.body ?? {}).status;
        if (!isUuid(id) || (status !== 'ignored' && status !== 'pending')) {
            return res.status(400).json({ success: false, error: 'Invalid request' });
        }
        const updated = await query(
            'UPDATE custom_payment_transactions SET status = $3 WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId, status],
        );
        if (updated.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Update payment check error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/expense-check/:id — the model misread a line: drop it. The budget
// entry it created, if any, is the family's own and is left alone.
router.delete('/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const id = req.params.id;
        if (!isUuid(id)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }
        const deleted = await query('DELETE FROM custom_payment_transactions WHERE id = $1 AND user_id = $2 RETURNING id', [
            id,
            req.userId,
        ]);
        if (deleted.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Delete payment check error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
