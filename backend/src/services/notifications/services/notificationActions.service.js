/**
 * Sistema Interno — Acciones de notificación firmadas (genérico, sin dominio).
 *
 * Permite que un push / quick-reply ejecute una acción en el backend sin sesión
 * interactiva: se firma un token (JWT con scope acotado) que viaja en la notificación
 * y, al tocar el botón, se verifica y se despacha la acción.
 *
 * El despacho es pluggable: cada módulo registra handlers vía registerNotificationAction
 * (kernel/handlerRegistry.js). Este servicio solo se ocupa de firmar, verificar, garantizar
 * idempotencia y rutear al handler que matchee. No conoce ninguna entidad de dominio.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getModels } from '../../../database.js';
import { getNotificationActionHandlers } from '../../../kernel/handlerRegistry.js';

/** Scope fijo del token: evita reutilizar tokens de auth normales como acciones. */
const TOKEN_SCOPE = 'notification-action';

/** Cache de resultados por `jti` para idempotencia (mismo token tocado dos veces). */
const processedActions = new Map();

/**
 * Secreto usado para firmar/verificar tokens de acción.
 * @returns {string|undefined} El secreto configurado (o undefined si falta).
 */
const getSecret = () => process.env.NOTIFICATION_ACTION_SECRET || process.env.JWT_SECRET;

/**
 * Firma un token de acción de notificación.
 * @param {object} params - Datos de la acción.
 * @param {number} params.userId - Usuario destinatario.
 * @param {string} params.value - Valor de la acción (ej. "items:archive:42"); lo interpreta el handler.
 * @param {string} [params.actionId] - ID lógico del botón (opcional).
 * @param {string} [params.type] - Tipo/categoría (opcional, informativo).
 * @returns {string|null} El JWT firmado, o null si no hay secreto configurado.
 */
export const signNotificationActionToken = ({ userId, value, actionId, type }) => {
    const secret = getSecret();
    if (!secret) return null; // Sin secreto no firmamos (push sin acciones, degrada bien).

    return jwt.sign({
        scope: TOKEN_SCOPE,
        userId: Number(userId),
        value: String(value || ''),
        actionId: actionId ? String(actionId) : null,
        type: type ? String(type) : null,
        jti: randomUUID() // Identificador único → idempotencia.
    }, secret, { expiresIn: process.env.NOTIFICATION_ACTION_TOKEN_TTL || '30d' });
};

/**
 * Verifica un token de acción y devuelve su payload.
 * @param {string} token - JWT firmado por signNotificationActionToken.
 * @returns {object} Payload validado { scope, userId, value, actionId, type, jti }.
 * @throws {Error} Si falta secreto, el scope no coincide o el payload está incompleto.
 */
export const verifyNotificationActionToken = (token) => {
    const secret = getSecret();
    if (!secret) throw new Error('NOTIFICATION_ACTION_SECRET/JWT_SECRET no configurado');
    const payload = jwt.verify(token, secret);
    if (payload.scope !== TOKEN_SCOPE) throw new Error('Token de acción inválido');
    if (!payload.userId || !payload.value) throw new Error('Token de acción incompleto');
    return payload;
};

/**
 * Verifica un token y ejecuta la acción asociada, garantizando idempotencia por `jti`.
 * @param {string} token - JWT de acción.
 * @param {object} [opts] - Opciones.
 * @param {object} [opts.io] - Instancia Socket.IO para emitir eventos en tiempo real.
 * @returns {Promise<any>} El resultado del handler que ejecutó la acción.
 */
export const executeSignedNotificationAction = async (token, { io } = {}) => {
    const payload = verifyNotificationActionToken(token);

    // Idempotencia: si ya procesamos este token, devolvemos el resultado cacheado.
    if (payload.jti && processedActions.has(payload.jti)) {
        return processedActions.get(payload.jti);
    }

    const result = await executeNotificationAction({
        userId: payload.userId,
        value: payload.value,
        io
    });

    // Cacheamos el resultado por 24h para tolerar reintentos / doble-tap del usuario.
    if (payload.jti) {
        processedActions.set(payload.jti, result);
        setTimeout(() => processedActions.delete(payload.jti), 1000 * 60 * 60 * 24).unref?.();
    }
    return result;
};

/**
 * Despacha una acción a su handler registrado. El primero cuyo `match(value)` da true,
 * la ejecuta. Sin handlers registrados que matcheen → error "no soportada".
 * @param {object} params - Parámetros de la acción.
 * @param {number} params.userId - Usuario destinatario.
 * @param {string} params.value - Valor de la acción a interpretar por el handler.
 * @param {object} [params.io] - Instancia Socket.IO para eventos real-time.
 * @returns {Promise<any>} El resultado que devuelva el handler.
 * @throws {Error} Si el valor está vacío o ningún handler matchea.
 */
export const executeNotificationAction = async ({ userId, value, io }) => {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error('Acción vacía');

    const models = getModels();
    const room = `user:${userId}`; // Room personal del usuario para emitir eventos.

    // Buscamos el primer handler que reclame esta acción.
    for (const handler of getNotificationActionHandlers()) {
        if (handler.match(normalized)) {
            return handler.run({ userId, value: normalized, models, io, room });
        }
    }

    throw new Error('Acción de notificación no soportada');
};
