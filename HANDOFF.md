# HANDOFF — Continuación de sesión (Coolify + GlitchTip) · OBSOLETO

> ⚠️ **Documento histórico.** Es el traspaso de una sesión de julio de 2026 sobre la infra
> local del starter **Zero 2.0** (Coolify + WSL2 + GlitchTip), anterior a que este repo
> pasara a ser el **Sistema Interno**. Para esta app, Coolify y Docker quedaron descartados:
> el deploy real está en [`docs/deploy-vps-oracle.md`](docs/deploy-vps-oracle.md).
> No sigas los pasos de acá.

> Documento de traspaso para continuar el trabajo en otra máquina/cuenta de Claude.
> Generado el 2026-07-02 al cierre de la sesión que montó la infra local y la observabilidad.
> **Cómo usarlo**: abrí Claude Code en este repo y decile *"Leé HANDOFF.md y continuemos desde ahí"*.
> Los secretos NO están acá: viajan aparte en `zero-session-export.tar.gz` (ver §5).

---

## 0. Sesión 2026-07-03 — Zero corriendo LOCAL en esta PC (WSL2 + Coolify)

> Esta sesión NO usó la infra de la PC "dev1" (§3). Levantó todo **desde cero en la PC de Santi
> (Windows 11)** dentro de WSL2, porque acá el disco C: está casi lleno y todo debía ir al disco F:.

### 0.a Rebuild "desde 0 como usuario" (2ª pasada, la definitiva) ✅
Se hizo un **teardown total** (`wsl --unregister`) y se reinstaló TODO de cero operando por las
**interfaces gráficas** (Playwright/Chromium headless), con **screenshots de cada decisión** en
`.vscode/rebuild-screenshots/` (00→49). Resultado, todo verificado:
- **Coolify**: cuenta creada por la UI de registro + onboarding (This Machine) + proyecto `zero` por UI.
- **Zero**: instalador `npm run setup` corrido en consola (transcript en `rebuild-screenshots/`),
  MariaDB+Redis+2 apps provisionadas, **backend y frontend LIVE** (`zero.localhost` / `api.zero.localhost` = 200).
- **GlitchTip**: **completo esta vez** (web+worker+postgres+redis healthy). Cuenta + org **Puente** por UI;
  2 proyectos (`zero-backend`/`zero-frontend`) + DSNs; **4 issues de prueba persistidos** (pipeline
  backend→GlitchTip OK). Gotcha resuelto: el backend se conecta a la **red de GlitchTip** (no al revés,
  porque `postgres` colisiona en la red `coolify`); DSN sin guiones (hex32).
- **Validación como usuario (UI)**: login super admin → `/admin`; **tenant "Gimnasio Demo" (Free)** creado
  por la UI; login del tenant → dashboard rediseñado con menú lateral (Inicio/Items/Configuración) y
  "Módulos habilitados: Items". **Plan-gating** re-probado en vivo: free → `/items` 200, plan `locked`
  (sin módulos) → `/items` **403**.
