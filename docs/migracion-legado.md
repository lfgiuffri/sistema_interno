# Migración de datos del sistema legado (PHP)

> ⚠️ **Keep in sync.** El script vive en `backend/src/exec/migrarLegado.js` (`npm run migrar_legado`). Si cambia un modelo, una capability o el schema, actualizá también el mapeo de este documento.

Copia **todo el contenido de negocio** del sistema PHP a la base del Sistema Interno **preservando los IDs originales**: abonos, clientes, servicios, proyectos, cobranzas, empleados, sueldos, tareas, usuarios y permisos quedan con el mismo `id` que tenían, así que ninguna referencia cruzada se rompe y cualquier planilla o link viejo sigue apuntando al mismo registro.

## Cómo se corre

```bash
# 1. Cargar el dump del legado en una base APARTE.
#    NUNCA sobre la base nueva: el dump trae DROP TABLE y la base se llama igual.
mysql -u<user> -p -e "CREATE DATABASE IF NOT EXISTS legado_php CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u<user> -p legado_php < sistema_interno.sql

# 2. Migrar (sin --confirmar solo informa qué haría).
cd backend
npm run migrar_legado                 # dry: muestra el impacto y no toca nada
npm run migrar_legado -- --confirmar  # ejecuta
```

Variables de entorno (opcionales — por defecto reusa las credenciales `DB_*` de la base nueva):

```
LEGACY_DB_NAME=legado_php   # base donde está cargado el dump del legado
LEGACY_DB_HOST · LEGACY_DB_PORT · LEGACY_DB_USER · LEGACY_DB_PASS
MIGRAR_LEGADO_CONFIRMAR=true   # equivalente a --confirmar (para correrlo desatendido)
```

### Garantías

- **Destructivo y avisado**: vacía las tablas de negocio del destino (incluidos los seeds y el usuario `admin`) antes de copiar. Sin `--confirmar` no hace nada.
- **Todo o nada**: el borrado y la copia van en una sola transacción; si algo falla, rollback y la base queda como estaba. Por eso se usa `DELETE` y no `TRUNCATE` (que es DDL y haría COMMIT implícito).
- **Re-ejecutable**: correrlo dos veces deja el mismo resultado. Sirve para repetirlo el día del deploy con un dump fresco.
- **Aborta** si `LEGACY_DB_NAME` es la misma base que `DB_NAME`.
- **AUTO_INCREMENT** de cada tabla importada se repone en `MAX(id)+1` al final (fuera de la transacción, porque `ALTER TABLE` es DDL): sin eso, el próximo alta chocaría con los IDs importados.

## Mapeo de tablas

| Legado | Nuevo | Notas |
|--------|-------|-------|
| `areas` | `areas` | `activa` → `activo` |
| `clientes` | `clientes` | directo |
| `servicios` | `servicios` | `area_id` → `areaId` |
| `formas_facturacion` | `formas_facturacions` | nombre de tabla pluralizado por Sequelize |
| `cuentas_pago` | `cuentas_pago` | directo |
| `espacios_trabajo` | `espacios_trabajo` | **se pierde `orden`** (el nuevo no lo tiene) |
| `roles` | `roles` | `nombre` → `label` + `name` (slug); `es_admin` → `isSystem` |
| `rol_permisos` + `rol_permisos_especiales` | `role_capabilities` | ver el mapeo de permisos más abajo |
| `usuarios` | `users` | ver la sección de usuarios |
| `usuario_espacios` | `usuario_espacios` | `puede_ver`/`puede_editar` → `ver`/`editar` |
| `listas` | `listas` | **se pierde `orden`** |
| `tareas` | `tareas` | directo (HTML de `descripcion` tal cual; el nuevo lo sanea al servir) |
| `tarea_estados` | `tarea_estados` | historial append-only |
| `empleados` | `empleados` | `categoria` (varchar) → enum de 4 valores, ya coincidían |
| `empleado_areas` | `empleado_areas` | N:N |
| `empleado_archivos` | `empleado_archivos` | ⚠️ copia los REGISTROS; los binarios se mueven a mano a `storage/empleados/<id>/` (el script avisa) |
| `vacaciones_asignacion` | `vacacion_asignaciones` | el legado no guarda fecha → `createdAt` = momento de migrar |
| `vacaciones_tomadas` | `vacacion_tomas` | `userId` queda NULL (el legado no registraba autoría) |
| `sueldo_actualizaciones` | `sueldo_actualizaciones` | historial de sueldos, base del "vigente" |
| `sueldo_pagos` | `sueldo_pagos` | planificación empleado × cuenta |
| `cuenta_disponible` | `cuenta_disponibles` | `disponible` → `monto` |
| `abonos` | `abonos` | directo |
| `actualizaciones` | `abono_actualizaciones` | `operationId` queda NULL (la idempotencia por operación nace con el sistema nuevo) |
| `facturaciones` | `facturaciones` | entran todas como vigentes: el legado no tenía anulación |
| `proyectos` | `proyectos` | las 5 fechas del ciclo de vida, directas |
| `cobranzas` | `cobranzas` | montos congelados tal cual |
| `configuracion` | `configs` | upsert por clave (ver abajo) |

