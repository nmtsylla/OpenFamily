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

import React from 'react';
import { Navigate, Route } from 'react-router-dom';
import BudgetAnalytics from './pages/BudgetAnalytics.custom';
import FamilyDashboard from './pages/FamilyDashboard.custom';

export const customRoutes = (isModuleEnabled: (key: string) => boolean): React.ReactElement[] => [
    <Route
        key="budget-analytics"
        path="/budget-analytics"
        element={isModuleEnabled('budgetAnalytics') ? <BudgetAnalytics /> : <Navigate to="/" replace />}
    />,
    <Route
        key="family-dashboard"
        path="/family-dashboard"
        element={isModuleEnabled('familyDashboard') ? <FamilyDashboard /> : <Navigate to="/" replace />}
    />,
];
