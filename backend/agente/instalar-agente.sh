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
PrivateTmp=false
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

systemctl daemon-reload
systemctl enable --now sistema-interno-agente.timer

# 4. Prueba inmediata: si el token o la URL están mal, se ve acá y no dentro de una hora.
echo "── Probando el primer reporte…"
if systemctl start sistema-interno-agente.service; then
    systemctl status sistema-interno-agente.service --no-pager -n 5 || true
    echo "✅ Agente instalado. Reporta cada minuto (journalctl -u sistema-interno-agente)."
else
    echo "❌ El primer reporte falló. Revisá: journalctl -u sistema-interno-agente -n 20"
    exit 1
fi
