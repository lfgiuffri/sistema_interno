# ADR-011 — Split marketing/app en una sola build + endpoint público de planes

- **Status**: Aceptado
- **Date**: 2026-07-01

## Context

Zero 2.0 pasa a venderse como **producto**: `zero.com.ar` debe ser una web pública (hero,
features, **pricing con planes reales**, docs, CTAs a login/registro), y la app real vive en
`app.zero.com.ar` (SPA de tenant) contra `api.zero.com.ar` (API). `docs/deployment.md` ya asume
los subdominios `app.`/`api.`.

Restricciones: **una sola build** de frontend (Vue 3 + Ionic + Vite) sirve ambos dominios —
no queremos un segundo proyecto ni duplicar el shell. Y el pricing NO puede hardcodearse: los
planes son **DB-backed** (ADR-010) y el super-admin los edita; la landing debe reflejar los
planes **activos** en vivo. Pero el catálogo existente (`GET /master/plans`) exige `super_admin`
y expone metadata interna (versiones, `isSystem`, overrides), inservible para una web anónima.

## Decision

1. **Modo runtime (marketing vs app)** resuelto por `@/config/appMode.ts`, cacheado por sesión:
   - `app.*` (ej. `app.zero.com.ar`) → **app**; dominio raíz (`zero.com.ar`, `www.*`) → **marketing**.
   - `localhost`/IP en dev → **app** por defecto.
   - Overrides para dev/preview (no dependen de DNS): `?view=marketing|app` en la URL (gana sobre
     todo) y `VITE_MARKETING=1` en build/dev.
2. **Ruteo**: la raíz `/` es la **landing** (`meta.marketing`, `views/marketing/MarketingPage.vue`).
   El área de tenant se remonta bajo `/dashboard` (mismas URLs `/dashboard/home|items|settings`).
   El guard decide: en modo **app** la raíz es un atajo a la sesión (logueado→su área, anónimo→
   `/login`); en modo **marketing** un anónimo ve la landing y un logueado entra directo a su área.
   `login`/`signup` siguen enganchando el auth store + self-signup existentes.
3. **Endpoint público** `GET /api/plans/public` (sin auth ni tenant): reusa
   `config/plans.js#getAllPlans` (el mismo cache del gating), filtra `active !== false` y expone
   **solo** campos no sensibles (`key/label/description/modules/allModules/limits/order`, ordenados
   por `order`). Se monta en `routes.js` **antes** del middleware de identificación de tenant para
   quedar accesible de forma anónima. La landing (`PricingSection.vue`) lo consume y arma las
   tarjetas de precios dinámicamente (con estados loading/error).

## Consequences

- Un solo artefacto de frontend cubre marketing y app; el split real es a nivel de DNS/deploy
  (reverse proxy sirviendo la misma SPA en ambos hosts). El modo se decide en el cliente.
- El pricing es un espejo fiel del catálogo activo sin trabajo manual: crear/editar/desactivar un
  plan desde el super-admin se refleja en la web al recargar (mismo cache de gating).
- La landing no filtra nada sensible: el endpoint público es un **proyector de solo lectura** con
  lista blanca de campos; la metadata interna (versiones, `isSystem`, overrides por tenant) nunca sale.
- **Follow-up**: cuando un logueado cae en la raíz `zero.com.ar` se lo redirige a `/dashboard`
  **en el mismo host**; el salto cross-subdominio a `app.zero.com.ar` es una decisión de deploy
  (proxy/redirect) fuera del alcance de este incremento. Documentar el endpoint en OpenAPI queda pendiente.
- Sin regresiones: `vue-tsc --noEmit` 0 errores; suite e2e API **78/78** (+3 tests del endpoint público).
