// The promotions a family never wants to see again: a brand, a product, a store's
// own label. PrijsProfeet's own filters cover store, category, price and savings,
// but not "not this", so the terms are applied here, on the page it returns.
//
// Storage is per family — the same `user_id` every custom table keys on — so the
// exclusion follows the household across devices, and the scanner's watchlist
// pane honours it too: "never show me this" cannot depend on which screen asked.
//
// Matching is deliberately generous and deliberate about it: a term is compared
// against the offer's product name and brand, case- and accent-insensitively,
// as a substring. Someone who excludes "coca" means every Coca-Cola, not the one
// row they clicked. It is a view preference, never a data change: nothing is
// deleted or hidden from anyone else.

import { query } from '../../db';
import type { PromoOffer } from './prijsprofeet.custom';

/** Long enough for "Pur jus de pomme bio", short enough for a VARCHAR(40). */
const MAX_TERM_LENGTH = 40;
// One letter would hide half the shop, and is a typo rather than an intention.
const MIN_TERM_LENGTH = 2;

/**
 * The stored, comparable form of a term: lowercase, no accents, single spaces.
 * Returns null when there is nothing worth storing.
 */
export const normalizeTerm = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;

    const term = value
        .normalize('NFD')
        // Combining marks, i.e. the accent stripped from the letter before it.
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    if (term.length < MIN_TERM_LENGTH) return null;
    return term.slice(0, MAX_TERM_LENGTH);
};

/** The same normalization, applied to what a term is compared against. */
const comparable = (value: string | null): string => (value ? (normalizeTerm(value) ?? '') : '');

/** Is this offer one the family asked not to see? Name or brand, substring. */
export const isExcluded = (offer: Pick<PromoOffer, 'name' | 'brand'>, terms: readonly string[]): boolean => {
    if (!terms.length) return false;
    const name = comparable(offer.name);
    const brand = comparable(offer.brand);

    return terms.some((term) => name.includes(term) || brand.includes(term));
};

/** The offers left after the family's terms, and how many they removed. */
export const applyExclusions = (
    offers: readonly PromoOffer[],
    terms: readonly string[]
): { offers: PromoOffer[]; hidden: number } => {
    const kept = offers.filter((offer) => !isExcluded(offer, terms));
    return { offers: kept, hidden: offers.length - kept.length };
};

export interface PromoExclusion {
    id: string;
    term: string;
    created_at: string;
}

/** The family's terms, oldest first. The id is what the UI deletes by. */
export async function exclusionsOf(userId: string): Promise<PromoExclusion[]> {
    const result = await query(
        'SELECT id, term, created_at FROM custom_promo_exclusions WHERE user_id = $1 ORDER BY created_at',
        [userId]
    );
    return result.rows as PromoExclusion[];
}

/** Just the comparable terms, for the matching path. */
export const termsOf = async (userId: string): Promise<string[]> =>
    (await exclusionsOf(userId)).map((exclusion) => exclusion.term);

/** Add a term, or return the one already there: excluding twice is not an error. */
export async function addExclusion(userId: string, normalizedTerm: string): Promise<PromoExclusion> {
    const result = await query(
        `INSERT INTO custom_promo_exclusions (user_id, term)
         VALUES ($1, $2)
         ON CONFLICT (user_id, term) DO UPDATE SET term = EXCLUDED.term
         RETURNING id, term, created_at`,
        [userId, normalizedTerm]
    );
    return result.rows[0] as PromoExclusion;
}

/** Remove one of the family's terms. False when it was already gone. */
export async function removeExclusion(userId: string, id: string): Promise<boolean> {
    const result = await query('DELETE FROM custom_promo_exclusions WHERE id = $1 AND user_id = $2', [id, userId]);
    return Boolean(result.rowCount);
}
