import { Router } from 'express';
import { query } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { formatDateOnly } from '../../lib/budgetRecurrence';
import {
    buildBudgetAnalytics,
    toAnalyticsEntries,
    type AnalyticsMember,
} from '../lib/budgetAnalytics.custom';
import {
    buildProductPurchases,
    type PurchaseLine,
    type PurchasedProduct,
} from '../lib/productAnalytics.custom';
import { inferLineAmount } from '../lib/quantityInference.custom';
import { pantryHeadName, pantryKeyResolver, pantryNameKey } from '../lib/pantry.custom';
import { buildProductCatalog, type CatalogPantryRow } from '../lib/productCatalog.custom';

// Fine-grained budget analytics — a SIDECAR to the shipped budget feature.
//
// It deliberately lives in its own router under its own prefix instead of being
// folded into routes/budget.ts: nothing here edits the existing handlers, SQL or
// tables, so an upstream update to the budget module merges without touching
// this file, and this file never has to be reconciled with upstream.
//
// Read-only: SELECTs over the family's own data, no writes, no new tables, no
// schema changes — so it cannot conflict with an upstream budget migration.
//
//   GET /api/budget-analytics/overview?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// `start` and `end` are both inclusive. The response is the pure
// buildBudgetAnalytics() output plus the echoed range: totals, actual-vs-recurring
// split, per category / month / day / weekday / member / merchant breakdowns and a
// pace projection for the elapsed part of the range. One request still answers the
// whole screen; the products come only from imported receipts (their item lines),
// so a family that types its expenses by hand gets an empty list, not a guess.
const router = Router();
router.use(authMiddleware);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// ~5 years: bounds the per-day series and the recurring expansion in one request.
const MAX_RANGE_DAYS = 1830;

const dateOnly = (value: unknown): string | null =>
    typeof value === 'string' && DATE_ONLY.test(value) ? value : null;

/** Inclusive `end` → exclusive upper bound, the shape a `date < $n` scan wants. */
const dayAfter = (date: string) => formatDateOnly(new Date(Date.parse(`${date}T00:00:00Z`) + 86400000));

/** pg hands DECIMAL back as a string; a broken value counts as nothing. */
const toNumber = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

const daysInclusive = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/** The server's own calendar day: the pace projection is about this family's clock. */
const localToday = () => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * The receipt lines of the family, mapped for the product module: DECIMALs to
 * numbers, the amount inferred when it was never stored, and the pantry group each
 * name belongs to. `start`/`end` (inclusive) scope it to a period; no range means
 * the whole history, which is what the products page asks for.
 */
const loadPurchaseLines = async (
    userId: string,
    start?: string,
    end?: string,
): Promise<PurchaseLine[]> => {
    const params: unknown[] = [userId];
    let sql = `SELECT i.label, i.product, i.quantity, i.unit, i.content, i.amount
                 FROM budget_receipt_items i
                 JOIN budget_receipts r ON r.id = i.receipt_id
                WHERE r.user_id = $1`;
    if (start && end) {
        params.push(start, dayAfter(end));
        sql += ' AND r.date >= $2::date AND r.date < $3::date';
    }

    const [itemsResult, pantryResult] = await Promise.all([
        query(sql, params),
        // The family's own product names. A row named 'Rijst - AH Basmati -
        // Basmati rijst' declares those names, so every receipt line that prints
        // one lands on the single product 'Rijst', the same way the receipt
        // import merges them into one pantry row.
        query(
            `SELECT name FROM custom_pantry_items
              WHERE user_id = $1 AND source <> 'grocy'
              ORDER BY name`,
            [userId]
        ),
    ]);

    const pantryNames = pantryResult.rows.map((row) => String(row.name));
    const resolvePantryKey = pantryKeyResolver(pantryNames.map(pantryNameKey));
    const pantryByKey = new Map(pantryNames.map((name) => [pantryNameKey(name), name]));

    return itemsResult.rows.map((row) => {
        const label = String(row.label ?? '');
        const product = row.product ?? null;
        const quantity = toNumber(row.quantity);
        const unit = row.unit === null || row.unit === undefined ? null : String(row.unit);
        const content = toNumber(row.content);
        const inferred = content > 0 ? null : inferLineAmount({ label, quantity, unit });
        // A line whose printed name (or the product name the model read) is a
        // name the family grouped lands on that group's head.
        const raw = String(product || label || '').trim();
        const groupKey = raw.length > 0 ? resolvePantryKey(raw) : '';
        const groupedName = groupKey.length > 0 ? pantryByKey.get(groupKey) : undefined;
        return {
            label,
            product,
            unit: inferred ? inferred.unit : unit,
            quantity,
            content: inferred ? inferred.content : content,
            amount: toNumber(row.amount),
            groupKey: groupedName ? groupKey : null,
            group: groupedName ? pantryHeadName(groupedName) : null,
        };
    });
};

