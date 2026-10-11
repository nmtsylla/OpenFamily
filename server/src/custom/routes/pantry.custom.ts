// =============================================================================
// /api/pantry — what the household has at home (custom_pantry_items).
//
// This is the source of truth the fork was missing. Three surfaces that used to
// throw their data away now meet here:
//
//  - the lunchbox AI dialog kept its four chip lists in localStorage; it reads
//    this table through the client (one `lunchbox_bucket` per item) instead;
//  - the upstream shopping list is bridged BOTH ways: low stock appends to it,
//    and what was bought (checked items) is stocked back in one call;
//  - a receipt's lines can be turned into pantry rows, behind a per-receipt
//    guard (`custom_pantry_imports`) so the same ticket never imports twice.
//
// The optional Grocy integration is read only (its stock → here); this router
// never writes to Grocy. Everything is scoped by `user_id = req.userId`.
//
// Merging is by folded name ONLY (`name_key`, lib/pantry.custom.ts): the same
// product written 'Lait', 'lait ' or 'LAIT' is one row, whatever the location.
// Accepted ceiling: one product in the fridge and the cellar is one row.
// =============================================================================

import { Router } from 'express';
import { getClient, query } from '../../db';
import { authMiddleware, AuthRequest, requireParent } from '../../middleware/auth';
import { broadcast } from '../../lib/broadcaster';
import { readCappedText, safeFetch } from '../../lib/safeFetch';
import { decryptCredentials } from '../../utils/crypto';
import logger from '../../lib/logger';
import { integrationRateLimiter } from '../middleware/rateLimit.custom';
import { isUniqueViolation, isUuid } from '../lib/validation.custom';
import {
    MAX_STOCK_LINES,
    PANTRY_LOCATIONS,
    mapGrocyStock,
    mapReceiptItems,
    pantryNameKey,
    sanitizePantryItem,
    type GrocyStockLine,
    type PantryLineSeed,
    type PantryLocation,
} from '../lib/pantry.custom';
import { mergeIntoPantry } from '../lib/pantryMerge.custom';

const router = Router();
router.use(authMiddleware);

const GROCY_TIMEOUT_MS = 15_000;
/** Grocy stock bodies are a few hundred KB at worst; a misconfigured host is not. */
const MAX_GROCY_BODY_BYTES = 1_000_000;
const DEFAULT_EXPIRY_DAYS = 14;
const MAX_EXPIRY_DAYS = 365;

const toNumber = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
};

interface PantryRow {
    id: string;
    name: string;
    name_key: string;
    category: string;
    quantity: unknown;
    unit: string | null;
    location: string;
    expires_on: string | null;
    low_stock_threshold: unknown;
    lunchbox_bucket: string | null;
    notes: string | null;
    source: string;
    created_at: unknown;
    updated_at: unknown;
}

/** DECIMAL comes back as a string, DATE as a plain YYYY-MM-DD string (db.ts). */
const toItem = (row: PantryRow) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: toNumber(row.quantity),
    unit: row.unit,
    location: row.location,
    expires_on: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
    low_stock_threshold: row.low_stock_threshold === null ? null : toNumber(row.low_stock_threshold),
    lunchbox_bucket: row.lunchbox_bucket,
    notes: row.notes,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

/** `days` query parameter: default 14, clamped to [0, 365]. */
const clampDays = (raw: unknown): number => {
    const parsed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_EXPIRY_DAYS;
    return Math.max(0, Math.min(Math.trunc(parsed), MAX_EXPIRY_DAYS));
};

