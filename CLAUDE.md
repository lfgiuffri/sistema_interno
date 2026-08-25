# CLAUDE.md — Guía para IA (Sistema Interno)

> Contexto completo para que Claude (o cualquier IA) programe el Sistema Interno de forma
> autónoma. Leé este archivo primero. Para el detalle, ver `docs/`. El PRD del producto vive
> en `../PRD.md` y el análisis del sistema PHP legado en `../analisis_app_php/`.

## Qué es

**Sistema Interno de Positive Media**: app de administración de la empresa (clientes, abonos,
proyectos, empleados, sueldos, tareas). Arquitectura **SINGLE-TENANT**: una sola base de
datos, sin planes ni billing, sin signup público — los usuarios los crea un administrador.
Permisos por **capabilities granulares** (`modulo:accion`).

## Stack

| Componente | Tecnología | Puerto | Path |
|------------|-----------|--------|------|
| Backend | Node.js ESM · Express · Sequelize 6 · MariaDB/MySQL | 3010 | `backend/` |
| Frontend | Vue 3 · Ionic · Vite · Capacitor · Pinia · Tailwind | 8100 | `frontend/` |
| E2E | Playwright (api / ui / websocket) | — | `e2e/` |

## Comandos esenciales

```bash
# Backend
cd backend && npm run init_db   # provisión: crea DB + schema + seed (rol Administrador + admin)
cd backend && npm run dev       # dev (babel-node + nodemon) en :3010
cd backend && npm run build     # build a build/
cd backend && npm run migrar_legado -- --confirmar   # copia los DATOS del PHP legado (docs/migracion-legado.md)

# Frontend
cd frontend && npm run dev      # dev en :8100
cd frontend && npm run build    # vue-tsc + vite build (debe quedar VERDE)

# E2E (requiere backend + frontend corriendo)
cd e2e && npm test
```

Docs interactivas: `http://localhost:3010/api/docs` (Scalar) · spec: `/api/openapi.json`.
Login inicial: `admin` / `ADMINPASS` (default admin123).

---

## Arquitectura (single-tenant)

### Base de datos única
- `backend/src/database.js` — conexión única (env `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS`)
  y singleton de modelos (`getModels()`), inicializados al boot (`initDatabase()`).
- `backend/src/associations.js` — auto-discovery de modelos (factories `define<X>Model(db)`
  en carpetas `models/` de `kernel/`, `modules/` y `services/`). No hay registro central.
- `middlewares/dbContext.js` inyecta `req.db` / `req.models` en cada request (los services
  siguen recibiendo `models`: el contrato de los módulos no cambió al pasar a single-tenant).
- **NO existe** base maestra, tenants, planes, billing, signup, Auth0 ni passwordless.

### kernel/ (infra) vs modules/ (pluggable)
```
backend/src/
├── kernel/
│   ├── users/               # User, Role, RoleCapability, LoginAttempt + auth/roles/users
│   ├── auth/                # password (argon2id), mfa (TOTP), session (JWT), lockout
│   ├── registry/models/     # Config, ActionTracking, ErrorLog
│   ├── realtime/            # presence.js (presencia + broadcast, rooms user:<id> y 'app')
│   ├── config-registry/  vault/  mail/  migrations/
│   ├── capability.js  moduleLoader.js  handlerRegistry.js
│   └── index.js             # BARREL: superficie pública de infra para los módulos
├── modules/                 # PLUGGABLE — cada uno con module.manifest.js
│   ├── abonos/ areas/ clientes/ dashboard/ documentacion/ empleados/ espacios/
│   ├── mantenimiento/       # servidores (agente, métricas) + sitios web (uptime, dominio, TLS)
│   ├── formas-facturacion/ proyectos/ servicios/ sueldos/ tareas/
│   └── settings/            # infra (montado explícito en routes.js)
├── services/                # storage, webhooks, embeddings, ai, scheduler, push, sandbox,
│                            # openapi, me, notifications, migrations runner
└── database.js  associations.js  app.js  routes.js  index.js
```

Regla de oro: **un módulo de `modules/` importa infra SOLO desde `kernel/index.js`** (el barrel).

### Flujo de request
```
helmet → json → globalRateLimit → req.io
  → dbContext → actionTracking
  → [auth: rate limit propio, público]
  → [resto: verifyAccessToken → requireCapability(por ruta)]
```

### Auth (`kernel/users/controllers/auth.controller.js`)
- `POST /api/auth/signin { username, password }` → `{ accessToken, refreshToken, expiresIn, user }`
  (o `{ mfaRequired, mfaToken }`). Acepta username o email.
