/**
 * Controller del módulo `clientes` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones para que otras sesiones refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager, Paginate } from '../../../kernel/index.js';
import * as clienteService from '../services/cliente.service.js';
import * as usuariosSvc from '../services/clienteUsuario.service.js';

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
 * GET /clientes — listado paginado con búsqueda y filtro de activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los clientes (+ abonosCount) y meta de paginación.
 */
export const list = async (req, res) => {
    try {
        const { rows, count, page, limit } = await clienteService.listClientes(req.models, req.query);
        return await responseManager(200, rows, req, res, false, { meta: Paginate(count, limit, page) });
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /clientes/:id — un cliente por id.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el cliente, o 404.
 */
export const getById = async (req, res) => {
    try {
        const cliente = await clienteService.getCliente(req.models, req.params.id);
        if (!cliente) return await responseManager(404, 'Cliente no encontrado', req, res, false);
        return await responseManager(200, cliente, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /clientes — crea un cliente.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el cliente creada.
 */
export const create = async (req, res) => {
    try {
        const cliente = await clienteService.createCliente(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('cliente:created', cliente);
        return await responseManager(201, cliente, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /clientes/:id — actualiza un cliente.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el cliente actualizada, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const cliente = await clienteService.updateCliente(req.models, req.params.id, data);
        if (!cliente) return await responseManager(404, 'Cliente no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('cliente:updated', cliente);
        return await responseManager(200, cliente, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /clientes/:id/active — alterna el estado activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el cliente actualizada, o 404.
 */
export const toggle = async (req, res) => {
    try {
        const cliente = await clienteService.toggleCliente(req.models, req.params.id);
        if (!cliente) return await responseManager(404, 'Cliente no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('cliente:updated', cliente);
        return await responseManager(200, cliente, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /clientes/:id/restore — reactiva un cliente eliminada.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el cliente restaurada, o 404.
 */
export const restore = async (req, res) => {
    try {
        const cliente = await clienteService.restoreCliente(req.models, req.params.id);
        if (!cliente) return await responseManager(404, 'Cliente eliminado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('cliente:created', cliente);
        return await responseManager(200, cliente, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /clientes/:id — baja lógica (protegida por uso).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409 si está en uso.
 */
export const remove = async (req, res) => {
    try {
        const ok = await clienteService.deleteCliente(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Cliente no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('cliente:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Cliente eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────── Usuarios de PORTAL del cliente ───────────────────────

/**
 * GET /clientes/:id/usuarios — usuarios de portal del cliente.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los usuarios (sin el hash).
 */
export const listUsuarios = async (req, res) => {
    try {
        const data = await usuariosSvc.listClienteUsuarios(req.models, req.params.id);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /clientes/:id/usuarios — da de alta un acceso al portal.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el usuario.
 */
export const createUsuario = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const usuario = await usuariosSvc.createClienteUsuario(req.models, id, data);
        return await responseManager(201, usuario, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /clientes/:id/usuarios/:uid — edita (y resetea la contraseña, si viene).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el usuario, 404 si no existe.
 */
export const updateUsuario = async (req, res) => {
    try {
        const { id, uid, ...data } = matchedData(req);
        const usuario = await usuariosSvc.updateClienteUsuario(req.models, id, uid, data);
        if (!usuario) return await responseManager(404, 'Usuario de portal no encontrado', req, res, false);
        return await responseManager(200, usuario, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /clientes/:id/usuarios/:uid/active — activa/desactiva el acceso.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el usuario, 404 si no existe.
 */
export const toggleUsuario = async (req, res) => {
    try {
        const usuario = await usuariosSvc.toggleClienteUsuario(req.models, req.params.id, req.params.uid);
        if (!usuario) return await responseManager(404, 'Usuario de portal no encontrado', req, res, false);
        return await responseManager(200, usuario, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /clientes/:id/usuarios/:uid — quita el acceso al portal.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, 404 si no existe.
 */
export const removeUsuario = async (req, res) => {
    try {
        const ok = await usuariosSvc.deleteClienteUsuario(req.models, req.params.id, req.params.uid);
        if (!ok) return await responseManager(404, 'Usuario de portal no encontrado', req, res, false);
        return await responseManager(200, { id: Number(req.params.uid) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
