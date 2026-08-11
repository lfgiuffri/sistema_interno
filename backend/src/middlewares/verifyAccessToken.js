/**
 * Sistema Interno — Verificación de tokens JWT (single-tenant).
 *
 * El payload de los tokens es mínimo ({ id, username, type }): rol y estado se releen de la
 * base en CADA verificación, así una baja o un cambio de rol impactan de inmediato sin
 * esperar a que venza el token (misma garantía que tenía el sistema legado por sesión).
 */

import jwt from 'jsonwebtoken';
import { responseManager } from '../libs/responseManager.js';
import { getModels } from '../database.js';

/**
 * Lee una config dinámica de la tabla configs (con fallback).
 * @param {object} modelsOrReq - req con .models, o los modelos directamente.
 * @param {string} configName - Clave de config (ej. 'ACCESS_TOKEN_EXPIRY').
 * @param {string} defaultValue - Valor por defecto.
 * @returns {Promise<string>} El valor configurado o el default.
 */
export const getTokenExpiry = async (modelsOrReq, configName, defaultValue) => {
    try {
        const models = modelsOrReq?.models || modelsOrReq;
        if (models && models.Config) {
            const config = await models.Config.findOne({ where: { name: configName } });
            return config ? config.value : defaultValue;
        }
        return defaultValue;
    } catch (error) {
        console.log(`⚠️ Error obteniendo config ${configName}, usando valor por defecto: ${defaultValue}`);
        return defaultValue;
    }
};

/**
 * Resuelve los modelos del request (dbContext) o del singleton (rutas montadas sin dbContext).
 * @param {import('express').Request} req - Request.
 * @returns {object} Modelos de la app.
 */
const resolveModels = (req) => {
    if (req.models) return req.models;
    const models = getModels();
    req.models = models;
    return models;
};

/**
 * Middleware que exige un access token válido y carga req.user (fresco, con rol).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Next.
 * @returns {Promise<void>}
 */
export const verifyAccessToken = async (req, res, next) => {
    try {
        const token = req.headers['x-access-token'];
        if (!token) {
            return await responseManager(401, 'No se proporcionó token', req, res, false);
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'access') {
            return await responseManager(401, 'Invalid token type', req, res, false);
        }

        const { User, Role } = resolveModels(req);
        const user = await User.findOne({
            where: { id: decoded.id },
            include: [{ model: Role }],
            attributes: { exclude: ['password', 'mfaSecret', 'mfaBackupCodes'] }
        });

        if (!user) {
            return await responseManager(403, 'Usuario no encontrado', req, res, false);
        }
        if (!user.active) {
            return await responseManager(403, 'Usuario inactivo', req, res, false);
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return await responseManager(401, 'Access token expired', req, res, false, { errorCode: 'TOKEN_EXPIRED' });
        }
        return await responseManager(401, 'Invalid access token', req, res, false);
    }
};

/**
 * Middleware que exige un refresh token válido y carga req.user (revalidando activo).
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Next.
 * @returns {Promise<void>}
 */
export const verifyRefreshToken = async (req, res, next) => {
    try {
        const token = req.headers['x-refresh-token'] || req.body.refreshToken;
        if (!token) {
            return await responseManager(401, 'No se proporcionó refresh token', req, res, false);
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'refresh') {
            return await responseManager(401, 'Invalid token type', req, res, false);
        }

        const { User } = resolveModels(req);
        const user = await User.findOne({ where: { id: decoded.id } });

        if (!user) {
            return await responseManager(403, 'Usuario no encontrado', req, res, false);
        }
        if (!user.active) {
            return await responseManager(403, 'Usuario inactivo', req, res, false);
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return await responseManager(401, 'Refresh token expired', req, res, false, { errorCode: 'REFRESH_TOKEN_EXPIRED' });
        }
        return await responseManager(401, 'Invalid refresh token', req, res, false);
    }
};
