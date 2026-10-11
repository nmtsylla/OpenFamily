// Sidebar and mobile-tab entries for custom pages.
//
// `components/layout/Layout.tsx` appends these to its own arrays (one marked
// hook), so the upstream lists stay untouched. Each entry carries a `module`
// key: the family-level module setting and the CUSTOM_FEATURE_*_ENABLED flag
// (reported as disabled through /api/auth/me) hide it without any extra work.

import { BarChart3, Home, Package, Sandwich, ScanLine, Tag } from 'lucide-react';
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
    // Same reason for /lunchboxes: the upstream Meals entry matches /meals.
    { labelKey: 'lunchbox.custom:nav.lunchboxes', href: '/lunchboxes', icon: Sandwich, module: 'lunchbox' },
    { labelKey: 'pantry.custom:nav.pantry', href: '/pantry', icon: Package, module: 'pantry' },
    { labelKey: 'scan.custom:nav.scanner', href: '/scanner', icon: ScanLine, module: 'productScan' },
    { labelKey: 'scan.custom:nav.promoWatchlist', href: '/promo-watchlist', icon: Tag, module: 'productScan' },
    // Same reason again for the dashboard: no upstream entry matches
    // /family-dashboard, and the page hides Layout's chrome anyway.
    { labelKey: 'dashboard.custom:nav.familyDashboard', href: '/family-dashboard', icon: Home, module: 'familyDashboard' },
];

export const customMobileTabs: CustomNavEntry[] = [
    { labelKey: 'analytics.custom:nav.mobileBudgetAnalytics', href: '/budget-analytics', icon: BarChart3, module: 'budgetAnalytics' },
    { labelKey: 'lunchbox.custom:nav.mobileLunchboxes', href: '/lunchboxes', icon: Sandwich, module: 'lunchbox' },
    { labelKey: 'pantry.custom:nav.mobilePantry', href: '/pantry', icon: Package, module: 'pantry' },
    // Scanning happens standing in a shop, where the sidebar is behind a menu,
    // so it earns a tab. The watchlist does not: the bar renders its grid from
    // this list's length, and a seventh tab is a crowd on a phone.
    { labelKey: 'scan.custom:nav.mobileScanner', href: '/scanner', icon: ScanLine, module: 'productScan' },
    { labelKey: 'dashboard.custom:nav.familyDashboard', href: '/family-dashboard', icon: Home, module: 'familyDashboard' },
];
