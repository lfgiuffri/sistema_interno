import path from 'node:path';
import { STORAGE } from './config/storage.config.js';
import { getProvider } from './providers/index.js';

/**
 * Facade de storage: los módulos guardan/leen archivos sin saber si atrás hay disco
 * local o S3. Acá se aplican el prefijo de app y las validaciones comunes; el driver
 * solo mueve bytes.
 *
 * Single-tenant: no hay prefijo por tenant, todas las keys cuelgan de `app/`.
 */

/**
 * Normaliza la key lógica y le antepone el prefijo de app. Bloquea path traversal
 * (`../`) para que ninguna key pueda escapar de la raíz del storage.
 *
 * @param {string} key Key lógica (ej. `avatars/u1.png`).
 * @returns {string} Key completa (ej. `app/avatars/u1.png`).
 * @throws {Error} Si la key está vacía o intenta salir de la raíz.
 */
const fullKey = (key) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('storage: key vacía');
    const clean = path.posix.normalize(key.trim().replace(/^\/+/, ''));
    if (clean === '.' || clean === '..' || clean.startsWith('../')) {
        throw new Error(`storage: key inválida "${key}"`);
    }
    return `${STORAGE.keyPrefix}/${clean}`;
};

/**
 * Guarda un archivo.
 *
 * @param {string} key Key lógica.
 * @param {Buffer} buffer Contenido.
 * @param {{ contentType?: string }} [opts] Metadatos (content-type del objeto).
 * @returns {Promise<{ key: string, size: number, contentType: string|null }>}
 * @throws {Error} Si el buffer no es Buffer o supera STORAGE_MAX_FILE_SIZE.
 */
export const putFile = async (key, buffer, opts = {}) => {
    if (!Buffer.isBuffer(buffer)) throw new Error('storage: el contenido debe ser un Buffer');
    if (buffer.length > STORAGE.maxFileSize) {
        throw new Error(`storage: archivo de ${buffer.length} bytes supera el máximo de ${STORAGE.maxFileSize}`);
    }
    return getProvider().put(fullKey(key), buffer, opts);
};

/**
 * Lee un archivo completo en memoria.
 *
 * @param {string} key Key lógica.
 * @returns {Promise<Buffer>} Contenido (tira si no existe).
 */
export const getFile = async (key) => getProvider().get(fullKey(key));

/**
 * Borra un archivo (idempotente).
 *
 * @param {string} key Key lógica.
 * @returns {Promise<void>}
 */
export const deleteFile = async (key) => getProvider().del(fullKey(key));

/**
 * @param {string} key Key lógica.
 * @returns {Promise<boolean>} true si el archivo existe.
 */
export const fileExists = async (key) => getProvider().exists(fullKey(key));

/**
 * URL para acceder al archivo: pública con driver `local`, presignada con `s3`.
 *
 * @param {string} key Key lógica.
 * @param {{ expiresIn?: number }} [opts] Vigencia en segundos (solo S3).
 * @returns {Promise<string>}
 */
export const getFileUrl = async (key, opts = {}) => getProvider().getUrl(fullKey(key), opts);

/**
 * @returns {string} Nombre del driver activo (`local` | `s3`).
 */
export const activeStorageDriver = () => getProvider().name;
