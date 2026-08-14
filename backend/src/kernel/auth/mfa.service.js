/**
 * Sistema Interno — MFA / 2FA por TOTP (otplib) + backup codes.
 *
 * Best-practice (skill 2FA): TOTP 6 dígitos / 30s; 10 backup codes de un solo uso; secret y
 * backup codes guardados de forma protegida; verificación con ventana ±1 para tolerar drift.
 * Este servicio es puro (genera/verifica); el almacenamiento (MasterUser.mfaSecret/backupCodes)
 * y el flujo de enroll/login lo maneja el controller.
 */

import crypto from 'crypto';
// otplib es CommonJS: import default + destructuring (interop ESM↔CJS robusto).
import otplib from 'otplib';
const { authenticator } = otplib;

// Ventana de ±1 step (30s) para tolerar desfasajes de reloj del dispositivo.
authenticator.options = { window: 1 };

/** Nombre de la app que aparece en la app de autenticación. */
const ISSUER = process.env.APP_NAME || 'Sistema Interno';

/**
 * Genera un secreto TOTP nuevo.
 * @returns {string} Secreto base32.
 */
export const generateSecret = () => authenticator.generateSecret();

/**
 * Construye la URI otpauth:// para mostrar como QR en el enrolamiento.
 * @param {string} secret - Secreto TOTP.
 * @param {string} accountLabel - Identificador del usuario (ej. email/username).
 * @returns {string} URI otpauth:// (para renderizar como QR en el frontend).
 */
export const buildOtpAuthUrl = (secret, accountLabel) =>
    authenticator.keyuri(accountLabel, ISSUER, secret);

/**
 * Verifica un código TOTP contra el secreto.
 * @param {string} token - Código de 6 dígitos ingresado por el usuario.
 * @param {string} secret - Secreto TOTP del usuario.
 * @returns {boolean} true si el código es válido.
 */
export const verifyToken = (token, secret) => {
    if (!token || !secret) return false;
    try {
        return authenticator.verify({ token: String(token).trim(), secret });
    } catch {
        return false;
    }
};

/**
 * Genera N backup codes de un solo uso (en claro para mostrarlos UNA vez) + su versión
 * hasheada para guardar. Nunca se guardan en claro.
 * @param {number} [amount=10] - Cantidad de códigos.
 * @returns {{ plain: string[], hashed: string[] }} Códigos en claro (mostrar) y hasheados (guardar).
 */
export const generateBackupCodes = (amount = 10) => {
    const plain = [];
    const hashed = [];
    for (let i = 0; i < amount; i++) {
        // Código legible de 10 hex chars.
        const code = crypto.randomBytes(5).toString('hex');
        plain.push(code);
        hashed.push(hashBackupCode(code));
    }
    return { plain, hashed };
};

/**
 * Hashea un backup code (SHA-256) para comparar sin guardarlo en claro.
 * @param {string} code - Código en claro.
 * @returns {string} Hash hex.
 */
export const hashBackupCode = (code) =>
    crypto.createHash('sha256').update(String(code).trim()).digest('hex');

/**
 * Consume un backup code: si coincide con alguno guardado, lo devuelve removido del set.
 * @param {string} code - Código ingresado por el usuario.
 * @param {string[]} hashedCodes - Códigos hasheados guardados.
 * @returns {{ valid: boolean, remaining: string[] }} Validez + set restante (sin el usado).
 */
export const consumeBackupCode = (code, hashedCodes = []) => {
    const h = hashBackupCode(code);
    const idx = hashedCodes.indexOf(h);
    if (idx === -1) return { valid: false, remaining: hashedCodes };
    const remaining = hashedCodes.filter((_, i) => i !== idx); // un solo uso
    return { valid: true, remaining };
};
