import { Router } from 'express';
import { getClient, query } from '../../db';
import { authMiddleware, AuthRequest, requireParent } from '../../middleware/auth';
import { broadcast } from '../../lib/broadcaster';
import {
    receiptFingerprint,
    validateReceiptImport,
    validateReceiptLine,
    type ReceiptImportPayload,
} from '../ai/receipt.custom';
import { getFamilyCategories } from '../../routes/categories';
import { isUuid } from '../lib/validation.custom';
import { isCustomFeatureEnabled } from '../features.custom';
import { splitReceiptLines } from '../lib/pantry.custom';
import { mergeIntoPantry } from '../lib/pantryMerge.custom';
import {
    cleanUnit,
    groupMissingAmounts,
    parsePerPack,
    planAmountFill,
    type AmountlessLine,
} from '../lib/receiptAmounts.custom';

// Imported receipts and bills, with their line detail.
//
// One import = one receipt row + its lines + the budget entries the family sees.
// The entries carry `receipt_id`, so the Budget page can show a single row per
// receipt and open it to reveal what was bought, deleting a receipt removes its
// entries with it, and the lines stay in the database for later analysis.
//
// An import is "itemized" (one entry per line, each in its own category) or
// "single" (one entry for the whole amount, for a bill whose breakdown is
// useless). The lines are archived in both cases.
//
// When the pantry feature is on, the same transaction also stocks the pantry
// with the lines the model called plainly stockable, under their brand-free
// `pantry_item` (ai/receipt.custom.ts); the rest wait in `custom_pantry_pending`
// for the family to name on the pantry page. The guard in
// `custom_pantry_imports` is keyed on the ticket's fingerprint, so scanning the
// same ticket again never counts its products twice.
const router = Router();
router.use(authMiddleware);

const toNumber = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
};

// pg types every row as `any`; these are the shapes the queries below select, so
// the mapping helpers can stay checked.
interface ReceiptRow {
    id: string;
    merchant: string;
    date: string;
    total: unknown;
    currency: string;
    document_type: string;
    category: string;
    import_mode: string;
    source_name: string | null;
    entry_count: unknown;
    pantry_imported?: boolean;
    created_at: unknown;
}

interface ReceiptItemRow {
    id: string;
    receipt_id: string;
    label: string;
    quantity: unknown;
    unit_price: unknown;
    amount: unknown;
    category: string;
}

const mapItem = (row: ReceiptItemRow) => ({
    id: row.id,
    label: row.label,
    quantity: toNumber(row.quantity),
    unit_price: toNumber(row.unit_price),
    amount: toNumber(row.amount),
    category: row.category,
});

const mapReceipt = (row: ReceiptRow, items: ReceiptItemRow[]) => ({
    id: row.id,
    merchant: row.merchant,
    date: row.date,
    total: toNumber(row.total),
    currency: row.currency,
    document_type: row.document_type,
    category: row.category,
    import_mode: row.import_mode,
    source_name: row.source_name,
    entry_count: toNumber(row.entry_count),
    /** Already in the pantry: the manual "add to pantry" button has nothing to do. */
    pantry_imported: row.pantry_imported === true,
    created_at: row.created_at,
    items: items.map(mapItem),
});

/** What the pantry side of an import did: rows merged, lines left to review, seeds refused. */
interface PantryImportResult {
    created: number;
    updated: number;
    /** Lines left in the review queue (some of them asking for an amount). */
    pending: number;
    /** Seeds not merged because their unit contradicts the pantry row's own. */
    skipped: number;
}

/** SQLSTATE of a pg error, '' for anything else ("23505" = unique_violation). */
const sqlStateOf = (error: unknown): string => {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = error.code;
        return typeof code === 'string' ? code : '';
    }
    return '';
};

/**
 * The entries and the receipt header, inserted in ONE transaction: a receipt
 * with half its lines, or lines with no receipt, would be worse than no import
 * at all. The unique index on (user_id, fingerprint) is the real duplicate
 * guard (it also holds when two imports race); the pre-check below only exists
 * to answer with a friendly 409 instead of a constraint violation.
 *
 * The pantry is fed in that same transaction when the feature is on: the
 * obviously stockable lines merge straight in (brand-free names the model read
 * off the ticket), the others are queued in `custom_pantry_pending` for the
 * pantry page. The guard row is keyed on the TICKET's fingerprint, so a ticket
 * deleted and scanned again does not count its groceries twice. `pantry` is null
 * when the feature is off or that ticket was already processed.
 */
