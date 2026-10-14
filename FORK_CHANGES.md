# Fork Changes

Ledger of every place this fork (`nmtsylla/OpenFamily`) diverges from upstream
(`NexaFlowFrance/OpenFamily`). Rules for making changes: `AGENTS.md`.

- Upstream remote: `upstream` → `https://github.com/NexaFlowFrance/OpenFamily.git`
- `origin` → `git@github.com:nmtsylla/OpenFamily.git` (this fork)
- Baseline of this ledger: `upstream/main` @ `835f9eb` (commit dated 2026-10-07)
- `main` carries the fork (upstream + custom features); upstream is merged in,
  never rebased onto. **Correction (2026-10-11):** `main` is 10 fork commits ahead
  of `upstream/main` and `develop` is a further 39 (`git rev-list --left-right
  --count main...upstream/main` reads `10 0`; `develop...upstream/main` reads
  `49 0`). `AGENTS.md` still describes `main` as an untouched mirror with "0
  commits of drift" and its sync step 1 (`git checkout main && git merge --ff-only
  upstream/main`) therefore fails as soon as upstream advances — that is a
  maintainer decision (re-layout, or rewrite the procedure and the doc), not
  something this ledger can settle. `git merge upstream/main` straight into
  `develop` is unaffected.

This repository is a **re-port** of the earlier fork work that had grown into the
upstream tree (that tree is kept for reference at `/home/bsylla/OpenFamily-budget`,
where the same features were spread over 50 upstream files and ~9000 inserted
lines). Here they live in `custom/` locations with a single hook per upstream file.

Measured divergence of this port, **re-measured 2026-10-11** on `develop` against
`upstream/main` (`git diff --numstat upstream/main...develop`): **38 upstream files
modified, 2486 lines inserted into them, 38 upstream-authored lines deleted** (34
excluding `package-lock.json`; 1936 inserted / 34 deleted excluding
`package-lock.json` and `DOCUMENTATION.md`). The figures this paragraph used to
carry (`35 upstream files touched, 24 modified lines, 1517 inserted`) were running
tallies of successive passes and had drifted — that command is the source of truth
from here on. Every touched upstream file carries `FORK-START/END` markers except
the four that cannot hold them the usual way: `.env.example` (which does hold `#`
comments, but uses the AGENTS.md `# --- Custom ---` section convention instead) and
`package-lock.json`, `server/package.json`, `client/package.json` (JSON) — each
explained below.

## Custom features (new files only)

