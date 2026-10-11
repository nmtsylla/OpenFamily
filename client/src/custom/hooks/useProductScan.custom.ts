// Scanned barcode → product, and product → shopping list row (+ optional watch).

import { useCallback } from 'react';
import { api } from '../../lib/api';
import type { ScanProduct } from '../lib/product.custom';

const BASE = '/api/products';

/** What the user can still edit before the row is created. */
export interface ShoppingDraft {
    name: string;
    category: string;
    quantity?: number | null;
    unit?: string | null;
    price?: number | null;
}

interface AddOptions {
    enablePromoWatch?: boolean;
    targetPrice?: number | null;
}

export function useProductScan() {
    /**
     * `null` means Open Food Facts does not know the barcode — an expected
     * answer, not a failure. Anything else (network, server) throws.
     */
    const lookupBarcode = useCallback(async (barcode: string): Promise<ScanProduct | null> => {
        try {
            const response = await api.get<{ success: boolean; data: ScanProduct }>(
                `${BASE}/lookup/${encodeURIComponent(barcode)}`
            );
            const data = response?.data;
            // The static demo answers its `ok([])` catch-all for the endpoints it
            // does not know, so a payload that is not a product reads as "not
            // found" instead of rendering a blank card.
            return data && typeof data === 'object' && !Array.isArray(data) && data.name ? data : null;
        } catch (error) {
            // The api client only exposes the server's message, and the lookup
            // route 404s with this exact wording for an unknown barcode.
            if (error instanceof Error && error.message === 'Product not found') return null;
            throw error;
        }
    }, []);

    /**
     * Creates the shopping item, remembers the barcode it came from, and adds it
     * to the promo watchlist when asked. The watch comes first — it is the only
     * step that can fail on the third-party side — so a failure leaves nothing
     * behind instead of a created row the caller reports as failed. The barcode
     * link is best-effort: it only drives the list's badge, so its failure never
     * costs the item.
     */
    const addToShoppingList = useCallback(
        async (barcode: string, draft: ShoppingDraft, options: AddOptions = {}): Promise<string | null> => {
            if (options.enablePromoWatch) {
                await api.post(`${BASE}/promo-watchlist`, {
                    barcode,
                    target_price: options.targetPrice ?? null,
                });
            }

            const created = await api.post<{ success: boolean; data: { id: string } }>('/api/shopping', {
                name: draft.name,
                category: draft.category,
                quantity: draft.quantity ?? undefined,
                unit: draft.unit || undefined,
                price: draft.price ?? undefined,
            });

            const itemId = created.data?.id ?? null;
            if (itemId) {
                await api
                    .post(`${BASE}/shopping-items/${itemId}/barcode`, { barcode })
                    .catch(() => undefined);
            }

            return itemId;
        },
        []
    );

    return { lookupBarcode, addToShoppingList };
}
