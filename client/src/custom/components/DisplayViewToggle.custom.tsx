// The list/grid switch, shared by the daily deals and the watchlist. Two toggle
// buttons rather than a radiogroup: a two-state view choice needs no arrow-key
// roving, and aria-pressed is the honest role here. Icon-only, so the accessible
// name is the aria-label.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DisplayView } from '../hooks/useDisplayView.custom';

interface DisplayViewToggleProps {
    view: DisplayView;
    onChange: (view: DisplayView) => void;
}

const OPTIONS: { view: DisplayView; labelKey: string; Icon: typeof List }[] = [
    { view: 'list', labelKey: 'display.viewList', Icon: List },
    { view: 'grid', labelKey: 'display.viewGrid', Icon: LayoutGrid },
];

const DisplayViewToggle: React.FC<DisplayViewToggleProps> = ({ view, onChange }) => {
    const { t } = useTranslation('scan.custom');

    return (
        <div
            role="group"
            aria-label={t('display.viewMode')}
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

export default DisplayViewToggle;
