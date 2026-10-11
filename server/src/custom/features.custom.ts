// Fork feature flags.
//
// One env var per custom feature. Absent means enabled, so a stock deployment
// behaves like upstream plus the fork's routes, and an operator can switch a
// feature off to compare against upstream or to bisect a merge problem.
//
// The flag doubles as the client's kill switch: when a feature is off its module
// keys are reported in `disabled_modules` by the /me route (see the marked hook
// in routes/auth.ts), and the client's existing module filter then hides the
// matching nav entry / dashboard widget / page. No client-side flag plumbing.

export type CustomFeature =
    | 'weather'
    | 'media'
    | 'budgetReceipts'
    | 'budgetAnalytics'
    | 'lunchbox'
    | 'pantry'
    | 'outings'
    | 'aiWidgets'
    | 'productScan';

const FLAGS: Record<CustomFeature, string> = {
    weather: 'CUSTOM_FEATURE_WEATHER_ENABLED',
    media: 'CUSTOM_FEATURE_MEDIA_ENABLED',
    budgetReceipts: 'CUSTOM_FEATURE_BUDGET_RECEIPTS_ENABLED',
    budgetAnalytics: 'CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED',
    lunchbox: 'CUSTOM_FEATURE_LUNCHBOX_ENABLED',
    pantry: 'CUSTOM_FEATURE_PANTRY_ENABLED',
    outings: 'CUSTOM_FEATURE_OUTINGS_ENABLED',
    aiWidgets: 'CUSTOM_FEATURE_AI_WIDGETS_ENABLED',
    productScan: 'CUSTOM_FEATURE_SCANNER_ENABLED',
};

// Module keys the client understands (client/src/contexts/AuthContext.tsx,
// `isModuleEnabled`). A feature can own several: the weather feature ships two
// dashboard widgets, so a family can hide them one by one.
const MODULE_KEYS: Record<CustomFeature, readonly string[]> = {
    weather: ['weather', 'activities'],
    media: [],
    budgetReceipts: ['budgetReceipts'],
    budgetAnalytics: ['budgetAnalytics'],
    lunchbox: ['lunchbox'],
    pantry: ['pantry'],
    outings: ['outings'],
    aiWidgets: [],
    productScan: ['productScan'],
};

// Every key above, in one tuple. It is spread into upstream's TOGGLEABLE_MODULES
// (routes/userSettings.ts) for a concrete reason: with a feature switched off,
// `customDisabledModules()` puts its key in what /api/auth/me reports, the client
// keeps that key in the array it sends back on the next module toggle
// (Settings → PUT /api/auth/modules), and upstream rejects any key it does not
// know with a 400. Registering the keys makes that round-trip legal.
//
// Note what this does NOT do: the Settings page still lists only upstream
// modules, so a family hides a custom feature through its CUSTOM_FEATURE_* flag
// (which reports the key as disabled), not through a checkbox. Listing them
// there would mean fork-owned label keys in six locales for a switch the env
// flag already provides.
export const CUSTOM_MODULE_KEYS = ['weather', 'activities', 'budgetReceipts', 'budgetAnalytics', 'lunchbox', 'pantry', 'outings', 'productScan'] as const;

// Dashboard widgets this fork adds. The server's own DASHBOARD_WIDGETS list
// (routes/userSettings.ts) sanitises what a member may store, so a widget that
// is missing there can never appear on the dashboard — the client list alone is
// not enough.
export const CUSTOM_DASHBOARD_WIDGETS = ['weather', 'activities', 'pantry'] as const;

export const isCustomFeatureEnabled = (feature: CustomFeature): boolean =>
    process.env[FLAGS[feature]] !== 'false' && process.env[FLAGS[feature]] !== '0';

/** Module keys to report as disabled because their feature is switched off. */
export const customDisabledModules = (): string[] =>
    (Object.keys(FLAGS) as CustomFeature[])
        .filter((feature) => !isCustomFeatureEnabled(feature))
        .flatMap((feature) => MODULE_KEYS[feature]);
