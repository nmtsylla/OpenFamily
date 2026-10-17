// The detail behind a list row's price chip: what the suggested product is, what
// every configured store charges for the item this week, and what the household
// usually pays for it.
//
// The chip (MarketPriceBadge) only has room for one store's price. This sheet is
// the full answer to "where do I buy this": the suggested offer first, then the
// same item's cheapest offer per store, cheapest first, above the attribution
// the data needs. The per-store rows are the shared PromoOfferRow, so this sheet
// and the promo screens can never disagree about how a deal reads.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/ui/Dialog';
import { formatCurrency, formatDate } from '../../lib/utils';
import { PrijsProfeetCredit } from './PrijsProfeetCredit.custom';
import { PromoOfferRow } from './PromoOfferRow.custom';
import { storeStyle, type MarketItemPlan, type MarketPlanOffer, type MarketPlanRow } from '../lib/market.custom';

interface MarketOfferSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** What the planner knows about the clicked item. */
    item: MarketItemPlan;
    /** The offer the chip showed: the chosen plan's row, else the best alternative. */
    suggested: MarketPlanRow;
    currency: string;
}

/** Cheapest first; a priceless offer sinks to the bottom rather than reading as 0. */
const byPrice = (a: MarketPlanOffer, b: MarketPlanOffer): number =>
    (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);

export const MarketOfferSheet: React.FC<MarketOfferSheetProps> = ({ open, onOpenChange, item, suggested, currency }) => {
    const { t } = useTranslation();

    const style = storeStyle(suggested.retailer, { [suggested.retailer]: suggested.retailer_name });

    // The server picks the chip's offer and this list's offers from the same
    // per-store winners, so the suggestion is normally already in `item.offers`;
    // appending it when it is not keeps the chip and the list from disagreeing
    // about where the item is. `Array.isArray` guards a payload from a server
    // that predates the field: the suggestion is then the whole list.
    const itemOffers: MarketPlanOffer[] = Array.isArray(item.offers) ? item.offers : [];
    const offers = [...itemOffers].sort(byPrice);
    if (!offers.some((offer) => offer.retailer === suggested.retailer)) offers.push(suggested);

    // Every row of this sheet answers for one item, so the one country the
    // planner searched is enough — collected rather than assumed, because the
    // credit is what keeps the data lawful. A row without one (a payload older
    // than the field) leaves the credit out rather than pointing the link at a
    // host that does not exist.
    const countries = [
        ...new Set(offers.map((offer) => offer.country).filter((country) => typeof country === 'string')),
    ];

    const reference = item.reference;
    // Cents first: a rounding artefact of two float prices must not print as a
    // difference. Positive = the promo is cheaper than what the household pays.
    const difference =
        reference && suggested.price != null ? Math.round((reference.price - suggested.price) * 100) / 100 : 0;
    // The receipt's own words, the parts that exist: label, shop, day.
    const receiptDetails = reference
        ? [
              reference.label,
              reference.merchant
                  ? t('market.custom:sheet.receiptMerchant', { merchant: reference.merchant })
                  : null,
              reference.date ? formatDate(reference.date) : null,
          ]
              .filter(Boolean)
              .join(' · ')
        : '';

    const rounded = suggested.savings_percentage != null ? Math.round(suggested.savings_percentage) : null;
    const discount = rounded != null && rounded > 0 ? rounded : null;
    const was =
        suggested.original_price != null && suggested.price != null && suggested.original_price > suggested.price
            ? suggested.original_price
            : null;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={item.name}
            description={offers.length ? t('market.custom:sheet.storesCount', { count: offers.length }) : undefined}
        >
            <section className="flex gap-3 rounded-card border border-primary/40 bg-primary-soft p-3">
                <span className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-card bg-surface-2">
                    {suggested.image_url ? (
                        // A chain's CDN, not ours: no referrer (several refuse it),
                        // and a broken URL falls back to the empty box.
                        <img
                            src={suggested.image_url}
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                                event.currentTarget.hidden = true;
                            }}
                            className="h-20 w-20 object-contain"
                        />
                    ) : null}
                </span>

                <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-foreground">{suggested.name ?? item.name}</p>
                    {suggested.brand || suggested.quantity ? (
                        <p className="text-micro text-muted-foreground">
                            {[suggested.brand, suggested.quantity].filter(Boolean).join(' · ')}
                        </p>
                    ) : null}
                    <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
                        <span className="h-2 w-2 flex-none rounded-full" style={{ background: style.color }} />
                        <span className="font-medium text-foreground">{style.label}</span>
                        {suggested.valid_until ? (
                            <span>· {t('market.custom:badge.validUntil', { date: formatDate(suggested.valid_until) })}</span>
                        ) : null}
                    </p>
                    <p className="mt-1 flex flex-wrap items-baseline gap-2">
                        {suggested.price != null ? (
                            <span className="text-body font-semibold text-foreground">
                                {formatCurrency(suggested.price, currency)}
                            </span>
                        ) : null}
                        {was != null ? (
                            <span className="text-caption text-muted-foreground line-through">
                                {formatCurrency(was, currency)}
                            </span>
                        ) : null}
                        {discount != null ? (
                            <span className="rounded-input bg-primary-soft px-1.5 py-0.5 text-micro font-semibold text-primary">
                                −{discount}%
                            </span>
                        ) : null}
                    </p>
                    {suggested.product_url ? (
                        <a
                            href={suggested.product_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-micro text-primary underline decoration-dotted hover:text-foreground"
                        >
                            {t('market.custom:sheet.seeAt', { store: suggested.retailer_name })}
                        </a>
                    ) : null}
                </div>
            </section>

            {reference ? (
                <p className="mt-3 text-caption text-muted-foreground">
                    {reference.source === 'receipt'
                        ? receiptDetails
                            ? t('market.custom:sheet.usualReceipt', {
                                  price: formatCurrency(reference.price, currency),
                                  details: receiptDetails,
                              })
                            : t('market.custom:badge.usualPrice', { price: formatCurrency(reference.price, currency) })
                        : t('market.custom:sheet.usualRegular', { price: formatCurrency(reference.price, currency) })}
                    {difference !== 0 ? (
                        <span className={difference > 0 ? 'text-success' : 'text-warning'}>
                            {' · '}
                            {difference > 0
                                ? t('market.custom:sheet.lessThan', { amount: formatCurrency(difference, currency) })
                                : t('market.custom:sheet.moreThan', { amount: formatCurrency(-difference, currency) })}
                        </span>
                    ) : null}
                </p>
            ) : null}

            <h3 className="mt-4 text-caption font-medium text-foreground">{t('market.custom:sheet.everyStore')}</h3>
            <ul className="mt-1 divide-y divide-border">
                {offers.map((offer) => (
                    <PromoOfferRow
                        key={offer.retailer}
                        offer={offer}
                        currency={currency}
                        showProduct
                        badge={offer.retailer === suggested.retailer ? t('market.custom:sheet.suggested') : undefined}
                        className="py-2"
                    />
                ))}
            </ul>

            {item.translated && item.dutch_terms?.length ? (
                <p className="mt-3 text-micro text-muted-foreground">
                    {t('market.custom:sheet.matchedDutch', { terms: item.dutch_terms.join(', ') })}
                </p>
            ) : null}

            <PrijsProfeetCredit countries={countries} />
        </Dialog>
    );
};
