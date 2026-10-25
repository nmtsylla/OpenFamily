// What the family BOUGHT over a period, not only what it spent.
//
// The receipt import stores, per line, the printed label and the brand-free
// product name with the unit the ticket showed and how much product the line
// holds in it (budget_receipt_items.product / .unit / .content, migration
// custom/0010). This module folds those lines into one row per product and
// adds the amounts up inside each unit bucket only: 5 kg and 3 pieces are two
// answers, never 8 of something.
//
// A line carries a PACK COUNT (how many packs were bought) and a CONTENT AMOUNT
// (how much product those packs hold, in the printed unit): 'RIJST BASMATI 5KG'
// is quantity 1, content 5 kg. The module adds the content, so the page can say
// "5 kg" instead of "1 kg", and falls back to the pack count when the ticket
// printed no content.
//
// Pure: no database, no clock. The route keeps the SQL, the test
// (test/productAnalytics.custom.test.ts) covers the rules.
//
// A line imported before custom/0010, or typed by hand, has no product, no unit
// and no content. It then groups by its printed label and its quantity counts
// packs.

import { pantryNameKey } from './pantry.custom';

export interface PurchaseLine {
    label: string;
    /** Brand-free product name the import stored; null on older rows and hand-typed lines. */
    product: string | null;
    /** Unit the ticket printed ('kg', 'L', 'pièce'); null when it printed none. */
    unit: string | null;
    /** Packs bought: always a real count, whatever the ticket printed. */
    quantity: number;
    /** Total content of the line in `unit`, 0 when the ticket did not say. */
    content: number;
    amount: number;
}

export interface PurchaseUnit {
    /** Printed unit, null when none: the quantity is then a count of packs. */
    unit: string | null;
    /** Total content in that unit, 0 when no line of the bucket said how much it held. */
    content: number;
    /** Lines in this unit that did not say how much they held: `content` is then a floor, not a total. */
    unsized: number;
    /** Packs bought, always counted. */
    packs: number;
}

export interface PurchasedProduct {
    /** Display name: the most frequent spelling of the product in the group. */
    name: string;
    amount: number;
    /** Receipt lines this product appeared on. */
    lines: number;
    /** One entry per unit, heaviest first, the unit-less bucket last. */
    units: PurchaseUnit[];
}

export interface ProductPurchases {
    byProduct: PurchasedProduct[];
    totals: { amount: number; lines: number; products: number; hidden: number };
}

export const MAX_PRODUCTS = 20;

const roundTo = (value: number, digits: number): number => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

/** A non-finite number would poison every sum: it counts as nothing instead. */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/** Code-unit order, not locale order: the list must not move between loads. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Most frequent spelling, ties broken by the shorter text, then alphabetically. */
const pickSpelling = (counts: Map<string, number>): string => {
    let best = '';
    let bestCount = -1;
    for (const [text, count] of counts) {
        const better =
            count > bestCount ||
            (count === bestCount &&
                (text.length < best.length || (text.length === best.length && compareText(text, best) < 0)));
        if (better) {
            best = text;
            bestCount = count;
        }
    }
    return best;
};

interface UnitBucket {
    /** Raw unit text → how many lines printed it. */
    texts: Map<string, number>;
    /** Content of the lines that said how much they held. */
    content: number;
    /** Lines that printed this unit but not how much they held. */
    unsized: number;
    /** Packs of every line, content known or not. */
    packs: number;
}

interface ProductGroup {
    /** Raw display text (`product || label`) → how many lines carried it. */
    texts: Map<string, number>;
    amount: number;
    lines: number;
    units: Map<string, UnitBucket>;
}

export const buildProductPurchases = (
    lines: readonly PurchaseLine[],
    max = MAX_PRODUCTS,
): ProductPurchases => {
    const groups = new Map<string, ProductGroup>();
    const totals = { amount: 0, lines: 0, products: 0, hidden: 0 };

    for (const line of lines) {
        const display = String(line.product || line.label || '');
        const productKey = pantryNameKey(display);
        // An unnamed line (no product, no label) cannot be grouped by anything.
        if (productKey.length === 0) continue;

        const group = groups.get(productKey) ?? { texts: new Map(), amount: 0, lines: 0, units: new Map() };

        group.texts.set(display, (group.texts.get(display) ?? 0) + 1);
        group.amount += finite(line.amount);
        group.lines += 1;

        // The fold is reused so 'Pièce', 'pièce' and 'PIECE' stay one bucket;
        // an empty unit is its own bucket, shown as a pack count.
        const rawUnit = line.unit ? String(line.unit) : '';
        const unitKey = pantryNameKey(rawUnit);
        const bucket = group.units.get(unitKey) ?? { texts: new Map(), content: 0, unsized: 0, packs: 0 };
        if (unitKey.length > 0) {
            bucket.texts.set(rawUnit, (bucket.texts.get(rawUnit) ?? 0) + 1);
            // A content without a unit is not an amount of anything: only a
            // bucket that printed a unit keeps what its lines said they held.
            // A line that printed a unit but no content makes the total a floor,
            // so it is counted instead of being silently left out of the sum.
            const content = finite(line.content);
            if (content > 0) bucket.content += content;
            else bucket.unsized += 1;
        }
        bucket.packs += finite(line.quantity);
        group.units.set(unitKey, bucket);

        groups.set(productKey, group);

        totals.amount += finite(line.amount);
        totals.lines += 1;
    }

    const products: PurchasedProduct[] = Array.from(groups, ([, group]) => {
        const units: PurchaseUnit[] = Array.from(group.units, ([unitKey, bucket]) => ({
            unit: unitKey.length === 0 ? null : pickSpelling(bucket.texts),
            content: unitKey.length === 0 ? 0 : roundTo(bucket.content, 3),
            unsized: unitKey.length === 0 ? 0 : bucket.unsized,
            packs: roundTo(bucket.packs, 3),
        }));

        // Heaviest first — content when a line said how much it held, packs
        // otherwise — the unit-less bucket last: a pack count is the fallback, so
        // it never outranks a printed unit.
        units.sort((a, b) => {
            if (a.unit === null && b.unit !== null) return 1;
            if (b.unit === null && a.unit !== null) return -1;
            return (b.content || b.packs) - (a.content || a.packs) || compareText(a.unit ?? '', b.unit ?? '');
        });

        return {
            name: pickSpelling(group.texts),
            amount: roundTo(group.amount, 2),
            lines: group.lines,
            units,
        };
    });

    products.sort((a, b) => b.amount - a.amount || compareText(a.name, b.name));

    totals.products = products.length;
    const byProduct = products.slice(0, Math.max(0, max));
    totals.hidden = products.length - byProduct.length;
    totals.amount = roundTo(totals.amount, 2);

    return { byProduct, totals };
};
