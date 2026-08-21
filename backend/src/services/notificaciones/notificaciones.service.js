/**
 * Notificaciones in-app (mejora §10.1): creación + entrega realtime.
 * Los módulos las emiten vía `crearNotificacion` (exportada por el barrel del kernel);
 * el frontend las recibe por socket (`notificacion` → room user:<id>) y las lista/marca
 * desde /notificaciones (rutas personales, sin capability — como /me).
 */

/**
 * Crea una notificación para un usuario y la empuja por el socket si está conectado.
 * Nunca tira: una notificación fallida no debe romper la mutación que la originó.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO (req.io) o null.
 * @param {object} data - { userId, tipo, titulo, cuerpo?, url? }.
 * @returns {Promise<object|null>} La notificación creada o null si falló.
 */
export const crearNotificacion = async (models, io, data) => {
    try {
        if (!models.Notificacion || !data.userId) return null;
        const notificacion = await models.Notificacion.create({
            userId: data.userId,
            tipo: data.tipo,
            titulo: String(data.titulo).slice(0, 150),
            cuerpo: data.cuerpo ? String(data.cuerpo).slice(0, 255) : null,
            url: data.url ? String(data.url).slice(0, 255) : null
        });
        if (io) io.to(`user:${data.userId}`).emit('notificacion', notificacion.toJSON());

        // El socket solo llega si la app está ABIERTA. Para que el aviso llegue igual con la
        // pestaña cerrada va también por Web Push. Se hace acá, en el único punto por el que
        // pasan TODAS las notificaciones, y no en cada módulo: así ninguno se olvida.
        // Sin await a propósito: el envío sale por HTTPS a un servicio externo y la mutación
        // que originó el aviso no tiene por qué esperarlo.
        void enviarPushNavegador(models, notificacion);

        return notificacion;
    } catch {
        return null;
    }
};

/**
 * Manda la notificación al navegador del usuario, respetando sus preferencias.
 *
 * Nunca tira: si falla el push, la notificación ya quedó guardada y en la campana. Un canal
 * caído no puede romper el que sí funciona.
 * @param {object} models - Modelos de la app.
 * @param {object} notificacion - La notificación recién creada.
 * @returns {Promise<void>}
 */
const enviarPushNavegador = async (models, notificacion) => {
    try {
        if (!models.PushSubscription) return;

        const settings = await models.UserSettings?.findOne({ where: { userId: notificacion.userId } });
        // Mismas reglas que el push nativo: si apagó las notificaciones, activó «no molestar»
        // o está en su horario silencioso, la campana igual queda — pero no se le vibra el
        // teléfono a las 3 de la mañana.
        if (settings) {
            const { isQuietHours } = await import('../push/services/push.service.js');
            if (settings.pushEnabled === false) return;
            if (settings.doNotDisturbEnabled) return;
            if (isQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) return;
        }

        const { enviarWebPush } = await import('../push/services/webpush.service.js');
        await enviarWebPush(models, notificacion.userId, {
            titulo: notificacion.titulo,
            cuerpo: notificacion.cuerpo || '',
            url: notificacion.url || '/',
            tag: notificacion.tipo,
        });
    } catch (e) {
        // No se propaga (la notificación ya está guardada), pero SÍ se registra: un catch mudo
        // acá significa que las notificaciones dejan de llegar sin que nadie se entere.
        console.warn('⚠️ [PUSH] no se pudo notificar al navegador:', String(e?.message).slice(0, 140));
    }
};

/**
 * Lista las notificaciones del usuario (más nuevas primero) + conteo de no leídas.
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Usuario.
 * @param {number} [limit] - Máximo (default 30).
 * @returns {Promise<{rows: object[], noLeidas: number}>}
 */
export const listNotificaciones = async (models, userId, limit = 30) => {
    const { Notificacion } = models;
    const [rows, noLeidas] = await Promise.all([
        Notificacion.findAll({
            where: { userId },
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            limit: Math.min(Math.max(Number(limit) || 30, 1), 100)
        }),
        Notificacion.count({ where: { userId, leidaAt: null } })
    ]);
    return { rows, noLeidas };
};

/**
 * Marca notificaciones como leídas (todas las del usuario, o solo `ids`).
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Usuario (scope duro: solo las propias).
 * @param {number[]|null} [ids] - Ids puntuales o null = todas.
 * @returns {Promise<number>} Cantidad marcada.
 */
export const marcarLeidas = async (models, userId, ids = null) => {
    const where = { userId, leidaAt: null };
    if (Array.isArray(ids) && ids.length) where.id = ids.map(Number);
    const [n] = await models.Notificacion.update({ leidaAt: new Date() }, { where });
    return n;
};
