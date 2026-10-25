import assert from 'node:assert/strict';
import test from 'node:test';
import { inferLineAmount, parsePrintedSize } from '../src/custom/lib/quantityInference.custom';

// =============================================================================
// Reading a line's amount off its own text.
//
// The expectations below are the owner's real ticket labels (102 distinct ones
// were measured): these are the shapes Belgian and Dutch supermarkets print. A
// wrong parse here becomes a wrong pantry quantity, so every case is literal.
//
// The labels that must NOT parse matter as much as the ones that do: a picture
// frame ('50x70cm'), a washing liquid ('40WL'), a tax rate ('6%') and a model
// number ('cr2032') are not groceries.
// =============================================================================

test('parsePrintedSize reads the formats a ticket prints', () => {
    assert.deepEqual(parsePrintedSize('CLEMENTINES 1KG'), { content: 1, unit: 'kg' });
    // A multi-pack is the product times the count, not one pack.
    assert.deepEqual(parsePrintedSize('Coca 6x33cl'), { content: 1.98, unit: 'l' });
    assert.deepEqual(parsePrintedSize('Boni sucre vanilliné 15x8g'), { content: 0.12, unit: 'kg' });
    assert.deepEqual(parsePrintedSize('LUIERBROEKJES XL 36ST'), { content: 36, unit: 'pièce' });
    assert.deepEqual(parsePrintedSize('2 x 1,5L'), { content: 3, unit: 'l' });
});

test('parsePrintedSize answers null for a size that is not a grocery', () => {
    assert.equal(parsePrintedSize('milano fotolijst 50x70cm'), null);
    assert.equal(parsePrintedSize('Wasmiddel VLB 40WL'), null);
    assert.equal(parsePrintedSize('Artikel met 6% btw'), null);
    assert.equal(parsePrintedSize('vershoudzakjes 25x11+25x31'), null);
    assert.equal(parsePrintedSize('bts paradise planner 21x21cm'), null);
    assert.equal(parsePrintedSize('cr2032'), null);
    assert.equal(parsePrintedSize('301'), null);
    // No size at all: the model (or the family) has to say.
    assert.equal(parsePrintedSize('CONFERENCE LOS'), null);
});

test('parsePrintedSize refuses two different sizes', () => {
    assert.equal(parsePrintedSize('Riz 500g + 1kg'), null);
    // The same size twice is one answer, not an ambiguity.
    assert.deepEqual(parsePrintedSize('Riz 500g (500g)'), { content: 0.5, unit: 'kg' });
});

test('inferLineAmount multiplies the pack size by the packs bought', () => {
    assert.deepEqual(inferLineAmount({ label: 'Everyday thon au naturel MSC 155g', quantity: 6 }), {
        content: 0.93, unit: 'kg', source: 'label',
    });
    assert.deepEqual(inferLineAmount({ label: 'Witte baguetten 300g', quantity: 8 }), {
        content: 2.4, unit: 'kg', source: 'label',
    });
    assert.deepEqual(inferLineAmount({ label: 'Boni sucre vanilliné 15x8g', quantity: 3 }), {
        content: 0.36, unit: 'kg', source: 'label',
    });
});

test('inferLineAmount reads a size the unit itself carries', () => {
    assert.deepEqual(inferLineAmount({ label: 'Rijst', quantity: 2, unit: '350g' }), {
        content: 0.7, unit: 'kg', source: 'unit_size',
    });
    assert.deepEqual(inferLineAmount({ label: 'Coca', quantity: 2, unit: '1,5L' }), {
        content: 3, unit: 'l', source: 'unit_size',
    });
});

test('inferLineAmount reads a weighed line as kilograms', () => {
    assert.deepEqual(inferLineAmount({ label: 'CONFERENCE LOS', quantity: 1.51 }), {
        content: 1.51, unit: 'kg', source: 'weighed',
    });
});

test('inferLineAmount answers null when the line says nothing usable', () => {
    assert.equal(inferLineAmount({ label: 'Lait', quantity: 2 }), null);
    assert.equal(inferLineAmount({ label: 'milano fotolijst 50x70cm', quantity: 1 }), null);
    // The pack count of a nonsense quantity is 1, not a crash and not 0.
    assert.deepEqual(inferLineAmount({ label: 'Riz 500g', quantity: Number.NaN }), {
        content: 0.5, unit: 'kg', source: 'label',
    });
    assert.deepEqual(inferLineAmount({ label: 'Riz 500g', quantity: Number.POSITIVE_INFINITY }), {
        content: 0.5, unit: 'kg', source: 'label',
    });
    // A quantity of 0 or below is not a count: one pack, not a negative content.
    assert.deepEqual(inferLineAmount({ label: 'Riz 500g', quantity: -3 }), {
        content: 0.5, unit: 'kg', source: 'label',
    });
    assert.equal(inferLineAmount({ label: '', quantity: 1 }), null);
});
