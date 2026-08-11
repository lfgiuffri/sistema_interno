#!/bin/sh
# Entrypoint del backend en Docker: inicializa la base (idempotente — CREATE IF NOT
# EXISTS, sync alter, seeds condicionales) y luego arranca el servidor. Reintenta la init por si
# la DB tarda un instante más en aceptar conexiones (además del depends_on:service_healthy).
set -e

echo "🔧 [entrypoint] Inicializando base de datos (idempotente)..."
n=0
until node build/exec/initDb.js; do
  n=$((n + 1))
  if [ "$n" -ge 10 ]; then
    echo "❌ [entrypoint] init_db falló tras $n intentos. Abortando."
    exit 1
  fi
  echo "⏳ [entrypoint] DB no lista todavía, reintento $n/10 en 3s..."
  sleep 3
done

echo "🚀 [entrypoint] Arrancando Sistema Interno..."
# --import carga la instrumentación (Sentry/GlitchTip) ANTES de la app. No-op si no hay SENTRY_DSN.
exec node --import ./instrument.mjs build/index.js
