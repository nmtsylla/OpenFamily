import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import '../lib/landscapeTabs.custom.css';

const LandscapeTabsToggle: React.FC = () => {
    const { t } = useTranslation('layout.custom');
    const [collapsed, setCollapsed] = useState(false);
    const label = t(collapsed ? 'showMobileTabs' : 'hideMobileTabs');

    return (
        <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            className="landscape-tabs-toggle min-h-11 items-center gap-2 rounded-input px-3 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
            {collapsed ? <ChevronUp aria-hidden="true" className="h-5 w-5" /> : <ChevronDown aria-hidden="true" className="h-5 w-5" />}
            {label}
        </button>
    );
};

export default LandscapeTabsToggle;
