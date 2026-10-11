// Rate limiter for the custom surfaces that talk to a FIXED host: Open-Meteo
// through the weather service, the two dashboard widgets that wrap it, the
// lunchbox AI calls (same fixed provider the /api/ai routes use), and the product
// lookup on Open Food Facts (hit on a cache miss, so a scan burst is bounded too).
//
// Upstream's outboundRateLimiter guards paths that fan out to a USER-SUPPLIED
// host (AI providers, recipe import, integrations) — nothing to probe here — and
// its 30-per-15-minutes budget is far too small for widgets that poll on every
// page load. One page load costs 2-3 calls per device, so this is a per-minute
// budget with real headroom: a household with several tabs stays near one call
// per second, while a runaway loop still hits the wall inside a minute.

import rateLimit from 'express-rate-limit';

const customRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.',
    },
});

// The exception to the rule above: a custom route that DOES fan out to a
// user-supplied host (the pantry's Grocy import reads the family's stored Grocy
// base URL). Upstream keeps exactly this shape for the same class of route
// (`outboundRateLimiter` in app.ts, 30 per 15 minutes, "to blunt abuse / SSRF
// probing"), and that limiter is module-local there, so the fork mirrors its
// budget here rather than letting the endpoint ride the 60-per-minute fixed-host
// budget.
export const integrationRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.',
    },
});

export default customRateLimiter;
