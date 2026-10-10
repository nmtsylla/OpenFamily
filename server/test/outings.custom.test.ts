import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildOverpassQuery,
    clearPlacesCache,
    haversineKm,
    isIndoorCategory,
    overpassFailure,
    parseOverpassResponse,
    rankPlaces,
    resetPlacesConfigCache,
    type NearbyPlace,
} from '../src/custom/lib/places.custom';
import {
    buildOutingsUserPrompt,
    outingWindow,
    validateOutingPlan,
    type OutingPlanningInput,
} from '../src/custom/ai/outings.custom';

// =============================================================================
// Outing planner: the pure halves of the feature.
//
// Two things decide whether the planner is any good, and neither needs a network
// or a model to check:
//   1. what OpenStreetMap's answer becomes — the categories, the distances, the
//      unnamed and duplicated places that must not reach the family;
//   2. what the model's answer becomes — a `ref` that points at a place that was
//      never offered is an invented venue and has to be dropped, and the order of
//      the picks IS the ranking, so it must survive validation.
// =============================================================================

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------

test('haversineKm matches a known distance (Paris → London, ~344 km)', () => {
    const km = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    assert.ok(km > 340 && km < 348, `expected ~344 km, got ${km}`);
});

test('buildOverpassQuery asks for every mapped category around the point', () => {
    resetPlacesConfigCache();
    const query = buildOverpassQuery(51.165, 4.14, 10_000);
    assert.match(query, /\[out:json\]/);
    assert.match(query, /\(around:10000,51\.165,4\.14\)/);
    // One `nwr` clause per OSM key, values as a regex: the one-clause-per-tag
    // version times the public instance out (measured: 504).
    assert.match(query, /nwr\["leisure"~"\^\(playground\|park\|water_park\|swimming_pool\)\$"\]/);
    assert.match(query, /nwr\["tourism"~"\^\(zoo\|aquarium\|museum\|theme_park\|attraction\|viewpoint\)\$"\]/);
    assert.match(query, /nwr\["amenity"="library"\]/);
    assert.equal(query.split('nwr[').length - 1, 3);
    // The cap Overpass applies BEFORE our distance sort: it must be generous,
    // because only ~a quarter of the elements it returns are named.
    assert.match(query, /out center 400;/);
});

test('overpassFailure reads a 200-with-remark as a failure, not as an empty area', () => {
    // Measured shape: HTTP 200, `elements: []`, and the reason in `remark`. Taken
    // as data it would say "no place here" and cache that for half a day.
    assert.equal(
        overpassFailure({
            version: 0.6,
            elements: [],
            remark: 'runtime error:   Query timed out in "query" at line 5 after 39 seconds.',
        }),
        'runtime error: Query timed out in "query" at line 5 after 39 seconds.',
    );

    assert.equal(overpassFailure({ elements: [] }), null);
    assert.equal(overpassFailure({ elements: [], remark: '   ' }), null);
    for (const junk of [null, 'nope', [], 42]) assert.equal(overpassFailure(junk), null);
});

test('parseOverpassResponse keeps named places, nearest first, categories resolved', () => {
    const payload = {
        elements: [
            {
                type: 'way',
                id: 11,
                center: { lat: 51.17, lon: 4.15 },
                tags: { name: 'Grand Parc', leisure: 'park', opening_hours: '24/7', fee: 'no' },
            },
            {
                type: 'node',
                id: 22,
                lat: 51.166,
                lon: 4.141,
                tags: { name: 'Aire de jeux', leisure: 'playground' },
            },
            // A zoo is also a tourist attraction: the zoo clause comes first.
            { type: 'node', id: 33, lat: 51.18, lon: 4.16, tags: { name: 'Zoo', tourism: 'zoo', attraction: 'yes' } },
            // Nameless: not a proposal anyone can act on.
            { type: 'node', id: 44, lat: 51.1601, lon: 4.1401, tags: { leisure: 'playground' } },
            // Nothing we map.
            { type: 'node', id: 55, lat: 51.16, lon: 4.14, tags: { name: 'Boulangerie', shop: 'bakery' } },
            // No coordinates at all.
            { type: 'node', id: 66, tags: { name: 'Fantôme', leisure: 'park' } },
            null,
        ],
    };

    const places = parseOverpassResponse(payload, 51.165, 4.14);

    assert.deepEqual(
        places.map((p) => [p.name, p.category]),
        [
            ['Aire de jeux', 'playground'],
            ['Grand Parc', 'park'],
            ['Zoo', 'zoo'],
        ],
    );
    assert.equal(places[0].id, 'osm:node/22');
    assert.equal(places[1].id, 'osm:way/11');
    assert.ok(places[0].distanceKm < places[1].distanceKm);
    assert.equal(places[1].openingHours, '24/7');
    assert.equal(round(places[0].distanceKm, 2), 0.13);
});