- Password argon2id (back-compat bcrypt con rehash-on-login). MFA/TOTP opcional con backup codes.
- **Lockout** (`kernel/auth/lockout.service.js`): 5 fallos/15min por usuario+IP → 429
  `LOGIN_LOCKED`; 15 fallos por IP → bloquea la IP. El username solo nunca bloquea (anti-DoS).
  Un login exitoso limpia los fallos del usuario/IP.
- Tokens con payload mínimo `{ id, username, type }`: el rol y el estado activo se releen de
  la base en CADA verify → una baja o cambio de rol impacta de inmediato.
- `POST /auth/refresh` (x-refresh-token) · `POST /auth/change-password` (step-up, min 8)
  · `POST /auth/mfa/{enroll,activate,disable,login}` · `GET /auth/mfa/status`.
- Headers: `x-access-token` / `x-refresh-token`. No existen x-api-key ni x-master-key.

### Permisos: capabilities granulares
- Un rol = set de capabilities (`RoleCapability`). El rol **Administrador** (seed) es
  `isSystem` + capability `*`: no se edita ni se elimina, y el comodín NO es asignable a
  otros roles. Deny-by-default.
- Cada ruta declara su capability con `requireCapability('modulo:accion')`. Las declaran los
  módulos en su manifest, o `registerCapabilities([...])` en rutas de kernel/services.
- Catálogo por prefijo de módulo (`usuarios:read`, `usuarios:create`, `usuarios:update`,
  `usuarios:toggle`, `usuarios:delete`, `roles:*`, `webhooks:manage`, y las de cada módulo
  de negocio). El catálogo completo es el del PRD §4 — todos los módulos están construidos.
- `GET /me` → `{ user, modules, capabilities, declaredCapabilities }`: el frontend arma el
  menú y gatea acciones con eso (store `me`: `can(cap)` / `canAny(modulo)`).
- Protecciones de usuarios: nadie se desactiva/elimina/cambia el rol a sí mismo; el ÚLTIMO
  admin activo no se puede desactivar/eliminar/degradar; unicidad de username/email contra
  no-eliminados. `PUT /users/my-account` permite editar el perfil PROPIO sin capability
  (campos whitelisteados: nombre, apellido, email, avatar, password).

### Realtime (Socket.IO)
- Auth en el handshake: `io(url, { auth: { token } })`. Rooms: `user:<id>` (personal) +
  `app` (global). Presencia + broadcast en `kernel/realtime/presence.js`
  (`presence:list`, `broadcast:subscribe/send` → evento `broadcast:<channel>`).

### Scheduler
- `services/scheduler`: UN job repetible (BullMQ si hay Redis, setInterval si no), tick por
  minuto que ejecuta los handlers registrados: `handler = { name, run({ db, models, io }) }`.

### Envelope de respuesta
Siempre vía `responseManager`: `{ success, code, message, timestamp, data, meta }`.
Paginación en `meta` (helper `Paginate`). Validación: express-validator → 422.

### Migraciones
- Carpeta única `backend/src/migrations/*.js` (`export const up = async (sequelize, Sequelize)`),
  idempotentes (MariaDB hace COMMIT implícito en DDL). Corren al boot (`AUTO_MIGRATE!=false`).
  ⚠️ `showAllTables()` devuelve OBJETOS (`{ tableName, schema }`), no strings: normalizá con
  `String(t?.tableName ?? t)` o el guard de idempotencia nunca corta.
- Instalación nueva: `npm run init_db` (CREATE DATABASE + `sync()` + seeds condicionales).
- **Todo cambio de schema sobre una base con datos → migración**, nunca `sync({alter})`.

---

## Frontend (design system propio)

- **Dirección** (PRD §7.0): neutros zinc + UN acento esmeralda (`#0F7660`), estética sobria
  tipo Linear/Notion, bordes 1px, sombras casi nulas, densidad media (filas 44px), tipografía
  **Geist** (self-hosted vía @fontsource). Nada de índigo/púrpura genérico. Sin emojis en UI.
- **Tokens**: CSS vars `--s-*` (tripletas RGB) en `src/theme/global.css`, mapeadas en
  `tailwind.config.js` (`bg-surface`, `text-ink`, `border-line`, `bg-accent`, …). Tema claro
  default + oscuro con clase `.dark` (composable `useTheme`, persiste y sigue al sistema).
- **Clases compuestas del DS**: `ds-card`, `ds-btn-{primary,secondary,ghost,danger}`,
  `ds-input`, `ds-label`, `ds-error`, `ds-hint`, `ds-badge-*`, `ds-table`, `ds-skeleton`,
  `ds-modal(-backdrop)`, `ds-enter`. Usalas antes de inventar estilos nuevos.
