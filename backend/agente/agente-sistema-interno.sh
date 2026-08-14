#!/usr/bin/env bash
#
# Agente de monitoreo del Sistema Interno.
#
# Lee CPU, RAM y disco del propio servidor y los reporta a la API. No abre ningún puerto:
# solo hace una petición HTTPS saliente, así que no hay superficie de ataque nueva en el VPS.
# Se autentica con el token del servidor (uno por servidor, se genera desde la app).
#
# Dependencias: bash, curl y coreutils. Nada más — funciona en cualquier Linux con systemd.
# Configuración: /etc/sistema-interno-agente.env  (API_URL y AGENT_TOKEN)
#
set -uo pipefail

CONFIG="${AGENTE_CONFIG:-/etc/sistema-interno-agente.env}"
[ -r "$CONFIG" ] && . "$CONFIG"

: "${API_URL:?falta API_URL en $CONFIG}"
: "${AGENT_TOKEN:?falta AGENT_TOKEN en $CONFIG}"

# ── CPU ──────────────────────────────────────────────────────────────────────────────
# Se mide con DOS muestras de /proc/stat separadas 1s: el porcentaje instantáneo es
# (tiempo no ocioso / tiempo total) en ese intervalo. Leer una sola vez daría el promedio
# desde que arrancó la máquina, que no sirve para alertar.
leer_cpu() {
    local a b idle_a idle_b total_a total_b
    a=($(grep '^cpu ' /proc/stat)); sleep 1; b=($(grep '^cpu ' /proc/stat))
    idle_a=$(( ${a[4]} + ${a[5]} )); idle_b=$(( ${b[4]} + ${b[5]} ))
    total_a=0; for v in "${a[@]:1}"; do total_a=$(( total_a + v )); done
    total_b=0; for v in "${b[@]:1}"; do total_b=$(( total_b + v )); done
    local dt=$(( total_b - total_a )) di=$(( idle_b - idle_a ))
    [ "$dt" -le 0 ] && { echo "0.0"; return; }
    awk -v dt="$dt" -v di="$di" 'BEGIN { printf "%.1f", (dt - di) * 100 / dt }'
}

# ── RAM ──────────────────────────────────────────────────────────────────────────────
# MemAvailable (no MemFree): es lo que el kernel puede entregar de verdad, descontando
# caché reclamable. Usar MemFree daría 95% de uso en cualquier servidor sano.
leer_ram() {
    awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END { if (t>0) printf "%.1f", (t-a)*100/t; else print "0.0" }' /proc/meminfo
}

# ── Discos ───────────────────────────────────────────────────────────────────────────
# Solo sistemas de archivos reales (se excluyen tmpfs, overlay de contenedores, etc.).
# Devuelve el JSON del detalle por montaje; el % que alerta es el del montaje más lleno.
leer_discos() {
    df -P -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR>1 {
        gsub(/%/, "", $5);
        printf "%s{\"montaje\":\"%s\",\"uso\":%s,\"libreGb\":%.2f}", (c++ ? "," : ""), $6, $5, $4/1073741824
    }'
}
disco_max() {
    df -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR>1 { gsub(/%/,"",$5); if ($5+0 > m) m=$5+0 } END { printf "%.1f", m }'
}

CPU=$(leer_cpu)
RAM=$(leer_ram)
DISCO=$(disco_max)
DISCOS=$(leer_discos)
CARGA=$(awk '{printf "%.2f", $1}' /proc/loadavg)
UPTIME=$(awk '{printf "%d", $1}' /proc/uptime)
SO=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr )
# El nombre del SO se mete crudo en el JSON: se le sacan comillas y barras por las dudas.
SO=${SO//\\/}; SO=${SO//\"/}

# ⚠️ NADA de archivos temporales de acá en adelante.
#
# El servicio corre con `ProtectSystem=strict`, así que el filesystem está en solo lectura.
# Un here-document (`<<JSON`) NO sirve: bash lo materializa en un archivo temporal y falla con
# «cannot create temp file for here-document». Por eso el JSON se arma en una variable, y la
# respuesta de curl se captura en memoria en vez de con `-o archivo`.
PAYLOAD='{"cpu":'"$CPU"',"ram":'"$RAM"',"disco":'"$DISCO"',"discos":['"$DISCOS"'],"carga1":'"$CARGA"',"uptimeSeg":'"$UPTIME"',"so":"'"$SO"'"}'

# `-w '\n%{http_code}'` agrega el código en la última línea del cuerpo: con eso alcanza para
# distinguir éxito de error sin escribir nada al disco. `2>&1` trae el mensaje de curl (DNS,
# TLS, timeout) al mismo lugar. --max-time: si la app no responde, el agente no se cuelga
# ocupando el timer.
SALIDA=$(curl -sS --max-time 20 -w '\n%{http_code}' \
    -X POST "${API_URL%/}/agente/metricas" \
    -H 'Content-Type: application/json' \
    -H "x-agent-token: $AGENT_TOKEN" \
    --data "$PAYLOAD" 2>&1)

CODIGO=${SALIDA##*$'\n'}     # última línea = %{http_code}
CUERPO=${SALIDA%$'\n'*}      # todo lo anterior = cuerpo o error de curl

if [ "$CODIGO" = "200" ]; then
    echo "ok cpu=${CPU}% ram=${RAM}% disco=${DISCO}%"
else
    # Código 000 = curl no llegó a hablar con el servidor (DNS, red, TLS): el motivo está
    # en el cuerpo.
    echo "ERROR HTTP ${CODIGO:-sin-respuesta} — $(printf '%.200s' "$CUERPO")" >&2
    exit 1
fi
