// Collapse toggle for the wide-viewport sidebar.
//
// From 1024px (`lg`) upstream's Layout pins the sidebar open
// (`lg:translate-x-0`) and offsets the content with `lg:pl-72`; a tablet held in
// landscape has no way to give that width back to the page. The state is one
// boolean, projected as the `nav-collapsed` class on <html> and read by
// `custom/lib/sidebarCollapse.custom.css`, which is scoped to the same
// breakpoint so the sub-1024px drawer (and the mobile tab bar) keep their own
// transform untouched. Nothing upstream is edited: no class string, no style.
//
// The choice is remembered in localStorage (`sidebarCollapsed`), like the theme,
// because it is a layout preference and not a per-visit act.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import '../lib/sidebarCollapse.custom.css';

const STORAGE_KEY = 'sidebarCollapsed';

const SidebarToggle: React.FC = () => {
    const { t } = useTranslation('layout.custom');
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

    useEffect(() => {
        document.documentElement.classList.toggle('nav-collapsed', collapsed);
        localStorage.setItem(STORAGE_KEY, String(collapsed));
        return () => document.documentElement.classList.remove('nav-collapsed');
    }, [collapsed]);

    const label = t(collapsed ? 'expand' : 'collapse');

    return (
        <button
            type="button"
            onClick={() => setCollapsed((open) => !open)}
            aria-label={label}
            title={label}
            className="hidden rounded-input p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:inline-flex"
        >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
    );
};

export default SidebarToggle;
