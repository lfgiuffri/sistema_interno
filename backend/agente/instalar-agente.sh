#!/usr/bin/env bash
#
# Instalador del agente de monitoreo del Sistema Interno.
#
# Uso (como root, en el servidor a monitorear):
#   curl -fsSL https://sys.positivemedia.com.ar/api/agente/instalar-agente.sh | \
#     API_URL=https://sys.positivemedia.com.ar/api AGENT_TOKEN=<token> bash
#
# Deja: el script en /usr/local/bin, la config en /etc (solo root), y un timer de systemd
# que lo corre cada minuto. Es idempotente: correrlo de nuevo actualiza y reinicia.
#
# Con FULLGLASS=1 instala ADEMÁS el worker de FullGlass (SQL masivo + deploy), con su propia
# unidad de systemd:
#   ... | API_URL=... AGENT_TOKEN=... FULLGLASS=1 bash
#
set -euo pipefail

: "${API_URL:?Falta API_URL (ej. https://sys.positivemedia.com.ar/api)}"
: "${AGENT_TOKEN:?Falta AGENT_TOKEN (se genera al dar de alta el servidor en la app)}"

[ "$(id -u)" -eq 0 ] || { echo "Hay que correrlo como root (sudo)."; exit 1; }
command -v curl >/dev/null || { echo "Falta curl: apt install -y curl"; exit 1; }

BIN=/usr/local/bin/agente-sistema-interno.sh
CONF=/etc/sistema-interno-agente.env

# 1. El script: se baja del mismo servidor que recibe las métricas.
curl -fsSL "${API_URL%/}/agente/agente-sistema-interno.sh" -o "$BIN"
chmod 755 "$BIN"

# 2. La config con el token: solo root puede leerla (es la credencial del servidor).
cat > "$CONF" <<EOF
API_URL=$API_URL
AGENT_TOKEN=$AGENT_TOKEN
EOF
chmod 600 "$CONF"

# 3. systemd: servicio one-shot + timer cada minuto. Se usa timer y no un demonio para que
#    un cuelgue del agente no deje un proceso zombie: cada corrida es independiente.
cat > /etc/systemd/system/sistema-interno-agente.service <<EOF
[Unit]
Description=Agente de monitoreo del Sistema Interno
After=network-online.target

[Service]
Type=oneshot
ExecStart=$BIN
# El agente solo lee /proc y /etc: sin privilegios extra ni escritura en el sistema.
ProtectSystem=strict
ProtectHome=true
# /tmp propio y descartable. Con ProtectSystem=strict el filesystem queda en SOLO LECTURA,
# así que sin esto cualquier archivo temporal —incluido el que bash necesita para un
# here-document— falla con «Read-only file system». El agente no lo usa, pero un /tmp
# escribible y aislado sale gratis y evita ese modo de falla.
PrivateTmp=true
NoNewPrivileges=true
EOF

cat > /etc/systemd/system/sistema-interno-agente.timer <<EOF
[Unit]
Description=Reporte de métricas al Sistema Interno (cada minuto)

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=5s
Unit=sistema-interno-agente.service

[Install]
WantedBy=timers.target
EOF

# ── 4. Worker de FullGlass (opcional) ────────────────────────────────────────────────────
#
# Va en una unidad APARTE y no dentro del agente de métricas a propósito. El agente corre con
# ProtectHome=true y el filesystem en solo lectura, y tiene que seguir así: es lo que corre
# cada minuto en todos los servidores. El worker necesita lo contrario —leer /home para
# encontrar los config_site.php y escribir para hacer un deploy—, así que esos permisos se le
# dan SOLO a él. Separarlos acota el daño: una falla del worker no toca al agente, y el agente
# sigue sin poder leer nada de /home.
if [ "${FULLGLASS:-0}" = "1" ]; then
    command -v php >/dev/null || { echo "Falta php (lo necesita el worker de FullGlass)"; exit 1; }

    WORKER=/usr/local/bin/sistema-interno-fullglass.php
    curl -fsSL "${API_URL%/}/agente/fullglass-worker.php" -o "$WORKER"
    chmod 700 "$WORKER"   # solo root: ejecuta SQL y comandos de deploy

    cat > /etc/systemd/system/sistema-interno-fullglass.service <<EOF
[Unit]
Description=Worker de FullGlass del Sistema Interno (SQL masivo y deploy)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env php $WORKER
# Sin ProtectHome ni ProtectSystem=strict: este worker SÍ necesita leer /home (los
# config_site.php de cada cliente) y escribir (el deploy). Es la contrapartida consciente de
# habilitar ejecución remota; por eso vive separado del agente de métricas, que no los tiene.
NoNewPrivileges=true
# Un deploy puede tardar: el timeout duro lo pone el propio worker (30 min).
TimeoutStartSec=2100
EOF

    cat > /etc/systemd/system/sistema-interno-fullglass.timer <<EOF
[Unit]
Description=Consulta de trabajos de FullGlass (cada 10 segundos)

[Timer]
OnBootSec=30
# Cada 10s: lanzar algo desde la app se tiene que sentir inmediato. Cuando no hay trabajo es
# una sola petición HTTPS que termina al instante, así que el costo es despreciable.
OnUnitActiveSec=10
AccuracySec=1s
Unit=sistema-interno-fullglass.service

[Install]
WantedBy=timers.target
EOF
    echo "   ✓ worker de FullGlass instalado"
fi

systemctl daemon-reload
systemctl enable --now sistema-interno-agente.timer
[ "${FULLGLASS:-0}" = "1" ] && systemctl enable --now sistema-interno-fullglass.timer

# 4. Prueba inmediata: si el token o la URL están mal, se ve acá y no dentro de una hora.
echo "── Probando el primer reporte…"
if systemctl start sistema-interno-agente.service; then
    systemctl status sistema-interno-agente.service --no-pager -n 5 || true
    echo "✅ Agente instalado. Reporta cada minuto (journalctl -u sistema-interno-agente)."
else
    echo "❌ El primer reporte falló. Revisá: journalctl -u sistema-interno-agente -n 20"
    exit 1
fi
