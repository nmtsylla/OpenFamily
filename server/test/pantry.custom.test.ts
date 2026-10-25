import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_PANTRY_NAME,
    composeProductName,
    isExpiringSoon,
    isLowStock,
    mapGrocyStock,
    mapReceiptItems,
    pantryAliasKeys,
    pantryHeadKey,
    pantryHeadName,
    pantryKeyResolver,
    pantryNameKey,
    unitsAgree,
    sanitizePantryItem,
    splitReceiptLines,
} from '../src/custom/lib/pantry.custom';
import { isCalendarDate, isUuid } from '../src/custom/lib/validation.custom';

// =============================================================================
// Pantry: the rules that keep the table and the three imports sane.
//
// Nothing here touches the database or Grocy — these are the pure functions the
// route leans on. The interesting cases are the ones real data produces: an
// accent the merge key must fold, a quantity sent as a string by a form, a
// malformed date, and stock lines Grocy answers with a zero amount.
// =============================================================================

test('pantryNameKey folds accents, ligatures and whitespace', () => {
    assert.equal(pantryNameKey('Œufs'), 'oeufs');
    assert.equal(pantryNameKey('  Crème   Fraîche '), 'creme fraiche');
    assert.equal(pantryNameKey('OEufs'), pantryNameKey('œufs'));
    assert.equal(pantryNameKey('a'.repeat(500)).length, MAX_PANTRY_NAME);
});

test('pantryHeadKey stops at the first qualifier', () => {
    assert.equal(pantryHeadKey('Uien - Oignon'), 'uien');
    assert.equal(pantryHeadKey('Pommes de terre (sac 5kg)'), 'pommes de terre');
    assert.equal(pantryHeadKey('Lait, demi-écrémé'), 'lait');
    assert.equal(pantryHeadKey('Coca-Cola'), 'coca');
    // No qualifier: the head IS the key, which is what makes the merge an exact
    // match rather than a guess.
    assert.equal(pantryHeadKey('Tomates'), 'tomates');
    assert.equal(pantryHeadKey('  '), '');
});

test('pantryAliasKeys reads every name a row declares', () => {
    assert.deepEqual(pantryAliasKeys('Uien - Oignon'), ['uien', 'oignon']);
    assert.deepEqual(pantryAliasKeys('  MELK / Lait  '), ['melk', 'lait']);
    assert.deepEqual(pantryAliasKeys('Tomates'), ['tomates']);
    // A multi-word name is one name, not two: 'Pommes de terre' is not 'Pommes'.
    assert.deepEqual(pantryAliasKeys('Pommes de terre (sac)'), ['pommes de terre', 'sac']);
    assert.deepEqual(pantryAliasKeys('   '), []);
});

// The duplication the family reported: the same product under two spellings (a
// Dutch ticket's 'Uien', a French one's 'Oignon') against the pantry's own
// 'Uien - Oignon' row.
test('pantryKeyResolver folds every language the household wrote on its row', () => {
    const resolve = pantryKeyResolver([pantryNameKey('Tomates'), pantryNameKey('Uien - Oignon')]);

    assert.equal(resolve('Uien'), pantryNameKey('Uien - Oignon'));
    assert.equal(resolve('uien'), pantryNameKey('Uien - Oignon'));
    // One of the two names the row declares, whichever language the ticket uses.
    assert.equal(resolve('Oignon'), pantryNameKey('Uien - Oignon'));
    // Whole aliases only: 'Oignons' and 'Onions' are the model's job, not a
    // string rule — stripping an 's' would read 'Riz' as 'Ri'.
    assert.equal(resolve('Oignons'), pantryNameKey('Oignons'));
    assert.equal(resolve('Onions'), pantryNameKey('Onions'));
    assert.equal(resolve('Tomates'), pantryNameKey('Tomates'));
    assert.equal(resolve('Tomaten'), pantryNameKey('Tomaten'));
});

