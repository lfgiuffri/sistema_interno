# ADR-005 — Billing vendor-agnóstico

> ⚠️ **Histórico.** Este ADR describe la base **Zero 2.0** (el starter SaaS multi-tenant
> del que nace el Sistema Interno), no la app actual: acá no hay tenants, planes ni
> billing. Se conserva como registro de por qué la base era así. Ver
> [ADR-015](ADR-015-single-tenant-conversion.md).


- **Status**: Supersedido por ADR-015
- **Date**: 2026-06-30

## Context

Zero debe cobrar suscripciones, y según el mercado conviene Stripe (global) o MercadoPago (LATAM). Acoplar el código de billing a un proveedor concreto obligaría a reescribir la lógica de checkout/webhooks/estado al cambiar o sumar proveedor.

## Decision

**Una abstracción `PaymentProvider` que ambos proveedores implementan; el servicio de billing es agnóstico.**

- Contrato: `name`, `isConfigured()`, `createCheckoutSession(...)`, `cancelSubscription(...)`, `verifyWebhook(rawBody, headers, query)`, `parseEvent(event)`. Implementaciones en `services/billing/providers/{stripe,mercadopago}.provider.js`; `providers/index.js` resuelve por nombre.
- El mapeo plan → IDs nativos sale de **config/env** (`STRIPE_PRICE_<PLAN>`, `MP_PLAN_<PLAN>`), nunca hardcodeado.
- El suscriptor es el **Tenant**. La fuente de verdad del estado es el proveedor: `handleWebhook` verifica firma (sobre `req.rawBody`), normaliza el evento, lo **deduplica** vía `PaymentEvent` (idempotencia por `externalEventId`) y sincroniza `Tenant.plan` + tabla `Subscription`.

## Alternatives

- **Acoplar a Stripe directamente**: menos código inicial, pero sin camino a MercadoPago ni a otros.
- **Usar un agregador de pagos de terceros**: dependencia externa y costos; innecesario para dos proveedores bien definidos.

## Consequences

- **+** Sumar un proveedor = implementar el contrato y registrarlo; el resto del sistema no cambia.
- **+** Webhooks idempotentes y firma siempre verificada (fail-closed): un replay no aplica dos veces.
- **+** El estado del plan se deriva del proveedor (no del optimistic update del checkout), evitando desincronización.
- **−** Hay que normalizar nombres de evento y shapes de cada proveedor en el borde (`parseEvent`); el costo es por proveedor.
- El downgrade al cancelar (`BILLING_DOWNGRADE_PLAN`) revoca acceso a módulos premium vía `planGate` automáticamente.
