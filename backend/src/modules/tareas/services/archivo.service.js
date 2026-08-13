/**
 * Archivos del módulo de tareas: imágenes embebidas + adjuntos genéricos (mejora §10.4).
 *
 * Las defensas (firma binaria, lista blanca, límites, nombre aleatorio) viven UNA sola vez
 * en `services/archivos/archivoPrivado.service.js`, compartidas con documentación; acá queda
 * lo propio de tareas: el directorio `storage/tareas`, la tabla índice `tarea_archivos` y el
 * ligado de imágenes a la tarea para el GC.
 */

import path from 'path';
import {
    NOMBRE_RE, resolverArchivo, escribirBinario, leerBinario, borrarBinario,
} from '../../../services/archivos/archivoPrivado.service.js';

/** Directorio privado de archivos (cwd del backend; NO está bajo public/). */
const STORAGE_DIR = () => path.resolve(process.cwd(), process.env.TAREAS_STORAGE_DIR || 'storage/tareas');

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
 * @param {number|null} [tareaId] - Tarea a la que se adjunta (null = imagen de editor, se liga al guardar).
 * @returns {Promise<object>} Registro creado ({ id, nombre, url, tipo, ... }).
 * @throws {Error} 400 con mensaje concreto si el archivo no pasa las defensas.
 */
export const guardarArchivo = async (models, file, userId, tareaId = null) => {
    const { tipo, mime, nombre } = resolverArchivo(file);

    // Si adjunta a una tarea, la tarea tiene que existir (el permiso lo valida el controller).
    if (tareaId) {
        const tarea = await models.Tarea.findByPk(tareaId);
        if (!tarea) throw bizError(404, 'Tarea no encontrada');
    }

    await escribirBinario(STORAGE_DIR(), nombre, file.buffer);

    const registro = await models.TareaArchivo.create({
        nombre,
        nombreOriginal: (file.originalname || nombre).slice(0, 200),
        tipo,
        mime,
        size: file.size,
        tareaId: tareaId || null,
        userId
    });

    return { ...registro.toJSON(), url: `/api/tareas/archivos/${nombre}` };
};

/**
 * Devuelve un archivo para servir (buffer + headers). El nombre se valida por regex ANTES
 * de tocar el disco; cualquier otra cosa es 404 (sin filtrar por espacio: la seguridad es
 * el nombre aleatorio de 80 bits + la sesión, como el legado).
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre en disco.
 * @returns {Promise<{buffer: Buffer, mime: string, nombreOriginal: string, tipo: string}|null>}
 */
export const leerArchivo = async (models, nombre) => {
    if (!NOMBRE_RE.test(String(nombre || ''))) return null;
    const registro = await models.TareaArchivo.findOne({ where: { nombre } });
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
    const registro = await models.TareaArchivo.findByPk(id);
    if (!registro) return null;
    await borrarBinario(STORAGE_DIR(), registro.nombre);
    await registro.destroy();
    return registro;
};

/**
 * Liga a la tarea las imágenes embebidas en su descripción (para el GC de huérfanas).
 * Extrae los nombres de los src del HTML ya saneado y setea tareaId donde falte.
 * @param {object} models - Modelos de la app.
 * @param {number} tareaId - Tarea dueña.
 * @param {string} html - Descripción saneada.
 * @returns {Promise<void>}
 */
export const ligarImagenes = async (models, tareaId, html) => {
    if (!html) return;
    const nombres = [...String(html).matchAll(/tareas\/archivos\/(\d{6}_[0-9a-f]{20}\.\w+)/g)].map(m => m[1]);
    if (!nombres.length) return;
    await models.TareaArchivo.update(
        { tareaId },
        { where: { nombre: nombres, tareaId: null } }
    );
};
