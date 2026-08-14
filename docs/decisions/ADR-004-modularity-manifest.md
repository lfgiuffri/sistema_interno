# ADR-004 — Modularidad por manifest + auto-discovery

- **Status**: Aceptado
- **Date**: 2026-06-30

## Context

El objetivo es que agregar/quitar un feature sea drop-in/out, sin editar archivos centrales por cada módulo. Un `routes.js` estático que se edita por módulo choca con eso (cada alta toca un archivo compartido, propenso a conflictos y a olvidar la cadena de middlewares).

## Decision

**Modularidad declarativa por `module.manifest.js` + auto-discovery (loader).**

- Cada módulo feature trae un manifest (`key`, `name`, `version`, `basePath`, `router`, + `capabilities`/`models`/`minPlan`/`dependsOn`/`schedulerHandler`/`socketHandler`).
- `kernel/moduleLoader.js` escanea `modules/*/module.manifest.js` al boot, **valida** (campos, basePaths únicos, dependsOn resueltas; falla fuerte ante errores de forma) y **monta** cada router detrás de la cadena estándar `verifyAccessToken → planGate(key) → router` (con `requireCapability` por ruta dentro del router).
- Las rutas de **infraestructura** (master/core/users/settings/catalogs) siguen montadas explícito en `routes.js` (always-on, orden importa). Híbrido: control explícito para infra, declarativo para features.

## Alternatives

- **Todo estático en `routes.js`**: control total pero edición central por módulo y sin gating uniforme.
- **Registry de módulos solo en DB**: flexible pero indirecto; el manifest en disco es la fuente de verdad y se valida disco-vs-manifest.

## Consequences

- **+** Agregar un módulo = crear su carpeta con manifest; cero edición central; la cadena de middlewares es uniforme y no se puede olvidar.
- **+** El loader falla fuerte ante manifests inválidos (bug del dev visible al boot).
- **+** El manifest declara capabilities/handlers, que el loader registra automáticamente.
- **−** Hay "magia" de auto-discovery: quien no conoce el loader puede sorprenderse de que un router se monte sin tocar `routes.js` (mitigado documentándolo acá y en `docs/modules/`).
- El modelo de datos se sigue descubriendo por `tenantAssociations` (patrón idiomático de Sequelize); el manifest solo lo declara para validar.
