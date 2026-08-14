# Migraciones — Sistema Interno

> ⚠️ **Keep in sync.** Runner en `backend/src/kernel/migrations/migrationRunner.js`; migraciones en `backend/src/migrations/`.

Hay **dos caminos** para llegar al schema, y no se pisan:

| Camino | Cuándo | Qué hace |
|---|---|---|
| **`npm run init_db`** | Instalación **nueva** | Crea la base + `sync()` desde los modelos (schema al día) + seeds condicionales (rol Administrador, usuario admin, áreas, formas de facturación, cuentas). |
| **Migraciones** (este doc) | Base **existente**, con datos | Aplica **deltas versionados**: una migración = un cambio, idempotente y registrado. |

**Regla dura**: todo cambio de schema sobre una base con datos va por migración. Nunca `sync({ alter })` — te reescribe columnas y se lleva datos puestos.

## Estructura

Una sola carpeta, sin master ni tenants (la app es single-tenant):

```
backend/src/migrations/
├── 0001-documentacion.js
├── 0002-estadisticas-capability.js
├── 0003-mantenimiento-servidores.js
└── 0004-mantenimiento-sitios.js
```

El nombre es `NNNN-descripcion.js` y **el orden lexicográfico es el orden de aplicación**. Cada archivo exporta:

```js
/**
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Namespace de Sequelize (tipos, Op, …).
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => { /* aplica el cambio */ };
```

No hay `down`: revertir en producción es más peligroso que arreglar hacia adelante con otra migración.

## Cuándo corren

Al **boot** del backend, antes de escuchar (`AUTO_MIGRATE` distinto de `false`). El runner:

1. Crea `schema_migrations (name PK, appliedAt)` si falta.
2. Lee los nombres ya aplicados.
3. Corre las pendientes **en orden**, cada una en su transacción, y registra el nombre.

Una migración que falla corta el arranque: es la señal correcta — mejor no levantar que servir con el schema a medias.

## Idempotencia (no es opcional)

MariaDB hace **COMMIT implícito en cada DDL**: si una migración crea dos tablas y explota en la segunda, la primera **ya quedó** y la transacción no la revierte. Por eso cada migración tiene que poder re-correrse: preguntá antes de crear.

```js
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    // ⚠️ showAllTables() devuelve OBJETOS ({ tableName, schema }) en MariaDB, no strings:
    // con String() quedaría "[object Object]" y el guard NUNCA cortaría.
    const existentes = (await q.showAllTables()).map(t => String(t?.tableName ?? t).toLowerCase());
    const hay = (t) => existentes.includes(t);

    if (!hay('mi_tabla')) {
        await sequelize.query(`CREATE TABLE mi_tabla (...) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }
};
```

Para columnas, el equivalente es `describeTable('tabla')` y chequear la clave; para índices, `showIndex`.

## Actualizar una base ya en producción

Lo normal es desplegar el código y reiniciar: el runner aplica lo pendiente solo. Si preferís tocar la base a mano (o el deploy y la migración van separados), en [`sql/`](sql/) hay scripts SQL equivalentes, re-ejecutables, que además registran la migración en `schema_migrations` para que el runner no la repita.

Antes de cualquiera de los dos caminos: **backup**.

```bash
mysqldump -u sistema -p sistema_interno > backup-$(date +%F).sql
```
