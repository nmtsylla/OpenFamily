// =============================================================================
// The "where to buy" card's two AI questions.
//
// Both answer something a string comparison cannot, and neither is trusted:
//
// 1. dutchTermsFor — the list is written in French (or English) but the chains
//    are Dutch-language shops, and the free tier's `q` barely answers French
//    ('lait' returns 2 rows on the live BE catalogue, 'melk' hundreds). The model
//    turns one product name into up to three Dutch search words.
// 2. verifyKept — that same `q` is fuzzy: `q=brood` answers tortilla chips, and
//    the prototype's own audit found 'Mangue' matching Magnum wine. Containment
//    cannot tell "Mango" from "Magnum wijn"; the model can.
//
// What the model never does: price anything. Prices, totals and savings come from
// the API's own rows through lib/marketPlan.custom.ts. Here it only proposes
// search words and names which candidate rows are the same kind of product.
//
// Failures are never the family's problem: every path degrades to what the plain
// search found (a chunk that cannot be answered contributes nothing; a
// verification that fails keeps every row). Both answers are cached per product
// until the same morning boundary the promotions use, because a term list is only
// as fresh as the offers it is searched against.
// =============================================================================

import { aiComplete, type AiSettings } from '../../services/ai';
import logger from '../../lib/logger';
import { msUntilRefresh } from './prijsprofeet.custom';
import { comparable } from './promoFocus.custom';
import type { PromptLanguage } from './promptLanguage.custom';

/** Products per call. The answer is one JSON row per product, so it stays small. */
const MAX_AI_ITEMS = 12;

/** How many Dutch words one product may be searched with, and how long one may be. */
const MAX_DUTCH_TERMS = 3;
const MAX_DUTCH_TERM_LENGTH = 24;
const MIN_DUTCH_TERM_LENGTH = 2;

/** One product and the candidate product names the search kept for it. */
export interface MarketVerifyEntry {
    name: string;
    candidates: readonly string[];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

const getCached = <T>(key: string): T | undefined => {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
        cache.delete(key);
        return undefined;
    }
    return hit.value as T;
};

/**
 * Bounded insert, like the promo cache. The verification key carries the API's
 * own product names, so an authenticated caller could mint a fresh key per
 * request; oldest-inserted first (Map order) is what bounds that.
 */
const setCached = (key: string, value: unknown): void => {
    if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(key)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    // The overnight boundary the promotions refresh on: a day-old Dutch word is
    // as good as a new one, and the key includes the product name it was made for.
    cache.set(key, { expiresAt: Date.now() + msUntilRefresh(), value });
};

const termsKey = (nameKey: string): string => `translate:${nameKey}`;

/** A verdict is about one product and the rows it was shown, never about a price. */
const verifyKey = (entry: MarketVerifyEntry): string =>
    `verify:${comparable(entry.name)}:${entry.candidates.map((candidate) => comparable(candidate)).join('|')}`;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
    const groups: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        groups.push(items.slice(index, index + size));
    }
    return groups;
};

// ---------------------------------------------------------------------------
// Dutch search words
// ---------------------------------------------------------------------------

/**
 * The schema is what a provider with native JSON mode is held to. The prompt is
 * French for a French reader and English for everyone else — the same split as
 * the lunchbox and outing prompts, with one difference: the language of the
 * ANSWER is decided by the shops, not by the reader, so the English prompt says
 * so outright instead of asking for the reader's language.
 */
const DUTCH_TERMS_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['products'],
    properties: {
        products: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'terms'],
                properties: {
                    index: { type: 'integer' },
                    terms: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
};

