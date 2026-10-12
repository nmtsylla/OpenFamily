// =============================================================================
// Fan a WebSocket update out to a whole family.
//
// `broadcast` is keyed by user id, but the family's shared data (the saved
// weather city, for one) lives on the owner's row: every member's open client
// has to hear about a change there, or their dashboard keeps the old answer
// until the next reload. The member list is the owner plus the rows that point
// at it through `family_owner_id`.
// =============================================================================

import { broadcast, type WsUpdatePayload } from '../../lib/broadcaster';
import { query } from '../../db';

export const notifyFamily = async (ownerId: string, payload: WsUpdatePayload): Promise<void> => {
    const result = await query('SELECT id FROM users WHERE id = $1 OR family_owner_id = $1', [ownerId]);
    for (const row of result.rows as Array<{ id: string }>) {
        broadcast(String(row.id), payload);
    }
};
