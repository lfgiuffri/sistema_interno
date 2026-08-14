# Sistema Interno — Backend (Node ESM · Express 5 · Sequelize · BullMQ).
# Multi-stage: la imagen final solo lleva el código compilado + deps de producción.

# ── Stage 1: build (compila src/ → build/ con Babel) ──────────────────────────
FROM node:22-slim AS build
WORKDIR /app
# Instalamos TODAS las deps (incluye Babel) para poder compilar.
# --include=dev fuerza las devDependencies aunque NODE_ENV=production llegue como
# build arg (p.ej. Coolify inyecta las env vars también en build): sin esto, npm ci
# omitiría Babel y `npm run build` fallaría con "babel: not found".
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ── Stage 2: runtime (solo deps de producción + build) ────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Solo deps de producción (el build keepea ESM: package.json tiene "type":"module").
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Código compilado (incluye los seeds JSON de exec/data: el build usa `babel --copy-files`,
# y loadJSONData/los módulos resuelven sus rutas relativas a build/, no al cwd).
COPY --from=build /app/build ./build
# Instrumentación de observabilidad (opt-in por SENTRY_DSN; ver instrument.mjs). Se carga con
# `node --import` desde el entrypoint, por eso va al root del runtime (no pasa por Babel).
COPY instrument.mjs ./
# Entrypoint: corre init idempotente y luego arranca el server.
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3010
ENTRYPOINT ["./docker-entrypoint.sh"]
