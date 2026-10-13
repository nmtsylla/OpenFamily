import assert from 'node:assert/strict';
import test from 'node:test';
import { knownContext, knownFilters, knownPage, matchTokens, matchedOffers, type KnownContext } from '../src/custom/lib/promoKnown.custom';
import { promoQueryOf, type PromoFilters, type PromoOffer, type PromoPage, type PromoQuery } from '../src/custom/lib/prijsprofeet.custom';

// =============================================================================
// The "my products" promo mode: which of the family's own product names appear
// in an offer's name. Every case here is one the probe measured on live data, so
// the literals are the shop's own text, not invented ones.
//
// Two failure modes matter, in opposite directions: a missed match is a deal the
// family does not see, a false positive is a deal they did not ask for. The
// false positives are the ones pinned here, because they are the ones a reader
// would notice.
// =============================================================================

const offer = (name: string | null, over: Partial<PromoOffer> = {}): PromoOffer => ({
    country: 'be',
    retailer: 'colruyt',
    retailer_name: 'Colruyt',
    name,
    brand: null,
    category: null,
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

/** A context with no frequency knowledge, i.e. the match rules on their own. */
const contextOf = (names: string[]): KnownContext => ({
    products: names.map((name) => {
        const tokens = matchTokens(name);
        return { name, tokens, distinctive: tokens };
    }),
    generic: new Set<string>(),
});

const query = (over: Partial<PromoQuery> = {}): PromoQuery => ({
    country: 'be',
    q: '*',
    retailer: null,
    category: null,
    onlyKnown: true,
    minSavings: null,
    sort: 'savings',
    page: 1,
    pageSize: 24,
    ...over,
});

test('matchTokens: folded, split, and nothing a half of the shop matches', () => {
    assert.deepEqual(matchTokens('Basmati rijst'), ['basmati', 'rijst']);
    assert.deepEqual(matchTokens('Café Œufs'), ['cafe', 'oeufs']); // accents and ligatures fold
    assert.deepEqual(matchTokens('AH Basmati'), ['basmati']); // 'ah' identifies nothing
    assert.deepEqual(matchTokens('Lait demi-écrémé 1L'), ['lait', 'demi', 'ecreme']); // '1l', digits
    assert.deepEqual(matchTokens('de a 1l'), []); // short tokens never decide a match
    assert.deepEqual(matchTokens('350'), []); // a bare number is not a product word
});

test('matchedOffers: the names the family knows, against the shop wording', () => {
    const offers = [
        offer('Tilda Pure Basmati'),
        offer('Streeckgenoten Kookworst'),
        offer('Knorr Maaltijdmix tikka masala'),
        offer('Leerdammer Original jong 45+ plakken'),
    ];

    assert.deepEqual(matchedOffers(offers, contextOf(['ah basmati'])), [offers[0]]);
    assert.deepEqual(matchedOffers(offers, contextOf(['kookworst'])), [offers[1]]);
    assert.deepEqual(matchedOffers(offers, contextOf(['tikka masala'])), [offers[2]]);
    // Four distinctive words, two of them hit: the majority rule carries it.
    assert.deepEqual(matchedOffers(offers, contextOf(['leerdammer original tranches 350g'])), [offers[3]]);
});

test('matchedOffers: a partial name does not carry a two-word product', () => {
    const offers = [offer('Streeckgenoten Kookworst')];
    // 'kookworst' is not 'kookworst speciaal': the second word must land too.
    assert.deepEqual(matchedOffers(offers, contextOf(['kookworst speciaal'])), []);
});

test('matchedOffers: a false positive is a deal the family did not ask for', () => {
    // The probe's two: 'eau' is a laundry-shelf word and a food-shelf word.
    const shelf = [offer('Garnier Dagcreme | Vegetal eau de rose'), offer('Poire Williams eau de vie')];
    assert.deepEqual(matchedOffers(shelf, contextOf(['eau de javel'])), []);

    assert.deepEqual(matchedOffers([offer('Vivera Stevige tofu a la minute')], contextOf(['boisson a la fraise'])), []);
});

test('matchedOffers: a three-character token is not a prefix', () => {
    // The probe's case: ungated prefixing made 'sla' match 'Delhaize Slagroom'.
    assert.deepEqual(matchedOffers([offer('Delhaize Slagroom')], contextOf(['sla'])), []);
    // The word itself (or its plural) still matches, which is the point of the gate.
    assert.equal(matchedOffers([offer('Verse sla 300 g')], contextOf(['sla'])).length, 1);
    assert.equal(matchedOffers([offer('Slas mix')], contextOf(['sla'])).length, 1);
});

test('knownContext: a word in >2 % of the day is the trade, not a product', () => {
    const offers = [
        offer('Bio Chocolade puur'), // once: 'chocolade' identifies this product
        ...Array.from({ length: 5 }, (_, index) => offer(`Bio Product ${index}`)), // 'bio' is in every shop
        ...Array.from({ length: 54 }, (_, index) => offer(`Filler ${index} Pack`)),
    ];
    assert.equal(offers.length, 60);

    const context = knownContext(['bio', 'chocolade', 'ah'], offers);
    assert.equal(context.generic.has('bio'), true);
    assert.equal(context.generic.has('chocolade'), false);

    // 'bio' alone decides nothing, so the name is dropped rather than matching 6 rows.
    assert.deepEqual(matchedOffers(offers, knownContext(['bio'], offers)), []);
    assert.deepEqual(matchedOffers(offers, knownContext(['ah'], offers)), []); // 'ah' is 2 characters
    assert.equal(matchedOffers(offers, knownContext(['chocolade'], offers)).length, 1);
});

// The catalogue the page/sort/facet tests share: 60 filler rows (so the
// frequency rule has a real day to work on and a single-occurrence token stays
// distinctive) plus three rows this family's names match.
const CATALOGUE: PromoOffer[] = [
    offer('Tilda Pure Basmati', { retailer: 'colruyt', retailer_name: 'Colruyt', brand: 'Tilda', category: 'kruiden', price: 4.5, savings_percentage: 30 }),
    offer('Streeckgenoten Kookworst', { retailer: 'delhaize', retailer_name: 'Delhaize', brand: 'Streeckgenoten', category: 'vlees', price: 2, savings_percentage: 50 }),
    offer('Knorr Maaltijdmix Tikka Masala', { retailer: 'delhaize', retailer_name: 'Delhaize', brand: 'Knorr', category: 'wereldkeuken', price: 3.2, savings_percentage: 20 }),
    ...Array.from({ length: 60 }, (_, index) => offer(`Filler ${index} Pack`, { retailer: 'albert_heijn_be' })),
];

const NAMES = ['ah basmati', 'kookworst', 'tikka masala'];

test('knownPage: the page is sliced over the family\'s matches, with an honest total', () => {
    const first = knownPage(CATALOGUE, NAMES, query({ pageSize: 2 }));
    assert.deepEqual(
        first.offers.map((entry) => entry.name),
        ['Streeckgenoten Kookworst', 'Tilda Pure Basmati'] // savings desc, the default
    );
    assert.equal(first.total, 3); // not the catalogue's 63
    assert.equal(first.pageSize, 2); // what the client asked for

    const second = knownPage(CATALOGUE, NAMES, query({ pageSize: 2, page: 2 }));
    assert.deepEqual(
        second.offers.map((entry) => entry.name),
        ['Knorr Maaltijdmix Tikka Masala']
    );
    assert.equal(second.total, 3);

    // Nothing known: an empty page, not every offer.
    assert.equal(knownPage(CATALOGUE, ['kaviaar'], query()).total, 0);
});

test('knownPage: the four filters the local list can apply', () => {
    const names = (page: PromoPage) => page.offers.map((entry) => entry.name);

    assert.deepEqual(names(knownPage(CATALOGUE, NAMES, query({ retailer: 'delhaize', sort: 'price_asc' }))), [
        'Streeckgenoten Kookworst',
        'Knorr Maaltijdmix Tikka Masala',
    ]);
    assert.deepEqual(names(knownPage(CATALOGUE, NAMES, query({ category: 'vlees' }))), ['Streeckgenoten Kookworst']);
    assert.deepEqual(names(knownPage(CATALOGUE, NAMES, query({ minSavings: 40 }))), ['Streeckgenoten Kookworst']);
    assert.deepEqual(names(knownPage(CATALOGUE, NAMES, query({ q: 'tilda' }))), ['Tilda Pure Basmati']); // the name
    assert.deepEqual(names(knownPage(CATALOGUE, NAMES, query({ q: 'TILDA' }))), ['Tilda Pure Basmati']); // folded
    assert.deepEqual(names(knownPage(CATALOGUE, NAMES, query({ q: 'streeckgenoten' }))), ['Streeckgenoten Kookworst']); // the brand
    assert.equal(knownPage(CATALOGUE, NAMES, query({ q: 'kaviaar' })).total, 0);
});

test('knownPage: the three sort orders', () => {
    const names = (sort: PromoQuery['sort']) =>
        knownPage(CATALOGUE, NAMES, query({ sort })).offers.map((entry) => entry.name);

    assert.deepEqual(names('savings'), ['Streeckgenoten Kookworst', 'Tilda Pure Basmati', 'Knorr Maaltijdmix Tikka Masala']);
    assert.deepEqual(names('price_asc'), ['Streeckgenoten Kookworst', 'Knorr Maaltijdmix Tikka Masala', 'Tilda Pure Basmati']);
    assert.deepEqual(names('price_desc'), ['Tilda Pure Basmati', 'Knorr Maaltijdmix Tikka Masala', 'Streeckgenoten Kookworst']);

    // A row whose discount the chain did not publish never leads a savings sort.
    const withUnknown = [...CATALOGUE, offer('Zanetti Kaviaar extra', { savings_percentage: null, price: 6 })];
    const page = knownPage(withUnknown, [...NAMES, 'kaviaar'], query({ sort: 'savings' }));
    assert.equal(page.total, 4);
    assert.equal(page.offers.at(-1)?.name, 'Zanetti Kaviaar extra');
});

test('promoQueryOf: `only_known=1` is the mode, anything else is not', () => {
    assert.equal(promoQueryOf({ only_known: '1' }).onlyKnown, true);
    assert.equal(promoQueryOf({}).onlyKnown, false);
    assert.equal(promoQueryOf({ only_known: 'true' }).onlyKnown, false);
    assert.equal(promoQueryOf({ only_known: ['1', '1'] }).onlyKnown, false); // repeated, i.e. not the client
});

test('knownFilters: the same facets, counted over the family\'s matches', () => {
    const upstream: PromoFilters = {
        countries: ['be'],
        country: 'be',
        total: 6019,
        retailers: [
            { key: 'delhaize', label: 'Delhaize', count: 1200 },
            { key: 'colruyt', label: 'Colruyt', count: 900 },
            { key: 'onbekend', label: 'Onbekend', count: 4 },
        ],
        categories: [
            { key: 'kruiden', label: 'Kruiden', count: 40 },
            { key: 'vlees', label: 'Vlees & Vis', count: 300 },
            { key: 'wereldkeuken', label: 'Wereldkeuken', count: 12 },
        ],
    };

    const filters = knownFilters(CATALOGUE, NAMES, upstream);
    assert.equal(filters.total, 3); // the family's deals, not the shop's 6019
    assert.equal(filters.country, 'be');
    assert.deepEqual(filters.countries, ['be']);
    assert.deepEqual(filters.retailers, [
        { key: 'delhaize', label: 'Delhaize', count: 2 },
        { key: 'colruyt', label: 'Colruyt', count: 1 },
    ]);
    // The display names stay upstream's (`/categories` is the only source), and a
    // facet nobody matched is gone: the panel never offers an empty store.
    assert.deepEqual(filters.categories, [
        { key: 'kruiden', label: 'Kruiden', count: 1 },
        { key: 'vlees', label: 'Vlees & Vis', count: 1 },
        { key: 'wereldkeuken', label: 'Wereldkeuken', count: 1 },
    ]);
    assert.equal(filters.retailers.some((facet) => facet.key === 'onbekend'), false);
});
