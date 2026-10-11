// Open Food Facts lookup: one barcode in, one normalized product out.
//
// The v3 product endpoint answers a plain JSON document, and `fields` keeps it
// small (the full document is hundreds of kilobytes for an image-heavy entry).
// Not-found is a 404 with a JSON body, so it is told apart from a network
// failure: `null` means "Open Food Facts does not know this barcode", a throw
// means "we could not ask".

import { safeFetch, readCappedText } from '../../lib/safeFetch';

const OFF_BASE = 'https://world.openfoodfacts.org/api/v3/product';
const OFF_FIELDS = 'product_name,brands,quantity,image_front_url,image_url,nutriscore_grade,categories';
const OFF_TIMEOUT_MS = 8000;
const OFF_MAX_BYTES = 256000;
// A stored Nutri-Score is exactly one letter, A-E (`custom_products` holds one
// character); the value is lowercased before this test, so no `i` flag here.
const NUTRI_SCORE_RE = /^[a-e]$/;
// Open Food Facts asks for an identifying User-Agent on API calls; the default
// undici one is rate-limited harder.
const OFF_USER_AGENT = 'OpenFamily/1.8 (self-hosted family app)';

export interface OpenFoodFactsProduct {
    barcode: string;
    name: string;
    brand: string;
    category: string;
    image_url: string | null;
    quantity: string | null;
    unit: string | null;
    nutriscore_grade: string | null;
}

/** First category of the OFF list, without its locale prefix ("fr:Goûter"). */
export const firstCategory = (categories: unknown): string => {
    if (typeof categories !== 'string') return '';
    const first = categories.split(',')[0]?.trim() ?? '';
    return first.replace(/^[a-z]{2}:/, '');
};

/**
 * OFF's product document → the row we store. Pure, so the mapping is testable
 * without the network: it is the part that can silently write invalid data
 * (external strings into fixed-width columns).
 */
export const normalizeProduct = (barcode: string, raw: Record<string, unknown>): OpenFoodFactsProduct => {
    const name = typeof raw.product_name === 'string' ? raw.product_name.trim() : '';
    const image = [raw.image_front_url, raw.image_url].find((value) => typeof value === 'string' && value);
    // OFF answers "unknown" / "not-applicable" for a score it never computed,
    // and the column holds one letter: anything outside a-e is "no score".
    const grade = typeof raw.nutriscore_grade === 'string' ? raw.nutriscore_grade.toLowerCase() : '';

    return {
        barcode,
        name: name || 'Unknown product',
        brand: typeof raw.brands === 'string' ? raw.brands.split(',')[0].trim() : '',
        category: firstCategory(raw.categories),
        image_url: (image as string) ?? null,
        quantity: typeof raw.quantity === 'string' && raw.quantity ? raw.quantity : null,
        // OFF has no structured unit column: the quantity string ("400 g e")
        // carries it, so the column stays null and the client shows it as-is.
        unit: null,
        nutriscore_grade: NUTRI_SCORE_RE.test(grade) ? grade : null,
    };
};

export async function lookupProduct(barcode: string): Promise<OpenFoodFactsProduct | null> {
    const url = `${OFF_BASE}/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
    const response = await safeFetch(url, {
        timeoutMs: OFF_TIMEOUT_MS,
        headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Open Food Facts answered HTTP ${response.status}`);

    const json = JSON.parse(await readCappedText(response, OFF_MAX_BYTES)) as {
        status?: string;
        product?: Record<string, unknown>;
    };
    if (json.status === 'failure' || !json.product) return null;

    return normalizeProduct(barcode, json.product);
}
