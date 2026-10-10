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

Measured divergence of this port: **34 upstream files touched, 1504 insertions,
24 modified lines** (measured 2026-10-10, `git diff --numstat upstream/main` over
the files that exist upstream; the two-phase dashboard fix added 25 insertions and
four modified lines to the previous 1479/20, which itself followed the lunchbox
port at 1224/19). The AI outing planner adds a **35th upstream file** —
`client/src/pages/Planning.tsx`, 13 inserted lines (one marker-wrapped import, one
marker-wrapped element), no modified line. Every touched upstream file carries
`FORK-START/END` markers except the three that cannot hold comments
(`.env.example`, `package-lock.json`, `server/package.json` — each explained
below).
below).

## Custom features (new files only)

| Feature | Files | Flag |
|---------|-------|------|
| Weather, clothing suggestions, screen-free activities | `server/src/custom/weather/*.custom.ts`, `server/src/custom/routes/weather.custom.ts`, `server/src/custom/lib/dayContext.custom.ts`, `server/src/custom/ai/{activityBank,widgets}.custom.ts`, `server/src/custom/routes/aiDashboard.custom.ts`, `client/src/custom/components/{WeatherClothingCard,WeatherDetailsDialog,WeatherLocation,KidsActivitiesCard}.custom.tsx`, `client/src/custom/hooks/useWeather.custom.ts`, `client/src/custom/lib/{weatherCode,dayContextLabel}.custom.ts` | `CUSTOM_FEATURE_WEATHER_ENABLED`, `CUSTOM_FEATURE_AI_WIDGETS_ENABLED` |
| Object storage for images (S3-compatible) | `server/src/custom/lib/{storage,media,storage-errors}.custom.ts`, `server/src/custom/middleware/media.custom.ts`, `server/src/custom/routes/media.custom.ts` | `CUSTOM_FEATURE_MEDIA_ENABLED` |
| Receipt / bill import with line detail | `server/src/custom/routes/budgetReceipts.custom.ts`, `server/src/custom/ai/receipt.custom.ts`, `client/src/custom/components/{ReceiptImport,BudgetReceipts}.custom.tsx` | `CUSTOM_FEATURE_BUDGET_RECEIPTS_ENABLED` |
| Budget analytics page | `server/src/custom/lib/budgetAnalytics.custom.ts`, `server/src/custom/routes/budgetAnalytics.custom.ts`, `client/src/custom/pages/BudgetAnalytics.custom.tsx` | `CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED` |
| Lunchboxes + weekly nutritional read (ported from KeurTonux) | `server/src/custom/lib/lunchbox.custom.ts`, `server/src/custom/lib/aiSettings.custom.ts`, `server/src/custom/lib/promptLanguage.custom.ts`, `server/src/custom/ai/{lunchbox,nutrition}.custom.ts`, `server/src/custom/routes/lunchbox.custom.ts`, `client/src/custom/pages/Lunchboxes.custom.tsx`, `client/src/custom/components/{LunchboxAiDialog,NutritionAnalysisDialog}.custom.tsx` | `CUSTOM_FEATURE_LUNCHBOX_ENABLED` |
| AI outing planner on the Planning page — real places around the family (OpenStreetMap/Overpass) ranked by the family's own model for the day, the weather, the people coming (whole family / with the kids / parents only) and what the children's cards say, plus place-less activity ideas; the chosen outing is added to the planning through upstream's own `/api/planning` | `server/src/custom/lib/places.custom.ts`, `server/src/custom/lib/{location,kids}.custom.ts` (extracted from the dashboard route when this needed the same answers), `server/src/custom/ai/outings.custom.ts`, `server/src/custom/routes/outings.custom.ts`, `client/src/custom/components/OutingPlanner.custom.tsx`, `client/src/custom/hooks/useOutings.custom.ts` | `CUSTOM_FEATURE_OUTINGS_ENABLED` |
| Feature flags / registration point | `server/src/custom/features.custom.ts`, `server/src/custom/register.custom.ts`, `server/src/custom/middleware/rateLimit.custom.ts` | — |
| Client hooks for custom code | `client/src/custom/{nav.custom.ts,routes.custom.tsx}` | — |
| Deploy assets | `deploy/README.md`, `deploy/up.sh`, `docker-compose.override.yml` | — |
| Translations | `client/src/i18n/locales/<lng>/{weather,activities,analytics,dashboard,budget,ai,lunchbox}.custom.json` | — |

