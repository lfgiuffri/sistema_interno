# Roadmap de Zero 2.0

> Estado del proyecto + qué falta + recomendaciones para seguir (incluido desde otra PC).
> Última actualización: 2026-07-02.

## Cómo retomar en otra PC
```bash
git clone https://github.com/santigiuf/zero.git
cd zero/backend && npm install && cp .env.example .env    # completá DB (MariaDB), JWT_SECRET, ADMIN*
npm run init_master_db && npm run dev                     # :3010
cd ../frontend && npm install && npm run dev              # :8100  (login admin / admin123)
cd ../e2e && npm install && npm test                      # suite completa (requiere back+front arriba)
```
Agencia Puente (agentes + skills): `git clone https://github.com/santigiuf/puente-agency.git && cd puente-agency && ./install.sh`.

---

## ✅ Hecho y sólido (base lista para construir encima)
- **Multi-tenant**: master DB + DB por tenant (lazy, cacheada). Provisioning + sync de schema.
- **Modularidad**: `kernel/` (infra) vs `modules/` (pluggable por manifest + auto-discovery) + barrel. Módulo de ejemplo `items`.
- **Capabilities** (micro-permisos `modulo:accion`) + validación al boot. **Planes** + gating + usage metering. **`free` es el plan base** (default de tenants y downgrade).
- **Auth**: login centralizado, argon2id + rehash-on-login, MFA/TOTP + backup codes, passwordless (OTP/magic-link), self-signup anti-fantasma. Botones sociales Google/Apple/Facebook en el login.
- **Servicios**: storage pluggable (local/S3), webhooks salientes firmados (idempotentes, con lock), embeddings, vault (AES-256-GCM), config-registry, realtime/presence (Socket.IO).
- **Migraciones** versionadas (master + tenants) + panel super-admin (`/admin/migrations`).
- **Super-admin**: dashboard, tenants (CRUD), migraciones, **planes/suscripciones** (`/admin/plans`, catálogo + gestión por tenant).
- **UI**: rediseño de nivel sistema (componentes `ui/`: BaseSelect/Button/Input/Badge, tokens `--z-*`), login/signup/confirm consistentes.
- **Docs**: `docs/` por área + ADRs (001–013) + `installer.md` / `plans-billing.md`. **OpenAPI 3 + Scalar** en `/api/docs`.
- **Tests**: suite e2e Playwright (API + UI + WebSocket) + spec visual full-tour (Chrome headed).
- **Docker**: `docker-compose.yml` (backend/frontend/db/redis) + Dockerfiles + entrypoint.

### Sesión 2026-07-02 (nuevo)
- **Redis opcional endurecido** (ADR-009): sin Redis ya no crashea (fallback in-process real).
- **Planes DB-backed con CRUD total + versionado** (ADR-010): tabla `plans` (fuente de verdad),
  cache de gating, CRUD super-admin, `Tenant.plan` VARCHAR (migración 0002), **precio por plan**.
- **Front marketing + split de dominios** (ADR-011): landing `zero.com.ar` (hero/features/pricing
  dinámico/CTA) + `app.`/`api.` + endpoint público `GET /api/plans/public`.
- **Checkout Mercado Pago (Path A)**: provider reescrito al flujo redirect (`/preapproval` monto
  inline + `external_reference`); descubierto y arreglado un bug que el mock ocultaba. (Falta
  validación viva: setup de la app MP + túnel para el webhook.)
- **Integraciones de pago configurables desde el super-admin** (ADR-013): modelo `Integration`
  cifrado, billing **DB-first / `.env`-fallback**, endpoints + UI (`AdminIntegrationsPage`).
- **Installer CLI `npm run setup`**: asistente de configuración (ver `docs/installer.md`).
- **Rework visual** del login + panel super-admin (frontend-design / high-end).
- **Auditoría de seguridad + arquitectura** (ADR-012): 4 hardenings aplicados; hallazgos S5-S13 +
  arquitectura A1-A5 documentados. `npm audit fix` (3 high de prod). Dead code borrado.
- **Tests**: suite e2e **93/93** (API 86 · UI 3 · WS 4).

---

## 🚧 Falta / parcial (con recomendación)

### Alta prioridad
1. **Auth0 real**: los botones sociales existen y disparan el flujo, pero **Auth0 no está configurado** (faltan `AUTH0_DOMAIN`/`AUTH0_AUDIENCE`/`CLIENT_ID` + conexiones Google/Apple/Facebook en un tenant Auth0). → Crear el tenant Auth0, cargar env, probar el intercambio de token real.
2. **Billing sandbox real** (parcial — falta validación viva): la abstracción Stripe + MercadoPago está, **checkout MP arreglado (Path A, ADR-010)** y las **integraciones se configuran desde el super-admin** (claves cifradas, DB-first/`.env`-fallback, ADR-013). App MP "ZeroBilling" + token test + 3 preapproval plans wired en `.env`. → **Falta solo lo vivo**: completar la app en el panel MP + túnel público (ngrok) para el webhook, y probar suscribir→webhook→cambia plan; cancelar→downgrade a `free`. *(Tu parte: authtoken de ngrok + setup del panel.)*
3. **Docker sin ejecutar**: el compose está escrito y validado en config, pero **Docker no está instalado** en la máquina de dev, así que nunca se levantó el stack containerizado. → Instalar Docker, `docker compose up -d --build`, validar el flujo real de 1 comando.
4. **Cobertura UI en la suite**: la e2e es fuerte en API pero liviana en UI (el testeo visual encontró 2 bugs que la API no veía). → Formalizar el `visual-fulltour.spec.ts` como parte del suite y agregar tests UI por pantalla (login-nav, items CRUD, settings, admin, plans).

