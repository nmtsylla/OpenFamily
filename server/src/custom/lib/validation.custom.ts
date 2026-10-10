// Small shared guards for the custom routers.
//
// A path/body id bound straight into a UUID column raises SQLSTATE 22P02 when it
// is not a UUID, which the route's catch turns into a 500 (plus a spurious error
// log) for what is really a bad request. One predicate, used by every custom
// route that takes an id from the client.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a UUID a UUID column will accept. */
export const isUuid = (value: unknown): boolean => typeof value === 'string' && UUID.test(value);

/**
 * True when a pg error is a unique_violation (SQLSTATE 23505). The pantry's merge
 * invariant is a unique index, so a plain INSERT/UPDATE can hit it: the honest
 * answer is a 409, not the 500 the generic catch would produce.
 */
export const isUniqueViolation = (error: unknown): boolean =>
    error !== null &&
    error !== undefined &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505';
