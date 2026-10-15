// One watched product, as a row (the original list) or a tile (the grid). The two
// share everything but the header, and an opened tile spans the grid so its deals
// and price-history panes get the full width instead of a ~200px column.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Plus, Tag, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import type { PromoPrice, WatchlistItem } from '../hooks/usePromoWatchlist.custom';
import type { WatchlistView } from '../hooks/useWatchlistView.custom';
import type { PromoOffer } from '../lib/product.custom';
import { PrijsProfeetCredit } from './PrijsProfeetCredit.custom';
import { PromoOfferRow } from './PromoOfferRow.custom';

interface PromoWatchlistItemProps {
    item: WatchlistItem;
    view: WatchlistView;
    open: boolean;
    currency: string;
    offers: PromoOffer[];
    offersLoading: boolean;
    offersFailed: boolean;
    history: PromoPrice[];
    onToggle: (item: WatchlistItem) => void;
    onLog: (item: WatchlistItem) => void;
    onStop: (item: WatchlistItem) => void;
}

const PromoWatchlistItem: React.FC<PromoWatchlistItemProps> = ({
    item,
    view,
    open,
    currency,
    offers,
    offersLoading,
    offersFailed,
    history,
    onToggle,
    onLog,
    onStop,
}) => {
    const { t } = useTranslation('scan.custom');
    const vertical = view === 'grid' && !open;
    const Chevron = open ? ChevronDown : ChevronRight;
    const offerCountries = [...new Set(offers.map((offer) => offer.country))];

    return (
        <div
            className={cn(
                'overflow-hidden rounded-card border border-border bg-card',
                view === 'grid' && open ? 'col-span-full' : ''
            )}
        >
            <div className={cn('flex gap-3', vertical ? 'flex-col p-3' : 'items-center p-4')}>
                {item.image_url ? (
                    <img
                        src={item.image_url}
                        alt=""
                        loading={vertical ? 'lazy' : undefined}
                        className={cn(
                            'flex-shrink-0 rounded-card bg-surface-2 object-contain',
                            vertical ? 'aspect-square w-full p-2' : 'h-14 w-14'
                        )}
                    />
                ) : (
                    <div
                        className={cn(
                            'flex flex-shrink-0 items-center justify-center rounded-card bg-surface-2 text-muted-foreground',
                            vertical ? 'aspect-square w-full' : 'h-14 w-14'
                        )}
                    >
                        <Tag className={vertical ? 'h-10 w-10' : 'h-5 w-5'} />
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => onToggle(item)}
                    aria-expanded={open}
                    className={cn('flex min-w-0 items-center gap-2 text-left', vertical ? 'w-full' : 'flex-1')}
                >
                    <div className="min-w-0 flex-1">
                        <p className={cn('text-body font-medium text-foreground', vertical ? 'line-clamp-2' : 'truncate')}>
                            {item.name}
                        </p>
                        {item.brand ? (
                            <p className="truncate text-micro text-muted-foreground">{item.brand}</p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap gap-2 text-micro text-muted-foreground">
                            {item.target_price ? (
                                <span>
                                    {t('promoWatchlist.targetPrice')} :{' '}
                                    {formatCurrency(Number(item.target_price), currency)}
                                </span>
                            ) : null}
                            <span className={item.best_promo_price ? 'font-semibold text-primary' : ''}>
                                {t('promoWatchlist.bestPromo')} :{' '}
                                {item.best_promo_price
                                    ? formatCurrency(Number(item.best_promo_price), currency)
                                    : t('promoWatchlist.noPromo')}
                            </span>
                        </div>
                    </div>
                    <Chevron className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
            </div>

            {vertical ? (
                <div className="flex gap-1 border-t border-border px-2 py-2">
                    <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('promoWatchlist.logPrice')}
                        title={t('promoWatchlist.logPrice')}
                        onClick={() => onLog(item)}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('promoWatchlist.stopWatching')}
                        title={t('promoWatchlist.stopWatching')}
                        onClick={() => onStop(item)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                    <Button size="sm" onClick={() => onLog(item)}>
                        <Plus className="mr-1 h-4 w-4" />
                        {t('promoWatchlist.logPrice')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onStop(item)}>
                        <Trash2 className="mr-1 h-4 w-4" />
                        {t('promoWatchlist.stopWatching')}
                    </Button>
                </div>
            )}

            {open ? (
                <div className="border-t border-border bg-surface-2/40 px-4 py-3">
                    <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('promoWatchlist.offers')}
                    </p>
                    {offersLoading ? (
                        <p className="text-caption text-muted-foreground">{t('promoWatchlist.offersLoading')}</p>
                    ) : offersFailed ? (
                        <p className="text-caption text-muted-foreground">{t('promoWatchlist.offersUnavailable')}</p>
                    ) : offers.length === 0 ? (
                        <p className="text-caption text-muted-foreground">{t('promoWatchlist.noOffers')}</p>
                    ) : (
                        <>
                            <ul className="space-y-1.5">
                                {offers.map((offer, index) => (
                                    <PromoOfferRow
                                        key={`${offer.country}-${offer.retailer}-${index}`}
                                        offer={offer}
                                        currency={currency}
                                        showCountry={offerCountries.length > 1}
                                    />
                                ))}
                            </ul>
                            <PrijsProfeetCredit countries={offerCountries} />
                        </>
                    )}
                </div>
            ) : null}

            {open ? (
                <div className="border-t border-border bg-surface-2/40 px-4 py-3">
                    <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('promoWatchlist.history')}
                    </p>
                    {history.length === 0 ? (
                        <p className="text-caption text-muted-foreground">{t('promoWatchlist.noHistory')}</p>
                    ) : (
                        <ul className="space-y-1.5">
                            {history.map((price) => (
                                <li key={price.id} className="flex items-baseline justify-between gap-3 text-caption">
                                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                        {formatDate(price.logged_at)}
                                        {price.store_name ? ` · ${price.store_name}` : ''}
                                        {price.notes ? ` · ${price.notes}` : ''}
                                    </span>
                                    <span className="flex-shrink-0 font-semibold text-foreground">
                                        {formatCurrency(Number(price.promo_price), currency)}
                                        {price.regular_price ? (
                                            <span className="ml-2 font-normal text-muted-foreground line-through">
                                                {formatCurrency(Number(price.regular_price), currency)}
                                            </span>
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </div>
    );
};

export default PromoWatchlistItem;
