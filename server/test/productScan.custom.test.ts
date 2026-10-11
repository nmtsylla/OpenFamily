import assert from 'node:assert/strict';
import test from 'node:test';
import { firstCategory, normalizeProduct } from '../src/custom/lib/openFoodFacts.custom';
import { applyExclusions, isExcluded, normalizeTerm } from '../src/custom/lib/promoExclusions.custom';
import { configuredCountries, labelOf, normalizeOffers, normalizePromoFilters, normalizePromoPage, promoQueryOf, type PromoOffer } from '../src/custom/lib/prijsprofeet.custom';
import { barcodeOf, optionalPrice } from '../src/custom/lib/product.custom';

// =============================================================================
// The product-scan feature's pure decisions: what counts as a barcode, what
// counts as a price, and how an Open Food Facts document becomes a row.
//
// The last one is the one that bites in production: OFF's strings are external
// input going into fixed-width columns, and it answers "unknown" for a score it
// never computed.
// =============================================================================

test('barcodeOf: only the digit lengths a grocery barcode can have', () => {
    assert.equal(barcodeOf('3017620422003'), '3017620422003'); // EAN-13
    assert.equal(barcodeOf('96385074'), '96385074'); // EAN-8
    assert.equal(barcodeOf('  3017620422003  '), '3017620422003'); // trimmed

    assert.equal(barcodeOf('1234567'), null); // one digit short of an EAN-8
    assert.equal(barcodeOf('12345678901234'), null); // one too many
    assert.equal(barcodeOf('30176204220a3'), null);
    assert.equal(barcodeOf(''), null);
    assert.equal(barcodeOf('   '), null);
    assert.equal(barcodeOf(undefined), null);
    assert.equal(barcodeOf(3017620422003), null); // a number is not a barcode
});

test('optionalPrice: a positive decimal, nothing else', () => {
    assert.equal(optionalPrice('2.50'), 2.5);
    assert.equal(optionalPrice('2,50'), 2.5); // French decimal comma
    assert.equal(optionalPrice(2.5), 2.5);
    assert.equal(optionalPrice('2.499'), 2.5); // rounded to cents
    assert.equal(optionalPrice('  3 '), 3);

    assert.equal(optionalPrice('0'), null); // a promo is never free
    assert.equal(optionalPrice(0), null);
    assert.equal(optionalPrice('-2.50'), null);
    assert.equal(optionalPrice(''), null);
    assert.equal(optionalPrice(null), null);
    assert.equal(optionalPrice(undefined), null);
    assert.equal(optionalPrice('cheap'), null);
    assert.equal(optionalPrice(Number.POSITIVE_INFINITY), null);
});

test('firstCategory: the first OFF category, without its locale prefix', () => {
    assert.equal(firstCategory('fr:Goûter, Snacks, Sucré'), 'Goûter');
    assert.equal(firstCategory('Snacks'), 'Snacks');
    assert.equal(firstCategory(' fr:Goûter '), 'Goûter');
    assert.equal(firstCategory(''), '');
    assert.equal(firstCategory(undefined), '');
    assert.equal(firstCategory(['fr:Goûter']), '');
});

test('normalizeProduct: a Nutri-Score is one letter A-E or nothing', () => {
    const grade = (nutriscore_grade: unknown) => normalizeProduct('1', { nutriscore_grade }).nutriscore_grade;

    assert.equal(grade('a'), 'a');
    assert.equal(grade('B'), 'b'); // OFF has answered both cases
    assert.equal(grade('e'), 'e');

    // The values OFF answers when it never computed a score: storing either
    // would overflow VARCHAR(1) and fail the whole lookup.
    assert.equal(grade('unknown'), null);
    assert.equal(grade('UNKNOWN'), null);
    assert.equal(grade('not-applicable'), null);
    assert.equal(grade(''), null);
    assert.equal(grade(undefined), null);
    assert.equal(grade(42), null);
});

