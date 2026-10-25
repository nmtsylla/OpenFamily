#!/usr/bin/env node
// Fills the amount of receipt lines imported before it was stored.
//
// `budget_receipt_items` gained `product` / `unit` / `content` in
// `custom/0010-receipt-item-product`. Lines imported before that keep NULL, and
// the analytics route infers their amount from the label at read time. This
// script writes the same inference into the row, so the amount is data every
// consumer sees (the per-receipt "add to pantry" path included) instead of being
// recomputed on every request.
//
// It only fills what the ticket itself proves: the size a label prints
// ('RIJST BASMATI 5KG', '6x33cl', '15x8g') or a weighed quantity. A line whose
// label prints no size is LEFT ALONE and reported: unit price cannot recover it
// (a ticket prints a per-kg price or a promo), so only the family can answer it.
//
// Respects the same env as the server (POSTGRES_*, CUSTOM_POSTGRES_SSL), so:
//
//   npx tsx scripts/backfill-receipt-amounts.ts         # dry run (the report)
//   npx tsx scripts/backfill-receipt-amounts.ts --yes   # write the amounts
//
// Idempotent: only rows whose `content` is NULL are considered, so a second run
// reports nothing. One transaction: either every inferred amount is written or
// none is.
import { Pool } from 'pg';
import { inferLineAmount } from '../server/src/custom/lib/quantityInference.custom';

interface Row {
    id: string;
    label: string;
    quantity: string;
    unit: string | null;
    amount: string;
}

interface Plan {
    id: string;
    content: number;
    unit: string;
    source: string;
}

interface Unknown {
    label: string;
    quantity: number;
    amount: number;
}

const APPLY = process.argv.includes('--yes');

const sslMode = (process.env.CUSTOM_POSTGRES_SSL || 'disable').toLowerCase();
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'openfamily',
    user: process.env.POSTGRES_USER || 'openfamily',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
    ssl: sslMode === 'disable' || sslMode === '' ? undefined : { rejectUnauthorized: sslMode === 'verify-full' },
    connectionTimeoutMillis: parseInt(process.env.CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS || '5000', 10),
    max: 1,
});

const fold = (value: string): string =>
    value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

const main = async () => {
    const rows = (await pool.query(
        `SELECT id, label, quantity, unit, amount
           FROM budget_receipt_items
          WHERE content IS NULL
          ORDER BY label`,
    )).rows as Row[];

    const plans: Plan[] = [];
    const unknown: Unknown[] = [];
    const sources = new Map<string, number>();

    for (const row of rows) {
        const quantity = Number(row.quantity);
        const amount = Number(row.amount);
        const hint = inferLineAmount({
            label: String(row.label ?? ''),
            quantity: Number.isFinite(quantity) ? quantity : 1,
            unit: row.unit,
        });
        if (hint) {
            plans.push({ id: row.id, content: hint.content, unit: hint.unit, source: hint.source });
            sources.set(hint.source, (sources.get(hint.source) ?? 0) + 1);
        } else {
            unknown.push({ label: String(row.label ?? ''), quantity, amount });
        }
    }

    console.log(`${rows.length} line(s) without an amount`);
    console.log(`${plans.length} can take the amount their label prints ${JSON.stringify(Object.fromEntries(sources))}`);
    console.log(`${unknown.length} cannot be inferred\n`);

    if (plans.length > 0) {
        console.log('amounts to write:');
        for (const plan of plans.slice(0, 20)) {
            const row = rows.find((r) => r.id === plan.id)!;
            console.log(`  ${row.label} → ${plan.content} ${plan.unit} (${plan.source})`);
        }
        if (plans.length > 20) console.log(`  … and ${plans.length - 20} more`);
        console.log('');
    }

    if (unknown.length > 0) {
        const groups = new Map<string, { label: string; lines: number; amount: number }>();
        for (const row of unknown) {
            const key = fold(row.label);
            const group = groups.get(key) ?? { label: row.label, lines: 0, amount: 0 };
            group.lines += 1;
            group.amount = Math.round((group.amount + row.amount) * 100) / 100;
            groups.set(key, group);
        }
        console.log('left for the family (no size on the ticket):');
        for (const group of [...groups.values()].sort((a, b) => b.amount - a.amount)) {
            console.log(`  ${group.label} — ${group.lines} line(s), €${group.amount.toFixed(2)}`);
        }
        console.log('');
    }

    if (!APPLY) {
        console.log('dry run: nothing written. Re-run with --yes to store these amounts.');
        await pool.end();
        return;
    }

    if (plans.length === 0) {
        console.log('nothing to write.');
        await pool.end();
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const plan of plans) {
            await client.query(
                'UPDATE budget_receipt_items SET content = $2, unit = $3 WHERE id = $1 AND content IS NULL',
                [plan.id, plan.content, plan.unit],
            );
        }
        await client.query('COMMIT');
        console.log(`written: ${plans.length} line(s).`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }

    await pool.end();
};

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
