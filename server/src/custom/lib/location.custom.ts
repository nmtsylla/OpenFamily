// =============================================================================
// Where the family is — the coordinates every custom surface that talks about
// "around here" starts from.
//
// Extracted from the dashboard widget route when the outing planner needed the
// same answer. Two sources, in this order: the session-only geolocation override
// the client sends in the body (`latitude`/`longitude`, used when a member
// shares the browser's position), then the city saved on the account by
// `PUT /api/weather/location`.
// =============================================================================

import type { AuthRequest } from '../../middleware/auth';
import { query } from '../../db';

export interface ResolvedCoords {
    latitude: number;
    longitude: number;
    /** null when the coordinates come from the browser, not from a saved city. */
    city: string | null;
}

export const resolveCoordinates = async (req: AuthRequest): Promise<ResolvedCoords | null> => {
    const bodyLat = typeof req.body?.latitude === 'number' ? req.body.latitude : null;
    const bodyLon = typeof req.body?.longitude === 'number' ? req.body.longitude : null;
    if (bodyLat !== null && bodyLon !== null && Number.isFinite(bodyLat) && Number.isFinite(bodyLon)) {
        return { latitude: bodyLat, longitude: bodyLon, city: null };
    }

    const userRow = await query('SELECT city, latitude, longitude FROM users WHERE id = $1', [
        req.actualUserId,
    ]);
    const u = userRow.rows[0] as
        | {
              city: string | null;
              latitude: string | number | null;
              longitude: string | number | null;
          }
        | undefined;

    if (!u || u.latitude === null || u.longitude === null) return null;
    return {
        latitude: Number(u.latitude),
        longitude: Number(u.longitude),
        city: u.city ?? null,
    };
};
