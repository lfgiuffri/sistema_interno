# Módulo `mantenimiento`

> ⚠️ **Keep in sync.** Backend en `backend/src/modules/mantenimiento/`; agente en `backend/agente/`; frontend en `frontend/src/views/mantenimiento/` + `stores/mantenimiento.ts`; e2e en `e2e/tests/api/m20-mantenimiento.spec.ts`.

Monitoreo de la infraestructura de la empresa: **Servidores** y **Sitios web**.

## Cómo se monitorea un servidor

Hay dos modos según quién administre el VPS:

| `monitorea` | Cómo | Qué se sabe |
|---|---|---|
| **true** (nuestro) | Un **agente** instalado en el VPS reporta cada minuto por HTTPS | CPU, RAM, disco por montaje, carga, uptime y estado online |
| **false** (de un tercero) | El scheduler prueba abrir una **conexión TCP** a `puertoChequeo` | Solo si responde o no |

**Por qué agente y no SSH:** el agente sale hacia la app (no abre ningún puerto en el VPS) y la app no guarda credenciales de acceso a los servidores — solo un token que sirve *nada más* que para reportar métricas. Si comprometieran la app, no se llevan los VPS.

**El heartbeat es el reporte:** no hay un ping aparte. Si el agente deja de reportar por más de `MANTENIMIENTO_MINUTOS_SIN_REPORTE` (default 5), el servidor pasa a `offline`. Eso detecta también un servidor prendido pero colgado, que responde al ping y no ejecuta nada.

**Chequeo externo de corroboración:** cuando un agente se calla, antes de abrir el incidente el scheduler prueba abrir una conexión TCP al `puertoChequeo` del servidor. El silencio del agente solo dice que *el agente* no habla; el puerto dice si el servidor sigue vivo. El aviso distingue los dos casos:

| TCP responde | Diagnóstico del aviso |
|---|---|
| No | «Sin reporte del agente … y tampoco responde en el puerto N» → el servidor está caído |
| Sí | «El servidor responde …, pero el agente no reporta» → probablemente se detuvo el servicio del agente |

## El agente

```bash
# En el VPS, como root. El token lo da la app al crear el servidor.
curl -fsSL https://sys.positivemedia.com.ar/api/agente/instalar-agente.sh | \
  sudo API_URL=https://sys.positivemedia.com.ar/api AGENT_TOKEN=<token> bash
```

Deja el script en `/usr/local/bin`, la config en `/etc/sistema-interno-agente.env` (permisos 600, solo root) y un **timer de systemd** que corre cada minuto. Es idempotente y se puede reinstalar para actualizar.

- Dependencias: bash, curl y coreutils. Nada más.
- **CPU**: dos muestras de `/proc/stat` separadas 1s (una sola lectura daría el promedio desde el arranque, que no sirve para alertar).
- **RAM**: `MemAvailable`, no `MemFree` — si no, cualquier servidor sano daría 95% por la caché.
- **Disco**: `df` excluyendo tmpfs/overlay; alerta el montaje más lleno, y se guarda el detalle de todos.
- Verificación: `journalctl -u sistema-interno-agente -n 20`.

**El token** se guarda **hasheado** (sha256) y se muestra UNA sola vez, como el secreto de los webhooks. Si se pierde, se regenera desde la llave del listado (y hay que reinstalar el agente).

### El servicio corre con el filesystem en solo lectura

El unit lleva `ProtectSystem=strict` + `ProtectHome=true` + `NoNewPrivileges=true`: el agente solo necesita **leer** `/proc` y `/etc`, así que no tiene por qué poder escribir nada. Consecuencia práctica, y **la trampa que ya nos comió una vez**:

> Con el filesystem en solo lectura, **un here-document de bash falla**. `<<EOF` no es una construcción en memoria: bash lo materializa en un archivo temporal y revienta con `cannot create temp file for here-document`. Lo mismo con `curl -o /tmp/...`.

Por eso el agente **no usa ningún archivo temporal**: el JSON se arma en una variable y la respuesta de curl se captura en memoria con `-w '\n%{http_code}'` (última línea = código, el resto = cuerpo o el error de curl). El unit además declara `PrivateTmp=true`, que le da un `/tmp` propio y escribible — el agente no lo usa, pero evita que cualquier agregado futuro vuelva a pisar esta mina.

Si tocás el script, probalo con el filesystem realmente en solo lectura antes de darlo por bueno:

```bash
unshare -rm bash -c 'mount -o remount,ro,bind /tmp; AGENTE_CONFIG=/etc/sistema-interno-agente.env bash /usr/local/bin/agente-sistema-interno.sh'
```

### Cuando el agente falla

| En `journalctl -u sistema-interno-agente` | Qué pasa |
|---|---|
| `cannot create temp file for here-document` / `Read-only file system` | Agente viejo (anterior a 2026-08-14) con el unit endurecido. **Reinstalá el agente** (el instalador es idempotente). |
| `ERROR HTTP 401` | El token no coincide con el del servidor en la app: regenerá el token desde la llave del listado y reinstalá. |
| `ERROR HTTP 000 — curl: (6) Could not resolve host` | DNS del VPS o `API_URL` mal escrita en `/etc/sistema-interno-agente.env`. |
| `ERROR HTTP 000 — curl: (7) Failed to connect` | El VPS no llega a la app (firewall de salida, app caída). |
| `ERROR HTTP 404` | `API_URL` sin el `/api` final. |

## Umbrales y alertas

Los umbrales globales se configuran en **Configuración → Negocio** (`MANTENIMIENTO_UMBRAL_CPU` 90, `_RAM` 90, `_DISCO` 85) y cada servidor puede tener el suyo, para el que legítimamente vive alto.

