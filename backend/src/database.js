/**
 * Sistema Interno — Conexión única a la base de datos (single-tenant).
 *
 * Reemplaza al par masterDatabase/getTenantConnection de Zero 2.0: acá hay UNA sola base
 * (la de la empresa), una sola conexión Sequelize y un solo set de modelos, inicializados
 * al boot. Los requests reciben `req.db` / `req.models` desde el middleware dbContext,
 * así el contrato de los módulos (services que reciben `models`) no cambia.
 */

import 'dotenv/config';
import { Sequelize } from 'sequelize';

/**
 * Lee un entero de entorno con fallback.
 * @param {string} name - Nombre de la variable de entorno.
 * @param {number} fallback - Valor por defecto si falta o es inválida.
 * @returns {number} El valor parseado o el fallback.
 */
const parseEnvInt = (name, fallback) => {
    const value = parseInt(process.env[name], 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// mysql2 exige un offset (`+HH:MM`) como timezone de conexión; un nombre IANA se ignora
// con warning. Normalizamos: offset → tal cual; IANA → su offset actual; vacío → UTC.
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

/**
 * Convierte un nombre de zona IANA a su offset actual (`+HH:MM`).
 * @param {string} tz - Nombre IANA (ej. "America/Argentina/Buenos_Aires").
 * @returns {string} Offset (`+HH:MM`) o "+00:00" si no se puede resolver.
 */
const ianaToOffset = (tz) => {
    try {
        const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
            .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '';
        const m = name.match(/[+-]\d{2}:\d{2}/);
        return m ? m[0] : '+00:00';
    } catch { return '+00:00'; }
};

/**
 * Normaliza la timezone configurada al formato que acepta el driver.
 * @param {string} tz - Offset, nombre IANA o vacío.
 * @returns {string} Offset válido para mysql2.
 */
const toDbTimezone = (tz) => {
    if (!tz || tz === 'Z') return '+00:00';
    return OFFSET_RE.test(tz) ? tz : ianaToOffset(tz);
};

// Variables nuevas (DB_*) con fallback a las históricas de Zero (MASTER_DB*) para que un
// .env existente siga funcionando durante la transición.
const DB_NAME = process.env.DB_NAME || process.env.MASTER_DBNAME || 'sistema_interno';
const DB_USER = process.env.DB_USER || process.env.MASTER_DBUSER;
const DB_PASS = process.env.DB_PASS || process.env.MASTER_DBPASS;
const DB_HOST = process.env.DB_HOST || process.env.MASTER_DBHOST || 'localhost';

/** Conexión única de la aplicación. */
export const db = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
    host: DB_HOST,
    port: parseEnvInt('DB_PORT', 3306),
    dialect: process.env.DBDRIVER || 'mariadb',
    timezone: toDbTimezone(process.env.TIMEZONE || 'America/Argentina/Buenos_Aires'),
    logging: process.env.DBLOGGING === 'true' ? console.log : false,
    dialectOptions: {
        charset: 'utf8mb4',
        connectTimeout: parseEnvInt('DB_CONNECT_TIMEOUT_MS', 10000),
    },
    pool: {
        max: parseEnvInt('DB_POOL_MAX', 10),
        min: parseEnvInt('DB_POOL_MIN', 0),
        acquire: parseEnvInt('DB_POOL_ACQUIRE_MS', 60000),
        idle: parseEnvInt('DB_POOL_IDLE_MS', 10000),
        evict: parseEnvInt('DB_POOL_EVICT_MS', 10000),
    },
    define: {
        charset: 'utf8mb4',
        collate: 'utf8mb4_general_ci'
    },
    retry: {
        match: [/Deadlock/i, Sequelize.ConnectionError],
        max: 3,
        backoffBase: 3000,
        backoffExponent: 1.5,
    }
});

/** Modelos instanciados al boot (singleton). Se llena en initDatabase(). */
let modelsSingleton = null;

/**
 * Devuelve los modelos de la aplicación. Falla fuerte si se pide antes de initDatabase():
 * un consumidor que corre antes del boot es un bug de orden de inicialización.
 * @returns {object} Mapa nombre → modelo Sequelize.
 * @throws {Error} Si la base todavía no fue inicializada.
 */
export const getModels = () => {
    if (!modelsSingleton) throw new Error('[DB] getModels() llamado antes de initDatabase()');
    return modelsSingleton;
};

/**
 * Autentica la conexión e instancia todos los modelos (auto-discovery + asociaciones).
 * Debe llamarse UNA vez al boot, antes de montar rutas.
 * @returns {Promise<{db: import('sequelize').Sequelize, models: object}>} Conexión y modelos.
 */
export const initDatabase = async () => {
    await db.authenticate();
    // Import diferido para evitar ciclo database ⇄ associations.
    const { setupModels } = await import('./associations.js');
    modelsSingleton = await setupModels(db);
    return { db, models: modelsSingleton };
};
