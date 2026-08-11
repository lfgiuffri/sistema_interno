# Modularidad — Zero 2.0

> ⚠️ **Keep in sync.** Loader en `kernel/moduleLoader.js`, capabilities en `kernel/capability.js`, handlers en `kernel/handlerRegistry.js`.

La modularidad de Zero descansa en cuatro piezas del kernel que trabajan juntas. Para **crear** un módulo, ver [docs/modules/](modules/README.md). Este doc explica los **puntos de extensión**.

## 1. Manifest + module loader (`kernel/moduleLoader.js`)

Cada módulo feature trae un `module.manifest.js` (única fuente de verdad). Al boot:

- **`loadModules()`** escanea `modules/*/module.manifest.js`, valida cada uno (campos obligatorios `key`/`name`/`version`/`basePath`/`router`; `basePath` empieza con `/`; `router` es función) y el **grafo** (keys y basePaths únicos, `dependsOn` resueltas). Cualquier falla **tira** (un manifest mal formado es un bug, no algo a tolerar). Luego registra capabilities + handlers (scheduler/socket) del manifest. Cachea el resultado.
- **`mountModuleManifests(router, sharedMiddleware)`** monta cada router: `basePath → [sharedMiddleware] → router`. Se llama desde `routes.js#mountFeatureModules`, que `index.js` invoca antes de `listen()`.

Agregar un módulo = crear su carpeta con manifest. **No se toca ningún archivo central.**

> Nota: el modelo de datos del módulo lo descubre `associations.js` (auto-loader de Sequelize). El campo `models` del manifest sirve para validar disco-vs-manifest.

## 2. Capabilities (`kernel/capability.js`)

Micro-permisos `modulo:accion` (ej. `items:create`). Deny-by-default.

- Los módulos **declaran** sus capabilities en el manifest (`capabilities: [...]`), que el loader registra con `registerCapabilities`. `getDeclaredCapabilities()` lista todas las del sistema (para el seed de roles / admin UI).
- La **asignación** a roles vive en la tabla `RoleCapability`. El comodín `*` = todo (rol Administrador, no asignable a otros roles).
- **`requireCapability(cap)`** es el middleware por ruta: corre tras `verifyAccessToken`, resuelve las capabilities del rol del usuario (cacheadas en Redis 5 min), y autoriza si el rol tiene `cap` o `*`. Si no, 403. Función pura testeable: `roleHasCapability(caps, cap)`.
- Helpers de gestión: `setRoleCapabilities`, `grantAllCapabilities` (asigna `['*']` al rol admin en la provisión), `invalidateRoleCapabilities` (llamar tras cambiar permisos).

```js
// En las rutas del módulo:
router.post('/', requireCapability('items:create'), validateCreate, controller.create);
```

## 3. Plan gate (`kernel/moduleGate.js`)

No hay gating por plan (single-tenant, ver ADR-015): el único gating es por capability.

**Dos capas de autorización** sobre cada módulo:
2. `requireCapability(cap)` — ¿el **rol** puede esta acción? (RBAC)

## 4. Handler registry (`kernel/handlerRegistry.js`)

Los frameworks genéricos del core (scheduler, sockets, notification-actions, sandbox) NO conocen ningún dominio: iteran sobre handlers que los módulos registran. Con cero módulos de dominio, corren como no-op.

| Registrar con | Forma del handler | Cuándo corre |
|---------------|-------------------|--------------|
| `registerSchedulerHandler` | `{ name, run({ db, models, io }) }` | cada tick del scheduler (default 60s) |
| `registerSocketHandler` | `(socket, io) => void` | una vez por conexión de socket autenticada |
| `registerNotificationAction` | `{ match(value), run(ctx) }` | dispatch de quick-replies firmadas (el 1ro que matchea ejecuta) |
| `setSandboxResultHandler` | `(ctx) => Promise<void>` | al resolverse un job de sandbox (solo uno, el último gana) |

Un módulo los aporta desde su manifest (`schedulerHandler`, `socketHandler`) o importando los `register*` desde el barrel del kernel. Ejemplo de infra que usa esto: `kernel/realtime/presence.js` registra su `presenceHandler` con `registerSocketHandler` en el boot.

## El barrel (`kernel/index.js`)

Único punto de import de infra para los módulos. Si una pieza se reubica, se actualiza solo el barrel. Re-exporta: `responseManager`, `Paginate`, `validator`, `requireCapability`/`registerCapabilities`/`getDeclaredCapabilities`/`getRoleCapabilities`, `enforceLimit`/`incrementUsage`/`getUsage`/`canConsume`, storage (`putFile`/`getFile`/...), `dispatchWebhook`, embeddings (`indexEmbedding`/`searchEmbeddings`/...), vault (`vaultSet`/`vaultGet`/...), config (`getConfig`/`getSection`/...), y los `register*Handler`.

```js
// Un módulo SIEMPRE importa así:
import { responseManager, requireCapability, enforceLimit } from '../../../kernel/index.js';
// NUNCA: import { responseManager } from '../../../libs/responseManager.js';
```

Ver [ADR-004](decisions/ADR-004-modularity-manifest.md) y [ADR-002](decisions/ADR-002-kernel-vs-modules.md).
