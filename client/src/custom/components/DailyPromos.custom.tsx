// The deals of the day: what every shop the family can reach is promoting today,
// narrowed by store, category, discount, free text and sort order.
//
// Nothing here is stored. PrijsProfeet refreshes the chains overnight and the
// server caches each query until the next morning (see
// server/src/custom/lib/prijsprofeet.custom.ts), so this is the day's list, not a
// snapshot that drifts.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { Button, Input, Select, useToast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { PrijsProfeetCredit } from './PrijsProfeetCredit.custom';
import { PromoOfferRow } from './PromoOfferRow.custom';
import { useDailyPromos } from '../hooks/useDailyPromos.custom';
import type { PromoCountry, PromoSort } from '../lib/product.custom';
import { EXCLUDE_TERM_MIN_LENGTH } from '../lib/product.custom';

const SORTS: PromoSort[] = ['savings', 'price_asc', 'price_desc'];
const SAVINGS_FLOORS = ['', '10', '25', '50'];

// Mirrors the server's own guard, which answers 400 below it.
const termTooShort = (term: string): boolean => term.trim().length > 0 && term.trim().length < EXCLUDE_TERM_MIN_LENGTH;

const DailyPromos: React.FC = () => {
    const { t } = useTranslation('scan.custom');
    const { showToast } = useToast();
    const { user } = useAuth();
    const currency = user?.currency || 'EUR';
    const {
        filters,
        filtersFailed,
        query,
        update,
        page,
        pageNumber,
        lastPage,
        loading,
        failed,
        setPageNumber,
        exclusions,
        addTerm,
        removeTerm,
        hideOffer,
    } = useDailyPromos();
    const [excludeTerm, setExcludeTerm] = useState('');

    const sortLabels: Record<PromoSort, string> = {
        savings: t('dailyPromos.sortSavings'),
        price_asc: t('dailyPromos.sortPriceAsc'),
        price_desc: t('dailyPromos.sortPriceDesc'),
    };
    const countries = filters?.countries ?? [];
    const offerCountries = [...new Set((page?.offers ?? []).map((offer) => offer.country))];

    // The select the user picked from is the one that knows the country; the
    // facets describe `filters.country` either way.
    const activeCountry = query.country || filters?.country || '';

    return (
        <div className="space-y-4">
            <div className="space-y-3 rounded-card border border-border bg-card p-4">
                <Button
                    type="button"
                    size="sm"
                    variant={query.onlyKnown ? 'primary' : 'secondary'}
                    aria-pressed={query.onlyKnown}
                    onClick={() => update({ onlyKnown: !query.onlyKnown })}
                >
                    {t('dailyPromos.myProducts')}
                </Button>
                <Input
                    label={t('dailyPromos.search')}
                    value={query.q}
                    onChange={(event) => update({ q: event.target.value })}
                    placeholder={t('dailyPromos.searchPlaceholder')}
                />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('dailyPromos.store')}
                        </label>
                        <Select
                            value={query.retailer}
                            onValueChange={(value) => update({ retailer: value })}
                            options={[
                                { value: '', label: t('dailyPromos.allStores') },
                                ...(filters?.retailers ?? []).map((facet) => ({
                                    value: facet.key,
                                    label: `${facet.label} (${facet.count})`,
                                })),
                            ]}
                            className="w-full [&>span]:truncate"
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('dailyPromos.category')}
                        </label>
                        <Select
                            value={query.category}
                            onValueChange={(value) => update({ category: value })}
                            options={[
                                { value: '', label: t('dailyPromos.allCategories') },
                                ...(filters?.categories ?? []).map((facet) => ({
                                    value: facet.key,
                                    label: `${facet.label} (${facet.count})`,
                                })),
                            ]}
                            className="w-full [&>span]:truncate"
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('dailyPromos.discount')}
                        </label>
                        <Select
                            value={query.minSavings}
                            onValueChange={(value) => update({ minSavings: value })}
                            options={SAVINGS_FLOORS.map((floor) => ({
                                value: floor,
                                label: floor ? t('dailyPromos.savingsFrom', { percent: floor }) : t('dailyPromos.anyDiscount'),
                            }))}
                            className="w-full [&>span]:truncate"
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-caption font-medium text-foreground">
                            {t('dailyPromos.sort')}
                        </label>
                        <Select
                            value={query.sort}
                            onValueChange={(value) => update({ sort: value as PromoSort })}
                            options={SORTS.map((sort) => ({ value: sort, label: sortLabels[sort] }))}
                            className="w-full [&>span]:truncate"
                        />
                    </div>
                    {countries.length > 1 ? (
                        <div>
                            <label className="mb-1.5 block text-caption font-medium text-foreground">
                                {t('dailyPromos.country')}
                            </label>
                            <Select
                                value={activeCountry}
                                onValueChange={(value) => update({ country: value as PromoCountry })}
                                options={countries.map((country) => ({
                                    value: country,
                                    label: country.toUpperCase(),
                                }))}
                                className="w-full [&>span]:truncate"
                            />
                        </div>
                    ) : null}
                </div>
                {filtersFailed ? (
                    <p className="text-caption text-muted-foreground">{t('dailyPromos.filtersUnavailable')}</p>
                ) : null}

                {/* The family's own exclusions: the API has no filter for "not
                    this", so the server drops these terms from the page it
                    returns (and from a watched product's deals pane). */}
                <div className="space-y-2 border-t border-border pt-3">
                    <form
                        className="flex items-end gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const term = excludeTerm.trim();
                            if (!term || termTooShort(term)) return;
                            // A refusal from the server is the user's business:
                            // silently swallowing it looked like nothing happened.
                            addTerm(term).then(
                                () => setExcludeTerm(''),
                                () => showToast({ title: t('dailyPromos.excludeFailed') })
                            );
                        }}
                    >
                        <Input
                            label={t('dailyPromos.exclude')}
                            value={excludeTerm}
                            onChange={(event) => setExcludeTerm(event.target.value)}
                            placeholder={t('dailyPromos.excludePlaceholder')}
                            maxLength={40}
                            className="flex-1"
                            error={termTooShort(excludeTerm) ? t('dailyPromos.excludeTooShort') : undefined}
                        />
                        <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="flex-shrink-0 whitespace-nowrap"
                            disabled={!excludeTerm.trim() || termTooShort(excludeTerm)}
                        >
                            {t('dailyPromos.excludeAdd')}
                        </Button>
                    </form>
                    {exclusions.length ? (
                        <div className="flex flex-wrap items-center gap-2">
                            {exclusions.map((exclusion) => (
                                <span
                                    key={exclusion.id}
                                    className="inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 text-micro text-muted-foreground"
                                >
                                    {exclusion.term}
                                    <button
                                        type="button"
                                        onClick={() =>
                                            removeTerm(exclusion.id).catch(() =>
                                                showToast({ title: t('dailyPromos.excludeFailed') })
                                            )
                                        }
                                        title={t('dailyPromos.excludeRemove')}
                                        aria-label={t('dailyPromos.excludeRemove')}
                                        className="rounded-input p-0.5 hover:text-foreground"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-micro text-muted-foreground">{t('dailyPromos.excludeHint')}</p>
                    )}
                </div>
            </div>

            {loading && !page ? (
                <div className="flex h-40 items-center justify-center">
                    <div className="spinner-brand" />
                </div>
            ) : failed ? (
                <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-caption text-danger">
                    {t('dailyPromos.unavailable')}
                </div>
            ) : !page || page.total === 0 ? (
                <div className="rounded-card border border-dashed border-border bg-card py-12 text-center">
                    <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                    <p className="text-body font-semibold text-foreground">
                        {t(query.onlyKnown ? 'dailyPromos.emptyMine' : 'dailyPromos.empty')}
                    </p>
                </div>
            ) : (
                <>
                    <p className="text-caption text-muted-foreground">
                        {t('dailyPromos.count', { count: page.total })}
                        {page.hidden ? ` · ${t('dailyPromos.hidden', { count: page.hidden })}` : ''}
                    </p>
                    <ul
                        className={`divide-y divide-border overflow-hidden rounded-card border border-border bg-card ${loading ? 'opacity-60' : ''}`}
                    >
                        {page.offers.map((offer, index) => (
                            <PromoOfferRow
                                key={`${offer.retailer}-${offer.product_url ?? offer.quantity ?? index}-${index}`}
                                offer={offer}
                                currency={currency}
                                showCountry={countries.length > 1}
                                showProduct
                                onHide={(hidden) =>
                                    hideOffer(hidden).catch(() =>
                                        showToast({ title: t('dailyPromos.excludeFailed') })
                                    )
                                }
                                className="px-3 py-2"
                            />
                        ))}
                    </ul>
                    <PrijsProfeetCredit countries={offerCountries} />

                    {lastPage > 1 ? (
                        <div className="flex items-center justify-between gap-3">
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={pageNumber <= 1 || loading}
                                onClick={() => setPageNumber(pageNumber - 1)}
                            >
                                {t('dailyPromos.previous')}
                            </Button>
                            <span className="text-caption text-muted-foreground">
                                {t('dailyPromos.page', { page: pageNumber, pages: lastPage })}
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={pageNumber >= lastPage || loading}
                                onClick={() => setPageNumber(pageNumber + 1)}
                            >
                                {t('dailyPromos.next')}
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
};

export default DailyPromos;
