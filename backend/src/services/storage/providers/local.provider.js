import fs from 'node:fs/promises';
import path from 'node:path';
import { STORAGE } from '../config/storage.config.js';

/**
 * Ruta absoluta en disco de una key ya normalizada por el facade.
 *
 * @param {string} key Key completa (con prefijo de app).
 * @returns {string} Path absoluto bajo STORAGE_LOCAL_ROOT.
 */
const absolute = (key) => path.join(path.resolve(process.cwd(), STORAGE.local.root), key);

/**
 * Driver `local`: filesystem bajo STORAGE_LOCAL_ROOT (`public/storage` por default),
 * servido como estático en STORAGE_LOCAL_PUBLIC_PATH. Los archivos son PÚBLICOS:
 * lo privado (adjuntos de tareas/empleados) va por sus propios services fuera de `public`.
 *
 * @type {{ name: string, put: Function, get: Function, del: Function, exists: Function, getUrl: Function }}
 */
export const localProvider = {
    name: 'local',

    /**
     * Escribe el archivo creando los directorios intermedios.
     *
     * @param {string} key Key completa.
     * @param {Buffer} buffer Contenido.
     * @param {{ contentType?: string }} [opts] Metadatos (el driver local no los persiste).
     * @returns {Promise<{ key: string, size: number, contentType: string|null }>}
     */
    async put(key, buffer, opts = {}) {
        const file = absolute(key);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buffer);
        return { key, size: buffer.length, contentType: opts.contentType || null };
    },

    /**
     * @param {string} key Key completa.
     * @returns {Promise<Buffer>} Contenido del archivo (tira si no existe).
     */
    async get(key) {
        return fs.readFile(absolute(key));
    },

    /**
     * Borrado idempotente (no falla si el archivo ya no está).
     *
     * @param {string} key Key completa.
     * @returns {Promise<void>}
     */
    async del(key) {
        await fs.rm(absolute(key), { force: true });
    },

    /**
     * @param {string} key Key completa.
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        try {
            await fs.access(absolute(key));
            return true;
        } catch {
            return false;
        }
    },

    /**
     * URL pública servida por el estático de Express.
     *
     * @param {string} key Key completa.
     * @returns {Promise<string>} URL relativa (`/public/storage/...`).
     */
    async getUrl(key) {
        return `${STORAGE.local.publicPath}/${key}`;
    },
};
