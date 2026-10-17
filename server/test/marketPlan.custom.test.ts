import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDutchTerms, sanitizeKeepIndexes } from '../src/custom/lib/marketAi.custom';
import {
    applyKeepIndexes,
    bestPlans,
    candidateTerms,
    dedupeTerms,
    mapWithConcurrency,
    marketCountry,
    marketStores,
    MAX_ITEM_TERMS,
    offerLabelsOf,
    planFor,
    referencePriceOf,
    type MarketBasketItem,
    type MarketItemReference,
    type MarketReceiptLine,
} from '../src/custom/lib/marketPlan.custom';
import type { PromoOffer } from '../src/custom/lib/prijsprofeet.custom';

// =============================================================================
// The "where to buy" plan's pure decisions.
//
// What these tests protect: the arithmetic the family acts on. `planFor` decides
// which store a week's shopping goes to and what it saves; `referencePriceOf`
// decides what "usual price" means, off the household's own receipts; and the two
// AI sanitizers decide how much of a model's answer may reach that arithmetic.
// The audit that shaped the ranking (a plan covering one expensive item must not
// beat the plan that covers the basket) is pinned in `bestPlans` below.
// =============================================================================

const offer = (over: Partial<PromoOffer> = {}): PromoOffer => ({
    country: 'be',
    retailer: 'colruyt',
    retailer_name: 'Colruyt',
    name: null,
    brand: null,
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
    ...over,
});

const reference = (price: number): MarketItemReference => ({
    price,
    source: 'regular',
    label: null,
    merchant: null,
    date: null,
});

const item = (id: string, offers: PromoOffer[], referencePrice: number | null = null): MarketBasketItem => ({
    id,
    offers,
    reference: referencePrice === null ? null : reference(referencePrice),
});

const receiptLine = (over: Partial<MarketReceiptLine> = {}): MarketReceiptLine => ({
    label: 'Broccoli 500g',
    unit_price: '1.29',
    amount: '1.29',
    merchant: 'ALDI',
    date: new Date(2026, 9, 7),
    ...over,
});

// =============================================================================
// Terms
// =============================================================================

test('candidateTerms: the name first, aliases deduped like the pantry, four at most', () => {
    // 'Mangue' and 'mangue' are one search; the list's own spelling goes first.
    assert.deepEqual(candidateTerms('Mangue', ['mangue', 'mango']), ['Mangue', 'mango']);
    // The pantry's folding, so 'Œufs' hides an alias that says the same thing.
    assert.deepEqual(candidateTerms('Œufs', ['oeufs', 'eieren']), ['Œufs', 'eieren']);
    // An alias the pantry declares for one product is a term of its own.
    assert.deepEqual(candidateTerms('Uien - Oignon', ['uien', 'oignon']), ['Uien - Oignon', 'uien', 'oignon']);

    // Four terms is the whole budget: the name and its three nearest aliases.
    assert.deepEqual(candidateTerms('Riz', ['riz', 'basmati', 'rijst', 'long', 'extra']), [
        'Riz',
        'basmati',
        'rijst',
        'long',
    ]);

    // One letter matches half the shop, an empty name is not a product.
    assert.deepEqual(candidateTerms('a', ['b']), []);
    assert.deepEqual(candidateTerms('', ['  ']), []);
    assert.equal(MAX_ITEM_TERMS, 4);
});

test('dedupeTerms: one term per spelling, accents and inner spaces aside', () => {
    assert.deepEqual(dedupeTerms(['Mangue', 'mangue', 'MANGO', 'Lait  chocolaté', 'lait chocolaté', '']), [
        'Mangue',
        'MANGO',
        'Lait  chocolaté',
    ]);
    assert.deepEqual(dedupeTerms([]), []);
});

// =============================================================================
// The household's reference price
// =============================================================================

