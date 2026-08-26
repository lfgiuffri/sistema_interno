/**
 * Sistema Interno — Conexión única a la base de datos (single-tenant).
 *
 * Reemplaza al par masterDatabase/getTenantConnection de la base multi-tenant original: acá hay UNA sola base
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

// Variables nuevas (DB_*) con fallback a las históricas (MASTER_DB*) para que un
// .env existente siga funcionando durante la transición.
const DB_NAME = process.env.DB_NAME || process.env.MASTER_DBNAME || 'sistema_interno';
const DB_USER = process.env.DB_USER || process.env.MASTER_DBUSER;
const DB_PASS = process.env.DB_PASS || process.env.MASTER_DBPASS;
const DB_HOST = process.env.DB_HOST || process.env.MASTER_DBHOST || 'localhost';
const DB_DIALECT = process.env.DBDRIVER || 'mariadb';

/** Hosts que significan «la base corre en esta misma máquina». */
const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1'];

/**
 * Opciones específicas del conector **mariadb** apuntando a un servidor **MySQL 8**.
 *
 * MySQL 8 autentica por defecto con `caching_sha2_password`. Ese plugin tiene un camino
 * rápido (el server recuerda al usuario) y uno completo, y el completo sobre una conexión sin
 * TLS exige la clave pública RSA del servidor. El conector de MariaDB NO la pide solo: aborta
 * con `ER_CANNOT_RETRIEVE_RSA_KEY` («RSA public key is not available client side») a menos que
 * se lo autorice. Como el camino rápido funciona mientras el server tenga al usuario en
 * cache, el síntoma aparece MÁS TARDE —al reiniciar MySQL, al hacer FLUSH PRIVILEGES o al
 * cambiar la contraseña— y parece salido de la nada.
 *
 * Se habilita solo con la base en la MISMA máquina: pedirle la clave al servidor es seguro
 * cuando no hay red en el medio que interceptar. Contra una base remota hay que decirlo a
 * mano (`DB_ALLOW_PUBLIC_KEY_RETRIEVAL=true`) y, mejor todavía, usar TLS.
 *
 * El arreglo de fondo NO es este: si el servidor es MySQL, corresponde `DBDRIVER=mysql`
 * (mysql2 hace este intercambio solo). Esto evita que la combinación equivocada explote.
 * @returns {object} Opciones extra para `dialectOptions` (vacío si no aplica).
 */
const opcionesRsaMariadb = () => {
    if (DB_DIALECT !== 'mariadb') return {};
    const forzado = process.env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL;
    const permitir = forzado === undefined
        ? HOSTS_LOCALES.includes(String(DB_HOST).toLowerCase())
        : forzado === 'true';
    return permitir ? { allowPublicKeyRetrieval: true } : {};
};

/** Conexión única de la aplicación. */
export const db = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
    host: DB_HOST,
    port: parseEnvInt('DB_PORT', 3306),
    dialect: DB_DIALECT,
    timezone: toDbTimezone(process.env.TIMEZONE || 'America/Argentina/Buenos_Aires'),
    logging: process.env.DBLOGGING === 'true' ? console.log : false,
    dialectOptions: {
        charset: 'utf8mb4',
        connectTimeout: parseEnvInt('DB_CONNECT_TIMEOUT_MS', 10000),
        ...opcionesRsaMariadb(),
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
 * Avisa si `DBDRIVER` no coincide con el motor que hay del otro lado.
 *
 * MySQL y MariaDB hablan casi el mismo protocolo, así que la combinación equivocada arranca
 * igual y falla DESPUÉS, con errores que no nombran la causa (el caso real: el conector de
 * MariaDB contra MySQL 8 muriendo por la clave RSA de `caching_sha2_password`). Un aviso al
 * boot convierte esa cacería en una línea de log.
 *
 * Nunca tumba el arranque: es un diagnóstico, no una validación.
 * @returns {Promise<void>}
 */
const avisarDialectoDisparejo = async () => {
    try {
        const [fila] = await db.query('SELECT VERSION() AS version', { type: Sequelize.QueryTypes.SELECT });
        const version = String(fila?.version ?? '');
        const servidorEsMariadb = /mariadb/i.test(version);
        if (servidorEsMariadb === (DB_DIALECT === 'mariadb')) return;
        const motor = servidorEsMariadb ? 'MariaDB' : 'MySQL';
        console.warn(
            `⚠️  [DB] DBDRIVER=${DB_DIALECT} pero el servidor es ${motor} (${version}). ` +
            `Poné DBDRIVER=${servidorEsMariadb ? 'mariadb' : 'mysql'} en el .env y reiniciá: ` +
            'la combinación cruzada arranca pero da errores raros de conexión más adelante.'
        );
    } catch { /* el diagnóstico no puede impedir el boot */ }
};

/**
 * Autentica la conexión e instancia todos los modelos (auto-discovery + asociaciones).
 * Debe llamarse UNA vez al boot, antes de montar rutas.
 * @returns {Promise<{db: import('sequelize').Sequelize, models: object}>} Conexión y modelos.
 */
export const initDatabase = async () => {
    await db.authenticate();
    await avisarDialectoDisparejo();
    // Import diferido para evitar ciclo database ⇄ associations.
    const { setupModels } = await import('./associations.js');
    modelsSingleton = await setupModels(db);
    return { db, models: modelsSingleton };
};
