import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKidsActivitiesUserPrompt, kidFactDigest, type ActivityKidInput } from '../src/custom/ai/widgets.custom';
import type { WeatherSummary } from '../src/custom/weather/WeatherService.custom';

// =============================================================================
// The activities user prompt is the whole contract with the model: the family
// expects the ideas to use what they wrote on each child's card, so that text
// has to survive into the prompt, and a child nobody wrote anything about must
// not leave an empty clause behind.
// =============================================================================

const weather: WeatherSummary = {
    tempMin: 9,
    tempMax: 15,
    label: 'Couvert',
    weatherCode: 3,
    tempMinBucket: 'mild',
    precipBucket: 'none',
    windyBucket: 'light',
};

const kid = (over: Partial<ActivityKidInput>): ActivityKidInput => ({
    id: 'kid-1',
    firstName: 'Mia',
    ageYears: 8,
    ...over,
});

const build = (kids: ActivityKidInput[], lang: 'fr' | 'en'): string =>
    buildKidsActivitiesUserPrompt(weather, kids, { busySlots: [], meals: [], chores: [] }, [], lang);

test('the activities prompt carries what the family wrote about a child', () => {
    const prompt = build(
        [kid({ notes: 'loves dinosaurs and building things', allergies: ['peanuts', 'latex'] })],
        'en',
    );

    assert.match(
        prompt,
        /- id=kid-1 name=Mia age=8 \(to know : loves dinosaurs and building things ; allergies : peanuts, latex\)/,
    );
});

test('a child with nothing written down leaves no empty clause', () => {
    const prompt = build([kid({})], 'en');

    assert.match(prompt, /- id=kid-1 name=Mia age=8$/m);
    assert.doesNotMatch(prompt, /\(\)/);
});

test('the French prompt says the same thing in French', () => {
    const prompt = build([kid({ notes: 'adore les dinosaures', allergies: ['arachides'] })], 'fr');

    assert.match(
        prompt,
        /- id=kid-1 prénom=Mia age=8 ans \(à savoir : adore les dinosaures ; allergies : arachides\)/,
    );
});

test('notes are flattened and capped so they cannot crowd out the JSON rules', () => {
    const prompt = build([kid({ notes: `a\n\n  b ${'x'.repeat(400)}` })], 'en');
    const line = prompt.split('\n').find((l) => l.startsWith('- id=kid-1')) ?? '';

    assert.match(line, /\(to know : a b x+/);
    assert.ok(line.length < 210, `kid line should stay short, was ${line.length} chars`);
});

test('the cache key digest is empty without personal facts and differs when they differ', () => {
    assert.equal(kidFactDigest(kid({})), '');
    assert.equal(kidFactDigest(kid({ notes: '   ' })), '');
    assert.equal(kidFactDigest(kid({ allergies: ['  '] })), '');

    const withNotes = kidFactDigest(kid({ notes: 'loves dinosaurs' }));
    assert.match(withNotes, /^[0-9a-f]{8}$/);
    assert.notEqual(withNotes, kidFactDigest(kid({ notes: 'loves drawing' })));
    assert.notEqual(withNotes, kidFactDigest(kid({ allergies: ['peanuts'] })));
    // Same facts, same key: the cache has to hit on a dashboard re-render.
    assert.equal(withNotes, kidFactDigest(kid({ notes: ' loves dinosaurs ' })));
});