- **Shell**: `views/AppShell.vue` — split-pane con menú lateral por grupos, filtrado por
  capabilities (`meStore.canAny('<modulo>')`). Agregar módulo nuevo = sumar la entrada al
  array `NAV` + la ruta lazy en `router/index.ts`.
- **Stores** (Pinia setup stores, feature-scoped): `auth` (login/MFA/logout), `me`
  (`loadContext()` → GET /me; `can`/`canAny`), `users`, `roles`, `mfa` y los de cada módulo +
  `reset.ts` (limpieza al logout — registrá ahí todo store nuevo).
- **Páginas**: root `<IonPage>`, datos en `onIonViewWillEnter`, acciones gateadas con
  `meStore.can(...)`, estados de carga (skeleton) + vacío + error SIEMPRE.
- **Responsive**: el sistema se usa desde el celular a diario. Reglas y auditoría en
  `docs/responsive.md` (`e2e/auditar-responsive.mjs` + `auditar-modales.mjs` MIDEN, no
  miran: texto que no entra en su caja). Lo clave: una tabla ancha **se recorre, no se
  comprime** (`min-width` + `overflow-x-auto` + primera columna `sticky` con fondo opaco);
  una fila `label`+`control` se APILA en celular (si no, el control con `flex-shrink: 0`
  deja la etiqueta en 0px y el texto sale una letra por renglón); un item de grid necesita
  `min-w-0` (su `min-width: auto` = min-content, así que un `truncate` largo lo ensancha y se
  sale); y toda fila de controles va con `flex-wrap`.
- **Cotización del dólar**: `components/shared/CotizacionDolar.vue` — se muestra y se edita
  desde el panel, abonos, cobranzas y la grilla (variantes `chip` y `texto`). Emite
  `actualizada` y CADA vista recarga: los montos en pesos dependen de ese número. Editar
  exige `configuracion:update`; sin permiso se ve el valor y el histórico.
- Español argentino. TypeScript estricto (`vue-tsc` debe quedar verde).

## Cómo agregar un MÓDULO feature (checklist)

> Copiá un módulo chico existente (`backend/src/modules/areas/`) como plantilla. Detalle en `docs/modules/README.md`.

- [ ] `modules/<x>/models/<X>.js` — factory `define<X>Model(db)` + `associate`, `paranoid: true`.
- [ ] `modules/<x>/services/<x>.service.js` — TODA la lógica + datos (sin `req`/`res`).
      ⚠️ Sistema Interno es COLABORATIVO: los datos de negocio son de la empresa, NO se
      filtran por `userId`. `userId` queda como autoría.
- [ ] `modules/<x>/controllers/<x>.controller.js` — finos: `matchedData` → service →
      `responseManager`. Emiten socket en mutaciones.
- [ ] `modules/<x>/validators/<x>.validator.js` — express-validator por endpoint.
- [ ] `modules/<x>/routes/<x>.routes.js` — `requireCapability('<x>:accion')` por ruta.
- [ ] `modules/<x>/module.manifest.js` — `{ key, name, version, basePath, models, capabilities, router }`.
- [ ] **No se toca `routes.js`**: el moduleLoader lo autodescubre y monta.
- [ ] Frontend: store + página + entrada en NAV + ruta. E2E: spec nuevo en `e2e/tests/api/`.

## Convenciones de código (innegociables)

- **ESM JS puro** (no TS en backend). **JSDoc obligatorio** en toda función + comentarios del *por qué*.
- **Controller fino / service con la lógica**. **Siempre `responseManager`**.
- **`paranoid: true`** — nunca `destroy({ force: true })` salvo bitácoras saldadas documentadas.
- **Nunca persistir un password en texto plano**: hashear ANTES de `create()`.
- **Validación**: express-validator + `matchedData(req)` (whitelist).
- Reglas de negocio del legado: preservarlas según `../analisis_app_php/` (montos congelados,
  historiales inmutables, protecciones de borrado, redondeos — ver PRD §6).

## Principios de conducta para la IA

1. **Pensar antes de codear.** No asumir; preguntar lo que confunde.
2. **Simplicity first.** Mínimo código que resuelve el problema.
3. **Cambios quirúrgicos.** Tocar solo lo necesario; mantener el estilo existente.
4. **Goal-driven.** Criterios de éxito verificables antes de empezar (ej. "e2e M7 verde").

## Regla de mantenimiento (SYNC RULE)

> **Al crear, modificar o eliminar cualquier endpoint, middleware, modelo (cambio de schema →
> migración), manifest, capability, evento de socket, servicio o config, actualizar en el
> mismo cambio:** 1) la doc relevante en `docs/`, 2) los tests e2e (`e2e/tests/`) + helpers,
> 3) el manifest / catálogo de capabilities si aplica, 4) el spec OpenAPI
> (`services/openapi/openapi.service.js`).