test('pantryKeyResolver only obeys a name a stored row declares', () => {
    const resolve = pantryKeyResolver([pantryNameKey('Uien - Oignon')]);

    // A single-language pantry row is not a translation service: 'Oignon' is a
    // different key, and only the model can tell it is the same product.
    assert.equal(pantryKeyResolver([pantryNameKey('Oignon')])('Uien'), pantryNameKey('Uien'));
    // A bare name on its own row declares nothing either: it is stored as typed.
    assert.equal(pantryKeyResolver([pantryNameKey('Tomates')])('Tomates cerises'), pantryNameKey('Tomates cerises'));
    // …and an incoming qualified name never reaches into a declared row.
    assert.equal(resolve('Lait - demi-écrémé'), pantryNameKey('Lait - demi-écrémé'));
    assert.equal(resolve('Riz basmati'), pantryNameKey('Riz basmati'));
});

// Two lines of ONE import are not evidence that they are one product: the merge
// only ever obeys what a stored row says, so the ticket's own spelling decides.
test('pantryKeyResolver keeps two names of the same import apart', () => {
    const resolve = pantryKeyResolver([]);

    assert.equal(resolve('Uien - Oignon'), pantryNameKey('Uien - Oignon'));
    assert.equal(resolve('Uien'), pantryNameKey('Uien'));
    assert.equal(resolve('Tomates - cerises'), pantryNameKey('Tomates - cerises'));
    // The same name twice does add up, which is the ordinary case (two yoghurts
    // counted on one ticket).
    assert.equal(resolve('Tomates'), pantryNameKey('Tomates'));
    assert.equal(resolve('Tomates'), pantryNameKey('Tomates'));
});

test('pantryKeyResolver never folds two rows the family kept apart', () => {
    const resolve = pantryKeyResolver([pantryNameKey('Poisson'), pantryNameKey('Boisson')]);

    assert.equal(resolve('Poisson'), pantryNameKey('Poisson'));
    assert.equal(resolve('Boisson'), pantryNameKey('Boisson'));
    // One letter apart is not the same product, and empty names never match.
    assert.equal(resolve('Poison'), pantryNameKey('Poison'));
    assert.equal(resolve('   '), '');
    // A word of a multi-word product is not a name for it.
    assert.equal(pantryKeyResolver([pantryNameKey('Pommes de terre (sac)')])('Pommes'), pantryNameKey('Pommes'));
});

test('sanitizePantryItem refuses a body without a usable name or quantity', () => {
    assert.equal(sanitizePantryItem({ name: '   ' }), null);
    assert.equal(sanitizePantryItem({ name: '' }), null);
    assert.equal(sanitizePantryItem({}), null);
    assert.equal(sanitizePantryItem(null), null);
    assert.equal(sanitizePantryItem({ name: 'Lait', quantity: -1 }), null);
    assert.equal(sanitizePantryItem({ name: 'Lait', quantity: 'abc' }), null);
});

test('sanitizePantryItem defaults and coerces the optional fields', () => {
    assert.deepEqual(sanitizePantryItem({ name: '  Lait  ' }), {
        name: 'Lait',
        category: 'Autre',
        quantity: 1,
        unit: null,
        location: 'pantry',
        expires_on: null,
        low_stock_threshold: null,
        lunchbox_bucket: null,
        notes: null,
    });

    assert.deepEqual(
        sanitizePantryItem({
            name: 'Lait',
            quantity: '2',
            unit: ' L ',
            location: 'bedroom',
            expires_on: '2026-13-45',
            low_stock_threshold: -2,
            lunchbox_bucket: 'brunch',
            notes: '   ',
        }),
        {
            name: 'Lait',
            category: 'Autre',
            quantity: 2,
            unit: 'L',
            location: 'pantry',
            expires_on: null,
            low_stock_threshold: null,
            lunchbox_bucket: null,
            notes: null,
        },
    );

    assert.deepEqual(
        sanitizePantryItem({
            name: 'Lait',
            category: 'Boissons',
            quantity: 0,
            location: 'fridge',
            expires_on: '2026-03-01',
            low_stock_threshold: 1,
            lunchbox_bucket: 'drink',
            notes: 'Ouvert',
        }),
        {
            name: 'Lait',
            category: 'Boissons',
            quantity: 0,
            unit: null,
            location: 'fridge',
            expires_on: '2026-03-01',
            low_stock_threshold: 1,
            lunchbox_bucket: 'drink',
            notes: 'Ouvert',
        },
    );
});

