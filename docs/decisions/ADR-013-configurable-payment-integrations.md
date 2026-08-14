# ADR-013 — Integraciones de pago configurables desde el super-admin (DB-first)

> ⚠️ **Histórico.** Este ADR describe la base **Zero 2.0** (el starter SaaS multi-tenant
> del que nace el Sistema Interno), no la app actual: acá no hay tenants, planes ni
> billing. Se conserva como registro de por qué la base era así. Ver
> [ADR-015](ADR-015-single-tenant-conversion.md).


- **Status**: Supersedido por ADR-015
- **Date**: 2026-07-02

## Context

Las claves de los proveedores de pago (Mercado Pago, Stripe) vivían **solo en `backend/.env`**, así
que configurarlas requería editar el archivo y redeployar. Para que Zero sea una base auto-configurable
(y para el wizard de instalación), el super_admin debe poder conectar/rotar los métodos de pago **desde
la app**, sin tocar el `.env` ni reiniciar.

## Decision

1. **Modelo `Integration`** (master DB): `provider` (PK, `mercadopago`|`stripe`), `enabled`, config
   **cifrada** (`configEncrypted`/`configIv`/`configAuthTag`, AES-256-GCM con el vault del proyecto —
   `VAULT_KEY`→`JWT_SECRET`), `status` (`configured`|`pending`|`error`), `lastTestedAt`. Migración
   master `0003-create-integrations.js` (idempotente, al boot).
2. **Resolución DB-first, `.env`-fallback** en `billing.config.js`: un cache en memoria
   (`loadIntegrationsFromDb`, mismo patrón que el registry de planes) descifra y cachea **solo** las
   integraciones `enabled=true`. `BILLING_ENV.stripe/.mercadopago` pasan de objeto estático a
   **getters** que resuelven por campo (DB si existe, si no `process.env.*`); ídem `stripePriceFor`/
   `mpPlanFor`. Se carga al boot (`index.js`, tras `loadPlansFromDb`) y se recarga en cada mutación.
   Los providers exponen `resetClient()` para tomar claves nuevas sin reiniciar. **Si no hay fila (o
   falla el descifrado) → cae al `.env` como siempre; nada se rompe.**
3. **Endpoints** `/master/integrations` (super_admin, `verifyAdmin`): `GET` (claves **enmascaradas**
   `••••1234`), `PUT /:provider` (guarda cifrado; un valor enmascarado entrante NO pisa el secreto
   real — merge anti-máscara; `''`/`null` limpia), `POST /:provider/test` (ping real: MP `/users/me`,
   Stripe `/v1/account`, con timeout, sin loguear el token).

## Consequences

- El super_admin conecta/rota MP/Stripe desde la app; el cambio impacta el billing sin redeploy.
- Los secretos **nunca** viajan en claro al frontend ni a los logs; cifrados en reposo.
- Compatibilidad total con el setup por `.env` existente (fallback) → no rompe instalaciones actuales.
- e2e API **86/86** (78 + 8 nuevos `m13-integrations`).
- **Pendiente**: la UI `AdminIntegrationsPage` (sobre el diseño nuevo) y el installer CLI `npm run setup`
  (parte del wizard) consumen esta API. La API ya devuelve todo enmascarado y listo.
