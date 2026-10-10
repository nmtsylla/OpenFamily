import assert from 'node:assert/strict';
import test from 'node:test';
import {
    validateReceipt,
    validateReceiptImport,
    validateReceiptLine,
} from '../src/custom/ai/receipt.custom';

// =============================================================================
// Receipt extraction, only the pantry half of it: every line carries the
// brand-free name and the unit the ticket showed, and both survive the round
// trip through the client (validateReceipt → validateReceiptImport). The pantry
// merges on that name (lib/pantry.custom.ts, mapReceiptItems), so a field lost
// here means a second row per brand instead of one row per product.
//
// The budget half of the extraction (amounts, categories, totals) is exercised
// by the API smoke run; these are the bounds the model cannot be trusted with.
// =============================================================================

const CATEGORIES = ['Alimentation', 'Maison', 'Autre'];

test('validateReceipt keeps the pantry name, unit and stock verdict', () => {
    const draft = validateReceipt(
        {
            document_type: 'receipt',
            merchant: 'Supermarché',
            date: '2026-10-10',
            currency: 'EUR',
            total: 2.3,
            category: 'Alimentation',
            items: [
                {
                    label: 'LAIT DEMI-ECREME BIO VILLAGE 1L',
                    quantity: 2,
                    unit_price: 1.15,
                    amount: 2.3,
                    category: 'Alimentation',
                    pantry_item: '  Lait   demi-écrémé ',
                    pantry_unit: 'L',
                    pantry_stock: true,
                },
            ],
        },
        CATEGORIES,
        '2026-10-10',
    );

    assert.deepEqual(draft.items, [{
        label: 'LAIT DEMI-ECREME BIO VILLAGE 1L',
        quantity: 2,
        unit_price: 1.15,
        amount: 2.3,
        category: 'Alimentation',
        pantry_item: 'Lait demi-écrémé',
        pantry_unit: 'L',
        pantry_stock: true,
    }]);
});

test('validateReceipt never invents a pantry name and bounds what it takes', () => {
    const [line] = validateReceipt(
        {
            document_type: 'receipt',
            date: '2026-10-10',
            total: 1,
            items: [{
                label: 'Riz',
                quantity: 1,
                amount: 1,
                category: 'Alimentation',
                // A model that answers something else than a string, and a unit
                // longer than the column: both have to come back usable. Anything
                // but a real `true` must never read as "yes, stock it".
                pantry_item: 42,
                pantry_unit: `${'x'.repeat(200)}`,
                pantry_stock: 'true',
            }],
        },
        CATEGORIES,
        '2026-10-10',
    ).items;

    assert.equal(line.pantry_item, '');
    assert.equal(line.pantry_unit.length, 50);
    assert.equal(line.pantry_stock, false);
});

test('validateReceiptImport passes the reviewed pantry fields through', () => {
    const payload = validateReceiptImport(
        {
            merchant: 'Supermarché',
            date: '2026-10-10',
            currency: 'EUR',
            document_type: 'receipt',
            category: 'Alimentation',
            total: 2.3,
            mode: 'itemized',
            items: [{
                label: 'LAIT 1L',
                quantity: 2,
                unit_price: 1.15,
                amount: 2.3,
                category: 'Alimentation',
                pantry_item: 'Lait',
                pantry_unit: 'L',
                pantry_stock: true,
            }],
            entries: [{ category: 'Alimentation', amount: 2.3, description: 'Supermarché — LAIT 1L' }],
        },
        CATEGORIES,
        'EUR',
    );

    assert.ok(payload);
    assert.equal(payload.items[0].pantry_item, 'Lait');
    assert.equal(payload.items[0].pantry_unit, 'L');
    assert.equal(payload.items[0].pantry_stock, true);
});

test('a line typed by hand carries no pantry name: the label stands in', () => {
    const line = validateReceiptLine({ label: 'Yaourts', quantity: 4, amount: 3.2, category: 'Alimentation' }, CATEGORIES);

    assert.ok(line);
    assert.equal(line.pantry_item, '');
    assert.equal(line.pantry_unit, '');
});
