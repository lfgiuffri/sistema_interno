# ADR-008 — Refactors de profundización (architecture review)

- **Status**: Aceptado
- **Date**: 2026-06-30

## Context

Se corrió la skill `improve-codebase-architecture` (lente *deep-vs-shallow* de Ousterhout + *deletion test*) sobre toda la base con un fan-out de agentes Explore: 40 candidatos crudos → 26 confirmados (5 Strong, 14 Worth-exploring, 7 Speculative). Este ADR registra los refactors aplicados para que futuras revisiones no los re-sugieran ni re-litiguen, y deja constancia de los que se **descartaron a propósito**.

## Decision

Aplicar los candidatos Strong + los Worth-exploring de mayor leverage, todos behavior-preserving y verificados con la suite e2e (68/68):

1. **Provisioning extraído** — `kernel/master/provisioning/tenantProvisioner.js`. Se sacó del `tenants.controller` toda la maquinaria de creación de tablas, detección/aplicación de cambios de schema, reparación de tablas legacy y seed de datos por defecto (~550 líneas, 23 funciones). Interfaz pública única: `performTenantSync`. El controller quedó fino (solo endpoints). Mejora *locality* y testabilidad; honra ADR-002 (infra ≠ handlers HTTP).
2. **Session issuance extraído** — `kernel/auth/session.service.js` (`generateTokens`, `issueSession`, `signMfaToken`). El `auth.controller` ya no mezcla emisión de sesión con orquestación de login.
3. **Rehash-on-login realizado** — `password.js#rehashIfNeeded` se cablea en `signIn` (master) y en el login de tenant-user. Completa ADR-007 (la función existía pero no se llamaba).
4. **Idempotencia de webhooks transaccional** — `billing.service#handleWebhook` envuelve el check + aplicación de estado en una transacción con `SELECT … FOR UPDATE` sobre `PaymentEvent`. Cierra la race de webhooks concurrentes del mismo evento (doble aplicación de estado de plan/suscripción).
5. **Validación de capabilities al boot** — `moduleLoader#validateCapabilities`: formato `modulo:accion` + unicidad cross-módulo, fail-hard. Una capability malformada se atrapa al arranque, no como un 403 críptico en runtime.
6. **Barrel portability** — `settings` (controller/validator) y los services `billing`/`webhooks`/`me` importan capability/responseManager/validator desde el barrel `kernel/index.js`. `settings` ganó service layer (`settings.service.js`).
7. **Frontend: auth store como única fuente de verdad** — el guard del router delega en `authStore.ensureInitialized()` (idempotente) y decide por getters del store, sin leer `localStorage` directo. `settings` resetea al logout (evita fuga de estado entre usuarios). Los feature stores (`items`/`billing`/`mfa`) exponen `error` (mensaje del envelope `responseManager`) en vez de tragárselo.

## Alternatives (descartadas a propósito)

- **Consolidar las dos `generateTokens`** (master multi-tenant vs `verifyAccessToken` por-usuario): tienen payloads y responsabilidades distintas; unificarlas agrega acoplamiento, no leverage. Se documentó la separación en `session.service.js`.
- **Partir `responseManager`** (acopla logging + notificaciones + respuesta): es una fachada deliberada; partirla toca toda la base con beneficio marginal. Se deja como está.
- **`settings` como feature module con manifest**: `settings` es INFRA (siempre disponible, no se gatea por plan); un manifest lo subordinaría a `planGate`. Se deja montado explícito.
- **Módulo `TestDataFactory`** (e2e): el propio *deletion test* mostró que sería indirección shallow ("mueve código sin ganar locality"). No se hace.

## Auditoría adversarial final (M-FINAL)

Tras los refactors se corrió una auditoría adversarial (9 dimensiones, verificación finding-por-finding): 26 crudos → 20 confirmados. **Arreglados (15):**

- **Seguridad**: webhook de MercadoPago ahora **fail-closed** (sin secret → rechaza, igual que Stripe); cross-check de tenant en `verifyAccessToken` (x-api-key de un tenant + x-access-token de otro → 401, evita mapear el userId a la DB equivocada); `JWT_SECRET` validado al boot (fail-fast si falta); CORS configurable por `CORS_ORIGIN`; `getApiKey.js` ahora lee las API keys reales de la DB (antes derivaba un MD5 de `JWT_SECRET`, inútil).
- **Provisioning**: password del admin **hasheado antes** de `User.create` (sin ventana de plaintext en DB); rutas de módulos y seeds resueltas **relativas al código** (`__dirname`/`babel --copy-files`), no al cwd (rompía en Docker, que lleva `build/` pero no `src/`); build hace `rm -rf build` (evita módulos borrados "stale" como `catalogs`).
- **Frontend**: `reset()` en todos los feature stores + `resetAllStores()` invocado en cada logout (no se filtran datos al próximo usuario); flag `initialized` del auth store se resetea al logout.
- **Kernel**: `validateCapabilities` también detecta colisión módulo↔service.
- **e2e**: M10.5 apunta al tenant de fixture (estable) en vez de `tenants[0]` (eliminó un flake de paralelismo).

**Diferidos a propósito (riesgo aceptado, no son defectos abiertos):**

- **Token MFA sin nonce de un solo uso** (medium): el token intermedio de MFA podría reusarse dentro de su TTL. Aceptado: TTL corto (10 min), requiere haber pasado el 1er factor, y se consume de inmediato. Hardening futuro: jti de un solo uso en Redis.
- **Tokens en `localStorage`** (low): vulnerable a XSS si lo hubiera. Es una decisión deliberada del shell SPA + Capacitor (las cookies HTTPOnly no sirven para el cliente nativo); se mitiga con el escapado de Vue + CSP. Migrar a cookies HTTPOnly sería un cambio transversal de auth, fuera de alcance.
- **`grantAllCapabilities`/`setRoleCapabilities` no en el barrel** (medium, descartado): `tenantProvisioner` es infra del kernel (no un módulo feature portable), así que importa `capability.js` (hermano) directo. El barrel es la superficie *hacia los módulos*; no corresponde forzar la infra interna a pasar por él.

## Consequences

- **+** Módulos más profundos y testeables; `tenants.controller` y `auth.controller` finos; bug de billing y de drift de capabilities cerrados; auth store single-source-of-truth.
- **+** El módulo de ejemplo `items` (plantilla) ahora modela el patrón de `error` state para que las features nuevas lo copien.
- **+** Auditoría adversarial: 0 findings critical/high abiertos; los medium/low restantes quedan documentados con rationale.
- **−** Dos archivos nuevos en `kernel/master/provisioning/` y `kernel/auth/` que los devs deben conocer (documentado acá y en las guías).
