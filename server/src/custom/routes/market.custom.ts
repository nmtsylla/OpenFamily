// The shopping list's "where to buy" card, server side.
//
//   POST /api/market/plan   { items: [{ id, name, quantity? }], lang? }
//
// One request per page load: for every pending item, the cheapest promotion
// running today at the household's chains, then the three candidate plans to buy
// the list with — one store, two stores, everywhere — scored against the
// household's own reference price (the last receipt line for that product, else
// the lowest crossed-out price a chain published). The client renders the plan;
// the arithmetic lives in lib/marketPlan.custom.ts.
//
// Where the inputs come from: PrijsProfeet (free plan) for the promotions and the
// crossed-out prices, the fork's own tables for the barcode links
// (custom_shopping_item_barcodes) and the pantry names that widen a search, and
// budget_receipt_items / budget_receipts for what the family itself paid. The
// model is asked two things and nothing else — Dutch search words for a
// French/English list, and which of the found rows are really the same product
// (lib/marketAi.custom.ts). It never touches a price.
//
// One page load is a fan-out, so it is budgeted: at most MAX_ITEMS items, each
// searched with at most MAX_ITEM_TERMS terms, term searches pooled at
// MAX_MARKET_FETCHES in flight (an item is one slot, and each slot asks one
// request at a time — see offersForTerms), and one model call per 12 items.
//
// Failure policy, deliberately: an item that cannot be looked up is uncovered,
// not an error, and an unreachable PrijsProfeet still answers 200 with every item
// uncovered — the client renders nothing when there is nothing, and a page reload
// must not 500 because the upstream is down.

import { Router } from 'express';
import { query } from '../../db';
import logger from '../../lib/logger';
import { authMiddleware, type AuthRequest } from '../../middleware/auth';
import { loadEnabledAiSettings } from '../lib/aiSettings.custom';
import { dutchTermsFor, verifyKept } from '../lib/marketAi.custom';
import {
    applyKeepIndexes,
    bestPlans,
    candidateTerms,
    dedupeTerms,
    itemOffersOf,
    mapWithConcurrency,
    marketCountry,
    marketStores,
    offerLabelsOf,
    referencePriceOf,
    type MarketBasketItem,
    type MarketItemReference,
    type MarketPlanResponse,
    type MarketReceiptLine,
} from '../lib/marketPlan.custom';
import { pantryAliasKeys, pantryKeyResolver, pantryNameKey } from '../lib/pantry.custom';
import { dealsForBarcode, labelOf, offersForTerms, type PromoOffer } from '../lib/prijsprofeet.custom';
import { resolvePromptLanguage } from '../lib/promptLanguage.custom';

const router = Router();
router.use(authMiddleware);

/** One request, one card: a longer list is paged by the client, not priced in one go. */
const MAX_ITEMS = 50;
/** The column `shopping_items.id` is a UUID; the id is only echoed back, so a plain bound. */
const MAX_ITEM_ID = 64;
/** `custom_pantry_items.name` is 160 wide; a list item's name has no business being longer. */
const MAX_ITEM_NAME = 80;
/** The outbound budget of one plan: items in flight, one PrijsProfeet search each. */
const MAX_MARKET_FETCHES = 6;
/** dealsForBarcode asks every configured country in parallel, so three barcodes are six requests. */
const MAX_BARCODE_FETCHES = 3;
/** Newest pantry names first: a household's stock is a few hundred names, and the nearest matter. */
const MAX_PANTRY_NAMES = 200;
/** Receipt lines, newest first: roughly the last three months of shopping. */
const MAX_RECEIPT_LINES = 400;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface MarketItemSeed {
    id: string;
    name: string;
    /** Posted by the client, carried no further: a plan prices one pack, the chain's own. */
    quantity: number | null;
}

/**
 * The posted list, as far as a plan can use it. Entries without a usable id or
 * name are dropped rather than guessed at, and a name the household typed twice
 * stays twice — each entry gets its own answer, so the card can line them up.
 */
