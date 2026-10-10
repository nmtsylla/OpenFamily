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

Measured divergence of this port: **34 upstream files touched, 1224 insertions,
19 modified lines**. Every touched upstream file carries `FORK-START/END` markers
except the three that cannot hold comments (`.env.example`, `package-lock.json`,
`server/package.json` — each explained below).

## Custom features (new files only)

| Feature | Files | Flag |
|---------|-------|------|
| Weather, clothing suggestions, screen-free activities | `server/src/custom/weather/*.custom.ts`, `server/src/custom/routes/weather.custom.ts`, `server/src/custom/lib/dayContext.custom.ts`, `server/src/custom/ai/{activityBank,widgets}.custom.ts`, `server/src/custom/routes/aiDashboard.custom.ts`, `client/src/custom/components/{WeatherClothingCard,WeatherDetailsDialog,WeatherLocation,KidsActivitiesCard}.custom.tsx`, `client/src/custom/hooks/useWeather.custom.ts`, `client/src/custom/lib/{weatherCode,dayContextLabel}.custom.ts` | `CUSTOM_FEATURE_WEATHER_ENABLED`, `CUSTOM_FEATURE_AI_WIDGETS_ENABLED` |
| Object storage for images (S3-compatible) | `server/src/custom/lib/{storage,media,storage-errors}.custom.ts`, `server/src/custom/middleware/media.custom.ts`, `server/src/custom/routes/media.custom.ts` | `CUSTOM_FEATURE_MEDIA_ENABLED` |
| Receipt / bill import with line detail | `server/src/custom/routes/budgetReceipts.custom.ts`, `server/src/custom/ai/receipt.custom.ts`, `client/src/custom/components/{ReceiptImport,BudgetReceipts}.custom.tsx` | `CUSTOM_FEATURE_BUDGET_RECEIPTS_ENABLED` |
| Budget analytics page | `server/src/custom/lib/budgetAnalytics.custom.ts`, `server/src/custom/routes/budgetAnalytics.custom.ts`, `client/src/custom/pages/BudgetAnalytics.custom.tsx` | `CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED` |
| Feature flags / registration point | `server/src/custom/features.custom.ts`, `server/src/custom/register.custom.ts`, `server/src/custom/middleware/rateLimit.custom.ts` | — |
| Client hooks for custom code | `client/src/custom/{nav.custom.ts,routes.custom.tsx}` | — |
| Deploy assets | `deploy/README.md`, `deploy/up.sh`, `docker-compose.override.yml` | — |
| Translations | `client/src/i18n/locales/<lng>/{weather,activities,analytics,dashboard,budget,ai}.custom.json` | — |

Gating: a feature's `CUSTOM_FEATURE_*_ENABLED=false` unmounts its API routes and
adds its module keys to `disabled_modules` in `/api/auth/me`, which hides the
matching nav entry, page and dashboard widget through the client's existing module
filter. Module keys: `weather`, `activities`, `budgetReceipts`, `budgetAnalytics`.

## Modifications to upstream files

Every row is additive and marker-wrapped unless the "modified lines" column says
otherwise.

