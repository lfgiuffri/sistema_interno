/**
 * Sistema Interno — Router principal (single-tenant).
 *
 * No hay rutas master ni identificación de tenant: la conexión y los modelos son singletons
 * (dbContext los inyecta por request). Las rutas de infra (auth, users, roles, settings, me)
 * se montan explícitas; los MÓDULOS FEATURE se autodescubren por manifest y se montan
 * detrás de verifyAccessToken, con requireCapability por ruta dentro de cada módulo.
 *
 * Cadena por request:
 *   dbContext → actionTracking → [verifyAccessToken → requireCapability(por ruta)]
 */

import { Router } from 'express';
import { dbContext, actionTrackingMidd, authRateLimit, verifyAccessToken } from './middlewares/index.js';
import { loadModules, mountModuleManifests } from './kernel/moduleLoader.js';

// ─── INFRA (rutas explícitas) ───────────────────────────────────────────────
import authRoute from './kernel/users/routes/auth.routes.js';
import rolesRoute from './kernel/users/routes/roles.routes.js';
import usersRoute from './kernel/users/routes/users.routes.js';
import settingsRoutes from './modules/settings/routes/settings.routes.js';
import appConfigRoutes from './kernel/registry/routes/appConfig.routes.js';
import webhooksRoutes from './services/webhooks/routes/webhooks.routes.js';
import notificationActionsRoutes from './services/notifications/routes/notificationActions.routes.js';
import meRoutes from './services/me/me.routes.js';
import notificacionesRoutes from './services/notificaciones/notificaciones.routes.js';
import agenteRoutes from './modules/mantenimiento/routes/agente.routes.js';
import healthRoutes from './kernel/registry/routes/health.routes.js';

const router = Router();

// Contexto de base de datos + auditoría para TODO.
router.use(dbContext);
router.use(actionTrackingMidd);

// SALUD: público y sin sesión — lo consulta el watchdog externo que vigila que esta app
// (y con ella todo el monitoreo) siga viva. Ver docs/modules/mantenimiento.md.
router.use('/health', healthRoutes);

// AUTH (con rate limit propio, sin verifyAccessToken: signin/refresh son públicas).
router.use('/auth', authRateLimit, authRoute);

// USERS / ROLES (capability-based: requireCapability por ruta dentro de cada router).
router.use('/users/roles', verifyAccessToken, rolesRoute);
router.use('/users', verifyAccessToken, usersRoute);

// SETTINGS (preferencias del usuario).
router.use('/settings', verifyAccessToken, settingsRoutes);

// CONFIGURACIÓN de negocio (cotización del dólar, redondeos, avisos).
router.use('/app-config', verifyAccessToken, appConfigRoutes);

// WEBHOOKS salientes (capability 'webhooks:manage' por ruta).
router.use('/webhooks', verifyAccessToken, webhooksRoutes);

// Acciones de notificación (botones de push/in-app registrados por los módulos).
router.use('/notification-actions', verifyAccessToken, notificationActionsRoutes);

// CONTEXTO de sesión para la UI permission-aware (user + módulos + capabilities).
router.use('/me', verifyAccessToken, meRoutes);
// Notificaciones personales: sin capability (scope duro por userId), como /me.
router.use('/notificaciones', verifyAccessToken, notificacionesRoutes);

// AGENTE de monitoreo: lo llama una máquina, no una sesión. Se autentica con el token del
// servidor (`x-agent-token`) que valida el service, así que va FUERA de verifyAccessToken
// (mismo criterio que /auth). Tiene rate limit propio.
router.use('/agente', agenteRoutes);

/**
 * Descubre y monta los MÓDULOS FEATURE (los que tienen module.manifest.js) sobre el router.
 * Se invoca desde index.js ANTES de listen(). El gating fino lo aplica requireCapability
 * (por ruta, dentro de cada módulo); no hay gating por plan (single-tenant, sin planes).
 * @returns {Promise<void>}
 */
export const mountFeatureModules = async () => {
    await loadModules();
    mountModuleManifests(router, [verifyAccessToken]);
};

export default router;
