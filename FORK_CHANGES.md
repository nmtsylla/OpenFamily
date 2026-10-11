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

Measured divergence of this port: **34 upstream files touched, 1258 insertions,
20 deletions** (recounted 2026-10-10 with the family dashboard in the tree; the
feature itself adds none — it lives entirely in `custom/`). Every touched upstream
file carries `FORK-START/END` markers except the three that cannot hold comments
(`.env.example`, `package-lock.json`, `server/package.json` — each explained below).

## Custom features (new files only)

| Feature | Files | Flag |
|---------|-------|------|
| Weather, clothing suggestions, screen-free activities | `server/src/custom/weather/*.custom.ts`, `server/src/custom/routes/weather.custom.ts`, `server/src/custom/lib/dayContext.custom.ts`, `server/src/custom/ai/{activityBank,widgets}.custom.ts`, `server/src/custom/routes/aiDashboard.custom.ts`, `client/src/custom/components/{WeatherClothingCard,WeatherDetailsDialog,WeatherLocation,KidsActivitiesCard}.custom.tsx`, `client/src/custom/hooks/useWeather.custom.ts`, `client/src/custom/lib/{weatherCode,dayContextLabel}.custom.ts` | `CUSTOM_FEATURE_WEATHER_ENABLED`, `CUSTOM_FEATURE_AI_WIDGETS_ENABLED` |
| Object storage for images (S3-compatible) | `server/src/custom/lib/{storage,media,storage-errors}.custom.ts`, `server/src/custom/middleware/media.custom.ts`, `server/src/custom/routes/media.custom.ts` | `CUSTOM_FEATURE_MEDIA_ENABLED` |
| Receipt / bill import with line detail | `server/src/custom/routes/budgetReceipts.custom.ts`, `server/src/custom/ai/receipt.custom.ts`, `client/src/custom/components/{ReceiptImport,BudgetReceipts}.custom.tsx` | `CUSTOM_FEATURE_BUDGET_RECEIPTS_ENABLED` |
| Budget analytics page | `server/src/custom/lib/budgetAnalytics.custom.ts`, `server/src/custom/routes/budgetAnalytics.custom.ts`, `client/src/custom/pages/BudgetAnalytics.custom.tsx` | `CUSTOM_FEATURE_BUDGET_ANALYTICS_ENABLED` |
| Family dashboard (phase-aware wall tablet + Home Assistant control) | `server/src/custom/lib/homeAssistantDevices.custom.ts`, `server/src/custom/routes/homeAssistantDevices.custom.ts`, `client/src/custom/pages/FamilyDashboard.custom.tsx`, `client/src/custom/hooks/useHomeAssistant.custom.ts`, `client/src/custom/lib/familyPhase.custom.ts` | `CUSTOM_FEATURE_FAMILY_DASHBOARD_ENABLED` |
| Feature flags / registration point | `server/src/custom/features.custom.ts`, `server/src/custom/register.custom.ts`, `server/src/custom/middleware/rateLimit.custom.ts` | — |
| Client hooks for custom code | `client/src/custom/{nav.custom.ts,routes.custom.tsx}` | — |
| Deploy assets | `deploy/README.md`, `deploy/up.sh`, `docker-compose.override.yml` | — |
| Translations | `client/src/i18n/locales/<lng>/{weather,activities,analytics,dashboard,budget,ai}.custom.json` | — |

Gating: a feature's `CUSTOM_FEATURE_*_ENABLED=false` unmounts its API routes and
adds its module keys to `disabled_modules` in `/api/auth/me`, which hides the
matching nav entry, page and dashboard widget through the client's existing module
filter. Module keys: `weather`, `activities`, `budgetReceipts`, `budgetAnalytics`,
`familyDashboard`.

### Family dashboard

`/family-dashboard` is a chrome-less full-screen page for a wall tablet: a
time-of-day phase (morning 06–09, day 09–17, evening 17–22, night 22–06) decides
which widgets are on screen, and the phase can be cycled by swiping the content
or tapping the badge in the top bar. It is the only custom feature that talks to
Home Assistant in both directions.

