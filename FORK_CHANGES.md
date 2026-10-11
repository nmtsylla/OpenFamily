# Fork Changes

Ledger of every place this fork (`nmtsylla/OpenFamily`) diverges from upstream
(`NexaFlowFrance/OpenFamily`). Rules for making changes: `AGENTS.md`.

- Upstream remote: `upstream` → `https://github.com/NexaFlowFrance/OpenFamily.git`
- `origin` → `git@github.com:nmtsylla/OpenFamily.git` (this fork)
- Baseline of this ledger: `upstream/main` @ `835f9eb` (2026-10-10), **0 commits of drift**
- `main` carries the fork (upstream + custom features), per `AGENTS.md`; upstream is
  merged in, never rebased onto.

This repository is a **re-port** of the earlier fork work that had grown into the
upstream tree (that tree is kept for reference at `/home/bsylla/OpenFamily-budget`,
where the same features were spread over 50 upstream files and ~9000 inserted
lines). Here they live in `custom/` locations with a single hook per upstream file.

Measured divergence of this port, recorded pass by pass: **35 upstream files
touched, 24 modified lines**, **1517 inserted lines** after the AI outing planner
(1504 before it; the chain reads 1224 → 1479 → 1504 → +13 for
`client/src/pages/Planning.tsx`). The insertion count is the noisy part of that
tally — every pass adds to the same shared files without re-measuring the absolute
— so treat it as a floor: a fresh `git diff --numstat upstream/main` today, on the
basis those figures used (excluding `package-lock.json`, 396 lines, and
`DOCUMENTATION.md`, 106), reads 1509. The receipt→pantry pass below contributed
**158** of them: `client/src/demo/mockApi.ts` +102,
`server/src/migrations/registry.ts` +48, `.env.example` +8 — all fork-owned lines
inside files upstream owns, so the 24 modified upstream-authored lines are
unchanged. Every touched upstream file carries `FORK-START/END` markers except the
three that cannot hold comments (`.env.example`, `package-lock.json`,
`server/package.json` — each explained below).

## Custom features (new files only)

