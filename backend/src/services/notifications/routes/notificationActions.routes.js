import { Router } from 'express';
import { responseManager } from '../../../libs/responseManager.js';
import { getSchedulerIO } from '../../scheduler/services/scheduler.service.js';
import { executeSignedNotificationAction } from '../services/notificationActions.service.js';

const router = Router();

router.post('/execute', async (req, res) => {
    try {
        const { token } = req.body || {};
        if (!token || typeof token !== 'string') {
            return responseManager(400, 'Token de acción requerido', req, res, false);
        }

        const result = await executeSignedNotificationAction(token, { io: getSchedulerIO() });
        return responseManager(200, result, req, res, false, { message: 'Acción ejecutada' });
    } catch (error) {
        const isAuthError = /token|jwt|firma|inválido|expir/i.test(error.message || '');
        return responseManager(isAuthError ? 401 : 400, error.message || 'No se pudo ejecutar la acción', req, res, false);
    }
});

export default router;