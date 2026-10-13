// PrijsProfeet: the supermarket promotions running today, keyed by barcode (the
// promo watchlist's deals pane) or browsed as a list (the promo screen's
// "deals of the day" tab).
//
// Free plan, which is what the fork uses: `/search`, `/categories` and
// `/filter-stats` are key-less. The key is OPTIONAL — it only raises the budget
// (150/min on your key instead of the per-IP caps) — so every surface here works
// without one and gets roomier with it.
//
// Deliberately not called: `/match/*` (cross-retailer EAN matching),
// `/shelf-prices` (the regular price of the whole assortment) and
// `/price-history`. All three are Pro-only, and `/match/ean/{ean}` answers 4xx on
// a free key. The consequence is real and the UI says so: what is NOT on
// promotion this week has no row here at all — the free tier carries promotions,
// not an assortment.
//
// The host picks the country: `.nl` for the Dutch chains, `.be` for the Belgian
// ones, one key valid on both. The watchlist pane asks every configured country
// and merges (small lists); the browsable list is one country per request, since
// merging two paginated streams would fake a paging nobody has (`total` comes
// from the API itself).
//
// Attribution is a licence term of the free plan, not a nicety: every screen that
// shows these rows carries a visible link to PrijsProfeet (scan.custom.json,
// `*.offersVia`).
//
// Caching: the API refreshes the chains overnight, so the browsable list and the
// filter counts are cached until the next morning — one upstream fetch per query
// per day, which is what "refreshed daily" means here. The barcode pane keeps its
// short TTL instead, because a card can be reopened at any time and the cost of
// one extra request is nothing. The whole day's catalogue (see `catalogueFor`) is
// a fourth cache with the same boundary, because the "my products" mode cannot be
// asked upstream at all: `q` is fuzzy there, so the matches are found here.

import { safeFetch, readCappedText } from '../../lib/safeFetch';

export type PromoCountry = 'nl' | 'be';

const HOSTS: Record<PromoCountry, string> = {
    nl: 'https://www.prijsprofeet.nl',
    be: 'https://www.prijsprofeet.be',
};
const DEFAULT_COUNTRY: PromoCountry = 'be';
const TIMEOUT_MS = 8000;
// A page of search results with images and URLs is a few tens of kilobytes; the
// image URLs are the bulk. The cap is what a hostile or broken upstream cannot
// exceed.
const MAX_BYTES = 1024000;
const BARCODE_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
// The upstream catalogue is ~9k promotions per country (15k in NL): a page
// number beyond this is a crawler, not a household.
const MAX_PAGE = 200;
// Deals change weekly (every night, at most), so what matters is not hammering a
// 150/min budget when a pane is toggled. Ten minutes is well inside "the same
// promotion", and a miss is one extra request.
const OFFERS_TTL_MS = 10 * 60 * 1000;
// PrijsProfeet refreshes the chains overnight (the "night run ready" webhook
// fires around 07:05 Europe/Amsterdam). The daily caches expire at the next
// 07:30 *server* time: late on purpose, so the refresh always lands before the
// boundary whatever the container's timezone.
const REFRESH_HOUR = 7;
const REFRESH_MINUTE = 30;
// The API asks integrations to identify themselves — and answers 403 to a
// KEYLESS request whose User-Agent contains "bot", "crawler", "spider" or
// "slurp", which is why this one is spelled out.
const USER_AGENT = 'OpenFamily/1.8 (self-hosted family app)';

/** One running promotion, reduced to what the promo screens render. */
export interface PromoOffer {
    country: PromoCountry;
    /** The API's chain key, e.g. `albert_heijn_be`. Kept for a stable React key. */
    retailer: string;
    /** The same key, spelled for display: `Albert Heijn`. */
    retailer_name: string;
    /** The shop's own name for the product. The browsable list shows it; the
     * watchlist pane already has it in the card header. */
    name: string | null;
    brand: string | null;
    /** The API's own category slug (`groente-fruit`), the same vocabulary
     * `/api/v1/categories` names — so the "my products" filter can group a local
     * list by the key the filter panel already speaks. */
    category: string | null;
    image_url: string | null;
    /** The chain's pack size ("500 g"), the one thing that tells two offers for
     * one EAN apart. */
    quantity: string | null;
    price: number | null;
    original_price: number | null;
    savings_percentage: number | null;
    loyalty_price: number | null;
    multi_buy_quantity: number | null;
    multi_buy_price: number | null;
    /** `active` today, `upcoming` when the deal only starts next week. */
    promotion_status: string | null;
    valid_until: string | null;
    product_url: string | null;
}

