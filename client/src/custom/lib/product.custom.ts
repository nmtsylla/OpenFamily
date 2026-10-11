// What a scanned barcode resolves to, how its Nutri-Score is coloured, and the
// one numeric-input helper both scan pages need.

export interface ScanProduct {
    barcode: string;
    name: string;
    brand: string | null;
    category: string | null;
    image_url: string | null;
    quantity: string | null;
    unit: string | null;
    nutriscore_grade: string | null;
}

// Nutri-Score, the letter grades A–E. Generic traffic-light palette: it is a
// rating scale, not a theme colour, so it stays the same in dark mode.
export const NUTRI_SCORE_CLASSES: Record<string, string> = {
    a: 'bg-emerald-600 text-white',
    b: 'bg-lime-500 text-white',
    c: 'bg-yellow-400 text-yellow-950',
    d: 'bg-orange-500 text-white',
    e: 'bg-red-600 text-white',
};

/**
 * A price or quantity the user may have left empty or typed with a comma:
 * `''` and a non-number are "nothing" (null), not zero.
 */
export const optionalNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
};

// EAN-8 to EAN-13, the printed lengths a grocery barcode has. Mirrors the
// server's check (server/src/custom/lib/product.custom.ts) so a typed barcode
// that could never resolve is refused before it costs a request.
const BARCODE_RE = /^\d{8,13}$/;

export const isBarcode = (value: string): boolean => BARCODE_RE.test(value.trim());

// A promo exclusion shorter than this is refused by the server (MIN_TERM_LENGTH
// in server/src/custom/lib/promoExclusions.custom.ts): one letter would hide half
// the shop. Mirroring it here means the form can say so before the round trip.
export const EXCLUDE_TERM_MIN_LENGTH = 2;

// =============================================================================
// PrijsProfeet promotions (server/src/custom/lib/prijsprofeet.custom.ts). Live
// data, never stored: the watchlist's deals pane and the promo screen's daily
// list both render these rows.
// =============================================================================

export type PromoCountry = 'nl' | 'be';

/** The sort orders the promo list offers; the server maps them to the API's own. */
export type PromoSort = 'savings' | 'price_asc' | 'price_desc';

/**
 * A promotion running in a shop. `promotion_status` is `active` today, `upcoming`
 * when it only starts next week; a price is nullable because a chain may publish
 * a deal without one.
 */
export interface PromoOffer {
    country: PromoCountry;
    retailer: string;
    retailer_name: string;
    /** The shop's own name for the product, with its brand and picture: what makes
     * the browsable list readable. */
    name: string | null;
    brand: string | null;
    image_url: string | null;
    quantity: string | null;
    price: number | null;
    original_price: number | null;
    savings_percentage: number | null;
    loyalty_price: number | null;
    multi_buy_quantity: number | null;
    multi_buy_price: number | null;
    promotion_status: string | null;
    valid_until: string | null;
    product_url: string | null;
}

/** A term the family never wants to see, in its stored (normalized) form. */
export interface PromoExclusion {
    id: string;
    term: string;
    created_at: string;
}

/** One filter choice — a store or a category — and how many deals it has. */
export interface PromoFacet {
    key: string;
    label: string;
    count: number;
}

export interface PromoFilters {
    /** Every country the deployment is configured for, so the list can offer to switch. */
    countries: PromoCountry[];
    /** The country these counts describe. */
    country: PromoCountry;
    total: number;
    retailers: PromoFacet[];
    categories: PromoFacet[];
}

/** A page of today's promotions; `total` is the API's own count for the filters. */
export interface PromoPage {
    offers: PromoOffer[];
    total: number;
    page: number;
    pageSize: number;
    /** Rows of this page the family's exclusions removed. */
    hidden: number;
}
