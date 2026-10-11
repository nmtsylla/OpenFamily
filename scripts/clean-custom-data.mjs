#!/usr/bin/env node
// Wipes the Budget, Meals and Pantry domains for a fresh start.
//
// DELETE, not TRUNCATE ... CASCADE. appointments.linked_budget_entry_id and
// appointments.linked_recurring_expense_id reference budget_entries /
// recurring_expenses with ON DELETE SET NULL, and a cascading TRUNCATE also
// truncates every referencing table — it would empty `appointments`, which is
// another feature. A plain TRUNCATE would instead fail on that same foreign
// key. Every key below is a UUID (no sequences to restart), so DELETE is
// equivalent and leaves the appointments' dangling links NULLed, as intended.
//
// Respects the same env as the server (POSTGRES_*, CUSTOM_POSTGRES_SSL), so:
//
//   node --env-file=.env scripts/clean-custom-data.mjs         # dry run (counts)
//   node --env-file=.env scripts/clean-custom-data.mjs --yes   # actually delete
//
// Nothing runs outside a single transaction: either every table is cleared or
// none is.
import { Pool } from 'pg';

const GROUPS = {
    budget: [
        'budget_entries',
        'budget_limits',
        'budget_receipts',
        'budget_receipt_items',
        'recurring_expenses',
        'recurring_expense_logs',
        'kakeibo_months',
    ],
    meals: [
        'recipes',
        'meal_plans',
        'custom_lunchboxes',
    ],
    // Barcode scan / promo watchlist feed the pantry and are cleared with it.
    pantry: [
        'custom_pantry_items',
        'custom_pantry_imports',
        'custom_pantry_pending',
        'custom_products',
        'custom_promo_watchlist',
        'custom_promo_prices',
        'custom_shopping_item_barcodes',
    ],
};

// Deliberately NOT cleared: `shopping_items` (its own upstream feature — the
// lunchbox/pantry "add to shopping list" only reads it), `users`,
// `family_members`, `shopping_list_templates`, `appointments`.
const sslMode = (process.env.CUSTOM_POSTGRES_SSL || 'disable').toLowerCase();
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'openfamily',
    user: process.env.POSTGRES_USER || 'openfamily',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
    ssl: sslMode === 'disable' || sslMode === '' ? undefined : { rejectUnauthorized: sslMode === 'verify-full' },
    connectionTimeoutMillis: parseInt(process.env.CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS || '5000'),
    max: 1,
});

const all = Object.entries(GROUPS).flatMap(([group, tables]) => tables.map((t) => [group, t]));

const client = await pool.connect();
try {
    // Only touch tables that exist: an install predating a custom migration
    // must still clean up cleanly.
    const existing = [];
    for (const [group, table] of all) {
        const { rows } = await client.query(
            'SELECT to_regclass($1) IS NOT NULL AS present',
            [`public.${table}`],
        );
        if (rows[0].present) existing.push([group, table]);
        else console.warn(`skip   ${table} (absent)`);
    }

    // Dry run first: print what a real run would remove.
    let total = 0;
    for (const [group, table] of existing) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
        total += rows[0].n;
        console.log(`${String(rows[0].n).padStart(8)}  ${group.padEnd(7)} ${table}`);
    }
    console.log(`\n${total} row(s) across ${existing.length} table(s).`);

    if (!process.argv.includes('--yes')) {
        console.log('Dry run. Re-run with --yes to delete.');
    } else {
        await client.query('BEGIN');
        for (const [, table] of existing) await client.query(`DELETE FROM ${table}`);
        await client.query('COMMIT');
        console.log(`Deleted ${total} row(s) in one transaction.`);
    }
} catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
} finally {
    client.release();
    await pool.end();
}