### Configuración

| Clave legado | `configs.name` |
|--------------|----------------|
| `cotizacion_dolar` | `COTIZACION_DOLAR` |
| `tareas_dias_por_vencer` | `TAREAS_DIAS_POR_VENCER` |
| `redondeo_abonos` | `REDONDEO_ABONOS` |

Se hace **upsert**, no reemplazo: las claves propias del sistema nuevo (`AVISOS_ULTIMA_CORRIDA`, `GC_ULTIMA_CORRIDA`, y `REDONDEO_ABONOS` si el legado no la trae) sobreviven. Además se siembra el primer punto de `cotizacion_dolar` (histórico) con el valor vigente al momento de migrar.

### Zona horaria (detalle que importa)

El legado guarda las fechas de alta en columnas `TIMESTAMP` —que MariaDB convierte según la zona de la sesión— y el sistema nuevo usa `DATETIME`, que es "sin zona". Por eso el script lee el legado con **exactamente la misma zona** que usa la conexión de la app (`SELECT @@session.time_zone`): leerlo en UTC adelantaba 3 horas todas las fechas de alta.

## Permisos: secciones → capabilities

El legado tenía permisos de **grano grueso** (`ver`/`editar` por sección); el nuevo los tiene granulares (`modulo:accion`). El script expande cada flag al set correspondiente, y `editar` **implica** `ver`:

| Sección legado | `ver` otorga | `editar` agrega |
|----------------|--------------|-----------------|
| `dashboard` | `dashboard:read` | — |
| `clientes` | `clientes:read` | `create` · `update` · `toggle` · `delete` |
| `empleados` | `empleados:read` · `vacaciones:read` · `empleados-archivos:read` | `empleados:{create,update,toggle,delete}` · `vacaciones:manage` · `empleados-archivos:{upload,delete}` |
| `servicios` | `servicios:read` | `create` · `update` · `toggle` · `delete` |
| `areas` | `areas:read` | `create` · `update` · `toggle` · `delete` |
| `abonos` | `abonos:read` · `facturaciones:read` | `abonos:{create,update,toggle,delete,actualizar-precio,facturar}` · `facturaciones:anular` |
| `tareas` | `tareas:read` | `create` · `update` · `delete` · `estado` · `asignar` |
| `facturacion` (formas) | `formas-facturacion:read` | `create` · `update` · `toggle` · `delete` |
| `proyectos` | `proyectos:read` | `create` · `update` · `delete` |
| `cobranzas` | `cobranzas:read` | `create` · `update` · `mover` · `cobrar` · `descobrar` · `delete` |
| `sueldos` | `sueldos:read` · `sueldos:historial` | `sueldos:update` · `sueldos:actualizar` |
| `aumentos` | `aumentos:read` | `aumentos:manage` |
| `planificacion` | `planificacion:read` | `planificacion:manage` |
| `cuentas` | `cuentas:read` | `create` · `update` · `toggle` · `delete` |
| `usuarios` | `usuarios:read` | `create` · `update` · `toggle` · `delete` |
| `roles` | `roles:read` | `create` · `update` · `delete` |
| `configuracion` | `configuracion:read` | `configuracion:update` |
| `espacios` | `espacios:read` | `create` · `update` · `toggle` · `delete` · `asignar-usuarios` |
| `estadistica_areas` | `dashboard:read` | — (sección desactivada en el legado) |

