# Deploy en VPS de Oracle Cloud — Sistema Interno (sin Docker)

> Runbook para correr el sistema **directo en el servidor** (bare metal): Node + MySQL
> ya instalados en la VM, backend como servicio de **systemd**, frontend estático y
> **nginx** como servidor web con HTTPS de Let's Encrypt (certbot). Sin contenedores.

## Arquitectura resultante

```
Internet ──► nginx (:80/:443, TLS de Let's Encrypt via certbot)
               sys.positivemedia.com.ar
                 ├── /            → dist/ del frontend (estático, SPA + PWA)
                 ├── /api/*       → 127.0.0.1:3010 (backend Node, systemd)
                 └── /socket.io/* → 127.0.0.1:3010 (WebSockets)
MySQL (local) · Redis (opcional) · adjuntos en backend/storage/
```

Un solo dominio: el frontend y la API comparten origen (`/api`), así que no hay CORS
entre subdominios y un solo certificado alcanza.

## 0. Requisitos

- **Node 20+** (recomendado 22) y **MySQL** — ya instalados según lo conversado.
- **Git**, **nginx** y **certbot** (se instalan en el paso 3).
- **Redis: opcional.** Sin Redis todo funciona igual (el scheduler usa un intervalo
  interno y el cache cae a memoria). Si está, se usa solo. `sudo apt install redis-server`
  si lo querés.

## 1. Firewall de Oracle Cloud (dos capas)

En OCI el firewall tiene DOS capas: la **Security List de la VCN** (consola) y el
**iptables local** de la imagen de Ubuntu de Oracle (viene restrictivo).

**Consola**: *Networking → VCN → Subnet → Security List* → Ingress Rules:

| Source | Protocolo | Puerto | Para |
|---|---|---|---|
| 0.0.0.0/0 | TCP | 80 | HTTP (redirige a HTTPS) |
| 0.0.0.0/0 | TCP | 443 | HTTPS |

**En la VM** (el 22/SSH ya está):

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80  -m state --state NEW -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -m state --state NEW -j ACCEPT
sudo netfilter-persistent save        # (apt install iptables-persistent si falta)
```

No abrir 3010 ni 3306: el backend queda en localhost detrás de nginx y MySQL no se expone.

## 2. DNS

Un registro **A**: `sys.positivemedia.com.ar` → IP pública de la VM.
(Debe propagar antes del paso 7: certbot lo necesita para emitir el certificado.)

## 3. nginx + certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

## 4. MySQL: base y usuario dedicado

```sql
-- sudo mysql
CREATE DATABASE IF NOT EXISTS sistema_interno CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sistema'@'localhost' IDENTIFIED BY '<password fuerte>';
GRANT ALL PRIVILEGES ON sistema_interno.* TO 'sistema'@'localhost';
FLUSH PRIVILEGES;
```

## 5. Backend

```bash
sudo mkdir -p /opt/sistema-interno && sudo chown $USER /opt/sistema-interno
git clone <URL del repo> /opt/sistema-interno
cd /opt/sistema-interno/backend
npm ci                       # incluye devDependencies (Babel compila el build)
```

**`/opt/sistema-interno/backend/.env`**:

```env
NODE_ENV=production
PORT=3010

# Base de datos (¡DBDRIVER=mysql porque el server es MySQL, no MariaDB!)
DBDRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=sistema_interno
DB_USER=sistema
DB_PASS=<password del usuario sistema>

# Redis (opcional — comentar si no hay; el sistema funciona igual)
# REDIS_HOST=127.0.0.1
# REDIS_PORT=6379

# Seguridad (OBLIGATORIO: el backend no arranca sin JWT_SECRET en producción)
JWT_SECRET=<openssl rand -hex 48>

# Admin inicial (cambiar la contraseña al primer login)
ADMINUSER=admin
ADMINPASS=<contraseña inicial fuerte>
ADMIN_EMAIL=santiago@positivemedia.com.ar
APP_NAME=Sistema Interno

# URLs públicas (mismo origen: el frontend y la API viven en sys.positivemedia.com.ar)
CORS_ORIGIN=https://sys.positivemedia.com.ar
PUBLIC_API_URL=https://sys.positivemedia.com.ar/api
FRONTEND_URL=https://sys.positivemedia.com.ar
AUTO_MIGRATE=true

