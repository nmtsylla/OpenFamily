import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildProductPurchases,
    MAX_PRODUCTS,
    type PurchaseLine,
} from '../src/custom/lib/productAnalytics.custom';

// =============================================================================
// What the family bought over a period: one row per product, quantities added
// only inside one unit bucket, and a deterministic display name so the list does
// not jump between two loads of the same data.
// =============================================================================

const line = (over: Partial<PurchaseLine>): PurchaseLine => ({
    label: 'Article',
    product: null,
    unit: null,
    quantity: 1,
    content: 0,
    amount: 1,
    ...over,
});

test('two spellings of one product merge into one row', () => {
    const result = buildProductPurchases([
        line({ label: 'LAIT DEMI-ECREME 1L', product: 'Lait demi-écrémé', unit: 'L', quantity: 1, amount: 1.15 }),
        line({ label: 'Lait demi-écrémé', product: 'Lait demi-écrémé', unit: 'L', quantity: 2, amount: 2.3 }),
    ]);

    assert.equal(result.byProduct.length, 1);
    assert.deepEqual(result.byProduct[0], {
        name: 'Lait demi-écrémé',
        amount: 3.45,
        lines: 2,
        units: [{ unit: 'L', content: 0, unsized: 2, packs: 3 }],
    });
    assert.deepEqual(result.totals, { amount: 3.45, lines: 2, products: 1, hidden: 0 });
});

test('a kilo and a piece never add up: one product, two unit buckets', () => {
    const result = buildProductPurchases([
        line({ label: 'Riz basmati 5 kg', product: 'Riz', unit: 'kg', quantity: 5, amount: 10 }),
        line({ label: 'Riz sachet', product: 'Riz', unit: 'pièce', quantity: 3, amount: 6 }),
    ]);

    assert.equal(result.byProduct.length, 1);
    assert.deepEqual(result.byProduct[0].units, [
        { unit: 'kg', content: 0, unsized: 1, packs: 5 },
        { unit: 'pièce', content: 0, unsized: 1, packs: 3 },
    ]);
    assert.equal(result.byProduct[0].lines, 2);
    assert.equal(result.byProduct[0].amount, 16);
});

test('a line with no product groups by its printed label', () => {
    const result = buildProductPurchases([
        line({ label: 'Pommes', unit: 'kg', quantity: 1.5, amount: 3.6 }),
        line({ label: 'Pommes', unit: 'kg', quantity: 0.5, amount: 1.2 }),
    ]);

    assert.deepEqual(result.byProduct, [
        { name: 'Pommes', amount: 4.8, lines: 2, units: [{ unit: 'kg', content: 0, unsized: 2, packs: 2 }] },
    ]);
});

test('a line with no printed unit keeps a null bucket, sorted last', () => {
    const result = buildProductPurchases([
        line({ label: 'Café moulu', product: 'Café', unit: null, quantity: 2, amount: 8 }),
        line({ label: 'Café 500 g', product: 'Café', unit: 'kg', quantity: 0.5, amount: 9 }),
    ]);

    // A bigger pack count still comes after a printed unit.
    assert.deepEqual(result.byProduct[0].units, [
        { unit: 'kg', content: 0, unsized: 1, packs: 0.5 },
        { unit: null, content: 0, unsized: 0, packs: 2 },
    ]);
});

test('the display name is the most frequent spelling, ties deterministic', () => {
    const frequent = buildProductPurchases([
        line({ label: 'a', product: 'Yaourt nature', amount: 1 }),
        line({ label: 'b', product: 'Yaourt nature', amount: 1 }),
        line({ label: 'c', product: 'YAOURT NATURE', amount: 1 }),
    ]);
    assert.equal(frequent.byProduct[0].name, 'Yaourt nature');

    // Same count, same length: alphabetical order decides.
    const tie = buildProductPurchases([
        line({ label: 'a', product: 'Yaourt nature', amount: 1 }),
        line({ label: 'b', product: 'yaourt nature', amount: 1 }),
    ]);
    assert.equal(tie.byProduct[0].name, 'Yaourt nature');

    // Same count: the shorter text wins.
    const shorter = buildProductPurchases([
        line({ label: 'a', product: 'YAOURT NATURE ', amount: 1 }),
        line({ label: 'b', product: 'YAOURT NATURE', amount: 1 }),
    ]);
    assert.equal(shorter.byProduct[0].name, 'YAOURT NATURE');
});