// GET /api/pantry?location=&filter=low_stock|expiring&days=14
// The whole pantry, or the two views the page and the dashboard widget open on.
router.get('/', async (req: AuthRequest, res) => {
    try {
        const params: unknown[] = [req.userId];
        let where = 'WHERE user_id = $1';

        const location = req.query.location;
        if (typeof location === 'string' && PANTRY_LOCATIONS.includes(location as PantryLocation)) {
            params.push(location);
            where += ` AND location = $${params.length}`;
        }

        if (req.query.filter === 'low_stock') {
            where += ' AND low_stock_threshold IS NOT NULL AND quantity <= low_stock_threshold';
        } else if (req.query.filter === 'expiring') {
            params.push(clampDays(req.query.days));
            where += ` AND expires_on IS NOT NULL AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + $${params.length}::int`;
        }

        const result = await query(
            `SELECT * FROM custom_pantry_items ${where} ORDER BY expires_on NULLS LAST, name`,
            params,
        );
        res.json({ success: true, data: { items: (result.rows as PantryRow[]).map(toItem) } });
    } catch (error) {
        logger.error('pantry.list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/pantry — one item, added by hand.
router.post('/', async (req: AuthRequest, res) => {
    try {
        const input = sanitizePantryItem(req.body);
        if (!input) {
            return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
        }

        const result = await query(
            `INSERT INTO custom_pantry_items
                (user_id, name, name_key, category, quantity, unit, location, expires_on, low_stock_threshold, lunchbox_bucket, notes, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual')
             RETURNING *`,
            [
                req.userId,
                input.name,
                pantryNameKey(input.name),
                input.category,
                input.quantity,
                input.unit,
                input.location,
                input.expires_on,
                input.low_stock_threshold,
                input.lunchbox_bucket,
                input.notes,
            ],
        );

        // Same entity as the shopping list on purpose: a pantry change is a
        // shopping-domain change, and the pantry page listens on 'shopping'.
        broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'created' });
        res.status(201).json({ success: true, data: { item: toItem(result.rows[0] as PantryRow) } });
    } catch (error) {
        // The name already exists for this family (the partial unique index on
        // the folded name): an ordinary add-dialog action, so answer 409 rather
        // than the generic 500.
        if (isUniqueViolation(error)) {
            return res.status(409).json({ success: false, error: 'DUPLICATE_NAME' });
        }
        logger.error('pantry.create_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/pantry/upsert — one item, merged by folded name with the quantity
// SET, not added up. Same body as POST /api/pantry. This is the write path of
// the AI assistant when its note says the family HAS some ("j'ai acheté 2 kg de
// riz" after 1 kg at home is 3 kg) — the family confirms the proposal before it
// lands, so the values are theirs, not the model's guess. The mirror case, "on
// a fini le lait", is POST /missing: a product that is not at home is not a row
// with quantity 0, and it has to reach the shopping list.
//
// The conflict target is the index mergeIntoPantry uses, with the opposite rule:
// an existing row is overwritten instead of incremented. A Grocy row is out of
// reach on purpose — the sync owns those, and a hand-typed 'Riz' must never be
// folded into them.
router.post('/upsert', async (req: AuthRequest, res) => {
    try {
        const input = sanitizePantryItem(req.body);
        if (!input) {
            return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
        }

        const result = await query(
            `INSERT INTO custom_pantry_items
                (user_id, name, name_key, category, quantity, unit, location, expires_on, low_stock_threshold, lunchbox_bucket, notes, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual')
             ON CONFLICT (user_id, name_key) WHERE source <> 'grocy'
             DO UPDATE SET
                quantity = EXCLUDED.quantity,
                unit = COALESCE(EXCLUDED.unit, custom_pantry_items.unit),
                category = EXCLUDED.category,
                location = EXCLUDED.location,
                updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [
                req.userId,
                input.name,
                pantryNameKey(input.name),
                input.category,
                input.quantity,
                input.unit,
                input.location,
                input.expires_on,
                input.low_stock_threshold,
                input.lunchbox_bucket,
                input.notes,
            ],
        );

        // Same entity as the shopping list (see POST /): the pantry page
        // refreshes on the 'shopping' broadcast, not on a pantry one.
        broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        res.json({ success: true, data: { item: toItem(result.rows[0] as PantryRow) } });
    } catch (error) {
        logger.error('pantry.upsert_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/pantry/missing — the other direction of the assistant's note: "on a
// fini le lait" is not a stock of 0, it is a product the family no longer has.
// Body: { name, category?, unit? }.
//
// One transaction, and the two halves are the point: the row goes (a product
// that is not at home does not belong in a list of what is at home), and the
// product is ENSURED on the upstream shopping list, unchecked, so the note
// leaves something actionable behind instead of just a deletion. Skipped when
// the same folded name is already unchecked there — pressing twice is safe.
//
// Grocy rows are out of reach, like everywhere else: the sync owns them, and
// asking Grocy to forget its own stock is not this route's business.
router.post('/missing', async (req: AuthRequest, res) => {
    const client = await getClient();
    try {
        const input = sanitizePantryItem({ ...(req.body ?? {}), quantity: 0 });
        if (!input) {
            return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
        }
        const key = pantryNameKey(input.name);

        await client.query('BEGIN');

        const removed = await client.query(
            `DELETE FROM custom_pantry_items
             WHERE user_id = $1 AND name_key = $2 AND source <> 'grocy'`,
            [req.userId, key],
        );

        // Folded in JS, exactly like POST /shopping-list: the merge key is not a
        // column of upstream's table.
        const existing = await client.query(
            'SELECT name FROM shopping_items WHERE user_id = $1 AND is_checked = false',
            [req.userId],
        );
        const alreadyOnList = (existing.rows as { name: string }[]).some(
            (row) => pantryNameKey(row.name) === key,
        );
        if (!alreadyOnList) {
            await client.query(
                'INSERT INTO shopping_items (user_id, name, category, quantity, is_checked, unit) VALUES ($1, $2, $3, 1, false, $4)',
                [req.userId, input.name, input.category, input.unit],
            );
        }

        await client.query('COMMIT');

        broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        res.json({
            success: true,
            data: { removed: (removed.rowCount ?? 0) > 0, shopping: alreadyOnList ? 'already' : 'added' },
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('pantry.missing_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/pantry/:id — the client sends the full item back.
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        // A malformed id would otherwise reach a UUID column and answer 500.
        if (!isUuid(req.params.id)) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const input = sanitizePantryItem(req.body);
        if (!input) {
            return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
        }

        const result = await query(
            `UPDATE custom_pantry_items SET
                name = $3, name_key = $4, category = $5, quantity = $6, unit = $7,
                location = $8, expires_on = $9, low_stock_threshold = $10,
                lunchbox_bucket = $11, notes = $12, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [
                req.params.id,
                req.userId,
                input.name,
                pantryNameKey(input.name),
                input.category,
                input.quantity,
                input.unit,
                input.location,
                input.expires_on,
                input.low_stock_threshold,
                input.lunchbox_bucket,
                input.notes,
            ],
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        res.json({ success: true, data: { item: toItem(result.rows[0] as PantryRow) } });
    } catch (error) {
        // Renaming an item onto another item's folded name is the same conflict.
        if (isUniqueViolation(error)) {
            return res.status(409).json({ success: false, error: 'DUPLICATE_NAME' });
        }
        logger.error('pantry.update_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/pantry/:id
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        if (!isUuid(req.params.id)) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const result = await query(
            'DELETE FROM custom_pantry_items WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'deleted' });
        res.json({ success: true });
    } catch (error) {
        logger.error('pantry.delete_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/pantry/shopping-list — append what is low to the upstream shopping
// list. Idempotent: something already on the list (unchecked) is left alone, so
// pressing the button twice never doubles the list.
router.post('/shopping-list', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT * FROM custom_pantry_items
             WHERE user_id = $1 AND low_stock_threshold IS NOT NULL AND quantity <= low_stock_threshold`,
            [req.userId],
        );
        const low = result.rows as PantryRow[];

        const existing = await query(
            'SELECT name FROM shopping_items WHERE user_id = $1 AND is_checked = false',
            [req.userId],
        );
        const onList = new Set(
            (existing.rows as { name: string }[]).map((row) => pantryNameKey(row.name)),
        );

        let created = 0;
        let skipped = 0;
        for (const item of low) {
            const key = pantryNameKey(item.name);
            if (onList.has(key)) {
                skipped += 1;
                continue;
            }
            await query(
                'INSERT INTO shopping_items (user_id, name, category, quantity, is_checked, unit) VALUES ($1, $2, $3, 1, false, $4)',
                [req.userId, item.name, item.category, item.unit],
            );
            onList.add(key);
            created += 1;
        }

        if (created > 0) {
            broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'created' });
        }
        res.json({ success: true, data: { created, skipped } });
    } catch (error) {
        logger.error('pantry.shopping_list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/pantry/stock — what was bought comes home. Body:
// { items: [{ name, quantity?, unit?, category? }] }. One transaction, merged by
// folded name; the response says what was new and what was added up.
router.post('/stock', async (req: AuthRequest, res) => {
    const client = await getClient();
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const rawItems = Array.isArray(body.items) ? body.items : [];

        const seeds: PantryLineSeed[] = [];
        for (const entry of rawItems.slice(0, MAX_STOCK_LINES)) {
            if (!entry || typeof entry !== 'object') continue;
            const row = entry as Record<string, unknown>;
            const name = typeof row.name === 'string' ? row.name.trim().slice(0, 160) : '';
            if (name.length === 0) continue;
            const quantity = toNumber(row.quantity);
            const category = typeof row.category === 'string' ? row.category.trim().slice(0, 50) : '';
            const unit = typeof row.unit === 'string' ? row.unit.trim().slice(0, 50) : '';
            seeds.push({
                name,
                quantity: quantity > 0 ? quantity : 1,
                category: category || 'Autre',
                unit: unit || null,
            });
        }

        await client.query('BEGIN');
        const { created, updated } = await mergeIntoPantry(client, req.userId!, seeds, 'shopping');
        await client.query('COMMIT');

        if (created + updated > 0) {
            broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        }
        res.json({ success: true, data: { created, updated } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('pantry.stock_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/pantry/import/receipt — the lines of a stored receipt become pantry
// rows. The guard table makes it once per TICKET (its fingerprint), the same key
// the receipt import uses: the second press answers 409. This is the path left
// for receipts imported before the import itself fed the pantry, so it merges
// every line under its printed label — the AI's per-line names and its "is this
// stock?" verdict were never stored for those.
router.post('/import/receipt', async (req: AuthRequest, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const receiptId = typeof body.receiptId === 'string' ? body.receiptId : '';
    if (!isUuid(receiptId)) {
        return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const owned = await client.query(
            'SELECT fingerprint FROM budget_receipts WHERE id = $1 AND user_id = $2',
            [receiptId, req.userId],
        );
        if (owned.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        // The guard is inserted here, inside the same transaction as the merge:
        // a failure leaves no guard behind, so the import can be retried.
        const guard = await client.query(
            `INSERT INTO custom_pantry_imports (user_id, source, source_ref)
             VALUES ($1, 'receipt', $2)
             ON CONFLICT (user_id, source, source_ref) DO NOTHING
             RETURNING id`,
            [req.userId, (owned.rows[0] as { fingerprint: string }).fingerprint],
        );
        if (guard.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'ALREADY_IMPORTED' });
        }

        const lines = await client.query(
            'SELECT label, quantity, category FROM budget_receipt_items WHERE receipt_id = $1 ORDER BY position',
            [receiptId],
        );
        const seeds = mapReceiptItems(lines.rows as { label: string; quantity: unknown; category: string }[]);
        const { created, updated } = await mergeIntoPantry(client, req.userId!, seeds, 'receipt');
        await client.query('COMMIT');

        if (created + updated > 0) {
            broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        }
        res.json({ success: true, data: { created, updated } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('pantry.receipt_import_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// The receipt lines the import did NOT stock by itself (a service, a fee, an
// unreadable line): they wait here until the family names and categorises them.

// GET /api/pantry/pending — the queue, newest first, with the ticket it came
// from so the family can recognise the line.
router.get('/pending', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT p.*, r.merchant, r.date
               FROM custom_pantry_pending p
               JOIN budget_receipts r ON r.id = p.receipt_id
              WHERE p.user_id = $1
              ORDER BY p.created_at DESC, p.id`,
            [req.userId],
        );
        res.json({
            success: true,
            data: {
                items: result.rows.map((row) => ({
                    id: row.id,
                    receipt_id: row.receipt_id,
                    label: row.label,
                    item: row.item,
                    quantity: toNumber(row.quantity),
                    unit: row.unit,
                    category: row.category,
                    merchant: row.merchant,
                    date: row.date ? String(row.date).slice(0, 10) : null,
                    created_at: row.created_at,
                })),
            },
        });
    } catch (error) {
        logger.error('pantry.pending_list_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/pantry/pending/:id/confirm — the family's own name and category for
// a queued line: it joins the pantry (merged by folded name, like every other
// import) and leaves the queue. Body: { name, category?, quantity?, unit? } —
// the same shape as POST /api/pantry, so the page reuses one form.
router.post('/pending/:id/confirm', async (req: AuthRequest, res) => {
    const id = req.params.id;
    if (!isUuid(id)) {
        return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
    const input = sanitizePantryItem(req.body);
    if (!input) {
        return res.status(400).json({ success: false, error: 'INVALID_ITEM' });
    }

    const client = await getClient();
    try {
        await client.query('BEGIN');

        // Claim the queue line BEFORE merging: DELETE ... RETURNING is the
        // serialisation point. With a plain SELECT, two overlapping confirms (a
        // request retried after a client-side timeout, two tabs) both saw the
        // row, both merged the quantity, and the loser's DELETE removed 0 rows
        // unseen — the product was counted into the pantry twice. Now the loser
        // deletes nothing and answers 404, and the merge never runs twice.
        const claimed = await client.query(
            'DELETE FROM custom_pantry_pending WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId],
        );
        if (claimed.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }

        const { created, updated } = await mergeIntoPantry(
            client,
            req.userId!,
            [{ name: input.name, quantity: input.quantity, category: input.category, unit: input.unit }],
            'receipt',
        );
        await client.query('COMMIT');

        broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
        res.json({ success: true, data: { created, updated } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('pantry.pending_confirm_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// DELETE /api/pantry/pending/:id — the line is not a product (a service, a fee):
// it leaves the queue without entering the pantry.
router.delete('/pending/:id', async (req: AuthRequest, res) => {
    const id = req.params.id;
    if (!isUuid(id)) {
        return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    }
    try {
        const result = await query(
            'DELETE FROM custom_pantry_pending WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId],
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('pantry.pending_dismiss_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * Upsert of Grocy's stock: matched on folded name AND source 'grocy' (the
 * partial unique index `idx_custom_pantry_name_grocy`), so a product the family
 * already tracks by hand is never touched by the sync, and a Grocy row's
 * quantity is REPLACED by what Grocy says rather than added to.
 */
const mergeGrocyStock = async (
    client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
    userId: string,
    lines: GrocyStockLine[],
): Promise<{ created: number; updated: number }> => {
    let created = 0;
    let updated = 0;

    for (const line of lines) {
        const key = pantryNameKey(line.name);
        if (key.length === 0) continue;

        const result = await client.query(
            `INSERT INTO custom_pantry_items
                (user_id, name, name_key, category, quantity, location, expires_on, source)
             VALUES ($1, $2, $3, 'Autre', $4, 'pantry', $5, 'grocy')
             ON CONFLICT (user_id, name_key) WHERE source = 'grocy'
             DO UPDATE SET
                quantity = EXCLUDED.quantity,
                expires_on = EXCLUDED.expires_on,
                updated_at = CURRENT_TIMESTAMP
             RETURNING (xmax = 0) AS inserted`,
            [userId, line.name, key, line.quantity, line.expires_on],
        );
        if (result.rows[0]?.inserted) created += 1;
        else updated += 1;
    }

    return { created, updated };
};

// POST /api/pantry/import/grocy — the family's Grocy stock, read only. 400 when
// no Grocy integration is configured, 502 when Grocy itself answers badly.
//
// Parents only, like upstream's POST /api/integrations/:id/sync: this is the one
// pantry route that leaves the server, it carries the family's Grocy API key, and
// the base URL is a user-supplied host — the same operation class upstream gates
// with `requireParent` + `outboundRateLimiter`. Its own limiter (below) keeps the
// outbound budget close to upstream's instead of the fixed-host one the mount
// applies.
router.post('/import/grocy', requireParent, integrationRateLimiter, async (req: AuthRequest, res) => {
    try {
        const integration = await query(
            "SELECT base_url, encrypted_credentials FROM integrations WHERE family_id = $1 AND type = 'grocy' LIMIT 1",
            [req.userId],
        );
        const row = integration.rows[0] as { base_url: string; encrypted_credentials: string | null } | undefined;
        if (!row || !row.encrypted_credentials) {
            return res.status(400).json({ success: false, error: 'NO_GROCY_INTEGRATION' });
        }

        const creds = decryptCredentials(row.encrypted_credentials);
        if (!creds.apiKey) {
            return res.status(400).json({ success: false, error: 'NO_GROCY_INTEGRATION' });
        }

        let payload: unknown;
        try {
            const response = await safeFetch(`${row.base_url.replace(/\/+$/, '')}/api/stock`, {
                headers: { 'GROCY-API-KEY': creds.apiKey },
                timeoutMs: GROCY_TIMEOUT_MS,
            });
            if (!response.ok) {
                return res.status(502).json({ success: false, error: 'GROCY_ERROR' });
            }
            // Capped, like the recipe import: a misconfigured or hostile Grocy
            // must not stream unbounded data into memory.
            payload = JSON.parse(await readCappedText(response, MAX_GROCY_BODY_BYTES));
        } catch (error) {
            logger.error('pantry.grocy_fetch_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return res.status(502).json({ success: false, error: 'GROCY_ERROR' });
        }

        const lines = mapGrocyStock(payload);

        // The pooled client is taken only now: it used to be checked out before
        // the fetch above, so a slow Grocy pinned a connection for the whole
        // request and could starve the pool for every other route.
        const client = await getClient();
        try {
            await client.query('BEGIN');
            const { created, updated } = await mergeGrocyStock(client, req.userId!, lines);
            await client.query('COMMIT');

            if (created + updated > 0) {
                broadcast(req.userId!, { type: 'update', entity: 'shopping', action: 'updated' });
            }
            res.json({ success: true, data: { created, updated } });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('pantry.grocy_import_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
