/**
 * Archivos de la ficha de empleado (../analisis_app_php/04 §3.4d/§3.5):
 *  - Disco PRIVADO `storage/empleados/<empleadoId>/`, nombre `<16hex>_<original saneado>`.
 *  - 15 MB máx; extensiones whitelist + verificación básica de contenido (mejora: el
 *    legado validaba solo por extensión).
 *  - Descarga con auth, SIEMPRE attachment + nosniff; anti path-traversal por resolución
 *    real de la ruta.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/** Raíz privada de archivos de empleados (fuera de public/). */
const STORAGE_DIR = () => path.resolve(process.cwd(), process.env.EMPLEADOS_STORAGE_DIR || 'storage/empleados');

const MAX_SIZE = 15 * 1024 * 1024;

/** Extensión → mime servido. */
const MIME_POR_EXT = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    txt: 'text/plain'
};

/**
 * Error de negocio con status.
 * @param {number} statusCode - HTTP status.
 * @param {string} message - Mensaje.
 * @returns {Error} Error enriquecido.
 */
const bizError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

/**
 * Verificación básica de contenido según extensión (firma binaria donde existe).
 * @param {Buffer} buf - Contenido.
 * @param {string} ext - Extensión declarada.
 * @returns {boolean} true si el contenido es plausible.
 */
const firmaValida = (buf, ext) => {
    const ascii = (n) => buf.slice(0, n).toString('latin1');
    switch (ext) {
        case 'pdf': return ascii(5) === '%PDF-';
        case 'png': return buf[0] === 0x89 && ascii(4).slice(1) === 'PNG';
        case 'jpg': case 'jpeg': return buf[0] === 0xff && buf[1] === 0xd8;
        case 'gif': return ascii(6) === 'GIF87a' || ascii(6) === 'GIF89a';
        case 'webp': return ascii(4) === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
        case 'docx': case 'xlsx': case 'odt': case 'ods': return ascii(2) === 'PK';
        case 'doc': case 'xls': return buf[0] === 0xd0 && buf[1] === 0xcf;
        case 'txt': return !buf.slice(0, 1024).includes(0);
        default: return false;
    }
};

/**
 * Sube un archivo a la ficha (validaciones del legado + firma de contenido).
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado dueño.
 * @param {object} file - Archivo de multer ({ buffer, originalname, size }).
 * @param {string} descripcion - Descripción obligatoria.
 * @param {number} userId - Quién sube.
 * @returns {Promise<object>} Registro creado.
 */
export const subirArchivo = async (models, empleadoId, file, descripcion, userId) => {
    const empleado = await models.Empleado.findByPk(empleadoId);
    if (!empleado) throw bizError(404, 'Empleado no encontrado');
    if (!descripcion?.trim()) throw bizError(400, 'Poné una descripción para el archivo');
    if (!file?.buffer?.length) throw bizError(400, 'Elegí un archivo');
    if (file.size > MAX_SIZE) throw bizError(400, 'El archivo supera el máximo permitido (15 MB)');

    const ext = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
    if (!MIME_POR_EXT[ext]) throw bizError(400, `Tipo de archivo no permitido (${ext || 'sin extensión'})`);
    if (!firmaValida(file.buffer, ext)) throw bizError(400, 'El contenido no coincide con el tipo de archivo');

    // Nombre: hex aleatorio + original saneado (mismo esquema del legado).
    const saneado = String(file.originalname).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
    const nombre = `${crypto.randomBytes(8).toString('hex')}_${saneado}`;

    const dir = path.join(STORAGE_DIR(), String(empleadoId));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, nombre), file.buffer);

    return models.EmpleadoArchivo.create({
        empleadoId,
        descripcion: descripcion.trim().slice(0, 200),
        nombre,
        nombreOriginal: (file.originalname || nombre).slice(0, 200),
        mime: MIME_POR_EXT[ext],
        size: file.size,
        userId
    });
};

/**
 * Lee un archivo para servir (anti-traversal: la ruta resuelta DEBE quedar dentro del
 * root de storage). Siempre attachment; el mime sale del registro, no del cliente.
 * @param {object} models - Modelos de la app.
 * @param {number} archivoId - Id del registro.
 * @returns {Promise<{buffer: Buffer, mime: string, nombreOriginal: string}|null>}
 */
export const leerArchivo = async (models, archivoId) => {
    const registro = await models.EmpleadoArchivo.findByPk(archivoId);
    if (!registro) return null;
    const base = STORAGE_DIR();
    const ruta = path.resolve(base, String(registro.empleadoId), registro.nombre);
    if (!ruta.startsWith(base + path.sep)) return null; // path traversal → 404
    try {
        const buffer = await fs.readFile(ruta);
        return { buffer, mime: registro.mime, nombreOriginal: registro.nombreOriginal };
    } catch {
        return null;
    }
};

/**
 * Elimina un archivo (binario + registro), scoped al empleado.
 * @param {object} models - Modelos de la app.
 * @param {number} empleadoId - Empleado dueño.
 * @param {number} archivoId - Archivo.
 * @returns {Promise<boolean>} true si se eliminó.
 */
export const eliminarArchivo = async (models, empleadoId, archivoId) => {
    const registro = await models.EmpleadoArchivo.findOne({ where: { id: archivoId, empleadoId } });
    if (!registro) return false;
    const base = STORAGE_DIR();
    const ruta = path.resolve(base, String(registro.empleadoId), registro.nombre);
    if (ruta.startsWith(base + path.sep)) await fs.unlink(ruta).catch(() => null);
    await registro.destroy();
    return true;
};
