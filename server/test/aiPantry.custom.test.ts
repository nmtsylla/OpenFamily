import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildMealsPrompt,
    buildParsePrompt,
    validateParsedItems,
    type RecipeRef,
} from '../src/services/ai/assistant';

// =============================================================================
// The pantry side of the two AI surfaces.
//
// Both prompts take the household's stock as `null` (the fork's pantry is
// switched off) or as an array (switched on, possibly empty). The three states
// have to stay distinguishable: an empty pantry is what "j'ai acheté du riz" has
// to land in, while a switched-off pantry must leave the prompt exactly as
// upstream built it — including the recipes, whose ingredient lines are only
// worth sending when something can be matched against them.
// =============================================================================

const CATEGORIES = ['Alimentation', 'Bebe', 'Menage', 'Sante', 'Autre'];

const parse = (item: Record<string, unknown>) =>
    validateParsedItems({ items: [item] }, [], CATEGORIES, ['Autre']);

const pantryItem = (over: Record<string, unknown> = {}) => ({
    type: 'pantry_item',
    title: 'Riz',
    quantity: 2,
    unit: 'kg',
    category: 'Alimentation',
    location: 'pantry',
    ...over,
});

test('a pantry_item proposal keeps its quantity, unit and location', () => {
    assert.deepEqual(parse(pantryItem()), [
        { type: 'pantry_item', name: 'Riz', quantity: 2, unit: 'kg', category: 'Alimentation', location: 'pantry' },
    ]);
});

test('quantity 0 survives: it is how an empty shelf is stated', () => {
    assert.deepEqual(parse(pantryItem({ quantity: 0, unit: '' })), [
        { type: 'pantry_item', name: 'Riz', quantity: 0, unit: null, category: 'Alimentation', location: 'pantry' },
    ]);
});

test('an unusable quantity reads as 0 rather than dropping the item', () => {
    for (const quantity of [-3, 'abc', null, undefined]) {
        assert.equal(parse(pantryItem({ quantity }))[0]?.type, 'pantry_item');
        assert.equal(parse(pantryItem({ quantity }))[0]?.quantity, 0);
    }
});

test('an unknown location falls back to the shelf, an unknown category to Autre', () => {
    assert.equal(parse(pantryItem({ location: 'bedroom' }))[0]?.location, 'pantry');
    assert.equal(parse(pantryItem({ location: 'fridge' }))[0]?.location, 'fridge');
    assert.equal(parse(pantryItem({ category: 'Nonsense' }))[0]?.category, 'Autre');
    assert.equal(parse(pantryItem({ category: 'Sante' }))[0]?.category, 'Sante');
});

test('the parse prompt names the pantry only when its stock is provided', () => {
    const off = buildParsePrompt([], CATEGORIES, ['Autre'], null);
    assert.equal(off, buildParsePrompt([], CATEGORIES, ['Autre']));
    assert.ok(!off.includes('pantry_item'));

    const empty = buildParsePrompt([], CATEGORIES, ['Autre'], []);
    assert.ok(empty.includes('"pantry_item"'));
    assert.ok(empty.includes('Garde-manger actuel'));
    assert.ok(empty.includes('(vide)'));

    const stocked = buildParsePrompt([], CATEGORIES, ['Autre'], [{ name: 'Lait', quantity: 2, unit: 'L' }]);
    assert.ok(stocked.includes('- Lait : 2 L'));
    assert.ok(stocked.includes('"shopping_item" = ce qu\'il reste à acheter'));
    // The routing the family feels: something to buy stays a shopping item, and a
    // finished product is not proposed twice (the server puts it on the list).
    assert.ok(stocked.includes('Ce qu\'il FAUT ACHETER est toujours un "shopping_item"'));
    assert.ok(stocked.includes('n\'ajoute pas AUSSI un "shopping_item"'));
    // The shelf vocabulary the validator accepts is spelled out for the model.
    assert.ok(stocked.includes('fridge (réfrigérateur)'));
});

test('the meals prompt carries the stock and each recipe its ingredients', () => {
    const recipes: RecipeRef[] = [{ id: 'r1', name: 'Riz sauté', category: 'Plat', ingredients: ['500 g de riz'] }];
    const args = { recipes, missingDates: ['2026-10-12'], plannedDinners: [], recentRecipeIds: [] };

    const off = buildMealsPrompt({ ...args, pantryItems: null });
    assert.ok(!off.user.includes('Garde-manger'));
    assert.ok(!off.system.includes('garde-manger'));
    assert.ok(!off.user.includes('ingrédients'));

    const stocked = buildMealsPrompt({ ...args, pantryItems: [{ name: 'Riz', quantity: 2, unit: 'kg' }] });
    assert.ok(stocked.user.includes('- Riz : 2 kg'));
    assert.ok(stocked.user.includes('| ingrédients : 500 g de riz'));
    assert.ok(stocked.system.includes("Privilégie les recettes"));

    const empty = buildMealsPrompt({ ...args, pantryItems: [] });
    assert.ok(empty.user.includes('(vide)'));
    assert.ok(empty.user.includes('| ingrédients : 500 g de riz'));
});

test('a recipe with no ingredients line still lists cleanly', () => {
    const { user } = buildMealsPrompt({
        recipes: [{ id: 'r1', name: 'Riz sauté', category: null }],
        missingDates: ['2026-10-12'],
        plannedDinners: [],
        recentRecipeIds: [],
        pantryItems: [{ name: 'Riz', quantity: 2, unit: null }],
    });

    assert.ok(user.includes('- id: r1 | Riz sauté'));
    assert.ok(user.includes('- Riz : 2'));
    assert.ok(!user.includes('ingrédients'));
});
