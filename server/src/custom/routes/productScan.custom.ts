// Barcode → product → promotion watchlist.
//
// Whole surface lives under /api/products, mounted from register.custom.ts when
// CUSTOM_FEATURE_SCANNER_ENABLED is on. Nothing here edits the upstream shopping
// or auth routers: the shopping list is read through its own tables (ownership is
// checked in the statement that writes), and the barcode of a shopping row is
// kept in the fork's own table.
//
//   GET    /api/products/lookup/:barcode              product, from cache or Open Food Facts
//   GET    /api/products/promo-watchlist              watched products + best known promo
//   POST   /api/products/promo-watchlist              watch a barcode
//   DELETE /api/products/promo-watchlist/:id          stop watching
//   POST   /api/products/promo-watchlist/:barcode/prices   log a promo price seen in a store
//   GET    /api/products/promo-watchlist/:barcode/prices   price history (50 latest)
//   POST   /api/products/shopping-items/:id/barcode   remember which barcode an item came from
//   GET    /api/products/shopping-items/barcodes      every linked barcode of the family, one map

import { Router } from 'express';
import { query } from '../../db';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { lookupProduct, type OpenFoodFactsProduct } from '../lib/openFoodFacts.custom';
import { barcodeOf, optionalPrice } from '../lib/product.custom';

const router = Router();
router.use(authMiddleware);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A product's name, brand or image changes rarely; a week-old row is close
// enough, and the cost of being wrong is one stale label.
const CACHE_TTL = '7 days';

const optionalText = (value: unknown, maxLength: number): string | null => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? text.slice(0, maxLength) : null;
};

const upsertProduct = async (product: OpenFoodFactsProduct): Promise<void> => {
    await query(
        `INSERT INTO custom_products (barcode, name, brand, category, image_url, quantity, unit, nutriscore_grade, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (barcode) DO UPDATE SET
             name = EXCLUDED.name,
             brand = EXCLUDED.brand,
             category = EXCLUDED.category,
             image_url = EXCLUDED.image_url,
             quantity = EXCLUDED.quantity,
             unit = EXCLUDED.unit,
             nutriscore_grade = EXCLUDED.nutriscore_grade,
             updated_at = now()`,
        [
            product.barcode,
            // Every one of these is external text going into a fixed-width
            // column: sliced here so an over-long OFF string cannot turn a
            // lookup into a 22001 write failure.
            product.name.slice(0, 255),
            product.brand.slice(0, 160),
            product.category.slice(0, 50),
            product.image_url,
            product.quantity?.slice(0, 50) ?? null,
            product.unit,
            product.nutriscore_grade,
        ]
    );
};

/**
 * Makes sure the barcode exists in custom_products — the watchlist and the price
 * log both foreign-key to it. Returns false when Open Food Facts does not know
 * the barcode; throws when it cannot be asked.
 */
const ensureProduct = async (barcode: string): Promise<boolean> => {
    const existing = await query('SELECT 1 FROM custom_products WHERE barcode = $1', [barcode]);
    if (existing.rowCount) return true;

    const product = await lookupProduct(barcode);
    if (!product) return false;
    await upsertProduct(product);
    return true;
};

// The product behind a barcode: the cached row while it is fresh, otherwise a
// fresh lookup that also refreshes the cache.
router.get('/lookup/:barcode', async (req: AuthRequest, res) => {
    const barcode = barcodeOf(req.params.barcode);
    if (!barcode) {
        return res.status(400).json({ success: false, error: 'Invalid barcode' });
    }

    try {
        const cached = await query(
            `SELECT * FROM custom_products WHERE barcode = $1 AND updated_at > now() - interval '${CACHE_TTL}'`,
            [barcode]
        );
        if (cached.rowCount) {
            return res.json({ success: true, data: cached.rows[0] });
        }

        const product = await lookupProduct(barcode);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        await upsertProduct(product);
        const saved = await query('SELECT * FROM custom_products WHERE barcode = $1', [barcode]);
        res.json({ success: true, data: saved.rows[0] });
    } catch (error) {
        console.error('Product lookup error:', error);
        res.status(502).json({ success: false, error: 'Lookup failed' });
    }
});

