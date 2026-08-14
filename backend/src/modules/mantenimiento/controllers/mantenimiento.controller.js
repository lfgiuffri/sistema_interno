/**
 * Controller del módulo `mantenimiento` (thin): input validado → service → responseManager.
 *
 * `ingesta` es el único endpoint que NO se autentica con sesión: lo llama el agente de cada
 * servidor con su token (por eso su ruta se monta fuera de verifyAccessToken).
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import * as svc from '../services/servidor.service.js';
import * as sitios from '../services/sitio.service.js';
import { chequearSitio } from '../services/chequeo.service.js';
import { vencimientoDominio } from '../services/rdap.service.js';

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
 * GET /mantenimiento/servidores — inventario con última métrica e incidentes abiertos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const list = async (req, res) => {
    try {
        return await responseManager(200, await svc.listServidores(req.models), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /mantenimiento/servidores/:id — ficha con series para el gráfico.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const getById = async (req, res) => {
    try {
        const dias = Math.min(Number(req.query.dias) || 2, 30);
        const servidor = await svc.getServidor(req.models, req.params.id, dias);
        if (!servidor) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        return await responseManager(200, servidor, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/servidores — alta (devuelve el token del agente UNA sola vez).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const create = async (req, res) => {
    try {
        const { servidor, token } = await svc.createServidor(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('servidor:created', { id: servidor.id });
        return await responseManager(201, { ...servidor.toJSON(), token }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /mantenimiento/servidores/:id — edición.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const update = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const servidor = await svc.updateServidor(req.models, id, data);
        if (!servidor) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servidor:updated', { id: servidor.id });
        return await responseManager(200, servidor, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/servidores/:id/token — regenera el token del agente.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const regenerarToken = async (req, res) => {
    try {
        const token = await svc.regenerarToken(req.models, req.params.id);
        if (!token) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        return await responseManager(200, { token }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /mantenimiento/servidores/:id/active — activa/desactiva el monitoreo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const toggle = async (req, res) => {
    try {
        const servidor = await svc.toggleServidor(req.models, req.params.id);
        if (!servidor) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servidor:updated', { id: servidor.id });
        return await responseManager(200, servidor, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /mantenimiento/servidores/:id — baja lógica.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const remove = async (req, res) => {
    try {
        const ok = await svc.deleteServidor(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servidor:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────────── Sitios web ───────────────────────────────

/**
 * GET /mantenimiento/sitios — listado con estado, dominio y certificado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const listSitios = async (req, res) => {
    try {
        return await responseManager(200, await sitios.listSitios(req.models), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /mantenimiento/sitios/:id — ficha con historial de chequeos e incidentes.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const getSitio = async (req, res) => {
    try {
        const sitio = await sitios.getSitio(req.models, req.params.id);
        if (!sitio) return await responseManager(404, 'Sitio no encontrado', req, res, false);
        return await responseManager(200, sitio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/sitios — alta.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const createSitio = async (req, res) => {
    try {
        const sitio = await sitios.createSitio(req.models, matchedData(req));
        if (req.io) req.io.to('app').emit('sitio:created', { id: sitio.id });
        return await responseManager(201, sitio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /mantenimiento/sitios/:id — edición.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const updateSitio = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const sitio = await sitios.updateSitio(req.models, id, data);
        if (!sitio) return await responseManager(404, 'Sitio no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: sitio.id });
        return await responseManager(200, sitio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /mantenimiento/sitios/:id/active — activa/desactiva el monitoreo del sitio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const toggleSitio = async (req, res) => {
    try {
        const sitio = await sitios.toggleSitio(req.models, req.params.id);
        if (!sitio) return await responseManager(404, 'Sitio no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: sitio.id });
        return await responseManager(200, sitio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /mantenimiento/sitios/:id — baja lógica.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const removeSitio = async (req, res) => {
    try {
        const ok = await sitios.deleteSitio(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Sitio no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('sitio:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/sitios/:id/chequear — chequeo manual (no espera al tick de 5 minutos).
 * Guarda el resultado como cualquier otro chequeo, pero NO abre ni cierra incidentes: es una
 * verificación puntual del usuario, la lógica de alertas sigue siendo la del scheduler.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const chequearAhora = async (req, res) => {
    try {
        const sitio = await req.models.SitioWeb.findByPk(req.params.id);
        if (!sitio) return await responseManager(404, 'Sitio no encontrado', req, res, false);

        const r = await chequearSitio(sitio.url, sitio.verificaMarcador);
        await req.models.SitioChequeo.create({
            sitioId: sitio.id, estado: r.estado, httpStatus: r.httpStatus,
            tiempoMs: r.tiempoMs, motivo: r.motivo?.slice(0, 200) ?? null, createdAt: new Date(),
        });
        await sitio.update({
            estado: r.estado, ultimoChequeoAt: new Date(), ultimoCodigo: r.httpStatus, tiempoMs: r.tiempoMs,
            ...(r.tlsVenceAt ? { tlsVenceAt: r.tlsVenceAt } : {}),
        });
        if (req.io) req.io.to('app').emit('sitio:updated', { id: sitio.id });
        return await responseManager(200, r, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/sitios/:id/dominio — consulta RDAP a demanda del vencimiento.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const consultarDominio = async (req, res) => {
    try {
        const sitio = await req.models.SitioWeb.findByPk(req.params.id);
        if (!sitio) return await responseManager(404, 'Sitio no encontrado', req, res, false);

        const r = await vencimientoDominio(sitio.dominio);
        if (r.ok && r.venceAt) {
            // Se guarda el dominio REGISTRABLE que resolvió RDAP (`app.cliente.com.ar` →
            // `cliente.com.ar`): es el que efectivamente vence.
            await sitio.update({ dominio: r.dominio, dominioVenceAt: r.venceAt, dominioAuto: true, dominioConsultadoAt: new Date() });
        } else {
            await sitio.update({ dominioConsultadoAt: new Date() });
        }
        return await responseManager(200, r, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /agente/metricas — reporte del agente instalado en un servidor.
 * Se autentica con el header `x-agent-token`, NO con sesión.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const ingesta = async (req, res) => {
    try {
        const token = req.headers['x-agent-token'];
        if (!token) return await responseManager(401, 'Falta el token del agente', req, res, false);
        const data = await svc.registrarMetrica(req.models, req.io, String(token), matchedData(req));
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
