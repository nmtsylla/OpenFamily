import { createHmac, timingSafeEqual } from 'crypto';
import { getJwtSecret } from '../../config/loadEnv';
import logger from '../../lib/logger';
import { generateMediaKey, isStorageConfigured, putObject } from './storage.custom';
import { StorageError } from './storage-errors.custom';

// =============================================================================
// Inline images on object storage
//
// The app stores photos as `data:` URLs inside PostgreSQL columns (avatar_url,
// image_url). This module moves those bytes to the object-storage bucket and
// leaves a reference behind instead:
//
//   IN   a `data:image/...;base64,` string  -> uploaded, replaced by `s3:<key>`
//   IN   one of our own media URLs          -> replaced by `s3:<key>` again
//        (the SPA hands back the URL it was given whenever it saves an edit)
//   OUT  `s3:<key>`                         -> `/api/media/<key>?exp&sig`
//
// The rule is value-shaped, not field-shaped, and it is applied to whole request
// and response bodies (middleware/media.ts), so a new image field needs no extra
// wiring. Only two shapes can match: a `data:image/` URL, and a path this API
// served itself. Nothing else is touched.
//
// A stored image is read back through GET /api/media/<key>, whose query
// signature IS the credential: an <img> tag cannot send the Authorization header
// the rest of the API uses. The bucket stays private, and no bucket URL ever
// reaches the browser.
// =============================================================================

export const MEDIA_REF_PREFIX = 's3:';
/** Path this API serves a stored image from; also what the SPA sees. */
export const MEDIA_PATH = '/api/media/';

/** Ceiling for one inline image, in decoded bytes (the client resizes to 2 MB). */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const DATA_URL = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const MEDIA_KEY = /^media\/[a-z0-9-]{1,64}\.[a-z0-9]{1,8}$/;

/** Longest life of a media link. Whole days, so it is stable within a day. */
const SIGNATURE_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

/** A reference this app wrote, as opposed to anything a caller sent. */
export const isMediaRef = (value: unknown): boolean =>
    typeof value === 'string' &&
    value.startsWith(MEDIA_REF_PREFIX) &&
    MEDIA_KEY.test(value.slice(MEDIA_REF_PREFIX.length));

/**
 * Key behind one of our own media URLs, relative (`/api/media/x`) or absolute
 * (`https://host/api/media/x?exp=..&sig=..`). Null for anything else.
 */
export const mediaKeyFromUrl = (value: string): string | null => {
    if (!value.includes(MEDIA_PATH)) return null;
    let pathname: string;
    try {
        pathname = new URL(value, 'http://media.invalid').pathname;
    } catch {
        return null;
    }
    if (!pathname.startsWith(MEDIA_PATH)) return null;
    const key = pathname.slice(MEDIA_PATH.length);
    return MEDIA_KEY.test(key) ? key : null;
};

/** URL the SPA renders for a stored object. */
export const signMediaPath = (key: string): string => {
    const exp = Math.floor((Date.now() / DAY_MS + SIGNATURE_TTL_DAYS)) * (DAY_MS / 1000);
    const sig = createHmac('sha256', getJwtSecret()).update(`${key}|${exp}`).digest('hex');
    return `${MEDIA_PATH}${key}?exp=${exp}&sig=${sig}`;
};

export const verifyMediaSignature = (key: string, exp: number, sig: string): boolean => {
    if (!Number.isInteger(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
    if (exp * 1000 < Date.now()) return false;
    const expected = createHmac('sha256', getJwtSecret()).update(`${key}|${exp}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Upload one inline image and return its reference. Anything that is not an
 * inline image is returned unchanged, so callers can map this over a whole body.
 * A malformed or oversized image throws: silently keeping a bad value in the
 * database is what we are removing here.
 *
 * ponytail: replacing or clearing an image leaves its object in the bucket (no
 * sweep). Add a garbage-collection pass if the bucket's growth ever matters.
 */
export const storeInlineImage = async (value: unknown): Promise<unknown> => {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) return value;

    const match = DATA_URL.exec(value);
    if (!match) {
        throw new StorageError('BAD_REQUEST', 'Unsupported inline image format');
    }

    const [, mimeType, base64] = match;
    const body = Buffer.from(base64, 'base64');
    if (body.length === 0) {
        throw new StorageError('BAD_REQUEST', 'Empty inline image');
    }
    if (body.length > MAX_IMAGE_BYTES) {
        throw new StorageError(
            'BAD_REQUEST',
            `Image too large: ${Math.round(body.length / 1024)} KB (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`,
        );
    }

    const key = generateMediaKey(mimeType === 'image/jpeg' ? 'image.jpg' : `image.${mimeType.slice(6)}`);
    await putObject({ key, body, contentType: mimeType, contentLength: body.length });
    logger.info('media.stored', { key, bytes: body.length, mimeType });
    return `${MEDIA_REF_PREFIX}${key}`;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/**
 * Walk a parsed JSON body, replacing every inline image with its stored
 * reference. Containers are mutated in place; non-plain objects (Date, Buffer)
 * are left alone, since only parsed JSON is expected here.
 */
export const storeInlineImages = async (node: unknown): Promise<unknown> => {
    if (!isStorageConfigured()) return node;

    if (typeof node === 'string') {
        const key = mediaKeyFromUrl(node);
        if (key) return `${MEDIA_REF_PREFIX}${key}`;
        return storeInlineImage(node);
    }
    if (Array.isArray(node)) {
        await Promise.all(node.map(async (item, index) => {
            node[index] = await storeInlineImages(item);
        }));
        return node;
    }
    if (isPlainObject(node)) {
        await Promise.all(Object.keys(node).map(async (field) => {
            node[field] = await storeInlineImages(node[field]);
        }));
        return node;
    }
    return node;
};

/** Walk a JSON payload, replacing stored references with signed media URLs. */
export const resolveStoredImages = (node: unknown): unknown => {
    if (typeof node === 'string') {
        return isMediaRef(node) ? signMediaPath(node.slice(MEDIA_REF_PREFIX.length)) : node;
    }
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
            node[i] = resolveStoredImages(node[i]);
        }
        return node;
    }
    if (isPlainObject(node)) {
        for (const field of Object.keys(node)) {
            node[field] = resolveStoredImages(node[field]);
        }
        return node;
    }
    return node;
};