# Observabilidad opcional (GlitchTip/Sentry) — vacío = no-op
SENTRY_DSN=
```

Compilar, inicializar la base (idempotente: schema + seeds la primera vez) y probar:

```bash
npm run build
node build/exec/initDb.js    # "🏁 Provisión completa"
npm start                    # prueba manual: "🚀 Sistema Interno corriendo en puerto 3010" → Ctrl+C
```

### Servicio systemd

**`/etc/systemd/system/sistema-interno.service`**:

```ini
[Unit]
Description=Sistema Interno - Positive Media (backend)
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=<tu usuario>
WorkingDirectory=/opt/sistema-interno/backend
ExecStart=/usr/bin/env node --import ./instrument.mjs build/index.js
Restart=always
RestartSec=5
# El .env lo lee la app desde el WorkingDirectory (dotenv).

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sistema-interno
systemctl status sistema-interno            # activo y sin errores
journalctl -u sistema-interno -f            # logs en vivo
```

> Los adjuntos (tareas y fichas de empleados) viven en
> `/opt/sistema-interno/backend/storage/` y `public/storage/` — se crean solos, el
> usuario del servicio debe poder escribir ahí. Entran al esquema de backups (paso 8).

## 6. Frontend

Las variables `VITE_*` se inyectan en **build time**:

```bash
cd /opt/sistema-interno/frontend
npm ci
VITE_API_URL=https://sys.positivemedia.com.ar/api \
VITE_SOCKET_URL=https://sys.positivemedia.com.ar \
npm run build                # genera dist/ (SPA + service worker de la PWA)
```

## 7. nginx

**`/etc/nginx/sites-available/sistema-interno`** — un solo server block: la SPA en la
raíz, la API en `/api` y los WebSockets en `/socket.io`:

```nginx
server {
    listen 80;
    server_name sys.positivemedia.com.ar;

    # ── Frontend: SPA estática + PWA ──
    root /opt/sistema-interno/frontend/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # SPA: cualquier ruta desconocida cae al index (el router del frontend resuelve).
    location / {
        try_files $uri $uri/ /index.html;
    }

    # El service worker y el index NUNCA se cachean (si no, la PWA no se actualiza).
    location = /sw.js {
        add_header Cache-Control "no-cache";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    # Assets con hash en el nombre: cache largo.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # ── Backend: API ──
    # El backend ya sirve sus rutas bajo /api, así que se pasa la URI tal cual
    # (proxy_pass SIN path para no reescribir).
    location /api {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Adjuntos de hasta 15 MB (tareas y fichas): el default de 1 MB rompería los uploads.
        client_max_body_size 20m;
    }

    # ── WebSockets (Socket.IO: notificaciones en vivo) ──
    location /socket.io {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Conexiones de socket largas: que nginx no las corte a los 60s.
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sistema-interno /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# HTTPS: certbot configura el server block a 443 + redirección y renueva solo
# (systemd timer incluido).
sudo certbot --nginx -d sys.positivemedia.com.ar
```

Dar permiso de lectura del `dist/` al usuario `www-data` si el repo quedó con permisos
restrictivos (`chmod -R o+rX /opt/sistema-interno/frontend/dist` y `o+x` en los
directorios del camino).

## 8. Verificación

```bash
curl https://sys.positivemedia.com.ar/api          # → { "success": true, ... }
```

- App: `https://sys.positivemedia.com.ar` → login con `ADMINUSER`/`ADMINPASS` →
  **cambiar la contraseña** → crear usuarios y roles reales.
- Docs API: `https://sys.positivemedia.com.ar/api/docs`.
- PWA: desde el browser, "Instalar app".
- Realtime: la campana de notificaciones conecta (consola del browser sin errores de socket).

## 9. Backups

**`/opt/sistema-interno/backup.sh`**:

```bash
#!/bin/bash
# Backup diario: dump de la base + adjuntos. Retención 14 días.
set -e
DIR=/opt/backups/sistema-interno
mkdir -p "$DIR"
FECHA=$(date +%F)
# Credenciales en ~/.my.cnf del usuario del cron ([mysqldump] user/password) — no en el comando.
mysqldump --single-transaction sistema_interno | gzip > "$DIR/db-$FECHA.sql.gz"
tar czf "$DIR/storage-$FECHA.tar.gz" -C /opt/sistema-interno/backend storage public/storage 2>/dev/null || true
find "$DIR" -mtime +14 -delete
```

```bash
chmod +x /opt/sistema-interno/backup.sh
( crontab -l 2>/dev/null; echo '0 4 * * * /opt/sistema-interno/backup.sh >> /var/log/sistema-backup.log 2>&1' ) | crontab -
```

Idealmente copiar `/opt/backups` afuera de la VM (OCI Object Storage con `rclone`, u
otro destino) — un backup en el mismo disco no cubre la pérdida de la VM.

## 10. Actualizaciones

**`/opt/sistema-interno/deploy.sh`**:

```bash
#!/bin/bash
# Actualiza a la última versión del repo: backend recompilado + frontend rebuildeado.
set -e
cd /opt/sistema-interno
git pull

cd backend
npm ci
npm run build
sudo systemctl restart sistema-interno   # las migraciones corren solas al boot (AUTO_MIGRATE)

cd ../frontend
npm ci
VITE_API_URL=https://sys.positivemedia.com.ar/api \
VITE_SOCKET_URL=https://sys.positivemedia.com.ar \
npm run build

echo "✅ Deploy OK — $(git rev-parse --short HEAD)"
```

Rollback: `git checkout <commit anterior>` + `./deploy.sh` (sin el `git pull`).

## Build móvil (Capacitor)

La SPA ya es instalable como **PWA**. Para el APK/AAB nativo Android (en una máquina
con Android Studio, no en el VPS):

```bash
cd frontend
VITE_API_URL=https://sys.positivemedia.com.ar/api \
VITE_SOCKET_URL=https://sys.positivemedia.com.ar npm run build
npx cap add android      # una sola vez (genera android/)
npx cap sync android
npx cap open android     # Android Studio → Build APK/AAB
```

`appId`: `ar.com.positivemedia.sistemainterno`.

## Notas

- El scheduler (avisos diarios + GC de archivos huérfanos) corre dentro del proceso del
  backend: no hace falta cron para la app.
- Rate limits, lockout de login, helmet y saneado de HTML vienen activos por defecto;
  `JWT_SECRET` es fail-fast en producción.
- En shapes chicos conviene swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` (+ fstab).
- Endurecer SSH (opcional pero recomendado): `PasswordAuthentication no` + fail2ban.
- Docker sigue disponible como alternativa (`docker compose up -d --build`, ver
  [deployment.md](deployment.md)) pero NO es el camino elegido para este servidor.
