// Every schema change from 1.7.2 on goes here, appended at the end, never
// inserted, edited or removed once shipped. See runner.ts for the rules.
//
//   {
//       id: 'core/0001-short-description',
//       statements: [
//           'ALTER TABLE ... ',
//       ],
//   },
//
// Each migration runs once, inside a transaction, so it does not need to be
// idempotent (no IF NOT EXISTS required), and a failure leaves nothing behind.
// Ids are namespaced: 'core/' for this repository. A downstream build that
// carries its own migrations uses its own namespace and its own list.

import type { Migration } from './runner';

export const coreMigrations: readonly Migration[] = [
    {
        // Recurring budget items move from "every month on debit_day" to a real
        // schedule: a start date, a frequency (daily to yearly), an interval and
        // an optional end. Items can also be income. Existing items become
        // monthly schedules that behave exactly as before, and every month
        // already marked as paid keeps its mark.
        id: 'core/0001-budget-recurrence',
        statements: [
            'ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS is_expense BOOLEAN NOT NULL DEFAULT true',
            'ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS start_date DATE',
            "ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS recurrence_frequency VARCHAR(16) NOT NULL DEFAULT 'monthly'",
            'ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1',
            'ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS recurrence_until DATE',
            // Start in the earlier of the month the item was created and the
            // first month anyone marked it paid, on its debit day, clamped to
            // the month's last day (the 31st in April is the 30th).
            `UPDATE recurring_expenses re
             SET start_date = (
                 SELECT (b.m + (LEAST(re.debit_day,
                                      EXTRACT(DAY FROM (b.m + interval '1 month' - interval '1 day'))::int) - 1))::date
                 FROM (
                     SELECT date_trunc('month', LEAST(
                         COALESCE(re.created_at, now()),
                         COALESCE(
                             (SELECT min(make_date(l.year, l.month, 1))::timestamp
                              FROM recurring_expense_logs l
                              WHERE l.recurring_expense_id = re.id),
                             COALESCE(re.created_at, now())
                         )
                     ))::date AS m
                 ) b
             )
             WHERE start_date IS NULL`,
            'ALTER TABLE recurring_expenses ALTER COLUMN start_date SET NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_recurring_expenses_start_date ON recurring_expenses(start_date)',
            // Paid marks were one per month; a weekly item needs one per
            // occurrence. Existing marks land on the month's debit day, clamped
            // the same way, which is exactly where the new schedule puts them.
            'ALTER TABLE recurring_expense_logs ADD COLUMN IF NOT EXISTS occurrence_date DATE',
            `UPDATE recurring_expense_logs rel
             SET occurrence_date = make_date(rel.year, rel.month, 1) + (
                 LEAST(re.debit_day,
                       EXTRACT(DAY FROM (make_date(rel.year, rel.month, 1) + interval '1 month' - interval '1 day'))::int) - 1
             )
             FROM recurring_expenses re
             WHERE re.id = rel.recurring_expense_id
               AND rel.occurrence_date IS NULL`,
            'ALTER TABLE recurring_expense_logs ALTER COLUMN occurrence_date SET NOT NULL',
            'ALTER TABLE recurring_expense_logs DROP CONSTRAINT IF EXISTS recurring_expense_logs_recurring_expense_id_month_year_key',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_expense_logs_occurrence ON recurring_expense_logs(recurring_expense_id, occurrence_date)',
        ],
    },
    {
        // A calendar event can carry a budget item (one-off or recurring), kept
        // in step with the event's date and recurrence. Deleting the budget item
        // removes its event; deleting the event only unlinks, so money records
        // are only ever deleted from the Budget page.
        id: 'core/0002-calendar-budget-link',
        statements: [
            'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS linked_budget_entry_id UUID REFERENCES budget_entries(id) ON DELETE SET NULL',
            'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS linked_recurring_expense_id UUID REFERENCES recurring_expenses(id) ON DELETE SET NULL',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_linked_budget_entry ON appointments(linked_budget_entry_id) WHERE linked_budget_entry_id IS NOT NULL',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_linked_recurring_expense ON appointments(linked_recurring_expense_id) WHERE linked_recurring_expense_id IS NOT NULL',
        ],
    },
    {
        // Each member chooses the first day of their week (ISO numbering,
        // Monday = 1 ... Sunday = 7). NULL means automatic: it follows the
        // regional conventions of the member's language and browser.
        id: 'core/0003-week-start',
        statements: [
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS week_start_day SMALLINT CHECK (week_start_day BETWEEN 1 AND 7)',
        ],
    },
    {
        // Reminders at any offset before an appointment (in minutes, up to four
        // weeks), several per appointment, instead of the two fixed "30 minutes"
        // and "1 hour" flags. The flags stay, kept in step, for older clients.
        // Each reminder sent is logged per occurrence, so a recurring event
        // reminds before every occurrence and never twice for the same one.
        id: 'core/0004-appointment-reminders',
        statements: [
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER[] NOT NULL DEFAULT '{}'",
            `UPDATE appointments
             SET reminder_minutes = array_remove(ARRAY[
                 CASE WHEN reminder_30min THEN 30 END,
                 CASE WHEN reminder_1hour THEN 60 END
             ], NULL)
             WHERE reminder_30min OR reminder_1hour`,
            `CREATE TABLE IF NOT EXISTS appointment_reminder_log (
                appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
                occurrence_start TIMESTAMP NOT NULL,
                minutes_before INTEGER NOT NULL,
                sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (appointment_id, occurrence_start, minutes_before)
            )`,
            'CREATE INDEX IF NOT EXISTS idx_appointment_reminder_log_sent_at ON appointment_reminder_log(sent_at)',
        ],
    },
    {
        // Calendars followed by address (Google Calendar's secret iCal address,
        // Outlook, Apple, Proton, a school's public calendar...). Their events
        // are copied into appointments and refreshed on a schedule; external_uid
        // and external_hash let a refresh update or remove exactly what changed.
        // A one-off .ics file import uses the same columns without a
        // subscription, so importing the same file twice updates, not doubles.
        id: 'core/0005-calendar-subscriptions',
        statements: [
            `CREATE TABLE IF NOT EXISTS calendar_subscriptions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                encrypted_url TEXT NOT NULL,
                url_host VARCHAR(255) NOT NULL,
                color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
                family_member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                last_synced_at TIMESTAMPTZ,
                last_error TEXT,
                event_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`,
            'CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_user ON calendar_subscriptions(user_id)',
            'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES calendar_subscriptions(id) ON DELETE CASCADE',
            'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS external_uid TEXT',
            'ALTER TABLE appointments ADD COLUMN IF NOT EXISTS external_hash TEXT',
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_external_uid
             ON appointments(user_id, (COALESCE(subscription_id, '00000000-0000-0000-0000-000000000000'::uuid)), external_uid)
             WHERE external_uid IS NOT NULL`,
            'CREATE INDEX IF NOT EXISTS idx_appointments_subscription ON appointments(subscription_id) WHERE subscription_id IS NOT NULL',
        ],
    },
    {
        // Recipes synced from Tandoor or Mealie stored their ingredients as
        // { name, quantity, unit } and their steps as { step, text }, where the
        // app expects lines of text: such recipes could not be opened, edited
        // or sent to the shopping list. They become lines ("250 g pâtes"); a
        // Mealie name already starts with its quantity and is kept as is.
        id: 'core/0006-recipe-text-lines',
        statements: [
            `UPDATE recipes
             SET ingredients = COALESCE((
                 SELECT jsonb_agg(line) FROM (
                     SELECT CASE
                         WHEN jsonb_typeof(e) <> 'object' THEN e
                         WHEN COALESCE(e->>'quantity', '') = ''
                              OR position(e->>'quantity' IN COALESCE(e->>'name', '')) = 1
                             THEN to_jsonb(trim(COALESCE(e->>'name', '')))
                         ELSE to_jsonb(trim(concat_ws(' ', e->>'quantity', NULLIF(e->>'unit', ''), NULLIF(e->>'name', ''))))
                     END AS line
                     FROM jsonb_array_elements(ingredients) WITH ORDINALITY AS t(e, n)
                     ORDER BY n
                 ) lines
                 WHERE line <> '""'::jsonb
             ), '[]'::jsonb)
             WHERE jsonb_typeof(ingredients) = 'array'
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(ingredients) e WHERE jsonb_typeof(e) = 'object')`,
            `UPDATE recipes
             SET instructions = COALESCE((
                 SELECT jsonb_agg(line) FROM (
                     SELECT CASE
                         WHEN jsonb_typeof(e) = 'object' THEN to_jsonb(trim(COALESCE(e->>'text', '')))
                         ELSE e
                     END AS line
                     FROM jsonb_array_elements(instructions) WITH ORDINALITY AS t(e, n)
                     ORDER BY n
                 ) lines
                 WHERE line <> '""'::jsonb
             ), '[]'::jsonb)
             WHERE jsonb_typeof(instructions) = 'array'
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(instructions) e WHERE jsonb_typeof(e) = 'object')`,
        ],
    },
    // FORK-START: custom-migrations
    {
        // Per-user location: city + geocoded coordinates, used by the dashboard
        // weather / clothing / activities widgets. All four columns are
        // nullable so existing accounts keep working; the widget shows an
        // empty-state CTA until a city is set.
        //
        // The id is in the reserved `custom/` namespace on purpose: `core/` is
        // upstream's sequence, and upstream ends at core/0006, so the next
        // migration it ships takes core/0007.
        id: 'custom/0001-users-location',
        statements: [
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(120)',
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code CHAR(2)',
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(8, 5)',
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(8, 5)',
        ],
    },
    {
        // Imported receipts and bills keep their line detail. The budget entries
        // a user actually sees are linked to the receipt (receipt_id), so one
        // row on the Budget page can be opened to show what was in the ticket,
        // a receipt can be deleted with its entries in one go, and the lines
        // stay available for later analysis.
        //
        // fingerprint is the duplicate guard: same merchant + date + total for
        // the same family = the same ticket scanned twice.
        id: 'custom/0002-budget-receipts',
        statements: [
            `CREATE TABLE IF NOT EXISTS budget_receipts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                merchant VARCHAR(120) NOT NULL DEFAULT '',
                date DATE NOT NULL,
                total DECIMAL(10, 2) NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
                document_type VARCHAR(16) NOT NULL DEFAULT 'receipt',
                category VARCHAR(50) NOT NULL,
                import_mode VARCHAR(16) NOT NULL DEFAULT 'itemized',
                source_name VARCHAR(160),
                fingerprint VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, fingerprint)
            )`,
            `CREATE TABLE IF NOT EXISTS budget_receipt_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                receipt_id UUID NOT NULL REFERENCES budget_receipts(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                label VARCHAR(160) NOT NULL,
                quantity DECIMAL(10, 3) NOT NULL DEFAULT 1,
                unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
                amount DECIMAL(10, 2) NOT NULL,
                category VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            'CREATE INDEX IF NOT EXISTS idx_budget_receipts_user_date ON budget_receipts(user_id, date)',
            'CREATE INDEX IF NOT EXISTS idx_budget_receipt_items_receipt ON budget_receipt_items(receipt_id)',
            // Deleting a receipt removes the entries it created: they are the
            // same expense, grouped.
            'ALTER TABLE budget_entries ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES budget_receipts(id) ON DELETE CASCADE',
            'CREATE INDEX IF NOT EXISTS idx_budget_entries_receipt ON budget_entries(receipt_id)',
        ],
    },
    {
        // Lunchboxes: one row per child per day, four free-text components. The
        // fork keeps them in its own table (upstream's meal_plans has one row
        // per date+meal type and no notion of "for whom"), which is also why the
        // upstream meal planner needs no change at all.
        id: 'custom/0003-lunchboxes',
        statements: [
            `CREATE TABLE IF NOT EXISTS custom_lunchboxes (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
                date DATE NOT NULL,
                main VARCHAR(200),
                fruit VARCHAR(200),
                snack VARCHAR(200),
                drink VARCHAR(200),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, family_member_id, date)
            )`,
            'CREATE INDEX IF NOT EXISTS idx_custom_lunchboxes_user_date ON custom_lunchboxes(user_id, date)',
            'CREATE INDEX IF NOT EXISTS idx_custom_lunchboxes_member_date ON custom_lunchboxes(family_member_id, date)',
        ],
    },
    {
        // The pantry: what the household actually has at home, with an optional
        // expiry date, a low-stock threshold and one optional lunchbox bucket.
        //
        // It is the source of truth the fork was missing. The lunchbox AI dialog
        // kept its four chip lists in localStorage, the Grocy integration only
        // imported the shopping list, and receipt lines were archived without
        // ever feeding anything — all three now read or write this table instead.
        //
        // name_key is the folded name (lib/pantry.custom.ts) used for merging:
        // 'Œufs', 'oeufs' and 'OEUFS ' are one row. custom_pantry_imports is the
        // receipt-import guard (one import per receipt); the Grocy import is
        // idempotent by name and needs no guard.
        id: 'custom/0004-pantry',
        statements: [
            `CREATE TABLE IF NOT EXISTS custom_pantry_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(160) NOT NULL,
                name_key VARCHAR(160) NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'Autre',
                quantity DECIMAL(10, 3) NOT NULL DEFAULT 1,
                unit VARCHAR(50),
                location VARCHAR(16) NOT NULL DEFAULT 'pantry',
                expires_on DATE,
                low_stock_threshold DECIMAL(10, 3),
                lunchbox_bucket VARCHAR(16),
                notes TEXT,
                source VARCHAR(16) NOT NULL DEFAULT 'manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS custom_pantry_imports (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                source VARCHAR(16) NOT NULL,
                source_ref VARCHAR(160) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, source, source_ref)
            )`,
            'CREATE INDEX IF NOT EXISTS idx_custom_pantry_user ON custom_pantry_items(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_custom_pantry_name ON custom_pantry_items(user_id, name_key)',
            'CREATE INDEX IF NOT EXISTS idx_custom_pantry_expiry ON custom_pantry_items(user_id, expires_on)',
        ],
    },
    {
        // Folds the duplicates that predate the merge invariant, so the two
        // UNIQUE indexes below can be created on a database that is not empty.
        //
        // Why a second "0005": it must run BEFORE custom/0005-pantry-name-unique,
        // and the runner applies the registry in array order (validateRegistry
        // checks ids for shape and uniqueness only, no ordering). A fresh
        // database has nothing to fold; an instance that ran an earlier revision
        // of this fork — the SELECT-then-INSERT path the index below replaces —
        // can hold two owned rows sharing (user_id, name_key), and a bare
        // CREATE UNIQUE INDEX would then raise 23505: the migration throws, the
        // runner rethrows and the server dies at startup, with 0005 unrecorded so
        // nothing after it ever runs and no later migration can repair it. This
        // id keeps the array in non-decreasing numeric order and the step name
        // says what it does.
        //
        // Naturally idempotent either way (versioned, and a second run finds no
        // group with count(*) > 1): the surviving row (lowest id) takes the
        // summed quantity, the rest go. Grocy rows are untouched — they coexist
        // with the family's own row by design (see the index below).
        id: 'custom/0005-pantry-dedupe',
        statements: [
            `UPDATE custom_pantry_items p
                SET quantity = folded.total
               FROM (
                    SELECT user_id, name_key, min(id::text)::uuid AS keep_id, sum(quantity) AS total
                      FROM custom_pantry_items
                     WHERE source <> 'grocy'
                     GROUP BY user_id, name_key
                    HAVING count(*) > 1
               ) folded
              WHERE p.id = folded.keep_id`,
            `DELETE FROM custom_pantry_items p
             USING (
                    SELECT user_id, name_key, min(id::text)::uuid AS keep_id
                      FROM custom_pantry_items
                     WHERE source <> 'grocy'
                     GROUP BY user_id, name_key
                    HAVING count(*) > 1
             ) folded
              WHERE p.user_id = folded.user_id
                AND p.name_key = folded.name_key
                AND p.source <> 'grocy'
                AND p.id <> folded.keep_id`,
        ],
    },
    {
        // The merge invariant, enforced by the database instead of by a
        // SELECT-then-INSERT: two concurrent merges (a double-clicked "stock from
        // shopping", a retried import) used to both find no row and both insert,
        // splitting one product's quantity across duplicates that later merges
        // only half-updated.
        //
        // Two PARTIAL unique indexes, not one on (user_id, name_key): a Grocy row
        // and a hand-kept row for the same product are meant to coexist (the
        // Grocy sync matches `name_key` AND `source = 'grocy'` so it never
        // touches what the family typed). 'manual', 'receipt' and 'shopping' rows
        // share the other index.
        id: 'custom/0005-pantry-name-unique',
        statements: [
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_pantry_name_owned
                ON custom_pantry_items(user_id, name_key) WHERE source <> 'grocy'`,
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_pantry_name_grocy
                ON custom_pantry_items(user_id, name_key) WHERE source = 'grocy'`,
        ],
    },
    {
        // The receipt lines the pantry import does NOT stock by itself: a
        // service, a fee, a line the model could not name generically. They wait
        // here — with the printed label, the proposed name, the quantity and the
        // unit — until someone confirms or dismisses them on the pantry page, so
        // a receipt never silently fills the stock with guesses and never drops
        // a line either.
        //
        // ON DELETE CASCADE on the receipt: the lines came from that ticket, so
        // deleting the receipt takes its queue with it (the products already
        // merged into the pantry stay — they are real stock).
        id: 'custom/0006-pantry-pending',
        statements: [
            `CREATE TABLE IF NOT EXISTS custom_pantry_pending (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                receipt_id UUID NOT NULL REFERENCES budget_receipts(id) ON DELETE CASCADE,
                label VARCHAR(160) NOT NULL,
                item VARCHAR(160) NOT NULL DEFAULT '',
                quantity DECIMAL(10, 3) NOT NULL DEFAULT 1,
                unit VARCHAR(50),
                category VARCHAR(50) NOT NULL DEFAULT 'Autre',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE INDEX IF NOT EXISTS idx_custom_pantry_pending_user
                ON custom_pantry_pending(user_id)`,
        ],
    },
    {
        // The receipt-import guard now names the TICKET (budget_receipts.
        // fingerprint: merchant + date + total, unique per family), not the
        // receipt row. With the row id, deleting an imported receipt and
        // scanning the same ticket again made a fresh id, the guard missed, and
        // the same groceries were counted into the pantry twice.
        //
        // Rows whose receipt was already deleted cannot be mapped (the id is all
        // they hold): they keep it, match no fingerprint, and stay inert. The
        // products they counted are still in the pantry, which is the point.
        id: 'custom/0007-pantry-guard-fingerprint',
        statements: [
            `UPDATE custom_pantry_imports pi
                SET source_ref = r.fingerprint
               FROM budget_receipts r
              WHERE pi.source = 'receipt'
                AND pi.user_id = r.user_id
                AND pi.source_ref = r.id::text`,
        ],
    },
    {
        // Barcode scanning: a scanned EAN is looked up on Open Food Facts and
        // cached in custom_products, then used as the key for a promotion
        // watchlist and the promo prices the family logs in stores.
        //
        // No upstream table is touched. The link from a shopping-list row to the
        // barcode it was scanned from lives in its own table, keyed by the
        // shopping item's id, so shopping_items keeps upstream's shape.
        id: 'custom/0008-product-scan',
        statements: [
            `CREATE TABLE IF NOT EXISTS custom_products (
                barcode VARCHAR(13) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                brand VARCHAR(160),
                category VARCHAR(50),
                image_url TEXT,
                quantity VARCHAR(50),
                unit VARCHAR(20),
                nutriscore_grade VARCHAR(1),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS custom_promo_watchlist (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                barcode VARCHAR(13) NOT NULL REFERENCES custom_products(barcode) ON DELETE CASCADE,
                target_price DECIMAL(10, 2),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, barcode)
            )`,
            `CREATE TABLE IF NOT EXISTS custom_promo_prices (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                barcode VARCHAR(13) NOT NULL REFERENCES custom_products(barcode) ON DELETE CASCADE,
                store_name VARCHAR(120),
                promo_price DECIMAL(10, 2) NOT NULL,
                regular_price DECIMAL(10, 2),
                notes TEXT,
                logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS custom_shopping_item_barcodes (
                shopping_item_id UUID PRIMARY KEY REFERENCES shopping_items(id) ON DELETE CASCADE,
                barcode VARCHAR(13) NOT NULL
            )`,
            // Only the one index neither table already carries: `user_id` is the
            // leading column of the watchlist's UNIQUE, and the barcode link is
            // keyed by its primary key.
            'CREATE INDEX IF NOT EXISTS idx_promo_prices_user_barcode ON custom_promo_prices(user_id, barcode)',
        ],
    },
    {
        // PrijsProfeet filters by store, category, price and so on, but it has no
        // "never show me this" — a family that does not want a brand or a product
        // has to be spared it on our side, after the upstream page comes back
        // (see lib/promoExclusions.custom.ts). The terms are keyed by the same
        // user_id every custom table uses, so the exclusion is the household's
        // and follows it from one device to the next.
        //
        // The term is stored normalized (lowercase, no accents): the UNIQUE is
        // then meaningful, and a second "Café" typed differently is not a second
        // row.
        id: 'custom/0009-promo-exclusions',
        statements: [
            `CREATE TABLE IF NOT EXISTS custom_promo_exclusions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                term VARCHAR(40) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, term)
            )`,
        ],
    },
    {
        // Three values per receipt line, so the analytics page can add up what the
        // family bought instead of only what it spent: `product` is the brand-free
        // name, `unit` the unit the ticket printed, and `content` how much product
        // the line holds in that unit ('RIJST BASMATI 5KG' → 5, quantity 1). The
        // import already reads all three off the ticket (`pantry_item`,
        // `pantry_unit`, `pantry_content` in ai/receipt.custom.ts) and used to drop
        // them. `content` is NULL when the ticket does not say how much the line
        // holds; the quantity is then a pack count. Nullable: lines imported before
        // this migration keep NULL, and the aggregation falls back to the label and
        // to a pack count.
        id: 'custom/0010-receipt-item-product',
        statements: [
            'ALTER TABLE budget_receipt_items ADD COLUMN IF NOT EXISTS product VARCHAR(160)',
            'ALTER TABLE budget_receipt_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50)',
            'ALTER TABLE budget_receipt_items ADD COLUMN IF NOT EXISTS content DECIMAL(10,3)',
        ],
    },
    {
        // A queued line whose amount nobody knows must be ASKED FOR, not stocked
        // as 1. Before, the import stored a pack count under the pack's unit, so
        // a 500 g broccoli pack became 'Broccoli 1 g'; the fix keeps such a line
        // in the queue until the family says how much it holds. The flag is the
        // queue's half of the question: the pantry page reads it and the confirm
        // route refuses a line that needs an amount but was sent none.
        //
        // Existing rows are false: they were queued by an import that could not
        // know any better, and asking for an amount they already carry (or were
        // dismissed from) would be a new question for old data.
        id: 'custom/0011-pantry-pending-amount',
        statements: [
            'ALTER TABLE custom_pantry_pending ADD COLUMN IF NOT EXISTS needs_amount BOOLEAN NOT NULL DEFAULT false',
        ],
    },
    // FORK-END: custom-migrations
];
