// One promotion, as the promo screen's daily list and the watchlist's deals pane
// both show it: which shop, what the deal is, and what it costs.
//
// Shared on purpose: the two surfaces used to grow apart on their own, and the
// price a family reads here is the same price either way. What differs is
// `showProduct`: the browsable list has no card around the row, so the product —
// its picture, its name, its brand — is the identity there and the product name
// carries the link to the shop's page. With `showProduct` off (the watchlist
// pane, whose card header already names the product) the chain's own name stays
// the link instead, which is the click-through that pane has always had.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff } from 'lucide-react';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import type { PromoOffer } from '../lib/product.custom';

interface PromoOfferRowProps {
    offer: PromoOffer;
    currency: string;
    /** The chain's country code, when the list mixes countries: Albert Heijn BE vs NL. */
    showCountry?: boolean;
    /** The product's own picture, name and brand — the browsable list's identity. */
    showProduct?: boolean;
    /** Hides this product from the family's lists, when the surface offers it. */
    onHide?: (offer: PromoOffer) => void;
    className?: string;
}

export const PromoOfferRow: React.FC<PromoOfferRowProps> = ({
    offer,
    currency,
    showCountry,
    showProduct,
    onHide,
    className,
}) => {
    const { t } = useTranslation('scan.custom');

    const deal = (
        <span className="min-w-0 flex-1 text-muted-foreground">
            <span className="block truncate">
                {showProduct || !offer.product_url ? (
                    offer.retailer_name
                ) : (
                    <a
                        href={offer.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-dotted hover:text-foreground"
                    >
                        {offer.retailer_name}
                    </a>
                )}
                {showCountry ? ` (${offer.country.toUpperCase()})` : ''}
                {offer.quantity ? ` · ${offer.quantity}` : ''}
                {offer.promotion_status && offer.promotion_status !== 'active'
                    ? ` · ${t('promoWatchlist.upcoming')}`
                    : ''}
                {offer.valid_until ? ` · ${t('promoWatchlist.until')} ${formatDate(offer.valid_until)}` : ''}
                {offer.multi_buy_quantity && offer.multi_buy_price
                    ? ` · ${t('promoWatchlist.multiBuy', {
                          count: offer.multi_buy_quantity,
                          price: formatCurrency(offer.multi_buy_price, currency),
                      })}`
                    : ''}
                {offer.loyalty_price
                    ? ` · ${t('promoWatchlist.loyalty')} ${formatCurrency(offer.loyalty_price, currency)}`
                    : ''}
            </span>
            {showProduct ? (
                <span className="mt-0.5 block truncate text-micro">
                    {offer.product_url ? (
                        <a
                            href={offer.product_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted hover:text-foreground"
                        >
                            {offer.name ?? ''}
                        </a>
                    ) : (
                        (offer.name ?? '')
                    )}
                    {offer.brand ? ` · ${offer.brand}` : ''}
                </span>
            ) : null}
        </span>
    );

    return (
        <li className={cn('flex items-baseline justify-between gap-3 text-caption', className)}>
            {showProduct ? (
                <span className="flex h-12 w-12 flex-shrink-0 items-baseline justify-center self-center overflow-hidden rounded-card bg-surface-2">
                    {offer.image_url ? (
                        // A chain's CDN, not ours: no referrer (several refuse it),
                        // and a broken URL falls back to the empty box rather than
                        // a broken-image icon.
                        <img
                            src={offer.image_url}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                                event.currentTarget.hidden = true;
                            }}
                            className="h-12 w-12 object-contain"
                        />
                    ) : null}
                </span>
            ) : null}

            {deal}

            <span className="flex flex-shrink-0 items-baseline gap-2">
                <span className="font-semibold text-foreground">
                    {offer.price !== null ? formatCurrency(offer.price, currency) : ''}
                </span>
                {offer.original_price ? (
                    <span className="font-normal text-muted-foreground line-through">
                        {formatCurrency(offer.original_price, currency)}
                    </span>
                ) : null}
                {offer.savings_percentage ? (
                    <span className="rounded-input bg-primary-soft px-1.5 py-0.5 text-micro font-semibold text-primary">
                        −{Math.round(offer.savings_percentage)}%
                    </span>
                ) : null}
            </span>

            {onHide ? (
                <button
                    type="button"
                    onClick={() => onHide(offer)}
                    title={t('dailyPromos.hideHint')}
                    aria-label={t('dailyPromos.hideHint')}
                    className="flex-shrink-0 self-center rounded-input p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                    <EyeOff className="h-4 w-4" />
                </button>
            ) : null}
        </li>
    );
};