**Qué avisa cada servidor** (2026-08-28): además del umbral, cada servidor elige CUÁLES de las
cuatro alertas crea — `alertaOffline`, `alertaCpu`, `alertaRam`, `alertaDisco`, todas `true`
por defecto (migración `0008`, así que al desplegar nadie deja de recibir lo que recibía). Son
dos cosas distintas: el **umbral corre la línea**, esto **apaga el aviso**. Sirve para el
servidor que vive con el disco al 95% a propósito, o para el de pruebas que se apaga los fines
de semana; antes la única salida era sacarlo del monitoreo y perder también las métricas.

- **Apagar una alerta NO apaga el monitoreo**: la métrica se sigue guardando, el estado se
  sigue actualizando y el servidor se ve caído en la pantalla. Lo único que no pasa es que se
  abra el incidente y se le escriba a alguien.
- El corte está en **un solo lugar** (`abrirIncidente`), así que da igual quién detecte el
  problema —el reporte del agente, el tick de caídas o el chequeo TCP de los de terceros—: la
  decisión se respeta igual.
- **Al apagar una alerta se cierra su incidente abierto**, en silencio (`updateServidor`). Si
  no, quedaría trabado para siempre: un incidente se cierra cuando el valor vuelve a la
  normalidad, y en el servidor que vive alto eso no pasa nunca. Se cierra sin notificar a
  propósito — no se recuperó nada, lo apagó una persona. El historial queda.
- Sin dato = habilitada: callarse por omisión es el peor default posible en un monitoreo.
- En el listado, un servidor con alguna alerta apagada lleva el badge **«sin aviso»**: si se
  cae y no llega nada, la explicación tiene que estar a la vista.

**Anti-spam:** mientras un problema sigue abierto NO se vuelve a notificar. Se avisa dos veces —al abrirse y al resolverse— y queda el incidente en la bitácora con su duración (`servidor_incidentes`, un incidente abierto por servidor y tipo).

Los avisos van a los usuarios cuyo rol tenga `servidores:read`, por **tres canales**:

| Canal | Requisito | Si no está |
|---|---|---|
| Campana in-app + socket | ninguno | — |
| Email | `SMTP_*` en el `.env` | se saltea en silencio |
| Push | Firebase + el usuario con dispositivo registrado | se saltea en silencio |

Un canal caído nunca tumba el monitoreo: los envíos van con `catch`.

## Filtros del listado de sitios

Ocho filtros que se combinan entre sí y con el buscador: **disponibilidad**
(en línea / sin marcador / caído / sin chequear), **vencimientos** (dominio o certificado, por
vencer o vencido, más un «algo por vencer o vencido» que junta los cuatro casos),
**servicio**, **servidor**, **activo/inactivo**, **propios o de terceros**, **con incidentes
abiertos** y **rama**. Las dos opciones «Sin servicio» / «Sin servidor» existen porque un sitio
sin asignar es justamente lo que se busca cuando se está ordenando el inventario.

El de **rama** responde a la pregunta de todos los días: «¿qué clientes quedaron en
`development`?». Sus opciones salen de los datos y no de una lista fija, porque la rama la lee el
agente de `config_site.php` y un cliente puede estar en una rama de prueba con cualquier
nombre; con la lista fija, ese sitio sería el único imposible de filtrar. Suma dos opciones
que no son una rama, pero que son lo que se busca cuando algo no cuadra: **«sin rama
informada»** (el sitio usa FullGlass y aun así no se sabe en qué rama está — le falta el
servidor, la carpeta, o el agente todavía no reportó) y **«no usa FullGlass»**.

Se aplican **en el cliente**, igual que el buscador, y por el mismo motivo: el listado no
pagina (son decenas de sitios) y los estados de vencimiento son **derivados** — se calculan
contra la fecha en cada consulta y no se guardan. Filtrarlos en SQL obligaría a repetir ese
cálculo del otro lado, con el riesgo de que las dos copias se separen.

«Propios o de terceros» es la bandera `verificaMarcador` vista desde el otro lado: a los
nuestros les exigimos el marcador del footer, a los de terceros les alcanza un 2xx.

## Vistas por sitio

Un sitio **no siempre es una sola página**. Un cliente puede tener la home hecha por nosotros y
un `/ecommerce` montado aparte, o un `/blog` de un tercero. Chequear solo la raíz diría «está en
línea» mientras la tienda devuelve 500 desde ayer.

Cada sitio tiene N **vistas** (`sitio_vistas`), y cada vista lleva su propio:

- **«Esto lo administramos nosotros»** (`verificaMarcador`) — a lo nuestro le exigimos el
  marcador del footer; a lo de terceros le alcanza un 2xx. Exigirle el marcador a algo que no
  hicimos lo dejaría en `sin_marcador` para siempre.
- **Id del marcador** (`marcadorId`) — en `null` usa el **global** (config
  `MANTENIMIENTO_MARCADOR_ID`, default `app-conn-id`). El override existe porque un sitio viejo
  puede llevar todavía otro id y no vale la pena redeployarlo solo para monitorearlo.
- **Estado, tiempo y fallos consecutivos** propios.

**Todo sitio tiene al menos la `/`**: la crea el alta y la migración se la agrega a los que ya
existían, heredando su estado (mismo `fallosSeguidos`, mismo estado) para que el chequeo siga
donde estaba y no avise una caída falsa. Así el caso simple —un sitio, una URL— no cambia para
nadie. La **última vista no se puede eliminar** (409): un sitio sin ninguna URL dejaría de
monitorearse en silencio, que es lo que este módulo tiene que evitar; para eso está desactivar
el sitio, que es explícito y reversible.

