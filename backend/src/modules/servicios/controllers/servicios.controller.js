/**
 * Controller del módulo `servicios` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones para que otras sesiones refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as servicioService from '../services/servicio.service.js';

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
 * GET /servicios — listado paginado con búsqueda, filtro de activo y de área.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los servicios (+ área y abonosCount) y meta de paginación.
 */
export const list = async (req, res) => {
    try {
        const { rows, count, page, limit } = await servicioService.listServicios(req.models, req.query);
        return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /servicios/:id — un servicio por id.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el servicio, o 404.
 */
export const getById = async (req, res) => {
    try {
        const servicio = await servicioService.getServicio(req.models, req.params.id);
        if (!servicio) return await responseManager(404, 'Servicio no encontrado', req, res, false);
        return await responseManager(200, servicio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /servicios — crea un servicio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el servicio creado.
 */
export const create = async (req, res) => {
    try {
        const servicio = await servicioService.createServicio(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('servicio:created', servicio);
        return await responseManager(201, servicio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /servicios/:id — actualiza un servicio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el servicio actualizada, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const servicio = await servicioService.updateServicio(req.models, req.params.id, data);
        if (!servicio) return await responseManager(404, 'Servicio no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servicio:updated', servicio);
        return await responseManager(200, servicio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /servicios/:id/active — alterna el estado activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el servicio actualizada, o 404.
 */
export const toggle = async (req, res) => {
    try {
        const servicio = await servicioService.toggleServicio(req.models, req.params.id);
        if (!servicio) return await responseManager(404, 'Servicio no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servicio:updated', servicio);
        return await responseManager(200, servicio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /servicios/:id/restore — reactiva un servicio eliminado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el servicio restaurada, o 404.
 */
export const restore = async (req, res) => {
    try {
        const servicio = await servicioService.restoreServicio(req.models, req.params.id);
        if (!servicio) return await responseManager(404, 'Servicio eliminado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servicio:created', servicio);
        return await responseManager(200, servicio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /servicios/:id — baja lógica (protegida por uso).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409 si está en uso.
 */
export const remove = async (req, res) => {
    try {
        const ok = await servicioService.deleteServicio(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Servicio no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servicio:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Servicio eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
