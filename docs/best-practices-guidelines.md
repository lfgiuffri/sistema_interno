# Zero 2.0 — Best-Practices Guidelines (North Star)

> **Origen.** Este documento consolida los hallazgos de skills de mejores prácticas instaladas vía [find-skills](https://skills.sh) y verificadas por reputación/instalaciones: **antfu/vue**, **antfu/pinia**, **cap-go/capacitor-best-practices**, **capawesome/ionic-expert**, **mcollina/node**, **mindrally/express-typescript**, **mindrally/sequelize**, **getsentry/security-review**, **currents-dev/playwright-best-practices**, **addyosmani/documentation-and-adrs**, **stripe/stripe-best-practices**, **better-auth/two-factor-authentication-best-practices**.
>
> **Cómo usarlo.** Es la guía que rige TODO el build de Zero 2.0 (M1→M13). Cada milestone debe respetar estas reglas. La sección final clasifica las decisiones contenciosas como **ADOPTAR / ADAPTAR / DIFERIR** para no romper lo que ya funciona en el modelo multi-tenant.

---

## 0. Decisiones para Zero 2.0 (resolución de tensiones)

Algunas recomendaciones de las skills chocan con convenciones heredadas (JS puro, `sync()` para provisión de tenants, express-validator, bcryptjs, morgan). Resolución explícita:

| Tema | Recomendación skill | Decisión Zero 2.0 | Cuándo |
|---|---|---|---|
| Lenguaje backend | TypeScript | **ADAPTAR**: seguir en JS ESM puro; usar JSDoc `@typedef`/`@param` + validación runtime para suplir tipos | — |
| Validación input | Zod | **ADAPTAR**: mantener `express-validator` como estándar de rutas (ya cableado); Zod opcional solo en servicios con schemas complejos | — |
| Hash de password | argon2id | **ADOPTAR**: migrar bcryptjs → `argon2` (win de seguridad, bajo riesgo; afecta MasterUser/User) | M7 |
| Schema DB | Migraciones, nunca `sync()` | **ADAPTAR**: `sync()` se mantiene SOLO para provisión de DB de tenant nuevo; agregar runner de migraciones versionadas para evolución de schema (no `sync({alter})` en prod) | M3/según necesidad |
| Logging | pino estructurado | **ADOPTAR**: introducir `pino` con `requestId/tenantId/userId`; mantener morgan solo dev | M2 (infra) |
| Shutdown | `close-with-grace` | **ADOPTAR**: graceful shutdown (DB/Redis/Socket.IO) + `/health` y `/ready` | M2 (infra) |
| Locators e2e | role-based, sin `waitForTimeout` | **ADOPTAR**: nuevos tests con `getByRole` + web-first assertions; migrar gradualmente el `SEL` legacy | M11 |
| Docs | ADRs + READMEs por área + CHANGELOG | **ADOPTAR** | M11 |
| Front TS | `strict: true` | **ADOPTAR** strict + arquitectura de componentes + stores por feature | M9/M10 |
| capacitor.config | `.ts` y dev-URL gateada por env | **ADOPTAR**: convertir `.json` → `.ts` | M9 |
| HTTP nativo | `CapacitorHttp` en native | **ADOPTAR** para API en plataformas nativas (SSL pinning, evita CORS) | M9 |

**Principio rector innegociable (de la skill de seguridad):** *deny-by-default* y *fail-closed*. Toda ruta valida permiso explícito; si un check de permiso falla por error de datos, se deniega.

---

## 1. Backend — Express (estructura & middleware)

- **Factory `createApp()`** que devuelve la instancia Express configurada; separar creación de app del arranque del server.
- **Orden del stack**: `helmet` → parsers → logging/requestId → tenant-context → rutas → **error handler (último, 4 args)**.
- **Body parsing con límites explícitos** (`express.json({ limit: '10mb' })`) para evitar agotamiento de memoria.
- **CORS sin wildcard en prod**: whitelist de orígenes; validar `Origin` por tenant.
- **Request ID por request** (`req.id`) propagado a logs, jobs BullMQ y respuestas de error.
- **Tenant-context middleware temprano**: extraer/validar tenant y dejar `req.tenant`/`req.tenantDb`/`req.models`; propagarlo a servicios, jobs y handlers de socket.
- **Error handler centralizado** con clases de error (`AppError` base + `NotFoundError/ValidationError/UnauthorizedError`), categorizando operacional vs programador. (Se integra con el `responseManager` existente.)
- **Rate limiting por tenant + por IP** en endpoints no autenticados; bucketing por cuenta para brute-force.

## 2. Backend — Sequelize

- **Aislamiento de tenant**: scope/`where: { tenantId }` o conexión por DB de tenant en TODA query; escribir tests que fallen si se quita el filtro de tenant (anti-IDOR).
- **Transacciones** (`sequelize.transaction`) para toda operación multi-registro; pasar `{ transaction }` a cada query del bloque.
- **Evitar N+1**: `include` con `as` explícito; nunca `getAssociation()` en loop.
- **Scopes reutilizables** (`active`, `withRelations`) para queries comunes y testeables.
- **Índices estratégicos** en FKs, filtros por tenant y columnas de `where`; documentar el porqué (ej. compuesto `tenantId+userId`).
- **`paranoid: true`** (soft delete) donde haga falta auditoría — ya es convención del proyecto.
- **`allowNull: false` + defaults** en columnas críticas (`tenantId`, `status`).
- **Pool**: `{ max: 10, min: 2, acquire: 30000, idle: 10000 }`.
- **Provisión de tenant**: `sync()` solo al crear DB de tenant nuevo; evolución de schema vía migraciones versionadas (ver §0).

## 3. Backend — Seguridad (authn/authz/input/secrets)

- **JWT**: claims mínimos (userId, tenantId, scopes/capabilities), expiración corta (5–15 min) + rotación de refresh token; regenerar sesión tras login y escalada de privilegios.
- **Mensajes de error genéricos** en login (evitar enumeración de usuarios).
- **Auth0**: validar firma del JWT contra JWKS publicado; MFA a nivel app (TOTP preferido).
- **Brute-force**: lock por cuenta tras N intentos (no solo por IP); permitir reset aún bloqueado.
- **Authz capability-based**: chequear `capabilities` (no solo nombres de rol); deny-by-default; validar membership de tenant en cada endpoint.
- **Anti-IDOR**: filtrar siempre por `resourceId` **y** `tenantId`; validar ownership antes de devolver/mutar.
- **Anti-escalada**: el usuario no puede modificar su propio rol/elevarse; requiere acción admin con auditoría.
- **Input validation** en `body`, `query`, `params` (express-validator); whitelist de tipos de archivo verificando MIME real (`file-type`), no `Content-Type`.
- **Secrets**: nunca hardcodear; validar presencia al startup; nunca loguear secretos (sanitizer); vault cifrado para secretos por tenant (ver M8).
- **Headers (helmet)**: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'self'`, `Referrer-Policy: strict-origin-when-cross-origin`.

## 4. Backend — Async, errores y performance

- **async/await** siempre; `try-catch` para propagación; sin cadenas de callbacks.
- **Concurrencia controlada** (`p-limit`/`p-map`, 5–10) para DB/API en paralelo; `Promise.allSettled` cuando se toleran fallos parciales (notificaciones).
- **`AbortController`** para timeouts en operaciones largas.
- **Logging estructurado (pino)** con `requestId/tenantId/userId` + códigos de error.
- **Cache**: `lru-cache` in-process para lookups repetidos (config de tenant); Redis para dedupe cross-process / stale-while-revalidate.
- **Graceful shutdown** (`close-with-grace`, ~25s) + `/health` (alive) y `/ready` (acepta tráfico; 503 si apagando).

## 5. Backend — Patrones de los sistemas que construimos

- **Módulos pluggable (M3)**: manifest con metadata (name, version, capabilities, dependsOn, minPlan); validar manifest al cargar; auto-discovery escaneando el dir de módulos; cargar por tenant solo los habilitados desde DB; resolver dependencias antes de montar (fail-fast).
- **Capabilities (M4)**: los módulos declaran capabilities (`modulo:accion`); el sistema otorga capabilities a roles; check capability-based, no por nombre de rol.
- **Plan-gating + metering (M5)**: contadores de uso por tenant/recurso (Redis o tabla dedicada, batch); límites *soft* (avisan) vs *hard* (bloquean) con período de gracia; auditar acciones que exceden límite.
- **Billing multi-vendor (M6)**: interfaz `PaymentProvider { createSubscription, cancel, changePlan, getInvoices, verifyWebhookSignature, parseEvent }`; Stripe y MercadoPago la implementan; mapear `tier → {stripe_price_id, mp_price_id}` en config (no hardcode); normalizar nombres de evento de webhook en el borde (`provider:event` → evento de app). Detalle Stripe en §7.
- **Realtime (Socket.IO)**: rooms por tenant (`tenant_${id}`); auth del JWT en el handshake; limpieza en disconnect + recuperación de estado en reconnect.
- **Secrets vault (M8)**: campos cifrados at-rest con clave por tenant; política de rotación; nunca exponer en respuestas/logs.
- **Storage pluggable (M8)**: interfaz `StorageProvider` (local/S3/R2) con aislamiento por tenant; driver elegido por config del proyecto.
- **Webhooks salientes (M8)**: firma HMAC-SHA256 con secreto por tenant en `X-Webhook-Signature`; backoff exponencial (3–5 reintentos); `X-Webhook-ID` para idempotencia; gestión de suscripciones + logs de entrega.

## 6. Frontend — Vue 3 / Pinia / Ionic / Capacitor

### 6.1 Arquitectura de componentes (Vue 3)
- **Romper las views monolíticas**: hoy casi todo está inline en views gigantes. Cada view = contenedor (≤150 líneas) que compone componentes chicos (≤300) en `src/components/`.
- **Siempre `<script setup lang="ts">`**; `defineProps`/`defineEmits`/`defineModel` tipados; emits como tuplas (`defineEmits<{ update:[v:string], close:[] }>()`).
- **Separar presentacional ("tonto") de contenedor ("inteligente")**: datos bajan por props, eventos suben.
- **Composables** para lógica cross-cutting (forms, llamadas API, lifecycle) en `src/composables/*.ts` tipados.
- **`shallowRef`** para respuestas API grandes no-reactivas; `readonly` para estado inmutable.

### 6.2 Pinia (matar el mega-store)
- **Stores por feature** (`auth.ts`, `modules.ts`, `<feature>.ts`, `ui.ts`); nunca un único store gigante (hoy `app.ts` tiene ~38 acciones — se parte).
- **Setup Store syntax** (`defineStore('x', () => { const s = ref(); const g = computed(); function a(){}; return {...} })`).
- **`storeToRefs()`** al destructurar estado en componentes (preserva reactividad); acciones se destructuran directo.
- **Componer stores a nivel acción** (llamar `useOtroStore()` dentro de acción/computed, no en module scope) para evitar deps circulares.

### 6.3 Ionic (single-codebase real)
- **Toda página con `IonPage` como raíz** (si no, lifecycle y transiciones fallan silenciosamente).
- **`onIonViewWillEnter()`** para refrescar datos en cada visita (el router de Ionic cachea páginas; `onMounted` no dispara en back-nav).
- **`ion-tabs`** para estructura principal; cada tab mantiene su stack.
- **Overlays declarativos** (`isOpen`/`trigger`), disparados desde acciones de store; evitar `.present()/.dismiss()` imperativos.
- **`isPlatform()` / `Capacitor.isNativePlatform()`** para lógica por plataforma (en composables, no en templates).
- **Componentes Ionic estrictos** (`ion-input`, `ion-select`...) para styling consciente de plataforma.

### 6.4 Navegación dinámica plan-aware
- **`stores/modules.ts`** mantiene `enabledModules` traído del backend al init; el `<ion-menu>` y las rutas se arman iterando ese estado (no hardcode); refrescar en `onIonViewWillEnter`/resume para reflejar cambios de plan; route guard que bloquea módulos deshabilitados.

### 6.5 Capacitor
- **Versiones sincronizadas** (`core`/`cli`/`ios`/`android`); `npx cap sync` tras instalar plugins.
- **`capacitor.config.ts`** con `server.url` de dev gateado por `NODE_ENV` (nunca commitear dev URL a prod).
- **Imports dinámicos de plugins** (`const { Camera } = await import('@capacitor/camera')`); chequear disponibilidad/permeisos antes de usar con fallback web.
- **Auth0 deep-links**: `scheme` en config + `App.addListener('appUrlOpen')` para parsear el callback (`zero://auth/callback?...`) y rutear a la acción del auth store.
- **`CapacitorHttp`** en nativo (SSL pinning, evita CORS); `fetch` en web.

### 6.6 TypeScript & performance (front)
- **`strict: true`** (`noImplicitAny`, `exactOptionalPropertyTypes`); sin `any`; acciones async devuelven `Promise<T>` tipado; tipos de API en `src/types`.
- **Lazy-load de rutas** (`() => import('./views/...')`) → chunk por ruta; tree-shaking en Vite.

## 7. Pagos — Stripe / multi-vendor (M6)

- **Modelado**: Product por tier; Prices API (`type:'recurring'`), no Plans deprecados; un Customer por **Tenant** (guardar `stripe_customer_id` inmutable).
- **Estado**: sincronizar estado de subscription → `Tenant.plan` en cada webhook (`customer.subscription.*`, `invoice.payment_failed`); guardar solo IDs (`customer/subscription/price`), traer invoices on-demand.
- **Webhooks**: verificar firma SIEMPRE; idempotencia por Event ID (guardar y saltear duplicados); responder 200 rápido y procesar en job (BullMQ).
- **Upgrades/downgrades**: Checkout Sessions con `proration_behavior:'create_prorations'`; máquina de estados (active/trial/past_due/canceled) con transiciones solo por webhook validado; grace period antes de revocar acceso.
- **Seguridad de claves**: Restricted API Keys con scope mínimo; vault; jamás en cliente/logs; test mode con tarjetas de prueba (`4242…` ok, `4000…0002` declinada).
- **Vendor-agnóstico**: todo lo anterior detrás de `PaymentProvider`; MercadoPago (preapproval/planes) implementa la misma interfaz; IDs y nombres de evento normalizados en config/borde.

## 8. Auth — MFA / 2FA / passwordless (M7)

- **Enrollment TOTP**: requerir verificación de password antes de habilitar; generar secreto → QR (`otpauth://`) + 10 backup codes; exigir verificar un código TOTP antes de marcar `twoFactorEnabled`. TOTP 6 dígitos / 30s.
- **Backup codes**: 10 de un solo uso; cifrados at-rest; regenerables solo con password (invalidan los previos); mostrados una sola vez.
- **OTP email/magic-link**: validez 5 min, 5 intentos máx, reenvío invalida el anterior; comparación constant-time.
- **Rate limiting** en endpoints 2FA (ej. 3 req/10s).
- **Step-up auth** para acciones sensibles (cambiar email, desactivar 2FA, cambiar método de pago, dar acceso API): exigir nuevo challenge; chequear que la última verificación 2FA sea fresca (<5 min).
- **Trusted devices**: opt-in (`trustDevice`), expiry 30d, registrados con device/UA/IP/expiry y revocables desde settings.
- **Desactivar 2FA**: requiere password, revoca trusted devices, email de confirmación, log de auditoría.
- **Almacenamiento de secretos TOTP** cifrado con clave de la app; nunca exponer al cliente/logs.

## 9. Tests — Playwright (M11)

- **Mantener lo bueno**: split de proyectos `api` (paralelo) / `ui` (secuencial por routing Ionic) / `websocket`; fixtures con cache de tokens por worker; helpers de validación (`expectSuccess/Error/Pagination`); naming `mNN-*.spec.ts`; `trace:'on-first-retry'`, `screenshot:'only-on-failure'`; retries en CI.
- **Cambiar**: eliminar TODOS los `waitForTimeout()` (~20 instancias) → web-first assertions (`await expect(locator).toBeVisible({timeout})`) + `waitForLoadState('networkidle')`/`waitForURL()` solo donde aplique.
- **Locators**: nuevos tests con `getByRole(...)` accesibles; deprecar gradualmente el `SEL` CSS-based.
- **Aislamiento**: `afterEach` de limpieza en UI (clear localStorage, cerrar modales, volver a home).
- **WebSocket**: `waitForEvent` con timeout 10s; sin `waitForTimeout`.
- **CI**: subir `playwright-report/`; fallar build si se detecta `waitForTimeout` (grep) o flakiness.
- **global-setup**: debe inicializar master DB + al menos un tenant de test; documentarlo.

## 10. Documentación & ADRs (M11)

- **`docs/decisions/`** con ADRs `ADR-NNN-slug.md` (formato: Status | Date | Context | Decision | Alternatives | Consequences). ADRs retroactivos para: multi-tenant master+tenant, JWT+refresh, auto-discovery de modelos, formato de respuesta, modularidad por manifest, capabilities, billing multi-vendor.
- **READMEs por área**: root (Quick Start, comandos, links), `backend/`, `frontend/`, `e2e/`.
- **Regla de sync (ya en CLAUDE.md)**: al tocar endpoint/modelo/middleware/evento → actualizar `docs/` + tests + `testing.md`. Mantener banner "⚠️ keep in sync" en architecture.
- **`CHANGELOG.md`** semver con Added/Fixed/Breaking + PRs.
- **Comentarios**: solo el *por qué* no obvio; sin código comentado ni TODOs colgados; sin credenciales hardcodeadas.

---

## 11. Estándares de código Zero 2.0 (decisiones del usuario)

### 11.1 Comentarios — OBLIGATORIO en TODO el código
Esto **sobre-escribe** la regla minimalista de la skill de docs. En Zero 2.0:
- **Toda función** (exportada o interna) lleva un bloque **JSDoc**: descripción de qué hace, `@param {tipo} nombre - …` por cada parámetro, `@returns {tipo} …`. En async: documentar qué resuelve la Promise.
- **Comentarios inline** dentro de cada función explicando el *por qué* de los pasos no triviales (no narrar lo obvio, sí la intención y los gotchas).
- Backend en JS: usar JSDoc con `@typedef` para shapes complejos (suple la falta de TS).
- Frontend en TS: JSDoc en composables/stores/funciones utilitarias; los tipos van en la firma TS, el JSDoc agrega el *por qué*.
- Encabezado de archivo: breve comentario de propósito del módulo/servicio.

### 11.2 Patrón Controller-Helper (thin controller)
- **Controller**: SOLO orquesta el ciclo req/res — extrae input, llama al helper, responde con `responseManager`. Sin lógica de negocio ni queries directas complejas.
- **Helper/Service** (`modules/<x>/services/*.service.js`): TODA la lógica de negocio y acceso a datos (Sequelize), testeable en aislamiento, reutilizable desde controllers, scheduler handlers, sockets y jobs.
- **Validators** (`modules/<x>/validators/*.validator.js`): express-validator por endpoint.
- Regla: si un controller tiene más de ~15 líneas de lógica, mover al helper. Un helper no conoce `req`/`res`.
- Esta es la estructura ya presente (`controllers/` + `services/`); se formaliza y se exige en cada módulo nuevo (ver `docs/modules`).

### 11.3 Testing de API — interactivo, no estático
- Se elimina el viejo `API Rest/*.http` (estático). Reemplazo: **OpenAPI 3 auto-generado + Swagger UI** servido por el backend (ej. `/api/docs`), siempre sincronizado con las rutas reales. Sirve para explorar/probar endpoints a mano.
- La cobertura automatizada sigue en **Playwright e2e** (api/ui/ws). Swagger = exploración manual; Playwright = regresión.
- Cada módulo nuevo documenta sus endpoints en el spec (anotación/registro al montar el manifest) → el `.http` estático ya no hace falta.

## 12. Routing & Associations — veredicto arquitectónico (decisiones del usuario)

### 12.1 Auto-discovery de modelos/asociaciones (`masterAssociations`/`tenantAssociations`) → SE MANTIENE
Es el patrón idiomático de Sequelize (equivalente al clásico `models/index.js`): escanear archivos de modelo, instanciarlos y llamar `Model.associate(models)`. Las asociaciones NO se auto-cablean: requieren que todos los modelos existan primero. Válido y recomendado para una base modular. Mejoras (no reescritura):
- **Fail-loud en dev**: un modelo que falla al cargar hoy se `warn`-saltea (desaparece en silencio). En `NODE_ENV=development` debe **throw**; en prod, warn.
- Quitar `console.log` comentados (dead code) de `masterAssociations.js`.
- Unificar convención: tenant `defineXModel(sequelize)` (factory) vs master default-export → documentar una sola regla por capa.
- El **manifest** (M3) declara los modelos del módulo → el loader valida disco-vs-manifest.

### 12.2 `routes.js` → HÍBRIDO (infra explícita + módulos por manifest)
Un `routes.js` central estático es válido y da control de middlewares, pero choca con el objetivo de Zero (módulos drop-in/out gateados por plan). Resolución:
- **Infra explícita** (master auth/tenants/global-configs/notification-actions, core, users): se mantienen en un bootstrap chico (always-on, orden importa).
- **Módulos feature auto-discovery** vía `module.manifest.js`: un **module loader** los monta aplicando la cadena estándar (`tenantIdentification → authAndPerms → capability check → plan gate`) de forma declarativa y uniforme. Se conserva el control de middlewares; se gana gating por plan y cero edición central por módulo.
- El loader sincroniza los manifests con el registry en DB existente (`modules/core`: Module/Controller/View/Route) en vez de inventar uno paralelo.

## 13. Estructura física: `kernel/` (infra) vs `modules/` (pluggable) — decisión del usuario

Para poder **mover módulos entre apps**, la separación es física:
```
backend/src/
├── kernel/                 # INFRA (el motor de Zero; NO se mueve entre apps)
│   ├── master/             # Tenant, GlobalConfig, MasterUser (base maestra)
│   ├── users/              # User, Role, Permission, RoleCapability, auth
│   ├── registry/           # Module/Controller/View/Route/Config (registro en DB)  [ex modules/core]
│   ├── handlerRegistry.js moduleLoader.js capability.js moduleGate.js
│   └── index.js            # BARREL: superficie pública de infra para módulos
├── modules/                # PLUGGABLE (cada módulo self-contained con manifest; portable)
│   ├── items/  settings/  catalogs/
├── services/ middlewares/ libs/ config/ socket/   # infra transversal (queda en root)
└── masterDatabase.js  tenant/masterAssociations.js  app.js  routes.js  index.js
```
Reglas:
- Un módulo de `modules/` **solo importa infra desde `kernel/index.js`** (el barrel), nunca rutas profundas. Así, copiar la carpeta del módulo a otra app Zero "just works".
- Para mover un módulo entre apps: copiar `modules/<nombre>/`. Su único acoplamiento externo es el barrel del kernel (misma API en toda app Zero).
- `masterAssociations` escanea `kernel/master/models`; `tenantAssociations` escanea `kernel/` (excluye master) + `modules/` + `services/`.
- Si una pieza de infra se reubica internamente, se actualiza solo el barrel.
- (Futuro) Con ESM nativo (sin babel) el barrel puede exponerse como subpath import `#kernel`. Con babel se evita por el riesgo de duplicar singletons (registries) entre `src/` y `build/`.

## 14. Modelo de roles (3 niveles) — decisión del usuario, respaldada por best-practices

Jerarquía RBAC multi-tenant canónica. **Lo crítico es DÓNDE vive cada nivel** (separación de privilegios / anti-escalation):

| Nivel | Quién | Scope | Cómo se enforce |
|---|---|---|---|
| **super_admin** | Zero + la empresa que desarrolla | **Plataforma (master DB)** | `MasterUser` + `masterOnly` + `x-master-key`. **NO es un rol de tenant.** Gestiona tenants, planes, billing, config global. |
| **admin** | El cliente que paga el tenant | **Tenant** (rol de sistema, `*`) | RoleCapability `['*']`. Gestiona su tenant: settings, usuarios, **crea roles custom**, asigna capabilities, su suscripción. |
| **user** | Usuario final del cliente | **Tenant** (rol de sistema, mínimo) | RoleCapability subset, deny-by-default. |
| *(custom roles)* | Creados por el admin del tenant | **Tenant** | Capabilities subset, **acotadas a las del plan**. |

Reglas (best-practice):
- **super_admin nunca es una fila Role de tenant** (si lo fuera, un admin podría auto-asignárselo → escalación). Vive en master.
- **admin del tenant solo puede otorgar capabilities que (a) existan y (b) estén dentro de su plan** (el gating por plan de M5 lo limita).
- **Roles de sistema** (`admin`, `user`) llevan `isSystem: true` → no se pueden borrar/renombrar (para no auto-bloquearse). Encima, el admin crea roles custom.
- **Anti-escalation**: un usuario no modifica su propio rol/capabilities; nadie se auto-asigna `*` ni capabilities de plataforma desde el tenant.
- Seed en provisión de tenant: `admin` con `['*']` + `user` con set mínimo.

## Orden de implementación (resumen operativo)
Backend: app setup → models/aislamiento → errores → authn (argon2/JWT/Auth0) → authz (capabilities/IDOR) → validación → rate limiting → secrets/vault → async → multi-tenant (metering/billing/webhooks) → módulos/plugins → realtime → graceful shutdown.
Frontend: stores por feature → extraer componentes → `onIonViewWillEnter` → menú dinámico → Auth0+deep-links → feature CRUD de ejemplo → CapacitorHttp/storage/permisos → lazy routes/perf.
