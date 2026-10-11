// The Promos screen: today's promotions in the shops, and the family's own watch
// list. The two live as tabs because they answer the same question at different
// distances — what is on offer around here today, and what am I waiting to drop
// below a price — and the list is the one to open by default.
//
// Both surfaces render PrijsProfeet data, whose free plan requires the credit
// line each of them shows (components/PrijsProfeetCredit.custom.tsx).

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tag } from 'lucide-react';
import { Tabs } from '../../components/ui';
import DailyPromos from '../components/DailyPromos.custom';
import PromoWatchlistPanel from '../components/PromoWatchlistPanel.custom';

const PromoWatchlist: React.FC = () => {
    const { t } = useTranslation('scan.custom');

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            <div className="flex items-center gap-3">
                <div className="rounded-card bg-primary-soft p-3 text-primary">
                    <Tag className="h-7 w-7" />
                </div>
                <div className="flex-1">
                    <h1 className="text-h1 text-foreground">{t('promos.title')}</h1>
                </div>
            </div>

            <Tabs
                defaultValue="daily"
                tabs={[
                    {
                        value: 'daily',
                        label: t('dailyPromos.tab'),
                        content: <DailyPromos />,
                    },
                    {
                        value: 'watchlist',
                        label: t('dailyPromos.watchlistTab'),
                        content: <PromoWatchlistPanel />,
                    },
                ]}
            />
        </div>
    );
};

export default PromoWatchlist;
