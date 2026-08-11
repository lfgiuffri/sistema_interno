/**
 * Controller del módulo `abonos` (thin): input validado → service → responseManager.
 * Los flujos de dos pasos (actualizar/facturar) exponen /preview (puro) + /aplicar
 * (idempotente por operationId). Emite eventos de socket en las mutaciones.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as svc from '../services/abono.service.js';

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
 * GET /abonos — listado con filtros, estado de actualización y paginación.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const list = async (req, res) => {
    try {
        const { rows, count, page, limit } = await svc.listAbonos(req.models, req.query);
        return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /abonos/resumen — tiles del listado (activos, total mensual, próximos, vencidos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const resumen = async (req, res) => {
    try {
        const data = await svc.resumenAbonos(req.models, req.query);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /abonos/:id — un abono con cliente/servicio/forma y días calculados.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const getById = async (req, res) => {
    try {
        const abono = await svc.getAbono(req.models, req.params.id);
        if (!abono) return await responseManager(404, 'Abono no encontrado', req, res, false);
        return await responseManager(200, abono, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /abonos/:id/actualizaciones — historial de precios del abono.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const actualizaciones = async (req, res) => {
    try {
        const abono = await svc.getAbono(req.models, req.params.id);
        if (!abono) return await responseManager(404, 'Abono no encontrado', req, res, false);
        const rows = await svc.getActualizaciones(req.models, req.params.id);
        return await responseManager(200, rows, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /abonos — crea un abono (nace inactivo salvo indicación explícita).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const create = async (req, res) => {
    try {
        const abono = await svc.createAbono(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('abono:created', abono);
        return await responseManager(201, abono, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /abonos/:id — edita los datos del abono (el precio va por los flujos de actualización).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const abono = await svc.updateAbono(req.models, req.params.id, data);
        if (!abono) return await responseManager(404, 'Abono no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('abono:updated', abono);
        return await responseManager(200, abono, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /abonos/:id/active — activa/desactiva (inactivo = no se factura ni actualiza).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const toggle = async (req, res) => {
    try {
        const abono = await svc.toggleAbono(req.models, req.params.id);
        if (!abono) return await responseManager(404, 'Abono no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('abono:updated', abono);
        return await responseManager(200, abono, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /abonos/:id — baja lógica (las facturaciones históricas se conservan).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const remove = async (req, res) => {
    try {
        const ok = await svc.deleteAbono(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Abono no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('abono:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Abono eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Actualización de precios (preview → aplicar) ───────────────────────────

/**
 * POST /abonos/actualizar/preview — cálculo puro por abono (sin escritura).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const actualizarPreview = async (req, res) => {
    try {
        const { ids, porcentaje, cotizacion, precioUsd, overrides } = matchedData(req);
        const data = await svc.previewActualizacion(req.models, ids, { porcentaje, cotizacion, precioUsd, overrides });
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /abonos/actualizar — aplica la actualización (idempotente por operationId).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const actualizarAplicar = async (req, res) => {
    try {
        const { ids, porcentaje, cotizacion, precioUsd, overrides, operationId } = matchedData(req);
        const data = await svc.aplicarActualizacion(req.models, req.user.id, ids, { porcentaje, cotizacion, precioUsd, overrides }, operationId);
        if (req.io) req.io.to('app').emit('abono:actualizado', { ids, aplicados: data.aplicados });
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Facturación mensual (preview → aplicar) ─────────────────────────────────

/**
 * POST /abonos/facturar/preview — qué se facturaría en el período (puro).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const facturarPreview = async (req, res) => {
    try {
        const { ids, anio, mes } = matchedData(req);
        const data = await svc.previewFacturacion(req.models, ids, anio, mes);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /abonos/facturar — factura el período (idempotente; omite ya facturados).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const facturarAplicar = async (req, res) => {
    try {
        const { ids, anio, mes, operationId } = matchedData(req);
        const data = await svc.aplicarFacturacion(req.models, req.user.id, ids, anio, mes, operationId);
        if (req.io) req.io.to('app').emit('facturacion:created', { anio, mes, facturados: data.facturados });
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Facturaciones (histórico + anulación) ───────────────────────────────────

/**
 * GET /abonos/facturaciones — histórico con filtros (las anuladas se excluyen por default).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const facturaciones = async (req, res) => {
    try {
        const { rows, count, page, limit, totalPesos } = await svc.listFacturaciones(req.models, req.query);
        return await responseManager(200, { rows, totalPesos }, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /abonos/facturaciones/:id/anular — anulación auditada, no-destructiva.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const anular = async (req, res) => {
    try {
        const { motivo } = matchedData(req);
        const fact = await svc.anularFacturacion(req.models, req.user.id, req.params.id, motivo);
        if (!fact) return await responseManager(404, 'Facturación no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('facturacion:anulada', { id: fact.id });
        return await responseManager(200, fact, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
