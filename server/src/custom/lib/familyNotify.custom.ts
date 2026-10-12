import { broadcast, type WsUpdatePayload } from '../../lib/broadcaster';
import { query } from '../../db';

export const notifyFamily = async (ownerId: string, payload: WsUpdatePayload): Promise<void> => {
    const result = await query('SELECT id FROM users WHERE id = $1 OR family_owner_id = $1', [ownerId]);
    for (const row of result.rows as Array<{ id: string }>) {
        broadcast(String(row.id), payload);
    }
};
