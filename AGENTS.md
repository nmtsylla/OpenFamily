# [AGENTS.md](http://AGENTS.md)

Instructions for AI coding agents (and humans) working in this repository.

## Context

This repository is a **fork of [OpenFamily](https://github.com/NexaFlowFrance/OpenFamily)** — upstream is `NexaFlowFrance/OpenFamily`, this fork is `nmtsylla/OpenFamily`. It contains **custom features** built on top of upstream. The owner wants to **keep pulling upstream updates and merging them with minimal conflicts, without losing the custom features**.

Every decision in this repo should be made with this question in mind:

> "Will this change make the next `git merge upstream/main` harder?"

If yes, find another way to implement it.

---

## Golden rules

1. **Prefer adding over modifying.** New behaviour goes in new files/modules. Editing upstream files is a last resort.
2. **Keep edits to upstream files tiny.** A one- to three-line hook/import/registration is acceptable. Refactors, reformatting, renames, or moving code in upstream files are **not**.
3. **Never reformat, re-lint, or "clean up" upstream files.** No mass formatting, import sorting, or whitespace changes. Formatting-only diffs are the number one cause of merge conflicts.
4. **Never rename, move, or delete upstream files, functions, classes, routes, DB tables, or config keys.**
5. **Never rewrite upstream history.** No force-pushes to `main`, no rebasing `main` onto upstream. Merge instead.
6. **Every unavoidable upstream edit must be logged** in `FORK_[CHANGES.md](http://CHANGES.md)` (see below).
7. **Don't break existing behaviour.** With all custom features disabled, the app should behave like upstream.

---

## Repository layout conventions

Custom code lives in clearly separated locations so it's easy to see what is ours.

This repository is the **monorepo fork** (`client/`, `server/`, `shared/`), so the
generic paths below are mapped like this — this mapping is fixed, do not invent a
second convention:

| Purpose | Location |
| --- | --- |
| Custom server business logic | `server/src/custom/**/*.custom.ts` |
| Custom server API routes | `server/src/custom/routes/*.custom.ts` — each exports an Express `Router` (default export), mounted only from `server/src/custom/register.custom.ts` |
| Custom server middleware | `server/src/custom/middleware/*.custom.ts` |
| Custom server libs | `server/src/custom/lib/*.custom.ts` |
| Custom weather code | `server/src/custom/weather/*.custom.ts` |
| Custom AI code | `server/src/custom/ai/*.custom.ts` |
| Custom client pages | `client/src/custom/pages/*.custom.tsx` |
| Custom client components | `client/src/custom/components/*.custom.tsx` |
| Custom client hooks/libs | `client/src/custom/hooks/*.custom.ts`, `client/src/custom/lib/*.custom.ts` |
| Custom translations | `client/src/i18n/locales/<lng>/<feature>.custom.json` — namespace `<feature>.custom`, used as `t('<feature>.custom:key')`. Never add keys to an upstream locale file |
| Custom server tests | `server/test/*.custom.test.ts` (matches the server's `tsx --test test/*.test.ts`) |
| Custom DB migrations | Appended to `coreMigrations` in `server/src/migrations/registry.ts`, id in the reserved `custom/` namespace: `custom/NNNN-description` (not `core/`, not `custom_YYYYMMDD_…` — `ID_PATTERN` in `migrations/runner.ts` accepts only `<namespace>/<0001>-<name>`) |
| Custom env vars | `.env.example`, `# --- Custom ---` section at the end of the file, names prefixed `CUSTOM_` |
| Feature flags | `CUSTOM_FEATURE_<NAME>_ENABLED` (default: enabled when unset). Read only through `server/src/custom/features.custom.ts` |
| Custom deploy assets | `deploy/`, `docker-compose.override.yml`, `client/nginx.conf` |
| Fork change ledger | `FORK_CHANGES.md` (root) |

Rules that follow from the mapping:

- **The only upstream file that knows about custom routes is `server/src/app.ts`**, through a single
  `registerCustomRoutes(app)` hook. A new custom route is mounted inside
  `server/src/custom/register.custom.ts`, never by adding a line to `app.ts`.
- **The client's upstream files know about custom code only through `client/src/custom/`**:
  `App.tsx` mounts `<CustomRoutes />`, `components/layout/Layout.tsx` appends
  `customNavigation` / `customMobileTabs`. Everything else is a custom file.
- A custom module key used for gating is declared in `server/src/custom/features.custom.ts`.
  When its `CUSTOM_FEATURE_*_ENABLED` flag is off, the server reports the key in
  `disabled_modules` (see `routes/auth.ts`), which hides the client's nav entry and
  dashboard widget through the existing mechanism — no client-side flag plumbing.


If a custom file must live inside an upstream directory (framework conventions often require this), use a recognizable suffix or prefix, e.g. `feature-name.custom.ts` or `custom_feature_[name.py](http://name.py)`.

---

## How to implement features safely

### 1. Extend, don't edit

- Use composition, wrappers, subclasses, plugins, middleware, hooks, event listeners, or dependency injection instead of changing upstream code.
- If upstream exposes extension points (plugins, config, events, slots, theming), use them first.
- If you need to change upstream behaviour, wrap or override it from custom code where possible.

### 2. When an upstream file *must* be touched

Keep the diff minimal and wrap it in markers so it's easy to find and re-apply after a merge:

```
// FORK-START: short-feature-name
import { registerCustomRoutes } from "./custom/routes";
registerCustomRoutes(app);
// FORK-END: short-feature-name

```

(Use the file's native comment syntax: `#`, `<!-- -->`, etc.)

Rules for these edits:

- Insert **new lines** rather than modifying existing lines whenever possible.
- Prefer a single registration/import line that delegates to custom code.
- Never leave upstream lines commented out; if upstream code must be disabled, use a flag or override from custom code.
- Add an entry to `FORK_[CHANGES.md](http://CHANGES.md)` immediately.

### 3. Database / schema

- Never alter or drop upstream tables, columns, or existing migrations.
- Add **new tables** with a distinct prefix (e.g. `custom_`), or add **new migrations** that only append.
- If you need extra data on an upstream entity, prefer a separate table keyed by the upstream ID over adding columns to upstream tables.
- Custom migrations must be ordered so they don't collide with upstream's future migrations (use a distinct naming scheme or timestamp prefix, and re-check ordering after each upstream merge).
- **The migration namespace to use is `custom`, not `core`:** `custom/0001-<name>`. `core` is upstream's sequence, and its next migration will take `core/0007` (see `FORK_CHANGES.md`). The id format `<namespace>/<0001>-<name>` is enforced by `ID_PATTERN` in `server/src/migrations/runner.ts`.
- **Once a migration has shipped its id and SQL are frozen.** The runner records `id` + SQL checksum in `openfamily_schema_migrations`: a renamed id re-runs its statements, and edited SQL fails startup. Fix a mistake with a new migration. (The two fork migrations were renamed once, before upstream shipped a `core/0007` that would have collided — see `FORK_CHANGES.md`, "The rename, and why it is safe".)
- **Every statement must be idempotent** (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). The historical list in `db.ts` re-runs on every start, and a renamed id re-runs once, so a non-idempotent statement eventually corrupts data instead of failing loudly.

### 4. Configuration &amp; environment

- Add custom settings under a distinct namespace/prefix (e.g. `CUSTOM_*` env vars, a `custom` config section).
- Don't change upstream defaults. Put overrides in custom config files.
- Document every new variable in `.env.example` under a `# --- Custom ---` section placed at the end of the file.

### 5. Dependencies

- Add new dependencies only when necessary, and list them in `FORK_[CHANGES.md](http://CHANGES.md)`.
- Don't bump versions of upstream's existing dependencies. If a bump is required, log it with the reason.
- Be aware lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, etc.) conflict often. See "Resolving conflicts" below.

### 6. Feature flags

- Gate significant custom features behind a flag (e.g. `CUSTOM_FEATURE_X_ENABLED`) so they can be disabled to compare against upstream behaviour or bisect a merge problem.

### 7. UI / styling

- Prefer new components and new stylesheets over editing existing ones.
- Override styles via theme/config or higher-specificity custom CSS, not by editing upstream stylesheets.
- Don't change upstream copy/translation strings. Add new keys in a custom translation file.

### 8. Tests

- Add tests for all custom features in custom test locations.
- Don't modify upstream tests. If an upstream test fails because of a custom change, fix the custom code, not the test (unless the change is unavoidable and logged).

---

## `FORK_[CHANGES.md](http://CHANGES.md)` (required ledger)

Maintain this file at the repo root. It is the source of truth for every place where this fork diverges from upstream in files that upstream owns.

Format:

```markdown
# Fork Changes

## Custom features (new files only)
- **Feature name**: short description. Location: `custom/feature-x/`. Flag: `CUSTOM_FEATURE_X_ENABLED`.

## Modifications to upstream files
| File | Lines/Marker | Why | Re-apply notes |
|------|--------------|-----|----------------|
| `src/app.ts` | `FORK-START: feature-x` | Registers custom routes | Re-add after the router setup block if upstream moves it |

## Dependency changes
- `package-name@x.y.z`: reason

## Custom migrations
- `custom_20250101_add_foo`: description

## Known upstream conflicts & resolutions
- (date) file: what conflicted and how it was resolved

```

**Update this file in the same commit as the change it describes.**

---

## Git setup &amp; branch strategy

### Remotes

```bash
git remote add upstream https://github.com/NexaFlowFrance/OpenFamily.git   # one-time
git remote -v   # origin = my fork, upstream = original repo

```

### Branches

This fork uses a **pristine-upstream `main` + integration branch** layout, which
keeps every upstream merge a fast-forward and puts the fork's custom work in one
place:

- `main`: an untouched mirror of `upstream/main`. No custom commits, ever — that
  is what makes `git merge upstream/main` conflict-free on this side.
- `develop`: the fork's integration branch (all custom features, merged). This is
  the branch that merges upstream and the branch to deploy from.
- `feature/<name>`: one branch per custom feature, branched from `develop`,
  merged back via PR (current: `budget`, `meteo`, `meal`).
- `sync/<date>`: temporary branch for each upstream merge (see below).

> History note: `AGENTS.md` originally described `main` as "upstream + my
> features". Reality (checked 2026-10-10: `git rev-list --left-right --count
> main...upstream/main` = `0 0`) is the layout above. Moving the features onto
> `main` is a deliberate maintainer decision, not a routine cleanup: it would
> diverge `main` from upstream (no more fast-forward syncs) and start upstream CI
> on `main` (`ci.yml` triggers on that branch).


### Commit conventions

- Keep custom commits **small and focused**, one logical change per commit.
- Never mix upstream-file edits and custom-file additions in the same commit when avoidable; it makes conflicts easier to resolve and revert.
- Prefix messages so fork work is searchable:
  - `custom(feature-x): add ...`
  - `fork-hook(feature-x): register custom routes in app.ts`
  - `sync: merge upstream/main (YYYY-MM-DD)`
  - `fix(custom): ...`

---

## Upstream sync procedure

Run this regularly (e.g. every upstream release, or monthly) so each merge stays small.

```bash
# 1. Fast-forward main onto upstream (no custom commits, so this never conflicts)
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main

# 2. Review what is coming, from develop's point of view
git log --oneline develop..upstream/main            # upstream commits we lack
git diff --stat develop...upstream/main             # files changed upstream

# 3. Do the merge on a throwaway branch off develop
git checkout develop
git checkout -b sync/$(date +%Y-%m-%d)
git merge upstream/main         # use merge, NOT rebase

# 4. Resolve conflicts (see rules below), then:
#    install deps, run migrations, build, run ALL tests
git add -A
git commit                      # keep the default merge message, prefix with "sync:"

# 5. Verify, then merge into develop
git checkout develop
git merge --no-ff sync/$(date +%Y-%m-%d)
git push origin develop

# 6. Delete the throwaway branch
git branch -d sync/$(date +%Y-%m-%d)

```

### Before merging, check for risky upstream changes

Look at the upstream diff for:

- Renamed/moved/deleted files that appear in `FORK_[CHANGES.md](http://CHANGES.md)`
- Changed function signatures/APIs/interfaces that custom code calls
- New or changed DB migrations (check ordering vs. custom migrations)
- Dependency or runtime version bumps
- Changes to config/env variables

If any custom code depends on something that changed, adapt the **custom** code (or the hook) rather than reverting upstream.

### Enable `rerere` (remember conflict resolutions)

```bash
git config rerere.enabled true

```

Git will then reuse earlier conflict resolutions in future merges.

### Resolving conflicts

1. **Upstream files with FORK markers**: take upstream's version, then re-apply the marked block from `FORK_[CHANGES.md](http://CHANGES.md)`.
2. **Lockfiles**: take upstream's version (`git checkout --theirs <lockfile>`), then re-install to re-add custom dependencies. Never hand-edit lockfiles.
3. **Generated files** (build output, compiled assets, schema dumps): regenerate, don't hand-merge.
4. **Migrations**: keep both sets; fix ordering/naming so custom migrations still apply after upstream's.
5. **Genuine logic conflicts**: understand upstream's intent first. Prefer upstream's new code + re-implement the custom behaviour through an extension point.
6. After resolving, update `FORK_[CHANGES.md](http://CHANGES.md)` (including "Known upstream conflicts &amp; resolutions").

### After merging, verify

- \[ \] App builds and starts
- \[ \] Upstream tests pass
- \[ \] Custom tests pass
- \[ \] Migrations run cleanly on a fresh DB **and** on an existing DB
- \[ \] Custom features work with their flags on; app behaves like upstream with flags off
- \[ \] `FORK_[CHANGES.md](http://CHANGES.md)` is accurate

---

## Contributing fixes back upstream (optional)

If a fix or improvement is generic (not specific to this fork):

1. Branch from `upstream/main` (not from `main`).
2. Make the change without any custom code.
3. Open a PR to the upstream repo.
4. Once merged upstream, it will arrive through the normal sync, and you can remove any local workaround.

Upstreaming small extension points (hooks, events, config options) is the best way to reduce long-term fork maintenance.

---

## Checklist for agents before finishing any task

- \[ \] Did I put new code in custom locations rather than editing upstream files?
- \[ \] If I edited an upstream file, is the diff minimal, marked with `FORK-START/END`, and logged in `FORK_[CHANGES.md](http://CHANGES.md)`?
- \[ \] Did I avoid reformatting, renaming, moving, or deleting upstream code?
- \[ \] Are new DB objects, env vars, and config keys namespaced as custom?
- \[ \] Are custom features behind a flag where appropriate?
- \[ \] Did I add or update tests for custom code, without modifying upstream tests?
- \[ \] Are commits small, focused, and prefixed per the conventions above?
- \[ \] Would `git merge upstream/main` still be easy after this change?

## When unsure

Ask the maintainer before:

- Modifying more than a few lines of any upstream file
- Changing an upstream DB schema or API contract
- Upgrading a core dependency or runtime version
- Removing or disabling any upstream feature

Default to the safest option: **add new, wrap existing, never rewrite.**