// =============================================================================
// How much product a receipt line holds, read off the text that is already
// there.
//
// The extraction asks the model for `pantry_content`, but the model is not the
// only source and not always right: a ticket that prints 'RIJST BASMATI 5KG'
// says the amount in its own label, and an old imported line has no content at
// all. This module is the fallback both paths share, so a 500 g pack never
// becomes 'Broccoli 1 g' again.
//
// It parses ONLY the unit table below, and only a number glued to one of those
// units: '50x70cm', '40WL', '6%', 'cr2032' and a bare '301' are not sizes.
// Two different printed sizes in one label are ambiguous, and ambiguity answers
// null — the family is asked rather than guessed at.
//
// Pure, and it never throws: garbage in a database row or a model answer is a
// null, never a 500.
// =============================================================================

export type InferredUnit = 'kg' | 'l' | 'pièce';

export interface InferredAmount {
    /** Total content of the line in `unit`, 3 decimals, > 0. */
    content: number;
    unit: InferredUnit;
    source: 'label' | 'unit_size' | 'weighed';
}

interface UnitFactor {
    unit: InferredUnit;
    /** Multiply the printed number by this to get the value in `unit`. */
    factor: number;
}

// The only units that count. Deliberately short: every extra spelling is a new
// way a random word after a number can pose as a size.
const UNIT_FACTORS: Record<string, UnitFactor> = {
    kg: { unit: 'kg', factor: 1 },
    kilo: { unit: 'kg', factor: 1 },
    kilos: { unit: 'kg', factor: 1 },
    g: { unit: 'kg', factor: 0.001 },
    gr: { unit: 'kg', factor: 0.001 },
    gram: { unit: 'kg', factor: 0.001 },
    grams: { unit: 'kg', factor: 0.001 },
    gramme: { unit: 'kg', factor: 0.001 },
    grammes: { unit: 'kg', factor: 0.001 },
    l: { unit: 'l', factor: 1 },
    lt: { unit: 'l', factor: 1 },
    litre: { unit: 'l', factor: 1 },
    litres: { unit: 'l', factor: 1 },
    dl: { unit: 'l', factor: 0.1 },
    cl: { unit: 'l', factor: 0.01 },
    ml: { unit: 'l', factor: 0.001 },
    st: { unit: 'pièce', factor: 1 },
    stuk: { unit: 'pièce', factor: 1 },
    stuks: { unit: 'pièce', factor: 1 },
    pc: { unit: 'pièce', factor: 1 },
    pcs: { unit: 'pièce', factor: 1 },
    pièce: { unit: 'pièce', factor: 1 },
    pièces: { unit: 'pièce', factor: 1 },
    piece: { unit: 'pièce', factor: 1 },
    pieces: { unit: 'pièce', factor: 1 },
};

// Longest spelling first, so 'grammes' is tried before 'g'.
const UNIT_PATTERN = Object.keys(UNIT_FACTORS)
    .sort((a, b) => b.length - a.length)
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

const NUMBER_PATTERN = String.raw`\d+(?:\.\d+)?`;

/** No letter may follow the unit: '5 grosse' is not 5 grams. */
const UNIT_END = String.raw`(?!\p{L})`;

const MULTI_PACK = String.raw`(\d+)\s*[x×]\s*(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})${UNIT_END}`;
const SINGLE_PACK = String.raw`(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})${UNIT_END}`;

/** A line above this is not a grocery pack: the parse is a misread, not a size. */
const CAPACITY: Record<InferredUnit, number> = { kg: 25, l: 25, 'pièce': 500 };

const roundTo3 = (value: number): number => Math.round(value * 1000) / 1000;

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

/** Rounds and applies the capacity of the unit. Null when the result cannot be real. */
const bounded = (content: number, unit: InferredUnit): number | null => {
    if (!finitePositive(content)) return null;
    const rounded = roundTo3(content);
    if (!finitePositive(rounded) || rounded > CAPACITY[unit]) return null;
    return rounded;
};

const factorOf = (text: string): UnitFactor | null => {
    const found = UNIT_FACTORS[text];
    return found ?? null;
};