## Estado del proyecto (fases del PRD)

- ✅ **Fase 0** — base single-tenant: poda multi-tenant, auth (lockout + MFA), roles +
  capabilities, usuarios (protecciones), shell + design system, login, e2e verdes.
- ✅ **Fase 1** — catálogos: módulos `areas`/`clientes`/`servicios`/`formas-facturacion`
  (unicidad + reactivación de eliminados vía 409 EXISTE_ELIMINADO + PATCH restore,
  protecciones de borrado con guards por presencia de modelos futuros, conteos sin N+1),
  frontend genérico de catálogo (`useCatalogo` + `CatalogoPage.vue` — REUSALO para todo
  ABM chico nuevo), seeds de áreas y formas.
- ✅ **Fase 2** — abonos: módulo completo (ARS/USD, `periodoMeses` = período de ACTUALIZACIÓN
  de precio, nace inactivo, estado vencido/próximo/al-día en SQL), actualización de precios
  preview→aplicar IDEMPOTENTE (operationId), facturación mensual con montos congelados +
  anulación auditada re-facturable, `/app-config` (COTIZACION_DOLAR, REDONDEO_ABONOS —
  helpers `getAppConfigNumber` en el barrel), módulo `dashboard` (bloques calculados solo
  con capability). Frontend: AbonosPage con selección múltiple + modales de dos pasos,
  AbonoFormPage con historial, FacturacionesPage con anular, panel real.
- ✅ **Fase 3** — proyectos + cobranzas: módulo `proyectos` (5 estados + 5 fechas de ciclo de
  vida independientes — solo `fechaEstimadaEntrega` alimenta alertas, ventana 5 días; cerrados
  al final del listado), cuotas SIEMPRE en USD con tope = presupuesto→USD (0 = sin tope),
  cobrar ingresa el PESO REAL → cotización derivada `round(pesos/usd, 2)` + montos CONGELADOS,
  cuota cobrada NO se mueve/edita/elimina (primero descobrar), TODA mutación auditada en
  `cobranza_eventos` (bitácora append-only, mejora §10.3), proyecto con cobranzas cobradas no
  se elimina (409), grilla anual proyectos × 12 meses. Frontend: ProyectosPage (default
  abiertos), ProyectoFormPage, CobranzasPage (KPIs + selección múltiple para mover +
  auditoría), GrillaCobranzasPage con **drag & drop** de celdas pendientes, panel con tiles y
  entregas de proyectos. Dashboard extendido (bloque proyectos + facturación del mes combinada).
- ✅ **Fase 4** — tareas + espacios: módulo `espacios` (ABM protegido + reactivación,
  matriz de accesos de DOBLE EJE — espacio↔usuario, cada eje reemplaza solo lo suyo, los
  admins entran por rol y nunca se tocan, el creador queda con acceso total) y módulo
  `tareas` (dependsOn espacios — **permiso de 2 capas**: capability Y ver/editar del
  espacio, helpers `exigirEspacioVer/Editar` importados del módulo espacios). Listas con
  unicidad por espacio + 409 al eliminar con tareas. Tareas: 14 filtros por query string,
  orden del legado, historial append-only (no anota sin cambio), edición RÁPIDA que no toca
  descripción/estado (PATCH parcial real), estado inválido → 422, mover de lista/espacio
  (mejora §10.5, editar en ambos), `tareas:asignar` para asignar a otros. HTML saneado en
  servidor **al guardar y al servir** (`sanitizador.service.js`, sanitize-html con la lista
  blanca del legado + data-type para TipTap). Archivos en disco PRIVADO `storage/tareas`
  (firma binaria, nombre aleatorio `YYYYMM_<20hex>`, headers defensivos, adjuntos genéricos
  — mejora §10.4 — indexados en `tarea_archivos` para el GC futuro). Resumen por categorías
  con FUENTE ÚNICA de condiciones (número = listado). Frontend: TareasHome, ListasPage,
  TareasListaPage (filtros en query string compartibles), ResumenPage, EspaciosPage +
  matriz, editor **TipTap** (`DescripcionEditor.vue`) y `useArchivosProtegidos` (los
  archivos se sirven con auth → blobs cacheados). ⚠️ Tabla `espacios_trabajo` tiene
  `tableName` explícito (Sequelize pluralizaba mal).
  **Clonar** (2026-08-24, `tareas:create` — duplicar CREA, no edita): una tarea se clona con
  su descripción, prioridad, fechas, asignado y una **copia propia de cada adjunto**, pero
  el estado arranca en `abierta` (clonar una completada es para volver a hacerla) y no se
  copian historial ni comentarios. Clonar una **lista** arrastra todas sus tareas —es la
  operación «usar esto como plantilla»—, ahí conservan su nombre (poner «(copia)» a 40 tareas
  sería ruido) y también arrancan abiertas. El nombre se **numera** (`(copia 2)`, `(copia 3)`)
  en vez de fallar con un 409: clonar dos veces lo mismo es normal.
  **Crear en varias listas** vive colapsado detrás de un botón: un espacio con 60 listas
  llenaba media pantalla por una opción que casi no se usa. Abierto es una **lista de
  checkboxes** con `max-h` + scroll (2026-08-25): el `<select multiple>` que había antes se
  recortaba a la altura fija del `.ds-input` (`h-10`) y en el celular exigía Ctrl/⌘, que no
  existe. El **resumen** filtra por **espacio de trabajo** (múltiple) con la misma caja:
  `GET /tareas/resumen?e=1,4` en el query string (compartible por link), se INTERSECA con los
  espacios visibles (un id ajeno se descarta; si no queda ninguno válido, se ve todo) y entra
  también en los CONTEOS — si no, la solapa diría 12 y la tabla mostraría 3. La respuesta suma
  `espacios` (todos los visibles, para el selector) y `espaciosFiltro`.
