// The barcode/price validation the product-scan routes share.
//
// Pure and separate from the router so it can be tested: every value here comes
// straight off the request body, and a wrong `true` here writes a bad row.

// EAN-8 to EAN-13, digits only: the printed barcode lengths a grocery scanner
// can produce. Anything else is the caller's mistake, not a lookup to attempt.
const BARCODE_RE = /^\d{8,13}$/;

export const barcodeOf = (value: unknown): string | null => {
    const barcode = typeof value === 'string' ? value.trim() : '';
    return BARCODE_RE.test(barcode) ? barcode : null;
};

/** A positive decimal price, or null when the caller sent nothing usable. */
export const optionalPrice = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
};
