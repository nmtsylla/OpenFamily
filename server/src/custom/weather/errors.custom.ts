// Typed errors for the weather service. Mirrors the AiError pattern: callers
// switch on `code`, the route layer converts to HTTP via `status`.

export type WeatherErrorCode =
    | 'BAD_REQUEST'
    | 'CITY_NOT_FOUND'
    | 'TIMEOUT'
    | 'PROVIDER_ERROR'
    | 'UNKNOWN';

const HTTP_STATUS: Record<WeatherErrorCode, number> = {
    BAD_REQUEST: 400,
    CITY_NOT_FOUND: 422,
    TIMEOUT: 504,
    PROVIDER_ERROR: 502,
    UNKNOWN: 500,
};

export class WeatherError extends Error {
    readonly code: WeatherErrorCode;
    readonly status: number;
    readonly cause: unknown;

    constructor(code: WeatherErrorCode, message: string, cause?: unknown) {
        super(message);
        this.name = 'WeatherError';
        this.code = code;
        this.status = HTTP_STATUS[code];
        this.cause = cause;
    }
}
