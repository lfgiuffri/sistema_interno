# Cómo crear un módulo — Sistema Interno

> ⚠️ **Keep in sync.** La plantilla canónica es `backend/src/modules/items/`. Si cambia el contrato del manifest o la cadena de montaje, actualizá este doc.

Un **módulo feature** es una carpeta self-contained bajo `backend/src/modules/<key>/` con un `module.manifest.js`. El `moduleLoader` lo autodescubre al boot, lo valida y lo monta detrás de la cadena estándar. **No se toca ningún archivo central** para sumar un módulo.

La forma más rápida y segura de crear uno es **copiar `modules/items/`** y renombrar.

## Anatomía del módulo `items` (la plantilla)

```
modules/items/
├── module.manifest.js          # fuente de verdad del módulo
├── models/Item.js              # factory defineItemModel(tenantDb) + associate
├── services/item.service.js    # TODA la lógica + acceso a datos (sin req/res)
├── controllers/items.controller.js  # handlers finos: input → service → responseManager
├── routes/items.routes.js      # requireCapability + validator + controller por ruta
└── validators/items.validator.js    # express-validator por endpoint
```

## Paso a paso

### 1. El manifest (`module.manifest.js`)

Única fuente de verdad. Campos:

| Campo | Tipo | Obligatorio | Qué es |
|-------|------|:-:|--------|
| `key` | string | ✅ | slug único del módulo (ej. `items`) |
| `name` | string | ✅ | nombre legible |
| `version` | string | ✅ | versión semántica |
| `basePath` | string | ✅ | path de montaje, debe empezar con `/` (ej. `/items`) |
| `router` | Express.Router | ✅ | el router del módulo |
| `description` | string | | qué hace |
| `models` | string[] | | nombres de modelos que define (para validar disco-vs-manifest) |
| `capabilities` | string[] | | capabilities que expone (`items:read`, ...) |
| `dependsOn` | string[] | | keys de otros módulos requeridos (el loader falla si falta uno) |
| `schedulerHandler` | `{ name, run(ctx) }` | | tarea que corre en cada tick del scheduler por tenant |
| `socketHandler` | `(socket, io) => void` | | listeners de socket por conexión |

```js
import router from './routes/items.routes.js';

/** @type {ModuleManifest} */
export default {
  key: 'items',
  name: 'Items',
  version: '1.0.0',
  description: 'Módulo CRUD de ejemplo.',
  basePath: '/items',
  models: ['Item'],
  capabilities: ['items:read', 'items:create', 'items:update', 'items:delete'],
  minPlan: 'free',
  dependsOn: [],
  router
};
```

El loader valida: campos obligatorios presentes, `basePath` empieza con `/`, `router` es función, `key`/`basePath` únicos entre módulos, y `dependsOn` resueltas. Cualquier falla **tira** al boot (un manifest mal formado es un bug, no algo a tolerar).

### 2. El modelo (`models/<X>.js`)

Factory `define<X>Model(tenantDb)` (el auto-discovery la detecta por el nombre). `paranoid: true`. Relaciones en `associate`. OJO: el Sistema Interno es COLABORATIVO — los datos de negocio son de la empresa; `userId` es autoría, no filtro (a diferencia del `items` de ejemplo).

```js
import { DataTypes } from 'sequelize';

export const defineItemModel = (tenantDb) => {
  const Item = tenantDb.define('items', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.ENUM('active', 'archived'), allowNull: false, defaultValue: 'active' },
    userId: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    timestamps: true,
    paranoid: true,                  // soft-delete (convención del proyecto)
    indexes: [{ fields: ['userId'] }]
  });

  Item.associate = (models) => {
    if (models.User) Item.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return Item;
};
```

El modelo se descubre solo (está en una carpeta `models/`). No lo registres en ningún lado. El campo `models` del manifest es solo para validar disco-vs-manifest.

### 3. El service / helper (`services/<x>.service.js`)

**Toda** la lógica de negocio y el acceso a datos. No conoce `req`/`res`: recibe `models` + parámetros planos → testeable y reutilizable desde controllers, scheduler, sockets, jobs. **Filtra siempre por `userId`** (anti-IDOR).

