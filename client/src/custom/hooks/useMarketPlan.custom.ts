// Where to buy the pending shopping items this week: one request to the server's
// planner, the proposal the user picked, and the two per-row lookups the list
// needs.
//
// No plan logic lives here. The server holds the promotions and the household's
// reference prices, so this hook forwards the items, keeps the answer, and
// resolves which row a list row should show.

import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { MARKET_PLAN_KEYS, planRowsFor } from '../lib/market.custom';
import type { MarketPlanItem, MarketPlanKey, MarketPlanResponse, MarketPlanRow } from '../lib/market.custom';

const BASE = '/api/market/plan';
// A list edit is rarely alone (remove a row, add another): waiting out the burst
// keeps the card from asking per keystroke and from flickering between answers.
const DEBOUNCE_MS = 800;
// How the cheapest row of another plan is looked for: `all` covers every
// configured store, so it holds the best price of the three.
const ALTERNATIVE_PLAN_ORDER: readonly MarketPlanKey[] = ['all', 'pair', 'single'];

interface MarketPlanOptions {
    /** False keeps the hook from asking: a hidden card needs no plan. */
    enabled: boolean;
    items: MarketPlanItem[];
    /** The member's UI language, forwarded for the server's matching prompts. */
    lang: string;
}

/**
 * The plan the card shows: the user's pick while the payload still has it, else
 * the server's recommendation, else the first plan on offer. A proposal can
 * vanish between two answers (an item left, a chain stopped promoting), and the
 * card must not point at one that is no longer there.
 */
const resolveChosen = (wanted: MarketPlanKey | null, data: MarketPlanResponse | null): MarketPlanKey => {
    if (wanted && data?.plans[wanted]) return wanted;
    if (data && data.plans[data.best]) return data.best;
    return MARKET_PLAN_KEYS.find((key) => data?.plans[key]) ?? 'pair';
};

export function useMarketPlan({ enabled, items, lang }: MarketPlanOptions) {
    const [data, setData] = useState<MarketPlanResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [wanted, setWanted] = useState<MarketPlanKey | null>(null);
    // Only the newest request may answer: a slower answer to the list as it was
    // before the last edit would paint rows the user already removed.
    const requestId = useRef(0);

    // The request as one value. The page rebuilds `items` on every render, so the
    // array's identity says nothing about whether the plan needs asking again,
    // while this key changes exactly when a field the server matches on does.
    const itemsKey = JSON.stringify(items.map((item) => [item.id, item.name, item.quantity ?? null]));

    useEffect(() => {
        if (!enabled || items.length === 0) {
            requestId.current += 1;
            setData(null);
            setLoading(false);
            return;
        }

        const request = (requestId.current += 1);
        setLoading(true);

        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const response = await api.post<{ success: boolean; data: MarketPlanResponse }>(BASE, {
                        items: items.map((item) => ({
                            id: item.id,
                            name: item.name,
                            quantity: item.quantity,
                        })),
                        lang,
                    });
                    if (request !== requestId.current) return;
                    // The static demo answers its `ok([])` catch-all for the
                    // routes it does not know: a payload that is not a plan
                    // reads as "no plan" instead of breaking the card.
                    const payload = response?.data;
                    if (payload && Array.isArray(payload.items) && payload.plans) setData(payload);
                    else setData(null);
                } catch (error) {
                    if (request !== requestId.current) return;
                    console.error('Failed to load the market plan:', error);
                    setData(null);
                } finally {
                    if (request === requestId.current) setLoading(false);
                }
            })();
        }, DEBOUNCE_MS);

        return () => clearTimeout(timer);
        // `items` is read through `itemsKey`: see above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, itemsKey, lang]);

    const chosen = resolveChosen(wanted, data);

    const rowFor = (itemId: string): MarketPlanRow | null =>
        planRowsFor(data?.plans[chosen] ?? null, itemId)[0] ?? null;

    /**
     * The best price another plan holds for an item the chosen one cannot cover:
     * this is what a row shows as "Aussi chez Lidl 0,98 €" instead of going quiet.
     * The plans are walked cheapest-scope first and the lowest price wins, so the
     * chip names the store that is actually worth the trip.
     */
    const alternativeFor = (itemId: string): MarketPlanRow | null => {
        let best: MarketPlanRow | null = null;
        let bestPrice = Number.POSITIVE_INFINITY;
        for (const key of ALTERNATIVE_PLAN_ORDER) {
            if (key === chosen) continue;
            const [candidate] = planRowsFor(data?.plans[key] ?? null, itemId);
            const price = candidate?.price;
            if (!candidate || typeof price !== 'number' || !Number.isFinite(price)) continue;
            if (price < bestPrice) {
                best = candidate;
                bestPrice = price;
            }
        }
        return best;
    };

    return { data, loading, chosen, setChosen: setWanted, rowFor, alternativeFor };
}
