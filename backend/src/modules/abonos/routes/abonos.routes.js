import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/abonos.controller.js';
import {
    validateList, validateId, validateCreate, validateUpdate,
    validateActualizarPreview, validateActualizarAplicar,
    validateFacturarPreview, validateFacturarAplicar,
    validateFacturacionesList, validateAnular,
} from '../validators/abonos.validator.js';

const router = Router();

// ── Facturaciones (histórico + anulación) — ANTES de /:id para no colisionar ──
router.get('/facturaciones', requireCapability('facturaciones:read'), validateFacturacionesList, controller.facturaciones);
router.post('/facturaciones/:id/anular', requireCapability('facturaciones:anular'), validateAnular, controller.anular);

// ── Flujos de dos pasos ──
router.post('/actualizar/preview', requireCapability('abonos:actualizar-precio'), validateActualizarPreview, controller.actualizarPreview);
router.post('/actualizar', requireCapability('abonos:actualizar-precio'), validateActualizarAplicar, controller.actualizarAplicar);
router.post('/facturar/preview', requireCapability('abonos:facturar'), validateFacturarPreview, controller.facturarPreview);
router.post('/facturar', requireCapability('abonos:facturar'), validateFacturarAplicar, controller.facturarAplicar);

// ── Resumen del listado ──
router.get('/resumen', requireCapability('abonos:read'), validateList, controller.resumen);

// ── CRUD ──
router.get('/', requireCapability('abonos:read'), validateList, controller.list);
router.get('/:id', requireCapability('abonos:read'), validateId, controller.getById);
router.get('/:id/actualizaciones', requireCapability('abonos:read'), validateId, controller.actualizaciones);
router.post('/', requireCapability('abonos:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('abonos:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('abonos:toggle'), validateId, controller.toggle);
router.delete('/:id', requireCapability('abonos:delete'), validateId, controller.remove);

export default router;