const itemSeedsOf = (raw: readonly unknown[]): MarketItemSeed[] => {
    const seeds: MarketItemSeed[] = [];
    for (const entry of raw) {
        if (seeds.length >= MAX_ITEMS) break;
        if (!entry || typeof entry !== 'object') continue;

        const row = entry as Record<string, unknown>;
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        const name = typeof row.name === 'string' ? row.name.trim().slice(0, MAX_ITEM_NAME) : '';
        if (!id || id.length > MAX_ITEM_ID || !name) continue;

        const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : null;
        seeds.push({ id, name, quantity });
    }
    return seeds;
};

/** One posted item, from its barcode or its search to the price it is compared against. */
interface MarketItemState {
    seed: MarketItemSeed;
    /** Every term this item was searched with, deduped, in order. Empty for a barcode. */
    terms: string[];
    /** The offers that survived the search and the model's pass. */
    offers: PromoOffer[];
    reference: MarketItemReference | null;
    /** Text path only: at least one search answered, so a Dutch fallback is worth asking. */
    searched: boolean;
    /** The Dutch words the model proposed, kept whether or not they ended up matching. */
    dutchTerms: string[];
    /** Text path only: a Dutch fallback term is what matched. */
    translated: boolean;
}

const loadPantryNames = async (userId: string): Promise<string[]> => {
    const result = await query(`SELECT name FROM custom_pantry_items WHERE user_id = $1 LIMIT ${MAX_PANTRY_NAMES}`, [userId]);
    return result.rows.map((row) => String(row.name));
};

/** Every barcode the family linked to a shopping row, keyed by that row's id. */
const loadItemBarcodes = async (userId: string): Promise<Map<string, string>> => {
    const result = await query(
        `SELECT b.shopping_item_id, b.barcode
         FROM custom_shopping_item_barcodes b
         JOIN shopping_items i ON i.id = b.shopping_item_id
         WHERE i.user_id = $1`,
        [userId]
    );
    return new Map(result.rows.map((row) => [String(row.shopping_item_id), String(row.barcode)]));
};

/**
 * What the family actually paid, newest first. The reference price is read off
 * these, and it is the first line that names a product, so the order is spelled
 * out to the last row: two tickets of the same day must not make two page loads
 * answer with two different prices. Within a ticket, the line the payer read
 * first (its `position`).
 */
const loadReceiptLines = async (userId: string): Promise<MarketReceiptLine[]> => {
    const result = await query(
        `SELECT i.label, i.unit_price, i.amount, i.quantity, r.merchant, r.date
         FROM budget_receipt_items i
         JOIN budget_receipts r ON r.id = i.receipt_id
         WHERE r.user_id = $1
         ORDER BY r.date DESC, r.created_at DESC, i.position ASC, i.id DESC LIMIT ${MAX_RECEIPT_LINES}`,
        [userId]
    );
    return result.rows;
};