**El sitio resume, la vista alerta.** La fila del listado muestra «2 de 3 vistas OK» (solo si
hay más de una: «1 de 1» sería ruido) y su estado es el **peor** de sus vistas activas — si la
tienda está caída, el sitio no está «en línea». Pero el **incidente y el aviso son por vista**,
con la clave anti-spam en `(sitio, vista, tipo)`: la home caída y la tienda caída son dos
problemas, y con la clave solo por sitio el segundo quedaría silenciado por el primero. El aviso
nombra la vista salvo que sea la home.

**Lo que NO se parte por vista**: el **dominio** y el **certificado**. Son del host, no de la
ruta, así que se consultan y avisan una vez por sitio — el TLS se lee del primer handshake que
funcione, porque todas las vistas comparten el mismo.

Rutas normalizadas al guardar: `tienda/` → `/tienda`, y si pegan la URL completa se recorta a su
ruta. Sin eso, `/tienda` y `/tienda/` serían dos vistas distintas del mismo lugar, con chequeos
y alertas duplicados. Recrear una vista eliminada la **reactiva** con el estado limpio (pasó
tiempo sin chequearse), mismo patrón que los catálogos.

## Velocidad: día, mes y año

Dos fuentes, y la distinción es el punto de todo esto:

| Tabla | Qué guarda | Cuánto vive |
|---|---|---|
| `sitio_chequeos` | un registro cada 5 minutos | **30 días** (se purga) |
| `sitio_velocidad_dia` | una fila por vista y día | **para siempre** |

Cuatro granularidades: **hora**, **día**, **mes** y **año**. La hora sale **siempre del
detalle** y de ningún otro lado — el rollup es diario, así que una vez purgado el detalle la
hora ya no se puede reconstruir. Por eso su ventana son las últimas 48 horas (de los 30 días
que hay) y no «todo». No se guarda un rollup horario a propósito: serían 24 filas por vista y
por día para responder una pregunta que solo tiene sentido sobre lo reciente («¿a qué hora se
puso lento hoy?»), y cuando el detalle se purga la pregunta deja de importar.

Sin el rollup, «¿el sitio está más lento que el año pasado?» no tendría respuesta: el detalle de
hace un año ya no existe. El resumen se consolida en la tarea diaria **antes** de purgar — el
orden importa, purgar primero borraría el dato sin resumirlo. Se consolidan los **últimos 7
días** y no solo ayer, así el proceso se recupera solo de un apagado de una semana; es
idempotente (único por `vistaId + fecha`), así que re-consolidar un día ya hecho no duplica.

Tres decisiones que se notan en los números:

1. **El promedio ignora los chequeos que no respondieron.** Un timeout de 12 s no es «12000 ms
   de latencia», es una caída. Mezclarlos haría que un día con tres caídas parezca un día lento.
   La caída se cuenta aparte, en `disponibilidad`.
2. **El mes y el año ponderan por muestras.** Promediar los promedios diarios le daría el mismo
   peso a un día con 12 chequeos que a uno con 288.
3. **El día de HOY sale del detalle**, no del rollup: todavía no está consolidado. Por eso se
   mueve durante la jornada, y la pantalla lo dice.

El tiempo medido es **solo el pedido HTTP**: el handshake TLS de la lectura del certificado es
otro socket y sumarlo inflaría la medición con algo que el visitante no espera.

La serie viene alineada con `periodos` y con `null` en los huecos, para que el gráfico **corte**
la línea en vez de unir dos meses lejanos o bajarla a cero (que leería como «respondió
instantáneo»).

## Historial

- `servidor_metricas`: detalle fino, una fila por minuto y por servidor.
- `servidor_metricas_dia`: resumen diario (promedio y máximo de cada métrica).

El scheduler consolida una vez por día y **purga el detalle de más de 30 días**: la tendencia larga sobrevive con ~365 filas al año por servidor en vez de medio millón.

---

# Sitios web

## Cómo se chequea un sitio

Cada 5 minutos el scheduler descarga la URL y decide entre **tres** estados, no dos:

| Estado | Cuándo | Por qué importa |
|---|---|---|
| `online` | responde 2xx **y** trae el marcador `<div id="app-conn-id">` del footer | el sitio anda de verdad |
| `sin_marcador` | responde 2xx pero **falta** el marcador | el servidor contesta, pero lo que sirve no es nuestro sitio (deploy roto, página del hosting, dominio apuntando a otro lado) |
| `offline` | timeout, error de conexión o status distinto de 2xx | está caído |

Un ping común confundiría los dos primeros: por eso se busca el marcador y no solo el código HTTP.

**Sitios de terceros:** si el sitio no es nuestro (no tiene el marcador), se destilda *«Es un sitio nuestro»* (`verificaMarcador = false`) y entonces alcanza con un 2xx. Sin eso quedaría en `sin_marcador` para siempre y el aviso perdería sentido.

**La alerta espera al segundo fallo seguido** (`MANTENIMIENTO_FALLOS_PARA_ALERTA`, default 2 = 10 minutos): un microcorte de red no despierta a nadie. La recuperación, en cambio, avisa enseguida.

## Dominio y certificado

- **Dominio**: se consulta por **RDAP** (el reemplazo moderno de WHOIS: JSON, sin scrapear texto) una vez por día. El servidor autoritativo se resuelve con el bootstrap oficial de IANA (`data.iana.org/rdap/dns.json`, cacheado un día), no con el redirector `rdap.org`: así no dependemos de un tercero.
  - Los subdominios se resuelven sacando etiquetas de a una (`app.cliente.com.ar` → `cliente.com.ar`), que es cómo se cubre sin la Public Suffix List que en `.com.ar` el registro son tres etiquetas y en `.com` dos.
  - **NIC Argentina publica RDAP**: los `.com.ar` devuelven fecha (verificado). Los TLD que **no** lo publican (`.io`, `.uy`, `.cl`…) se informan como tal y la fecha se carga **a mano**; una fecha manual pone `dominioAuto = false` y el refresco diario deja de pisarla.
  - Si RDAP falla, **nunca se borra** la fecha que ya estaba: solo se actualiza `dominioConsultadoAt`.
