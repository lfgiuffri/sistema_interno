# Incidencias + Portal de clientes

Los clientes cargan sus reclamos desde un **portal propio** (URL y login aparte del sistema
interno) y el equipo los ve, los responde y los convierte en tareas. Es la primera vez que el
sistema autentica a alguien que **no** es un usuario interno, y eso condiciona casi todo lo que
sigue.

## Las dos superficies de autenticación

| | Sistema interno | Portal de clientes |
|---|---|---|
| Principal | `User` (rol + capabilities) | `ClienteUsuario` (solo su cliente) |
| Secreto | `JWT_SECRET` | **`JWT_PORTAL_SECRET`** |
| `type` del token | `access` / `refresh` | `portal_access` / `portal_refresh` |
| Id en el payload | `id` | **`sub`** |
| Dónde queda | `req.user` | **`req.clienteUsuario`** |
| Lockout | `login_attempts` | `portal_login_attempts` |
| Socket | sí (room `app`) | **no** |
| Montaje | detrás de `verifyAccessToken` | explícito en `routes.js`, fuera |

### Por qué tres cerrojos y no uno

`middlewares/verifyAccessToken.js` hace `jwt.verify(token, JWT_SECRET)` y después
`User.findOne({ where: { id: decoded.id } })`. Nada más. Si un token de portal llegara a pasar
esa verificación con `id: 1`, **sería el administrador del seed**. Los tres cerrojos son
independientes y cualquiera alcanza por sí solo:

1. **Secreto propio**, sin fallback a `JWT_SECRET`. El backend **no arranca** si falta, si mide
   menos de 32 caracteres o si es **igual** al interno (`validarConfigPortal`, llamado desde
   `index.js`). Falla al arrancar antes que en producción.
2. **`type` propio**: aunque los secretos colisionaran, `verifyAccessToken.js` corta en su
   chequeo de `type !== 'access'`.
3. **El id en `sub`**: si aun así llegara al `findOne`, buscaría `{ id: undefined }`.

`req.clienteUsuario` y no `req.user` tampoco es cosmético: `requireCapability` resuelve permisos
con `req.user.roleId` y cachea por `caps:default:<roleId>`. Con el principal en otra propiedad,
una ruta interna mal montada responde «No autenticado» en vez de aplicarle las capabilities del
rol interno que tenga ese mismo número.

`portal_login_attempts` es tabla propia porque `lockout.service.js:73` borra los fallos de una IP
al loguear bien: compartiéndola, un cliente entrando desde la IP de su oficina **le limpiaría el
contador de fuerza bruta al login interno**. Como el service hace `const { LoginAttempt } = models`,
alcanza con pasarle `{ LoginAttempt: models.PortalLoginAttempt }` — el kernel no se toca.

### Lo que el portal NO tiene, a propósito

- **Socket**: al conectarse, una sesión se une a la room `app`, que recibe los broadcasts de
  todos los clientes. Hay test negativo (M23.2).
- **Auto-registro y recuperación de contraseña**: las cuentas las crea y las resetea un usuario
  interno desde la ficha del cliente (capability `clientes:usuarios`). Elimina el flujo donde
  vive la enumeración de usuarios en una superficie expuesta a internet.
- **HTML en la descripción**: es texto plano. Sin editor no hay saneado que mantener ni lista
  blanca que revisar, en lo único que recibe contenido desde afuera.
- **Rate limit del `/auth` interno**: son 10 intentos por IP cada 15 minutos y los clientes
  salen todos por el NAT de su oficina — un torpe dejaría afuera a toda la empresa. El portal
  usa 60, y la defensa real es el lockout por par `(email, IP)`, que sí discrimina por persona.

## Estados

`nueva | en_progreso | resuelta`. Son **menos** que los de una tarea a propósito: el kanban
interno es asunto nuestro.

Hubo un cuarto, `cerrada`, que se sacó (2026-09-17, migración `0012`): se pisaba con `resuelta`.
En el portal las dos iban al fondo y decían lo mismo, así que la única diferencia real era que
alguien se acordara de cerrar — y si no se acordaba, todo quedaba en `resuelta` para siempre. Un
estado que solo agrega trabajo no es un estado. Las filas que estaban en `cerrada` pasaron a
`resuelta` **antes** de tocar el ENUM (si no, MySQL las convierte en cadena vacía sin avisar).

| tarea | incidencia |
|---|---|
| `abierta` | `nueva` |
| `en_progreso` · `pausada` · `en_revision` | `en_progreso` |
| `completada` | `resuelta` |

`abierta → nueva` y no `en_progreso`: que exista una tarea significa que la anotamos, no que
alguien la empezó. Decir «estamos trabajando en esto» cuando nadie la tocó es la clase de mentira
por la que el cliente después llama.

**Invariante:** *la incidencia es DERIVADA mientras tenga `tareaId`; es MANUAL si no tiene.*

