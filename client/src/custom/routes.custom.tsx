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

// These four were the last custom pages still imported eagerly, and together
// they were the main bundle's whole margin: with them in it the bundle sat 314
// bytes under workbox's 2 MiB precache limit, which fails the PWA build outright
// rather than warning. Their own chunks put the main bundle 86 kB clear of it
// (measured 2,097,362 → 2,009,466 bytes). The service worker precaches every
// chunk, so an installed app opens them offline like the rest.
const BudgetAnalytics = React.lazy(() => import('./pages/BudgetAnalytics.custom'));
const Lunchboxes = React.lazy(() => import('./pages/Lunchboxes.custom'));
const Pantry = React.lazy(() => import('./pages/Pantry.custom'));
const PromoWatchlist = React.lazy(() => import('./pages/PromoWatchlist.custom'));

// The scanner carries @zxing/library, ~400 kB of decoder, and the whole app is
// precached by the service worker: imported eagerly it pushes the main bundle
// past workbox's 2 MiB precache limit and the PWA build fails. Its own chunk is
// fetched the first time someone opens /scanner.
const ProductScanner = React.lazy(() => import('./pages/ProductScanner.custom'));

// Same ceiling, same treatment: the board is a full-screen display (its
// own tile layout) and lives on a wall tablet, so its chunk is fetched once and
// then lives in the service worker's cache like the rest.
const Board = React.lazy(() => import('./pages/Board.custom'));

export const customRoutes = (isModuleEnabled: (key: string) => boolean): React.ReactElement[] => [
    <Route
        key="budget-analytics"
        path="/budget-analytics"
        element={
            isModuleEnabled('budgetAnalytics') ? (
                <Suspense fallback={null}>
                    <BudgetAnalytics />
                </Suspense>
            ) : (
                <Navigate to="/" replace />
            )
        }
    />,
    <Route
        key="lunchboxes"
        path="/lunchboxes"
        element={
            isModuleEnabled('lunchbox') ? (
                <Suspense fallback={null}>
                    <Lunchboxes />
                </Suspense>
            ) : (
                <Navigate to="/" replace />
            )
        }
    />,
    // Flat href on purpose, like the two above: no upstream nav entry matches
    // /pantry, so nothing else stays highlighted while this page is open.
    <Route
        key="pantry"
        path="/pantry"
        element={
            isModuleEnabled('pantry') ? (
                <Suspense fallback={null}>
                    <Pantry />
                </Suspense>
            ) : (
                <Navigate to="/" replace />
            )
        }
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
        element={
            isModuleEnabled('productScan') ? (
                <Suspense fallback={null}>
                    <PromoWatchlist />
                </Suspense>
            ) : (
                <Navigate to="/" replace />
            )
        }
    />,
    <Route
        key="board"
        path="/board"
        element={
            isModuleEnabled('board') ? (
                <Suspense fallback={null}>
                    <Board />
                </Suspense>
            ) : (
                <Navigate to="/" replace />
            )
        }
    />,
];
