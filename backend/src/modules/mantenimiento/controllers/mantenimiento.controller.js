/**
 * Controller del módulo `mantenimiento` (thin): input validado → service → responseManager.
 *
 * `ingesta` es el único endpoint que NO se autentica con sesión: lo llama el agente de cada
 * servidor con su token (por eso su ruta se monta fuera de verifyAccessToken).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { matchedData } from 'express-validator';
import { responseManager, getRoleCapabilities, roleHasCapability } from '../../../kernel/index.js';
import * as svc from '../services/servidor.service.js';
import * as sitios from '../services/sitio.service.js';
import { chequearSitio } from '../services/chequeo.service.js';
import { urlDeVista, marcadorDeVista } from '../services/vista.service.js';
import * as vistasSvc from '../services/vista.service.js';
import { velocidadDeSitio } from '../services/velocidad.service.js';
import { vencimientoDominio } from '../services/rdap.service.js';
import * as trabajos from '../services/trabajo.service.js';

/** Carpeta de este controller, para ubicar los scripts del agente fuera de `src/`. */
const __dirnameCtrl = path.dirname(fileURLToPath(import.meta.url));

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
        // El hash viaja en la MISMA respuesta del reporte: el agente ya hace este ida y vuelta
        // cada minuto, así que la autoactualización no agrega ni una petición.
        return await responseManager(200, {
            ...data,
            agenteHash: hashScriptAgente('agente-sistema-interno.sh'),
        }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/* ──────────────── FullGlass: SQL masivo y deploy (lado interno) ──────────────── */

/**
 * Exige una capability DENTRO del controller.
 *
 * Hace falta porque `POST /trabajos` sirve los dos tipos y cada uno pide la suya: un mismo
 * endpoint no puede declararla como middleware. Devuelve false habiendo respondido ya el 403.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {string} cap - Capability requerida.
 * @returns {Promise<boolean>} true si puede seguir.
 */
const puede = async (req, res, cap) => {
    const caps = await getRoleCapabilities(req.models, req.tenant?.id || 'default', req.user?.roleId);
    if (roleHasCapability(caps, cap)) return true;
    await responseManager(403, `No tenés el permiso requerido: ${cap}`, req, res, false);
    return false;
};

/** Capability de ejecución que corresponde a cada tipo de trabajo. */
// Cambiar de rama es de la misma clase que un deploy —decide qué código corre el cliente— así
// que reusa su capability en vez de crear una quinta que nacería sin que nadie la tenga.
const CAP_EJECUTAR = {
    sql: 'servidores:bd-ejecutar',
    deploy: 'servidores:deploy-ejecutar',
    rama: 'servidores:deploy-ejecutar',
};

/**
 * Deja pasar si tiene CUALQUIERA de las dos capabilities de ejecución (para leer el historial).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<boolean>} true si puede seguir.
 */
const puedeAlguna = async (req, res) => {
    const caps = await getRoleCapabilities(req.models, req.tenant?.id || 'default', req.user?.roleId);
    if (Object.values(CAP_EJECUTAR).some(c => roleHasCapability(caps, c))) return true;
    await responseManager(403, 'No tenés permiso para ver las ejecuciones de los servidores', req, res, false);
    return false;
};

/**
 * Exige la capability del TIPO del trabajo al que se apunta (aprobar / cancelar).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<boolean>} true si puede seguir.
 */
const puedeDelTrabajo = async (req, res) => {
    const trabajo = await req.models.ServidorTrabajo.findByPk(Number(req.params.id), { attributes: ['tipo'] });
    if (!trabajo) { await responseManager(404, 'Trabajo no encontrado', req, res, false); return false; }
    return puede(req, res, CAP_EJECUTAR[trabajo.tipo]);
};

/**
 * PUT /mantenimiento/servidores/:id/config-bd — ruta que recorre el agente.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const configBd = async (req, res) => {
    try {
        const { id, ...config } = matchedData(req);
        const data = await svc.updateServidor(req.models, id, config);
        if (!data) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /mantenimiento/servidores/:id/config-deploy — comandos de producción y desarrollo.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const configDeploy = async (req, res) => {
    try {
        const { id, ...comandos } = matchedData(req);
        const data = await svc.updateServidor(req.models, id, comandos);
        if (!data) return await responseManager(404, 'Servidor no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/trabajos/analizar — qué tiene de peligroso un SQL, ANTES de lanzarlo.
 * Puro: no crea nada. Es lo que alimenta el cartel de confirmación de la pantalla.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const analizarSql = async (req, res) => {
    try {
        const { sql } = matchedData(req);
        return await responseManager(200, trabajos.analizarSql(sql), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/trabajos — lanza un lote (un trabajo por servidor elegido).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con `{ loteId, trabajos }`.
 */
export const crearTrabajos = async (req, res) => {
    try {
        const datos = matchedData(req);
        if (!await puede(req, res, CAP_EJECUTAR[datos.tipo])) return undefined;
        const data = await trabajos.crearLote(req.models, req.user, datos);
        if (req.io) req.io.to('app').emit('servidor:trabajos', { loteId: data.loteId });
        return await responseManager(201, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /mantenimiento/trabajos — historial (filtros: servidorId, tipo, estado).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const listTrabajos = async (req, res) => {
    try {
        // Ver el historial de SQL alcanza con poder ejecutar CUALQUIERA de las dos: el listado
        // mezcla los dos tipos y filtrarlo por capability fila a fila sería confuso de leer.
        if (!await puedeAlguna(req, res)) return undefined;
        return await responseManager(200, await trabajos.listTrabajos(req.models, req.query), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /mantenimiento/trabajos/:id — un trabajo con su detalle base por base.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 404 si no existe.
 */
export const getTrabajo = async (req, res) => {
    try {
        if (!await puedeAlguna(req, res)) return undefined;
        const data = await trabajos.getTrabajo(req.models, req.params.id);
        if (!data) return await responseManager(404, 'Trabajo no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/trabajos/:id/aprobar — seguir con el resto tras un canario OK.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const aprobarTrabajo = async (req, res) => {
    try {
        // Aprobar el canario es decidir que el SQL se aplique a TODO: pide la de ejecutar.
        if (!await puedeDelTrabajo(req, res)) return undefined;
        const data = await trabajos.aprobarTrabajo(req.models, req.user, req.params.id);
        if (req.io) req.io.to('app').emit('servidor:trabajos', { id: data.id });
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /mantenimiento/trabajos/:id/cancelar — frenar lo que el agente todavía no tomó.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const cancelarTrabajo = async (req, res) => {
    try {
        if (!await puedeDelTrabajo(req, res)) return undefined;
        const data = await trabajos.cancelarTrabajo(req.models, req.params.id);
        if (req.io) req.io.to('app').emit('servidor:trabajos', { id: data.id });
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /mantenimiento/servidores/:id/sitios — inventario para la vista previa.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const listSitiosServidor = async (req, res) => {
    try {
        return await responseManager(200, await trabajos.listSitios(req.models, req.params.id), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/* ──────────────── FullGlass: lado del AGENTE (token, sin sesión) ──────────────── */

/**
 * Resuelve el servidor desde el header `x-agent-token`, o responde el error y devuelve null.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<object|null>} El servidor, o null si ya se respondió el error.
 */
const servidorDelAgente = async (req, res) => {
    const token = req.headers['x-agent-token'];
    if (!token) { await responseManager(401, 'Falta el token del agente', req, res, false); return null; }
    try {
        return await svc.servidorPorToken(req.models, String(token));
    } catch (e) {
        await bizCatch(e, req, res);
        return null;
    }
};

/**
 * Hash de uno de los scripts del agente, para que cada servidor sepa si el suyo quedó viejo.
 *
 * Se cachea por mtime: lo piden TODOS los agentes en CADA ronda, y leer y hashear el archivo
 * en cada request sería trabajo repetido para un dato que solo cambia en los deploys.
 * @param {string} archivo - Nombre del script en `backend/agente/`.
 * @returns {string|null} sha256, o null si no se puede leer.
 */
const cacheHash = {};
const hashScriptAgente = (archivo) => {
    try {
        const ruta = path.resolve(__dirnameCtrl, '../../../../agente/', archivo);
        const stat = fs.statSync(ruta);
        const cache = cacheHash[archivo];
        if (!cache || stat.mtimeMs !== cache.mtime) {
            cacheHash[archivo] = {
                mtime: stat.mtimeMs,
                hash: crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex'),
            };
        }
        return cacheHash[archivo].hash;
    } catch {
        // Sin hash no hay autoactualización, pero el agente sigue trabajando: un problema para
        // leer el archivo no puede dejar a todos los servidores sin reportar.
        return null;
    }
};

/**
 * GET /agente/config — lo que el agente necesita saber de SU configuración.
 *
 * Existe para que la ruta a recorrer viva en UN solo lugar (la ficha del servidor). Si se
 * guardara también en el `.env` del VPS, el día que alguien la cambie en la app el agente
 * seguiría recorriendo la vieja y nadie se enteraría.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const agenteConfig = async (req, res) => {
    const servidor = await servidorDelAgente(req, res);
    if (!servidor) return undefined;
    return await responseManager(200, {
        tieneFullglass: servidor.tieneFullglass,
        rutaSitios: servidor.rutaSitios,
        // Dónde leer la rama dentro del config_site.php de cada cliente.
        claveRama: servidor.claveRama,
        // Con esto el agente compara contra su propia copia y se actualiza solo si quedó vieja.
        workerHash: hashScriptAgente('fullglass-worker.php'),
    }, req, res, false);
};

/**
 * GET /agente/trabajos — qué tiene para ejecutar este servidor.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const agenteTrabajos = async (req, res) => {
    const servidor = await servidorDelAgente(req, res);
    if (!servidor) return undefined;
    try {
        return await responseManager(200, await trabajos.trabajosPendientes(req.models, servidor), req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /agente/trabajos/:id/tomar — el agente avisa que lo empezó.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const agenteTomar = async (req, res) => {
    const servidor = await servidorDelAgente(req, res);
    if (!servidor) return undefined;
    try {
        const ok = await trabajos.marcarTomado(req.models, servidor, req.params.id);
        if (!ok) return await responseManager(409, 'El trabajo ya no está disponible', req, res, false);
        if (req.io) req.io.to('app').emit('servidor:trabajos', { id: Number(req.params.id) });
        return await responseManager(200, { tomado: true }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /agente/trabajos/:id/resultado — cómo terminó (o cómo le fue al canario).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const agenteResultado = async (req, res) => {
    const servidor = await servidorDelAgente(req, res);
    if (!servidor) return undefined;
    try {
        const data = await trabajos.reportarResultado(req.models, servidor, req.params.id, req.body || {});
        if (!data) return await responseManager(404, 'Trabajo no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('servidor:trabajos', { id: data.id, estado: data.estado });
        return await responseManager(200, { estado: data.estado }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /agente/sitios — inventario de sitios del servidor (para la vista previa).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const agenteSitios = async (req, res) => {
    const servidor = await servidorDelAgente(req, res);
    if (!servidor) return undefined;
    try {
        const n = await trabajos.guardarInventario(req.models, servidor, req.body?.sitios);
        return await responseManager(200, { sitios: n }, req, res, false);
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