- **Certificado TLS**: sale del mismo chequeo, del handshake (`tls.connect` → `valid_to`), sin costo extra. Se lee con `rejectUnauthorized: false` **a propósito**: justamente el certificado vencido o inválido es el caso que hay que avisar, y con validación estricta ni se podría leer la fecha.

Los dos vencimientos avisan con anticipación configurable (`MANTENIMIENTO_DIAS_AVISO_DOMINIO` 30, `MANTENIMIENTO_DIAS_AVISO_TLS` 15). El estado (ok / por vencer / vencido) **no se guarda**: se deriva de la fecha en cada consulta, así nunca queda viejo.

## Historial de sitios

- `sitio_chequeos`: una fila por chequeo (cada 5 min), con status, tiempo y motivo. Se purga a los **30 días**.
- `sitio_incidentes`: bitácora con `tipo` (`offline`, `sin_marcador`, `dominio`, `tls`), apertura y resolución. Mismo anti-spam que servidores: uno abierto por sitio y tipo.

La ficha muestra la **disponibilidad** medida sobre los chequeos guardados.

---

## El punto ciego: quién vigila al que vigila

El monitoreo corre **dentro del proceso del backend**. Si se cae el VPS del Sistema Interno, se cae el monitoreo con él y nadie avisa. Por eso hay un endpoint público de salud, pensado para un watchdog **externo**:

```
GET /api/health   →  200 { ok: true, baseMs, uptimeSeg }   |   503 si la base no responde
```

