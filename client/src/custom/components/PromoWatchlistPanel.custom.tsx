// What the family is waiting for a discount on: the watched products, the prices
// they logged themselves, and the promotions running on those barcodes right now
// (PrijsProfeet, fetched when a card is opened — never stored, since deals change
// nightly).
//
// Prices are stored as decimals and come back as strings ("2.50"): they are
// formatted for display, never arithmetically combined, so Number() at the
// display boundary is the only conversion needed. The live deals come back as
// numbers, and are display-only too.

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Plus, Tag, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Textarea, useToast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import { usePromoWatchlist, type PromoPrice, type WatchlistItem } from '../hooks/usePromoWatchlist.custom';
import { optionalNumber, type PromoOffer } from '../lib/product.custom';
import { PrijsProfeetCredit } from './PrijsProfeetCredit.custom';
import { PromoOfferRow } from './PromoOfferRow.custom';

interface LogPriceDialogProps {
    item: WatchlistItem;
    onClose: () => void;
    onSave: (
        barcode: string,
        input: { store_name: string; promo_price: number; regular_price: number | null; notes: string }
    ) => Promise<void>;
}

const LogPriceDialog: React.FC<LogPriceDialogProps> = ({ item, onClose, onSave }) => {
    const { t } = useTranslation('scan.custom');
    const [store, setStore] = useState('');
    const [promoPrice, setPromoPrice] = useState('');
    const [regularPrice, setRegularPrice] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [invalid, setInvalid] = useState(false);

    const parsedPromo = optionalNumber(promoPrice);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (parsedPromo === null || parsedPromo <= 0) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        setSaving(true);
        try {
            await onSave(item.barcode, {
                store_name: store.trim(),
                promo_price: parsedPromo,
                regular_price: optionalNumber(regularPrice),
                notes: notes.trim(),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()} title={item.name} description={t('promoWatchlist.logPrice')}>
            <form onSubmit={submit} className="space-y-4">
                <Input label={t('promoWatchlist.store')} value={store} onChange={(e) => setStore(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                    <Input
                        label={t('promoWatchlist.promoPrice')}
                        type="number"
                        min="0"
                        step="0.01"
                        value={promoPrice}
                        onChange={(e) => setPromoPrice(e.target.value)}
                        error={invalid ? t('errors.priceInvalid') : undefined}
                        required
                    />
                    <Input
                        label={t('promoWatchlist.regularPrice')}
                        type="number"
                        min="0"
                        step="0.01"
                        value={regularPrice}
                        onChange={(e) => setRegularPrice(e.target.value)}
                    />
                </div>
                <Textarea
                    label={t('promoWatchlist.notes')}
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        {t('addToList.cancel')}
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {t('promoWatchlist.save')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
};

const PromoWatchlistPanel: React.FC = () => {
    const { t } = useTranslation('scan.custom');
    const { showToast } = useToast();
    const { user } = useAuth();
    const currency = user?.currency || 'EUR';
    const { watchlist, loading, error, removeWatch, logPrice, fetchPrices, fetchOffers } = usePromoWatchlist();

    const [openBarcode, setOpenBarcode] = useState<string | null>(null);
    const [history, setHistory] = useState<PromoPrice[]>([]);
    const [offers, setOffers] = useState<PromoOffer[]>([]);
    const [offersLoading, setOffersLoading] = useState(false);
    const [offersFailed, setOffersFailed] = useState(false);
    const [logging, setLogging] = useState<WatchlistItem | null>(null);

    /**
     * The pane is filled on first open, and kept until another card opens: the
     * family's own logged prices and the live shop deals in parallel. The deal
     * check is the one that may fail on its own — PrijsProfeet being down must
     * not hide the prices already logged.
     *
     * One pane for the whole list, so only the newest open may fill it: opening
     * card A then card B used to leave A's slower answer to paint under B's
     * header. `requestId` is bumped on every open (and on close), and the
     * awaited results are dropped unless they are still the current one.
     */
    const requestId = useRef(0);
    const toggleHistory = async (item: WatchlistItem) => {
        const request = (requestId.current += 1);
        if (openBarcode === item.barcode) {
            setOpenBarcode(null);
            return;
        }
        setOpenBarcode(item.barcode);
        setHistory([]);
        setOffers([]);
        setOffersFailed(false);
        setOffersLoading(true);

        const [prices, deals] = await Promise.all([
            fetchPrices(item.barcode).catch((fetchError: unknown) => {
                console.error('Failed to load the price history:', fetchError);
                showToast({ title: t('errors.loadFailed') });
                return null;
            }),
            fetchOffers(item.barcode).catch((offerError: unknown) => {
                console.error('Failed to load the shop deals:', offerError);
                return null;
            }),
        ]);

        if (request !== requestId.current) return;
        setHistory(prices ?? []);
        setOffers(deals ?? []);
        setOffersFailed(deals === null);
        setOffersLoading(false);
    };

    const stopWatching = async (item: WatchlistItem) => {
        try {
            await removeWatch(item.id);
        } catch (removeError) {
            console.error('Failed to stop watching:', removeError);
            showToast({ title: t('errors.removeFailed') });
        }
    };

    const savePrice: LogPriceDialogProps['onSave'] = async (barcode, input) => {
        try {
            await logPrice(barcode, input);
            setLogging(null);
            showToast({ title: t('promoWatchlist.saved') });
            // The pane is open on this product for a reason: the price just logged
            // belongs in the list below it, not in the next visit's.
            if (openBarcode === barcode) setHistory(await fetchPrices(barcode));
        } catch (saveError) {
            console.error('Failed to log the promo price:', saveError);
            showToast({ title: t('errors.priceInvalid') });
        }
    };

    // The attribution links follow the countries actually present in the list:
    // the licence term is one link per source, and only when its data shows.
    const offerCountries = [...new Set(offers.map((offer) => offer.country))];

    if (loading) {
        return (
            <div className="flex h-full min-h-[50vh] items-center justify-center">
                <div className="spinner-brand" />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <p className="text-body text-muted-foreground">{t('promoWatchlist.subtitle')}</p>

            {error ? (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {t('errors.loadFailed')}
                </div>
            ) : null}

            {watchlist.length === 0 ? (
                <div className="rounded-card border border-dashed border-border bg-card py-16 text-center">
                    <Tag className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                    <p className="text-body font-semibold text-foreground">{t('promoWatchlist.empty')}</p>
                    <p className="mt-1 text-caption text-muted-foreground">{t('promoWatchlist.emptyHint')}</p>
                </div>
            ) : null}

            {watchlist.map((item) => {
                const open = openBarcode === item.barcode;
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                    <div key={item.id} className="overflow-hidden rounded-card border border-border bg-card">
                        <div className="flex items-center gap-3 p-4">
                            {item.image_url ? (
                                <img
                                    src={item.image_url}
                                    alt=""
                                    className="h-14 w-14 flex-shrink-0 rounded-card bg-surface-2 object-contain"
                                />
                            ) : (
                                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-card bg-surface-2 text-muted-foreground">
                                    <Tag className="h-5 w-5" />
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => void toggleHistory(item)}
                                aria-expanded={open}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-body font-medium text-foreground">{item.name}</p>
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

                        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                            <Button size="sm" onClick={() => setLogging(item)}>
                                <Plus className="mr-1 h-4 w-4" />
                                {t('promoWatchlist.logPrice')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void stopWatching(item)}>
                                <Trash2 className="mr-1 h-4 w-4" />
                                {t('promoWatchlist.stopWatching')}
                            </Button>
                        </div>

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
            })}

            {logging ? (
                <LogPriceDialog item={logging} onClose={() => setLogging(null)} onSave={savePrice} />
            ) : null}
        </div>
    );
};

export default PromoWatchlistPanel;
