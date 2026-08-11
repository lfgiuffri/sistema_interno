/**
 * Controller del módulo `espacios` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones para que otras sesiones refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import * as espacioService from '../services/espacio.service.js';

/**
 * Mapea un error de negocio del service al envelope (statusCode + errorCode/deletedId).
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
 * GET /espacios — listado de administración con conteos y resumen de accesos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los espacios.
 */
export const list = async (req, res) => {
    try {
        const rows = await espacioService.listEspacios(req.models);
        return await responseManager(200, rows, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /espacios/:id — un espacio por id.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio, o 404.
 */
export const getById = async (req, res) => {
    try {
        const espacio = await espacioService.getEspacio(req.models, req.params.id);
        if (!espacio) return await responseManager(404, 'Espacio de trabajo no encontrado', req, res, false);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /espacios — crea un espacio (el creador queda con acceso total).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el espacio creado.
 */
export const create = async (req, res) => {
    try {
        const espacio = await espacioService.createEspacio(req.models, matchedData(req), req.user.id);
        if (req.io) req.io.to('app').emit('espacio:created', espacio);
        return await responseManager(201, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /espacios/:id — actualiza un espacio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio actualizado, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const espacio = await espacioService.updateEspacio(req.models, req.params.id, data);
        if (!espacio) return await responseManager(404, 'Espacio de trabajo no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('espacio:updated', espacio);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /espacios/:id/active — alterna el estado activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio actualizado, o 404.
 */
export const toggle = async (req, res) => {
    try {
        const espacio = await espacioService.toggleEspacio(req.models, req.params.id);
        if (!espacio) return await responseManager(404, 'Espacio de trabajo no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('espacio:updated', espacio);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /espacios/:id/restore — reactiva un espacio eliminado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio restaurado, o 404.
 */
export const restore = async (req, res) => {
    try {
        const espacio = await espacioService.restoreEspacio(req.models, req.params.id);
        if (!espacio) return await responseManager(404, 'Espacio eliminado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('espacio:created', espacio);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /espacios/:id — baja lógica (protegida: con listas/tareas no se elimina).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409 si tiene contenido.
 */
export const remove = async (req, res) => {
    try {
        const ok = await espacioService.deleteEspacio(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Espacio de trabajo no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('espacio:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Espacio de trabajo eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /espacios/:id/usuarios — matriz de accesos del EJE ESPACIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las filas de la matriz, o 404.
 */
export const matriz = async (req, res) => {
    try {
        const filas = await espacioService.getMatrizEspacio(req.models, req.params.id);
        if (!filas) return await responseManager(404, 'Espacio de trabajo no encontrado', req, res, false);
        return await responseManager(200, filas, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /espacios/:id/usuarios — guarda la matriz del EJE ESPACIO (solo gestionables).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, o 404.
 */
export const setMatriz = async (req, res) => {
    try {
        const { usuarios } = matchedData(req);
        const ok = await espacioService.setMatrizEspacio(req.models, req.params.id, usuarios);
        if (!ok) return await responseManager(404, 'Espacio de trabajo no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('espacio:accesos', { espacioId: Number(req.params.id) });
        return await responseManager(200, { message: 'Accesos del espacio actualizados' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /espacios/usuario/:userId — matriz de accesos del EJE USUARIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { porRol, espacios }, o 404.
 */
export const espaciosUsuario = async (req, res) => {
    try {
        const data = await espacioService.getEspaciosUsuario(req.models, req.params.userId);
        if (!data) return await responseManager(404, 'Usuario no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /espacios/usuario/:userId — guarda la matriz del EJE USUARIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 403 si es admin, o 404.
 */
export const setEspaciosUsuario = async (req, res) => {
    try {
        const { espacios } = matchedData(req);
        const ok = await espacioService.setEspaciosUsuario(req.models, req.params.userId, espacios);
        if (!ok) return await responseManager(404, 'Usuario no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('espacio:accesos', { userId: Number(req.params.userId) });
        return await responseManager(200, { message: 'Espacios del usuario actualizados' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
