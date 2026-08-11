/**
 * Controller del módulo `dashboard` (thin).
 */

import { responseManager } from '../../../kernel/index.js';
import { armarDashboard } from '../services/dashboard.service.js';

/**
 * GET /dashboard — los bloques del panel según las capabilities del usuario.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @returns {Promise<void>}
 */
export const get = async (req, res) => {
    try {
        const data = await armarDashboard(req.models, req.user, req.query.anio);
        return await responseManager(200, data, req, res, false);
    } catch (e) {
        return await responseManager(500, e.message, req, res, true);
    }
};
