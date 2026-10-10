import assert from 'node:assert/strict';
import test from 'node:test';
import {
    lunchboxItemsFromRow,
    sanitizeLunchboxItems,
    tallyForShopping,
    tallyLunchboxItems,
} from '../src/custom/lib/lunchbox.custom';
import { validateLunchboxIdeas } from '../src/custom/ai/lunchbox.custom';
import { validateNutritionAnalysis } from '../src/custom/ai/nutrition.custom';
import { resolvePromptLanguage } from '../src/custom/lib/promptLanguage.custom';

// =============================================================================
// Lunchboxes: the rules that keep the table and the AI answers sane.
//
// Nothing here touches the database or a model — these are the pure functions
// the route leans on. The interesting cases are the ones a model produces in the
// wild: components that are not strings, an answer that is prose instead of
// JSON, a score out of range, and counts written "pomme" and "Pomme".
// =============================================================================

test('sanitizeLunchboxItems keeps the four known fields and drops everything else', () => {
    assert.deepEqual(
        sanitizeLunchboxItems({
            main: '  Sandwich  ',
            fruit: 'Pomme',
            snack: '',
            drink: 42,
            extra: 'ignored',
        }),
        { main: 'Sandwich', fruit: 'Pomme' },
    );

    // No component left → null, so the table never holds an empty object.
    assert.equal(sanitizeLunchboxItems({ main: '   ', drink: null }), null);
    assert.equal(sanitizeLunchboxItems(null), null);
    assert.equal(sanitizeLunchboxItems(['Sandwich']), null);
});

test('sanitizeLunchboxItems caps a component at 200 characters', () => {
    const long = 'a'.repeat(500);
    const cleaned = sanitizeLunchboxItems({ main: long });
    assert.equal(cleaned?.main.length, 200);
});

test('lunchboxItemsFromRow reads a row back into the four components', () => {
    assert.deepEqual(lunchboxItemsFromRow({ main: 'Riz', fruit: 'Mangue', snack: null, drink: 'Eau' }), {
        main: 'Riz',
        fruit: 'Mangue',
        drink: 'Eau',
    });
});

test('tallyLunchboxItems groups case-insensitively and keeps the most recent spelling', () => {
    const stats = tallyLunchboxItems([
        { main: 'Pomme', fruit: null, snack: null, drink: null },
        { main: 'pomme', fruit: null, snack: null, drink: null },
        { main: 'Riz', fruit: null, snack: null, drink: null },
    ]);

    assert.equal(stats.totalLunchboxes, 3);
    assert.deepEqual(stats.byField.main, [
        { label: 'Pomme', count: 2 },
        { label: 'Riz', count: 1 },
    ]);
    assert.deepEqual(stats.byField.drink, []);
});

test('tallyForShopping counts what a week of lunchboxes needs', () => {
    const tally = tallyForShopping([
        { main: 'Sandwich', fruit: 'Pomme', snack: null, drink: 'Eau' },
        { main: 'sandwich', fruit: 'Banane', snack: null, drink: 'Eau' },
    ]);

    assert.equal(tally.size, 4);
    assert.deepEqual(tally.get('sandwich'), { label: 'Sandwich', count: 2 });
    assert.deepEqual(tally.get('eau'), { label: 'Eau', count: 2 });
});

test('validateLunchboxIdeas clamps the model answer', () => {
    const ideas = validateLunchboxIdeas(
        {
            ideas: [
                {
                    main: '  Wrap au thon ',
                    fruit: 'Pomme',
                    snack: 'Yaourt',
                    drink: 'Eau',
                    reasoning: 'Rapide',
                    warnings: ['Garder au frais', 'Couper en deux', 'Une troisième alerte'],
                },
                // No main dish → dropped.
                { main: '   ', fruit: 'Poire' },
                { main: 'Riz', fruit: '', snack: null, drink: 'x'.repeat(400) },
                { main: 'Quatrième idée' },
            ],
        },
        3,
    );

    assert.equal(ideas.length, 2);
    assert.deepEqual(ideas[0].warnings, ['Garder au frais', 'Couper en deux']);
    assert.equal(ideas[0].main, 'Wrap au thon');
    assert.equal(ideas[1].drink.length, 200);
    assert.deepEqual(ideas[1].warnings, []);
});