const insertReceipt = async (
    userId: string,
    payload: ReceiptImportPayload,
    fingerprint: string,
): Promise<{ id: string; pantry: PantryImportResult | null } | null> => {
    const client = await getClient();
    try {
        await client.query('BEGIN');

        const inserted = await client.query(
            `INSERT INTO budget_receipts
                (user_id, merchant, date, total, currency, document_type, category, import_mode, source_name, fingerprint)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id`,
            [
                userId,
                payload.merchant,
                payload.date,
                payload.total,
                payload.currency,
                payload.documentType,
                payload.category,
                payload.mode,
                payload.sourceName || null,
                fingerprint,
            ]
        );
        const receiptId = inserted.rows[0].id as string;

        for (const [position, item] of payload.items.entries()) {
            await client.query(
                `INSERT INTO budget_receipt_items
                    (receipt_id, position, label, quantity, unit_price, amount, category, product, unit, content)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    receiptId,
                    position,
                    item.label,
                    item.quantity,
                    item.unit_price,
                    item.amount,
                    item.category,
                    item.pantry_item || null,
                    item.pantry_unit || null,
                    // NULL, not 0: the ticket did not say how much the line holds.
                    item.pantry_content > 0 ? item.pantry_content : null,
                ]
            );
        }

        for (const entry of payload.entries) {
            await client.query(
                `INSERT INTO budget_entries
                    (user_id, category, amount, description, date, is_expense, receipt_id)
                 VALUES ($1, $2, $3, $4, $5, true, $6)`,
                [userId, entry.category, entry.amount, entry.description || payload.merchant, payload.date, receiptId]
            );
        }

        // The pantry, in the same transaction: the cart that fed the budget also
        // feeds what the household has at home. The guard is inserted inside the
        // transaction too, so a rolled-back import leaves no guard behind and can
        // be retried; when the guard already exists (this ticket was imported
        // before, even if its receipt was deleted since) the products are already
        // counted, so nothing is merged or queued again.
        //
        // A pantry line with no known amount is NOT stocked as 1: it waits in the
        // queue with `needs_amount`, and the family answers on the pantry page
        // (custom/0011-pantry-pending-amount).
        //
        // A receipt with no usable line (a bill whose breakdown is useless — the
        // family may add its lines by hand afterwards) takes NO guard: there is
        // nothing to record, and the guard would both hide the manual "add to
        // pantry" button and make it answer 409 for the lines added later.
        let pantry: PantryImportResult | null = null;
        if (isCustomFeatureEnabled('pantry')) {
            const { stock, pending } = splitReceiptLines(payload.items);
            if (stock.length + pending.length > 0) {
                const guard = await client.query(
                    `INSERT INTO custom_pantry_imports (user_id, source, source_ref)
                     VALUES ($1, 'receipt', $2)
                     ON CONFLICT (user_id, source, source_ref) DO NOTHING
                     RETURNING id`,
                    [userId, fingerprint]
                );
                if (guard.rows.length > 0) {
                    const merged = await mergeIntoPantry(client, userId, stock, 'receipt');
                    for (const line of pending) {
                        await client.query(
                            `INSERT INTO custom_pantry_pending
                                (user_id, receipt_id, label, item, quantity, unit, category, needs_amount)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                            [userId, receiptId, line.label, line.item, line.quantity, line.unit, line.category, line.needs_amount]
                        );
                    }
                    pantry = { ...merged, pending: pending.length };
                }
            }
        }

        await client.query('COMMIT');
        return { id: receiptId, pantry };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        // 23505 = unique_violation, i.e. the same receipt is already stored.
        if (sqlStateOf(error) === '23505') return null;
        throw error;
    } finally {
        client.release();
    }
};

