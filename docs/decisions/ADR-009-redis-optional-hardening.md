# ADR-009 — Redis opcional: fallback robusto (no-crash) en scheduler/webhooks/sandbox

- **Status**: Aceptado
- **Date**: 2026-07-01

## Context

Los docs (`deployment.md`, `.env.example`, roadmap) afirman que **sin Redis todo degrada a un
fallback in-process**. En la práctica, al levantar el backend nativo en una máquina **sin Redis**,
el proceso **crasheaba** con `ECONNREFUSED :6379` no capturado, originado en BullMQ.

Causa raíz (bug de una *clase*, repetido en 3 servicios):
1. El guard de disponibilidad era `const redis = getRedis(); if (!redis) return;`. Pero
   `getRedis()` (ioredis) **conecta de forma asíncrona** y devuelve una conexión *truthy* aunque el
   servidor esté caído → el guard **nunca disparaba** el fallback y se creaba BullMQ igual.
2. Las instancias `Queue`/`QueueEvents` de BullMQ **no tenían handler `.on('error')`** (el `Worker`
   del scheduler sí). Un `'error'` de conexión sin listener es fatal en Node → tumba el proceso.

Afectaba a `services/scheduler`, `services/webhooks` y `services/sandbox` (este último gateado por
`SANDBOX_ENABLED`, pero con el mismo patrón latente). El review estático previo (ADR-008) no lo
detectó porque solo se manifiesta en runtime sin Redis.

## Decision

Endurecer el path Redis-opcional de forma consistente:

1. **Probe real de Redis** — nuevo `config/redis.js#pingRedis(timeoutMs)`: crea una conexión
   efímera con `lazyConnect`, `retryStrategy: () => null` y `connectTimeout`, hace `PING` y
   resuelve `true/false`. **No reintenta ni spamea**. Reemplaza al guard roto `getRedis()`.
2. **Gate por ping antes de crear BullMQ** — `initSchedulerQueue` (ahora `async`, `await`eado en
   `index.js`) y el `ensureQueue` de webhooks usan `pingRedis()`. Sin Redis: no se instancia BullMQ
   y se usa el fallback documentado (`setInterval` en scheduler; entrega **inline** en webhooks).
3. **Handlers `.on('error')`** en todas las `Queue`/`QueueEvents` (scheduler, webhooks, sandbox),
   emparejando el patrón que ya tenía el `Worker`. Defensa en profundidad si Redis cae *después*
   del arranque.

Cambios: `config/redis.js`, `services/scheduler/services/scheduler.service.js`, `index.js`,
`services/webhooks/services/webhooks.service.js`, `services/sandbox/services/sandboxQueue.service.js`.

## Consequences

- El backend **arranca y opera sin Redis** (ahora sí, como prometían los docs): el scheduler corre
  por `setInterval` (verificado: "Fallback setInterval para tenant 1"), los webhooks entregan inline.
- Sin spam de reintentos en el arranque (el probe es un solo intento acotado).
- Con Redis presente, el comportamiento es idéntico al anterior (BullMQ).
- Suite e2e sin regresiones: **74/74** (API 67 · WS 4 · UI 3).
- **Follow-up**: sumar un e2e que ejercite explícitamente el modo sin-Redis (hoy la cobertura asume
  el entorno tal cual está). El *rate-limit* Redis (`middlewares/rateLimit.js`) solo aplica en prod;
  revisar su degradación sin Redis cuando se aborde el hardening de producción.
