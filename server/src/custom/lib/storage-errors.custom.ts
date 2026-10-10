// Typed errors for the storage layer. Mirrors AiError / WeatherError.

export type StorageErrorCode =
    | 'BAD_REQUEST'
    | 'NOT_FOUND'
    | 'PROVIDER_ERROR'
    | 'TIMEOUT'
    | 'UNKNOWN';

const HTTP_STATUS: Record<StorageErrorCode, number> = {
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    PROVIDER_ERROR: 502,
    TIMEOUT: 504,
    UNKNOWN: 500,
};

export class StorageError extends Error {
    readonly code: StorageErrorCode;
    readonly status: number;
    readonly cause: unknown;

    constructor(code: StorageErrorCode, message: string, cause?: unknown) {
        super(message);
        this.name = 'StorageError';
        this.code = code;
        this.status = HTTP_STATUS[code];
        this.cause = cause;
    }

    toJSON(): { code: StorageErrorCode; message: string } {
        return { code: this.code, message: this.message };
    }
}
