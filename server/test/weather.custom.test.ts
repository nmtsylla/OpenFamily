import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDayContext, resolveTargetDay, toDateKey } from '../src/custom/lib/dayContext.custom';
import { summarize, type TomorrowForecast } from '../src/custom/weather/WeatherService.custom';
import { pickFallbackActivities } from '../src/custom/ai/activityBank.custom';

// =============================================================================
// The weather feature's pure decisions: which day the dashboard talks about,
// how a forecast is bucketed for the AI prompt, and which offline ideas are
// eligible. Everything else in the feature is I/O.
// =============================================================================

const forecast = (over: Partial<TomorrowForecast>): TomorrowForecast => ({
    date: '2026-03-11',
    tempMin: 10,
    tempMax: 18,
    precipitationMm: 0,
    precipitationProbability: 0,
    windSpeedMax: 5,
    weatherCode: 1,
    label: 'Ciel principalement clair',
    timezone: 'Europe/Brussels',
    ...over,
});

test('dayContext: weekends are home days, term weekdays are school days', () => {
    // 2026-03-14 is a Saturday, 2026-03-11 a Wednesday.
    assert.deepEqual(resolveDayContext('2026-03-14'), {
        date: '2026-03-14',
        mode: 'home',
        reason: 'weekend',
    });
    assert.deepEqual(resolveDayContext('2026-03-11'), {
        date: '2026-03-11',
        mode: 'school',
        reason: 'school_day',
    });
});

test('dayContext: July and August fall back to summer without any declaration', () => {
    assert.equal(resolveDayContext('2026-07-01').reason, 'default_summer');
    assert.equal(resolveDayContext('2026-08-31').reason, 'default_summer');
    // The bounds are inclusive of the month, not of the whole summer month.
    assert.equal(resolveDayContext('2026-06-30').reason, 'school_day');
    assert.equal(resolveDayContext('2026-09-01').reason, 'school_day');
});

test('resolveTargetDay: the hour picks the day, the mode only labels it', () => {
    const morning = resolveTargetDay(new Date(2026, 2, 11, 9, 0));
    assert.equal(morning.dayOffset, 0);
    assert.equal(morning.date, '2026-03-11');
    assert.equal(morning.mode, 'school');

    const late = resolveTargetDay(new Date(2026, 2, 11, 17, 59));
    assert.equal(late.dayOffset, 0);
    assert.equal(late.date, '2026-03-11');

    const evening = resolveTargetDay(new Date(2026, 2, 11, 18, 0));
    assert.equal(evening.dayOffset, 1);
    assert.equal(evening.date, '2026-03-12');
});

test('resolveTargetDay: an evening on a home day targets tomorrow, still home', () => {
    const saturday = resolveTargetDay(new Date(2026, 2, 14, 20, 0));
    assert.equal(saturday.dayOffset, 1);
    assert.equal(saturday.date, '2026-03-15');
    assert.equal(saturday.mode, 'home');
    assert.equal(saturday.reason, 'weekend');
});

test('resolveTargetDay: the picked date always matches the offset', () => {
    for (const hour of [0, 8, 17, 18, 23]) {
        const now = new Date(2026, 2, 11, hour, 30);
        const picked = resolveTargetDay(now);
        const expected = new Date(now);
        expected.setDate(expected.getDate() + picked.dayOffset);
        assert.equal(picked.date, toDateKey(expected));
    }
});

test('resolveTargetDay: flipsAt is the nearer of the cutoff and midnight', () => {
    const morning = resolveTargetDay(new Date(2026, 2, 11, 9, 0));
    assert.equal(morning.date, '2026-03-11');
    assert.equal(morning.dayOffset, 0);
    assert.equal(new Date(morning.flipsAt).getTime(), new Date(2026, 2, 11, 18, 0, 0).getTime());

    const evening = resolveTargetDay(new Date(2026, 2, 11, 18, 0));
    assert.equal(evening.dayOffset, 1);
    assert.equal(new Date(evening.flipsAt).getTime(), new Date(2026, 2, 12, 0, 0, 0).getTime());

    const lateEvening = resolveTargetDay(new Date(2026, 2, 11, 23, 30));
    assert.equal(lateEvening.dayOffset, 1);
    assert.equal(new Date(lateEvening.flipsAt).getTime(), new Date(2026, 2, 12, 0, 0, 0).getTime());

    const afterMidnight = resolveTargetDay(new Date(2026, 2, 12, 0, 30));
    assert.equal(afterMidnight.date, '2026-03-12');
    assert.equal(afterMidnight.dayOffset, 0);
    assert.equal(new Date(afterMidnight.flipsAt).getTime(), new Date(2026, 2, 12, 18, 0, 0).getTime());

    for (const hour of [0, 8, 17, 18, 23]) {
        const now = new Date(2026, 2, 11, hour, 30);
        assert.ok(new Date(resolveTargetDay(now).flipsAt) > now, `flipsAt must be ahead at ${hour}:30`);
    }
});

