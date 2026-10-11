// The family's promo watchlist: watched products, the promos logged for them,
// and the three mutations the watchlist page performs.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ScanProduct } from '../lib/product.custom';

const BASE = '/api/products';

/** A watched product: the cached product row + this family's watch state. */
export interface WatchlistItem extends ScanProduct {
    id: string;
    target_price: string | null;
    best_promo_price: string | null;
    created_at: string;
}

/** A promo price somebody saw in a store. Prices come back as decimal strings. */
export interface PromoPrice {
    id: string;
    store_name: string | null;
    promo_price: string;
    regular_price: string | null;
    notes: string | null;
    logged_at: string;
}

export interface PromoPriceInput {
    store_name?: string;
    promo_price: number;
    regular_price?: number | null;
    notes?: string;
}

export function usePromoWatchlist() {
    const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const refetch = useCallback(async () => {
        try {
            const response = await api.get<{ success: boolean; data: WatchlistItem[] }>(
                `${BASE}/promo-watchlist`
            );
            setWatchlist(response.data ?? []);
            setError('');
        } catch (err) {
            console.error('Failed to load the promo watchlist:', err);
            setError(err instanceof Error ? err.message : 'failed');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refetch();
    }, [refetch]);

    const addWatch = useCallback(
        async (barcode: string, targetPrice?: number | null) => {
            await api.post(`${BASE}/promo-watchlist`, {
                barcode,
                target_price: targetPrice ?? null,
            });
            await refetch();
        },
        [refetch]
    );

    const removeWatch = useCallback(
        async (id: string) => {
            await api.delete(`${BASE}/promo-watchlist/${id}`);
            setWatchlist((previous) => previous.filter((item) => item.id !== id));
        },
        []
    );

    const logPrice = useCallback(
        async (barcode: string, input: PromoPriceInput) => {
            await api.post(`${BASE}/promo-watchlist/${encodeURIComponent(barcode)}/prices`, input);
            await refetch();
        },
        [refetch]
    );

    const fetchPrices = useCallback(async (barcode: string): Promise<PromoPrice[]> => {
        const response = await api.get<{ success: boolean; data: PromoPrice[] }>(
            `${BASE}/promo-watchlist/${encodeURIComponent(barcode)}/prices`
        );
        return response.data ?? [];
    }, []);

    return { watchlist, loading, error, refetch, addWatch, removeWatch, logPrice, fetchPrices };
}
