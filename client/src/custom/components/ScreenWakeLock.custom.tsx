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
// The family dashboard calls the hook directly and unconditionally — a wall
// tablet is a display, so it locks the screen whatever the display mode.
// =============================================================================

const isStandalonePwa = (): boolean =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ScreenWakeLock: React.FC = () => {
    useScreenWakeLock(isStandalonePwa());
    return null;
};

export default ScreenWakeLock;