const buildTermsSystemPrompt = (lang: PromptLanguage): string => {
    if (lang === 'fr') {
        return `Tu prépares la liste de courses d'une famille en Belgique. Les supermarchés interrogés sont néerlandophones : les mots-clés de recherche doivent être en NÉERLANDAIS, même quand le produit est écrit en français ou en anglais.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "products": [
    {
      "index": integer,     // le numéro du produit dans la liste, à partir de 0
      "terms": string[]     // 1 à 3 mots-clés néerlandais, en minuscules
    }
  ]
}

Règles :
- Un mot-clé est le nom courant du produit en néerlandais, au singulier, sans marque :
  'Mangue' → ['mango'], 'Pain' → ['brood'], 'Œufs' → ['eieren'], 'Lait chocolaté' → ['chocolademelk'].
- Deux mots au maximum, et seulement quand le mot seul est ambigu.
- Jamais de phrase, jamais de marque, jamais de nom de magasin, jamais de mot français.
- Une seule entrée par produit, avec son numéro exact. "terms": [] quand aucun mot néerlandais évident n'existe.`;
    }

    return `You are preparing a Belgian family's shopping list. The supermarkets are Dutch-language chains, so the search words must be in DUTCH even when the product is written in French or English — whatever the language of this prompt.
Answer with a valid JSON object ONLY, no text before or after, no markdown.

Expected schema:
{
  "products": [
    {
      "index": integer,     // the product's number in the list, starting at 0
      "terms": string[]     // 1 to 3 Dutch search words, lowercase
    }
  ]
}

RULES:
- A search word is the everyday Dutch name of the product, singular, without the brand:
  'Mangue' → ['mango'], 'Pain' → ['brood'], 'Œufs' → ['eieren'], 'Lait chocolaté' → ['chocolademelk'].
- Two words at most, and only when the single word is ambiguous.
- No sentences, no brand names, no shop names, no French words.
- One entry per product, with its exact number. "terms": [] when no obvious Dutch word exists.`;
};

const buildTermsUserPrompt = (names: readonly string[], lang: PromptLanguage): string =>
    [lang === 'fr' ? 'Produits :' : 'Products:', ...names.map((name, index) => `${index}. ${name}`)].join('\n');

/**
 * The model's search words as they may be used: strings only, lowercase, letters
 * and hyphens, at most three, deduped.
 *
 * Accents are kept rather than folded. The words are looked up by a Dutch shop
 * API that decides what matches, and every comparison on this side (the cache
 * key, the verification of an offer against its term) already folds accents, so
 * keeping them costs nothing and searching 'crème' as 'creme' would only guess.
 *
 * `itemName` is the product the words are meant for. A word identical to it is
 * not a translation, and searching the list's own text again can only answer what
 * the first search already answered.
 */
export const sanitizeDutchTerms = (raw: unknown, itemName = ''): string[] => {
    if (!Array.isArray(raw)) return [];
    const own = comparable(itemName);
    const seen = new Set<string>();
    const terms: string[] = [];

    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const term = entry
            .toLowerCase()
            // \p{L} keeps é and ë (a Dutch word may carry either) and collapses
            // everything a search query has no business carrying — punctuation,
            // digits, quotes — to a space.
            .replace(/[^\p{L}\s-]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^-+|-+$/g, '')
            .trim()
            .slice(0, MAX_DUTCH_TERM_LENGTH)
            .trim();

        const key = comparable(term);
        if (key.length < MIN_DUTCH_TERM_LENGTH || (own && key === own) || seen.has(key)) continue;
        seen.add(key);
        terms.push(term);
        if (terms.length >= MAX_DUTCH_TERMS) break;
    }

    return terms;
};

/**
 * Up to three Dutch search words per product, keyed by every spelling the caller
 * asked for. Products already answered today are not asked again — the cache is
 * per product, so a list that keeps the same item costs nothing tomorrow morning.
 *
 * A chunk the model could not answer costs the Dutch fallback for its products
 * and nothing else: the card still shows what the plain search found for them.
 */
