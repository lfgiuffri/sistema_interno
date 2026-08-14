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
            return await responseManager(400, 'No hay token de push configurado', req, res, false);
        }
        return await responseManager(200, outcome.result, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};