| Feature | Files | Flag |
|---------|-------|------|
| Weather, clothing suggestions, screen-free activities | `server/src/custom/weather/*.custom.ts`, `server/src/custom/routes/weather.custom.ts`, `server/src/custom/lib/dayContext.custom.ts`, `server/src/custom/ai/{activityBank,widgets}.custom.ts`, `server/src/custom/routes/aiDashboard.custom.ts`, `client/src/custom/components/{WeatherClothingCard,WeatherDetailsDialog,WeatherLocation,KidsActivitiesCard}.custom.tsx`, `client/src/custom/hooks/useWeather.custom.ts`, `client/src/custom/lib/{weatherCode,dayContextLabel}.custom.ts` | `CUSTOM_FEATURE_WEATHER_ENABLED`, `CUSTOM_FEATURE_AI_WIDGETS_ENABLED` |
| Object storage for images (S3-compatible) | `server/src/custom/lib/{storage,media,storage-errors}.custom.ts`, `server/src/custom/middleware/media.custom.ts`, `server/src/custom/routes/media.custom.ts` | `CUSTOM_FEATURE_MEDIA_ENABLED` |
| Receipt / bill import with line detail | `server/src/custom/routes/budgetReceipts.custom.ts`, `server/src/custom/ai/receipt.custom.ts`, `client/src/custom/components/{ReceiptImport,BudgetReceipts}.custom.tsx` | `CUSTOM_FEATURE_BUDGET_RECEIPTS_ENABLED` |
| Budget analytics page | `server/src/custom/lib/budgetAnalytics.custom.ts`, `server/src/custom/routes/budgetAnalytics.custom.ts`, `client/src/custom/pages/BudgetAnalytics.custom.tsx` | `CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED` |
| Lunchboxes + weekly nutritional read (ported from KeurTonux) | `server/src/custom/lib/lunchbox.custom.ts`, `server/src/custom/lib/aiSettings.custom.ts`, `server/src/custom/lib/promptLanguage.custom.ts`, `server/src/custom/ai/{lunchbox,nutrition}.custom.ts`, `server/src/custom/routes/lunchbox.custom.ts`, `client/src/custom/pages/Lunchboxes.custom.tsx`, `client/src/custom/components/{LunchboxAiDialog,NutritionAnalysisDialog}.custom.tsx` | `CUSTOM_FEATURE_LUNCHBOX_ENABLED` |
| Smart pantry — what the household has at home (locations, expiry, low stock), bridging the shopping list both ways, Grocy stock in, and the receipt import feeding it: the obviously stockable lines merge in under the brand-free name the AI read off the ticket, the rest wait in a review queue on the page; lunchbox AI and a "cook from what you have" tab out | `server/src/custom/lib/pantry.custom.ts`, `server/src/custom/lib/pantryMerge.custom.ts`, `server/src/custom/lib/validation.custom.ts`, `server/src/custom/routes/pantry.custom.ts`, `client/src/custom/pages/Pantry.custom.tsx`, `client/src/custom/components/PantryExpiryCard.custom.tsx`, `client/src/custom/lib/pantryMatch.custom.ts` | `CUSTOM_FEATURE_PANTRY_ENABLED` |
| AI outing planner on the Planning page — real places around the family (OpenStreetMap/Overpass) ranked by the family's own model for the day, the weather, the people coming (whole family / with the kids / parents only) and what the children's cards say, plus place-less activity ideas; the chosen outing is added to the planning through upstream's own `/api/planning` | `server/src/custom/lib/places.custom.ts`, `server/src/custom/lib/{location,kids}.custom.ts` (extracted from the dashboard route when this needed the same answers), `server/src/custom/ai/outings.custom.ts`, `server/src/custom/routes/outings.custom.ts`, `client/src/custom/components/OutingPlanner.custom.tsx`, `client/src/custom/hooks/useOutings.custom.ts` | `CUSTOM_FEATURE_OUTINGS_ENABLED` |
| Barcode scanning, product lookup and promo watchlist | `server/src/custom/lib/{openFoodFacts,product}.custom.ts`, `server/src/custom/routes/productScan.custom.ts`, `server/test/productScan.custom.test.ts`, `client/src/custom/pages/{ProductScanner,PromoWatchlist}.custom.tsx`, `client/src/custom/components/{BarcodeScanner,ProductCard}.custom.tsx`, `client/src/custom/hooks/{useProductScan,usePromoWatchlist}.custom.ts`, `client/src/custom/lib/product.custom.ts` | `CUSTOM_FEATURE_SCANNER_ENABLED` |
| Feature flags / registration point | `server/src/custom/features.custom.ts`, `server/src/custom/register.custom.ts`, `server/src/custom/middleware/rateLimit.custom.ts` | — |
| Client hooks for custom code | `client/src/custom/{nav.custom.ts,routes.custom.tsx}` | — |
| Deploy assets | `deploy/README.md`, `deploy/up.sh`, `docker-compose.override.yml` | — |
| Translations | `client/src/i18n/locales/<lng>/{weather,activities,analytics,dashboard,budget,ai,lunchbox,pantry,scan}.custom.json` | — |

Gating: a feature's `CUSTOM_FEATURE_*_ENABLED=false` unmounts its API routes and
adds its module keys to `disabled_modules` in `/api/auth/me`, which hides the
matching nav entry, page and dashboard widget through the client's existing module
filter. Module keys: `weather`, `activities`, `budgetReceipts`, `budgetAnalytics`,
`lunchbox`, `pantry`, `outings`, `productScan`.

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

Every row is additive and marker-wrapped unless the "modified lines" column says
otherwise.

