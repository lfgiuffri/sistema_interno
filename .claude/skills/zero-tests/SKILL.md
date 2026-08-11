---
name: zero-tests
description: Write and run the Zero 2.0 Playwright e2e suite (api/ui/websocket). Use when adding/modifying tests under e2e/, testing a new module/endpoint, or running the suite. Covers fixtures, the create-tenant helper, web-first assertions, how to boot the stack for a real run, and the maintenance rule.
---

# Zero 2.0 — E2E Tests (Playwright)

Suite at `e2e/`. Three projects: **api** (HTTP, fully parallel), **ui** (browser, sequential), **websocket** (Socket.IO).

## Structure
- `playwright.config.ts` — 3 projects; backend default `:3010`.
- `global-setup.ts` — creates a stable **fixture tenant** (plan premium) via the admin API, idempotent.
- `fixtures/auth.fixture.ts` — `authedApi` (tenant-admin token, cached per worker), `unauthApi`, `masterApi` (super_admin), `tokens`. `fixtures/app.fixture.ts` — `authedPage`, `navigateTo`, shell routes.
- `helpers/constants.ts` — `API_BASE`, endpoint maps, `ROUTES`, factories `makeItem/makeTenant/makeSignup`. `helpers/response.ts` — `expectSuccess/expectError/expectPagination/expectAuthResponse`. `helpers/tenantHelper.ts` — `createTenantAndLogin(masterApi, request, { plan })` (admin creates a tenant → logs in as its admin). `helpers/selectors.ts` — shell selectors.
- `tests/api/mNN-*.spec.ts`, `tests/ui/`, `tests/ws/`.

## Conventions (best-practice — docs/best-practices-guidelines.md §9)
- **Web-first assertions** (`await expect(locator).toBeVisible()`); **NO `waitForTimeout`** (grep the suite — it must stay clean of it).
- Role/label-based locators in UI; the `SEL` map only for stable shell elements.
- API vs UI strictly separated. Validation errors are **422**; business errors **400**; admin routes without super_admin → **403**; not found → **404** (or **403** if a non-whitelisted path is denied first by verifyPermissions — deny-by-default).
- Envelope `{ success, code, data, meta }`. Use the `response.ts` helpers.
- Tests that need a tenant: create a FRESH one per run via `createTenantAndLogin` (factories use unique ts+rnd names/emails to avoid cross-run collisions). Cleanup is best-effort (soft delete / leave test DBs).

## To add tests for a new module
1. Add endpoints to `helpers/constants.ts` + a `make<Entity>()` factory.
2. Add `tests/api/mNN-<feature>.spec.ts`: happy path, 401 (no token), 422 (bad input), capability/plan gating (403 when not allowed), pagination if applicable.
3. UI: a minimal spec in `tests/ui/` if the feature has a page.
4. Add `test:mNN` to `e2e/package.json`.
5. `npx playwright test --list` must stay green (specs parse).

## Running for real (the whole stack must be up)
1. Backend: `cd backend && npm run init_master_db` (seeds super_admin admin/admin123) then `node build/index.js` (or `npm run dev`) on :3010.
2. Frontend (only for the `ui` project): `cd frontend && npm run build && npx vite preview --port 8100`; install browser once with `npx playwright install chromium`.
3. `cd e2e && npx playwright test` (or `--project=api` / `--project=websocket` / `--project=ui`).
- **Gotcha (learned the hard way)**: after changing a backend model column, OLD tenant DBs have schema drift — re-sync them (admin `/sync`) or, in dev, drop the `zero_*`/`zero2_*` test DBs + reinit master so the fixture is recreated with the current schema. NEVER drop `lifesync_*`.
- **Gotcha**: `babel src --out-dir build` can leave a stale file in-place; if runtime disagrees with source, do a clean `rm -rf build && npm run build`.

## ⚠️ SYNC RULE
Every backend/frontend change → add/update the matching e2e test in the same change. Keep the suite green and `waitForTimeout`-free. If conventions change, update this skill.