test('parseOverpassResponse drops the second copy of a place and refuses junk payloads', () => {
    // The same playground mapped twice (a node and a small way around it).
    const payload = {
        elements: [
            { type: 'node', id: 1, lat: 51.165, lon: 4.14, tags: { name: 'Speeltuin', leisure: 'playground' } },
            { type: 'way', id: 2, center: { lat: 51.1651, lon: 4.1401 }, tags: { name: 'speeltuin', leisure: 'playground' } },
        ],
    };
    const places = parseOverpassResponse(payload, 51.165, 4.14);
    assert.equal(places.length, 1);
    assert.equal(places[0].id, 'osm:node/1');

    for (const junk of [null, 'nope', {}, { elements: 'x' }, { elements: [] }]) {
        assert.deepEqual(parseOverpassResponse(junk, 51.165, 4.14), []);
    }
});

test('parseOverpassResponse normalizes a website and rejects a non-http one', () => {
    const payload = {
        elements: [
            { type: 'node', id: 1, lat: 51.165, lon: 4.14, tags: { name: 'Musée', tourism: 'museum', website: 'www.musee.be' } },
            { type: 'node', id: 2, lat: 51.165, lon: 4.14, tags: { name: 'Biblio', amenity: 'library', website: 'javascript:alert(1)' } },
        ],
    };
    const places = parseOverpassResponse(payload, 51.165, 4.14);
    assert.equal(places.find((p) => p.name === 'Musée')?.website, 'https://www.musee.be/');
    assert.equal(places.find((p) => p.name === 'Biblio')?.website, null);
});

test('rankPlaces keeps distance order when dry, and puts indoor venues first when wet', () => {
    const place = (name: string, category: NearbyPlace['category'], km: number): NearbyPlace => ({
        id: `osm:node/${name}`,
        name,
        category,
        latitude: 0,
        longitude: 0,
        distanceKm: km,
        openingHours: null,
        website: null,
        fee: null,
    });
    const places = [
        place('Aire', 'playground', 0.2),
        place('Musée', 'museum', 4),
        place('Parc', 'park', 1),
        place('Biblio', 'library', 6),
    ];

    assert.deepEqual(rankPlaces(places, false).map((p) => p.name), ['Aire', 'Parc', 'Musée', 'Biblio']);
    assert.deepEqual(rankPlaces(places, true).map((p) => p.name), ['Musée', 'Biblio', 'Aire', 'Parc']);
    assert.equal(isIndoorCategory('aquarium'), true);
    assert.equal(isIndoorCategory('park'), false);
});

test('clearPlacesCache empties the in-process cache', () => {
    clearPlacesCache();
    assert.doesNotThrow(() => clearPlacesCache());
});

// ---------------------------------------------------------------------------
// The model's answer
// ---------------------------------------------------------------------------

test('validateOutingPlan drops a ref that was never offered, and keeps the ranking order', () => {
    const plan = validateOutingPlan(
        {
            picks: [
                { ref: 3, why: 'Le plus proche.', startTime: '10:30', durationMinutes: 90 },
                { ref: 99, why: 'Lieu inventé.', startTime: '11:00', durationMinutes: 60 },
                { ref: 1, why: 'Couvert, idéal sous la pluie.' },
                { ref: 3, why: 'Encore lui.', startTime: '14:00', durationMinutes: 60 },
            ],
            ideas: [],
        },
        3,
    );

    assert.deepEqual(plan.picks.map((p) => p.ref), [3, 1]);
    assert.deepEqual(plan.picks[0], { ref: 3, why: 'Le plus proche.', startTime: '10:30', durationMinutes: 90 });
    assert.deepEqual(plan.picks[1], { ref: 1, why: 'Couvert, idéal sous la pluie.', startTime: null, durationMinutes: null });
});

