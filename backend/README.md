# Sistema Interno — Backend

API del Sistema Interno de Positive Media. Node.js ESM · Express 5 · Sequelize 6 · MariaDB/MySQL, **single-tenant** (una sola base, sin planes ni billing).

> La guía completa para trabajar en el repo está en [`../CLAUDE.md`](../CLAUDE.md); el detalle por área, en [`../docs/`](../docs/README.md).

## Comandos

```bash
npm run init_db   # provisión: crea la base + schema + seed (rol Administrador + admin)
npm run dev       # desarrollo (babel-node + nodemon) en :3010
npm run build     # compila a build/
npm start         # corre lo compilado (lo que usa el servicio systemd en producción)

npm run migrar_legado -- --confirmar   # copia los datos del sistema PHP legado
```

Docs interactivas: `http://localhost:3010/api/docs` (Scalar) · spec: `/api/openapi.json`.
Salud (público, para el watchdog externo): `/api/health`.

## Estructura

```
src/
├── kernel/        # INFRA: users/roles/capabilities, auth (argon2id + MFA + lockout),
│                  # registry, realtime, config-registry, vault, mail, migrations.
│                  # `kernel/index.js` es el BARREL: lo único que un módulo puede importar.
├── modules/       # FEATURES pluggable, uno por carpeta con su `module.manifest.js`:
│                  # abonos, areas, clientes, dashboard, documentacion, empleados, espacios,
│                  # formas-facturacion, mantenimiento, proyectos, servicios, sueldos,
│                  # tareas + settings (infra).
├── services/      # ai, archivos, avisos, embeddings, html, me, notificaciones,
│                  # notifications, openapi, push, sandbox, scheduler, storage, webhooks.
├── migrations/    # migraciones idempotentes que corren al boot (AUTO_MIGRATE != false)
├── database.js    # conexión única + singleton de modelos
├── associations.js# auto-discovery de modelos (factories `define<X>Model`)
└── routes.js      # rutas de infra explícitas; los módulos se montan solos por manifest
```

## Cómo se resuelve un request

```
helmet → json → rate limit global → req.io
  → dbContext (req.db / req.models) → actionTracking
  → [auth: rate limit propio, público]
  → [resto: verifyAccessToken → requireCapability('modulo:accion') por ruta]
```

Toda respuesta sale por `responseManager`: `{ success, code, message, timestamp, data, meta }`.

## Agregar un módulo

Copiá `src/modules/areas/` como plantilla y seguí el checklist de [`../docs/modules/README.md`](../docs/modules/README.md). **No se toca `routes.js`**: el moduleLoader lo descubre y lo monta.

## Configuración

`.env` a partir de [`.env.example`](.env.example). Lo mínimo: `DB_*`, `JWT_SECRET` (obligatorio en producción) y `ADMINUSER`/`ADMINPASS` para el seed. Redis es opcional — sin él, las colas y el scheduler degradan a `setInterval`.
