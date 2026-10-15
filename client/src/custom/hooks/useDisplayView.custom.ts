// A two-state display choice ('list' | 'grid') kept per device, so a family that
// browses by photo does not re-pick the grid on every visit. Each surface passes
// its own storage key; an absent or unreadable value is the list, which is what
// the page has always shown.

import { useCallback, useState } from 'react';

export type DisplayView = 'list' | 'grid';

const parseView = (raw: string | null): DisplayView => (raw === 'list' || raw === 'grid' ? raw : 'list');

export function useDisplayView(storageKey: string): { view: DisplayView; setView: (view: DisplayView) => void } {
    const [view, setViewState] = useState<DisplayView>(() => {
        try {
            return parseView(localStorage.getItem(storageKey));
        } catch {
            return 'list';
        }
    });

    const setView = useCallback(
        (next: DisplayView) => {
            setViewState(next);
            try {
                localStorage.setItem(storageKey, next);
            } catch {
                // localStorage unavailable (private mode): the choice just is not remembered.
            }
        },
        [storageKey]
    );

    return { view, setView };
}
