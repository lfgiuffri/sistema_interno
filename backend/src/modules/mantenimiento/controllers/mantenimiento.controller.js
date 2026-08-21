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
import { urlDeVista, marcadorDeVista } from '../services/vista.service.js';
import * as vistasSvc from '../services/vista.service.js';
import { velocidadDeSitio } from '../services/velocidad.service.js';
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

        // Se chequean TODAS las vistas activas: el usuario apretó «chequear este sitio», y con
        // varias URLs mirar solo la raíz respondería por la parte que no le preocupaba.
        const vistas = await req.models.SitioVista.findAll({
            where: { sitioId: sitio.id, activo: true }, order: [['orden', 'ASC']],
        });
        if (!vistas.length) return await responseManager(400, 'El sitio no tiene ninguna vista activa que chequear', req, res, false);

        const GRAVEDAD = { offline: 3, sin_marcador: 2, desconocido: 1, online: 0 };
        const resultados = [];
        let peor = 'online';
        let peorTiempo = null;
        let tlsLeido = null;

        for (const vista of vistas) {
            const url = urlDeVista(sitio.url, vista.ruta);
            const marcador = await marcadorDeVista(req.models, vista);
            const r = await chequearSitio(url, vista.verificaMarcador, marcador);

            await req.models.SitioChequeo.create({
                sitioId: sitio.id, vistaId: vista.id, estado: r.estado, httpStatus: r.httpStatus,
                tiempoMs: r.tiempoMs, motivo: r.motivo?.slice(0, 200) ?? null, createdAt: new Date(),
            });
            // El chequeo manual SÍ actualiza el estado de la vista (es el dato más fresco que
            // hay), pero no toca `fallosSeguidos`: el contador de alertas es del scheduler y
            // apretar el botón tres veces no debería disparar un aviso.
            await vista.update({
                estado: r.estado, ultimoChequeoAt: new Date(), ultimoCodigo: r.httpStatus, tiempoMs: r.tiempoMs,
            });

            resultados.push({ vistaId: vista.id, ruta: vista.ruta, nombre: vista.nombre, ...r });
            if (GRAVEDAD[r.estado] > GRAVEDAD[peor]) peor = r.estado;
            if (r.tiempoMs != null && (peorTiempo == null || r.tiempoMs > peorTiempo)) peorTiempo = r.tiempoMs;
            if (!tlsLeido && r.tlsVenceAt) tlsLeido = r.tlsVenceAt;
        }

        await sitio.update({
            estado: peor, ultimoChequeoAt: new Date(), tiempoMs: peorTiempo,
            ...(tlsLeido ? { tlsVenceAt: tlsLeido } : {}),
        });
        if (req.io) req.io.to('app').emit('sitio:updated', { id: sitio.id });

        // Se conserva la forma vieja de la respuesta (estado/tiempoMs/motivo del conjunto) y se
        // suma el detalle por vista: así el frontend que solo mostraba un toast sigue andando.
        const peorResultado = resultados.find(r => r.estado === peor) ?? resultados[0];
        return await responseManager(200, {
            estado: peor,
            tiempoMs: peorTiempo,
            motivo: peorResultado?.motivo ?? null,
            tlsVenceAt: tlsLeido,
            vistas: resultados,
        }, req, res, false);
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

/* ────────────────────────── Vistas de un sitio ────────────────────────── */

/**
 * GET /mantenimiento/sitios/:id/vistas — las URLs que se chequean del sitio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const listVistas = async (req, res) => {
    try {
        return await responseManager(200, await vistasSvc.listVistas(req.models, req.params.id), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/sitios/:id/vistas — agrega una vista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const createVista = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const vista = await vistasSvc.createVista(req.models, id, data);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: Number(id) });
        return await responseManager(201, vista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /mantenimiento/sitios/vistas/:id — edita una vista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const updateVista = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const vista = await vistasSvc.updateVista(req.models, id, data);
        if (!vista) return await responseManager(404, 'Vista no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: vista.sitioId });
        return await responseManager(200, vista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /mantenimiento/sitios/vistas/:id/active — activa/desactiva el chequeo de la vista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const toggleVista = async (req, res) => {
    try {
        const vista = await vistasSvc.toggleVista(req.models, req.params.id);
        if (!vista) return await responseManager(404, 'Vista no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: vista.sitioId });
        return await responseManager(200, vista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /mantenimiento/sitios/vistas/:id — baja lógica (la última vista no se elimina).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const removeVista = async (req, res) => {
    try {
        const vista = await req.models.SitioVista.findByPk(req.params.id);
        const ok = await vistasSvc.deleteVista(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Vista no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: vista.sitioId });
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /mantenimiento/sitios/:id/vistas/orden — reordena las vistas del sitio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const reordenarVistas = async (req, res) => {
    try {
        const { id, ids } = matchedData(req);
        const out = await vistasSvc.reordenarVistas(req.models, id, ids);
        if (req.io) req.io.to('app').emit('sitio:updated', { id: Number(id) });
        return await responseManager(200, out, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /mantenimiento/sitios/:id/velocidad — serie de velocidad por día, mes o año.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const velocidadSitio = async (req, res) => {
    try {
        const sitio = await req.models.SitioWeb.findByPk(req.params.id);
        if (!sitio) return await responseManager(404, 'Sitio no encontrado', req, res, false);
        const data = await velocidadDeSitio(req.models, Number(req.params.id), {
            granularidad: req.query.granularidad,
            vistaId: req.query.vistaId,
        });
        return await responseManager(200, { sitio: { id: sitio.id, nombre: sitio.nombre, url: sitio.url }, ...data }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