/** A page of the browsable list. `total` is the API's own count for the filters. */
export interface PromoPage {
    offers: PromoOffer[];
    total: number;
    page: number;
    pageSize: number;
}

/** One filter choice: a retailer key or a category slug, with how many deals it has. */
export interface PromoFacet {
    key: string;
    label: string;
    count: number;
}

export interface PromoFilters {
    /** Every configured country, so the client can offer to switch. */
    countries: PromoCountry[];
    /** The country these counts describe. */
    country: PromoCountry;
    total: number;
    retailers: PromoFacet[];
    categories: PromoFacet[];
}

/** Sort orders the UI offers, mapped to the API's own `sort_by` values. */
export const PROMO_SORTS = {
    savings: 'savings_percentage:desc',
    price_asc: 'price:asc',
    price_desc: 'price:desc',
} as const;

export type PromoSort = keyof typeof PROMO_SORTS;

/** A browsable-list request, with every value already vetted. */
export interface PromoQuery {
    country: PromoCountry;
    q: string;
    retailer: string | null;
    category: string | null;
    /** The "my products" mode: keep only the deals this family's pantry or past
     * receipts already know. Never sent upstream — the API cannot answer it. */
    onlyKnown: boolean;
    minSavings: number | null;
    sort: PromoSort;
    page: number;
    pageSize: number;
}

const textOf = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? text : null;
};

const numberOf = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const countOf = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/**
 * `albert_heijn_be` → `Albert Heijn`, `groente-fruit` → `Groente Fruit`. The
 * retailer keys and the category slugs are both identifiers, never copy; the
 * country suffix carries no information once the country is shown on its own.
 */
