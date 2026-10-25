import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductCatalog } from '../src/custom/lib/productCatalog.custom';
import type { PurchasedProduct } from '../src/custom/lib/productAnalytics.custom';

// =============================================================================
// The products page's list: the pantry's products and the receipt groups nobody
// declared, in one catalog. The cases that matter are the union (a product with
// no purchase is still a product), the match (a group lands on its pantry row),
// and the order (biggest spend first, names as a tie-break).
// =============================================================================

const group = (over: Partial<PurchasedProduct & { key: string; names: string[] }>) => ({
    key: 'cafe',
    name: 'Café',
    names: ['Café'],
    units: [],
    amount: 0,
    lines: 0,
    ...over,
});

test('a pantry product keeps its row even without a purchase', () => {
    const products = buildProductCatalog(
        [{ id: 'p1', name: 'Rijst - AH Basmati', quantity: 5, unit: 'kg' }],
        [],
    );

    assert.deepEqual(products, [{
        key: 'rijst - ah basmati',
        name: 'Rijst',
        pantryName: 'Rijst - AH Basmati',
        pantryItemId: 'p1',
        names: [],
        units: [],
        amount: 0,
        lines: 0,
        stock: { quantity: 5, unit: 'kg' },
    }]);
});

test('a receipt group lands on the pantry row that declares it', () => {
    const products = buildProductCatalog(
        [{ id: 'p1', name: 'Rijst - AH Basmati', quantity: 5, unit: 'kg' }],
        [group({
            key: 'rijst - ah basmati',
            name: 'Rijst',
            names: ['AH Basmati'],
            units: [{ unit: 'kg', content: 1, unsized: 0, packs: 1 }],
            amount: 2.5,
            lines: 1,
        })],
    );

    assert.equal(products.length, 1);
    assert.deepEqual(products[0], {
        key: 'rijst - ah basmati',
        name: 'Rijst',
        pantryName: 'Rijst - AH Basmati',
        pantryItemId: 'p1',
        names: ['AH Basmati'],
        units: [{ unit: 'kg', content: 1, unsized: 0, packs: 1 }],
        amount: 2.5,
        lines: 1,
        stock: { quantity: 5, unit: 'kg' },
    });
});

test('an undeclared group is a product of its own', () => {
    const products = buildProductCatalog(
        [{ id: 'p1', name: 'Rijst', quantity: 1, unit: null }],
        [group({ key: 'milano fotolijst 50x70cm', name: 'milano fotolijst 50x70cm', names: ['milano fotolijst 50x70cm'], amount: 7.95, lines: 1 })],
    );

    const milano = products.find((product) => product.key === 'milano fotolijst 50x70cm');
    assert.ok(milano);
    assert.equal(milano.pantryItemId, null);
    assert.equal(milano.stock, null);
    assert.equal(milano.amount, 7.95);
});

test('the list is sorted by spend, then by name', () => {
    const products = buildProductCatalog(
        [
            { id: 'p1', name: 'Café', quantity: 0, unit: null },
            { id: 'p2', name: 'Thé', quantity: 0, unit: null },
        ],
        [group({ key: 'riz', name: 'Riz', names: ['Riz'], amount: 9, lines: 1 })],
    );

    assert.deepEqual(products.map((product) => product.name), ['Riz', 'Café', 'Thé']);
});
