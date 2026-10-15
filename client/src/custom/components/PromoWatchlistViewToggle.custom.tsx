// The list/grid switch for the watchlist. Two toggle buttons rather than a
// radiogroup: a two-state view choice needs no arrow-key roving, and aria-pressed
// is the honest role here. Icon-only, so the accessible name is the aria-label.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WatchlistView } from '../hooks/useWatchlistView.custom';

interface PromoWatchlistViewToggleProps {
    view: WatchlistView;
    onChange: (view: WatchlistView) => void;
}

const OPTIONS: { view: WatchlistView; labelKey: string; Icon: typeof List }[] = [
    { view: 'list', labelKey: 'promoWatchlist.viewList', Icon: List },
    { view: 'grid', labelKey: 'promoWatchlist.viewGrid', Icon: LayoutGrid },
];

const PromoWatchlistViewToggle: React.FC<PromoWatchlistViewToggleProps> = ({ view, onChange }) => {
    const { t } = useTranslation('scan.custom');

    return (
        <div
            role="group"
            aria-label={t('promoWatchlist.viewMode')}
            className="inline-flex flex-shrink-0 gap-1 rounded-pill bg-surface-2 p-1"
        >
            {OPTIONS.map(({ view: option, labelKey, Icon }) => (
                <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    aria-label={t(labelKey)}
                    title={t(labelKey)}
                    onClick={() => onChange(option)}
                    className={cn(
                        'inline-flex h-9 w-9 items-center justify-center rounded-pill transition-colors duration-fast ease-soft',
                        view === option ? 'bg-card text-primary shadow-surface' : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                </button>
            ))}
        </div>
    );
};

export default PromoWatchlistViewToggle;