test('referencePriceOf: the newest matching receipt line is what the household paid', () => {
    const lines = [
        receiptLine({ label: 'Tikka Masala', unit_price: '5.99', amount: '5.99', merchant: 'Albert Heijn', date: new Date(2026, 9, 9) }),
        // Two lines name the product; the route hands the tickets over newest first.
        receiptLine({ label: 'Mango', unit_price: '3.10', amount: '3.10' }),
        receiptLine({ label: 'MANGUE 2P', unit_price: '2.20', amount: '4.40', date: new Date(2026, 9, 5) }),
    ];

    // 'Mangue' answers to the Dutch 'Mango' and to the ticket's own shorthand:
    // the newest of the two is the reference, not the cheaper older one.
    assert.deepEqual(referencePriceOf(['Mangue'], lines, [offer({ price: 1.5, original_price: 2.0 })]), {
        price: 3.1,
        source: 'receipt',
        label: 'Mango',
        merchant: 'ALDI',
        date: '2026-10-07',
    });

    // Two tickets of the same day: the first in the caller's order, which is the
    // one the household scanned last.
    const sameDay = [receiptLine({ label: 'Lait 1L', unit_price: '1.10' }), receiptLine({ label: 'LAIT CHOCO 1L', unit_price: '1.90' })];
    assert.equal(referencePriceOf(['Lait'], sameDay, [])?.price, 1.1);

    // The receipt wins over the chain's own crossed-out price.
    const receipts = [receiptLine({ label: 'Café 250g', unit_price: '4.50', amount: '4.50' })];
    const priced = referencePriceOf(['Café'], receipts, [offer({ price: 3.0, original_price: 6.0 })]);
    assert.equal(priced?.source, 'receipt');
    assert.equal(priced?.price, 4.5);
});

test('referencePriceOf: a 0,00 line is not a price, and the amount stands in for a missing unit price', () => {
    // The household really has such lines (a scanned loyalty discount, a free
    // item): they must not become the price everyone else is compared against.
    const lines = [
        receiptLine({ label: 'Broccoli 500g', unit_price: '0.00', amount: '0.00' }),
        receiptLine({ label: 'Broccoli 500g', unit_price: null, amount: '2.49' }),
    ];
    assert.equal(referencePriceOf(['Broccoli'], lines, [])?.price, 2.49);

    // A line whose both numbers are unreadable is skipped, not zero.
    assert.equal(referencePriceOf(['Broccoli'], [receiptLine({ unit_price: null, amount: null })], []), null);
    assert.equal(referencePriceOf(['Broccoli'], [receiptLine({ unit_price: 'cher', amount: '' })], []), null);

    // Terms shorter than three letters match too much of a ticket to be evidence.
    assert.equal(referencePriceOf(['la'], [receiptLine({ label: 'LAIT CHOCO 1L', unit_price: '0.99' })], []), null);
    // ...and a match starts a word of the ticket, so 'Ail' is not the milk line.
    assert.equal(referencePriceOf(['Ail'], [receiptLine({ label: 'LAIT CHOCO 1L', unit_price: '1.19' })], []), null);
    // ...while a folded term still finds the accented line.
    assert.equal(referencePriceOf(['oeufs'], [receiptLine({ label: 'ŒUF BIO', unit_price: '2.10' })], [])?.price, 2.1);
});

test('referencePriceOf: with no receipt, the lowest published regular price stands in', () => {
    const offers = [
        offer({ price: 1.0, original_price: 1.5 }),
        offer({ price: 0.8, original_price: 1.2 }),
        // No promo price at all: there is nothing to compare, so it contributes none.
        offer({ price: null, original_price: 0.6 }),
    ];
    assert.deepEqual(referencePriceOf(['Broccoli'], [], offers), {
        price: 1.2,
        source: 'regular',
        label: null,
        merchant: null,
        date: null,
    });

    // A promo that is dearer than the crossed-out price still counts at the promo price.
    assert.equal(referencePriceOf(['X'], [], [offer({ price: 2.0, original_price: 1.5 })])?.price, 2.0);

    assert.equal(referencePriceOf(['Broccoli'], [], []), null);
    assert.equal(referencePriceOf(['Broccoli'], [], [offer({ price: null, original_price: null })]), null);
    // A zero is not something anyone paid.
    assert.equal(referencePriceOf(['Broccoli'], [], [offer({ price: 0 })]), null);
});

