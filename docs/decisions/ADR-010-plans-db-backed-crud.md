# ADR-010 — Planes DB-backed con CRUD, versionado y cache de gating

- **Status**: Aceptado
- **Date**: 2026-07-01

## Context

La definición de planes vivía en `config/plans.js` (objeto estático), consumida **síncronamente**
en el hot-path de gating (`moduleGate.planGate`). El super-admin podía cambiar el plan/overrides
*por tenant* pero **no editar la definición global** de un plan (módulos/límites) ni crear planes
nuevos. `Tenant.plan` era un **ENUM** fijo (`free/basic/premium/enterprise/ultimate`), lo que
impedía referenciar planes creados dinámicamente. (Roadmap #5.)

## Decision

Hacer los planes **DB-backed** manteniendo el gating síncrono vía un **cache en memoria**:

1. **Modelos master** `Plan` (fuente de verdad: `name`, `label`, `description`, `modules` JSON,
   `limits` JSON, `order`, `active`, `isSystem`) y `PlanVersion` (audit: snapshot + `version`
   incremental + `action` + `changedBy` por cada mutación).
2. **Seed**: `initMasterDb` siembra `plans` desde `DEFAULT_PLANS` (ex-`PLANS`) si está vacía →
   comportamiento por defecto preservado.
3. **Cache + helpers síncronos** (`config/plans.js`): `loadPlansFromDb()` carga la tabla a un mapa
   en memoria; los helpers (`planAllowsModule`, `getPlanLimit`, …) leen el cache con **fallback a
   `DEFAULT_PLANS`** si no cargó (el gating nunca rompe). Se carga al boot (tras init de master DB)
   y **se recarga en cada mutación**. `planGate` no cambia (sigue síncrono, sin tocar DB).
4. **CRUD** `/master/plans` (super_admin): `GET /` (catálogo), `POST /`, `PUT /:name`,
   `DELETE /:name`, `GET /:name/versions`. Patrón controller-helper (`plans.service.js`).
   - **DELETE** bloquea: `403` si `isSystem` (ej. `free`), `409` si algún tenant usa el plan
     (hay que reasignarlo antes). Cada mutación versiona en `planVersions`.
5. **`Tenant.plan` ENUM → VARCHAR(50)** (migración master `0002-tenant-plan-varchar.js`,
   idempotente). La validez del valor se chequea contra el registro (fail-closed) en el validator
   y en `tenants.controller` (ambos ahora dinámicos, no lista hardcodeada).

## Consequences

- El super-admin puede **crear/editar/borrar planes arbitrarios** desde la API (y la UI, pendiente)
  y **asignarlos a tenants**; el gating los toma sin redeploy (recarga de cache).
- Historial de cambios por plan (auditable / base para revertir).
- Gating sigue O(1) en memoria; una mutación implica una recarga del cache (single-process).
  **Follow-up**: en despliegue multi-proceso, invalidar el cache vía pub/sub Redis (hoy la app es
  single-process en dev). El `version` de `PlanVersion` se calcula con `max+1`: correcto para uso
  de un solo admin; bajo escritura concurrente extrema, serializar.
- `customDomain` de tenants sigue con heurística `!['free','basic'].includes(plan)` (planes nuevos
  → con dominio). Configurable por plan a futuro si hace falta.
- Sin regresiones: suite e2e API 67/67. CRUD verificado (crear/editar/versionar/borrar + 403/409 +
  asignar plan custom a un tenant).
