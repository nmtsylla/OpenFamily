import React from 'react';
import { useScreenWakeLock } from '../hooks/useScreenWakeLock.custom';

// =============================================================================
// App-wide screen wake lock, mounted once from main.tsx so every route keeps a
// phone's or tablet's screen awake (Layout pages, /kiosk, /login alike).
//
// Only when the app runs installed: a browser tab's screen is the browser's
// business, and waking a desktop was never the point of this. The installed
// display mode is the whole scope of the feature.
//
// Nothing else calls the hook: it is this component's only job, so the lock
// follows the same installed-only rule as the rest of the app.
// =============================================================================

const isStandalonePwa = (): boolean =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ScreenWakeLock: React.FC = () => {
    useScreenWakeLock(isStandalonePwa());
    return null;
};

export default ScreenWakeLock;
