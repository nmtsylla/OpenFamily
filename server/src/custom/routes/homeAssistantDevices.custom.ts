import { Router } from 'express';
import { authMiddleware, requireParent, AuthRequest } from '../../middleware/auth';
import { query } from '../../db';
import { decryptCredentials } from '../../utils/crypto';
import { safeFetch, readCappedText } from '../../lib/safeFetch';
import { UnsafeUrlError } from '../../utils/urlGuard';
import logger from '../../lib/logger';
import {
    HA_STATES_MAX_BYTES,
    HA_TIMEOUT_MS,
    haServiceFailure,
    simplifyHaState,
    validateServiceCall,
    type RawHaState,
} from '../lib/homeAssistantDevices.custom';

// =============================================================================
// /api/custom/ha — the family dashboard's window on Home Assistant.
//
// Read the entity list, write through HA services. The HA token never leaves the
// server: the family's `integrations` row (type = 'homeassistant', the one the
// shopping-list sync already uses) supplies the base URL and the encrypted
// credentials, exactly as services/integrations/homeassistant.ts reads them.
//
// What may be shown and driven lives in lib/homeAssistantDevices.custom.ts, so
// the whitelist and the validation are unit-tested without a database. What is
// left here is I/O: safeFetch re-vets the stored URL on every redirect hop and
// caps the body, since HA runs on a user-supplied host.
// =============================================================================

const router = Router();
router.use(authMiddleware);

interface HAIntegration {
    base_url: string;
    encrypted_credentials: string | null;
}

/**
 * The family's Home Assistant row. The sync uses the same lookup
 * (`family_id` + `type`), which the ON CONFLICT (family_id, type) upsert in
 * routes/integrations.ts makes unique.
 */
const loadIntegration = async (familyId: string): Promise<{ baseUrl: string; token: string } | null> => {
    const result = await query(
        `SELECT base_url, encrypted_credentials FROM integrations
         WHERE family_id = $1 AND type = 'homeassistant'`,
        [familyId],
    );
    const integ = result.rows[0] as HAIntegration | undefined;
    if (!integ || !integ.encrypted_credentials) return null;

    const creds = decryptCredentials(integ.encrypted_credentials);
    const token = creds.token;
    if (!token) return null;

    return { baseUrl: integ.base_url.replace(/\/+$/, ''), token };
};

const haHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
});

/** GET /api/custom/ha/states — the whitelisted, simplified entity list. */
router.get('/states', async (req: AuthRequest, res) => {
    try {
        const integ = await loadIntegration(req.userId!);
        if (!integ) {
            return res.status(404).json({ success: false, error: 'homeassistant.integration_not_found' });
        }

        const response = await safeFetch(`${integ.baseUrl}/api/states`, {
            headers: haHeaders(integ.token),
            timeoutMs: HA_TIMEOUT_MS,
        });
        if (!response.ok) {
            logger.warn('homeassistant.states_failed', { status: response.status });
            return res.status(502).json({ success: false, error: 'homeassistant.unreachable' });
        }

        const text = await readCappedText(response, HA_STATES_MAX_BYTES);
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) {
            return res.status(502).json({ success: false, error: 'homeassistant.unreachable' });
        }

        const data = (parsed as RawHaState[])
            .map(simplifyHaState)
            .filter((entity) => entity !== null);

        res.json({ success: true, data });
    } catch (error) {
        if (error instanceof UnsafeUrlError) {
            return res.status(400).json({ success: false, error: 'homeassistant.unsafe_url' });
        }
        logger.warn('homeassistant.states_error', {
            message: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ success: false, error: 'homeassistant.unreachable' });
    }
});

/**
 * POST /api/custom/ha/services/:domain/:service — body: { entity_id, …service_data }
 *
 * Proxies straight through to HA's own service call, so every domain-specific
 * field (brightness_pct, temperature, position…) keeps its HA semantics instead
 * of being re-modelled here. Parent-only: this drives the family's home.
 */
router.post('/services/:domain/:service', requireParent, async (req: AuthRequest, res) => {
    const { domain, service } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const invalid = validateServiceCall(domain, service, body);
    if (invalid) {
        return res.status(400).json({ success: false, error: invalid });
    }

    try {
        const integ = await loadIntegration(req.userId!);
        if (!integ) {
            return res.status(404).json({ success: false, error: 'homeassistant.integration_not_found' });
        }

        const response = await safeFetch(`${integ.baseUrl}/api/services/${domain}/${service}`, {
            method: 'POST',
            headers: haHeaders(integ.token),
            body: JSON.stringify(body),
            timeoutMs: HA_TIMEOUT_MS,
        });

        if (!response.ok) {
            const detail = await readCappedText(response, 4096).catch(() => '');
            const failure = haServiceFailure(response.status);
            logger.warn('homeassistant.service_failed', {
                domain,
                service,
                status: response.status,
            });
            return res.status(failure.status).json({
                success: false,
                error: failure.error,
                message: detail.slice(0, 500),
            });
        }

        // HA answers with the list of changed states; the dashboard only needs
        // the acknowledgement, and refetches /states on its next tick.
        await response.body?.cancel().catch(() => undefined);
        res.json({ success: true });
    } catch (error) {
        if (error instanceof UnsafeUrlError) {
            return res.status(400).json({ success: false, error: 'homeassistant.unsafe_url' });
        }
        logger.warn('homeassistant.service_error', {
            domain,
            service,
            message: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ success: false, error: 'homeassistant.unreachable' });
    }
});

export default router;