| Feature | Files | Flag |
|---------|-------|------|
| Weather, clothing suggestions, screen-free activities. The saved city is the **family's**, not the account's: stored on the owner's row, saved from Settings and read by every member's dashboard, with a `family` WebSocket event fanned out to the whole family on save. The widgets target **today before 18:00 and tomorrow from 18:00 on** (the hour alone picks the day; the school/home rule only labels it), and the payload carries the offset plus the nearer of the next 18:00 and midnight, so the client schedules against the server's boundary and the label cannot stay "tomorrow" past midnight | `server/src/custom/weather/*.custom.ts`, `server/src/custom/routes/weather.custom.ts`, `server/src/custom/lib/{dayContext,familyNotify}.custom.ts`, `server/src/custom/ai/{activityBank,widgets}.custom.ts`, `server/src/custom/routes/aiDashboard.custom.ts`, `client/src/custom/components/{WeatherClothingCard,WeatherDetailsDialog,WeatherLocation,KidsActivitiesCard}.custom.tsx`, `client/src/custom/hooks/useWeather.custom.ts`, `client/src/custom/lib/{weatherCode,dayContextLabel}.custom.ts` | `CUSTOM_FEATURE_WEATHER_ENABLED`, `CUSTOM_FEATURE_AI_WIDGETS_ENABLED` |
| Object storage for images (S3-compatible) | `server/src/custom/lib/{storage,media,storage-errors}.custom.ts`, `server/src/custom/middleware/media.custom.ts`, `server/src/custom/routes/media.custom.ts` | `CUSTOM_FEATURE_MEDIA_ENABLED` |
| Receipt / bill import with line detail | `server/src/custom/routes/budgetReceipts.custom.ts`, `server/src/custom/ai/receipt.custom.ts`, `client/src/custom/components/{ReceiptImport,BudgetReceipts}.custom.tsx` | `CUSTOM_FEATURE_BUDGET_RECEIPTS_ENABLED` |
| Budget analytics page | `server/src/custom/lib/budgetAnalytics.custom.ts`, `server/src/custom/routes/budgetAnalytics.custom.ts`, `client/src/custom/pages/BudgetAnalytics.custom.tsx` | `CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED` |
| Lunchboxes + weekly nutritional read (ported from KeurTonux), with manual and AI drink fields optional and validation/save errors kept inside the form dialog | `server/src/custom/lib/lunchbox.custom.ts`, `server/src/custom/lib/aiSettings.custom.ts`, `server/src/custom/lib/promptLanguage.custom.ts`, `server/src/custom/ai/{lunchbox,nutrition}.custom.ts`, `server/src/custom/routes/lunchbox.custom.ts`, `server/test/lunchbox.custom.test.ts`, `client/src/custom/pages/Lunchboxes.custom.tsx`, `client/src/custom/components/{LunchboxAiDialog,NutritionAnalysisDialog}.custom.tsx` | `CUSTOM_FEATURE_LUNCHBOX_ENABLED` |
| Smart pantry — what the household has at home (locations, expiry, low stock), bridging the shopping list both ways, Grocy stock in, and the receipt import feeding it: the obviously stockable lines merge in under the brand-free name the AI read off the ticket, the rest wait in a review queue on the page; lunchbox AI and a "cook from what you have" tab out | `server/src/custom/lib/pantry.custom.ts`, `server/src/custom/lib/pantryMerge.custom.ts`, `server/src/custom/lib/validation.custom.ts`, `server/src/custom/routes/pantry.custom.ts`, `client/src/custom/pages/Pantry.custom.tsx`, `client/src/custom/components/PantryExpiryCard.custom.tsx`, `client/src/custom/lib/pantryMatch.custom.ts` | `CUSTOM_FEATURE_PANTRY_ENABLED` |
| AI outing planner on the Planning page — real nearby places from OpenStreetMap/Overpass ranked for the selected day, weather, party and relevant family profiles; choose saved home, browser position or a temporary city/area without changing home settings; restaurants require the exact `diet:halal=only` tag; location-free activity ideas never invent venues; the chosen outing is added through upstream's `/api/planning` | `server/src/custom/lib/places.custom.ts`, `server/src/custom/lib/{location,kids}.custom.ts`, `server/src/custom/ai/outings.custom.ts`, `server/src/custom/routes/outings.custom.ts`, `server/test/outings.custom.test.ts`, `client/src/custom/components/OutingPlanner.custom.tsx`, `client/src/custom/hooks/useOutings.custom.ts` | `CUSTOM_FEATURE_OUTINGS_ENABLED` |
| Barcode scanning, product lookup and promo watchlist | `server/src/custom/lib/{openFoodFacts,product}.custom.ts`, `server/src/custom/routes/productScan.custom.ts`, `server/test/productScan.custom.test.ts`, `client/src/custom/pages/{ProductScanner,PromoWatchlist}.custom.tsx`, `client/src/custom/components/{BarcodeScanner,ProductCard}.custom.tsx`, `client/src/custom/hooks/{useProductScan,usePromoWatchlist}.custom.ts`, `client/src/custom/lib/product.custom.ts` | `CUSTOM_FEATURE_SCANNER_ENABLED` |
| Live supermarket promotions (PrijsProfeet, free plan): the promo screen's daily list with product pictures, filtered by store / category / discount / text and paginated, the family's own "never show me this" terms, and the watch list's deals pane | `server/src/custom/lib/{prijsprofeet,promoExclusions}.custom.ts`, `client/src/custom/components/{DailyPromos,PromoOfferRow,PrijsProfeetCredit,PromoWatchlistPanel}.custom.tsx`, `client/src/custom/hooks/useDailyPromos.custom.ts` (routes, page, hooks and translations shared with the row above) | `CUSTOM_FEATURE_SCANNER_ENABLED` |
| Board — a full-screen wall-display page, the pastel tile grid of the reference mock: clock + greeting, today's agenda, weather with hourly rain-probability bars, meals, shopping, European air quality, over a full-width chores strip whose chips are tapped to complete (inline 5 s undo, Kiosk.tsx's pattern). Reads the upstream lists (appointments / tasks / meal plans / shopping) and Open-Meteo directly for weather and air quality (no key, public CORS); both follow the **family's** saved city (`GET /api/weather/location`, the coordinates a parent saves in Settings), so every account and every device shows one city and a change reaches the open boards over the `family` WebSocket. Chrome-less (`fixed inset-0` layer), so no upstream edit | `client/src/custom/pages/Board.custom.tsx`, `client/src/custom/lib/board.custom.css` (keys in `board.custom`) | `CUSTOM_FEATURE_BOARD_ENABLED` |
| Feature flags / registration point | `server/src/custom/features.custom.ts`, `server/src/custom/register.custom.ts`, `server/src/custom/middleware/rateLimit.custom.ts` | — |
| Client hooks for custom code | `client/src/custom/{nav.custom.ts,routes.custom.tsx}` | — |
| Deploy assets | `deploy/README.md`, `deploy/up.sh`, `docker-compose.override.yml` | — |
| Maintenance: clear the Budget / Meals / Pantry domains (dry run by default, `--yes` to delete) | `scripts/clean-custom-data.mjs` | — |
| Translations | `client/src/i18n/locales/<lng>/{weather,activities,analytics,dashboard,budget,ai,lunchbox,pantry,outings,scan,layout,board}.custom.json` | — |
| Screen wake lock — the app keeps the screen awake while it is the visible page, which is what makes a wall tablet or a phone left on the kitchen counter usable as a display; the lock is re-asked for on every return to visible (the browser drops it itself when the page hides) and released on unmount, and it exists once, in a hook the app-wide mount uses (it absorbed the family dashboard's own inline effect, which had the idempotence bug of stacking a second lock on a mount followed by a visible event) | `client/src/custom/hooks/useScreenWakeLock.custom.ts`, `client/src/custom/components/ScreenWakeLock.custom.tsx` (mounted from `client/src/main.tsx`) | — (no flag: client-only, no server route and no API surface, so there is nothing for a `CUSTOM_FEATURE_*` variable to unmount; its scope is the installed display mode, which `isStandalonePwa` holds — `matchMedia('(display-mode: standalone)')` or `navigator.standalone` — because a browser tab's screen is the browser's business, while the dashboard holds the lock whatever the display mode, a wall tablet being a display) |
| Landscape mobile tab-bar collapse | `client/src/custom/components/LandscapeTabsToggle.custom.tsx`, `client/src/custom/lib/landscapeTabs.custom.css`, `client/src/i18n/locales/<lng>/layout.custom.json` | — (no flag: client-only, no server route and no API surface) |

Gating: a feature's `CUSTOM_FEATURE_*_ENABLED=false` unmounts its API routes and
adds its module keys to `disabled_modules` in `/api/auth/me`, which hides the
matching nav entry, page and dashboard widget through the client's existing module
filter. Module keys: `weather`, `activities`, `budgetReceipts`, `budgetAnalytics`,
`lunchbox`, `pantry`, `outings`, `productScan`, `board`.

## Ported from KeurTonux (`tonux/KeurTonux`, local checkout `/home/bsylla/keurtonux`)

The meal-planning delta is the **lunchbox** feature set: per-child daily boxes,
their tracking, the shopping list built from them, AI ideas from the pantry, and a
weekly nutritional read. It is the only thing ported; the household meal planner is
KeurTonux's older sibling of upstream's and stays upstream's.

**Kept from OpenFamily** (the fork does not fork these): the upstream meal planner
(`meal_plans`, `routes/mealPlans.ts`, `pages/MealPlanning.tsx`, the Tandoor import)
untouched; the AI stack (`services/ai` — ollama/OpenAI-compatible/Anthropic/Gemini,
`ai_settings` + encrypted key, the `AI_*` error codes the client already maps through
`ai:errors.*`); the `custom/` layout, the one-hook-per-upstream-file rule and the
`CUSTOM_FEATURE_*` gating; the shopping list and its family-customizable categories;
the `meals.custom.json`-style i18n convention (here `lunchbox.custom.json`).

**Changed on the way in**, each for a reason that does not exist in KeurTonux:

| KeurTonux | Here | Why |
|---|---|---|
| Lunchboxes as extra `meal_plans` rows discriminated by `meal_type = 'Boîte à lunch'`, with a rewritten unique index | Own table `custom_lunchboxes` (`custom/0003`) | Never alter an upstream table or its constraints; the fork already reads upstream tables read-only for the nutrition call |
| A lunchbox row inside the MealPlanning page | Own page `/lunchboxes` + nav entry | `pages/MealPlanning.tsx` is upstream-owned; a tab there would be a large upstream diff |
| `LUNCHBOX_TYPE = 'Boîte à lunch'` and French-only prompts (`Toutes les chaînes en français`) | No French constant anywhere in the code; prompts take the reader's language (French hand-tuned, English base + explicit directive for the other five, same pattern as the weather widgets) | The fork ships six locales; a stored French meal type would have to be translated at render time and a French-only model answer is wrong in five of them |
| Verdict returned as `"Bon"` / `"À améliorer"` | Verdict as a locale-neutral code (`good`, `needs_improvement`) translated client-side | Same reason; the score bands stay the single source of truth (the code is derived from the score when the model invents one) |
| Senegal-specific nutrition framing (Yassa, Thiéboudienne…) | Culture-neutral prompt | OpenFamily is not a Senegalese app; the family's own dish names arrive as data |
| `AI` quota / `DISABLED` / `BAD_JSON` codes | `AI_*` codes of `services/ai` | Upstream has no AI quota; reusing its codes keeps one client-side error map |
| Shopping list always `INSERT`s, so a second run adds the quantities again | Existing unchecked item with the same name is left alone | Re-running a week must be idempotent; the toast reports created vs already-there |
| Mon–Fri cells only | Any day | An outing or a trip weekend is exactly when a box gets packed, and the AI dialog offers "outing" / "travel" locations |

## Modifications to upstream files

Every row is additive and marker-wrapped. (The table has no "modified lines"
column — an earlier version of this paragraph referred to one that never
existed; the exact count of rewritten upstream lines is the next section's table.)

| File | Marker | Why |
|------|--------|-----|
| `server/src/app.ts` | `custom-routes`, `budget-custom`, `board` | One `registerCustomRoutes(app)` hook (import + call, above the upstream limiters) and one added condition so `/api/ai/extract-receipt` skips the 1 MB default JSON parser; the `board` marker adds the air-quality host to the SPA's CSP (see "The board takes the family city" below) |
| `server/src/routes/auth.ts` | `custom-features`, `media` | Adds the env-disabled custom modules to `disabled_modules`; accepts an `s3:` avatar reference |
| `server/src/routes/userSettings.ts` | `weather`, `custom-modules` | Adds the custom dashboard widget keys to `DASHBOARD_WIDGETS` (the list `parseDashboardPrefs` validates against — without it the widgets are silently dropped) and the custom module keys to `TOGGLEABLE_MODULES` (upstream rejects an unknown key in `PUT /api/auth/modules`, so a flag-disabled key reported through `/api/auth/me` would make the next module toggle fail with 400) |
| `server/src/migrations/registry.ts` | `custom-migrations` | Appends the fork migrations (`custom/0001` … `custom/0009-promo-exclusions`) |
| `server/src/index.ts` | `media` | Ensures the bucket exists at startup when storage is configured |
| `server/src/lib/postFields.ts`, `server/src/lib/recipeImage.ts` | `media` | Keeps an `s3:` media reference intact instead of treating it as a data URL |
| `server/src/routes/dataTransfer.ts` | `media` | Stores inline images on import and answers with JSON instead of rethrowing |
| `server/src/routes/ai.ts` | `ai`, `pantry-ai` | Adds the `extract-receipt` endpoint and the attachment type; `pantry-ai` hands the household's stock to the two prompts (`loadPantryForAi`) and drops a pantry proposal the model returns while the pantry is switched off |
| `server/src/services/ai/assistant.ts` | `pantry-ai` | Adds the `pantry_item` proposal (schema enum, parse-prompt section, validator case) and the pantry/ingredient halves of the meals prompt; imports `PANTRY_LOCATIONS` from `custom/lib/pantry.custom` so the validator and the table share one vocabulary |
| `server/src/services/ai/index.ts` | `ai`, `ai-no-deliberation` | Adds the `AiAttachment` type and the `AI_UNSUPPORTED_MEDIA` code; appends one no-deliberation line to every completion's system prompt (a JSON-only call, and a reasoning model left alone spent most of its completion tokens thinking, see "Measured latency" below) |
| `server/src/services/ai/{openai,anthropic,gemini,ollama}.ts` | `ai` | Sends attachments to each provider; OpenAI-compatible gateways that need a session |
| `server/src/db.ts` | `db-config` | Database TLS and connect timeout from `CUSTOM_POSTGRES_*` |
| `client/src/App.tsx` | `custom-routes` | Mounts `customRoutes(isModuleEnabled)` inside `<Routes>` |
| `client/src/components/layout/Layout.tsx` | `custom-nav`, `nav-collapse` | Appends `customNavigation` / `customMobileTabs` to the upstream arrays; the second hook mounts the landscape mobile tab-bar toggle in the header's left group |
| `client/src/pages/Dashboard.tsx` | `weather`, `pantry` | Renders the custom dashboard widgets; the pantry expiry card has its own three `pantry` blocks, the weather blocks are untouched |
| `client/src/pages/Settings.tsx` | `weather`, `budget-custom` | Weather location card, vision-model hint |
| `client/src/pages/Budget.tsx` | `budget-custom` | Mounts the receipt import button and the imported-receipts section |
| `client/src/components/ui/Dialog.tsx` | `stable-dialogs` | One added attribute, `onPointerDownOutside={(event) => event.preventDefault()}`. An outside tap lands on the scrim with the page's own chrome showing through it, and on a phone or tablet that read as the dialog closing itself mid-use: the tap did nothing else. The X, Escape, and every explicit action still close it |
| `client/src/pages/Budget.tsx`, `client/src/pages/Integrations.tsx` | `stable-dialogs` | Each had a hand-rolled backdrop that closed on tap: the budget limits `Sheet` and the Integrations connect modal. Both keep their own X button, so their backdrop no longer closes them either |
| `client/src/pages/Planning.tsx` | `outings` | Renders the custom outing planner below the week grid (one import + one element, both marker-wrapped); the outcome is added through the page's own `/api/planning` endpoint |
| `client/src/pages/ShoppingList.tsx` | `product-scan` | Adds the "scan a barcode" button (navigates to `/scanner`) and the per-row barcode badge that opens the promo watchlist; purely additive (2 imports, one hook block, 2 JSX blocks) and it reads `productScan` through a second `useAuth()` call so upstream reshaping its own destructure cannot collide |
| `server/src/lib/safeFetch.ts` | `safeFetch-credentials` | Drops `Authorization` / `X-API-Key` / `x-goog-api-key` / `Cookie` on a redirect hop that leaves the original hostname (the guard only blocks internal/metadata targets, not third parties); a same-host hop — including an `http` → `https` upgrade — keeps them |
| `client/src/contexts/AuthContext.tsx` | `weather, pantry` | The `DASHBOARD_WIDGETS` line carries the fork's widget keys (weather, activities, pantry); one marker pair wraps that modified line itself, so an upstream change to it is re-applied from here |
| `client/src/components/app/MagicInput.tsx` | `budget-custom`, `pantry-ai` | Adds the `AI_UNSUPPORTED_MEDIA` error code; `pantry-ai` renders the pantry proposal (own icon and label, quantity and shelf) and confirms it through `POST /api/pantry/upsert` |
| `client/src/demo/mockApi.ts` | `budget-custom`, `demo-prefs`, `lunchbox`, `pantry`, `outings` | Demo handlers for receipts, receipt extraction, analytics, lunchboxes and the pantry (seeded rows, the shopping-list bridge, the receipt import — which splits its lines exactly like the server: obvious products merged, the rest queued — the review queue with its `confirm`/`ignore` calls, and the two answers the page reacts to: `DUPLICATE_NAME`, `NO_GROCY_INTEGRATION`); plus the two object-shaped endpoints upstream's demo never answers (`dashboard-prefs`, `posts/latest`), whose `ok([])` catch-all crashed the demo's default route. The `demo-prefs` block's default widget order also carries `pantry`; the `outings` block resolves area lookups only for Sint-Niklaas, answers current-position requests with its fixed location-free ideas and no places (the demo has no places database), and never relabels its fixed fixtures for another area |
| `client/nginx.conf` | `media` | Dedicated `location ^~ /api/media/` block (upstream's `location /api/` line untouched) |
| `scripts/smoke-api.sh` | `budget-custom`, `lunchbox`, `outings` | Smoke calls for saved, area-resolved, and current-position outing requests, including the temporary-area geocoder endpoint and a comparison that the saved home is unchanged by it |
| `.env.example` | (section) | `# --- Custom ---` section at the end of the file |
| `DOCUMENTATION.md`, `ROADMAP.md`, `README.md`, `README.fr.md`, `README.zh-CN.md` | `docs` | Feature documentation |
| `docker-compose.yml` | `deploy` | Custom env vars for the server service, `CUSTOM_FEATURE_*_ENABLED` included (without a line there, a variable set in `.env` never reaches the container — the documented kill switch could not be used on a Docker install) |
| `server/package.json`, `package-lock.json` | (none, JSON) | `@aws-sdk/client-s3` dependency and the `test` script; lockfile regenerated, never hand-edited |
| `client/package.json`, `package-lock.json` | (none, JSON) | `react-zxing` dependency; lockfile updated with `npm install --legacy-peer-deps` so the workspace's react/react-dom stay on the versions already locked (19.2.7/19.2.7) — a plain `npm install` re-resolved `react` to 19.3.0 against `react-dom` 19.2.7 and crashed every page at runtime |
| `client/src/main.tsx` | `custom-wake-lock` | Mounts the app-wide screen wake lock beside `<App />`, its only mount point that covers every route at once (the Layout-wrapped pages, `/kiosk`, `/login`), and the component gates itself on the installed display mode so a browser tab is left alone. What it cost, and what that forced: the mount is 811 bytes of main bundle, and the bundle had 314 bytes of room under workbox's 2 MiB precache limit, which fails `vite build` outright rather than warning (the same limit that keeps the scanner and dashboard chunks lazy) — so the last four eagerly imported custom pages moved to their own chunks in the same change, measured 2,097,362 → 2,009,466 bytes (see `custom/routes.custom.tsx`), while a boot-time `import()` of a React-free variant was tried first and rejected: the dynamic-import machinery alone costs 357 bytes more than the module. Purely additive here: one marker-wrapped default import placed immediately before `import App from './App'`, and one marker-wrapped `<ScreenWakeLock />` added as a direct child of `<WebSocketProvider>`; no upstream line moved, reordered or reworded (6 added lines: the two marker pairs and their two content lines). Re-apply = re-insert the two marker blocks if upstream reshapes this file, since both markers wrap only fork lines |

### Modified (non-additive) upstream lines — the complete list

38 lines in 20 files (42 with `package-lock.json`), all wrapped in markers. The
per-file counts were re-measured 2026-10-11 with `git diff --numstat
upstream/main...develop -- <file>` (the deleted column — not `grep -c '^-[^-]'`,
which misses a deleted line that itself starts with `-`, as `ROADMAP.md`'s does);
two rows were wrong before (`routes/auth.ts` 2 → 6, `routes/userSettings.ts` 2 → 1).
The last two rows are the 2026-10-12 dialog pass; `components/ui/Dialog.tsx`'s one
line is an added attribute, so it appears in the additive table above instead.

| File | Lines | What |
|------|-------|------|
| `server/src/services/ai/assistant.ts` | 2 | the parse schema's `type` enum carries `pantry_item`; the meals recipe line gains its ingredient suffix when the pantry is on |
| `server/src/services/ai/index.ts` | 4 | the four provider calls in `aiCompleteWithUsage` pass the request with the no-deliberation line appended |
| `server/src/routes/auth.ts` | 6 | The avatar data-URL format/size checks are skipped for an `s3:` reference (wrapped in `if (!isMediaRef(...))`); re-measured: the two checks and their comment, nested one level deeper |
| `server/src/services/ai/openai.ts` | 2 | `chatCompletionUrl(baseUrl)`, `messageContent(request)` |
| `server/src/services/ai/anthropic.ts` | 2 | `max_tokens` 2048 → 4096; user content carries attachments |
| `server/src/services/ai/gemini.ts` | 1 | request parts carry attachments |
| `server/src/services/ai/ollama.ts` | 1 | user message carries images when present |
| `server/src/db.ts` | 1 | `connectionTimeoutMillis` uses `CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS` |
| `server/src/routes/userSettings.ts` | 1 | `DASHBOARD_WIDGETS` spreads the custom widget keys; `TOGGLEABLE_MODULES` is an appended line, not a rewrite |
| `client/src/contexts/AuthContext.tsx` | 1 | `DASHBOARD_WIDGETS` lists the custom widget keys (weather, activities, pantry) |
| `README.md`, `README.fr.md`, `README.zh-CN.md` | 1 each | Feature row appended to the budget line |
| `ROADMAP.md` | 2 | The receipt-import bullet, rewritten as a fork block (the line itself starts with `-`, which a `grep '^-[^-]'` count misses) |
| `server/src/lib/safeFetch.ts` | 1 | the `fetch` call passes `requestInit` (the credentials-stripped headers) instead of `init` |
| `server/src/routes/ai.ts` | 5 | the parse prompt's 4th argument and the proposal filter; the recipes `SELECT` (adds `ingredients`) and the row mapping that keeps only its string lines; the `buildMealsPrompt` call passes `pantryItems` |
| `client/src/components/app/MagicInput.tsx` | 3 | the `AiProposal` union carries `PantryProposal`; the card's title chain and its type label know that type |
| `client/src/pages/Budget.tsx` | 1 | the limits `Sheet`'s backdrop loses its `onClick={onClose}` |
| `client/src/pages/Integrations.tsx` | 1 | the connect modal's backdrop loses its `onClick={closeModal}` |
| `server/src/app.ts` | 1 | the SPA CSP's `connect-src` line gains the board's air-quality host; the array line itself is rewritten (added 2026-10-14) |

## Measured latency of the AI dashboard widgets

The two dashboard widgets are the only AI calls a member waits on with an empty
card, so they were measured end to end (2026-10-10, live instance, French UI,
provider `openai` against `opencode.ai/zen/go`, model `deepseek-v4.1-flash`).

Route durations from the server log, before any change:

| Route | Duration |
|-------|----------|
| `POST /kids-activities` | 28.1 s, and one 60.2 s (the shared `AI_TIMEOUT_MS` giving up) |
| `POST /clothing-suggestions` | 17.8 s (209 ms on a cache hit) |

One request to the gateway with the real prompt and no cap returned
`prompt_tokens: 533` (256 of them cached) and `completion_tokens: 3456`, of which
`reasoning_tokens: 2796`. Four fifths of the generated tokens were the model
deliberating before it wrote anything, and the wall time tracks completion tokens,
not prompt size (the JSON itself is ~700 tokens).

Four concurrent runs of the same prompt, English and French, with and without one
appended line:

| Run | reasoning tokens | completion tokens | wall |
|-----|-----------------|-------------------|------|
| en, as-is | 1974 | 2813 | 60.8 s |
| en, + no-deliberation line | 0 | 760 | 17.8 s |
| fr, as-is | 5078 | 5971 | 62.2 s |
| fr, + no-deliberation line | 384 | 1305 | 12.3 s |

Every arm returned valid JSON. Three further sequential runs of the directive
prompt gave 17.1 s / 44.4 s / 85.9 s (reasoning 684 / 1241 / 4043), so the line
reduces deliberation at the median but does not switch it off, and the spread is
wide. The gateway is what bounds this number. That is why the second half of the
fix does not depend on it: both widget routes answer a first phase (`instant:
true`) with the context and, for activities, the offline bank, and the dashboard
paints that in ~200 ms before asking for the model's answer (see
`routes/aiDashboard.custom.ts` and `useWidgetPhases` in
`client/src/custom/hooks/useWeather.custom.ts`).

## Dependency changes

- `@aws-sdk/client-s3@^3.1148.0` (server) — S3-compatible image storage
- `react-zxing@^2.1.0` (client, resolves to 2.2.0 + `@zxing/library@0.20.0`) — barcode
  decoding for the scanner page. `zxing-wasm` was dropped from the plan: it is only
  needed by react-zxing v3 (`barcode-detector`), while v2 decodes in pure JS and
  needs no WASM asset — one less thing to ship to the WebView.
- `server/package.json` — `"test": "tsx --test test/*.test.ts"`
- `package-lock.json` regenerated for the above; no other version changed. The
  `react-zxing` install was done with `npm install --legacy-peer-deps` (see the
  `client/package.json` row above): it leaves the locked `react`/`react-dom`
  versions alone, and only adds `react-zxing` and its three transitive packages.

## Custom migrations

They live in the reserved `custom/` namespace (upstream ends at `core/0006`, so its
next migration takes `core/0007`):

- `custom/0001-users-location` — `users.city`, `country_code`, `latitude`, `longitude`
- `custom/0002-budget-receipts` — `budget_receipts`, `budget_receipt_items`,
  `budget_entries.receipt_id` (FK `ON DELETE CASCADE`), `UNIQUE (user_id, fingerprint)`
- `custom/0003-lunchboxes` — `custom_lunchboxes`, `UNIQUE (user_id, family_member_id, date)`,
  two indexes. The fork's own table on purpose: upstream's `meal_plans` has one row per
  date+meal type and no "for whom", so adding lunchboxes there would mean altering an
  upstream table (KeurTonux's approach) instead of adding beside it.
- `custom/0005-pantry-dedupe` — folds the owned rows that share a `name_key` (the
  surviving lowest-id row takes their summed quantity, the rest are deleted; Grocy
  rows untouched) so the unique indexes below can be created on a database that is
  not empty. Placed in the array immediately BEFORE `custom/0005-pantry-name-unique`
  — the runner applies the registry in array order, and `validateRegistry` checks
  ids for shape and uniqueness only — because a bare `CREATE UNIQUE INDEX` on
  duplicates raises 23505, the migration throws, and the server dies at startup with
  `0005` unrecorded, so no later migration could ever repair it. Verified on a
  scratch Postgres 16: with two owned `lait` rows (2 + 3) and one Grocy row,
  `custom/0005-pantry-name-unique` alone fails (`could not create unique index`),
  while dedupe → index applies both, leaves one owned row at 5 and the Grocy row at 1.
- `custom/0005-pantry-name-unique` — two PARTIAL unique indexes on `custom_pantry_items`: one
  for `source <> 'grocy'`, one for `source = 'grocy'`. The merge invariant (one row per folded
  name) is enforced by the database rather than by a SELECT-then-INSERT, so two concurrent
  merges cannot both insert; the split is what lets a Grocy row and a hand-kept row for the
  same product coexist, which is the Grocy sync's contract.
- `custom/0004-pantry` — `custom_pantry_items` (`name_key` = the folded name every merge
  compares on, `expires_on`, `low_stock_threshold`, `lunchbox_bucket`, `source`),
  `custom_pantry_imports` (`UNIQUE (user_id, source, source_ref)` — the import guard,
  once per ticket), three indexes. The pantry is the fork's own table like the two above:
  upstream has a shopping list, not a stock, and the Grocy integration only ever imported
  the shopping list.
- `custom/0006-pantry-pending` — `custom_pantry_pending`: the receipt lines the import
  refuses to stock on its own (a fee, an abbreviation nobody can name), with the printed
  label, the proposed name, the quantity and the unit, until someone confirms or ignores
  them on the pantry page. `receipt_id` is a FK `ON DELETE CASCADE`: the queue came from
  that ticket, while the products already merged into the pantry stay (they are real stock).
- `custom/0007-pantry-guard-fingerprint` — remaps the existing receipt guard rows from the
  receipt id to `budget_receipts.fingerprint` (merchant + date + total). Keyed on the id, a
  ticket whose receipt was deleted and scanned again made a fresh id, missed the guard and
  counted the same groceries into the pantry twice. Rows whose receipt was already deleted
  cannot be mapped (the id is all they hold) and stay inert — the products they counted are
  still in the pantry, which is the point.

- `custom/0008-product-scan` — `custom_products` (the Open Food Facts cache),
  `custom_promo_watchlist`, `custom_promo_prices`, `custom_shopping_item_barcodes`
  (+ one index: the two other candidates duplicated a primary key and the
  watchlist's UNIQUE). No upstream table is touched: the link from a shopping row
  to the barcode it was scanned from lives in its own table, keyed by the row's id.
  Numbered 0008, not 0003: the fork's other features took `custom/0003` to
  `custom/0007` first, and two migrations must not share a number.

- `custom/0009-promo-exclusions` — `custom_promo_exclusions` (one row per term a
  family never wants to see in the promo screens, UNIQUE per `user_id`). It exists
  because PrijsProfeet's own filters are store, category, price and savings, and
  the fork does not get to add a "not this" to a third-party API: the terms are
  applied to the page it returns (see `lib/promoExclusions.custom.ts`). The stored
  term is normalized, so the UNIQUE is meaningful and a second "Café" typed with
  its accent is not a second row. Applied to an existing database and to a fresh
  `postgres:16` in the same pass (see the verification section).

Every statement is idempotent (`IF NOT EXISTS`), and the ids must never be renamed
or their SQL edited: the runner records `id` + SQL checksum in
`openfamily_schema_migrations` (`server/src/migrations/runner.ts`).

## Environment variables (all new, all `CUSTOM_*`)

Documented in `.env.example` under `# --- Custom ---`. If you are migrating an
instance from the earlier fork tree, rename these in your `.env`:

| Old name | New name |
|----------|----------|
| `POSTGRES_SSL` | `CUSTOM_POSTGRES_SSL` |
| `POSTGRES_CONNECT_TIMEOUT_MS` | `CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS` |
| `MINIO_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` / `_REGION` | `CUSTOM_MINIO_*` |
| `OPEN_METEO_BASE_URL` / `OPEN_METEO_GEOCODING_URL` | `CUSTOM_OPEN_METEO_*` |
| `WEATHER_DEFAULT_LANG` / `_CACHE_TTL_MS` / `_REQUEST_TIMEOUT_MS` | `CUSTOM_WEATHER_*` |
| — (new) | `CUSTOM_FEATURE_{WEATHER,MEDIA,BUDGET_RECEIPTS,BUDGET_ANALYTICS,LUNCHBOX,PANTRY,OUTINGS,SCANNER,AI_WIDGETS,BOARD}_ENABLED` |
| — (new) | `CUSTOM_OVERPASS_URL`, `CUSTOM_OVERPASS_TIMEOUT_MS`, `CUSTOM_OUTINGS_RADIUS_KM`, `CUSTOM_OUTINGS_CACHE_TTL_MS` |
| — (new) | `CUSTOM_PRIJSPROFEET_API_KEY` (optional — the free plan works key-less), `CUSTOM_PRIJSPROFEET_COUNTRIES` (default `be`) |

All ten flags are listed in `docker-compose.yml`'s `FORK-START: deploy` block, so an
operator on a Docker install can switch any of them off from `.env` (they were absent
before the outing planner; unset still means enabled, so nothing changed for an
existing `.env`). `CUSTOM_PRIJSPROFEET_API_KEY` and `CUSTOM_PRIJSPROFEET_COUNTRIES`
sit in the same block for the same reason: without a line there, a key set in `.env`
never reaches the container.

## Translations

Fork-owned namespaces only, referenced as `t('<ns>:key')`; no key is added to an
upstream locale file:

- `weather.custom`, `activities.custom` (six locales)
- `analytics.custom` (six locales; the `es`, `pt`, `ru`, `zh` files are copies of
  the English strings — placeholders pending translation, required because
  `client/scripts/check-i18n.mjs` fails the build on any namespace missing from a
  locale)
- `dashboard.custom`, `budget.custom`, `ai.custom` (six locales; `dashboard.custom`
  now carries only the three custom widget labels upstream's own dashboard reads,
  and its `ru`/`zh` files are copies of the English strings, same placeholder rule
  as `analytics.custom`)
- `lunchbox.custom`, `pantry.custom` (six locales). `pantry.custom` also carries
  the magic-input label of a pantry proposal (`magic.types.pantry_item`): the
  card's label is read from the feature's own namespace rather than from a key
  added to upstream's `ai.json`, which this fork does not touch. Its `dashboard.*`
  keys stay: the pantry expiry card on upstream's dashboard reads them.
- `outings.custom` (six locales)
- `scan.custom` (six locales; `es`, `pt`, `ru`, `zh` are copies of the English
  strings, same placeholder rule as `analytics.custom`)
- `board.custom` (six locales)

## Tests

`server/test/{weather,aiProvider,budgetAnalytics,aiPrompt,lunchbox,pantry,receipt,outings,productScan,aiPantry}.custom.test.ts` — matched by the
server's `tsx --test test/*.test.ts`. `aiPantry` covers the pantry
half of the two AI prompts: the three states of the stock argument (`null` off,
`[]` on and empty, values), the `pantry_item` validator (quantity 0 kept,
unusable quantity → 0, unknown shelf/category → the defaults) and the recipes'
ingredient lines, which are only sent when something can be matched against them. `aiPrompt` covers the activities user prompt
and the cache-key digest it shares a normalizer with: what the family wrote on a
child's card has to reach the model, and two children with different notes must
never share a cached idea list. `pantry` covers the merge key (accents, case,
whitespace, the 160-char cap), the item sanitiser, low-stock and expiry
boundaries, the two import mappers (Grocy stock, receipt lines) and the split that
decides which lines are stocked without asking. `receipt` covers the pantry half of
the extraction: the brand-free name, the unit and the "is this stock?" verdict
survive validation, a non-boolean verdict never reads as yes, and a line typed by
hand carries neither. `lunchbox` covers item sanitization and AI idea validation
when the drink is omitted. `outings` covers exact-tag halal parsing and prompt
labeling, candidate-cap retention, participant profile projection and prompt
details (age, allergies, medications, and notes), model-reference validation, and
outing windows. `weather` covers the target-day rule: the 18:00 cutoff picks the
day (offset 0 before it, 1 from it), an evening on a home day targets tomorrow
with mode `home`, and the picked `date` always equals `toDateKey(now + dayOffset)`
for hours 0, 8, 17, 18 and 23; `flipsAt` is the nearer of the next 18:00 and
midnight.
The client
has no test runner; the custom UI
was verified in a browser instead (see "Verification" below).

## Endpoint moves (behaviour changes vs the earlier fork tree)

- `PUT /api/auth/location` → `PUT /api/weather/location` (the location belongs to
  the weather feature, not to upstream's auth router). `GET /api/weather/location`
  reads it back, so the client no longer needs `city`/`latitude`/… on the user object.
- Everything else keeps its path: `/api/weather`, `/api/ai/dashboard`,
  `/api/media`, `/api/budget/receipts`, `/api/budget-analytics`.
- `/api/custom/ha` existed for the family dashboard only and went with it
  (2026-10-14).

## Known gaps and inherited issues

- **Demo mode: fixed on the fork side.** `client/src/demo/mockApi.ts` has no
  handler for `/api/auth/dashboard-prefs` or `/api/posts/latest` in either tree,
  so its `ok([])` catch-all made `dashboardPrefs` an array (the dashboard throws
  on `prefs.order.filter`) and the latest post `[]` (throws on `author_name`).
  Both gaps were reproduced on the upstream baseline; this fork answers those two
  object-shaped endpoints properly (marker `demo-prefs`), so the static demo's
  default route renders again. The demo hides the two weather widgets, since it
  has no weather backend.
- `server/src/lib/postFields.ts`: the fork's reorder of the length check below the
  data-URL check was not ported (not media-related, and it would move upstream
  lines). Upstream order is preserved, so non-media behaviour is upstream's.
- `deploy/README.md` named the **wrong tree** as the active deployment (the live
  Compose project's working dir is `/home/bsylla/OpenFamily`, confirmed by
  `docker inspect openfamily-client`; the previous tree left no compose file
  behind), and FORK_CHANGES repeated the inversion. Both are corrected, and the
  rollback recipe now says what actually survives (the `openfamily-fork-*` images,
  not a directory).
- `analytics.custom.json` exists for all six locales, but its `es`/`pt`/`ru`/`zh`
  files are English placeholders pending translation (required by `check-i18n`).
- **The main bundle was within ~500 bytes of the PWA's precache limit — closed on
  2026-10-11 by `df16f56` (the four remaining eager custom pages moved into their
  own chunks, −87 kB).** Recorded because it shaped the family dashboard's kiosk
  rework (that page has since been removed, see its section): the branch it
  was measured on (`6ce1c4e`) built a 2,096.76 kB main chunk against workbox's 2 MiB
  `maximumFileSizeToCacheInBytes` (2,097,152 B), i.e. a few hundred bytes of
  headroom, so the rework deleted as many `dashboard.custom` keys as it added
  instead of shaving the margin. The 2026-10-11 merged-tree build measured
  2,009.33 kB. The 2026-10-12 build measured 2,016.64 kB, still below the 2 MiB
  per-file limit. Keep pages and heavy imports behind `React.lazy`, and measure
  `dist/assets/index-*.js` after adding i18n keys — the locale JSON is eager.
- **`custom/0005-pantry-name-unique` used to abort startup on a database that
  already held duplicate pantry rows — closed on 2026-10-11.** `CREATE UNIQUE
  INDEX` raises 23505 if two `source <> 'grocy'` rows share `(user_id, name_key)`
  — exactly the duplicates the pre-0005 SELECT-then-INSERT path could create — and
  the runner rethrows, so the process died at startup with `0005` unrecorded and
  nothing after it ever running. The frozen id and SQL rule out touching `0005`
  and the historical list in `db.ts` is closed by its own comment, so the repair
  is a new migration, `custom/0005-pantry-dedupe`, placed BEFORE `0005` in the
  registry array (the runner applies array order; `validateRegistry` checks shape
  and uniqueness, not order). Any instance — including one that already boot-looped
  on an earlier revision — is fixed by upgrading: the dedupe applies first, then
  `0005` finds a database with nothing left to fold. See "Custom migrations".
- **The custom rate limiter keys on `req.ip` with `trust proxy = 1`, and one
  instance is mounted on every custom router.** Behind the documented
  `cloudflared → nginx → server` chain the recorded hop is nginx's, so every
  client shares one 60-requests-per-minute budget across all eight custom mounts
  (a busy tab can 429 the household); on the base `docker-compose.yml`, which
  publishes `3001:3001` directly, a spoofed `X-Forwarded-For` bypasses it
  instead. Which of the two applies is a deployment decision (hop count vs. not
  publishing the port), so it is recorded here rather than patched blindly.
- **The pantry merge invariant and the receipt-import fingerprint have no test.**
  `mergeIntoPantry` (`custom/lib/pantryMerge.custom.ts`) and `receiptFingerprint`
  depend on a live database and the recorded fingerprint row respectively; the
  unit suites cover the pure halves (the fingerprint's normalization now has one,
  `server/test/receipt.custom.test.ts`), and `scripts/smoke-api.sh` does not POST
  a real receipt import. Treat a change to either as needing a manual run.

## Review pass on `develop` (2026-10-11)

A review of the branch's 39 commits (five read-only passes plus a measurement and
a smoke run) produced the fixes below. Everything not fixed here is recorded in
"Known gaps and inherited issues" above rather than left implicit.

- **A queued receipt line could stock the pantry twice.** `POST
  /api/pantry/pending/:id/confirm` read the row with a plain `SELECT`, merged, then
  deleted: two overlapping confirms (a client retry, two tabs) both saw the row,
  both merged the quantity, and the loser's `DELETE` removed 0 rows unnoticed.
  It now claims the line with `DELETE … RETURNING` inside the same transaction —
  the loser merges nothing and answers 404 (`routes/pantry.custom.ts`).
- **Credentials crossed redirect hosts.** `safeFetch` reused the caller's headers
  on every hop, so a compromised or MITM'd upstream could 302 the `Authorization`
  / `X-API-Key` / `x-goog-api-key` header to a third party (the guard only blocks
  internal/metadata targets). A hop that leaves the original hostname now drops
  those four headers; a same-host hop — `http` → `https` included — keeps them.
  Marker `safeFetch-credentials`.
- **Lunchbox edits leaked constraints as 500s.** Moving a lunchbox onto a day the
  same child already has now answers 409 `LUNCHBOX_DAY_TAKEN` (same helper as the
  pantry), and every date the router takes — create, update, the week range of
  the shopping-list and nutrition calls — is validated as a real calendar day, so
  `2026-02-30` is a 400 instead of PostgreSQL 22008. `isCalendarDate` moved from
  `lib/pantry.custom.ts` to `lib/validation.custom.ts` and is now shared by the
  pantry, the lunchbox and the outing planner.
- **Two client stale-response races.** `useDailyPromos` wrote its page/failure
  state without honouring the effect's `cancelled` flag (its own `catch` did), so a
  slow earlier filter could repaint the list; `PromoWatchlistPanel` filled one
  shared pane from whichever request resolved last, so opening card A then B could
  paint A's deals under B's header. Both now drop the stale answer.
- **Unbounded in-process caches.** The PrijsProfeet page cache and the widget
  caches key on client-supplied text and never evicted (a TTL does not bound a map
  whose expired entries are only ever replaced by their exact key). Both now evict
  the oldest entry past a fixed ceiling.
- **The pantry's unique index could not be created on a database that already
  held duplicates** (a boot loop, and no later migration could repair it). Closed
  with `custom/0005-pantry-dedupe`, placed before `0005` in the registry array —
  see "Custom migrations" and the known-gaps entry, both updated.
- **The lunchbox list and stats routes took unvalidated query dates.**
  `GET /api/lunchbox` and `GET /api/lunchbox/stats/:memberId` passed
  `?start_date=abc` (22007) and `2026-02-30` (22008) straight into a `DATE`
  comparison, answering 500 where the message is a 400; both now validate with
  the same `isCalendarDate` guard as the rest of the router.
- **Tests.** `server/test/receipt.custom.test.ts` gains the duplicate guard's
  identity (one ticket, one fingerprint whatever the spelling), its distinctness
  (another day/amount/shop) and its non-Latin behaviour (the `[a-z0-9]` stripping
  that collapsed Cyrillic and CJK shop names is what migration `custom/0007`
  exists for); `pantry.custom.test.ts` gains `isCalendarDate`. 100 tests pass.
- **Ledger corrections.** The divergence figures are re-measured above; the
  `client/src/pages/ShoppingList.tsx` and `server/src/lib/safeFetch.ts` rows were
  missing from "Modifications to upstream files"; two per-file counts in
  "Modified (non-additive) upstream lines" were wrong (`routes/auth.ts` 2 → 6,
  `routes/userSettings.ts` 2 → 1) and the note now states the measuring command,
  because `grep -c '^-[^-]'` also undercounts a deleted line that itself starts
  with `-` (`ROADMAP.md`'s, which is 2 and always was); the marker-less file list
  is four files, not three (`.env.example` holds `#` comments — it uses the
  `# --- Custom ---` section convention); `outings.custom.json` was missing from
  the translations row; and the stale "the fork's only modified upstream line"
  comment in `routes/auth.ts` now says what it actually wraps.

Verification for the pass: `cd server && npm test` (100 pass, 0 fail),
`npx tsc --noEmit` clean in `server/` and `client/`, and two throwaway scripts,
both deleted after their run:

- a same-host and a cross-host redirect in front of a recording server — the
  same-host hop kept `Authorization`/`X-API-Key`, the cross-host hop dropped both
  and kept an unrelated header;
- a scratch Postgres 16 (Docker) holding two owned `lait` rows (2 + 3) and one
  Grocy row, then `runVersionedMigrations` on the real registry: with
  `custom/0005-pantry-name-unique` alone the run fails (`could not create unique
  index`), and with `custom/0005-pantry-dedupe` before it both migrations apply,
  one owned row survives at quantity 5 and the Grocy row is untouched at 1. (The
  first cut of the dedupe used `min(id)`, which Postgres rejects for a `uuid`
  column — `min(id::text)::uuid` fixes it; the smoke run is what caught it.)

## Deployment

This checkout (`/home/bsylla/OpenFamily`, branch `develop`) is the **live
deployment** since 2026-10-10: `family.bsylla.com`
(Cloudflare tunnel `navidrome`, host service `cloudflared.service`) → the client
on `127.0.0.1:8200`, server reachable only inside the Compose network. Database:
Neon `keurtonux`/`openfamily`, TLS `verify-full`. Images: S3 Scaleway bucket
`openfamily-media`. Details and rollback: `deploy/README.md`.

The previous tree was stopped with `deploy/up.sh down` the same day; only its
images survive (`openfamily-fork-server`, `openfamily-fork-client`), the directory
it was built from no longer holds a compose file — `deploy/README.md` has the
workable rollback. Container names are fixed, so only one stack can run at a time.

What the cutover exercised, on the live database:

- the `CUSTOM_*` env renames — confirmed by `storage.bucket_ready` for
  `openfamily-media` at startup, which only happens when `CUSTOM_MINIO_*` is read
- the migration rename — `db.migrations_complete` reported
  `applied: ["custom/0001-users-location", "custom/0002-budget-receipts"]`,
  `alreadyApplied: 6`: the idempotent statements re-ran once, schema unchanged
- the two stale `core/0007`/`core/0008` rows were then deleted from
  `openfamily_schema_migrations` (the `db.migrations_unknown` warning), and the
  next restart reported `alreadyApplied: 8` with no warning

## Local development

`npm ci` at the root installs every workspace from the lockfile (772 packages).
Earlier the checkout carried symlinked `node_modules` into a sibling worktree
because `/home` was full; they are gone — a real install now exists, and the
lockfile is this fork's own.

Since this checkout is also the deployment, `.env` holds the **live** instance
config and `server/src/config/loadEnv.ts` loads it through dotenv (it reads
`cwd/.env` and `cwd/../.env`). Running the server locally therefore inherits
`CUSTOM_POSTGRES_SSL=verify-full` and `REGISTRATION_ENABLED=false` from
production. Pin what differs for a throwaway database, e.g.:

```bash
cd server && CUSTOM_POSTGRES_SSL=disable REGISTRATION_ENABLED=true \
  POSTGRES_HOST=127.0.0.1 POSTGRES_PASSWORD=… JWT_SECRET=… npx tsx src/index.ts
```

dotenv never overrides a variable that is already set, so pinning is enough.

## Verification performed on this port

- `npm ci` at the root installs the lockfile (772 packages), then `npm run build`
  (shared + server + client) passes, including `check:i18n` (6 languages,
  28 namespaces, structure and interpolation parity) and `tsc`; the client build
  also passes with `VITE_DEMO=1`
- `npm test` (server): 19/19 pass
- Migrations applied and re-applied cleanly against a real Postgres 16 (fresh
  schema, second run a no-op, ids recorded as `custom/0001`, `custom/0002`)
- Server booted against that database and exercised end to end: analytics
  (`/overview` with the expected payload shape), receipts, weather location,
  weather forecast (live Open-Meteo), plus upstream `/api/budget/entries` and
  `/api/auth/me` untouched; media rejects an unsigned key without a 500
- With `CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED=false`: the route answers 404 and
  `/api/auth/me` reports `budgetAnalytics` as disabled, other custom routes stay
  up, and the disabled key round-trips through `PUT /api/auth/modules` (200)
  while an unknown key is still rejected (400, control check)
- A 1.6 MB receipt body reaches `/api/ai/extract-receipt` (400 from the route,
  not 413 from the default JSON parser)
- Browser: the analytics page renders in demo mode (nav entry, i18n labels,
  demo-derived numbers, no console errors) — this is the check that catches
  `<Routes>` children violations, which neither `tsc` nor the build can see
- Two-phase dashboard widgets, on the live instance with a cold server cache
  (`docker compose restart server`, real account, headless Chromium against
  `http://127.0.0.1:8200`): the two `instant` requests land at 211 ms and 227 ms
  and the activities card shows four bank ideas with the "more ideas on the way"
  hint; the model phase returns 23.6 s later for the outfits, and the activities
  model call timed out at the 60 s `AI_TIMEOUT_MS`, which left the same ideas on
  screen under the card's "offline ideas" wording. The ideas never blanked in
  either case. Clicking "Other ideas" swapped in four new bank ideas within
  ~170 ms with the hint shown again. On a warm in-process cache both model phases
  answer in 120-189 ms. Screenshots and the request timeline:
  `/tmp/poteto/shot-dashboard-first-paint.webp`,
  `/tmp/poteto/shot-dashboard-after-regenerate.webp`
- Lunchbox AI dialog, same instance. Three generated ideas landed 20-50 s after
  the request, and clicking "Generate again" kept all twelve idea lines on screen
  at 0.8 s, 6.8 s and 27 s while the button showed its spinner
  (`/tmp/poteto/shot-lunchbox-regenerate.webp`)
- What a child's card carries into the ideas, on a debug instance of the same
  code against the live database. With `notes` "loves dinosaurs, hates loud
  noises" and an allergy set on one child, the model answered "Quiet Dino Egg
  Hunt" with cushions; with the same facts cleared, a repeat of the identical
  request was a cache miss (50.4 s) and returned "Rainy Indoor Obstacle Course",
  while the call after it hit the cache in 0.21 s. So the facts reach the prompt
  and the cache key depends on them. The probe values were cleared afterwards and
  all five member rows are back to empty notes and allergies. The card's footnote
  and its link to the family page were checked in the browser, and the deployed
  instance serves the build that was verified (`/tmp/poteto/shot-personal-hint.webp`,
  `/tmp/poteto/shot-family-from-hint.webp`)

### Smart pantry (2026-10-10)

Checked against a **throwaway** Postgres 16 container on `127.0.0.1:5433`
(`docker run postgres:16-alpine`), never the live Neon database, with the server
pinned as the "Local development" snippet above plus
`POSTGRES_PORT=5433 SERVER_PORT=3001` and a test account:

- `npm run build` (shared + server + client, `check:i18n`: 6 languages,
  30 namespaces) and `npm test` (server, 41/41 including the new
  `pantry.custom.test.ts`) pass
- `custom/0004-pantry` applied on a fresh schema (`applied` listed it,
  `alreadyApplied: 0`); the next start reported `applied: []`, `alreadyApplied: 10`
- API, with a real token: item CRUD (`INVALID_ITEM` on a blank name, 404 on an
  unknown id), `filter=low_stock`, `filter=expiring&days=14` (and `days=0` empty),
  the shopping bridge (`created:1`, then `created:0 skipped:1`; the item lands
  unchecked on `/api/shopping`), the stock bridge (`lait` merged into `Lait`,
  1 → 2), the receipt import (2 lines → `created:2`, second call 409, unknown
  receipt 404), and Grocy (400 `NO_GROCY_INTEGRATION` without an integration;
  against a stub `/api/stock` `created:2` then `updated:2`, the zero-amount entry
  dropped, and the hand-kept `Riz` row left untouched because the match also
  requires `source = 'grocy'`)
- Receipt lines: add/edit/delete through the new endpoints, and the receipt total
  stays the scanned amount (2.20 after adding a 1.50 line)
- `expires_on` is validated as a real calendar day, not just four-two-two digits:
  `'2026-13-45'` matches the shape but the DATE column rejects it (SQLSTATE
  22008, reproduced with a direct `INSERT`), which would have surfaced as a 500
  instead of a stored row. `POST /api/pantry` with that value now answers 201 and
  stores `expires_on: null`, while a real date is kept. The Grocy mapper drops the
  same bogus `next_best_before_date` for the same reason
- Browser (Chromium against the Vite dev server on `:5173`, French UI): the
  `/pantry` page renders with its nav entry and four tabs; each tab fetches its
  own filter (Radix mounts only the active panel, so the page never reads the
  uncontrolled `Tabs` state); adding a `Yaourt` row, setting its expiry, deleting
  a row, "Envoyer le stock bas aux courses" (the item appeared on `/shopping`),
  "Approvisionner depuis les courses" (checked item → `Lait` 1 → 2), "Importer
  depuis Grocy" ("2 produits importés depuis Grocy"), the Cook tab (2/2 and 2/3
  coverage, cookable first), the dashboard widget ("À finir bientôt", listed in
  the customiser, its link opening `/pantry`), "Ajouter une ligne" on a receipt
  and "Ajouter au garde-manger" (`Beurre`/`Farine` stored with `source: receipt`),
  and "Charger depuis le garde-manger" in the lunchbox AI dialog (snack → `Yaourt`,
  drink → `Lait`, hint "2 aliments disponibles")
- With `CUSTOM_FEATURE_PANTRY_ENABLED=false`: `/api/pantry` answers 404,
  `/api/auth/me` reports `pantry` in `disabled_modules`, the sidebar/mobile entries
  and the dashboard widget are gone, `/pantry` redirects to `/`, and the rest of
  the app still renders

Follow-up review pass (security + quality) found five issues, all fixed and
re-verified on the same throwaway database:

- **Pool client held across the Grocy fetch** (was a whole-app starvation vector:
  the client was checked out before `safeFetch`, so a slow host pinned one of 20
  pool connections for up to 15 s per hop, and `response.json()` had no time
  bound). The client is now taken after the fetch, around the transaction only.
- **`/api/pantry/import/grocy` is the one pantry route that leaves the server**,
  so it now carries `requireParent` (like upstream's
  `POST /api/integrations/:id/sync`, which fetches the same stored URL with the
  same decrypted key) and its own `integrationRateLimiter` (30 per 15 minutes,
  upstream's outbound budget) instead of riding the 60-per-minute fixed-host one.
  Verified: a child account gets 403; the 31st call in the window gets 429.
- **Body read capped** at 1 MB via `readCappedText`, the fork's own convention.
- **Merge is now an upsert** on the new partial unique indexes rather than
  SELECT-then-INSERT. Verified: two parallel `POST /api/pantry/stock` for the same
  new name produce one row with the summed quantity (`created:1` + `updated:1`),
  and a hand-inserted duplicate is rejected by `idx_custom_pantry_name_owned`.
  The conflict target excludes Grocy rows, which also fixes a latent bug: a receipt
  line for a product the sync already owns used to increment the Grocy row, whose
  next import then overwrote that quantity. Verified: a receipt line for `Pommes`
  added to the hand-kept row (5 → 7) and left the Grocy row (9) alone.
- **Malformed ids answer 404, not 500** (`isUuid` in `lib/validation.custom.ts`):
  `PUT`/`DELETE /api/pantry/:id`, `/api/pantry/import/receipt`, and the three
  receipt line-item routes no longer reach a UUID column with junk (no more
  `22P02` + spurious error log).
- **A duplicate name answers 409 `DUPLICATE_NAME`, not 500** (`isUniqueViolation`
  in the same lib): adding a product the pantry already holds (in any spelling —
  `Pommes` and `  pommes  ` both hit it) or renaming one onto another's folded name
  is an ordinary dialog action, so the client toasts
  `pantry.custom:errors.duplicateName`. Verified 409/409/200 on those three calls.
- **The stock bridge now carries `unit` and `category`** from the shopping item
  (the server already accepted both, so the client half was the gap): a new row
  keeps them (`Farine T65`, 2 `kg`, `Alimentation`) and an existing row's empty
  unit is filled without touching a non-empty one.
- **`daysUntil` moved to `client/src/custom/lib/pantryDates.custom.ts`** (the page
  and the dashboard card had a verbatim copy each), and a failed load no longer
  renders the "nothing here yet" paragraph under its own error line.
- **The Grocy button is hidden for child accounts**, mirroring the server's
  `requireParent` (the budget page's `canEdit` rule).
- **Demo mode renders the pantry**: `mockApi.ts` gained a `pantry` block (seeded
  rows, tabs' filters, the shopping bridge, the receipt import, `DUPLICATE_NAME`
  and `NO_GROCY_INTEGRATION`), and the `demo-prefs` default widget order now lists
  `pantry`. Verified in the browser against `VITE_DEMO=1`: three seeded rows with
  their badges, the Low-stock and Use-it-up tabs, and the dashboard widget with
  `Lait`/`Pommes`. The client build also passes with `VITE_DEMO=1`.

Deployed to production on 2026-10-10 (12:12 UTC) with `deploy/up.sh up -d --build`:

- the server log shows `db.migrations_complete` with
  `applied: ["custom/0004-pantry", "custom/0005-pantry-name-unique"]`,
  `alreadyApplied: 9` — the two migrations landed on the Neon database, and
  `openfamily_schema_migrations` now records both with that timestamp
- `custom_pantry_items` exists there with `idx_custom_pantry_{user,name,expiry}`
  plus the two partial unique indexes (`..._owned`, `..._grocy`), and is empty:
  no family data was touched
- `http://127.0.0.1:8200/health` and `https://family.bsylla.com/health` both
  answer `{"status":"ok"}`, `GET /api/pantry` answers 401 without a token (the
  mount is there, behind auth), and the served bundle
  (`assets/index-B1__LhjB.js`) contains the `pantry.custom` namespace — the new
  client is what the tunnel serves

### AI outing planner (2026-10-10)

Not deployed yet: the code is on this checkout, verified as below.

**OpenStreetMap is the half that had to be measured, not assumed.** The first
query shape — one clause per tag, on nodes and ways separately, 22 sub-queries in
one request — was answered with a **504** by the public instance every time. The
shipped shape groups the values of each OSM key into one `nwr` regex clause (3
sub-queries, measured 200 every time). Two more findings from the same probes:
the public instance answers **406 without a `User-Agent`**, and its load
fluctuates enough that a query in three came back 429/504 during the evening's
testing — hence one retry that asks for a **half-radius** area rather than
retrying the same load (verified against a stub: attempt radii `10000 -> 5000`,
recovered). Live result for the family's coordinates (51.165, 4.1407): **53 real
places in 8.3 s cold**, 17 playgrounds / 13 parks / 11 museums / 7 libraries /
2 zoos / 1 each aquarium-swimming-attraction-viewpoint; the second call for the
same cell costs **0 ms** (cache).

**The route was run end to end** against the live database with a minted token,
through the real router (read-only: it reads `users`, `family_members`,
`ai_settings`):

- `{"party":"kids","duration":"short"}` → `ai=ok`, `placesSource=osm`,
  weather `Pluie modérée 10.2–15.2 °C, 95 %` (95 % rain → the three picks are
  all **indoor**: the three museums 0.2–0.4 km away, each with a one-sentence
  reason naming the children and an opening time the place actually has),
  plus 3 place-less ideas in the reader's language;
- `{"party":"parents","duration":"half_day"}` → same places, and every reason
  says "for two adults" / "without children" — the audience really reaches the
  prompt;
- `{"instant":true}` → `ai=pending` with the nearest places only: the first phase
  needs no model;
- **with Overpass down** (a real 504 during the run) → 200, `placesSource:
  unavailable`, `ai: pending`, `places: []` — the panel then shows the note and
  the ideas, never an error banner.

**The cap, and a 200 that means failure.** `out center N` is applied by Overpass
*before* any distance sort, so `N` decides whether "nearest first" is true. With
`N=200` this household's 10 km returned exactly 200 raw elements of which only
**53 were named** — 75 % of the cap spent on unnamed things the parser drops
anyway. Raised to 400: **78 named places**, same request cost class (measured
200 OK in 5.9 s). Filtering server-side with `["name"]` — the obvious way to stop
wasting the cap — is a trap: Overpass cannot index it and answers **HTTP 200 with
`remark: "runtime error: Query timed out"` and an empty `elements`**. Taken at
face value that reads as "no place here", and the result would have been cached
for 12 h. It is now recognised as a failure (`overpassFailure`), retried once at
half radius, and never cached — the route answers `placesSource: unavailable` and
the panel shows its note instead of "nothing around you". A failed request now
also carries Overpass's own words (tags stripped) into the error message.

**Latency, and why the answer is two-phase.** The model phase took **43 s, 44 s
and 55 s** on this instance's configured model (openai-compatible gateway,
`deepseek-v4.1-flash`) — measured on three calls. That is the same order as the
dashboard widgets' model phase, and it is the reason the panel asks for the
places first (`instant: true`, ~0.3 s warm, 4.6–8.3 s while Overpass is queried)
and shows them with a "the model is ranking these places…" note until the ranking
replaces them. Without that, pressing the button would be a 40-second blank
spinner.

**Client, verified in the browser** (`VITE_DEMO=1`, `/#/planning`): the panel
renders below the week grid, its "no location yet" state, the position button
(`navigator.geolocation`), the form (party / day / length), the ranked answer with
category, distance, window, reason, opening hours, fee and website, the idea list
with indoor/outdoor badges, and **"Add to the planning"** → toast "Added to the
planning" with the button switching to its added state. Both phases were observed
by temporarily slowing the demo's ranked answer (2.5 s): pending note + spinner
over the already-visible places, then the ranked answer with its reasons replacing
them; the temporary delay was reverted. `npm run build` (i18n check + tsc + vite)
passes, `check:i18n` reports 6 languages / 31 namespaces with structure parity,
and `tsx --test test/*.test.ts` is **55/55** (13 new).

**Fixed after the first review pass**, each with the check that showed it:

- the panel no longer shows the previous answer under a form the user has since
  changed — the hook reports the key its `data` belongs to, and the button label
  follows what is on screen ("Suggest outings" again once the answer is hidden);
  verified in the browser by switching the party mid-answer;
- `outingWindow` refuses a window ending at exactly midnight (`24:00` is not a
  time upstream's planner accepts, so that one outing would have 400'd on "add to
  the planning") — it now falls back to the requested window, with a test;
- the AI catch no longer rethrows `AiError`: a provider outage has to degrade to
  the nearest places, which the module's own header comment promises;
- the flags reach the container (see the environment section), so the kill switch
  documented in `.env.example` works on a Docker install too.

### Receipt import feeding the pantry (2026-10-10)

The import now stocks the pantry itself, under the brand-free name the model reads
off the ticket, and queues what it refuses to guess at. Checked against the same
**throwaway** Postgres 16 container on `127.0.0.1:5433` (`docker run
postgres:16-alpine`), never the live Neon database, with the server pinned as the
"Local development" snippet above plus `POSTGRES_PORT=5433 SERVER_PORT=3001`, a
test account, and — for the AI leg — an **OpenAI-compatible stub** on
`127.0.0.1:4010` (`POST /v1/chat/completions` answering a canned draft), stored
through `PUT /api/ai/settings` (`provider: openai`, that base URL). No real model
was called, so the *prompt text* is what was verified, not a model's judgement:

- the request the stub received carries the new instructions
  (`"pantry_item"`, `"pantry_unit"`, `"pantry_stock"`, with `response_format:
  json_object`), and `/api/ai/extract-receipt` returns the three fields per line —
  so the prompt, the schema and `validateReceipt` agree end to end
- `npm test` (server) is **61/61**, including the new `receipt.custom.test.ts` and
  the `splitReceiptLines` cases; `npm run build` (shared + server + client) passes
  with `check:i18n` (6 languages, 31 namespaces)
- `custom/0006-pantry-pending` and `custom/0007-pantry-guard-fingerprint` applied
  on the existing schema (`applied` listed both, `alreadyApplied: 11`); the next
  start reported `applied: []`, `alreadyApplied: 13`
- the guard remap did its job on real rows: the pre-change guard row (36-char
  receipt id) whose receipt still exists came back as its 64-char fingerprint, and
  `/api/budget/receipts` now reports `pantry_imported: true` for it
- import with one stockable line and one fee → `pantry: {created:1, updated:0,
  pending:1}`; the pantry got `Yaourt nature` (1 `pot`) and the queue got
  `FRAIS DE DOSSIER` with the ticket's merchant and date
- `GET /api/pantry/pending` lists it; `POST …/:id/confirm` with
  `{name:"Frais de dossier", category:"Autre"}` merges it into the pantry
  (`created:1`), empties the queue, and stores the family's own category;
  a second confirm is 404, a blank name is 400 `INVALID_ITEM`
- `DELETE /api/pantry/pending/:id` removes a line without writing anything to the
  pantry (verified: no `Vitamine` row appeared); the second delete is 404
- **the bug this pass found**: deleting an imported receipt and scanning the same
  ticket again re-merged its products (`Lait demi-écrémé` 2 → 4), because the
  guard was keyed on the receipt row. With the fingerprint key the same sequence
  answers `pantry: null` and the pantry is untouched; the queue is not refilled
  either (the ticket was already processed)
- with `CUSTOM_FEATURE_PANTRY_ENABLED=false`: `/api/pantry` and
  `/api/pantry/pending` answer 404, `/api/auth/me` reports `pantry` as disabled,
  and the receipt import still answers 201 while writing nothing (`pantry: null`,
  no rows, queue empty)
- browser, French UI against the Vite dev server on `:5173` (real API + the stub
  model): the import dialog reads the scan, the review lists the three lines,
  `Importer (3)` shows the three toasts — "Reçu importé", "Ticket importé dans le
  garde-manger 0 nouveaux, 2 mis à jour" and "1 produits à ranger dans le
  garde-manger" — the pantry page then shows the "1 produits à ranger" banner,
  the review dialog prefills the printed label, the ticket and its category, and
  "Ajouter au garde-manger" (disabled while the name is empty) stores
  `Cotisation mutuelle` under `Santé`; "Ignorer" removes the next line, shows
  "Ligne ignorée" and leaves the pantry unchanged
- the review dialog's category select now also offers the line's own category: it
  comes from the BUDGET list, so `Santé` used to render as an empty field
- demo mode (`VITE_DEMO=1` on `:5199`): the seeded queue shows the banner, the
  dialog adds `Trash bags` (row appears with the `Receipt` source) and ignores the
  second line; importing a receipt from the demo's canned ticket answers
  "Receipt imported into the pantry — 3 new, 0 updated" + "1 products to put away",
  matching the server's split

Follow-up pass (review notes), each with its check:

- **A receipt with no usable line took the guard anyway.** A bill imported as
  `single` with `items: []` (rent, a subscription) recorded the once-per-ticket
  guard while stocking and queueing nothing — so the manual "add to pantry" button
  was hidden, and had it been reachable it would have answered 409 for the lines
  the family adds later. The guard is now inserted only when there is something to
  record (`stock.length + pending.length > 0`). Verified on a fresh database: the
  line-less bill answers `pantry: null`, `pantry_imported: false`, `SELECT count(*)
  FROM custom_pantry_imports` is 0; two lines added by hand afterwards merge
  through `POST /api/pantry/import/receipt` (`created: 2`) and the second press is
  409
- **the realtime refresh of the review banner** was re-checked properly, after a
  first attempt that proved nothing: that run's dev server had silently moved to
  `:5174` (5173 was still held), so the browser was talking to a build without
  `VITE_WS_URL` and the app's socket never opened (the server log showed no
  `ws.connection_open` for the page). With one dev server pinned on `:5173` and
  `VITE_WS_URL=ws://127.0.0.1:3001`, a receipt imported through `fetch` from inside
  the page moved the banner from **0 to 1 without a reload** — the page re-read
  `/api/pantry/pending` off the `shopping` broadcast, which the server sends for
  queued lines even when nothing was merged

### Barcode scanning & promo watchlist (2026-10-10)

- `npm run build` (shared + server + client) passes: on the feature branch, and
  again on the merged `develop` tree — including `check:i18n` (6 languages; 29
  namespaces before the merge, 32 with develop's features) and `tsc`
- Migrations, re-run on a throwaway `postgres:16` after the merge (the renumber and
  the index set changed this SQL, so the earlier run no longer described it), on two
  separate databases:
  - **fresh**: the custom slice applied all eight ids
    (`custom/0001-users-location` … `custom/0008-product-scan`), and a second run
    applied `[]` with `alreadyApplied: 8`
  - **upgrade**: a database carrying `custom/0001`-`0007` (the deployment's shape
    plus develop's features) applied exactly `["custom/0008-product-scan"]`, with
    `alreadyApplied: 7`, `unknown: []`

  `validateRegistry` accepts the merged registry (14 ids, all unique, last one
  `custom/0008-product-scan` — develop already holds `custom/0003` to `custom/0007`,
  which is why ours is 0008). The four product-scan tables end up with their four
  implicit primary keys, the watchlist's UNIQUE and the one index the migration
  creates (`idx_promo_prices_user_barcode`) — the two dropped candidates are absent
- Server exercised end to end against a database carrying the schema, with live
  Open Food Facts
  calls: `GET /api/products/lookup/<ean>` returned a cached row in 63 ms after the
  first lookup, 404 for an unknown barcode, 400 for a malformed one; watchlist
  add/upsert/delete (+404 on a second delete, 404 for a non-uuid id); promo price
  log/history with `best_promo_price` aggregated into the watchlist row (400 on a
  zero price, 404 for a barcode Open Food Facts does not know); shopping-item
  barcode link, bulk map, 404 for another family's item id, 401 unauthenticated
- With `CUSTOM_FEATURE_SCANNER_ENABLED=false`: `/api/products/*` answers 404,
  `/api/auth/me` reports `productScan` disabled, the key round-trips through
  `PUT /api/auth/modules` (200) while an unknown key is still rejected (400), and
  `/api/budget-analytics/overview` stays up
- Browser, on the built client: sidebar shows Scanner + Promos (and the mobile bar
  a Scan tab); a barcode typed into the scanner resolves to the product card
  (name, brand, category, quantity, Nutri-Score badge); "add to the shopping list"
  creates the row, links the barcode and lands on `/shopping` with the barcode
  badge on the row; that badge adds the product to the watchlist without clearing
  a target price already set; the watchlist shows the target, logs a promo price
  and shows it as best promo, expands the price history, and "stop watching"
  removes the row; with the flag off the two nav entries disappear and
  `/scanner` + `/promo-watchlist` both redirect to `/`
- The camera itself was not exercised (headless browser, no device): the failure
  path is what the browser run covered — react-zxing reports the error, the page
  says the camera is unavailable and offers the manual barcode field
- Static demo (`VITE_DEMO=1`, `--mode demo`): builds; `/scanner` answers "product
  not found" and `/promo-watchlist` renders its empty state, with no console
  errors — the lookup hook reads the demo's `ok([])` catch-all as "not found"
  rather than as a product, which is what a demo with no Open Food Facts should say

Follow-up pass (review notes), each with its check:

- **`nutriscore_grade` could break the lookup it was part of.** OFF answers
  `"unknown"` / `"not-applicable"` for a score it never computed, and the column is
  one character: unvalidated, that string failed the INSERT with `22001` and turned
  the lookup — and every watch built on it — into a 502. The grade is now kept only
  when it is one letter A-E. Checked with the real `lookupProduct` against a
  stubbed OFF body (and permanently in `server/test/productScan.custom.test.ts`):
  `unknown`, `not-applicable` and an absent field → `null`, `B` → `b`
- **`name` and `brand` were written unsliced** into `VARCHAR(255)` / `VARCHAR(160)`,
  unlike `category` and `quantity` three lines below: the same `22001` failure mode
  from the same external source. Both are sliced now
- **`ShoppingList`'s scan block was not gated on the module**, so with the feature
  off the button stayed visible and the bulk barcode request still fired (a silent
  404). No other custom component behaved that way. Verified in a browser against a
  stub API: with `productScan` in `disabled_modules`, `/shopping` renders neither
  the button nor the nav entries and issues **zero** `/api/products/*` requests;
  with the module enabled the button, the barcode badge and the badge's watch POST
  all appear. Production fires the bulk request once: the 2 requests seen in dev
  are React StrictMode's double-invoked effect
- **The promo watch was written after the shopping item**, so a watch failure threw
  after the row already existed: the page said the add failed, the dialog stayed
  open, and a retry created a duplicate row. The watch now comes first — it is the
  only step that can fail on the third-party side — and the barcode link stays
  best-effort last. Verified against the stub: watch → item → barcode link, in that
  order; with the watch answering 500, only the watch request is sent, the dialog
  stays open and the page says the add failed. No second Open Food Facts call
  appears on that path: `ensureProduct` finds the row the scan just cached
- **The mapping and the validators had no tests.** `normalizeProduct` and
  `firstCategory` are exported from `lib/openFoodFacts.custom.ts`, and the barcode
  and price rules live in `lib/product.custom.ts`, so
  `server/test/productScan.custom.test.ts` covers them: the grade gate (including
  `UNKNOWN`), the name/brand/category/quantity/image fallbacks, the 8-13 digit
  barcode rule, and the price rule (comma decimals, rounding to cents, zero and
  negatives rejected). 24 tests pass
- **A malformed manual entry reported a failed connection.** `1234` reached the
  route, came back 400, and the page blamed the network. It is now refused locally
  with its own message and its own keys, and without taking the scan lock — checked
  in the browser: `1234` shows "That is not a barcode" with **zero** requests, and
  the next, valid barcode still resolves
- **The row badge reused the scanner's "Watch for promos only" as its tooltip**,
  where that string means the opposite thing. It has its own key
  (`scanner.watchBadgeHint`), and logging a price now refreshes the history pane
  already open on that product instead of leaving it stale. Both checked in the
  browser; the new strings keep `check:i18n` parity across the six locales
- The migration was renumbered to `custom/0008-product-scan` on the merge into
  `develop` (which already holds `custom/0003` to `custom/0007`), and the two
  indexes that duplicated an existing primary key / UNIQUE were dropped while the
  id was still unreleased

### PrijsProfeet promotions in the promo watchlist (2026-10-11)

The watchlist already held what the family saw in a store; a card now also shows
what the shops are promoting on that barcode right now, from PrijsProfeet's free
plan — which is the tier this integrates, and why nothing here needs a paid
subscription:

- **Only `/search` is called, one request per configured country** (`.nl` and
  `.be` are separate hosts and one key works on both), merged and sorted
  cheapest-first. `/match/*` (cross-retailer EAN matching) and `/shelf-prices`
  (the regular price of the whole assortment) are Pro-only and are deliberately
  not called, so a watched product with no running promotion shows no offer at
  all: the free tier carries promotions, not an assortment. That is a property of
  the plan, and the pane's empty state says so rather than pretending otherwise.
- **`CUSTOM_PRIJSPROFEET_API_KEY` is optional.** Without it the per-IP caps apply;
  with it, 150/min. Requests carry an identifying `User-Agent` spelled without
  `bot`/`crawler`/`spider`/`slurp`, which the API answers 403 to when keyless.
- **Attribution is a licence term of the free plan**: every screen showing the
  data credits PrijsProfeet with a link. `promoCredits.via` renders it
  under the rows, one link per country present (`.be` for the Belgian data), and
  only when there is data to credit.
- **A row whose EAN differs from the watched barcode is dropped**: a fuzzy search
  answering another product is the one mistake a barcode-keyed watchlist must not
  make. A chain that publishes no EAN is unverifiable rather than wrong, and
  stays.
- **Deals are never stored.** They change nightly, so the pane fetches them when
  a card is opened, behind a 10-minute in-process cache (`ponytail:` note in
  `lib/prijsprofeet.custom.ts`): no migration, and no write to `custom_products`.
  When the check fails the pane says so and the family's own logged prices still
  render underneath — verified by pointing the pane at a 502.
- Verified live on 2026-10-11 against both hosts with the real free key
  (`partner/usage` reported `plan: free`, 150/min): 12 bare-EAN searches, every
  row matching the EAN or carrying none, none foreign, `promotion_status=active`
  honoured; then the real Express router over HTTP — 401 without a token, 400 on
  a malformed barcode, 200 with a live offer (AH Pistolet wit, `4 pour 0,99 €`,
  `−49%`); then the page in a browser: the deals pane, the `−49%` badge, the
  attribution link to `prijsprofeet.be`, the empty state for a product nobody
  promotes, and the failure state.
- Tests: `labelOf`, `normalizeOffers` (a foreign EAN dropped, a hostile document
  yielding rows rather than exceptions, a `javascript:` URL yielding no link) and
  `configuredCountries` (an unknown country falling back to `be`, duplicates
  asked once) in `server/test/productScan.custom.test.ts`. Client strings land in
  all six locale files; like the rest of the namespace, `en` and `fr` carry real
  text and the other four fall back to English.
- The credit line lives in one component (`components/PrijsProfeetCredit.custom.tsx`)
  so both promo surfaces show it, one link per country on screen, and it renders
  nothing when no data is shown — the licence term, in one place.

### The promo screen's daily list (2026-10-11)

The promo screen used to be the watchlist only. It now opens on *today's deals*,
with the watchlist as its second tab:

- **The day's promotions, filtered server-side.** `/api/products/promos` passes
  the filters (store, category, minimum discount, free text, sort) to
  PrijsProfeet's own `/search`, so `total` and `page` are the API's, not a
  filtered page of a page. `/api/products/promos/filters` merges `/categories`
  (the only source of real category names — the slugs would render as "Groente
  Fruit") with `/filter-stats?promotion_status=active` (the counts the user is
  filtering). Both are free endpoints.
- **Cached for the day, which is what the API's freshness allows.** The upstream
  fetches once per query and the result is kept until the next 07:30 *server*
  time — deliberately late, so PrijsProfeet's night run (webhook ~07:05
  Europe/Amsterdam) always lands before the boundary whatever the container's
  timezone. The barcode pane keeps its 10-minute TTL instead: a card can be
  reopened at any time. Verified: the same query answered in 173 ms and then 5 ms.
- **One country per request.** The browsable list cannot merge two paginated
  streams without faking paging, so it asks one host; the country selector appears
  only when the deployment configures more than one. The watchlist's deals pane
  still merges both, because it deals with a handful of rows. `CUSTOM_PRIJSPROFEET_COUNTRIES`
  stays the single knob, and a country the deployment does not configure is never
  asked (it falls back to the first configured one).
- **Everything the client can send is vetted first** (`promoQueryOf`): the store
  and category values must look like the identifiers the API's own facets produce,
  the page number and size are clamped, and an unknown sort falls back to biggest
  discount. A query nobody's UI could build (`country=fr`, `retailer=../../etc`,
  `page=-1`, `page_size=9999`) comes back as the default page — verified over HTTP.
- Rows, the price/`−X%` layout and the credit line are one shared component each
  for both surfaces (`components/{PromoOfferRow,PrijsProfeetCredit}.custom.tsx`),
  so the two cannot drift.
- Verified live on 2026-10-11 with the real free key: `filters` → 5 623 active
  deals, 7 Belgian stores with counts, 25 named categories; filtered query
  (`colruyt` + `groente-fruit` + `min_savings=25`, price ascending) → 18 rows, the
  first at 0.67 € (−50 %); then the same screen in a browser: 5 605 deals with
  BE + NL configured, store filter narrowing to 1 435, category row giving 143,
  paging `Page 2 / 6`, the country switch moving the list and the facets to the NL
  host (9 600 deals) with the credit link following to `prijsprofeet.nl`, and the
  watchlist tab opening a card whose deals pane renders through the shared row.
- Tests: `normalizePromoPage`, `normalizePromoFilters` (facets with no deals
  dropped, named from the categories list, fullest first), `promoQueryOf` (clamps,
  drops what the API could not produce, never asks an unconfigured country, and
  refuses a prototype key as a sort order or a country) and `labelOf` in
  `server/test/productScan.custom.test.ts`.

### Product pictures, the family's exclusions, and what the review found (2026-10-11)

- **The rows carry the product, not just the chain.** `/search` already answers
  `name`, `brand` and `image_url`; `normalizeOffers` kept only the offer, which
  left a browsable list reading "Albert Heijn · 75 wasbeurten · 8,99 €" with no
  product in it. The three fields are normalized now (`image_url` through the same
  http(s) check as the product link) and `PromoOfferRow` renders picture, name and
  brand behind `showProduct` — on for the daily list, off for the watchlist pane,
  whose card header already names the product. The thumbnail is loaded from the
  chain's own CDN with `referrerPolicy="no-referrer"` (several refuse a
  referrer) and hides itself on error rather than showing a broken-image icon.
- **"Never show me this" is the family's own filter**, because PrijsProfeet has
  none: `custom_promo_exclusions` + `lib/promoExclusions.custom.ts`, applied by
  the server to the page it returns (`hidden` counts what it removed from *this*
  page, since the upstream `total` is what the shops publish). Matching is a
  normalized (lowercase, accents stripped) substring of the name or the brand, so
  a term typed by hand covers variants the row-clicked product name would not; a
  one-letter term is refused, and the same list filters a watched product's deals
  pane — "never show me this" cannot depend on which screen asked. The row's hide
  button stores the product name, the filter bar takes any term, and the chips
  take it back.
- **Two real defects the pass found and fixed**, both in code this same ledger
  entry describes:
    - `DELETE /promo-exclusions/:id` never deleted anything. The SQL said
      `WHERE id = $1 AND user_id = $2` and the parameters were passed
      `[userId, id]`. It answered 404 on a row that plainly existed; the unit
      tests could not see it (they exercise the pure matching, not the SQL), and
      only the live check did. Fixed by passing the parameters in the order the
      statement reads them.
    - `exclusionsOf` selected `term` alone, so the list the client renders had no
      `id` to delete by. It returns the rows now (`termsOf` maps them to the
      comparable strings for the matching path).
- **Prototype keys are not values.** `sort in PROMO_SORTS` and `country in HOSTS`
  walk the prototype chain, so `sort=constructor` passed the whitelist and
  stringified a function into `sort_by` (the API rejects that: a 502 for a query
  no UI can build), and `CUSTOM_PRIJSPROFEET_COUNTRIES=constructor` would have
  produced a garbage host URL. Both are `Object.hasOwn` now, with tests.
- **The two upstream counts do not agree, and that is upstream's.** For the same
  `promotion_status=active`, `/search` answers `total` 5605 where `/filter-stats`
  answers 5623 (checked directly, curl, both hosts: 18 promotions exist in the
  facet count that the list will not page to). The fork relays each endpoint's own
  number rather than inventing one; the filter panel can therefore show a count a
  hair above what the list reaches.
- Verified on 2026-10-11, live, in this order:
    - **Migrations**: `custom/0009-promo-exclusions` applied to the existing
      database (server log: `applied: ["custom/0009-promo-exclusions"]`), then a
      second boot with `applied: []` and `alreadyApplied: 15`; and a fresh
      `postgres:16` container where the whole list applied, `custom/0009`
      included.
    - **The exclusions over HTTP against that database**: add `"  Café   TEST "`
      → stored `cafe test`; adding it twice → the same row; a one-letter term →
      400; the list → rows carrying their id; two terms live → the page of 24
      came back as 20 with `hidden: 4` and no excluded brand left on it; delete →
      200, delete again → 404; then the list empty, `hidden: 0`, and
      `select count(*)` on the table back to 0 — the verification left no row
      behind.
    - **The screen in a browser**, against the real server and the real API: 24
      rows with 24 thumbnails, each row naming its product and brand ("Omo Poeder
      wasmiddel wit · Omo"), "5605 deals today"; the row's hide button → 23 rows
      and `· 1 hidden by your exclusions` with a chip for the product; typing
      `omo` → 20 rows, `· 4 hidden by your exclusions`, no Omo left; both chips
      removed → back to 24 rows and no note.
    - **The advisory about unclickable tabs**: the hit-test says the tab bar is
      covered by the app's sticky header *at a scrolled offset* (the point
      returned the header container, not the tab) — at the top of the page nothing
      overlays it, and a real pointer click on the tab switches it. The earlier
      timeouts were that scroll position (plus an open Select popup swallowing the
      click), not a defect in the tab bar.
    - **The demo build** (`VITE_DEMO=true`), whose mock API has no handler for the
      promo routes: `/promo-watchlist` used to reach `page.offers.map` on the
      array the fallback returns, i.e. a TypeError on the tab. `useDailyPromos`
      now treats a response that is not a page as "could not load", and the demo
      renders both tabs, the filter bar and "Could not load today's deals." with
      zero page errors. The demo deliberately serves no promo fixtures, as it does
      for the scanner: inventing promotions would put made-up prices behind a real
      company's credit line.
- Server suite: 77 tests pass, 16 of them the product-scan/promo file; `tsc`
  clean on the server, and `npm run build` on the client (i18n parity + `tsc` +
  Vite).

### Family dashboard (2026-10-11)

> **Removed 2026-10-14.** The page, its route and its two nav entries, its module
> key and `CUSTOM_FEATURE_FAMILY_DASHBOARD_ENABLED`, the phase engine
> (`lib/familyPhase.custom.ts`), the Home Assistant device proxy under
> `/api/custom/ha` with the `useHomeAssistant` hook and
> `homeAssistantDevices.custom.test.ts`, and its locale keys are all gone: the
> board is the wall display now, and it reads the household's own lists plus
> Open-Meteo for the family's saved city. Everything below, in this section and in
> "The tablet becomes a kiosk", is the record of what the page was and why it was
> built that way, not the state of the tree.

A full-screen, chrome-less page for a wall tablet (`/family-dashboard`): a
time-of-day phase (morning 06–09, day 09–17, evening 17–22, night 22–06) decides
which widgets are on screen, the phase is cycleable by swiping the content or
tapping the top bar's badge, and the family's Home Assistant is driven both ways
through `/api/custom/ha`. **No upstream file was touched by this feature.**

> The phase engine, the route and the HA proxy described here are unchanged, but
> the **layout** was rebuilt later the same day — see "The tablet becomes a kiosk"
> below, which is what the file looks like now. The phase-to-widget mapping in the
> verification list further down is historical.

- **Chrome-less without an upstream edit.** The route lives in
  `customRoutes` like every other custom page, i.e. inside upstream's `<Layout>`,
  and the page covers the chrome with a `fixed inset-0 z-[60]` layer — above
  Layout's own highest fixed element (`z-50`). Upstream's Kiosk instead renders
  outside `<Layout>`, which would have cost a marked edit in `client/src/App.tsx`;
  that edit was deliberately not taken.
- **The HA credentials are reused, not re-configured.** The proxy reads the
  family's existing `integrations` row (`family_id` + `type = 'homeassistant'`,
  unique through upstream's `ON CONFLICT (family_id, type)` upsert), decrypts
  `encrypted_credentials` and calls HA through `safeFetch` with the same
  `Authorization: Bearer` header and 15 s timeout as
  `services/integrations/homeassistant.ts`. No new env var, no new table.
- **The client reaches HA only through the proxy.** `GET /states` returns the
  whitelisted domains (`light`, `switch`, `climate`, `media_player`, `scene`,
  `input_boolean`, `cover`, `fan`, `lock`, `binary_sensor`, `camera`) with a
  trimmed attribute set; `POST /services/:domain/:service` forwards a service call
  verbatim, parent-only, with the domain whitelist and the entity/domain match
  enforced in `lib/homeAssistantDevices.custom.ts`.
- **The quick-toggle grid only lists domains that really take
  `turn_on`/`turn_off`** (`light`, `switch`, `input_boolean`, `fan`,
  `media_player`, `climate`). `lock` and `cover` are in the read whitelist but take
  `lock`/`unlock` and `open_cover`/`close_cover`; the lock appears in the Security
  card instead, amber while `unlocked` (a lock reads `locked`/`unlocked`, so the
  generic `state === 'on'` check would have kept every lock green), and a cover has
  no place in a v1 toggle grid.
- **A service HA rejects is not an outage.** HA answering 4xx (a service that
  domain does not implement, an entity that will not take it) comes back as
  `400 homeassistant.service_rejected`; only HA 5xx and an unreachable host become
  `502 homeassistant.unreachable`/`service_failed`. The client maps only the latter
  to its offline banner, so one dead tile can never disable the whole screen. HA's
  own 401/403 folds into that 400 on purpose: forwarding it would make the client's
  API layer read an expired OpenFamily session and log the family out.
- **Entity name heuristics, by design.** The coffee toggle matches
  "café"/"cafe"/"coffee", the dinner scene "dîner"/"diner"/"dinner", the nightlight
  "nuit"/"nightlight"/"veilleuse". A household whose entities are named differently
  simply does not get those tiles — no config UI, no env var.
- **Degradations are explicit.** No HA integration → full-screen setup banner
  linking to `/integrations`, no HA cards. HA unreachable → sticky toast with a
  retry button, every HA toggle disabled, and the read-only HA cards (security
  pills, light count) hidden rather than left showing yesterday's state. No AI
  model or no saved city → the morning clothing card falls back to "Vérifiez la
  météo".

What was exercised, on a throwaway Postgres 16 and a stub Home Assistant:

- `npm test` (server): **31/31**, the 12 new ones in
  `homeAssistantDevices.custom.test.ts`. `tsc` clean on the server and the client;
  `npm run build` at the root passes, `check:i18n` included (6 languages). The
  client was built and driven in Chromium at 900×1600 portrait.
- Through the HTTP layer: `/states` filters the non-whitelisted domains and trims
  the attributes; `POST /services/...` forwards the body verbatim for a single
  entity, a list and a scene, and rejects a non-whitelisted domain, a cross-domain
  target, a missing `entity_id` and a service name carrying a path traversal (400
  each); no integration → 404 `homeassistant.integration_not_found`; unreachable HA
  → 502 `homeassistant.unreachable` on both endpoints; no token → 401. With
  `CUSTOM_FEATURE_FAMILY_DASHBOARD_ENABLED=false` the route answers 404 and
  `/api/auth/me` reports `familyDashboard` as disabled.
- In the browser, against the stub HA: every phase renders (morning weather +
  clothing fallback + coffee toggle, day agenda/devices/security/shopping, evening
  dinner/dimmer/bedtime, night clock + nightlight); a tile tap reached HA as
  `light.turn_off`, the dimmer as `light.turn_on` with `brightness_pct`, the scene
  button as `scene.turn_on`, "Tout éteindre" as `light.turn_off` +
  `switch.turn_off`; the badge tap and a 60 px swipe both cycle the phase and wrap;
  the viewport meta is injected; `navigator.wakeLock` is requested on mount; the
  night clock dims to `opacity-30` with the bottom bar at `opacity-50` after five
  idle minutes and any touch restores both; stopping HA shows the offline toast
  with the HA buttons disabled and the read-only HA cards hidden, and restarting it
  clears the toast on retry; zero console errors and zero horizontal overflow in
  every phase; every interactive element measures ≥ 56 px.
- **The lock/cover defect was reproduced before it was fixed.** A stub HA
  implementing HA's real per-domain service table showed that tapping a `lock` tile
  sent `lock.turn_on`, HA answered 400, the proxy turned that into a 502 and the
  client flashed "Home Assistant hors ligne" over the whole screen while disabling
  two controls. After the fix the grid no longer lists lock/cover, every remaining
  tile sends a service its domain implements (verified for switch / light / climate
  / media_player with no banner at any moment), `lock.turn_on` answers
  `400 homeassistant.service_rejected` instead of 502, and the Security card's lock
  dot goes amber on `unlocked` while a closed window stays green.

### The tablet becomes a kiosk (2026-10-11)

`FamilyDashboard.custom.tsx` was rebuilt as a kiosk: upstream `/kiosk`'s panel
vocabulary (agenda, meals, tasks, shopping) plus the fork's own feeds (kids'
activities, the day's promos, the pantry), on one screen that never scrolls.
Same file, same route, same phase engine; **no upstream file was touched and no
new namespace was added.**

- **The phase keeps its job, the layout stops scrolling.** A phase used to be a
  column of cards that scrolled; it is now a stack of panels that fills the
  viewport — `main` is `overflow-hidden`, every panel is `min-h-0` with a clipped
  body, and every list is capped (`CAP` in the file: 5 agenda rows, 4 tasks, 4
  promos, …). The ceiling is deliberate: a wall display nobody touches must not
  move, and a panel that has more to say truncates instead of pushing rows off
  screen. The trade-off is that a very short viewport clips rather than scrolls,
  which is what the 9.7" portrait target wants.
- **The panels, per phase.** Morning: next departure with its countdown, the
  children's outfits when the model wrote them, agenda, activities, tasks, coffee
  toggle. Day: meals, agenda + activities, promos + pantry, tasks + shopping.
  Evening: dinner, dinner scene, dimmer, bedtimes, tomorrow. Night: unchanged
  (dim clock, tomorrow's first appointment, nightlight).
- **Anything Home Assistant needs room for moved into the House sheet** (bottom
  bar): the toggle grid, the security pills and the scenes, in one scrolling
  bottom sheet. Nothing was dropped — a grid of device tiles is simply not
  something a fixed screen can hold alongside the household's day.
- **Labels come from namespaces that already exist** (`kiosk:meals`,
  `kiosk:tasks`, `activities.custom:titleToday`, `scan.custom:dailyPromos.tab`,
  `pantry.custom:dashboard.*`) rather than from new keys. Three keys were added to
  `dashboard.custom` (`actions.house`, `widgets.noPromos`, `widgets.saved`) and
  six stopped being used and were deleted (`widgets.departure`, `noDeparture`,
  `noSecurity`, `meals`, `tasks_today`, `noActivities`) — the file shrank, which
  matters: the main bundle sits ~500 bytes under workbox's 2 MiB precache limit
  (see "Known gaps").
- **The activities panel is absent, not empty, on a school day** — the contract
  the dashboard card already had: `homeDayIdeas()` returns null unless the server
  says the day is a home day and there are ideas, so a school day never shows a
  wall-sized "what shall we do today?".
- **Two defects found while porting.** The agenda asked the appointments route for
  `end_date=YYYY-MM-DD`, and that route compares `start_time <= end_date` as a
  string — every appointment after midnight was therefore invisible (the route's
  own Kiosk caller passes `T23:59:59`). `dayAppointments()` now names both ends of
  the day. The top bar's weather label read `weather.custom:mostlyClear` instead of
  `conditions.mostlyClear`, so it printed the raw slug.

Verified in the built client, driven in Chromium at 900×1600 portrait, in demo
mode with **throwaway fixtures** for the promos, activities, weather, location and
HA endpoints (added to `client/src/demo/mockApi.ts`, reverted afterwards — the
demo deliberately serves none of them, see the promo section above):

- Every phase renders without a page scroll: `scrollingElement.scrollHeight` equals
  `innerHeight` at 1600 px in morning, day, evening and night, before and after the
  activity/promo/pantry panels fill in; zero console errors; zero raw i18n keys in
  French or English.
- Day phase on screen: meals strip, agenda (with the fixture appointment — the bug
  above), three activity rows with their category, duration and child dots, four
  promo rows with price and discount, the pantry's two expiring items, and the
  capped task/shopping lists.
- Tap-to-complete: tapping a task hid it and showed the shared undo toast; the
  undo button restored it. The toast is one queue for tasks and shopping together.
- The House sheet rendered the toggle grid (ON/OFF tiles), the security pills
  (amber for the `unlocked` lock, green for the closed door) and both scenes.
- `npm run build` passes: `check:i18n` (6 languages), `tsc`, Vite; the dashboard
  stays a lazy chunk (35.2 kB) and the eager bundle came out 480 bytes *smaller* than
  the branch base it was measured against (`6ce1c4e`: 2,096.28 kB vs 2,096.76 kB —
  that base was itself within 500 bytes of workbox's 2 MiB precache limit, which is
  why keys were traded rather than added; the 2026-10-11 merged-tree build measured
  2,009.33 kB (see "Known gaps").

### The two AI surfaces read the pantry (2026-10-11)

The magic input now knows what is at home, and the meal suggester prefers what is
already there. Three files of upstream's AI layer carry the change, all under
`FORK-START/END: pantry-ai` (see the tables above); the write path is a new route
in the fork's own pantry router.

- **Two endpoints, because the note says two different things.** `POST
  /api/pantry/upsert` is the "we have some" direction: one item merged by folded
  name with the quantity SET, not added up (the note names a total — "j'ai acheté
  2 kg de riz" after 1 kg at home is 3 kg), on the same partial unique index the
  other bridges use (`(user_id, name_key) WHERE source <> 'grocy'`), so a Grocy
  row is out of its reach and a hand-typed 'Riz' becomes its own row.
  `POST /api/pantry/missing` is the "we have none left" direction, and it is not
  an upsert with 0: a product that is not at home does not belong in a list of
  what is at home. In one transaction the row goes and the product is ENSURED on
  the upstream shopping list, unchecked, so the note leaves something actionable
  behind. Second press: nothing removed, nothing duplicated (the check folds the
  names in JS, like `POST /shopping-list`, because the merge key is not a column
  of upstream's table). A product the family never tracked is simply queued —
  confirmed by the owner: "if it wasn't on the pantry, no need to add it there,
  just add it on the shopping list".
- **The routing rules, not just the types.** The first cut of this shipped the
  new `pantry_item` type without saying who owns what, and the model started
  answering "il faut du café" with a pantry proposal — the shopping list stopped
  filling up. The prompt now states it twice: what is to be BOUGHT is always a
  `shopping_item`, even when the note says there is none left; and a `pantry_item`
  at 0 ("we just finished it") must not be doubled with a `shopping_item` for the
  same product, since `/missing` queues it itself. An ordinary shopping item is
  still proposed for a product absent from both lists.
- **`null` vs `[]` is the whole switch.** Both prompt builders take the stock as a
  fourth argument: `null` means the feature is off and the prompt is byte for byte
  the one upstream built; an empty array means "switched on, nothing at home",
  which is a different statement and the one "j'ai acheté du riz" has to land in.
  A single boolean would have conflated them.
- **The route, not the validator, enforces the flag.** With the pantry off,
  `loadPantryForAi` answers `null`, the prompt loses its pantry half, and the
  parse route drops any `pantry_item` the model returns anyway (the JSON schema's
  enum is a module constant and always lists the type). Without that filter the
  client would render a proposal whose endpoint is not mounted.
- **Recipes carry their ingredients only when they can be matched.** The
  suggest-meals route always selects `ingredients` (same row it already reads),
  but the prompt only appends them when the pantry is on. The JSONB column is
  normalised to strings on read: a hand-typed recipe stores lines, and an old
  Tandoor/Mealie import had left objects behind (`core/0006-recipe-text-lines`).
- **The client label lives in the fork's namespace.** The card reads
  `pantry.custom:magic.types.pantry_item` instead of a `types.pantry_item` key in
  upstream's `ai.json` — no upstream locale file is touched. The shelf is shown
  only when it is not `pantry` (the default), which would otherwise repeat the
  label's own word.
- **Confirmed, not inferred.** The family confirms the proposal before it lands:
  the values written are the ones the card showed.

What was exercised, on a throwaway Postgres 16 and an Ollama-shaped stub that
records every prompt it is asked to complete (no model involved):

- `npm test` (server): **96/96**, the 7 new ones in `aiPantry.custom.test.ts`.
  `tsc` clean on the server and the client; `check:i18n` passes for the 6
  languages; `scripts/smoke-api.sh` green end to end against the same instance.
- Through the HTTP layer, with the pantry on: the parse call's system prompt
  carried `- Riz : 1 kg` and the pantry type line, and the stub's `pantry_item`
  answer came back validated (`quantity` 2 → 3 kept, unit, category, shelf); the
  upsert of that same proposal hit the existing row (`id` unchanged) and left the
  quantity at 3 — not 4, so the merge is a SET, not an addition — and a
  `source='grocy'` row of the same folded name kept its own 7 kg while a manual
  row was created beside it; the suggest-meals prompt listed the stock and each
  recipe's ingredients, and a removed product was no longer listed. `POST
  /api/pantry/missing` on a tracked `Lait` answered `{removed: true, shopping:
  'added'}` — the row gone, exactly one unchecked `Lait` (folded, so "lait " hits
  the same row) on the shopping list; the second call answered `{removed: false,
  shopping: 'already'}` with the list unchanged; an untracked `Yaourt` answered
  `{removed: false, shopping: 'added'}` and created no pantry row; a
  `source='grocy'` row was left at 7 kg while its product still reached the
  shopping list.
- The owner's regression was reproduced and fixed at its cause. With the pantry
  on, the first cut's prompt sent "things to buy" to the new pantry type, so
  notes that used to fill the shopping list stopped filling it. The fix is the
  two routing rules (asserted in `aiPantry.custom.test.ts` and visible in the
  recorded prompt), plus `/missing` as the destination of a "we're out" note —
  after which the note ends where the owner asked: the pantry row gone, the
  product on the shopping list.
- Through the HTTP layer, with `CUSTOM_FEATURE_PANTRY_ENABLED=false`: the parse
  prompt lost both the pantry list and the pantry type, a pantry proposal the stub
  still returned was dropped, the meals prompt mentioned neither the stock nor the
  ingredients, and both `POST /api/pantry/upsert` and `POST /api/pantry/missing`
  answered 404.
- In Chromium, against the running client on the dev server (French UI, real
  login): "J'ai acheté 2 kg de riz et il faut du café" rendered a `Riz` card
  labelled "Garde-manger · 3 kg" and a `Café` card, the confirm toast read
  "2 élément(s) ajouté(s)", and the pantry page then showed `Riz — Qté 3 kg`;
  "Proposer un menu ✨" on `/meal-planning` returned a suggestion and the prompt it
  sent carried `Garde-manger (ce que la famille a chez elle) : - Riz : 3 kg` and
  each recipe's ingredients. With a tracked `Lait` at 2 L, "On a fini le lait"
  rendered "Garde-manger · Réfrigérateur · 0 L", and after confirming the pantry
  page read "Rien ici pour l'instant." while the shopping list read "1 article
  restant" with an unchecked `Lait — Alimentation — Qté: 1 L`.

### Landscape mobile tab-bar collapse (2026-10-11)

The toggle is available only in landscape below 1024px. Its local `aria-expanded`
state drives CSS that hides the fixed bottom tab bar and reduces `main.pb-28` to
1rem plus the safe-area inset when collapsed. Portrait, desktop, and sidebar
behavior remain unchanged.

### The weather card keeps its dialog through a refetch (2026-10-12)

Client-only, inside `client/src/custom/`; no upstream file touched. The dashboard's
weather card renders `WeatherDetailsDialog` inside its success branch, and the two
places under it that could blank that branch were both wrong. `useCachedQuery`'s
catch discarded the payload it already had, and `useSavedLocation` reported
`loading: true` on every refetch while it still held the city. The saved city is
refetched on every `family` WebSocket frame, so any saved-city change — including
another member's — dropped the card to its skeleton and unmounted the reader's open
dialog, which came back only when the response landed. A refetch answered with an
error was worse: the dialog stayed closed and the card claimed no city while one
was saved.

Reproduced in Chromium at 390x844 against the dev client on the dev server, with
the weather endpoints stubbed (the demo build hides the widget and has no weather
backend) and a stand-in `WebSocket` so a `family` frame could be pushed on demand.
Stub responses were delayed 400-700 ms so the transient render was observable:

- before: 250 ms after the frame the card was its skeleton and `[role=dialog]`
  counted 0; at +950 ms the dialog was back — the blink the report describes;
- after: 50 samples at 50 ms across the refetch pinned the dialog count at 1, with
  the clothing query still refetching on schedule (2 → 4 calls);
- with the refetch answered 503: before, the dialog closed and the card fell to its
  "no city" empty state; after, both the dialog and the city stayed on screen.

`loading` now means "nothing to show yet", the contract `useWidgetPhases` keeps in
the same file, and a failed refetch keeps the last payload. `npx tsc --noEmit` is
clean. Three candidates were tested in the browser and ruled out: nothing behind a
modal is reachable (no click-through holes over a full-viewport grid at 390x844 and
834x1112, so a tap there can only dismiss), the toast viewport's `z-[100]` does not
paint above a dialog's `z-50`, and a shared session-position change re-keys the card
without closing the dialog. The other custom dialog hosts (lunchboxes, pantry,
scanner, receipts, promo watchlist) keep their dialogs outside any refetch-driven
branch; the scanner's and the receipts section's only ways to drop a dialog are
user actions or a genuinely empty list.

### Dialogs no longer close on a tap outside them (2026-10-12)

Every dialog used to close on a completed tap anywhere outside its own box, and the
page's chrome shows through the scrim, so on a phone or tablet the tap did nothing
but dismiss the dialog: it read as closing itself whenever its reader reached for
something else. Radix defers that dismissal to a `click`
(`deferPointerDownOutside` in `@radix-ui/react-dismissable-layer@1.1.13`, with
`react-dialog@1.1.17`), which is also why the same gesture differed by device: a
wheel scroll over the scrim emits no `pointerdown` and never dismissed.

Measured in Chromium with touch input against the demo client at 390x844 and
834x1112, on `/tasks`, `/lunchboxes`, `/budget` and `/integrations`:

- before: a tap on the scrim above the sheet closed the dialog (dialogs 1 → 0). On
  the tablet the dialog is a centred 576x875 box in an 834x1112 viewport, so the
  nav, the sidebar and the header all sit under the scrim, and every tap aimed at
  them closed the dialog and did nothing else;
- a 120 px and a 300 px touch drag starting on the scrim left it open (no `click`
  follows a drag), and a wheel scroll over the same point left it open too, so the
  trigger is the completed tap and not a gesture;
- after the change the same scrim tap leaves the dialog open on every surface above,
  its own X still closes it (1 → 0), Escape still closes it, and with the AI dialog
  stacked over the lunchbox form a scrim tap leaves both open while the top X closes
  only the top one;
- the budget limits sheet and the Integrations connect modal — their own backdrops,
  not the shared primitive — keep their X and no longer close on the backdrop either.

`npx tsc --noEmit` is clean. Left alone at the time: the family dashboard's house
sheet (`custom/pages/FamilyDashboard.custom.tsx`), whose backdrop was its only way
out, so removing that dismissal needed a close control of its own; that page was
removed on 2026-10-14 (see its section), so the exception went with it.

### The board takes the family city, and the family dashboard goes (2026-10-14)

- **The board's city is the family's now.** `Board.custom.tsx` lost the whole
  per-device city: the `openfamily.boardSettings` reader with its
  `openfamily.kioskSettings` fallback, its writer, the geocoding search and the
  city overlay. It reads `useSavedLocation()` (`GET /api/weather/location`)
  instead — the same coordinate pair the dashboard widgets use, stored on the
  family owner's row. `location` is memoized on the saved city's values, so the
  30-minute Open-Meteo effect re-runs only when the family changes its city, and
  a change reaches an open board over the existing `family` WebSocket event.
  Both tiles gained a "no city set / set it in Settings" state (keys
  `weather.noCity` and `weather.noCityHint`, six locales). With no city the board
  no longer offers a picker of its own: the setting belongs to the family and is
  written from Settings by a parent, which is the only write path.
- **`/family-dashboard` is removed** with everything that existed only for it;
  its section above lists the page, route, nav entries, module key and flag, the
  Home Assistant device proxy and its hook and test, the phase engine and the
  locale keys that went.

Verified on a throwaway `postgres:16` container with the built client served by
the Express server itself (`SERVE_CLIENT_DIR`, so `/api` and `/ws` share one
origin). Two traps that shaped the run: the invoking shell exports the live
deployment's variables (`POSTGRES_*`, `SMTP_*`, `VAPID_*`, `CUSTOM_MINIO_*`, a
production `CORS_ORIGINS`), which the first launch of this stack inherited and
acted on — it reached the real Scaleway bucket through `ensureBucket` before
`env -i` closed the environment to thirteen variables — and Vite's dev proxy
forwards `/api` only, not `/ws`, which made the board look like it ignored the
`family` event until the check moved to the server-served build.

- `npm test` (server): **99/99**, `tsc` clean. Client: `npm run build` passes
  `check:i18n` (6 languages), `tsc` and Vite; main bundle 2,018.32 kB against
  workbox's 2 MiB per-file precache limit, board chunk 17.37 kB (lazy).
- In Chromium, against that stack: the board shows the saved city's name and
  calls both Open-Meteo endpoints at the family's coordinates (51.16509 for the
  Sint-Niklaas the geocoder stores as its French name, Saint-Nicolas);
  `openfamily.boardSettings` and `openfamily.kioskSettings` set to Paris and Lyon
  change nothing (same city, same 51.16509); and a `PUT /api/weather/location`
  reaches the open board with no reload — the recorded WebSocket frames are
  `{"type":"auth","success":true}` and, after the PUT,
  `{"type":"update","entity":"family","action":"updated"}`, followed by the
  weather and air refetches at the new coordinates.
- Removal, same stack: `/family-dashboard` lands on `/`, no
  `a[href="/family-dashboard"]` exists in the shell, `GET /api/custom/ha/states`
  answers 404 and `/api/auth/me` reports no `familyDashboard` module key. The
  dashboard itself still renders its custom widgets (the pantry card's
  `pantry.custom:dashboard.*` labels were deliberately kept — see "Translations").
- **A CSP gap in the server-served mode was found and closed.** With
  `SERVE_CLIENT_DIR` the SPA carries upstream's `spaContentSecurityPolicy`, whose
  `connect-src` lists the two Open-Meteo hosts upstream's Kiosk fetches but not
  `air-quality-api.open-meteo.com`, which only the board's air tile calls. Before
  the fix that tile read "Qualité de l'air indisponible" while a page-level probe
  returned `Failed to fetch` for the air host and HTTP 200 for
  `api.open-meteo.com`; after adding the host (the marker-wrapped line in
  "Modifications to upstream files") the tile renders `AQI 36` with its band.
  Deployments whose nginx serves the client send no CSP and were never affected.
  The service worker replays the cached `index.html` response headers, so the
  first check after the fix still failed until its registration and caches were
  dropped.
- The static demo has no backend to hold a family city, so the board's weather
  and air tiles show their no-city state there; the board's row above no longer
  claims the demo works.
