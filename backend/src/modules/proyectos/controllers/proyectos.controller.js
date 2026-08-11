/**
 * Controller del módulo `proyectos` (thin): input validado → service → responseManager.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as svc from '../services/proyecto.service.js';

/**
 * Mapea un error de negocio del service al envelope.
 * @param {Error} e - Error capturado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
const bizCatch = async (e, req, res) => {
    const code = e.statusCode || 500;
    return responseManager(code, e.message, req, res, code >= 500);
};

/**
 * GET /proyectos — listado con filtros de estado/cliente/búsqueda.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const list = async (req, res) => {
    try {
        const { rows, count, page, limit } = await svc.listProyectos(req.models, req.query);
        return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /proyectos/grilla — grilla anual global de cobranzas (proyectos × 12 meses).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const grilla = async (req, res) => {
    try {
        const anio = Number(req.query.anio) || new Date().getFullYear();
        const data = await svc.getGrillaAnual(req.models, anio);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /proyectos/:id — un proyecto.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const getById = async (req, res) => {
    try {
        const proyecto = await svc.getProyecto(req.models, req.params.id);
        if (!proyecto) return await responseManager(404, 'Proyecto no encontrado', req, res, false);
        return await responseManager(200, proyecto, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /proyectos — crea un proyecto.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const create = async (req, res) => {
    try {
        const proyecto = await svc.createProyecto(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('proyecto:created', proyecto);
        return await responseManager(201, proyecto, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /proyectos/:id — edita un proyecto.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const proyecto = await svc.updateProyecto(req.models, req.params.id, data);
        if (!proyecto) return await responseManager(404, 'Proyecto no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('proyecto:updated', proyecto);
        return await responseManager(200, proyecto, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /proyectos/:id — baja lógica (protegida si tiene cobranzas cobradas).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const remove = async (req, res) => {
    try {
        const ok = await svc.deleteProyecto(req.models, req.user.id, req.params.id);
        if (!ok) return await responseManager(404, 'Proyecto no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('proyecto:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Proyecto eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Cobranzas ───────────────────────────────────────────────────────────────

/**
 * GET /proyectos/:id/cobranzas — cuotas + KPIs + auditoría del proyecto.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const cobranzas = async (req, res) => {
    try {
        const data = await svc.getCobranzas(req.models, req.params.id);
        if (!data) return await responseManager(404, 'Proyecto no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /proyectos/:id/cobranzas — agrega una cuota (tope de presupuesto).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const addCobranza = async (req, res) => {
    try {
        const { anio, mes, montoUsd } = matchedData(req);
        const cuota = await svc.addCobranza(req.models, req.user.id, req.params.id, { anio, mes, montoUsd });
        if (req.io) req.io.to('app').emit('cobranza:created', cuota);
        return await responseManager(201, cuota, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /proyectos/:id/cobranzas/:cobranzaId/monto — edita el monto (solo pendientes).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const updateMonto = async (req, res) => {
    try {
        const { montoUsd } = matchedData(req);
        const cuota = await svc.updateMonto(req.models, req.user.id, req.params.id, req.params.cobranzaId, montoUsd);
        if (req.io) req.io.to('app').emit('cobranza:updated', cuota);
        return await responseManager(200, cuota, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /proyectos/:id/cobranzas/mover — mueve cuotas pendientes a otro período (lote DnD).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const mover = async (req, res) => {
    try {
        const { cobranzaIds, anio, mes } = matchedData(req);
        const movidas = await svc.moverCobranzas(req.models, req.user.id, req.params.id, cobranzaIds, anio, mes);
        if (req.io) req.io.to('app').emit('cobranza:updated', { proyectoId: Number(req.params.id) });
        return await responseManager(200, { movidas }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /proyectos/:id/cobranzas/:cobranzaId/cobrar — cobra (peso real → cotización derivada).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const cobrar = async (req, res) => {
    try {
        const { montoPesos } = matchedData(req);
        const cuota = await svc.cobrarCuota(req.models, req.user.id, req.params.id, req.params.cobranzaId, montoPesos);
        if (req.io) req.io.to('app').emit('cobranza:cobrada', cuota);
        return await responseManager(200, cuota, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /proyectos/:id/cobranzas/:cobranzaId/descobrar — deshace un cobro (auditado).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const descobrar = async (req, res) => {
    try {
        const cuota = await svc.descobrarCuota(req.models, req.user.id, req.params.id, req.params.cobranzaId);
        if (req.io) req.io.to('app').emit('cobranza:updated', cuota);
        return await responseManager(200, cuota, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /proyectos/:id/cobranzas/:cobranzaId — elimina una cuota pendiente (auditado).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const removeCobranza = async (req, res) => {
    try {
        await svc.deleteCobranza(req.models, req.user.id, req.params.id, req.params.cobranzaId);
        if (req.io) req.io.to('app').emit('cobranza:deleted', { id: Number(req.params.cobranzaId) });
        return await responseManager(200, { message: 'Cobranza eliminada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