- **Credenciales** de todo: `.vscode/credentials.md`. **Runbook** para repetir teardown+reinstalación:
  `.vscode/teardown-y-reinstalar.md`. Scripts: `F:\Proyectos\Infra\scripts\50-77` + `ui-scripts\`.
- **Cuenta Coolify nueva** (este rebuild): `santiago@positivemedia.com.ar` (password en `credentials.md`).
  UUIDs nuevos (proyecto/servidor/DBs) también en `credentials.md`.

### Estado: DESPLEGADO Y VALIDADO end-to-end ✅
- **Frontend**: http://zero.localhost  · **API**: http://api.zero.localhost/api/docs — ambos **200**
  desde el browser de Windows. Bundle del front con `api.zero.localhost` horneado (no `localhost:3010`).
- **Backend**: `initMasterDb` OK (5 planes sembrados, super_admin `admin`), migraciones master aplicadas,
  Redis + MariaDB conectados, módulo `items` montado, server en :3010.
- **Plan-gating validado en vivo** (el escenario que pediste): tenant en `free` → `enabledModules=['items']`
  → `GET /items = 200`; tenant en un plan `locked` (modules `[]`) → `enabledModules=[]` → `GET /items = 403`.
- **GlitchTip**: servicio creado en Coolify pero quedó a medias (sólo su redis levantó; el resto del
  template no terminó de desplegar). **PENDIENTE** re-desplegarlo y crear org/proyectos/DSNs. La
  instrumentación de Zero es no-op sin DSN, así que el stack funciona sin esto.

### Dónde vive todo (esta PC)
- **Distro WSL**: `Ubuntu-Coolify` en `F:\Proyectos\Infra\wsl\Ubuntu-Coolify`. Coolify 4.1.2 adentro.
- **Panel Coolify**: http://localhost:8000 (admin `santiago@positivemedia.com.ar`).
- **Credenciales** (fuera de git): `F:\Proyectos\Infra\coolify-local-creds.txt` (admin + API token),
  `zero-db-creds.txt` (MariaDB/Redis), `zero-app-creds.txt` (JWT, MASTER_API_KEY, ADMINPASS de Zero).
- **Scripts de provisión** (paso a paso, reproducibles): `F:\Proyectos\Infra\scripts\*.sh` (01→45).

### ⚠️ Operación (LEER)
- **Keepalive obligatorio**: WSL apaga la distro cuando no hay sesión que la mantenga → Coolify se cae.
  Durante la sesión se mantuvo con `wsl -d Ubuntu-Coolify -u root -- sleep infinity` en background.
  **Para que sobreviva reinicios/suspensión de Windows falta una Tarea Programada al logon** (el
  clasificador de seguridad la bloqueó en la sesión; hay que crearla manualmente o autorizarla). VBS
  listo en `F:\Proyectos\Infra\keepalive-coolify.vbs`.
- **Si la PC se suspende**, WSL/Coolify se pausan; al despertar hay que relanzar el keepalive.
- Fixes de entorno ya documentados en `docs/deploy-coolify.md` → "Local en Windows (WSL2)".

### Trabajo de esta sesión ya en git (branch `main`)
- `9a73c14` docs(deploy): receta WSL2 (DNS fix de Docker, keepalive, dominios `*.localhost`).
- `80a886a` feat(ui): rediseño base — sistema de diseño accesible (motion Emil, tipografía 16px,
  touch 48px, focus-visible) + shell mobile-first (menú lateral). Build verde.
- `69320e8` feat(ui): rediseño HomePage e ItemsPage (más cálido/legible/tapeable, inputs 16px).
- Frontend **redeployado** en Coolify con estos cambios → visible en http://zero.localhost.

### Pendientes de esta tanda (pedido del usuario)
1. **Rediseño completo de la UI** con `/emil-design-eng`, mobile-first, aprovechando desktop, menú
   lateral conservado, usable por cualquier edad. **Hecho**: sistema de diseño (tokens/motion/type/
   touch/focus), shell (menú lateral), BaseButton, HomePage, ItemsPage — todo build-verde y deployado.
   **Falta**: LoginPage, SignupPage, SettingsLayout + secciones, Admin* (Dashboard/Tenants/Plans/
   Integrations/Migrations), Marketing/Pricing, y componentes ui restantes (BaseInput/BaseSelect/
   StatCard/AppModal). El fundamento de tokens ya hace que cada página nueva sea rápida.
2. **Teardown total + rebuild desde 0** para validar que el setup es smooth (borrar DBs de Zero +
   Coolify y reinstalar todo con el instalador). La receta quedó en los scripts + docs.
3. **Correr la suite e2e** (Playwright) y sumar tests si falta (plan-gating ya cubierto por
   `m06-capabilities-plan.spec.ts`).
4. Desplegar el rediseño (redeploy del frontend en Coolify) cuando esté listo.

---

## 1. Contexto de negocio (por qué esto existe)

- **Zero 2.0** (este repo) es el starter multi-tenant de la agencia **Puente** para construir y vender
  muchas apps. Repo privado `santigiuf/zero`, branch `main`.
- Se decidió el stack de plataforma: **Coolify** = capa de deploy (PaaS self-hosted, Apache 2.0, sin
  fee per-app) y **GlitchTip** = capa de observabilidad (protocolo/SDK de Sentry, MIT). Se descartó
  Sentry self-hosted (16GB RAM + licencia FSL prohíbe revenderlo) y se dejó Sentry Cloud como opción
  vía el mismo SDK. Análisis completos en la conversación exportada (ver §5).
- **Requerimiento clave del dueño**: Zero debe desplegarse **CON o SIN Coolify** y **CON o SIN
  GlitchTip**, según setup (3 modos: `standalone` / `coolify-new` / `coolify-existing`). Cumplido.

## 2. Qué se hizo (commits de la sesión, ya en `main`)

| Commit | Qué |
|---|---|
| `48c53ae` | fix Dockerfile backend: `npm ci --include=dev` en build stage (Coolify inyecta NODE_ENV=production como build arg y rompía Babel) |
| `c9baf1a` | **Instrumentación opt-in Sentry/GlitchTip**: backend `@sentry/node` (`instrument.mjs` + `node --import` en entrypoint/start + `setupExpressErrorHandler` + tag `tenant` post-tenantIdentification) y frontend `@sentry/vue` (init en `main.ts` si `VITE_SENTRY_DSN`). **Sin DSN = no-op total** (dev/e2e intactos) |
| `ccfac19` | `npm run setup` pregunta **modo de deploy** (standalone/coolify-new/coolify-existing) + sección observabilidad (SENTRY_DSN); `docs/deploy-coolify.md` (guía completa + troubleshooting); `docs/decisions/ADR-014`; links en deployment.md y docs/README.md |

## 3. Infra local desplegada (vive en la PC "dev1", NO en esta máquina)

En la PC original quedó corriendo (todo provisionado **por API** de Coolify):

| Recurso | Detalle |
|---|---|
| Coolify 4.1.2 | panel `:8000`, proxy Traefik en **80/443** (Apache del host quedó **deshabilitado**) |
| Proyecto `zero` | MariaDB 11 managed (backend conecta como root — multi-tenant crea DBs) + Redis 7 managed + `zero-backend` (Dockerfile, Base Dir `/backend`, :3010) + `zero-frontend` (Base Dir `/frontend`, :80, VITE_* como build args) |
| Proyecto servicios | **GlitchTip** (org "Puente", proyectos `zero-backend` y `zero-frontend` con DSNs; 1 issue de prueba capturado ✅), **Mailpit** (SMTP 1025 al host), **Uptime Kuma**, **MinIO** (compose custom) |
| Dominios | `*.127.0.0.1.sslip.io` vía **/etc/hosts** (bloque `# >>> zero-coolify local`) porque el router bloquea sslip.io (DNS-rebind). Fuente del repo: **deploy key** (no GitHub App → sin webhooks → deploys manuales) |

