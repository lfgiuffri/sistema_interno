/**
 * Sistema Interno — Controller del feature `webhooks` (thin).
 *
 * Controller-helper: estos handlers solo orquestan el ciclo req/res — extraen input validado,
 * llaman al service (webhooks.service) y responden con responseManager. La lógica de negocio
 * (firma HMAC, reintentos, transporte) vive en el service.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as webhooks from '../services/webhooks.service.js';

/**
 * GET /webhooks/subscriptions — lista las suscripciones.
 * @param {import('express').Request} req - Request (req.models, req.query).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el array de suscripciones.
 */
export const listSubscriptions = async (req, res) => {
    try {
        const subs = await webhooks.listSubscriptions(req.models, req.query);
        return await responseManager(200, subs, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /webhooks/subscriptions/:id — una suscripción por id.
 * @param {import('express').Request} req - Request (req.params.id).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la suscripción, o 404 si no existe.
 */
export const getSubscription = async (req, res) => {
    try {
        const sub = await webhooks.getSubscription(req.models, req.params.id);
        if (!sub) return await responseManager(404, 'Suscripción no encontrada', req, res, false);
        return await responseManager(200, sub, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * POST /webhooks/subscriptions — crea una suscripción (el server genera el secreto HMAC).
 * @param {import('express').Request} req - Request (body validado, req.user).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la suscripción creada (incluye el secret, mostrar una sola vez).
 */
export const createSubscription = async (req, res) => {
    try {
        const data = matchedData(req); // solo campos validados (url, events?, active?)
        // userId del token cuando hay usuario; null si fuese una llamada a nivel sistema.
        const userId = req.user?.id ?? null;
        const sub = await webhooks.createSubscription(req.models, userId, data);
        return await responseManager(201, sub, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * DELETE /webhooks/subscriptions/:id — elimina (soft-delete) una suscripción.
 * @param {import('express').Request} req - Request (req.params.id).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se borró, o 404 si no existía.
 */
export const deleteSubscription = async (req, res) => {
    try {
        const ok = await webhooks.deleteSubscription(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Suscripción no encontrada', req, res, false);
        return await responseManager(200, { message: 'Suscripción eliminada' }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * GET /webhooks/deliveries — log paginado de entregas.
 * @param {import('express').Request} req - Request (req.query: subscriptionId?, status?, page?, limit?).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las filas + meta de paginación.
 */
export const listDeliveries = async (req, res) => {
    try {
        const { rows, count, page, limit } = await webhooks.listDeliveries(req.models, req.query);
        const meta = Paginate(count, limit, page);
        return await responseManager(200, rows, req, res, false, { meta });
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * POST /webhooks/test — dispara un evento de prueba para verificar la configuración.
 * Usa el mismo `dispatch` que los eventos reales, así se ejercita firma + transporte + log.
 * @param {import('express').Request} req - Request (body: event?, payload?; req.models, req.io).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con cuántas entregas se generaron.
 */
export const test = async (req, res) => {
    try {
        const data = matchedData(req);
        // Evento de prueba por defecto; el payload incluye un timestamp para que sea identificable.
        const event = data.event || 'webhook:test';
        const payload = data.payload || { test: true, triggeredAt: new Date().toISOString() };

        const result = await webhooks.dispatch(req.models, event, payload, req.io);
        return await responseManager(200, {
            message: `Evento de prueba "${event}" despachado a ${result.dispatched} suscripción(es)`,
            ...result
        }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};
