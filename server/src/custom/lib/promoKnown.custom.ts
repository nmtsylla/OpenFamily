// The promo screen's "my products" mode: the deals whose product this family
// already knows — something in the pantry, or a line on a ticket it has paid.
//
// The matching is local, and that is the whole point: upstream's `q` is fuzzy
// (`q=AH Basmati` answers 513 rows), so asking the shop which of our known names
// are on promotion would return half the shop. Instead the day's catalogue is
// read once (prijsprofeet.custom.ts, `catalogueFor`) and each known name is
// looked for in the offer's product name.
//
// This deliberately does NOT reuse `client/src/lib/textSearch.ts`'s
// `matchesWords`: it lives in the client package (the server cannot import it),
// it runs the other direction (recipe text, pantry query), and it has no
// frequency rule — and frequency is what stops a chain's own name from matching
// every offer on the page.
//
// Ceilings, both accepted and both real. There is no fuzzy matching: a typo, a
// synonym or a language change misses. And a noisy receipt label ("Everyday lait
// choco demi-écrémé brique 1L") carries more distinctive words than any offer
// repeats, so it matches nothing. Both fail toward the same side: a deal the
// family does not see, never a deal they did not ask for.

import { query } from '../../db';
import { pantryNameKey } from './pantry.custom';
import { catalogueFor, labelOf } from './prijsprofeet.custom';
import type { PromoFacet, PromoFilters, PromoOffer, PromoPage, PromoQuery, PromoSort } from './prijsprofeet.custom';

/** One known product, reduced to the tokens a promo name is matched against. */
export interface KnownProduct {
    name: string;
    tokens: string[];
}

/** The matching context: the known products plus the tokens too common to mean anything. */
export interface KnownContext {
    products: KnownProduct[];
    generic: ReadonlySet<string>;
}

// Two letters is "de", "ah", "1l": they appear in half the offers and identify
// nothing.
const MIN_TOKEN_LENGTH = 3;
// A word in more than this share of the day's offers is the trade's own
// vocabulary, not a product: measured live it is `bio, chocolade, delhaize,
// knorr, pack, spray`. Without this, 'delhaize' would match a tenth of the list.
const GENERIC_SHARE = 0.02;
// A token this short may only match a word that IS it (or its stem) — the probe
// had 'sla' match 'Delhaize Slagroom' when 3-character tokens were allowed to
// prefix.
const PREFIX_MIN_LENGTH = 4;

export const matchTokens = (name: string): string[] =>
    pantryNameKey(name)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= MIN_TOKEN_LENGTH && !/^\d+$/.test(token));

/**
 * The names this family knows: the pantry's merge keys plus the labels of every
 * line on a receipt it has imported. Two reads rather than one `UNION`, because
 * the two surfaces are read the same way and the pantry key is already the folded
 * form (`budget_receipt_items` stores printed text, folded here like everything
 * else). Receipt items, not budget entries: an entry's description carries the
 * merchant's name in front of it.
 */
export async function knownNames(userId: string): Promise<string[]> {
    const [pantry, receipts] = await Promise.all([
        query('SELECT DISTINCT name_key AS name FROM custom_pantry_items WHERE user_id = $1', [userId]),
        query(
            `SELECT DISTINCT item.label AS name
             FROM budget_receipt_items item
             JOIN budget_receipts receipt ON receipt.id = item.receipt_id
             WHERE receipt.user_id = $1`,
            [userId]
        ),
    ]);

    const rows = [...pantry.rows, ...receipts.rows] as { name: string | null }[];
    const names = rows
        .map((row) => row.name)
        .filter((name): name is string => Boolean(name && name.trim()));

    // The same name off both surfaces counts once, and the order is stable so a
    // reader's sample does not shuffle between two identical requests.
    return [...new Set(names)].sort();
}

/**
 * The words a promo offer is matched on: its product name, folded and split the
 * same way as a known name. The brand is not included — a chain's own brand
 * ("Delhaize") would match its whole shelf, and the frequency rule below only
 * catches the words that appear in enough offers to be measured.
 */
const offerWords = (offer: PromoOffer): Set<string> => new Set(matchTokens(offer.name ?? ''));

/** `word` minus the plural 's'/'x' a word this long can afford to lose. */
const stem = (word: string): string => (word.length > 3 ? word.replace(/[sx]$/, '') : word);

/**
 * Does this token name one of the offer's words — as the word itself, or as the
 * stem of a longer one?
 */
const tokenMatches = (token: string, words: Set<string>): boolean => {
    for (const word of words) {
        if (token.length < PREFIX_MIN_LENGTH) {
            if (word === token || stem(word) === token) return true;
        } else if (stem(word).startsWith(stem(token))) {
            return true;
        }
    }
    return false;
};

