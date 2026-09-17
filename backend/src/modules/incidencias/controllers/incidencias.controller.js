/**
 * Controller del módulo `incidencias` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones, para que los listados abiertos se refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import * as svc from '../services/incidencia.service.js';
import * as archivos from '../services/archivoIncidencia.service.js';

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
 * GET /incidencias — listado con filtros.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las incidencias (cerradas al fondo).
 */
export const list = async (req, res) => {
    try {
        const data = await svc.listIncidencias(req.models, matchedData(req));
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /incidencias/:id — detalle con bitácora y archivos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el detalle, 404 si no existe.
 */
export const getById = async (req, res) => {
    try {
        const data = await svc.getIncidencia(req.models, req.params.id);
        if (!data) return await responseManager(404, 'Incidencia no encontrada', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /incidencias/servicios/:clienteId — servicios elegibles de un cliente.
 *
 * Existe para que el sistema interno arme el selector al cargar una incidencia en nombre del
 * cliente. Puede devolver vacío legítimamente: ahí la UI ofrece «Consulta general».
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con [{ id, nombre }].
 */
export const serviciosDeCliente = async (req, res) => {
    try {
        const data = await svc.serviciosDelCliente(req.models, req.params.clienteId);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /incidencias — alta desde el sistema interno, en nombre de un cliente.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la incidencia.
 */
export const create = async (req, res) => {
    try {
        const data = await svc.createIncidencia(req.models, matchedData(req), { userId: req.user.id }, req.io);
        if (req.io) req.io.to('app').emit('incidencia:creada', { id: data.id, clienteId: data.clienteId });
        return await responseManager(201, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /incidencias/:id — edita título, descripción y servicio (el estado va aparte).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la incidencia, 404 si no existe.
 */
export const update = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const actualizada = await svc.updateIncidencia(req.models, id, data);
        if (!actualizada) return await responseManager(404, 'Incidencia no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('incidencia:actualizada', { id: actualizada.id });
        return await responseManager(200, actualizada, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /incidencias/:id/estado — cambio manual de estado (el cliente NUNCA puede).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la incidencia, 404 si no existe.
 */
export const cambiarEstado = async (req, res) => {
    try {
        const { id, estado } = matchedData(req);
        const actualizada = await svc.cambiarEstadoIncidencia(req.models, id, estado, req.user.id);
        if (!actualizada) return await responseManager(404, 'Incidencia no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('incidencia:estado', { id: actualizada.id, estado });
        return await responseManager(200, actualizada, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /incidencias/:id — baja lógica.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, 404 si no existe.
 */
export const remove = async (req, res) => {
    try {
        const ok = await svc.deleteIncidencia(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Incidencia no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('incidencia:eliminada', { id: Number(req.params.id) });
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /incidencias/:id/tarea — crea una tarea a partir de la incidencia y las vincula.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la incidencia ya vinculada.
 */
export const crearTarea = async (req, res) => {
    try {
        const { id, listaId, fechaVencimiento } = matchedData(req);
        const data = await svc.crearTareaDesdeIncidencia(req.models, req.user, id, { listaId, fechaVencimiento }, req.io);
        if (req.io) {
            req.io.to('app').emit('incidencia:actualizada', { id: data.id });
            req.io.to('app').emit('tarea:creada', { id: data.tareaId, listaId });
        }
        return await responseManager(201, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /incidencias/archivos — sube un adjunto suelto desde el sistema interno.
 *
 * Pide el cliente en el body porque acá el que sube es un usuario interno cargando en nombre
 * del cliente: no hay un `clienteId` implícito como en el portal.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el registro y su URL.
 */
export const subirArchivo = async (req, res) => {
    try {
        if (!req.file) return await responseManager(400, 'No se recibió ningún archivo', req, res, false);
        const clienteId = Number(req.body.clienteId);
        if (!clienteId) return await responseManager(400, 'Falta el cliente del archivo', req, res, false);
        const data = await archivos.guardarArchivo(req.models, req.file, { clienteId, userId: req.user.id });
        return await responseManager(201, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /incidencias/archivos/:nombre — sirve un adjunto (sistema interno, con sesión).
 *
 * No usa `responseManager`: responde binario. Headers defensivos idénticos a los de tareas —
 * `nosniff` y una CSP que apaga todo, para que un HTML subido no se ejecute como página.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El binario, o 404.
 */
export const servirArchivo = async (req, res) => {
    try {
        const { nombre } = req.params;
        if (!archivos.NOMBRE_RE.test(nombre)) return res.status(404).end();
        const archivo = await archivos.leerArchivo(req.models, nombre);
        if (!archivo) return res.status(404).end();

        res.setHeader('Content-Type', archivo.mime || 'application/octet-stream');
        res.setHeader('Content-Disposition', archivo.tipo === 'imagen'
            ? 'inline'
            : `attachment; filename="${encodeURIComponent(archivo.nombreOriginal || nombre)}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(archivo.buffer);
    } catch { return res.status(404).end(); }
};

/**
 * DELETE /incidencias/archivos/:id — elimina un adjunto.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, 404 si no existe.
 */
export const eliminarArchivo = async (req, res) => {
    try {
        const ok = await archivos.eliminarArchivo(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Archivo no encontrado', req, res, false);
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
