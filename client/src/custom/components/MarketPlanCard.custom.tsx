// Where to buy: the three plans the server compared, and the store-by-store
// reading of the selected one.
//
// The card quotes the numbers the server sent (rows, total, savings) instead of
// recomputing them, so the summary always says what the plan actually holds.
// `data.best` is read only to mark the server's pick with a star.

import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { PrijsProfeetCredit } from './PrijsProfeetCredit.custom';
import {
    MARKET_PLAN_KEYS,
    signedMoney,
    shortDate,
    storeStyle,
    storesOfPlan,
    type MarketPlanKey,
    type MarketPlanResponse,
} from '../lib/market.custom';

const PLAN_LABEL_KEY: Record<MarketPlanKey, string> = {
    single: 'market.custom:card.planSingle',
    pair: 'market.custom:card.planPair',
    all: 'market.custom:card.planAll',
};

const PLAN_MODE_KEY: Record<MarketPlanKey, string> = {
    single: 'market.custom:card.modeSingle',
    pair: 'market.custom:card.modePair',
    all: 'market.custom:card.modeAll',
};

// What joins two store names on the button's sub-line, "AH + ALDI".
const STORE_JOINER = ' + ';

interface MarketPlanCardProps {
    data: MarketPlanResponse;
    chosen: MarketPlanKey;
    onChoose: (key: MarketPlanKey) => void;
    currency: string;
}

export const MarketPlanCard: React.FC<MarketPlanCardProps> = ({ data, chosen, onChoose, currency }) => {
    const { t } = useTranslation();

    const plan = data.plans[chosen];
    // A proposal can be missing from a payload (no item was cheap enough to
    // propose it). The hook falls back to another one; until it does, nothing is
    // worth showing here.
    if (!plan) return null;

    const total = data.items.length;
    const coverage = storesOfPlan(plan, data.store_names);
    const savingsTone = plan.savings >= 0 ? 'text-success' : 'text-warning';

    return (
        <>
            <section className="rounded-card border border-border bg-card p-4 shadow-surface">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-h2 font-serif text-foreground">{t('market.custom:card.title')}</h2>
                    <span className="ml-auto text-micro text-muted-foreground">
                        {t('market.custom:card.promosFrom', { date: shortDate(data.fetched_at) })}
                    </span>
                </div>

                <p className="mt-2 text-caption text-muted-foreground">
                    <Trans
                        i18nKey="market.custom:card.summary"
                        values={{
                            covered: plan.rows.length,
                            total,
                            mode: t(PLAN_MODE_KEY[chosen]),
                            stores:
                                coverage
                                    .map((store) => `${store.style.label} (${store.count})`)
                                    .join(STORE_JOINER) || t('market.custom:card.planNoStore'),
                            totalPrice: formatCurrency(plan.total, currency),
                            savings: signedMoney(plan.savings, currency),
                        }}
                        components={{
                            covered: <span className="font-medium text-foreground" />,
                            stores: <span className="font-medium text-foreground" />,
                            totalPrice: <span className="font-medium text-foreground" />,
                            savings: <span className={`font-medium ${savingsTone}`} />,
                        }}
                    />
                </p>

                <div className="mt-3 space-y-2">
                    {MARKET_PLAN_KEYS.map((key) => {
                        const option = data.plans[key];
                        if (!option) return null;
                        const active = key === chosen;
                        // `best` is "single" or "pair" by contract, so it can
                        // never mark the four-store `all` plan: a round trip is
                        // not a recommendation.
                        const best = key === data.best;
                        const stops =
                            option.stores
                                .map((store) => storeStyle(store, data.store_names).short)
                                .join(STORE_JOINER) || t('market.custom:card.planNoStore');
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => onChoose(key)}
                                aria-pressed={active}
                                className={`flex w-full items-center gap-3 rounded-card border p-3 text-left transition-colors duration-fast ${
                                    active
                                        ? 'border-primary bg-primary-soft'
                                        : 'border-border bg-card hover:border-border-strong'
                                }`}
                            >
                                {active ? (
                                    <CheckCircle2 className="h-5 w-5 flex-none text-primary" />
                                ) : (
                                    <Circle className="h-5 w-5 flex-none text-border-strong" />
                                )}
                                <span className="min-w-0 flex-1">
                                    <span className="block text-caption font-medium text-foreground">
                                        {t(PLAN_LABEL_KEY[key])}
                                        {best ? <span className="text-primary"> ★</span> : null}
                                        <span className="text-micro font-normal text-muted-foreground">
                                            {' · '}
                                            {t('market.custom:card.stops', { count: option.stores.length })}
                                            {' · '}
                                            {t('market.custom:card.articles', {
                                                covered: option.rows.length,
                                                count: total,
                                            })}
                                        </span>
                                    </span>
                                    <span className="block truncate text-micro text-muted-foreground">{stops}</span>
                                </span>
                                <span className="flex-none text-right">
                                    <span className="block text-body font-semibold text-foreground">
                                        {formatCurrency(option.total, currency)}
                                    </span>
                                    <span
                                        className={`block text-micro ${option.savings >= 0 ? 'text-success' : 'text-warning'}`}
                                    >
                                        {signedMoney(option.savings, currency)}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-3 border-t border-border pt-3 text-micro text-muted-foreground">
                    {coverage.map((store) => (
                        <span key={store.key} className="mr-3 inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 flex-none rounded-full" style={{ background: store.style.color }} />
                            {store.style.label} · {t('market.custom:card.footerArticles', { count: store.count })} ·{' '}
                            {formatCurrency(store.sum, currency)}
                        </span>
                    ))}
                    <span className="mt-1 block">
                        {t('market.custom:card.referenceNote', { count: plan.referenced, total })}
                    </span>
                    {plan.missing > 0 ? (
                        <span className="mt-1 block">{t('market.custom:card.missing', { count: plan.missing })}</span>
                    ) : null}
                    <PrijsProfeetCredit countries={[data.country]} />
                </div>
            </section>
            {/* The caveat is about three stores and more, the plan's own copy
                included: that is where the detour stops paying for itself. */}
            {plan.stores.length >= 3 ? (
                <p className="mt-2 px-1 text-micro text-muted-foreground">{t('market.custom:card.caveat')}</p>
            ) : null}
        </>
    );
};
