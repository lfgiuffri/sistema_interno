---
name: sistema-interno-frontend
description: Build frontend features in the Sistema Interno (Vue 3 + Ionic 8 + Vite + Capacitor + Pinia + Tailwind, one codebase → Web/APK/iOS). Use when adding/modifying a page, Pinia store, composable, route, or the shell/nav under frontend/src. Covers the permission-aware shell, the design system, feature stores and Ionic single-codebase conventions.
---

# Sistema Interno — Frontend

Vue 3 `<script setup lang="ts">`, Ionic 8, Vite, Capacitor (Android/iOS/Web from one codebase), Pinia, vue-router 4, Tailwind with a **design system of our own**.

## Structure
- `services/api.ts` — axios + envelope `{success,code,data,meta}` + auto-refresh interceptor (`x-access-token`). `services/socket.ts` — Socket.IO client (token in the handshake).
- `config/nav.ts` — **single source of truth for the menu**, consumed by the shell (to paint it) and by the router (to pick the landing route). Exports `NAV`, `gruposVisibles(canAny)`, `primeraRutaVisible(canAny)`.
- `stores/` — **feature-scoped Pinia setup stores** (never a mega-store): `auth` (login/MFA/logout), `me` (`loadContext()` → GET /me; `can(cap)` / `canAny(modulo)`), `users`, `roles`, `mfa` + one per module, and `reset.ts` (clears everything on logout — **register every new store there**).
- `views/` — `LoginPage`, `AppShell` (split-pane menu grouped and filtered by capabilities), and one folder per module.
- `composables/` — `useCatalogo` (+ `CatalogoPage.vue`: **reuse it for any small ABM**), `useAutoRefresh`, `useTheme`, `useToast`, `useEscapeToClose`, `useFormato`, `useCsv`, `useArchivosProtegidos`.

## Design system (PRD §7.0)
Zinc neutrals + ONE emerald accent (`#0F7660`), sober Linear/Notion feel, 1px borders, almost no shadows, medium density (44px rows), **Geist** typeface. No indigo/purple. **No emojis in the UI** — ionicons `*-outline`.

Tokens are CSS vars `--s-*` in `theme/global.css`, mapped in `tailwind.config.js` (`bg-surface`, `text-ink`, `border-line`, `bg-accent`, …). Light theme by default, dark via the `.dark` class (`useTheme`, persists and follows the system).

**Use the composed classes before inventing styles**: `ds-card`, `ds-btn-{primary,secondary,ghost,danger}`, `ds-input`, `ds-label`, `ds-error`, `ds-hint`, `ds-badge-*`, `ds-table`, `ds-skeleton`, `ds-modal(-backdrop|-lg|-xl)`, `ds-enter`.

## To add a feature page
1. Create `stores/<feature>.ts` (setup store: refs, computed, async actions over `api`) and register it in `stores/reset.ts`.
2. Create `views/<feature>/<Feature>Page.vue`: root `<IonPage>`, load data in `onIonViewWillEnter` (**not** `onMounted` — Ionic caches pages), gate actions with `meStore.can('<feature>:create')`, and ALWAYS handle the three states: loading (skeleton), empty and error.
3. Add a lazy route in `router/index.ts` and an entry in `config/nav.ts` (`module: '<feature>'`).
4. For a small ABM, skip all of the above and reuse `CatalogoPage.vue` + `useCatalogo`.

## Conventions (non-negotiable)
- `<script setup lang="ts">`, strict types, **`vue-tsc` must stay green**. No `any`.
- Spanish (es-AR) copy. JSDoc on non-obvious functions, comments explaining the *why*.
- The menu and the landing route derive from `config/nav.ts` + capabilities; never hardcode visibility.
- **Modals/overlays go inside `<Teleport defer to="ion-app">`**: `ion-app` creates a stacking context (`position:absolute; z-index:0; contain:layout`) that traps anything rendered outside it — an alert would appear *behind* a modal. `defer` is required or the teleport target isn't found yet.
- Dropdowns that must escape an `overflow` container use fixed positioning + the same teleport (see `EstadoMenu.vue`).
- Ionic route caching: two routes with the same shape and param names get confused — use **distinct param names** across modules (see the `:deid`/`:dlid` note in `router/index.ts`).

## Verify
`cd frontend && npm run build` (vue-tsc --noEmit && vite build) must be GREEN. For UI e2e: `npx vite preview --port 8100` + the `ui` project of the `sistema-interno-tests` skill.

## ⚠️ SYNC RULE (mandatory)
Adding/changing a page, store, route or nav entry → update `docs/` + the e2e specs + (if conventions change) this skill and the other `sistema-interno-*` skills, in the same change.