test('isLowStock is true at and under the threshold, false without one', () => {
    assert.equal(isLowStock({ quantity: 1, low_stock_threshold: 2 }), true);
    assert.equal(isLowStock({ quantity: 2, low_stock_threshold: 2 }), true);
    assert.equal(isLowStock({ quantity: 3, low_stock_threshold: 2 }), false);
    assert.equal(isLowStock({ quantity: 0, low_stock_threshold: null }), false);
    // pg returns DECIMAL as a string.
    assert.equal(isLowStock({ quantity: '1.500', low_stock_threshold: '2' }), true);
});

test('isExpiringSoon includes both ends and ignores past and missing dates', () => {
    const today = new Date('2026-06-10T09:00:00Z');
    assert.equal(isExpiringSoon('2026-06-10', today, 14), true);
    assert.equal(isExpiringSoon('2026-06-24', today, 14), true);
    assert.equal(isExpiringSoon('2026-06-25', today, 14), false);
    assert.equal(isExpiringSoon('2026-06-09', today, 14), false);
    assert.equal(isExpiringSoon(null, today, 14), false);
    assert.equal(isExpiringSoon('10/06/2026', today, 14), false);
    // Shape-valid but not a calendar day: PostgreSQL rejects it (22008).
    assert.equal(isExpiringSoon('2026-13-45', today, 14), false);
    assert.equal(isExpiringSoon('2026-02-30', today, 14), false);
});

test('mapGrocyStock keeps named, positive lines and drops the rest', () => {
    assert.deepEqual(
        mapGrocyStock([
            { product: { name: 'Riz' }, amount: '2.5', next_best_before_date: '2027-01-01 00:00:00' },
            { product: { name: 'Pâtes' }, amount: 0 },
            { product: { name: '  ' }, amount: 3 },
            { product: {}, amount: 1 },
            { amount: 1 },
            null,
            { product: { name: 'Thé' }, amount: 1 },
        ]),
        [
            { name: 'Riz', quantity: 2.5, expires_on: '2027-01-01' },
            { name: 'Thé', quantity: 1, expires_on: null },
        ],
    );
    assert.deepEqual(mapGrocyStock({ not: 'an array' }), []);
    // A shape-valid but impossible date is dropped, never handed to the DATE column.
    assert.deepEqual(
        mapGrocyStock([{ product: { name: 'Riz' }, amount: 1, next_best_before_date: '2026-13-45 00:00:00' }]),
        [{ name: 'Riz', quantity: 1, expires_on: null }],
    );
});

test('mapReceiptItems defaults the quantity and drops unlabelled lines', () => {
    assert.deepEqual(
        mapReceiptItems([
            { label: '  Lait  ', quantity: '2', category: 'Alimentation' },
            { label: 'Pain', quantity: '0', category: 'Alimentation' },
            { label: '   ', quantity: 1, category: 'Alimentation' },
            { label: 'Savon', quantity: null, category: '' },
        ]),
        [
            { name: 'Lait', quantity: 2, category: 'Alimentation', unit: null },
            { name: 'Pain', quantity: 1, category: 'Alimentation', unit: null },
            { name: 'Savon', quantity: 1, category: 'Autre', unit: null },
        ],
    );
});

