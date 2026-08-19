/**
 * Sistema Interno — Controller de UserSettings (preferencias del usuario).
 *
 * Patrón controller-helper: estos controllers son finos (extraen input de `req`,
 * llaman a los modelos y responden con responseManager). UserSettings guarda
 * preferencias genéricas: push token, push on/off, quiet hours y do-not-disturb,
 * que el servicio de push (services/push) consume al enviar notificaciones.
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import {
    getOrCreateSettings,
    applySettingsUpdate,
    setPushToken,
    sendTestNotification
} from '../services/settings.service.js';

/** Nombre de la app para títulos de notificación (configurable por entorno). */
const APP_NAME = process.env.APP_NAME || 'Sistema Interno';

/**
 * Devuelve las preferencias del usuario; las crea con defaults si no existen.
 * @param {import('express').Request} req - Request (usa req.models y req.user).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Responde con el registro UserSettings.
 */
export const getSettings = async (req, res) => {
    try {
        const settings = await getOrCreateSettings(req.models, req.user.id);
        return await responseManager(200, settings, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Actualiza (o crea) las preferencias del usuario y emite `settings:updated` por socket.
 * * @param {import("express").Request} req - Request (req.models, req.user, req.io).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Responde con el registro actualizado.
 */
export const updateSettings = async (req, res) => {
    try {
        // Solo campos validados/whitelisteados por el validator llegan acá.
        const settings = await applySettingsUpdate(req.models, req.user.id, matchedData(req));

        // Notificamos a las otras sesiones del usuario (multi-dispositivo) en tiempo real.
        if (req.io) req.io.to(`user:${req.user.id}`).emit('settings:updated', settings);

        return await responseManager(200, settings, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Registra/actualiza el push token del dispositivo y habilita las notificaciones.
 * @param {import('express').Request} req - Request (body.token, req.models, req.user).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Responde con un mensaje de confirmación.
 */
export const registerPushToken = async (req, res) => {
    try {
        const { token } = matchedData(req);
        await setPushToken(req.models, req.user.id, token);
        return await responseManager(200, { message: 'Push token registrado' }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Envía una notificación push de prueba al token registrado del usuario.
 * Útil para que el usuario verifique que las notificaciones funcionan.
 * @param {import('express').Request} req - Request (req.models, req.user).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Responde con el resultado del envío, o 400 si no hay token.
 */
export const testNotification = async (req, res) => {
    try {
        const outcome = await sendTestNotification(req.models, req.user.id, APP_NAME);
        if (!outcome.ok) {
            // El mensaje explica QUÉ falta, no solo que falló: sin esto el usuario ve
            // «error» y no tiene forma de saber que le falta activar el permiso.
            return await responseManager(400, outcome.motivo, req, res, false);
        }
        return await responseManager(200, outcome.result, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /settings/push/clave-publica — clave VAPID que el navegador necesita para suscribirse.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { clavePublica } o null si el servidor no tiene push configurado.
 */
export const clavePublicaWebPush = async (req, res) => {
    const { clavePublica } = await import('../../../services/push/services/webpush.service.js');
    return responseManager(200, { clavePublica: clavePublica() }, req, res, false);
};

/**
 * POST /settings/push/suscripcion — registra este navegador para recibir notificaciones.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la suscripción guardada.
 */
export const suscribirWebPush = async (req, res) => {
    try {
        const { guardarSuscripcion } = await import('../../../services/push/services/webpush.service.js');
        const sub = await guardarSuscripcion(req.models, req.user.id, req.body, req.headers['user-agent']);
        return await responseManager(201, { id: sub.id }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * DELETE /settings/push/suscripcion — deja de recibir notificaciones en este navegador.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200.
 */
export const desuscribirWebPush = async (req, res) => {
    try {
        const { borrarSuscripcion } = await import('../../../services/push/services/webpush.service.js');
        const borrada = await borrarSuscripcion(req.models, req.user.id, req.body?.endpoint || '');
        return await responseManager(200, { borrada }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};
