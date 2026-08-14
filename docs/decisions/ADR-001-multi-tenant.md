# ADR-001 — Multi-tenant: base maestra + DB por tenant

> ⚠️ **Histórico.** Este ADR describe la base **Zero 2.0** (el starter SaaS multi-tenant
> del que nace el Sistema Interno), no la app actual: acá no hay tenants, planes ni
> billing. Se conserva como registro de por qué la base era así. Ver
> [ADR-015](ADR-015-single-tenant-conversion.md).


- **Status**: Supersedido por ADR-015
- **Date**: 2026-06-30

## Context

Zero 2.0 es una base para apps SaaS que sirven a múltiples clientes (tenants) que no deben ver datos de otros. Hay que decidir el modelo de aislamiento de datos: schema compartido con columna `tenantId`, schema por tenant, o base de datos por tenant.

## Decision

**Base maestra + una base de datos por tenant.**

- Una base maestra (`zero_master`) gestiona la plataforma: `tenants`, `masterUsers`, `globalConfigs`, `subscriptions`, `paymentEvents`, `signupRequests`, `loginTokens`. Modelos en `kernel/master/models/`.
- Cada tenant tiene su propia DB (nombre en `Tenant.dbName`). Las conexiones se crean **lazy** (al primer request del tenant) y se **cachean** (`masterDatabase.js`). Los modelos del tenant se instancian y cachean por conexión en un `WeakMap` (`tenantAssociations.js`).
- El tenant se identifica en `middlewares/tenantMiddleware.js` por `x-api-key` o por el `tenantId` del JWT, dejando `req.tenant`/`req.tenantDb`/`req.models`.

## Alternatives

- **Schema compartido + `tenantId` por fila**: más simple de provisionar, pero todo el aislamiento depende de no olvidar el `where: { tenantId }` (alto riesgo de IDOR cross-tenant) y complica backups/exports por cliente.
- **Schema por tenant en una sola DB**: aislamiento intermedio, pero límites de conexiones/objetos por DB y migraciones más enredadas.

## Consequences

- **+** Aislamiento fuerte por construcción; backup/restore/export por tenant triviales; un tenant pesado no degrada a los demás.
- **+** Provisión de tenant nuevo vía `sync()` de su DB (caso acotado y aceptado; la evolución de schema va por migraciones versionadas).
- **−** Más conexiones y overhead operativo; cambios de schema deben aplicarse a N bases (mitigado con el auto-discovery de modelos y un runner de migraciones).
- El pool de conexiones por tenant es una zona sensible: tocarlo requiere cuidado (ver `CLAUDE.md`).
