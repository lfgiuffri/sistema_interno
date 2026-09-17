/**
 * Archivos adjuntos de incidencias.
 *
 * Reusa las defensas de `services/archivos/archivoPrivado.service.js` (firma binaria, lista
 * blanca de extensiones, límites de tamaño, nombre aleatorio) igual que tareas y
 * documentación. Lo que NO se copia de tareas es su modelo de acceso: allá alcanza con «el
 * nombre es aleatorio y tenés sesión» porque todos los que miran son compañeros de trabajo.
 * Acá el que mira es un cliente, y lo que hay del otro lado son datos de OTROS clientes.
 */

import path from 'path';
import {
    NOMBRE_RE, resolverArchivo, escribirBinario, leerBinario, borrarBinario
} from '../../../services/archivos/archivoPrivado.service.js';

export { NOMBRE_RE };

/** Carpeta privada de los adjuntos de incidencias (fuera de lo servido por nginx). */
const STORAGE_DIR = () => path.resolve(process.cwd(), process.env.INCIDENCIAS_STORAGE_DIR || 'storage/incidencias');

/**
 * Guarda un archivo subido suelto (todavía sin incidencia).
 *
 * `clienteId` es obligatorio y se toma de QUIÉN sube, nunca de un parámetro: es lo único que
 * dice de quién es el archivo durante la ventana en que `incidenciaId` es null.
 * @param {object} models - Modelos de la app.
 * @param {object} file - Archivo de multer (memoria).
 * @param {{clienteId: number, clienteUsuarioId?: number, userId?: number}} autor - De quién es.
 * @returns {Promise<object>} El registro con su URL.
 * @throws {Error} 400 si el contenido no pasa las defensas.
 */
export const guardarArchivo = async (models, file, autor) => {
    // `destino: 'adjunto'` siempre: en incidencias no hay editor rico, así que una imagen es
    // un adjunto más y no contenido embebido.
    const { tipo, mime, nombre } = resolverArchivo(file, 'adjunto');
    await escribirBinario(STORAGE_DIR(), nombre, file.buffer);

    const registro = await models.IncidenciaArchivo.create({
        nombre,
        nombreOriginal: String(file.originalname || '').slice(0, 200),
        tipo, mime,
        size: file.size,
        incidenciaId: null,
        clienteId: autor.clienteId,
        clienteUsuarioId: autor.clienteUsuarioId ?? null,
        userId: autor.userId ?? null
    });
    return { ...registro.toJSON(), url: `/api/incidencias/archivos/${nombre}` };
};

/**
 * Lee un archivo para servirlo, verificando de quién es.
 *
 * `clienteId` acota la búsqueda cuando pregunta el portal. Un archivo de otro cliente
 * devuelve null → 404, no 403: a un tercero no se le confirma que ese archivo existe.
 * @param {object} models - Modelos de la app.
 * @param {string} nombre - Nombre en disco.
 * @param {number|null} [clienteId] - Si viene, el archivo tiene que ser de ese cliente.
 * @returns {Promise<{buffer: Buffer, mime: string, nombreOriginal: string, tipo: string}|null>} El archivo o null.
 */
export const leerArchivo = async (models, nombre, clienteId = null) => {
    const where = { nombre };
    if (clienteId !== null) where.clienteId = Number(clienteId);

    const registro = await models.IncidenciaArchivo.findOne({ where });
    if (!registro) return null;

    const buffer = await leerBinario(STORAGE_DIR(), registro.nombre);
    if (!buffer) return null;
    return { buffer, mime: registro.mime, nombreOriginal: registro.nombreOriginal, tipo: registro.tipo };
};

/**
 * Elimina un archivo (binario + registro), verificando de quién es.
 * @param {object} models - Modelos de la app.
 * @param {number} id - Archivo.
 * @param {number|null} [clienteId] - Si viene, tiene que ser de ese cliente.
 * @returns {Promise<boolean>} true si se eliminó.
 */
export const eliminarArchivo = async (models, id, clienteId = null) => {
    const where = { id: Number(id) };
    if (clienteId !== null) where.clienteId = Number(clienteId);

    const registro = await models.IncidenciaArchivo.findOne({ where });
    if (!registro) return false;
    await borrarBinario(STORAGE_DIR(), registro.nombre);
    await registro.destroy();
    return true;
};

/**
 * Copia un adjunto de incidencia al almacén de TAREAS, para el botón «crear tarea».
 *
 * Copia el binario en vez de compartirlo: son dos módulos con su propio directorio y su
 * propio índice, y la tarea no puede quedar colgada de un archivo que el GC de incidencias
 * (o el cliente) haga desaparecer.
 * @param {object} models - Modelos de la app.
 * @param {number} archivoId - Adjunto de la incidencia.
 * @param {number} tareaId - Tarea destino.
 * @param {number} userId - Usuario interno que dispara la copia.
 * @returns {Promise<object|null>} El registro nuevo, o null si el original se perdió.
 */
export const copiarArchivoATarea = async (models, archivoId, tareaId, userId) => {
    const origen = await models.IncidenciaArchivo.findByPk(Number(archivoId));
    if (!origen) return null;

    const buffer = await leerBinario(STORAGE_DIR(), origen.nombre);
    if (!buffer) return null;   // binario perdido: se saltea en vez de romper el alta

    // Nombre nuevo en el almacén de tareas: el nombre es la credencial del archivo, no se
    // reutiliza entre módulos.
    const ext = origen.nombre.split('.').pop();
    const { randomBytes } = await import('crypto');
    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    const nombre = `${yyyymm}_${randomBytes(10).toString('hex')}.${ext}`;

    const dirTareas = path.resolve(process.cwd(), process.env.TAREAS_STORAGE_DIR || 'storage/tareas');
    await escribirBinario(dirTareas, nombre, buffer);

    return models.TareaArchivo.create({
        nombre,
        nombreOriginal: origen.nombreOriginal,
        tipo: origen.tipo,
        mime: origen.mime,
        size: origen.size,
        tareaId,
        userId
    });
};
