/**
 * Sistema Interno — Hashing de passwords (argon2id, con back-compat bcrypt).
 *
 * Best-practice (skill de seguridad): argon2id para nuevos hashes. Para no romper usuarios
 * existentes con hashes bcrypt, verifyPassword detecta el formato y compara con el algoritmo
 * correcto; needsRehash() permite re-hashear a argon2 en el próximo login exitoso (rehash-on-login).
 */

import argon2 from '@node-rs/argon2';
import bcryptjs from 'bcryptjs';

/** Detecta un hash bcrypt ($2a/$2b/$2y). */
const isBcrypt = (hash) => typeof hash === 'string' && /^\$2[aby]\$/.test(hash);

/**
 * Hashea una contraseña con argon2id.
 * @param {string} plain - Contraseña en texto plano.
 * @returns {Promise<string>} El hash argon2id.
 */
export const hashPassword = (plain) => argon2.hash(plain);

/**
 * Verifica una contraseña contra su hash (soporta argon2id y bcrypt legacy).
 * @param {string} hash - Hash almacenado.
 * @param {string} plain - Contraseña a verificar.
 * @returns {Promise<boolean>} true si coincide.
 */
export const verifyPassword = async (hash, plain) => {
    if (!hash || plain == null) return false;
    try {
        // Hash legacy de bcrypt → comparar con bcrypt; resto → argon2.
        return isBcrypt(hash) ? await bcryptjs.compare(plain, hash) : await argon2.verify(hash, plain);
    } catch {
        return false; // hash corrupto / formato desconocido → no autorizar
    }
};

/**
 * Indica si un hash debería re-hashearse a argon2id (es bcrypt legacy).
 * @param {string} hash - Hash almacenado.
 * @returns {boolean} true si conviene re-hashear en el próximo login.
 */
export const needsRehash = (hash) => isBcrypt(hash);

/**
 * Rehash-on-login (ADR-007): si el hash del usuario es bcrypt legacy, lo migra a argon2id tras un
 * login exitoso, sin forzar reset de password. Best-effort — un fallo al guardar NO rompe el login
 * (se reintenta en el próximo). El modelo no auto-hashea en save (no hay hook), así que setear el
 * hash ya calculado es seguro (no hay doble hash).
 * @param {{password: string, save: Function}} user - Instancia (MasterUser o User de tenant) ya autenticada.
 * @param {string} plain - Contraseña en texto plano recién verificada.
 * @returns {Promise<boolean>} true si re-hasheó.
 */
export const rehashIfNeeded = async (user, plain) => {
    if (!user || !needsRehash(user.password)) return false;
    try {
        user.password = await hashPassword(plain);
        await user.save();
        return true;
    } catch {
        return false;
    }
};