- ✅ **Fase 5** — empleados + sueldos: módulo `empleados` (ficha completa, categorías —
  Freelance sin vacaciones —, áreas N:N reemplazo completo, **motor de vacaciones** exacto
  del legado en `vacaciones.service.js`: grants por año con override, vigencia año+1 y
  vencimiento a año+2, consumo del bucket más viejo primero, días corridos inclusive,
  `disponibleAl` con tomas previas; mejoras: validación de solapamiento y sobregiro
  recalculado siempre — no persistido; archivos privados `storage/empleados/<id>/` con
  whitelist + firma, attachment + nosniff, anti-traversal; 409 al eliminar con datos) y
  módulo `sueldos` (dependsOn empleados — **fuente unificada**: el vigente SIEMPRE sale de
  `salarioEnMesPuro` sobre el historial, comparado contra FIN de mes, desempate fecha DESC
  id DESC, extensión hacia atrás con el primer valor; `empleados.sueldo` = cache
  sincronizado; edición inline que registra contra el vigente — sin históricos espurios —,
  actualización por % con overrides por fila (preview→aplicar), **aumentos programados**
  multi-mes: % sobre mes base NO encadenados o fijo, reemplazo por mes calendario con
  PISADOS avisados en el preview, `sueldoAnterior` calculado DENTRO de la trx secuencial;
  **planificación** empleado × cuenta (default mes anterior, fechaPago conservada, monto 0
  borra, solo activos×activas); cuentas de pago con unicidad + 409 con pagos). Seeds de
  cuentas. Frontend: EmpleadosPage/Ficha/Form, SueldosPage (inline + % + historial),
  AumentosPage (líneas dinámicas + preview con aviso de pisados), PlanificacionPage
  (autoguardado con estado visible + semáforos), CuentasPage (CatalogoPage con `capPrefix`).
- ✅ **Fase 6** — dashboard completo + notificaciones + mejoras: `estadisticas.service.js`
  en el módulo dashboard (serie mensual abonos vs proyectos del año, por servicio top 7 +
  "Otros", por área con cubeta "Sin área" — cobrado CONGELADO, mismo año para los 3
  bloques, gating: cada gráfico exige ver TODAS sus fuentes; desde 2026-08-12 viven en
  `GET /dashboard/estadisticas` + pantalla propia, ver más abajo) + `equipoDashboard` en tareas
  (tarjetas del equipo, "qué está haciendo cada uno" con desde de la bitácora, tabla por
  usuario con tiempo promedio de trabajo — tramos en_progreso, cerradas, asignado actual —
  acotado a los espacios del que mira). **Notificaciones in-app**: `services/notificaciones`
  (modelo + rutas personales SIN capability, como /me; `crearNotificacion` en el barrel;
  socket `notificacion` a user:<id>) — emitidas en asignación de tarea, cambio de estado de
  tarea ajena, comentarios/menciones y el **scheduler de avisos diarios**
  (`services/avisos/avisos.handler.js`: abonos por actualizar ≤7d a quienes pueden
  actualizar precios + tareas vencidas/hoy a su asignado; marca diaria en Config).
  **Comentarios en tareas** (`tarea_comentarios`, menciones @username, borrar propio o
  admin). **Cotización histórica** (`cotizacion_dolar`, hook en PUT /app-config + GET
  /app-config/cotizaciones). Frontend: panel con Chart.js (`GraficoLinea.vue`, specs del
  legado + reconstrucción al cambiar tema), campana `NotificacionesBell` en el shell,
  comentarios en TareaModal, **vista Kanban** con drag & drop (persiste en localStorage),
  **export CSV** cliente (`useCsv.ts`: abonos, facturaciones, sueldos, planificación) y
  **PWA** (vite-plugin-pwa, sin cache de API).
