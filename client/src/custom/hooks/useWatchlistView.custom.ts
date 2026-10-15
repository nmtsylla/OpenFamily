// The watchlist's display mode: a two-state UI choice ('list' | 'grid'), kept per
// device under openfamily.promoWatchlist.view.v1 so a family that browses by photo
// does not re-pick the grid on every visit. An absent or unreadable key is the
// list, which is what the page has always shown.

import { useCallback, useState } from 'react';

export type WatchlistView = 'list' | 'grid';

const STORAGE_KEY = 'openfamily.promoWatchlist.view.v1';

const parseView = (raw: string | null): WatchlistView =>
    raw === 'list' || raw === 'grid' ? raw : 'list';

export function useWatchlistView(): { view: WatchlistView; setView: (view: WatchlistView) => void } {
    const [view, setViewState] = useState<WatchlistView>(() => {
        try {
            return parseView(localStorage.getItem(STORAGE_KEY));
        } catch {
            return 'list';
        }
    });

    const setView = useCallback((next: WatchlistView) => {
        setViewState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // localStorage unavailable (private mode): the choice just is not remembered.
        }
    }, []);

    return { view, setView };
}
