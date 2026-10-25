// =============================================================================
// Pantry rules: what the household has at home (custom_pantry_items).
//
// Pure functions only — no database, no copy. The route keeps the SQL, these
// keep the invariants: a name that fits the column, a quantity that is a real
// number, an expiry date that is a date, and the folded `name_key` every merge
// (receipt import, shopping bridge, Grocy import) compares on.
//
// The merge key is the folded name, with one deliberate exception: a name the
// household's own row declares is one of its names ('Uien' and 'Oignon' both
// land on 'Uien - Oignon') instead of opening a second row — see
// pantryKeyResolver. Two rows for the same product in two locations (one in the
// fridge, one in the cellar) still merge into one on the next import — accepted
// ceiling, noted on the page, split manually.
// =============================================================================

import { isCalendarDate } from './validation.custom';
import { inferLineAmount } from './quantityInference.custom';

/** Where the item is stored. The values are the client's Select options. */
export const PANTRY_LOCATIONS = ['pantry', 'fridge', 'freezer', 'cellar', 'other'] as const;
export type PantryLocation = (typeof PANTRY_LOCATIONS)[number];

/** The bridge to the lunchbox AI: one optional bucket per item. */
export const PANTRY_BUCKETS = ['main', 'fruit', 'snack', 'drink'] as const;
export type PantryBucket = (typeof PANTRY_BUCKETS)[number];

// Caps match the column widths in custom/0004-pantry.
export const MAX_PANTRY_NAME = 160;
export const MAX_PANTRY_UNIT = 50;
export const MAX_PANTRY_CATEGORY = 50;
export const MAX_PANTRY_NOTES = 1000;
/** One import call never inserts more lines than this (receipts, Grocy stock). */
export const MAX_IMPORT_LINES = 500;
/** One shopping-list stock confirmation, same idea: a shopping list, not a dump. */
export const MAX_STOCK_LINES = 100;

/** The category the fork falls back to when the family's list has no match. */
export const DEFAULT_PANTRY_CATEGORY = 'Autre';

/**
 * Merge key: diacritics, case and inner whitespace do not count, so 'Œufs',
 * 'oeufs' and 'OEUFS ' are one row. Truncated to the column width so a long
 * name cannot make two different rows look equal.
 */
export const pantryNameKey = (name: string): string =>
    String(name ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/œ/gi, 'oe')
        .replace(/æ/gi, 'ae')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_PANTRY_NAME);

/** The characters a pantry name uses to hang a qualifier on its product. */
const QUALIFIER_SEPARATOR = /[-–—,;:•·|/()[\]{}«»]/;

/**
 * The names a pantry name declares for its product, folded: 'Uien - Oignon' →
 * ['uien', 'oignon']. A family that writes both languages on one row is saying
 * the product answers to either name, whatever the ticket prints.
 *
 * A multi-word segment stays whole: 'Pommes de terre (sac)' → ['pommes de
 * terre', 'sac'], so 'Pommes' never reaches the potatoes.
 */
export const pantryAliasKeys = (name: string): string[] => {
    const key = pantryNameKey(name);
    if (key.length === 0) return [];
    const segments = key.split(QUALIFIER_SEPARATOR).map((part) => part.trim()).filter((part) => part.length > 0);
    return segments.length > 0 ? segments : [key];
};

/**
 * The folded name up to its first qualifier: 'uien' for 'Uien - Oignon',
 * 'pommes de terre' for 'Pommes de terre (sac)'. Equal to the key above when the
 * name carries no qualifier, which is the common case.
 */
export const pantryHeadKey = (name: string): string => pantryAliasKeys(name)[0] ?? '';

/**
 * What an incoming name adds up to. The folded name itself, or one of the names
 * an EXISTING row declares: a ticket that says 'Uien' — or 'Oignon' — lands on
 * the household's 'Uien - Oignon' row instead of opening a second one, which is
 * the duplicate the family could not unsee.
 *
 * Only a row that is already stored gets to declare aliases, and it declares
 * them by being written: its own text is the family's word that those names are
 * one product. An incoming name declares nothing, so 'Tomates - cerises' or
 * 'Lait - demi-écrémé' opens its own row and stays in it, even when a bare
 * 'Tomates' or 'Lait' is imported alongside — a ticket's qualifier says it is a
 * more precise product, and two lines of the same import are not evidence that
 * they are one.
 *
 * Whole names only, and never just their words: 'Riz' against 'Riz basmati' is
 * two products that look alike, and telling them apart needs the model (the
 * extraction is offered the family's names, ai/receipt.custom.ts) or the family
 * itself. Edit distance is deliberately absent: 'poisson' and 'boisson' are one
 * letter apart.
 */
export const pantryKeyResolver = (existingKeys: readonly string[]) => {
    const rows = new Set(existingKeys);
    // declared name → the row that answers to it. First row wins, so the winner
    // does not depend on the order the caller happened to read them in.
    const declared = new Map<string, string>();
    for (const key of existingKeys) {
        for (const alias of pantryAliasKeys(key)) {
            if (alias !== key && !declared.has(alias)) declared.set(alias, key);
        }
    }

    return (name: string): string => {
        const own = pantryNameKey(name);
        if (own.length === 0) return own;
        return rows.has(own) ? own : declared.get(own) ?? own;
    };
};