- ✅ **Fase 7** — cierre: módulo de ejemplo `items` ELIMINADO (backend, frontend, e2e —
  el fixture de e2e ahora usa `areas:*` + `usuarios:read` y global-setup sincroniza sus
  capabilities si cambian), **GC diario de archivos huérfanos** de tareas
  (`services/avisos/gc.handler.js`: tareaId null > 48 h → binario + registro),
  docker-compose actualizado a single-tenant (vars `DB_*`, volúmenes persistentes de
  `/app/storage` y `/app/public/storage`), identidad Capacitor
  (`ar.com.positivemedia.sistemainterno`) y **runbook de producción en VPS de Oracle
  Cloud SIN Docker** (`docs/deploy-vps-oracle.md`: Node + MySQL del host —
  `DBDRIVER=mysql`—, backend compilado como servicio systemd, frontend estático servido
  por nginx + certbot — con WebSockets y client_max_body_size para los adjuntos —,
  Security List + iptables de OCI, backups y deploy.sh).
  Decisión 2026-08-11: se descartó Coolify y también Docker para este servidor (el
  compose queda como alternativa). El deploy real queda pendiente de ejecutar el runbook.

**PROYECTO COMPLETO** — las 7 fases del PRD entregadas; las 12 mejoras (§10) implementadas.

## Migración de datos del legado (2026-08-12)

`npm run migrar_legado` (`backend/src/exec/migrarLegado.js`, doc en `docs/migracion-legado.md`)
copia los datos reales del PHP a la base nueva **preservando los IDs**: 609 filas en 28 tablas,
transaccional, re-ejecutable, con los AUTO_INCREMENT repuestos. Puntos a recordar:
- Los permisos de grano grueso del legado (`rol_permisos.ver/editar` por sección) se expanden
  al catálogo granular de capabilities; `editar` implica `ver`; el rol `es_admin` se convierte
  en el rol de sistema (`administrador`, `isSystem`, `*`).
- Los usuarios conservan su contraseña (hash bcrypt `$2y$` → back-compat → rehash a argon2 en
  el primer login) y el **username se deriva del email**. La migración BORRA el usuario `admin`
  del seed → para correr los e2e hay que recrearlo con `npm run init_db` (idempotente).
- La conexión al legado usa la MISMA zona horaria que la app: sus fechas de alta son `TIMESTAMP`
  (dependen de la zona de sesión) y las del sistema nuevo son `DATETIME` (sin zona).

## Módulo `documentacion` (2026-08-13)

Base de conocimiento con la misma forma que tareas — **espacio → lista → documento** — pero
con espacios PROPIOS (`doc_espacios` + `usuario_doc_espacios`): la documentación puede tener
recortes distintos a los tableros y sus accesos se administran aparte. Doc completa en
`docs/modules/documentacion.md`. Puntos salientes:
- **Dos capas de permisos** igual que tareas (capability `documentacion:*` Y ver/editar del
  espacio), y capabilities separadas `doc-espacios:*` para el ABM y la matriz de accesos:
  repartir accesos no es lo mismo que escribir documentación.
- **Un documento es texto Y/O adjuntos** (no una cosa o la otra), con **historial de versiones
  append-only**: cada edición archiva el estado anterior y restaurar archiva el vigente. Se
  puede adjuntar TAMBIÉN al crear: el archivo se sube suelto y el alta lo liga con
  `archivoIds` filtrando por `documentoId: null` (mismo patrón que tareas); lo que quede
  huérfano lo barre el GC diario, que ahora cubre tareas y documentación.
- **Adjuntar imágenes**: el endpoint de subida recibe `destino` (`editor` | `adjunto`). El
  CONTENIDO decide las defensas (firma binaria, lista blanca, 5 MB imágenes / 15 MB adjuntos);
  la INTENCIÓN decide la clasificación, así que una imagen subida con «Adjuntar» queda como
  `tipo: 'archivo'` y aparece en la lista en vez de irse al cuerpo. Arrastrar y soltar en
  tareas y documentos con `components/shared/ZonaAdjuntos.vue`.
