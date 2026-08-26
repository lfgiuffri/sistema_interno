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

> 📁 **La ruta `/opt/sistema-interno` de este runbook es un EJEMPLO.** Si instalás en otro
> lado (ej. `/srv/miapp/sistema_interno`), hay que cambiarla en los CUATRO lugares que la
> referencian, o el deploy queda a medias: el `root` del server block de nginx, el
> `WorkingDirectory`/`ExecStart` del servicio systemd, `backup.sh` y `deploy.sh`.
> Para verificarlo: `grep -rn "/opt/sistema-interno" /etc/nginx/sites-available/ /etc/systemd/system/sistema-interno.service`.

## 4. MySQL: base y usuario dedicado

⚠️ **El usuario va creado para `127.0.0.1`, no solo para `localhost`.** Para MySQL son hosts
DISTINTOS: `localhost` matchea conexiones por socket unix (o por TCP si el server resuelve el
nombre), y el driver de Node **siempre conecta por TCP a 127.0.0.1**. Si solo existe
`'sistema'@'localhost'`, el arranque falla con:

```
Error inicializando la base de datos: (conn:-1, no: 1130, SQLState: HY000)
Host '127.0.0.1' is not allowed to connect to this MySQL server
```

Se crea para los dos hosts y listo (el de socket sirve para entrar con el cliente `mysql`):

```sql
-- sudo mysql
CREATE DATABASE IF NOT EXISTS sistema_interno CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'sistema'@'127.0.0.1' IDENTIFIED BY '<password fuerte>';
CREATE USER IF NOT EXISTS 'sistema'@'localhost' IDENTIFIED BY '<password fuerte>';
GRANT ALL PRIVILEGES ON sistema_interno.* TO 'sistema'@'127.0.0.1';
GRANT ALL PRIVILEGES ON sistema_interno.* TO 'sistema'@'localhost';
FLUSH PRIVILEGES;

-- Verificación: tienen que aparecer las dos filas.
SELECT user, host FROM mysql.user WHERE user = 'sistema';
```

Nunca `'sistema'@'%'`: abriría el usuario a cualquier origen. El puerto 3306 igual no se
expone (ver Security List), pero el grant es la última línea de defensa.

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
curl https://sys.positivemedia.com.ar/api/health   # → { "ok": true, "baseMs": 2, ... }
```

- App: `https://sys.positivemedia.com.ar` → login con `ADMINUSER`/`ADMINPASS` →
  **cambiar la contraseña** → crear usuarios y roles reales.
- Docs API: `https://sys.positivemedia.com.ar/api/docs`.
- PWA: desde el browser, "Instalar app".
- Realtime: la campana de notificaciones conecta (consola del browser sin errores de socket).

### Si el backend no arranca

| Síntoma en `journalctl -u sistema-interno -n 50` | Causa y arreglo |
|---|---|
| `no: 1130 ... Host '127.0.0.1' is not allowed to connect` | El usuario MySQL existe solo para otro host (típicamente `'sistema'@'localhost'`). Crear el grant para `127.0.0.1` (paso 4). Diagnóstico: `sudo mysql -e "SELECT user,host FROM mysql.user WHERE user='sistema'"`. |
| `no: 1045 ... Access denied for user 'sistema'@'127.0.0.1'` | El host SÍ está permitido pero la contraseña no coincide: `ALTER USER 'sistema'@'127.0.0.1' IDENTIFIED BY '<password>'` y revisar `DB_PASS` del `.env`. |
| `no: 1049 ... Unknown database` | Falta crear la base (paso 4) o `DB_NAME` no coincide. |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL no está corriendo (`systemctl status mysql`) o escucha en otra interfaz (`bind-address` en `/etc/mysql/mysql.conf.d/mysqld.cnf` debe incluir `127.0.0.1`). |
| `no: 45044 ... RSA public key is not available client side` (`ER_CANNOT_RETRIEVE_RSA_KEY`) | El `.env` quedó con `DBDRIVER=mariadb` (el default de `.env.example`) pero **el servidor es MySQL 8**, que autentica con `caching_sha2_password`; el conector de MariaDB no pide la clave RSA y aborta. Ojo: **no falla al arrancar** — mientras MySQL tenga al usuario en cache anda por el camino rápido, y explota más tarde (al reiniciar MySQL, con `FLUSH PRIVILEGES` o al cambiar la contraseña), así que parece un problema nuevo. Arreglo: `DBDRIVER=mysql` en el `.env` + `sudo systemctl restart sistema-interno`. El backend avisa el cruce al boot con `⚠️ [DB] DBDRIVER=...`. |
| `JWT_SECRET` | En producción el backend NO arranca sin `JWT_SECRET` en el `.env`. |

