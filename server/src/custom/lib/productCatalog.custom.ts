// =============================================================================
// The product catalog: everything the family can name, not only what it bought.
//
// The products card on the analytics page is about a date range and a screenful.
// This page is about the names themselves: every pantry row is a product even
// when nothing was bought, every receipt group that no pantry row declares is a
// product of its own, and one list holds both. That is what lets the family open
// 'Riz basmati' and add 'AH Basmati' to it, or rename an untracked product.
//
// Pure: no database, no clock. The route keeps the SQL.
// =============================================================================

import { pantryHeadName, pantryNameKey } from './pantry.custom';
import type { PurchasedProduct, PurchaseUnit } from './productAnalytics.custom';

export interface CatalogPantryRow {
    id: string;
    /** The stored name, aliases included: 'Rijst - AH Basmati - Basmati rijst'. */
    name: string;
    quantity: number;
    unit: string | null;
}

export interface CatalogProduct {
    /** Folded group key: the pantry row's folded name, or the label of an untracked product. */
    key: string;
    /** What the family sees: the pantry row's head, or the voted printed spelling. */
    name: string;
    /** The full stored name, null for a product no pantry row declares. */
    pantryName: string | null;
    pantryItemId: string | null;
    /** Every printed spelling the receipts used for this product. */
    names: string[];
    units: PurchaseUnit[];
    amount: number;
    lines: number;
    /** What the pantry holds, null for an untracked product. */
    stock: { quantity: number; unit: string | null } | null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One row per product: the pantry's own rows first (a product exists without a
 * purchase), then the receipt groups nobody declared. A group whose key matches a
 * pantry row is that row's purchase history.
 */
export const buildProductCatalog = (
    pantryRows: readonly CatalogPantryRow[],
    groups: readonly (PurchasedProduct & { key: string; names: string[] })[],
): CatalogProduct[] => {
    const byKey = new Map<string, PurchasedProduct & { key: string; names: string[] }>();
    for (const group of groups) {
        if (!byKey.has(group.key)) byKey.set(group.key, group);
    }

    const products: CatalogProduct[] = [];
    const used = new Set<string>();

    for (const row of pantryRows) {
        const key = pantryNameKey(row.name);
        if (key.length === 0) continue;
        const group = byKey.get(key);
        used.add(key);
        products.push({
            key,
            name: pantryHeadName(row.name),
            pantryName: row.name,
            pantryItemId: row.id,
            names: group?.names ?? [],
            units: group?.units ?? [],
            amount: group?.amount ?? 0,
            lines: group?.lines ?? 0,
            stock: {
                quantity: Number.isFinite(row.quantity) ? row.quantity : 0,
                unit: row.unit ?? null,
            },
        });
    }

    for (const group of groups) {
        if (used.has(group.key)) continue;
        products.push({
            key: group.key,
            name: group.name,
            pantryName: null,
            pantryItemId: null,
            names: group.names,
            units: group.units,
            amount: group.amount,
            lines: group.lines,
            stock: null,
        });
    }

    return products.sort((a, b) => b.amount - a.amount || compareText(a.name, b.name));
};
