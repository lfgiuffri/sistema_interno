/**
 * Sistema Interno — Protección de fuerza bruta en el login (lockout por ventana deslizante).
 *
 * Regla (heredada del sistema legado, endurecida contra DoS dirigido):
 *  - 5 fallos en 15 min para el par (username + IP) → bloqueo de ese par.
 *  - 15 fallos en 15 min desde una misma IP (cualquier usuario) → bloqueo de la IP.
 *  El username solo NUNCA bloquea por sí mismo: así un tercero no puede dejar afuera a un
 *  usuario legítimo tirando fallos contra su email desde otra red.
 *  Un login exitoso limpia los fallos previos de ese usuario/IP.
 */

import { Op } from 'sequelize';

/** Fallos permitidos para el par usuario+IP dentro de la ventana. */
const MAX_FAILS_PAIR = 5;
/** Fallos permitidos para una IP (cualquier usuario) dentro de la ventana. */
const MAX_FAILS_IP = 15;
/** Ventana de conteo/bloqueo en segundos (15 minutos). */
const WINDOW_SECONDS = 15 * 60;

/**
 * Segundos de bloqueo restantes para un intento de login. 0 = no bloqueado.
 * El bloqueo dura hasta que el fallo más viejo de la serie sale de la ventana.
 * @param {object} models - Modelos de la app (LoginAttempt).
 * @param {string} username - Username/email intentado.
 * @param {string} ip - IP del cliente.
 * @returns {Promise<number>} Segundos restantes de bloqueo (0 si puede intentar).
 */
export const lockoutSecondsRemaining = async (models, username, ip) => {
    const { LoginAttempt } = models;
    if (!LoginAttempt) return 0; // sin tabla no hay lockout (degradación segura para tests)

    const since = new Date(Date.now() - WINDOW_SECONDS * 1000);

    /**
     * Calcula los segundos restantes si los fallos que matchean `where` alcanzan el tope.
     * @param {object} where - Condición de conteo.
     * @param {number} max - Tope de fallos permitido.
     * @returns {Promise<number>} Segundos restantes (0 si no llegó al tope).
     */
    const remainingFor = async (where, max) => {
        const rows = await LoginAttempt.findAll({
            where: { ...where, success: false, createdAt: { [Op.gt]: since } },
            attributes: ['createdAt'],
            order: [['createdAt', 'ASC']]
        });
        if (rows.length < max) return 0;
        const oldest = rows[0].createdAt.getTime();
        const remaining = Math.ceil((oldest + WINDOW_SECONDS * 1000 - Date.now()) / 1000);
        return remaining > 0 ? remaining : 0;
    };

    const pair = await remainingFor({ username, ip }, MAX_FAILS_PAIR);
    if (pair > 0) return pair;
    return remainingFor({ ip }, MAX_FAILS_IP);
};

/**
 * Registra un intento de login. Un éxito limpia los fallos previos del usuario y de la IP
 * (así el contador no arrastra ruido viejo). Best-effort: un fallo acá no rompe el login.
 * @param {object} models - Modelos de la app (LoginAttempt).
 * @param {string} username - Username/email intentado (se trunca a 160).
 * @param {string} ip - IP del cliente.
 * @param {boolean} success - Si el intento fue exitoso.
 * @returns {Promise<void>}
 */
export const registerLoginAttempt = async (models, username, ip, success) => {
    const { LoginAttempt } = models;
    if (!LoginAttempt) return;
    try {
        await LoginAttempt.create({ username: String(username).slice(0, 160), ip, success });
        if (success) {
            await LoginAttempt.destroy({
                where: { success: false, [Op.or]: [{ username }, { ip }] },
                force: true // bitácora de fallos ya saldada: borrado físico intencional
            });
        }
    } catch (error) {
        console.error('⚠️ [LOCKOUT] No se pudo registrar el intento de login:', error.message);
    }
};
