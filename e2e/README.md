# Sistema Interno — Tests End-to-End con Playwright

Suite E2E que verifica el backend del Sistema Interno (API single-tenant), su shell web y la capa de tiempo real (Socket.IO).

> Para **escribir o mantener** tests, la guía es [`CLAUDE.md`](CLAUDE.md) (fixtures, helpers, convenciones y el checklist de cada endpoint nuevo). Este README es solo el arranque.

## Qué hay

**159 tests en 21 archivos**, en tres proyectos de Playwright:

| Proyecto | Carpeta | Qué cubre |
|---|---|---|
| `api` | `tests/api/` | El grueso: un spec por módulo (`mNN-<modulo>.spec.ts`), HTTP directo sin browser |
| `ui` | `tests/ui/` | Mínimo y resiliente: login del shell |
| `websocket` | `tests/ws/` | Conexión a Socket.IO, auth del handshake y presencia |

## Correr la suite

Requiere el **backend en `:3010`** (y el **frontend en `:8100`** solo para los tests de UI):

```bash
cd backend && npm run init_db && npm run dev   # base sembrada + API
cd frontend && npm run dev                     # solo si vas a correr los tests de UI

cd e2e && npm test                 # todo
npm run test:api                   # solo API
npx playwright test tests/api/m21-sitios.spec.ts --project=api    # un spec
```

⚠️ **La suite crea y borra datos reales en la base que apunta `backend/.env`.** No la corras contra producción.

## Credenciales

Se leen solas de `backend/.env`. Los tests usan dos identidades:

- **admin** (`ADMINUSER`/`ADMINPASS`, default `admin`/`admin123`): rol Administrador, capability `*`.
- **usuario de fixture**: lo crea `global-setup.ts` con un rol acotado (`areas:*` + `usuarios:read`). Sirve para probar el deny-by-default: sin la capability, **403**.

Si la cuenta `admin` no existe (la migración del legado la borra), corré con las credenciales de un admin real:

```bash
ADMINUSER=<usuario> ADMINPASS=<clave> npx playwright test tests/api
```

Los tests **no deben depender** del username `admin`: el admin se resuelve desde `GET /me`.

## Lo que la suite asume de la API

- Base: `http://localhost:3010/api` (puerto `PORT`). Una sola base de datos.
- Envelope: `{ success, code, message, timestamp, data?, meta? }`.
- Headers: `x-access-token` / `x-refresh-token`.
- `POST /auth/signin { username, password }` (acepta username o email) → sesión o `{ mfaRequired, mfaToken }`.
- Sin token → **401** · sin la capability → **403** · validación → **422** · negocio → **400/409**.
