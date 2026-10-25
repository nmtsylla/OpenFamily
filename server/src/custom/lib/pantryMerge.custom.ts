// =============================================================================
// The one merge rule that puts lines into the pantry table — the SQL the pantry
// library deliberately does not hold (see lib/pantry.custom.ts).
//
// It lives here because two routers need the identical write path: the pantry's
// own bridges (shopping list, Grocy) and the receipt import, which stocks the
// pantry in the same transaction as the budget entries it creates.
// =============================================================================

import { pantryKeyResolver, type PantryLineSeed } from './pantry.custom';

/**
 * Merge seeds into the pantry: one non-Grocy row per product, quantities add
 * up, and a unit only ever fills a hole (the row's own unit wins).
 *
 * The row a seed lands on is decided by `pantryKeyResolver` against the names
 * already in the pantry: the folded name, or any name an existing row declares
 * ('Uien' and 'Oignon' both land on a pantry that tracks 'Uien - Oignon', in
 * whatever language the ticket prints). The resolved key is what the upsert
 * below targets, so the merge converges on the rows the family already has
 * instead of filling the page with near-copies of them.
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
    if (seeds.length === 0) return { created, updated };

    // Read inside the caller's transaction: the batch sees one snapshot, and the
    // upsert below stays the serialisation point for two concurrent merges.
    const existing = await client.query(
        `SELECT name_key FROM custom_pantry_items
          WHERE user_id = $1 AND source <> 'grocy'
          ORDER BY name_key`,
        [userId],
    );
    const resolveKey = pantryKeyResolver(existing.rows.map((row) => String(row.name_key)));

    for (const seed of seeds) {
        const key = resolveKey(seed.name);
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
