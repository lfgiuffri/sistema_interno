/**
 * Rutas de notificaciones PERSONALES: como /me, no llevan capability — cada usuario ve
 * y marca SOLO las suyas (el scope por userId es duro en el service).
 */

import { Router } from 'express';
import { body, query } from 'express-validator';
import { validator } from '../../middlewares/validator.js';
import { responseManager } from '../../libs/responseManager.js';
import { listNotificaciones, marcarLeidas } from './notificaciones.service.js';

const router = Router();

router.get(
    '/',
    [query('limit').optional().isInt({ min: 1, max: 100 }), validator],
    async (req, res) => {
        try {
            const data = await listNotificaciones(req.models, req.user.id, req.query.limit);
            return await responseManager(200, data, req, res, false);
        } catch (e) {
            return await responseManager(500, e.message, req, res, true);
        }
    }
);

router.patch(
    '/leidas',
    [body('ids').optional().isArray(), body('ids.*').isInt({ min: 1 }), validator],
    async (req, res) => {
        try {
            const n = await marcarLeidas(req.models, req.user.id, req.body.ids ?? null);
            return await responseManager(200, { marcadas: n }, req, res, false);
        } catch (e) {
            return await responseManager(500, e.message, req, res, true);
        }
    }
);

export default router;