test('toDateKey uses the local calendar, not UTC', () => {
    assert.equal(toDateKey(new Date(2026, 0, 5, 1, 30)), '2026-01-05');
});

test('summarize buckets the temperature, the rain and the wind', () => {
    assert.equal(summarize(forecast({ tempMin: -3 })).tempMinBucket, 'cold');
    assert.equal(summarize(forecast({ tempMin: 0 })).tempMinBucket, 'cool');
    assert.equal(summarize(forecast({ tempMin: 8 })).tempMinBucket, 'mild');
    assert.equal(summarize(forecast({ tempMin: 16 })).tempMinBucket, 'warm');
    assert.equal(summarize(forecast({ tempMin: 24 })).tempMinBucket, 'hot');

    // Dry: low probability AND negligible millimetres.
    assert.equal(summarize(forecast({ precipitationMm: 0.2, precipitationProbability: 10 })).precipBucket, 'none');
    // A high probability with no volume is not "none".
    assert.equal(summarize(forecast({ precipitationMm: 0.2, precipitationProbability: 40 })).precipBucket, 'light');
    assert.equal(summarize(forecast({ precipitationMm: 4.9 })).precipBucket, 'light');
    assert.equal(summarize(forecast({ precipitationMm: 5 })).precipBucket, 'heavy');

    assert.equal(summarize(forecast({ windSpeedMax: 14 })).windyBucket, 'calm');
    assert.equal(summarize(forecast({ windSpeedMax: 15 })).windyBucket, 'breezy');
    assert.equal(summarize(forecast({ windSpeedMax: 35 })).windyBucket, 'windy');
});

test('pickFallbackActivities: deterministic, weather- and age-appropriate, honours exclusions', () => {
    const kids = [{ id: 'kid-1', ageYears: 7 }];
    const sunny = pickFallbackActivities({ kids, outdoorOk: true, dateKey: '2026-08-05' });
    const rainy = pickFallbackActivities({ kids, outdoorOk: false, dateKey: '2026-08-05' });

    assert.ok(sunny.length >= 3 && sunny.length <= 4);
    // Same input, same output: a dashboard refresh must not reshuffle the card.
    assert.deepEqual(
        sunny.map((a) => a.id),
        pickFallbackActivities({ kids, outdoorOk: true, dateKey: '2026-08-05' }).map((a) => a.id),
    );
    // A new day rotates the bank.
    assert.notDeepEqual(
        sunny.map((a) => a.id),
        pickFallbackActivities({ kids, outdoorOk: true, dateKey: '2026-08-06' }).map((a) => a.id),
    );
    // Nobody is suggested an outdoor idea when it rains or freezes.
    assert.equal(rainy.some((a) => a.id === 'treasure-hunt-garden'), false);

    // Every pick is addressed to a kid it actually suits, and the exclusions stick.
    for (const activity of sunny) {
        assert.deepEqual(activity.kidIds, ['kid-1']);
    }
    const excluded = sunny.map((a) => a.id ?? '');
    const next = pickFallbackActivities({ kids, outdoorOk: true, dateKey: '2026-08-05', exclude: excluded });
    assert.equal(next.some((a) => excluded.includes(a.id ?? '')), false);
});

test('pickFallbackActivities: bank ideas carry slugs, never server-side copy', () => {
    // The offline bank is translated by the client from `id` + material slugs,
    // which is what keeps the degraded card in the reader's own language: any
    // text field here would be French for every reader.
    const picked = pickFallbackActivities({
        kids: [{ id: 'kid-1', ageYears: 8 }],
        outdoorOk: true,
        dateKey: '2026-07-14',
    });
    assert.ok(picked.length > 0);
    for (const activity of picked) {
        assert.equal(typeof activity.id, 'string');
        assert.equal(activity.title, undefined);
        assert.equal(activity.instructions, undefined);
        // Material slugs, not words: lowercase, no accents, no spaces.
        for (const material of activity.materials) {
            assert.match(material, /^[a-z-]+$/);
        }
    }
});

test('pickFallbackActivities: an idea nobody fits is dropped, never returned unattributed', () => {
    // A 17-year-old is barely covered by the bank; whatever survives the age
    // filter must still name the kid it was picked for, and an empty family
    // returns nothing at all.
    const picked = pickFallbackActivities({
        kids: [{ id: 'kid-1', ageYears: 17 }],
        outdoorOk: true,
        dateKey: '2026-08-05',
    });
    assert.equal(picked.every((a) => a.kidIds.length > 0), true);
    assert.deepEqual(pickFallbackActivities({ kids: [], outdoorOk: true, dateKey: '2026-08-05' }), []);
});