export const labelOf = (key: string): string =>
    key
        .replace(/_(nl|be)$/, '')
        .split(/[-_]/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

// The URL goes into an `href` in the client: an http(s) link or nothing.
const linkOf = (value: unknown): string | null => {
    const text = textOf(value);
    if (!text) return null;
    try {
        const url = new URL(text);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
        return null;
    }
};

/**
 * A `/search` document → the offers worth showing. Pure, so the mapping is
 * testable without the network: the input is external JSON of unknown shape, and
 * a wrong row here is a price the family trusts and acts on.
 */
export const normalizeOffers = (country: PromoCountry, ean: string, payload: unknown): PromoOffer[] => {
    const results = (payload as { results?: unknown } | null | undefined)?.results;
    if (!Array.isArray(results)) return [];

    return results.flatMap((raw): PromoOffer[] => {
        const row = (raw ?? {}) as Record<string, unknown>;
        const rowEan = textOf(row.ean);
        // A different EAN proves the search answered another product, which is
        // the one mistake a barcode-keyed watchlist must not make. A chain that
        // publishes no EAN is unverifiable rather than wrong, and stays. An empty
        // `ean` is the browsable list, where nothing is filtered by barcode.
        if (ean && rowEan && rowEan !== ean) return [];

        const retailer = textOf(row.retailer) ?? '';
        return [
            {
                country,
                retailer,
                retailer_name: labelOf(retailer),
                name: textOf(row.name),
                brand: textOf(row.brand),
                category: textOf(row.unified_category),
                image_url: linkOf(row.image_url),
                quantity: textOf(row.quantity),
                price: numberOf(row.price),
                original_price: numberOf(row.original_price),
                savings_percentage: numberOf(row.savings_percentage),
                loyalty_price: numberOf(row.loyalty_price),
                multi_buy_quantity: numberOf(row.multi_buy_quantity),
                multi_buy_price: numberOf(row.multi_buy_price),
                promotion_status: textOf(row.promotion_status),
                valid_until: textOf(row.valid_until),
                product_url: linkOf(row.product_url),
            },
        ];
    });
};

/** A page document → the offers plus the API's own paging numbers. */
export const normalizePromoPage = (country: PromoCountry, payload: unknown): PromoPage => {
    const page = (payload ?? {}) as Record<string, unknown>;
    return {
        // The browsable list has no barcode, so nothing is filtered by EAN.
        offers: normalizeOffers(country, '', page),
        total: countOf(page.total),
        page: countOf(page.page) || 1,
        pageSize: countOf(page.page_size) || DEFAULT_PAGE_SIZE,
    };
};

const facetList = (counts: unknown, labels: Map<string, string> | null): PromoFacet[] => {
    if (!counts || typeof counts !== 'object') return [];
    return Object.entries(counts as Record<string, unknown>)
        .map(([key, count]) => ({ key, label: labels?.get(key) ?? labelOf(key), count: countOf(count) }))
        // A facet nobody can filter by is noise in a dropdown.
        .filter((facet) => facet.count > 0)
        .sort((left, right) => right.count - left.count);
};

/**
 * `/categories` + `/filter-stats` → the filter panel's choices. The categories
 * endpoint is the only source of display names (the slugs would render as
 * "Groente Fruit"), and the stats are asked with `promotion_status=active` so a
 * store or category the user picks counts what the list will actually show
 * (verified: Colruyt's facet count equals Colruyt's filtered `total`).
 *
 * One caveat, and it is upstream's: the two endpoints disagree by ~18 rows on the
 * unfiltered wildcard (`/search?q=*` answers 5 605 where `/filter-stats` answers
 * 5 623, both with `promotion_status=active`). Each number stays the API's own
 * for its own endpoint — reconciling them would mean inventing a third one.
 */
export const normalizePromoFilters = (country: PromoCountry, countries: PromoCountry[], raw: { categories?: unknown; stats?: unknown }): PromoFilters => {
    const names = new Map<string, string>();
    const listed = (raw.categories as { categories?: unknown } | null | undefined)?.categories;
    if (Array.isArray(listed)) {
        for (const entry of listed) {
            const item = (entry ?? {}) as Record<string, unknown>;
            const slug = textOf(item.slug);
            const name = textOf(item.name);
            if (slug && name) names.set(slug, name);
        }
    }

    const stats = (raw.stats ?? {}) as Record<string, unknown>;
    return {
        countries,
        country,
        total: countOf(stats.total),
        retailers: facetList(stats.retailers, null),
        // The category names come from the categories list, but only the counts
        // decide which ones are worth showing.
        categories: facetList(stats.categories, names),
    };
};

/** The countries to ask, from `CUSTOM_PRIJSPROFEET_COUNTRIES` (default: be). */
export const configuredCountries = (): PromoCountry[] => {
    const requested = (process.env.CUSTOM_PRIJSPROFEET_COUNTRIES || DEFAULT_COUNTRY)
        .toLowerCase()
        .split(',')
        .map((country) => country.trim())
        // `Object.hasOwn`, not `in`: a typo like `constructor` must not make it
        // through as a host.
        .filter((country): country is PromoCountry => Object.hasOwn(HOSTS, country));

    return requested.length ? [...new Set(requested)] : [DEFAULT_COUNTRY];
};

/** A country the deployment is configured for, or the first one. */
export const promoCountryOf = (value: unknown): PromoCountry => {
    const wanted = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const configured = configuredCountries();
    return configured.find((country) => country === wanted) ?? configured[0] ?? DEFAULT_COUNTRY;
};

const RETAILER_RE = /^[a-z0-9_]{1,32}$/;
const CATEGORY_RE = /^[a-z0-9-]{1,40}$/;
const MAX_QUERY_LENGTH = 60;

/**
 * Request query string → a vetted browsable-list request. Everything here lands
 * in a third-party URL, and the values the client sends come from the API's own
 * facets: anything outside that shape is dropped rather than forwarded.
 */
export const promoQueryOf = (raw: Record<string, unknown>): PromoQuery => {
    const retailer = textOf(raw.retailer);
    const category = textOf(raw.category);
    const sort = textOf(raw.sort);
    const savings = textOf(raw.min_savings);
    const minSavings = savings === null ? null : Number(savings);
    const page = countOf(textOf(raw.page));
    const pageSize = countOf(textOf(raw.page_size));

    return {
        country: promoCountryOf(raw.country),
        // `*` is the API's "browse everything"; it is the default view.
        q: (textOf(raw.q) ?? '*').slice(0, MAX_QUERY_LENGTH),
        retailer: retailer && RETAILER_RE.test(retailer) ? retailer : null,
        category: category && CATEGORY_RE.test(category) ? category : null,
        onlyKnown: raw.only_known === '1',
        minSavings: minSavings !== null && Number.isFinite(minSavings) && minSavings >= 0 && minSavings <= 100 ? Math.floor(minSavings) : null,
        // `Object.hasOwn`: `sort=constructor` would otherwise pass the guard and
        // stringify a function into `sort_by`.
        sort: sort && Object.hasOwn(PROMO_SORTS, sort) ? (sort as PromoSort) : 'savings',
        page: Math.min(Math.max(page, 1), MAX_PAGE),
        pageSize: Math.min(Math.max(pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE),
    };
};

/** Milliseconds until the next daily refresh boundary. */
export const msUntilRefresh = (now = new Date()): number => {
    const boundary = new Date(now);
    boundary.setHours(REFRESH_HOUR, REFRESH_MINUTE, 0, 0);
    if (boundary.getTime() <= now.getTime()) boundary.setDate(boundary.getDate() + 1);
    return boundary.getTime() - now.getTime();
};

// ponytail: one Map in one process, no shared cache until the server is run
// replicated. The key carries the client's own search terms, so it is bounded by
// entry count instead of relying on the TTL alone: an authenticated caller can
// mint a fresh key per request, and entries the TTL has expired are only ever
// replaced when that exact key comes back. Oldest-inserted first (Map order).
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

const cached = async <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { expiresAt: Date.now() + ttlMs, value });
    return value;
};

