# Sistema Interno · Positive Media

Sistema de administración interna de la empresa (clientes, abonos, proyectos, empleados,
sueldos, tareas), construido sobre la base **Zero 2.0 adaptada a single-tenant**.
Reemplaza al sistema PHP legado (documentado en `../analisis_app_php/`); el plan de
producto vive en [`../PRD.md`](../PRD.md).

| Componente | Tecnología | Puerto | Path |
|------------|-----------|--------|------|
| Backend | Node.js ESM · Express · Sequelize 6 · MariaDB/MySQL | 3010 | `backend/` |
| Frontend | Vue 3 · Ionic · Vite · Capacitor · Pinia · Tailwind | 8100 | `frontend/` |
| E2E | Playwright (api / ui / websocket) | — | `e2e/` |

## Qué trae

- **Auth**: login password (argon2id), MFA/TOTP opcional con backup codes, lockout anti
  fuerza bruta, refresh tokens. Sin signup público: los usuarios los crea un administrador.
- **Permisos por capabilities** (`modulo:accion`), deny-by-default. Rol Administrador
  intocable con comodín `*`; matriz de permisos editable por rol.
- **Modularidad**: cada módulo de negocio se autodescubre por su `module.manifest.js` y se
  monta detrás de `verifyAccessToken → requireCapability`. Cero edición central.
- **Servicios de plataforma**: storage pluggable (local/S3), webhooks salientes firmados,
  realtime (presencia + broadcast), scheduler, vault de secretos, embeddings, OpenAPI 3 +
  Scalar en `/api/docs`.
- **Design system propio** (frontend): neutros zinc + acento esmeralda, tema claro/oscuro,
  tipografía Geist, estética sobria. Mobile-ready (Capacitor).

## Quick start

Requisitos: Node 18+, MariaDB/MySQL, (opcional) Redis — sin Redis todo degrada a fallback.

```bash
# Backend
cd backend
cp .env.example .env          # completá DB_* y JWT_SECRET
npm install
npm run init_db               # crea la base + schema + seed (rol Administrador + admin)
npm run dev                   # :3010

# Frontend
cd ../frontend
npm install
npm run dev                   # :8100 → login: admin / ADMINPASS (default admin123)

# E2E (requiere backend + frontend corriendo)
cd ../e2e
npm test
```

- API: `http://localhost:3010/api` · Docs (Scalar): `http://localhost:3010/api/docs`
- ⚠️ Cambiá la contraseña del admin ni bien ingreses.

## Documentación

- [`CLAUDE.md`](CLAUDE.md) — guía completa para programar en este repo (leer primero).
- [`docs/architecture/`](docs/architecture/README.md) — cableado single-tenant, flujo de request.
- [`docs/auth.md`](docs/auth.md) — login, tokens, MFA, lockout.
- [`docs/modules/`](docs/modules/README.md) — cómo crear un módulo.
- [`docs/decisions/`](docs/decisions/) — ADRs (la conversión single-tenant es
  [ADR-015](docs/decisions/ADR-015-single-tenant-conversion.md)).
- Servicios: [storage](docs/storage.md) · [realtime](docs/realtime.md) ·
  [webhooks](docs/webhooks.md) · [vault](docs/vault.md) · [config-registry](docs/config-registry.md)
- Operación: [migraciones](docs/migrations.md) · [deployment](docs/deployment.md)

## Convenciones

- Backend **JS ESM puro** (no TypeScript), **JSDoc obligatorio**, patrón controller-helper.
- Modelos con factory `defineXModel(db)` + `paranoid: true` (soft delete), auto-discovery.
- Un módulo importa infra **solo desde el barrel** `kernel/index.js`.
- Idioma de UI y mensajes: español argentino.
- **Regla de sync**: al tocar endpoint/modelo/middleware/evento/servicio → actualizar
  `docs/` + tests e2e en el mismo cambio.
