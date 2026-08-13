# CLAUDE.md — Instrucciones para IA sobre los E2E del Sistema Interno

Cómo mantener, agregar, modificar y eliminar tests E2E de Playwright para el **Sistema Interno** (single-tenant).

## Contexto

`e2e/` contiene los tests end-to-end (API + shell web + tiempo real). Cubren:

- **API** (HTTP directo, sin browser) → `tests/api/`
- **UI** (Chromium real) → `tests/ui/`
- **WebSocket** (Socket.IO) → `tests/ws/`

Cada test tiene un ID (`M5.2`, `M17.1`, ...) usado en su título.

### Hechos de la plataforma que los tests asumen

- Base API: `http://localhost:3010/api` (puerto `PORT`, default 3010). Single-tenant: una sola base.
- Envelope homogéneo: `{ success, code, message, timestamp, data?, meta? }`.
- Headers: `x-access-token` / `x-refresh-token` (no existen x-api-key ni x-master-key).
- `POST /auth/signin { username, password }` (acepta username o email) → sesión `{ accessToken, refreshToken, user }` o `{ mfaRequired, mfaToken }`.
  - Admin sembrado por `init_db`: `admin` / `ADMINPASS` (default `admin123`), rol Administrador (capability `*`).
    Si esa cuenta no existe (la migración del legado la borra), corré la suite con las credenciales
    de un admin real: `ADMINUSER=<usuario> ADMINPASS=<clave> npx playwright test tests/api`.
    Los tests NO deben depender del username `admin`: resolvé el admin desde `GET /me`.
  - Usuario de fixture (lo crea `global-setup`): rol acotado `areas:*` + `usuarios:read` → sirve para probar el deny-by-default.
- Sin token → **401**. Sin la capability → **403** con el nombre de la capability en el mensaje.
- Lockout: 5 fallos por usuario+IP en 15 min → **429** `LOGIN_LOCKED` (los fallos cuentan aun para usuarios inexistentes; un login exitoso los limpia).
- `validator` (express-validator) corta con **422**; errores de negocio suelen ser **400** (409 para "rol en uso").
- Protecciones de usuarios/roles: comodín `*` no asignable, rol Administrador (isSystem) intocable, último admin activo protegido, auto-protecciones.

---

## Regla principal (de mantenimiento)

> **Cuando se cree, modifique o elimine un endpoint, ruta, middleware, modelo, módulo feature, capability, plan, página del shell o evento WebSocket, se DEBEN actualizar los tests E2E correspondientes** (specs + `helpers/constants.ts` + `helpers/selectors.ts` si aplica).

---

## Fixtures disponibles

| Fixture | Fuente | Descripción |
|---------|--------|-------------|
| `authedApi` | `auth.fixture.ts` | `APIRequestContext` como el **usuario de fixture** (rol acotado) |
| `adminApi` | `auth.fixture.ts` | `APIRequestContext` como **admin** (capability `*`) |
| `unauthApi` | `auth.fixture.ts` | `APIRequestContext` sin auth (tests negativos) |
| `tokens` / `adminTokens` | `auth.fixture.ts` | `{ accessToken, refreshToken }` raw |
| `authedPage` / `adminPage` | `app.fixture.ts` | `Page` logueada (fixture / admin) via localStorage |

## Helpers disponibles

| Helper | Archivo | Uso |
|--------|---------|-----|
| `expectSuccess(res, code?)` | `response.ts` | Valida envelope de éxito (success, code, message, timestamp) |
| `expectSuccessData(res, code?)` | `response.ts` | Lo anterior + retorna `body.data` |
| `expectError(res, code)` | `response.ts` | Valida envelope de error |
| `expectPagination(meta)` | `response.ts` | Valida `meta` de paginación (totalItems, totalPages, ...) |
| `expectAuthResponse(data)` | `response.ts` | Valida `accessToken` + `refreshToken` |
| `hardDeleteByPath(path)` | `hardCleanup.ts` | Hard-delete por SQL (best-effort): `areas/:id`, `empleados/:id`, `users/:id`, `users/roles/:id`, ... |
| `makeNombre` / `makeUser` / `makeRole` | `constants.ts` | Factories de test data |
| `SEL.{area}.{elemento}` | `selectors.ts` | Selectores accesibles del shell |

