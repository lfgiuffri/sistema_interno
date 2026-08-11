/**
 * Sistema Interno — Contexto de base de datos por request (single-tenant).
 *
 * Reemplaza a tenantIdentification de Zero 2.0: no hay tenant que resolver — la conexión
 * y los modelos son singletons inicializados al boot. Este middleware los inyecta en el
 * request para conservar el contrato que ya usan controllers y services (`req.models`,
 * `req.db`), de modo que los módulos sigan siendo portables.
 */

import { db, getModels } from '../database.js';
import { responseManager } from '../libs/responseManager.js';

/**
 * Inyecta `req.db` y `req.models` desde los singletons de la app.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Next.
 * @returns {Promise<void>}
 */
export const dbContext = async (req, res, next) => {
    try {
        req.db = db;
        req.models = getModels();
        next();
    } catch (error) {
        // getModels tira si el boot no terminó: request llegó demasiado temprano.
        console.error('❌ [DB_CONTEXT]', error.message);
        return await responseManager(500, 'La aplicación todavía está inicializando', req, res, false);
    }
};
