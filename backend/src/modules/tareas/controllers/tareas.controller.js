/**
 * Controller del módulo `tareas` (thin): input validado → service → responseManager.
 * La capa 2 de permisos (espacio ver/editar) la exige el service en cada operación.
 * Emite eventos de socket en las mutaciones (tarea:creada, tarea:estado, ...).
 */

import { matchedData } from 'express-validator';
import { responseManager } from '../../../kernel/index.js';
import * as tareaService from '../services/tarea.service.js';
import * as analisisService from '../services/analisis.service.js';
import * as archivoService from '../services/archivo.service.js';

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
 * GET /tareas/espacios — home del módulo: espacios visibles + mi resumen.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { espacios, miResumen, diasPorVencer }.
 */
export const home = async (req, res) => {
    try {
        const data = await tareaService.homeEspacios(req.models, req.user);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /tareas/asignables — usuarios que pueden recibir tareas.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con [{ id, nombre }].
 */
export const asignables = async (req, res) => {
    try {
        const data = await tareaService.usuariosAsignables(req.models);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /tareas/resumen — resumen por categorías (número y listado con la MISMA condición).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { categoria, conteos, grupos, espacios, espaciosFiltro }.
 */
export const resumen = async (req, res) => {
    try {
        const data = await tareaService.resumenCategorias(
            req.models, req.user, req.query.f, req.query.u, req.query.e
        );
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /tareas/analisis — pantalla de estadísticas del módulo (equipo, listas, rango, series).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con todos los bloques del análisis.
 */
export const analisis = async (req, res) => {
    try {
        const data = await analisisService.analisisTareas(req.models, req.user, matchedData(req));
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Listas ───────────────────────────

/**
 * GET /tareas/espacios/:eid/listas — listas del espacio con agregados.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { espacio, puedeEditar, listas }.
 */
export const listas = async (req, res) => {
    try {
        const data = await tareaService.listListas(req.models, req.user, req.params.eid);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /tareas/espacios/:eid/listas — crea una lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la lista creada.
 */
export const createLista = async (req, res) => {
    try {
        const data = matchedData(req);
        const lista = await tareaService.createLista(req.models, req.user, req.params.eid, data);
        if (req.io) req.io.to('app').emit('lista:created', lista);
        return await responseManager(201, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /tareas/espacios/:eid/listas/:lid — edita una lista.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la lista, o 404.
 */
export const updateLista = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.eid; delete data.lid;
        const lista = await tareaService.updateLista(req.models, req.user, req.params.eid, req.params.lid, data);
        if (!lista) return await responseManager(404, 'Lista no encontrada en este espacio', req, res, false);
        if (req.io) req.io.to('app').emit('lista:updated', lista);
        return await responseManager(200, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /tareas/espacios/:eid/listas/:lid/active — alterna `activa`.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la lista, o 404.
 */
export const toggleLista = async (req, res) => {
    try {
        const lista = await tareaService.toggleLista(req.models, req.user, req.params.eid, req.params.lid);
        if (!lista) return await responseManager(404, 'Lista no encontrada en este espacio', req, res, false);
        if (req.io) req.io.to('app').emit('lista:updated', lista);
        return await responseManager(200, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /tareas/espacios/:eid/listas/:lid/restore — reactiva una lista eliminada.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la lista, o 404.
 */
export const restoreLista = async (req, res) => {
    try {
        const lista = await tareaService.restoreLista(req.models, req.user, req.params.eid, req.params.lid);
        if (!lista) return await responseManager(404, 'Lista eliminada no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('lista:created', lista);
        return await responseManager(200, lista, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /tareas/espacios/:eid/listas/:lid — baja lógica (409 con tareas).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 404 o 409.
 */
export const removeLista = async (req, res) => {
    try {
        const ok = await tareaService.deleteLista(req.models, req.user, req.params.eid, req.params.lid);
        if (!ok) return await responseManager(404, 'Lista no encontrada en este espacio', req, res, false);
        if (req.io) req.io.to('app').emit('lista:deleted', { id: Number(req.params.lid) });
        return await responseManager(200, { message: 'Lista eliminada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Tareas ───────────────────────────

/**
 * GET /tareas/espacios/:eid/listas/:lid/tareas — listado central con filtros.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { espacio, lista, puedeEditar, tareas, total }.
 */
export const listTareas = async (req, res) => {
    try {
        const data = await tareaService.listTareas(req.models, req.user, req.params.eid, req.params.lid, req.query);
        return await responseManager(200, data, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /tareas/:id — detalle (historial + tiempo trabajado + adjuntos).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el detalle, o 404.
 */
export const getById = async (req, res) => {
    try {
        const tarea = await tareaService.getTarea(req.models, req.user, req.params.id);
        if (!tarea) return await responseManager(404, 'Tarea no encontrada', req, res, false);
        return await responseManager(200, tarea, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /tareas — crea una tarea.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el detalle creado.
 */
export const create = async (req, res) => {
    try {
        const data = matchedData(req);

        // `listaIds` = crear la misma tarea en varias listas (una tarea por lista, cada una
        // con su copia de los adjuntos). Se resuelve acá y no en otro endpoint para que el
        // alta sea un solo camino con las mismas validaciones.
        if (Array.isArray(data.listaIds) && data.listaIds.length) {
            const { creadas, errores } = await tareaService.createTareaEnListas(req.models, req.user, data, req.io);
            if (req.io) {
                for (const t of creadas) {
                    req.io.to('app').emit('tarea:creada', { id: t.id, espacioId: t.espacioId, listaId: t.listaId });
                }
            }
            return await responseManager(201, { creadas, errores }, req, res, false);
        }

        const tarea = await tareaService.createTarea(req.models, req.user, data, req.io);
        if (req.io) req.io.to('app').emit('tarea:creada', { id: tarea.id, espacioId: tarea.espacioId, listaId: tarea.listaId });
        return await responseManager(201, tarea, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PUT /tareas/:id — edición COMPLETA.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con el detalle, o 404.
 */
export const update = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const tarea = await tareaService.updateTareaCompleta(req.models, req.user, req.params.id, data, req.io);
        if (!tarea) return await responseManager(404, 'Tarea no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('tarea:actualizada', { id: tarea.id, espacioId: tarea.espacioId, listaId: tarea.listaId });
        return await responseManager(200, tarea, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /tareas/:id/rapida — edición RÁPIDA (no toca descripción ni estado).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la tarea, o 404.
 */
export const updateRapida = async (req, res) => {
    try {
        const data = matchedData(req);
        delete data.id;
        const tarea = await tareaService.updateTareaRapida(req.models, req.user, req.params.id, data, req.io);
        if (!tarea) return await responseManager(404, 'Tarea no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('tarea:actualizada', { id: tarea.id, espacioId: tarea.espacioId, listaId: tarea.listaId });
        return await responseManager(200, tarea, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /tareas/:id/estado — cambio rápido de estado (+ bitácora).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con { tarea, cambio }, o 404.
 */
export const estado = async (req, res) => {
    try {
        const { estado: nuevo } = matchedData(req);
        const r = await tareaService.cambiarEstado(req.models, req.user, req.params.id, nuevo, req.io);
        if (!r) return await responseManager(404, 'Tarea no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('tarea:estado', { id: r.tarea.id, espacioId: r.tarea.espacioId, estado: nuevo });
        const message = r.cambio ? 'Estado actualizado' : 'La tarea ya estaba en ese estado';
        return await responseManager(200, { tarea: r.tarea, cambio: r.cambio, message }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * PATCH /tareas/:id/mover — mueve la tarea a otra lista (mejora; valida ambos espacios).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 con la tarea, o 404.
 */
export const mover = async (req, res) => {
    try {
        const { listaId } = matchedData(req);
        const tarea = await tareaService.moverTarea(req.models, req.user, req.params.id, listaId);
        if (!tarea) return await responseManager(404, 'Tarea no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('tarea:actualizada', { id: tarea.id, espacioId: tarea.espacioId, listaId: tarea.listaId });
        return await responseManager(200, tarea, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /tareas/:id/clonar — duplica una tarea (opcionalmente en otra lista).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el detalle de la tarea nueva.
 */
export const clonar = async (req, res) => {
    try {
        const { id, ...opts } = matchedData(req);
        const tarea = await tareaService.clonarTarea(req.models, req.user, id, opts, req.io);
        if (req.io) req.io.to('app').emit('tarea:creada', { id: tarea.id, espacioId: tarea.espacioId, listaId: tarea.listaId });
        return await responseManager(201, tarea, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * POST /tareas/espacios/:eid/listas/:lid/clonar — duplica una lista con todas sus tareas.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con la lista nueva y cuántas tareas se clonaron, o 404.
 */
export const clonarLista = async (req, res) => {
    try {
        const { eid, lid, ...data } = matchedData(req);
        const r = await tareaService.clonarLista(req.models, req.user, eid, lid, data);
        if (!r) return await responseManager(404, 'Lista no encontrada', req, res, false);
        if (req.io) {
            req.io.to('app').emit('lista:created', r.lista);
            // Las tareas se emiten como UN evento de lista y no una por una: 40 tareas
            // clonadas serían 40 mensajes para decir «esta lista cambió toda».
            req.io.to('app').emit('lista:updated', { id: r.lista.id, espacioId: eid });
        }
        return await responseManager(201, r, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /tareas/:id — baja lógica (404 real si no existe).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200 o 404.
 */
export const remove = async (req, res) => {
    try {
        const ok = await tareaService.deleteTarea(req.models, req.user, req.params.id);
        if (!ok) return await responseManager(404, 'Tarea no encontrada', req, res, false);
        if (req.io) req.io.to('app').emit('tarea:eliminada', { id: Number(req.params.id) });
        return await responseManager(200, { message: 'Tarea eliminada' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Comentarios ───────────────────────────

/**
 * POST /tareas/:id/comentarios — agrega un comentario (menciones @username notifican).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con el comentario.
 */
export const addComentario = async (req, res) => {
    try {
        const { texto } = matchedData(req);
        const comentario = await tareaService.addComentario(req.models, req.user, req.params.id, texto, req.io);
        if (req.io) req.io.to('app').emit('tarea:comentario', { tareaId: Number(req.params.id) });
        return await responseManager(201, comentario, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * DELETE /tareas/comentarios/:id — elimina un comentario (autor o admin).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 403 o 404.
 */
export const deleteComentario = async (req, res) => {
    try {
        const ok = await tareaService.deleteComentario(req.models, req.user, req.params.id);
        if (!ok) return await responseManager(404, 'Comentario no encontrado', req, res, false);
        return await responseManager(200, { message: 'Comentario eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

// ─────────────────────────── Archivos ───────────────────────────

/**
 * POST /tareas/archivos — sube imagen o adjunto. Autorización del legado: editar en AL MENOS
 * un espacio (el control fino ocurre al guardar la tarea). Con `tareaId`, exige editar el
 * espacio de esa tarea (adjunto directo).
 * @param {import('express').Request} req - Request (multipart, campo `archivo`).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 201 con { nombre, url, tipo }.
 */
export const subirArchivo = async (req, res) => {
    try {
        if (!req.file) return await responseManager(400, 'No se pudo subir el archivo', req, res, false);
        const tareaId = req.body.tareaId ? Number(req.body.tareaId) : null;

        if (tareaId) {
            const tarea = await req.models.Tarea.findByPk(tareaId);
            if (!tarea) return await responseManager(404, 'Tarea no encontrada', req, res, false);
            const { exigirEspacioEditar } = await import('../../espacios/services/espacio.service.js');
            await exigirEspacioEditar(req.models, req.user, tarea.espacioId);
        } else if (!(await tareaService.editaEnAlgunEspacio(req.models, req.user))) {
            return await responseManager(403, 'No tenés permiso para editar tareas', req, res, false);
        }

        // `destino` lo manda el front: 'adjunto' desde el botón «Adjuntar», 'editor' (default)
        // para las imágenes que se pegan en la descripción. Solo cambia la clasificación; las
        // defensas sobre el contenido son las mismas en los dos casos.
        const destino = req.body.destino === 'adjunto' ? 'adjunto' : 'editor';
        const archivo = await archivoService.guardarArchivo(req.models, req.file, req.user.id, tareaId, destino);
        return await responseManager(201, archivo, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};

/**
 * GET /tareas/archivos/:nombre — sirve el binario con headers defensivos (nosniff + CSP +
 * cache privado). Respuesta binaria: acá NO va responseManager (envelope JSON) a propósito.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} El binario, o 404 vacío.
 */
export const servirArchivo = async (req, res) => {
    try {
        const archivo = await archivoService.leerArchivo(req.models, req.params.nombre);
        if (!archivo) return res.status(404).end();
        res.set({
            'Content-Type': archivo.mime,
            // Imágenes inline (el editor las embebe); adjuntos como descarga con su nombre real.
            'Content-Disposition': archivo.tipo === 'imagen'
                ? 'inline'
                : `attachment; filename="${encodeURIComponent(archivo.nombreOriginal)}"`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; img-src 'self'",
            'Cache-Control': 'private, max-age=86400'
        });
        return res.send(archivo.buffer);
    } catch {
        return res.status(404).end();
    }
};

/**
 * DELETE /tareas/archivos/:id — elimina un adjunto (editar en el espacio de su tarea;
 * un archivo sin tarea solo lo borra quien lo subió).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} 200, 403 o 404.
 */
export const eliminarArchivo = async (req, res) => {
    try {
        const registro = await req.models.TareaArchivo.findByPk(req.params.id);
        if (!registro) return await responseManager(404, 'Archivo no encontrado', req, res, false);

        if (registro.tareaId) {
            const tarea = await req.models.Tarea.findByPk(registro.tareaId, { paranoid: false });
            if (tarea) {
                const { exigirEspacioEditar } = await import('../../espacios/services/espacio.service.js');
                await exigirEspacioEditar(req.models, req.user, tarea.espacioId);
            }
        } else if (registro.userId !== req.user.id) {
            return await responseManager(403, 'Solo quien subió el archivo puede eliminarlo', req, res, false);
        }

        await archivoService.eliminarArchivo(req.models, registro.id);
        return await responseManager(200, { message: 'Archivo eliminado' }, req, res, false);
    } catch (e) { return bizCatch(e, req, res); }
};
