---
name: zero-frontend
description: Build frontend features on the Zero 2.0 starter-shell (Vue 3 + Ionic 8 + Vite + Capacitor + Pinia, one codebase → Web/APK/iOS). Use when adding/modifying a page, Pinia store, composable, route, or auth/admin/billing UI under frontend/src. Covers the plan-aware shell, feature stores, the items page template, auth flows (Auth0/MFA/passwordless), and Ionic single-codebase conventions.
---

# Zero 2.0 — Frontend

Generic **starter-shell** (not a finished app): Vue 3 `<script setup lang="ts">`, Ionic 8 (mode md), Vite, Capacitor (Android/iOS/Web from one codebase), Pinia, vue-router 4. Domain features are app-specific; the shell provides auth + multi-tenant session + plan-aware nav + admin + account/billing UI + an example feature.

## Structure
- `services/api.ts` — axios + envelope `{success,code,data,meta}` + auto-refresh interceptor (x-access-token). `services/socket.ts` — Socket.IO client.
- `stores/` — **feature-scoped Pinia setup stores** (never a mega-store): `auth.ts` (login/MFA/passwordless/Auth0/signup, finalizeSession, routing), `modules.ts` (`loadContext()` → GET /me → `enabledModules`/`capabilities`, `hasModule`/`hasCapability`), `items.ts` (example CRUD), `admin.ts`, `billing.ts`, `mfa.ts`.
- `views/` — `LoginPage`, `SignupPage`, `ConfirmPage`, `TabsLayout`, `DashboardPage` (dynamic nav from `modules` store), `dashboard/{HomePage,ItemsPage,settings/*}`, `admin/*`.
- `components/shared/` (AppModal, PageHeader, EmptyState, ...) + `components/settings/` (Setting*).

## To add a feature page: COPY `views/dashboard/ItemsPage.vue` + `stores/items.ts`
`ItemsPage` + `items` store are the canonical template:
1. Create `stores/<feature>.ts` (setup store: state refs, computed getters, async actions calling `api`).
2. Create `views/dashboard/<Feature>Page.vue`: root `<IonPage>`, load data in `onIonViewWillEnter` (NOT onMounted — Ionic caches pages), gate actions with `modulesStore.hasCapability('<feature>:create')`, reuse `AppModal`/`EmptyState`/`PageHeader`.
3. Add a lazy route in `router/index.ts` under the tabs.
4. Add a NAV entry (filtered by `modulesStore.hasModule('<feature>')`) so it appears only when the plan enables it.

## Conventions (non-negotiable)
- `<script setup lang="ts">` + strict types in `src/types/index.ts`. No `any`.
- Every page root = `<IonPage>`; refresh data in `onIonViewWillEnter`.
- **Plan-aware nav**: menu/routes derive from `modules` store (`enabledModules`); never hardcode feature visibility.
- **NO emojis in UI** — use ionicons `*-outline` (`<ion-icon :icon="...">`). Exception: account `icon` emoji fields if any.
- Ionic components only (`ion-input`, `ion-select`, ...). Overlays declarative (`isOpen`/`trigger`).
- Capacitor: `isPlatform()`/`Capacitor.isNativePlatform()` in composables; `capacitor.config.ts` with dev `server.url` gated by env; deep-links for Auth0 callback.
- Spanish (es-AR) copy.
- Env: `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_AUTH0_DOMAIN`, `VITE_MASTER_KEY` (admin), `VITE_TURNSTILE_SITEKEY` (signup captcha).

## Auth flows (already wired in auth store + LoginPage/SignupPage/ConfirmPage)
- Password signin; if `mfaRequired` → code → `/master/auth/mfa/login`. Auth0 social (`useAuth0`, gated by `VITE_AUTH0_DOMAIN`). Passwordless OTP. Self-signup (`/signup` → email confirm `/auth/confirm`).
- super_admin → `/admin`; tenant_user → `/dashboard/home`.

## Verify
`cd frontend && npm run build` (vue-tsc --noEmit && vite build) must be GREEN. To run UI e2e: `npx vite preview --port 8100` + the `zero-tests` UI project.

## ⚠️ SYNC RULE (mandatory)
Adding/changing a page, store, route, or auth flow → update `docs/` + the e2e UI/specs + (if conventions change) this skill and the other `zero-*` skills, in the same change. Keep docs and skills in lockstep with the code.
