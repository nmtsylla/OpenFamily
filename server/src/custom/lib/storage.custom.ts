import {
    CreateBucketCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import logger from '../../lib/logger';
import { StorageError } from './storage-errors.custom';

// =============================================================================
// Object storage
//
// Thin wrapper around an S3-compatible client (MinIO, Scaleway Object Storage,
// AWS S3): same code, different env vars. The bucket stays PRIVATE — nothing is
// ever handed to the browser as a bucket URL; the API serves the bytes itself
// from a signed URL (see lib/media.ts).
//
// Object keys are `media/<uuid><ext>`: the unguessable name is not the security
// boundary, the signature is.
// =============================================================================

export interface StorageConfig {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    /** Irrelevant for MinIO, but the SDK insists on one. */
    region: string;
}

let cachedConfig: StorageConfig | null = null;
let cachedClient: S3Client | null = null;

/**
 * Object storage is OPTIONAL: without an endpoint and a bucket the app keeps
 * images inline in the database, exactly as it did before this module existed.
 */
export const isStorageConfigured = (): boolean =>
    Boolean(process.env.CUSTOM_MINIO_ENDPOINT?.trim()) && Boolean(process.env.CUSTOM_MINIO_BUCKET?.trim());

export const getStorageConfig = (): StorageConfig => {
    if (cachedConfig) return cachedConfig;
    cachedConfig = {
        endpoint: process.env.CUSTOM_MINIO_ENDPOINT!.trim(),
        accessKey: process.env.CUSTOM_MINIO_ACCESS_KEY?.trim() || '',
        secretKey: process.env.CUSTOM_MINIO_SECRET_KEY?.trim() || '',
        bucket: process.env.CUSTOM_MINIO_BUCKET!.trim(),
        region: process.env.CUSTOM_MINIO_REGION?.trim() || 'us-east-1',
    };
    return cachedConfig;
};

const getClient = (): S3Client => {
    if (cachedClient) return cachedClient;
    const cfg = getStorageConfig();
    const opts: S3ClientConfig = {
        endpoint: cfg.endpoint,
        region: cfg.region,
        credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        // Path-style addressing: what MinIO needs, and what Scaleway Object
        // Storage accepts.
        forcePathStyle: true,
    };
    cachedClient = new S3Client(opts);
    return cachedClient;
};

/**
 * Ensure the configured bucket exists. Idempotent — called once at boot so a
 * fresh environment needs no manual setup step. Throws a typed StorageError on
 * failure; the caller decides whether that is fatal.
 */
export const ensureBucket = async (): Promise<void> => {
    const cfg = getStorageConfig();
    const client = getClient();

    try {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        logger.info('storage.bucket_ready', { bucket: cfg.bucket, endpoint: cfg.endpoint });
        return;
    } catch (err) {
        // The HTTP status lives under `$metadata`, reached by narrowing: 404
        // means "we are about to create it", 403/301 mean "it exists but HEAD
        // may not see it" (what MinIO answers for a missing bucket).
        const metadata = err && typeof err === 'object' && '$metadata' in err ? err.$metadata : undefined;
        const status = metadata && typeof metadata === 'object' && 'httpStatusCode' in metadata
            && typeof metadata.httpStatusCode === 'number'
            ? metadata.httpStatusCode
            : undefined;
        if (status !== 404 && status !== 403 && status !== 301) {
            logger.warn('storage.head_bucket_unexpected', { status });
        }
    }

    try {
        await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
        logger.info('storage.bucket_created', { bucket: cfg.bucket });
    } catch (err) {
        // The service code is either a `Code` property or the error's `name`.
        const code = err && typeof err === 'object' && 'Code' in err && typeof err.Code === 'string'
            ? err.Code
            : err instanceof Error ? err.name : undefined;
        if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
            logger.info('storage.bucket_already_exists', { bucket: cfg.bucket });
            return;
        }
        throw new StorageError(
            'PROVIDER_ERROR',
            `Failed to create bucket "${cfg.bucket}": ${
                err instanceof Error ? err.message : String(err)
            }`,
            err,
        );
    }
};

/**
 * Key for a new object. The extension is kept (lowercased) so tools that sniff
 * by extension still work; anything unusual is dropped rather than sanitised.
 */
export const generateMediaKey = (originalName: string): string => {
    const rawExt = extname(originalName).toLowerCase();
    const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '';
    return `media/${randomUUID()}${ext}`;
};

export interface PutObjectInput {
    key: string;
    body: Buffer | Uint8Array | Readable;
    contentType: string;
    contentLength?: number;
}

export const putObject = async (input: PutObjectInput): Promise<void> => {
    const cfg = getStorageConfig();
    try {
        await getClient().send(
            new PutObjectCommand({
                Bucket: cfg.bucket,
                Key: input.key,
                Body: input.body,
                ContentType: input.contentType,
                ContentLength: input.contentLength,
            }),
        );
    } catch (err) {
        throw new StorageError(
            'PROVIDER_ERROR',
            `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
        );
    }
};

export interface GetObjectResult {
    body: Readable;
    contentType: string | undefined;
    contentLength: number | undefined;
}

export const getObjectStream = async (key: string): Promise<GetObjectResult> => {
    const cfg = getStorageConfig();
    try {
        const response = await getClient().send(
            new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
        );
        const body = response.Body as Readable | undefined;
        if (!body) {
            throw new StorageError('PROVIDER_ERROR', 'Empty object body');
        }
        return {
            body,
            contentType: response.ContentType,
            contentLength: response.ContentLength,
        };
    } catch (err) {
        const code = err && typeof err === 'object' && 'Code' in err && typeof err.Code === 'string'
            ? err.Code
            : err instanceof Error ? err.name : undefined;
        if (code === 'NoSuchKey' || code === 'NotFound') {
            throw new StorageError('NOT_FOUND', `Object not found: ${key}`, err);
        }
        throw new StorageError(
            'PROVIDER_ERROR',
            `Download failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
        );
    }
};

/** Test helper: reset cached client so tests can swap env vars. */
export const _resetStorageCache = (): void => {
    cachedConfig = null;
    cachedClient = null;
};