export const knownContext = (names: string[], offers: PromoOffer[]): KnownContext => {
    const counts = new Map<string, number>();
    for (const offer of offers) {
        for (const token of offerWords(offer)) counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    const threshold = offers.length * GENERIC_SHARE;
    const generic = new Set<string>();
    for (const [token, count] of counts) {
        if (count > threshold) generic.add(token);
    }

    return {
        products: names.map((name) => ({ name, tokens: matchTokens(name) })),
        generic,
    };
};

/**
 * Does one offer carry this product? Every distinctive word, or a majority of
 * them: a two-word name lands both ('kookworst' is not 'Streeckgenoten
 * Kookworst'), a three-word one may lose one ('tikka masala' inside 'Knorr
 * Maaltijdmix tikka masala').
 */
const isMatch = (product: KnownProduct, words: Set<string>, generic: ReadonlySet<string>): boolean => {
    const distinctive = product.tokens.filter((token) => !generic.has(token));
    if (!distinctive.length) return false;

    const hits = distinctive.filter((token) => tokenMatches(token, words)).length;
    return hits === distinctive.length || (hits >= 2 && 2 * hits >= distinctive.length);
};

/** The offers whose product the family knows, catalogue order kept. */
export const matchedOffers = (offers: PromoOffer[], context: KnownContext): PromoOffer[] => {
    // A name whose every word is generic ('ah', 'de') can decide nothing: dropping
    // it here keeps it from matching the whole list.
    const products = context.products.filter((product) =>
        product.tokens.some((token) => !context.generic.has(token))
    );
    if (!products.length) return [];

    return offers.filter((offer) => {
        const words = offerWords(offer);
        return products.some((product) => isMatch(product, words, context.generic));
    });
};

const numeric = (value: number | null, fallback: number): number =>
    value === null || !Number.isFinite(value) ? fallback : value;

// Nulls last in every order: a row whose price or discount the chain did not
// publish must not lead a list that was sorted by it.
const SORTERS: Record<PromoSort, (left: PromoOffer, right: PromoOffer) => number> = {
    savings: (left, right) =>
        numeric(right.savings_percentage, -1) - numeric(left.savings_percentage, -1),
    price_asc: (left, right) =>
        numeric(left.price, Number.POSITIVE_INFINITY) - numeric(right.price, Number.POSITIVE_INFINITY),
    price_desc: (left, right) => numeric(right.price, -1) - numeric(left.price, -1),
};

/**
 * The filters the local list can apply on its own — store, category, discount and
 * text, the same four the API does upstream. The text is folded like the names,
 * so `q=Q` finds `q`, and `*` is the client's "no search" (see `promoQueryOf`).
 */
const applyFilters = (offers: PromoOffer[], filter: PromoQuery): PromoOffer[] => {
    const needle = filter.q === '*' ? '' : pantryNameKey(filter.q);
    return offers.filter((offer) => {
        if (filter.retailer && offer.retailer !== filter.retailer) return false;
        if (filter.category && offer.category !== filter.category) return false;
        if (filter.minSavings !== null && (offer.savings_percentage ?? -1) < filter.minSavings) return false;
        if (needle && !pantryNameKey(offer.name ?? '').includes(needle) && !pantryNameKey(offer.brand ?? '').includes(needle)) return false;
        return true;
    });
};

/**
 * One page of the family's own deals. `total` is the honest count of what passed
 * the filters, and the client pages over that, because nothing upstream knows how
 * many of the day's promotions this family already buys.
 */
export const knownPage = (offers: PromoOffer[], names: string[], query: PromoQuery): PromoPage => {
    const matched = applyFilters(matchedOffers(offers, knownContext(names, offers)), query);
    const start = (query.page - 1) * query.pageSize;

    return {
        offers: matched.sort(SORTERS[query.sort]).slice(start, start + query.pageSize),
        total: matched.length,
        page: query.page,
        pageSize: query.pageSize,
    };
};

/** The "my products" page for one family: today's catalogue, matched locally. */
export const knownPromos = async (query: PromoQuery, userId: string): Promise<PromoPage> =>
    knownPage(await catalogueFor(query.country), await knownNames(userId), query);

const counted = (
    offers: PromoOffer[],
    keyOf: (offer: PromoOffer) => string | null,
    labels: Map<string, string>
): PromoFacet[] => {
    const counts = new Map<string, number>();
    for (const offer of offers) {
        const key = keyOf(offer);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts]
        .map(([key, count]) => ({ key, label: labels.get(key) ?? labelOf(key), count }))
        .sort((left, right) => right.count - left.count);
};

/**
 * The filter panel for the "my products" mode: the same facets, counted over the
 * family's matched deals instead of the shop's whole list — panel and list must
 * agree, or the store the user just picked looks empty. The labels stay
 * upstream's, since `/categories` is the only place the display names exist.
 */
export const knownFilters = (offers: PromoOffer[], names: string[], upstream: PromoFilters): PromoFilters => {
    const matched = matchedOffers(offers, knownContext(names, offers));
    const labels = new Map<string, string>(
        [...upstream.retailers, ...upstream.categories].map((facet): [string, string] => [facet.key, facet.label])
    );

    return {
        countries: upstream.countries,
        country: upstream.country,
        total: matched.length,
        retailers: counted(matched, (offer) => offer.retailer, labels),
        categories: counted(matched, (offer) => offer.category, labels),
    };
};