interface Candidate {
    content: number;
    unit: InferredUnit;
    start: number;
    end: number;
}

/** A fresh global regex per call: a shared one carries `lastIndex` between calls. */
const matcher = (source: string): RegExp => new RegExp(source, 'gu');

/**
 * The size one pack prints in its label, normalized: `{ content: 0.12, unit:
 * 'kg' }` for 'Boni sucre vanilliné 15x8g'. Null when the label prints no size,
 * prints two different ones, or prints one no grocery pack can hold.
 */
export const parsePrintedSize = (label: string): { content: number; unit: InferredUnit } | null => {
    try {
        if (typeof label !== 'string') return null;
        // '±' is the ticket saying "approximately": the number after it is the size.
        const text = label.toLowerCase().replace(/,/g, '.').replace(/±/g, ' ');

        const multiRanges: Array<[number, number]> = [];
        const candidates: Candidate[] = [];

        // Multi-packs first: '6x33cl' is 1.98 l of product, not 33 cl.
        for (const match of text.matchAll(matcher(MULTI_PACK))) {
            const start = match.index ?? 0;
            const end = start + match[0].length;
            const factor = factorOf(match[3]);
            if (!factor) continue;
            multiRanges.push([start, end]);
            candidates.push({
                content: Number(match[1]) * Number(match[2]) * factor.factor,
                unit: factor.unit,
                start,
                end,
            });
        }

        // Then every plain number+unit that is NOT part of a multi-pack.
        for (const match of text.matchAll(matcher(SINGLE_PACK))) {
            const start = match.index ?? 0;
            if (multiRanges.some(([from, to]) => start >= from && start < to)) continue;
            const factor = factorOf(match[2]);
            if (!factor) continue;
            candidates.push({
                content: Number(match[1]) * factor.factor,
                unit: factor.unit,
                start,
                end: start + match[0].length,
            });
        }

        if (candidates.length === 0) return null;

        // One distinct size only: '500g et 1kg' is two answers, so it is none.
        const distinct = new Map<string, Candidate>();
        for (const candidate of candidates) {
            if (!bounded(candidate.content, candidate.unit)) continue;
            distinct.set(`${candidate.unit}:${roundTo3(candidate.content)}`, candidate);
        }
        if (distinct.size !== 1) return null;

        const [only] = distinct.values();
        const content = bounded(only.content, only.unit);
        return content === null ? null : { content, unit: only.unit };
    } catch {
        return null;
    }
};

/** Packs bought: a whole count above 0, otherwise one pack. */
const packCount = (quantity: unknown): number => {
    const parsed = typeof quantity === 'number' ? quantity : Number(quantity);
    return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

/**
 * How much a reviewed line holds. The model's own content wins when the caller
 * already has one; this is the fallback the import and the analytics share.
 *
 * Order: a `unit` that itself carries a size ('350g', '1,5L'), then the size in
 * the label, then a fractional quantity — a weighed item, where the number
 * bought IS the weight in kilograms ('CONFERENCE LOS' 1.51).
 */
export const inferLineAmount = (line: {
    label: string;
    quantity: number;
    unit?: string | null;
}): InferredAmount | null => {
    try {
        const packs = packCount(line?.quantity);
        const quantity = typeof line?.quantity === 'number' ? line.quantity : Number(line?.quantity);
        const unitText = typeof line?.unit === 'string' ? line.unit : '';

        const fromUnit = parsePrintedSize(unitText);
        const fromLabel = fromUnit ? null : parsePrintedSize(typeof line?.label === 'string' ? line.label : '');
        const size = fromUnit ?? fromLabel;

        if (size) {
            const content = bounded(size.content * packs, size.unit);
            if (content === null) return null;
            return { content, unit: size.unit, source: fromUnit ? 'unit_size' : 'label' };
        }

        // A weighed line: 'CONFERENCE LOS' bought as 1.51 is 1.51 kg of pears.
        if (Number.isFinite(quantity) && quantity > 0 && !Number.isInteger(quantity)) {
            const content = bounded(quantity, 'kg');
            if (content === null) return null;
            return { content, unit: 'kg', source: 'weighed' };
        }

        return null;
    } catch {
        return null;
    }
};