// The AI reads the brand off the ticket; the pantry must store what it proposes,
// or every supermarket creates a second row for the same product.
test('mapReceiptItems prefers the model pantry name and the amount the label prints', () => {
    assert.deepEqual(
        mapReceiptItems([
            { label: 'LAIT DEMI-ECREME BIO VILLAGE 1L', quantity: 2, category: 'Alimentation', pantry_item: 'Lait demi-écrémé', pantry_unit: 'L' },
            // A line the model left empty (or one typed by hand) keeps its label.
            { label: 'Pain complet', quantity: 1, category: 'Alimentation', pantry_item: '', pantry_unit: '' },
            { label: 'Lessive', quantity: 1, category: 'Maison' },
            // Spaces only: not a name, so the label is used.
            { label: 'Riz basmati', quantity: 1, category: 'Alimentation', pantry_item: '   ', pantry_unit: '  ' },
        ]),
        [
            // Two 1 L bricks: the amount is 2 l, in the canonical unit.
            { name: 'Lait demi-écrémé', quantity: 2, category: 'Alimentation', unit: 'l' },
            { name: 'Pain complet', quantity: 1, category: 'Alimentation', unit: null },
            { name: 'Lessive', quantity: 1, category: 'Maison', unit: null },
            { name: 'Riz basmati', quantity: 1, category: 'Alimentation', unit: null },
        ],
    );
});

// The split decides what enters the pantry unasked: only a line the model both
// called stock AND named. Everything else waits on the pantry page.
test('splitReceiptLines stocks the obvious lines and queues the rest', () => {
    const { stock, pending } = splitReceiptLines([
        {
            label: 'LAIT DEMI-ECREME BIO VILLAGE 1L', quantity: 2, category: 'Alimentation',
            pantry_item: 'Lait demi-écrémé', pantry_unit: 'L', pantry_stock: true,
        },
        // Named but not called stock: the family decides.
        {
            label: 'DOLIPRANE 1000MG', quantity: 1, category: 'Santé',
            pantry_item: 'Paracétamol', pantry_unit: '', pantry_stock: false,
        },
        // Stock but no generic name: nothing to store, so it waits for a name.
        { label: 'TRUC BIZARRE', quantity: 1, category: 'Autre', pantry_item: '', pantry_stock: true },
        // A line typed by hand: no verdict at all.
        { label: 'Yaourts', quantity: 4, category: 'Alimentation' },
        // No label and no name: not a line anyone can act on.
        { label: '   ', quantity: 1, category: 'Autre', pantry_item: '', pantry_stock: true },
    ]);

    assert.deepEqual(stock, [
        // The label prints 1L and the line is 2 packs: 2 l of milk, in the
        // canonical unit — not 2 under the printed 'L'.
        { name: 'Lait demi-écrémé', quantity: 2, category: 'Alimentation', unit: 'l' },
    ]);
    assert.deepEqual(pending, [
        { label: 'DOLIPRANE 1000MG', item: 'Paracétamol', quantity: 1, category: 'Santé', unit: null, needs_amount: false },
        { label: 'TRUC BIZARRE', item: '', quantity: 1, category: 'Autre', unit: null, needs_amount: false },
        { label: 'Yaourts', item: '', quantity: 4, category: 'Alimentation', unit: null, needs_amount: false },
    ]);
});

test('splitReceiptLines stocks the content, not the pack count', () => {
    const { stock, pending } = splitReceiptLines([
        {
            label: 'RIJST BASMATI 5KG', quantity: 1, category: 'Alimentation',
            pantry_item: 'Riz basmati', pantry_unit: 'kg', pantry_content: 5, pantry_stock: true,
        },
        {
            // The model left the content at 0: the label prints 500g.
            label: 'BROCCOLI 500g', quantity: 1, category: 'Alimentation',
            pantry_item: 'Broccoli', pantry_unit: '', pantry_content: 0, pantry_stock: true,
        },
    ]);

    assert.deepEqual(stock, [
        { name: 'Riz basmati', quantity: 5, category: 'Alimentation', unit: 'kg' },
        { name: 'Broccoli', quantity: 0.5, category: 'Alimentation', unit: 'kg' },
    ]);
    assert.deepEqual(pending, []);
});

