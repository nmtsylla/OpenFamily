// Where to buy the pending shopping items this week: the wire shape of
// `POST /api/market/plan` and the small pure helpers the card and the row badge
// share.
//
// The plan types mirror the server's contract field for field, so the client and
// the planner cannot drift apart silently. The store registry is this app's own:
// the server knows a chain's name, not how this app draws its dot.

import { intlLocale } from '../../i18n/format';
import { formatCurrency } from '../../lib/utils';
import type { PromoCountry, PromoOffer } from './product.custom';

/**
 * The cheapest current promotion a chain runs on one item.
 *
 * The same fields as the promo API's own offer, and deliberately the same type:
 * the planner's serializer (server/src/custom/lib/marketPlan.custom.ts) copies
 * one from the other field for field, so the shared PromoOfferRow can render a
 * plan's offer without a second, drifting row shape.
 */
export type MarketPlanOffer = PromoOffer;

/** One offer, tagged with the list item it was matched to. */
export interface MarketPlanRow extends MarketPlanOffer {
    item_id: string;
}

/** One proposal: the stores it visits and the cheapest row per item it covers. */
export interface MarketPlan {
    /** Retailer keys, in the configured order. */
    stores: string[];
    /** One row per item the plan covers. */
    rows: MarketPlanRow[];
    total: number;
    /** Money saved against the household's reference prices; negative when the plan costs more. */
    savings: number;
    /** Items that have a reference price. */
    referenced: number;
    /** Items no offer in `stores` covers. */
    missing: number;
}

/** The price an item is compared against: what the household last paid, else the lowest crossed-out price. */
export interface MarketItemReference {
    price: number;
    source: 'receipt' | 'regular';
    label: string | null;
    merchant: string | null;
    /** YYYY-MM-DD */
    date: string | null;
}

/** What the planner knows about a list item, whatever plan is selected. */
export interface MarketItemPlan {
    id: string;
    name: string;
    status: 'covered' | 'uncovered';
    reference: MarketItemReference | null;
    /** Every search term used for this item, deduped, in order. */
    terms: string[];
    /** The Dutch words the model proposed for it; empty without an AI pass. */
    dutch_terms: string[];
    /** The item's own wording found nothing and the Dutch fallback did. */
    translated: boolean;
    /** The cheapest offer of every configured store that has one, in `store_order`. */
    offers: MarketPlanOffer[];
}

export interface MarketPlanResponse {
    /** When the promotion snapshot behind these plans was taken. */
    fetched_at: string;
    /** The one country the planner searched. */
    country: PromoCountry;
    store_order: string[];
    store_names: Record<string, string>;
    /** The server's pick between the best single-store and the best two-store plan. */
    best: 'single' | 'pair';
    plans: {
        single: MarketPlan | null;
        pair: MarketPlan | null;
        all: MarketPlan | null;
    };
    items: MarketItemPlan[];
}

/** The three proposals, as `plans` names them. */
export type MarketPlanKey = 'single' | 'pair' | 'all';

/** The proposals in the order the card offers them. */
export const MARKET_PLAN_KEYS: readonly MarketPlanKey[] = ['single', 'pair', 'all'];

/** The list fields the planner needs; the id comes back on every row it matches. */
export interface MarketPlanItem {
    id: string;
    name: string;
    quantity?: number;
}

/** How a chain is drawn: its chip name, its footer label, its dot colour. */
export interface MarketStoreStyle {
    short: string;
    label: string;
    color: string;
}

/**
 * The four Belgian chains the planner ranks.
 *
 * `rgb(var(--token))`, not the prototype's bare `var(--token)`: these tokens are
 * RGB triplets in client/src/design/tokens.css, so a bare var() paints nothing
 * (which is why the prototype's own dots render invisible).
 */
export const MARKET_STORE_STYLE: Record<string, MarketStoreStyle> = {
    albert_heijn_be: { short: 'AH', label: 'Albert Heijn', color: 'rgb(var(--plum))' },
    colruyt: { short: 'Colruyt', label: 'Colruyt', color: 'rgb(var(--primary))' },
    aldi_be: { short: 'ALDI', label: 'ALDI', color: 'rgb(var(--peach))' },
    lidl_be: { short: 'Lidl', label: 'Lidl', color: 'rgb(var(--success))' },
};

/**
 * The chain's style, with a grey fallback for a key this build does not know (a
 * chain the deployment added, or another country's list): the server's own name
 * for it still beats a blank chip.
 */
export const storeStyle = (key: string, names: Record<string, string>): MarketStoreStyle => {
    const known = MARKET_STORE_STYLE[key];
    if (known) return known;
    const name = names[key] || key;
    return { short: name, label: name, color: 'rgb(var(--muted-foreground))' };
};

/**
 * The prototype's `signed()`: a saving is money not spent, so a positive saving
 * reads as a minus amount ("−8,26 €") and a plan that costs more than the usual
 * price reads as a plus.
 */
export const signedMoney = (amount: number, currency: string): string =>
    amount >= 0 ? `−${formatCurrency(amount, currency)}` : `+${formatCurrency(-amount, currency)}`;

/** Day and month ("17/10"). Empty for a missing or unparseable value. */
export const shortDate = (value: string | null | undefined): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit' }).format(date);
};

/**
 * The rows a plan holds for one item. The server sends at most one (the cheapest
 * offer among the plan's stores), so callers take the first.
 */
export const planRowsFor = (plan: MarketPlan | null, itemId: string): MarketPlanRow[] =>
    (plan?.rows ?? []).filter((row) => row.item_id === itemId);

/** One store of a plan: its style, and what the plan buys there. */
export interface MarketStoreCoverage {
    key: string;
    style: MarketStoreStyle;
    count: number;
    sum: number;
}

/**
 * The plan's stores in the order the server listed them, each with the rows it
 * holds. `sum` is local, because only the whole-plan `total` comes from the
 * server; a row without a price counts as nothing rather than breaking the line.
 */
export const storesOfPlan = (plan: MarketPlan, names: Record<string, string>): MarketStoreCoverage[] =>
    plan.stores.map((key) => {
        const rows = plan.rows.filter((row) => row.retailer === key);
        return {
            key,
            style: storeStyle(key, names),
            count: rows.length,
            sum: rows.reduce((total, row) => total + (row.price ?? 0), 0),
        };
    });
