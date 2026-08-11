# Autenticación — Sistema Interno (single-tenant)

> ⚠️ **Keep in sync.** Fuentes: `kernel/users/controllers/auth.controller.js`,
> `kernel/auth/*`, `middlewares/verifyAccessToken.js`.
> Tests: `e2e/tests/api/m01-auth.spec.ts`, `m02-middlewares.spec.ts`.

## Modelo

- Los usuarios viven en la tabla `users` (modelo `User`), con rol (`roleId`) y flag `active`.
- Password con **argon2id** (`kernel/auth/password.js`); los hashes bcrypt legacy se migran
  automáticamente en el próximo login exitoso (rehash-on-login, ADR-007).
- MFA/TOTP **opcional por usuario** (`mfaEnabled`, `mfaSecret`, `mfaBackupCodes`).
- No hay signup público: los usuarios los crea un administrador (`POST /users`).

## Endpoints

| Método y path | Auth | Descripción |
|---|---|---|
| `POST /api/auth/signin` | — | `{ username, password }` (username o email) → sesión o `{ mfaRequired, mfaToken }` |
| `POST /api/auth/mfa/login` | — | `{ mfaToken, code }` (TOTP o backup code) → sesión |
| `POST /api/auth/refresh` | `x-refresh-token` | → `{ accessToken, refreshToken, expiresIn }` |
| `POST /api/auth/change-password` | `x-access-token` | `{ currentPassword, newPassword }` (min 8, step-up) |
| `GET /api/auth/mfa/status` | `x-access-token` | `{ mfaEnabled }` |
| `POST /api/auth/mfa/enroll` | `x-access-token` | → `{ secret, otpauthUrl, backupCodes }` (se muestran UNA vez) |
| `POST /api/auth/mfa/activate` | `x-access-token` | `{ code }` — activa tras verificar un TOTP |
| `POST /api/auth/mfa/disable` | `x-access-token` | `{ password }` (step-up) |
| `GET /api/me` | `x-access-token` | `{ user, modules, capabilities, declaredCapabilities }` |

Shape de sesión: `{ auth, accessToken, refreshToken, expiresIn, user }`.

## Tokens

- JWT firmados con `JWT_SECRET` (fail-fast al boot si falta). Payload mínimo
  `{ id, username, type: 'access'|'refresh' }`.
- Expiración por config dinámica (`ACCESS_TOKEN_EXPIRY` 15m / `REFRESH_TOKEN_EXPIRY` 7d,
  overrideables en la tabla `configs`).
- **Re-validación por request**: `verifyAccessToken` recarga el usuario (con rol) de la base
  en cada request; un usuario desactivado o eliminado pierde acceso de inmediato, y un cambio
  de rol/capabilities impacta sin re-login (cache de capabilities 5 min en Redis).

## Lockout (anti fuerza bruta)

`kernel/auth/lockout.service.js` + tabla `login_attempts` (bitácora, no paranoid):

- **5 fallos en 15 min para el par usuario+IP** → 429 `LOGIN_LOCKED` hasta que el fallo más
  viejo salga de la ventana.
- **15 fallos en 15 min desde una misma IP** (cualquier usuario) → bloquea la IP.
- El username solo NUNCA bloquea: un tercero no puede dejar afuera a un usuario legítimo
  tirando fallos contra su email desde otra red (mejora sobre el sistema legado).
- Un login exitoso limpia los fallos previos de ese usuario y esa IP.
- Los intentos contra usuarios inexistentes también cuentan (castiga el scanning) y el
  mensaje de error es genérico («Credenciales inválidas») — anti-enumeración.

## Rate limit

`authRateLimit` (express-rate-limit) protege `/auth/*` además del lockout; es no-op en
desarrollo (`NODE_ENV !== 'production'`).

## Frontend

`stores/auth.ts` (login → `finalizeSession` guarda tokens en localStorage y conecta el
socket; paso MFA en `LoginPage`), interceptor de axios con auto-refresh
(`services/api.ts`), y `stores/me.ts` para el contexto de permisos.