// =============================================================================
// The plans
// =============================================================================

test('planFor: the cheapest offer per store, and only covered items are priced', () => {
    const items = [
        item(
            'milk',
            [offer({ retailer: 'colruyt', price: 1.0 }), offer({ retailer: 'albert_heijn_be', price: 0.9, name: 'AH halfvolle melk' })],
            2.0
        ),
        item('bread', [offer({ retailer: 'colruyt', price: 2.0 })], 1.5),
        // Uncovered, but its reference still counts: the card says how much of the
        // list it can speak for.
        item('soap', [], 3.0),
    ];

    const plan = planFor(items, ['albert_heijn_be', 'colruyt']);

    assert.deepEqual(
        plan.rows.map((row) => [row.item_id, row.retailer, row.price]),
        [
            ['milk', 'albert_heijn_be', 0.9],
            ['bread', 'colruyt', 2.0],
        ]
    );
    assert.equal(plan.total, 2.9);
    // Savings are against each item's own reference: 1,10 € on the milk, 0,50 €
    // overpaid on the bread, and the soap plays no part at all.
    assert.equal(plan.savings, 0.6);
    assert.equal(plan.referenced, 3);
    assert.equal(plan.missing, 1);
    assert.deepEqual(plan.stores, ['albert_heijn_be', 'colruyt']);
});

test('planFor: the cheapest offer of a store wins, a tie goes to the earlier store', () => {
    const offers = [
        offer({ retailer: 'albert_heijn_be', name: 'Cher', price: 1.5 }),
        offer({ retailer: 'albert_heijn_be', name: 'Bon marché', price: 1.2 }),
        offer({ retailer: 'colruyt', name: 'Même prix', price: 1.2 }),
    ];

    const plan = planFor([item('x', offers, 2.0)], ['albert_heijn_be', 'colruyt']);
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].name, 'Bon marché'); // the cheaper row of the store
    assert.equal(plan.rows[0].retailer_name, 'Albert Heijn'); // display label

    // The configured order is what breaks a tie, not the order the API published.
    assert.equal(planFor([item('x', offers, 2.0)], ['colruyt', 'albert_heijn_be']).rows[0].retailer, 'colruyt');
});

test('planFor: a null price counts as 0 in the total, and the sum does not drift', () => {
    const plan = planFor(
        [
            item('a', [offer({ price: 0.1 })], 1.0),
            item('b', [offer({ price: 0.2 })], 1.0),
            item('c', [offer({ price: null })], 1.0),
        ],
        ['colruyt']
    );

    assert.equal(plan.total, 0.3);
    assert.equal(plan.savings, 2.7);
    assert.equal(plan.missing, 0);
});

test('bestPlans: the audit regression — money first, coverage only inside the same cent', () => {
    // A store covering ONE item (0,10 € saved) against a store covering three
    // (2,00 €). Ranking by the offers' own barré discounts is what crowned the
    // one-item plan in the prototype's first build; the shipped rule cannot.
    const items = [
        item('cafe', [offer({ retailer: 'albert_heijn_be', price: 7.9, original_price: 8.0 })], 8.0),
        item('savon', [offer({ retailer: 'colruyt', price: 2.5, original_price: 3.0 })], 3.0),
        item('pates', [offer({ retailer: 'colruyt', price: 1.0, original_price: 2.0 })], 2.0),
    ];
    const plans = bestPlans(items, ['albert_heijn_be', 'colruyt']);

    assert.deepEqual(plans.single?.stores, ['colruyt']);
    assert.equal(plans.single?.rows.length, 2);
    assert.equal(plans.single?.savings, 1.5);
    assert.equal(plans.single?.missing, 1);

    // The pair takes the coffee at Albert Heijn and the rest at Colruyt: one more
    // row and 0,10 € more saved, so it is the answer the card stars.
    assert.deepEqual(plans.pair?.stores, ['albert_heijn_be', 'colruyt']);
    assert.deepEqual(
        plans.pair?.rows.map((row) => [row.item_id, row.retailer]),
        [
            ['cafe', 'albert_heijn_be'],
            ['savon', 'colruyt'],
            ['pates', 'colruyt'],
        ]
    );
    assert.equal(plans.pair?.savings, 1.6);
    assert.equal(plans.best, 'pair');

    // Everywhere is the same basket as the pair here, and it is always computed.
    assert.equal(plans.all?.missing, 0);
    assert.equal(plans.all?.savings, 1.6);

    // With one store there is no pair to compare, and no star to move.
    const single = bestPlans(items, ['colruyt']);
    assert.equal(single.pair, null);
    assert.equal(single.best, 'single');
    assert.deepEqual(single.single?.stores, ['colruyt']);
});

