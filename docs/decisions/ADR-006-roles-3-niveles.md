# ADR-006 — RBAC de 3 niveles (dónde vive cada rol)

> ⚠️ **Histórico.** Este ADR describe la base **Zero 2.0** (el starter SaaS multi-tenant
> del que nace el Sistema Interno), no la app actual: acá no hay tenants, planes ni
> billing. Se conserva como registro de por qué la base era así. Ver
> [ADR-015](ADR-015-single-tenant-conversion.md).


- **Status**: Supersedido por ADR-003 (capabilities) y ADR-015
- **Date**: 2026-06-30

## Context

En un SaaS multi-tenant hay tres clases de actor: quien opera la **plataforma** (la empresa que desarrolla Zero), quien **paga** un tenant (su dueño) y los **usuarios finales** del cliente. Lo crítico no es solo qué puede cada uno, sino **dónde vive** cada nivel, para evitar escalación de privilegios (que un admin de tenant se auto-asigne poderes de plataforma).

## Decision

**Tres niveles, con separación de privilegios por ubicación.**

| Nivel | Quién | Scope | Cómo se enforce |
|-------|-------|-------|-----------------|
| `super_admin` | Zero / la empresa | Plataforma (master DB) | `MasterUser` + `masterOnly`/`x-master-key`/`verifyAdmin`. **NO es un rol de tenant.** |
| `admin` | Cliente que paga | Tenant (rol de sistema, `*`) | `Role` con RoleCapability `['*']`. Crea roles custom, asigna capabilities, gestiona su suscripción. |
| `user` | Usuario final | Tenant (rol de sistema, mínimo) | `Role` con subset, deny-by-default. |
| *(custom)* | Creados por el admin | Tenant | subset de capabilities, acotado al plan. |

Reglas: `super_admin` nunca es una fila `Role` de tenant (si lo fuera, un admin podría auto-asignárselo → escalación). Los roles de sistema (`admin`, `user`) no se borran/renombran. Un usuario no modifica su propio rol/capabilities; el admin solo otorga capabilities que existan y estén dentro de su plan.

## Alternatives

- **Un solo nivel de roles dentro del tenant** (incluyendo "super admin"): simple pero abre la puerta a escalación entre tenant y plataforma.
- **Roles fijos sin capabilities ni roles custom**: insuficiente para clientes que necesitan granularidad.

## Consequences

- **+** Imposible escalar de tenant a plataforma: el `super_admin` vive en otra DB y se autentica con `x-master-key`.
- **+** El cliente arma su propia jerarquía (roles custom) dentro de los límites de su plan.
- **+** Seed de tenant nuevo: `admin` con `['*']` + `user` mínimo.
- **−** Hay dos universos de usuario (`MasterUser` de plataforma y `User` de tenant) que deben mantenerse coherentes (ej. password sync en `change-password`).