test('the list is capped, sorted by amount, and the totals still cover the rest', () => {
    const result = buildProductPurchases(
        [
            line({ label: 'A', product: 'A', quantity: 1, amount: 1 }),
            line({ label: 'B', product: 'B', quantity: 1, amount: 5 }),
            line({ label: 'C', product: 'C', quantity: 1, amount: 3 }),
        ],
        2,
    );

    assert.deepEqual(result.byProduct.map((product) => product.name), ['B', 'C']);
    assert.deepEqual(result.totals, { amount: 9, lines: 3, products: 3, hidden: 1 });
});

test('a line with no product and no label is skipped, totals stay zero', () => {
    const result = buildProductPurchases([
        line({ label: '', product: null, unit: null, quantity: 4, amount: 9 }),
    ]);

    assert.deepEqual(result.byProduct, []);
    assert.deepEqual(result.totals, { amount: 0, lines: 0, products: 0, hidden: 0 });
});

test('a non-finite quantity or amount counts as zero and never throws', () => {
    let result: ReturnType<typeof buildProductPurchases> | undefined;
    assert.doesNotThrow(() => {
        result = buildProductPurchases([
            line({ label: 'Beurre', product: 'Beurre', unit: 'pièce', quantity: Number.NaN, amount: Number.POSITIVE_INFINITY }),
        ]);
    });

    assert.deepEqual(result!.byProduct, [
        { name: 'Beurre', amount: 0, lines: 1, units: [{ unit: 'pièce', content: 0, unsized: 1, packs: 0 }] },
    ]);
    assert.deepEqual(result!.totals, { amount: 0, lines: 1, products: 1, hidden: 0 });
    assert.equal(MAX_PRODUCTS, 20);
});

// =============================================================================
// Content beside packs. The model sets `quantity` to the number of items, so a
// 5 kg bag of rice arrives as quantity 1 with unit 'kg': the bucket has to add
// the content the ticket printed, or the page tells the family it bought 1 kg.
// =============================================================================

test('content adds up inside one unit, packs count every line', () => {
    const result = buildProductPurchases([
        line({ label: 'RIJST BASMATI 5KG', product: 'Riz', unit: 'kg', quantity: 1, content: 5, amount: 10 }),
        line({ label: 'RIJST BASMATI 2KG', product: 'Riz', unit: 'kg', quantity: 2, content: 2, amount: 8 }),
    ]);

    assert.deepEqual(result.byProduct[0].units, [{ unit: 'kg', content: 7, unsized: 0, packs: 3 }]);
});

test('a line with no content keeps its packs and adds no content', () => {
    const result = buildProductPurchases([
        line({ label: 'Riz', product: 'Riz', unit: 'kg', quantity: 3, content: 0, amount: 6 }),
    ]);

    assert.deepEqual(result.byProduct[0].units, [{ unit: 'kg', content: 0, unsized: 1, packs: 3 }]);
});

test('a content without a unit is not an amount of anything', () => {
    const result = buildProductPurchases([
        line({ label: 'Café moulu', product: 'Café', unit: null, quantity: 1, content: 5, amount: 8 }),
    ]);

    assert.deepEqual(result.byProduct[0].units, [{ unit: null, content: 0, unsized: 0, packs: 1 }]);
});

test('a bucket with a content sorts before one with a bigger pack count', () => {
    const result = buildProductPurchases([
        line({ label: 'Riz sachet', product: 'Riz', unit: 'pièce', quantity: 4, content: 0, amount: 8 }),
        line({ label: 'Riz 5 kg', product: 'Riz', unit: 'kg', quantity: 1, content: 5, amount: 10 }),
    ]);

    assert.deepEqual(result.byProduct[0].units.map((bucket) => bucket.unit), ['kg', 'pièce']);
});

test('an unsized line in the bucket makes the content a floor, not a total', () => {
    const result = buildProductPurchases([
        line({ label: 'RIJST BASMATI 5KG', product: 'Riz', unit: 'kg', quantity: 1, content: 5, amount: 10 }),
        line({ label: 'Rijst los', product: 'Riz', unit: 'kg', quantity: 1, content: 0, amount: 2 }),
    ]);

    // The page shows "≥ 5 kg": one line said how much it held, the other did not.
    assert.deepEqual(result.byProduct[0].units, [{ unit: 'kg', content: 5, unsized: 1, packs: 2 }]);
});
