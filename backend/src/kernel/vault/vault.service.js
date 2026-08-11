/**
 * Zero 2.0 — Vault de secretos cifrados por tenant (AES-256-GCM).
 *
 * Guarda secretos sensibles (API keys de terceros, tokens, credenciales) cifrados en la
 * tabla `tenant_secrets` del tenant. Usa AES-256-GCM, que además de confidencialidad
 * provee integridad/autenticación: si el ciphertext o el IV se alteran, el descifrado
 * falla en vez de devolver basura.
 *
 * La clave de cifrado se DERIVA (no se usa cruda) con scrypt a partir de
 * `process.env.VAULT_KEY` (preferida) o, como fallback, `process.env.JWT_SECRET`. Derivar
 * con scrypt + salt fija nos da una clave de 32 bytes (256 bits) determinística: el mismo
 * VAULT_KEY siempre produce la misma clave, condición necesaria para poder descifrar más
 * tarde. La salt es fija a propósito ('zero-vault'): no buscamos resistencia a rainbow
 * tables sobre la clave (que es un secreto de entorno, no una password de usuario), sino
 * estirar el material de clave a 32 bytes de forma estable.
 *
 * Degradación: si NO hay ni VAULT_KEY ni JWT_SECRET, no rompemos el arranque del proceso
 * (no se valida al importar). Recién al USAR el vault se tira un error claro, porque sin
 * clave no se puede cifrar ni descifrar nada de forma segura.
 */

import crypto from 'crypto';

/** Algoritmo de cifrado autenticado. GCM = confidencialidad + integridad en un solo paso. */
const ALGORITHM = 'aes-256-gcm';

/** Largo del IV recomendado para GCM (12 bytes). Aleatorio y único por cada cifrado. */
const IV_LENGTH = 12;

/** Salt fija para la derivación scrypt. Constante a propósito (ver doc del archivo). */
const KEY_SALT = 'zero-vault';

/** Largo de la clave derivada en bytes: 32 = AES-256. */
const KEY_LENGTH = 32;

/**
 * Deriva la clave de 32 bytes con scrypt a partir del secreto de entorno.
 * No cachea el resultado a propósito: scrypt sobre un string corto es barato y así un cambio
 * de VAULT_KEY en runtime (raro) no queda pegado. Lanza un error claro si no hay material de clave.
 * @returns {Buffer} Clave de 32 bytes lista para AES-256-GCM.
 * @throws {Error} Si no existe ni VAULT_KEY ni JWT_SECRET en el entorno.
 */
const deriveKey = () => {
    // Preferimos VAULT_KEY; caemos a JWT_SECRET para tenants/deploys que aún no la setearon.
    const secret = process.env.VAULT_KEY || process.env.JWT_SECRET;
    if (!secret) {
        // Error explícito en el punto de uso (no al importar): el resto de la app sigue arrancando.
        throw new Error('Vault no configurado: definí VAULT_KEY (o al menos JWT_SECRET) para cifrar/descifrar secretos.');
    }
    // scryptSync es síncrono y determinístico: misma entrada → misma clave (necesario para descifrar).
    return crypto.scryptSync(secret, KEY_SALT, KEY_LENGTH);
};

/**
 * Cifra un string con AES-256-GCM usando un IV aleatorio.
 * @param {string} plainText - Valor en claro a cifrar.
 * @returns {{ valueEncrypted: string, iv: string, authTag: string }} Ciphertext, IV y authTag en base64.
 */
const encrypt = (plainText) => {
    const key = deriveKey();
    // IV aleatorio por cada cifrado: dos secretos iguales producen ciphertexts distintos (clave en GCM).
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
    // El authTag se obtiene DESPUÉS de cipher.final(); es obligatorio para verificar integridad al descifrar.
    const authTag = cipher.getAuthTag();
    return {
        valueEncrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
    };
};

/**
 * Descifra un ciphertext AES-256-GCM. Verifica integridad vía authTag (tira si fue alterado).
 * @param {string} valueEncrypted - Ciphertext en base64.
 * @param {string} iv - IV en base64 usado al cifrar.
 * @param {string} authTag - Etiqueta de autenticación en base64.
 * @returns {string} El valor original en claro.
 * @throws {Error} Si la integridad falla (authTag inválido) o la clave no coincide.
 */
