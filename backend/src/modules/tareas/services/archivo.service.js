/**
 * Archivos del módulo de tareas: imágenes embebidas + adjuntos genéricos (mejora §10.4).
 *
 * Defensas del legado (../analisis_app_php/03 §2.12) + extensiones:
 *  - Binarios en disco PRIVADO (`storage/tareas`, fuera de public/), servidos solo con auth
 *    y headers defensivos (nosniff + CSP + Cache-Control private).
 *  - Tipo de imagen decidido por CONTENIDO (firma binaria), nunca por nombre/mime del cliente.
 *  - Nombre aleatorio `YYYYMM_<20hex>.ext` validado por regex al servir.
 *  - Límites: 5 MB imágenes, 15 MB adjuntos. Adjuntos por lista blanca de extensión+firma.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/** Directorio privado de archivos (cwd del backend; NO está bajo public/). */
const STORAGE_DIR = () => path.resolve(process.cwd(), process.env.TAREAS_STORAGE_DIR || 'storage/tareas');

/** Regex del nombre en disco (mismo esquema que el legado, extensiones ampliadas). */
export const NOMBRE_RE = /^\d{6}_[0-9a-f]{20}\.(png|jpg|jpeg|gif|webp|pdf|doc|docx|xls|xlsx|csv|txt|zip)$/;

const MAX_IMAGEN = 5 * 1024 * 1024;
const MAX_ARCHIVO = 15 * 1024 * 1024;

/** Extensión → mime servido (fuente de verdad nuestra, no el cliente). */
const MIME_POR_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv', txt: 'text/plain', zip: 'application/zip'
};

const EXT_IMAGEN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

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
 * Detecta el tipo de imagen por FIRMA binaria (equivalente al getimagesize del legado).
 * @param {Buffer} buf - Contenido del archivo.
 * @returns {string|null} Extensión canónica de imagen o null si no es imagen conocida.
 */
const firmaImagen = (buf) => {
    if (buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.slice(0, 6).toString('latin1') === 'GIF87a' || buf.slice(0, 6).toString('latin1') === 'GIF89a') return 'gif';
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
};

/**
 * Valida un adjunto genérico contra su extensión declarada (lista blanca + firma básica).
 * @param {Buffer} buf - Contenido.
 * @param {string} ext - Extensión declarada (del nombre original, ya en minúsculas).
 * @returns {boolean} true si el contenido es plausible para la extensión.
 */
const firmaAdjuntoValida = (buf, ext) => {
    const ascii4 = buf.slice(0, 4).toString('latin1');
    switch (ext) {
        case 'pdf': return buf.slice(0, 5).toString('latin1') === '%PDF-';
        // docx/xlsx/zip comparten contenedor ZIP (PK...).
        case 'docx': case 'xlsx': case 'zip': return ascii4.startsWith('PK');
        // doc/xls legado: contenedor OLE.
        case 'doc': case 'xls': return buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
        // Texto plano: sin bytes nulos en la muestra.
        case 'csv': case 'txt': return !buf.slice(0, 1024).includes(0);
        default: return false;
    }
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
    if (!file?.buffer?.length) throw bizError(400, 'No se pudo subir el archivo');

    const extDeclarada = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
    const extImagen = firmaImagen(file.buffer);

    let ext, tipo;
    if (extImagen) {
        // Es imagen por contenido: la extensión canónica sale de la firma, no del nombre.
        if (file.size > MAX_IMAGEN) throw bizError(400, 'La imagen supera los 5 MB');
        ext = extImagen;
        tipo = 'imagen';
    } else if (EXT_IMAGEN.has(extDeclarada)) {
        // Dice ser imagen pero el contenido no lo es → afuera (regla del legado).
        throw bizError(400, 'El archivo no es una imagen válida');
    } else {
        if (!MIME_POR_EXT[extDeclarada]) throw bizError(400, 'Tipo de archivo no permitido (pdf, doc, xls, csv, txt o zip)');
        if (file.size > MAX_ARCHIVO) throw bizError(400, 'El archivo supera los 15 MB');
        if (!firmaAdjuntoValida(file.buffer, extDeclarada)) throw bizError(400, 'El contenido no coincide con el tipo de archivo');
        ext = extDeclarada;
        tipo = 'archivo';
    }

    // Si adjunta a una tarea, la tarea tiene que existir (el permiso lo valida el controller).
    if (tareaId) {
        const tarea = await models.Tarea.findByPk(tareaId);
        if (!tarea) throw bizError(404, 'Tarea no encontrada');
    }

    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    const nombre = `${yyyymm}_${crypto.randomBytes(10).toString('hex')}.${ext}`;

    const dir = STORAGE_DIR();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, nombre), file.buffer);

    const registro = await models.TareaArchivo.create({
        nombre,
        nombreOriginal: (file.originalname || nombre).slice(0, 200),
        tipo,
        mime: MIME_POR_EXT[ext],
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
    try {
        const buffer = await fs.readFile(path.join(STORAGE_DIR(), nombre));
        return { buffer, mime: registro.mime, nombreOriginal: registro.nombreOriginal, tipo: registro.tipo };
    } catch {
        return null; // registro sin binario (borrado a mano): 404
    }
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
    await fs.unlink(path.join(STORAGE_DIR(), registro.nombre)).catch(() => null);
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