test('bestPlans: a plan that saves more inside one store beats a wider but cheaper one', () => {
    const items = [
        item('whisky', [offer({ retailer: 'colruyt', price: 5.0 })], 15.0),
        item('savon', [offer({ retailer: 'albert_heijn_be', price: 2.9 })], 3.0),
        item('pates', [offer({ retailer: 'albert_heijn_be', price: 1.9 })], 2.0),
    ];
    const plans = bestPlans(items, ['albert_heijn_be', 'colruyt']);

    // 10,00 € saved on one item outranks 0,20 € saved on two: the family drives
    // to one store and pockets the difference, and `rows` only breaks ties.
    assert.deepEqual(plans.single?.stores, ['colruyt']);
    assert.equal(plans.single?.savings, 10.0);
    assert.equal(plans.single?.rows.length, 1);

    // …but the pair does both, so it is what `best` names.
    assert.equal(plans.pair?.savings, 10.2);
    assert.equal(plans.pair?.missing, 0);
    assert.equal(plans.best, 'pair');
});

// =============================================================================
// Configuration
// =============================================================================

test('marketStores: the four Belgian chains, vetted, deduped, eight at most', () => {
    const original = process.env.CUSTOM_MARKET_STORES;
    try {
        delete process.env.CUSTOM_MARKET_STORES;
        assert.deepEqual(marketStores(), ['albert_heijn_be', 'colruyt', 'aldi_be', 'lidl_be']);

        // Keys only: a path, a space and a repeated chain are not stores.
        process.env.CUSTOM_MARKET_STORES = ' Colruyt , colruyt,../etc/passwd, ,LIDL_BE';
        assert.deepEqual(marketStores(), ['colruyt', 'lidl_be']);

        // A prototype key is not a store: a chain is looked up in plain objects,
        // where 'constructor' answers with a function. The guard folds with the
        // value, and a list nothing survives falls back to the default rather
        // than to an empty plan.
        process.env.CUSTOM_MARKET_STORES = 'constructor,__proto__,toString';
        assert.deepEqual(marketStores(), ['albert_heijn_be', 'colruyt', 'aldi_be', 'lidl_be']);

        process.env.CUSTOM_MARKET_STORES = 'a,b,c,d,e,f,g,h,i,j,k';
        assert.equal(marketStores().length, 8);
    } finally {
        if (original === undefined) delete process.env.CUSTOM_MARKET_STORES;
        else process.env.CUSTOM_MARKET_STORES = original;
    }
});

test('marketCountry: one country, the deployment’s first', () => {
    const original = process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
    try {
        delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        assert.equal(marketCountry(), 'be');

        process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = 'nl,be';
        assert.equal(marketCountry(), 'nl');
    } finally {
        if (original === undefined) delete process.env.CUSTOM_PRIJSPROFEET_COUNTRIES;
        else process.env.CUSTOM_PRIJSPROFEET_COUNTRIES = original;
    }
});

// =============================================================================
// The model's answers
// =============================================================================

