// Today's promotions, browsable: the filter choices, the filter state, and the
// page of results behind it.
//
// Every filter is applied by PrijsProfeet itself (see the server's
// lib/prijsprofeet.custom.ts), so `total` counts the whole filtered set rather
// than the page on screen. The server caches each query until the next morning,
// which is when the API refreshes the chains; the client's own cost is one
// request per filter change, with the search box debounced so typing is not one.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { PromoCountry, PromoExclusion, PromoFilters, PromoOffer, PromoPage, PromoSort } from '../lib/product.custom';

const BASE = '/api/products/promos';
const EXCLUSIONS = '/api/products/promo-exclusions';
// Enough rows to fill a screen without a list nobody scrolls; the API caps at 60.
const PAGE_SIZE = 24;
// A keystroke per request would be a request per keystroke.
const SEARCH_DEBOUNCE_MS = 400;

export interface PromoQueryState {
    /** Empty = the server's default country (the first one configured). */
    country: PromoCountry | '';
    q: string;
    retailer: string;
    category: string;
    /** "10", "25", "50" or "" for no floor. */
    minSavings: string;
    sort: PromoSort;
    /** Keep only the deals on products the family knows (pantry goods or what a receipt shows they bought). On by default: the family asked for it. */
    onlyKnown: boolean;
}

const INITIAL_QUERY: PromoQueryState = {
    country: '',
    q: '',
    retailer: '',
    category: '',
    minSavings: '',
    sort: 'savings',
    onlyKnown: true,
};

export function useDailyPromos() {
    const [filters, setFilters] = useState<PromoFilters | null>(null);
    const [filtersFailed, setFiltersFailed] = useState(false);
    const [exclusions, setExclusions] = useState<PromoExclusion[]>([]);
    const [query, setQuery] = useState<PromoQueryState>(INITIAL_QUERY);
    const [pageNumber, setPageNumber] = useState(1);
    const [deferredQuery, setDeferredQuery] = useState('');
    const [page, setPage] = useState<PromoPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    // Bumped when the family's terms change: the list has to be asked again,
    // since it is the server that leaves them out.
    const [refresh, setRefresh] = useState(0);

    const { country, q, retailer, category, minSavings, sort, onlyKnown } = query;

    useEffect(() => {
        const timer = setTimeout(() => setDeferredQuery(q), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [q]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await api.get<{ success: boolean; data: PromoExclusion[] }>(EXCLUSIONS);
                if (!cancelled) setExclusions(response.data ?? []);
            } catch (error) {
                console.error('Failed to load the promo exclusions:', error);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [refresh]);

    const addTerm = useCallback(async (term: string) => {
        await api.post(EXCLUSIONS, { term });
        setRefresh((previous) => previous + 1);
    }, []);

    const removeTerm = useCallback(async (id: string) => {
        await api.delete(`${EXCLUSIONS}/${id}`);
        setExclusions((previous) => previous.filter((exclusion) => exclusion.id !== id));
        setRefresh((previous) => previous + 1);
    }, []);

    /** The row's hide button: the product when the shop names it, its brand otherwise. */
    const hideOffer = useCallback(
        async (offer: PromoOffer) => {
            const term = offer.name ?? offer.brand;
            if (term) await addTerm(term);
        },
        [addTerm]
    );

    // The filter panel: its own request, and only the country and the mode change it.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const params = new URLSearchParams(country ? { country } : {});
                if (onlyKnown) params.set('only_known', '1');
                const suffix = params.toString();
                const response = await api.get<{ success: boolean; data: PromoFilters }>(
                    `${BASE}/filters${suffix ? `?${suffix}` : ''}`
                );
                if (!cancelled) {
                    setFilters(response.data ?? null);
                    setFiltersFailed(false);
                }
            } catch (error) {
                console.error('Failed to load the promo filters:', error);
                if (!cancelled) setFiltersFailed(true);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [country, onlyKnown]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            const params = new URLSearchParams({ sort, page: String(pageNumber), page_size: String(PAGE_SIZE) });
            if (country) params.set('country', country);
            if (deferredQuery.trim()) params.set('q', deferredQuery.trim());
            if (retailer) params.set('retailer', retailer);
            if (category) params.set('category', category);
            if (minSavings) params.set('min_savings', minSavings);
            if (onlyKnown) params.set('only_known', '1');

            try {
                const response = await api.get<{ success: boolean; data: PromoPage }>(`${BASE}?${params}`);
                // A response that is not a page (an unmocked demo route answers
                // `[]`, for one) must read as "could not load", not crash the tab.
                // Stale answers are dropped too: a filter change fires a new
                // request, and the older one resolving last must not repaint the
                // list with the abandoned filter's results.
                if (cancelled) return;
                const data = response.data;
                if (data && Array.isArray(data.offers)) {
                    setPage(data);
                    setFailed(false);
                } else {
                    setPage(null);
                    setFailed(true);
                }
            } catch (error) {
                console.error("Failed to load today's promotions:", error);
                if (!cancelled) {
                    setPage(null);
                    setFailed(true);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [country, deferredQuery, retailer, category, minSavings, sort, pageNumber, refresh, onlyKnown]);

    /** A filter change always goes back to page 1: page 7 of another filter is meaningless. */
    const update = useCallback((patch: Partial<PromoQueryState>) => {
        setQuery((previous) => ({
            ...previous,
            ...patch,
            // The facets are per country and per mode: a store of the country you
            // just left, or one with no matching deals in the mode you switched to,
            // is not a filter the new list can honour.
            ...(patch.country !== undefined || patch.onlyKnown !== undefined ? { retailer: '', category: '' } : {}),
        }));
        setPageNumber(1);
    }, []);

    return {
        filters,
        filtersFailed,
        query,
        update,
        page,
        pageNumber,
        lastPage: Math.max(1, Math.ceil((page?.total ?? 0) / (page?.pageSize || PAGE_SIZE))),
        loading,
        failed,
        setPageNumber,
        exclusions,
        addTerm,
        removeTerm,
        hideOffer,
    };
}