- **Identidad visual**: el logo es `frontend/public/vaso 300x300.png` y de ahí salen TODOS
  los iconos, con `frontend/scripts/generar-iconos.py` (correrlo si cambia el logo). Tres
  familias: `icon-*`/`favicon` con fondo TRANSPARENTE (van sobre la pestaña, clara u oscura);
  `pwa-*`/`apple-touch-icon` con fondo BLANCO (iOS pinta de negro lo transparente); y
  `pwa-512-maskable` que es el ÚNICO con margen (18%), porque Android recorta con máscara y
  la zona segura es el 80% central — usar el mismo archivo para los dos obliga a elegir entre
  verse chico en todos lados o que Android corte los bordes. ⚠️ El `favicon.svg` se genera
  con el PNG embebido: el navegador PREFIERE el SVG a los `<link>` PNG, así que uno viejo
  ahí gana y el logo nuevo no se ve nunca. Ojo con el margen: el vaso es ALTO y angosto, así
  que al centrarlo en un cuadrado manda la altura y cada punto de margen se nota el doble.
- **Notificaciones**: TRES canales que NO son intercambiables — campana in-app (socket),
  **Web Push** al navegador (`services/push/webpush.service.js` + `public/sw-push.js`, claves
  VAPID en el `.env`, sin terceros) y **FCM** a la app nativa (Firebase, solo APK). El push
  de Capacitor no hace NADA en una pestaña: por eso en Chrome hay que activar Web Push, que
  se registra **por navegador** (`/settings/push/suscripcion`). Las suscripciones muertas
  (410) se borran solas. Detalle en `docs/notificaciones.md`.
- **Instalar la PWA**: `composables/useInstalarApp.ts` guarda el evento `beforeinstallprompt`
  (se dispara UNA vez y muy temprano → se engancha en `main.ts`, antes de montar) para poder
  ofrecer la instalación desde Configuración → Acerca de cuando el usuario quiera. Si no hay
  evento (iOS, o el navegador ya no lo ofrece), muestra las instrucciones manuales.
- **Buscador** por título y contenido, acotado a los espacios visibles, y **orden manual**
  (drag & drop) de listas y documentos con `orden` en múltiplos de 10.
- **Refactors para no duplicar**: las defensas de archivos subidos viven en
  `services/archivos/archivoPrivado.service.js` y el saneado de HTML en
  `services/html/sanitizador.service.js` (antes dentro de tareas) — UNA sola copia de cada
  cosa, compartida por los dos módulos. `DescripcionEditor.vue` recibe la subida por prop.
- **Menú**: Tareas y Documentación viven ahora en el grupo **Proyectos** (el grupo Tareas
  desapareció); «Espacios de documentación» está en Administración.

## Módulo `mantenimiento` — Servidores y Sitios web (2026-08-14)

Monitoreo de los VPS de la empresa. Doc completa en `docs/modules/mantenimiento.md`.
- **Agente push, no SSH**: un script + timer de systemd en cada VPS reporta CPU/RAM/disco por
  minuto con un token propio (guardado HASHEADO, mostrado una sola vez). La app no guarda
  credenciales de acceso a los servidores ni abre puertos en ellos.
- **El heartbeat es el reporte**: sin reporte por N minutos → `offline` (detecta el servidor
  colgado, que un ping no ve). Los de terceros (`monitorea = false`) se prueban por TCP.
- **`/agente/*` se monta FUERA de `verifyAccessToken`** (routes.js) porque quien llama es una
  máquina: autentica el token del servidor, con rate limit propio.
- **Anti-spam**: un incidente abierto por servidor y tipo; se avisa al abrir y al resolver.
  Destinatarios = quienes tengan `servidores:read`; canales campana + email + push (los que
  no estén configurados se saltean solos).
- **Historial**: detalle por minuto 30 días + resumen diario permanente (rollup y purga en el
  scheduler). Umbrales globales en Configuración con override por servidor.
- **Chequeo externo de corroboración**: cuando un agente se calla, antes de abrir el incidente
  se prueba el puerto por TCP → el aviso distingue «el servidor está caído» de «el servidor
  responde pero el agente se detuvo».

**Sitios web** (`sitios:*`, chequeo cada 5 minutos en `sitios.handler.js`):
- **Tres estados, no dos**: `online` (2xx **y** el marcador `<div id="app-conn-id">` del
  footer), `sin_marcador` (contesta pero lo que sirve no es nuestro sitio) y `offline`. Los
  sitios de terceros van con `verificaMarcador = false` y ahí alcanza un 2xx — si no,
  quedarían en `sin_marcador` para siempre.
- **La alerta espera al 2º fallo seguido** (`MANTENIMIENTO_FALLOS_PARA_ALERTA`): un microcorte
  no despierta a nadie. La recuperación avisa enseguida.
- **Dominios por RDAP** (bootstrap de IANA, no rdap.org): `.com.ar` SÍ devuelve fecha
  (verificado contra `rdap.nic.ar`); los TLD sin RDAP (.io, .uy, .cl) se cargan a mano y esa
  fecha manual pone `dominioAuto = false` para que el refresco diario no la pise. Si RDAP
  falla, la fecha existente NUNCA se borra.
