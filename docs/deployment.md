# Deployment (Docker) — Zero 2.0

> ⚠️ **Keep in sync.** `docker-compose.yml` (raíz), `backend/Dockerfile` + `backend/docker-entrypoint.sh`, `frontend/Dockerfile` + `frontend/nginx.conf`, `.env.docker.example`. Migraciones/deploy desde el panel: ver [migrations.md](migrations.md).

> **Producción del Sistema Interno**: VPS de Oracle Cloud SIN Docker (Node + MySQL del
> host, systemd + nginx/certbot) — runbook completo en [deploy-vps-oracle.md](deploy-vps-oracle.md).
> Este doc (compose) queda como alternativa/entorno de prueba. La observabilidad
> (Sentry/GlitchTip) es opt-in: ver [ADR-014](decisions/ADR-014-observability-and-coolify-deploy.md).

Zero 2.0 se despliega completo con **un comando**. El compose levanta cuatro servicios y los conecta entre sí.

```bash
cp .env.docker.example .env      # opcional — los defaults ya funcionan
docker compose up -d --build
```

| Servicio | Imagen | Puerto host | Rol |
|----------|--------|-------------|-----|
| `frontend` | build → nginx:alpine | 8100 → 80 | SPA (Vue/Ionic) estática |
| `backend` | build (node:22-slim) | 3010 | API + Socket.IO |
| `db` | mariadb:11 | 3306 | DB maestra + DBs de tenant (volumen `db_data`) |
| `redis` | redis:7-alpine | interno | cache, rate-limit, BullMQ (volumen `redis_data`) |

Al terminar: frontend en `http://localhost:8100`, API en `http://localhost:3010/api`, docs en `http://localhost:3010/api/docs`. Login inicial: `admin` / `admin123`.

## Qué hace el arranque, solo

1. `db` y `redis` arrancan; el backend **espera** a que estén *healthy* (`depends_on: condition: service_healthy`).
2. El `docker-entrypoint.sh` del backend corre `initMasterDb.js` (idempotente: crea la DB maestra con utf8mb4, sincroniza tablas master, siembra configs globales y el super_admin si no existen). Reintenta hasta 10× por si la DB tarda.
3. Arranca `node build/index.js`. Al boot aplica las **migraciones master** pendientes (`AUTO_MIGRATE=true`).
4. Las **migraciones de tenant** se aplican desde el panel super-admin (`/admin/migrations`) — ver [migrations.md](migrations.md).

> Los datos persisten en los volúmenes `db_data`/`redis_data`. `docker compose down` para parar; `docker compose down -v` **borra los datos**.

## Variables

Compose lee el `.env` de la raíz (ver [`.env.docker.example`](../.env.docker.example)); todo tiene default. Para producción cambiá **al menos** `MASTER_DBPASS`, `JWT_SECRET` y `ADMINPASS`.

Las **API keys de terceros** (IA, Stripe, MercadoPago, S3, SMTP, Auth0…) van en `backend/.env`: el compose lo carga con `env_file: { required: false }`. Las variables de `environment` del compose (hosts internos, puertos, secretos core) tienen prioridad sobre ese archivo.

### URLs públicas (importante si exponés con dominio)

El frontend es estático: las URLs del backend se **inyectan en build time** (Vite inlinea `VITE_*`). Si servís detrás de un dominio/proxy, seteá antes de `--build`:

```bash
VITE_API_URL=https://api.tudominio.com/api
VITE_SOCKET_URL=https://api.tudominio.com
PUBLIC_API_URL=https://api.tudominio.com/api
FRONTEND_URL=https://app.tudominio.com
CORS_ORIGIN=https://app.tudominio.com
```

## Operaciones comunes

```bash
docker compose up -d --build       # levantar / reconstruir
docker compose logs -f backend     # ver logs del backend
docker compose ps                  # estado de los servicios
docker compose restart backend     # reiniciar un servicio
docker compose down                # parar (conserva datos)
docker compose down -v             # parar y BORRAR datos
```

### Migraciones y deploy de código

Una vez arriba, el super_admin las dispara desde `/admin/migrations` o por API (ver [migrations.md](migrations.md)). Para que el botón **Deploy** redeployee los contenedores, configurá en `backend/.env`:

```bash
DEPLOY_COMMAND=docker compose pull && docker compose up -d --build
```

> Para que el backend pueda ejecutar `docker compose`, el contenedor necesita acceso al Docker host (montar `/var/run/docker.sock`) — habilitalo solo si confiás en quién tiene rol super_admin. Alternativa más segura: dejar `DEPLOY_COMMAND` vacío y desplegar desde CI/CD.

## Deploy a un servidor

1. Instalá Docker + Docker Compose en el server.
2. Cloná el repo, `cp .env.docker.example .env` y completá secretos de producción.
3. (Opcional) `backend/.env` con las API keys de terceros.
4. Seteá las `VITE_*`/`PUBLIC_API_URL`/`CORS_ORIGIN` a tu dominio.
5. `docker compose up -d --build`.
6. Poné un reverse proxy (nginx/Caddy/Traefik) con TLS delante de `:8100` (frontend) y `:3010` (API).

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| backend reinicia en loop | DB no acepta conexiones | `docker compose logs db`; esperar al healthcheck; verificar `MASTER_DBPASS` consistente |
| frontend llama a `localhost:3010` en prod | `VITE_*` no seteadas antes del build | re-`build` con `VITE_API_URL`/`VITE_SOCKET_URL` correctas |
| CORS bloquea el frontend | `CORS_ORIGIN=*` no alcanza con credenciales | poné el origin exacto del frontend |
| "Access denied for user root" | password desincronizado | `down -v` y volver a levantar, o alinear `MASTER_DBPASS` |
