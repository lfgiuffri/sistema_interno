# ADR-003 — Authz por capabilities (no por nombre de rol)

- **Status**: Aceptado
- **Date**: 2026-06-30

## Context

Hay que autorizar acciones por endpoint en un sistema multi-tenant donde cada tenant puede crear roles custom y los módulos son pluggable (no se conocen de antemano todas las acciones). Chequear por **nombre de rol** (`if role === 'admin'`) no escala: acopla las rutas a roles concretos y rompe con roles custom.

## Decision

**Authz capability-based, deny-by-default.**

- Las acciones se modelan como capabilities `modulo:accion` (ej. `items:create`). Los módulos las **declaran** en su manifest (`registerCapabilities`).
- La **asignación** de capabilities a roles vive en la tabla `RoleCapability` del tenant. El comodín `*` = todas (rol admin del tenant).
- Cada ruta de módulo declara su capability con `requireCapability(cap)` (`kernel/capability.js`), que corre tras `verifyAccessToken`, resuelve las capabilities del rol (cacheadas en Redis 5 min) y autoriza si el rol tiene `cap` o `*`. Si no → 403.

## Alternatives

- **Chequeo por nombre de rol**: simple pero rígido; no soporta roles custom ni módulos drop-in.
- **Permisos por ruta en DB (RBAC clásico de `verifyPermissions`)**: se mantiene para la infra del core/users (rutas estables), pero para los módulos feature se prefiere capabilities (más alineado con el manifest y el gating por plan).

## Consequences

- **+** Roles custom funcionan sin tocar código; un módulo nuevo trae sus propias capabilities.
- **+** Deny-by-default: si el rol no tiene la capability (ni `*`), se deniega (fail-closed).
- **+** El admin del tenant solo puede otorgar capabilities que existan y estén dentro de su plan (gating).
- **−** Hay que mantener el catálogo de capabilities y el seed de roles; invalidar el cache al cambiar permisos (`invalidateRoleCapabilities`).
- Conviven dos mecanismos de authz: `verifyPermissions` (infra) y `requireCapability` (módulos + billing/webhooks). Documentado para no confundir.
