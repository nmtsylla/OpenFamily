// =============================================================================
// The amount of receipt lines that no data can size.
//
// A line imported before `custom/0010`, or one whose ticket printed no size (and
// no weighed quantity), has no amount. The label inference cannot help, and unit
// price is not a quantity (a ticket prints a per-kg price or a promo). The only
// source left is the family: one answer per printed label, "one pack holds X",
// applied to every line that prints it.
//
// Pure: no database, no clock. The route keeps the SQL.
// =============================================================================

import { pantryNameKey } from './pantry.custom';
import { inferLineAmount } from './quantityInference.custom';

export interface AmountlessLine {
    id: string;
    /** The printed text of the ticket line. */
    label: string;
    /** Packs bought on that line. */
    quantity: number;
    /** What the line cost. */
    amount: number;
    /** YYYY-MM-DD of the receipt. */
    date: string;
}

export interface MissingAmountGroup {
    /** Folded label: what the fill request names, so an accent or a case cannot miss. */
    key: string;
    /** The spelling the family sees: the most frequent one in the group. */
    label: string;
    lines: number;
    /** Packs across the group, so the family sees whether it is one bag or six. */
    packs: number;
    amount: number;
    /** Newest receipt in the group, YYYY-MM-DD. */
    last: string;
}

export interface AmountFill {
    id: string;
    content: number;
    unit: string;
}

/** Most groups a page asks about: one screenful of answers, not a spreadsheet. */
export const MAX_MISSING_AMOUNTS = 50;
/** One pack above this is not a grocery pack: the answer is a misread. */
export const MAX_PACK_CONTENT = 25000;
export const MAX_UNIT_LENGTH = 50;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Most frequent spelling, ties broken by the shorter text, then alphabetically. */
const pickSpelling = (counts: Map<string, number>): string => {
    let best = '';
    let bestCount = -1;
    for (const [text, count] of counts) {
        const better =
            count > bestCount ||
            (count === bestCount &&
                (text.length < best.length || (text.length === best.length && compareText(text, best) < 0)));
        if (better) {
            best = text;
            bestCount = count;
        }
    }
    return best;
};

/** Packs bought: a positive number, else one pack. */
const packsOf = (quantity: number): number => (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);

interface Group {
    labels: Map<string, number>;
    lines: number;
    packs: number;
    amount: number;
    last: string;
}

/**
 * The labels still waiting for an answer. A line the size inference can read is
 * left out: those amounts are already in the stats, so asking would be noise.
 */
export const groupMissingAmounts = (
    lines: readonly AmountlessLine[],
    max = MAX_MISSING_AMOUNTS,
): { groups: MissingAmountGroup[]; hidden: number } => {
    const groups = new Map<string, Group>();

    for (const line of lines) {
        const label = String(line.label ?? '').trim();
        const key = pantryNameKey(label);
        if (key.length === 0) continue;

        const packs = packsOf(line.quantity);
        // The family is only asked what the ticket cannot say.
        if (inferLineAmount({ label, quantity: packs })) continue;

        const group = groups.get(key) ?? { labels: new Map(), lines: 0, packs: 0, amount: 0, last: '' };
        group.labels.set(label, (group.labels.get(label) ?? 0) + 1);
        group.lines += 1;
        group.packs += packs;
        group.amount += finite(line.amount);
        if (line.date && line.date > group.last) group.last = line.date;
        groups.set(key, group);
    }

    const all: MissingAmountGroup[] = Array.from(groups, ([key, group]) => ({
        key,
        label: pickSpelling(group.labels),
        lines: group.lines,
        packs: round3(group.packs),
        amount: Math.round(group.amount * 100) / 100,
        last: group.last,
    })).sort((a, b) => b.amount - a.amount || compareText(a.label, b.label));

    const shown = all.slice(0, Math.max(0, max));
    return { groups: shown, hidden: all.length - shown.length };
};

/**
 * What a fill writes: one row per line that prints the label, `perPack` times the
 * packs it bought. A line whose amount is already stored is not touched (the
 * caller's query only returns NULL ones, and the UPDATE repeats the test).
 */
export const planAmountFill = (
    lines: readonly AmountlessLine[],
    key: string,
    perPack: number,
    unit: string,
): AmountFill[] => {
    const folded = pantryNameKey(String(key ?? ''));
    const cleanUnit = String(unit ?? '').trim().slice(0, MAX_UNIT_LENGTH);
    if (folded.length === 0 || cleanUnit.length === 0) return [];
    if (!(Number.isFinite(perPack) && perPack > 0)) return [];
    const per = round3(perPack);
    if (!(per > 0) || per > MAX_PACK_CONTENT) return [];

    const fills: AmountFill[] = [];
    for (const line of lines) {
        if (pantryNameKey(String(line.label ?? '').trim()) !== folded) continue;
        const content = round3(per * packsOf(line.quantity));
        if (!(content > 0)) continue;
        fills.push({ id: line.id, content, unit: cleanUnit });
    }
    return fills;
};

/** '1,5' and '1.5' are the same answer; anything not a real pack size is null. */
export const parsePerPack = (value: unknown): number | null => {
    const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.replace(',', '.') : NaN;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_PACK_CONTENT) return null;
    return round3(parsed);
};

export const cleanUnit = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const unit = value.replace(/\s+/g, ' ').trim().slice(0, MAX_UNIT_LENGTH);
    return unit.length > 0 ? unit : null;
};