const decrypt = (valueEncrypted, iv, authTag) => {
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    // Sin setAuthTag GCM no puede validar integridad: decipher.final() lanzaría siempre.
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(valueEncrypted, 'base64')),
        decipher.final() // Acá se valida el authTag: si no matchea, lanza y no devuelve plaintext corrupto.
    ]);
    return decrypted.toString('utf8');
};

/**
 * Guarda (upsert) un secreto cifrado por su `name` dentro del tenant.
 * Si el nombre ya existe, re-cifra y actualiza (nuevo IV/authTag); si no, lo crea.
 * Nunca devuelve el valor ni el ciphertext: solo el nombre.
 * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Modelos del tenant (req.models).
 * @param {string} name - Identificador lógico del secreto (ej. 'stripe_api_key').
 * @param {string} value - Valor en claro a cifrar y persistir.
 * @returns {Promise<{ name: string }>} El nombre del secreto guardado.
 * @throws {Error} Si falta el modelo TenantSecret, faltan argumentos, o no hay clave de vault.
 */
export const vaultSet = async (models, name, value) => {
    if (!models?.TenantSecret) {
        throw new Error('Vault no disponible: el modelo TenantSecret no está presente en este tenant.');
    }
    if (!name) throw new Error('vaultSet requiere un name.');
    if (value === undefined || value === null) throw new Error('vaultSet requiere un value.');

    const { valueEncrypted, iv, authTag } = encrypt(value);

    // Buscamos con unscoped() porque el defaultScope del modelo excluye las columnas crypto:
    // necesitamos saber si ya existe (incluida una fila previa) para decidir update vs create.
    const existing = await models.TenantSecret.unscoped().findOne({ where: { name } });
    if (existing) {
        await existing.update({ valueEncrypted, iv, authTag });
    } else {
        await models.TenantSecret.create({ name, valueEncrypted, iv, authTag });
    }

    // Contrato: jamás devolvemos el valor ni el ciphertext.
    return { name };
};

/**
 * Recupera y descifra el valor de un secreto por su `name`.
 * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Modelos del tenant (req.models).
 * @param {string} name - Nombre del secreto a leer.
 * @returns {Promise<string|null>} El valor en claro, o null si no existe.
 * @throws {Error} Si falta el modelo TenantSecret, no hay clave, o la integridad del dato falla.
 */
export const vaultGet = async (models, name) => {
    if (!models?.TenantSecret) {
        throw new Error('Vault no disponible: el modelo TenantSecret no está presente en este tenant.');
    }
    if (!name) throw new Error('vaultGet requiere un name.');

    // unscoped() para traer las columnas crypto que el defaultScope oculta.
    const row = await models.TenantSecret.unscoped().findOne({ where: { name } });
    if (!row) return null; // No existe → null (no es un error).

    return decrypt(row.valueEncrypted, row.iv, row.authTag);
};

/**
 * Lista los NAMES de todos los secretos del tenant. Nunca devuelve valores ni ciphertext.
 * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Modelos del tenant (req.models).
 * @returns {Promise<string[]>} Lista de nombres de secretos (puede ser []).
 * @throws {Error} Si falta el modelo TenantSecret.
 */
export const vaultList = async (models) => {
    if (!models?.TenantSecret) {
        throw new Error('Vault no disponible: el modelo TenantSecret no está presente en este tenant.');
    }
    // Pedimos SOLO la columna name: imposible filtrar ciphertext aunque algo cambie el scope.
    const rows = await models.TenantSecret.findAll({ attributes: ['name'], order: [['name', 'ASC']] });
    return rows.map(r => r.name);
};

/**
 * Borra (soft-delete, paranoid) un secreto por su `name`.
 * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Modelos del tenant (req.models).
 * @param {string} name - Nombre del secreto a borrar.
 * @returns {Promise<{ name: string, deleted: boolean }>} Si se borró algo (deleted=false si no existía).
 * @throws {Error} Si falta el modelo TenantSecret o el name.
 */
export const vaultDelete = async (models, name) => {
    if (!models?.TenantSecret) {
        throw new Error('Vault no disponible: el modelo TenantSecret no está presente en este tenant.');
    }
    if (!name) throw new Error('vaultDelete requiere un name.');

    // destroy soft-delete (paranoid): el unique index incluye deletedAt, así que el nombre queda reutilizable.
    const count = await models.TenantSecret.destroy({ where: { name } });
    return { name, deleted: count > 0 };
};