Gating: a feature's `CUSTOM_FEATURE_*_ENABLED=false` unmounts its API routes and
adds its module keys to `disabled_modules` in `/api/auth/me`, which hides the
matching nav entry, page and dashboard widget through the client's existing module
filter. Module keys: `weather`, `activities`, `budgetReceipts`, `budgetAnalytics`,
`lunchbox`, `outings`.

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
| `server/src/routes/userSettings.ts` | `weather`, `custom-modules` | Adds the two custom dashboard widget keys to `DASHBOARD_WIDGETS` (the list `parseDashboardPrefs` validates against — without it the widgets are silently dropped) and the custom module keys to `TOGGLEABLE_MODULES` (upstream rejects an unknown key in `PUT /api/auth/modules`, so a flag-disabled key reported through `/api/auth/me` would make the next module toggle fail with 400) |
| `server/src/migrations/registry.ts` | `custom-migrations` | Appends the fork migrations (`custom/0001`, `custom/0002`, `custom/0003`) |
| `server/src/index.ts` | `media` | Ensures the bucket exists at startup when storage is configured |
| `server/src/lib/postFields.ts`, `server/src/lib/recipeImage.ts` | `media` | Keeps an `s3:` media reference intact instead of treating it as a data URL |
| `server/src/routes/dataTransfer.ts` | `media` | Stores inline images on import and answers with JSON instead of rethrowing |
| `server/src/routes/ai.ts` | `ai` | Adds the `extract-receipt` endpoint and the attachment type |
| `server/src/services/ai/index.ts` | `ai`, `ai-no-deliberation` | Adds the `AiAttachment` type and the `AI_UNSUPPORTED_MEDIA` code; appends one no-deliberation line to every completion's system prompt (a JSON-only call, and a reasoning model left alone spent most of its completion tokens thinking, see "Measured latency" below) |
| `server/src/services/ai/{openai,anthropic,gemini,ollama}.ts` | `ai` | Sends attachments to each provider; OpenAI-compatible gateways that need a session |
| `server/src/db.ts` | `db-config` | Database TLS and connect timeout from `CUSTOM_POSTGRES_*` |
| `client/src/App.tsx` | `custom-routes` | Mounts `customRoutes(isModuleEnabled)` inside `<Routes>` |
| `client/src/components/layout/Layout.tsx` | `custom-nav` | Appends `customNavigation` / `customMobileTabs` to the upstream arrays |
| `client/src/pages/Dashboard.tsx` | `weather` | Renders the two custom dashboard widgets |
| `client/src/pages/Settings.tsx` | `weather`, `budget-custom` | Weather location card, vision-model hint |
| `client/src/pages/Budget.tsx` | `budget-custom` | Mounts the receipt import button and the imported-receipts section |
| `client/src/pages/Planning.tsx` | `outings` | Renders the custom outing planner below the week grid (one import + one element, both marker-wrapped); the outcome is added through the page's own `/api/planning` endpoint |
| `client/src/contexts/AuthContext.tsx` | `weather` | Adds the two custom widget keys to the client's `DASHBOARD_WIDGETS` |
| `client/src/components/app/MagicInput.tsx` | `budget-custom` | Adds the `AI_UNSUPPORTED_MEDIA` error code |
| `client/src/demo/mockApi.ts` | `budget-custom`, `demo-prefs`, `lunchbox`, `outings` | Demo handlers for receipts, receipt extraction, analytics and lunchboxes; plus the two object-shaped endpoints upstream's demo never answers (`dashboard-prefs`, `posts/latest`), whose `ok([])` catch-all crashed the demo's default route. The `outings` block answers the planner with a fixed set (a demo has no OpenStreetMap and no model) |
| `client/nginx.conf` | `media` | Dedicated `location ^~ /api/media/` block (upstream's `location /api/` line untouched) |
| `scripts/smoke-api.sh` | `budget-custom`, `lunchbox` | Smoke calls for the custom endpoints |
| `.env.example` | (section) | `# --- Custom ---` section at the end of the file |
| `DOCUMENTATION.md`, `ROADMAP.md`, `README.md`, `README.fr.md`, `README.zh-CN.md` | `docs` | Feature documentation |
| `docker-compose.yml` | `deploy` | Custom env vars for the server service |
| `server/package.json`, `package-lock.json` | (none, JSON) | `@aws-sdk/client-s3` dependency and the `test` script; lockfile regenerated, never hand-edited |

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
| `client/src/contexts/AuthContext.tsx` | 1 | `DASHBOARD_WIDGETS` lists the custom widget keys |
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
- `server/package.json` — `"test": "tsx --test test/*.test.ts"`
- `package-lock.json` regenerated for the above; no other version changed

## Custom migrations

Both live in the reserved `custom/` namespace (upstream ends at `core/0006`, so its
next migration takes `core/0007`):

- `custom/0001-users-location` — `users.city`, `country_code`, `latitude`, `longitude`
- `custom/0002-budget-receipts` — `budget_receipts`, `budget_receipt_items`,
  `budget_entries.receipt_id` (FK `ON DELETE CASCADE`), `UNIQUE (user_id, fingerprint)`
- `custom/0003-lunchboxes` — `custom_lunchboxes`, `UNIQUE (user_id, family_member_id, date)`,
  two indexes. The fork's own table on purpose: upstream's `meal_plans` has one row per
  date+meal type and no "for whom", so adding lunchboxes there would mean altering an
  upstream table (KeurTonux's approach) instead of adding beside it.

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
| — (new) | `CUSTOM_FEATURE_{WEATHER,MEDIA,BUDGET_RECEIPTS,BUDGET_ANALYTICS,LUNCHBOX,OUTINGS,AI_WIDGETS}_ENABLED` |
| — (new) | `CUSTOM_OVERPASS_URL`, `CUSTOM_OVERPASS_TIMEOUT_MS`, `CUSTOM_OUTINGS_RADIUS_KM`, `CUSTOM_OUTINGS_CACHE_TTL_MS` |

All eight flags are listed in `docker-compose.yml`'s `FORK-START: deploy` block, so an
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
- `outings.custom` (six locales)

## Tests

`server/test/{weather,aiProvider,budgetAnalytics,aiPrompt,outings}.custom.test.ts` — matched by the
server's `tsx --test test/*.test.ts`. `aiPrompt` covers the activities user prompt
and the cache-key digest it shares a normalizer with: what the family wrote on a
child's card has to reach the model, and two children with different notes must
covers the Overpass answer (categories, unnamed and duplicated places, a `ref`
pointing at a place that was never offered) and the outing window (the model's
suggestion when it fits inside a day, the requested length otherwise). The client
never share a cached idea list. The client has no test runner; the custom UI
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

## Deployment

This checkout is the **live deployment** since 2026-10-10: `family.bsylla.com`
(Cloudflare tunnel `navidrome`, host service `cloudflared.service`) → the client
on `127.0.0.1:8200`, server reachable only inside the Compose network. Database:
Neon `keurtonux`/`openfamily`, TLS `verify-full`. Images: S3 Scaleway bucket
`openfamily-media`. Details and rollback: `deploy/README.md`.

The previous checkout (`/home/bsylla/OpenFamily`, branch `develop`) was stopped
with `deploy/up.sh down` in the same operation; its images are kept, so the
rollback is two commands. Container names are fixed, so only one stack can run at
a time.

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

