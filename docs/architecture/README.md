# Arquitectura — Sistema Interno (single-tenant)

> ⚠️ **Keep in sync.** Cableado en `backend/src/{database,associations,app,routes,index}.js`.
> La conversión desde Zero 2.0 multi-tenant está documentada en
> [ADR-015](../decisions/ADR-015-single-tenant-conversion.md).

## Vista general

Una sola base de datos (MariaDB/MySQL), un solo set de modelos Sequelize inicializados al
boot, y módulos pluggable autodescubiertos por manifest. El kernel provee la infra (auth,
capabilities, realtime, storage, scheduler, vault, config); los módulos de negocio se montan
solos detrás de `verifyAccessToken` y gatean cada ruta con `requireCapability`.

```
boot (index.js):
  initDatabase()            → conexión + modelos singleton (associations.js)
  runMigrations()           → deltas pendientes (src/migrations/*.js)
  mountFeatureModules()     → moduleLoader: escanea modules/*/module.manifest.js
  initSchedulerQueue() + startScheduler()   → tick por minuto (BullMQ o setInterval)
  Socket.IO                 → auth por JWT; rooms user:<id> + 'app'
```

## Flujo de request

```
helmet → json/urlencoded → globalRateLimit → req.io
  → dbContext (req.db, req.models)
  → actionTracking (auditoría en action_trackings)
  → /auth/*  : authRateLimit (público: signin/refresh/mfa-login)
  → resto    : verifyAccessToken → requireCapability(por ruta) → validator → controller
```

- `verifyAccessToken` recarga el usuario de la base en cada request (con su rol): las bajas
  y cambios de permisos impactan de inmediato.
- Deny-by-default: una ruta sin capability otorgada corta con 403 y el nombre de la
  capability faltante.

## kernel/ vs modules/ vs services/

- **`kernel/`** — infra que no cambia entre apps: users/roles/capabilities, auth
  (password/mfa/session/lockout), registry (Config/ActionTracking/ErrorLog), realtime,
  config-registry, vault, mail, migraciones, moduleLoader, handlerRegistry y el **barrel
  `kernel/index.js`** (única superficie de import para los módulos).
- **`modules/`** — features pluggable con `module.manifest.js` (auto-montados). `settings`
  es infra (montado explícito). `items` es la plantilla canónica (se elimina al final).
- **`services/`** — infra transversal: storage (local/S3, prefijo `app/`), webhooks
  salientes firmados, scheduler, push, sandbox, embeddings, ai, openapi, me, notifications.

## Datos

- Auto-discovery de modelos: toda factory `define<X>Model(db)` en una carpeta `models/`
  se instancia sola. `paranoid: true` (soft delete) como convención.
- **Datos de negocio colaborativos**: pertenecen a la empresa, no a un usuario. No se
  filtra por `userId` (el `userId` de autoría es informativo). El acceso se gatea por
  capabilities.
- Envelope de respuesta uniforme vía `responseManager`:
  `{ success, code, message, timestamp, data, meta }`.

## Permisos (capabilities)

Un rol = set de capabilities `modulo:accion` (tabla `role_capabilities`). El rol
**Administrador** (isSystem, seed) tiene el comodín `*`, que no es asignable a ningún otro
rol. `GET /me` expone `capabilities` + `declaredCapabilities` (catálogo) y el frontend arma
menú y botones con eso. Ver [ADR-003](../decisions/ADR-003-capabilities-rbac.md) y
`docs/auth.md`.