---

## Cómo agregar tests

### Nuevo endpoint de un módulo feature

1. Si el módulo nuevo se llama p.ej. `widgets`, agregá su path en `helpers/constants.ts → APP_ENDPOINTS`.
2. Creá `tests/api/mNN-widgets.spec.ts` usando `authedApi` (usuario acotado) o `adminApi` (admin).
3. Cubrí el checklist:
   - [ ] Happy path (200/201)
   - [ ] Sin auth → 401
   - [ ] Sin la capability → 403 (usar `authedApi`, que tiene rol acotado)
   - [ ] Validación inválida → 422
   - [ ] Recurso inexistente → 404
   - [ ] Paginación → `expectPagination(body.meta)`
   - [ ] Cleanup en `afterAll` (soft via API + `hardDeleteByPath`)
4. Agregá el script `"test:mNN"` en `package.json`.

```ts
import { test, expect } from '../../fixtures/auth.fixture';
import { APP_ENDPOINTS, makeNombre } from '../../helpers/constants';
import { expectSuccess, expectError } from '../../helpers/response';

test('MNN.1 - crea un recurso', async ({ authedApi }) => {
  const res = await authedApi.post(APP_ENDPOINTS.areas, { data: makeNombre('Área') });
  const body = await expectSuccess(res, 201);
  expect(body.data).toHaveProperty('id');
});
```

### Nuevo evento WebSocket

1. Agregá tests en `tests/ws/m17-websocket.spec.ts` (o un archivo nuevo si es otro feature).
2. Conectá con `io(BACKEND_URL, { auth: { token }, transports: ['websocket'] })`.
3. Esperá eventos con `waitForEvent(socket, 'evento', 10_000)` — **nunca** `waitForTimeout`.

### Nueva página del shell (UI)

1. Agregá la ruta en `helpers/constants.ts → ROUTES`.
2. Usá `authedPage` y locators accesibles (`getByRole`, `getByLabel`); evitá clases CSS.
3. Mantené los tests UI mínimos y resilientes (el menú es permission-aware y su markup varía).

---

## Cómo modificar / eliminar

- **Endpoint cambió de path** → actualizá `helpers/constants.ts` y los specs que lo usan.
- **Modelo cambió de campos** → actualizá la factory `make*()` y los asserts específicos.
- **Endpoint eliminado** → borrá sus tests; si desaparece un módulo, borrá su `.spec.ts` y su script en `package.json`.
- **Envelope cambió** → actualizá `helpers/response.ts`.

---

## Convenciones

- **Naming**: archivos `mNN-{nombre}.spec.ts`; títulos `M{N}.{N} - ...` (UI: `M{N}U.{N}`).
- **Web-first assertions**: cero `waitForTimeout`. Usá `expect(locator).toBeVisible({ timeout })`, `waitForLoadState('domcontentloaded')`, `waitForURL()` y `waitForEvent` (WS).
- **Locators**: en UI preferí `getByRole(...)` accesibles.
- **Aislamiento**: limpiá lo que creás en `afterAll`. Para estado realmente limpio, `hardDeleteByPath` (best-effort, ignora errores de BD).
- **global-setup**: garantiza el rol + usuario de fixture; está documentado en `global-setup.ts`.
- **Idioma**: español argentino en descripciones y mensajes.

---

## Verificación

```bash
cd e2e
npx playwright test --list   # Debe listar todos los tests sin errores de parseo
npm run test:api             # Requiere backend en :3010 con la base sembrada (npm run init_db)
                             # ⚠️ crea y borra datos en la base: no apuntar a producción
```
