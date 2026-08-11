# Webhooks salientes — Zero 2.0

> ⚠️ **Keep in sync.** Servicio en `services/webhooks/services/webhooks.service.js`; rutas en `services/webhooks/routes/webhooks.routes.js`; modelos `WebhookSubscription`/`WebhookDelivery`.

Webhooks salientes **por tenant**: cuando un módulo dispara un evento (ej. `item:created`), las suscripciones activas del tenant interesadas reciben un POST firmado, con reintentos y backoff.

> No confundir con los webhooks **entrantes** de billing (`/master/billing/webhooks/:provider`), que son otra cosa — ver [plans-billing.md](plans-billing.md).

## Disparar un evento (vía el barrel)

```js
import { dispatchWebhook } from '../../../kernel/index.js';

await dispatchWebhook(req.models, req.tenant, 'item:created', item, req.io);
```

`dispatch(models, tenantContext, event, payload, io?)` busca las suscripciones activas que matchean el evento (por nombre exacto o comodín `*`), crea una `WebhookDelivery` (status `pending`) por cada una y la entrega. **Nunca tira**: un webhook es un side-effect; un fallo de entrega no debe romper la operación que lo disparó.

## Firma y headers

Cada POST se firma con **HMAC-SHA256** del body usando el secreto de la suscripción. El receptor recomputa el HMAC con su copia del secreto y compara.

| Header | Contenido |
|--------|-----------|
| `X-Zero-Signature` | `sha256=<hex>` del body |
| `X-Zero-Event` | nombre del evento |
| `X-Zero-Delivery` | id de la entrega (para deduplicar reintentos del lado del receptor) |

## Entrega: reintentos y transporte

- Hasta `WEBHOOKS_MAX_ATTEMPTS` (default 5, clamp 1..10) con **backoff exponencial** (1s, 2s, 4s... tope 30s). Cualquier 2xx = éxito; timeout por intento 10s.
- **Con Redis**: se encola en BullMQ (`zero-webhooks-<suffix>`) → no bloquea el request.
- **Sin Redis**: entrega inline async (fire-and-forget) con el mismo backoff. El feature degrada con gracia.
- El resultado final se persiste en `WebhookDelivery` (`status`, `attempts`, `responseStatus`, `lastError`).

## Endpoints (tenant, capability `webhooks:manage`)

Montados en `/webhooks` (verifyAccessToken + capability):

| Método | Path | Qué hace |
|--------|------|----------|
| GET | `/webhooks/subscriptions` | lista suscripciones del tenant |
| GET | `/webhooks/subscriptions/:id` | una suscripción |
| POST | `/webhooks/subscriptions` | crea suscripción (el **server genera el secreto HMAC**, se muestra una vez) |
| DELETE | `/webhooks/subscriptions/:id` | soft-delete |
| GET | `/webhooks/deliveries` | log de entregas (paginado, filtrable por `subscriptionId`/`status`) |
| POST | `/webhooks/test` | dispara un evento de prueba |

Una suscripción tiene `url`, `events` (array; default `['*']` = todos), `active`, y `secret` (generado por el server). El secreto **nunca** se confía al cliente.

## Variables de entorno

```
WEBHOOKS_MAX_ATTEMPTS=5
WEBHOOKS_QUEUE_SUFFIX=          # opcional; aísla colas entre deploys (default: MASTER_DBNAME)
```
