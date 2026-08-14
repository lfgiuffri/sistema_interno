---
name: sistema-interno-tests
description: Write and run the Sistema Interno Playwright e2e suite (api/ui/websocket). Use when adding/modifying tests under e2e/, testing a new module/endpoint, or running the suite. Covers fixtures, helpers, web-first assertions, how to boot the stack for a real run, and the maintenance rule.
---

# Sistema Interno — E2E Tests (Playwright)

Suite at `e2e/`. Three projects: **api** (HTTP, parallel by default), **ui** (browser), **websocket** (Socket.IO). The long-form guide is `e2e/CLAUDE.md`.

## Structure
- `playwright.config.ts` — 3 projects; backend default `:3010` (`BACKEND_URL` / `PORT`).
- `global-setup.ts` — creates (idempotently) a stable **fixture user** with a narrow role (`areas:*` + `usuarios:read`) and syncs its capabilities if they changed.
- `fixtures/auth.fixture.ts` — `adminApi` (capability `*`), `authedApi` (the narrow fixture user — this is how you prove deny-by-default), `unauthApi`, `tokens`/`adminTokens`. `fixtures/app.fixture.ts` — `authedPage` / `adminPage`.
- `helpers/constants.ts` — `API_BASE`, `APP_ENDPOINTS`, `ROUTES`, factories (`makeNombre`, `makeUser`, `makeRole`). `helpers/response.ts` — `expectSuccess/expectSuccessData/expectError/expectPagination`. `helpers/hardCleanup.ts` — `hardDeleteByPath` (best-effort SQL cleanup, knows each entity's children). `helpers/selectors.ts` — shell selectors.
- `tests/api/mNN-*.spec.ts`, `tests/ui/`, `tests/ws/`.

## Conventions
- **Web-first assertions** (`await expect(locator).toBeVisible()`); **NO `waitForTimeout`** — the suite must stay clean of it. For sockets, `waitForEvent`.
- Role/label-based locators in UI; the `SEL` map only for stable shell elements.
- Status codes: no token → **401** · missing capability → **403** (the message names the capability) · validation → **422** · business error → **400** (**409** for "in use" / "exists deleted").
- Envelope `{ success, code, message, timestamp, data?, meta? }` — always via the `response.ts` helpers.
- **Never depend on the username `admin`** (the legacy migration deletes it): resolve the admin from `GET /me`, and allow `ADMINUSER`/`ADMINPASS` overrides.
- Tests that share state across steps → `test.describe.configure({ mode: 'serial' })`; otherwise the parallel `api` project interleaves them.
- Clean up what you create in `afterAll` (API delete + `hardDeleteByPath`).

## To add tests for a new module
1. Add its path to `helpers/constants.ts → APP_ENDPOINTS` (+ the table mapping in `hardCleanup.ts` if it has children).
2. Add `tests/api/mNN-<feature>.spec.ts` covering: happy path, 401, 403 with `authedApi`, 422, 404, pagination when it applies, and the module's real business rules.
3. Add a minimal `tests/ui/` spec if the feature has a page.
4. Add `test:mNN` to `e2e/package.json`.
5. `npx playwright test --list` must stay green (specs parse).

## Running for real (the stack must be up)
1. Backend: `cd backend && npm run init_db` (seeds `admin`/`ADMINPASS`) then `npm run dev` on :3010.
2. Frontend (only for the `ui` project): `cd frontend && npm run dev` (or `npm run build && npx vite preview --port 8100`); install the browser once with `npx playwright install chromium`.
3. `cd e2e && npx playwright test` (or `--project=api` / `--project=ui` / `--project=websocket`).

⚠️ **The suite creates and deletes real rows** in the database `backend/.env` points at. Never aim it at production.

- **Gotcha**: `babel src --out-dir build` can leave a stale file behind; if runtime disagrees with the source, `rm -rf build && npm run build`.

## ⚠️ SYNC RULE
Every backend/frontend change → add or update the matching e2e test in the same change. Keep the suite green and `waitForTimeout`-free. If conventions change, update this skill.
