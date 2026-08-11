/**
 * Sistema Interno — Runner de migraciones (single-tenant).
 *
 * Complementa al sync de provisión (que crea el schema actual en una instalación NUEVA):
 * las migraciones aplican DELTAS versionados a una base EXISTENTE, sin perder datos.
 *
 * Estructura: src/migrations/*.js (una sola base → un solo scope).
 * Cada archivo exporta: `export const up = async (sequelize, Sequelize) => {...}` (y opcional `down`).
 * Orden de aplicación = orden lexicográfico del nombre (prefijo NNNN-).
 *
 * IMPORTANTE: en MariaDB/MySQL el DDL hace COMMIT implícito, así que la transacción NO revierte
 * cambios de schema. Las migraciones DEBEN ser IDEMPOTENTES (chequear describeTable/showIndex
 * antes de alterar) — esa es la red de seguridad real ante un reintento.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Sequelize, QueryTypes } from 'sequelize';
import { db as appDb } from '../../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Carpeta de migraciones (resuelve a src/ en dev y build/ en prod). */
const migrationsDir = () => path.join(__dirname, '..', '..', 'migrations');

/**
 * Lista los archivos de migración en orden lexicográfico (= orden de aplicación).
 * @returns {string[]} Nombres de archivo .js ordenados.
 */
const listFiles = () => {
    const dir = migrationsDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.js') && !f.includes('.test.') && !f.includes('.spec.'))
        .sort();
};

/**
 * Asegura la tabla `schema_migrations` (registro de migraciones aplicadas).
 * @param {import('sequelize').Sequelize} db - Conexión.
 * @returns {Promise<void>}
 */
const ensureTable = async (db) => {
    // QueryTypes.RAW explícito: con el dialecto mariadb, las queries crudas sin type devuelven
    // un array con propiedad `meta` no-configurable que rompe el manejo por defecto de Sequelize.
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        appliedAt DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`, { type: QueryTypes.RAW });
};

/**
 * Devuelve el set de migraciones ya aplicadas.
 * @param {import('sequelize').Sequelize} db - Conexión.
 * @returns {Promise<Set<string>>} Nombres aplicados.
 */
const getApplied = async (db) => {
    await ensureTable(db);
    const rows = await db.query('SELECT name FROM schema_migrations', { type: QueryTypes.SELECT });
    return new Set(rows.map(r => r.name));
};

/**
 * Importa el módulo de una migración por nombre.
 * @param {string} file - Nombre de archivo.
 * @returns {Promise<{up: Function, down?: Function}>} El módulo de migración.
 */
const loadMigration = async (file) => {
    const mod = await import(pathToFileURL(path.join(migrationsDir(), file)).href);
    if (typeof mod.up !== 'function') throw new Error(`Migración ${file} no exporta up()`);
    return mod;
};

/**
 * Aplica todas las migraciones pendientes, en orden. El registro en `schema_migrations`
 * se hace en una transacción tras correr `up()`; si una migración falla, aborta y propaga.
 * @param {object} [opts] - { dryRun: solo listar sin aplicar, db: conexión alternativa (tests) }.
 * @returns {Promise<{applied: string[], pending: string[]}>} Migraciones aplicadas y/o pendientes.
 */
export const runMigrations = async (opts = {}) => {
    const db = opts.db || appDb;
    const applied = await getApplied(db);
    const pending = listFiles().filter(f => !applied.has(f));
    if (opts.dryRun) return { applied: [], pending };

    const done = [];
    for (const file of pending) {
        const migration = await loadMigration(file);
        const tx = await db.transaction();
        try {
            await migration.up(db, Sequelize);
            await db.query('INSERT INTO schema_migrations (name, appliedAt) VALUES (?, NOW())', {
                replacements: [file], transaction: tx, type: QueryTypes.INSERT
            });
            await tx.commit();
            done.push(file);
            console.log(`✅ [MIGRATION] ${file} aplicada`);
        } catch (err) {
            await tx.rollback();
            console.error(`❌ [MIGRATION] ${file} falló:`, err.message);
            throw new Error(`Migración ${file} falló: ${err.message}`);
        }
    }
    return { applied: done, pending: [] };
};