const requestJson = async (path: string, searchParams: Record<string, string | number | undefined>): Promise<unknown> => {
    const key = process.env.CUSTOM_PRIJSPROFEET_API_KEY?.trim();
    const url = new URL(path);
    for (const [name, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }

    const response = await safeFetch(url.toString(), {
        timeoutMs: TIMEOUT_MS,
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            ...(key ? { 'X-API-Key': key } : {}),
        },
    });
    if (!response.ok) throw new Error(`PrijsProfeet answered HTTP ${response.status}`);

    return JSON.parse(await readCappedText(response, MAX_BYTES));
};

const fetchOffers = async (country: PromoCountry, barcode: string): Promise<PromoOffer[]> => {
    const payload = await requestJson(`${HOSTS[country]}/api/v1/search`, {
        q: barcode,
        promotion_status: 'active',
        page_size: BARCODE_PAGE_SIZE,
    });
    return normalizeOffers(country, barcode, payload);
};

const fetchPage = async (query: PromoQuery): Promise<PromoPage> => {
    const payload = await requestJson(`${HOSTS[query.country]}/api/v1/search`, {
        q: query.q,
        promotion_status: 'active',
        retailer: query.retailer ?? undefined,
        category: query.category ?? undefined,
        min_savings: query.minSavings ?? undefined,
        sort_by: PROMO_SORTS[query.sort],
        page: query.page,
        page_size: query.pageSize,
    });
    return normalizePromoPage(query.country, payload);
};

const fetchFilters = async (country: PromoCountry): Promise<PromoFilters> => {
    const host = HOSTS[country];
    const [categories, stats] = await Promise.all([
        requestJson(`${host}/api/v1/categories`, {}),
        requestJson(`${host}/api/v1/filter-stats`, { promotion_status: 'active' }),
    ]);
    return normalizePromoFilters(country, configuredCountries(), { categories, stats });
};

/**
 * The running promotions for a barcode, cheapest first. Every configured country
 * is asked in parallel and either may fail on its own: only when all of them
 * failed is the caller told the check could not happen.
 */
export async function dealsForBarcode(barcode: string): Promise<PromoOffer[]> {
    return cached(`offers:${barcode}`, OFFERS_TTL_MS, async () => {
        const settled = await Promise.allSettled(
            configuredCountries().map((country) => fetchOffers(country, barcode))
        );
        const offers = settled
            .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
            .sort((left, right) => (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY));

        if (!offers.length && settled.every((result) => result.status === 'rejected')) {
            throw (settled[0] as PromiseRejectedResult).reason;
        }
        return offers;
    });
}