El rol con `es_admin = 1` se convierte en el **rol de sistema** del nuevo (`name: administrador`, `isSystem`, capability `*`) y lleva **solo** el comodín. Las secciones o permisos especiales que no estén en el mapeo se informan como aviso y **no otorgan nada** (deny-by-default). La tabla `secciones` del legado no se migra: en el sistema nuevo el catálogo de permisos lo declaran los manifests en código.

## Usuarios

- **Contraseñas intactas**: el hash bcrypt (`$2y$10$…`) se copia tal cual. El sistema nuevo lo verifica por back-compat y lo re-hashea a argon2id en el primer login exitoso, sin pedir reset.
- **Username derivado del email**: el legado se loguea con email y el nuevo pide username, así que se usa la parte local del email (`leonel@…` → `leonel`), con desempate numérico si dos usuarios la comparten. El login del sistema nuevo acepta username **o** email.
- **`nombre` se parte** en `name` + `lastName` (primera palabra / resto).
- **El usuario `admin` del seed se borra** junto con el resto: quedan solo los usuarios reales del legado. Ojo con esto:

> Los **e2e** se autentican con `ADMINUSER`/`ADMINPASS` (default `admin`/`admin123`). Después de migrar esa cuenta ya no existe, así que hay que correr la suite con las credenciales de un admin real:
>
> ```bash
> cd e2e && ADMINUSER=<usuario_admin> ADMINPASS=<clave> npx playwright test tests/api
> ```
>
> (La alternativa es `cd backend && npm run init_db`, que recrea el `admin` del seed sin tocar los datos migrados — pero deja una cuenta con contraseña por defecto.)
>
> ⚠️ La suite crea y borra registros en la base contra la que corre: **no la apuntes a producción**. Si la corrés sobre una base con datos reales, revisá después que no queden filas con `E2E` en el nombre ni usuarios `e2e-*` (el usuario de fixture es estable y se recrea solo en la próxima corrida).

## Qué NO se migra (y por qué)

- **`intentos_login`** → bitácora de seguridad del legado, indexada por email; el sistema nuevo la lleva por username. Empezar limpio no pierde nada de negocio.
- **`cobranza_eventos`** → la bitácora append-only de cobranzas nace con el sistema nuevo (no existe en el legado): inventar eventos pasados sería auditoría falsa.
- **Anulaciones de facturación** → el legado no tenía el concepto; todas las facturaciones entran como vigentes.
- **`orden`** de espacios y listas → el schema nuevo no tiene esa columna.
- **Binarios** de archivos de empleados → hay que copiarlos a mano (ver la tabla de mapeo).

## Cómo verificar una corrida

El script imprime filas migradas por tabla y el listado de usuarios resultante. Para una verificación independiente, comparar las dos bases (mismo server) con `CAST(... AS BINARY)` — necesario porque tienen collations distintas (`utf8mb4_unicode_ci` vs `utf8mb4_general_ci`):

```sql
-- conteos e IDs
SELECT (SELECT COUNT(*) FROM legado_php.abonos) legado, (SELECT COUNT(*) FROM sistema_interno.abonos) nuevo;

-- contenido campo a campo (0 = idéntico)
SELECT COUNT(*) FROM legado_php.abonos l JOIN sistema_interno.abonos n ON n.id = l.id
WHERE NOT (CAST(l.precio AS BINARY) <=> CAST(n.precio AS BINARY)
       AND CAST(l.fecha_inicio AS BINARY) <=> CAST(n.fechaInicio AS BINARY)
       AND CAST(l.created_at AS BINARY) <=> CAST(n.createdAt AS BINARY));

-- sumas de control
SELECT (SELECT SUM(monto_pesos) FROM legado_php.facturaciones) legado,
       (SELECT SUM(montoPesos)  FROM sistema_interno.facturaciones) nuevo;

-- soft-delete coherente
SELECT COUNT(*) FROM legado_php.servicios l JOIN sistema_interno.servicios n ON n.id = l.id
WHERE (l.eliminado = 1) <> (n.deletedAt IS NOT NULL);
```
