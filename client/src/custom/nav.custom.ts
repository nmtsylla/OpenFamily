// Sidebar and mobile-tab entries for custom pages.
//
// `components/layout/Layout.tsx` appends these to its own arrays (one marked
// hook), so the upstream lists stay untouched. Each entry carries a `module`
// key: the family-level module setting and the CUSTOM_FEATURE_*_ENABLED flag
// (reported as disabled through /api/auth/me) hide it without any extra work.

import { BarChart3, ScanLine, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface CustomNavEntry {
    labelKey: string;
    href: string;
    icon: LucideIcon;
    module?: string;
}

export const customNavigation: CustomNavEntry[] = [
    // Flat href on purpose: a nested /budget/analytics would keep the upstream
    // Budget entry highlighted at the same time, since Layout matches by prefix.
    { labelKey: 'analytics.custom:nav.budgetAnalytics', href: '/budget-analytics', icon: BarChart3, module: 'budgetAnalytics' },
    { labelKey: 'scan.custom:nav.scanner', href: '/scanner', icon: ScanLine, module: 'productScan' },
    { labelKey: 'scan.custom:nav.promoWatchlist', href: '/promo-watchlist', icon: Tag, module: 'productScan' },
];

export const customMobileTabs: CustomNavEntry[] = [
    { labelKey: 'analytics.custom:nav.mobileBudgetAnalytics', href: '/budget-analytics', icon: BarChart3, module: 'budgetAnalytics' },
    // Scanning happens standing in a shop, where the sidebar is behind a menu,
    // so it earns a tab. The watchlist does not: the bar renders its grid from
    // this list's length, and a seventh tab is a crowd on a phone.
    { labelKey: 'scan.custom:nav.mobileScanner', href: '/scanner', icon: ScanLine, module: 'productScan' },
];