test('normalizeProduct: the fields the client renders, and their fallbacks', () => {
    const product = normalizeProduct('3017620422003', {
        product_name: '  Nutella  ',
        brands: 'Ferrero, Nutella',
        categories: 'en:Spreads, Sweet spreads',
        quantity: '400 g',
        image_front_url: 'https://images.openfoodfacts.org/front.jpg',
        image_url: 'https://images.openfoodfacts.org/other.jpg',
        nutriscore_grade: 'e',
    });

    assert.deepEqual(product, {
        barcode: '3017620422003',
        name: 'Nutella',
        brand: 'Ferrero', // first brand only
        category: 'Spreads',
        image_url: 'https://images.openfoodfacts.org/front.jpg', // front wins
        quantity: '400 g',
        unit: null, // OFF has no structured unit; the label string carries it
        nutriscore_grade: 'e',
    });

    const bare = normalizeProduct('1', {
        product_name: '',
        image_url: 'https://images.openfoodfacts.org/other.jpg',
        quantity: '',
    });
    assert.equal(bare.name, 'Unknown product');
    assert.equal(bare.brand, '');
    assert.equal(bare.category, '');
    assert.equal(bare.quantity, null);
    assert.equal(bare.image_url, 'https://images.openfoodfacts.org/other.jpg'); // fallback image
});

// =============================================================================
// PrijsProfeet: the free `/search` document behind the watchlist's deals pane.
// Same shape of risk as Open Food Facts above — external JSON of unknown shape —
// plus one of its own: a fuzzy search that answers a different product must never
// be shown under a barcode the family is watching for a price.
// =============================================================================

test('labelOf: an identifier key reads as a label', () => {
    assert.equal(labelOf('albert_heijn_be'), 'Albert Heijn');
    assert.equal(labelOf('albert_heijn'), 'Albert Heijn');
    assert.equal(labelOf('delhaize'), 'Delhaize');
    assert.equal(labelOf('groente-fruit'), 'Groente Fruit');
    assert.equal(labelOf(''), '');
});

test('normalizeOffers: only the product the barcode asked for', () => {
    const payload = {
        results: [
            {
                ean: '8718226779618',
                retailer: 'albert_heijn_be',
                name: 'AH Pistolet wit',
                brand: 'Albert Heijn',
                image_url: 'https://www.ah.be/img/pistolet.jpg',
                quantity: '300 g',
                price: 0.25,
                original_price: 0.49,
                savings_percentage: 49.49,
                promotion_status: 'active',
                valid_until: '2026-10-11T23:59:59',
                product_url: 'https://www.ah.be/producten/pistolet',
            },
            { ean: '8718226779619', retailer: 'jumbo', price: 1.99 }, // another product
            { ean: null, retailer: 'colruyt', price: 0.99 }, // the chain publishes no EAN
        ],
    };

    const offers = normalizeOffers('be', '8718226779618', payload);
    assert.deepEqual(
        offers.map((offer) => offer.retailer),
        ['albert_heijn_be', 'colruyt']
    );
    assert.deepEqual(offers[0], {
        country: 'be',
        retailer: 'albert_heijn_be',
        retailer_name: 'Albert Heijn',
        name: 'AH Pistolet wit',
        brand: 'Albert Heijn',
        image_url: 'https://www.ah.be/img/pistolet.jpg',
        quantity: '300 g',
        price: 0.25,
        original_price: 0.49,
        savings_percentage: 49.49,
        loyalty_price: null,
        multi_buy_quantity: null,
        multi_buy_price: null,
        promotion_status: 'active',
        valid_until: '2026-10-11T23:59:59',
        product_url: 'https://www.ah.be/producten/pistolet',
    });
});

test('normalizeOffers: a hostile document yields rows, not exceptions', () => {
    assert.deepEqual(normalizeOffers('nl', '12345678', null), []);
    assert.deepEqual(normalizeOffers('nl', '12345678', {}), []);
    assert.deepEqual(normalizeOffers('nl', '12345678', { results: 'nope' }), []);

    const [offer] = normalizeOffers('nl', '12345678', {
        results: [
            { retailer: 42, price: 'cheap', original_price: Number.NaN, product_url: 'javascript:alert(1)' },
        ],
    });
    assert.equal(offer.retailer_name, '');
    assert.equal(offer.price, null); // the client formats this as currency
    assert.equal(offer.original_price, null);
    assert.equal(offer.product_url, null); // the value goes into an href
});

