// =============================================================================
// "My groceries": the promo screen's focus list.
//
// Two layers, the family's own first:
//   1. what the household actually has or has bought — the pantry
//      (custom_pantry_items) and every line of every imported receipt
//      (budget_receipt_items.label), searched by name because neither carries a
//      barcode;
//   2. general groceries — the shops' top deals in each food category, so a
//      household with a thin pantry or no receipts yet still gets a useful list
//      instead of the whole catalogue (candles, toothpaste and the rest stay in
//      "all deals").
//
// Why the names are searched one at a time and verified locally: PrijsProfeet's
// free tier has no "my assortment" filter (that is the Pro `/match` +
// `/shelf-prices`), and its `q` is fuzzy enough that `q=brood` answers tortilla
// chips — measured on the live API, 2 of its 40 rows actually contained the
// word. A single long OR of every household name would be both noisy and
// unbounded, so each name is asked on its own and kept only when the offer
// really names it. General groceries need no such check: they are the category,
// not a word match.
//
// Pure, no database: the route owns the SQL that loads the names, this owns the
// rules — what counts as a term, a match, and a grocery category.
// =============================================================================

import type { PromoOffer } from './prijsprofeet.custom';

/** How many names are asked of the API at once. The newest are the relevant ones. */
export const MAX_FOCUS_TERMS = 24;

/**
 * The food categories PrijsProfeet publishes, by its own slugs. "Groceries" in
 * the everyday sense — what a household eats and drinks — not the candles and
 * toothbrushes a supermarket also sells (`huishouden`, `drogisterij`, ...).
 * Both hosts expose the same 25 slugs (checked on nl and be), so one list fits
 * every configured country.
 */
export const GENERAL_GROCERY_CATEGORIES = [
    'groente-fruit',
    'zuivel-eieren',
    'vega',
    'kaas',
    'vlees',
    'vis',
    'brood-bakkerij',
    'ontbijt',
    'pasta-rijst-wereldkeuken',
    'soepen-conserven-sauzen',
    'snoep-koek-chips',
    'frisdrank',
    'koffie-thee',
    'bier-wijn-sterke-drank',
    'diepvries',
] as const;
/** A term goes into a URL query: long enough for a real label, short enough to read. */
const MAX_TERM_LENGTH = 60;
/** One letter matches half the shop (mirrors the exclusion rule). */
const MIN_TERM_LENGTH = 2;

/** Lowercase, no accents, single spaces: what two texts are compared as. */
const comparable = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // The ligatures the pantry's merge key also folds, so 'Œufs' and 'oeufs' are one product.
        .replace(/œ/gi, 'oe')
        .replace(/æ/gi, 'ae')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

/**
 * The terms to search, newest first: what the user typed (if anything) followed
 * by the family's own product names, deduplicated the way the pantry merges —
 * case, accents and inner whitespace do not make two products different.
 */
export const focusTermsOf = (names: readonly string[], typedQuery: string): string[] => {
    const seen = new Set<string>();
    const terms: string[] = [];

    for (const candidate of [typedQuery, ...names]) {
        const term = String(candidate ?? '').trim().slice(0, MAX_TERM_LENGTH);
        if (term.length < MIN_TERM_LENGTH) continue;

        const key = comparable(term);
        if (!key || seen.has(key)) continue;

        seen.add(key);
        terms.push(term);
        if (terms.length >= MAX_FOCUS_TERMS) break;
    }

    return terms;
};

/** Does this offer really name one of the terms? Name or brand, accents aside. */
export const focusMatches = (
    offer: Pick<PromoOffer, 'name' | 'brand'>,
    terms: readonly string[]
): boolean => {
    const text = comparable(`${offer.name ?? ''} ${offer.brand ?? ''}`);
    return terms.some((term) => text.includes(comparable(term)));
};
