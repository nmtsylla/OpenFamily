// What a scanned barcode resolves to, how its Nutri-Score is coloured, and the
// one numeric-input helper both scan pages need.

export interface ScanProduct {
    barcode: string;
    name: string;
    brand: string | null;
    category: string | null;
    image_url: string | null;
    quantity: string | null;
    unit: string | null;
    nutriscore_grade: string | null;
}

// Nutri-Score, the letter grades A–E. Generic traffic-light palette: it is a
// rating scale, not a theme colour, so it stays the same in dark mode.
export const NUTRI_SCORE_CLASSES: Record<string, string> = {
    a: 'bg-emerald-600 text-white',
    b: 'bg-lime-500 text-white',
    c: 'bg-yellow-400 text-yellow-950',
    d: 'bg-orange-500 text-white',
    e: 'bg-red-600 text-white',
};

/**
 * A price or quantity the user may have left empty or typed with a comma:
 * `''` and a non-number are "nothing" (null), not zero.
 */
export const optionalNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
};

// EAN-8 to EAN-13, the printed lengths a grocery barcode has. Mirrors the
// server's check (server/src/custom/lib/product.custom.ts) so a typed barcode
// that could never resolve is refused before it costs a request.
const BARCODE_RE = /^\d{8,13}$/;

export const isBarcode = (value: string): boolean => BARCODE_RE.test(value.trim());
