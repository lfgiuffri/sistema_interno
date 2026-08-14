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

**Anti-spam:** mientras un problema sigue abierto NO se vuelve a notificar. Se avisa dos veces —al abrirse y al resolverse— y queda el incidente en la bitácora con su duración (`servidor_incidentes`, un incidente abierto por servidor y tipo).

Los avisos van a los usuarios cuyo rol tenga `servidores:read`, por **tres canales**:

| Canal | Requisito | Si no está |
|---|---|---|
| Campana in-app + socket | ninguno | — |
| Email | `SMTP_*` en el `.env` | se saltea en silencio |
| Push | Firebase + el usuario con dispositivo registrado | se saltea en silencio |

Un canal caído nunca tumba el monitoreo: los envíos van con `catch`.

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
