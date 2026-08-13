/**
 * Controller del módulo `documentacion` (thin): input validado → service → responseManager.
 * Emite eventos de socket en las mutaciones para que otras sesiones refresquen.
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import * as espacioService from '../services/docEspacio.service.js';
import * as docService from '../services/documento.service.js';
import * as archivoService from '../services/archivoDoc.service.js';

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

// ─── Espacios de documentación ───────────────────────────────────────────────────────

/**
 * GET /documentacion/espacios — home: los espacios que el usuario puede ver, con conteos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los espacios visibles.
 */
export const home = async (req, res) => {
    try {
        const rows = await espacioService.homeDocEspacios(req.models, req.user);
        return await responseManager(200, rows, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/admin/espacios — listado de administración (todos, con accesos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los espacios.
 */
export const listEspacios = async (req, res) => {
    try {
        const rows = await espacioService.listDocEspacios(req.models);
        return await responseManager(200, rows, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /documentacion/admin/espacios — crea un espacio (el creador queda con acceso total).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el espacio creado.
 */
export const createEspacio = async (req, res) => {
    try {
        const espacio = await espacioService.createDocEspacio(req.models, matchedData(req), req.user.id);
        if (req.io) req.io.to('app').emit('doc-espacio:created', espacio);
        return await responseManager(201, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /documentacion/admin/espacios/:id — edita un espacio.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio, o 404.
 */
export const updateEspacio = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const espacio = await espacioService.updateDocEspacio(req.models, id, data);
        if (!espacio) return await responseManager(404, 'Espacio de documentación no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('doc-espacio:updated', espacio);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/admin/espacios/:id/active — activa/desactiva.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio, o 404.
 */
export const toggleEspacio = async (req, res) => {
    try {
        const espacio = await espacioService.toggleDocEspacio(req.models, req.params.id);
        if (!espacio) return await responseManager(404, 'Espacio de documentación no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('doc-espacio:updated', espacio);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/admin/espacios/:id/restore — reactiva un espacio eliminado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el espacio, o 404.
 */
export const restoreEspacio = async (req, res) => {
    try {
        const espacio = await espacioService.restoreDocEspacio(req.models, req.params.id);
        if (!espacio) return await responseManager(404, 'Espacio eliminado no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('doc-espacio:updated', espacio);
        return await responseManager(200, espacio, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /documentacion/admin/espacios/:id — elimina (soft) si está vacío.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, 404 si no existe, 409 si tiene contenido.
 */
export const removeEspacio = async (req, res) => {
    try {
        const ok = await espacioService.deleteDocEspacio(req.models, req.params.id);
        if (!ok) return await responseManager(404, 'Espacio de documentación no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('doc-espacio:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/admin/espacios/:id/accesos — matriz del eje ESPACIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las filas, o 404.
 */
export const getAccesos = async (req, res) => {
    try {
        const filas = await espacioService.getMatrizDocEspacio(req.models, req.params.id);
        if (!filas) return await responseManager(404, 'Espacio de documentación no encontrado', req, res, false);
        return await responseManager(200, filas, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /documentacion/admin/espacios/:id/accesos — guarda la matriz del eje ESPACIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si guardó, o 404.
 */
export const setAccesos = async (req, res) => {
    try {
        const { id, accesos } = matchedData(req);
        const ok = await espacioService.setMatrizDocEspacio(req.models, id, accesos);
        if (!ok) return await responseManager(404, 'Espacio de documentación no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('doc-espacio:accesos', { id: Number(id) });
        return await responseManager(200, { id: Number(id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/admin/usuarios/:userId/espacios — matriz del eje USUARIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la matriz, o 404.
 */
export const getAccesosUsuario = async (req, res) => {
    try {
        const data = await espacioService.getDocEspaciosUsuario(req.models, req.params.userId);
        if (!data) return await responseManager(404, 'Usuario no encontrado', req, res, false);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /documentacion/admin/usuarios/:userId/espacios — guarda la matriz del eje USUARIO.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si guardó, o 404.
 */
export const setAccesosUsuario = async (req, res) => {
    try {
        const { userId, espacios } = matchedData(req);
        const ok = await espacioService.setDocEspaciosUsuario(req.models, userId, espacios);
        if (!ok) return await responseManager(404, 'Usuario no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('doc-espacio:accesos', { userId: Number(userId) });
        return await responseManager(200, { userId: Number(userId) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Listas ──────────────────────────────────────────────────────────────────────────

/**
 * GET /documentacion/espacios/:eid/listas — listas del espacio con conteos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con espacio + listas.
 */
export const listas = async (req, res) => {
    try {
        const data = await docService.listListas(req.models, req.user, req.params.eid);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /documentacion/espacios/:eid/listas — crea una lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la lista creada.
 */
export const createLista = async (req, res) => {
    try {
        const { eid, ...data } = matchedData(req);
        const lista = await docService.createLista(req.models, req.user, eid, data);
        if (req.io) req.io.to('app').emit('doc-lista:created', lista);
        return await responseManager(201, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /documentacion/espacios/:eid/listas/:lid — edita una lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la lista, o 404.
 */
export const updateLista = async (req, res) => {
    try {
        const { eid, lid, ...data } = matchedData(req);
        const lista = await docService.updateLista(req.models, req.user, eid, lid, data);
        if (!lista) return await responseManager(404, 'Lista no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('doc-lista:updated', lista);
        return await responseManager(200, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/espacios/:eid/listas/:lid/active — activa/desactiva una lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la lista, o 404.
 */
export const toggleLista = async (req, res) => {
    try {
        const lista = await docService.toggleLista(req.models, req.user, req.params.eid, req.params.lid);
        if (!lista) return await responseManager(404, 'Lista no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('doc-lista:updated', lista);
        return await responseManager(200, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/espacios/:eid/listas/:lid/restore — reactiva una lista eliminada.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la lista, o 404.
 */
export const restoreLista = async (req, res) => {
    try {
        const lista = await docService.restoreLista(req.models, req.user, req.params.eid, req.params.lid);
        if (!lista) return await responseManager(404, 'Lista eliminada no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('doc-lista:updated', lista);
        return await responseManager(200, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /documentacion/espacios/:eid/listas/:lid — elimina una lista vacía.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, 404 si no existe, 409 si tiene documentos.
 */
export const removeLista = async (req, res) => {
    try {
        const ok = await docService.deleteLista(req.models, req.user, req.params.eid, req.params.lid);
        if (!ok) return await responseManager(404, 'Lista no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('doc-lista:deleted', { id: Number(req.params.lid) });
        return await responseManager(200, { id: Number(req.params.lid) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/espacios/:eid/listas/orden — reordena las listas (drag & drop).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la cantidad reordenada.
 */
export const ordenarListas = async (req, res) => {
    try {
        const { eid, ids } = matchedData(req);
        const n = await docService.reordenarListas(req.models, req.user, eid, ids);
        if (req.io) req.io.to('app').emit('doc-lista:orden', { docEspacioId: Number(eid) });
        return await responseManager(200, { reordenadas: n }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Documentos ──────────────────────────────────────────────────────────────────────

/**
 * GET /documentacion/espacios/:eid/listas/:lid/documentos — documentos de una lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con espacio + lista + documentos.
 */
export const listDocumentos = async (req, res) => {
    try {
        const data = await docService.listDocumentos(req.models, req.user, req.params.eid, req.params.lid);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/buscar?q= — busca por título y contenido en los espacios visibles.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con los resultados.
 */
export const buscar = async (req, res) => {
    try {
        const rows = await docService.buscarDocumentos(req.models, req.user, matchedData(req));
        return await responseManager(200, rows, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/documentos/:id — documento completo (cuerpo saneado + adjuntos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el documento, o 404.
 */
export const getDocumento = async (req, res) => {
    try {
        const doc = await docService.getDocumento(req.models, req.user, req.params.id);
        if (!doc) return await responseManager(404, 'Documento no encontrado', req, res, false);
        return await responseManager(200, doc, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /documentacion/documentos — crea un documento.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el documento creado.
 */
export const createDocumento = async (req, res) => {
    try {
        const doc = await docService.createDocumento(req.models, req.user, matchedData(req));
        if (req.io) req.io.to('app').emit('documento:created', { id: doc.id, docListaId: doc.docListaId });
        return await responseManager(201, doc, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /documentacion/documentos/:id — edita un documento (archiva la versión anterior).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el documento, o 404.
 */
export const updateDocumento = async (req, res) => {
    try {
        const { id, ...data } = matchedData(req);
        const doc = await docService.updateDocumento(req.models, req.user, id, data);
        if (!doc) return await responseManager(404, 'Documento no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('documento:updated', { id: doc.id, docListaId: doc.docListaId });
        return await responseManager(200, doc, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/documentos/:id/mover — mueve el documento a otra lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el documento, o 404.
 */
export const moverDocumento = async (req, res) => {
    try {
        const { id, ...destino } = matchedData(req);
        const doc = await docService.moverDocumento(req.models, req.user, id, destino);
        if (!doc) return await responseManager(404, 'Documento no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('documento:updated', { id: doc.id, docListaId: doc.docListaId });
        return await responseManager(200, doc, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /documentacion/espacios/:eid/listas/:lid/documentos/orden — reordena (drag & drop).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la cantidad reordenada.
 */
export const ordenarDocumentos = async (req, res) => {
    try {
        const { eid, lid, ids } = matchedData(req);
        const n = await docService.reordenarDocumentos(req.models, req.user, eid, lid, ids);
        if (req.io) req.io.to('app').emit('documento:orden', { docListaId: Number(lid) });
        return await responseManager(200, { reordenados: n }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /documentacion/documentos/:id — elimina (soft) un documento.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, o 404.
 */
export const removeDocumento = async (req, res) => {
    try {
        const ok = await docService.deleteDocumento(req.models, req.user, req.params.id);
        if (!ok) return await responseManager(404, 'Documento no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('documento:deleted', { id: Number(req.params.id) });
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/documentos/:id/versiones — historial de versiones.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con las versiones, o 404.
 */
export const listVersiones = async (req, res) => {
    try {
        const versiones = await docService.listVersiones(req.models, req.user, req.params.id);
        if (!versiones) return await responseManager(404, 'Documento no encontrado', req, res, false);
        return await responseManager(200, versiones, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /documentacion/documentos/:id/versiones/:vid/restaurar — restaura una versión.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el documento resultante, o 404.
 */
export const restaurarVersion = async (req, res) => {
    try {
        const doc = await docService.restaurarVersion(req.models, req.user, req.params.id, req.params.vid);
        if (!doc) return await responseManager(404, 'Documento no encontrado', req, res, false);
        if (req.io) req.io.to('app').emit('documento:updated', { id: doc.id, docListaId: doc.docListaId });
        return await responseManager(200, doc, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─── Archivos ────────────────────────────────────────────────────────────────────────

/**
 * POST /documentacion/archivos — sube una imagen del editor o un adjunto.
 * Autorización: hay que poder EDITAR el espacio del documento (o alguno, si todavía no
 * está ligado, porque es una imagen que se está pegando en un documento nuevo).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el registro del archivo.
 */
export const subirArchivo = async (req, res) => {
    try {
        const documentoId = req.body?.documentoId ? Number(req.body.documentoId) : null;

        if (documentoId) {
            const doc = await req.models.Documento.findByPk(documentoId);
            if (!doc) return await responseManager(404, 'Documento no encontrado', req, res, false);
            await espacioService.exigirDocEspacioEditar(req.models, req.user, doc.docEspacioId);
        } else {
            // Imagen suelta del editor: alcanza con poder editar en ALGÚN espacio.
            const permisos = await espacioService.getDocEspacioPermisos(req.models, req.user);
            if (!Object.values(permisos).some(p => p.editar)) {
                return await responseManager(403, 'No tenés permiso para subir archivos de documentación', req, res, false);
            }
        }

        const archivo = await archivoService.guardarArchivo(req.models, req.file, req.user.id, documentoId);
        return await responseManager(201, archivo, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /documentacion/archivos/:nombre — sirve el binario con headers defensivos.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El archivo, o 404.
 */
export const servirArchivo = async (req, res) => {
    try {
        const archivo = await archivoService.leerArchivo(req.models, req.params.nombre);
        if (!archivo) return await responseManager(404, 'Archivo no encontrado', req, res, false);

        res.setHeader('Content-Type', archivo.mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'private, max-age=300');
        // Las imágenes se muestran inline; el resto se descarga (nunca se ejecuta en el sitio).
        const disp = archivo.tipo === 'imagen' ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition', `${disp}; filename="${encodeURIComponent(archivo.nombreOriginal)}"`);
        return res.send(archivo.buffer);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /documentacion/archivos/:id — elimina un archivo (registro + binario).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 si se eliminó, o 404.
 */
export const eliminarArchivo = async (req, res) => {
    try {
        const registro = await req.models.DocumentoArchivo.findByPk(req.params.id);
        if (!registro) return await responseManager(404, 'Archivo no encontrado', req, res, false);

        // Si ya está ligado a un documento, hay que poder editar ESE espacio.
        if (registro.documentoId) {
            const doc = await req.models.Documento.findByPk(registro.documentoId);
            if (doc) await espacioService.exigirDocEspacioEditar(req.models, req.user, doc.docEspacioId);
        }

        await archivoService.eliminarArchivo(req.models, req.params.id);
        return await responseManager(200, { id: Number(req.params.id) }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
