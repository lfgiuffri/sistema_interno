/**
 * Sistema Interno — Emisión de sesión (tokens JWT) single-tenant.
 *
 * Concentra la lógica de issuance: firmar tokens y armar la respuesta de sesión uniforme
 * sin importar el método de login (password o MFA). El controller queda fino: orquesta el
 * flujo y delega la emisión. Los tiempos de expiración salen de la config dinámica
 * (tabla configs) con defaults sanos.
 */

import jwt from 'jsonwebtoken';
import { getTokenExpiry } from '../../middlewares/verifyAccessToken.js';

/** TTL del token intermedio de MFA (entre password OK y verificación del 2do factor). */
const MFA_TOKEN_TTL = process.env.MFA_TOKEN_TTL || '10m';

/**
 * Genera el par access/refresh para un usuario. El payload es mínimo a propósito
 * (id + type): los datos frescos (rol, activo) se releen de la base en cada verify,
 * así un cambio de permisos o una baja impactan sin esperar a que venza el token.
 * @param {object} user - Usuario autenticado (instancia de User).
 * @param {object|null} models - Modelos de la app (para leer configs de expiración) o null.
 * @returns {Promise<{accessToken: string, refreshToken: string, accessExpiry: string, refreshExpiry: string}>}
 */
export const generateTokens = async (user, models = null) => {
    const accessExpiry = models ? await getTokenExpiry(models, 'ACCESS_TOKEN_EXPIRY', '15m') : '15m';
    const refreshExpiry = models ? await getTokenExpiry(models, 'REFRESH_TOKEN_EXPIRY', '7d') : '7d';

    const payload = { id: user.id, username: user.username };

    const accessToken = jwt.sign({ ...payload, type: 'access' }, process.env.JWT_SECRET, { expiresIn: accessExpiry });
    const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: refreshExpiry });

    return { accessToken, refreshToken, accessExpiry, refreshExpiry };
};

/**
 * Construye la respuesta de sesión (tokens + datos básicos) para un usuario ya autenticado.
 * Compartida por signIn (password) y mfaVerifyLogin (2do factor) para que el shape sea
 * idéntico sin importar el método de login.
 * @param {object} user - Usuario autenticado.
 * @param {object|null} models - Modelos de la app (configs de expiración).
 * @returns {Promise<object>} { auth, accessToken, refreshToken, expiresIn, user }.
 */
export const issueSession = async (user, models = null) => {
    const { accessToken, refreshToken, accessExpiry } = await generateTokens(user, models);
    return {
        auth: true,
        accessToken,
        refreshToken,
        expiresIn: accessExpiry,
        user: {
            id: user.id,
            name: user.name,
            lastName: user.lastName,
            username: user.username,
            email: user.email,
            roleId: user.roleId
        }
    };
};

/**
 * Firma un token intermedio de MFA (corto): prueba que pasó el 1er factor, falta el 2do.
 * @param {object} user - Usuario que pasó el password.
 * @returns {string} JWT con purpose 'mfa'.
 */
export const signMfaToken = (user) =>
    jwt.sign({ userId: user.id, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: MFA_TOKEN_TTL });
