/**
 * Rutas de configuración de aplicación: GET /app-config · PUT /app-config.
 * Capability-based (`configuracion:*`). El PUT recibe { name, value } y valida contra
 * el registro de claves (appConfig.service).
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { matchedData } from 'express-validator';
import { requireCapability, registerCapabilities } from '../../capability.js';
import { validator } from '../../../middlewares/validator.js';
import { responseManager } from '../../../libs/responseManager.js';
import { listAppConfig, setAppConfig } from '../services/appConfig.service.js';

registerCapabilities(['configuracion:read', 'configuracion:update']);

const router = Router();

router.get('/', requireCapability('configuracion:read'), async (req, res) => {
    try {
        const configs = await listAppConfig(req.models);
        return await responseManager(200, configs, req, res, false);
    } catch (e) {
        return await responseManager(500, e.message, req, res, true);
    }
});

router.put(
    '/',
    requireCapability('configuracion:update'),
    [
        body('name').isString().trim().notEmpty(),
        body('value').exists().withMessage('Falta el valor'),
        validator,
    ],
    async (req, res) => {
        try {
            const { name, value } = matchedData(req);
            const saved = await setAppConfig(req.models, name, String(value));
            // Cotización del dólar: cada cambio deja rastro en el histórico (mejora §10.10).
            if (name === 'COTIZACION_DOLAR' && req.models.CotizacionDolar) {
                await req.models.CotizacionDolar.create({ valor: Number(saved), userId: req.user?.id ?? null }).catch(() => null);
            }
            if (req.io) req.io.to('app').emit('app-config:updated', { name, value: saved });
            return await responseManager(200, { name, value: saved }, req, res, false);
        } catch (e) {
            return await responseManager(e.statusCode || 500, e.message, req, res, (e.statusCode || 500) >= 500);
        }
    }
);

// Histórico de cotizaciones (más nuevas primero, con quién la cambió).
router.get('/cotizaciones', requireCapability('configuracion:read'), async (req, res) => {
    try {
        const rows = await req.models.CotizacionDolar.findAll({
            include: [{ model: req.models.User, attributes: ['id', 'name', 'lastName'], required: false, paranoid: false }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            limit: 100
        });
        return await responseManager(200, rows.map(r => ({
            id: r.id,
            valor: Number(r.valor),
            fecha: r.createdAt,
            usuario: r.user ? `${r.user.name} ${r.user.lastName}`.trim() : null
        })), req, res, false);
    } catch (e) {
        return await responseManager(500, e.message, req, res, true);
    }
});

export default router;
