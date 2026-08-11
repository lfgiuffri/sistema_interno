# ADR-012 — Auditoría de seguridad + arquitectura (hardening)

- **Status**: Aceptado
- **Date**: 2026-07-02

## Context

Se corrió una auditoría del backend con las skills `security-review` + `penetration-testing`
(OWASP Top 10, threat modeling de auth/authz/webhooks/injection) y `improve-codebase-architecture`
(lente deep-vs-shallow + deletion test), con foco en el código nuevo (checkout MP, CRUD de planes,
`/api/plans/public`, self-signup). **Veredicto: base sólida y hardened; sin Críticos ni Altos
explotables.** Este ADR registra los fixes aplicados y deja constancia de los hallazgos diferidos
(riesgo aceptado / requieren decisión) para no re-litigar.

## Decision — Fixes aplicados (quirúrgicos, e2e 78/78)

1. **S1 — Timing-safe en la firma del webhook MP** (`services/billing/providers/mercadopago.provider.js`):
   la comparación `hmac !== v1` era no-constante (timing side-channel). Ahora `crypto.timingSafeEqual`
   con guardia de longitud.
2. **S2 — Password del self-signup no queda recuperable en reposo** (`kernel/auth/signup.service.js`):
   al confirmar, se hace `row.destroy()` de la `SignupRequest` (antes quedaba la password cifrada-pero-
   reversible en la master DB).
3. **S3 — Path traversal en storage local** (`services/storage/providers/local.provider.js`): el strip
   de `..` era evadible (`....//`, key absoluta). Ahora se resuelve contra el root y se rechaza toda key
   que escape (`resolved.startsWith(base + sep)`). Latente (sin caller con input de usuario hoy).
4. **S4 — `verifyAdmin` exige `type === 'access'`** (`middlewares/tenantMiddleware.js`): antes un
   **refresh token** de super_admin (TTL 30d) servía como credencial para rutas admin.

## Hallazgos diferidos (riesgo aceptado / requieren decisión — NINGUNO Crítico/Alto)

Seguridad:
- **S5 (Medio) — Email bombing**: `passwordless/otp|magic` y `signup` mandan mail a direcciones
  arbitrarias y responden 200; `authRateLimit` usa `skipSuccessfulRequests:true` → sin límite efectivo.
  Fix propuesto: limiter dedicado (sin skipSuccessful) por email+IP en esas rutas.
- **S6 (Medio) — Rate limiting off si `NODE_ENV !== 'production'`**: un staging sin esa var queda sin
  anti-brute-force. Fix: forzar `NODE_ENV=production` en staging.
- **S7 (Medio) — SSRF ciego en webhooks salientes**: la URL destino (tenant-controlled) no filtra IPs
  privadas/metadata (169.254.169.254, RFC1918, localhost). Fix grande (rompería webhooks a localhost/e2e);
  guard con protección de DNS-rebinding, detrás de flag de entorno.
- **S8 (Medio, arq.) — JWT legacy `/users/auth` no atado al tenant** (`{id,type}`): válido en cualquier
  DB de tenant con ese `id` dado el `x-api-key`. Ver A1.
- **S9–S13 (Bajo)**: CORS cae a `*` sin `CORS_ORIGIN`; mass-assignment en `updateTenant` (super_admin-only);
  `libs/multer.js` (dead code) con rutas de FS sin validar; enumeración de emails por timing en signup;
  `aesKey()` cae a literal `'zero'` si faltan VAULT_KEY/JWT_SECRET.

No-vulnerables confirmados (para no re-levantar): `order/order_type` de getUsers/getRoles NO son
SQL-injectables (Sequelize 6 escapa identificador+dirección); `CREATE DATABASE` protegido por validator;
`deploy.service` solo corre `DEPLOY_COMMAND` del entorno; `/plans/public` no filtra nada sensible;
webhooks Stripe+MP fail-closed; vault AES-256-GCM con IV+authTag correctos.

Arquitectura (para fases futuras):
- **A1** — Dos sistemas de auth/token en paralelo (legacy `/users/auth` vs master `/master/auth`);
  `verifyAccessToken` olfatea el formato. Converger en el master y deprecar el legacy (cierra S8).
- **A2** — `tenants.controller.js` god-object (831 líneas): mezcla handlers + creación física de DB +
  `fs.mkdir` + `sync({alter})` + cache de conexiones. Mover provisioning/DB-admin a servicios.
- **A3** — `responseManager` sobre-responsabilizado (respuesta + ErrorLog + notificaciones + email-stub).
  Separar logging/notificaciones a middleware/observer.
- **A4** — Boilerplate de query duplicado entre `users.controller` y `roles.controller`. Extraer builder.
- **A5** — Dead code `libs/multer.js` (solo se auto-referencia). Borrable (arrastra S11).

## Consequences
- 4 hardenings aplicados sin regresión (e2e API 78/78). El resto queda documentado y priorizable.
- Los ítems de arquitectura (A1-A5) alimentan una futura fase de refactor; ninguno bloquea.
