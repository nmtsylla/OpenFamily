// One promotion as a grid tile: the same content as PromoOfferRow, but with the
// product's picture given the room a photo-first view needs. The product name
// carries a stretched link to the shop's page, so the whole tile is clickable
// without nesting the hide button inside the link.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff, Tag } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { PromoOffer } from '../lib/product.custom';

interface PromoOfferTileProps {
    offer: PromoOffer;
    currency: string;
    /** The chain's country code, when the list mixes countries: Albert Heijn BE vs NL. */
    showCountry?: boolean;
    /** Hides this product from the family's lists, when the surface offers it. */
    onHide?: (offer: PromoOffer) => void;
}

export const PromoOfferTile: React.FC<PromoOfferTileProps> = ({ offer, currency, showCountry, onHide }) => {
    const { t } = useTranslation('scan.custom');

    const meta = [
        `${offer.retailer_name}${showCountry ? ` (${offer.country.toUpperCase()})` : ''}`,
        offer.quantity,
        offer.promotion_status && offer.promotion_status !== 'active' ? t('promoWatchlist.upcoming') : null,
        offer.valid_until ? `${t('promoWatchlist.until')} ${formatDate(offer.valid_until)}` : null,
        offer.multi_buy_quantity && offer.multi_buy_price
            ? t('promoWatchlist.multiBuy', {
                  count: offer.multi_buy_quantity,
                  price: formatCurrency(offer.multi_buy_price, currency),
              })
            : null,
        offer.loyalty_price ? `${t('promoWatchlist.loyalty')} ${formatCurrency(offer.loyalty_price, currency)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <li className="relative flex flex-col overflow-hidden rounded-card border border-border bg-card">
            <div className="relative flex aspect-square w-full items-center justify-center bg-surface-2 p-3">
                {offer.image_url ? (
                    // A chain's CDN, not ours: no referrer (several refuse it), and
                    // a broken URL falls back to the empty box rather than a
                    // broken-image icon.
                    <img
                        src={offer.image_url}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                            event.currentTarget.hidden = true;
                        }}
                        className="h-full w-full object-contain"
                    />
                ) : (
                    <Tag className="h-10 w-10 text-muted-foreground/40" />
                )}
                {offer.savings_percentage ? (
                    <span className="absolute left-2 top-2 rounded-input bg-primary-soft px-1.5 py-0.5 text-micro font-semibold text-primary">
                        −{Math.round(offer.savings_percentage)}%
                    </span>
                ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-2 text-caption font-medium text-foreground">
                    {offer.product_url ? (
                        <a
                            href={offer.product_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="after:absolute after:inset-0 after:content-[''] hover:underline"
                        >
                            {offer.name ?? offer.retailer_name}
                        </a>
                    ) : (
                        (offer.name ?? offer.retailer_name)
                    )}
                </p>
                {offer.brand ? <p className="truncate text-micro text-muted-foreground">{offer.brand}</p> : null}
                <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-1">
                    <span className="text-body font-semibold text-foreground">
                        {offer.price !== null ? formatCurrency(offer.price, currency) : ''}
                    </span>
                    {offer.original_price ? (
                        <span className="text-caption font-normal text-muted-foreground line-through">
                            {formatCurrency(offer.original_price, currency)}
                        </span>
                    ) : null}
                </div>
                <p className="text-micro text-muted-foreground">{meta}</p>
            </div>

            {onHide ? (
                <div className="relative z-10 flex justify-end border-t border-border px-2 py-1.5">
                    <button
                        type="button"
                        onClick={() => onHide(offer)}
                        title={t('dailyPromos.hideHint')}
                        aria-label={t('dailyPromos.hideHint')}
                        className="rounded-input p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                        <EyeOff className="h-4 w-4" />
                    </button>
                </div>
            ) : null}
        </li>
    );
};

export default PromoOfferTile;
