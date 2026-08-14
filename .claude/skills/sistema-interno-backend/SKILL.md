---
name: sistema-interno-backend
description: Build backend features in the Sistema Interno (Node ESM + Express 5 + Sequelize, single-tenant). Use when adding/modifying a backend module, model, service, controller, route, capability, scheduler/socket/notification handler, or anything under backend/src. Covers the manifest module system, the kernel barrel, capabilities, auth, migrations, and the controller-helper + JSDoc conventions.
---

# Sistema Interno — Backend

Administration app for Positive Media. **Single-tenant**: one database, no tenants, no plans, no billing, no public signup — an administrator creates the users. Backend is **plain JS ESM** (no TypeScript), Express 5, Sequelize 6, Socket.IO, BullMQ/Redis (Redis optional — everything degrades to `setInterval`).

## Architecture (read first)
- `backend/src/kernel/` = **infra** (never business-specific): `users/` (User, Role, RoleCapability + auth/roles/users), `auth/` (argon2id, TOTP, session, lockout), `registry/`, `realtime/`, `config-registry/`, `vault/`, `mail/`, `migrations/`, `capability.js`, `moduleLoader.js`, `handlerRegistry.js`, and the **barrel `kernel/index.js`**.
- `backend/src/modules/` = **pluggable features**, each self-contained with a `module.manifest.js`. Auto-discovered at boot and mounted behind `verifyAccessToken → requireCapability(per route)`. **There is no plan gating.**
- `backend/src/services/` = platform services (ai, archivos, avisos, embeddings, html, me, notificaciones, notifications, openapi, push, sandbox, scheduler, storage, webhooks).
- One connection in `database.js`; models auto-discovered by `associations.js` (factories `define<X>Model(db)`); `middlewares/dbContext.js` injects `req.db` / `req.models`.
- Full reference: `CLAUDE.md`, `docs/architecture/README.md`, `docs/modules/README.md`.

## To add a feature module: COPY `backend/src/modules/areas/`
`areas/` is the smallest complete module — mirror it:
1. `models/<Name>.js` — factory `export const define<Name>Model = (db) => {...}` + `associate`, `paranoid: true`. Auto-discovered, no central registration.
2. `services/<name>.service.js` — **all business logic + data access**. No `req`/`res`. Receives `(models, ...)`.
   ⚠️ **The data is the company's, not the user's**: never filter business queries by `userId`. `userId` is authorship only.
3. `controllers/<name>.controller.js` — **thin**: `matchedData(req)` → service → `responseManager`. Emit socket events on mutations.
4. `validators/<name>.validator.js` — express-validator per endpoint + the `validator` middleware (from the barrel). Failures → 422.
5. `routes/<name>.routes.js` — every route declares `requireCapability('<key>:<action>')`.
6. `module.manifest.js` — `export default { key, name, version, basePath, models:[...], capabilities:[...], dependsOn:[], router }`.

Then nothing else: **do not touch `routes.js`** — the loader discovers the module, registers its capabilities and mounts it.

## Conventions (non-negotiable)
- **Import infra ONLY from the kernel barrel**: `import { responseManager, Paginate, validator, requireCapability, getAppConfigNumber, crearNotificacion, putFile, ... } from '../../../kernel/index.js'`. Never deep-import infra into a module.
- **Always `responseManager`** — never `res.json()` directly. Envelope: `{ success, code, message, timestamp, data, meta }`. Pagination in `meta` (helper `Paginate`).
- **JSDoc on EVERY function** (description, `@param`, `@returns`) + inline comments explaining the *why*, in Spanish (es-AR), like the surrounding code.
- **`paranoid: true`** (soft delete). Never `destroy({ force: true })` outside documented, settled ledgers.
- Capabilities: `modulo:accion` (e.g. `abonos:create`), deny-by-default. The seeded `Administrador` role is `isSystem` with the `*` wildcard: it can't be edited or deleted, and `*` is not assignable to other roles.
- Pluggable handlers: `registerSchedulerHandler` (one-minute tick), `registerSocketHandler`, `registerNotificationAction`.
- **Resolve filesystem paths relative to the module** (`path.dirname(fileURLToPath(import.meta.url))`), NEVER cwd-relative — that breaks in production, where the process runs from `build/`.
- **Never persist a plaintext password**: hash BEFORE `create()`.
- Legacy business rules (frozen amounts, append-only histories, delete guards, rounding) are preserved from the PHP system — see `../analisis_app_php/` and PRD §6.

## Migrations
**Any schema change on a database with data → a migration**, never `sync({ alter })`. Add `backend/src/migrations/NNNN-desc.js` (`export const up = async (sequelize, Sequelize)`), idempotent — MariaDB auto-commits DDL, so a half-applied migration must be safe to re-run. They run at boot unless `AUTO_MIGRATE=false`. A fresh install uses `npm run init_db`.
⚠️ `showAllTables()` returns objects (`{ tableName, schema }`) in MariaDB, not strings — normalize before comparing or the guard never fires.

## Verify
`cd backend && npm run build`. Runtime: `npm run init_db` then `npm run dev`; smoke-test `POST /api/auth/signin`. Add e2e in `e2e/tests/api/` (see the `sistema-interno-tests` skill).

## ⚠️ SYNC RULE (mandatory)
When you add/change an endpoint, model (**schema change → migration**), middleware, capability, manifest, socket event, service or config:
1. Update `docs/` **in the same change**.
2. Update/add the e2e test in `e2e/` (+ helpers).
3. Update the OpenAPI spec (`services/openapi/openapi.service.js`).
4. If a convention changes, update THIS skill and the other `sistema-interno-*` skills.
Stale docs/skills are worse than none — keep them in lockstep with the code.
