import { useEffect } from 'react';

// =============================================================================
// Keep the screen awake while this page is the visible one.
//
// Mechanism only: no display-mode knowledge and no UI. The browser drops the
// lock itself the moment the page hides, so the hook asks again on every
// `visibilitychange` back to visible; a `release` the sentinel fires on its own
// (the tab was hidden, the device threw the lock) is forgotten, otherwise the
// next visible moment plus the still-held reference would leave two locks
// behind.
//
// `wakeLock` is not in this project's TS lib, hence the two local interfaces.
// Android WebView (the Capacitor shell) and older Safari have no such API at
// all: there the device's own keep-awake setting is the fallback.
// =============================================================================

interface WakeLockSentinelLike {
    release: () => Promise<void>;
    addEventListener?: (type: 'release', listener: () => void) => void;
}

interface WakeLockNavigator {
    wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
}

export function useScreenWakeLock(enabled = true): void {
    useEffect(() => {
        if (!enabled) return;
        const wakeLock = (navigator as Navigator & WakeLockNavigator).wakeLock;
        if (!wakeLock) return;

        let lock: WakeLockSentinelLike | null = null;
        let disposed = false;

        const acquire = async () => {
            if (disposed || lock) return;
            try {
                const sentinel = await wakeLock.request('screen');
                // The browser releases the lock on its own when the page hides.
                // Forgetting it here is what lets the next visible moment ask
                // again; without it the hook holds a dead reference and a
                // second request would stack a second lock.
                sentinel.addEventListener?.('release', () => {
                    if (lock === sentinel) lock = null;
                });
                if (disposed) {
                    void sentinel.release().catch(() => undefined);
                    return;
                }
                lock = sentinel;
            } catch {
                /* denied, unsupported, or the page was hidden mid-request */
            }
        };

        void acquire();
        const onVisible = () => {
            if (document.visibilityState === 'visible') void acquire();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisible);
            void lock?.release().catch(() => undefined);
            lock = null;
        };
    }, [enabled]);
}
