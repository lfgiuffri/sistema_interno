/**
 * Sistema Interno — Auth single-tenant.
 *
 * Login por username/email + password (argon2id, back-compat bcrypt con rehash-on-login),
 * lockout por fuerza bruta, MFA/TOTP opcional con backup codes, refresh de tokens y
 * cambio de contraseña con step-up. Reemplaza al login centralizado de master de Zero 2.0.
 */

import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { matchedData } from 'express-validator';
import { responseManager } from '../../../libs/responseManager.js';
import { getIP } from '../../../libs/getIp.js';
import { generateTokens, issueSession, signMfaToken } from '../../auth/session.service.js';
import { rehashIfNeeded } from '../../auth/password.js';
import { lockoutSecondsRemaining, registerLoginAttempt } from '../../auth/lockout.service.js';
import { generateSecret, buildOtpAuthUrl, verifyToken, generateBackupCodes, consumeBackupCode } from '../../auth/mfa.service.js';

/**
 * Busca un usuario habilitable para login por username o email (no eliminado).
 * @param {object} models - Modelos de la app.
 * @param {string} username - Username o email tipeado.
 * @returns {Promise<object|null>} El usuario o null.
 */
const findLoginUser = (models, username) =>
    models.User.findOne({ where: { [Op.or]: [{ username }, { email: username }] } });

/**
 * Login con password. Aplica lockout ANTES de tocar la base de usuarios y devuelve
 * mensajes genéricos (no revela si el usuario existe o está inactivo).
 * POST /auth/signin  Body: { username, password }
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} Sesión, o { mfaRequired, mfaToken } si el usuario tiene MFA.
 */