const cleanText = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
};

/** `Number(value)`, or the fallback when it is not a finite number. */
const toFinite = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(String(value));
    return Number.isFinite(parsed) ? parsed : null;
};

export interface PantryItemInput {
    name: string;
    category: string;
    quantity: number;
    unit: string | null;
    location: PantryLocation;
    expires_on: string | null;
    low_stock_threshold: number | null;
    lunchbox_bucket: PantryBucket | null;
    notes: string | null;
}

/**
 * The one door into the table: every write goes through it, so a bad body can
 * never reach a column. Returns null when there is no usable item at all —
 * an empty name, or a quantity that is present but not a number >= 0.
 */
export const sanitizePantryItem = (raw: unknown): PantryItemInput | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const body = raw as Record<string, unknown>;

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_PANTRY_NAME) : '';
    if (name.length === 0) return null;

    // Absent means 1 (the common case: "I have milk"); present but broken means
    // no item, rather than silently storing 1 under a typo.
    const parsedQuantity = body.quantity === undefined || body.quantity === null || body.quantity === ''
        ? 1
        : toFinite(body.quantity);
    if (parsedQuantity === null || parsedQuantity < 0) return null;

    const threshold = toFinite(body.low_stock_threshold);
    const rawExpiry = typeof body.expires_on === 'string' ? body.expires_on.trim() : '';

    return {
        name,
        category: cleanText(body.category, MAX_PANTRY_CATEGORY) ?? DEFAULT_PANTRY_CATEGORY,
        quantity: parsedQuantity,
        unit: cleanText(body.unit, MAX_PANTRY_UNIT),
        location: PANTRY_LOCATIONS.includes(body.location as PantryLocation)
            ? (body.location as PantryLocation)
            : 'pantry',
        expires_on: isCalendarDate(rawExpiry) ? rawExpiry : null,
        low_stock_threshold: threshold !== null && threshold >= 0 ? threshold : null,
        lunchbox_bucket: PANTRY_BUCKETS.includes(body.lunchbox_bucket as PantryBucket)
            ? (body.lunchbox_bucket as PantryBucket)
            : null,
        notes: cleanText(body.notes, MAX_PANTRY_NOTES),
    };
};

/** At or under the threshold the family set — no threshold, no alert. */
export const isLowStock = (item: { quantity: unknown; low_stock_threshold: unknown }): boolean => {
    const threshold = toFinite(item.low_stock_threshold);
    if (threshold === null) return false;
    const quantity = toFinite(item.quantity);
    if (quantity === null) return false;
    return quantity <= threshold;
};

/**
 * `expiresOn` is a YYYY-MM-DD string and today <= expiresOn <= today + days,
 * both ends inclusive (`days` = 0 means "expires today" only).
 */
export const isExpiringSoon = (expiresOn: string | null, today: Date, days: number): boolean => {
    if (!expiresOn || !isCalendarDate(expiresOn)) return false;
    const expiry = Date.parse(`${expiresOn}T00:00:00Z`);
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const limit = start + Math.max(0, days) * 24 * 60 * 60 * 1000;
    return expiry >= start && expiry <= limit;
};

export interface GrocyStockLine {
    name: string;
    quantity: number;
    expires_on: string | null;
}

/**
 * Grocy GET /api/stock answers
 * `[{ product: { name }, amount, next_best_before_date }]` (zero-amount entries
 * included). Keep only what can become a pantry row: a named product with a
 * positive amount, capped at MAX_IMPORT_LINES.
 */
export const mapGrocyStock = (raw: unknown): GrocyStockLine[] => {
    if (!Array.isArray(raw)) return [];
    const lines: GrocyStockLine[] = [];
    for (const entry of raw) {
        if (lines.length >= MAX_IMPORT_LINES) break;
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const product = row.product;
        const name = product && typeof product === 'object'
            ? cleanText((product as Record<string, unknown>).name, MAX_PANTRY_NAME)
            : null;
        if (!name) continue;
        const amount = toFinite(row.amount);
        if (amount === null || amount <= 0) continue;
        const rawDate = typeof row.next_best_before_date === 'string' ? row.next_best_before_date.slice(0, 10) : '';
        lines.push({
            name,
            quantity: amount,
            expires_on: isCalendarDate(rawDate) ? rawDate : null,
        });
    }
    return lines;
};

export interface PantryLineSeed {
    name: string;
    quantity: number;
    category: string;
    /** Optional: only when the source knows one (a ticket unit, a shopping item). */
    unit?: string | null;
}

