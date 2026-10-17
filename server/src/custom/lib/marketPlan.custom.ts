// =============================================================================
// "Where to buy": the shopping list's plan card, as data.
//
// The answer to one question the family asks in the shop: given the promotions
// running today at its own chains, which stores should this list be bought at,
// and what does that beat paying normally?
//
// Pure: no database, no network, no model. The route (routes/market.custom.ts)
// loads the pantry, the barcode links, the receipt lines and the API's
// promotions; this module owns what a search term is, what a reference price is,
// and how a plan is scored — the arithmetic the family acts on, assertable
// against a literal.
//
// Pure too because of what it prices. Two rules come from the prototype that
// shaped this screen (/tmp/opencode/shopping-price-proto, variant V2):
//
//  - A plan is scored against each item's own reference price (what the household
//    last paid, else the lowest crossed-out price a chain published), never
//    against the offers' own discounts. The first build ranked by "sum of the
//    barré discounts" and crowned a plan covering one expensive item; an item
//    nobody has a price for is neutral here.
//  - Savings decide, coverage breaks the tie: rank = savings * 1000 + rows, so a
//    plan covering one more item wins only within the same cent.
// =============================================================================

import { comparable, focusTermsOf } from './promoFocus.custom';
import { labelOf, promoCountryOf, type PromoCountry, type PromoOffer } from './prijsprofeet.custom';
import { isCalendarDate } from './validation.custom';

// ---------------------------------------------------------------------------
// The response contract. The shopping list is built against these names, so a
// change here is a change to the client.
// ---------------------------------------------------------------------------

/** The fields of one offer the plan card renders. */
export interface MarketPlanOffer {
    /** The API's chain key, e.g. `albert_heijn_be`. */
    retailer: string;
    /** The same key spelled for display: `Albert Heijn`. */
    retailer_name: string;
    name: string | null;
    quantity: string | null;
    price: number | null;
    original_price: number | null;
    savings_percentage: number | null;
    image_url: string | null;
    product_url: string | null;
    valid_until: string | null;
}

/** One covered item inside a plan: its cheapest offer among the plan's stores. */
export interface MarketPlanRow extends MarketPlanOffer {
    /** The id the client posted, so a row can be matched to its list entry. */
    item_id: string;
}

/** One candidate plan: buy the covered items at exactly these stores. */
export interface MarketPlan {
    /** Retailer keys, in configured order. */
    stores: string[];
    /** One row per covered item, in the order the items were posted. */
    rows: MarketPlanRow[];
    /** Sum of the rows' prices; a null price counts 0. */
    total: number;
    /** Sum over the rows that have a reference: reference - price. Negative when the promo is dearer. */
    savings: number;
    /** Items with a reference price, covered or not. */
    referenced: number;
    /** Items of the list this plan has no row for. */
    missing: number;
}

/**
 * What the plan compares an offer against: what the household itself paid, or,
 * when no receipt shows the product, the chain's own regular price.
 */
export interface MarketItemReference {
    price: number;
    /** `receipt` = a matched receipt line; `regular` = a crossed-out price. */
    source: 'receipt' | 'regular';
    /** The receipt line's own text, merchant and day. Null for a `regular` price. */
    label: string | null;
    merchant: string | null;
    date: string | null;
}

/** One posted item, answered: what it is worth here, and how it was searched. */
export interface MarketItemPlan {
    id: string;
    name: string;
    /** Covered = at least one offer survived the search and the model's pass. */
    status: 'covered' | 'uncovered';
    reference: MarketItemReference | null;
    /** Every search term used for this item, deduped, in order. */
    terms: string[];
    /** True when a Dutch fallback term is what matched. */
    translated: boolean;
}

/** The whole answer to one `POST /api/market/plan`. */
export interface MarketPlanResponse {
    /** When this computation ran, ISO. */
    fetched_at: string;
    /** The one country searched. */
    country: PromoCountry;
    store_order: string[];
    /** Every configured key → its display name. */
    store_names: Record<string, string>;
    /** Which of `plans.single` / `plans.pair` ranks higher. `single` when only one store is configured. */
    best: 'single' | 'pair';
    plans: { single: MarketPlan | null; pair: MarketPlan | null; all: MarketPlan | null };
    /** One entry per accepted posted item, in the posted order. */
    items: MarketItemPlan[];
}

