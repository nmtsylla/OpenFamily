// Custom routes.
//
// react-router's `createRoutesFromChildren` only accepts `<Route>` and
// `<Fragment>` as children of `<Routes>` — anything else throws
// "[X] is not a <Route> component" while rendering, which tsc and the build do
// NOT catch. So this exports a plain function that returns Route elements rather
// than a component, and `App.tsx` calls it inside its own `<Routes>`:
//
//     {customRoutes(isModuleEnabled)}
//
// Gating mirrors App.tsx's own `moduleRoute`: a page whose module the family
// has hidden — or whose CUSTOM_FEATURE_*_ENABLED flag is off, which the server
// reports as a disabled module — redirects to the dashboard, so a bookmarked URL
// never shows a disabled page.

import React, { Suspense } from 'react';
import { Navigate, Route } from 'react-router-dom';
import BudgetAnalytics from './pages/BudgetAnalytics.custom';
import PromoWatchlist from './pages/PromoWatchlist.custom';

// The scanner carries @zxing/library, ~400 kB of decoder, and the whole app is
// precached by the service worker: imported eagerly it pushes the main bundle
// past workbox's 2 MiB precache limit and the PWA build fails. Its own chunk is
// fetched the first time someone opens /scanner.
const ProductScanner = React.lazy(() => import('./pages/ProductScanner.custom'));

export const customRoutes = (isModuleEnabled: (key: string) => boolean): React.ReactElement[] => [
    <Route
        key="budget-analytics"
        path="/budget-analytics"
        element={isModuleEnabled('budgetAnalytics') ? <BudgetAnalytics /> : <Navigate to="/" replace />}
    />,
    <Route
        key="scanner"
        path="/scanner"
        element={
            isModuleEnabled('productScan') ? (
                <Suspense fallback={null}>
                    <ProductScanner />
                </Suspense>
            ) : (
                <Navigate to="/" replace />
            )
        }
    />,
    <Route
        key="promo-watchlist"
        path="/promo-watchlist"
        element={isModuleEnabled('productScan') ? <PromoWatchlist /> : <Navigate to="/" replace />}
    />,
];