test('configuredCountries: only the hosts that exist, `be` when unset', () => {
    const original = process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
    try {
        delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        assert.deepEqual(configuredCountries(), ['be']);

        process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = 'NL, be';
        assert.deepEqual(configuredCountries(), ['nl', 'be']);

        process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = 'nl,be,nl';
        assert.deepEqual(configuredCountries(), ['nl', 'be']); // one call per host

        process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = 'fr'; // not a host we know
        assert.deepEqual(configuredCountries(), ['be']);
    } finally {
        if (original === undefined) delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        else process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = original;
    }
});

test('normalizePromoPage: the browsable list keeps every row and the API paging', () => {
    const page = normalizePromoPage('nl', {
        total: 5623,
        page: 2,
        page_size: 24,
        results: [
            { ean: '8718226779618', retailer: 'albert_heijn', price: 0.25, promotion_status: 'active' },
            { ean: '8718226779619', retailer: 'jumbo', price: 1.99 },
        ],
    });

    // Nothing is filtered by EAN here: the list answers a query, not a barcode.
    assert.deepEqual(
        page.offers.map((offer) => offer.retailer),
        ['albert_heijn', 'jumbo']
    );
    assert.deepEqual(
        { total: page.total, page: page.page, pageSize: page.pageSize },
        { total: 5623, page: 2, pageSize: 24 }
    );

    assert.deepEqual(normalizePromoPage('nl', null), { offers: [], total: 0, page: 1, pageSize: 24 });
});

test('normalizePromoFilters: only the facets with deals, named, fullest first', () => {
    const filters = normalizePromoFilters('be', ['be', 'nl'], {
        categories: {
            categories: [
                { slug: 'groente-fruit', name: 'Groente & Fruit', count: 412, group: 'vers' },
                { slug: 'overig', name: 'Overig', count: 587 },
            ],
        },
        stats: {
            total: 5623,
            retailers: { albert_heijn_be: 2349, delhaize: 1438, lege_keten: 0 },
            categories: { overig: 587, 'groente-fruit': 412, verdwenen: 3 },
        },
    });

    assert.equal(filters.country, 'be');
    assert.deepEqual(filters.countries, ['be', 'nl']);
    assert.equal(filters.total, 5623);
    assert.deepEqual(filters.retailers, [
        { key: 'albert_heijn_be', label: 'Albert Heijn', count: 2349 },
        { key: 'delhaize', label: 'Delhaize', count: 1438 },
    ]); // the store with nothing on promotion is not a filter choice
    assert.deepEqual(filters.categories, [
        { key: 'overig', label: 'Overig', count: 587 },
        { key: 'groente-fruit', label: 'Groente & Fruit', count: 412 }, // the API's own name, not the slug
        { key: 'verdwenen', label: 'Verdwenen', count: 3 }, // unnamed by the categories list: the slug stands in
    ]);
});

