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
        return notificacion;
    } catch {
        return null;
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
