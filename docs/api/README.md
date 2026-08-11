# API — Sistema Interno

> ⚠️ **Keep in sync.** Al agregar/cambiar/eliminar endpoints, actualizá este overview, el
> spec OpenAPI (`services/openapi/openapi.service.js`) y los tests e2e.

## Base URL

```
http://localhost:3010/api
```

Configurable por `PUBLIC_API_URL`. Toda ruta cuelga de `/api` (ver `app.js`).

## Documentación interactiva

- **Scalar UI** (explorar/probar): `GET /api/docs`
- **Spec OpenAPI 3 crudo**: `GET /api/openapi.json` — generado en
  `services/openapi/openapi.service.js`. Los módulos feature extienden `paths` al construirse.

## Headers

| Header | Para qué |
|--------|----------|
| `x-access-token` | JWT de sesión. Requerido en rutas autenticadas. |
| `x-refresh-token` | Refresh token (en `POST /auth/refresh`). |

## Envelope de respuesta

Toda respuesta tiene la misma forma (vía `responseManager`):

```json
{
  "success": true,
  "code": 200,
  "message": "Operación exitosa",
  "timestamp": "2026-08-10T12:00:00-03:00",
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "code": 403,
  "error": "FORBIDDEN",
  "message": "No tenés el permiso requerido: usuarios:create",
  "timestamp": "2026-08-10T12:00:00-03:00"
}
```

`errorCode` notables: `TOKEN_EXPIRED`, `REFRESH_TOKEN_EXPIRED`, `LOGIN_LOCKED` (lockout de
fuerza bruta, 429). Tipos de error (`error`): `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## Paginación

En endpoints listables: query `page` (default 1) + `limit`. La meta va en `meta`:

```json
"meta": {
  "totalItems": 142, "limit": 20, "page": 1,
  "totalPages": 8, "hasNextPage": true, "hasPrevPage": false
}
```

## Overview de endpoints

### Auth (públicos, con rate limit propio)

| Método | Path | Qué hace |
|--------|------|----------|
| POST | `/auth/signin` | Login password (→ tokens o `mfaRequired`) |
| POST | `/auth/mfa/login` | Segundo factor (TOTP o backup code) |
| POST | `/auth/refresh` | Refrescar access token |

### Auth (autenticados)

| Método | Path | Qué hace |
|--------|------|----------|
| POST | `/auth/change-password` | Cambiar la contraseña propia (step-up, min 8) |
| GET/POST | `/auth/mfa/{status,enroll,activate,disable}` | Gestión del 2FA propio |

Detalle en [docs/auth.md](../auth.md).

### Sesión y cuenta propia (autenticado, sin capability)

| Método | Path | Qué hace |
|--------|------|----------|
| GET | `/me` | `{ user, modules, capabilities, declaredCapabilities }` — el frontend arma el menú con esto |
| GET | `/users/my-account` | La cuenta propia (con rol) |
| PUT | `/users/my-account` | Editar el perfil propio (campos whitelisteados: nombre, apellido, email, avatar, password) |

### Usuarios y roles (capability-based)

| Método | Path | Capability |
|--------|------|-----------|
| GET | `/users` · `/users/:id` | `usuarios:read` |
| POST | `/users` | `usuarios:create` |
| PUT | `/users/:id` | `usuarios:update` |
| PATCH | `/users/:id/active` | `usuarios:toggle` |
| DELETE | `/users/:id` | `usuarios:delete` |
| GET | `/users/roles` · `/users/roles/:id` | `roles:read` |
| GET | `/users/roles/create` (catálogo de capabilities) | `roles:create` |
| POST | `/users/roles` | `roles:create` |
| PUT | `/users/roles/:id` | `roles:update` |
| DELETE | `/users/roles/:id` | `roles:delete` |

### Infra always-on (autenticado)

| Recurso | Path | Capability |
|---------|------|-----------|
| settings (preferencias) | `/settings` (+ `/export`, `/test-notification`, `/push-token`) | (autenticado) |
| webhooks salientes | `/webhooks/{subscriptions,deliveries,test}` | `webhooks:manage` |
| acciones de notificación | `/notification-actions/execute` | (token firmado propio) |

### Módulos feature (`verifyAccessToken → requireCapability` por ruta)

| Recurso | Path | Capabilities |
|---------|------|-------------|
| items (ejemplo) | `/items` (GET/POST `/`, GET/PUT/DELETE `/:id`) | `items:{read,create,update,delete}` |

Cada módulo nuevo expone su CRUD bajo su `basePath`. Ver [docs/modules/](../modules/README.md).

## Rate limiting y lockout

`globalRateLimit` (solo en producción) sobre todo `/api`; `authRateLimit` extra en `/auth/*`.
Además, el **lockout** de login aplica SIEMPRE (dev y prod): 5 fallos por usuario+IP en
15 min → 429 `LOGIN_LOCKED`. Ver [docs/auth.md](../auth.md).