/** One item of the basket a plan prices. */
export interface MarketBasketItem {
    /** Echoed into every row's `item_id`. */
    id: string;
    /** The offers the searches kept for this item. */
    offers: readonly PromoOffer[];
    /** null when the household has neither a receipt price nor a crossed-out one. */
    reference: MarketItemReference | null;
}

/** The two best plans of their size, and which size wins. */
export interface MarketPlanSet {
    single: MarketPlan | null;
    pair: MarketPlan | null;
    all: MarketPlan | null;
    best: 'single' | 'pair';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MARKET_STORES = ['albert_heijn_be', 'colruyt', 'aldi_be', 'lidl_be'];
/** Four chains is already one detour too many; a longer list is a typo, not a plan. */
const MAX_MARKET_STORES = 8;
const RETAILER_RE = /^[a-z0-9_]{1,32}$/;

/**
 * The keys that would answer with something inherited: a chain key is looked up
 * in plain objects (the client's own store-style map among them), so a plan must
 * not carry `constructor` or `__proto__` — the lookups would hand back a function
 * where a chain is drawn. Folded, because a configured value is lowercased before
 * it is vetted.
 */
const PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype).map((name) => name.toLowerCase()));

/** The chains this household compares, from `CUSTOM_MARKET_STORES`, in order. */
export const marketStores = (): string[] => {
    const requested = (process.env.CUSTOM_MARKET_STORES ?? '')
        .toLowerCase()
        .split(',')
        .map((store) => store.trim())
        .filter((store) => RETAILER_RE.test(store) && !PROTOTYPE_KEYS.has(store));

    const unique = [...new Set(requested)].slice(0, MAX_MARKET_STORES);
    // A deployment that configured nothing but typos gets the four Belgian chains
    // rather than an empty plan: the card has to say something.
    return unique.length ? unique : [...DEFAULT_MARKET_STORES];
};

/**
 * The one country whose host answers the searches. The default store list is
 * Belgian, so the two variables are configured together: pointing the stores at
 * Dutch chains means pointing `CUSTOM_PRIJSPROFEET_COUNTRIES` at `nl` too.
 */
export const marketCountry = (): PromoCountry => promoCountryOf(undefined);

/** How many terms one item is searched with: its name, its aliases, one Dutch guess. */
export const MAX_ITEM_TERMS = 4;

/**
 * The terms one item is searched with, the name first: what the user typed on
 * their list, then the names the pantry declares for the same product ('Uien -
 * Oignon' answers to both). Deduplicated the way the pantry merges, so 'Mangue'
 * and 'mangue' are one search.
 */
export const candidateTerms = (name: string, aliases: readonly string[]): string[] =>
    focusTermsOf(aliases, name).slice(0, MAX_ITEM_TERMS);

/** One term per comparable spelling, first spelling winning. */
export const dedupeTerms = (terms: readonly string[]): string[] => {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const term of terms) {
        const key = comparable(term);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(term);
    }
    return unique;
};

// ---------------------------------------------------------------------------
// The household's own reference price
// ---------------------------------------------------------------------------

/** A receipt line as the budget tables hold it — both values arrive unsorted and untyped. */
export interface MarketReceiptLine {
    /** `budget_receipt_items.label`, VARCHAR(160). */
    label: unknown;
    /** Unit price and line total: Postgres NUMERIC arrives as a string. */
    unit_price: unknown;
    amount: unknown;
    /** `budget_receipts.merchant`. */
    merchant: unknown;
    /** `budget_receipts.date`: a DATE column arrives as a Date. */
    date: unknown;
}

/** A term shorter than this matches too many receipt lines to be evidence. */
const MIN_RECEIPT_TERM_LENGTH = 3;
/** How many letters of a term a receipt match rests on (see `referencePriceOf`). */
const RECEIPT_STEM_LENGTH = 4;