### Media prioridad
5. ~~**Editar definición de planes desde la UI**~~ → **HECHO** (2026-07-02, [ADR-010](../decisions/ADR-010-plans-db-backed-crud.md)): planes **DB-backed** (modelos `Plan`/`PlanVersion`, seed desde `config/plans.js#DEFAULT_PLANS`), gating síncrono contra un **cache en memoria** recargado en cada mutación, CRUD total + versionado + precio/moneda, editable desde `/admin/plans`.
6. **Deploy más completo**: el botón "Deploy" corre un `DEPLOY_COMMAND` genérico. Gaps: (a) **chequeo real de updates en git**, (b) **deploy opinado** (pull+build+reload back/front con install de deps), (c) **flag "rebuild APK/iOS"** que dispare `cap sync` + build mobile. → Definir si se implementan.
7. **Mobile (Capacitor)**: la codebase es única (web + APK/iOS) pero **`cap sync` + build Android/iOS no se ejercitaron**. → Probar `cap sync`, generar APK, validar en device/emulador.
8. **Storage S3**: el driver `local` anda; **S3/R2 no se probó** con credenciales. → Config `STORAGE_DRIVER=s3` + bucket real, validar subir/leer/borrar.

### Baja prioridad / nice-to-have
9. **Sitio de docs** (VitePress/Docusaurus) sobre `docs/` — hoy son markdown sueltos.
10. **Realtime/embeddings/vault**: implementados pero **poco testeados** end-to-end. → Sumar e2e específicos.
11. **CI/CD**: no hay pipeline (GitHub Actions) que corra build + e2e en cada push. → Agregar workflow.
12. ~~**Dead code menor**: `libs/promiseUtils.js` sin callers~~ → **borrado** (2026-07-01).

---

## Recomendaciones de orden para seguir
1. **Validación viva de billing MP** (lo más cerca de cerrar): setup del panel MP + `ngrok` → probar suscribir→webhook→sube plan / cancelar→downgrade. Es lo que valida el core del negocio SaaS (checkout Path A ya está en código).
2. **Configurar Auth0** (aunque sea con Google) para cerrar el login social real.
3. **Formalizar cobertura UI** en la e2e (el visual-fulltour ya existe; sumarlo al `npm test`).
4. **Instalar Docker** y validar el `docker compose up` (destraba el "deploy de 1 comando" y da un entorno reproducible).
5. Luego: deploy completo (#6), mobile (#7), refactors de arquitectura A1-A3 (ADR-012).

> ✅ **Planes DB-backed (#5)** y el **wizard/integraciones configurables** ya están hechos — salieron de la cola.

## Próximo / diferido

- ✅ **Checkout MP arreglado (Path A, 2026-07-02)**: el provider usaba el flujo *"suscripción CON plan asociado"* (`preapproval_plan_id`) que MP exige con `card_token_id` → `card_token_id is required`. **Reescrito** al flujo *"SIN plan asociado, pago pendiente"* (`/preapproval` con `auto_recurring` inline + `external_reference` + status pending → `init_point`). Se agregó `price`/`currency` al modelo `Plan`. **Falta solo validación viva** (ver "Billing sandbox" #2): completar la app MP en el panel + túnel público (ngrok) para el webhook.
- ✅ **Wizard de instalación + integraciones configurables (HECHO, 2026-07-02)**: installer CLI `npm run setup` (asistente de preguntas → genera `.env`, ver `docs/installer.md`) + integraciones de pago configurables desde el super-admin (modelo `Integration` cifrado, billing DB-first/`.env`-fallback, UI `AdminIntegrationsPage`, ADR-013).
- 🔨 **Refactors de arquitectura (diferidos, ADR-012 A1-A5)** — riesgosos, mejor con supervisión: **A1** converger los dos sistemas de auth (legacy `/users/auth` vs master) y deprecar el legacy (cierra S8); **A2** partir el god-object `tenants.controller` (831 líneas: handlers + creación de DB + `fs.mkdir` + `sync`); **A3** separar `responseManager` (respuesta + ErrorLog + notificaciones). *(A5 dead code ya borrado.)*
- 🔒 **Seguridad diferida (ADR-012 S5-S13)** — Medios/Bajos: rate-limit dedicado para signup/passwordless (email bombing), forzar `NODE_ENV=production` en staging, guard SSRF en webhooks salientes, CORS explícito en prod. Ninguno Crítico/Alto.

## Notas de arquitectura (no re-litigar — ver ADRs)
- DB-por-tenant (aislamiento a nivel conexión). `kernel/` vs `modules/` con barrel. Capabilities para authz. Billing vendor-agnóstico. argon2id. Ver `docs/decisions/ADR-001..009`.
- Auditoría de arquitectura (improve-codebase-architecture) + M-FINAL: 0 findings críticos abiertos; los medium/low quedaron documentados en ADR-008.
- **Redis opcional endurecido (ADR-009, 2026-07-01)**: se corrigió un bug de runtime que crasheaba el backend **sin Redis** (guard `getRedis()` roto + `Queue`/`QueueEvents` sin handler de error, en scheduler/webhooks/sandbox). Ahora `pingRedis()` gatea BullMQ y el fallback in-process (setInterval / entrega inline) funciona como prometían los docs. Verificado nativo en MySQL 8.0 local, suite e2e 74/74.
- **Higiene de conexión DB (2026-07-01)**: `masterDatabase.js` normaliza el `timezone` de conexión a offset válido (`mysql2` rechaza nombres IANA) y saca `collate` de `dialectOptions` (va en `define`). Boot sin warnings. Dead code `libs/promiseUtils.js` borrado.
