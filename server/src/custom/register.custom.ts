// The fork's single registration point.
//
// `server/src/app.ts` calls this once (see its FORK-START: custom-routes hook),
// so the list of custom routers never leaks into the upstream file. Adding a
// custom route means adding it here.
//
// Position matters: the hook sits above the upstream rate limiters, because
// these routes do not need upstream's 30-per-15-minutes outbound budget — the
// weather and widget surfaces read a fixed public API, and the Home Assistant
// proxy polls a device on a 30 s timer. Each carries its own limiter below.

import type { Express } from 'express';
import { isCustomFeatureEnabled } from './features.custom';
import { resolveOutgoingImages, storeIncomingImages } from './middleware/media.custom';
import customWeatherRateLimiter from './middleware/rateLimit.custom';
import aiDashboardRoutes from './routes/aiDashboard.custom';
import budgetAnalyticsRoutes from './routes/budgetAnalytics.custom';
import budgetReceiptsRoutes from './routes/budgetReceipts.custom';
import homeAssistantDevicesRoutes from './routes/homeAssistantDevices.custom';
import mediaRoutes from './routes/media.custom';
import weatherRoutes from './routes/weather.custom';

export const registerCustomRoutes = (app: Express): void => {
    // Both image middlewares wrap every response, upstream routes included: an
    // avatar uploaded through an upstream route must still come back as a signed
    // URL, and an incoming data: URL must still reach the bucket.
    if (isCustomFeatureEnabled('media')) {
        app.use(resolveOutgoingImages);
        app.use(storeIncomingImages);
        app.use('/api/media', mediaRoutes);
    }

    if (isCustomFeatureEnabled('weather')) {
        app.use('/api/weather', customWeatherRateLimiter, weatherRoutes);
    }

    if (isCustomFeatureEnabled('aiWidgets')) {
        app.use('/api/ai/dashboard', customWeatherRateLimiter, aiDashboardRoutes);
    }

    if (isCustomFeatureEnabled('budgetReceipts')) {
        // Registered before upstream's /api/budget router: this mount can never
        // be swallowed by it, and /api/budget keeps working untouched.
        app.use('/api/budget/receipts', budgetReceiptsRoutes);
    }

    if (isCustomFeatureEnabled('budgetAnalytics')) {
        app.use('/api/budget-analytics', budgetAnalyticsRoutes);
    }

    if (isCustomFeatureEnabled('familyDashboard')) {
        // Unlike the surfaces above this one DOES reach a user-supplied host —
        // the family's own Home Assistant, validated by safeFetch on every hop.
        // It polls on a 30 s timer, far past upstream's 30-per-15-minutes
        // outbound budget, so it takes the per-minute limiter instead.
        app.use('/api/custom/ha', customWeatherRateLimiter, homeAssistantDevicesRoutes);
    }
};