const positivePriceOf = (value: unknown): number | null => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** The calendar day of a DATE column, whichever way the driver hands it over. */
const calendarDateOf = (value: unknown): string | null => {
    if (typeof value === 'string') {
        const text = value.trim().slice(0, 10);
        return isCalendarDate(text) ? text : null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        const text = `${value.getFullYear()}-${month}-${day}`;
        return isCalendarDate(text) ? text : null;
    }
    return null;
};

/**
 * What this item costs the household when no shop has it on promotion.
 *
 * The newest matching receipt line wins: a price paid three months ago says less
 * about today than last week's, and the household's own ticket is the only honest
 * answer to "what do we normally pay". `lines` arrives newest first — the route
 * orders it — so the first line that names a term is the most recent one, and a
 * line whose price cannot be read (a 0,00 loyalty line, an unparsed amount) is
 * skipped rather than becoming a reference nobody ever paid.
 *
 * A match rests on a term's first four letters, at the start of a word of the
 * line: a ticket prints the shop's own shorthand, in the shop's own language, so
 * the list's exact spelling ('Mangue') has to answer to 'Mango' and 'MANGUE 2P',
 * and 'oeufs' to 'ŒUF'. Starting at a word keeps 'Ail' away from 'Lait choco' —
 * accents, ligatures and case are already folded away before this.
 *
 * With no receipt line, the chain's own regular price stands in: for each kept
 * offer, the crossed-out price when it is higher than the promo, else the promo
 * price itself — the cheapest of those is what the family would pay by default.
 */
export const referencePriceOf = (
    terms: readonly string[],
    lines: readonly MarketReceiptLine[],
    offers: readonly PromoOffer[]
): MarketItemReference | null => {
    const wanted = dedupeTerms(terms)
        .map((term) => comparable(term))
        .filter((term) => term.length >= MIN_RECEIPT_TERM_LENGTH)
        .map((term) => term.slice(0, RECEIPT_STEM_LENGTH));

    const namesTerm = (text: string, stem: string): boolean => text.startsWith(stem) || text.includes(` ${stem}`);

    for (const line of lines) {
        const label = typeof line.label === 'string' ? line.label.trim() : '';
        const text = comparable(label);
        if (!text || !wanted.some((stem) => namesTerm(text, stem))) continue;

        const price = positivePriceOf(line.unit_price) ?? positivePriceOf(line.amount);
        if (price === null) continue;

        const merchant = typeof line.merchant === 'string' && line.merchant.trim() ? line.merchant.trim() : null;
        return { price, source: 'receipt', label: label || null, merchant, date: calendarDateOf(line.date) };
    }

    const regular = offers
        .map((offer) =>
            offer.original_price !== null && offer.price !== null && offer.original_price > offer.price
                ? offer.original_price
                : offer.price
        )
        .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
    if (!regular.length) return null;

    return { price: Math.min(...regular), source: 'regular', label: null, merchant: null, date: null };
};

// ---------------------------------------------------------------------------
// The plans
// ---------------------------------------------------------------------------

/** Sums of cents drift in the 15th decimal; money is compared here, so sums are quantised. */
const cents = (value: number): number => Math.round(value * 100) / 100;

const offerFieldsOf = (offer: PromoOffer): MarketPlanOffer => ({
    retailer: offer.retailer,
    retailer_name: labelOf(offer.retailer),
    name: offer.name,
    quantity: offer.quantity,
    price: offer.price,
    original_price: offer.original_price,
    savings_percentage: offer.savings_percentage,
    image_url: offer.image_url,
    product_url: offer.product_url,
    valid_until: offer.valid_until,
});

/**
 * The cheapest of the item's offers among `stores`. Ties go to the earlier store
 * of `stores` — which is the configured order of the chain list, so the answer
 * does not depend on the order the API happened to publish.
 */
const cheapestAmong = (offers: readonly PromoOffer[], stores: readonly string[]): PromoOffer | null => {
    let best: PromoOffer | null = null;
    for (const store of stores) {
        let cheapest: PromoOffer | null = null;
        for (const offer of offers) {
            if (offer.retailer !== store) continue;
            if (cheapest === null || (offer.price ?? Number.POSITIVE_INFINITY) < (cheapest.price ?? Number.POSITIVE_INFINITY)) {
                cheapest = offer;
            }
        }
        if (cheapest === null) continue;
        if (best === null || (cheapest.price ?? Number.POSITIVE_INFINITY) < (best.price ?? Number.POSITIVE_INFINITY)) {
            best = cheapest;
        }
    }
    return best;
};