// POST /api/budget/receipts — parents only: store a reviewed receipt and the
// budget entries it creates. 409 RECEIPT_DUPLICATE when this family already has
// the same merchant/date/amount (the same ticket scanned twice).
router.post('/', requireParent, async (req: AuthRequest, res) => {
    try {
        const categories = await getFamilyCategories(req.userId!);
        const currencyResult = await query('SELECT currency FROM users WHERE id = $1', [req.userId]);
        const currency = (currencyResult.rows[0] as { currency?: string } | undefined)?.currency || 'EUR';

        const payload = validateReceiptImport(
            (req.body ?? {}) as Record<string, unknown>,
            categories.budget,
            currency
        );
        if (!payload) {
            return res.status(400).json({
                success: false,
                error: 'date, total et lignes sont requis, et le détail doit correspondre aux écritures',
            });
        }

        const fingerprint = receiptFingerprint(payload.merchant, payload.date, payload.total);
        const existing = await query(
            'SELECT id, date, merchant, total FROM budget_receipts WHERE user_id = $1 AND fingerprint = $2',
            [req.userId, fingerprint]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'RECEIPT_DUPLICATE',
                data: {
                    id: existing.rows[0].id,
                    date: existing.rows[0].date,
                    merchant: existing.rows[0].merchant,
                },
            });
        }

        const imported = await insertReceipt(req.userId!, payload, fingerprint);
        if (!imported) {
            return res.status(409).json({ success: false, error: 'RECEIPT_DUPLICATE' });
        }

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'created' });
        // The pantry page and its dashboard widget live on another entity's
        // events: same event the /api/pantry bridges fire after a merge. Sent
        // for queued lines too — the review list changed even when nothing was
        // merged.
        if (imported.pantry && imported.pantry.created + imported.pantry.updated + imported.pantry.pending > 0) {
            broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        }
        res.status(201).json({
            success: true,
            data: {
                receipt: {
                    id: imported.id,
                    merchant: payload.merchant,
                    date: payload.date,
                    total: payload.total,
                    currency: payload.currency,
                    document_type: payload.documentType,
                    category: payload.category,
                    import_mode: payload.mode,
                    source_name: payload.sourceName,
                    entry_count: payload.entries.length,
                    items: payload.items.map((item, index) => ({ id: String(index), ...item })),
                },
                entry_count: payload.entries.length,
                // { created, updated, pending, skipped } when this import also fed the
                // pantry, null when the pantry feature is off or this ticket was
                // already processed (see insertReceipt).
                pantry: imported.pantry,
            },
        });
    } catch (error) {
        console.error('Create budget receipt error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/budget/receipts?start_date=&end_date= — receipts of the period with
// their lines, newest first (the Budget page opens one to show its detail).
router.get('/', async (req: AuthRequest, res) => {
    try {
        const { start_date, end_date } = req.query;
        const params: unknown[] = [req.userId];
        let queryText = `SELECT r.*,
                   (SELECT count(*) FROM budget_entries be WHERE be.receipt_id = r.id) AS entry_count,
                   EXISTS (
                       SELECT 1 FROM custom_pantry_imports pi
                       WHERE pi.user_id = r.user_id AND pi.source = 'receipt' AND pi.source_ref = r.fingerprint
                   ) AS pantry_imported
            FROM budget_receipts r
            WHERE r.user_id = $1`;

        if (start_date) {
            params.push(start_date);
            queryText += ` AND r.date >= $${params.length}`;
        }
        if (end_date) {
            params.push(end_date);
            queryText += ` AND r.date <= $${params.length}`;
        }
        queryText += ' ORDER BY r.date DESC, r.created_at DESC';

        const receipts = await query(queryText, params);
        const rows = receipts.rows as ReceiptRow[];
        const itemsByReceipt: Record<string, ReceiptItemRow[]> = {};

        if (rows.length > 0) {
            const items = await query(
                'SELECT * FROM budget_receipt_items WHERE receipt_id = ANY($1::uuid[]) ORDER BY position',
                [rows.map((row) => row.id)]
            );
            for (const item of items.rows as ReceiptItemRow[]) {
                (itemsByReceipt[item.receipt_id] ??= []).push(item);
            }
        }

        res.json({
            success: true,
            data: rows.map((row) => mapReceipt(row, itemsByReceipt[row.id] ?? [])),
        });
    } catch (error) {
        console.error('List budget receipts error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// The lines no data can size: imported before the amount was stored, and their
// label prints no size. The analytics page asks one question per label ("one
// pack holds X") and posts the answer back here.

/** Lines of this family's receipts that still have no amount, newest first. */
const amountlessLines = async (userId: string): Promise<AmountlessLine[]> => {
    const result = await query(
        `SELECT i.id, i.label, i.quantity, i.amount, r.date
           FROM budget_receipt_items i
           JOIN budget_receipts r ON r.id = i.receipt_id
          WHERE r.user_id = $1
            AND i.content IS NULL
          ORDER BY r.date DESC, i.position`,
        [userId],
    );
    return result.rows.map((row) => ({
        id: String(row.id),
        label: String(row.label ?? ''),
        quantity: toNumber(row.quantity),
        amount: toNumber(row.amount),
        date: String(row.date ?? '').slice(0, 10),
    }));
};

// GET /api/budget/receipts/missing-amounts — grouped by the label they print,
// biggest spend first. A line the size inference can read is not listed: its
// amount is already in the stats.
router.get('/missing-amounts', async (req: AuthRequest, res) => {
    try {
        const lines = await amountlessLines(req.userId!);
        res.json({ success: true, data: groupMissingAmounts(lines) });
    } catch (error) {
        console.error('Missing receipt amounts error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/budget/receipts/missing-amounts — body { key, per_pack, unit }. `key`
// is the folded label the GET returned. Every line of the family that prints it
// takes `per_pack` times the packs it bought; a line whose amount is already
// stored is left alone (the UPDATE repeats the test).
//
// Not parent-only: this is a product size, not a budget amount, and the pantry
// page already lets every member correct what the household has.
router.post('/missing-amounts', async (req: AuthRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    const perPack = parsePerPack(body.per_pack);
    const unit = cleanUnit(body.unit);
    if (key.length === 0 || perPack === null || unit === null) {
        return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
    }

    const client = await getClient();
    try {
        const lines = await amountlessLines(req.userId!);
        const fills = planAmountFill(lines, key, perPack, unit);
        if (fills.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        await client.query('BEGIN');
        for (const fill of fills) {
            await client.query(
                `UPDATE budget_receipt_items i
                    SET content = $2, unit = $3
                   FROM budget_receipts r
                  WHERE i.id = $1
                    AND i.receipt_id = r.id
                    AND r.user_id = $4
                    AND i.content IS NULL`,
                [fill.id, fill.content, fill.unit, req.userId],
            );
        }
        await client.query('COMMIT');

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        res.json({ success: true, data: { updated: fills.length } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Fill receipt amounts error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// DELETE /api/budget/receipts/:id — parents only. The lines and the budget
// entries created by this import go with it (ON DELETE CASCADE).
router.delete('/:id', requireParent, async (req: AuthRequest, res) => {
    try {
        const result = await query(
            'DELETE FROM budget_receipts WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Receipt not found' });
        }
        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'deleted' });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete budget receipt error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// The lines of a stored receipt, editable one by one. Extraction can miss a
// product or answer "single" for a bill whose breakdown the family actually
// wants; these three routes let them fix it after the import.
//
// The receipt's TOTAL is never recalculated: it is the amount printed on the
// paper and the one the budget reflects. The lines are analytical detail, and
// the pantry import reads them.

// POST /api/budget/receipts/:id/items — parents only.
router.post('/:id/items', requireParent, async (req: AuthRequest, res) => {
    try {
        // A malformed id would otherwise reach a UUID column and answer 500.
        if (!isUuid(req.params.id)) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const owned = await query('SELECT id FROM budget_receipts WHERE id = $1 AND user_id = $2', [
            req.params.id,
            req.userId,
        ]);
        if (owned.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const categories = await getFamilyCategories(req.userId!);
        const line = validateReceiptLine((req.body ?? {}) as Record<string, unknown>, categories.budget);
        if (!line) {
            return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
        }

        const result = await query(
            `INSERT INTO budget_receipt_items (receipt_id, position, label, quantity, unit_price, amount, category)
             VALUES ($1, 1 + (SELECT COALESCE(MAX(position), 0) FROM budget_receipt_items WHERE receipt_id = $1), $2, $3, $4, $5, $6)
             RETURNING *`,
            [req.params.id, line.label, line.quantity, line.unit_price, line.amount, line.category]
        );

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        res.status(201).json({ success: true, data: { item: mapItem(result.rows[0] as ReceiptItemRow) } });
    } catch (error) {
        console.error('Create budget receipt item error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/budget/receipts/:id/items/:itemId — parents only.
router.put('/:id/items/:itemId', requireParent, async (req: AuthRequest, res) => {
    try {
        if (!isUuid(req.params.id) || !isUuid(req.params.itemId)) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const categories = await getFamilyCategories(req.userId!);
        const line = validateReceiptLine((req.body ?? {}) as Record<string, unknown>, categories.budget);
        if (!line) {
            return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
        }

        // The receipt's owner is checked through the join: a line id alone must
        // never be enough to edit another family's receipt.
        const result = await query(
            `UPDATE budget_receipt_items item SET
                label = $3, quantity = $4, unit_price = $5, amount = $6, category = $7
             FROM budget_receipts receipt
             WHERE item.id = $1 AND item.receipt_id = $2 AND item.receipt_id = receipt.id AND receipt.user_id = $8
             RETURNING item.*`,
            [req.params.itemId, req.params.id, line.label, line.quantity, line.unit_price, line.amount, line.category, req.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        res.json({ success: true, data: { item: mapItem(result.rows[0] as ReceiptItemRow) } });
    } catch (error) {
        console.error('Update budget receipt item error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/budget/receipts/:id/items/:itemId — parents only.
router.delete('/:id/items/:itemId', requireParent, async (req: AuthRequest, res) => {
    try {
        if (!isUuid(req.params.id) || !isUuid(req.params.itemId)) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const result = await query(
            `DELETE FROM budget_receipt_items item
             USING budget_receipts receipt
             WHERE item.id = $1 AND item.receipt_id = $2 AND item.receipt_id = receipt.id AND receipt.user_id = $3
             RETURNING item.id`,
            [req.params.itemId, req.params.id, req.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'updated' });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete budget receipt item error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