/** One page of today's promotions, filtered server-side, cached for the day. */
export async function searchPromos(query: PromoQuery): Promise<PromoPage> {
    const key = `promos:${JSON.stringify(query)}`;
    return cached(key, msUntilRefresh(), () => fetchPage(query));
}

/** The filter choices and their counts for one country, cached for the day. */
export async function promoFilters(country: PromoCountry): Promise<PromoFilters> {
    return cached(`filters:${country}`, msUntilRefresh(), () => fetchFilters(country));
}

// The catalogue is asked for in whole pages: 6 000 offers arrive as 61 requests.
const CATALOGUE_PAGE_SIZE = 100;

// ponytail: the catalogue is ~6 000 rows (~8 MB), so it must NOT go through the
// shared 500-entry FIFO above — one country's value would evict every cached query
// of the day, and a FIFO is the wrong eviction for a value that is read on every
// "my products" request. One entry per configured country, in its own Map.
const catalogues = new Map<PromoCountry, { expiresAt: number; value: PromoOffer[] }>();
// Two callers before the first crawl finishes (the boot warm and the first
// visitor) share one crawl instead of starting a second 61-request walk.
const catalogueLoads = new Map<PromoCountry, Promise<PromoOffer[]>>();

/**
 * One page of the wildcard browse. A page that fails is pushed back once: a lost
 * page is a shop that silently vanishes from the family's list, which is worse
 * than a second request — and a second failure means this is not this morning's
 * catalogue, so it throws rather than returns a partial one.
 */
const fetchCataloguePage = async (country: PromoCountry, page: number): Promise<unknown> => {
    const searchParams = {
        q: '*',
        promotion_status: 'active',
        page,
        page_size: CATALOGUE_PAGE_SIZE,
    };
    try {
        return await requestJson(`${HOSTS[country]}/api/v1/search`, searchParams);
    } catch {
        return requestJson(`${HOSTS[country]}/api/v1/search`, searchParams);
    }
};

const crawlCatalogue = async (country: PromoCountry): Promise<PromoOffer[]> => {
    const offers: PromoOffer[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGE; page += 1) {
        const rows = normalizePromoPage(country, await fetchCataloguePage(country, page));

        for (const offer of rows.offers) {
            // The chain lists some products once per store or per multi-buy, with
            // the same row body; the key is what a card renders, so identical
            // cards collapse and near-identical ones (another price, another
            // pack size) stay.
            const key = `${offer.retailer}|${offer.name}|${offer.quantity}|${offer.price}|${offer.product_url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            offers.push(offer);
        }

        // A page the API calls non-empty must not come back empty: caching that as
        // the day's catalogue would hide every deal until tomorrow, so it throws
        // and the next request tries again.
        if (!rows.offers.length && rows.total > 0) {
            throw new Error(`PrijsProfeet returned an empty page ${page} of ${rows.total}`);
        }

        // A short page is the end of the list whatever the count says, and the
        // count is upstream's own for the wildcard.
        if (rows.offers.length < CATALOGUE_PAGE_SIZE || page * CATALOGUE_PAGE_SIZE >= rows.total) break;
    }

    return offers;
};

/**
 * Every promotion running today in one country — the "my products" mode's search
 * space, since upstream cannot filter by "the products this family knows". Cached
 * until the next morning like the list itself, and one crawl at a time.
 */
export async function catalogueFor(country: PromoCountry): Promise<PromoOffer[]> {
    const hit = catalogues.get(country);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const running = catalogueLoads.get(country);
    if (running) return running;

    // A failure is not cached: the next request tries again rather than serving a
    // family a permanently empty list for the rest of the day.
    const load = crawlCatalogue(country)
        .then((offers) => {
            catalogues.set(country, { expiresAt: Date.now() + msUntilRefresh(), value: offers });
            return offers;
        })
        .finally(() => catalogueLoads.delete(country));

    catalogueLoads.set(country, load);
    return load;
}
