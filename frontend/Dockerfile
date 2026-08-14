# Sistema Interno — Frontend (Vue 3 · Ionic · Vite). Build estático servido por nginx.
# Las URLs del backend se inyectan en BUILD time (Vite inlinea import.meta.env.VITE_*),
# por eso van como ARG: el browser del usuario las usa para hablar con el backend.

# ── Stage 1: build (Vite → dist/) ─────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# URLs del backend visibles desde el browser (no desde la red interna de Docker).
ARG VITE_API_URL=http://localhost:3010/api
ARG VITE_SOCKET_URL=http://localhost:3010
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
# Observabilidad opt-in (Sentry/GlitchTip). Vacío = no-op; se hornea en build (Vite inlinea VITE_*).
ARG VITE_SENTRY_DSN=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN npm run build

# ── Stage 2: nginx sirve el estático ──────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
