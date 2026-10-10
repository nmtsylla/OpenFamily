// =============================================================================
// The one merge rule that puts lines into the pantry table — the SQL the pantry
// library deliberately does not hold (see lib/pantry.custom.ts).
//
// It lives here because two routers need the identical write path: the pantry's
// own bridges (shopping list, Grocy) and the receipt import, which stocks the
// pantry in the same transaction as the budget entries it creates.
// =============================================================================

import { pantryNameKey, type PantryLineSeed } from './pantry.custom';

/**
 * Merge seeds into the pantry: one non-Grocy row per folded name, quantities add
 * up, and a unit only ever fills a hole (the row's own unit wins).
 *
 * A single `INSERT … ON CONFLICT DO UPDATE` on the partial unique index
 * (`custom/0005-pantry-name-unique`), so two concurrent merges cannot both
 * insert: one of them waits and updates. The conflict target deliberately
 * excludes Grocy rows — those are the sync's own, and a hand-typed 'Riz' must
 * not have its quantity overwritten by the next Grocy import.
 *
 * `xmax = 0` is how PostgreSQL reports "this RETURNING row was inserted", which
 * is what tells created from updated.
 *
 * The caller owns the transaction: both routers run this inside their own
 * BEGIN/COMMIT, so a half-merged batch rolls back with the call that caused it.
 */
export const mergeIntoPantry = async (
    client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
    userId: string,
    seeds: PantryLineSeed[],
    source: string,
): Promise<{ created: number; updated: number }> => {
    let created = 0;
    let updated = 0;

    for (const seed of seeds) {
        const key = pantryNameKey(seed.name);
        if (key.length === 0) continue;

        const result = await client.query(
            `INSERT INTO custom_pantry_items
                (user_id, name, name_key, category, quantity, unit, location, source)
             VALUES ($1, $2, $3, $4, $5, $6, 'pantry', $7)
             ON CONFLICT (user_id, name_key) WHERE source <> 'grocy'
             DO UPDATE SET
                quantity = custom_pantry_items.quantity + EXCLUDED.quantity,
                unit = COALESCE(custom_pantry_items.unit, EXCLUDED.unit),
                updated_at = CURRENT_TIMESTAMP
             RETURNING (xmax = 0) AS inserted`,
            [userId, seed.name, key, seed.category, seed.quantity, seed.unit ?? null, source],
        );
        if (result.rows[0]?.inserted) created += 1;
        else updated += 1;
    }

    return { created, updated };
};