| File | Marker | Why |
|------|--------|-----|
| `server/src/app.ts` | `custom-routes`, `budget-custom` | One `registerCustomRoutes(app)` hook (import + call, above the upstream limiters) and one added condition so `/api/ai/extract-receipt` skips the 1 MB default JSON parser |
| `server/src/routes/auth.ts` | `custom-features`, `media` | Adds the env-disabled custom modules to `disabled_modules`; accepts an `s3:` avatar reference |
| `server/src/routes/userSettings.ts` | `weather`, `custom-modules` | Adds the two custom dashboard widget keys to `DASHBOARD_WIDGETS` (the list `parseDashboardPrefs` validates against — without it the widgets are silently dropped) and the custom module keys to `TOGGLEABLE_MODULES` (upstream rejects an unknown key in `PUT /api/auth/modules`, so a flag-disabled key reported through `/api/auth/me` would make the next module toggle fail with 400) |
| `server/src/migrations/registry.ts` | `custom-migrations` | Appends the two fork migrations (`custom/0001`, `custom/0002`) |
| `server/src/index.ts` | `media` | Ensures the bucket exists at startup when storage is configured |
| `server/src/lib/postFields.ts`, `server/src/lib/recipeImage.ts` | `media` | Keeps an `s3:` media reference intact instead of treating it as a data URL |
| `server/src/routes/dataTransfer.ts` | `media` | Stores inline images on import and answers with JSON instead of rethrowing |
| `server/src/routes/ai.ts` | `ai` | Adds the `extract-receipt` endpoint and the attachment type |
| `server/src/services/ai/index.ts` | `ai` | Adds the `AiAttachment` type and the `AI_UNSUPPORTED_MEDIA` code |
| `server/src/services/ai/{openai,anthropic,gemini,ollama}.ts` | `ai` | Sends attachments to each provider; OpenAI-compatible gateways that need a session |
| `server/src/db.ts` | `db-config` | Database TLS and connect timeout from `CUSTOM_POSTGRES_*` |
| `client/src/App.tsx` | `custom-routes` | Mounts `customRoutes(isModuleEnabled)` inside `<Routes>` |
| `client/src/components/layout/Layout.tsx` | `custom-nav` | Appends `customNavigation` / `customMobileTabs` to the upstream arrays |
| `client/src/pages/Dashboard.tsx` | `weather` | Renders the two custom dashboard widgets |
| `client/src/pages/Settings.tsx` | `weather`, `budget-custom` | Weather location card, vision-model hint |
| `client/src/pages/Budget.tsx` | `budget-custom` | Mounts the receipt import button and the imported-receipts section |
| `client/src/contexts/AuthContext.tsx` | `weather` | Adds the two custom widget keys to the client's `DASHBOARD_WIDGETS` |
| `client/src/components/app/MagicInput.tsx` | `budget-custom` | Adds the `AI_UNSUPPORTED_MEDIA` error code |
| `client/src/demo/mockApi.ts` | `budget-custom`, `demo-prefs` | Demo handlers for receipts, receipt extraction and analytics; plus the two object-shaped endpoints upstream's demo never answers (`dashboard-prefs`, `posts/latest`), whose `ok([])` catch-all crashed the demo's default route |
| `client/nginx.conf` | `media` | Dedicated `location ^~ /api/media/` block (upstream's `location /api/` line untouched) |
| `scripts/smoke-api.sh` | `budget-custom` | Smoke calls for the custom endpoints |
| `.env.example` | (section) | `# --- Custom ---` section at the end of the file |
| `DOCUMENTATION.md`, `ROADMAP.md`, `README.md`, `README.fr.md`, `README.zh-CN.md` | `docs` | Feature documentation |
| `docker-compose.yml` | `deploy` | Custom env vars for the server service |
| `server/package.json`, `package-lock.json` | (none, JSON) | `@aws-sdk/client-s3` dependency and the `test` script; lockfile regenerated, never hand-edited |

### Modified (non-additive) upstream lines — the complete list

Only 19 lines in 12 files, all wrapped in markers:

| File | Lines | What |
|------|-------|------|
| `server/src/routes/auth.ts` | 2 re-indented | The avatar data-URL format/size checks are skipped for an `s3:` reference (wrapped in `if (!isMediaRef(...))`) |
| `server/src/services/ai/openai.ts` | 2 | `chatCompletionUrl(baseUrl)`, `messageContent(request)` |
| `server/src/services/ai/anthropic.ts` | 2 | `max_tokens` 2048 → 4096; user content carries attachments |
| `server/src/services/ai/gemini.ts` | 1 | request parts carry attachments |
| `server/src/services/ai/ollama.ts` | 1 | user message carries images when present |
| `server/src/db.ts` | 1 | `connectionTimeoutMillis` uses `CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS` |
| `server/src/routes/userSettings.ts` | 2 | `DASHBOARD_WIDGETS` spreads the custom widget keys; `TOGGLEABLE_MODULES` spreads the custom module keys |
| `client/src/contexts/AuthContext.tsx` | 1 | `DASHBOARD_WIDGETS` lists the custom widget keys |
| `README.md`, `README.fr.md`, `README.zh-CN.md` | 1 each | Feature row appended to the budget line |
| `ROADMAP.md` | 2 | The receipt-import bullet |

## Dependency changes

- `@aws-sdk/client-s3@^3.1148.0` (server) — S3-compatible image storage
- `server/package.json` — `"test": "tsx --test test/*.test.ts"`
- `package-lock.json` regenerated for the above; no other version changed

## Custom migrations

Both live in the reserved `custom/` namespace (upstream ends at `core/0006`, so its
next migration takes `core/0007`):

- `custom/0001-users-location` — `users.city`, `country_code`, `latitude`, `longitude`
- `custom/0002-budget-receipts` — `budget_receipts`, `budget_receipt_items`,
  `budget_entries.receipt_id` (FK `ON DELETE CASCADE`), `UNIQUE (user_id, fingerprint)`

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
| — (new) | `CUSTOM_FEATURE_{WEATHER,MEDIA,BUDGET_RECEIPTS,BUDGET_ANALYTICS,AI_WIDGETS}_ENABLED` |

## Translations

Fork-owned namespaces only, referenced as `t('<ns>:key')`; no key is added to an
upstream locale file:

- `weather.custom`, `activities.custom` (six locales)
- `analytics.custom` (six locales; the `es`, `pt`, `ru`, `zh` files are copies of
  the English strings — placeholders pending translation, required because
  `client/scripts/check-i18n.mjs` fails the build on any namespace missing from a
  locale)
- `dashboard.custom`, `budget.custom`, `ai.custom` (six locales)

## Tests

`server/test/{weather,aiProvider,budgetAnalytics}.custom.test.ts` — matched by the
server's `tsx --test test/*.test.ts`. The client has no test runner; the custom UI
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
- `deploy/README.md` still mentions the old checkout path `/home/bsylla/OpenFamily`
  in its backup snippet.
- `analytics.custom.json` exists for all six locales, but its `es`/`pt`/`ru`/`zh`
  files are English placeholders pending translation (required by `check-i18n`).

## Local development

`npm ci` at the root installs every workspace from the lockfile (772 packages).
Earlier the checkout carried symlinked `node_modules` into a sibling worktree
because `/home` was full; they are gone — a real install now exists, and the
lockfile is this fork's own.

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
