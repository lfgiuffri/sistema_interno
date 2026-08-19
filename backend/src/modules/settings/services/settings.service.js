/**
 * Sistema Interno — Lógica de UserSettings (preferencias del usuario).
 *
 * Service layer del módulo settings (patrón controller-helper): el controller queda fino y la
 * lógica de datos vive acá, testeable sin req/res. `settings` es INFRA — siempre disponible, no
 * se gatea por plan — por eso NO tiene manifest y se monta explícito en routes.js (no vía el
 * moduleLoader, que gatea por plan).
 */

/**
 * Obtiene las preferencias del usuario; las crea con defaults si no existen (lazy-create).
 * @param {object} models - Modelos del tenant (req.models).
 * @param {number} userId - Id del usuario.
 * @returns {Promise<object>} El registro UserSettings.
 */
export const getOrCreateSettings = async (models, userId) => {
    let settings = await models.UserSettings.findOne({ where: { userId } });
    if (!settings) settings = await models.UserSettings.create({ userId });
    return settings;
};

/**
 * Actualiza (o crea) las preferencias del usuario con los campos ya validados.
 * @param {object} models - Modelos del tenant.
 * @param {number} userId - Id del usuario.
 * @param {object} patch - Campos validados a aplicar.
 * @returns {Promise<object>} El registro actualizado.
 */
export const applySettingsUpdate = async (models, userId, patch) => {
    let settings = await models.UserSettings.findOne({ where: { userId } });
    if (!settings) settings = await models.UserSettings.create({ ...patch, userId });
    else await settings.update(patch);
    return settings;
};

/**
 * Registra/actualiza el push token del dispositivo y habilita las notificaciones.
 * @param {object} models - Modelos del tenant.
 * @param {number} userId - Id del usuario.
 * @param {string} token - Push token del dispositivo.
 * @returns {Promise<object>} El registro actualizado.
 */
export const setPushToken = async (models, userId, token) => {
    let settings = await models.UserSettings.findOne({ where: { userId } });
    if (!settings) settings = await models.UserSettings.create({ userId, pushToken: token, pushEnabled: true });
    else await settings.update({ pushToken: token, pushEnabled: true });
    return settings;
};

/**
 * Envía una notificación push de prueba al token registrado del usuario.
 * Devuelve un resultado discriminado para que el controller mapee el caso "sin token" a 400.
 * @param {object} models - Modelos del tenant.
 * @param {number} userId - Id del usuario.
 * @param {string} appName - Nombre de la app (para el título de la notificación).
 * @returns {Promise<{ok: boolean, reason?: string, result?: object}>} `ok:false`/`reason:'no-token'` si no hay token.
 */
export const sendTestNotification = async (models, userId, appName) => {
    const titulo = `🔔 ${appName}`;
    const cuerpo = 'Las notificaciones están funcionando correctamente.';

    // Los dos caminos conviven y son para destinos distintos: Web Push llega al NAVEGADOR
    // (Chrome, Edge, Firefox) y FCM a la app NATIVA de Android. Se prueban los dos y alcanza
    // con que uno funcione: si el usuario está en Chrome, no tiene ni va a tener token de FCM.
    const { enviarWebPush } = await import('../../../services/push/services/webpush.service.js');
    const web = await enviarWebPush(models, userId, { titulo, cuerpo, url: '/panel', tag: 'prueba' });

    const settings = await models.UserSettings.findOne({ where: { userId } });
    let nativa = null;
    if (settings?.pushToken) {
        const { sendPushNotification } = await import('../../../services/push/services/push.service.js');
        nativa = await sendPushNotification(settings.pushToken, titulo, cuerpo);
    }

    if (web.enviadas || nativa) return { ok: true, result: { navegador: web, nativa } };

    // Nada que enviar: se dice POR QUÉ, que es lo único accionable para el usuario.
    const motivo = web.eliminadas
        ? 'La suscripción de este navegador ya no es válida. Activá de nuevo las notificaciones.'
        : 'Este dispositivo no está registrado para recibir notificaciones. Activalas en Configuración → Notificaciones.';
    return { ok: false, reason: 'sin-destino', motivo };
};
