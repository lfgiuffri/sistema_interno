/**
 * Zero 2.0 — Config registry tipado (inspirado en el config.toml de Supabase).
 *
 * Un único lugar que declara TODO lo configurable de Zero por secciones (app, auth, storage,
 * realtime, webhooks, vault, ai), con tipo, default, variable de entorno y si es secreto.
 * Resuelve el valor efectivo (env → default) con coerción de tipo y enmascara secretos al exponer.
 *
 * Es la base "muy configurable" que pidió el usuario: el admin (M10) puede leer/mostrar esta
 * config y, a futuro, overridear por tenant. Hoy resuelve de entorno; mantener el SCHEMA como
 * fuente de verdad de qué existe y cómo se llama cada variable.
 */

/**
 * @typedef {object} ConfigKeyDef
 * @property {'string'|'number'|'boolean'} type - Tipo del valor.
 * @property {*} default - Valor por defecto si no hay env.
 * @property {string} env - Nombre de la variable de entorno.
 * @property {boolean} [secret] - Si true, se enmascara al exponer.
 * @property {string} desc - Descripción.
 */

/** Esquema de configuración por secciones. Agregar acá = declarar nueva config de Zero. */
export const CONFIG_SCHEMA = {
    app: {
        name: { type: 'string', default: 'Zero', env: 'APP_NAME', desc: 'Nombre de la app' },
        publicApiUrl: { type: 'string', default: '', env: 'PUBLIC_API_URL', desc: 'URL pública del API' },
        frontendUrl: { type: 'string', default: 'http://localhost:8100', env: 'FRONTEND_URL', desc: 'URL del frontend' }
    },
    auth: {
        accessTokenExpiry: { type: 'string', default: '15m', env: 'ACCESS_TOKEN_EXPIRY', desc: 'Expiración del access token' },
        refreshTokenExpiry: { type: 'string', default: '7d', env: 'REFRESH_TOKEN_EXPIRY', desc: 'Expiración del refresh token' },
        auth0Domain: { type: 'string', default: '', env: 'AUTH0_DOMAIN', desc: 'Dominio de Auth0 (social login)' },
        mfaTokenTtl: { type: 'string', default: '10m', env: 'MFA_TOKEN_TTL', desc: 'TTL del token intermedio de MFA' },
        passwordlessTtlMin: { type: 'number', default: 10, env: 'PASSWORDLESS_TTL_MIN', desc: 'Minutos de validez de OTP/magic link' }
    },
    storage: {
        driver: { type: 'string', default: 'local', env: 'STORAGE_DRIVER', desc: 'local | s3' },
        s3Bucket: { type: 'string', default: '', env: 'STORAGE_S3_BUCKET', desc: 'Bucket S3/R2' },
        s3SecretKey: { type: 'string', default: '', env: 'STORAGE_S3_SECRET_KEY', secret: true, desc: 'Secret key S3' },
        maxFileSize: { type: 'number', default: 52428800, env: 'STORAGE_MAX_FILE_SIZE', desc: 'Tamaño máx de archivo (bytes)' }
    },
    realtime: {
        corsOrigin: { type: 'string', default: '*', env: 'CORS_ORIGIN', desc: 'Origen permitido para Socket.IO' }
    },
    webhooks: {
        maxAttempts: { type: 'number', default: 5, env: 'WEBHOOKS_MAX_ATTEMPTS', desc: 'Reintentos máximos de entrega' }
    },
    vault: {
        key: { type: 'string', default: '', env: 'VAULT_KEY', secret: true, desc: 'Clave maestra del vault (cae a JWT_SECRET)' }
    },
    ai: {
        groqKey: { type: 'string', default: '', env: 'GROQ_API_KEY', secret: true, desc: 'Groq API key' },
        geminiKey: { type: 'string', default: '', env: 'GEMINI_API_KEY', secret: true, desc: 'Gemini API key' }
    }
};

/** Coerciona un valor de entorno (string) al tipo declarado. */
const coerce = (raw, def) => {
    if (raw == null) return def.default;
    if (def.type === 'boolean') return String(raw) === 'true';
    if (def.type === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : def.default; }
    return raw;
};

/**
 * Resuelve el valor efectivo de una clave (env → default), con coerción de tipo.
 * @param {string} section - Sección del schema (ej. 'storage').
 * @param {string} key - Clave dentro de la sección (ej. 'driver').
 * @returns {*} Valor resuelto.
 * @throws {Error} Si la sección/clave no existe en el schema.
 */
export const getConfig = (section, key) => {
    const def = CONFIG_SCHEMA[section]?.[key];
    if (!def) throw new Error(`Config desconocida: ${section}.${key}`);
    return coerce(process.env[def.env], def);
};

/**
 * Devuelve una sección resuelta (secretos enmascarados como '***' si tienen valor).
 * @param {string} section - Sección.
 * @returns {object} Mapa key→valor (secretos enmascarados).
 */
export const getSection = (section) => {
    const defs = CONFIG_SCHEMA[section];
    if (!defs) throw new Error(`Sección de config desconocida: ${section}`);
    const out = {};
    for (const [key, def] of Object.entries(defs)) {
        const val = coerce(process.env[def.env], def);
        out[key] = def.secret && val ? '***' : val; // nunca exponer secretos
    }
    return out;
};

/**
 * Devuelve toda la config efectiva (secretos enmascarados) — para el admin/diagnóstico.
 * @returns {object} { seccion: { key: valor } }.
 */
export const getEffectiveConfig = () =>
    Object.fromEntries(Object.keys(CONFIG_SCHEMA).map(s => [s, getSection(s)]));