test('promoQueryOf: what the client sends is vetted before it reaches the API', () => {
    const original = process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
    try {
        delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        assert.deepEqual(promoQueryOf({}), {
            country: 'be',
            q: '*',
            retailer: null,
            category: null,
            minSavings: null,
            sort: 'savings',
            page: 1,
            pageSize: 24,
        });
        // A country the deployment is not configured for is never asked.
        assert.equal(promoQueryOf({ country: 'nl' }).country, 'be');

        process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = 'be,nl';
        assert.deepEqual(
            promoQueryOf({
                country: 'nl',
                q: '  koffie ',
                retailer: 'albert_heijn',
                category: 'groente-fruit',
                min_savings: '50',
                sort: 'price_asc',
                page: '3',
                page_size: '500',
            }),
            {
                country: 'nl',
                q: 'koffie',
                retailer: 'albert_heijn',
                category: 'groente-fruit',
                minSavings: 50,
                sort: 'price_asc',
                page: 3,
                pageSize: 60, // clamped to the page size the API is asked for
            }
        );

        // A prototype key is not a sort order (nor a country): it must not reach
        // the upstream URL as `sort_by=function Object() {...}`.
        assert.equal(promoQueryOf({ sort: 'constructor' }).sort, 'savings');
        assert.equal(promoQueryOf({ country: 'constructor' }).country, 'be');

        // Anything the API's own facets could not produce is dropped, never forwarded.
        assert.deepEqual(
            promoQueryOf({
                country: 'fr', // not a configured host
                retailer: '../etc/passwd',
                category: 'A B',
                min_savings: 'trop',
                sort: 'random',
                page: '-2',
                page_size: '0',
            }),
            {
                country: 'be',
                q: '*',
                retailer: null,
                category: null,
                minSavings: null,
                sort: 'savings',
                page: 1,
                pageSize: 24,
            }
        );
    } finally {
        if (original === undefined) delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        else process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = original;
    }
});

test('configuredCountries: a prototype key is not a host either', () => {
    const original = process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
    try {
        process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = 'constructor,__proto__,be';
        assert.deepEqual(configuredCountries(), ['be']);
    } finally {
        if (original === undefined) delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        else process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = original;
    }
});

// =============================================================================
// The family's exclusions: a view preference applied after the upstream page,
// because PrijsProfeet has no "never show me this".
// =============================================================================

const offer = (name: string | null, brand: string | null): PromoOffer => ({
    country: 'be',
    retailer: 'colruyt',
    retailer_name: 'Colruyt',
    name,
    brand,
    image_url: null,
    quantity: null,
    price: null,
    original_price: null,
    savings_percentage: null,
    loyalty_price: null,
    multi_buy_quantity: null,
    multi_buy_price: null,
    promotion_status: 'active',
    valid_until: null,
    product_url: null,
});

test('normalizeTerm: comparable, or nothing worth storing', () => {
    assert.equal(normalizeTerm('  Café   Liégeois '), 'cafe liegeois');
    assert.equal(normalizeTerm('COCA'), 'coca');
    assert.equal(normalizeTerm('x'.repeat(60))?.length, 40); // the column's width

    assert.equal(normalizeTerm('a'), null); // one letter hides half the shop
    assert.equal(normalizeTerm('  '), null);
    assert.equal(normalizeTerm(42), null);
    assert.equal(normalizeTerm(undefined), null);
});

test('isExcluded: the name or the brand, accents and case aside', () => {
    assert.equal(isExcluded(offer('Coca-Cola Regular', 'Coca-Cola'), ['coca']), true);
    assert.equal(isExcluded(offer('Coca-Cola Regular', 'Coca-Cola'), ['pepsi']), false);
    assert.equal(isExcluded(offer('Coca-Cola Regular', 'Coca-Cola'), []), false);
    assert.equal(isExcluded(offer('Café Liégeois', null), ['cafe liegeois']), true);
    assert.equal(isExcluded(offer(null, 'Boni'), ['boni']), true);
    assert.equal(isExcluded(offer(null, null), ['boni']), false);
});

test('applyExclusions: what is left, and what that hid on this page', () => {
    const page = [offer('Coca-Cola Regular', 'Coca-Cola'), offer('Pistolet wit', null), offer(null, 'Boni')];

    const none = applyExclusions(page, []);
    assert.equal(none.hidden, 0);
    assert.equal(none.offers.length, 3);

    const withoutBoni = applyExclusions(page, ['boni']);
    assert.deepEqual(
        withoutBoni.offers.map((entry) => entry.name),
        ['Coca-Cola Regular', 'Pistolet wit']
    );
    assert.equal(withoutBoni.hidden, 1);

    const withoutSoftDrinks = applyExclusions(page, ['coca', 'boni']);
    assert.deepEqual(
        withoutSoftDrinks.offers.map((entry) => entry.name),
        ['Pistolet wit']
    );
    assert.equal(withoutSoftDrinks.hidden, 2);
});