router.post('/plan', async (req: AuthRequest, res) => {
    const rawItems = req.body?.items;
    if (!Array.isArray(rawItems)) {
        return res.status(400).json({ success: false, error: 'items must be an array' });
    }

    const seeds = itemSeedsOf(rawItems);
    const lang = resolvePromptLanguage(req.body?.lang);

    try {
        const userId = req.userId!;
        const country = marketCountry();
        const storeOrder = marketStores();

        const [pantryNames, barcodes, receiptLines, aiSettings] = await Promise.all([
            loadPantryNames(userId),
            loadItemBarcodes(userId),
            loadReceiptLines(userId),
            // Loaded with the rest, not on the AI path only: one row, and the
            // fallback pass must not add a round-trip when it is reached.
            loadEnabledAiSettings(userId),
        ]);

        const states: MarketItemState[] = seeds.map((seed) => ({
            seed,
            terms: [],
            offers: [],
            reference: null,
            searched: false,
            dutchTerms: [],
            translated: false,
        }));

        // Barcode first: a scanned item names its product exactly, so it is never
        // searched by text and never judged by the model.
        const scanned = states.filter((state) => barcodes.has(state.seed.id));
        await mapWithConcurrency(scanned, MAX_BARCODE_FETCHES, async (state) => {
            try {
                const offers = await dealsForBarcode(barcodes.get(state.seed.id)!);
                state.offers = offers.filter((offer) => offer.country === country);
            } catch (error) {
                // One barcode the deals API cannot answer leaves its item
                // uncovered; the rest of the card is still worth rendering.
                logger.warn('market.barcode_failed', { item: state.seed.id, error: messageOf(error) });
            }
        });

        const searched = states.filter((state) => !barcodes.has(state.seed.id));

        // The pantry's own names widen the search: a row the family wrote as
        // 'Uien - Oignon' answers to both, and its name is what the offer has to
        // contain anyway.
        const resolver = pantryKeyResolver(pantryNames.map(pantryNameKey));
        for (const state of searched) {
            const resolved = resolver(state.seed.name);
            const aliases = pantryAliasKeys(resolved).filter((alias) => alias !== pantryNameKey(state.seed.name));
            state.terms = candidateTerms(state.seed.name, aliases);
        }

        await mapWithConcurrency(searched, MAX_MARKET_FETCHES, async (state) => {
            if (!state.terms.length) return;
            try {
                state.offers = await offersForTerms(country, state.terms);
                state.searched = true;
            } catch (error) {
                // Every term failed for this item, so it stays uncovered — and the
                // whole request still answers 200.
                logger.warn('market.terms_failed', { item: state.seed.id, terms: state.terms, error: messageOf(error) });
            }
        });

        if (aiSettings) {
            // A second chance in Dutch for what the plain search could not cover.
            // Only for items whose search itself worked: with PrijsProfeet down,
            // asking the model for words and searching them spends tokens to reach
            // the same zero.
            const fallback = searched.filter((state) => state.searched && !state.offers.length);
            if (fallback.length) {
                const dutchTerms = await dutchTermsFor(aiSettings, lang, fallback.map((state) => state.seed.name));
                await mapWithConcurrency(fallback, MAX_MARKET_FETCHES, async (state) => {
                    const terms = dutchTerms.get(state.seed.name) ?? [];
                    if (!terms.length) return;
                    state.dutchTerms = terms;
                    state.terms = dedupeTerms([...state.terms, ...terms]);
                    try {
                        const offers = await offersForTerms(country, terms);
                        state.offers = offers;
                        state.translated = offers.length > 0;
                    } catch (error) {
                        logger.warn('market.fallback_failed', { item: state.seed.id, terms, error: messageOf(error) });
                    }
                });
            }

            // One call for the whole request (it chunks inside): the model sees the
            // item and the candidate product names, and drops the rows that are
            // another product entirely. A failure keeps every row.
            const verify = searched
                .map((state) => ({ state, candidates: offerLabelsOf(state.offers) }))
                .filter(({ candidates }) => candidates.length > 0);
            if (verify.length) {
                const kept = await verifyKept(
                    aiSettings,
                    lang,
                    verify.map(({ state, candidates }) => ({ name: state.seed.name, candidates }))
                );
                verify.forEach(({ state, candidates }, position) => {
                    state.offers = applyKeepIndexes(state.offers, candidates, kept[position]);
                });
            }
        }

        for (const state of states) {
            state.reference = referencePriceOf(state.terms, receiptLines, state.offers);
            // A Dutch word that no longer covers anything did not translate the
            // match: `status` says uncovered, and this has to agree with it.
            if (!state.offers.length) state.translated = false;
        }

        const basket: MarketBasketItem[] = states.map((state) => ({
            id: state.seed.id,
            offers: state.offers,
            reference: state.reference,
        }));
        const { single, pair, all, best } = bestPlans(basket, storeOrder);

        const data: MarketPlanResponse = {
            fetched_at: new Date().toISOString(),
            country,
            store_order: storeOrder,
            store_names: Object.fromEntries(storeOrder.map((key) => [key, labelOf(key)])),
            best,
            plans: { single, pair, all },
            items: states.map((state) => ({
                id: state.seed.id,
                name: state.seed.name,
                status: state.offers.length > 0 ? 'covered' : 'uncovered',
                reference: state.reference,
                terms: state.terms,
                dutch_terms: state.dutchTerms,
                translated: state.translated,
                offers: itemOffersOf(state.offers, storeOrder),
            })),
        };

        res.json({ success: true, data });
    } catch (error) {
        logger.error('market.plan_failed', { error: messageOf(error) });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