- **No upstream file is touched by this feature.** The page renders inside
  `<Layout>` like every other custom route and covers the chrome with a
  `fixed inset-0 z-[60]` layer — above Layout's own highest fixed element
  (`z-50`). Upstream's Kiosk instead renders outside `<Layout>`, which would cost
  a marked edit in `client/src/App.tsx`; that edit was deliberately not taken.
- **Home Assistant credentials are reused, not re-configured.** The proxy reads
  the family's existing `integrations` row (`family_id` + `type =
  'homeassistant'`, unique through upstream's `ON CONFLICT (family_id, type)`
  upsert), decrypts `encrypted_credentials` and calls HA through `safeFetch` with
  the same `Authorization: Bearer` header and 15 s timeout as
  `services/integrations/homeassistant.ts`. No new env var, no new table.
- **The client reaches HA only through `/api/custom/ha`.** `GET /states` returns
  the whitelisted domains (`light`, `switch`, `climate`, `media_player`, `scene`,
  `input_boolean`, `cover`, `fan`, `lock`, `binary_sensor`, `camera`) with a
  trimmed attribute set; `POST /services/:domain/:service` forwards a service
  call verbatim, parent-only, with the domain whitelist and the entity/domain
  match enforced in `lib/homeAssistantDevices.custom.ts`.
- **Entity name heuristics, by design.** The coffee toggle matches
  "café"/"cafe"/"coffee", the dinner scene "dîner"/"diner"/"dinner", the
  nightlight "nuit"/"nightlight"/"veilleuse". A household whose entities are named
  differently simply does not get those tiles — no config UI, no env var.
- **The quick-toggle grid only lists domains that really take `turn_on`/`turn_off`**
  (`light`, `switch`, `input_boolean`, `fan`, `media_player`, `climate`). `lock`
  and `cover` are in the read whitelist but take `lock`/`unlock` and
  `open_cover`/`close_cover`, so a tile for them would be a control that never
  works; the lock appears in the Security card instead (amber while `unlocked`,
  since a lock reads `locked`/`unlocked` and not `on`/`off`), and a cover has no
  place in a v1 toggle grid.
- **A service HA rejects is not an outage.** HA answering 4xx (a service that
  domain does not implement, an entity that will not take it) comes back as
  `400 homeassistant.service_rejected`; only HA 5xx and an unreachable host
  become `502 homeassistant.unreachable`/`service_failed`. The client maps only
  the latter to its offline banner, so one dead tile can never disable the whole
  screen. HA's own 401/403 is folded into that 400 on purpose: forwarding it
  would make the client's API layer read it as an expired OpenFamily session and
  log the family out.
- **Degradations are explicit.** No HA integration → full-screen setup banner
  linking to `/integrations`, no HA cards. HA unreachable → sticky toast with a
  retry button, every HA toggle disabled, and the read-only HA cards (security
  pills, light count) hidden rather than left showing yesterday's state. No AI
  model or no saved city → the morning clothing card falls back to "Vérifiez la
  météo".

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
| — (new) | `CUSTOM_FEATURE_{WEATHER,MEDIA,BUDGET_RECEIPTS,BUDGET_ANALYTICS,AI_WIDGETS,FAMILY_DASHBOARD}_ENABLED` |

## Translations

Fork-owned namespaces only, referenced as `t('<ns>:key')`; no key is added to an
upstream locale file:

- `weather.custom`, `activities.custom` (six locales)
- `analytics.custom` (six locales; the `es`, `pt`, `ru`, `zh` files are copies of
  the English strings — placeholders pending translation, required because
  `client/scripts/check-i18n.mjs` fails the build on any namespace missing from a
  locale)
- `dashboard.custom`, `budget.custom`, `ai.custom` (six locales; the family
  dashboard's keys live in `dashboard.custom` alongside the two widget labels
  already there, and its `ru`/`zh` files are English placeholders pending
  translation, same rule as `analytics.custom`)

## Tests

`server/test/{weather,aiProvider,budgetAnalytics,homeAssistantDevices}.custom.test.ts`
— matched by the server's `tsx --test test/*.test.ts`. The client has no test
runner; the custom UI was verified in a browser instead (see "Verification" below).

`homeAssistantDevices.custom.test.ts` covers the rules that decide what the
dashboard may read and drive (domain whitelist, attribute trimming, entity/domain
match, service-name shape) and how a non-2xx from HA is classified (a 4xx
rejection must never surface as an outage, and HA's 401/403 must never surface as
401), against `custom/lib/homeAssistantDevices.custom.ts` — which is why that
logic sits in a lib rather than in the router.

## Endpoint moves (behaviour changes vs the earlier fork tree)

- `PUT /api/auth/location` → `PUT /api/weather/location` (the location belongs to
  the weather feature, not to upstream's auth router). `GET /api/weather/location`
  reads it back, so the client no longer needs `city`/`latitude`/… on the user object.
- Everything else keeps its path: `/api/weather`, `/api/ai/dashboard`,
  `/api/media`, `/api/budget/receipts`, `/api/budget-analytics`.
- `/api/custom/ha` (family dashboard only) is new, and is the one custom mount
  that reaches a user-supplied host — the family's own Home Assistant. It
  therefore sits behind the same per-minute custom limiter as the weather
  surfaces rather than upstream's 30-per-15-minutes outbound budget, which a
  30 s state poll would exhaust in seven minutes.

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
- Family dashboard, against a throwaway Postgres 16 and a stub Home Assistant
  (2026-10-10): `npm test` 31/31 (the 12 new ones in
  `homeAssistantDevices.custom.test.ts`); `/api/custom/ha/states` filters the
  non-whitelisted domains and trims the attributes; `POST /services/...` forwards
  the body verbatim for a single entity, a list and a scene, and rejects a
  non-whitelisted domain, a cross-domain target, a missing `entity_id` and a
  service name carrying a path traversal (400 each); no integration → 404
  `homeassistant.integration_not_found`, unreachable HA → 502
  `homeassistant.unreachable`, no token → 401; with
  `CUSTOM_FEATURE_FAMILY_DASHBOARD_ENABLED=false` the route answers 404 and
  `/api/auth/me` reports `familyDashboard` as disabled
- The lock/cover defect was reproduced before it was fixed, with a stub HA that
  implements HA's real per-domain service table: tapping a `lock` tile sent
  `lock.turn_on`, HA answered 400, the proxy turned that into 502 and the client
  flashed "Home Assistant hors ligne" over the whole screen while disabling two
  controls. After the fix the grid no longer lists lock/cover, every remaining
  tile sends a service the domain implements (verified for switch/light/climate/
  media_player with no banner at any point), `lock.turn_on` answers
  `400 homeassistant.service_rejected` instead of 502, and the Security card's
  lock dot goes amber on `unlocked` while a closed window stays green
- Family dashboard in Chromium at 900×1600 portrait: every phase renders
  (morning weather + clothing fallback + coffee toggle, day agenda/devices/
  security/shopping, evening dinner/dimmer/bedtime, night clock + nightlight);
  a tile tap reached HA as `light.turn_off`, the dimmer as `light.turn_on` with
  `brightness_pct`, the scene button as `scene.turn_on`, "Tout éteindre" as
  `light.turn_off` + `switch.turn_off`; the phase badge and a 60 px swipe both
  cycle phases and wrap; the viewport meta is injected; `navigator.wakeLock`
  is requested on mount; the night clock dims to `opacity-30` with the bottom
  bar at `opacity-50` after five idle minutes and any touch restores both;
  stopping HA shows the offline toast with the HA buttons disabled and the
  read-only HA cards hidden, and restarting it clears the toast on retry; no
  console errors and no horizontal overflow in any phase