**Ningún estado es terminal.** Al sacar `cerrada` se cayó también el corte de propagación que
tenía: mientras haya tarea, la incidencia la sigue. Si reabrimos una tarea porque en realidad no
estaba resuelta, el cliente lo ve volver a «en progreso» — que es justamente el caso en el que
más le importa enterarse. `resueltaAt` (antes `cerradaAt`) se sella al pasar a `resuelta` y se
**limpia** si vuelve para atrás: decir que se resolvió tal día ya no sería cierto.

Con tarea vinculada, la UI interna apaga TODAS las pastillas de estado y lo dice. No queda
escape manual: un botón que el próximo cambio de la tarea pisa sin explicación es peor que no
tener botón.

El mapeo vive en **una sola función pura**, `estadoDesdeTarea()`.

## Propagación tarea → incidencia

El estado de una tarea cambia en **siete** lugares (alta, alta múltiple, clonado de tarea,
clonado de lista, PUT completo, cambio suelto y cambio en lote). La propagación no se engancha en
esas siete funciones, sino en los **dos únicos escritores de bitácora** (`registrarEstado` y
`registrarCambios`, privados en `tarea.service.js`), por donde pasan todas. Parchear las públicas
de a una garantiza que el día que aparezca la octava, se escape.

Detalles que importan:
- Se saltea cuando `anterior === null` (un alta: una tarea recién creada todavía no puede tener
  incidencia). Eso evita una consulta por cada tarea al clonar una lista entera.
- Índice **UNIQUE** en `incidencias.tareaId`: hace barata la búsqueda y evita el doble vínculo si
  alguien aprieta dos veces «crear tarea» (devuelve 409).
- Sin import cruzado: `models.Incidencia` con guarda, e import diferido para las funciones.
- **Los dos soft-deletes se manejan explícitos.** `deleteTarea` y `eliminarTareasLote` no
  escriben estado, así que no pasan por la bitácora: sin el desenganche, la incidencia quedaría
  apuntando a una tarea invisible y congelada para siempre (y las tareas no tienen restore).

> ⚠️ Antes de esto, `updateTareaCompleta` hacía `estado: data.estado || 'abierta'`: un PUT sin
> estado **reabría la tarea en silencio**. Con la propagación cableada eso le habría reabierto el
> reclamo al cliente **y mandado un mail** por un renombre. Ahora es un PATCH real.

### La fecha estimada viaja por el mismo camino

`tareas.fechaVencimiento` → `incidencias.fechaEstimada`: es la respuesta a «¿para cuándo lo van a
tener?», que es lo segundo que pregunta un cliente. Se carga al convertir la incidencia en tarea
(el modal tiene el campo) y después sigue a la tarea cada vez que alguien la corre. El enganche es
`registrarCambios` —el mismo choque por el que pasa el estado—, porque `fechaVencimiento` ya está
en `CAMPOS_AUDITADOS`: la edición rápida y el PUT completo pasan los dos por ahí.

**Se guarda COPIADA, no se lee por el join**, y esa es la decisión de diseño: la respuesta del
portal **ya no incluye el objeto `Tarea`**. El nombre interno de la tarea, su espacio y su lista
son organización nuestra y no tienen por qué salir a internet; lo único que el cliente necesita es
la fecha. De regalo, si la tarea se elimina la incidencia se desliga pero la fecha que se le
prometió no se evapora.

No genera evento ni mail: correr una fecha interna no es un cambio de estado, y un mail cada vez
que alguien acomoda el tablero sería ruido. El cliente la ve la próxima vez que entra.

## Aviso al equipo cuando entra una incidencia

Un reclamo que nadie mira no sirve de nada, así que el alta notifica a quienes tengan
`incidencias:read` (campana + socket + Web Push, los tres de una con `crearNotificacion`, que es
el único punto por el que pasan todas las notificaciones del sistema). El que la cargó queda
afuera: nadie necesita que le avisen lo que acaba de escribir — por eso el test de esto
(**M23.8**) carga la incidencia *desde el portal*, donde el autor no es un usuario interno.

Es **distinto** del mail al cliente, que sigue saliendo por el outbox: dos avisos, dos públicos, y
uno no reemplaza al otro. Va después del commit y envuelto en un `try` mudo: la incidencia ya está
guardada y se ve en el listado. Quedarse sin campana es molesto; perder el reclamo, no.

Destinatarios: `usuariosConCapability()` en `kernel/capability.js`. Vive ahí porque «a quién le
avisamos» es la misma pregunta que ya resolvían, con la misma consulta copiada, los avisos diarios
y las alertas de mantenimiento.

## Mails: outbox, no envío en línea

El cambio de estado escribe una fila en `incidencia_cambios` con `notificadoAt: null`, **dentro de
la misma transacción**. Un handler del scheduler (tick por minuto) levanta las pendientes, agrupa
**por cliente** y estampa. Compra cuatro cosas: nada se manda si hay rollback, hay retry, un SMTP
lento no cuelga un request, y 20 tareas de un lote son un mail y no 20. Cuesta hasta un minuto de
latencia, que para esto no significa nada.

**Qué se avisa se configura por cliente** (`AVISOS_INCIDENCIA` en `models/Cliente.js` es la fuente
única: la usan el modelo, el outbox y la pantalla). Defaults: avisa al **crearse** y al quedar
**resuelta**; los pasos intermedios no.