test('a stockable line with no known amount is queued and asks for one', () => {
    const { stock, pending } = splitReceiptLines([
        {
            label: 'FROMAGE BLANC', quantity: 2, category: 'Alimentation',
            pantry_item: 'Fromage blanc', pantry_unit: '', pantry_content: 0, pantry_stock: true,
        },
        {
            // Not stock, so no amount is needed: the family will not stock it.
            label: 'SAC PLASTIQUE', quantity: 1, category: 'Maison',
            pantry_item: 'Sac', pantry_unit: '', pantry_stock: false,
        },
    ]);

    assert.deepEqual(stock, []);
    assert.deepEqual(pending, [
        // The pack count is kept as a starting point; the family types the amount.
        { label: 'FROMAGE BLANC', item: 'Fromage blanc', quantity: 2, category: 'Alimentation', unit: null, needs_amount: true },
        { label: 'SAC PLASTIQUE', item: 'Sac', quantity: 1, category: 'Maison', unit: null, needs_amount: false },
    ]);
});

test('isUuid accepts a UUID and rejects what would reach the column', () => {
    assert.equal(isUuid('2e670764-4383-4972-8ad4-d430d85d12e2'), true);
    assert.equal(isUuid('2E670764-4383-4972-8AD4-D430D85D12E2'), true);
    // A non-UUID id used to raise pg 22P02 and answer 500 instead of 404.
    assert.equal(isUuid('not-a-uuid'), false);
    assert.equal(isUuid('2e670764-4383-4972-8ad4-d430d85d12e'), false);
    assert.equal(isUuid(''), false);
    assert.equal(isUuid(undefined), false);
    assert.equal(isUuid(42), false);
});

test('isCalendarDate: a real day, not just four-two-two digits', () => {
    // 22008 on the DATE column used to surface as a 500 for every route that
    // validated its dates by shape alone (the pantry, the lunchbox, the outings).
    assert.equal(isCalendarDate('2026-03-01'), true);
    assert.equal(isCalendarDate('2024-02-29'), true);
    assert.equal(isCalendarDate('2026-02-30'), false);
    assert.equal(isCalendarDate('2026-13-01'), false);
    assert.equal(isCalendarDate('2026-03-32'), false);
    assert.equal(isCalendarDate('2026-3-1'), false);
    assert.equal(isCalendarDate('01/03/2026'), false);
    assert.equal(isCalendarDate(''), false);
    assert.equal(isCalendarDate(null), false);
    assert.equal(isCalendarDate(20260301), false);
});


// The name a grouped product shows under in the stats: the head, in the family's
// own casing.
test('pantryHeadName keeps the name before the first qualifier', () => {
    assert.equal(pantryHeadName('Rijst - AH Basmati - Basmati rijst'), 'Rijst');
    assert.equal(pantryHeadName('Lait entier - Melk - Milk'), 'Lait entier');
    assert.equal(pantryHeadName('Pommes de terre (sac)'), 'Pommes de terre');
    assert.equal(pantryHeadName('Broccoli'), 'Broccoli');
    assert.equal(pantryHeadName('  '), '');
});


// A merge writes one name carrying every name the product answers to, which is
// what makes the receipt labels resolve to the one product.
test('composeProductName folds one head and its aliases into one name', () => {
    assert.equal(
        composeProductName('Rijst', ['AH Basmati', 'Basmati rijst']),
        'Rijst - AH Basmati - Basmati rijst',
    );
    // Case and spacing do not make a name twice; accents are one product too.
    assert.equal(composeProductName('Riz', ['riz', 'RIZ ', 'Ris']), 'Riz - Ris');
    assert.equal(composeProductName('Rijst', []), 'Rijst');
    assert.equal(composeProductName('  ', ['  ']), '');
    assert.equal(composeProductName('Rijst', ['x'.repeat(200)]).length, MAX_PANTRY_NAME);
});

// Stock is only added up when the units can be.
test('unitsAgree answers for the units the merge adds up', () => {
    assert.equal(unitsAgree(null, 'kg'), true);
    assert.equal(unitsAgree('kg', null), true);
    assert.equal(unitsAgree('L', 'l'), true);
    assert.equal(unitsAgree(' kg ', 'kg'), true);
    assert.equal(unitsAgree('', 'kg'), true);
    assert.equal(unitsAgree('kg', 'pièce'), false);
    assert.equal(unitsAgree('paquet', 'pièce'), false);
});