test('validateOutingPlan refuses impossible times, absurd durations and prose answers', () => {
    const plan = validateOutingPlan(
        {
            picks: [
                { ref: 1, why: 'ok', startTime: '25:99', durationMinutes: 5 },
                { ref: 2, why: 'ok', startTime: '9:00', durationMinutes: 5000 },
                { ref: 3, why: '' },
            ],
            ideas: [
                { title: 'Chasse au trésor', description: 'Dans le quartier.', indoor: false },
                { title: 'Jeux de société', description: '', indoor: true },
                { title: 'Cinéma maison', description: '', indoor: true },
                { title: 'Une de trop', description: '', indoor: true },
                { title: '', description: 'Sans titre.' },
            ],
        },
        3,
    );

    assert.equal(plan.picks.length, 2);
    assert.equal(plan.picks[0].startTime, null);
    assert.equal(plan.picks[0].durationMinutes, null);
    assert.equal(plan.picks[1].durationMinutes, null);
    assert.deepEqual(plan.ideas.map((i) => i.title), ['Chasse au trésor', 'Jeux de société', 'Cinéma maison']);

    for (const junk of [null, 'prose', [], {}, { picks: 'x', ideas: 3 }]) {
        assert.deepEqual(validateOutingPlan(junk, 3), { picks: [], ideas: [] });
    }
});

test('outingWindow uses the model suggestion when it fits, the requested length otherwise', () => {
    assert.deepEqual(outingWindow({ startTime: '11:15', durationMinutes: 90 }, 'half_day'), {
        startTime: '11:15',
        endTime: '12:45',
    });
    // The model proposed neither: the family's "half a day" decides.
    assert.deepEqual(outingWindow({ startTime: null, durationMinutes: null }, 'half_day'), {
        startTime: '10:00',
        endTime: '14:00',
    });
    assert.deepEqual(outingWindow({ startTime: null, durationMinutes: null }, 'short'), {
        startTime: '10:00',
        endTime: '12:00',
    });
    assert.deepEqual(outingWindow({ startTime: null, durationMinutes: null }, 'full_day'), {
        startTime: '09:30',
        endTime: '17:30',
    });
    // 22:00 + 8 h would wrap past midnight, where end_time is a clock time again.
    assert.deepEqual(outingWindow({ startTime: '22:00', durationMinutes: 480 }, 'half_day'), {
        startTime: '10:00',
        endTime: '14:00',
    });
    // Ending EXACTLY at midnight is the same trap one minute earlier: 24:00 is
    // not a time upstream's planner accepts, so this outing would 400.
    assert.deepEqual(outingWindow({ startTime: '22:00', durationMinutes: 120 }, 'short'), {
        startTime: '10:00',
        endTime: '12:00',
    });
    assert.deepEqual(outingWindow({ startTime: '21:00', durationMinutes: 179 }, 'short'), {
        startTime: '21:00',
        endTime: '23:59',
    });
});

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

const baseInput: OutingPlanningInput = {
    party: 'kids',
    duration: 'half_day',
    date: '2026-06-13',
    city: 'Sint-Niklaas',
    weather: { label: 'Pluie faible', tempMin: 12, tempMax: 16, precipitationProbability: 70 },
    kids: [
        { name: 'Léa', ageYears: 7, notes: 'Peur des chiens', allergies: ['arachides'] },
        { name: 'Tom', ageYears: 10, notes: null, allergies: [] },
    ],
    places: [
        {
            id: 'osm:node/1',
            name: 'Musée communal',
            category: 'museum',
            latitude: 51.17,
            longitude: 4.15,
            distanceKm: 2.4,
            openingHours: 'Tu-Su 10:00-17:00',
            website: 'https://example.org',
            fee: 'yes',
        },
    ],
};

test('buildOutingsUserPrompt carries the places, the party, the kids and the weather', () => {
    const prompt = buildOutingsUserPrompt(baseInput, 'fr');

    assert.match(prompt, /2026-06-13/);
    assert.match(prompt, /Sint-Niklaas/);
    assert.match(prompt, /un ou deux adultes avec les enfants/);
    assert.match(prompt, /une demi-journée/);
    assert.match(prompt, /Pluie faible, 12–16°C, pluie 70%/);
    assert.match(prompt, /^- Léa \(7 ans\) \(Peur des chiens — allergies: arachides\)$/m);
    assert.match(prompt, /^- Tom \(10 ans\)$/m);
    assert.match(prompt, /1\. Musée communal — museum \(2\.4 km, Tu-Su 10:00-17:00, tarif: yes, https:\/\/example\.org\)/);
    // The number of picks asked for never exceeds the number of places offered.
    assert.match(prompt, /au maximum 1 lieu/);
});

test('buildOutingsUserPrompt says so when there is no place and no forecast', () => {
    const prompt = buildOutingsUserPrompt(
        { ...baseInput, party: 'parents', kids: [], weather: null, places: [], city: null, duration: 'full_day' },
        'en',
    );
    assert.match(prompt, /the parents only, without the children/);
    assert.match(prompt, /the whole day/);
    assert.match(prompt, /forecast unavailable/);
    assert.match(prompt, /- none/);
    assert.match(prompt, /return no 'picks'/);
});