```js
export const listItems = async (models, userId, query = {}) => {
  const { Item } = models;
  const where = { userId };
  if (query.status) where.status = query.status;
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const { rows, count } = await Item.findAndCountAll({ where, limit, offset: (page - 1) * limit, order: [['createdAt', 'DESC']] });
  return { rows, count, page, limit };
};

export const getItem = (models, userId, id) => models.Item.findOne({ where: { id, userId } }); // id Y userId → anti-IDOR
export const createItem = (models, userId, data) => models.Item.create({ ...data, userId });    // userId lo fija el server
```

### 4. El controller (`controllers/<x>.controller.js`)

Handlers finos: extraen input validado (`matchedData(req)`), llaman al service, responden con `responseManager`. Emiten socket en mutaciones. Aplican cuotas con `enforceLimit`. **Importan todo desde el barrel del kernel.**

```js
import { matchedData } from 'express-validator';
import { responseManager, Paginate, enforceLimit } from '../../../kernel/index.js';
import * as itemService from '../services/item.service.js';

export const list = async (req, res) => {
  try {
    const { rows, count, page, limit } = await itemService.listItems(req.models, req.user.id, req.query);
    return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
  } catch (e) { return await responseManager(500, e.message, req, res, true); }
};

export const create = async (req, res) => {
  try {
    const data = matchedData(req);
    // Cuota por plan: no crear más que el tope del plan del tenant.
    const { allowed, limit } = await enforceLimit({
      plan: req.tenant?.plan || 'free',
      limitName: 'items',
      count: () => req.models.Item.count({ where: { userId: req.user.id } })
    });
    if (!allowed) return await responseManager(403, `Alcanzaste el límite (${limit}).`, req, res, false, { errorCode: 'limit_reached' });

    const item = await itemService.createItem(req.models, req.user.id, data);
    if (req.io) req.io.to(`${req.tenant.id}:${req.user.id}`).emit('item:created', item);
    return await responseManager(201, item, req, res, false);
  } catch (e) { return await responseManager(500, e.message, req, res, true); }
};
```

### 5. Las rutas (`routes/<x>.routes.js`)

Cada ruta declara su **capability** con `requireCapability(...)` ANTES del validador y el controller. El loader ya montó el router detrás de `verifyAccessToken + planGate`, así que acá hay `req.user` y el tenant resuelto.

```js
import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/items.controller.js';
import { validateList, validateId, validateCreate, validateUpdate } from '../validators/items.validator.js';

const router = Router();
router.get('/',      requireCapability('items:read'),   validateList,   controller.list);
router.get('/:id',   requireCapability('items:read'),   validateId,     controller.getById);
router.post('/',     requireCapability('items:create'), validateCreate, controller.create);
router.put('/:id',   requireCapability('items:update'), validateUpdate, controller.update);
router.delete('/:id',requireCapability('items:delete'), validateId,     controller.remove);
export default router;
```

### 6. Los validadores (`validators/<x>.validator.js`)

express-validator por endpoint + el middleware `validator` (corta con 422). `matchedData(req)` en el controller solo expone los campos whitelisteados.

```js
import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateCreate = [
  body('name').isString().trim().notEmpty().isLength({ max: 120 }),
  body('status').optional().isIn(['active', 'archived']),
  validator
];
```

## Cómo se monta (resumen del mecanismo)

1. `index.js` llama `mountFeatureModules()` antes de `listen()`.
2. `loadModules()` escanea `modules/*/module.manifest.js`, valida, y registra capabilities + handlers (scheduler/socket) en el handlerRegistry.
3. `mountModuleManifests(router, [verifyAccessToken])` monta cada router: `basePath → verifyAccessToken → router del módulo`.
4. Dentro del router, cada ruta aplica su `requireCapability(...)`.

## Checklist

- [ ] Carpeta `modules/<key>/` con manifest + model + service + controller + routes + validator.
- [ ] Factory `define<X>Model`, `paranoid: true`, filtro por `userId`.
- [ ] Service sin `req`/`res`; controller fino; `responseManager` siempre.
- [ ] `requireCapability` por ruta; capabilities declaradas en el manifest.
- [ ] JSDoc en toda función; mensajes en español argentino.
- [ ] Tests e2e + actualizar el spec OpenAPI si aplica (ver SYNC RULE en `CLAUDE.md`).
- [ ] **No** editar `routes.js` (el loader lo descubre).

## Módulos infra vs feature

- **Feature** (con manifest, ej. `items`): autodescubierto. Vivís acá el 99% del tiempo.
- **Infra** (sin manifest, ej. `settings`): montados explícito en `routes.js`, siempre disponibles. Reservado para piezas always-on del producto base.