export const signIn = async (req, res) => {
    try {
        const { username, password } = matchedData(req);
        const ip = getIP(req);

        // 1. Lockout: demasiados fallos recientes → ni siquiera verificamos credenciales.
        const lockSeconds = await lockoutSecondsRemaining(req.models, username, ip);
        if (lockSeconds > 0) {
            const minutes = Math.ceil(lockSeconds / 60);
            return await responseManager(429,
                `Demasiados intentos fallidos. Esperá ${minutes} minuto(s) e intentá de nuevo.`,
                req, res, false, { errorCode: 'LOGIN_LOCKED' });
        }

        // 2. Credenciales. Usuario inexistente, inactivo o password inválido → mismo mensaje
        //    (anti-enumeración), pero solo los intentos con credencial inválida cuentan como fallo.
        const user = await findLoginUser(req.models, username);
        const passValid = user ? await user.comparePassword(password, user.password) : false;

        if (!user || !passValid || !user.active) {
            // El fallo se registra también para usuarios inexistentes: castiga el scanning.
            await registerLoginAttempt(req.models, username, ip, false);
            return await responseManager(401, 'Credenciales inválidas', req, res, false);
        }

        // Rehash-on-login (ADR-007): migra hashes bcrypt legacy a argon2id, best-effort.
        await rehashIfNeeded(user, password);

        // 3. MFA: password OK pero falta el 2do factor → token intermedio, sin sesión todavía.
        if (user.mfaEnabled) {
            await registerLoginAttempt(req.models, username, ip, true);
            return await responseManager(200, { mfaRequired: true, mfaToken: signMfaToken(user) }, req, res, false);
        }

        // 4. Sesión completa.
        await registerLoginAttempt(req.models, username, ip, true);
        await user.update({ lastLoginAt: new Date(), lastLoginIp: ip });
        const data = await issueSession(user, req.models);
        console.log(`✅ [AUTH] Login exitoso: ${user.username}`);
        return await responseManager(200, data, req, res, false);
    } catch (error) {
        console.error('❌ [AUTH] Error en signin:', error);
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Renueva el par de tokens. verifyRefreshToken (middleware) ya validó el token y cargó
 * req.user revalidando que siga activo — una baja corta la sesión en el próximo refresh.
 * POST /auth/refresh  Header: x-refresh-token
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { accessToken, refreshToken, expiresIn }.
 */
export const refreshToken = async (req, res) => {
    try {
        const { accessToken, refreshToken: newRefreshToken, accessExpiry } = await generateTokens(req.user, req.models);
        return await responseManager(200, {
            accessToken,
            refreshToken: newRefreshToken,
            expiresIn: accessExpiry
        }, req, res, false);
    } catch (error) {
        console.error('❌ [AUTH] Error en refresh:', error.message);
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Cambio de contraseña del usuario logueado (step-up: exige la contraseña actual).
 * POST /auth/change-password  Body: { currentPassword, newPassword }  (x-access-token)
 * @param {import('express').Request} req - Request (req.user vía verifyAccessToken).
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = matchedData(req);

        // req.user viene sin el hash (verifyAccessToken lo excluye): lo recargamos completo.
        const user = await req.models.User.findByPk(req.user.id);
        if (!user) return await responseManager(404, 'Usuario no encontrado', req, res, false);

        const valid = await user.comparePassword(currentPassword, user.password);
        if (!valid) return await responseManager(401, 'Contraseña actual incorrecta', req, res, false);

        const hashed = await user.encryptPassword(newPassword);
        await user.update({ password: hashed });
        console.log(`✅ [AUTH] Password cambiado para: ${user.username}`);
        return await responseManager(200, { message: 'Contraseña actualizada exitosamente' }, req, res, false);
    } catch (error) {
        console.error('❌ [AUTH] Error en changePassword:', error);
        return await responseManager(500, error.message, req, res, true);
    }
};

// ─── MFA (TOTP + backup codes) ────────────────────────────────────────────────

/**
 * Inicia el enrolamiento de MFA: genera secreto + URL otpauth (QR) + backup codes.
 * Guarda el secreto + codes hasheados pero NO activa MFA hasta verificar un código.
 * POST /auth/mfa/enroll  (x-access-token)
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { secret, otpauthUrl, backupCodes } (los codes se muestran UNA vez).
 */
export const mfaEnroll = async (req, res) => {
    try {
        const user = await req.models.User.findByPk(req.user.id);
        if (!user) return await responseManager(404, 'Usuario no encontrado', req, res, false);

        const secret = generateSecret();
        const { plain, hashed } = generateBackupCodes();
        await user.update({ mfaSecret: secret, mfaBackupCodes: hashed, mfaEnabled: false });

        return await responseManager(200, {
            secret,
            otpauthUrl: buildOtpAuthUrl(secret, user.username),
            backupCodes: plain // ⚠️ se muestran UNA sola vez
        }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Activa MFA verificando un código TOTP contra el secreto pendiente del enrolamiento.
 * POST /auth/mfa/activate  Body: { code }  (x-access-token)
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const mfaActivate = async (req, res) => {
    try {
        const user = await req.models.User.findByPk(req.user.id);
        if (!user?.mfaSecret) return await responseManager(400, 'No hay enrolamiento de MFA pendiente', req, res, false);

        if (!verifyToken(req.body?.code, user.mfaSecret)) {
            return await responseManager(400, 'Código inválido', req, res, false);
        }
        await user.update({ mfaEnabled: true });
        return await responseManager(200, { message: 'MFA activado' }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Estado del MFA del usuario logueado (la UI de Seguridad muestra activar o desactivar).
 * GET /auth/mfa/status  (x-access-token)
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>} { mfaEnabled: boolean }.
 */
export const mfaStatus = async (req, res) => {
    try {
        return await responseManager(200, { mfaEnabled: !!req.user.mfaEnabled }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Desactiva MFA. Requiere la contraseña actual (step-up) para evitar abuso.
 * POST /auth/mfa/disable  Body: { password }  (x-access-token)
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const mfaDisable = async (req, res) => {
    try {
        const user = await req.models.User.findByPk(req.user.id);
        if (!user) return await responseManager(404, 'Usuario no encontrado', req, res, false);

        if (!(await user.comparePassword(req.body?.password || '', user.password))) {
            return await responseManager(401, 'Contraseña incorrecta', req, res, false);
        }
        await user.update({ mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null });
        return await responseManager(200, { message: 'MFA desactivado' }, req, res, false);
    } catch (error) {
        return await responseManager(500, error.message, req, res, true);
    }
};

/**
 * Completa el login con MFA: intercambia el mfaToken + código (TOTP o backup) por la sesión.
 * POST /auth/mfa/login  Body: { mfaToken, code }
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const mfaVerifyLogin = async (req, res) => {
    try {
        const { mfaToken, code } = req.body || {};
        const decoded = jwt.verify(mfaToken, process.env.JWT_SECRET);
        if (decoded.purpose !== 'mfa') return await responseManager(401, 'Token de MFA inválido', req, res, false);

        const user = await req.models.User.findByPk(decoded.userId);
        if (!user || !user.active || !user.mfaEnabled) {
            return await responseManager(401, 'MFA no habilitado', req, res, false);
        }

        // Aceptamos un código TOTP válido O un backup code de un solo uso.
        let ok = verifyToken(code, user.mfaSecret);
        if (!ok) {
            const { valid, remaining } = consumeBackupCode(code, user.mfaBackupCodes || []);
            if (valid) {
                await user.update({ mfaBackupCodes: remaining }); // consumir el backup code
                ok = true;
            }
        }
        if (!ok) return await responseManager(400, 'Código inválido', req, res, false);

        await user.update({ lastLoginAt: new Date(), lastLoginIp: getIP(req) });
        const data = await issueSession(user, req.models);
        return await responseManager(200, data, req, res, false);
    } catch (error) {
        return await responseManager(401, 'Token de MFA inválido', req, res, false);
    }
};
