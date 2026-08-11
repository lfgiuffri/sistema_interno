# ADR-015 — Conversión a single-tenant (Sistema Interno)

**Estado**: aceptada · **Fecha**: 2026-08-10 · **Decisor**: Santiago (PRD §2)

## Contexto

Zero 2.0 nació como base SaaS multi-tenant (base maestra + una DB por tenant, planes,
billing, self-signup). El Sistema Interno de Positive Media es una app de UNA sola empresa:
el peso del multi-tenant (resolución de tenant por request, pool de conexiones por tenant,
gating por plan, billing) no aporta nada y complica cada feature.

## Decisión

Eliminar el multi-tenant por completo (no "un tenant fijo"): una sola base, un solo set de
modelos singleton, auth sobre `User` local y permisos únicamente por capabilities.

**Se eliminó**: `kernel/master/` (Tenant, MasterUser, GlobalConfig, Subscription,
PaymentEvent, SignupRequest, LoginToken), `masterDatabase`/`tenantAssociations`,
`tenantIdentification`/`verifyAdmin`/`masterOnly`, `services/billing`, `services/publicPlans`,
`config/plans.js`/`featureAccess`/`planGate`, `kernel/usage`, self-signup/captcha/Auth0/
passwordless, el RBAC viejo por vistas (Permission/View/Route/registry-routes) y el panel
super-admin del frontend (admin/marketing/signup).

**Se agregó/adaptó**: `database.js` (conexión única + `getModels()`), `associations.js`,
`dbContext`, auth single-tenant (signin por username/email, lockout anti fuerza bruta con
tabla `login_attempts`, MFA/TOTP sobre User, tokens con payload mínimo y re-validación por
request), roles sobre capabilities con rol Administrador `isSystem` + `*` no asignable,
protección del último admin, `PUT /users/my-account` (perfil propio sin capability),
scheduler/webhooks/sandbox/push/presence/storage re-escritos sin tenant (rooms `user:<id>`
y `app`; storage con prefijo `app/`), migraciones de carpeta única, `exec/initDb.js`.

## Consecuencias

- (+) Cada módulo de negocio se escribe contra `req.models` sin pensar en tenants.
- (+) Menos superficie de ataque y de mantenimiento; boot más simple.
- (−) Si algún día se quiere vender el sistema como SaaS, el camino es volver a la base
  Zero 2.0 original y portar los módulos (los manifests y el barrel del kernel se
  conservaron justamente para eso).
- Los ADR 001/005/006/010/011/013 describen la base Zero original y quedan como historia:
  ya no aplican a este repo.