test('sanitizeDutchTerms: lowercase letters, three at most, never the item’s own name', () => {
    assert.deepEqual(sanitizeDutchTerms(['Mango', '  brood ', 'Chocolademelk']), ['mango', 'brood', 'chocolademelk']);
    assert.deepEqual(sanitizeDutchTerms(['mango', 'Mango', 'mangue']), ['mango', 'mangue']);

    // A word identical to the product is not a translation: the plain search
    // already asked it. Folded, so 'Crème' answers to 'creme'.
    assert.deepEqual(sanitizeDutchTerms(['Mangue', 'mango'], 'Mangue'), ['mango']);
    assert.deepEqual(sanitizeDutchTerms(['Crème'], 'creme'), []);

    // Accents are kept (the shop's API decides), punctuation and digits are not.
    assert.deepEqual(sanitizeDutchTerms(['crème fraîche!', '2%', 'bio-melk']), ['crème fraîche', 'bio-melk']);

    // Too short, not a string, an empty name: nothing worth a request.
    assert.deepEqual(sanitizeDutchTerms(['a', ' ', '-', 42, null, 'ō']), []);
    assert.deepEqual(sanitizeDutchTerms('mango'), []);
    assert.deepEqual(sanitizeDutchTerms([]), []);

    // Three words is the budget, and one long word is cut, not dropped.
    assert.deepEqual(sanitizeDutchTerms(['een', 'twee', 'drie', 'vier']), ['een', 'twee', 'drie']);
    assert.equal(sanitizeDutchTerms(['x'.repeat(40)])[0].length, 24);
});

test('sanitizeKeepIndexes: in-range integers kept, silence keeps every candidate', () => {
    const raw = {
        items: [
            { index: 0, keep: [1, 1, 3] }, // 3 is out of range, 1 twice
            { index: 2, keep: [] }, // the model named nothing: not a reason to delete rows
        ],
    };

    // Entry 1 was not answered at all — same answer as entry 2's empty list.
    assert.deepEqual(sanitizeKeepIndexes(raw, 3, 2), [[1], [0, 1], [0, 1]]);

    // Counts differ per entry.
    assert.deepEqual(sanitizeKeepIndexes({ items: [{ index: 0, keep: [0, 2] }] }, 2, [1, 3]), [[0], [0, 1, 2]]);

    // An answer about an entry that was not asked, a broken keep, a wrong type:
    // everything that is not a usable verdict keeps the candidates.
    assert.deepEqual(sanitizeKeepIndexes({ items: [{ index: 9, keep: [0] }, { index: 0.5, keep: [0] }] }, 1, 1), [[0]]);
    assert.deepEqual(sanitizeKeepIndexes({ items: [{ index: 0, keep: 'none' }] }, 1, 1), [[0]]);
    assert.deepEqual(sanitizeKeepIndexes(null, 1, 1), [[0]]);
    assert.deepEqual(sanitizeKeepIndexes({ items: 'nope' }, 1, 1), [[0]]);

    // Non-integer and negative numbers are noise, not indexes.
    assert.deepEqual(sanitizeKeepIndexes({ items: [{ index: 0, keep: [-1, 1.5, '1', 0] }] }, 1, 2), [[0]]);
});

test('offerLabelsOf / applyKeepIndexes: the model judges names, the plan keeps offers', () => {
    const offers = [
        offer({ name: 'Mango' }),
        offer({ name: 'Magnum wijn' }),
        offer({ brand: 'Boni' }),
        offer({ name: 'mango' }), // the same product name, folded
        offer({}), // no name at all: nothing to judge, so never dropped
    ];
    const candidates = offerLabelsOf(offers);
    assert.deepEqual(candidates, ['Mango', 'Magnum wijn', 'Boni']);

    const kept = applyKeepIndexes(offers, candidates, [0, 2]);
    assert.deepEqual(
        kept.map((entry) => entry.name ?? entry.brand ?? ''),
        ['Mango', 'Boni', 'mango', '']
    );

    // The verdict is about a name, so every offer carrying a name the model did
    // not list goes with it — and the offer no name could describe is the one
    // thing a verdict on names cannot reach.
    assert.deepEqual(applyKeepIndexes(offers, candidates, []).map((entry) => entry.name ?? entry.brand ?? ''), ['']);
});

// =============================================================================
// Plumbing
// =============================================================================

test('mapWithConcurrency: results in input order, at most `limit` in flight', async () => {
    let running = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return value * 2;
    });

    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
    assert.equal(peak, 3);
    assert.deepEqual(await mapWithConcurrency([], 3, async () => 'never'), []);
});
