// The per-row answer to "where": the chosen plan's own price when it covers the
// item, otherwise the best price another plan found, so a row the selected plan
// cannot cover still says where the item is on promo.
//
// The chip is a button: a tap opens MarketOfferSheet, the detail behind the
// match — what the suggested product is, what every store charges for it, and
// what the household usually pays.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../lib/utils';
import { MarketOfferSheet } from './MarketOfferSheet.custom';
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
    const [open, setOpen] = useState(false);

    /**
     * The chip's tooltip: what the offer is, how long it runs, and what the
     * household usually pays for that item. That last line needs the plan's own
     * reference price, which is why the badge is handed the item plan. The sheet
     * is the full explanation now; the tooltip stays the one-liner.
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

    const suggested = row ?? alternative;

    // Whatever the chip says — the chosen plan's price or another plan's — it
    // names a store, and the sheet explains it. Nothing to name, nothing to open.
    if (!suggested) return null;

    const style = storeStyle(suggested.retailer, { [suggested.retailer]: suggested.retailer_name });

    let className: string;
    let content: React.ReactNode;

    if (row) {
        // The prototype's `pct()`: a rounded discount, and nothing when rounding
        // leaves zero.
        const rounded = row.savings_percentage != null ? Math.round(row.savings_percentage) : null;
        const discount = rounded != null && rounded > 0 ? rounded : null;
        const was =
            row.original_price != null && row.price != null && row.original_price > row.price
                ? row.original_price
                : null;
        className =
            'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-pill border border-primary/40 bg-primary-soft px-2 py-1 text-micro text-primary';
        content = (
            <>
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: style.color }} />
                <span className="font-medium">{style.short}</span>
                {row.price != null ? <span className="font-semibold">{formatCurrency(row.price, currency)}</span> : null}
                {was != null ? (
                    <span className="text-muted-foreground line-through">{formatCurrency(was, currency)}</span>
                ) : null}
                {discount != null ? <span className="text-muted-foreground">−{discount}%</span> : null}
            </>
        );
    } else {
        // The hook only offers an alternative that carries a price; a priceless one
        // would read as "0,00 €", which is worse than saying nothing.
        const alternativePrice = suggested.price;
        if (typeof alternativePrice !== 'number') return null;
        className =
            'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-pill border border-dashed border-border px-2.5 py-1 text-micro text-muted-foreground';
        content = (
            <>
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: style.color }} />
                {t('market.custom:badge.alsoAt', {
                    store: style.short,
                    price: formatCurrency(alternativePrice, currency),
                })}
            </>
        );
    }

    // A row always comes with its item plan (the server answers one entry per
    // posted item), so this is the belt to that contract's braces: without a plan
    // there is nothing to explain, and the chip keeps its old, read-only shape
    // rather than opening an empty sheet.
    if (!plan) {
        return (
            <span title={offerTitle(suggested)} className={className}>
                {content}
            </span>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={t('market.custom:sheet.openHint', { name: plan.name })}
                title={offerTitle(suggested)}
                className={className}
            >
                {content}
            </button>
            <MarketOfferSheet open={open} onOpenChange={setOpen} item={plan} suggested={suggested} currency={currency} />
        </>
    );
};
