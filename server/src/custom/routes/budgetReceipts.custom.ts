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
    created_at: row.created_at,
    items: items.map(mapItem),
});

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
 */
const insertReceipt = async (
    userId: string,
    payload: ReceiptImportPayload,
    fingerprint: string,
): Promise<string | null> => {
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
                    (receipt_id, position, label, quantity, unit_price, amount, category)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [receiptId, position, item.label, item.quantity, item.unit_price, item.amount, item.category]
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

        await client.query('COMMIT');
        return receiptId;
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

        const receiptId = await insertReceipt(req.userId!, payload, fingerprint);
        if (!receiptId) {
            return res.status(409).json({ success: false, error: 'RECEIPT_DUPLICATE' });
        }

        broadcast(req.userId!, { type: 'update', entity: 'budget', action: 'created' });
        res.status(201).json({
            success: true,
            data: {
                receipt: {
                    id: receiptId,
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
                   (SELECT count(*) FROM budget_entries be WHERE be.receipt_id = r.id) AS entry_count
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