/** Buying `items` at exactly `stores`: the rows, the total, what that beats. */
export const planFor = (items: readonly MarketBasketItem[], stores: readonly string[]): MarketPlan => {
    const rows: MarketPlanRow[] = [];
    let total = 0;
    let savings = 0;
    let referenced = 0;

    for (const item of items) {
        if (item.reference) referenced += 1;

        const offer = cheapestAmong(item.offers, stores);
        if (!offer) continue;

        const price = offer.price ?? 0;
        total += price;
        if (item.reference) savings += item.reference.price - price;
        rows.push({ item_id: item.id, ...offerFieldsOf(offer) });
    }

    return {
        stores: [...stores],
        rows,
        total: cents(total),
        savings: cents(savings),
        referenced,
        missing: items.length - rows.length,
    };
};

/** What a plan is worth: money first, coverage only inside the same cent. */
const rankOf = (plan: MarketPlan): number => plan.savings * 1000 + plan.rows.length;

/** The best single-store plan, the best pair, and everything in between. */
export const bestPlans = (items: readonly MarketBasketItem[], stores: readonly string[]): MarketPlanSet => {
    let single: MarketPlan | null = null;
    for (const store of stores) {
        const plan = planFor(items, [store]);
        if (single === null || rankOf(plan) > rankOf(single)) single = plan;
    }

    let pair: MarketPlan | null = null;
    for (let i = 0; i < stores.length; i += 1) {
        for (let j = i + 1; j < stores.length; j += 1) {
            const plan = planFor(items, [stores[i], stores[j]]);
            if (pair === null || rankOf(plan) > rankOf(pair)) pair = plan;
        }
    }

    return {
        single,
        pair,
        all: planFor(items, stores),
        // A pair that saves exactly as much as the best single store is still the
        // better answer only if it covers more items — which `rankOf` already
        // decided, so a tie here means the pair is at least as good.
        best: pair !== null && (single === null || rankOf(pair) >= rankOf(single)) ? 'pair' : 'single',
    };
};

// ---------------------------------------------------------------------------
// The model's pass over the rows
// ---------------------------------------------------------------------------

/**
 * The candidate names the AI verification is shown for one item: its offers'
 * product names, deduped the way the matcher compares them. An offer with no
 * name at all cannot be judged by one, so it never enters the list — and is
 * therefore never dropped.
 */
export const offerLabelsOf = (offers: readonly PromoOffer[]): string[] => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const offer of offers) {
        const label = (offer.name ?? offer.brand ?? '').trim();
        const key = comparable(label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
    }
    return labels;
};

/**
 * The offers whose candidate name the model kept.
 *
 * A verdict names a product, so every offer carrying that name obeys it — the
 * folded comparison is what makes 'mango' follow the verdict on 'Mango'. An
 * offer with no name at all was never shown to the model and always survives.
 */
export const applyKeepIndexes = (
    offers: readonly PromoOffer[],
    candidates: readonly string[],
    keep: readonly number[]
): PromoOffer[] => {
    const kept = new Set(keep.map((index) => candidates[index]).filter((label) => label !== undefined).map((label) => comparable(label)));
    return offers.filter((offer) => {
        const label = comparable((offer.name ?? offer.brand ?? '').trim());
        return !label || kept.has(label);
    });
};

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/**
 * `run` over `items`, at most `limit` in flight, results in input order.
 *
 * This is the whole outbound budget of one plan request: an item is one slot, and
 * every slot asks PrijsProfeet one request at a time (offersForTerms), so `limit`
 * is literally the number of requests that can be in flight.
 */
export const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    limit: number,
    run: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async (): Promise<void> => {
        for (;;) {
            const index = next;
            next += 1;
            if (index >= items.length) return;
            results[index] = await run(items[index], index);
        }
    };

    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
    await Promise.all(workers);
    return results;
};
