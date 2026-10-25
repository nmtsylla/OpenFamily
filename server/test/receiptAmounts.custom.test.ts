import assert from 'node:assert/strict';
import test from 'node:test';
import {
    cleanUnit,
    groupMissingAmounts,
    MAX_PACK_CONTENT,
    parsePerPack,
    planAmountFill,
    type AmountlessLine,
} from '../src/custom/lib/receiptAmounts.custom';

// =============================================================================
// The labels no data can size, and the answer the family gives for them.
//
// The grouping rule matters as much as the arithmetic: a line the label
// inference can read must never be asked about, and two spellings of one product
// must be one question.
// =============================================================================

const line = (over: Partial<AmountlessLine>): AmountlessLine => ({
    id: 'id-1',
    label: 'AH Basmati',
    quantity: 1,
    amount: 1.79,
    date: '2026-10-08',
    ...over,
});

test('spellings of one label are one question', () => {
    const { groups } = groupMissingAmounts([
        line({ id: 'a', label: 'AH Basmati', quantity: 2, amount: 3.58, date: '2026-10-08' }),
        line({ id: 'b', label: 'ah basmati', quantity: 1, amount: 1.79, date: '2026-10-12' }),
        line({ id: 'c', label: 'AH  Basmati ', quantity: 1, amount: 1.79, date: '2026-10-01' }),
    ]);

    assert.deepEqual(groups, [{
        key: 'ah basmati',
        label: 'AH Basmati',
        lines: 3,
        packs: 4,
        amount: 7.16,
        last: '2026-10-12',
    }]);
});

test('a line the label can size is never asked about', () => {
    const { groups } = groupMissingAmounts([
        line({ label: 'RIJST BASMATI 5KG' }),
        line({ label: 'CONFERENCE LOS', quantity: 1.51 }),
        line({ label: 'AH Basmati' }),
    ]);

    assert.deepEqual(groups.map((group) => group.label), ['AH Basmati']);
});

test('groups are sorted by spend and capped, the rest counted', () => {
    const { groups, hidden } = groupMissingAmounts(
        [
            line({ id: 'a', label: 'Small', amount: 1 }),
            line({ id: 'b', label: 'Big', amount: 9 }),
            line({ id: 'c', label: 'Middle', amount: 5 }),
        ],
        2,
    );

    assert.deepEqual(groups.map((group) => group.label), ['Big', 'Middle']);
    assert.equal(hidden, 1);
});

test('an unlabelled line is skipped', () => {
    const { groups } = groupMissingAmounts([line({ label: '   ' })]);
    assert.deepEqual(groups, []);
});

test('one answer fills every line that prints the label', () => {
    // Two packs and one pack: 0.5 kg per pack is 1 kg and 0.5 kg.
    const fills = planAmountFill(
        [
            line({ id: 'a', label: 'AH Basmati', quantity: 2 }),
            line({ id: 'b', label: 'ah basmati', quantity: 1 }),
            line({ id: 'c', label: 'Everyday Fusilli 500g', quantity: 3 }),
        ],
        'AH Basmati',
        0.5,
        ' kg ',
    );

    assert.deepEqual(fills, [
        { id: 'a', content: 1, unit: 'kg' },
        { id: 'b', content: 0.5, unit: 'kg' },
    ]);
});

test('a line without a pack count takes one pack', () => {
    const fills = planAmountFill([line({ quantity: 0 })], 'ah basmati', 1.5, 'l');
    assert.deepEqual(fills, [{ id: 'id-1', content: 1.5, unit: 'l' }]);
});

test('a fill with no unit or no matching line writes nothing', () => {
    assert.deepEqual(planAmountFill([line({})], 'ah basmati', 1, '  '), []);
    assert.deepEqual(planAmountFill([line({})], 'autre produit', 1, 'kg'), []);
    assert.deepEqual(planAmountFill([line({})], '', 1, 'kg'), []);
});

test('the pack size is read with a comma and bounded', () => {
    assert.equal(parsePerPack('1,5'), 1.5);
    assert.equal(parsePerPack('1.5'), 1.5);
    assert.equal(parsePerPack(2), 2);
    assert.equal(parsePerPack('0'), null);
    assert.equal(parsePerPack('-2'), null);
    assert.equal(parsePerPack('beaucoup'), null);
    assert.equal(parsePerPack(String(MAX_PACK_CONTENT + 1)), null);
});

test('the unit is trimmed, collapsed and capped', () => {
    assert.equal(cleanUnit('  kg  '), 'kg');
    assert.equal(cleanUnit('k  g'), 'k g');
    assert.equal(cleanUnit(''), null);
    assert.equal(cleanUnit('   '), null);
    assert.equal(cleanUnit(42), null);
    assert.equal(cleanUnit('x'.repeat(80))?.length, 50);
});
