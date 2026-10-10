import type { NextFunction, Request, Response } from 'express';
import logger from '../../lib/logger';
import { resolveStoredImages, storeInlineImages } from '../lib/media.custom';
import { isStorageConfigured } from '../lib/storage.custom';
import { StorageError } from '../lib/storage-errors.custom';

// =============================================================================
// Media middleware
//
// Two hooks, both value-shaped (see lib/media.ts for the rules):
//
//   storeIncomingImages   — after the body parser, before the routes: an inline
//                           image in a request is uploaded and replaced by its
//                           reference, so route code and validators only ever
//                           see `s3:<key>`.
//   resolveOutgoingImages — every JSON response gets its references turned into
//                           signed media URLs, so the SPA can render them in an
//                           <img> tag with no header and no per-route work.
//
// Both are inert when object storage is not configured: images then stay inline
// in the database, exactly as before.
// =============================================================================

export const storeIncomingImages = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    if (!isStorageConfigured() || !req.body || typeof req.body !== 'object') {
        next();
        return;
    }

    try {
        await storeInlineImages(req.body);
        next();
    } catch (err) {
        if (err instanceof StorageError) {
            logger.error('media.store_failed', { path: req.path, code: err.code, error: err.message });
            res.status(err.status).json({ success: false, error: err.message });
            return;
        }
        next(err);
    }
};

export const resolveOutgoingImages = (
    _req: Request,
    res: Response,
    next: NextFunction,
): void => {
    const sendJson = res.json.bind(res);
    res.json = ((body?: unknown) => sendJson(resolveStoredImages(body))) as Response['json'];
    next();
};