- **TLS** del mismo handshake del chequeo, con `rejectUnauthorized: false` a propósito: el
  certificado vencido es justamente el caso a avisar y con validación estricta ni se leería.
- El **estado** de los vencimientos (ok / por vencer / vencido) se DERIVA de la fecha en cada
  consulta; no se persiste.
- **Velocidad por hora** (2026-08-24): cuarta granularidad, que sale SIEMPRE del detalle (el
  rollup es diario, así que la hora no se puede reconstruir después de la purga). Ventana 48 h.
- **Vistas por sitio** (2026-08-21): un sitio tiene N URLs chequeables (`sitio_vistas`), cada
  una con su propio «lo administramos nosotros» y su override del id del marcador (el global
  es la config `MANTENIMIENTO_MARCADOR_ID`). Todo sitio nace con la vista `/` y la ÚLTIMA no
  se elimina (409): un sitio sin URLs dejaría de monitorearse en silencio. El **sitio resume**
  («2 de 3 vistas OK», estado = el peor) y la **alerta es por vista** (anti-spam por
  `sitio+vista+tipo`). Dominio y TLS siguen siendo del SITIO: son del host, no de la ruta.
- **Velocidad histórica**: `sitio_velocidad_dia` es un rollup **permanente** (una fila por
  vista y día) que la tarea diaria consolida **antes** de purgar el detalle de 30 días — el
  orden importa. El promedio ignora los chequeos que no respondieron (un timeout es una caída,
  no latencia), el mes/año ponderan por muestras, y el día de hoy sale del detalle porque
  todavía no está consolidado. `GET /mantenimiento/sitios/:id/velocidad?granularidad=dia|mes|anio`.
- **Filtros del listado** (7, en el cliente como el buscador): disponibilidad, vencimientos,
  servicio, servidor, activo/inactivo, propios/terceros, con incidentes abiertos.
- **Punto ciego resuelto**: el monitoreo vive dentro de este proceso, así que hay
  `GET /api/health` **público** (200 solo si la base responde) para un watchdog EXTERNO —
  runbook en `docs/deploy-vps-oracle.md` (§ Watchdog externo). El chequeo no debe apuntar a la
  raíz del dominio: nginx sirve el frontend aunque el backend esté muerto.

## Panel vs Estadísticas (2026-08-12)

El módulo `dashboard` expone DOS superficies, cada una con su pantalla:
- `GET /dashboard` (`dashboard:read`) → **Panel** (`views/dashboard/HomePage.vue`, grupo
  Principal del menú): qué está pasando ahora — cotización, contadores y alertas de abonos,
  facturación del mes, proyectos, **infraestructura** y tareas del equipo. NO calcula series
  anuales. El bloque `mantenimiento` (`modules/mantenimiento/services/resumen.service.js`) es
  RESUMEN: solo conteos agregados y el pico de consumo (últimos 10 min, para no mostrar el
  valor congelado de un agente muerto); cada mitad exige `servidores:read` / `sitios:read`.
  El panel se **refresca solo cada minuto** (`composables/useAutoRefresh.ts` +
  `components/shared/IndicadorAutoRefresh.vue`) para poder dejarlo en un monitor: suspende
  con la pestaña oculta y al salir de la vista, refresca al volver a mirar, no encima
  pedidos y NO muestra toasts de error (los cuenta y lo dice el indicador del encabezado,
  que además pausa/reanuda y recuerda la preferencia). Las dos pantallas de **servidores**
  usan lo mismo, con el mismo minuto: es el ritmo al que reporta el agente, así que pedir
  más seguido traería lo mismo.
- `GET /dashboard/estadisticas?anio=` (**`estadisticas:read`**, capability propia desde
  2026-08-13 — migración `0002` se la dio a los roles que ya tenían `facturaciones:read`) →
  **Estadísticas** (`views/dashboard/EstadisticasPage.vue`, también en Principal): mensual
  abonos vs proyectos, abonos por servicio y facturación por área, con el selector de año
  único. El gating fino por gráfico (facturaciones, cobranzas, servicios, áreas) sigue dentro
  del service; si los tres vienen null la pantalla lo explica.

**Menú y landing** (`frontend/src/config/nav.ts`): el menú es FUENTE ÚNICA y lo consumen el
shell (para pintarlo) y el router (para decidir el destino inicial). El Panel se otorga con
`dashboard:read` como cualquier otra pantalla; quien no lo tenga entra a la PRIMERA opción del
menú que sí puede ver (antes caía en un panel vacío). Ir a `/panel` sin permiso redirige igual.
