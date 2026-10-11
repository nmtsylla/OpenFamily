import assert from 'node:assert/strict';
import test from 'node:test';
import {
    haDomainOf,
    haServiceFailure,
    simplifyHaState,
    validateServiceCall,
} from '../src/custom/lib/homeAssistantDevices.custom';

// =============================================================================
// The two rules the family dashboard's Home Assistant proxy must not get wrong:
// what a family is allowed to see, and what it is allowed to drive. Both decide
// whether a URL path segment or an entity id ever reaches the household's HA,
// so they are pinned here rather than left to the browser smoke test.
// =============================================================================

test('simplifyHaState keeps whitelisted domains and drops the rest', () => {
    const kept = simplifyHaState({
        entity_id: 'light.salon',
        state: 'on',
        attributes: { friendly_name: 'Salon' },
    });
    assert.equal(kept?.entity_id, 'light.salon');
    assert.equal(kept?.domain, 'light');

    for (const entity_id of ['automation.reveil', 'sensor.temperature', 'person.babacar', 'update.core', 'weird']) {
        assert.equal(simplifyHaState({ entity_id, state: 'on' }), null, `${entity_id} must be filtered out`);
    }
});

test('simplifyHaState trims attributes to the dashboard whitelist', () => {
    const entity = simplifyHaState({
        entity_id: 'light.salon',
        state: 'on',
        attributes: {
            friendly_name: 'Salon',
            brightness: 180,
            rgb_color: [255, 0, 0],
            supported_features: 63,
            entity_picture: '/local/salon.png',
            icon: 'mdi:lamp',
        },
    });

    assert.deepEqual(entity?.attributes, {
        friendly_name: 'Salon',
        brightness: 180,
        rgb_color: [255, 0, 0],
    });
});

test('simplifyHaState falls back to the entity id and coerces a non-string state', () => {
    const entity = simplifyHaState({ entity_id: 'switch.prise', state: 42, attributes: {} });
    assert.equal(entity?.friendly_name, 'switch.prise');
    assert.equal(entity?.state, '42');
});

test('simplifyHaState tolerates an entity without attributes', () => {
    assert.deepEqual(simplifyHaState({ entity_id: 'scene.diner', state: 'scening' }), {
        entity_id: 'scene.diner',
        domain: 'scene',
        friendly_name: 'scene.diner',
        state: 'scening',
        attributes: {},
    });
});

test('validateServiceCall accepts a single entity, a list and the `all` wildcard', () => {
    assert.equal(validateServiceCall('light', 'turn_on', { entity_id: 'light.salon' }), null);
    assert.equal(
        validateServiceCall('light', 'turn_off', { entity_id: ['light.salon', 'light.veilleuse'] }),
        null,
    );
    assert.equal(validateServiceCall('light', 'turn_off', { entity_id: 'all' }), null);
    assert.equal(validateServiceCall('scene', 'turn_on', { entity_id: 'scene.diner' }), null);
});

test('validateServiceCall refuses a domain outside the whitelist', () => {
    assert.equal(validateServiceCall('automation', 'trigger', { entity_id: 'automation.reveil' }), 'homeassistant.unsupported_domain');
    assert.equal(validateServiceCall('homeassistant', 'restart', { entity_id: 'light.salon' }), 'homeassistant.unsupported_domain');
});

test('validateServiceCall refuses a service name that is not lower_snake_case', () => {
    // A slash would escape the URL path segment the proxy builds.
    for (const service of ['../../etc/passwd', 'turn_on/../..', 'Turn On', 'turn-on', '']) {
        assert.equal(validateServiceCall('light', service, { entity_id: 'light.salon' }), 'homeassistant.unsupported_service');
    }
});

test('validateServiceCall requires a usable entity_id', () => {
    assert.equal(validateServiceCall('light', 'turn_on', {}), 'homeassistant.entity_id_required');
    assert.equal(validateServiceCall('light', 'turn_on', { entity_id: '' }), 'homeassistant.entity_id_required');
    assert.equal(validateServiceCall('light', 'turn_on', { entity_id: [] }), 'homeassistant.entity_id_required');
    assert.equal(validateServiceCall('light', 'turn_on', { entity_id: ['light.salon', 7] }), 'homeassistant.entity_id_required');
});

test('validateServiceCall refuses a target from another domain', () => {
    assert.equal(validateServiceCall('light', 'turn_on', { entity_id: 'switch.machine_cafe' }), 'homeassistant.domain_mismatch');
    assert.equal(
        validateServiceCall('light', 'turn_on', { entity_id: ['light.salon', 'switch.machine_cafe'] }),
        'homeassistant.domain_mismatch',
    );
    // The mismatch wins over the whitelist: the caller asked for a valid domain.
    assert.equal(validateServiceCall('scene', 'turn_on', { entity_id: 'light.salon' }), 'homeassistant.domain_mismatch');
});

test('haDomainOf reads the domain prefix', () => {
    assert.equal(haDomainOf('binary_sensor.porte_entree'), 'binary_sensor');
    assert.equal(haDomainOf('all'), 'all');
});

test('haServiceFailure keeps a rejected call apart from an outage', () => {
    // HA saying "no such service for this domain" — the tile did nothing, the
    // screen stays usable.
    for (const status of [400, 404, 422, 499]) {
        assert.deepEqual(haServiceFailure(status), { status: 400, error: 'homeassistant.service_rejected' }, `HA ${status}`);
    }
    // HA itself failing is an outage.
    for (const status of [500, 502, 503]) {
        assert.deepEqual(haServiceFailure(status), { status: 502, error: 'homeassistant.service_failed' }, `HA ${status}`);
    }
});

test('haServiceFailure never forwards HA 401/403 as an auth failure', () => {
    // The client's API layer logs the user out on a 401 of its own; a bad HA
    // token must not be able to end the family's OpenFamily session.
    for (const status of [401, 403]) {
        const failure = haServiceFailure(status);
        assert.equal(failure.status, 400, `HA ${status} must not surface as 401`);
        assert.equal(failure.error, 'homeassistant.service_rejected');
    }
});