Es público a propósito (un chequeo que pide credenciales no sirve como watchdog) y no expone nada sensible. Cómo engancharlo, en [deploy-vps-oracle.md](../deploy-vps-oracle.md#watchdog-externo).

## Endpoints

```
GET    /mantenimiento/servidores              inventario + última métrica + incidentes abiertos
POST   /mantenimiento/servidores              alta (devuelve el token del agente UNA vez)
GET    /mantenimiento/servidores/:id?dias=    ficha: series fina y diaria + incidentes
PUT    /mantenimiento/servidores/:id          editar (incluye umbrales propios)
POST   /mantenimiento/servidores/:id/token    regenerar token
PATCH  /mantenimiento/servidores/:id/active   activar/desactivar
DELETE /mantenimiento/servidores/:id          baja lógica

GET    /mantenimiento/sitios                  listado + estado + vencimientos derivados
POST   /mantenimiento/sitios                  alta
GET    /mantenimiento/sitios/:id              ficha: disponibilidad, chequeos, incidentes
PUT    /mantenimiento/sitios/:id              editar (fecha manual ⇒ dominioAuto = false)
POST   /mantenimiento/sitios/:id/chequear     chequeo manual (no abre ni cierra incidentes)
POST   /mantenimiento/sitios/:id/dominio      consulta RDAP a demanda
PATCH  /mantenimiento/sitios/:id/active       activar/desactivar
DELETE /mantenimiento/sitios/:id              baja lógica (cierra sus incidentes)

POST   /agente/metricas                       ⚠️ SIN sesión: auth por header x-agent-token
GET    /agente/instalar-agente.sh             instalador (público, sin secretos)
GET    /agente/agente-sistema-interno.sh      el agente
GET    /health                                ⚠️ público: salud para el watchdog externo
```

⚠️ Las rutas `/agente/*` se montan en `routes.js` **fuera de `verifyAccessToken`**, porque quien llama es una máquina y no una sesión. Tienen rate limit propio (30/min por IP) y la autenticación la resuelve el service comparando el hash del token.

## Capabilities

`servidores:read|create|update|toggle|delete` y `sitios:read|create|update|toggle|delete`.

`servidores:read` y `sitios:read` definen además **quién recibe las alertas** de cada sección.

## Configuración (Configuración → Negocio)

| Clave | Default | Qué hace |
|---|---|---|
| `MANTENIMIENTO_UMBRAL_CPU` / `_RAM` | 90 | % que dispara alerta (cada servidor puede tener el suyo) |
| `MANTENIMIENTO_UMBRAL_DISCO` | 85 | ídem, sobre el montaje más lleno |
| `MANTENIMIENTO_MINUTOS_SIN_REPORTE` | 5 | silencio del agente que cuenta como caída |
| `MANTENIMIENTO_FALLOS_PARA_ALERTA` | 2 | chequeos fallidos seguidos antes de avisar un sitio |
| `MANTENIMIENTO_DIAS_AVISO_DOMINIO` | 30 | anticipación del aviso de vencimiento de dominio |
| `MANTENIMIENTO_DIAS_AVISO_TLS` | 15 | ídem para el certificado |

## Scheduler

Dos handlers, ambos dentro del proceso del backend — que en producción es un servicio systemd, así que **el monitoreo sigue activo aunque nadie use la app**.

`monitoreo.handler.js` (servidores), en cada tick de 1 minuto:

1. **Caídas**: agentes que dejaron de reportar → chequeo TCP de corroboración → `offline` + incidente.
2. **Chequeo TCP** (cada 5 min): los servidores de terceros.
3. **Consolidación + purga** (1 vez por día): resumen diario y limpieza del detalle viejo.

`sitios.handler.js` (sitios web):

1. **Disponibilidad** (cada 5 min): descarga + marcador + certificado, con la regla de los N fallos seguidos.
2. **Dominios** (1 vez por día): refresco por RDAP y avisos de próximos a vencer.
3. **Purga** (1 vez por día): chequeos de más de 30 días.

Las marcas de «ya corrió hoy» van directo contra `Config` (`MANTENIMIENTO_ULTIMO_ROLLUP`, `MANTENIMIENTO_SITIOS_ULTIMO_DIARIO`) y **no** por `getAppConfig`: ese servicio solo acepta las claves declaradas en `APP_CONFIG_KEYS`, que son las configurables por el usuario.

## Frontend

| Pantalla | Ruta | Archivo |
|---|---|---|
| Servidores: listado + alta (con el comando de instalación) | `/mantenimiento/servidores` | `views/mantenimiento/ServidoresPage.vue` |
| Servidor: métricas, discos, gráfico e incidentes | `/mantenimiento/servidores/:id` | `views/mantenimiento/ServidorFichaPage.vue` |
| Sitios: listado, chequeo y consulta de dominio a demanda, detalle en modal | `/mantenimiento/sitios` | `views/mantenimiento/SitiosPage.vue` |

### Refresco automático

Las dos pantallas de servidores se actualizan solas **cada minuto**, igual que el panel y con las mismas reglas (`composables/useAutoRefresh.ts` + `components/shared/IndicadorAutoRefresh.vue`): se suspenden con la pestaña oculta y **al salir de la vista**, refrescan al volver, no encima pedidos y los errores se cuentan en el indicador del encabezado en vez de tirar toasts. Se pueden pausar desde ese mismo indicador y la preferencia queda guardada.

El minuto **no es arbitrario**: es el ritmo al que el agente reporta (timer de systemd), o sea cada cuánto puede haber un dato nuevo. Pedir más seguido devolvería exactamente lo mismo. Si algún día el agente cambia de cadencia, hay que mover `intervaloMs` en las dos pantallas.

## Resumen en el Panel

`GET /dashboard` trae un bloque `mantenimiento` con **conteos agregados**, nunca el detalle de cada servidor o sitio: el panel responde «¿está todo bien?» y, si no lo está, cuántos y de qué tipo. El detalle es el módulo.

- Lo arma `services/resumen.service.js`; cada mitad se calcula solo si el rol tiene `servidores:read` / `sitios:read` (la otra viaja `null` y el panel no la dibuja).
- **Servidores**: online / offline / sin datos, incidentes abiertos y el **pico** de CPU, RAM y disco entre todos. El pico solo mira métricas de los últimos 10 minutos, para no mostrar el valor congelado de un servidor que dejó de reportar.
- **Sitios**: online / sin marcador / caídos / sin chequear, más los conteos de dominios y certificados vencidos y por vencer.
- En la pantalla (sección **Infraestructura** de `HomePage.vue`) cada tarjeta muestra `online / total`, un punto de estado y —solo si hay algo mal— los problemas como badges: rojo lo que ya falla, ámbar lo que va a fallar.

El panel **se refresca solo cada minuto** (`composables/useAutoRefresh.ts`), pensado para dejarlo abierto en un monitor. Un minuto es el ritmo del monitoreo (los agentes reportan cada minuto, los sitios se chequean cada 5): bajar más solo agregaría consultas sin datos nuevos. El composable:

- **suspende con la pestaña oculta y al salir de la vista** — nada de pedir cada minuto contra una pantalla que nadie mira —, y **refresca al volver**, porque lo que quedó en pantalla ya está viejo;
- **no encima pedidos**: si una consulta tarda más que el intervalo, el tick siguiente se saltea;
- **no muestra toasts de error**: los cuenta. El indicador del encabezado pasa a «sin conexión» y vuelve solo. Una pantalla desatendida no tiene que llenarse de avisos por un microcorte;
- deja **pausar y reanudar** desde ese mismo indicador, y recuerda la preferencia en `localStorage`.

El gráfico reusa `GraficoLinea.vue`, que ahora acepta `labels` propias y `formato="porcentaje"` (antes tenía los meses y el eje en pesos fijos, porque nació para facturación).

## FullGlass: actualización de bases y deploy (2026-10-06)

Dos funciones que antes se hacían entrando por SSH a cada VPS: correr SQL sobre **todas las
bases de los clientes** de un servidor, y disparar el **deploy** de FullGlass. Solo aplica a
los servidores marcados con `tieneFullglass`.

En la ficha del servidor el bloque va **arriba de las métricas**, con los dos botones al
tamaño de una acción principal: cuando se entra a un servidor con FullGlass casi siempre es
para actualizar las bases o desplegar; las estadísticas se miran cuando algo anda mal, que es
menos seguido.

### Por qué el agente PREGUNTA en vez de que la app entre

El módulo vive de una propiedad: *la app no guarda credenciales de acceso a los servidores ni
abre puertos en ellos*. Habilitar ejecución remota por SSH la habría roto — el servidor de la
app pasaría a ser la llave de todos los VPS. En cambio el agente hace **pull**: pregunta si hay
trabajo, lo ejecuta él, y reporta. Siguen siendo solo peticiones HTTPS salientes.

El worker (`backend/agente/fullglass-worker.php`) está en **PHP y no en bash**: estos
servidores tienen PHP porque es lo que corre FullGlass, así que lee `config_site.php` con un
`include` —igual que el script `update_databases.php` que reemplaza— y habla con MySQL por
`mysqli`. Desde bash habría que parsear PHP y JSON a mano.

**No hay que pedirlo**: el instalador le pregunta a la app (`GET /agente/config`, con el mismo
token) si este servidor está marcado como que aloja FullGlass, y si lo está instala también el
worker. Es el MISMO comando de siempre:

```bash
curl -fsSL https://sys.positivemedia.com.ar/api/agente/instalar-agente.sh | \
  API_URL=https://sys.positivemedia.com.ar/api AGENT_TOKEN=<token> bash
```

El flag existía al principio y fue un error de diseño: la app ya sabe si el servidor tiene
FullGlass, y pedir que además alguien se acuerde de una variable deja el caso silencioso de un
servidor marcado en la app pero sin worker instalado — ahí la pantalla dice «el agente no
reportó sus sitios» y nadie sabe por qué. `FULLGLASS=1` sigue andando como override, para
instalar el worker ANTES de marcar el servidor.

⚠️ **Si marcás un servidor como FullGlass DESPUÉS de haber instalado el agente**, hay que
volver a correr el instalador en ese servidor (es idempotente). Si no, no tiene worker.

⚠️ **Su unidad de systemd tiene menos blindaje que la del agente de métricas, a propósito.** El
agente corre con `ProtectHome=true` y el filesystem en solo lectura y tiene que seguir así: es
lo que corre cada minuto en todos los servidores. El worker necesita leer `/home` y escribir
(el deploy), así que esos permisos se le dan **solo a él**. Separarlos acota el daño.

Timer cada **10 segundos**: lanzar algo desde la app se tiene que sentir inmediato, y cuando no
hay trabajo es una sola petición que termina al instante.

### El worker se actualiza solo

Cada cambio del worker obligaba a entrar a cada servidor a reinstalarlo. Como ya habla con la
app cada 10 s, ahora compara su propio sha256 contra el que publica `GET /agente/config` y, si
quedó viejo, se baja la versión nueva y termina la corrida; el timer vuelve en 10 s con ella.
**Con un deploy del backend alcanza: los servidores se ponen al día solos.**

No agrega confianza nueva — la app ya puede hacer que este worker ejecute comandos como root,
que es lo que hace el deploy, así que mandarle además el propio archivo no cambia el modelo de
amenaza. Lo que sí agrega es un modo de falla (un worker roto se propagaría a todos los
servidores de una), y contra eso van cuatro defensas:

1. Lo descargado tiene que **coincidir con el hash anunciado**; si no, no se toca nada.
2. Se valida la **sintaxis con `php -l`** antes de reemplazar. Probado: con una versión rota
   publicada, el agente la rechaza, deja el archivo viejo y **sigue trabajando normal**.
3. Se guarda la versión anterior al lado (`.bak`).
4. El reemplazo es un `rename()` sobre el mismo filesystem, **atómico**: nunca queda un archivo
   a medio escribir que la próxima corrida intente ejecutar.

La comprobación va ANTES de tomar un trabajo, así nunca se reemplaza el archivo con algo a
medio ejecutar. Reinstalar sigue sirviendo, y es lo único que instala el worker la PRIMERA vez.

#### El agente de métricas, igual pero con una advertencia

Mismo mecanismo y mismas cuatro defensas (con `bash -n` en lugar de `php -l`), con dos
diferencias:

- **No hace un pedido extra.** El hash viaja como `agenteHash` dentro de la respuesta de
  `POST /agente/metricas`, que el agente ya hace una vez por minuto. Y se actualiza **después**
  de reportar: una actualización que falle nunca cuesta la métrica de esa corrida.
- **Acá sí cambia el modelo de amenaza.** En un servidor sin FullGlass la app no podía
  ejecutar nada: el agente lee `/proc` y hace un POST, y se acabó. Darle autoactualización
  significa que la app puede reemplazarle el script que corre como root. Se acepta porque la
  alternativa real era entrar a mano a cada servidor cada vez que cambia una métrica —y eso,
  en la práctica, termina en servidores con agentes de distintas épocas—, pero el permiso se
  da del tamaño exacto del problema: la unidad conserva `ProtectSystem=strict` y
  `ProtectHome=true`, y abre **un archivo, no un directorio**:

  ```ini
  ReadWritePaths=/usr/local/bin/agente-sistema-interno.sh
  ```

  Sin esa línea el filesystem está en solo lectura y el agente **no puede** escribirse. No
  falla en silencio: loguea `autoactualización: no se pudo escribir … (¿falta reinstalar el
  agente?)`, que es justamente la señal de que ese servidor quedó con la unidad vieja y hay
  que correrle el instalador una vez más.

Probado de punta a punta contra la API: un agente viejo se pone al día en una corrida (y deja
el `.bak`), uno al día no toca nada, y con una versión **rota** publicada el agente la rechaza,
sigue reportando métricas y no deja archivos sueltos.

### El canario: por qué el SQL no se aplica a todo de una

`ALTER TABLE` **no se puede deshacer** — MySQL hace commit implícito en DDL—, así que «lo
envolvemos en una transacción» no existe para lo que estas corridas hacen. La única red real es
romper una base en vez de doscientas:

1. Se lanza → el agente corre el SQL en **UNA** base y reporta.
2. El trabajo queda en `espera_ok`. **No sigue solo.**
3. Una persona aprueba desde *Ejecuciones* → el agente toma el resto.

Es **una base por servidor**, no una global: que un servidor tenga el esquema viejo es
exactamente lo que rompe estas corridas, y con un canario global no se vería hasta estar
corriendo ahí. Si el canario falla, el trabajo queda en `error` y el resto no se toca.

### Rama de cada cliente: `main` o `development`

Cuando se desarrolla algo a medida se pasa al cliente a `development` para que lo pruebe, y
después vuelve a `main`. Eso se hacía entrando al servidor y tocando varios archivos, sin forma
de ver de un vistazo quién quedó en pruebas.

⚠️ La rama de pruebas se llama **`development`**, no `dev`: es el nombre real en los servidores
y el modal lo manda **tal cual** al script que la cambia. Vive en las constantes
`RAMA_ESTABLE` / `RAMA_PRUEBAS` de `SitiosPage.vue` —un solo lugar— justamente porque un
literal repetido que queda viejo manda al cliente a una rama que no existe. La pastilla del
listado, en cambio, pinta de verde `main` y de ámbar **cualquier otra cosa**: muestra lo que el
agente reportó, sea cual sea.

**La rama NO se guarda en la app: la REPORTA el agente.** La lee del `config_site.php` de cada
cliente (la clave se configura por servidor, `claveRama`, default `branch`) junto con el resto
del inventario. Si la guardáramos nosotros, el día que alguien la cambie a mano en el servidor
la pantalla mentiría — que es justo el problema que esto viene a resolver.

**El script lo distribuye la app**: vive en el repo en `backend/agente/cambiar-rama.sh`, se
publica en `GET /agente/cambiar-rama.sh` y el worker lo baja, lo deja en
`/usr/local/bin/fullglass-cambiar-rama.sh` y lo refresca cuando el hash que anuncia
`GET /agente/config` (`scriptRamaHash`) deja de coincidir con la copia local. **No hay que
subir nada a ningún servidor**: desplegar el backend alcanza. Es el mismo mecanismo que la
autoactualización del worker, con las mismas defensas (hash anunciado, `bash -n`, escritura
atómica) y una diferencia: no corta la corrida, porque no es el archivo que se está ejecutando.

⚠️ **La ruta la decide la app**, no el servidor: viaja en `scriptRamaRuta` y sale de la
constante `RUTA_SCRIPT_RAMA` de `trabajo.service.js`, la misma que se usa para componer el
comando por defecto. Si cada lado tuviera su propia idea de dónde está el archivo, el día que
uno cambie el comando apuntaría a la nada. El worker igual la valida (absoluta y terminada en
`.sh`) antes de escribir como root.

Por eso **`comandoCambiarRama` es un override opcional, no un requisito**: sin configurar nada
el trabajo sale con `/usr/local/bin/fullglass-cambiar-rama.sh {sitio} {rama}`. El campo queda
para un servidor con un layout propio.

Qué hace, por cliente: en `configs/config_site.php` mueve `branch` y `backTemplatesDir`, y en
`sitio/index.php` y `sitio/getPlugin.php` el `set_include_path` que apunta a
`../../../FullGlass{,Dev}/POSITIVEMEDIA`. Las dos trampas del layout, que es por lo que los
reemplazos van anclados a la CLAVE y no al texto de la ruta:

- `backCustomTemplatesDir` también contiene `FullGlass/adminFiles/templates/` y **no** cambia.
- `index.php` y `getPlugin.php` tienen un **segundo** `set_include_path`, a `/../FullGlass`,
  que tampoco cambia. El patrón exige los tres `../` y el `/POSITIVEMEDIA` final.

Son tres archivos, así que lo peor posible es quedar a mitad de camino (el config diciendo una
rama y el include apuntando a la otra). Por eso: comprueba todo —incluido que la carpeta
`FullGlassDev` EXISTA, que es el chequeo que evita dejar al cliente caído en un servidor que
nunca tuvo esa rama—, arma las tres versiones nuevas en temporales, verifica el resultado
(relee, no confía en `sed`) y las valida con `php -l`, y recién ahí escribe con respaldo; si
algo falla, deshace. Escribe con `cat > archivo` y no con `mv`, para no dejar los archivos del
cliente con dueño root. Es idempotente (volver a aplicar lo mismo sale por «ya estaba») y tiene
`--dry-run`, que muestra el diff sin tocar nada — conviene para el primer cliente de cada
servidor. Si falta la clave `branch`, la agrega y lo avisa.

El comando se configura en la ficha del servidor con dos marcadores:

```
/home/scripts/cambiar-rama.sh {sitio} {rama}
```

`{sitio}` es la carpeta del cliente y `{rama}` la destino. Los dos se **entrecomillan** al
resolver el comando (corre como root: una ruta con un espacio o una comilla no puede partirlo
en dos) y el comando resultante se guarda tal cual se ejecutó, para que el historial muestre la
línea exacta.

#### Los clientes que no declaran su rama

Los clientes de antes no tienen la key `branch` en su `config_site.php`. El agente no tiene de
dónde leerla, así que la columna queda vacía y el sistema no puede decir en qué rama están.

En el listado, ese «sin dato» es un **botón** (`sin dato · detectar`) que lanza el mismo script
con `--detectar`: mira a qué carpeta de FullGlass apuntan los tres archivos del cliente, deduce
la rama y **deja la key declarada como PRIMERA del arreglo** — arriba de todo, que es donde uno
la va a buscar al abrir el archivo. **No mueve al cliente de rama**, y por eso es seguro
ofrecerlo desde la pantalla: escribe una sola clave en un solo archivo.

Tres cosas que hacen que sea confiable:

- **Si los tres archivos no coinciden, no escribe nada.** Un cliente a mitad de un cambio
  anterior no tiene «una» rama, y estampar cualquiera de las dos sería convertir en dato algo
  que no es cierto. El error dice qué dice cada archivo y pide resolverlo con un cambio
  explícito.
- **No exige que exista `FullGlassDev`**, a diferencia del cambio de rama: no se mueve nada, y
  pedirla dejaría sin declarar su rama justo a los clientes de un servidor que solo tiene la
  estable — que son los que más la necesitan.
- **Se niega si el servidor tiene un `comandoCambiarRama` propio**: ese script no tiene por qué
  entender `--detectar`, y mandárselo sería invocar como root un comando con un argumento que
  no espera.

Si la key existe pero **contradice** a los archivos, la corrige **donde está** (no la mueve
arriba): es el archivo de un cliente en producción y un diff más grande no compra nada.

En el trabajo, la columna `rama` queda en **null** —todavía no se sabe cuál es, eso es lo que
va a averiguar— y el `comando` con su `--detectar` es lo que dice qué se hizo. No hizo falta
una columna nueva para distinguirlos.

⚠️ Para que el botón aparezca, el listado necesita saber si el agente **vio** esa carpeta:
`rutaInventariada` en la respuesta de sitios. Sin ese dato, `rama: null` tiene dos causas
—carpeta mal cargada, o cliente que no la declara— y la pantalla adivinaba la primera, que es
la que casi nunca pasa.

⚠️ **La rama destino va explícita, nunca se alterna.** Un «cambiar a la otra» parece cómodo,
pero si la app y el servidor están desfasados un instante manda al cliente a la rama contraria
a la que se quiso.

Cambiar de rama es un tercer tipo de trabajo (`rama`) junto a `sql` y `deploy`, así que hereda
gratis el historial, los permisos, la ejecución por agente y la captura de errores. Reusa la
capability `servidores:deploy-ejecutar`: decidir qué código corre un cliente es de la misma
clase que un deploy, y una quinta capability nacería sin que nadie la tenga.

**En el listado de Sitios web**, `usaFullglass` marca cuáles corren FullGlass —hay sitios viejos
que no— y `rutaFullglass` vincula el sitio con su carpeta en el servidor. Ese vínculo es lo que
permite cruzar la URL que se monitorea con lo que el agente ve en el disco; sin él no hay forma
de saber qué `/home/<cliente>` le corresponde a cada sitio. Un sitio de FullGlass sin rama dice
«sin dato» y el tooltip explica cuál de las tres causas es: falta el servidor, falta la carpeta,
o el agente todavía no reportó.

### Sentencias peligrosas

`DROP DATABASE/TABLE/COLUMN`, `TRUNCATE`, `UPDATE`/`DELETE` sin `WHERE` y `GRANT`/`REVOKE` se
detectan y exigen escribir **CONFIRMO**. No se bloquean: el día que haga falta un DROP de
verdad, bloquearlo obligaría a entrar al servidor a mano, que es lo que queremos dejar de hacer.
No es una defensa de seguridad —quien escribe el SQL ya tiene permiso para romper cosas—: es un
freno contra el copiar/pegar equivocado y el dedo rápido.

### Permisos

Cuatro capabilities, **configurar y ejecutar separados**, y separados entre base y deploy:

| | configura | ejecuta |
|---|---|---|
| Bases | `servidores:bd-config` | `servidores:bd-ejecutar` |
| Deploy | `servidores:deploy-config` | `servidores:deploy-ejecutar` |

El comando de deploy **corre como root** en el VPS: quien lo edita puede hacer cualquier cosa
ahí adentro, y eso no tiene por qué ser el mismo que aprieta el botón.

⚠️ Los campos sensibles viven en endpoints propios (`PUT /servidores/:id/config-bd` y
`/config-deploy`) y **no** en el PUT del servidor. Como `matchedData` whitelistea, alguien con
`servidores:update` no puede setear un comando aunque lo mande en el body.

### Detalles que importan

- **Sin contacto = error, no cola.** Un deploy que se dispara solo tres días después, cuando ya
  nadie se acuerda de haberlo pedido, es peor que uno que no corrió.
- **El comando se COPIA al trabajo al lanzarlo**: si alguien lo edita mientras el agente lo está
  por tomar, corre el que se aprobó.
- **Los `omitido` NO se listan en la pantalla.** Son las carpetas de la ruta recorrida sin un
  `config_site.php` legible, y en `/home` casi siempre son cosas que no son sitios de clientes
  (scripts, usuarios del sistema): mezclarlas con las bases actualizadas llenaba la tabla de
  filas que no dicen nada. Se siguen GUARDANDO —que una carpeta no tenga config es un dato— y
  la pantalla muestra solo el conteo al pie.
- **Historial base por base.** El script PHP anotaba la query en un `.txt` y nada más: si fallaba
  en el sitio 12 de 30, el registro decía igual que se había corrido. Ahora cada base deja su
  fila con filas afectadas o el error textual.
- **Las credenciales de los clientes nunca salen del servidor.** El agente lee
  `config_site.php`, conecta, y reporta solo sitio, base y resultado. El inventario
  (`servidor_sitios`) que alimenta la vista previa tampoco las tiene.
- **Huérfanos.** Si el agente muere a mitad, el trabajo quedaría en `canario`/`corriendo` para
  siempre. El worker reporta igual ante un fatal (`register_shutdown_function`), y pasados
  **45 minutos** sin reportar se puede destrabar a mano. El registro dice que lo cortó una
  persona y que **puede haber quedado aplicado** en el servidor: afirmar que «falló» sería
  inventar lo que pasó allá.
- **Dependencia**: el worker necesita `php` **7.0 o superior** con `mysqli`. El instalador
  verifica las dos cosas; si falta mysqli en tiempo de ejecución, el trabajo se marca con ese
  error en vez de quedar colgado.
  ⚠️ **El worker está escrito para PHP 7.0 a propósito** y por eso parece anticuado: sin arrow
  functions (`fn()`, 7.4), sin `str_contains()` (8.0) y sin tipos en las firmas. Los VPS de
  clientes corren la versión que necesita cada FullGlass, no la última. Una función de más
  explota en EJECUCIÓN, no al hacer `php -l`, así que no se ve en ningún lado: el worker muere
  en el journal y la app queda diciendo «el agente no reportó sus sitios». Antes de usar algo
  nuevo ahí, probalo de verdad contra la versión más vieja:
  `docker run --rm -v "$PWD:/app" php:7.0-cli php /app/fullglass-worker.php`.
- **Leer el journal del worker, con cuidado**: el timer corre cada 10 s, así que
  `journalctl -u sistema-interno-fullglass -n 20` muestra corridas ANTERIORES a lo que acabás
  de hacer. Al reinstalar, el archivo viejo puede haber fallado segundos antes de ser
  reemplazado y esas líneas aparecen igual: parece que la instalación falló cuando en realidad
  salió bien. Mirá la MARCA DE TIEMPO, o filtrá con `--since` (es lo que hace el instalador).
  Cada corrida sin trabajos deja una línea del tipo
  `sin trabajos; inventario de /home: 14 sitio(s), 1 sin config legible` — si esa línea está,
  el worker anda.