Después de tocar grants: `FLUSH PRIVILEGES` y `sudo systemctl restart sistema-interno`.

### Si la app da 403 / 404 en el navegador

El log de nginx dice exactamente cuál de los dos casos es:
`sudo tail -20 /var/log/nginx/error.log`.

| Línea en el error.log | Causa y arreglo |
|---|---|
| `directory index of "/opt/sistema-interno/frontend/dist/" is forbidden` | La carpeta existe pero **no tiene `index.html`**: falta compilar el frontend (paso 6) o el build falló. `ls /opt/sistema-interno/frontend/dist/index.html` y re-correr el build. |
| `Permission denied` / `open() ... failed (13)` | nginx (usuario `www-data`) no puede leer el `dist/`. Necesita **`x` en todo el camino** y `r` en los archivos: `sudo chmod o+X /opt /opt/sistema-interno /opt/sistema-interno/frontend /opt/sistema-interno/frontend/dist && sudo chmod -R o+rX /opt/sistema-interno/frontend/dist`. |
| `No such file or directory` (404 en vez de 403) | El `root` del server block no apunta a la carpeta real del build. |

Ojo con el ORDEN del runbook: nginx (paso 7) asume que el frontend ya está compilado
(paso 6). Si se configura nginx antes de compilar, la raíz da 403.

## Watchdog externo

El módulo de Mantenimiento vigila los servidores y los sitios **desde adentro** de esta app. Falta lo obvio: **quién vigila a esta app**. Si el VPS se cae, se cae el monitoreo con él y nadie avisa.

Para eso está el endpoint público de salud, que responde **200** solo si el backend y su base están vivos, y **503** si la base no responde:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://sys.positivemedia.com.ar/api/health
```

Elegí **una** de estas dos opciones (no hacen falta las dos):

**A. Servicio de uptime (recomendado).** UptimeRobot, BetterStack o similar, plan gratis: monitor HTTP cada 5 minutos contra `/api/health`, alerta por mail y/o Telegram cuando el status no sea 200. Es **infraestructura ajena**: sigue avisando aunque se caiga todo lo nuestro, incluida la conexión del VPS. Cinco minutos de configuración y cero mantenimiento.

**B. Cron en otra máquina** (otro VPS, una PC de la oficina que quede prendida). Sirve si preferís no depender de un tercero, pero **la máquina que corre el cron pasa a ser el punto ciego**:

```bash
#!/bin/bash
# /usr/local/bin/watchdog-sistema-interno.sh — cron: */5 * * * *
URL="https://sys.positivemedia.com.ar/api/health"
MARCA="/tmp/.watchdog-sistema-interno"

codigo=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$URL")
if [ "$codigo" = "200" ]; then
  # Se recuperó: avisar una sola vez y limpiar la marca.
  [ -f "$MARCA" ] && echo "Sistema Interno volvió a responder" | mail -s "OK: Sistema Interno" vos@positivemedia.com.ar
  rm -f "$MARCA"
else
  # Anti-spam: se avisa al detectarlo, no en cada corrida.
  [ -f "$MARCA" ] || echo "Sistema Interno no responde (HTTP $codigo)" | mail -s "ALERTA: Sistema Interno caído" vos@positivemedia.com.ar
  touch "$MARCA"
fi
```

> El chequeo **no** debe apuntar a `https://sys.positivemedia.com.ar/` a secas: eso es el frontend estático, que nginx sigue sirviendo aunque el backend esté muerto. Un 200 ahí no prueba nada.

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