// ponytail: no index of its own. The family's table is small (tens to thousands
// of rows) and a seq scan answers in milliseconds; the shipped per-column
// indexes on budget_entries stay untouched. Add a composite (user_id, date)
// index in a migration if a family ever grows past ~1M entries.
router.get('/overview', async (req: AuthRequest, res) => {
    try {
        const start = dateOnly(req.query.start);
        const end = dateOnly(req.query.end);

        if (!start || !end) {
            return res.status(400).json({ success: false, error: 'start and end are required (YYYY-MM-DD)' });
        }
        if (start > end) {
            return res.status(400).json({ success: false, error: 'start must not be after end' });
        }
        if (daysInclusive(start, end) > MAX_RANGE_DAYS) {
            return res.status(400).json({ success: false, error: `range too long (max ${MAX_RANGE_DAYS} days)` });
        }

        const [entriesResult, recurringResult, membersResult, lines] = await Promise.all([
            // Range predicate on the bare column: this is what the index above serves.
            query(
                `SELECT be.id, be.category, be.amount, be.is_expense, be.date, be.assigned_to,
                        r.merchant
                 FROM budget_entries be
                 LEFT JOIN budget_receipts r ON r.id = be.receipt_id
                 WHERE be.user_id = $1
                   AND be.date >= $2::date
                   AND be.date < $3::date`,
                [req.userId, start, dayAfter(end)]
            ),
            query(
                `SELECT * FROM recurring_expenses
                 WHERE user_id = $1
                   AND is_active = true
                   AND start_date <= $3::date
                   AND (recurrence_until IS NULL OR recurrence_until >= $2::date)`,
                [req.userId, start, end]
            ),
            query('SELECT id, name, color FROM family_members WHERE user_id = $1 ORDER BY name', [req.userId]),
            // The item lines of the imported receipts: what the family bought.
            loadPurchaseLines(req.userId!, start, end),
        ]);

        // Both sides include the end day: `date < end + 1 day` here, and an
        // inclusive range end inside the expansion (see toAnalyticsEntries).
        const entries = toAnalyticsEntries(entriesResult.rows, recurringResult.rows, start, end);

        const members: AnalyticsMember[] = membersResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            color: row.color ?? null,
        }));

        res.json({
            success: true,
            data: {
                range: { start, end },
                ...buildBudgetAnalytics({ entries, members, start, end, today: localToday() }),
                purchases: buildProductPurchases(lines),
            },
        });
    } catch (error) {
        console.error('Budget analytics error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// How many products one catalog request returns: every one a family plausibly has,
// bounded so the page cannot become a phonebook.
const MAX_CATALOG_PRODUCTS = 1000;

// GET /api/budget-analytics/products — the products page's whole list: every
// pantry row (a product exists without a purchase) plus every receipt group no
// pantry row declares. The analytics card is a screenful about one period; this is
// the catalog the family names and groups.
router.get('/products', async (req: AuthRequest, res) => {
    try {
        const [lines, pantryResult] = await Promise.all([
            loadPurchaseLines(req.userId!),
            query(
                `SELECT id, name, quantity, unit FROM custom_pantry_items
                  WHERE user_id = $1
                  ORDER BY name`,
                [req.userId]
            ),
        ]);

        const purchases = buildProductPurchases(lines, MAX_CATALOG_PRODUCTS, { withNames: true });
        const groups = purchases.byProduct.filter(
            (product): product is PurchasedProduct & { key: string; names: string[] } =>
                typeof product.key === 'string' && Array.isArray(product.names),
        );
        const pantryRows: CatalogPantryRow[] = pantryResult.rows.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            quantity: toNumber(row.quantity),
            unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
        }));

        const products = buildProductCatalog(pantryRows, groups);
        res.json({ success: true, data: { products, total: products.length } });
    } catch (error) {
        console.error('Product catalog error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
