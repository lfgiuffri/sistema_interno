/**
 * Controller del módulo `formas-facturacion` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones para que otras sesiones refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as formaService from '../services/formaFacturacion.service.js';

/**
 * Mapea un error de negocio del service al envelope (statusCode + errorCode/deletedId).
 * @param {Error} e - Error capturado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
const bizCatch = async (e, req, res) => {
    const code = e.statusCode || 500;
    // Como data-objeto: responseManager copia los campos extra (deletedId) a la respuesta.
    const payload = e.deletedId ? { message: e.message, deletedId: e.deletedId } : e.message;
    return responseManager(code, payload, req, res, code >= 500, e.errorCode ? { errorCode: e.errorCode } : {});
};

/**
 * GET /formas-facturacion — listado paginado con búsqueda y filtro de activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las formas (+ abonosCount) y meta de paginación.
 */
export const list = async (req, res) => {
    try {
        const { rows, count, page, limit } = await formaService.listFormas(req.models, req.query);
        return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /formas-facturacion/:id — una forma por id.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la forma, o 404.
 */
export const getById = async (req, res) => {
    try {
        const forma = await formaService.getForma(req.models, req.params.id);
        if (!forma) return await responseManager(404, 'Forma de facturación no encontrada', req, res, false);
        return await responseManager(200, forma, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /formas-facturacion — crea una forma.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la forma creada.
 */
export const create = async (req, res) => {
    try {
        const forma = await formaService.createForma(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('forma-facturacion:created', forma);
        return await responseManager(201, forma, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /formas-facturacion/:id — actualiza una forma.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la forma actualizada, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const forma = await formaService.updateForma(req.models, req.params.id, data);
        if (!forma) return await responseManager(404, 'Forma de facturación no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('forma-facturacion:updated', forma);
        return await responseManager(200, forma, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /formas-facturacion/:id/active — alterna el estado activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la forma actualizada, o 404.
 */
export const toggle = async (req, res) => {
    try {
        const forma = await formaService.toggleForma(req.models, req.params.id);
        if (!forma) return await responseManager(404, 'Forma de facturación no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('forma-facturacion:updated', forma);
        return await responseManager(200, forma, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /formas-facturacion/:id/restore — reactiva una forma eliminada.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la forma restaurada, o 404.
 */
export const restore = async (req, res) => {
    try {
        const forma = await formaService.restoreForma(req.models, req.params.id);
        if (!forma) return await responseManager(404, 'Forma de facturación eliminada no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('forma-facturacion:created', forma);
        return await responseManager(200, forma, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /formas-facturacion/:id — baja lógica (protegida por uso).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409 si está en uso.
 */
export const remove = async (req, res) => {
    try {
        const ok = await formaService.deleteForma(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Forma de facturación no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('forma-facturacion:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Forma de facturación eliminada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
