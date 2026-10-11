import assert from 'node:assert/strict';
import test from 'node:test';
import { firstCategory, normalizeProduct } from '../src/custom/lib/openFoodFacts.custom';
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