| File | Marker | Why |
|------|--------|-----|
| `server/src/app.ts` | `custom-routes`, `budget-custom` | One `registerCustomRoutes(app)` hook (import + call, above the upstream limiters) and one added condition so `/api/ai/extract-receipt` skips the 1 MB default JSON parser |
| `server/src/routes/auth.ts` | `custom-features`, `media` | Adds the env-disabled custom modules to `disabled_modules`; accepts an `s3:` avatar reference |
| `server/src/routes/userSettings.ts` | `weather`, `custom-modules` | Adds the custom dashboard widget keys to `DASHBOARD_WIDGETS` (the list `parseDashboardPrefs` validates against — without it the widgets are silently dropped) and the custom module keys to `TOGGLEABLE_MODULES` (upstream rejects an unknown key in `PUT /api/auth/modules`, so a flag-disabled key reported through `/api/auth/me` would make the next module toggle fail with 400) |
| `server/src/migrations/registry.ts` | `custom-migrations` | Appends the fork migrations (`custom/0001` … `custom/0005`) |
| `server/src/index.ts` | `media` | Ensures the bucket exists at startup when storage is configured |
| `server/src/lib/postFields.ts`, `server/src/lib/recipeImage.ts` | `media` | Keeps an `s3:` media reference intact instead of treating it as a data URL |
| `server/src/routes/dataTransfer.ts` | `media` | Stores inline images on import and answers with JSON instead of rethrowing |
| `server/src/routes/ai.ts` | `ai` | Adds the `extract-receipt` endpoint and the attachment type |
| `server/src/services/ai/index.ts` | `ai`, `ai-no-deliberation` | Adds the `AiAttachment` type and the `AI_UNSUPPORTED_MEDIA` code; appends one no-deliberation line to every completion's system prompt (a JSON-only call, and a reasoning model left alone spent most of its completion tokens thinking, see "Measured latency" below) |
| `server/src/services/ai/{openai,anthropic,gemini,ollama}.ts` | `ai` | Sends attachments to each provider; OpenAI-compatible gateways that need a session |
| `server/src/db.ts` | `db-config` | Database TLS and connect timeout from `CUSTOM_POSTGRES_*` |
| `client/src/App.tsx` | `custom-routes` | Mounts `customRoutes(isModuleEnabled)` inside `<Routes>` |
| `client/src/components/layout/Layout.tsx` | `custom-nav` | Appends `customNavigation` / `customMobileTabs` to the upstream arrays |
| `client/src/pages/Dashboard.tsx` | `weather`, `pantry` | Renders the custom dashboard widgets; the pantry expiry card has its own three `pantry` blocks, the weather blocks are untouched |
| `client/src/pages/Settings.tsx` | `weather`, `budget-custom` | Weather location card, vision-model hint |
| `client/src/pages/Budget.tsx` | `budget-custom` | Mounts the receipt import button and the imported-receipts section |
| `client/src/pages/Planning.tsx` | `outings` | Renders the custom outing planner below the week grid (one import + one element, both marker-wrapped); the outcome is added through the page's own `/api/planning` endpoint |
| `client/src/contexts/AuthContext.tsx` | `weather, pantry` | The `DASHBOARD_WIDGETS` line carries the fork's widget keys (weather, activities, pantry); one marker pair wraps that modified line itself, so an upstream change to it is re-applied from here |
| `client/src/components/app/MagicInput.tsx` | `budget-custom` | Adds the `AI_UNSUPPORTED_MEDIA` error code |
| `client/src/demo/mockApi.ts` | `budget-custom`, `demo-prefs`, `lunchbox`, `pantry`, `outings` | Demo handlers for receipts, receipt extraction, analytics, lunchboxes and the pantry (seeded rows, the shopping-list bridge, the receipt import — which splits its lines exactly like the server: obvious products merged, the rest queued — the review queue with its `confirm`/`ignore` calls, and the two answers the page reacts to: `DUPLICATE_NAME`, `NO_GROCY_INTEGRATION`); plus the two object-shaped endpoints upstream's demo never answers (`dashboard-prefs`, `posts/latest`), whose `ok([])` catch-all crashed the demo's default route. The `demo-prefs` block's default widget order also carries `pantry`; the `outings` block answers the planner with a fixed set (a demo has no OpenStreetMap and no model) |
| `client/nginx.conf` | `media` | Dedicated `location ^~ /api/media/` block (upstream's `location /api/` line untouched) |
| `scripts/smoke-api.sh` | `budget-custom`, `lunchbox` | Smoke calls for the custom endpoints |
| `.env.example` | (section) | `# --- Custom ---` section at the end of the file |
| `DOCUMENTATION.md`, `ROADMAP.md`, `README.md`, `README.fr.md`, `README.zh-CN.md` | `docs` | Feature documentation |
| `docker-compose.yml` | `deploy` | Custom env vars for the server service, `CUSTOM_FEATURE_*_ENABLED` included (without a line there, a variable set in `.env` never reaches the container — the documented kill switch could not be used on a Docker install) |
| `server/package.json`, `package-lock.json` | (none, JSON) | `@aws-sdk/client-s3` dependency and the `test` script; lockfile regenerated, never hand-edited |
| `client/package.json`, `package-lock.json` | (none, JSON) | `react-zxing` dependency; lockfile updated with `npm install --legacy-peer-deps` so the workspace's react/react-dom stay on the versions already locked (19.2.7/19.2.7) — a plain `npm install` re-resolved `react` to 19.3.0 against `react-dom` 19.2.7 and crashed every page at runtime |

### Modified (non-additive) upstream lines — the complete list

Only 23 lines in 13 files, all wrapped in markers:

| File | Lines | What |
|------|-------|------|
| `server/src/services/ai/index.ts` | 4 | the four provider calls in `aiCompleteWithUsage` pass the request with the no-deliberation line appended |
| `server/src/routes/auth.ts` | 2 re-indented | The avatar data-URL format/size checks are skipped for an `s3:` reference (wrapped in `if (!isMediaRef(...))`) |
| `server/src/services/ai/openai.ts` | 2 | `chatCompletionUrl(baseUrl)`, `messageContent(request)` |
| `server/src/services/ai/anthropic.ts` | 2 | `max_tokens` 2048 → 4096; user content carries attachments |
| `server/src/services/ai/gemini.ts` | 1 | request parts carry attachments |
| `server/src/services/ai/ollama.ts` | 1 | user message carries images when present |
| `server/src/db.ts` | 1 | `connectionTimeoutMillis` uses `CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS` |
| `server/src/routes/userSettings.ts` | 2 | `DASHBOARD_WIDGETS` spreads the custom widget keys; `TOGGLEABLE_MODULES` spreads the custom module keys |
| `client/src/contexts/AuthContext.tsx` | 1 | `DASHBOARD_WIDGETS` lists the custom widget keys (weather, activities, pantry) |
| `README.md`, `README.fr.md`, `README.zh-CN.md` | 1 each | Feature row appended to the budget line |
| `ROADMAP.md` | 2 | The receipt-import bullet |

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
| — (new) | `CUSTOM_FEATURE_{WEATHER,MEDIA,BUDGET_RECEIPTS,BUDGET_ANALYTICS,LUNCHBOX,PANTRY,OUTINGS,SCANNER,AI_WIDGETS}_ENABLED` |
| — (new) | `CUSTOM_OVERPASS_URL`, `CUSTOM_OVERPASS_TIMEOUT_MS`, `CUSTOM_OUTINGS_RADIUS_KM`, `CUSTOM_OUTINGS_CACHE_TTL_MS` |

All nine flags are listed in `docker-compose.yml`'s `FORK-START: deploy` block, so an
operator on a Docker install can switch any of them off from `.env` (they were absent
before the outing planner; unset still means enabled, so nothing changed for an
existing `.env`).

## Translations

Fork-owned namespaces only, referenced as `t('<ns>:key')`; no key is added to an
upstream locale file:

- `weather.custom`, `activities.custom` (six locales)
- `analytics.custom` (six locales; the `es`, `pt`, `ru`, `zh` files are copies of
  the English strings — placeholders pending translation, required because
  `client/scripts/check-i18n.mjs` fails the build on any namespace missing from a
  locale)
- `dashboard.custom`, `budget.custom`, `ai.custom` (six locales)
- `lunchbox.custom`, `pantry.custom` (six locales)
- `outings.custom` (six locales)
- `scan.custom` (six locales; `es`, `pt`, `ru`, `zh` are copies of the English
  strings, same placeholder rule as `analytics.custom`)

## Tests

`server/test/{weather,aiProvider,budgetAnalytics,aiPrompt,lunchbox,pantry,receipt,outings,productScan}.custom.test.ts` — matched by the
server's `tsx --test test/*.test.ts`. `aiPrompt` covers the activities user prompt
and the cache-key digest it shares a normalizer with: what the family wrote on a
child's card has to reach the model, and two children with different notes must
never share a cached idea list. `pantry` covers the merge key (accents, case,
whitespace, the 160-char cap), the item sanitiser, low-stock and expiry
boundaries, the two import mappers (Grocy stock, receipt lines) and the split that
decides which lines are stocked without asking. `receipt` covers the pantry half of
the extraction: the brand-free name, the unit and the "is this stock?" verdict
survive validation, a non-boolean verdict never reads as yes, and a line typed by
hand carries neither. `outings`
covers the Overpass answer (categories, unnamed and duplicated places, a `ref`
pointing at a place that was never offered) and the outing window (the model's
suggestion when it fits inside a day, the requested length otherwise). The client
has no test runner; the custom UI
was verified in a browser instead (see "Verification" below).

## Endpoint moves (behaviour changes vs the earlier fork tree)

- `PUT /api/auth/location` → `PUT /api/weather/location` (the location belongs to
  the weather feature, not to upstream's auth router). `GET /api/weather/location`
  reads it back, so the client no longer needs `city`/`latitude`/… on the user object.
- Everything else keeps its path: `/api/weather`, `/api/ai/dashboard`,
  `/api/media`, `/api/budget/receipts`, `/api/budget-analytics`.

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