/**
 * Receipt lines (`budget_receipt_items`) as pantry seeds. The name is the AI's
 * brand-free `pantry_item` when the line has one, the label otherwise — a line
 * typed by hand, or archived before the extraction asked for that field, keeps
 * its printed text. The amount is how much the line holds: the stored content and
 * unit, else the size its printed label carries (lib/quantityInference.custom.ts),
 * else the number bought as a pack count. That last fallback is why a receipt
 * archived before the amount was stored still lands as 'Broccoli 500 g' instead of
 * 'Broccoli 1 g'.
 */
export const mapReceiptItems = (
    rows: {
        label: string;
        quantity: unknown;
        category: string;
        pantry_item?: string;
        pantry_unit?: string;
        content?: unknown;
    }[],
): PantryLineSeed[] => {
    const seeds: PantryLineSeed[] = [];
    for (const row of rows) {
        if (seeds.length >= MAX_IMPORT_LINES) break;
        const label = cleanText(row?.label, MAX_PANTRY_NAME);
        const name = cleanText(row?.pantry_item, MAX_PANTRY_NAME) ?? label;
        if (!name) continue;
        const quantity = toFinite(row?.quantity);
        const packs = quantity !== null && quantity > 0 ? quantity : 1;
        const printedUnit = cleanText(row?.pantry_unit, MAX_PANTRY_UNIT);
        const content = toFinite(row?.content);
        const amount = content !== null && content > 0 && printedUnit
            ? { content, unit: printedUnit }
            : inferLineAmount({ label: label ?? name, quantity: packs, unit: printedUnit });
        seeds.push({
            name,
            quantity: amount ? amount.content : packs,
            category: cleanText(row?.category, MAX_PANTRY_CATEGORY) ?? DEFAULT_PANTRY_CATEGORY,
            unit: amount ? amount.unit : printedUnit,
        });
    }
    return seeds;
};

export interface PendingReceiptLine {
    /** The printed text of the ticket line, as the family will see it. */
    label: string;
    /** The model's brand-free name, '' when it had none to propose. */
    item: string;
    quantity: number;
    unit: string | null;
    category: string;
    /**
     * The line IS household stock under a usable name, but neither the model nor
     * its label says how much it holds: the family must answer before it can be
     * stocked. A line that is not stock is never asked — it is not a pantry row
     * in the first place.
     */
    needs_amount: boolean;
}

/**
 * The split every receipt import goes through.
 *
 * `stock` — the lines the model called plainly household stock, named, AND whose
 * amount is known (from the model's `pantry_content`, else from the size the
 * label prints): they are merged into the pantry without asking, because asking
 * per line is what makes people stop importing tickets. They are stocked with
 * `quantity = amount.content` in `amount.unit` — how much product the line holds,
 * never the number of packs under the pack's own unit (the '500 g broccoli →
 * Broccoli 1 g' bug).
 * `pending` — everything else: a service, a fee, fuel, an abbreviation nobody
 * can name, a line the model was unsure about, or a stockable line whose amount
 * nobody knows (that one carries `needs_amount`, and the pantry page asks for
 * it). Those wait on the pantry page for the family to name and categorise them;
 * nothing is stocked silently.
 *
 * The rule is deliberately strict — a boolean, a usable generic name and a
 * known amount — so an unreadable line can never be stocked under whatever the
 * ticket happened to print.
 */
export const splitReceiptLines = (
    rows: {
        label: string;
        quantity: unknown;
        category: string;
        pantry_item?: string;
        pantry_unit?: string;
        pantry_content?: number;
        pantry_stock?: boolean;
    }[],
): { stock: PantryLineSeed[]; pending: PendingReceiptLine[] } => {
    const stock: PantryLineSeed[] = [];
    const pending: PendingReceiptLine[] = [];

    for (const row of rows) {
        if (stock.length + pending.length >= MAX_IMPORT_LINES) break;
        const label = cleanText(row?.label, MAX_PANTRY_NAME);
        const item = cleanText(row?.pantry_item, MAX_PANTRY_NAME);
        const name = label ?? item;
        if (!name) continue;

        const quantity = toFinite(row?.quantity);
        const packCount = quantity !== null && quantity > 0 ? quantity : 1;
        const printedUnit = cleanText(row?.pantry_unit, MAX_PANTRY_UNIT);
        const content = toFinite(row?.pantry_content);

        // How much the line holds: what the model read, else the size its label
        // prints. Both are in the canonical unit, so what is stocked is 0.5 kg of
        // broccoli rather than 1 of something.
        const amount = content !== null && content > 0 && printedUnit
            ? { content, unit: printedUnit }
            : inferLineAmount({ label: name, quantity: packCount, unit: printedUnit });

        const category = cleanText(row?.category, MAX_PANTRY_CATEGORY) ?? DEFAULT_PANTRY_CATEGORY;
        const stockable = item !== null && row?.pantry_stock === true;

        if (stockable && amount) {
            stock.push({ name: item, quantity: amount.content, category, unit: amount.unit });
        } else {
            pending.push({
                label: name,
                item: item ?? '',
                quantity: amount ? amount.content : packCount,
                unit: amount ? amount.unit : printedUnit,
                category,
                needs_amount: stockable && !amount,
            });
        }
    }

    return { stock, pending };
};
