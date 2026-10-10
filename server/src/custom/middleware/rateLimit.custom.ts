// Rate limiter for the custom surfaces that read a FIXED public host (Open-Meteo
// through the weather service, and the two dashboard widgets that wrap it).
//
// Upstream's outboundRateLimiter guards paths that fan out to a USER-SUPPLIED
// host (AI providers, recipe import, integrations) — nothing to probe here — and
// its 30-per-15-minutes budget is far too small for widgets that poll on every
// page load. One page load costs 2-3 calls per device, so this is a per-minute
// budget with real headroom: a household with several tabs stays near one call
// per second, while a runaway loop still hits the wall inside a minute.

import rateLimit from 'express-rate-limit';

const customWeatherRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.',
    },
});

export default customWeatherRateLimiter;