export async function dutchTermsFor(
    settings: AiSettings,
    lang: PromptLanguage,
    names: readonly string[]
): Promise<Map<string, string[]>> {
    // One question per product, however the list spells it: 'Mangue' and 'mangue'
    // are the same search, and both spellings get the one answer.
    const wanted = new Map<string, string>();
    for (const name of names) {
        const key = comparable(name);
        if (key && !wanted.has(key)) wanted.set(key, name);
    }

    const missing = [...wanted.keys()].filter((key) => getCached<string[]>(termsKey(key)) === undefined);
    for (const group of chunk(missing, MAX_AI_ITEMS)) {
        const products = group.map((key) => wanted.get(key) ?? '');
        try {
            const raw = await aiComplete(settings, {
                system: buildTermsSystemPrompt(lang),
                user: buildTermsUserPrompt(products, lang),
                jsonSchema: DUTCH_TERMS_SCHEMA,
            });

            const byIndex = new Map<number, string[]>();
            const listed = (raw as { products?: unknown }).products;
            if (Array.isArray(listed)) {
                for (const entry of listed) {
                    if (!entry || typeof entry !== 'object') continue;
                    const row = entry as Record<string, unknown>;
                    const index = row.index;
                    // An answer about a product this chunk did not ask about is
                    // not an answer: the index is the only thing tying a term
                    // list to a product, so it has to be one of the chunk's own.
                    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= group.length || byIndex.has(index)) {
                        continue;
                    }
                    byIndex.set(index, sanitizeDutchTerms(row.terms, products[index]));
                }
            }
            group.forEach((key, index) => setCached(termsKey(key), byIndex.get(index) ?? []));
        } catch (error) {
            logger.warn('market.translate_failed', {
                products: group.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return new Map(names.map((name) => [name, getCached<string[]>(termsKey(comparable(name))) ?? []]));
}

// ---------------------------------------------------------------------------
// Which found rows are really the requested product
// ---------------------------------------------------------------------------

const VERIFY_SCHEMA: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'keep'],
                properties: {
                    index: { type: 'integer' },
                    keep: { type: 'array', items: { type: 'integer' } },
                },
            },
        },
    },
};

const buildVerifySystemPrompt = (lang: PromptLanguage): string => {
    if (lang === 'fr') {
        return `Tu vérifies la liste de courses d'une famille. Pour chaque produit demandé, on te donne les promotions trouvées dans les supermarchés, numérotées.
Dis quelles promotions sont le MÊME TYPE de produit que celui demandé — même catégorie, même usage — et lesquelles sont autre chose.
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans markdown.

Schéma attendu :
{
  "items": [
    {
      "index": integer,    // le numéro du produit, à partir de 0
      "keep": integer[]    // les numéros des promotions à garder
    }
  ]
}

Règles :
- Garde une promotion quand elle peut remplacer le produit demandé :
  'Mangue' → 'Mango' oui, 'Magnum wijn' non ; 'Brood' → 'Tarwebrood' oui, 'Tortilla chips' non.
- Écarte ce qui n'est qu'un ingrédient, une boisson, un dessert ou un plat préparé à base du produit :
  'Mangue' ne prend ni 'jus de mangue', ni 'smoothie mangue', ni 'yaourt à la mangue'.
- Le prix, la marque et le magasin ne comptent pas.
- En cas de doute, garde la promotion : une promotion en trop coûte moins cher qu'un produit manquant.
- "keep" doit lister TOUTES les promotions à garder : une promotion absente de la liste est écartée.
- Une seule entrée par produit, avec son numéro exact.`;
    }

    return `You are checking a Belgian family's shopping list. For each requested product you are given the promotions found in the supermarkets, numbered.
Say which promotions are the SAME KIND of product as the requested one — same category, same use — and which are something else.
Answer with a valid JSON object ONLY, no text before or after, no markdown.

Expected schema:
{
  "items": [
    {
      "index": integer,    // the product's number, starting at 0
      "keep": integer[]    // the numbers of the promotions to keep
    }
  ]
}

RULES:
- Keep a promotion when it can replace the requested product:
  'Mangue' → 'Mango' yes, 'Magnum wijn' no; 'Brood' → 'Tarwebrood' yes, 'Tortilla chips' no.
- Drop anything that is only an ingredient, a drink, a dessert or a prepared dish made from the product:
  'Mangue' takes neither 'jus de mangue', nor 'smoothie mangue', nor 'yaourt à la mangue'.
- Price, brand and shop do not count.
- When in doubt, keep the promotion: one promotion too many costs less than a missing product.
- "keep" must list EVERY promotion to keep: a promotion left out is discarded.
- One entry per product, with its exact number.`;
};