El filtro por evento se aplica **en el outbox, no al escribir la bitácora**: la bitácora es
auditoría y registra lo que pasó, independientemente de las preferencias de aviso. La fila se
estampa igual con `notificado: false` cuando se omite, así no se reintenta para siempre y queda
registrado *por qué* no salió el mail — que es la pregunta del día que un cliente diga «no me
llegó nada».

Destinatarios: el campo `emailsNotificacion` del cliente, no los usuarios del portal. Puede
incluir a alguien que necesita enterarse sin entrar (el gerente, el que factura).

## Servicios elegibles

No hay tabla cliente↔servicio: se **derivan** de los abonos ACTIVOS y los proyectos del cliente.

⚠️ **Puede dar vacío legítimamente**: los abonos nacen inactivos (`Abono.activo` default `false`)
y `Proyecto.servicioId` es nullable. Por eso `servicioId` es opcional y la UI siempre ofrece
**«Consulta general»**: bloquear a un cliente por un dato de facturación sería hacerle pagar
nuestra contabilidad. El servicio se revalida en el servidor al crear — el listado es una ayuda,
no un permiso.

## Archivos

Reusa `services/archivos/archivoPrivado.service.js` (firma binaria, whitelist, límites) y los
headers defensivos de tareas. **Dos cosas que NO se copian de tareas:**

- **El servido va acotado por `clienteId`** y un archivo ajeno devuelve **404**. El modelo de
  tareas («nombre aleatorio de 80 bits + sesión, sin filtrar») es defendible entre compañeros de
  trabajo; entre clientes distintos no: un nombre filtrado en un mail reenviado o en un log de
  proxy daría acceso permanente al adjunto de otra empresa.
- **`IncidenciaArchivo` lleva `clienteId` desnormalizado y NOT NULL.** El archivo se sube ANTES de
  que exista la incidencia, y durante esa ventana es lo único que dice de quién es. Sin él, el
  ligado (`WHERE id IN (...) AND incidenciaId IS NULL`, sobre ids secuenciales) dejaría que el
  cliente A se quede con el adjunto en vuelo del B.

Al crear la tarea, los adjuntos se **copian** al almacén de tareas (no se comparte el binario:
son dos módulos con su propio directorio, y la tarea no puede colgar de un archivo que el GC de
incidencias haga desaparecer).

El GC de huérfanos cubre incidencias, y su gracia pasó de 48 h a **una semana**: desde que hay
portal, quien adjunta puede ser un cliente que sube tres PDF y vuelve el lunes.

## Capabilities

`incidencias:read` · `create` · `update` · **`estado`** (separada: mover el estado es lo que le
dispara el mail al cliente) · `delete`. Más `clientes:usuarios` para el ABM de accesos al portal
(repartir accesos a gente de afuera no es lo mismo que editar la ficha de un cliente).

Crear la tarea desde una incidencia pide **`tareas:create`**: crea una tarea.

## Endpoints

**Sistema interno** — `GET /incidencias`, `GET /incidencias/:id`, `POST /incidencias`,
`PUT /incidencias/:id`, `PATCH /incidencias/:id/estado`, `DELETE /incidencias/:id`,
`GET /incidencias/servicios/:clienteId`, `POST /incidencias/:id/tarea`, y los de archivos
(`POST|GET|DELETE /incidencias/archivos/...`).

**Portal** (fuera de `verifyAccessToken`) — `POST /portal/auth/signin`, `POST /portal/auth/refresh`,
`GET /portal/me`, `GET /portal/servicios`, `GET|POST /portal/incidencias`,
`GET /portal/incidencias/:id`, `POST /portal/archivos`, `GET /portal/archivos/:nombre`.

**Usuarios de portal** — `GET|POST /clientes/:id/usuarios`, `PUT|DELETE /clientes/:id/usuarios/:uid`,
`PATCH /clientes/:id/usuarios/:uid/active`.

## Frontend

- `/portal/*` vive en el MISMO build, con su propio login, su propio shell y su propio guard
  (early-return por prefijo en el `beforeEach`; si no, `meta.guest` dispararía `GET /me`, que no
  es del portal). Se publica en su subdominio apuntando al mismo build.
- `services/portalApi.ts` es una instancia axios aparte: claves `portalAccessToken` /
  `portalRefreshToken`, `/portal/auth/refresh` y redirect a `/portal/login`. **Regla dura:** nada
  bajo `views/portal/**` importa de `@/stores/*` ni de `@/services/api` — un import descuidado
  patea al cliente al login del sistema interno en el primer 401.
- Cada vista del portal es su propio `IonPage` con su `PortalHeader`. Un header puesto en el
  shell, hermano del `IonRouterOutlet`, queda **por encima** del contenido y se come los clics
  (lo primero que tapó fue «Nueva incidencia»). El outlet lleva `id="portal"`, distinto de
  `"main"`.
- `stores/portal/*` tiene su propio reset: `stores/reset.ts` es del sistema interno y llamarlo
  desde el portal borraría el estado del otro.
