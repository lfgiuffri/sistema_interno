---
name: zero-backend
description: Build backend features on the Zero 2.0 base (Node ESM + Express 5 + Sequelize multi-tenant). Use when adding/modifying a backend module, model, service, controller, route, capability, scheduler/socket/notification handler, or anything under backend/src. Covers the manifest module system, kernel barrel, capabilities, plan-gating, billing, auth, storage/webhooks/embeddings/vault, and the controller-helper + JSDoc conventions.
---

# Zero 2.0 — Backend

Zero 2.0 is a multi-tenant base: a **master DB** (tenants, masterUsers, configs, subscriptions) + **one DB per tenant** (lazy, cached). Backend is **plain JS ESM** (no TypeScript), Express 5, Sequelize 6, Socket.IO, BullMQ/Redis.

## Architecture (read first)
- `backend/src/kernel/` = **infra** (never app-specific): `master/`, `users/`, `registry/`, `handlerRegistry.js`, `moduleLoader.js`, `capability.js`, `moduleGate.js`, `vault/`, `config-registry/`, and the **barrel `kernel/index.js`**.
- `backend/src/modules/` = **pluggable features**, each self-contained with a `module.manifest.js`. Auto-discovered at boot and mounted behind `verifyAccessToken → planGate(plan) → requireCapability(per route)`.
- `backend/src/services/` = infra services (ai, push, scheduler, sandbox, notifications, billing, storage, webhooks, embeddings, me, openapi).
- Full reference: `docs/architecture/README.md`, `docs/modules/README.md`, `docs/best-practices-guidelines.md`.

## To add a feature module: COPY `backend/src/modules/items/`
`items/` is the canonical template. Mirror it exactly:
1. `models/<Name>.js` — factory `export const define<Name>Model = (tenantDb) => { const M = tenantDb.define('snake_table', {...}, { timestamps:true, paranoid:true, indexes:[...] }); M.associate = (models)=>{ if(models.User) M.belongsTo(models.User,{foreignKey:'userId'}); }; return M; }`. Auto-discovered (no central registration). Always include `userId` + filter every query by it (tenant-isolation / anti-IDOR).
2. `services/<name>.service.js` — **all business logic + data access** (controller-helper pattern). No `req`/`res`. Receives `(models, userId, ...)`.
3. `controllers/<name>.controller.js` — **thin**: extract input, call service, respond with `responseManager`. Emit socket events on mutations.
4. `validators/<name>.validator.js` — express-validator per endpoint + the `validator` middleware (from the kernel barrel). Validation failures → 422.
5. `routes/<name>.routes.js` — each route declares `requireCapability('<key>:<action>')` before the validator + controller.
6. `module.manifest.js` — `export default { key, name, version, basePath, models:[...], capabilities:['<key>:read', ...], minPlan, dependsOn:[], router }`.

Then: nothing else. The loader discovers it, registers capabilities, and mounts it. Add the module key to the relevant plans in `config/plans.js` so `planGate` enables it.

## Conventions (non-negotiable)
- **Import infra ONLY from the kernel barrel**: `import { responseManager, Paginate, validator, requireCapability, enforceLimit, putFile, dispatchWebhook, vaultGet, ... } from '../../../kernel/index.js'`. Never deep-import infra into a module (keeps modules portable between Zero apps).
- **Always `responseManager(code, data, req, res, sendNotification, options)`** — never `res.json()` directly. Envelope: `{ success, code, message, timestamp, data, meta }`.
- **JSDoc on EVERY function** (description, `@param`, `@returns`) + inline comments for non-obvious *why*.
- **`paranoid: true`** (soft delete) on models. Never `destroy({ force:true })`.
- Capabilities: `modulo:accion` (e.g. `items:create`). Admin role has `*`. Seed/assign via `setRoleCapabilities` / the admin.
- Plan gating: feature modules gated by `planGate` (from `config/plans.js`). Quotas via `enforceLimit`/usage metering.
- Pluggable handlers: a module can add scheduler tasks (`registerSchedulerHandler`), socket handlers (`registerSocketHandler`), or notification actions (`registerNotificationAction`) — register them from the manifest/boot.
- **Resolve filesystem paths relative to the module** (`path.dirname(fileURLToPath(import.meta.url))`), NEVER cwd-relative (`./src/...`) — cwd-relative breaks in Docker/prod where the process runs from `build/`. Seeds/data are shipped to `build/` via `babel --copy-files`; `npm run build` does `rm -rf build` first (no stale artifacts).
- **Never persist a plaintext password**, even transiently: hash BEFORE `create()` (`await User.prototype.encryptPassword(pw)`), not after. Rehash legacy hashes on login via `rehashIfNeeded`.
- **External webhooks verify signatures fail-CLOSED**: if the signing secret is missing, throw/reject — never accept unverified (see Stripe/MercadoPago providers).

## Master / platform
- Roles: `super_admin` (platform, MasterUser, NOT a tenant role), `admin` (tenant owner, `*`), `user` (member). Custom roles per tenant.
- Auth for `/master/*`: `verifyAdmin` checks the **super_admin JWT** (`x-access-token`) — the frontend never ships `x-master-key`. `masterOnly` (`x-master-key`) is a separate platform key for a few config endpoints only.
- Tenant provisioning: `provisionTenant(data)` in `kernel/master/controllers/tenants.controller.js` (reused by admin createTenant AND self-signup).
- Billing: vendor-agnostic `PaymentProvider` (Stripe/MercadoPago). Webhooks verify signature + idempotency; they sync `Tenant.plan`.
- **Schema changes → write a migration**, never rely on `sync({alter})`. Add `src/migrations/{master,tenant}/NNNN-desc.js` (idempotent: check `describeTable`/`showIndex` first — MariaDB DDL auto-commits). Master migrations auto-run at boot; tenant ones run from the super-admin panel (`/admin/migrations`) or `POST /master/migrations/run`. See `docs/migrations.md`.

## Verify
`cd backend && npm run build`. For runtime: `npm run init_master_db` then `npm run dev`; smoke-test `POST /api/master/auth/signin`. Add e2e in `e2e/tests/api/` (see the `zero-tests` skill).

## ⚠️ SYNC RULE (mandatory)
When you add/change an endpoint, model (incl. **any schema change → migration**), middleware, capability, plan, manifest, or event:
1. Update `docs/` (architecture/modules/api + the relevant guide) **in the same change**.
2. Update/add the e2e test in `e2e/`.
3. If a convention changes, update THIS skill and the other `zero-*` skills.
Stale docs/skills are worse than none — keep them in lockstep with the code.
