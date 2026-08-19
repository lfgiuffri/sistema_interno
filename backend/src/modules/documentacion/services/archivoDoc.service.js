/**
 * Archivos del módulo de documentación: imágenes embebidas en el cuerpo + ADJUNTOS
 * (el caso "la documentación ES un PDF").
 *
 * Las defensas (firma binaria, lista blanca, límites, nombre aleatorio) viven UNA sola vez
 * en `services/archivos/archivoPrivado.service.js`, compartidas con tareas; acá queda lo
 * propio del módulo: el directorio `storage/documentacion`, la tabla índice
 * `documento_archivos` y el ligado de imágenes al documento para el GC.
 */

import path from 'path';
import {
    NOMBRE_RE, resolverArchivo, escribirBinario, leerBinario, borrarBinario,
} from '../../../services/archivos/archivoPrivado.service.js';

/** Directorio privado de archivos (cwd del backend; NO está bajo public/). */
const STORAGE_DIR = () => path.resolve(process.cwd(), process.env.DOCUMENTACION_STORAGE_DIR || 'storage/documentacion');

// Re-export: el controller valida el nombre con esta regex antes de servir.
export { NOMBRE_RE };

/**
 * Error de negocio con status (el controller lo mapea al envelope).
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje para el usuario.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/**
 * Guarda un archivo subido (imagen o adjunto) en el storage privado + registra el índice.
 * @param {object} models - Modelos de la app.
 * @param {object} file - Archivo de multer ({ buffer, originalname, size }).
 * @param {number} userId - Usuario que sube.
 * @param {number|null} [documentoId] - Documento al que se adjunta (null = todavía no existe).
 * @param {'editor'|'adjunto'} [destino] - Si viene del editor (imagen del cuerpo) o del botón
 *   «Adjuntar». Decide la clasificación: una imagen adjuntada queda como `archivo` para que
 *   aparezca en la lista de adjuntos y no se confunda con las embebidas en el cuerpo.
 * @returns {Promise<object>} Registro creado ({ id, nombre, url, tipo, ... }).
 * @throws {Error} 400 con mensaje concreto si el archivo no pasa las defensas.
 */
export const guardarArchivo = async (models, file, userId, documentoId = null, destino = 'editor') => {
    const { tipo, mime, nombre } = resolverArchivo(file, destino);

    // Si adjunta a un documento, el documento tiene que existir (el permiso lo valida el controller).
    if (documentoId) {
        const doc = await models.Documento.findByPk(documentoId);
        if (!doc) throw bizError(404, 'Documento no encontrado');
    }

    await escribirBinario(STORAGE_DIR(), nombre, file.buffer);

    const registro = await models.DocumentoArchivo.create({
        nombre,
        nombreOriginal: (file.originalname || nombre).slice(0, 200),
        tipo,
        mime,
        size: file.size,
        documentoId: documentoId || null,
        userId
    });

    return { ...registro.toJSON(), url: `/api/documentacion/archivos/${nombre}` };
};

/**
 * Devuelve un archivo para servir (buffer + headers). El nombre se valida por regex ANTES
 * de tocar el disco; cualquier otra cosa es 404 (la seguridad es el nombre aleatorio de
 * 80 bits + la sesión, igual que en tareas).
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre en disco.
 * @returns {Promise<{buffer: Buffer, mime: string, nombreOriginal: string, tipo: string}|null>}
 */
export const leerArchivo = async (models, nombre) => {
    if (!NOMBRE_RE.test(String(nombre || ''))) return null;
    const registro = await models.DocumentoArchivo.findOne({ where: { nombre } });
    if (!registro) return null;
    const buffer = await leerBinario(STORAGE_DIR(), nombre);
    if (!buffer) return null;
    return { buffer, mime: registro.mime, nombreOriginal: registro.nombreOriginal, tipo: registro.tipo };
};

/**
 * Elimina un archivo (índice + binario). El permiso lo resuelve el controller.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Id del registro.
 * @returns {Promise<object|null>} El registro eliminado o null si no existe.
 */
export const eliminarArchivo = async (models, id) => {
    const registro = await models.DocumentoArchivo.findByPk(id);
    if (!registro) return null;
    await borrarBinario(STORAGE_DIR(), registro.nombre);
    await registro.destroy();
    return registro;
};

/**
 * Liga al documento las imágenes embebidas en su cuerpo (para el GC de huérfanas).
 * Extrae los nombres de los src del HTML ya saneado y setea documentoId donde falte.
 * @param {object} models - Modelos de la app.
 * @param {number} documentoId - Documento dueño.
 * @param {string} html - Cuerpo saneado.
 * @returns {Promise<void>}
 */
export const ligarImagenes = async (models, documentoId, html) => {
    if (!html) return;
    const nombres = [...String(html).matchAll(/documentacion\/archivos\/(\d{6}_[0-9a-f]{20}\.\w+)/g)].map(m => m[1]);
    if (!nombres.length) return;
    await models.DocumentoArchivo.update(
        { documentoId },
        { where: { nombre: nombres, documentoId: null } }
    );
};
