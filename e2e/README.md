# Zero 2.0 — Tests End-to-End con Playwright

Suite de tests E2E automatizados con [Playwright](https://playwright.dev/) para verificar el backend de **Zero 2.0**: la API multi-tenant, su shell web y la capa de tiempo real (Socket.IO).

## ¿Qué es Playwright?

[Playwright](https://playwright.dev/) es un framework de testing end-to-end. Permite:
- **Testear APIs** directamente (HTTP requests sin browser)
- **Automatizar un browser real** (Chromium) — navegar, clickear, llenar formularios
- **Testear WebSockets** — conectar, emitir y escuchar eventos en tiempo real

Todo corre desde la terminal: corrés un comando y leés los resultados.

---

## ¿Qué testea esta suite?

**62 tests** organizados por módulo. El grueso es **API**; hay un test mínimo de **UI** (login del shell) y uno de **WebSocket** (conexión + presencia).

| Módulo | Área | Tipo | Qué cubre |
|--------|------|------|-----------|
| **M0** | Infraestructura | API | `GET /api/` sin tenant → 401 · `GET /api/openapi.json` → 200 · `GET /api/docs` (Scalar) → 200 |
| **M1** | Autenticación | API | `signin` (super_admin / tenant / mal password / validación) · `refresh` · `GET /me` · `GET /users/my-account` |
| **M2** | Middlewares | API | 401 sin token en rutas tenant · token inválido · 403 en rutas admin · rate limit (no-op en dev) |
| **M3** | Formato de respuesta | API | Envelope `{ success, code, message, timestamp, data?, meta? }` en éxito y error |
| **M4** | Self-signup | API | `POST /signup` (200/400) · `POST /signup/confirm` con token inválido → 400 · validación |
| **M5** | Items CRUD | API | CRUD completo del módulo de ejemplo `items` (paginación, validación, 404, 401) |
| **M6** | Capabilities & plan | API | Crea tenant `basic`, valida `GET /me` (enabledModules + capabilities) y creación dentro del plan |
| **M7** | Billing | API | `GET /billing/status` (shape) · 401 sin token · `checkout` sin plan → 400 |
| **M8** | Master tenants | API | super_admin: listar · crear · usage · stats · validación · 403/404 |
| **M9** | Catálogos & Settings | API | `GET/PUT /settings` · `GET /catalogs/:catalog` (currencies, frequencies) · 404 · 401 |
| **M17** | WebSocket | WS | Conexión con/sin token · `presence:list` (ack) · `broadcast:subscribe` (ack) |

### Tipos de test

| Tipo | Carpeta | Qué hace | ¿Browser? |
|------|---------|----------|-----------|
| **API** | `tests/api/` | Requests HTTP directos al backend. Valida status, envelope, lógica. | No |
| **UI** | `tests/ui/` | Abre Chromium y verifica que el shell renderiza el login. | Sí |
| **WebSocket** | `tests/ws/` | Conecta a Socket.IO y verifica auth + presencia. | No |

---

## Conceptos de Zero 2.0 que usan los tests

- **Base API**: `http://localhost:3010/api` (puerto `PORT` del backend, default 3010).
- **Envelope**: `{ success, code, message, timestamp, data?, meta? }`.
- **Headers**: `x-access-token` (JWT), `x-master-key` (clave maestra), `x-api-key` (tenant).
- **Auth**: `POST /master/auth/signin { username, password }`.
  - **super_admin**: username `admin`, password de `ADMINPASS` (default `admin123`).
  - **tenant admin**: su username es el `adminEmail` con el que se creó el tenant.
- **Admin de tenants** (super_admin, `x-access-token`): `GET/POST /master/tenants`, `GET /master/tenants/:id/usage`.
- **Tenant** (`x-access-token`): `GET /me`, CRUD `/items`, `GET /billing/status`, `/webhooks/*`, `/settings`, `/catalogs/*`.

---

## Pre-requisitos

1. **MariaDB/MySQL** con la master DB de Zero 2.0 sembrada (incluye el super_admin `admin`).
2. **Backend** corriendo en `http://localhost:3010`:
   ```bash
   cd backend && npm run dev
   ```
3. **Frontend** (shell) en `http://localhost:8100` — solo necesario para los tests UI:
   ```bash
   cd frontend && npm run dev
   ```
4. **Credenciales** — se leen automáticamente de `backend/.env` (`PORT`, `ADMINUSER`, `ADMINPASS`, `MASTER_API_KEY`, `MASTER_DB*`). No hace falta configurar nada extra.

### Tenant de fixture

`global-setup.ts` crea (una vez) un **tenant de fixture** estable contra el cual corren los tests tenant. Sus credenciales viven en `helpers/constants.ts → FIXTURE_TENANT` y se pueden sobreescribir por env (`E2E_TENANT_*`). El tenant se deja creado entre corridas (su BD es reutilizable). Plan por defecto: `premium` (habilita todos los módulos feature).

---

## Instalación (primera vez)

```bash
cd e2e
npm install                      # Instala dependencias
npx playwright install chromium  # Descarga el browser (solo para tests UI)
```

> Para únicamente **listar** los tests (`--list`) no hace falta el browser.

---

## Cómo correr los tests

```bash
# Todos
npm test

# Por tipo
npm run test:api      # Solo API (sin browser, rápido)
npm run test:ui       # Solo UI (Chromium)
npm run test:ws       # Solo WebSocket

# Por módulo
npm run test:m00      # Infraestructura
npm run test:m01      # Autenticación
npm run test:m05      # Items CRUD
npm run test:m08      # Master tenants
npm run test:m17      # WebSocket

# Por patrón
npx playwright test --grep "M1"

# Solo listar (no ejecuta nada; no requiere backend ni browser)
npm run test:list
```

---

## Estructura del proyecto

```
e2e/
├── playwright.config.ts          # 3 projects: api (paralelo), ui (secuencial), websocket
├── global-setup.ts               # Crea el tenant de fixture via admin API
├── package.json                  # Scripts por módulo (test:mNN)
├── tsconfig.json
│
├── fixtures/
│   ├── auth.fixture.ts           # authedApi (tenant), unauthApi, masterApi (super_admin) + cache de tokens
│   └── app.fixture.ts            # authedPage / adminPage (browser logueado) + navigateTo()
│
├── helpers/
│   ├── constants.ts              # API_BASE, AUTH/TENANT/MASTER_ENDPOINTS, FIXTURE_TENANT, factories
│   ├── response.ts               # expectSuccess / expectError / expectPagination / expectAuthResponse
│   ├── selectors.ts              # Selectores accesibles del shell (genéricos)
│   ├── tenantHelper.ts           # createTenantAndLogin(): crea un tenant y loguea a su admin
│   └── hardCleanup.ts            # hard-delete por SQL (tenants, global-configs, items) — best-effort
│
└── tests/
    ├── api/   m00..m09           # Tests de endpoints HTTP
    ├── ui/    m01-login-ui       # Test mínimo del login del shell
    └── ws/    m17-websocket      # Conexión + presencia Socket.IO
```

---

## Factories de datos (`helpers/constants.ts`)

| Factory | Para |
|---------|------|
| `makeItem(overrides?)` | Crear un item del módulo `items` |
| `makeTenant(overrides?)` | Payload de `POST /master/tenants` (incluye `domain`, `adminEmail`/`adminPassword` únicos) |
| `makeSignup(overrides?)` | Payload de `POST /master/auth/signup` |

---

## Convenciones

- **IDs de test**: `M{N}.{N}` (API/WS) y `M{N}U.{N}` (UI).
- **Web-first assertions**: nada de `waitForTimeout`. Se usa `expect(locator).toBeVisible({ timeout })`, `waitForLoadState('domcontentloaded')` y `waitForEvent` (10s) en WS.
- **Locators accesibles**: en UI se prefiere `getByRole` / `getByLabel` sobre clases CSS.
- **Cleanup**: los datos de prueba usan prefijo `E2E`. Los tenants creados se borran (soft + hard best-effort) en `afterAll`. Si un test falla a mitad, puede quedar data — es aceptable (soft delete).
- **Idioma**: español argentino en descripciones y mensajes.

---

## Tecnologías

- **[Playwright](https://playwright.dev/)** — testing E2E
- **[socket.io-client](https://socket.io/)** — cliente WebSocket para tests de real-time
- **[mysql2](https://github.com/sidorares/node-mysql2)** — hard-cleanup directo en la BD
- **[dotenv](https://github.com/motdotla/dotenv)** — carga credenciales desde `backend/.env`
