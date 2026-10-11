// Pure rules behind /api/custom/ha, kept out of the router so they can be tested
// without a database, a token or a Home Assistant instance.

/** Same budget as the upstream HA service: a LAN device that stopped answering. */
export const HA_TIMEOUT_MS = 15_000;

/** The states payload of a large install runs to a few hundred kB; this caps a runaway. */
export const HA_STATES_MAX_BYTES = 4 * 1024 * 1024;

// Domains the dashboard can show or drive. Anything else (automation, sensor,
// update, person…) is filtered out of /states, so a family never sees its own
// automations listed as devices.
export const HA_DOMAINS: Record<string, true> = {
    light: true,
    switch: true,
    climate: true,
    media_player: true,
    scene: true,
    input_boolean: true,
    cover: true,
    fan: true,
    lock: true,
    binary_sensor: true,
    camera: true,
};

// Attribute keys worth the trip to the tablet. HA returns everything the
// integration exposes (supported_features bitmasks, entity pictures…), and the
// dashboard only draws a handful of them.
export const HA_ATTRIBUTE_KEYS = [
    'friendly_name',
    'device_class',
    'unit_of_measurement',
    'brightness',
    'color_mode',
    'rgb_color',
    'color_temp_kelvin',
    'temperature',
    'current_temperature',
    'target_temp_high',
    'target_temp_low',
    'hvac_action',
    'hvac_modes',
    'media_title',
    'media_artist',
    'media_content_type',
    'volume_level',
    'current_position',
    'percentage',
    'battery_level',
] as const;

export const haDomainOf = (entityId: string): string => entityId.split('.')[0] ?? '';

export interface HaEntity {
    entity_id: string;
    domain: string;
    friendly_name: string;
    state: string;
    attributes: Record<string, unknown>;
}

/** One row of HA's /api/states, as this proxy accepts it. */
export interface RawHaState {
    entity_id?: unknown;
    state?: unknown;
    attributes?: Record<string, unknown>;
}

/** The entity as the dashboard needs it, or null when its domain is not whitelisted. */
export const simplifyHaState = (entity: RawHaState): HaEntity | null => {
    if (typeof entity.entity_id !== 'string') return null;
    const domain = haDomainOf(entity.entity_id);
    if (!HA_DOMAINS[domain]) return null;

    const source = entity.attributes ?? {};
    const attributes: Record<string, unknown> = {};
    for (const key of HA_ATTRIBUTE_KEYS) {
        if (source[key] !== undefined) attributes[key] = source[key];
    }

    return {
        entity_id: entity.entity_id,
        domain,
        friendly_name: typeof source.friendly_name === 'string' ? source.friendly_name : entity.entity_id,
        state: typeof entity.state === 'string' ? entity.state : String(entity.state ?? ''),
        attributes,
    };
};

export type HaServiceError =
    | 'homeassistant.unsupported_domain'
    | 'homeassistant.unsupported_service'
    | 'homeassistant.entity_id_required'
    | 'homeassistant.domain_mismatch';

/**
 * How a non-2xx from HA's service endpoint becomes this proxy's answer.
 *
 * A 4xx is HA saying the call itself is wrong (a service that domain does not
 * implement, an entity that will not take it). HA is up, so it must not read as
 * an outage: one dead tile, not an offline banner over the whole screen. HA's own
 * 401/403 folds into the same 400 on purpose — forwarding it would make the
 * client treat the family's OpenFamily session as expired and log them out.
 */
export const haServiceFailure = (status: number): { status: number; error: string } =>
    status < 500
        ? { status: 400, error: 'homeassistant.service_rejected' }
        : { status: 502, error: 'homeassistant.service_failed' };

/**
 * Whether a service call may be proxied, and nothing else. HA takes a single
 * `entity_id` or a list, and `all` is HA's own wildcard; every other target must
 * live in the domain being called, which keeps the whitelist meaningful one hop
 * earlier than HA would.
 */
export const validateServiceCall = (
    domain: string,
    service: string,
    body: Record<string, unknown>,
): HaServiceError | null => {
    if (!HA_DOMAINS[domain]) return 'homeassistant.unsupported_domain';
    // HA service names are lower_snake_case; reject anything else before it
    // reaches a URL path segment.
    if (!/^[a-z0-9_]+$/.test(service)) return 'homeassistant.unsupported_service';

    const targets = Array.isArray(body.entity_id) ? body.entity_id : [body.entity_id];
    if (targets.length === 0 || !targets.every((id) => typeof id === 'string' && id.length > 0)) {
        return 'homeassistant.entity_id_required';
    }
    if ((targets as string[]).some((id) => id !== 'all' && haDomainOf(id) !== domain)) {
        return 'homeassistant.domain_mismatch';
    }
    return null;
};
