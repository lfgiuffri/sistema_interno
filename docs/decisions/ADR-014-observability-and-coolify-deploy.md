# ADR-014 — Observabilidad opt-in (Sentry/GlitchTip) y deploy con Coolify

> **Actualización (2026-08-11):** para el Sistema Interno se descartó Coolify; la
> producción va en un VPS de Oracle Cloud con Docker Compose + Caddy
> ([deploy-vps-oracle.md](../deploy-vps-oracle.md)). La parte de observabilidad de este
> ADR sigue vigente; `deploy-coolify.md` fue eliminado.

- **Status**: Aceptado
- **Date**: 2026-07-02

## Context

La base es un starter que **otros despliegan** de formas distintas: en un VPS pelado, con un PaaS, o
sumando la app a una plataforma que ya tienen. Además, algunos van a querer error tracking y otros no.
Hasta ahora no había instrumentación de errores ni una guía de deploy más allá de Docker Compose.
Necesitábamos: (a) observabilidad **sin acoplar** la app a ninguna herramienta ni infra concreta, y
(b) documentar el deploy con Coolify como camino de "plataforma".

## Decision

1. **Instrumentación opt-in por DSN** (no-op sin él). Backend `@sentry/node`, frontend `@sentry/vue`:
   - `backend/instrument.mjs` inicializa el SDK **solo si** `process.env.SENTRY_DSN`. Se carga con
     `node --import ./instrument.mjs` (entrypoint Docker + script `start`) porque en ESM `init()` debe
     correr antes de importar la app.
   - `setupExpressErrorHandler(app)` tras montar las rutas; middleware que taggea cada request con el
     `tenant` (scope aislado por request en `@sentry/node` v8+). Todo guardado por `if (SENTRY_DSN)`.
   - Frontend: `Sentry.init({ app, dsn })` en `main.ts` solo si `VITE_SENTRY_DSN` (build arg, horneado
     por Vite → cambiar el DSN exige rebuild).
   - Sin DSN: el SDK no se inicializa, no sale tráfico, dev/e2e intactos. Sirve para "con o sin
     GlitchTip". Como GlitchTip habla el **protocolo de Sentry**, el mismo DSN sirve para ambos.

2. **Deploy agnóstico, elegible en el setup.** `npm run setup` pregunta el modo:
   `standalone` (compose/bare-metal, sin Coolify) · `coolify-new` (instalar Coolify + la app) ·
   `coolify-existing` (sumar la app a un Coolify existente). El `.env` generado incluye `SENTRY_DSN`.
   El patrón Coolify (managed MariaDB/Redis + 2 apps Dockerfile) y sus gotchas quedan en
   `deploy-coolify.md` (eliminado — ver nota al tope).

3. **Hardening del build**: el build stage del `backend/Dockerfile` usa `npm ci --include=dev` para no
   depender de que `NODE_ENV` no llegue como build arg (Coolify inyecta env vars también en build).

## Consequences

- La app queda observable en cualquier destino sin dependencia dura de GlitchTip ni Coolify; quien no
  quiere error tracking no paga nada (SDK no-op).
- Nuevas deps de producción: `@sentry/node` (backend), `@sentry/vue` (frontend). Presentes siempre,
  inertes sin DSN.
- El frontend hornea el DSN en build → rotar el DSN implica redeploy del frontend (documentado).
- El deploy con Coolify queda reproducible; el `docker-compose.yml` sigue siendo el camino standalone.
- **Pendiente**: automatizar la provisión en Coolify (modos `coolify-*`) vía la API de Coolify desde
  un script del installer; hoy el wizard guía y `deploy-coolify.md` tiene la receta paso a paso.
