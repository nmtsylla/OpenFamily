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
import customRateLimiter from './middleware/rateLimit.custom';
import { catalogueFor, configuredCountries } from './lib/prijsprofeet.custom';
import aiDashboardRoutes from './routes/aiDashboard.custom';
import budgetAnalyticsRoutes from './routes/budgetAnalytics.custom';
import budgetReceiptsRoutes from './routes/budgetReceipts.custom';
import homeAssistantDevicesRoutes from './routes/homeAssistantDevices.custom';
import lunchboxRoutes from './routes/lunchbox.custom';
import mediaRoutes from './routes/media.custom';
import outingsRoutes from './routes/outings.custom';
import pantryRoutes from './routes/pantry.custom';
import productScanRoutes from './routes/productScan.custom';
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
        app.use('/api/weather', customRateLimiter, weatherRoutes);
    }

    if (isCustomFeatureEnabled('aiWidgets')) {
        app.use('/api/ai/dashboard', customRateLimiter, aiDashboardRoutes);
    }

    if (isCustomFeatureEnabled('lunchbox')) {
        // Its own page and its own table (custom_lunchboxes): the upstream meal
        // planner keeps working untouched, and these routes never fan out to a
        // user-supplied host — only the two AI calls leave the server, and they
        // go to the family's own configured provider.
        app.use('/api/lunchbox', customRateLimiter, lunchboxRoutes);
    }

    if (isCustomFeatureEnabled('pantry')) {
        // The pantry is the fork's own table; the shopping-list route behind it
        // appends to upstream's list and writes to no other system. One route
        // inside the router DOES leave the server — the Grocy import reads the
        // family's stored Grocy URL — so it carries its own limiter (see
        // middleware/rateLimit.custom.ts) on top of this one.
        app.use('/api/pantry', customRateLimiter, pantryRoutes);
    }

    if (isCustomFeatureEnabled('outings')) {
        // The outing planner: OpenStreetMap for the places (fixed public host),
        // the family's own configured model for the ranking. Read-only — the
        // chosen outing is added through upstream's /api/planning.
        app.use('/api/outings', customRateLimiter, outingsRoutes);
    }

    if (isCustomFeatureEnabled('budgetReceipts')) {
        // Registered before upstream's /api/budget router: this mount can never
        // be swallowed by it, and /api/budget keeps working untouched.
        app.use('/api/budget/receipts', budgetReceiptsRoutes);
    }

    if (isCustomFeatureEnabled('budgetAnalytics')) {
        app.use('/api/budget-analytics', budgetAnalyticsRoutes);
    }

    if (isCustomFeatureEnabled('productScan')) {
        // The "my products" promo mode matches the day's catalogue locally, so its
        // first visitor would wait out a 61-request crawl (~12 s); starting it here
        // moves that off the request path. Fire-and-forget, rejection swallowed: a
        // failed warm is one slow request later (nothing is cached on failure, so
        // the next request retries), never a failed start.
        void Promise.all(configuredCountries().map((country) => catalogueFor(country))).catch(() => {});

        // Behind the same limiter as the weather surface: this router fans out
        // to a third-party API (Open Food Facts) on a cache miss.
        app.use('/api/products', customRateLimiter, productScanRoutes);
    }

    if (isCustomFeatureEnabled('familyDashboard')) {
        // Like the product scan above, this one DOES reach a host outside this
        // server — the family's own Home Assistant, re-vetted by safeFetch on
        // every hop. It polls on a 30 s timer, far past upstream's
        // 30-per-15-minutes outbound budget, so it takes the per-minute limiter.
        app.use('/api/custom/ha', customRateLimiter, homeAssistantDevicesRoutes);
    }
};
