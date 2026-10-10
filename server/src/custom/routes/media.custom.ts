import { Router } from 'express';
import logger from '../../lib/logger';
import { isMediaRef, verifyMediaSignature } from '../lib/media.custom';
import { getObjectStream } from '../lib/storage.custom';
import { StorageError } from '../lib/storage-errors.custom';

// =============================================================================
// GET /api/media/<key>?exp=<unix seconds>&sig=<hmac>
//
// Streams one stored image. The signature IS the credential: the SPA renders
// these URLs in <img> tags, which cannot carry the Authorization header the rest
// of the API uses. The bucket stays private — the browser never talks to it, and
// the link expires (lib/media.ts, SIGNATURE_TTL_DAYS).
//
// No authMiddleware on purpose, and nothing here is enumerable: a key is a UUID
// and an unsigned or expired link is a 403.
// =============================================================================

const router = Router();

router.get(/^\/.+$/, async (req, res) => {
    const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';

    if (!isMediaRef(`s3:${key}`) || !verifyMediaSignature(key, exp, sig)) {
        return res.status(403).json({ success: false, error: 'Invalid or expired media link' });
    }

    try {
        const { body, contentType, contentLength } = await getObjectStream(key);
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        if (contentLength !== undefined) {
            res.setHeader('Content-Length', String(contentLength));
        }
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        body.on('error', (err) => {
            logger.error('media.read_failed', { key, error: err.message });
            res.destroy();
        });
        body.pipe(res);
    } catch (err) {
        if (err instanceof StorageError && err.code === 'NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        logger.error('media.read_failed', {
            key,
            error: err instanceof Error ? err.message : String(err),
        });
        return res.status(502).json({ success: false, error: 'Media unavailable' });
    }
});

export default router;
