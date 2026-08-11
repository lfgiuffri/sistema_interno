# Migraciones + Deploy — Zero 2.0

> ⚠️ **Keep in sync.** Runner en `kernel/migrations/migrationRunner.js`; migraciones en `src/migrations/{master,tenant}/`; controller/rutas en `services/migrations/`; deploy en `services/migrations/services/deploy.service.js`. Panel super-admin en `frontend/src/views/admin/AdminMigrationsPage.vue` + `stores/migrations.ts`.

Sistema de migraciones **versionadas** para la base maestra y para **cada** DB de tenant, más un **deploy de código** disparable desde el panel super-admin. Resuelve el problema de *schema drift*: tenants creados antes de un cambio de modelo quedan sin las columnas/índices nuevos.

## Dos mecanismos complementarios — no confundir

| Mecanismo | Cuándo | Qué hace |
|-----------|--------|----------|
| **Sync de provisión** (`tenants.controller.js`) | Al **crear** un tenant nuevo | Crea el schema **actual** completo desde los modelos. |
| **Migraciones** (este doc) | Sobre DBs **existentes** | Aplica **deltas versionados** (una migración = un cambio), idempotentes, registrados. |

Un tenant nuevo nace con el schema al día (sync) **y** con las migraciones marcadas como aplicadas recién cuando se corren — por eso las migraciones deben ser idempotentes (si la columna ya existe, no rompen).

## Estructura

```
backend/src/migrations/
├── master/        # se aplican a la DB maestra (zero2_master)
│   └── 0001-tenants-status-index.js
└── tenant/        # se aplican a CADA DB de tenant
    └── 0001-roles-isSystem.js
```

Cada archivo se nombra `NNNN-descripcion.js` (el orden lexicográfico **es** el orden de aplicación) y exporta:

```js
/** @param {import('sequelize').Sequelize} sequelize @param {typeof import('sequelize')} Sequelize */
export const up = async (sequelize, Sequelize) => { /* aplica el cambio */ };
export const down = async (sequelize) => { /* opcional: revierte */ };
```

## Cómo escribir una migración (idempotente — obligatorio)

En MariaDB/MySQL el **DDL hace COMMIT implícito**: la transacción del runner NO revierte un `ALTER TABLE`. Por eso toda migración debe chequear el estado **antes** de alterar, así un reintento es seguro. Plantillas vivas: copiá [`0001-roles-isSystem.js`](../backend/src/migrations/tenant/0001-roles-isSystem.js) (columna) o [`0001-tenants-status-index.js`](../backend/src/migrations/master/0001-tenants-status-index.js) (índice).

```js
// Agregar columna — idempotente vía describeTable
export const up = async (sequelize, Sequelize) => {
  const qi = sequelize.getQueryInterface();
  const table = await qi.describeTable('roles');
  if (!table.isSystem) {
    await qi.addColumn('roles', 'isSystem', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
  }
};
```

Para crear un índice usá `showIndex` + `addIndex`. Para data migrations puras (DML), también escribilas idempotentes (`INSERT ... ON DUPLICATE KEY`, `UPDATE` con `WHERE` acotado).

## Aplicar migraciones

**Al boot**: las migraciones **master** se aplican automáticamente al arrancar el backend (idempotentes). Se desactiva con `AUTO_MIGRATE=false`. Las **tenant** NO se corren al boot (iterar todos los tenants sería lento) → se disparan desde el panel.

**Desde el panel super-admin** (`/admin/migrations`): ver estado (pendientes por scope), aplicar a master / a todos los tenants / a un tenant puntual, y disparar el deploy.

**Por API** (super_admin, `x-access-token`):

| Método | Ruta | Qué hace |
|--------|------|----------|
| GET | `/api/master/migrations/status` | Estado: disponibles + pendientes en master y por tenant + `deployConfigured`. |
| POST | `/api/master/migrations/run` | Body `{ scope: 'master'\|'tenants'\|'all', dryRun?: boolean }`. |
| POST | `/api/master/migrations/run/tenant/:id` | Aplica las migraciones tenant a un tenant puntual. |
| POST | `/api/master/migrations/deploy` | Ejecuta `DEPLOY_COMMAND`; body `{ migrate?: boolean }` corre migraciones después. |

Todas pasan por `verifyAdmin` (solo `super_admin`). `dryRun: true` lista pendientes sin aplicar.

## Registro: `schema_migrations`

Cada DB (master y cada tenant) lleva su propia tabla `schema_migrations (name PK, appliedAt)`. El runner aplica solo lo que no figura ahí, en orden, y registra cada éxito en una transacción. Si una migración falla, aborta y propaga (no la marca como aplicada); `runAllTenants` no corta ante el fallo de un tenant: registra el error por tenant y sigue.

## Deploy de código

`POST /master/migrations/deploy` ejecuta el comando **preconfigurado** en `DEPLOY_COMMAND` (nunca un comando provisto por el request → sin superficie de inyección). Si no está seteado → `400`.

```bash
# bare-metal
DEPLOY_COMMAND="git pull && npm --prefix backend ci && npm --prefix backend run build && pm2 reload zero"
# Docker
DEPLOY_COMMAND="docker compose pull && docker compose up -d --build"
DEPLOY_TIMEOUT_MS=600000   # opcional, default 10 min
DEPLOY_CWD=                 # opcional, default cwd del proceso
```

El endpoint devuelve `{ stdout, stderr, success, exitCode }`. Con `{ migrate: true }` y deploy exitoso, corre las migraciones master + tenants a continuación (útil cuando el deploy trae migraciones nuevas).

## Env

```bash
AUTO_MIGRATE=true            # aplica migraciones master al boot (idempotentes)
# DEPLOY_COMMAND=            # vacío = deploy deshabilitado (endpoint responde 400)
# DEPLOY_TIMEOUT_MS=600000
# DEPLOY_CWD=
```

## Tests

`e2e/tests/api/m10-migrations.spec.ts` — estado, run idempotente, dry-run, scope por tenant, 404 tenant inexistente, 422 validación, 400 deploy no configurado, 403 sin super_admin.
