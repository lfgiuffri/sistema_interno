# Sistema Interno — Documentación

App de administración de Positive Media: **single-tenant**, modular (backend Node/Express/Sequelize + frontend Ionic/Vue + e2e Playwright).

> Toda esta doc refleja el **código actual**. Al tocar el código, actualizá la doc en el mismo cambio (ver la SYNC RULE en `CLAUDE.md`).

## Empezá acá

- **[architecture/](architecture/README.md)** — single-tenant, kernel vs módulos, flujo de request, auto-discovery, envelope de respuesta.
- **[modules/](modules/README.md)** — **cómo crear un módulo** paso a paso, copiando `backend/src/modules/areas/` (el módulo chico que sirve de plantilla).
- **[api/](api/README.md)** — base URL, headers, envelope, paginación, OpenAPI 3 + Scalar, endpoints clave.

## Guías por área

| Doc | Qué cubre |
|-----|-----------|
| [auth.md](auth.md) | signin, MFA/TOTP + backup codes + step-up, lockout, argon2id |
| [modularity.md](modularity.md) | manifest + moduleLoader + handlerRegistry + capability + planGate (puntos de extensión) |
| [storage.md](storage.md) | storage pluggable local/S3 |
| [realtime.md](realtime.md) | Socket.IO: auth, rooms, presencia, broadcast |
| [webhooks.md](webhooks.md) | webhooks salientes firmados (HMAC), reintentos, idempotencia |
| [embeddings.md](embeddings.md) | embeddings + búsqueda semántica genérica |
| [vault.md](vault.md) | secretos cifrados (AES-256-GCM) |
| [config-registry.md](config-registry.md) | config tipada por secciones (qué es configurable, env vars, secretos enmascarados) |
| [migrations.md](migrations.md) | migraciones versionadas, idempotencia, runner al boot |
| [modules/mantenimiento.md](modules/mantenimiento.md) | monitoreo de servidores (agente, métricas, umbrales) y de sitios web (marcador, RDAP, TLS), incidentes, alertas y watchdog externo |
| [sql/](sql/) | scripts SQL sueltos para actualizar a mano una base ya en producción (alternativa al runner de migraciones) |
| [migracion-legado.md](migracion-legado.md) | migración de DATOS del sistema PHP legado (`npm run migrar_legado`): mapeo de tablas, permisos → capabilities, usuarios y contraseñas |

## Decisiones de arquitectura (ADRs)

`decisions/` — formato Status / Date / Context / Decision / Alternatives / Consequences:

- [ADR-015](decisions/ADR-015-single-tenant-conversion.md) — Conversión a single-tenant (**la decisión vigente**).
- [ADR-001](decisions/ADR-001-multi-tenant.md) — Multi-tenant: master DB + DB por tenant *(histórico: la base Zero 2.0)*.
- [ADR-002](decisions/ADR-002-kernel-vs-modules.md) — Separación física kernel/ vs modules/.
- [ADR-003](decisions/ADR-003-capabilities-rbac.md) — Authz por capabilities.
- [ADR-004](decisions/ADR-004-modularity-manifest.md) — Modularidad por manifest + auto-discovery.
- [ADR-005](decisions/ADR-005-billing-vendor-agnostic.md) — Billing vendor-agnóstico *(histórico: la base Zero 2.0)*.
- [ADR-006](decisions/ADR-006-roles-3-niveles.md) — RBAC de 3 niveles *(histórico: hoy son capabilities, ADR-003)*.
- [ADR-007](decisions/ADR-007-argon2-auth-hardening.md) — argon2id + hardening de auth.
- [ADR-008](decisions/ADR-008-architecture-review-deepening.md) — refactors de profundización (architecture review).

## Referencia

- **[best-practices-guidelines.md](best-practices-guidelines.md)** — North Star del proyecto (las prácticas y decisiones que rigen el build).