// Watched products, with the cheapest promo price anyone in the family logged.
router.get('/promo-watchlist', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT w.id, w.barcode, w.target_price, w.is_active, w.created_at,
                    p.name, p.brand, p.image_url, p.category, p.quantity, p.nutriscore_grade,
                    MIN(pr.promo_price) AS best_promo_price
             FROM custom_promo_watchlist w
             JOIN custom_products p ON w.barcode = p.barcode
             LEFT JOIN custom_promo_prices pr ON w.barcode = pr.barcode AND w.user_id = pr.user_id
             WHERE w.user_id = $1 AND w.is_active = TRUE
             GROUP BY w.id, w.barcode, w.target_price, w.is_active, w.created_at,
                      p.name, p.brand, p.image_url, p.category, p.quantity, p.nutriscore_grade
             ORDER BY w.created_at DESC`,
            [req.userId]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Get promo watchlist error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/promo-watchlist', async (req: AuthRequest, res) => {
    const barcode = barcodeOf(req.body?.barcode);
    if (!barcode) {
        return res.status(400).json({ success: false, error: 'Invalid barcode' });
    }
    const targetPrice = optionalPrice(req.body?.target_price);

    try {
        if (!(await ensureProduct(barcode))) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const result = await query(
            // A watch request that carries no target price keeps the one already
            // there: the shopping list's one-tap "watch" must not wipe a target
            // the user typed in the scanner.
            `INSERT INTO custom_promo_watchlist (user_id, barcode, target_price)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, barcode)
             DO UPDATE SET is_active = TRUE, target_price = COALESCE(EXCLUDED.target_price, custom_promo_watchlist.target_price)
             RETURNING *`,
            [req.userId, barcode, targetPrice]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Watch promo error:', error);
        res.status(502).json({ success: false, error: 'Could not watch this product' });
    }
});

router.delete('/promo-watchlist/:id', async (req: AuthRequest, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }

    try {
        const result = await query('DELETE FROM custom_promo_watchlist WHERE id = $1 AND user_id = $2', [
            id,
            req.userId,
        ]);
        if (!result.rowCount) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Unwatch promo error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// A promo price seen in a store: what the family is actually meant to act on.
router.post('/promo-watchlist/:barcode/prices', async (req: AuthRequest, res) => {
    const barcode = barcodeOf(req.params.barcode);
    if (!barcode) {
        return res.status(400).json({ success: false, error: 'Invalid barcode' });
    }

    const promoPrice = optionalPrice(req.body?.promo_price);
    if (promoPrice === null) {
        return res.status(400).json({ success: false, error: 'Invalid price' });
    }
    const regularPrice = optionalPrice(req.body?.regular_price);

    try {
        if (!(await ensureProduct(barcode))) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const result = await query(
            `INSERT INTO custom_promo_prices (user_id, barcode, store_name, promo_price, regular_price, notes)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                req.userId,
                barcode,
                optionalText(req.body?.store_name, 120),
                promoPrice,
                regularPrice,
                optionalText(req.body?.notes, 500),
            ]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Log promo price error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/promo-watchlist/:barcode/prices', async (req: AuthRequest, res) => {
    const barcode = barcodeOf(req.params.barcode);
    if (!barcode) {
        return res.status(400).json({ success: false, error: 'Invalid barcode' });
    }

    try {
        const result = await query(
            `SELECT * FROM custom_promo_prices
             WHERE user_id = $1 AND barcode = $2
             ORDER BY logged_at DESC LIMIT 50`,
            [req.userId, barcode]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Get promo prices error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Every barcode the family has linked, as one map, for the shopping list's
// per-row badge. One query instead of one request per item.
router.get('/shopping-items/barcodes', async (req: AuthRequest, res) => {
    try {
        const result = await query(
            `SELECT b.shopping_item_id, b.barcode
             FROM custom_shopping_item_barcodes b
             JOIN shopping_items i ON i.id = b.shopping_item_id
             WHERE i.user_id = $1`,
            [req.userId]
        );
        const data: Record<string, string> = {};
        for (const row of result.rows) {
            data[row.shopping_item_id] = row.barcode;
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error('Get shopping barcodes error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Remember which barcode a shopping item was scanned from. The SELECT is the
// ownership check: a row that is not the family's inserts nothing.
router.post('/shopping-items/:id/barcode', async (req: AuthRequest, res) => {
    const { id } = req.params;
    const barcode = barcodeOf(req.body?.barcode);
    if (!UUID_RE.test(id) || !barcode) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
    }

    try {
        const result = await query(
            `INSERT INTO custom_shopping_item_barcodes (shopping_item_id, barcode)
             SELECT i.id, $2 FROM shopping_items i WHERE i.id = $1 AND i.user_id = $3
             ON CONFLICT (shopping_item_id) DO UPDATE SET barcode = EXCLUDED.barcode
             RETURNING shopping_item_id, barcode`,
            [id, barcode, req.userId]
        );
        if (!result.rowCount) {
            return res.status(404).json({ success: false, error: 'Shopping item not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Link barcode error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