Si la otra PC está en la **misma LAN**, el panel es accesible en `http://192.168.100.13:8000`
(las URLs sslip locales apuntan a 127.0.0.1 — para acceder desde otra máquina habría que apuntar los
hosts a `192.168.100.13`).

### Gotchas aprendidos (importan para Oracle y para repetir el proceso)
- Coolify **asume su proxy en :80** al autogenerar URLs de servicios one-click (con proxy en :8080
  salían DSNs/links rotos → por eso se liberó el 80). El FQDN de los servicios sale del **Wildcard
  Domain del server** (se seteó `http://127.0.0.1.sslip.io`); para corregir un servicio ya creado hay
  que tocar `service_applications.fqdn` + borrar las env `SERVICE_FQDN/URL_*` y redeployar.
- Backend→GlitchTip **en local**: dentro del contenedor `*.127.0.0.1.sslip.io` resuelve al loopback
  del contenedor. Se probó el pipeline con el **DSN interno** (`web-<uuid>:8000`) → issue creado. El
  `--add-host` configurado por API no lo aplicó Coolify (guardado pero ignorado). En un VPS con DNS
  real este problema NO existe. **No** conectar contenedores de GlitchTip a la red `coolify` a mano
  (lo desestabilizó; se revirtió con restart).
- El e2e de errores quedó: backend probado con DSN interno ✅, frontend tiene el DSN horneado en el
  bundle ✅ (falta solo provocar un error real desde el browser para verlo entrar).

## 4. Próximos pasos (en orden de valor)

1. **VPS Oracle de Puente** (plan completo ya diseñado, quedó en la conversación exportada):
   cuenta nueva de Puente, región `sa-saopaulo-1`, **PAYG + budget USD 1** (receta probada de
   LifeSync), VM Ampere A1 4 OCPU/24GB Ubuntu 22.04 ARM, dominio **`*.apps.puentestec.com`** con
   HTTPS real, proxy 80/443, GitHub App (ahí los webhooks SÍ funcionan → auto-deploy). Gotcha Oracle:
   abrir puertos en Security List **y** en iptables del SO. Verificar builds ARM64 (deps nativas).
2. **Automatizar la provisión Coolify en `setup.js`** (modos `coolify-*`): hoy el wizard guía y
   `docs/deploy-coolify.md` tiene la receta; la sesión dejó probada la secuencia exacta de API
   (project → mariadb → redis → 2 apps por deploy-key → envs bulk → deploy).
3. **Polish local** (no bloqueante): monitores en Uptime Kuma, backups programados de la MariaDB
   managed (a MinIO o disco), routing de la consola de MinIO (2 puertos/mismo host).
4. Al terminar en la PC original: revertir passwordless sudo (`sudo rm /etc/sudoers.d/claude-temp` +
  borrar la línea agregada al final de `/etc/sudoers` con `sudo visudo`).

## 5. Secretos y archivos que viajan FUERA de git

En la PC original se genera `~/zero-session-export.tar.gz` con:
- `coolify-creds.txt` — admin de Coolify, **API token root**, root pass de MariaDB, pass de Redis,
  JWT/MASTER_API_KEY/ADMINPASS de Zero, credenciales de GlitchTip y los **2 DSNs**.
- El **transcript completo** de la conversación (`.jsonl`, ~3MB) — sirve para re-leer los análisis
  (Sentry vs GlitchTip, Coolify, plan Oracle) o para `claude --resume` (ver abajo).
- El **plan file** aprobado de la sesión.

Transferilo por USB/scp/password-manager. **Nunca commitearlo.**

### (Opcional) Resume exacto de la sesión en otra PC
El transcript permite retomar la MISMA conversación (las sesiones de Claude Code son locales, no
dependen de la cuenta): copiar el `.jsonl` a
`~/.claude/projects/<slug-del-cwd>/2ef687ed-8d5a-4173-809c-84624ca85de7.jsonl` en la otra máquina
(el `slug` es el path del directorio de trabajo con `/`→`-`; debe coincidir con el cwd desde donde
abras `claude`) y correr `claude --resume`. Si no coincide el path, este HANDOFF es el camino simple.
