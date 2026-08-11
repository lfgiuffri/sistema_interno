/**
 * Controller del módulo `empleados` (thin). La ficha incluye vacaciones y archivos solo
 * si el rol tiene esas capabilities (granularidad del PRD §4: vacaciones y archivos son
 * módulos de permiso propios aunque cuelguen de la misma ruta).
 */

import { matchedData } from 'express-validator';
import { responseManager, getRoleCapabilities } from '../../../kernel/index.js';
import * as empleadoService from '../services/empleado.service.js';
import * as archivoService from '../services/archivoEmpleado.service.js';

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
 * ¿El rol del usuario tiene la capability (o comodín)?
 * @param {import('express').Request} req - Request.
 * @param {string} cap - Capability.
 * @returns {Promise<boolean>} true si la tiene.
 */
const puede = async (req, cap) => {
    const caps = await getRoleCapabilities(req.models, 'default', req.user.roleId);
    return caps.includes('*') || caps.includes(cap);
};

/**
 * GET /empleados — listado con áreas y vacaciones por lote.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los empleados.
 */
export const list = async (req, res) => {
    try {
        const rows = await empleadoService.listEmpleados(req.models);
        // Sin vacaciones:read el bloque no viaja (granularidad).
        const verVac = await puede(req, 'vacaciones:read');
        return await responseManager(200, verVac ? rows : rows.map(r => ({ ...r, vacaciones: undefined })), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /empleados/:id — ficha completa (vacaciones/archivos según capabilities).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la ficha, o 404.
 */
export const ficha = async (req, res) => {
    try {
        const data = await empleadoService.getFicha(req.models, req.params.id);
        if (!data) return await responseManager(404, 'Empleado no encontrado', req, res, false);
        if (!(await puede(req, 'vacaciones:read'))) delete data.vacaciones;
        if (!(await puede(req, 'empleados-archivos:read'))) delete data.archivos;
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /empleados — alta de ficha (el sueldo se carga desde Sueldos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el empleado.
 */
export const create = async (req, res) => {
    try {
        const empleado = await empleadoService.createEmpleado(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('empleado:created', { id: empleado.id });
        return await responseManager(201, empleado, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /empleados/:id — edición de ficha.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el empleado, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const empleado = await empleadoService.updateEmpleado(req.models, req.params.id, data);
        if (!empleado) return await responseManager(404, 'Empleado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('empleado:updated', { id: empleado.id });
        return await responseManager(200, empleado, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /empleados/:id/active — alterna activo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el empleado, o 404.
 */
export const toggle = async (req, res) => {
    try {
        const empleado = await empleadoService.toggleEmpleado(req.models, req.params.id);
        if (!empleado) return await responseManager(404, 'Empleado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('empleado:updated', { id: empleado.id });
        return await responseManager(200, empleado, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /empleados/:id — baja lógica protegida (409 con datos asociados).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409.
 */
export const remove = async (req, res) => {
    try {
        const ok = await empleadoService.deleteEmpleado(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Empleado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('empleado:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Empleado eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Vacaciones ───────────────────────────

/**
 * POST /empleados/:id/vacaciones/tomas — registra un período.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la toma (incluye días).
 */
export const addToma = async (req, res) => {
    try {
        const data = matchedData(req);
        const toma = await empleadoService.addToma(req.models, req.params.id, data, req.user.id);
        return await responseManager(201, toma, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /empleados/:id/vacaciones/tomas/:tomaId — elimina un período (404 real).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 o 404.
 */
export const deleteToma = async (req, res) => {
    try {
        const ok = await empleadoService.deleteToma(req.models, req.params.id, req.params.tomaId);
        if (!ok) return await responseManager(404, 'Período de vacaciones no encontrado', req, res, false);
        return await responseManager(200, { message: 'Período de vacaciones eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /empleados/:id/vacaciones/asignacion — override de días para un año
 * (dias null/'' → quita el ajuste).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { quitado }.
 */
export const setAsignacion = async (req, res) => {
    try {
        const { anio, dias } = matchedData(req);
        const r = await empleadoService.setAsignacion(req.models, req.params.id, anio, dias ?? null);
        const message = r.quitado
            ? 'Se quitó el ajuste; ese año vuelve al valor por defecto'
            : 'Asignación de vacaciones guardada';
        return await responseManager(200, { ...r, message }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Archivos ───────────────────────────

/**
 * POST /empleados/:id/archivos — sube un archivo a la ficha (multipart `archivo`).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el registro.
 */
export const subirArchivo = async (req, res) => {
    try {
        if (!req.file) return await responseManager(400, 'Elegí un archivo', req, res, false);
        const archivo = await archivoService.subirArchivo(
            req.models, req.params.id, req.file, req.body.descripcion, req.user.id
        );
        return await responseManager(201, archivo, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /empleados/archivos/:archivoId — descarga (attachment + nosniff). Respuesta
 * binaria: acá no va responseManager a propósito.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El binario o 404 vacío.
 */
export const descargarArchivo = async (req, res) => {
    try {
        const archivo = await archivoService.leerArchivo(req.models, req.params.archivoId);
        if (!archivo) return res.status(404).end();
        res.set({
            'Content-Type': archivo.mime,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(archivo.nombreOriginal)}"`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=0'
        });
        return res.send(archivo.buffer);
    } catch {
        return res.status(404).end();
    }
};

/**
 * DELETE /empleados/:id/archivos/:archivoId — elimina archivo (binario + registro).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 o 404.
 */
export const eliminarArchivo = async (req, res) => {
    try {
        const ok = await archivoService.eliminarArchivo(req.models, req.params.id, req.params.archivoId);
        if (!ok) return await responseManager(404, 'Archivo no encontrado', req, res, false);
        return await responseManager(200, { message: 'Archivo eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
