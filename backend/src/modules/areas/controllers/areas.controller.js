/**
 * Controller del módulo `areas` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones para que otras sesiones refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as areaService from '../services/area.service.js';

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
 * GET /areas — listado paginado con búsqueda y filtro de activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las áreas (+ serviciosCount) y meta de paginación.
 */
export const list = async (req, res) => {
    try {
        const { rows, count, page, limit } = await areaService.listAreas(req.models, req.query);
        return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /areas/:id — un área por id.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el área, o 404.
 */
export const getById = async (req, res) => {
    try {
        const area = await areaService.getArea(req.models, req.params.id);
        if (!area) return await responseManager(404, 'Área no encontrada', req, res, false);
        return await responseManager(200, area, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /areas — crea un área.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el área creada.
 */
export const create = async (req, res) => {
    try {
        const area = await areaService.createArea(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('area:created', area);
        return await responseManager(201, area, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /areas/:id — actualiza un área.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el área actualizada, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const area = await areaService.updateArea(req.models, req.params.id, data);
        if (!area) return await responseManager(404, 'Área no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('area:updated', area);
        return await responseManager(200, area, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /areas/:id/active — alterna el estado activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el área actualizada, o 404.
 */
export const toggle = async (req, res) => {
    try {
        const area = await areaService.toggleArea(req.models, req.params.id);
        if (!area) return await responseManager(404, 'Área no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('area:updated', area);
        return await responseManager(200, area, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /areas/:id/restore — reactiva un área eliminada.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el área restaurada, o 404.
 */
export const restore = async (req, res) => {
    try {
        const area = await areaService.restoreArea(req.models, req.params.id);
        if (!area) return await responseManager(404, 'Área eliminada no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('area:created', area);
        return await responseManager(200, area, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /areas/:id — baja lógica (protegida por uso).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409 si está en uso.
 */
export const remove = async (req, res) => {
    try {
        const ok = await areaService.deleteArea(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Área no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('area:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Área eliminada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
