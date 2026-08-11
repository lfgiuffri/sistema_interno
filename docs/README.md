# Zero 2.0 — Documentación

Base multi-tenant modular para construir apps (backend Node/Express/Sequelize + frontend Ionic/Vue + e2e Playwright).

> Toda esta doc refleja el **código actual**. Al tocar el código, actualizá la doc en el mismo cambio (ver la SYNC RULE en `CLAUDE.md`).

## Empezá acá

- **[architecture/](architecture/README.md)** — multi-tenant, kernel vs módulos, flujo de request, auto-discovery, envelope de respuesta.
- **[modules/](modules/README.md)** — **cómo crear un módulo** paso a paso, copiando `backend/src/modules/items/` (la plantilla canónica).
- **[api/](api/README.md)** — base URL, headers, envelope, paginación, OpenAPI 3 + Scalar, endpoints clave.

## Guías por área

| Doc | Qué cubre |
|-----|-----------|
| [auth.md](auth.md) | signin, Auth0, MFA/TOTP + backup codes + step-up, passwordless (OTP/magic link), self-signup anti-fantasma, argon2id |
| [modularity.md](modularity.md) | manifest + moduleLoader + handlerRegistry + capability + planGate (puntos de extensión) |
| [storage.md](storage.md) | storage pluggable local/S3, tenant-scoped |
| [realtime.md](realtime.md) | Socket.IO: auth, rooms, presencia, broadcast |
| [webhooks.md](webhooks.md) | webhooks salientes firmados (HMAC), reintentos, idempotencia |
| [embeddings.md](embeddings.md) | embeddings + búsqueda semántica genérica |
| [vault.md](vault.md) | secretos cifrados por tenant (AES-256-GCM) |
| [config-registry.md](config-registry.md) | config tipada por secciones (qué es configurable, env vars, secretos enmascarados) |
| [migrations.md](migrations.md) | migraciones versionadas (master + tenants), idempotencia, runner, deploy de código desde el panel |

## Decisiones de arquitectura (ADRs)

`decisions/` — formato Status / Date / Context / Decision / Alternatives / Consequences:

- [ADR-001](decisions/ADR-001-multi-tenant.md) — Multi-tenant: master DB + DB por tenant.
- [ADR-002](decisions/ADR-002-kernel-vs-modules.md) — Separación física kernel/ vs modules/.
- [ADR-003](decisions/ADR-003-capabilities-rbac.md) — Authz por capabilities.
- [ADR-004](decisions/ADR-004-modularity-manifest.md) — Modularidad por manifest + auto-discovery.
- [ADR-005](decisions/ADR-005-billing-vendor-agnostic.md) — Billing vendor-agnóstico.
- [ADR-006](decisions/ADR-006-roles-3-niveles.md) — RBAC de 3 niveles.
- [ADR-007](decisions/ADR-007-argon2-auth-hardening.md) — argon2id + hardening de auth.
- [ADR-008](decisions/ADR-008-architecture-review-deepening.md) — refactors de profundización (architecture review).

## Referencia

- **[best-practices-guidelines.md](best-practices-guidelines.md)** — North Star del proyecto (las prácticas y decisiones que rigen el build).