test('validateLunchboxIdeas refuses anything that is not the expected JSON', () => {
    assert.deepEqual(validateLunchboxIdeas('voici trois idées…', 3), []);
    assert.deepEqual(validateLunchboxIdeas({ ideas: { main: 'x' } }, 3), []);
    assert.deepEqual(validateLunchboxIdeas(null, 3), []);
});

test('validateNutritionAnalysis derives the verdict from the score, whatever the model says', () => {
    const analysis = validateNutritionAnalysis({
        score: 91,
        // A verdict the model made up, and a valid-looking one, are both ignored:
        // the score band is the single source of truth.
        verdict: 'délicieux',
        summary: 'Bonne semaine.',
        strengths: ['Beaucoup de légumes'],
        weaknesses: [],
        missingFoodGroups: ['Poissons gras'],
        recommendations: [{ title: 'Ajouter du poisson', detail: 'Un thiéboudienne jeudi.' }, { title: '' }],
    });

    assert.equal(analysis?.score, 91);
    assert.equal(analysis?.verdict, 'excellent');
    assert.deepEqual(analysis?.recommendations, [
        { title: 'Ajouter du poisson', detail: 'Un thiéboudienne jeudi.' },
    ]);

    const mismatched = validateNutritionAnalysis({ score: 30, verdict: 'excellent', summary: 'Semaine.' });
    assert.equal(mismatched?.verdict, 'unbalanced');
});

test('validateNutritionAnalysis clamps the score and the list lengths', () => {
    const analysis = validateNutritionAnalysis({
        score: 140,
        summary: 'Semaine correcte.',
        strengths: ['a', 'b', 'c', 'd', 'e'],
        weaknesses: ['a', 'b', 'c', 'd', 'e'],
        missingFoodGroups: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        recommendations: [],
    });

    assert.equal(analysis?.score, 100);
    assert.equal(analysis?.verdict, 'excellent');
    assert.equal(analysis?.strengths.length, 4);
    assert.equal(analysis?.weaknesses.length, 4);
    assert.equal(analysis?.missingFoodGroups.length, 6);
});

test('validateNutritionAnalysis rejects an answer without a usable score or summary', () => {
    assert.equal(validateNutritionAnalysis({ summary: 'Bien' }), null);
    assert.equal(validateNutritionAnalysis({ score: 'excellent', summary: 'Bien' }), null);
    assert.equal(validateNutritionAnalysis({ score: 70, summary: '   ' }), null);
    assert.equal(validateNutritionAnalysis('analyse'), null);
});

test('resolvePromptLanguage maps the UI language to the six the prompts know', () => {
    // The model writes the copy, so an unsupported language must not silently
    // produce English while the interface is, say, Dutch.
    assert.equal(resolvePromptLanguage('fr'), 'fr');
    assert.equal(resolvePromptLanguage('en'), 'en');
    assert.equal(resolvePromptLanguage('ES'), 'es');
    assert.equal(resolvePromptLanguage('pt-BR'), 'pt');
    assert.equal(resolvePromptLanguage('zh-Hans'), 'zh');
    assert.equal(resolvePromptLanguage('  ru  '), 'ru');

    assert.equal(resolvePromptLanguage(undefined), 'en');
    assert.equal(resolvePromptLanguage(null), 'en');
    assert.equal(resolvePromptLanguage(''), 'en');
    assert.equal(resolvePromptLanguage('nl'), 'en');
    assert.equal(resolvePromptLanguage(7), 'en');
    assert.equal(resolvePromptLanguage({ lang: 'fr' }), 'en');
});