const buildVerifyUserPrompt = (entries: readonly MarketVerifyEntry[], lang: PromptLanguage): string => {
    const lines: string[] = [lang === 'fr' ? 'Produits et promotions :' : 'Products and promotions:'];
    entries.forEach((entry, index) => {
        lines.push('', lang === 'fr' ? `Produit ${index} : ${entry.name}` : `Product ${index}: ${entry.name}`);
        entry.candidates.forEach((candidate, position) => lines.push(`  ${position}. ${candidate}`));
    });
    return lines.join('\n');
};

/**
 * The model's verdict as indexes that can be trusted: integers, in range, no
 * duplicates, one list per entry.
 *
 * Silence is not a verdict. An entry the model did not answer, an entry whose
 * `keep` is not a list, and an entry whose list is empty all mean the same —
 * keep every candidate. A model that leaves a row out of its answer must not be
 * what deletes a product's whole promotion block from the family's card; the
 * price of that choice is that a lone wrong row survives.
 *
 * `candidateCount` is per entry, or one number when the caller's entries are
 * uniform.
 */
export const sanitizeKeepIndexes = (
    raw: unknown,
    entryCount: number,
    candidateCount: number | readonly number[]
): number[][] => {
    const counts = Array.from({ length: Math.max(0, entryCount) }, (_, entry) =>
        typeof candidateCount === 'number' ? candidateCount : candidateCount[entry] ?? 0
    );
    const everyIndex = counts.map((count) => Array.from({ length: Math.max(0, count) }, (_, index) => index));

    const answered = new Map<number, number[]>();
    const items = (raw as { items?: unknown } | null | undefined)?.items;
    if (Array.isArray(items)) {
        for (const entry of items) {
            if (!entry || typeof entry !== 'object') continue;
            const row = entry as Record<string, unknown>;
            const index = row.index;
            if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= counts.length) continue;
            if (!Array.isArray(row.keep)) continue;

            const kept = [
                ...new Set(
                    row.keep.filter(
                        (value): value is number =>
                            typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < counts[index]
                    )
                ),
            ];
            if (kept.length) answered.set(index, kept);
        }
    }

    return counts.map((_, entry) => answered.get(entry) ?? everyIndex[entry]);
};

/**
 * Which of each entry's candidate names are the same kind of product, as
 * indexes into that entry's `candidates`.
 *
 * One call per chunk of 12 entries and per day: the verdict is cached per entry
 * (product name + candidate names, never a price), so a second page load of the
 * same list costs no tokens at all.
 *
 * Every failure — the provider unreachable, the model babbling, a chunk timing
 * out — keeps all of that chunk's rows.
 */
export async function verifyKept(
    settings: AiSettings,
    lang: PromptLanguage,
    entries: readonly MarketVerifyEntry[]
): Promise<number[][]> {
    const everyIndex = entries.map((entry) => entry.candidates.map((_, index) => index));

    const missing: number[] = [];
    entries.forEach((entry, index) => {
        if (getCached<number[]>(verifyKey(entry)) === undefined) missing.push(index);
    });

    for (const group of chunk(missing, MAX_AI_ITEMS)) {
        const asked = group.map((index) => entries[index]);
        try {
            const raw = await aiComplete(settings, {
                system: buildVerifySystemPrompt(lang),
                user: buildVerifyUserPrompt(asked, lang),
                jsonSchema: VERIFY_SCHEMA,
            });
            const kept = sanitizeKeepIndexes(raw, asked.length, asked.map((entry) => entry.candidates.length));
            group.forEach((entryIndex, position) => setCached(verifyKey(entries[entryIndex]), kept[position]));
        } catch (error) {
            logger.warn('market.verify_failed', {
                items: asked.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return entries.map((entry, index) => getCached<number[]>(verifyKey(entry)) ?? everyIndex[index]);
}
