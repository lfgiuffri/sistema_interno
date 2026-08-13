/**
 * Archivos privados: primitivas compartidas por los módulos que guardan binarios subidos
 * por usuarios fuera del webroot (tareas, documentación).
 *
 * Acá vive UNA sola copia de las defensas (mismas reglas del legado,
 * ../analisis_app_php/03 §2.12), para que no puedan divergir entre módulos:
 *  - Tipo de imagen decidido por CONTENIDO (firma binaria), nunca por nombre o mime del cliente.
 *  - Adjuntos por lista blanca de extensión + verificación de firma.
 *  - Límites: 5 MB imágenes, 15 MB adjuntos.
 *  - Nombre en disco aleatorio `YYYYMM_<20hex>.ext` (80 bits) validado por regex al servir.
 *
 * Cada módulo aporta su directorio y su tabla índice; estas funciones no saben de modelos.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/** Regex del nombre en disco (mismo esquema que el legado, extensiones ampliadas). */
export const NOMBRE_RE = /^\d{6}_[0-9a-f]{20}\.(png|jpg|jpeg|gif|webp|pdf|doc|docx|xls|xlsx|csv|txt|zip)$/;

/** Límite de las imágenes embebidas (bytes). */
export const MAX_IMAGEN = 5 * 1024 * 1024;
/** Límite de los adjuntos genéricos (bytes). */
export const MAX_ARCHIVO = 15 * 1024 * 1024;

/** Extensión → mime servido (fuente de verdad nuestra, no el cliente). */
export const MIME_POR_EXT = {
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
export const firmaImagen = (buf) => {
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
export const firmaAdjuntoValida = (buf, ext) => {
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
 * Aplica TODAS las defensas a un archivo subido y resuelve cómo debe guardarse.
 * No toca el disco ni la base: decide.
 * @param {object} file - Archivo de multer ({ buffer, originalname, size }).
 * @returns {{ext: string, tipo: 'imagen'|'archivo', mime: string, nombre: string}} Datos resueltos.
 * @throws {Error} 400 con mensaje concreto si no pasa alguna defensa.
 */
export const resolverArchivo = (file) => {
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

    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    return { ext, tipo, mime: MIME_POR_EXT[ext], nombre: `${yyyymm}_${crypto.randomBytes(10).toString('hex')}.${ext}` };
};

/**
 * Escribe el binario en el directorio privado (creándolo si hace falta).
 * @param {string} dir - Directorio absoluto del módulo.
 * @param {string} nombre - Nombre en disco ya resuelto.
 * @param {Buffer} buffer - Contenido.
 * @returns {Promise<void>}
 */
export const escribirBinario = async (dir, nombre, buffer) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, nombre), buffer);
};

/**
 * Lee un binario del directorio privado. El nombre se valida por regex ANTES de tocar el
 * disco: cualquier cosa rara es null (el llamador responde 404).
 * @param {string} dir - Directorio absoluto del módulo.
 * @param {string} nombre - Nombre en disco.
 * @returns {Promise<Buffer|null>} Contenido o null si el nombre es inválido o no existe.
 */
export const leerBinario = async (dir, nombre) => {
    if (!NOMBRE_RE.test(String(nombre || ''))) return null;
    try {
        return await fs.readFile(path.join(dir, nombre));
    } catch {
        return null; // registro sin binario (borrado a mano): 404
    }
};

/**
 * Borra un binario (best-effort: si ya no está, no falla).
 * @param {string} dir - Directorio absoluto del módulo.
 * @param {string} nombre - Nombre en disco.
 * @returns {Promise<void>}
 */
export const borrarBinario = async (dir, nombre) => {
    await fs.unlink(path.join(dir, nombre)).catch(() => null);
};
