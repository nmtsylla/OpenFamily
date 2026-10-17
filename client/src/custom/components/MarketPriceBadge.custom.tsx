// The per-row answer to "where": the chosen plan's own price when it covers the
// item, otherwise the best price another plan found, so a row the selected plan
// cannot cover still says where the item is on promo.
//
// A plain span, not a button: the sheet that would explain a match is not built,
// and a tap target that does nothing is worse than none.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../lib/utils';
import {
    shortDate,
    storeStyle,
    type MarketItemPlan,
    type MarketPlanRow,
} from '../lib/market.custom';

interface MarketPriceBadgeProps {
    /** What the planner knows about the row's item; undefined until the plan answers. */
    plan: MarketItemPlan | undefined;
    /** The chosen plan's offer for this item, when it has one. */
    row: MarketPlanRow | null;
    /** The best offer another plan holds for it, when the chosen plan has none. */
    alternative: MarketPlanRow | null;
    currency: string;
}

export const MarketPriceBadge: React.FC<MarketPriceBadgeProps> = ({ plan, row, alternative, currency }) => {
    const { t } = useTranslation();

    /**
     * The chip's tooltip: what the offer is, how long it runs, and what the
     * household usually pays for that item. That last line needs the plan's own
     * reference price, which is why the badge is handed the item plan.
     */
    const offerTitle = (offer: MarketPlanRow): string => {
        const until = offer.valid_until ? shortDate(offer.valid_until) : '';
        const reference = plan?.reference;
        const receipt =
            reference && reference.source === 'receipt'
                ? [reference.label, reference.merchant, shortDate(reference.date)].filter(Boolean).join(' · ')
                : '';
        return [
            offer.name,
            offer.quantity,
            until ? t('market.custom:badge.validUntil', { date: until }) : null,
            reference
                ? receipt
                    ? t('market.custom:badge.lastPaid', {
                          price: formatCurrency(reference.price, currency),
                          receipt,
                      })
                    : t('market.custom:badge.usualPrice', { price: formatCurrency(reference.price, currency) })
                : null,
        ]
            .filter(Boolean)
            .join(' · ');
    };

    if (row) {
        const style = storeStyle(row.retailer, { [row.retailer]: row.retailer_name });
        // The prototype's `pct()`: a rounded discount, and nothing when rounding
        // leaves zero.
        const rounded = row.savings_percentage != null ? Math.round(row.savings_percentage) : null;
        const discount = rounded != null && rounded > 0 ? rounded : null;
        const was =
            row.original_price != null && row.price != null && row.original_price > row.price
                ? row.original_price
                : null;
        return (
            <span
                title={offerTitle(row)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-pill border border-primary/40 bg-primary-soft px-2 py-1 text-micro text-primary"
            >
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: style.color }} />
                <span className="font-medium">{style.short}</span>
                {row.price != null ? <span className="font-semibold">{formatCurrency(row.price, currency)}</span> : null}
                {was != null ? (
                    <span className="text-muted-foreground line-through">{formatCurrency(was, currency)}</span>
                ) : null}
                {discount != null ? <span className="text-muted-foreground">−{discount}%</span> : null}
            </span>
        );
    }

    // The hook only offers an alternative that carries a price; a priceless one
    // would read as "0,00 €", which is worse than saying nothing.
    const alternativePrice = alternative?.price;
    if (alternative && typeof alternativePrice === 'number') {
        const style = storeStyle(alternative.retailer, { [alternative.retailer]: alternative.retailer_name });
        return (
            <span
                title={offerTitle(alternative)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-pill border border-dashed border-border px-2.5 py-1 text-micro text-muted-foreground"
            >
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: style.color }} />
                {t('market.custom:badge.alsoAt', {
                    store: style.short,
                    price: formatCurrency(alternativePrice, currency),
                })}
            </span>
        );
    }

    // Uncovered (the card's footer counts those items), or no plan yet: a row
    // with nothing to name stays bare.
    return null;
};
