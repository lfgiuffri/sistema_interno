/**
 * Controller del módulo `sueldos` (thin): input validado → service → responseManager.
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import * as sueldoService from '../services/sueldo.service.js';

/**
 * Mapea un error de negocio del service al envelope.
 * @param {Error} e - Error capturado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
const bizCatch = async (e, req, res) => {
    const code = e.statusCode || 500;
    const payload = e.deletedId ? { message: e.message, deletedId: e.deletedId } : e.message;
    return responseManager(code, payload, req, res, code >= 500, e.errorCode ? { errorCode: e.errorCode } : {});
};

/**
 * GET /sueldos — listado con vigente/último cambio/futuros + cabecera.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { rows, activos, masaSalarial }.
 */
export const list = async (req, res) => {
    try {
        const data = await sueldoService.listSueldos(req.models);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /sueldos/:empleadoId — edición inline (registra contra el vigente).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { vigente, registrado }.
 */
export const setSueldo = async (req, res) => {
    try {
        const { sueldo } = matchedData(req);
        const r = await sueldoService.setSueldo(req.models, req.params.empleadoId, sueldo, req.user.id);
        if (req.io) req.io.to('app').emit('sueldo:updated', { empleadoId: Number(req.params.empleadoId) });
        return await responseManager(200, r, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /sueldos/actualizar/preview — preview de actualización por % (puro).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las filas calculadas.
 */
export const previewActualizacion = async (req, res) => {
    try {
        const { ids, porcentaje, overrides } = matchedData(req);
        const filas = await sueldoService.previewActualizacion(req.models, ids, porcentaje, overrides || {});
        return await responseManager(200, filas, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /sueldos/actualizar — aplica la actualización por %.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { actualizados }.
 */
export const aplicarActualizacion = async (req, res) => {
    try {
        const { ids, porcentaje, overrides } = matchedData(req);
        const r = await sueldoService.aplicarActualizacion(req.models, ids, porcentaje, overrides || {}, req.user.id);
        if (req.io) req.io.to('app').emit('sueldo:updated', { ids });
        return await responseManager(200, r, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /sueldos/:empleadoId/historial — historial con tipos y variación.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { empleado, vigente, historial }, o 404.
 */
export const historial = async (req, res) => {
    try {
        const data = await sueldoService.getHistorial(req.models, req.params.empleadoId);
        if (!data) return await responseManager(404, 'Empleado no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /sueldos/aumentos/preview — matriz empleado × línea + registros que se pisan.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { filas, lineas, pisados }.
 */
export const previewAumentos = async (req, res) => {
    try {
        const data = await sueldoService.previewAumentos(req.models, matchedData(req));
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /sueldos/aumentos — aplica los aumentos programados (trx secuencial).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { empleados, meses }.
 */
export const aplicarAumentos = async (req, res) => {
    try {
        const r = await sueldoService.aplicarAumentos(req.models, matchedData(req), req.user.id);
        if (req.io) req.io.to('app').emit('sueldo:updated', { aumentos: true });
        return await responseManager(200, r, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /sueldos/planificacion — matriz del período (default: mes anterior).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la planificación.
 */
export const getPlanificacion = async (req, res) => {
    try {
        const data = await sueldoService.getPlanificacion(req.models, req.query.anio, req.query.mes);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /sueldos/planificacion — guarda la matriz (autoguardado del frontend).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200.
 */
export const savePlanificacion = async (req, res) => {
    try {
        await sueldoService.savePlanificacion(req.models, matchedData(req));
        return await responseManager(200, { message: 'Planificación guardada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Cuentas ───────────────────────────

/**
 * GET /sueldos/cuentas — cuentas con usos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las cuentas.
 */
export const listCuentas = async (req, res) => {
    try {
        const rows = await sueldoService.listCuentas(req.models);
        return await responseManager(200, rows, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /sueldos/cuentas — crea una cuenta.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la cuenta.
 */
export const createCuenta = async (req, res) => {
    try {
        const cuenta = await sueldoService.createCuenta(req.models, matchedData(req));
        return await responseManager(201, cuenta, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /sueldos/cuentas/:id — edita una cuenta.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la cuenta, o 404.
 */
export const updateCuenta = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const cuenta = await sueldoService.updateCuenta(req.models, req.params.id, data);
        if (!cuenta) return await responseManager(404, 'Cuenta no encontrada', req, res, false);
        return await responseManager(200, cuenta, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /sueldos/cuentas/:id/active — alterna activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la cuenta, o 404.
 */
export const toggleCuenta = async (req, res) => {
    try {
        const cuenta = await sueldoService.toggleCuenta(req.models, req.params.id);
        if (!cuenta) return await responseManager(404, 'Cuenta no encontrada', req, res, false);
        return await responseManager(200, cuenta, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /sueldos/cuentas/:id/restore — reactiva una cuenta eliminada.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la cuenta, o 404.
 */
export const restoreCuenta = async (req, res) => {
    try {
        const cuenta = await sueldoService.restoreCuenta(req.models, req.params.id);
        if (!cuenta) return await responseManager(404, 'Cuenta eliminada no encontrada', req, res, false);
        return await responseManager(200, cuenta, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /sueldos/cuentas/:id — baja lógica protegida (409 con pagos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409.
 */
export const removeCuenta = async (req, res) => {
    try {
        const ok = await sueldoService.deleteCuenta(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Cuenta no encontrada', req, res, false);
        return await responseManager(200, { message: 'Cuenta eliminada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
