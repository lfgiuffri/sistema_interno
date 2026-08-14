/**
 * Sistema Interno — Instrumentación de observabilidad (compatible con Sentry Cloud o GlitchTip self-hosted).
 *
 * OPT-IN: si `SENTRY_DSN` está vacío no se inicializa nada y el SDK queda no-op — dev/e2e y los
 * despliegues sin observabilidad (o "sin GlitchTip") no se ven afectados en absoluto.
 *
 * En ESM, `Sentry.init()` debe correr ANTES de que se importe el resto de la app (auto-instrumenta
 * Express/HTTP/DB al cargarlas). Por eso este archivo se carga con el flag `--import`:
 *   node --import ./instrument.mjs build/index.js
 * (ver `docker-entrypoint.sh` y el script `start` de package.json).
 */
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Tracing apagado por defecto (solo errores). Subilo con SENTRY_TRACES_SAMPLE_RATE si querés performance.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
  console.log('🛰️  [observabilidad] Sentry/GlitchTip inicializado');
}
